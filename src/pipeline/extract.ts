// Model extraction for a page no deterministic reader could answer (PLAN 6.5 step 6, 8.2).
//
//   1. The extraction cache, keyed by the hash of the exact text the model is sent and the prompt
//      version: an unchanged page costs nothing (PLAN 6.7), and an answer can never be stored under
//      text it was not given (D-074).
//   2. The base job (`extract`, Workers AI granite). The client validates the reply with zod and
//      retries once on a schema failure or a truncated reply before giving up (D-039).
//   3. Escalation to `escalate` (gemma) when PLAN 8.2 says so: the base job failed validation or
//      was truncated, the mean confidence is below 0.6, the page is in a non-Latin script, the
//      page is a list of more than 15 items, or the read listed nothing from text that writes three
//      or more of the window's nights (D-074). A non-Latin page goes straight to escalation rather
//      than paying for a base call whose result would be discarded.
//   4. `quota_exhausted` and `no_eligible_provider` defer the source to a later run (PLAN 6.7);
//      they are expected outcomes, not failures. When escalation is deferred but the base result
//      validated, the base result is kept rather than thrown away.
//
// Only Cloudflare ever serves these jobs (`sendsUntrustedText`, routableFor()).

import { getDomain } from "tldts";

import { familyOf, isStyleKey, matchStyles, type FamilyKey } from "@/config/styles";
import { sha256 } from "@/src/adapters/shared";
import {
  UNTIMED_RULE_ANCHOR,
  type HarvestedListing,
  type HarvestedRecurrence,
} from "@/src/adapters/types";
import {
  jobById,
  type AiClient,
  type AiFailure,
  type AiOutcome,
  type AiProviderId,
  type AiUsage,
} from "@/src/ai";
import {
  EXTRACT_JSON_SCHEMA,
  EXTRACT_SYSTEM,
  extractUserTurn,
  type ExtractSourceHeader,
} from "@/src/ai/prompts";
import {
  dateOrderFor,
  findEventLinks,
  linkKey,
  pageLinks,
  sameLink,
  stripTracking,
} from "@/src/domain/event-link-matcher";
import { meanConfidence, rawExtractionSchema, type RawExtraction } from "@/src/domain/listing";
import { isButtonLabel } from "@/src/domain/listing-screen";
import { MATERIALIZE_DAYS, parseRecurrenceText } from "@/src/domain/recurrence";
import {
  categoryAbove,
  findPhrase,
  foldPage,
  type FoldedPage,
  headingDateKey,
  isDateHeading,
  contradictingDate,
  dateBesideTitle,
  foldForMatch,
  foldWords,
  listedOnlyUnderOtherDates,
  mentionsClass,
  recurrenceNearTitle,
  recurrencePhraseAfterTitle,
  statesDate,
  weekdayCodeOf,
  weekdaysNamed,
  weekdaysNearTitle,
  windowNightsWritten,
} from "@/src/domain/text-facts";
import { currencyForCountry } from "@/src/domain/prices";
import {
  checkListingFacts,
  organizerFromNeighbour,
  type FactChange,
} from "@/src/domain/stated-facts";
import {
  checkListingTimes,
  ownBlockTexts,
  readBlockTimes,
  ownPageTimes,
  titleHourOverOffset,
  type TimeChange,
  type TimeField,
} from "@/src/domain/stated-times";
import { titleBlocks, subtitleLine, type TitleBlock } from "@/src/domain/title-blocks";
import { withdrawnTwins } from "@/src/domain/withdrawn-twin";
import { windowNights } from "@/src/pipeline/normalize";
import { weeklyGridOpenRule, weeklyGridRule } from "@/src/pipeline/weekly-grid";
import { openLineSection } from "@/src/pipeline/open-line";

/**
 * Bumped whenever the prompt, the schema or the escalation rules change, so the cache never
 * serves an answer to a question we no longer ask. Also bumped when the reading of a reply
 * changes, because the cache holds the parsed reply: ".4" re-reads every page once so a stated
 * range such as "8pm-1am" is read by its start (D-060 point 10) instead of staying unread.
 *
 * "2026-09-29.1" (D-074) drops every answer cached from an empty page. Before 79e7cdb, a page that
 * answered 304 was sent to the model with no text at all, and the answer was cached under the real
 * page's content hash (ingest runs 22 to 25): This Week in Swing's "not relevant", and the "every
 * Thursday" nights invented for swingremixnyc.com, salsanewyork.com and nylindy.com, came back
 * every run while those pages did not change. The cache is now keyed by the text actually sent, so
 * that cannot recur; the pages are also cut into parts at their date headings, and an empty read
 * of a part that writes the window's nights is escalated, both of which change what is asked.
 *
 * "2026-10-17.1": DJ sets and club nights at a bar, club or lounge are dance events (#145); the
 * cache had kept Dead Letter No. 9's empty answer from before the rule.
 */
export const EXTRACT_PROMPT_VERSION = "2026-10-17.1";

/** PLAN 8.2: escalate below this mean confidence. */
export const ESCALATE_BELOW_CONFIDENCE = 0.6;
/** PLAN 8.2: escalate a list page with more than this many items. */
export const ESCALATE_LIST_OVER = 15;

export interface CachedExtraction {
  extraction: RawExtraction;
  model: string;
}

/**
 * Answers by the sha256 of the exact text the model was sent (`textKey`) and the prompt version.
 * Nothing outside this module chooses the key (D-074).
 */
export interface ExtractionCache {
  get(textHash: string, promptVersion: string): Promise<CachedExtraction | null>;
  put(textHash: string, promptVersion: string, value: CachedExtraction): Promise<void>;
}

/** The cache key for a text: the sha256 of the text itself, never a hash a caller supplies. */
export const textKey = (text: string): string => sha256(text);

export interface ModelCall {
  job: "extract" | "escalate";
  provider: AiProviderId | null;
  model: string | null;
  usage: AiUsage | null;
  outcome: "ok" | AiFailure;
}

export type ExtractResult =
  | {
      status: "ok";
      extraction: RawExtraction;
      model: string;
      cached: boolean;
      escalated: boolean;
      calls: ModelCall[];
      notes: string[];
      /**
       * Parts of a long page that could not be read this run (deferred or failed); absent when
       * the whole page was read. Only a whole read may retire what the page no longer lists (D-070).
       */
      unread?: number;
      /**
       * Parts whose base read listed nothing though they write three or more of the window's
       * nights (D-074), which were escalated; absent when none.
       */
      emptySuspect?: number;
      /**
       * Parts answered by a fallback provider and therefore not cached (D-142); absent when none.
       */
      fallback?: number;
    }
  | { status: "deferred"; detail: string; calls: ModelCall[]; emptySuspect?: number }
  | { status: "failed"; detail: string; calls: ModelCall[]; emptySuspect?: number };

export interface ExtractInput {
  /** The text the model reads, and the cache key's source (`textKey`). */
  pageText: string;
  header: ExtractSourceHeader;
  /** The metro slug, for the per-metro quota cap. */
  metro: string;
}

/** True when more than 30% of the page's letters are outside the Latin script. */
export function isMostlyNonLatin(text: string): boolean {
  let letters = 0;
  let nonLatin = 0;
  for (const char of text) {
    if (!/\p{L}/u.test(char)) continue;
    letters += 1;
    if (!/\p{Script=Latin}/u.test(char)) nonLatin += 1;
  }
  return letters > 0 && nonLatin / letters > 0.3;
}

/** Mean of the listings' mean confidences; null when no listing states any. */
export function extractionConfidence(extraction: RawExtraction): number | null {
  const means = extraction.listings
    .map((listing) => meanConfidence(listing))
    .filter((m): m is number => m !== null);
  if (means.length === 0) return null;
  return means.reduce((a, b) => a + b, 0) / means.length;
}

/** D-074: a read that lists nothing from text writing this many of the window's nights is suspect. */
export const EMPTY_SUSPECT_NIGHTS = 3;

/** Why an empty read of dated text is escalated (D-074). */
const EMPTY_SUSPECT = (written: number, of: number) =>
  `the text writes ${written} of the window's ${of} nights but the read listed none`;

/**
 * Whether a cached read lists nothing in the window (no listing undated, recurring or dated on one
 * of the window's nights) from text that writes one of the window's nights (D-281, D-286): Newham's
 * page also writes its CMS date "Date: 17 Mar 2026.", and a read listing only that is as empty.
 *
 * (D-287) When `harvested` is given, judge on the checked listings instead of the raw extraction:
 * a recurrence the page does not write is dropped by the check, so Newham's read listed a recurring
 * tea dance yet wrote nothing.
 */
export function emptyReadOfWindowNight(
  extraction: RawExtraction,
  text: string,
  nights: readonly string[],
  harvested?: readonly HarvestedListing[],
): boolean {
  if (harvested !== undefined) {
    const inWindowHarvested = (h: HarvestedListing) =>
      h.recurrence !== null ||
      (h.listing.local_date != null && nights.includes(h.listing.local_date));
    return (
      !harvested.some(inWindowHarvested) &&
      windowNightsWritten(text, nights, extraction.language) >= 1
    );
  }
  const inWindow = (l: RawExtraction["listings"][number]) =>
    !l.local_date || (l.recurrence_text ?? "").trim() !== "" || nights.includes(l.local_date);
  return (
    !extraction.listings.some(inWindow) &&
    windowNightsWritten(text, nights, extraction.language) >= 1
  );
}

/**
 * Why a validated base result should still be escalated, or null when it should not. `text`, the
 * text that was read, and `nights`, the window's nights, let an empty read be told from an empty
 * page (D-074): a read that lists nothing from text that writes three or more of the window's
 * nights (`statesDate`, year-aware) is escalated. This Week in Swing's page writes all 14.
 */
export function escalationReason(
  extraction: RawExtraction,
  read?: { text: string; nights: readonly string[] },
): string | null {
  if (read && extraction.listings.length === 0) {
    const written = windowNightsWritten(read.text, read.nights, extraction.language);
    if (written >= EMPTY_SUSPECT_NIGHTS) return EMPTY_SUSPECT(written, read.nights.length);
  }
  if (extraction.page_kind === "list" && extraction.listings.length > ESCALATE_LIST_OVER) {
    return `a list of ${extraction.listings.length} items`;
  }
  const confidence = extractionConfidence(extraction);
  if (confidence !== null && confidence < ESCALATE_BELOW_CONFIDENCE) {
    return `mean confidence ${confidence.toFixed(2)}`;
  }
  return null;
}

