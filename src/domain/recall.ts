// The recall eval (SPEC section 8, PLAN 12, D-112). Pure: the owner's list of nights he knows
// are on, matched to what the site lists with the dedupe scorer (D-006), and every miss put in
// one of PLAN's four classes. src/pipeline/recall.ts loads the facts from the database; this
// decides what they mean.

import { z } from "zod";

import { type FamilyKey, matchStyles, normalizeForMatch } from "@/config/styles";
import { CANDIDATE_START_MINUTES, CANDIDATE_VENUE_NAME_SIMILARITY, REVIEW } from "@/config/dedupe";
import { type DedupeSide, isHubSite, ownSite, scorePair } from "@/src/domain/dedupe";

/** Title similarity at which a listing at the same venue counts as found (D-227). */
export const SAME_VENUE_TITLE_SIMILARITY = 0.6;

/** The CSV's columns, in order. Only `title` is required. */
export const RECALL_COLUMNS = ["title", "venue", "start_time", "style", "source_url"] as const;

export interface RecallRow {
  /** 1-based line in the file, for the report. */
  line: number;
  title: string;
  venue: string | null;
  /** Local "HH:MM", 24-hour; an hour after midnight belongs to the night before. */
  start: string | null;
  style: string | null;
  url: string | null;
}

const httpUrl = z
  .url({ protocol: /^https?$/ })
  .nullable()
  .catch(() => null);

