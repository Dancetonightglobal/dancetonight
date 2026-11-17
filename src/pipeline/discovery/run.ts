// One venue-website discovery run for one metro (D-040 step 3, D-120): `pnpm discover --metro nyc`.
//
// 1. The metro's seeded venues with a website, inside the metro's outline, become candidates, one
//    per host, club, salsa and nightlife places first (candidates.ts). A host that already has a
//    source row, or is a starting address, is skipped and named.
// 2. At most `limit` candidates are probed (site-probe.ts), a few hosts at a time; the polite
//    client keeps every domain to one request per 5 seconds.
// 3. Every probed host gets a source row, so it is never a candidate again: a site a reader can
//    take becomes a source, and every other outcome is stored switched off with its reason (dead,
//    repurposed, blocked, unreachable, page only, nothing). The run report names every one.
//
// What is switched on: a club, salsa, dance-hall or nightlife place's calendar that a reader takes
// without a model (iCalendar, The Events Calendar, schema.org events, Squarespace), with
// `mixed_calendar` set, because every venue calendar carries D-083's screen (docs/WORKSTREAMS.md
// 2.9, D-121). A calendar only a model could read yet (a Google Calendar embed) is stored switched
// off as "held". Rows held before the column existed
// (D-120) are released at the start of each run, with the flag set, once a reader takes them.

import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";

import type { Metro, SourceKind } from "@/src/adapters/types";
import type { Db } from "@/src/db/client";
import { sources as sourcesTable, venues } from "@/src/db/schema";
import type { SourceHealth } from "@/src/db/schema/sources";
import { probePage } from "@/src/pipeline/probe";
import {
  awaitsGate,
  chooseCandidates,
  type Candidate,
  type KnownHost,
  type Skipped,
  type VenueSite,
} from "@/src/pipeline/discovery/candidates";
import { danceGate, GATE_VERSION } from "@/src/pipeline/discovery/gate";
import { hostSkip, siteHost } from "@/src/pipeline/discovery/hosts";
import { probeSite, type SiteOutcome, type SiteStatus } from "@/src/pipeline/discovery/site-probe";
import type { HttpClient } from "@/src/pipeline/http";
import { pipelineId } from "@/src/pipeline/store";

/** Hosts probed per run unless the caller says otherwise: about 3 requests each. */
export const DISCOVERY_PROBES_PER_RUN = 250;

/** Hosts probed at once. Each domain still gets one request per 5 seconds. */
export const DISCOVERY_CONCURRENCY = 6;

/** How long a host discovery found nothing usable on waits before it is probed again (D-140). */
export const REPROBE_AFTER_DAYS = 60;

/** What discovery found on a host that makes it worth probing again later (D-140). */
const REPROBE_STATUSES: readonly string[] = [
  "nothing",
  "page_only",
  "dead",
  "blocked",
  "unreachable",
];

function reprobeCutoff(at: Date): Date {
  return new Date(at.getTime() - REPROBE_AFTER_DAYS * 24 * 60 * 60 * 1000);
}

/** The adapter id discovery writes as `discovered_by` (src/adapters/registry/discovery.ts). */
export const VENUE_WEBSITES = "venue_websites" as const;

/**
 * Whether a reader takes this kind without a model today. The Squarespace list reader takes
 * these pages (D-111, D-136); a Google Calendar embed waits for lane 5's Calendar API reader
 * (calendar.google.com refuses crawlers).
 */
/**
 * The groups whose calendars switch on before any page of theirs is read (D-121, D-559): the clubs,
 * salsa clubs, dance halls, nightlife venues, lounges, music/event venues and community/social clubs.
 * Every listing is still screened as a venue's whole calendar (D-083). Studio calendars (class
 * timetables) wait.
 */
export const SWITCH_ON_UNREAD: ReadonlySet<string> = new Set([
  "dance or salsa club",
  "dance hall",
  "nightlife venue",
  "lounge",
  "music or event venue",
  "community or social club",
]);

export function readableWithoutModel(kind: SourceKind): boolean {
  return kind === "feed_ics" || kind === "wp_tribe" || kind === "jsonld" || kind === "squarespace";
}