const DEFERRING: readonly AiFailure[] = ["quota_exhausted", "no_eligible_provider", "disabled"];

/**
 * Marks a cached answer the stronger model gave on a re-read (D-101), so no answer is re-read
 * twice. Kept in the cache's model column, so it needs no migration, and shown in the run report.
 */
export const REREAD_MARK = " · re-read";

/** The most cached parts one run re-reads (D-101); the rest wait for later runs. */
export const REREADS_PER_RUN = 4;

/**
 * A cached read whose check drops facts its page does not write, or leaves a dated listing
 * untimed while its own part of the page writes a start, is read once more, by the stronger
 * model, rather than replayed for ever (D-101, D-267). `wants` says whether a read's check dropped
 * any facts or missed any times; `budget` is shared by every page of a run.
 */
export interface RereadOptions {
  wants: (extraction: RawExtraction) => boolean;
  budget: { left: number };
}

/** Whether a cached answer is to be read again (D-101): not re-read before, and the run can afford it. */
const rereads = (cached: CachedExtraction, reread: RereadOptions | undefined) =>
  reread !== undefined &&
  reread.budget.left > 0 &&
  !cached.model.includes(REREAD_MARK) &&
  reread.wants(cached.extraction);

/** D-142: only the first provider's answer is cached; a fallback's answer is used this run only. */
const fromFallback = (client: AiClient, provider: AiProviderId): boolean => {
  const first = client.order?.[0];
  return first !== undefined && provider !== first;
};

export async function extractPage(
  input: ExtractInput,
  client: AiClient,
  cache: ExtractionCache,
  reread?: RereadOptions,
): Promise<ExtractResult> {
  const calls: ModelCall[] = [];
  // A page with no text is never read, and nothing cached is served for it: an answer to no text
  // would stand for the page's "no events" (runs 22 to 25, D-074).
  if (!input.pageText.trim()) {
    return { status: "failed", detail: "the page has no text to read", calls };
  }
  const key = textKey(input.pageText);
  const cached = await cache.get(key, EXTRACT_PROMPT_VERSION);
  const user = extractUserTurn(input.header, input.pageText);
  if (cached && rereads(cached, reread)) {
    // Read again once by the stronger model (D-101). Whatever it answers is cached with the mark,
    // so it is never read again for the same text; when it cannot be read, the cached answer stays.
    reread!.budget.left -= 1;
    const outcome = await client.run(
      {
        job: jobById("escalate"),
        system: EXTRACT_SYSTEM,
        user,
        schema: rawExtractionSchema,
        jsonSchema: EXTRACT_JSON_SCHEMA,
      },
      { metro: input.metro },
    );
    calls.push({
      job: "escalate",
      provider: outcome.provider,
      model: outcome.ok ? outcome.model : null,
      usage: outcome.ok ? outcome.usage : null,
      outcome: outcome.ok ? "ok" : outcome.reason,
    });
    if (outcome.ok) {
      const fallback = fromFallback(client, outcome.provider);
      if (!fallback) {
        const model = `${outcome.model}${REREAD_MARK}`;
        await cache.put(key, EXTRACT_PROMPT_VERSION, { extraction: outcome.value, model });
        return {
          status: "ok",
          extraction: outcome.value,
          model,
          cached: false,
          escalated: true,
          calls,
          notes: [
            "re-read by the stronger model: the cached read came with facts its part of the page does not write",
          ],
        };
      } else {
        // Fallback provider: do not cache, keep old cached answer unchanged.
        const notes = [
          "re-read by the stronger model: the cached read came with facts its part of the page does not write",
          `read by the fallback model ${outcome.model} (${outcome.provider}); not cached, so the next run reads it again`,
        ];
        return {
          status: "ok",
          extraction: outcome.value,
          model: outcome.model,
          cached: false,
          escalated: true,
          calls,
          notes,
          fallback: 1,
        };
      }
    }
    return {
      status: "ok",
      extraction: cached.extraction,
      model: cached.model,
      cached: true,
      escalated: false,
      calls,
      notes: [
        `a re-read was wanted (the cached read came with facts its part of the page does not write) but not possible (${outcome.reason}); kept the cached read`,
      ],
    };
  }
  if (cached) {
    return {
      status: "ok",
      extraction: cached.extraction,
      model: cached.model,
      cached: true,
      escalated: false,
      calls,
      notes: [],
    };
  }

  const nights = windowNights(input.header.today, MATERIALIZE_DAYS);
  let emptySuspect = false;
  const run = async (job: "extract" | "escalate") => {
    const outcome: AiOutcome<RawExtraction> = await client.run(
      {
        job: jobById(job),
        system: EXTRACT_SYSTEM,
        user,
        schema: rawExtractionSchema,
        jsonSchema: EXTRACT_JSON_SCHEMA,
      },
      { metro: input.metro },
    );
    calls.push({
      job,
      provider: outcome.provider,
      model: outcome.ok ? outcome.model : null,
      usage: outcome.ok ? outcome.usage : null,
      outcome: outcome.ok ? "ok" : outcome.reason,
    });
    return outcome;
  };
  const done = async (
    outcome: AiOutcome<RawExtraction> & { ok: true },
    escalated: boolean,
    notes: string[],
  ) => {
    const fallback = fromFallback(client, outcome.provider);
    if (!fallback) {
      await cache.put(key, EXTRACT_PROMPT_VERSION, {
        extraction: outcome.value,
        model: outcome.model,
      });
    } else {
      notes.push(
        `read by the fallback model ${outcome.model} (${outcome.provider}); not cached, so the next run reads it again`,
      );
    }
    return {
      status: "ok" as const,
      extraction: outcome.value,
      model: outcome.model,
      cached: false,
      escalated,
      calls,
      notes,
      ...(emptySuspect ? { emptySuspect: 1 } : {}),
      ...(fallback ? { fallback: 1 } : {}),
    };
  };

  let reason: string;
  let base: (AiOutcome<RawExtraction> & { ok: true }) | null = null;
  if (isMostlyNonLatin(input.pageText)) {
    reason = "a page in a non-Latin script";
  } else {
    const first = await run("extract");
    if (first.ok) {
      const why = escalationReason(first.value, { text: input.pageText, nights });
      if (why === null) return done(first, false, []);
      base = first;
      reason = why;
      emptySuspect = first.value.listings.length === 0;
    } else if (first.reason === "schema_mismatch" || first.reason === "truncated") {
      reason = `the base model's reply was ${first.reason === "truncated" ? "truncated" : "invalid"} twice`;
    } else if (DEFERRING.includes(first.reason)) {
      return { status: "deferred", detail: `${first.reason}: ${first.detail}`, calls };
    } else {
      return { status: "failed", detail: `${first.reason}: ${first.detail}`, calls };
    }
  }

  // Escalated once: whatever the stronger model answers is cached, an empty answer too, so a
  // dated part with no dance on it is not read again every run (D-074).
  const second = await run("escalate");
  if (second.ok) return done(second, true, [`escalated: ${reason}`]);
  if (base && emptySuspect) {
    // The empty base read is not the part's answer: nothing is cached, the part counts as unread
    // (so nothing is retired on its word), and the next run reads it again.
    const detail = `${reason}, and the stronger model could not read it (${second.reason}: ${second.detail})`;
    return DEFERRING.includes(second.reason)
      ? { status: "deferred", detail, calls, emptySuspect: 1 }
      : { status: "failed", detail, calls, emptySuspect: 1 };
  }
  if (base) {
    return done(base, false, [
      `escalation wanted (${reason}) but not possible (${second.reason}); kept the base result`,
    ]);
  }
  if (DEFERRING.includes(second.reason)) {
    return { status: "deferred", detail: `${second.reason}: ${second.detail}`, calls };
  }
  return { status: "failed", detail: `escalation: ${second.reason}: ${second.detail}`, calls };
}

/**
 * The most page text one model call reads. Workers AI writes about 36 output tokens a second under
 * constrained decoding (ingest run 17: 2,863 tokens in 78 s), so a whole list page's reply ran past
 * the 120 s timeout on 9 of 19 pages. Without a grammar (D-056), the probe's three listings took
 * 28 s; about 4,000 characters of page text holds a handful of listings, whose reply fits well
 * inside the timeout.
 */
export const CHUNK_MAX_CHARS = 4_000;

/** How many parts of one page are read at once. */
export const CHUNK_CONCURRENCY = 4;

/**
 * The most dated entries one part holds (D-074): date headings, a heading that repeats the date of
 * the heading just above it within three lines counting as the same entry (a Squarespace summary
 * prints "Oct 11", "October 11, 2026" and "October 11, 2026" for one event). Granite writes about
 * 37 output tokens a second (ingest run 21, This Week in Swing: 2,806 tokens in 76 s, 2,248 in
 * 61 s). Run 21 cut that page into 7 parts; the only one with 6 dated entries (3,760 characters;
 * its 2,370 input tokens match no other part) answered in 61 s with 2,248 tokens, about 375 an
 * entry. Of the five with 10 to 12 entries, one answered in 76 s on its second try and four ended
 * in replies that failed the schema after 83 to 114 s or at the 120 s limit. At 375 tokens an
 * entry, 6 entries take about 61 s and 12 about 122 s.
 */
export const CHUNK_MAX_HEADINGS = 6;

/** Non-heading lines within which a heading repeating the last heading's date is the same entry. */
const SAME_ENTRY_LINES = 3;

/**
 * A last part shorter than this is folded into the part before it (D-074): run 21's 306-character
 * tail held the end of one event's details, from which the stronger model wrote 2,123 tokens of
 * listings.
 */
export const CHUNK_MIN_TAIL = 500;

/** A cut moves back to a date heading only when the part keeps at least this share of its room. */
const HEADING_CUT_MIN_SHARE = 0.5;

/**
 * Marks the date heading a part starts under, carried from the part before it (D-074): the model
 * reads what follows under that date, and the line itself is not a listing.
 */
export const CARRIED_HEADING_NOTE =
  "[carried over from the page above as context, not a listing: the text below continues under this date]";

/**
 * Cuts page text into parts of at most `maxChars` of the page's own text (D-074):
 *
 * - at a date heading (`isDateHeading`) where one falls in the second half of the part, so an
 *   event's details stay with its date; else at a blank line (between blocks and headings); else
 *   at a line end; and only inside a line when one line alone is too long;
 * - before the heading that would give a part more than `maxHeadings` dated entries, so a dense
 *   list's parts finish inside the call limit (`CHUNK_MAX_HEADINGS`);
 * - a last part shorter than `CHUNK_MIN_TAIL` is folded into the part before it;
 * - a part that does not begin with a date heading starts with the last one above it, under
 *   `CARRIED_HEADING_NOTE`, so its first listings keep their night.
 */
