// The recall eval's loader (D-112): reads what the database holds for one metro and night and
// hands it to the pure matcher and classifier in src/domain/recall.ts. Read-only; it writes an
// `eval_runs` row only when asked.

import { sql } from "drizzle-orm";

import { normalizeForMatch } from "@/config/styles";
import type { Db } from "@/src/db/client";
import { evalRuns } from "@/src/db/schema";
import { isHubSite, ownSite } from "@/src/domain/dedupe";
import {
  bestMatch,
  buildRecallReport,
  classifyMiss,
  type MissEvidence,
  type RecallListing,
  type RecallReport,
  type RecallRow,
  type RelatedSource,
  rowFamily,
  type RowResult,
  textNamesTitle,
} from "@/src/domain/recall";
import { addCalendarDays, type IsoDate } from "@/src/domain/time";

/** A same-night listing this alike in title, that did not match, was written wrong. */
const MISPLACED_TITLE_SIMILARITY = 0.6;
/** A listing on the night before or after this alike in title was given the wrong night. */
const WRONG_NIGHT_TITLE_SIMILARITY = 0.8;
/** How far back a fetch counts as having read the source for the night. */
const FETCHED_WITHIN_DAYS = 14;

type ListingRow = {
  id: string;
  title: string;
  night: string;
  start: string | null;
  canonical_url: string | null;
  ticket_url: string | null;
  merged_into_id: string | null;
  title_sim: number;
  venue_sim: number | null;
  event_urls: string[] | null;
  source_urls: string[] | null;
  other_source_urls: string[] | null;
};

/**
 * A listing's organiser sites, as the organizer link reads them (D-090): its first-party sources'
 * and its own links', never a directory's or ticket seller's that only lists it, nor a hub's.
 */
function toListing(r: ListingRow): RecallListing {
  const eventUrls = r.event_urls ?? [];
  const listers = new Set((r.other_source_urls ?? []).map((u) => ownSite(u)));
  const sites = [r.canonical_url, r.ticket_url, ...eventUrls, ...(r.source_urls ?? [])]
    .map((u) => ownSite(u))
    .filter((s): s is string => s !== null && !listers.has(s) && !isHubSite(s));
  return {
    id: r.id,
    title: r.title,
    start: r.start,
    canonicalUrl: r.canonical_url,
    ticketUrl: r.ticket_url,
    eventUrls,
    sites: [...new Set(sites)],
    titleSimilarity: Number(r.title_sim),
    venueSimilarity: r.venue_sim === null ? null : Number(r.venue_sim),
  };
}

async function listingsOn(
  db: Db,
  metroId: string,
  row: RecallRow,
  nights: readonly string[],
  statuses: readonly string[],
  where: ReturnType<typeof sql> = sql`true`,
): Promise<ListingRow[]> {
  const title = normalizeForMatch(row.title);
  const venue = row.venue ? normalizeForMatch(row.venue) : "";
  const namePart = row.venue ? normalizeForMatch(row.venue.split(",")[0] ?? "") : "";
  return [
    ...(await db.execute<ListingRow>(sql`
      select e.id, e.title, e.night_date::text as night,
        to_char(e.starts_at at time zone e.tz, 'HH24:MI') as start,
        e.canonical_url, e.ticket_url, e.merged_into_id,
        similarity(e.title_normalized, ${title})::float8 as title_sim,
        case when ${venue} <> '' and v.id is not null
          then case
            when length(${namePart}) >= 4 and (
              position(' ' || ${namePart} || ' ' in ' ' || v.name_normalized || ' ') > 0 or
              position(' ' || v.name_normalized || ' ' in ' ' || ${namePart} || ' ') > 0
            ) then 1.0
            else greatest(
              similarity(v.name_normalized, ${venue}),
              similarity(v.name_normalized, ${namePart})
            ) end
        end as venue_sim,
        array(select es.event_url from event_sources es
          where es.event_id = e.id and es.event_url is not null) as event_urls,
        array(select s.url from sources s
          where s.id = any(e.source_ids) and s.trust_tier = 'first_party') as source_urls,
        array(select s.url from sources s
          where s.id = any(e.source_ids) and s.trust_tier <> 'first_party') as other_source_urls
      from events e left join venues v on v.id = e.venue_id
      where e.metro_id = ${metroId}
        and e.night_date::text = any(${`{${nights.join(",")}}`}::text[])
        and e.status::text = any(${`{${statuses.join(",")}}`}::text[])
        and ${where}
      order by e.id`)),
  ];
}