export interface ProbedLine {
  host: string;
  venues: string[];
  group: string;
  status: SiteStatus;
  /** What happened to the row: switched on, held, or switched off. */
  stored: "source" | "held" | "off" | "untouched";
  url: string;
  kind: SourceKind;
  platform: string | null;
  feedUrl: string | null;
  reason: string;
  /** Links to other platforms found on the way, recorded for their lanes: never added here. */
  candidates: string[];
  tierD: string[];
}

export interface DiscoveryReport {
  metro: string;
  limit: number;
  /** Candidates left after this run's probes: the queue for the next runs. */
  waiting: number;
  probed: ProbedLine[];
  /** Rows held by an earlier run that a reader now takes: switched on, screened, this run. */
  released: Array<{ url: string; kind: SourceKind }>;
  /** Rows an earlier run switched on whose host is now skipped: switched off, this run. */
  retired: Array<{ url: string; reason: string }>;
  /** Squarespace rows stored under the old probe rule, re-probed this run (D-137). */
  rechecked: Rechecked[];
  skipped: Skipped[];
  requests: number;
}

export interface DiscoveryOptions {
  db: Db;
  metro: Metro;
  http: HttpClient;
  now: () => Date;
  limit?: number;
  /** Starting addresses from config/sources: a host there is "already a source" before any run. */
  seedUrls?: readonly string[];
  log?: (line: string) => void;
  /** Hosts probed at once; DISCOVERY_CONCURRENCY when unset. */
  concurrency?: number;
}

export async function loadVenueSites(db: Db, metroId: string): Promise<VenueSite[]> {
  const rows = await db
    .select({
      venueId: venues.id,
      name: venues.name,
      kind: venues.kind,
      danceFloor: venues.danceFloor,
      websiteUrl: venues.websiteUrl,
      lat: sql<number>`ST_Y(${venues.location}::geometry)`,
      lng: sql<number>`ST_X(${venues.location}::geometry)`,
    })
    .from(venues)
    .where(
      and(eq(venues.metroId, metroId), isNotNull(venues.websiteUrl), eq(venues.blocklisted, false)),
    )
    .orderBy(venues.id);
  return rows.map((r) => ({
    venueId: r.venueId,
    name: r.name,
    kind: r.kind,
    danceFloor: r.danceFloor,
    websiteUrl: r.websiteUrl!,
    location: { lat: Number(r.lat), lng: Number(r.lng) },
  }));
}

type Rechecked = { url: string; outcome: "events_page" | "switched_off"; feedUrl: string | null };

/**
 * Re-probes the Squarespace rows stored before D-137, when any Squarespace site passed as an
 * events collection (its asset manifest names one). A row whose site links its events page gets
 * that page as its feed; one with no events list is switched off, and kept so it is not probed
 * again. Each row is re-probed once.
 */