/** "21:00", "9pm", "9:30 pm", "12am", "noon". Null when blank or unreadable. */
export function parseClock(raw: string): string | null {
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  if (s === "noon") return "12:00";
  if (s === "midnight") return "00:00";
  const m = /^(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?$/.exec(s);
  if (!m) return null;
  let hour = Number(m[1]);
  const minute = Number(m[2] ?? "0");
  const half = m[3]?.[0];
  if (minute > 59) return null;
  if (half) {
    if (hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (half === "p" ? 12 : 0);
  } else if (hour > 23 || m[2] === undefined) {
    // A bare "9" is not a time anyone wrote on purpose.
    return null;
  }
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** One CSV record per line; fields may be double-quoted, with "" for a quote inside. */
function splitCsv(text: string): string[][] {
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      record.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      record.push(field);
      records.push(record);
      record = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || record.length > 0) {
    record.push(field);
    records.push(record);
  }
  return records;
}

export interface ParsedRecallCsv {
  rows: RecallRow[];
  /** Lines skipped, with why: the report prints them so nothing is dropped silently. */
  problems: string[];
}

/**
 * Reads the owner's CSV. The header row names the columns (any order, any case); a line whose
 * first field starts with "#" is a comment. A row with no title is reported, not read; a start
 * time or URL that cannot be read is reported and treated as not given.
 */
export function parseRecallCsv(text: string): ParsedRecallCsv {
  const records = splitCsv(text.replace(/^﻿/, ""));
  const problems: string[] = [];
  const rows: RecallRow[] = [];
  const headerAt = records.findIndex((r) => r.some((f) => f.trim() !== "") && !isComment(r));
  if (headerAt < 0) return { rows, problems: ["the file has no header row"] };
  const header = records[headerAt]!.map((h) => h.trim().toLowerCase());
  const col = (name: (typeof RECALL_COLUMNS)[number]) => header.indexOf(name);
  if (col("title") < 0) return { rows, problems: ['the header has no "title" column'] };
  for (const unknown of header.filter(
    (h) => h && !(RECALL_COLUMNS as readonly string[]).includes(h),
  ))
    problems.push(`header: column "${unknown}" is not read`);
  for (let i = headerAt + 1; i < records.length; i++) {
    const record = records[i]!;
    const line = i + 1;
    if (isComment(record) || record.every((f) => f.trim() === "")) continue;
    const get = (name: (typeof RECALL_COLUMNS)[number]) => {
      const at = col(name);
      const value = at >= 0 ? (record[at] ?? "").trim() : "";
      return value === "" ? null : value;
    };
    const title = get("title");
    if (!title) {
      problems.push(`line ${line}: no title, so not read`);
      continue;
    }
    const rawStart = get("start_time");
    const start = rawStart ? parseClock(rawStart) : null;
    if (rawStart && !start) problems.push(`line ${line}: start time "${rawStart}" not read`);
    const rawUrl = get("source_url");
    const url = rawUrl ? httpUrl.parse(rawUrl) : null;
    if (rawUrl && !url) problems.push(`line ${line}: source URL "${rawUrl}" is not http(s)`);
    rows.push({ line, title, venue: get("venue"), start, style: get("style"), url });
  }
  return { rows, problems };
}

function isComment(record: string[]): boolean {
  return (record[0] ?? "").trimStart().startsWith("#");
}

/** A listing on the night, as the loader reads it. */
export interface RecallListing {
  id: string;
  title: string;
  /** Local "HH:MM" of the listing's start, or null when it gives none (D-060). */
  start: string | null;
  canonicalUrl: string | null;
  ticketUrl: string | null;
  /** Every event page its sources link (event_sources.event_url). */
  eventUrls: string[];
  /** The organiser sites the listing is on: its sources' and its own links' (`ownSite`). */
  sites: string[];
  /** pg_trgm similarity of the row's normalised title to the listing's, 0 to 1. */
  titleSimilarity: number;
  /** pg_trgm similarity of the row's venue name to the listing's, when both have one. */
  venueSimilarity: number | null;
}

function minutes(clock: string): number {
  const [h, m] = clock.split(":").map(Number);
  return h! * 60 + m!;
}

/** Minutes between two local clocks on one night, across midnight either way. */
export function clockGap(a: string, b: string): number {
  const d = Math.abs(minutes(a) - minutes(b));
  return Math.min(d, 1440 - d);
}

export interface RecallMatch {
  listing: RecallListing;
  score: number;
}

function sameVenue(listing: RecallListing): boolean {
  return (
    listing.venueSimilarity !== null && listing.venueSimilarity >= CANDIDATE_VENUE_NAME_SIMILARITY
  );
}

function sameSite(row: RecallRow, listing: RecallListing): boolean {
  const site = ownSite(row.url);
  return site !== null && !isHubSite(site) && listing.sites.includes(site);
}

/** The row's link is the listing's own event page or ticket link. */
function sameEventPage(row: RecallRow, listing: RecallListing): boolean {
  return row.url !== null && (listing.eventUrls.includes(row.url) || listing.ticketUrl === row.url);
}

/**
 * The dedupe scorer (D-006) with the row as one side: title similarity, the same venue (names at
 * the dedupe's venue-name similarity), the same URL or URL family, and the same organiser site
 * standing in for the same organiser. Starts more than the dedupe's candidate gap apart never
 * match; a side with no time does not disagree. Found means a score at the dedupe's review
 * threshold or above (a pair the dedupe would at least have asked about); or the row's link being
 * the listing's own event page or ticket link, since that page is the night (a list or home page
 * shared by many nights, a listing's canonical URL, is never enough alone); or the organizer link
 * (D-090): the row's site is one of the listing's organiser sites and the venue is the same, so
 * "Swing Remix" on the list finds "The Brooks Prumo Orchestra" on swingremixnyc.com; or the same
 * venue and a close title (D-227).
 */
export function scoreRow(row: RecallRow, listing: RecallListing): number | null {
  if (row.start && listing.start && clockGap(row.start, listing.start) > CANDIDATE_START_MINUTES)
    return null;
  const sameEventUrl = sameEventPage(row, listing);
  const side = (id: string, canonical: string | null, ticket: string | null): DedupeSide => ({
    id,
    startsAt: null,
    organizerId: sameSite(row, listing) ? "site" : null,
    organizerName: null,
    venueId: sameVenue(listing) ? "venue" : null,
    ticketUrl: ticket,
    canonicalUrl: canonical,
    trust: "first_party",
    firstSeenAt: new Date(0),
  });
  const rowSide = side("row", row.url, row.url);
  const listingSide = side(
    listing.id,
    sameEventUrl ? row.url : listing.canonicalUrl,
    listing.ticketUrl,
  );
  return scorePair(rowSide, listingSide, {
    titleSimilarity: listing.titleSimilarity,
    organizerSimilarity: null,
  }).score;
}

/** The best-scoring listing found (see `scoreRow`), or null. */
export function bestMatch(row: RecallRow, listings: readonly RecallListing[]): RecallMatch | null {
  let best: RecallMatch | null = null;
  for (const listing of listings) {
    const score = scoreRow(row, listing);
    if (score === null) continue;
    const linked = sameEventPage(row, listing) || (sameSite(row, listing) && sameVenue(listing));
    const sameVenueCloseTitle =
      sameVenue(listing) && listing.titleSimilarity >= SAME_VENUE_TITLE_SIMILARITY;
    if (score < REVIEW && !linked && !sameVenueCloseTitle) continue;
    if (!best || score > best.score || (score === best.score && listing.id < best.listing.id))
      best = { listing, score };
  }
  return best;
}

export type MissCause =
  "no_source_known" | "source_not_harvested" | "extracted_wrong" | "deduped_away";

export const MISS_CAUSES: readonly MissCause[] = [
  "no_source_known",
  "source_not_harvested",
  "extracted_wrong",
  "deduped_away",
];

/** A source that shares a site with the row, and what its last harvests say. */
export interface RelatedSource {
  url: string;
  enabled: boolean;
  robotsDisallowed: boolean;
  /** The last error the ingest recorded, while the source is failing. */
  failing: string | null;
  /** The latest fetch before the night ended, or null when it was never fetched in time. */
  fetchedAt: string | null;
  /** Whether the latest stored page text names the row's title. */
  textNamesTitle: boolean;
}

/** What the loader found about one row the site does not list. */
export interface MissEvidence {
  /** A merged-away listing on the night that matches the row, and the listing it went into. */
  mergedInto: { mergedTitle: string; survivorTitle: string } | null;
  /** A listing of the row's title on the wrong night, or at a start or place that disagrees. */
  misplaced: { title: string; night: string; why: string } | null;
  sources: RelatedSource[];
}

export interface Miss {
  cause: MissCause;
  detail: string;
}

/**
 * PLAN 12's four classes, first match wins: merged into a listing that is not the night
 * (deduped_away); a listing exists with a wrong night, start or place, or a harvested page names
 * the title and nothing was written (extracted_wrong); no source shares a site with the row
 * (no_source_known); otherwise a source was not read in time (source_not_harvested). A source
 * read in time whose page does not name the night is also source_not_harvested: the night is on
 * a page of that site we do not read.
 */
export function classifyMiss(evidence: MissEvidence): Miss {
  if (evidence.mergedInto)
    return {
      cause: "deduped_away",
      detail: `"${evidence.mergedInto.mergedTitle}" was merged into "${evidence.mergedInto.survivorTitle}"`,
    };
  if (evidence.misplaced)
    return {
      cause: "extracted_wrong",
      detail: `listed as "${evidence.misplaced.title}" on ${evidence.misplaced.night}: ${evidence.misplaced.why}`,
    };
  const sources = evidence.sources;
  const named = sources.find((s) => s.fetchedAt && s.textNamesTitle);
  if (named)
    return {
      cause: "extracted_wrong",
      detail: `${named.url} (fetched ${named.fetchedAt}) names it, and no listing was written`,
    };
  if (sources.length === 0)
    return { cause: "no_source_known", detail: "no source shares its site" };
  const why = (s: RelatedSource): string =>
    !s.enabled
      ? "switched off"
      : s.robotsDisallowed
        ? "robots.txt disallows it"
        : s.failing
          ? `failing: ${s.failing}`
          : !s.fetchedAt
            ? "not fetched before the night"
            : `fetched ${s.fetchedAt}; the page does not name it`;
  return {
    cause: "source_not_harvested",
    detail: sources.map((s) => `${s.url} (${why(s)})`).join("; "),
  };
}

/** The family the owner's style names, or null when it names none. */
export function rowFamily(row: RecallRow): FamilyKey | null {
  return row.style ? (matchStyles(row.style).families[0] ?? null) : null;
}

export interface RowResult {
  row: RecallRow;
  family: FamilyKey | null;
  found: { title: string; score: number } | null;
  miss: Miss | null;
}

export interface RecallReport {
  metro: string;
  night: string;
  found: number;
  missed: number;
  missesByCause: Record<MissCause, number>;
  byFamily: Record<string, { found: number; missed: number }>;
  lines: string[];
}

export function buildRecallReport(
  metro: string,
  night: string,
  results: readonly RowResult[],
  problems: readonly string[],
): RecallReport {
  const missesByCause = Object.fromEntries(MISS_CAUSES.map((c) => [c, 0])) as Record<
    MissCause,
    number
  >;
  const byFamily: Record<string, { found: number; missed: number }> = {};
  for (const r of results) {
    const key = r.family ?? "no style given";
    const f = (byFamily[key] ??= { found: 0, missed: 0 });
    if (r.found) f.found++;
    else f.missed++;
    if (r.miss) missesByCause[r.miss.cause]++;
  }
  const found = results.filter((r) => r.found).length;
  const missed = results.length - found;
  const pct = results.length ? Math.round((found / results.length) * 100) : 0;
  const lines = [
    `Recall, ${metro}, night of ${night}: ${found} of ${results.length} found (${pct}%), ${missed} missed`,
    ...MISS_CAUSES.filter((c) => missesByCause[c] > 0).map((c) => `  ${c}: ${missesByCause[c]}`),
    "By family (found / on the list):",
    ...Object.entries(byFamily)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `  ${k}: ${v.found} / ${v.found + v.missed}`),
  ];
  const misses = results.filter((r) => r.miss);
  if (misses.length) lines.push("Missed:");
  for (const r of misses)
    lines.push(`  line ${r.row.line} "${r.row.title}": ${r.miss!.cause}: ${r.miss!.detail}`);
  if (problems.length) lines.push("Not read:", ...problems.map((p) => `  ${p}`));
  lines.push(
    "The list measures what we miss only where the owner corrected it: a list drafted from what we find finds it (D-048, question 3).",
  );
  return { metro, night, found, missed, missesByCause, byFamily, lines };
}

/** Whether a page's text names a title: the normalised title appears in the normalised text. */
export function textNamesTitle(text: string, title: string): boolean {
  const t = normalizeForMatch(title);
  return t.length > 0 && ` ${normalizeForMatch(text)} `.includes(` ${t} `);
}