async function listingById(db: Db, row: RecallRow, id: string): Promise<RecallListing | null> {
  const metro = [
    ...(await db.execute<{ metro_id: string; night: string; status: string }>(
      sql`select metro_id, night_date::text as night, status::text as status from events where id = ${id}`,
    )),
  ][0];
  if (!metro) return null;
  const rows = await listingsOn(
    db,
    metro.metro_id,
    row,
    [metro.night],
    [metro.status],
    sql`e.id = ${id}`,
  );
  return rows[0] ? toListing(rows[0]) : null;
}

type SourceRow = {
  id: string;
  url: string;
  enabled: boolean;
  robots_status: string;
  health: { consecutiveFailures?: number; lastError?: string | null } | null;
};

async function relatedSources(
  db: Db,
  metroId: string,
  row: RecallRow,
  night: IsoDate,
): Promise<RelatedSource[]> {
  const sites = new Set<string>();
  const rowSite = ownSite(row.url);
  if (rowSite) sites.add(rowSite);
  if (row.venue) {
    const venue = normalizeForMatch(row.venue);
    const namePart = normalizeForMatch(row.venue.split(",")[0] ?? "");
    const venueSites = await db.execute<{ website_url: string | null }>(sql`
      select website_url from venues
      where website_url is not null and (metro_id = ${metroId} or metro_id is null)
        and greatest(
          similarity(name_normalized, ${venue}),
          similarity(name_normalized, ${namePart})
        ) >= 0.8`);
    for (const v of venueSites) {
      const site = ownSite(v.website_url);
      if (site) sites.add(site);
    }
  }
  const all = [
    ...(await db.execute<SourceRow>(sql`
      select id, url, enabled, robots_status::text as robots_status, health from sources
      where metro_id = ${metroId} or metro_id is null`)),
  ];
  // A platform's URL (an Eventbrite event) names no site; the source that linked it does.
  const linked = row.url
    ? new Set(
        [
          ...(await db.execute<{ source_id: string }>(
            sql`select distinct source_id from event_sources where event_url = ${row.url}`,
          )),
        ].map((r) => r.source_id),
      )
    : new Set<string>();
  const related = all.filter((s) => {
    const site = ownSite(s.url);
    return linked.has(s.id) || s.url === row.url || (site !== null && sites.has(site));
  });
  const until = addCalendarDays(night, 2);
  const from = addCalendarDays(night, -FETCHED_WITHIN_DAYS);
  const out: RelatedSource[] = [];
  for (const s of related.sort((a, b) => a.url.localeCompare(b.url))) {
    const fetched = [
      ...(await db.execute<{ fetched_at: string; http_status: number | null }>(sql`
        select fetched_at::text as fetched_at, http_status from raw_documents
        where source_id = ${s.id} and fetched_at >= ${from}::date and fetched_at < ${until}::date
        order by fetched_at desc limit 1`)),
    ][0];
    const text = [
      ...(await db.execute<{ cleaned_text: string }>(sql`
        select cleaned_text from raw_documents
        where source_id = ${s.id} and cleaned_text is not null
          and fetched_at >= ${from}::date and fetched_at < ${until}::date
        order by fetched_at desc limit 1`)),
    ][0];
    const failures = s.health?.consecutiveFailures ?? 0;
    out.push({
      url: s.url,
      enabled: s.enabled,
      robotsDisallowed: s.robots_status === "disallowed",
      failing: failures > 0 ? (s.health?.lastError ?? `${failures} failures in a row`) : null,
      fetchedAt:
        fetched && (fetched.http_status === null || fetched.http_status < 400)
          ? fetched.fetched_at.slice(0, 16)
          : null,
      textNamesTitle: text ? textNamesTitle(text.cleaned_text, row.title) : false,
    });
  }
  return out;
}

/** The listing a merged-away match went into, when it is up on the same night (D-227). */
async function mergedSurvivorOnNight(
  db: Db,
  metroId: string,
  row: RecallRow,
  night: IsoDate,
): Promise<{ survivorId: string; title: string; score: number } | null> {
  const merged = await listingsOn(db, metroId, row, [night], ["merged"]);
  const hit = bestMatch(row, merged.map(toListing));
  if (!hit) return null;
  const into = merged.find((m) => m.id === hit.listing.id)?.merged_into_id ?? null;
  if (!into) return null;
  const [survivor] = await listingsOn(
    db,
    metroId,
    row,
    [night],
    ["active", "cancelled"],
    sql`e.id = ${into}`,
  );
  return survivor ? { survivorId: survivor.id, title: survivor.title, score: hit.score } : null;
}