async function recheckSquarespace(db: Db, metroId: string, http: HttpClient): Promise<Rechecked[]> {
  const rows = await db
    .select({ id: sourcesTable.id, url: sourcesTable.url, health: sourcesTable.health })
    .from(sourcesTable)
    .where(
      and(
        eq(sourcesTable.metroId, metroId),
        eq(sourcesTable.discoveredBy, VENUE_WEBSITES),
        eq(sourcesTable.kind, "squarespace"),
        isNull(sourcesTable.feedUrl),
        sql`(${sourcesTable.health} -> 'discovery' ->> 'recheck') is distinct from 'D-137'`,
      ),
    )
    .orderBy(sourcesTable.url)
    .limit(40);
  const out: Rechecked[] = [];
  for (const row of rows) {
    const before = row.health.discovery ?? { status: "structured", reason: "", probedAt: "" };
    let feedUrl: string | null = null;
    let listed = false;
    let failure = "";
    try {
      const page = await http.request({
        url: row.url,
        purpose: "crawl",
        headers: { accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1" },
      });
      if (page.status >= 200 && page.status < 300) {
        const outcome = probePage(page.url || row.url, page.body);
        listed = outcome.kind === "squarespace";
        feedUrl = listed ? outcome.feedUrl : null;
      } else failure = `; fetch failed: HTTP ${page.status}`;
    } catch (error) {
      failure = `; fetch failed: ${error instanceof Error ? error.message : String(error)}`;
    }
    const discovery = listed
      ? { ...before, recheck: "D-137" }
      : {
          ...before,
          status: "nothing",
          reason: `re-probed 2026-10-11 rule (D-137): no Squarespace events list${failure}`,
          recheck: "D-137",
        };
    await db
      .update(sourcesTable)
      .set({
        ...(feedUrl ? { feedUrl } : {}),
        ...(listed ? {} : { enabled: false }),
        health: { ...row.health, discovery },
      })
      .where(eq(sourcesTable.id, row.id));
    out.push({ url: row.url, outcome: listed ? "events_page" : "switched_off", feedUrl });
  }
  return out;
}

/**
 * Switches on the rows an earlier run held for want of the mixed-calendar flag (D-120) whose kind
 * a reader now takes without a model, with the flag set (D-121).
 */
async function releaseHeld(
  db: Db,
  metroId: string,
): Promise<Array<{ url: string; kind: SourceKind }>> {
  const held = await db
    .select({
      id: sourcesTable.id,
      url: sourcesTable.url,
      kind: sourcesTable.kind,
      health: sourcesTable.health,
    })
    .from(sourcesTable)
    .where(
      and(
        eq(sourcesTable.metroId, metroId),
        eq(sourcesTable.discoveredBy, VENUE_WEBSITES),
        eq(sourcesTable.enabled, false),
        sql`${sourcesTable.health} -> 'discovery' ->> 'status' = 'held'`,
      ),
    )
    .orderBy(sourcesTable.url);
  const out: Array<{ url: string; kind: SourceKind }> = [];
  for (const row of held) {
    if (!readableWithoutModel(row.kind)) continue;
    // A host named since it was held stays off; an enabled one is switched off by retireSkipped.
    if (hostSkip(siteHost(row.url) ?? "")) continue;
    // A row from before the group was stored, or of another group, waits for the dance gate.
    if (!SWITCH_ON_UNREAD.has(row.health.discovery?.group ?? "")) continue;
    const discovery = row.health.discovery!;
    await db
      .update(sourcesTable)
      .set({
        enabled: true,
        mixedCalendar: true,
        health: {
          ...row.health,
          discovery: {
            status: "structured",
            reason: `${discovery.reason.replace(/; held until .*$/, "")}; switched on with the mixed-calendar screen (D-121)`,
            probedAt: discovery.probedAt,
          },
        },
      })
      .where(eq(sourcesTable.id, row.id));
    out.push({ url: row.url, kind: row.kind });
  }
  return out;
}

/**
 * Switches off the rows discovery switched on whose host has since been named as not a venue's
 * own site (`hostSkip`, aoh.com on 2026-10-05). The row is kept, with the reason, so the host is
 * never probed again.
 */
async function retireSkipped(
  db: Db,
  metroId: string,
): Promise<Array<{ url: string; reason: string }>> {
  const rows = await db
    .select({ id: sourcesTable.id, url: sourcesTable.url, health: sourcesTable.health })
    .from(sourcesTable)
    .where(
      and(
        eq(sourcesTable.metroId, metroId),
        eq(sourcesTable.discoveredBy, VENUE_WEBSITES),
        eq(sourcesTable.enabled, true),
      ),
    )
    .orderBy(sourcesTable.url);
  const out: Array<{ url: string; reason: string }> = [];
  for (const row of rows) {
    const skip = hostSkip(siteHost(row.url) ?? "");
    if (!skip) continue;
    const discovery = row.health.discovery;
    await db
      .update(sourcesTable)
      .set({
        enabled: false,
        health: {
          ...row.health,
          discovery: {
            status: "skipped",
            reason: `switched off: ${skip.reason}`,
            probedAt: discovery?.probedAt ?? new Date(0).toISOString(),
            ...(discovery?.group ? { group: discovery.group } : {}),
          },
        },
      })
      .where(eq(sourcesTable.id, row.id));
    out.push({ url: row.url, reason: skip.reason });
  }
  return out;
}

/** Every host that already has a source row (any metro: a host is one site), and the seeds'. */
export async function loadKnownHosts(
  db: Db,
  seedUrls: readonly string[],
): Promise<Map<string, KnownHost>> {
  return (await loadDiscoveryHosts(db, seedUrls, null)).known;
}

/**
 * The hosts discovery knows, and those whose only rows are stale (D-140): discovery found nothing
 * usable there more than REPROBE_AFTER_DAYS ago, so the host may be probed again. With no `at`,
 * nothing is stale.
 */
async function loadDiscoveryHosts(
  db: Db,
  seedUrls: readonly string[],
  at: Date | null,
): Promise<{ known: Map<string, KnownHost>; staleHosts: Set<string> }> {
  const known = new Map<string, KnownHost>();
  const staleHosts = new Set<string>();
  const rows = await db
    .select({
      url: sourcesTable.url,
      feedUrl: sourcesTable.feedUrl,
      enabled: sourcesTable.enabled,
      health: sourcesTable.health,
      discoveredBy: sourcesTable.discoveredBy,
    })
    .from(sourcesTable);
  const cutoff = at ? reprobeCutoff(at) : null;
  for (const row of rows) {
    const discovery = row.health.discovery;
    const probedAt = discovery?.probedAt ? Date.parse(discovery.probedAt) : NaN;
    const stale =
      cutoff !== null &&
      row.discoveredBy === VENUE_WEBSITES &&
      !row.enabled &&
      REPROBE_STATUSES.includes(discovery?.status ?? "") &&
      probedAt < cutoff.getTime();
    for (const url of [row.url, row.feedUrl]) {
      const host = url ? siteHost(url) : null;
      if (!host) continue;
      if (stale) {
        staleHosts.add(host);
        continue;
      }
      // A host's enabled row wins over a retired one.
      const before = known.get(host);
      if (!before || (!before.enabled && row.enabled))
        known.set(host, {
          url: row.url,
          enabled: row.enabled,
          ...(row.health.discovery
            ? {
                status: row.health.discovery.status,
                gated: !!row.health.discovery.gate,
                gatePass: row.health.discovery.gate?.pass ?? null,
                gateVersion: row.health.discovery.gate?.version ?? 1,
              }
            : {}),
        });
    }
  }
  for (const url of seedUrls) {
    const host = siteHost(url);
    if (host && !known.has(host)) known.set(host, { url, enabled: true });
  }
  return { known, staleHosts };
}

export async function runVenueDiscovery(options: DiscoveryOptions): Promise<DiscoveryReport> {
  const { db, metro, http, now } = options;
  const log = options.log ?? (() => {});
  const limit = Math.max(0, options.limit ?? DISCOVERY_PROBES_PER_RUN);
  const rechecked = await recheckSquarespace(db, metro.id, http);
  const released = await releaseHeld(db, metro.id);
  const retired = await retireSkipped(db, metro.id);
  const { known, staleHosts } = await loadDiscoveryHosts(db, options.seedUrls ?? [], now());
  const { candidates, skipped } = chooseCandidates(
    await loadVenueSites(db, metro.id),
    known,
    metro,
  );
  const batch = candidates.slice(0, limit);
  // A page-only host probed again for the gate is this run's to write (D-124).
  for (const c of batch) {
    const before = known.get(c.host);
    if (before && awaitsGate(before)) known.delete(c.host);
  }
  const report: DiscoveryReport = {
    metro: metro.slug,
    limit,
    waiting: candidates.length - batch.length,
    probed: [],
    released,
    retired,
    rechecked,
    skipped,
    requests: 0,
  };

  const lines: Array<ProbedLine | undefined> = new Array(batch.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= batch.length) return;
      const candidate = batch[i]!;
      log(`probing ${candidate.url} (${candidate.group}: ${candidate.venueNames[0]})`);
      const outcome = await probeSite(http, {
        url: candidate.url,
        venueNames: candidate.venueNames,
      });
      report.requests += outcome.requests;
      lines[i] = await record(db, metro, candidate, outcome, known, staleHosts, now());
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.min(options.concurrency ?? DISCOVERY_CONCURRENCY, batch.length) },
      worker,
    ),
  );
  report.probed = lines.filter((l): l is ProbedLine => !!l);
  return report;
}