export function splitPageText(
  text: string,
  maxChars = CHUNK_MAX_CHARS,
  options: { maxHeadings?: number } = {},
): string[] {
  const maxHeadings = options.maxHeadings ?? CHUNK_MAX_HEADINGS;
  const lines: string[] = [];
  for (const line of text.split("\n")) {
    if (line.length <= maxChars) lines.push(line);
    else for (let i = 0; i < line.length; i += maxChars) lines.push(line.slice(i, i + maxChars));
  }
  const heading = lines.map((line) => isDateHeading(line));
  // The headings that start a dated entry (CHUNK_MAX_HEADINGS).
  const entry = heading.map(() => false);
  let lastKey: string | null = null;
  let since = 0;
  lines.forEach((line, k) => {
    if (!heading[k]) {
      if (line.trim()) since += 1;
      return;
    }
    const key = headingDateKey(line);
    entry[k] = !(key === lastKey && since <= SAME_ENTRY_LINES);
    lastKey = key;
    since = 0;
  });
  if (text.length <= maxChars && entry.filter(Boolean).length <= maxHeadings) return [text];

  /** Characters of lines [from, to) joined by line breaks, and the dated entries among them. */
  const measure = (from: number, to: number) => {
    let size = -1;
    let headings = 0;
    for (let k = from; k < to; k++) {
      size += lines[k]!.length + 1;
      if (entry[k]) headings += 1;
    }
    return { size: Math.max(0, size), headings };
  };
  /** Where to end a part that starts at `from` and cannot take line `at`. */
  const cutBefore = (from: number, at: number) => {
    for (let k = at; k > from; k--) {
      if (entry[k] && measure(from, k).size >= maxChars * HEADING_CUT_MIN_SHARE) return k;
    }
    for (let k = at; k > from; k--) if (lines[k] === "") return k;
    return at;
  };

  const ranges: Array<[number, number]> = [];
  let start = 0;
  let size = 0;
  let headings = 0;
  for (let i = 0; i < lines.length; i++) {
    const len = lines[i]!.length;
    for (;;) {
      const tooLong = i > start && size + 1 + len > maxChars;
      const tooDense = i > start && entry[i] && headings >= maxHeadings;
      if (!tooLong && !tooDense) break;
      const cut = tooDense ? i : cutBefore(start, i);
      ranges.push([start, cut]);
      start = cut;
      while (start < i && lines[start] === "") start += 1;
      ({ size, headings } = measure(start, i));
    }
    size = i === start ? len : size + 1 + len;
    if (entry[i]) headings += 1;
  }
  ranges.push([start, lines.length]);

  const textOf = ([from, to]: [number, number]) =>
    lines
      .slice(from, to)
      .join("\n")
      .replace(/^\n+|\n+$/g, "");
  const last = ranges.at(-1)!;
  // Scaled down for a small part size (tests), so a tail is never most of a part; and never when
  // the part before would then hold more dated entries than `maxHeadings`.
  const before = ranges.at(-2);
  if (
    before &&
    textOf(last).length < Math.min(CHUNK_MIN_TAIL, maxChars / 8) &&
    measure(before[0], last[1]).headings <= maxHeadings
  ) {
    ranges.pop();
    ranges[ranges.length - 1] = [ranges.at(-1)![0], last[1]];
  }

  return ranges
    .map((range, index) => {
      const own = textOf(range);
      if (index === 0) return own;
      let first = range[0];
      while (first < range[1] && lines[first] === "") first += 1;
      if (heading[first]) return own;
      let above = range[0] - 1;
      while (above >= 0 && !heading[above]) above -= 1;
      return above < 0 ? own : `${CARRIED_HEADING_NOTE}\n${lines[above]!.trim()}\n\n${own}`;
    })
    .filter((part) => part.trim());
}

async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      out[index] = await fn(items[index]!, index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/**
 * `extractPage` for a page of any length: a page longer than one part is read in parts, several
 * at once, each cached under the hash of its own text, and the listings are joined. The joined
 * result is cached under the whole text's hash only when every part was read, so an unchanged page
 * (or a 304) costs nothing next time, and a page with an unread part retries only that part.
 *
 * The result is `ok` when at least one part was read; the parts that were not are named in the
 * notes. It is `deferred` or `failed` only when no part was read, and `failed`, with no model call,
 * nothing cached and nothing served from the cache, when the page has no text.
 */
export async function extractPageInChunks(
  input: ExtractInput,
  client: AiClient,
  cache: ExtractionCache,
  options: {
    maxChars?: number;
    maxHeadings?: number;
    concurrency?: number;
    /** Re-read cached parts whose check drops facts (D-101). */
    reread?: RereadOptions;
  } = {},
): Promise<ExtractResult> {
  if (!input.pageText.trim()) {
    return { status: "failed", detail: "the page has no text to read", calls: [] };
  }
  const key = textKey(input.pageText);
  const whole = await cache.get(key, EXTRACT_PROMPT_VERSION);
  // A whole answer whose check drops facts goes to its parts, each re-read once when its own
  // check does (D-101).
  if (whole && !rereads(whole, options.reread)) {
    return {
      status: "ok",
      extraction: whole.extraction,
      model: whole.model,
      cached: true,
      escalated: false,
      calls: [],
      notes: [],
    };
  }
  const chunks = splitPageText(input.pageText, options.maxChars ?? CHUNK_MAX_CHARS, {
    maxHeadings: options.maxHeadings,
  });
  if (chunks.length === 1) return extractPage(input, client, cache, options.reread);

  const results = await mapLimit(chunks, options.concurrency ?? CHUNK_CONCURRENCY, (chunk) =>
    extractPage({ ...input, pageText: chunk }, client, cache, options.reread),
  );
  const calls = results.flatMap((r) => r.calls);
  const suspect = results.reduce((n, r) => n + (r.emptySuspect ?? 0), 0);
  const emptySuspect = suspect > 0 ? { emptySuspect: suspect } : {};
  const read = results.filter(
    (r): r is Extract<ExtractResult, { status: "ok" }> => r.status === "ok",
  );
  const unread = results.filter((r) => r.status !== "ok") as Exclude<
    ExtractResult,
    { status: "ok" }
  >[];
  if (read.length === 0) {
    const deferred = unread.find((r) => r.status === "deferred");
    const first = deferred ?? unread[0]!;
    return {
      status: first.status,
      detail: `none of the page's ${chunks.length} parts was read: ${first.detail}`,
      calls,
      ...emptySuspect,
    };
  }

  const relevant = read.find((r) => r.extraction.page_kind !== "not_relevant") ?? read[0]!;
  const extraction: RawExtraction = {
    page_kind: relevant.extraction.page_kind,
    language: relevant.extraction.language,
    listings: read.flatMap((r) => r.extraction.listings),
  };
  const model = [...new Set(read.map((r) => r.model))].join(", ");
  const notes = read.flatMap((r) => r.notes);
  const fallbackSum = read.reduce((sum, r) => sum + (r.fallback ?? 0), 0);
  if (unread.length > 0) {
    notes.push(
      `${unread.length} of the page's ${chunks.length} parts could not be read this run (${unread[0]!.detail}); the next run retries them`,
    );
  } else if (fallbackSum === 0) {
    await cache.put(key, EXTRACT_PROMPT_VERSION, { extraction, model });
  } else {
    notes.push(
      `${fallbackSum} of the page's ${chunks.length} parts were read by a fallback model; the whole read is not cached`,
    );
  }
  return {
    status: "ok",
    extraction,
    model,
    cached: unread.length === 0 && read.every((r) => r.cached),
    escalated: read.some((r) => r.escalated),
    calls,
    notes,
    ...(unread.length > 0 ? { unread: unread.length } : {}),
    ...emptySuspect,
    ...(fallbackSum > 0 ? { fallback: fallbackSum } : {}),
  };
}

/**
 * A recurrence phrase as an RRULE body. The phrase is tried as the model copied it, then without a
 * clock time or a room it ran on into ("Every Tuesday 9:30pm to 1:30am", "Every Sunday - Time:
 * 3:00pm", "Every Wednesdays, Studio D"), since the parser reads only a bare phrase. Nothing else
 * is cut, so a hedged phrase ("most Fridays") still reads as no rule. A cut is kept only when its
 * rule falls on every weekday the whole phrase names: "Tuesdays 8pm & Thursdays 9pm" cut at "8pm"
 * reads as Tuesdays alone, which would move the Thursday night onto a Tuesday (review,
 * 2026-09-28), so it reads as no rule. The page's language first, then any the parser knows (a
 * page tagged Spanish may state its rules in English).
 */
export function recurrenceRule(phrase: string, lang: string | null | undefined): string | null {
  const tries = [phrase];
  const clock = /\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)(?![a-z])|\b\d{1,2}:\d{2}\b/i.exec(
    phrase,
  );
  if (clock && clock.index > 0) tries.push(phrase.slice(0, clock.index));
  const room = /,\s*(?:studio|room|floor|hall|salon|sala)\b/i.exec(phrase);
  if (room && room.index > 0) tries.push(phrase.slice(0, room.index));
  for (const raw of tries) {
    const text = raw
      // A label left dangling by the cut: "Every 2nd & last SaturdayTime:" reads "... Saturday".
      .replace(/(?:time|\bfrom|\bat|@)\s*:?\s*$/i, "")
      .replace(/[\s,;:@–—-]+$/, "")
      .trim();
    if (!text) continue;
    const rule = (lang ? parseRecurrenceText(text, lang) : null) ?? parseRecurrenceText(text);
    if (!rule) continue;
    if (raw !== phrase) {
      const days = ruleWeekdays(rule);
      if ([...weekdaysNamed(phrase, lang)].some((day) => !days.has(day))) continue;
    }
    return rule;
  }
  return null;
}

/** The weekdays an RRULE body falls on (BYDAY codes without their ordinals); empty when none. */
function ruleWeekdays(rrule: string): Set<string> {
  const byday = /(?:^|;)BYDAY=([^;]+)/.exec(rrule)?.[1];
  return new Set(
    (byday ?? "")
      .split(",")
      .map((d) => d.replace(/^[+-]?\d+/, ""))
      .filter(Boolean),
  );
}