async function missEvidence(
  db: Db,
  metroId: string,
  row: RecallRow,
  night: IsoDate,
  sameNight: readonly RecallListing[],
): Promise<MissEvidence> {
  let mergedInto: MissEvidence["mergedInto"] = null;
  const merged = await listingsOn(db, metroId, row, [night], ["merged"]);
  const hit = bestMatch(row, merged.map(toListing));
  if (hit) {
    const into = merged.find((m) => m.id === hit.listing.id)?.merged_into_id ?? null;
    const survivor = into ? await listingById(db, row, into) : null;
    mergedInto = {
      mergedTitle: hit.listing.title,
      survivorTitle: survivor?.title ?? "a removed listing",
    };
  }
  let misplaced: MissEvidence["misplaced"] = null;
  const alike = sameNight
    .filter((l) => l.titleSimilarity >= MISPLACED_TITLE_SIMILARITY)
    .sort((a, b) => b.titleSimilarity - a.titleSimilarity)[0];
  if (alike)
    misplaced = {
      title: alike.title,
      night,
      why:
        row.start && alike.start && row.start !== alike.start
          ? `starts ${alike.start}, the list says ${row.start}`
          : "its place or links differ from the list's",
    };
  if (!misplaced) {
    const nearby = (
      await listingsOn(
        db,
        metroId,
        row,
        [addCalendarDays(night, -1), addCalendarDays(night, 1)],
        ["active", "cancelled"],
      )
    ).filter((l) => Number(l.title_sim) >= WRONG_NIGHT_TITLE_SIMILARITY)[0];
    if (nearby) misplaced = { title: nearby.title, night: nearby.night, why: "the wrong night" };
  }
  return { mergedInto, misplaced, sources: await relatedSources(db, metroId, row, night) };
}

export interface RecallOptions {
  /** Write an `eval_runs` row with the counts. */
  record?: boolean;
  reportPath?: string | null;
}

export async function evaluateRecall(
  db: Db,
  metroSlug: string,
  night: IsoDate,
  rows: readonly RecallRow[],
  problems: readonly string[],
  options: RecallOptions = {},
): Promise<RecallReport> {
  const metro = [
    ...(await db.execute<{ id: string }>(sql`select id from metros where slug = ${metroSlug}`)),
  ][0];
  if (!metro) throw new Error(`no metro "${metroSlug}"`);
  const results: RowResult[] = [];
  const directIds = new Set<string>();
  // First pass: direct matches
  for (const row of rows) {
    const listings = (await listingsOn(db, metro.id, row, [night], ["active", "cancelled"])).map(
      toListing,
    );
    const match = bestMatch(row, listings);
    if (match) {
      directIds.add(match.listing.id);
      results.push({
        row,
        family: rowFamily(row),
        found: { title: match.listing.title, score: match.score },
        miss: null,
      });
    } else {
      results.push({
        row,
        family: rowFamily(row),
        found: null,
        miss: null, // placeholder, will be filled in second pass
      });
    }
  }
  // Second pass: check merged survivors for unmatched rows
  for (let i = 0; i < rows.length; i++) {
    if (results[i]!.found) continue; // already matched
    const row = rows[i]!;
    const survivor = await mergedSurvivorOnNight(db, metro.id, row, night);
    if (survivor && !directIds.has(survivor.survivorId)) {
      results[i]!.found = { title: survivor.title, score: survivor.score };
      results[i]!.miss = null;
    } else {
      const listings = (await listingsOn(db, metro.id, row, [night], ["active", "cancelled"])).map(
        toListing,
      );
      results[i]!.miss = classifyMiss(await missEvidence(db, metro.id, row, night, listings));
    }
  }
  const report = buildRecallReport(metroSlug, night, results, problems);
  if (options.record)
    await db.insert(evalRuns).values({
      kind: "recall",
      metroId: metro.id,
      date: night,
      metrics: {
        recall: results.length ? report.found / results.length : 0,
        found: report.found,
        missed: report.missed,
        missesByCause: report.missesByCause,
      },
      reportPath: options.reportPath ?? null,
    });
  return report;
}