/** Writes one probed host's row(s) and returns its report line. */
async function record(
  db: Db,
  metro: Metro,
  candidate: Candidate,
  outcome: SiteOutcome,
  known: Map<string, KnownHost>,
  staleHosts: Set<string>,
  at: Date,
): Promise<ProbedLine> {
  const wasStale = staleHosts.has(candidate.host);
  const reasonSuffix = wasStale ? ` (re-probed after ${REPROBE_AFTER_DAYS} days)` : "";
  const line: ProbedLine = {
    host: candidate.host,
    venues: candidate.venueNames,
    group: candidate.group,
    status: outcome.status,
    stored: "off",
    url: outcome.url,
    kind: outcome.kind,
    platform: outcome.platform,
    feedUrl: outcome.feedUrl,
    reason: outcome.reason + reasonSuffix,
    candidates: outcome.discovered
      .filter((d) => d.kind !== "social_link")
      .map((d) => `${d.platform ?? d.kind}: ${d.url}`),
    tierD: outcome.tierD,
  };

  // Another candidate of this run reached this host first (its calendar lives here): one row only.
  const claimed = known.get(candidate.host);
  if (claimed) {
    line.stored = "untouched";
    line.reason = `reached first by another site of this run (${claimed.url})`;
    return line;
  }
  const metroId = metro.id;
  const probedAt = at.toISOString();
  const marker = (reason: string, status: string) =>
    writeRow(
      db,
      metroId,
      candidate.venueId,
      { url: candidate.url, kind: "html", platform: null, feedUrl: null },
      false,
      {
        status,
        reason,
        probedAt,
        group: candidate.group,
      },
      at,
    );

  // A home page that redirects to another domain is recorded at its own address only: the page it
  // lands on may be another venue's, so nothing is written under that domain.
  if (outcome.status === "moved") {
    known.set(candidate.host, { url: candidate.url, enabled: false, status: "moved" });
    if (!(await marker(outcome.reason, "moved"))) line.stored = "untouched";
    return line;
  }

  // A calendar on another host of the site (calendar.club.com) that we hold already, or that
  // another candidate of this run has claimed, is that row; it is never written twice. The claim
  // is taken before any await, so two workers cannot both take one host.
  const outcomeHost = siteHost(outcome.url);
  if (outcomeHost && outcomeHost !== candidate.host) {
    const there = known.get(outcomeHost);
    const skip = hostSkip(outcomeHost);
    if (there || skip) {
      known.set(candidate.host, { url: candidate.url, enabled: false, status: "moved" });
      line.stored = "untouched";
      line.reason = there
        ? `the site's calendar is at ${outcomeHost}, already known (${there.url})`
        : `the site's calendar is at ${outcomeHost}: ${skip!.reason}`;
      await marker(line.reason, "moved");
      return line;
    }
  }

  const structured = outcome.status === "structured";
  const readable = structured && readableWithoutModel(outcome.kind);
  const clubGroup = SWITCH_ON_UNREAD.has(candidate.group);
  // A page-only events page is read by the model only when the dance gate passes it (D-124).
  const gate =
    outcome.status === "page_only" && outcome.page
      ? danceGate({
          text: outcome.page.text,
          contentType: outcome.page.contentType,
          group: candidate.group,
          now: at,
          tz: metro.tz,
          languages: metro.languages,
          countryCode: metro.countryCode,
        })
      : null;
  const enable = (readable && clubGroup) || gate?.pass === true;
  const status = enable ? outcome.status : structured ? "held" : outcome.status;
  if (outcomeHost) known.set(outcomeHost, { url: outcome.url, enabled: enable, status });
  if (outcomeHost !== candidate.host)
    known.set(candidate.host, { url: candidate.url, enabled: false, status: "moved" });
  line.stored = enable ? "source" : structured ? "held" : "off";
  const why = gate
    ? `${outcome.reason}; dance gate: ${gate.reason}${gate.pass ? "; read by the model, screened as a venue's whole calendar" : ""}`
    : !structured || enable
      ? outcome.reason
      : readable
        ? `${outcome.reason}; held: a ${candidate.group}'s calendar waits for the dance gate`
        : `${outcome.reason}; held: no reader takes ${outcome.platform ?? outcome.kind} without a model yet`;
  line.reason = why + reasonSuffix;
  const written = await writeRow(
    db,
    metroId,
    candidate.venueId,
    outcome,
    enable,
    {
      status,
      reason: why,
      probedAt,
      group: candidate.group,
      ...(gate ? { gate: { pass: gate.pass, reason: gate.reason, version: GATE_VERSION } } : {}),
      // Probed under D-137's rule already: never re-probed as an old Squarespace row.
      ...(outcome.kind === "squarespace" ? { recheck: "D-137" } : {}),
    },
    at,
  );
  if (!written) {
    line.stored = "untouched";
    line.reason = `${why}; a row at ${outcome.url} already exists and is left as it is${reasonSuffix}`;
  }
  // A row under another host of the site leaves the candidate's own host unmarked: it is marked
  // too, switched off, so it is never probed again.
  if (outcomeHost !== candidate.host)
    await marker(`the site's calendar is at ${outcome.url}`, "moved");
  return line;
}