const WEEKDAY_NAMES: Record<string, string> = {
  SU: "Sunday",
  MO: "Monday",
  TU: "Tuesday",
  WE: "Wednesday",
  TH: "Thursday",
  FR: "Friday",
  SA: "Saturday",
};

export interface ExtractionRead {
  listings: HarvestedListing[];
  /** Listings not written, with the reason, for the report's rejected count. */
  rejected: Array<{ title: string; reason: string }>;
  /** Plain notes for the run report: what the checks against the page changed. */
  notes: string[];
  /**
   * Titles rejected because the page does not write them (D-073). The rows they made before are
   * not listed by this read, so a whole read retires them (D-070); a partial read retires nothing.
   */
  notOnPage: string[];
  /**
   * Titles the page writes whose recurrence it does not (D-073, review 2026-09-29): the rule is
   * dropped, and the listing is kept on a date the page states, else not written this run. Its
   * title is the page's, so its rows are never retired as the title's: a whole read retires only
   * those on nights the page does not state and on a weekday it does not name near the title (the
   * nights an invented "every Thursday" made), and a partial read none.
   */
  recurrenceNotOnPage: string[];
  /**
   * Nights the page contradicts for a title it writes (D-079): a date on a weekday the page
   * denies beside the title, or under another night's heading. A row this source stored for that
   * title on that night is wrong whatever else the read missed, so it is retired even tonight,
   * which retirement otherwise leaves to the day-of check (Tango Y Te on Tuesday, run 29).
   */
  contradicted: Array<{ title: string; night: string }>;
  /**
   * True when the page text was not at hand (stored text pruned, read served from the cache): no
   * check against the page could run, the read is kept as it is, and the event pages stored
   * before are kept rather than overwritten by links nobody checked (D-073).
   */
  unchecked: boolean;
  /** Listings whose check dropped a fact their part of the page does not write (D-100, D-101). */
  factsDropped: number;
  /**
   * Dated listings the read left with no start time though their own part of the page writes one
   * (`ownPageTimes`): the read missed it, so the cached read is read again (D-267).
   */
  timesMissed: number;
}

export interface ExtractionReadOptions {
  pageUrl: string;
  fetchedAt: Date;
  today: string;
  /**
   * The page text the model read, to check its read against (D-070, D-073). Null when it is no
   * longer stored (an unchanged page whose body was pruned): a date beside a readable rule is then
   * not shown to be the page's, and the rule stands alone; titles, recurrences and links go
   * unchecked, and the result says so (`unchecked`).
   */
  pageText?: string | null;
  /** The source gathers other people's nights (D-061): its own links are its event pages. */
  directory?: boolean;
  /** The metro's country, for the order a URL writes a numeric date in (10-3-26). */
  countryCode?: string | null;
  /** The source's own styles: a read's style of their family stands unnamed (D-107). */
  sourceStyles?: readonly string[];
  /** The source is a weekly grid (`SeedSource.weeklyGrid`, D-402). */
  weeklyGrid?: boolean;
  /** The source is the venue's own site (`SeedSource.venuePage`): its label names the venue (D-299). */
  venueLabel?: string;
}

/**
 * Whether the page writes a listing's recurrence (D-073, D-074): beside the listing's own title
 * (`recurrenceNearTitle`: the rest of the title's line, the words after it up to the next
 * listing's title, and a weekday or dated heading over it), every weekday and ordinal the phrase
 * names, read alike on both sides (plurals, abbreviations, "first" and "1st", "&" and "and",
 * filler dropped). CDNY prints "ENGLISH - TUESDAYS", which the model reads as "every Tuesday". The
 * phrase written somewhere else on the page is not enough: on a list where one entry says "Every
 * Thursday", a model that copies it onto the next entry would otherwise invent that entry's
 * Thursdays, as the prompt's own example did on pages that named no Thursday at all.
 */
function pageStatesRecurrence(
  page: FoldedPage,
  title: string,
  phrase: string,
  lang: string | null | undefined,
  others: readonly string[],
): boolean {
  return recurrenceNearTitle(page, title, phrase, lang, others);
}

/** "A; B; C, and 2 more": the listings a report line names. */
function named(titles: readonly string[], max = 12): string {
  const unique = [...new Set(titles)];
  const shown = unique.slice(0, max).join("; ");
  return unique.length > max ? `${shown}, and ${unique.length - max} more` : shown;
}

const TIME_NAMES: Record<TimeField, string> = {
  doors_time: "doors",
  lesson_time: "lesson",
  dancing_time: "dancing",
  end_time: "end",
};
const TIME_TARGETS: Record<TimeField, string> = {
  doors_time: "doors",
  lesson_time: "the lesson",
  dancing_time: "the start",
  end_time: "the end",
};

/**
 * The run report's lines for the times a read's check changed (D-081): one line per kind of
 * change, naming each listing with what it came with and what was kept.
 */
function timeNotes(checked: ReadonlyArray<{ title: string; changes: readonly TimeChange[] }>) {
  const lines: Array<{
    kind: TimeChange["kind"];
    head: string;
    when?: (c: TimeChange) => boolean;
  }> = [
    {
      kind: "not_written",
      head: "came with a time their part of the page does not write; dropped",
    },
    {
      kind: "end_only",
      head: "came with the end of a range as a start; read as the end",
      when: (c) => c.kind === "end_only" && c.becameEnd,
    },
    {
      kind: "end_only",
      head: 'came with the end of a range, or a time after "until", as a start; dropped',
      when: (c) => c.kind === "end_only" && !c.becameEnd,
    },
    { kind: "cutoff_only", head: "came with a price's cut-off time as a start; dropped" },
    {
      kind: "meridiem",
      head: "came with am or pm the page does not write; read as the page writes it",
    },
    {
      kind: "moved",
      head: "came with a time the page's words beside it give another name; moved",
    },
    {
      kind: "end_over_12h",
      head: "came with an end the page writes more than 12 hours after the start; end not listed",
    },
    { kind: "superseded", head: "came with two times for one start; kept one" },
  ];
  const what = (change: TimeChange): string => {
    switch (change.kind) {
      case "not_written":
        return `${TIME_NAMES[change.field]} ${change.given}`;
      case "meridiem":
        return `${TIME_NAMES[change.field]} ${change.given} is ${change.time}`;
      case "end_only":
      case "cutoff_only":
      case "end_over_12h":
        return change.time;
      case "moved":
        return `${TIME_NAMES[change.field]} ${change.time} to ${TIME_TARGETS[change.to]}`;
      case "superseded":
        return `dropped ${change.time}, kept ${change.by}`;
    }
  };
  const notes: string[] = [];
  for (const { kind, head, when } of lines) {
    const listed: string[] = [];
    for (const { title, changes } of checked) {
      const mine = changes.filter((c) => c.kind === kind && (when?.(c) ?? true));
      if (mine.length > 0) listed.push(`${title} (${mine.map(what).join(", ")})`);
    }
    if (listed.length > 0) notes.push(`${listed.length} listing(s) ${head}: ${named(listed)}`);
  }
  return notes;
}

/**
 * The run report's lines for the facts a read's check changed (D-100): one line per kind of
 * change, naming each listing with what it came with and what was kept.
 */
function factNotes(checked: ReadonlyArray<{ title: string; changes: readonly FactChange[] }>) {
  const heads: Record<FactChange["kind"], string> = {
    dropped: "came with facts their part of the page does not write; dropped",
    relabelled: "came with a price the page writes under other words; filed under the page's",
    ranged: "came with one end of a price range the page writes; listed as the range",
  };
  const notes: string[] = [];
  for (const kind of ["dropped", "relabelled", "ranged"] as const) {
    const listed: string[] = [];
    for (const { title, changes } of checked) {
      const mine = changes.filter((c) => c.kind === kind);
      if (mine.length > 0) listed.push(`${title} (${mine.map((c) => c.detail).join(", ")})`);
    }
    if (listed.length > 0)
      notes.push(`${listed.length} listing(s) ${heads[kind]}: ${named(listed)}`);
  }
  return notes;
}

/**
 * Whether a grid cell headed by `base` writes `qualifier` (D-676): one of the four lines after a line that is the
 * base title, stopping at a time-slot line ("9pm-10pm") or a line naming the base or another read title.
 */
function cellWritesQualifier(
  pageText: string,
  base: string,
  qualifier: string,
  others: readonly string[],
): boolean {
  const lines = pageText.split("\n");
  const baseFold = foldForMatch(base);
  const stops = new Set([baseFold, ...others.map((o) => foldForMatch(o))]);
  const want = foldForMatch(qualifier);
  const timeSlot = /\d{1,2}(?::\d{2})?\s*[ap]\.?m\b/i;
  // Helper to strip trailing link marker
  const stripLink = (line: string): string => {
    return line.replace(/\s*\[https?:\/\/[^\]\s]*\]\s*$/, "").trim();
  };
  for (let i = 0; i < lines.length; i++) {
    const strippedLine = stripLink(lines[i]!);
    if (foldForMatch(strippedLine) !== baseFold) continue;
    // The next four non-blank lines (the cleaner writes a blank line between cells, D-598).
    let seen = 0;
    for (let j = i + 1; j < lines.length && seen < 4; j++) {
      const candidate = lines[j]!;
      const strippedCandidate = stripLink(candidate);
      if (strippedCandidate === "") continue; // skip blank lines
      seen++;
      if (timeSlot.test(candidate) || stops.has(foldForMatch(strippedCandidate))) break;
      if (foldForMatch(strippedCandidate) === want) return true;
    }
  }
  return false;
}

/** "Salsa Partner Work Level 2" -> { base: "Salsa Partner Work", qualifier: "Level 2" }; null when no level ends it (D-676). */
function extractLevelQualifier(title: string): { base: string; qualifier: string } | null {
  const LEVEL_QUALIFIER =
    /^(.*?\p{L}.*?)(?:\s*[-–—:]\s*|\s+)\(?((?:level\s*\d+\+?)|all\s+levels|open\s+level|beginners?|intermediate|advanced)\)?\s*$/iu;
  const m = LEVEL_QUALIFIER.exec(title.trim());
  if (!m) return null;
  const base = m[1]!.trim();
  const qualifier = m[2]!.trim();
  if (base === "" || !/\p{L}/u.test(base)) return null;
  return { base, qualifier };
}

