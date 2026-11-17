// Reading what a visitor submits into draft listings (PLAN 8.3; D-135).
//
// A visitor gives a URL or pastes text. Either becomes up to three draft listings for the visitor
// to check field by field before the submission goes to moderation. Nothing here writes to the
// database: the caller stores the drafts (the `submissions` table) once the page UI exists.
//
// - A URL is checked (`untrustedUrlProblem`) and fetched through a client built by
//   `submissionHttp`, whose transport refuses our own network at connect time and on every
//   redirect (D-134). robots.txt and the blocklist apply as to any crawl.
// - A page's schema.org events are read first, with no model call (`jsonLdToListings`).
// - Otherwise the page text, or the pasted text, is read by the `submission` job. It carries
//   untrusted text, so only a provider that does not train on input may serve it (`routableFor`).
//   Its spend is counted under its own quota scope, `submissions`, never a real metro's share.
// - The read is checked against the text it came from (`extractionToHarvested`): a title, date,
//   time, price or link the text does not write is dropped, never guessed.
// - When the model cannot read it (no provider, quota spent, a failed reply), the submission is
//   `queued`: a person reads it in moderation. A visitor's submission is never lost to a quota.

import { jobById } from "@/src/ai/jobs";
import { EXTRACT_JSON_SCHEMA, EXTRACT_SYSTEM, extractUserTurn } from "@/src/ai/prompts";
import type { AiClient } from "@/src/ai/client";
import type { AiProviderId, AiUsage } from "@/src/ai/types";
import { extractJsonLd, jsonLdToListings } from "@/src/adapters/feeds/jsonld";
import type { HarvestedListing, Metro } from "@/src/adapters/types";
import type { ListingDraft } from "@/src/db/schema/submissions";
import { rawExtractionSchema } from "@/src/domain/listing";
import { currentNightDate } from "@/src/domain/tonight";
import { EMPTY_BLOCKLIST, registrableDomain, type Blocklist } from "@/src/pipeline/blocklist";
import { cleanPageText } from "@/src/pipeline/clean";
import { extractionToHarvested } from "@/src/pipeline/extract";
import { createPoliteHttp, HttpError, type HttpClient, type Transport } from "@/src/pipeline/http";
import { expandRecurrence, normalizeListing, type NormalizedEvent } from "@/src/pipeline/normalize";
import {
  untrustedTransport,
  untrustedUrlProblem,
  type UntrustedPolicy,
  type UntrustedTransportOptions,
} from "@/src/pipeline/untrusted-transport";

/** The ledger scope submissions spend under: capped like a metro, and no metro's share (D-135). */
export const SUBMISSION_QUOTA_SCOPE = "submissions";
/** A submission describes one event, or a short series: the `submission` job is sized for three. */
export const SUBMISSION_LISTINGS_MAX = 3;
/** Pasted text longer than this is refused, not cut: a cut could drop the very date or time. */
export const SUBMISSION_TEXT_MAX_CHARS = 12_000;
/** A submitted page larger than this is not read. */
export const SUBMISSION_MAX_BYTES = 2 * 1024 * 1024;
export const SUBMISSION_TIMEOUT_MS = 15_000;
/**
 * Where pasted text "comes from", for the checks that compare links with the page's own address.
 * `.invalid` never resolves (RFC 2606), and it never reaches a draft (`toDraft`).
 */
export const PASTED_TEXT_URL = "https://pasted-text.invalid/";

export type SubmissionRequest = { kind: "url"; url: string } | { kind: "text"; text: string };

/** One model call, for the cost log. */
export interface SubmissionCall {
  provider: AiProviderId | null;
  model: string | null;
  usage: AiUsage | null;
  outcome: string;
}

export type SubmissionRead =
  /** Read: the drafts, for the visitor to check. */
  | {
      status: "draft";
      method: "jsonld" | "model";
      drafts: ListingDraft[];
      notes: string[];
      calls: SubmissionCall[];
    }
  /** Read, and no dance night found in it. */
  | { status: "empty"; method: "jsonld" | "model"; notes: string[]; calls: SubmissionCall[] }
  /** Not read by a model now (none available, quota spent, a failed reply): a person reads it. */
  | { status: "queued"; reason: string; calls: SubmissionCall[] }
  /**
   * The page could not be fetched (robots.txt, a 404, a timeout, too large). `reason` is fixed
   * wording for the visitor; `detail` is for our logs only, never shown: it can name a host.
   */
  | { status: "unreadable"; reason: string; detail: string }
  /** The input itself is refused: a URL we may not fetch, or empty or over-long text. */
  | { status: "refused"; reason: string };