/**
 * Inserts one discovered row, switched off unless `enabled`, in one statement: a run that dies
 * part-way never leaves a row switched on by the column's default. A row already at the address
 * (a starting address, another lane's) is never touched, except discovery's own page-only row
 * from before the dance gate, which takes the gate's verdict (D-124). Returns whether a row was
 * written.
 */
async function writeRow(
  db: Db,
  metroId: string,
  venueId: string | null,
  outcome: Pick<SiteOutcome, "url" | "kind" | "platform" | "feedUrl">,
  enabled: boolean,
  discovery: NonNullable<SourceHealth["discovery"]>,
  at: Date,
): Promise<boolean> {
  const html = outcome.kind === "html";
  const rows = await db
    .insert(sourcesTable)
    .values({
      id: pipelineId("source", outcome.url),
      url: outcome.url,
      kind: outcome.kind,
      // A page the probe found nothing structured on is marked probed, so it is not probed again
      // the day it is switched on; it then waits for the model like any probed page.
      platform: html ? "probed" : outcome.platform,
      feedUrl: html ? null : outcome.feedUrl,
      metroId,
      venueId,
      trustTier: "first_party",
      discoveredBy: VENUE_WEBSITES,
      enabled,
      // Every row discovery writes is a venue's own site: its calendar is screened (D-121).
      mixedCalendar: true,
      health: { discovery },
    })
    // The rows discovery rewrites: its own page-only row from before the gate (D-124), its own
    // stale row of a host probed again (D-140), and its own page-only row an older dance gate
    // held (GATE_VERSION, D-514).
    .onConflictDoUpdate({
      target: sourcesTable.url,
      set: {
        enabled,
        kind: sql`excluded.kind`,
        platform: sql`excluded.platform`,
        feedUrl: sql`excluded.feed_url`,
        venueId: sql`coalesce(excluded.venue_id, ${sourcesTable.venueId})`,
        health: sql`${sourcesTable.health} || jsonb_build_object('discovery', ${JSON.stringify(discovery)}::jsonb)`,
        updatedAt: new Date(),
      },
      setWhere: sql`${sourcesTable.discoveredBy} = ${VENUE_WEBSITES} and ${sourcesTable.enabled} = false
        and (
          (${sourcesTable.health} -> 'discovery' ->> 'status' = 'page_only'
          and ${sourcesTable.health} -> 'discovery' -> 'gate' is null)
          or
          (${sourcesTable.health} -> 'discovery' ->> 'status' in ('nothing','page_only','dead','blocked','unreachable')
          and (${sourcesTable.health} -> 'discovery' ->> 'probedAt')::timestamptz < ${reprobeCutoff(at).toISOString()}::timestamptz)
          or
          (${sourcesTable.health} -> 'discovery' ->> 'status' = 'page_only'
          and (${sourcesTable.health} -> 'discovery' -> 'gate' ->> 'pass')::boolean = false
          and coalesce((${sourcesTable.health} -> 'discovery' -> 'gate' ->> 'version')::int, 1) < ${GATE_VERSION})
        )`,
    })
    .returning({ id: sourcesTable.id });
  return rows.length > 0;
}