/**
 * The extraction's listings as harvested listings for the ordinary write path, checked against the
 * page (D-070).
 *
 * Recurrence. A stated recurrence ("every Thursday") becomes a rule when the deterministic parser
 * reads it; the first occurrence is anchored on the night the page was read, at the earliest stated
 * time, or, for a rule that skips weeks ("every other Thursday"), on the date the page writes. A rule with no stated time is anchored at noon for date arithmetic only and marked
 * `timeListed: false`, so its nights are listed as "Time not listed" (D-060). The rule is kept even
 * when the model also gave a date, which it does despite the prompt (Stepping Out, run 26: "Every
 * Thursday" returned as Monday 28 September): the date is kept only when the page writes it beside
 * the title (`dateBesideTitle`, D-080), and then as a dated listing beside the rule. A dated listing
 * whose weekday its own phrase contradicts ("Every Sunday", dated a Tuesday) is rejected with a
 * note, never guessed at, and so is one whose title the page lists only under other nights' date
 * headings (D-074, `listedOnlyUnderOtherDates`), with the heading named, or whose own block gives
 * it another date (`contradictingDate`, D-080). A listing whose date goes that way is listed by the
 * rule the page writes after its title, when there is one (D-078); a rule that skips weeks runs
 * from the date the page gives the listing, and without one the listing is not listed this run
 * (`anchorOf`, seam review 2026-09-29).
 *
 * Links. `ticket_url` stays only when it is a link other than the page itself, and, for a directory,
 * a link off the directory's own site: The Ronda's page for an event sells no tickets. That page is
 * the event's own page, and is stored as its canonical URL.
 *
 * Kind. A listing read as `other`, or as a class its title does not call a class, takes the kind
 * the page's category label over its title gives it ("milonga" on The Ronda).
 *
 * Grounding (D-073). Every run, on a fresh read or a cached one, the read is checked against the
 * page with no model: a listing whose title the page does not write is rejected (a model can
 * invent a whole night, "Nylon Lindy Hop, every Thursday", on a page that never mentions it); a
 * recurrence the page does not write is dropped, and a listing left with neither a recurrence nor
 * a date the page writes is not written this run, though its title, being the page's, never
 * retires its rows (`recurrenceNotOnPage`); a ticket link the page does not carry is dropped. Titles
 * and phrases are compared folded (`foldWords`): exactly, or with the same letters and digits
 * split into words differently ("N oche De Descarga").
 *
 * Links (D-073). Each listing's own link on the page (`findEventLinks`): a ticket seller's page
 * becomes its ticket link when the model gave none, without tracking parameters; a page on the
 * site becomes its event page, and a model's ticket link to that same page is moved there. On a
 * directory, a found page replaces a different same-site page the model gave, which is dropped
 * with a note; when nothing is found, the model's stands.
 *
 * Times (D-081). Each listing's times are checked against its own part of the page
 * (`titleBlocks`, `checkListingTimes`): a time the part does not write is dropped, am or pm is
 * the page's, a range's end is never a start, and each start is filed under the word the page puts
 * beside it (doors, a lesson word, or none: the start). A listing left with no start of those the
 * read gave is marked `timesWithdrawn`, so it is written as "Time not listed".
 *
 * Prices and the age limit (D-100). From the same part, which a ticket link does not end
 * (`titleBlocks`' `facts`), `checkListingFacts`: an amount, a free entry or an age the part does not
 * write is dropped and nothing is put in its place; a price is filed under the page's words beside
 * its amount when the read's are not there, and one end of a range is listed as the range. A kept
 * fact's evidence is the page's own clause.
 */