export interface SubmissionDeps {
  /** Built by `submissionHttp`: a client on any other transport could reach our own network. */
  http: HttpClient;
  /** Null when no model may be used; a text the model would read is then queued. */
  ai: { client: AiClient } | null;
  /** The metro the submission is for: its zone, its tonight and its currency. */
  metro: Metro;
  now: Date;
  /** Widens what a URL may name, for tests against a local server only. */
  urlPolicy?: UntrustedPolicy;
}

/**
 * The polite client a submission's URL is fetched with (D-134). Every redirect hop is checked
 * against the blocklist and its own site's robots.txt, as the first URL is: a link shortener
 * must not lead us to a site that asked to be left out.
 */
export function submissionHttp(options: {
  userAgent: string;
  blocklist?: Blocklist;
  /** Widens what may be reached, for tests against a local server only. */
  untrusted?: Omit<UntrustedTransportOptions, "checkHop">;
  /** Replaces the guarded transport, for fixture tests only. */
  transport?: Transport;
  sleep?: (ms: number) => Promise<void>;
}): HttpClient {
  const blocklist = options.blocklist ?? EMPTY_BLOCKLIST;
  const checkHop = async (url: string, firstUrl: string) => {
    const blocked = blocklist.matchUrl(url);
    if (blocked)
      throw new HttpError("blocklisted", url, `on the blocklist (${blocked.patternType})`);
    const parsed = new URL(url);
    // robots.txt itself is fetched whatever it says (RFC 9309), and asking for its own policy
    // while fetching it would wait on itself.
    if (parsed.pathname === "/robots.txt") return;
    // A hop within the first URL's own site (http to https, www to none) is the site's own
    // redirect, under the robots.txt already honoured; asking again would wait on the turn the
    // first request holds for that site.
    if (registrableDomain(parsed.hostname) === registrableDomain(new URL(firstUrl).hostname)) {
      return;
    }
    const policy = await client.robots(url);
    const path = `${parsed.pathname}${parsed.search}`;
    if (!policy.isAllowed(path)) {
      throw new HttpError("robots_disallowed", url, `robots.txt disallows ${path}`);
    }
  };
  const client: HttpClient = createPoliteHttp({
    transport: options.transport ?? untrustedTransport({ ...options.untrusted, checkHop }),
    userAgent: options.userAgent,
    blocklist,
    ...(options.sleep ? { sleep: options.sleep } : {}),
    maxBytes: SUBMISSION_MAX_BYTES,
    timeoutMs: SUBMISSION_TIMEOUT_MS,
  });
  return client;
}

/** What the visitor is told when a page could not be fetched: never a host or an address. */
function unreadableReason(error: unknown): string {
  if (!(error instanceof HttpError)) return "the page could not be fetched";
  switch (error.kind) {
    case "robots_disallowed":
      // An unreachable robots.txt counts as disallowing everything (RFC 9309), but the site
      // asked nothing: to the visitor it is a page that could not be fetched.
      return error.message.startsWith("robots.txt could not be fetched")
        ? "the page could not be fetched"
        : "the site asks automated readers not to read this page";
    case "http_status":
    case "stopped":
      return error.status ? `the site answered ${error.status}` : "the site refused the request";
    case "too_large":
      return "the page is too large to read";
    case "timeout":
      return "the site did not answer in time";
    default:
      return "the page could not be fetched";
  }
}

/** The JSON Schema for the reply: the extraction schema, held to the job's three listings. */
const SUBMISSION_JSON_SCHEMA = (() => {
  const schema = structuredClone(EXTRACT_JSON_SCHEMA) as {
    properties?: { listings?: { maxItems?: number } };
  };
  if (schema.properties?.listings) schema.properties.listings.maxItems = SUBMISSION_LISTINGS_MAX;
  return schema as Record<string, unknown>;
})();

// Control characters other than tab and newline carry nothing a reader needs.
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f]/g;