const STATUS_ORDER: SiteStatus[] = [
  "structured",
  "page_only",
  "nothing",
  "blocked",
  "unreachable",
  "moved",
  "dead",
  "repurposed",
];

const STATUS_WORDS: Record<SiteStatus, string> = {
  structured: "a feed or structured events",
  page_only: "an events page, no feed (waits for the dance gate)",
  nothing: "no events page",
  blocked: "blocked (recorded, not worked around)",
  unreachable: "unreachable from here",
  dead: "dead (retired)",
  repurposed: "repurposed (retired)",
  moved: "redirects to another domain (retired)",
};

export function formatDiscoveryReport(report: DiscoveryReport): string {
  const out: string[] = [];
  const count = (s: SiteStatus) => report.probed.filter((l) => l.status === s).length;
  out.push(
    `Venue websites for ${report.metro}: ${report.probed.length} probed (cap ${report.limit}), ${report.waiting} waiting for later runs, ${report.skipped.length} skipped. ${report.requests} requests.`,
  );
  out.push(
    `Sources: ${report.probed.filter((l) => l.stored === "source").length} switched on, ${report.probed.filter((l) => l.stored === "held").length} held.`,
  );
  if (report.released.length > 0) {
    out.push(
      "",
      `Held by an earlier run and switched on now, screened as a venue's whole calendar: ${report.released.length}`,
    );
    for (const r of report.released) out.push(`  ${r.url} [${r.kind}]`);
  }
  if (report.retired.length > 0) {
    out.push(
      "",
      `Switched on by an earlier run, now not a venue's own site: ${report.retired.length}`,
    );
    for (const r of report.retired) out.push(`  ${r.url}: ${r.reason}`);
  }
  for (const status of STATUS_ORDER) {
    const lines = report.probed.filter((l) => l.status === status);
    if (lines.length === 0) continue;
    out.push("", `${STATUS_WORDS[status]}: ${count(status)}`);
    for (const l of lines) {
      const what = l.feedUrl
        ? ` [${l.kind}${l.platform ? `/${l.platform}` : ""} ${l.feedUrl}]`
        : l.kind !== "html"
          ? ` [${l.kind}${l.platform ? `/${l.platform}` : ""}]`
          : "";
      out.push(
        `  ${l.host} (${l.venues.slice(0, 3).join("; ")}; ${l.group}): ${l.url}${what}: ${l.reason}`,
      );
      if (l.candidates.length > 0) out.push(`    links to ${l.candidates.join(", ")}`);
      if (l.tierD.length > 0) out.push(`    calendar on ${l.tierD.join(", ")} (Tier D, not read)`);
    }
  }
  if (report.rechecked.length > 0) {
    out.push("", `Squarespace rows re-checked (D-137): ${report.rechecked.length}`);
    for (const r of report.rechecked) {
      if (r.outcome === "events_page") {
        out.push(`  ${r.url} -> ${r.feedUrl ?? "its own events list"}`);
      } else {
        out.push(`  ${r.url}: no Squarespace events list; switched off`);
      }
    }
  }

  if (report.skipped.length > 0) {
    out.push("", `Skipped: ${report.skipped.length}`);
    const groups = new Map<string, Skipped[]>();
    for (const s of report.skipped) groups.set(s.reason, [...(groups.get(s.reason) ?? []), s]);
    for (const [reason, list] of groups) {
      out.push(`  ${reason}: ${list.length}`);
      for (const s of list) out.push(`    ${s.host} (${s.venueName}): ${s.detail}`);
    }
  }
  return out.join("\n");
}