export function extractionToHarvested(
  extraction: RawExtraction,
  options: ExtractionReadOptions,
): ExtractionRead {
  const pageText = options.pageText ?? null;
  const lang = extraction.language;
  const site = getDomain(options.pageUrl, { allowPrivateDomains: true });
  const rejected: ExtractionRead["rejected"] = [];
  const listings: HarvestedListing[] = [];
  const notOnPage: string[] = [];
  const contradicted: ExtractionRead["contradicted"] = [];
  const recurrenceNotOnPage: string[] = [];
  let datesDropped = 0;
  const rulesListed: string[] = [];
  const rulesFromPage: string[] = [];
  const rulesFromGrid: string[] = [];
  const rulesUnanchored: string[] = [];
  let eventPages = 0;
  const page = pageText !== null ? foldPage(pageText) : null;
  // A title the model ends with its own aside, "Ladies Styling (Thursdays)" where the page writes
  // "Ladies Styling": the page's words stand as the title and the aside is dropped.
  // Each listing's title without a trailing level (D-676), so a cell ends where another listing's class starts.
  const preliminaryBases = extraction.listings.map((l) => {
    const title = l.title.trim();
    const levelMatch = extractLevelQualifier(title);
    return levelMatch ? levelMatch.base : title;
  });

  const readListings = extraction.listings.map((l, index) => {
    const title = l.title.trim();
    if (page !== null && !findPhrase(page, title)) {
      const shorter = /^(.*\S)\s*\([^()]*\)$/.exec(title)?.[1]?.trim();
      if (shorter && /\p{L}/u.test(shorter) && findPhrase(page, shorter)) {
        return { ...l, title: shorter };
      }
      // A title the model joined from a row's cells, "Palais presents Axel Boman" where the page
      // writes "Palais presents" and "Axel Boman" apart: the longest part the page writes stands
      // (D-222).
      const written = title
        .split(/\s+presents?\s+|\s*[:|]\s+|\s+[-\u2013\u2014]\s+/i)
        .map((part) => part.replace(/^[\s:|\-\u2013\u2014]+|[\s:|\-\u2013\u2014]+$/gu, ""))
        .filter((part) => part.length >= 4 && /\p{L}/u.test(part) && findPhrase(page, part))
        .sort((a, b) => b.length - a.length)[0];
      if (written) return { ...l, title: written };
      // D-676: a class title the model ends with its cell's level ("Salsa Partner Work Level 2", where the grid
      // writes "Salsa Partner Work / Drop-in / Alexandre / Level 2") stands under the page's title, but only when
      // that title's own cell writes the level; a level the page does not write there is never dropped.
      const level = extractLevelQualifier(title);
      if (
        level &&
        pageText !== null &&
        findPhrase(page, level.base) &&
        cellWritesQualifier(
          pageText,
          level.base,
          level.qualifier,
          preliminaryBases.filter((_, i) => i !== index),
        )
      ) {
        return { ...l, title: level.base };
      }
      // Venue's own page: a made-up title that only names the venue becomes the venue's name (D-299).
      if (options.venueLabel && options.venueLabel.trim() !== "") {
        const label = options.venueLabel.trim();
        // Name forms: label itself, label without trailing parenthetical, text inside parenthetical.
        const forms: string[] = [label];
        const paren = /^(.*?)\s*\(([^)]+)\)$/.exec(label);
        if (paren) {
          const without = paren[1]!.trim();
          const inside = paren[2]!.trim();
          if (without) forms.push(without);
          if (inside) forms.push(inside);
        }
        const uniqueForms = [...new Set(forms.filter((f) => f.length > 0))];
        // Find the longest form the page writes.
        let writtenForm: string | null = null;
        for (const form of uniqueForms) {
          if (findPhrase(page, form)) {
            if (!writtenForm || form.length > writtenForm.length) {
              writtenForm = form;
            }
          }
        }
        if (writtenForm) {
          const titleWords = foldWords(title)
            .split(/\s+/)
            .map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
            .filter((w) => w.length > 0);
          const labelWords = foldWords(writtenForm)
            .split(/\s+/)
            .filter((w) => w.length > 0);
          // Filler words: weekdays and a fixed set.
          const fillerSet = new Set([
            "night",
            "nights",
            "nite",
            "nites",
            "nightclub",
            "club",
            "lounge",
            "bar",
            "weekend",
            "weekends",
            "week",
            "at",
            "the",
            "a",
            "of",
            "en",
            "el",
            "la",
            "los",
            "las",
            "de",
            "del",
            "noche",
            "noches",
            "noite",
            "noites",
            "fin",
            "semana",
            "party",
            "fiesta",
          ]);
          const remaining = titleWords.filter(
            (w) =>
              weekdaysNamed(w, lang).size === 0 && !fillerSet.has(w) && !labelWords.includes(w),
          );
          const hasLabelWord = titleWords.some((w) => labelWords.includes(w));
          if (remaining.length === 0 && hasLabelWord) {
            return { ...l, title: writtenForm };
          }
        }
      }
    }
    return l;
  });
  const linksOnPage =
    pageText !== null ? new Set(pageLinks(pageText).map(linkKey).filter(Boolean)) : null;
  const phrasesDropped: string[] = [];
  const ticketsDropped: string[] = [];
  const timeChanges: Array<{ title: string; changes: TimeChange[] }> = [];
  const factChanges: Array<{ title: string; changes: FactChange[] }> = [];
  const stylesDropped: string[] = [];
  const sourceStyles = (options.sourceStyles ?? []).filter(isStyleKey);
  let pageFamilies: Set<FamilyKey> | null = null;
  let timesMissed = 0;

  // Every title the read gives, so a listing's recurrence is looked for beside its own title and
  // not in the next listing's details (`tokensNearTitle`). A button's label read as a title ("TICKETS AND INFO")
  // is left out: as a title it would take the date and time lines of the card it ends (Rivoli Ballroom).
  const readTitles = readListings.map((l) => l.title.trim()).filter((t) => !isButtonLabel(t));
  // Every listing's part of the page, as the facts check reads it (D-105); worked out once, and
  // only when an organiser needs it.
  const partsOf = new Map<string, Array<{ start: number; end: number }>>();
  const allParts = (title: string) =>
    [...new Set(readTitles)].flatMap((t) => {
      if (!partsOf.has(t)) {
        const blocks = titleBlocks(pageText ?? "", t, readTitles, lang, undefined, { facts: true });
        partsOf.set(
          t,
          blocks.map((b) => ({ start: b.start, end: b.end })),
        );
      }
      return partsOf.get(t)!.map((p) => ({ ...p, own: foldForMatch(t) === foldForMatch(title) }));
    });
  for (const raw of readListings) {
    let listing = raw;
    const title = listing.title.trim();

    // Grounding: the page writes the title, else the listing is not the page's.
    if (page && !findPhrase(page, title)) {
      rejected.push({ title, reason: "the page does not write this title; not listed" });
      notOnPage.push(title);
      continue;
    }

    // Links: a ticket link is a link to tickets, not the page or the directory's own event page.
    let eventUrl: string | null = null;
    let ticket = listing.ticket_url;
    if (
      ticket &&
      !sameUrl(ticket, options.pageUrl) &&
      linksOnPage &&
      !linksOnPage.has(linkKey(ticket))
    ) {
      ticketsDropped.push(`${title} (${ticket})`);
      listing = { ...listing, ticket_url: null };
      ticket = null;
    }
    if (ticket && sameUrl(ticket, options.pageUrl)) {
      listing = { ...listing, ticket_url: null };
    } else if (
      ticket &&
      options.directory &&
      site &&
      getDomain(ticket, { allowPrivateDomains: true }) === site
    ) {
      eventUrl = ticket;
      eventPages += 1;
      listing = { ...listing, ticket_url: null };
    }

    // Kind: the page's own category label over the title.
    const stated = listing.listing_type;
    if (pageText && (stated === "other" || (stated === "class" && !mentionsClass(title)))) {
      const category = categoryAbove(pageText, title);
      if (category && category.type !== stated) {
        listing = {
          ...listing,
          listing_type: category.type,
          evidence: { ...listing.evidence, listing_type: category.label },
        };
      }
    }

    // Recurrence and date. A recurrence the page does not write is the model's, not the page's.
    const givenPhrase = listing.recurrence_text?.trim() || null;
    const phraseInvented =
      givenPhrase !== null &&
      page !== null &&
      !pageStatesRecurrence(page, title, givenPhrase, lang, readTitles);
    if (phraseInvented) {
      phrasesDropped.push(`${title} ("${givenPhrase.slice(0, 60)}")`);
      recurrenceNotOnPage.push(title);
      const evidence = { ...listing.evidence };
      delete evidence.recurrence_text;
      listing = { ...listing, recurrence_text: null, evidence };
    }
    let phrase = phraseInvented ? null : givenPhrase;
    let rrule = phrase ? recurrenceRule(phrase, lang) : null;
    let date = listing.local_date;
    // The night a rule taken from the page after the read's date went runs from (`anchorOf`).
    let ruleAnchor: string | null | false = null;
    // Where the page dates this listing (D-080): beside its own title, not anywhere on the page.
    const beside = date && page ? dateBesideTitle(page, title, date, lang, readTitles) : null;
    const dateStated = beside?.stated === true;
    // A date the page gives this listing none of, dating it otherwise beside its title: NYC Swings
    // writes "Fri, Oct 30" on the Flow Fridays card; the model's October 2 is another card's.
    const against =
      date && beside && !rrule && page && pageText !== null
        ? contradictingDate(page, pageText, title, date, lang, readTitles, beside)
        : null;
    if (date && against && pageText !== null) {
      rejected.push({
        title,
        reason:
          against.kind === "heading"
            ? `dated ${date}, but the page lists it only under "${against.text}"; not listed on that date`
            : `dated ${date}, but the page gives it "${against.text}" beside its title; not listed on that date`,
      });
      contradicted.push({ title, night: date });
      // The date goes; the rule the page writes after the title, when there is one, is the
      // listing's instead, as D-078 reads it: Stepping Out writes "Every Sunday" under Tango Y Te
      // and a next date below it, and a model's wrong date must not lose its Sundays.
      date = null;
      const written = recurrencePhraseAfterTitle(pageText, title, readTitles);
      const pageRule = written ? recurrenceRule(written, lang) : null;
      if (!written || !pageRule) continue;
      // A rule that skips weeks runs from the date the page gives the listing (seam review,
      // 2026-09-29): anchored on today it would list the weeks the event is off.
      ruleAnchor = anchorOf(pageRule, against.text, options.today, lang);
      if (ruleAnchor === false) {
        rulesUnanchored.push(`${title} ("${written.slice(0, 60)}")`);
        continue;
      }
      phrase = written;
      rrule = pageRule;
      listing = {
        ...listing,
        recurrence_text: written,
        evidence: { ...listing.evidence, recurrence_text: written },
      };
      rulesFromPage.push(`${title} ("${written}")`);
    }
    // Weekly grid: if the source is a weekly grid and the listing has no rule and no stated date,
    // try to derive a weekly rule from the page's weekday headings (D-402).
    let gridSection: string | null = null;
    // The slot line's start for a grid listing read with no start (D-598), set after the time checks: the slot
    // line stands above the slot's first class, outside a second class's own part of the page.
    let gridSlot: { time: string; line: string } | null = null;
    if (
      options.weeklyGrid === true &&
      page !== null &&
      pageText !== null &&
      !rrule &&
      !(date && dateStated)
    ) {
      const startTime = listing.doors_time ?? listing.lesson_time ?? listing.dancing_time ?? null;
      const rule = weeklyGridRule(
        page,
        pageText,
        title,
        givenPhrase,
        lang,
        startTime,
        options.venueLabel !== undefined,
      );
      if (rule) {
        phrase = rule.written;
        rrule = rule.rrule;
        date = null;
        gridSection = rule.section ?? null;
        gridSlot = rule.slotTime
          ? { time: rule.slotTime, line: rule.slotLine ?? rule.slotTime }
          : null;
        listing = {
          ...listing,
          recurrence_text: rule.written,
          evidence: { ...listing.evidence, recurrence_text: rule.written },
        };
        rulesFromGrid.push(`${title} ("${rule.written}")`);
      }
    }
    // A club's own page whose booking picker prints today's date (D-809, Grupo Mandala: "Select your date / November
    // 09, 2026"): the model's nights that are the "Open:" line's nights are that line's weekly rule, not the date.
    if (
      !rrule &&
      date &&
      phrase &&
      options.weeklyGrid === true &&
      options.venueLabel !== undefined &&
      pageText
    ) {
      const open = weeklyGridOpenRule(pageText, lang);
      const named = weekdaysNamed(phrase, lang);
      const openDays = open ? ruleWeekdays(open.rrule) : new Set<string>();
      if (
        open &&
        named.size > 0 &&
        named.size === openDays.size &&
        [...named].every((d) => openDays.has(d))
      ) {
        phrase = open.written;
        rrule = open.rrule;
        date = null;
        listing = {
          ...listing,
          recurrence_text: open.written,
          evidence: { ...listing.evidence, recurrence_text: open.written },
        };
        rulesFromGrid.push(`${title} ("${open.written}")`);
      }
    }
    // A grid listing whose rule the model (or the page beside its title) already wrote keeps that rule, but an
    // untimed one still takes its slot line's start when the grid lists it on the same weekdays (D-763, Agozar
    // "Timing & Musicality 1": "Every Sunday" from the model left the D-598 slot unused).
    if (
      gridSlot === null &&
      rrule &&
      options.weeklyGrid === true &&
      page !== null &&
      pageText !== null &&
      !(date && dateStated) &&
      (listing.doors_time ?? listing.lesson_time ?? listing.dancing_time ?? null) === null
    ) {
      const rule = weeklyGridRule(
        page,
        pageText,
        title,
        givenPhrase,
        lang,
        null,
        options.venueLabel !== undefined,
      );
      const given = ruleWeekdays(rrule);
      const grid = rule ? ruleWeekdays(rule.rrule) : new Set<string>();
      if (rule?.slotTime && grid.size === given.size && [...grid].every((day) => given.has(day))) {
        gridSlot = { time: rule.slotTime, line: rule.slotLine ?? rule.slotTime };
      }
    }

    let openLined = false;
    // A club's own "Open:" line that names the rule's nights vouches for the hours written on it (Grupo Mandala).
    if (
      gridSection === null &&
      rrule &&
      options.weeklyGrid === true &&
      options.venueLabel !== undefined
    ) {
      gridSection = pageText !== null ? openLineSection(pageText, lang, rrule) : null;
      openLined = gridSection !== null;
    }

    // Its title is the page's: not written this run, but not taken for a title the page does not
    // write either (`recurrenceNotOnPage`), so the rows it made before are not retired for it.
    if (phraseInvented && !rrule && !(date && dateStated)) {
      rejected.push({
        title,
        reason: `the page does not write "${givenPhrase.slice(0, 60)}" and gives no date for it; not listed`,
      });
      continue;
    }
    if (date && rrule && !dateStated) {
      date = null;
      datesDropped += 1;
    }
    // A date in a labelled list of the listing's dates wins over the rule beside it (D-821): El Fenn
    // lists its four Sundays under "DATES", and "every other Sunday" would run on past the last.
    if (date && rrule && beside?.listed) {
      rrule = null;
      phrase = null;
      const evidence = { ...listing.evidence };
      delete evidence.recurrence_text;
      listing = { ...listing, recurrence_text: null, evidence };
      rulesListed.push(`${title} (${date})`);
    }
    if (date && phrase) {
      const days = rrule ? ruleWeekdays(rrule) : weekdaysNamed(phrase, lang);
      const weekday = weekdayCodeOf(date);
      if (days.size > 0 && !days.has(weekday)) {
        rejected.push({
          title,
          reason: `dated ${date}, a ${WEEKDAY_NAMES[weekday]}, but the page says "${phrase.slice(0, 80)}"; not listed on that date`,
        });
        contradicted.push({ title, night: date });
        date = null;
        if (!rrule) continue;
      }
    }
    // A date and no rule, on a weekday the page contradicts beside the title (D-078): Stepping
    // Out writes "Every Sunday" under Tango Y Te, and the model dated it today, a Tuesday (run 28).
    // A date the page writes stands. Otherwise the date goes, and the rule the page writes after
    // the title, when there is one, is the listing's instead.
    if (date && !phrase && page !== null && pageText !== null && !dateStated) {
      const days = weekdaysNearTitle(page, title, lang, readTitles, { besideOnly: true });
      const weekday = weekdayCodeOf(date);
      if (days.size > 0 && !days.has(weekday)) {
        const given = [...days].map((d) => WEEKDAY_NAMES[d] ?? d).join(" or ");
        rejected.push({
          title,
          reason: `dated ${date}, a ${WEEKDAY_NAMES[weekday]}, but the page gives ${given} beside it; not listed on that date`,
        });
        contradicted.push({ title, night: date });
        date = null;
        const written = recurrencePhraseAfterTitle(pageText, title, readTitles);
        const pageRule = written ? recurrenceRule(written, lang) : null;
        if (!written || !pageRule) continue;
        // No date stands beside the title here (else `contradictingDate` would have spoken), so
        // the anchor is a date line in the listing's own part ("Next: 2026-10-09").
        ruleAnchor = anchorOf(
          pageRule,
          beside?.otherDate ??
            anchorLineOf(pageText, title, readTitles, pageRule, options.today, lang),
          options.today,
          lang,
        );
        if (ruleAnchor === false) {
          rulesUnanchored.push(`${title} ("${written.slice(0, 60)}")`);
          continue;
        }
        phrase = written;
        rrule = pageRule;
        listing = {
          ...listing,
          recurrence_text: written,
          evidence: { ...listing.evidence, recurrence_text: written },
        };
        rulesFromPage.push(`${title} ("${written}")`);
      }
    }
    // Date above (D-074): a dated listing whose title the page writes only under other nights'
    // headings is not that night's (run 21 put Gotham Jazz, listed under September 30 and October
    // 7, on October 1). A title not found, or found under its own night or under none, is left.
    // A listing whose own block states its night is that night's, whatever heading stands above its
    // title: Somewhere Nowhere prints each card's date four lines below the title, under the
    // previous card's date line (cov-92, 2026-11-03).
    const other =
      date &&
      pageText !== null &&
      !(page && dateBesideTitle(page, title, date, lang, readTitles).stated) &&
      listedOnlyUnderOtherDates(pageText, title, date, lang);
    if (date && other) {
      rejected.push({
        title,
        reason: `dated ${date}, but the page lists it only under "${other.slice(0, 60)}"; not listed on that date`,
      });
      contradicted.push({ title, night: date });
      date = null;
      if (!rrule) continue;
    }

    // Times (D-081): each time the read gives is checked against the listing's own words on the
    // page, after every date decision above, so `date` is final (null for a rule's listing).
    let timesWithdrawn: { pageStarts: string[]; pageEnds: string[] } | null = null;
    let organizerWithdrawn = false;
    if (page !== null && pageText !== null) {
      // A weekly grid's night whose title's own parts state no time (La Viruta: every night is titled by
      // the venue's name, written only in the footer) is timed from its weekday's section (D-402).
      // One event's dates list with one time block for all its dates (Newham's tea dances): no
      // date's own part writes the read's start, so the times are checked against the event's
      // text to the end of the page (D-270).
      function sharedTimeBlocks(own: TitleBlock[]): TitleBlock[] {
        if (own.length === 0 || pageText === null) return own;
        const key = foldForMatch(title);
        const sameTitle = readListings.filter((l) => foldForMatch(l.title.trim()) === key).length;
        if (sameTitle < 2) return own;
        // The read's starts the title's own part writes: those stand on their own.
        const starts = [listing.doors_time, listing.lesson_time, listing.dancing_time].filter(
          (t): t is string => typeof t === "string",
        );
        const written = ownPageTimes(own, date, lang).starts;
        // A night whose own part writes a start of its own is timed there, never from the next
        // cards' times (D-868, Traumtänzer: an unread card's 18:00 under a repeated title's night).
        if (starts.length === 0 || written.length > 0) return own;
        const first = own.reduce((a, b) => (b.start < a.start ? b : a));
        return [
          {
            ...first,
            end: pageText.length,
            text: pageText.slice(first.start),
            lead: "",
            held: false,
            above: "",
            card: false,
          },
        ];
      }
      const ownBlocks = titleBlocks(
        pageText,
        title,
        readTitles,
        lang,
        undefined,
        options.weeklyGrid ? { grid: true } : {},
      );
      // The plain line under the title (Tipitina's subtitle) is the page's own words about this listing,
      // which the venue-calendar screen reads (D-344).
      const subtitle = ownBlocks
        .map((b) => subtitleLine(pageText, b, readTitles, lang))
        .find((s): s is string => s !== null);
      if (
        subtitle !== undefined &&
        !Object.values(listing.evidence ?? {}).some((v) => v.includes(subtitle))
      ) {
        listing = { ...listing, evidence: { ...listing.evidence, subtitle } };
      }
      const blocks: TitleBlock[] =
        options.weeklyGrid === true &&
        gridSection !== null &&
        (openLined ||
          ownBlocks.every(
            (b) => readBlockTimes(`${b.above}\n${b.lead} ${b.text}`, lang).length === 0,
          ))
          ? [
              {
                start: 0,
                titleEnd: 0,
                end: gridSection.length,
                text: gridSection,
                heading: null,
                lead: "",
                held: false,
                above: "",
                card: false,
              },
            ]
          : sharedTimeBlocks(ownBlocks);
      const checked = checkListingTimes(listing, { blocks, pageText, title, date, lang });
      if (checked.changes.length > 0) {
        listing = checked.listing;
        timeChanges.push({ title, changes: checked.changes });
      }
      // A start one minute past the hour the title writes on the hour (D-268, Blue Nile).
      listing = titleHourOverOffset(listing, title, lang).listing;
      if (
        gridSlot !== null &&
        listing.doors_time == null &&
        listing.lesson_time == null &&
        listing.dancing_time == null
      ) {
        listing = {
          ...listing,
          dancing_time: gridSlot.time,
          evidence: { ...listing.evidence, dancing_time: gridSlot.line },
        };
      }
      if (checked.withdrawn) {
        timesWithdrawn = { pageStarts: checked.pageStarts, pageEnds: checked.pageEnds };
      }
      // A dated listing the read left untimed while its own part writes a start (D-267).
      if (
        date !== null &&
        listing.doors_time == null &&
        listing.lesson_time == null &&
        listing.dancing_time == null &&
        ownPageTimes(blocks, date, lang).starts.length > 0
      ) {
        timesMissed += 1;
      }
      // Prices and the age limit (D-100): from the same part, which a ticket link does not end.
      const factBlocks = titleBlocks(pageText, title, readTitles, lang, undefined, {
        facts: true,
        ...(options.weeklyGrid ? { grid: true } : {}),
      });
      const facts = checkListingFacts(
        listing,
        ownBlockTexts(factBlocks, date, lang, { lead: false }),
        { others: readTitles, currency: currencyForCountry(options.countryCode ?? "") },
      );
      listing = facts.listing;
      const changes = [...facts.changes];
      // The organiser (D-105): withdrawn only where the page writes it inside other listings'
      // parts and nowhere else.
      if (
        organizerFromNeighbour(listing.organizer, {
          pageUrl: options.pageUrl,
          pageText,
          own: ownBlockTexts(factBlocks, date, lang, { lead: false }),
          parts: () => allParts(title),
        })
      ) {
        changes.push({ field: "organizer", kind: "dropped", detail: listing.organizer!.name! });
        const evidence = { ...listing.evidence };
        const confidence = { ...listing.confidence };
        delete evidence.organizer;
        delete confidence.organizer;
        listing = { ...listing, organizer: { name: null, url: null }, evidence, confidence };
        organizerWithdrawn = true;
      }
      if (changes.length > 0) factChanges.push({ title, changes });
      // Styles (D-107): a style of a family the page never names, and not the source's own, is
      // the read's guess. Without it the listing's styles come from its title or its source.
      if (listing.styles.length > 0) {
        pageFamilies ??= new Set([
          ...matchStyles(pageText).families,
          ...sourceStyles.map((s) => familyOf(s)),
        ]);
        const named = pageFamilies;
        const unnamed = listing.styles.filter((s) => !named.has(familyOf(s)));
        if (unnamed.length > 0) {
          stylesDropped.push(`${title} (${unnamed.join(", ")})`);
          const evidence = { ...listing.evidence };
          delete evidence.styles;
          listing = {
            ...listing,
            styles: listing.styles.filter((s) => named.has(familyOf(s))),
            evidence,
          };
        }
      }
    }
    const base = {
      ...(timesWithdrawn ? { timesWithdrawn } : {}),
      ...(organizerWithdrawn ? { organizerWithdrawn: true as const } : {}),
      externalId: null,
      tz: null,
      venueLocation: null,
      provenance: {
        sourceUrl: options.pageUrl,
        fetchedAt: options.fetchedAt,
        method: "llm" as const,
      },
      ...(eventUrl ? { eventUrl } : {}),
    };
    if (rrule) {
      const time = listing.doors_time ?? listing.lesson_time ?? listing.dancing_time;
      // A rule that skips weeks ("every other Thursday") runs in step with a night the page
      // writes, not with the day it was read: anchored on today it would list the week the event
      // is off (review, 2026-09-28). A weekly rule falls on the same nights from either anchor.
      const interval = Number(/(?:^|;)INTERVAL=(\d+)/.exec(rrule)?.[1] ?? 1);
      // Look for a start date on the title's own line (D-599)
      const startDate =
        pageText !== null
          ? startDateOnTitleLine(pageText, title, rrule, options.today, lang)
          : null;
      const anchor = ruleAnchor || startDate || (date && interval > 1 ? date : options.today);
      const recurrence: HarvestedRecurrence = time
        ? { rrule, dtstartLocal: `${anchor}T${time}`, exdates: [] }
        : {
            rrule,
            dtstartLocal: `${anchor}T${UNTIMED_RULE_ANCHOR}`,
            exdates: [],
            timeListed: false,
          };
      // The rule's nights are the phrase's, not a date's: the model's quote of the phrase, or the
      // phrase itself, is their evidence.
      const evidence = { ...listing.evidence };
      delete evidence.local_date;
      listings.push({
        ...base,
        listing: {
          ...listing,
          local_date: null,
          evidence: {
            ...evidence,
            recurrence_text: (evidence.recurrence_text ?? phrase ?? "").slice(0, 300),
          },
        },
        recurrence,
      });
    }
    if (date || !rrule) {
      listings.push({ ...base, listing: { ...listing, local_date: date }, recurrence: null });
    }
  }

  // Each listing's own link among the page's links (D-073), with every listing's title and night
  // at once, so one listing's block ends where another's begins.
  const pagesFound: string[] = [];
  const ticketsFound: string[] = [];
  const ticketsMoved: string[] = [];
  const pagesReplaced: string[] = [];
  if (pageText !== null && listings.length > 0) {
    const found = findEventLinks(
      pageText,
      options.pageUrl,
      listings.map((h) => ({
        title: h.listing.title.trim(),
        date: h.recurrence ? null : h.listing.local_date,
      })),
      {
        lang,
        dateOrder: dateOrderFor(options.countryCode),
        // A rejected listing is still an item on the page: its title ends the block before it.
        bounds: rejected.map((r) => r.title),
      },
    );
    found.forEach((link, i) => {
      const h = listings[i]!;
      const title = h.listing.title.trim();
      if (!link.url) return;
      if (link.kind === "ticketing") {
        if (h.listing.ticket_url) return;
        listings[i] = { ...h, listing: { ...h.listing, ticket_url: stripTracking(link.url) } };
        ticketsFound.push(title);
        return;
      }
      // A same-site "ticket" link that is the event's own page is the event page (as D-070 does
      // for a directory's).
      let next = h;
      if (h.listing.ticket_url && sameLink(h.listing.ticket_url, link.url)) {
        next = { ...next, listing: { ...next.listing, ticket_url: null } };
        ticketsMoved.push(title);
      }
      if (!next.eventUrl) {
        next = { ...next, eventUrl: link.url };
        pagesFound.push(title);
      } else if (!sameLink(next.eventUrl, link.url)) {
        // On a directory the model's same-site link is its event page unchecked, and a model
        // mixes up neighbours (Salsa Social given Bachata Night's page for another night). The
        // matcher's link passed its checks (the listing's own line or block, no other title's,
        // no other night's), so it wins, and the model's is dropped (review 2026-09-29).
        pagesReplaced.push(`${title} (${next.eventUrl})`);
        next = { ...next, eventUrl: link.url };
      }
      listings[i] = next;
    });
  }

  const notes: string[] = [];
  if (datesDropped > 0) {
    notes.push(
      `${datesDropped} listing(s) came with a date the page does not state beside a recurrence it does: listed by the recurrence`,
    );
  }
  if (rulesListed.length > 0) {
    notes.push(
      `${rulesListed.length} listing(s) came with a rule beside a date the page lists under a dates label: listed on the page's dates, not the rule (D-821): ${named(rulesListed)}`,
    );
  }
  if (rulesFromPage.length > 0) {
    notes.push(
      `${rulesFromPage.length} listing(s) came dated on a weekday the page contradicts, and no rule: listed by the rule the page writes after the title: ${named(rulesFromPage)}`,
    );
  }
  if (rulesFromGrid.length > 0) {
    notes.push(
      `${rulesFromGrid.length} listing(s) on a weekly grid came with no rule and no date: listed weekly by the weekdays the page writes over them (D-402): ${named(rulesFromGrid)}`,
    );
  }
  if (rulesUnanchored.length > 0) {
    notes.push(
      `${rulesUnanchored.length} listing(s) came dated on a night the page contradicts, and the rule the page writes after the title skips weeks with no date of the page's to keep them by: not listed this run: ${named(rulesUnanchored)}`,
    );
  }
  if (phrasesDropped.length > 0) {
    notes.push(
      `${phrasesDropped.length} listing(s) came with a recurrence the page does not write; dropped: ${named(phrasesDropped)}`,
    );
  }
  if (ticketsDropped.length > 0) {
    notes.push(
      `${ticketsDropped.length} listing(s) came with a ticket link the page does not carry; dropped: ${named(ticketsDropped)}`,
    );
  }
  if (eventPages > 0) {
    notes.push(
      `${eventPages} listing(s) linked this site's own page for the event: kept as the event page, not as tickets`,
    );
  }
  if (pagesReplaced.length > 0) {
    notes.push(
      `${pagesReplaced.length} listing(s) linked a page on this site other than the one the page's own links give them: that one kept, the model's dropped: ${named(pagesReplaced)}`,
    );
  }
  if (ticketsMoved.length > 0) {
    notes.push(
      `${ticketsMoved.length} listing(s) gave as tickets the event's own page on this site: kept as the event page: ${named(ticketsMoved)}`,
    );
  }
  if (pagesFound.length > 0) {
    notes.push(
      `${pagesFound.length} listing(s) got their own event page from the page's links: ${named(pagesFound)}`,
    );
  }
  if (ticketsFound.length > 0) {
    notes.push(
      `${ticketsFound.length} listing(s) got a ticket seller's page for the event from the page's links: ${named(ticketsFound)}`,
    );
  }
  notes.push(...timeNotes(timeChanges));
  notes.push(...factNotes(factChanges));
  if (stylesDropped.length > 0) {
    notes.push(
      `${stylesDropped.length} listing(s) came with a style the page never names; left to the title or the source: ${stylesDropped.join("; ")}`,
    );
  }
  if (pageText === null) {
    notes.push(
      "the page's text is no longer stored, so this read was not checked against it (titles, recurrences, links): kept as read, with the event pages stored before",
    );
  }
  // A copy whose time its own part does not write, beside the read's timed listing of one title
  // and night, is a misread of another card (D-868): dropped.
  const twins = withdrawnTwins(listings);
  if (twins.length > 0) {
    notes.push(
      `${twins.length} listing(s) came with a time their own part does not write, beside the read's timed listing of one title and night: dropped as a misread (D-868): ${named(twins.map((l) => l.listing.title))}`,
    );
  }
  return {
    listings: listings.filter((l) => !twins.includes(l)),
    rejected,
    notes,
    notOnPage,
    recurrenceNotOnPage: [...new Set(recurrenceNotOnPage)],
    contradicted,
    unchecked: pageText === null,
    factsDropped: factChanges.filter((c) => c.changes.some((x) => x.kind === "dropped")).length,
    timesMissed,
  };
}