export async function readSubmission(
  request: SubmissionRequest,
  deps: SubmissionDeps,
): Promise<SubmissionRead> {
  const tonight = currentNightDate(deps.now, deps.metro.tz);
  if (request.kind === "text") {
    const text = request.text.replace(/\r\n?/g, "\n").replace(CONTROL, "").trim();
    if (!text) return { status: "refused", reason: "there is no text to read" };
    if (text.length > SUBMISSION_TEXT_MAX_CHARS) {
      return {
        status: "refused",
        reason: `the text is over ${SUBMISSION_TEXT_MAX_CHARS} characters`,
      };
    }
    return readWithModel(text, null, deps.now, tonight, deps);
  }

  const url = request.url.trim();
  const problem = untrustedUrlProblem(url, deps.urlPolicy);
  if (problem) return { status: "refused", reason: `this URL may not be fetched: ${problem}` };
  let page;
  try {
    page = await deps.http.request({
      url,
      purpose: "crawl",
      headers: { accept: "text/html,application/xhtml+xml" },
    });
  } catch (error) {
    // A name that resolves to one of our own addresses is reported as any failed fetch, so the
    // answer does not tell an outsider which internal names exist.
    return {
      status: "unreadable",
      reason: unreadableReason(error),
      detail: error instanceof Error ? error.message : String(error),
    };
  }
  const pageUrl = page.url || url;

  // A page's own structured events come first: no model call, and the page's own facts.
  const { blocks } = extractJsonLd(page.body);
  if (blocks.length > 0) {
    const fromJsonLd = jsonLdToListings(blocks, {
      pageUrl,
      fetchedAt: page.fetchedAt,
      metroTz: deps.metro.tz,
      countryCode: deps.metro.countryCode,
      fromNight: tonight,
    });
    if (fromJsonLd.listings.length > 0) {
      const { drafts, notes } = toDrafts(fromJsonLd.listings, pageUrl, tonight, deps);
      return drafts.length > 0
        ? {
            status: "draft",
            method: "jsonld",
            drafts,
            notes: [...(fromJsonLd.notes ?? []), ...notes],
            calls: [],
          }
        : {
            status: "empty",
            method: "jsonld",
            notes: [...(fromJsonLd.notes ?? []), ...notes],
            calls: [],
          };
    }
  }

  // The job is sized for pasted text's limit, and so is a page's text (D-135).
  const text = cleanPageText(page.body, pageUrl, SUBMISSION_TEXT_MAX_CHARS);
  if (!text.trim()) {
    return {
      status: "unreadable",
      reason: "the page has no text to read",
      detail: "no text after cleaning",
    };
  }
  // A site whose robots.txt asks that its content not be used as AI input is read by a person.
  const policy = await deps.http.robots(pageUrl);
  if (!policy.aiInputAllowed) {
    return {
      status: "queued",
      reason: "the site asks that its pages not be read by AI",
      calls: [],
    };
  }
  return readWithModel(text, pageUrl, page.fetchedAt, tonight, deps);
}

/** The model's read of a page's text, or of pasted text (`pageUrl` null). */
async function readWithModel(
  text: string,
  pageUrl: string | null,
  fetchedAt: Date,
  tonight: string,
  deps: SubmissionDeps,
): Promise<SubmissionRead> {
  if (!deps.ai) return { status: "queued", reason: "no model may read it now", calls: [] };
  const outcome = await deps.ai.client.run(
    {
      job: jobById("submission"),
      system: EXTRACT_SYSTEM,
      user: extractUserTurn(
        {
          url: pageUrl ?? "none: text a visitor pasted",
          sourceLabel: "a visitor's submission",
          today: tonight,
          tz: deps.metro.tz,
        },
        text,
      ),
      schema: rawExtractionSchema,
      jsonSchema: SUBMISSION_JSON_SCHEMA,
    },
    { metro: SUBMISSION_QUOTA_SCOPE },
  );
  const calls: SubmissionCall[] = [
    {
      provider: outcome.provider,
      model: outcome.ok ? outcome.model : null,
      usage: outcome.ok ? outcome.usage : (outcome.usage ?? null),
      outcome: outcome.ok ? "ok" : outcome.reason,
    },
  ];
  if (!outcome.ok) {
    return { status: "queued", reason: `the model could not read it (${outcome.reason})`, calls };
  }

  const notes: string[] = [];
  // Checked against the very text the model read: what it does not write is dropped.
  const read = extractionToHarvested(outcome.value, {
    pageUrl: pageUrl ?? PASTED_TEXT_URL,
    fetchedAt,
    today: tonight,
    pageText: text,
    countryCode: deps.metro.countryCode,
  });
  for (const r of read.rejected) notes.push(`${r.title}: ${r.reason}`);
  notes.push(...read.notes);
  const drafted = toDrafts(read.listings, pageUrl, tonight, deps);
  notes.push(...drafted.notes);
  return drafted.drafts.length > 0
    ? { status: "draft", method: "model", drafts: drafted.drafts, notes, calls }
    : { status: "empty", method: "model", notes, calls };
}

/**
 * One draft per listing read. A rule ("every Thursday") is drafted as its next night with the
 * rule's own words beside it, not as a month of nights.
 */
function toDrafts(
  listings: readonly HarvestedListing[],
  pageUrl: string | null,
  tonight: string,
  deps: SubmissionDeps,
): { drafts: ListingDraft[]; notes: string[] } {
  const nights: Array<{ event: NormalizedEvent; recurrenceText: string | null }> = [];
  const notes: string[] = [];
  const seen = new Set<string>();
  for (const harvested of listings) {
    const title = harvested.listing.title.trim();
    let one = harvested;
    let recurrenceText: string | null = null;
    if (harvested.recurrence) {
      const expanded = expandRecurrence(harvested, tonight, deps.metro.tz);
      if (expanded.error || expanded.listings.length === 0) {
        notes.push(`${title}: ${expanded.error ?? "the rule has no night in the coming weeks"}`);
        continue;
      }
      one = expanded.listings[0]!;
      recurrenceText = harvested.listing.recurrence_text?.trim() || null;
    }
    const outcome = normalizeListing(one, {
      metro: deps.metro,
      source: { styles: [] },
      now: deps.now,
    });
    if (!outcome.ok) {
      notes.push(`${outcome.title}: ${outcome.reason}`);
      continue;
    }
    const event = outcome.event;
    if (event.cancelled) {
      notes.push(`${title}: listed as cancelled; not drafted`);
      continue;
    }
    if (event.nightDate < tonight) {
      notes.push(`${title}: ${event.nightDate} has passed; not drafted`);
      continue;
    }
    // One night, one draft: a page that gives several nights one @id is still several nights.
    const key = `${event.nightDate}|${event.startsAt?.toISOString() ?? "untimed"}|${event.titleNormalized}`;
    if (seen.has(key)) {
      notes.push(`${title}: listed twice for ${event.nightDate}; drafted once`);
      continue;
    }
    seen.add(key);
    nights.push({ event, recurrenceText });
  }
  // The coming nights first, whatever order the page lists them in.
  const when = (e: NormalizedEvent) => e.startsAt?.toISOString() ?? `${e.nightDate}T99`;
  nights.sort((a, b) => when(a.event).localeCompare(when(b.event)));
  if (nights.length > SUBMISSION_LISTINGS_MAX) {
    notes.push(`${nights.length} nights; the first ${SUBMISSION_LISTINGS_MAX} to come are drafted`);
  }
  return {
    drafts: nights
      .slice(0, SUBMISSION_LISTINGS_MAX)
      .map((n) => toDraft(n.event, n.recurrenceText, pageUrl)),
    notes,
  };
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

/** A normalized night as a draft: instants as ISO strings, its zone beside them. */
export function toDraft(
  event: NormalizedEvent,
  recurrenceText: string | null,
  pageUrl: string | null,
): ListingDraft {
  const own = event.canonicalUrl ?? event.eventUrl ?? pageUrl;
  return {
    title: event.title,
    listingType: event.listingType,
    styles: [...event.styles],
    nightDate: event.nightDate,
    doorsAt: iso(event.doorsAt),
    lessonAt: iso(event.lessonAt),
    dancingAt: iso(event.dancingAt),
    endsAt: iso(event.endsAt),
    tz: event.tz,
    venueName: event.venue.name,
    venueAddress: event.venue.address,
    organizerName: event.organizer.name,
    prices: event.prices,
    isFree: event.isFree,
    ticketUrl: event.ticketUrl,
    level: event.level,
    partnerRequired: event.partnerRequired,
    ageMin: event.ageMin,
    dressCode: event.dressCode,
    floor: event.floor,
    indoorOutdoor: event.indoorOutdoor,
    music: event.music,
    recurrenceText,
    canonicalUrl: own && !own.startsWith(PASTED_TEXT_URL) ? own : null,
  };
}