/**
 * Where a rule taken from the page runs from, for a listing whose read date went (D-078, D-080):
 * null for a rule that falls on the same nights from any anchor; for one that skips weeks
 * ("every other Sunday"), the date the page gives the listing (`pageDate`, as written: "Sunday,
 * October 11"), on one of the rule's weekdays; false when there is none, and the listing is not
 * listed this run rather than on a guessed fortnight (seam review, 2026-09-29).
 */
function anchorOf(
  rrule: string,
  pageDate: string | null,
  today: string,
  lang: string | null,
): string | null | false {
  const interval = Number(/(?:^|;)INTERVAL=(\d+)/.exec(rrule)?.[1] ?? 1);
  if (interval <= 1) return null;
  const days = ruleWeekdays(rrule);
  const iso = pageDate ? isoOfPageDate(pageDate, today, lang, days) : null;
  if (iso === null) return false;
  return days.size === 0 || days.has(weekdayCodeOf(iso)) ? iso : false;
}

/**
 * The first line of a listing's own part of the page (`titleBlocks`) that names a date on one of a
 * rule's weekdays (`isoOfPageDate`): where an "every other" rule taken from the page runs from when
 * no date stands beside its title (review of the seam fixes, 2026-09-29). Null when none does.
 */
function anchorLineOf(
  pageText: string,
  title: string,
  readTitles: readonly string[],
  rrule: string,
  today: string,
  lang: string | null,
): string | null {
  const days = ruleWeekdays(rrule);
  for (const block of titleBlocks(pageText, title, readTitles, lang)) {
    for (const line of block.text.split("\n").slice(1)) {
      // Another item's own title (one link's label: the read skipped it) ends the listing's part,
      // and the date a post was written on is no night of it (review of the seam fixes).
      const item = /^(.*?)\s*\[https?:[^\]\s]*\]\s*$/.exec(line.trim());
      if (item && /\p{L}/u.test(item[1]!) && isoOfPageDate(item[1]!, today, lang) === null) break;
      if (/\b(?:posted|published|updated)\b/i.test(line)) continue;
      const iso = isoOfPageDate(line, today, lang, days);
      if (iso !== null && days.has(weekdayCodeOf(iso))) return line;
    }
  }
  return null;
}

/**
 * A weekly rule's start written before its title on the title's own line (D-599, agozar.com: "01 Dec Tuesdays
 * 9pm-10pm SALSA - ABSOLUTE BEGINNER 4 week cycle"): the first such date on one of the rule's weekdays, when it is
 * later than today; otherwise null.
 */
function startDateOnTitleLine(
  pageText: string,
  title: string,
  rrule: string,
  today: string,
  lang: string | null,
): string | null {
  const days = ruleWeekdays(rrule);
  const titleFold = foldForMatch(title);
  for (const line of pageText.split("\n")) {
    if (!foldForMatch(line).includes(titleFold)) continue;
    const lowerLine = line.toLowerCase();
    const lowerTitle = title.toLowerCase();
    const pos = lowerLine.indexOf(lowerTitle);
    if (pos === -1) continue;
    const leading = line.slice(0, pos).trim();
    if (leading === "") continue;
    const iso = isoOfPageDate(leading, today, lang, days);
    if (iso === null || !days.has(weekdayCodeOf(iso))) continue;
    // The first dated line decides: one on or before today means the rule already runs (a list of
    // dates whose first is tonight must not start next week).
    return iso > today ? iso : null;
  }
  return null;
}

/**
 * The night a date the page writes names ("Sunday, October 11", "Oct 11 [link]", "2026-10-11"),
 * as an ISO date: of the years around today's that the text states (a year it writes must match),
 * the one nearest today among those on one of `days` when any is, else the nearest (review of the
 * seam fixes, 2026-09-29: a rule's start written without its year, months back, is last year's,
 * not next year's). Null when it names no month and day by the month's name or as an ISO date.
 */
function isoOfPageDate(
  text: string,
  today: string,
  lang: string | null,
  days: ReadonlySet<string> = new Set(),
): string | null {
  const written = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(text);
  const m = written
    ? ([written[0], written[2], written[3]] as const)
    : /^(\d{1,2})-(\d{1,2})$/.exec(headingDateKey(text, lang));
  if (!m) return null;
  const dayOf = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / 86_400_000;
  const year = Number(today.slice(0, 4));
  const years = written ? [Number(written[1])] : [year - 1, year, year + 1];
  const candidates = years
    .map((y) => `${y}-${m[1]!.padStart(2, "0")}-${m[2]!.padStart(2, "0")}`)
    .filter((iso) => {
      const real = new Date(`${iso}T00:00:00Z`);
      if (Number.isNaN(real.getTime()) || real.toISOString().slice(0, 10) !== iso) return false;
      return written !== null || statesDate(text, iso, lang);
    });
  const onDays = candidates.filter((iso) => days.has(weekdayCodeOf(iso)));
  const pool = onDays.length > 0 ? onDays : candidates;
  let best: string | null = null;
  for (const iso of pool) {
    if (best === null || Math.abs(dayOf(iso) - dayOf(today)) < Math.abs(dayOf(best) - dayOf(today)))
      best = iso;
  }
  return best;
}

/** Two http(s) URLs name the same page: host without www, path without a trailing slash, query. */
function sameUrl(a: string, b: string): boolean {
  const key = (u: string) => {
    try {
      const url = new URL(u);
      return `${url.hostname.replace(/^www\./, "")}${url.pathname.replace(/\/+$/, "")}${url.search}`;
    } catch {
      return u;
    }
  };
  return key(a) === key(b);
}
