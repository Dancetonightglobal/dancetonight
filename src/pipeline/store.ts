// The write path (PLAN 6.2, D-043): the only code that writes harvested facts to the database.
// Adapters never write; they return HarvestResults, and the ingest job passes normalised events
// here.
//
// Every row id is a UUID v5 of a natural key, so a re-run updates the rows it wrote before
// instead of adding copies (the seed uses the same scheme, under its own namespace):
// - event:            the source id plus the event's key (the source's own id, or night + start +
//                     title, or night + "untimed" + title when no time is listed)
// - event_source:     event id + source id + source URL
// - field_provenance: event id + field + source id
// - organizer:        metro id + normalised name
// - venue (listing):  normalised name + coordinates to 4 decimals (about 11 m)
//
// An event whose venue cannot be placed is still written, with no venue: it is kept and counted,
// never silently dropped, and listed on the site as "Location not listed" (D-082). So is an event
// whose time is not listed (D-060): its times are null and its night is the listed date.

import { insideMetro, METRO_BOUNDS } from "@/src/domain/metro-bounds";
import { cleanStrings } from "@/src/pipeline/text-clean";
import {
  and,
  eq,
  inArray,
  isNotNull,
  isNull,
  lt,
  notInArray,
  or,
  sql,
  type AnyColumn,
} from "drizzle-orm";
import { screenTitle, screenStoredRow, type VenueCalendarFlags } from "@/src/domain/listing-screen";
import { isClassLike } from "@/src/domain/class-like";

import { TRUST_ORDER } from "@/config/dedupe";
import { titleNamesOutsideTown } from "@/config/metro-regions";
import { ownSite } from "@/src/domain/dedupe";
import { matchStyles, normalizeForMatch } from "@/config/styles";
import type { Metro, Source, SourceCandidate } from "@/src/adapters/types";
import { haversineKm } from "@/src/data/listing-mapper";
import type { Db } from "@/src/db/client";
import {
  blocklist as blocklistTable,
  eventSources,
  events,
  fieldProvenance,
  metros,
  organizers,
  rawDocuments,
  sources,
  venues,
} from "@/src/db/schema";
import type { EventMusic } from "@/src/db/schema/events";
import type { Price } from "@/src/db/schema/series";
import type { SourceHealth } from "@/src/db/schema/sources";
import { uuidV5 } from "@/src/db/seed/ids";
import { rawListingSchema, type Point } from "@/src/domain/listing";
import {
  findPhrase,
  foldPage,
  contradictingDate,
  dateBesideTitle,
  listedOnlyUnderOtherDates,
  weekdaysNearTitle,
  weekdayCodeOf,
} from "@/src/domain/text-facts";
import { normalizePrices } from "@/src/domain/prices";
import { checkListingFacts, type FactChange } from "@/src/domain/stated-facts";
import { ownBlockTexts, ownPageTimes, pageWritesRowTimes } from "@/src/domain/stated-times";
import { titleBlocks } from "@/src/domain/title-blocks";
import { addCalendarDays } from "@/src/domain/time";
import { zoneForPoint } from "@/src/domain/zone";
import { buildBlocklist, type Blocklist } from "@/src/pipeline/blocklist";
import { siteHost } from "@/src/pipeline/discovery/hosts";
import { isPlaceholderAddress } from "@/src/pipeline/geocode";
import { slugFor } from "@/src/pipeline/slug";
import { venueByStreetNumber } from "@/src/pipeline/venue-address-match";
import {
  isUnkeyedUntimed,
  sentenceCase,
  untimedKey,
  type NormalizedEvent,
} from "@/src/pipeline/normalize";
import { isNoPlace } from "@/src/pipeline/source-venue";
import { noteOnce, type VenueReport } from "@/src/pipeline/venue-checks";
import { renameToCanonical } from "@/src/pipeline/venue-canonical";
import type { KnownVenue } from "@/config/known-venues";

/** The pipeline's id namespace; distinct from the seed's so the two can never collide. Never change it. */
export const PIPELINE_NAMESPACE = "0b7e3f52-1c9d-4a6e-8f20-6d5a4c3b2e19";

export function pipelineId(kind: string, key: string): string {
  return uuidV5(`${kind}:${key}`, PIPELINE_NAMESPACE);
}

const geographyPoint = (p: Point) =>
  sql`ST_SetSRID(ST_MakePoint(${p.lng}, ${p.lat}), 4326)::geography`;

/** How far apart two records of one venue may be, in metres (D-006 uses the same figure). */
export const VENUE_MATCH_METRES = 150;
/** Trigram similarity for a name match near a point, and for a name-only match in the metro. */
export const VENUE_NAME_NEAR = 0.45;
export const VENUE_NAME_ONLY = 0.8;

// ---------------------------------------------------------------------------------------------
// Metros, sources, blocklist

export async function loadMetro(db: Db, slug: string): Promise<Metro | null> {
  const rows = await db
    .select({
      id: metros.id,
      slug: metros.slug,
      name: metros.name,
      countryCode: metros.countryCode,
      lat: sql<number>`ST_Y(${metros.center}::geometry)`,
      lng: sql<number>`ST_X(${metros.center}::geometry)`,
      radiusKm: metros.radiusKm,
      tz: metros.tz,
      languages: metros.languages,
    })
    .from(metros)
    .where(eq(metros.slug, slug))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    countryCode: row.countryCode,
    center: { lat: Number(row.lat), lng: Number(row.lng) },
    radiusKm: row.radiusKm,
    tz: row.tz,
    languages: row.languages,
  };
}

export async function loadBlocklist(db: Db): Promise<Blocklist> {
  const rows = await db
    .select({ patternType: blocklistTable.patternType, value: blocklistTable.value })
    .from(blocklistTable);
  return buildBlocklist(rows);
}

function toSource(row: typeof sources.$inferSelect): Source {
  return {
    id: row.id,
    url: row.url,
    kind: row.kind,
    trustTier: row.trustTier,
    platform: row.platform,
    feedUrl: row.feedUrl,
    metroId: row.metroId,
    styles: row.styles,
    mixedCalendar: row.mixedCalendar,
    venueId: row.venueId,
    etag: row.etag,
    lastModified: row.lastModified,
    contentHash: row.contentHash,
  };
}

/** Enabled sources of a metro, oldest harvest first. */
export async function loadSources(
  db: Db,
  metroId: string,
  now: Date = new Date(),
): Promise<Source[]> {
  const rows = await db
    .select()
    .from(sources)
    .where(and(eq(sources.metroId, metroId), eq(sources.enabled, true)))
    // A source the last run deferred (stamped with that run's start) comes first: that run stamped
    // every due source it did not read so, and a source due since has a later stamp. Then the
    // rest by their next time (D-088; the ingest reads only the due ones), then one never read or
    // that failed (null, read as now). PLAN 6.7.
    // "Now" is the run's clock, not the database's, so a run on a fixed clock sorts as it would
    // have on that day.
    .orderBy(
      sql`coalesce(${sources.nextHarvestAt}, ${now.toISOString()}::timestamptz) asc`,
      sources.url,
    );
  return rows.map(toSource);
}

/** Adds a source, or refreshes what discovery knows about it. Keyed by URL. */
export async function upsertSource(
  db: Db,
  metroId: string,
  candidate: SourceCandidate & { styles?: string[]; language?: string; mixedCalendar?: boolean },
  options: { enable?: boolean } = {},
): Promise<Source> {
  // A seed that says platform "probed" pins the page to plain HTML read by the model,
  // undoing a wrong probe (a `?ical=1` link that serves HTML).
  const pinPlain = candidate.kind === "html" && candidate.platform === "probed";
  const [row] = await db
    .insert(sources)
    .values({
      id: pipelineId("source", candidate.url),
      url: candidate.url,
      kind: candidate.kind,
      platform: candidate.platform ?? null,
      feedUrl: candidate.feedUrl ?? null,
      metroId,
      styles: candidate.styles ?? [],
      language: candidate.language ?? null,
      trustTier: candidate.trustTier,
      discoveredBy: candidate.discoveredBy,
      mixedCalendar: candidate.mixedCalendar ?? false,
    })
    .onConflictDoUpdate({
      target: sources.url,
      set: {
        // The seed list and discovery say "html"; probing learns more (a feed, Squarespace) and
        // writes it directly. A later upsert must not reset that, or no feed is read after run one.
        // However, a seed with platform "probed" forces the page back to plain HTML.
        kind: pinPlain
          ? sql`'html'`
          : sql`case when excluded.kind = 'html' then ${sources.kind} else excluded.kind end`,
        platform: sql`coalesce(excluded.platform, ${sources.platform})`,
        feedUrl: pinPlain ? null : sql`coalesce(excluded.feed_url, ${sources.feedUrl})`,
        styles: sql`case when cardinality(excluded.styles) > 0 then excluded.styles else ${sources.styles} end`,
        trustTier: sql`excluded.trust_tier`,
        // Only a caller that says (a starting address) changes the flag; a link found on a page
        // leaves what is stored (D-121).
        ...(candidate.mixedCalendar === undefined
          ? {}
          : { mixedCalendar: candidate.mixedCalendar }),
        // A starting address takes over a row discovery stored at the same address.
        ...(options.enable ? { enabled: true, discoveredBy: sql`excluded.discovered_by` } : {}),
      },
    })
    .returning();
  if (!row) throw new Error(`source upsert returned nothing for ${candidate.url}`);
  return toSource(row);
}

/**
 * A starting page marked as a venue's own (`SeedSource.venuePage`) takes that venue (D-087), as
 * discovery's rows do (D-120): the one seeded venue in the metro whose listed website has the
 * page's host. Discovery skips hosts already on the starting list, so without this a venue's own
 * calendar never placed a listing at its venue (D-123). Two venues listing one website is not
 * guessed between; none leaves the page as it was; a page that already has a venue keeps it.
 *
 * Any other starting page loses a venue it was given, and so do its listings at that venue: the
 * first version matched every starting page, and an organiser's site whose name the map data also
 * lists (Brooklyn Contra's, as "Robert Wagner Park") would place nights that name no place there.
 * The same run's read places each listing again from the place it names. Discovery never writes a
 * starting page's venue, so every venue on one came from here. Returns one report line per page.
 */
export async function placeSeedSources(
  db: Db,
  metroId: string,
  seeds: readonly {
    url: string;
    venuePage?: boolean;
    venueAddress?: string | null;
    label?: string;
  }[],
): Promise<string[]> {
  if (seeds.length === 0) return [];
  const lines: string[] = [];
  const others = seeds.filter((seed) => !seed.venuePage).map((seed) => seed.url);
  const wronglyPlaced =
    others.length === 0
      ? []
      : await db
          .select({ id: sources.id, url: sources.url, venueId: sources.venueId })
          .from(sources)
          .where(
            and(
              eq(sources.metroId, metroId),
              inArray(sources.url, others),
              isNotNull(sources.venueId),
            ),
          );
  for (const row of wronglyPlaced) {
    const cleared = await db
      .update(events)
      .set({ venueId: null, geo: null, updatedAt: new Date() })
      .where(and(eq(events.venueId, row.venueId!), sql`${row.id}::uuid = any(${events.sourceIds})`))
      .returning({ id: events.id });
    await db.update(sources).set({ venueId: null }).where(eq(sources.id, row.id));
    lines.push(
      `${row.url} is not a venue's own page: its venue taken off, with ${cleared.length} of its listings there, to be placed again from the place each names`,
    );
  }

  const venuePages = seeds.filter((seed) => seed.venuePage).map((seed) => seed.url);
  if (venuePages.length === 0) return lines;
  // D-808: a host whose venue pages carry two labels is a ticket site for several clubs (mandalatickets.com:
  // Rakata, La Vaquita, Bonbonniere...), never one venue's own site; a venue it gave them by website goes again.
  const labelsOfHost = new Map<string, Set<string>>();
  for (const seed of seeds.filter((s) => s.venuePage)) {
    const host = siteHost(seed.url);
    if (host)
      labelsOfHost.set(host, (labelsOfHost.get(host) ?? new Set()).add(seed.label ?? seed.url));
  }
  const shared = (url: string) => (labelsOfHost.get(siteHost(url) ?? "")?.size ?? 0) > 1;
  const sharedPages = venuePages.filter(shared);
  if (sharedPages.length > 0) {
    const placedByHost = await db
      .select({
        id: sources.id,
        url: sources.url,
        venueId: sources.venueId,
        site: venues.websiteUrl,
      })
      .from(sources)
      .innerJoin(venues, eq(venues.id, sources.venueId))
      .where(and(eq(sources.metroId, metroId), inArray(sources.url, sharedPages)));
    for (const row of placedByHost.filter((r) => r.site && siteHost(r.site) === siteHost(r.url))) {
      await db
        .update(events)
        .set({ venueId: null, geo: null, updatedAt: new Date() })
        .where(
          and(eq(events.venueId, row.venueId!), sql`${row.id}::uuid = any(${events.sourceIds})`),
        );
      await db.update(sources).set({ venueId: null }).where(eq(sources.id, row.id));
      lines.push(
        `${row.url}: a ticket site for several venues, not its venue's own site; venue taken off`,
      );
    }
  }
  const unplaced = await db
    .select({ id: sources.id, url: sources.url })
    .from(sources)
    .where(
      and(eq(sources.metroId, metroId), inArray(sources.url, venuePages), isNull(sources.venueId)),
    );
  if (unplaced.length === 0) return lines;
  const sites = await db
    .select({ id: venues.id, name: venues.name, websiteUrl: venues.websiteUrl })
    .from(venues)
    .where(
      and(eq(venues.metroId, metroId), isNotNull(venues.websiteUrl), eq(venues.blocklisted, false)),
    );
  const byHost = new Map<string, { id: string; name: string }[]>();
  for (const site of sites) {
    const host = siteHost(site.websiteUrl!);
    if (host) byHost.set(host, [...(byHost.get(host) ?? []), { id: site.id, name: site.name }]);
  }
  for (const row of unplaced) {
    if (shared(row.url)) continue; // D-808: placed from its seed's address or the place each listing names
    const host = siteHost(row.url);
    const venuesOfHost = host ? (byHost.get(host) ?? []) : [];
    if (venuesOfHost.length === 1) {
      const venue = venuesOfHost[0]!;
      await db.update(sources).set({ venueId: venue.id }).where(eq(sources.id, row.id));
      lines.push(`${row.url} is ${venue.name}'s own site: placed at it`);
    } else if (venuesOfHost.length > 1) {
      lines.push(
        `${row.url}: ${venuesOfHost.length} venues list this website (${venuesOfHost.map((v) => v.name).join(", ")}); left unplaced`,
      );
    } else {
      // A page whose seed gives its own address is placed from it: nothing to report (D-273).
      const seed = seeds.find((s) => s.url === row.url);
      if (!seed?.venueAddress) {
        lines.push(`${row.url}: no seeded venue lists this website; left unplaced`);
      }
    }
  }
  return lines;
}

export interface FetchRecord {
  etag: string | null;
  lastModified: string | null;
  contentHash: string | null;
  doc?: {
    url: string;
    fetchedAt: Date;
    httpStatus: number;
    cleanedText: string | null;
    method: string;
  };
}

/** Stores the validators for the next conditional GET and, when content changed, the document. */
export async function recordFetch(
  db: Db,
  sourceId: string,
  record: FetchRecord,
): Promise<string | null> {
  await db
    .update(sources)
    .set({
      etag: record.etag,
      lastModified: record.lastModified,
      contentHash: record.contentHash,
    })
    .where(eq(sources.id, sourceId));
  if (!record.doc || !record.contentHash) return null;
  const id = pipelineId("raw_document", `${sourceId}:${record.contentHash}`);
  await db
    .insert(rawDocuments)
    .values({
      id,
      sourceId,
      url: record.doc.url,
      fetchedAt: record.doc.fetchedAt,
      httpStatus: record.doc.httpStatus,
      etag: record.etag,
      contentHash: record.contentHash,
      cleanedText: record.doc.cleanedText,
      extractionMethod: record.doc.method,
    })
    .onConflictDoUpdate({
      target: rawDocuments.id,
      // A page fetched again in full after its text was pruned stores that text again.
      set: {
        fetchedAt: record.doc.fetchedAt,
        cleanedText: sql`coalesce(${rawDocuments.cleanedText}, excluded.cleaned_text)`,
      },
    });
  return id;
}

/**
 * The cleaned text stored for a source's page with this content hash, or null once it has been
 * pruned (D-043). An unchanged page (a 304) is read from the extraction cache; its text is what the
 * read's dates are checked against (D-070).
 */
export async function storedPageText(
  db: Db,
  sourceId: string,
  contentHash: string,
): Promise<string | null> {
  const [row] = await db
    .select({ text: rawDocuments.cleanedText })
    .from(rawDocuments)
    .where(and(eq(rawDocuments.sourceId, sourceId), eq(rawDocuments.contentHash, contentHash)))
    .limit(1);
  return row?.text ?? null;
}

/** Nulls page bodies older than the retention window (D-043: 3 days); hashes stay. */
export async function pruneRawDocuments(db: Db, now: Date, keepDays = 3): Promise<number> {
  const cutoff = new Date(now.getTime() - keepDays * 86_400_000);
  const rows = await db
    .update(rawDocuments)
    .set({ cleanedText: null })
    .where(and(lt(rawDocuments.fetchedAt, cutoff), sql`${rawDocuments.cleanedText} is not null`))
    .returning({ id: rawDocuments.id });
  return rows.length;
}

export type HarvestStatus = "ok" | "unchanged" | "failed" | "skipped";

/**
 * Rolls a source's health forward after one harvest attempt and returns what it wrote, so the
 * run's report reads the streak from the one read made here (audit of 2026-09-29, TWIS F1).
 */
export async function recordHealth(
  db: Db,
  sourceId: string,
  status: HarvestStatus,
  at: Date,
  error: string | null,
  nextHarvestAt: Date | null,
): Promise<SourceHealth> {
  const [row] = await db
    .select({ health: sources.health })
    .from(sources)
    .where(eq(sources.id, sourceId));
  const previous: SourceHealth = row?.health ?? {};
  const failed = status === "failed";
  const streak = previous.consecutiveFailures ?? 0;
  // Other writers keep their own keys here (discovery's record, D-120): only the run's own change.
  const health: SourceHealth = {
    ...previous,
    lastSuccessAt: failed ? (previous.lastSuccessAt ?? null) : at.toISOString(),
    lastError: failed ? error : null,
    consecutiveFailures: failed ? streak + 1 : 0,
    // A streak's first failure starts it; a later one keeps its start; anything else ends it.
    failingSince: failed ? (streak > 0 ? (previous.failingSince ?? null) : at.toISOString()) : null,
    errorRate7d: previous.errorRate7d ?? null,
  };
  await db.update(sources).set({ health, nextHarvestAt }).where(eq(sources.id, sourceId));
  return health;
}

/**
 * The metro's enabled sources that are not due in a run starting at `at` (D-088): their next
 * harvest is later. Every other source is due, including one added during the run.
 */
export async function notDueSourceIds(db: Db, metroId: string, at: Date): Promise<Set<string>> {
  const rows = await db
    .select({ id: sources.id })
    .from(sources)
    .where(
      and(
        eq(sources.metroId, metroId),
        eq(sources.enabled, true),
        sql`${sources.nextHarvestAt} > ${at.toISOString()}::timestamptz`,
      ),
    );
  return new Set(rows.map((r) => r.id));
}

/** How many of the metro's enabled sources, other than `skipKinds`, are due at `at` (D-088). */
export async function countDue(
  db: Db,
  metroId: string,
  at: Date,
  skipKinds: readonly string[],
): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(sources)
    .where(
      and(
        eq(sources.metroId, metroId),
        eq(sources.enabled, true),
        sql`(${sources.nextHarvestAt} is null or ${sources.nextHarvestAt} <= ${at.toISOString()}::timestamptz)`,
        skipKinds.length > 0
          ? sql`${sources.kind}::text not in (${sql.join(
              skipKinds.map((k) => sql`${k}`),
              sql`, `,
            )})`
          : undefined,
      ),
    );
  return row?.n ?? 0;
}

/**
 * A due source the run had no time left for (D-088): stamped with the run's start, so it is due
 * in the next run and sorts first in it (`loadSources`). Its health is not touched: it was not read.
 */
export async function deferHarvest(db: Db, sourceId: string, runStart: Date): Promise<void> {
  await db.update(sources).set({ nextHarvestAt: runStart }).where(eq(sources.id, sourceId));
}

/**
 * What a source has on the site for the window: its listed rows from `from` to `to`, how many
 * no other source lists, the last night among them, and when it last confirmed any of them. For
 * the report of a failing source; it reads, and changes nothing. Only `metroId`'s rows count: a
 * platform source (ticketmaster.com) is one row shared by every metro (D-850).
 */
export async function storedBySource(
  db: Db,
  sourceId: string,
  metroId: string,
  from: string,
  to: string,
): Promise<{ listed: number; alone: number; lastNight: string | null; lastSeenAt: Date | null }> {
  const [row] = await db
    .select({
      listed: sql<number>`count(distinct ${events.id})::int`,
      alone: sql<number>`count(distinct ${events.id}) filter (where cardinality(${events.sourceIds}) = 1)::int`,
      lastNight: sql<string | null>`max(${events.nightDate})::text`,
      lastSeenAt: sql<string | null>`max(${eventSources.lastSeenAt})::text`,
    })
    .from(events)
    .innerJoin(eventSources, eq(eventSources.eventId, events.id))
    .where(
      and(
        eq(eventSources.sourceId, sourceId),
        eq(events.metroId, metroId),
        sql`${events.nightDate} >= ${from} and ${events.nightDate} <= ${to}`,
        sql`${events.status} in ('active', 'cancelled')`,
      ),
    );
  return {
    listed: row?.listed ?? 0,
    alone: row?.alone ?? 0,
    lastNight: row?.lastNight ?? null,
    lastSeenAt: row?.lastSeenAt ? new Date(row.lastSeenAt) : null,
  };
}

// ---------------------------------------------------------------------------------------------
// Venues and organizers

export interface VenueInput {
  name: string | null;
  address: string | null;
  url: string | null;
  location: Point | null;
}

export interface ResolvedVenue {
  venueId: string;
  location: Point;
  created: boolean;
  /** `same_id`: the venue this listing created at this point before, wherever it stands now. */
  method:
    | "near_name"
    | "near_only"
    | "name_only"
    | "address_match"
    | "created"
    | "same_id"
    | "source_venue";
}

/** What `resolveVenue` checks beyond matching, and where it says what it found (D-071). */
export interface VenueChecks {
  /**
   * The listing's point came from a ticketing API (Ticketmaster, Eventbrite; `checksApiPoint`):
   * it is checked against its street address geocoded to a building (`building`), and the
   * building's point is used when they are more than 150 m apart.
   */
  checkPoint?: boolean;
  /**
   * The address's point when the geocoder answers with a building, else null. Absent when the run
   * has no geocoder: the point is then not checked, and the report says so.
   */
  building?: (address: string) => Promise<Point | null>;
  report?: VenueReport;
  /**
   * The metro's known venues: a stored venue a listing matches by name, still named by one of a
   * canonical entry's other names, takes the entry's first name (D-265 follow-up, Spades).
   */
  known?: readonly KnownVenue[];
}

/**
 * Whether a source's venue points are checked against their addresses (D-071): a ticketing API's
 * (Ticketmaster, Eventbrite), which put Terminal 5 800 m from its door. A feed's own point
 * (Squarespace's marker, The Events Calendar's venue) is the organiser's pin and stands, even
 * though those feeds are read as APIs too.
 */
export function checksApiPoint(source: Pick<Source, "kind">): boolean {
  return source.kind === "ticketing_api";
}

/** The id of the venue a listing creates: its normalised name and its point to 4 decimals. */
function listingVenueId(nameNormalized: string, at: Point): string {
  return pipelineId("venue", `${nameNormalized}@${at.lat.toFixed(4)},${at.lng.toFixed(4)}`);
}

type CheckedVenue = {
  name: string | null;
  nameNormalized: string | null;
  address: string;
  given: Point;
};

const pointColumns = {
  lat: sql<number>`ST_Y(${venues.location}::geometry)`,
  lng: sql<number>`ST_X(${venues.location}::geometry)`,
};

/**
 * Where the venue a listing with this name and street address already stands, when one is stored:
 * a venue an earlier check placed at its building (created there, or moved), found by name and
 * address, or the venue the listing created at this very point (its id).
 */
async function storedListingVenue(
  db: Db,
  metro: Metro,
  venue: CheckedVenue,
): Promise<Point | null> {
  if (!venue.nameNormalized) return null;
  const [row] = await db
    .select(pointColumns)
    .from(venues)
    .where(
      and(
        eq(venues.metroId, metro.id),
        eq(venues.seedProvider, "listing"),
        eq(venues.blocklisted, false),
        eq(venues.nameNormalized, venue.nameNormalized),
        or(
          sql`${venues.address}->>'formatted' = ${venue.address}`,
          eq(venues.id, listingVenueId(venue.nameNormalized, venue.given)),
        ),
      ),
    )
    // A venue an earlier check moved to its building before one still at the API's point.
    .orderBy(sql`ST_Distance(${venues.location}, ${geographyPoint(venue.given)}) desc`, venues.id)
    .limit(1);
  return row ? { lat: Number(row.lat), lng: Number(row.lng) } : null;
}

/**
 * An API's point, checked against its street address geocoded to a building (D-071): when they
 * are more than 150 m apart the building's point is used, and the venue a listing created at the
 * API's point moves there. Its Google place ID was looked up in the wrong box, so it is cleared
 * and asked again; its listings' points follow it. Any answer but a building (an amenity's or a
 * park's centroid, a street) moves nothing.
 *
 * With no building-level answer (no geocoder in the run, an outage, a quota, an address placed no
 * better than a street), the point is not checked, and the report says so. A venue already stored
 * for this name and address keeps its stored point, so a run whose check has no answer neither
 * adds a second venue at the API's point nor pins its listings there (review, 2026-09-28); with
 * none, the API's point is used.
 */
async function checkedPoint(
  db: Db,
  metro: Metro,
  venue: CheckedVenue,
  building: ((address: string) => Promise<Point | null>) | undefined,
  report: VenueReport | undefined,
): Promise<Point> {
  const geocoded = building ? await building(venue.address) : null;
  if (!geocoded) {
    const stored = await storedListingVenue(db, metro, venue);
    noteOnce(
      report?.unchecked,
      `${venue.name ?? "A venue with no name"}: ${building ? "no building-level answer" : "no geocoder in this run"} for ${venue.address}; ${stored ? "the venue already stored for it is used" : "the listed point is used"}`,
    );
    return stored ?? venue.given;
  }
  const metres = Math.round(haversineKm(venue.given, geocoded) * 1000);
  if (metres <= VENUE_MATCH_METRES) return venue.given;
  let moved = false;
  if (venue.nameNormalized) {
    const id = listingVenueId(venue.nameNormalized, venue.given);
    const rows = await db
      .update(venues)
      .set({
        location: geocoded,
        tz: zoneForPoint(geocoded.lat, geocoded.lng) ?? metro.tz,
        googlePlaceId: null,
        googlePlaceCheckedAt: null,
        googlePlaceNameCheckedAt: null,
      })
      .where(
        and(
          eq(venues.id, id),
          eq(venues.seedProvider, "listing"),
          // Still where the listing put it: a venue already moved is not moved, or reset, again.
          sql`ST_DWithin(${venues.location}, ${geographyPoint(venue.given)}, 20)`,
        ),
      )
      .returning({ id: venues.id });
    if (rows.length > 0) {
      moved = true;
      await db.update(events).set({ geo: geocoded }).where(eq(events.venueId, id));
    }
  }
  noteOnce(
    report?.moved,
    `${venue.name ?? "A venue with no name"}: the listed point is ${metres} m from ${venue.address}; the address's point is used${moved ? ", and the stored venue moved there" : ""}`,
  );
  return geocoded;
}

/**
 * Finds the venue a listing names, or creates one from the listing when it has a point: its own,
 * or its address geocoded. With a point: the closest venue within 150 m whose name is similar
 * enough (or, when the listing names no venue, the closest within 150 m). Without a point: a
 * strong name match inside the metro. A venue is created under the name the listing gives, or
 * under its address when it names none (D-082). Anything else returns null and the event is
 * written unplaced.
 *
 * A placeholder address ("123 Main St") counts as no address: it is never geocoded, stored or
 * searched (D-071). With `checks.checkPoint`, the listing's point is checked against its
 * address geocoded to a building first (`checkedPoint`).
 */
export async function resolveVenue(
  db: Db,
  metro: Metro,
  input: VenueInput,
  geocode?: (address: string) => Promise<Point | null>,
  checks: VenueChecks = {},
): Promise<ResolvedVenue | null> {
  // A place named only by the metro ("London" on Ridley Road Market Bar's pages) names no venue:
  // it is placed by its address, never matched by that name (D-595).
  if (input.name && normalizeForMatch(input.name) === normalizeForMatch(metro.name)) {
    input = { ...input, name: null };
  }
  const nameNormalized = input.name ? normalizeForMatch(input.name) : null;
  const placeholder = input.address !== null && isPlaceholderAddress(input.address);
  const address = placeholder ? null : input.address;
  if (placeholder) {
    noteOnce(
      checks.report?.placeholders,
      `${input.name ?? "A venue with no name"}: "${input.address}" is a placeholder address; not geocoded`,
    );
  }
  let location = input.location;
  if (location && address && checks.checkPoint) {
    location = await checkedPoint(
      db,
      metro,
      { name: input.name, nameNormalized, address, given: location },
      checks.building,
      checks.report,
    );
  }

  if (location) {
    const near = await db
      .select({
        id: venues.id,
        lat: sql<number>`ST_Y(${venues.location}::geometry)`,
        lng: sql<number>`ST_X(${venues.location}::geometry)`,
        similarity: nameNormalized
          ? sql<number>`similarity(${venues.nameNormalized}, ${nameNormalized})`
          : sql<number>`0`,
        distance: sql<number>`ST_Distance(${venues.location}, ${geographyPoint(location)})`,
      })
      .from(venues)
      .where(
        and(
          eq(venues.blocklisted, false),
          sql`ST_DWithin(${venues.location}, ${geographyPoint(location)}, ${VENUE_MATCH_METRES})`,
        ),
      )
      .orderBy(sql`4 desc, 5 asc`)
      .limit(5);
    const best = nameNormalized
      ? near.find((v) => Number(v.similarity) >= VENUE_NAME_NEAR)
      : near.slice().sort((a, b) => Number(a.distance) - Number(b.distance))[0];
    if (best) {
      if (nameNormalized)
        await renameToCanonical(db, best.id, input.name, checks.known, checks.report);
      return {
        venueId: best.id,
        location: { lat: Number(best.lat), lng: Number(best.lng) },
        created: false,
        method: nameNormalized ? "near_name" : "near_only",
      };
    }
  } else if (nameNormalized) {
    const [match] = await db
      .select({
        id: venues.id,
        lat: sql<number>`ST_Y(${venues.location}::geometry)`,
        lng: sql<number>`ST_X(${venues.location}::geometry)`,
        similarity: sql<number>`similarity(${venues.nameNormalized}, ${nameNormalized})`,
      })
      .from(venues)
      .where(
        and(
          eq(venues.blocklisted, false),
          // `%` lets the trigram index narrow the venues first (its threshold, 0.3 by default, is
          // below VENUE_NAME_ONLY, so the rows kept are the same).
          sql`${venues.nameNormalized} % ${nameNormalized}`,
          sql`similarity(${venues.nameNormalized}, ${nameNormalized}) >= ${VENUE_NAME_ONLY}`,
          sql`ST_DWithin(${venues.location}, ${geographyPoint(metro.center)}, ${metro.radiusKm * 1000})`,
        ),
      )
      .orderBy(sql`4 desc`)
      .limit(1);
    if (match) {
      await renameToCanonical(db, match.id, input.name, checks.known, checks.report);
      return {
        venueId: match.id,
        location: { lat: Number(match.lat), lng: Number(match.lng) },
        created: false,
        method: "name_only",
      };
    }
    if (address && geocode) location = await geocode(address);
  } else if (address) {
    // No name and no point: the one named venue stored at the same street and number, by text
    // only, never by distance (D-082 stands; Busca Dança's address-only rows, Rio 2026-11-01).
    const report = checks.report;
    const sameDoor = await venueByStreetNumber(db, metro, address, () => {
      if (report) noteOnce((report.sameDoorCapped ??= []), address);
    });
    if (sameDoor) {
      if (report) noteOnce((report.sameDoor ??= []), `${address}: placed at ${sameDoor.name}`);
      return {
        venueId: sameDoor.id,
        location: sameDoor.location,
        created: false,
        method: "address_match",
      };
    }
    if (geocode) location = await geocode(address);
  }

  // A listing that names no venue, only an address, is placed under the address as its source
  // wrote it (D-082): at the source's own point when it gave one and no stored venue stands within
  // 150 m of it (the `near_only` match above), else where the geocoder placed the address. The
  // venue is known by its door, and no name is invented. An address the geocoder placed is never
  // snapped to a stored venue nearby, which in a dense street can be the next building (review of
  // the run 30 fix, 2026-09-29); and a feed's own point is never moved to its geocoded address
  // (D-071).
  const venueName = input.name ?? address;
  const venueKey = venueName === null ? null : (nameNormalized ?? normalizeForMatch(venueName));
  if (!location || venueName === null || !venueKey) return null;
  const tz = zoneForPoint(location.lat, location.lng) ?? metro.tz;
  const id = listingVenueId(venueKey, location);
  const inserted = await db
    .insert(venues)
    .values({
      id,
      name: venueName,
      nameNormalized: venueKey,
      location: location,
      address: address ? { formatted: address } : null,
      tz,
      seedProvider: "listing",
      websiteUrl: input.url,
      metroId: metro.id,
    })
    .onConflictDoNothing({ target: venues.id })
    .returning({ id: venues.id });
  if (inserted.length === 0) {
    // This listing created the venue here before, and a check has since moved it: its listings
    // take the point it is stored at, not the one it left.
    const [row] = await db.select(pointColumns).from(venues).where(eq(venues.id, id));
    if (row) {
      return {
        venueId: id,
        location: { lat: Number(row.lat), lng: Number(row.lng) },
        created: false,
        method: "same_id",
      };
    }
  }
  return { venueId: id, location, created: true, method: "created" };
}

export async function resolveOrganizer(
  db: Db,
  metro: Metro,
  organizer: { name: string | null; url: string | null },
): Promise<string | null> {
  if (!organizer.name) return null;
  const nameNormalized = normalizeForMatch(organizer.name);
  if (!nameNormalized) return null;
  const id = pipelineId("organizer", `${metro.id}:${nameNormalized}`);
  await db
    .insert(organizers)
    .values({
      id,
      name: organizer.name,
      nameNormalized,
      websiteUrl: organizer.url,
      metroId: metro.id,
    })
    .onConflictDoUpdate({
      target: organizers.id,
      set: { websiteUrl: sql`coalesce(${organizers.websiteUrl}, excluded.website_url)` },
    });
  // An organiser's own site replaces a platform page stored for it before (an Eventbrite page,
  // lane 1, D-090); one own site never replaces another.
  if (organizer.url && ownSite(organizer.url)) {
    const [stored] = await db
      .select({ websiteUrl: organizers.websiteUrl })
      .from(organizers)
      .where(eq(organizers.id, id));
    if (stored?.websiteUrl && !ownSite(stored.websiteUrl)) {
      await db.update(organizers).set({ websiteUrl: organizer.url }).where(eq(organizers.id, id));
    }
  }
  return id;
}

// ---------------------------------------------------------------------------------------------
// Events

// Slugs: src/pipeline/slug.ts (D-568 spells non-Latin titles in ASCII).
export { slugFor };

/** The facts written to field_provenance for one event, with the field names the UI reads. */
export function provenanceFields(
  event: NormalizedEvent,
): Array<{ field: string; value: unknown; evidenceKey: string }> {
  const fields: Array<{ field: string; value: unknown; evidenceKey: string }> = [];
  const add = (field: string, value: unknown, evidenceKey = field) => {
    if (value === null || value === undefined) return;
    if (Array.isArray(value) && value.length === 0) return;
    fields.push({ field, value, evidenceKey });
  };
  add("title", event.title);
  add("listing_type", event.listingType);
  add("styles", event.styles);
  // Every event has a night; for one whose time is not listed it is the only date fact (D-060).
  add("night_date", event.nightDate, "local_date");
  add("doors_at", event.doorsAt?.toISOString(), "doors_time");
  add("lesson_at", event.lessonAt?.toISOString(), "lesson_time");
  add("dancing_at", event.dancingAt?.toISOString(), "dancing_time");
  add("ends_at", event.endsAt?.toISOString(), "end_time");
  add("prices", event.prices);
  add("is_free", event.isFree);
  add("ticket_url", event.ticketUrl);
  add("level", event.level);
  add("partner_required", event.partnerRequired);
  add("age_min", event.ageMin);
  add("dress_code", event.dressCode);
  add("floor", event.floor);
  add("indoor_outdoor", event.indoorOutdoor);
  add("music", event.music);
  add("crowd_size_hint", event.crowdSizeHint);
  add("venue_name", event.venue.name, "venue");
  add("venue_address", event.venue.address, "venue");
  add("organizer_name", event.organizer.name, "organizer");
  add("cancelled", event.cancelled ? true : null);
  return fields;
}

export interface WriteResult {
  written: number;
  unplaced: number;
  blocked: number;
  /** Written with no listed time (D-060), and of those, how many are on a placed venue. */
  untimed: number;
  untimedPlaced: number;
  /** Untimed rows of this source retired because it now lists the same night with a time. */
  superseded: number;
  eventIds: string[];
  /**
   * Rows this run's listings still stand for without writing them: the timed row an untimed
   * listing of the same night and title gave way to. Never retired as unlisted (D-070).
   */
  keptIds: string[];
  /** Of `keptIds`, those kept for a read that gave no time: no check of the page vouched for them. */
  keptUncheckedIds: string[];
  notes: string[];
}

/** The event columns that hold a listed time; their provenance rows carry these names. */
export const TIME_FIELDS = ["doors_at", "lesson_at", "dancing_at", "ends_at"] as const;

/**
 * Provenance fields whose column a re-harvest sets from the source whatever it says, so a fact the
 * source no longer gives is gone from the row and its provenance stops being current. The venue
 * and the organiser are not among them: the row keeps a known one when a re-harvest names none.
 */
export const FOLLOWING_FIELDS: readonly string[] = [
  ...TIME_FIELDS,
  "styles",
  "prices",
  "is_free",
  "ticket_url",
  "level",
  "partner_required",
  "age_min",
  "dress_code",
  "floor",
  "indoor_outdoor",
  "music",
  "crowd_size_hint",
  "cancelled",
];

/** A database handle or an open transaction on one. */
export type DbOrTx = Pick<Db, "select" | "insert" | "update" | "execute">;

/** The source that wrote a row, as its primary link says. */
const writtenBy = (sourceId: string) =>
  sql`exists (select 1 from ${eventSources} es where es.event_id = ${events.id} and es.source_id = ${sourceId} and es.role = 'primary')`;

/**
 * A row this source's model read stored before D-060 with an invented midnight (see
 * `retireInventedMidnights`): from a rule (never verified by a dated listing), no doors or lesson
 * time, dancing at exactly 00:00 local on the calendar day after its night, and that dancing time
 * came from the model with no quote: the removed fallback wrote "00:00" and never had one, while a
 * page that states midnight gives its words (review, 2026-09-28). Its midnight is not a listed time.
 */
const inventedMidnight = (sourceId: string) => sql`(
  ${events.doorsAt} is null and ${events.lessonAt} is null and ${events.dancingAt} is not null
  and (${events.dancingAt} at time zone ${events.tz})::time = time '00:00'
  and (${events.dancingAt} at time zone ${events.tz})::date = ${events.nightDate} + 1
  and ${events.lastVerifiedAt} is null
  and exists (select 1 from ${fieldProvenance} fp
    where fp.entity_type = 'event' and fp.entity_id = ${events.id} and fp.field = 'dancing_at'
      and fp.source_id = ${sourceId} and fp.method = 'llm' and fp.evidence is null)
)`;

/** The venue a venue's own calendar belongs to (D-123), or null when it is gone or blocklisted. */
async function sourceVenue(
  db: Db,
  venueId: string,
): Promise<{ venue: ResolvedVenue; nameNormalized: string } | null> {
  const [row] = await db
    .select({
      nameNormalized: venues.nameNormalized,
      lat: sql<number>`ST_Y(${venues.location}::geometry)`,
      lng: sql<number>`ST_X(${venues.location}::geometry)`,
    })
    .from(venues)
    .where(and(eq(venues.id, venueId), eq(venues.blocklisted, false)));
  if (!row) return null;
  return {
    venue: {
      venueId,
      location: { lat: Number(row.lat), lng: Number(row.lng) },
      created: false,
      method: "source_venue",
    },
    nameNormalized: row.nameNormalized,
  };
}

/**
 * Whether a listing on a venue's own calendar is at that venue (D-123): it names no place at all,
 * or names the venue itself. A listing that names somewhere else is placed as any other is.
 */
export function atSourceVenue(input: VenueInput, own: { nameNormalized: string }): boolean {
  if (input.name === null) return input.address === null && input.location === null;
  // "The Copacabana" on the feed is the Copacabana of the seed.
  const bare = (name: string) => name.replace(/^the /, "");
  return bare(normalizeForMatch(input.name)) === bare(own.nameNormalized);
}

/**
 * Writes one source's normalised events. `placeVenue` resolves each event's venue (usually
 * `resolveVenue` bound to the metro and the geocoder); it is a parameter so the ingest job can
 * cache answers across a run.
 */
export async function writeEvents(
  db: Db,
  args: {
    metro: Metro;
    source: Source;
    events: NormalizedEvent[];
    blocklist: Blocklist;
    /** `apiPoint`: the source is a ticketing API, whose points are checked (D-071). */
    placeVenue: (input: VenueInput, apiPoint?: boolean) => Promise<ResolvedVenue | null>;
    rawDocumentId?: string | null;
    /**
     * The read could not be checked against its page (its text was pruned, D-073): a source row
     * already stored keeps its event page instead of taking a link nobody checked. A new row
     * still takes the one it came with.
     */
    keepEventUrls?: boolean;
  },
): Promise<WriteResult> {
  const { metro, source, blocklist } = args;
  const result: WriteResult = {
    written: 0,
    unplaced: 0,
    blocked: 0,
    untimed: 0,
    untimedPlaced: 0,
    superseded: 0,
    eventIds: [],
    keptIds: [],
    keptUncheckedIds: [],
    notes: [],
  };
  const untimedIds: string[] = [];
  const own = source.venueId ? await sourceVenue(db, source.venueId) : null;

  for (const event of args.events) {
    if (
      (event.organizer.name && blocklist.hasOrganizer(normalizeForMatch(event.organizer.name))) ||
      (event.venue.name && blocklist.hasVenue(normalizeForMatch(event.venue.name))) ||
      blocklist.matchUrl(event.provenance.sourceUrl) ||
      (event.ticketUrl && blocklist.matchUrl(event.ticketUrl)) ||
      (event.canonicalUrl && blocklist.matchUrl(event.canonicalUrl))
    ) {
      result.blocked += 1;
      result.notes.push(`on the blocklist: ${event.title}`);
      continue;
    }

    const id = pipelineId("event", `${source.id}:${event.key}`);
    // This source's untimed listing of the night: a timed row retired into it (below) comes back
    // when a later read lists that time again.
    const untimedId = pipelineId(
      "event",
      `${source.id}:${untimedKey(event.nightDate, event.titleNormalized)}`,
    );
    // The mirror of the rule below: a night this source already lists with a time is not listed
    // again without one (a model read can drop a time one run and state it the next). Unless the
    // read's times were withdrawn against the page (D-081): the page's own words no longer give
    // that time, so the untimed listing is written and replaces the timed rows, on any read,
    // whole or partial (`retireTimedInto`). A timed row whose every time the listing's own part of
    // the page writes is the page's, though, and stays: the read's time was wrong, not the row's
    // (seam review, 2026-09-29). The untimed listing is then not written, and the night's other
    // timed rows are retired as unlisted. Not for a cancellation, which is always written.
    // An untimed listing with an id of its own counts too when its own page is the timed row's page
    // (Mumbai allevents pool party, 2026-11-05): the mirror of `retireUntimedSiblings`.
    const timed = isUnkeyedUntimed(event)
      ? await timedSiblingsOf(db, metro, source, event, id)
      : event.startsAt === null && event.eventUrl
        ? await timedSiblingsOf(db, metro, source, event, id, event.eventUrl)
        : [];
    const siblings = timed.map((s) => s.id);
    const withdrawn = event.timesWithdrawn;
    const onPage = withdrawn
      ? timed.filter((s) =>
          pageWritesRowTimes(s, { starts: withdrawn.pageStarts, ends: withdrawn.pageEnds }),
        )
      : [];
    if (siblings.length > 0 && (!withdrawn || (onPage.length > 0 && !event.cancelled))) {
      const kept = withdrawn ? onPage.map((s) => s.id) : [siblings[0]!];
      result.keptIds.push(...kept);
      if (!withdrawn) result.keptUncheckedIds.push(...kept);
      result.notes.push(
        `${event.title}: listed on ${event.nightDate} with no time, and this source already lists that night with one; kept the one with the time`,
      );
      const stale = siblings.filter((s) => !kept.includes(s));
      if (withdrawn && stale.length > 0) {
        for (const s of stale) {
          await retireRow(db, source, s, [...result.eventIds, ...result.keptIds]);
        }
        result.notes.push(
          `${event.title}: ${stale.length} listing(s) on ${event.nightDate} at a time the page does not write were retired`,
        );
      }
      continue;
    }

    const venue =
      own && atSourceVenue(event.venue, own)
        ? own.venue
        : await args.placeVenue(event.venue, checksApiPoint(source));
    const organizerId = await resolveOrganizer(db, metro, event.organizer);
    if (!venue) {
      result.unplaced += 1;
      result.notes.push(
        `venue not placed: ${event.title} (${event.venue.name ?? "no venue named"})`,
      );
    }

    const fetchedAt = event.provenance.fetchedAt;
    const row = {
      id,
      slug: slugFor(event.title, event.nightDate, id),
      title: event.title,
      titleNormalized: event.titleNormalized,
      listingType: event.listingType,
      styles: event.styles,
      doorsAt: event.doorsAt,
      lessonAt: event.lessonAt,
      dancingAt: event.dancingAt,
      endsAt: event.endsAt,
      nightDate: event.nightDate,
      tz: event.tz,
      geo: venue?.location ?? event.venue.location ?? null,
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
      crowdSizeHint: event.crowdSizeHint,
      venueId: venue?.venueId ?? null,
      organizerId,
      metroId: metro.id,
      confirmation: event.confirmation,
      confidence: meanOf(event.confidence),
      sourceIds: [source.id],
      lastVerifiedAt: event.fromRule ? null : fetchedAt,
      status: event.cancelled ? ("cancelled" as const) : ("active" as const),
      // The event's own page when the source links one, else the page it was read from (D-070).
      canonicalUrl: event.canonicalUrl ?? event.provenance.sourceUrl,
    };
    // A directory named as the organiser is withdrawn (D-070): the row stops pointing at it, where
    // an organiser merely not named this run is kept.
    const organizerWithdrawn = event.withdrawn.includes("organizer_name");

    await db
      .insert(events)
      .values(cleanStrings(row))
      .onConflictDoUpdate({
        target: events.id,
        set: {
          title: sql`excluded.title`,
          titleNormalized: sql`excluded.title_normalized`,
          listingType: sql`excluded.listing_type`,
          styles: sql`excluded.styles`,
          doorsAt: sql`excluded.doors_at`,
          lessonAt: sql`excluded.lesson_at`,
          dancingAt: sql`excluded.dancing_at`,
          endsAt: sql`excluded.ends_at`,
          nightDate: sql`excluded.night_date`,
          tz: sql`excluded.tz`,
          geo: sql`coalesce(excluded.geo, ${events.geo})`,
          prices: sql`excluded.prices`,
          isFree: sql`excluded.is_free`,
          ticketUrl: sql`excluded.ticket_url`,
          level: sql`excluded.level`,
          partnerRequired: sql`excluded.partner_required`,
          ageMin: sql`excluded.age_min`,
          dressCode: sql`excluded.dress_code`,
          floor: sql`excluded.floor`,
          indoorOutdoor: sql`excluded.indoor_outdoor`,
          music: sql`excluded.music`,
          crowdSizeHint: sql`excluded.crowd_size_hint`,
          venueId: sql`coalesce(excluded.venue_id, ${events.venueId})`,
          organizerId: organizerWithdrawn
            ? null
            : sql`coalesce(excluded.organizer_id, ${events.organizerId})`,
          // Dedupe may have set `conflicting`; a re-harvest does not clear that on its own.
          confirmation: sql`case when ${events.confirmation} = 'conflicting' and excluded.confirmation <> 'cancelled' then ${events.confirmation} else excluded.confirmation end`,
          confidence: sql`excluded.confidence`,
          sourceIds: sql`array(select distinct unnest(${events.sourceIds} || excluded.source_ids))`,
          lastVerifiedAt: sql`coalesce(excluded.last_verified_at, ${events.lastVerifiedAt})`,
          // A merged row stays merged, and so does a row retired into the listing that replaced it
          // (it points at that listing). A row retired only because a read did not list it
          // (`retireUnlisted`, no replacement) comes back when a later read lists it again: one
          // missed read, or a time that changes and changes back, must not hide a listed night
          // (review, 2026-09-28). Everything else follows the source.
          // A timed row retired into this source's untimed listing of its night, because a read's
          // time was withdrawn against the page (D-081), comes back when a read lists that time
          // again: it is not left pointing at the listing that the time now replaces.
          // A removed row whose merge target was itself retired outright (target status = 'removed'
          // and target merged_into_id is null) is written like an unmerged row: status follows
          // excluded.status, and merged_into_id becomes null.
          status: sql`case when ${events.status} = 'merged' or (${events.status} = 'removed' and ${events.mergedIntoId} is not null and ${events.mergedIntoId} <> ${untimedId} and not exists (select 1 from ${events} t where t.id = ${events.mergedIntoId} and t.status = 'removed' and t.merged_into_id is null)) then ${events.status} else excluded.status end`,
          mergedIntoId: sql`case when ${events.status} = 'removed' and (${events.mergedIntoId} = ${untimedId} or exists (select 1 from ${events} t where t.id = ${events.mergedIntoId} and t.status = 'removed' and t.merged_into_id is null)) then null else ${events.mergedIntoId} end`,
          canonicalUrl: sql`excluded.canonical_url`,
          updatedAt: sql`now()`,
        },
      });

    await db
      .insert(eventSources)
      .values({
        id: pipelineId("event_source", `${id}:${source.id}:${event.provenance.sourceUrl}`),
        eventId: id,
        sourceId: source.id,
        sourceUrl: event.provenance.sourceUrl,
        rawDocumentId: args.rawDocumentId ?? null,
        role: "primary",
        firstSeenAt: fetchedAt,
        lastSeenAt: fetchedAt,
        // This source's own page for the event (D-073), never the list it was read from.
        eventUrl: event.eventUrl,
      })
      .onConflictDoUpdate({
        target: [eventSources.eventId, eventSources.sourceId, eventSources.sourceUrl],
        set: {
          lastSeenAt: sql`excluded.last_seen_at`,
          rawDocumentId: sql`excluded.raw_document_id`,
          eventUrl: args.keepEventUrls ? sql`${eventSources.eventUrl}` : sql`excluded.event_url`,
        },
      });

    const provenanceRows = provenanceFields(event).map((f) => ({
      id: pipelineId("provenance", `${id}:${f.field}:${source.id}`),
      entityType: "event" as const,
      entityId: id,
      field: f.field,
      value: f.value,
      sourceId: source.id,
      sourceUrl: event.provenance.sourceUrl,
      fetchedAt,
      evidence: evidenceFor(event, f.field, f.evidenceKey),
      method: event.provenance.method,
      confidence: event.confidence[f.evidenceKey] ?? null,
      isCurrent: true,
    }));
    if (provenanceRows.length > 0) {
      await db
        .insert(fieldProvenance)
        .values(cleanStrings(provenanceRows))
        .onConflictDoUpdate({
          target: fieldProvenance.id,
          set: {
            value: sql`excluded.value`,
            fetchedAt: sql`excluded.fetched_at`,
            evidence: sql`excluded.evidence`,
            method: sql`excluded.method`,
            confidence: sql`excluded.confidence`,
            isCurrent: sql`true`,
          },
        });
    }
    // A re-harvest that no longer lists a time follows the source to null (the upsert above), and
    // this source's earlier provenance for that time stops being current (D-060 point 12). So does
    // every other fact whose column follows the source, and a fact normalisation withdrew (D-070):
    // a door code read as a dress code, a directory read as the organiser.
    const following = [...FOLLOWING_FIELDS, ...(organizerWithdrawn ? ["organizer_name"] : [])];
    const stale = following.filter((f) => !provenanceRows.some((r) => r.field === f));
    if (stale.length > 0) {
      await db
        .update(fieldProvenance)
        .set({ isCurrent: false })
        .where(
          and(
            eq(fieldProvenance.entityType, "event"),
            eq(fieldProvenance.entityId, id),
            eq(fieldProvenance.sourceId, source.id),
            inArray(fieldProvenance.field, stale),
            eq(fieldProvenance.isCurrent, true),
          ),
        );
    }

    if (event.startsAt === null) {
      result.untimed += 1;
      if (venue) result.untimedPlaced += 1;
      untimedIds.push(id);
      if (event.timesWithdrawn && siblings.length > 0) {
        for (const sibling of siblings) await retireTimedInto(db, source, sibling, id);
        result.notes.push(
          `${event.title}: listed on ${event.nightDate} with no time, as the page does not write the time the read gave; the listing stored with a time was replaced`,
        );
      }
    } else {
      const retired = await retireUntimedSiblings(db, metro, source, event, id);
      result.superseded += retired;
      if (retired > 0) {
        result.notes.push(
          `${event.title}: now listed on ${event.nightDate} with a time; the listing without one was merged into it`,
        );
      }
    }
    result.written += 1;
    result.eventIds.push(id);
  }
  // The re-harvest just wrote these without a time; one whose duplicate from another source was
  // merged into it gets that listing's times back (D-060 point 11).
  await refillTimesFromMerges(db, untimedIds);
  return result;
}

/** A stored row's times in its zone, 24-hour "HH:MM" (`pageWritesRowTimes`). */
type RowTimes = {
  doors: string | null;
  lesson: string | null;
  dancing: string | null;
  end: string | null;
};
const localTime = (at: AnyColumn) =>
  sql<string | null>`to_char(${at} at time zone ${events.tz}, 'HH24:MI')`;
const rowTimesColumns = () => ({
  doors: localTime(events.doorsAt),
  lesson: localTime(events.lessonAt),
  dancing: localTime(events.dancingAt),
  end: localTime(events.endsAt),
});

/**
 * This source's active rows for the event's night and title with a time, with each one's times in
 * its zone.
 */
async function timedSiblingsOf(
  db: DbOrTx,
  metro: Metro,
  source: Source,
  event: NormalizedEvent,
  id: string,
  samePage: string | null = null,
): Promise<Array<{ id: string } & RowTimes>> {
  const rows = await db
    .select({ id: events.id, ...rowTimesColumns() })
    .from(events)
    .where(
      and(
        eq(events.metroId, metro.id),
        eq(events.nightDate, event.nightDate),
        eq(events.titleNormalized, event.titleNormalized),
        inArray(events.status, ["active", "cancelled"]),
        sql`${events.startsAt} is not null`,
        sql`${events.id} <> ${id}`,
        writtenBy(source.id),
        // An invented midnight is not a listed time: its replacement must still be written.
        sql`not ${inventedMidnight(source.id)}`,
        samePage
          ? sql`exists (select 1 from ${eventSources} es where es.event_id = ${events.id} and es.source_id = ${source.id} and es.role = 'primary' and es.event_url = ${samePage})`
          : undefined,
      ),
    )
    .orderBy(events.startsAt, events.id);
  return rows;
}

/**
 * A timed row whose time a read withdrew against the page (D-081) is replaced by this source's
 * untimed listing of the night, on the read that withdrew it, whole or partial: the read covered
 * the listing's part of the page, and that part does not write the time. As D-065 retires a
 * placeholder's row (`retireInto`): the row is `removed`, pointing at the untimed listing, which
 * keeps its venue when it has none. This source's own rows merged into it go with it (the untimed
 * listing itself, merged into it when the night gained that time, stands again); other sources'
 * rows merged into it stand on their own again, for the next dedupe to pair. Nothing is deleted.
 */
async function retireTimedInto(
  db: Db,
  source: Source,
  timedId: string,
  untimedId: string,
): Promise<void> {
  const standing = sql`case when ${events.confirmation} = 'cancelled' then 'cancelled'::event_status else 'active'::event_status end`;
  await db.transaction(async (tx) => {
    await tx.execute(sql`
      update ${events} r set venue_id = o.venue_id, geo = coalesce(r.geo, o.geo), updated_at = now()
      from ${events} o
      where r.id = ${untimedId} and o.id = ${timedId}
        and r.venue_id is null and o.venue_id is not null
    `);
    await tx
      .update(events)
      .set({ status: "removed", mergedIntoId: untimedId, updatedAt: new Date() })
      .where(eq(events.id, timedId));
    await tx
      .update(events)
      .set({ status: standing, mergedIntoId: null, updatedAt: new Date() })
      .where(and(eq(events.id, untimedId), eq(events.mergedIntoId, timedId)));
    await tx
      .update(events)
      .set({ status: "removed", mergedIntoId: null, updatedAt: new Date() })
      .where(
        and(eq(events.mergedIntoId, timedId), eq(events.status, "merged"), writtenBy(source.id)),
      );
    await tx
      .update(events)
      .set({ status: standing, mergedIntoId: null, updatedAt: new Date() })
      .where(and(eq(events.mergedIntoId, timedId), eq(events.status, "merged")));
  });
}

/**
 * Across runs (D-060 point 7): once a source lists a night with a time, its row for the same night
 * and title known only by night and title (its untimed key) is marked merged into the timed row.
 * A row with an id of its own is a listing in its own right and is left alone (review,
 * 2026-09-28); the untimed key's start, if any, came from a merged duplicate.
 * So is an untimed row of this source with an id of its own whose own page (event_url) is the timed listing's page (Mumbai allevents, 2026-11-01).
 */
async function retireUntimedSiblings(
  db: Db,
  metro: Metro,
  source: Source,
  event: NormalizedEvent,
  timedId: string,
): Promise<number> {
  const untimedId = pipelineId(
    "event",
    `${source.id}:${untimedKey(event.nightDate, event.titleNormalized)}`,
  );
  const siblings = await db
    .select({ id: events.id })
    .from(events)
    .where(
      and(
        eq(events.metroId, metro.id),
        eq(events.nightDate, event.nightDate),
        eq(events.titleNormalized, event.titleNormalized),
        inArray(events.status, ["active", "cancelled"]),
        sql`${events.id} <> ${timedId}`,
        writtenBy(source.id),
        or(
          eq(events.id, untimedId),
          // An untimed row of this source with an id of its own (a list page's date-only row, keyed by the
          // listing's own id) that points at the same event page is the same listing, now timed.
          event.eventUrl
            ? and(
                sql`${events.startsAt} is null`,
                sql`exists (select 1 from ${eventSources} es where es.event_id = ${events.id} and es.source_id = ${source.id} and es.role = 'primary' and es.event_url = ${event.eventUrl})`,
              )
            : sql`false`,
        ),
      ),
    );
  for (const sibling of siblings) {
    await db.transaction(async (tx) => mergeInto(tx, timedId, sibling.id));
  }
  return siblings.length;
}

/**
 * Marks `mergedId` merged into `survivorId`: the survivor gains its sources and its source links
 * (as secondary links), and rows that were merged into it now point at the survivor. Facts are
 * not copied; the caller decides which (D-006, D-060).
 */
export async function mergeInto(db: DbOrTx, survivorId: string, mergedId: string): Promise<void> {
  await db
    .update(events)
    .set({ status: "merged", mergedIntoId: survivorId, updatedAt: new Date() })
    .where(eq(events.id, mergedId));
  const [loser] = await db
    .select({ sourceIds: events.sourceIds })
    .from(events)
    .where(eq(events.id, mergedId));
  await db
    .update(events)
    .set({
      sourceIds: sql`array(select distinct unnest(${events.sourceIds} || ${`{${(loser?.sourceIds ?? []).join(",")}}`}::uuid[]))`,
      updatedAt: new Date(),
    })
    .where(eq(events.id, survivorId));
  await db
    .update(events)
    .set({ mergedIntoId: survivorId, updatedAt: new Date() })
    .where(and(eq(events.mergedIntoId, mergedId), eq(events.status, "merged")));

  const links = await db.select().from(eventSources).where(eq(eventSources.eventId, mergedId));
  if (links.length > 0) {
    await db
      .insert(eventSources)
      .values(
        links.map((l) => ({
          id: pipelineId("event_source", `${survivorId}:${l.sourceId}:${l.sourceUrl}`),
          eventId: survivorId,
          sourceId: l.sourceId,
          sourceUrl: l.sourceUrl,
          rawDocumentId: l.rawDocumentId,
          role: "secondary" as const,
          firstSeenAt: l.firstSeenAt,
          lastSeenAt: l.lastSeenAt,
          // A merged Eventbrite row keeps its event page under the survivor (D-073).
          eventUrl: l.eventUrl,
        })),
      )
      .onConflictDoUpdate({
        target: [eventSources.eventId, eventSources.sourceId, eventSources.sourceUrl],
        set: {
          lastSeenAt: sql`excluded.last_seen_at`,
          // The survivor's own primary row was just written by the current read: its page (or
          // its lack of one, when the checks dropped the link) stands over the older row's
          // (review #20). A secondary row takes the merged row's page when it has one.
          eventUrl: sql`case when ${eventSources.role} = 'primary' then ${eventSources.eventUrl} else coalesce(excluded.event_url, ${eventSources.eventUrl}) end`,
        },
      });
  }
}

/**
 * Gives a survivor with no listed time the times of a timed listing merged into it (D-060 point
 * 11): doors, lesson and dancing, and the end when the survivor lists none, each with its
 * provenance copied onto the survivor. Does nothing when the survivor has a time, the merged row
 * has none, or the merged row is no longer on the survivor's night: a rescheduled ticket listing
 * keeps its id and moves, and its times must not be stamped on the night it left (review finding,
 * 2026-09-28). Returns true when times were copied.
 */
export async function copyTimesFromMerged(
  db: DbOrTx,
  survivorId: string,
  mergedId: string,
): Promise<boolean> {
  const [pair] = await db.execute<{ survivor_end_listed: boolean }>(sql`
    select s.ends_at is not null as survivor_end_listed
    from events s, events m
    where s.id = ${survivorId} and m.id = ${mergedId}
      and s.starts_at is null and m.starts_at is not null
      and m.night_date = s.night_date
  `);
  if (!pair) return false;
  await db.execute(sql`
    update events s
    set doors_at = m.doors_at, lesson_at = m.lesson_at, dancing_at = m.dancing_at,
      ends_at = coalesce(s.ends_at, m.ends_at), updated_at = now()
    from events m
    where s.id = ${survivorId} and m.id = ${mergedId}
  `);
  const fields: string[] = ["doors_at", "lesson_at", "dancing_at"];
  if (!pair.survivor_end_listed) fields.push("ends_at");
  const facts = await db
    .select()
    .from(fieldProvenance)
    .where(
      and(
        eq(fieldProvenance.entityType, "event"),
        eq(fieldProvenance.entityId, mergedId),
        eq(fieldProvenance.isCurrent, true),
        inArray(fieldProvenance.field, fields),
      ),
    );
  if (facts.length > 0) {
    await db
      .insert(fieldProvenance)
      .values(
        facts.map((f) => ({
          ...f,
          id: pipelineId(
            "provenance",
            `${survivorId}:${f.field}:${f.sourceId ?? "none"}:from:${mergedId}`,
          ),
          entityId: survivorId,
          createdAt: new Date(),
        })),
      )
      .onConflictDoUpdate({
        target: fieldProvenance.id,
        set: {
          value: sql`excluded.value`,
          fetchedAt: sql`excluded.fetched_at`,
          evidence: sql`excluded.evidence`,
          method: sql`excluded.method`,
          confidence: sql`excluded.confidence`,
          isCurrent: sql`true`,
        },
      });
  }
  return true;
}

/**
 * For survivors just re-written without a time: copies the times back from the most trusted timed
 * listing merged into each one on the same night. The survivor's own source does not list a time,
 * so its re-harvest writes the times as null; the merged listing's times are still facts another
 * source states. Any merged row counts, not only a direct dedupe decision: a row re-pointed to a
 * new survivor by a later merge carries its times with it.
 */
export async function refillTimesFromMerges(
  db: Db,
  survivorIds: readonly string[],
): Promise<number> {
  if (survivorIds.length === 0) return 0;
  const pairs = await db.execute<{ survivor_id: string; merged_id: string }>(sql`
    select distinct on (m.merged_into_id) m.merged_into_id as survivor_id, m.id as merged_id
    from events m
    join events s on s.id = m.merged_into_id
    where s.id = any(${`{${survivorIds.join(",")}}`}::uuid[])
      and s.starts_at is null and s.status in ('active', 'cancelled')
      and m.status = 'merged' and m.starts_at is not null
      and m.night_date = s.night_date
    order by m.merged_into_id,
      (select min(array_position(${`{${TRUST_ORDER.join(",")}}`}::text[], src.trust_tier::text))
        from ${sources} src where src.id = any(m.source_ids)) asc nulls last,
      m.first_seen_at asc, m.id asc
  `);
  let filled = 0;
  for (const pair of pairs) {
    const done = await db.transaction((tx) =>
      copyTimesFromMerged(tx, pair.survivor_id, pair.merged_id),
    );
    if (done) filled += 1;
  }
  return filled;
}

/**
 * Rows written before D-060 with an invented midnight: an untimed rule read by the model was
 * anchored at 00:00 on the day the page was read, so each night was stored as dancing at local
 * midnight on the night before the rule's day. Such a row is retired (status `removed`, pointing at
 * its replacement) by the first run of its source that writes the replacement: the same source's
 * untimed listing of the same title on the next night. Only rows that match exactly are touched:
 * written by this source, from a rule (never verified by a dated listing), read by the model, with
 * no doors or lesson time, dancing at exactly 00:00 local on the next calendar day, and not
 * written again by this run. Nothing is deleted, and rows that dedupe had merged into a retired
 * row stand on their own again.
 */
export async function retireInventedMidnights(
  db: Db,
  args: { source: Source; writtenIds: readonly string[]; nights: readonly string[] },
): Promise<{ retired: number; notes: string[] }> {
  const { source, writtenIds, nights } = args;
  if (writtenIds.length === 0 || nights.length === 0) return { retired: 0, notes: [] };
  const written = new Set(writtenIds);
  const rows = await db
    .select({
      id: events.id,
      night: events.nightDate,
      title: events.title,
      titleNormalized: events.titleNormalized,
    })
    .from(events)
    .where(
      and(
        inArray(events.nightDate, [...nights]),
        inArray(events.status, ["active", "cancelled"]),
        writtenBy(source.id),
        inventedMidnight(source.id),
        notInArray(events.id, [...writtenIds]),
      ),
    );
  let retired = 0;
  const notes: string[] = [];
  for (const row of rows) {
    const replacement = pipelineId(
      "event",
      `${source.id}:${untimedKey(addCalendarDays(row.night, 1), row.titleNormalized)}`,
    );
    if (!written.has(replacement)) continue;
    await retireInto(db, row.id, replacement);
    retired += 1;
    notes.push(
      `${row.title}: the listing stored at midnight on ${row.night} was an invented time; replaced by the listing on ${addCalendarDays(row.night, 1)} with no time`,
    );
  }
  return { retired, notes };
}

/**
 * Retires this source's other rows that stand for a listing it just wrote: same night, same
 * normalised title and same start (2026-10-14: Salsa Vida's guide had each of four nights twice,
 * an earlier read having keyed them under another id). One source does not list one night twice
 * at one time, and dedupe never pairs two rows of one source, so the stale twin would stay listed.
 * Untimed rows are matched on night, title and venue: a re-keyed untimed listing (La Deskomunal,
 * Salsa Vida, 2026-11-05) is the same listing (D-593). Each twin is retired into the written row
 * (`retireInto`); nothing is deleted.
 */
export async function retireSameSourceTwins(
  db: Db,
  args: { source: Source; writtenIds: readonly string[] },
): Promise<{ retired: number; notes: string[] }> {
  const { source, writtenIds } = args;
  if (writtenIds.length === 0) return { retired: 0, notes: [] };

  let totalRetired = 0;
  const totalNotes: string[] = [];

  // --- Timed rows (startsAt IS NOT NULL) ---
  const writtenTimedRows = await db
    .select({
      id: events.id,
      night: events.nightDate,
      titleNormalized: events.titleNormalized,
      startsAt: events.startsAt,
      title: events.title,
    })
    .from(events)
    .where(and(inArray(events.id, [...writtenIds]), isNotNull(events.startsAt)));

  if (writtenTimedRows.length > 0) {
    const nights = [...new Set(writtenTimedRows.map((r) => r.night))];
    const writtenMap = new Map<string, (typeof writtenTimedRows)[0]>();
    for (const row of writtenTimedRows) {
      const key = `${row.night}|${row.titleNormalized}|${row.startsAt!.getTime()}`;
      writtenMap.set(key, row);
    }

    const candidates = await db
      .select({
        id: events.id,
        night: events.nightDate,
        titleNormalized: events.titleNormalized,
        startsAt: events.startsAt,
        title: events.title,
      })
      .from(events)
      .where(
        and(
          inArray(events.nightDate, nights),
          inArray(events.status, ["active", "cancelled"]),
          writtenBy(source.id),
          notInArray(events.id, [...writtenIds]),
          isNotNull(events.startsAt),
        ),
      );

    for (const candidate of candidates) {
      const key = `${candidate.night}|${candidate.titleNormalized}|${candidate.startsAt!.getTime()}`;
      const written = writtenMap.get(key);
      if (!written) continue;
      await retireInto(db, candidate.id, written.id);
      totalRetired += 1;
      totalNotes.push(
        `${candidate.title}: listed twice by this source on ${candidate.night} at the same time; the older copy was retired`,
      );
    }
  }

  // --- Untimed rows (startsAt IS NULL) ---
  const writtenUntimedRows = await db
    .select({
      id: events.id,
      night: events.nightDate,
      titleNormalized: events.titleNormalized,
      venueId: events.venueId,
      title: events.title,
    })
    .from(events)
    .where(and(inArray(events.id, [...writtenIds]), isNull(events.startsAt)));

  if (writtenUntimedRows.length > 0) {
    const nights = [...new Set(writtenUntimedRows.map((r) => r.night))];
    const untimedKey = (r: { night: string; titleNormalized: string; venueId: string | null }) =>
      `${r.night}|${r.titleNormalized}|${r.venueId ?? ""}`;
    const writtenMap = new Map(writtenUntimedRows.map((r) => [untimedKey(r), r]));
    const candidates = await db
      .select({
        id: events.id,
        night: events.nightDate,
        titleNormalized: events.titleNormalized,
        venueId: events.venueId,
        title: events.title,
      })
      .from(events)
      .where(
        and(
          inArray(events.nightDate, nights),
          inArray(events.status, ["active", "cancelled"]),
          writtenBy(source.id),
          notInArray(events.id, [...writtenIds]),
          isNull(events.startsAt),
        ),
      );
    for (const candidate of candidates) {
      const written = writtenMap.get(untimedKey(candidate));
      if (!written) continue;
      await retireInto(db, candidate.id, written.id);
      totalRetired += 1;
      totalNotes.push(
        `${candidate.title}: listed twice by this source on ${candidate.night} with no time; the older copy was retired`,
      );
    }
  }

  return { retired: totalRetired, notes: totalNotes };
}

/**
 * Retires a source's unplaced older copy of a night it now lists, placed, at a moved time (D-277:
 * Blue Nile's Reggae Night stood twice, this run's 11pm row at the venue and an earlier read's 10pm
 * row with no venue). Same night and normalised title, a start within 3 hours, no other source
 * vouching for it, and not listed by this run. A placed row whose time moved is left to the time
 * checks (D-070, D-079, D-081). Each copy is retired into the written row; nothing is deleted.
 */
export async function retireMovedCopies(
  db: Db,
  args: { source: Source; writtenIds: readonly string[]; listedIds: readonly string[] },
): Promise<{ retired: number; notes: string[] }> {
  const { source, writtenIds, listedIds } = args;
  if (writtenIds.length === 0) return { retired: 0, notes: [] };

  // Load written rows (active, with a start)
  const writtenRows = await db
    .select({
      id: events.id,
      night: events.nightDate,
      titleNormalized: events.titleNormalized,
      startsAt: events.startsAt,
      venueId: events.venueId,
      title: events.title,
    })
    .from(events)
    .where(
      and(
        inArray(events.id, [...writtenIds]),
        eq(events.status, "active"),
        isNotNull(events.startsAt),
      ),
    );

  if (writtenRows.length === 0) return { retired: 0, notes: [] };

  const nights = [...new Set(writtenRows.map((r) => r.night))];

  // Load candidates: same source, same nights, active/cancelled, not in listedIds, single source, with start
  const candidates = await db
    .select({
      id: events.id,
      night: events.nightDate,
      titleNormalized: events.titleNormalized,
      startsAt: events.startsAt,
      venueId: events.venueId,
      title: events.title,
    })
    .from(events)
    .where(
      and(
        inArray(events.nightDate, nights),
        inArray(events.status, ["active", "cancelled"]),
        writtenBy(source.id),
        listedIds.length > 0 ? notInArray(events.id, [...listedIds]) : sql`true`,
        sql`cardinality(${events.sourceIds}) = 1`,
        isNotNull(events.startsAt),
      ),
    )
    .orderBy(events.nightDate, events.title, events.id);

  // Each night and title's written rows: a candidate is a copy of the one whose start is closest.
  const writtenByKey = new Map<string, (typeof writtenRows)[number][]>();
  for (const w of writtenRows) {
    const key = `${w.night}|${w.titleNormalized}`;
    writtenByKey.set(key, [...(writtenByKey.get(key) ?? []), w]);
  }

  let retired = 0;
  const notes: string[] = [];
  const processed = new Set<string>();

  for (const candidate of candidates) {
    const key = `${candidate.night}|${candidate.titleNormalized}`;
    const start = candidate.startsAt!.getTime();
    const written = (writtenByKey.get(key) ?? [])
      .slice()
      .sort(
        (x, y) =>
          Math.abs(x.startsAt!.getTime() - start) - Math.abs(y.startsAt!.getTime() - start) ||
          (x.id < y.id ? -1 : x.id > y.id ? 1 : 0),
      )[0];
    if (!written) continue;
    // Different start?
    if (candidate.startsAt!.getTime() === written.startsAt!.getTime()) continue;
    // Within 3 hours?
    const diffMs = Math.abs(candidate.startsAt!.getTime() - written.startsAt!.getTime());
    if (diffMs > 3 * 60 * 60 * 1000) continue;
    // Only an unplaced older copy of a night now placed (D-277: the old Blue Nile row had none).
    // A placed row whose time moved is left to the time checks (D-070, D-079, D-081).
    if (candidate.venueId !== null || written.venueId === null) continue;
    if (processed.has(candidate.id)) continue;
    await retireInto(db, candidate.id, written.id);
    processed.add(candidate.id);
    retired += 1;
    notes.push(
      `${candidate.title}: this source now lists it on ${candidate.night} at another time; the older copy was retired`,
    );
  }
  return { retired, notes };
}

/** A title that sells a booking for a night (a birthday, a table, bottles, a VIP section), not the night itself. */
export function isBookingTitle(title: string): boolean {
  const regex =
    /\b(?:b-?\s?days?|bday|b day|birthdays?|bottle service|bottle special|bottles|table|tables|table reservation|reservations?|vip section|vip tables?|booth|booths|section|sections)\b/i;
  return regex.test(title);
}

export function sameTimeKeeper<T extends { title: string; titleNormalized: string }>(
  rows: readonly T[],
): T {
  if (rows.length === 0) throw new Error("sameTimeKeeper requires at least one row");
  return rows.reduce((best, current) => {
    // a. non-booking beats booking
    const bestBooking = isBookingTitle(best.title);
    const currentBooking = isBookingTitle(current.title);
    if (bestBooking !== currentBooking) {
      return currentBooking ? best : current;
    }
    // b. more dance styles wins
    const bestStyles = matchStyles(best.title).styles.length;
    const currentStyles = matchStyles(current.title).styles.length;
    if (currentStyles !== bestStyles) {
      return currentStyles > bestStyles ? current : best;
    }
    // c. lower titleNormalized wins
    return current.titleNormalized < best.titleNormalized ? current : best;
  });
}

/**
 * Merges same-source duplicates that are the same night at one venue under several names or time slots.
 * Cases (owner, 2026-10-18):
 * 1. Same times, different names: a promoter lists one night at one bar under several titles, all
 *    same start and end. Does not apply when either row is a class, workshop or practice (owner,
 *    2026-10-18: parallel studio classes must stay apart).
 * 2. Same name, one row per time slot: a venue lists the same title multiple times a night, one per
 *    ticketed slot.
 * Rows with no start time or no venue are left alone. A source's 8pm class and 10pm party under
 * different titles stay separate.
 */
export async function retireSameSourceSiblings(
  db: Db,
  args: { source: Source; writtenIds: readonly string[] },
): Promise<{ retired: number; notes: string[] }> {
  const { source, writtenIds } = args;
  if (writtenIds.length === 0) return { retired: 0, notes: [] };

  // Load written rows that have a start time AND a venue
  const writtenRows = await db
    .select({
      id: events.id,
      night: events.nightDate,
      venueId: events.venueId,
      startsAt: events.startsAt,
      endsAt: events.endsAt,
      title: events.title,
      titleNormalized: events.titleNormalized,
      listingType: events.listingType,
    })
    .from(events)
    .where(
      and(
        inArray(events.id, [...writtenIds]),
        isNotNull(events.startsAt),
        isNotNull(events.venueId),
        eq(events.status, "active"),
      ),
    );

  if (writtenRows.length === 0) return { retired: 0, notes: [] };

  // Group by night|venueId
  const groups = new Map<string, typeof writtenRows>();
  for (const row of writtenRows) {
    const key = `${row.night}|${row.venueId}`;
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }

  let totalRetired = 0;
  const notes: string[] = [];

  for (const groupRows of groups.values()) {
    if (groupRows.length < 2) continue;
    const retiredIds = new Set<string>();

    // 1. Same times, different names
    // Both ends must be listed: two titles at one start with no end (two rooms' classes) stay apart.
    // Owner, 2026-10-18: do not merge a class, workshop or practice with anything else.
    const byTime = new Map<string, typeof groupRows>();
    for (const row of groupRows) {
      if (row.endsAt === null) continue;
      if (isClassLike(row)) continue;
      const timeKey = `${row.startsAt!.getTime()}|${row.endsAt.getTime()}`;
      const list = byTime.get(timeKey) ?? [];
      list.push(row);
      byTime.set(timeKey, list);
    }

    for (const timeRows of byTime.values()) {
      if (timeRows.length < 2) continue;
      const keeper = sameTimeKeeper(timeRows);
      const losers = timeRows.filter((r) => r.id !== keeper.id);
      for (const loser of losers) {
        await retireInto(db, loser.id, keeper.id);
        totalRetired += 1;
        notes.push(
          `${loser.title}: same night, place and times as "${keeper.title}" from this source; listed once`,
        );
      }
      for (const loser of losers) retiredIds.add(loser.id);
    }

    // 2. Same name, one row per slot (still active rows in group)
    const byTitle = new Map<string, typeof groupRows>();
    for (const row of groupRows) {
      if (retiredIds.has(row.id)) continue;
      const list = byTitle.get(row.titleNormalized) ?? [];
      list.push(row);
      byTitle.set(row.titleNormalized, list);
    }

    for (const titleRows of byTitle.values()) {
      if (titleRows.length < 2) continue;
      // Distinct startsAt count
      const distinctStarts = new Set(titleRows.map((r) => r.startsAt!.getTime()));
      if (distinctStarts.size < 2) continue;
      // Classes of one name in slots that do not overlap stay apart: a studio's grid repeats one class name at
      // several levels in one night (Agozar's "Salsa Partner Work" at 8pm Level 2 and 9pm Level 3). A class whose
      // start falls inside the previous kept slot (before its end, or within 45 min of its start when it has no
      // end) is the same class read twice with a drifted time, and is listed once (D-675, coverage-85).
      if (titleRows.every((r) => isClassLike(r))) {
        const sorted = [...titleRows].sort((x, y) => x.startsAt!.getTime() - y.startsAt!.getTime());
        let kept = sorted[0]!;
        for (const row of sorted.slice(1)) {
          const slotEnd = kept.endsAt?.getTime() ?? kept.startsAt!.getTime() + 45 * 60_000;
          if (row.startsAt!.getTime() >= slotEnd) {
            kept = row;
            continue;
          }
          await retireInto(db, row.id, kept.id);
          totalRetired += 1;
          notes.push(
            `${row.title}: a class inside the slot of "${kept.title}" on ${kept.night}; listed once`,
          );
        }
        continue;
      }
      // Keep earliest start
      const keeper = titleRows.reduce((prev, curr) =>
        curr.startsAt!.getTime() < prev.startsAt!.getTime() ? curr : prev,
      );
      const losers = titleRows.filter((r) => r.id !== keeper.id);
      for (const loser of losers) {
        await retireInto(db, loser.id, keeper.id);
        totalRetired += 1;
        notes.push(
          `${loser.title}: another time slot of the same listing on ${keeper.night}; listed once at its first time`,
        );
      }
    }
  }

  return { retired: totalRetired, notes };
}

/**
 * Retires a stale row in favour of the listing that replaces it: status `removed`, pointing at its
 * replacement. A replacement whose venue could not be placed this run keeps the retired row's
 * venue, so the night stays on the list (review, 2026-09-28). Nothing is deleted, and rows that
 * dedupe had merged into the retired row stand on their own again, for the next dedupe to pair.
 */
export async function retireInto(db: Db, rowId: string, replacementId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`
      update ${events} r set venue_id = o.venue_id, geo = coalesce(r.geo, o.geo), updated_at = now()
      from ${events} o
      where r.id = ${replacementId} and o.id = ${rowId}
        and r.venue_id is null and o.venue_id is not null
    `);
    await tx
      .update(events)
      .set({ status: "removed", mergedIntoId: replacementId, updatedAt: new Date() })
      .where(eq(events.id, rowId));
    await tx
      .update(events)
      .set({
        status: sql`case when ${events.confirmation} = 'cancelled' then 'cancelled'::event_status else 'active'::event_status end`,
        mergedIntoId: null,
        updatedAt: new Date(),
      })
      .where(and(eq(events.mergedIntoId, rowId), eq(events.status, "merged")));
  });
}

const START_FIELDS = ["doors_at", "lesson_at", "dancing_at"] as const;

/** A time provenance value as an instant; every one is an ISO string (`provenanceFields`). */
const provenanceInstant = (alias: string) => sql.raw(`(${alias}.value #>> '{}')::timestamptz`);

/**
 * Stored times that are one of their source's placeholders (D-065). Rows written before the
 * source declared its placeholder (D-063) kept the clock time the site prints on every event (The
 * Ronda's 15:00) as if the organiser had stated it, and a stored time stops the untimed listing
 * that replaces it from being written (`timedSiblingsOf`). Run before the source's listings are
 * written, over the window's nights, in one transaction:
 *
 * 1. this source's provenance for such a time stops being current, wherever dedupe copied it (onto
 *    a survivor with no time, or beside a conflicting time);
 * 2. every row carrying that provenance, current or already withdrawn, has each placeholder time
 *    cleared unless a current fact from another source states that same instant: a different
 *    time beside it keeps nothing (review, 2026-09-28), and a re-run after an interrupted one
 *    finishes the job.
 *
 * Then a survivor that lost its start takes the times of a timed listing merged into it from
 * another source (`refillTimesFromMerges`, D-060 point 11), and a row left `conflicting` only by
 * the withdrawn fact is no longer flagged, since nothing current disagrees with its times; its own
 * source's next harvest sets its confirmation again. Nothing is deleted; a row left with no time
 * reads "Time not listed" (D-060). Returns how many rows lost their start.
 */
export async function clearPlaceholderTimes(
  db: Db,
  args: { source: Source; placeholders: readonly string[]; nights: readonly string[] },
): Promise<{ cleared: number; notes: string[] }> {
  const { source, placeholders, nights } = args;
  if (placeholders.length === 0 || nights.length === 0) return { cleared: 0, notes: [] };
  const placeholderList = `{${placeholders.join(",")}}`;
  const nightList = `{${nights.join(",")}}`;
  const isPlaceholder = (instant: ReturnType<typeof sql>, tz: ReturnType<typeof sql>) =>
    sql`to_char(${instant} at time zone ${tz}, 'HH24:MI') = any(${placeholderList}::text[])`;

  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`
      update ${fieldProvenance} fp set is_current = false
      from ${events} e
      where fp.entity_type = 'event' and fp.entity_id = e.id
        and fp.source_id = ${source.id} and fp.is_current
        and fp.field in ('doors_at', 'lesson_at', 'dancing_at', 'ends_at')
        and e.night_date = any(${nightList}::date[])
        and ${isPlaceholder(provenanceInstant("fp"), sql`e.tz`)}
    `);
    const marked = await tx.execute<{ id: string }>(sql`
      select distinct e.id from ${events} e
      join ${fieldProvenance} fp on fp.entity_type = 'event' and fp.entity_id = e.id
      where fp.source_id = ${source.id}
        and fp.field in ('doors_at', 'lesson_at', 'dancing_at', 'ends_at')
        and e.night_date = any(${nightList}::date[])
        and ${isPlaceholder(provenanceInstant("fp"), sql`e.tz`)}
    `);
    const ids = [...marked].map((r) => r.id);
    if (ids.length === 0) return { ids, lost: [] };
    const idList = `{${ids.join(",")}}`;

    // A field is cleared when it holds a placeholder and no current fact states that instant.
    const cleared = (field: string, column: AnyColumn) => sql`case
      when ${isPlaceholder(sql`${column}`, sql`${events.tz}`)}
        and not exists (select 1 from ${fieldProvenance} cur
          where cur.entity_type = 'event' and cur.entity_id = ${events.id}
            and cur.field = ${field} and cur.is_current
            and ${provenanceInstant("cur")} = ${column})
      then null else ${column} end`;
    const rows = await tx.execute<{ id: string; had_start: boolean; has_start: boolean }>(sql`
      update ${events} set
        doors_at = ${cleared("doors_at", events.doorsAt)},
        lesson_at = ${cleared("lesson_at", events.lessonAt)},
        dancing_at = ${cleared("dancing_at", events.dancingAt)},
        ends_at = ${cleared("ends_at", events.endsAt)},
        updated_at = now()
      from (select id, starts_at is not null as had_start from ${events}
        where id = any(${idList}::uuid[])) old_row
      where ${events.id} = old_row.id
      returning ${events.id} as id, old_row.had_start,
        coalesce(${events.dancingAt}, ${events.lessonAt}, ${events.doorsAt}) is not null as has_start
    `);
    return { ids, lost: [...rows].filter((r) => r.had_start && !r.has_start).map((r) => r.id) };
  });
  const { ids, lost } = result;

  // Another source's timed listing merged into a row that lost its start gives it back its times.
  await refillTimesFromMerges(db, lost);
  // No current start fact left that disagrees with the row's own times: not conflicting.
  if (ids.length > 0) {
    await db.execute(sql`
      update ${events} e set confirmation = 'recurring_unconfirmed', updated_at = now()
      where e.id = any(${`{${ids.join(",")}}`}::uuid[]) and e.confirmation = 'conflicting'
        and not exists (select 1 from ${fieldProvenance} cur
          where cur.entity_type = 'event' and cur.entity_id = e.id and cur.is_current
            and cur.field in ('doors_at', 'lesson_at', 'dancing_at')
            and ${provenanceInstant("cur")} is distinct from case cur.field
              when 'doors_at' then e.doors_at when 'lesson_at' then e.lesson_at
              else e.dancing_at end)
    `);
  }
  return {
    cleared: lost.length,
    notes:
      lost.length > 0
        ? [
            `${lost.length} stored listing(s) showed ${placeholders.join(" or ")}, which this site prints on every event: that time is withdrawn`,
          ]
        : [],
  };
}

/**
 * A row whose placeholder time was withdrawn (`clearPlaceholderTimes`, in this run or an earlier
 * one) gives way to this run's listing of the same source, night and title: the untimed listing
 * that replaces it, or, when the source now states a time, the timed one (a night this source lists
 * with a time is not also listed without one, D-060 point 7), or, for a row that kept a stated time
 * of its own, the listing at that same time. The row is retired into it (`retireInto`). Only rows
 * that match exactly are touched: written by this source, not written by this run, and holding
 * this source's withdrawn provenance for a placeholder start.
 */
export async function retireClearedPlaceholders(
  db: Db,
  args: {
    source: Source;
    placeholders: readonly string[];
    writtenIds: readonly string[];
    nights: readonly string[];
  },
): Promise<{ retired: number; notes: string[] }> {
  const { source, placeholders, writtenIds, nights } = args;
  if (placeholders.length === 0 || writtenIds.length === 0 || nights.length === 0)
    return { retired: 0, notes: [] };
  const rows = await db
    .select({
      id: events.id,
      night: events.nightDate,
      title: events.title,
      titleNormalized: events.titleNormalized,
      startsAt: events.startsAt,
    })
    .from(events)
    .where(
      and(
        inArray(events.nightDate, [...nights]),
        inArray(events.status, ["active", "cancelled"]),
        writtenBy(source.id),
        notInArray(events.id, [...writtenIds]),
        sql`exists (select 1 from ${fieldProvenance} fp
          where fp.entity_type = 'event' and fp.entity_id = ${events.id}
            and fp.source_id = ${source.id} and not fp.is_current
            and fp.field in (${sql.join(
              START_FIELDS.map((f) => sql`${f}`),
              sql`, `,
            )})
            and to_char(${provenanceInstant("fp")} at time zone ${events.tz}, 'HH24:MI') = any(${`{${placeholders.join(",")}}`}::text[]))`,
      ),
    );
  if (rows.length === 0) return { retired: 0, notes: [] };
  const written = await db
    .select({
      id: events.id,
      night: events.nightDate,
      titleNormalized: events.titleNormalized,
      startsAt: events.startsAt,
    })
    .from(events)
    .where(inArray(events.id, [...writtenIds]))
    .orderBy(sql`${events.startsAt} asc nulls first`, events.id);

  let retired = 0;
  const notes: string[] = [];
  for (const row of rows) {
    const same = written.filter(
      (w) => w.night === row.night && w.titleNormalized === row.titleNormalized,
    );
    const untimedId = pipelineId(
      "event",
      `${source.id}:${untimedKey(row.night, row.titleNormalized)}`,
    );
    const replacement =
      row.startsAt === null
        ? (same.find((w) => w.id === untimedId) ?? same.find((w) => w.startsAt !== null))
        : same.find((w) => w.startsAt?.getTime() === row.startsAt?.getTime());
    if (!replacement || replacement.id === row.id) continue;
    await retireInto(db, row.id, replacement.id);
    retired += 1;
    notes.push(
      `${row.title}: the listing stored on ${row.night} with this site's placeholder time was replaced by ${replacement.startsAt === null ? "the listing with no time" : "this run's listing"}`,
    );
  }
  return { retired, notes };
}

/** The evidence for a field: the listing's own quote, or a plain statement of how it was decided. */
function evidenceFor(event: NormalizedEvent, field: string, evidenceKey: string): string | null {
  const quote = event.evidence[evidenceKey] ?? event.evidence[field];
  if (quote) return quote.slice(0, 300);
  if (field === "night_date") {
    // Structured sources quote their start ("DTSTART 2026-10-02", "startDate 2026-10-02"); the
    // model quotes the recurrence phrase for a night that came from a rule.
    const night = event.evidence.start ?? event.evidence.recurrence_text;
    if (night) return night.slice(0, 300);
  }
  if (field === "styles") {
    if (event.stylesFrom === "title") return `matched in the title: ${event.title}`.slice(0, 300);
    if (event.stylesFrom === "source_hint") return "the source lists only this style";
    if (event.stylesFrom === "listing_type") return "a club night that names no style";
  }
  return null;
}

function meanOf(values: Record<string, number>): number | null {
  const list = Object.values(values);
  return list.length ? list.reduce((a, b) => a + b, 0) / list.length : null;
}

/**
 * Rows a page no longer lists (D-070). Called only after a complete, successful read of the page
 * (every part read, nothing deferred) that wrote at least one listing: this source's active or
 * cancelled rows on the given nights (the window after tonight) that this run neither wrote nor
 * kept are retired, status `removed`. They are what an earlier read put on the wrong night (a date
 * the model invented where the page states "every Thursday", D-070), a time the page has changed,
 * or a night the page has dropped. Tonight is never passed in: a night already under way is left
 * to the day-of check. Nothing is deleted. Rows of other sources that dedupe had merged into a
 * retired row stand on their own again, for the next dedupe to pair; this source's own rows merged
 * into it that this run did not list are retired with it. A retired row points at nothing
 * (`merged_into_id` null), which is how a later read that lists it again brings it back
 * (`writeEvents`, review 2026-09-28).
 *
 * `titles` narrows it to the rows under those titles (D-073): listings the read rejected because
 * the page does not write them. Their rows go even when the read listed nothing else, since the
 * page was checked and does not write them; without `titles`, a read that listed nothing retires
 * nothing.
 *
 * `ungroundedIn`, the text of a page read whole (D-074), narrows it instead to the rows whose title
 * that text does not write (`findPhrase`, as D-073 checks a read's titles), and retires them even
 * when the read listed nothing: a page that no longer writes a title no longer lists its nights,
 * whatever the model said of it. A row whose title the page still writes is kept.
 *
 * `unsupportedIn`, the text of a page read whole, narrows it instead to the rows that the page no
 * longer gives on their night: the title is not written, or no date or weekday of the night beside
 * it (owner, 2026-10-23). A page that still writes a night keeps it.
 *
 * `exceptTitles` leaves the rows under those titles out, and `keep` any row it answers true for
 * (review 2026-09-29): a title the page writes whose recurrence it does not is never retired as
 * unlisted, only on the nights its caller gives and `keep` does not keep. `what` words the note.
 *
 * `keepStated`, the text of the page read, keeps a row the page still supports (D-079): its title
 * is written, its date is stated, and the read listed nothing of this source's on that night. The
 * model missing a night the page plainly gives is its recall, not the page's word: Frim Fram Jam's
 * page wrote "October 1, 2026" under its title, the read gave that night a title the page does
 * not write, and the stored October 1 row was retired (run 29). A night the read did list
 * something on (a renamed night, a changed time) is the page's current word and still retires.
 * A title the page lists only under other nights' headings is not supported on this one (D-074).
 * The same test lists again a row an earlier read retired that the page still supports: run 29's
 * October 1 row comes back on the next run, not only when the model next reads that night. Never
 * beside a row of this source's that stands for the same title and night (seam review,
 * 2026-09-29): that night is listed already.
 *
 * `contradictedIn`, a page's whole text, narrows it instead to the rows whose title that text
 * writes and whose night its own words contradict (`contradictingDate`, D-080): the title listed
 * only under other nights' headings, or its own block giving it another date. The check needs no
 * model, so it is called after every read of the page, whole, partial or none at all, with tonight
 * among the nights.
 */
export async function retireUnlisted(
  db: Db,
  args: {
    source: Source;
    listedIds: readonly string[];
    nights: readonly string[];
    titles?: readonly string[];
    ungroundedIn?: string;
    unsupportedIn?: { text: string; lang?: string | null };
    exceptTitles?: readonly string[];
    keep?: (row: { title: string; night: string }) => boolean;
    keepStated?: { text: string; lang?: string | null; titles?: readonly string[] };
    contradictedIn?: { text: string; lang?: string | null; titles?: readonly string[] };
    what?: string;
    /** The source's venue-calendar flags: a row their screen leaves out is not listed again (D-501). */
    screen?: VenueCalendarFlags;
    /** Note the rows it would retire and change nothing (D-880). */
    logOnly?: true;
  },
): Promise<{ retired: number; notes: string[] }> {
  const { source, listedIds, nights } = args;
  const titles = args.titles?.map((t) => normalizeForMatch(t)).filter(Boolean) ?? null;
  const except = args.exceptTitles?.map((t) => normalizeForMatch(t)).filter(Boolean) ?? [];
  const page = args.ungroundedIn !== undefined ? foldPage(args.ungroundedIn) : null;
  const unsupported = args.unsupportedIn ? foldPage(args.unsupportedIn.text) : null;
  const contra = args.contradictedIn ? foldPage(args.contradictedIn.text) : null;
  if (nights.length === 0) return { retired: 0, notes: [] };
  if (
    page === null &&
    unsupported === null &&
    contra === null &&
    (titles === null ? listedIds.length === 0 : titles.length === 0)
  ) {
    return { retired: 0, notes: [] };
  }
  // drizzle's notInArray reads an empty list as `true` (drizzle-orm 0.45); spelled out here too.
  const notListed = listedIds.length > 0 ? notInArray(events.id, [...listedIds]) : sql`true`;
  const found = await db
    .select({ id: events.id, night: events.nightDate, title: events.title })
    .from(events)
    .where(
      and(
        inArray(events.nightDate, [...nights]),
        inArray(events.status, ["active", "cancelled"]),
        writtenBy(source.id),
        notListed,
        titles ? inArray(events.titleNormalized, titles) : sql`true`,
        except.length > 0 ? notInArray(events.titleNormalized, except) : sql`true`,
      ),
    )
    .orderBy(events.nightDate, events.title);
  let stated: ((row: { title: string; night: string }) => boolean) | null = null;
  const restored: Array<{ title: string; night: string }> = [];
  if (args.keepStated) {
    const { text, lang } = args.keepStated;
    const folded = foldPage(text);
    const bounds = args.keepStated.titles ?? [];
    const listedNights = new Set(
      listedIds.length > 0
        ? (
            await db
              .select({ night: events.nightDate })
              .from(events)
              .where(inArray(events.id, [...listedIds]))
          ).map((r) => r.night)
        : [],
    );
    stated = (row) =>
      !listedNights.has(row.night) &&
      findPhrase(folded, row.title) !== null &&
      dateBesideTitle(folded, row.title, row.night, lang, bounds).stated &&
      !listedOnlyUnderOtherDates(text, row.title, row.night, lang);
    const gone = await db
      .select({
        id: events.id,
        night: events.nightDate,
        title: events.title,
        titleNormalized: events.titleNormalized,
        styles: events.styles,
        startsAt: events.startsAt,
        tz: events.tz,
        venueName: venues.name,
      })
      .from(events)
      .leftJoin(venues, eq(venues.id, events.venueId))
      .where(
        and(
          inArray(events.nightDate, [...nights]),
          eq(events.status, "removed"),
          isNull(events.mergedIntoId),
          writtenBy(source.id),
          notListed,
          titles ? inArray(events.titleNormalized, titles) : sql`true`,
          except.length > 0 ? notInArray(events.titleNormalized, except) : sql`true`,
        ),
      )
      .orderBy(events.nightDate, events.title);
    // One row per title and night: two retired rows of one night (a time that changed) stay off,
    // and so does one whose title and night this source still lists: a row standing, merged into
    // another source's listing of the night, or the untimed listing a withdrawn time was retired
    // into (D-081), whose timed row points at it and so is not counted here. Restored beside it,
    // an old time the page no longer writes would list
    // the night twice (seam review, 2026-09-29). Two sessions of one title on one night are one
    // key too: a missed one stays off until a read lists it again.
    const perNight = new Map<string, number>();
    for (const row of gone) {
      const key = `${row.titleNormalized}|${row.night}`;
      perNight.set(key, (perNight.get(key) ?? 0) + 1);
    }
    if (gone.length > 0) {
      const standing = await db
        .select({ titleNormalized: events.titleNormalized, night: events.nightDate })
        .from(events)
        .where(
          and(
            inArray(events.nightDate, [...new Set(gone.map((r) => r.night))]),
            inArray(events.status, ["active", "cancelled", "merged"]),
            writtenBy(source.id),
          ),
        );
      for (const row of standing) perNight.set(`${row.titleNormalized}|${row.night}`, Infinity);
    }
    for (const row of gone) {
      if (screenTitle(row.title, row.venueName)) continue; // a screened title stays off (D-156)
      // ...and so does one the source's venue-calendar screen leaves out (D-501).
      if (
        args.screen &&
        screenStoredRow(
          {
            title: row.title,
            styles: row.styles ?? [],
            startsAt: row.startsAt,
            nightDate: row.night,
            tz: row.tz,
            venueName: row.venueName,
          },
          args.screen,
        )
      )
        continue;
      if (perNight.get(`${row.titleNormalized}|${row.night}`) !== 1) continue;
      if (!stated(row) || args.logOnly) continue;
      await db
        .update(events)
        .set({
          status: sql`case when ${events.confirmation} = 'cancelled' then 'cancelled'::event_status else 'active'::event_status end`,
          updatedAt: new Date(),
        })
        .where(eq(events.id, row.id));
      restored.push({ title: row.title, night: row.night });
    }
  }
  const rows = found.filter(
    (row) =>
      (!page || findPhrase(page, row.title) === null) &&
      (!unsupported ||
        findPhrase(unsupported, row.title) === null ||
        !(
          dateBesideTitle(unsupported, row.title, row.night, args.unsupportedIn?.lang, []).stated ||
          weekdaysNearTitle(unsupported, row.title, args.unsupportedIn?.lang, []).has(
            weekdayCodeOf(row.night),
          )
        )) &&
      (!contra ||
        contradictingDate(
          contra,
          args.contradictedIn!.text,
          row.title,
          row.night,
          args.contradictedIn!.lang,
          args.contradictedIn!.titles ?? [],
        ) !== null) &&
      !args.keep?.({ title: row.title, night: row.night }) &&
      !stated?.({ title: row.title, night: row.night }),
  );
  if (args.logOnly) {
    if (rows.length === 0) return { retired: 0, notes: [] };
    const named = rows.slice(0, 12).map((r) => `${r.title} on ${r.night}`);
    const more = rows.length > named.length ? `, and ${rows.length - named.length} more` : "";
    return {
      retired: 0,
      notes: [
        `log only (D-880): ${rows.length} stored listing(s) this page no longer lists would be retired: ${named.join("; ")}${more}`,
      ],
    };
  }
  for (const row of rows) await retireRow(db, source, row.id, listedIds);
  const restoredNote =
    restored.length > 0
      ? [
          `${restored.length} listing(s) retired before that the page still writes were listed again: ${restored
            .slice(0, 12)
            .map((r) => `${r.title} on ${r.night}`)
            .join("; ")}${restored.length > 12 ? `, and ${restored.length - 12} more` : ""}`,
        ]
      : [];
  if (rows.length === 0) return { retired: 0, notes: restoredNote };
  const named = rows.slice(0, 12).map((r) => `${r.title} on ${r.night}`);
  const more = rows.length > named.length ? `, and ${rows.length - named.length} more` : "";
  let note: string;
  if (args.what) {
    note = `${rows.length} stored listing(s) ${args.what} were retired: ${named.join("; ")}${more}`;
  } else if (unsupported) {
    note = `${rows.length} stored listing(s) the page no longer gives on their night were retired: ${named.join("; ")}${more}`;
  } else if (page) {
    note = `${rows.length} stored listing(s) whose title the page no longer writes were retired: ${named.join("; ")}${more}`;
  } else {
    note = `${rows.length} stored listing(s) this page no longer lists were retired: ${named.join("; ")}${more}`;
  }
  return {
    retired: rows.length,
    notes: [...restoredNote, note],
  };
}

/**
 * This source's stored rows that no read has vouched for the times of this run, as the untimed
 * listings that replace them (seam review, 2026-09-29): a timed row on one of `nights` that the
 * read did not list (`listedIds`, nor any row of its title on its night), that no other source
 * lists, whose title the page writes, and whose times the listing's own part of the page does not
 * (`ownPageTimes`, `pageWritesRowTimes`). Frim Fram Jam's October 1 row, stored by an early read at
 * 7:30pm to 10:30pm, stayed on because the page still writes the title and the night, though its
 * part writes 8:30pm and 9pm. Each comes back as the listing D-081 writes for a withdrawn time
 * (`timesWithdrawn`), with the row's title, type, styles, night, zone, point and link and nothing
 * else: a row whose times the page does not write is not the page's word on the rest either. The
 * caller writes them (`writeEvents`), which retires the timed row into its untimed listing, or
 * keeps a sibling whose every time the page does write.
 */
export async function untimedForUnwrittenTimes(
  db: DbOrTx,
  args: {
    source: Source;
    listedIds: readonly string[];
    nights: readonly string[];
    text: string;
    lang?: string | null;
    titles?: readonly string[];
    now: Date;
  },
): Promise<NormalizedEvent[]> {
  const { source, listedIds, nights, text, lang, now } = args;
  if (nights.length === 0 || !text.trim()) return [];
  const listed =
    listedIds.length === 0
      ? new Set<string>()
      : new Set(
          (
            await db
              .select({ titleNormalized: events.titleNormalized, night: events.nightDate })
              .from(events)
              .where(inArray(events.id, [...listedIds]))
          ).map((r) => `${r.titleNormalized}|${r.night}`),
        );
  const rows = await db
    .select({
      id: events.id,
      title: events.title,
      titleNormalized: events.titleNormalized,
      listingType: events.listingType,
      styles: events.styles,
      night: events.nightDate,
      tz: events.tz,
      lat: sql<number | null>`ST_Y(${events.geo}::geometry)`,
      lng: sql<number | null>`ST_X(${events.geo}::geometry)`,
      status: events.status,
      confirmation: events.confirmation,
      canonicalUrl: events.canonicalUrl,
      lastVerifiedAt: events.lastVerifiedAt,
      ...rowTimesColumns(),
    })
    .from(events)
    .where(
      and(
        inArray(events.nightDate, [...nights]),
        inArray(events.status, ["active", "cancelled"]),
        sql`${events.startsAt} is not null`,
        sql`cardinality(${events.sourceIds}) = 1`,
        writtenBy(source.id),
        listedIds.length > 0 ? notInArray(events.id, [...listedIds]) : sql`true`,
      ),
    )
    .orderBy(events.nightDate, events.title);
  // A night a rule gave (never verified by a dated listing) is checked as the read checked it, by
  // the rule's own part and no date. And a row's times are unwritten only when the page writes
  // them by neither layout (cards dated above their titles, or titles written first): with no
  // read's titles to vote it, a title-first list could be read as cards and every item given the
  // previous one's time (review of the seam fixes, 2026-09-29).
  const dateOf = (row: (typeof rows)[number]) => (row.lastVerifiedAt === null ? null : row.night);
  const pageTimesOf = (row: (typeof rows)[number], layout?: boolean) =>
    ownPageTimes(titleBlocks(text, row.title, args.titles ?? [], lang, layout), dateOf(row), lang);
  const stale = rows.filter((row) => {
    if (listed.has(`${row.titleNormalized}|${row.night}`)) return false;
    if (titleBlocks(text, row.title, args.titles ?? [], lang).length === 0) return false;
    return [true, false].every((layout) => !pageWritesRowTimes(row, pageTimesOf(row, layout)));
  });
  if (stale.length === 0) return [];
  const quotes = await db
    .select({
      entityId: fieldProvenance.entityId,
      field: fieldProvenance.field,
      evidence: fieldProvenance.evidence,
    })
    .from(fieldProvenance)
    .where(
      and(
        eq(fieldProvenance.entityType, "event"),
        inArray(
          fieldProvenance.entityId,
          stale.map((r) => r.id),
        ),
        eq(fieldProvenance.sourceId, source.id),
        eq(fieldProvenance.isCurrent, true),
        inArray(fieldProvenance.field, ["title", "night_date"]),
      ),
    );
  const quoteOf = (id: string, field: string) =>
    quotes.find((q) => q.entityId === id && q.field === field)?.evidence ?? null;
  const byNight = new Map<string, NormalizedEvent>();
  for (const row of stale) {
    const key = untimedKey(row.night, row.titleNormalized);
    if (byNight.has(key)) continue;
    const page = pageTimesOf(row);
    const title = quoteOf(row.id, "title");
    const night = quoteOf(row.id, "night_date");
    byNight.set(key, {
      key,
      title: row.title,
      titleNormalized: row.titleNormalized,
      listingType: row.listingType,
      styles: row.styles as NormalizedEvent["styles"],
      stylesFrom: "title",
      doorsAt: null,
      lessonAt: null,
      dancingAt: null,
      endsAt: null,
      startsAt: null,
      nightDate: row.night,
      tz: row.tz,
      prices: [],
      isFree: null,
      ticketUrl: null,
      canonicalUrl: row.canonicalUrl,
      eventUrl: null,
      level: null,
      partnerRequired: null,
      ageMin: null,
      dressCode: null,
      floor: null,
      indoorOutdoor: null,
      music: null,
      crowdSizeHint: null,
      cancelled: row.status === "cancelled",
      confirmation: row.confirmation,
      fromRule: false,
      timesWithdrawn: { pageStarts: page.starts, pageEnds: page.ends },
      // No venue to place: the timed row's venue and point pass to it as it is retired into it
      // (`retireTimedInto`), where placing it again by its point could take another venue there.
      venue: { name: null, address: null, url: null, location: null },
      organizer: { name: null, url: null },
      withdrawn: [],
      evidence: {
        ...(title ? { title } : {}),
        ...(night ? { local_date: night } : {}),
      },
      confidence: {},
      provenance: { sourceUrl: source.url, fetchedAt: now, method: "llm" },
    });
  }
  return [...byNight.values()];
}

/**
 * Retires one of this source's rows as unlisted (`retireUnlisted`): `removed`, pointing at nothing,
 * so a later read that lists it again brings it back.
 */
/**
 * Lists again, each on its own, the rows merged into a row that was just taken off the site:
 * another source's listing of the night must not stay hidden behind a listing that is gone
 * (lane 1, D-090).
 */
export async function releaseMergedInto(db: DbOrTx, rowId: string): Promise<void> {
  await db
    .update(events)
    .set({
      status: sql`case when ${events.confirmation} = 'cancelled' then 'cancelled'::event_status else 'active'::event_status end`,
      mergedIntoId: null,
      updatedAt: new Date(),
    })
    .where(and(eq(events.mergedIntoId, rowId), eq(events.status, "merged")));
}

export async function retireRow(
  db: Db,
  source: Source,
  rowId: string,
  listedIds: readonly string[],
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(events)
      .set({ status: "removed", mergedIntoId: null, updatedAt: new Date() })
      .where(eq(events.id, rowId));
    // This source's own rows merged into it (its untimed listing of the night, merged when the
    // night gained a time) go with it: the page no longer lists them either, and brought back
    // they would list the night twice or keep a night the page dropped (review, 2026-09-28).
    await tx
      .update(events)
      .set({ status: "removed", mergedIntoId: null, updatedAt: new Date() })
      .where(
        and(
          eq(events.mergedIntoId, rowId),
          eq(events.status, "merged"),
          writtenBy(source.id),
          listedIds.length > 0 ? notInArray(events.id, [...listedIds]) : sql`true`,
        ),
      );
    await tx
      .update(events)
      .set({
        status: sql`case when ${events.confirmation} = 'cancelled' then 'cancelled'::event_status else 'active'::event_status end`,
        mergedIntoId: null,
        updatedAt: new Date(),
      })
      .where(and(eq(events.mergedIntoId, rowId), eq(events.status, "merged")));
    // A listed row retired into a sibling the page has now dropped stands again.
    if (listedIds.length > 0) {
      await tx
        .update(events)
        .set({
          status: sql`case when ${events.confirmation} = 'cancelled' then 'cancelled'::event_status else 'active'::event_status end`,
          mergedIntoId: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(events.mergedIntoId, rowId),
            eq(events.status, "removed"),
            inArray(events.id, [...listedIds]),
          ),
        );
    }
  });
}

/**
 * Events this source listed before for nights in the window that it no longer lists. They are
 * not deleted: the store marks the link stale by leaving `last_seen_at` behind, and events whose
 * only source dropped them are returned so the job can report them. Removal is a Phase 3
 * verification decision, not a harvest one.
 */
export async function droppedBySource(
  db: Db,
  sourceId: string,
  seenEventIds: readonly string[],
  nights: readonly string[],
): Promise<string[]> {
  if (nights.length === 0) return [];
  const rows = await db
    .select({ id: events.id })
    .from(events)
    .innerJoin(eventSources, eq(eventSources.eventId, events.id))
    .where(
      and(
        eq(eventSources.sourceId, sourceId),
        inArray(events.nightDate, [...nights]),
        sql`cardinality(${events.sourceIds}) = 1`,
        seenEventIds.length > 0 ? notInArray(events.id, [...seenEventIds]) : sql`true`,
      ),
    );
  return rows.map((r) => r.id);
}

/**
 * Retires this source's stored rows on `nights` that its screens now leave out (PR 2): the rows of
 * items its adapter read and left out as no dance night (`keys`, the listing's `externalId`), and
 * the rows `reject` names a reason for, from the stored title, styles, kind and start. A screen
 * that changes (Ticketmaster's genre no longer a style, a price line no longer an event) otherwise
 * leaves the rows it wrote before on the site until their nights pass: nothing writes them again,
 * and a feed or an API retires nothing it does not list. Tonight included, as for a night the
 * page contradicts (D-079): the row was never a dance night.
 */
export async function retireScreened(
  db: Db,
  args: {
    source: Source;
    nights: readonly string[];
    keys?: readonly string[];
    reject?: (row: {
      id: string;
      title: string;
      styles: readonly string[];
      listingType: NormalizedEvent["listingType"];
      startsAt: Date | null;
      nightDate: string;
      tz: string;
    }) => string | null;
  },
): Promise<{ retired: number; notes: string[] }> {
  const { source, nights } = args;
  if (nights.length === 0) return { retired: 0, notes: [] };
  const keyed = (args.keys ?? []).map((key) => pipelineId("event", `${source.id}:${key}`));
  const rows = await db
    .select({
      id: events.id,
      title: events.title,
      styles: events.styles,
      listingType: events.listingType,
      startsAt: events.startsAt,
      nightDate: events.nightDate,
      tz: events.tz,
    })
    .from(events)
    .where(
      and(
        inArray(events.nightDate, [...nights]),
        inArray(events.status, ["active", "cancelled"]),
        writtenBy(source.id),
      ),
    )
    .orderBy(events.nightDate, events.title);
  const gone: string[] = [];
  for (const row of rows) {
    const reason = keyed.includes(row.id)
      ? "not a dance night"
      : (args.reject?.({ ...row, styles: row.styles ?? [] }) ?? null);
    if (!reason) continue;
    await retireRow(db, source, row.id, []);
    gone.push(`${row.title} on ${row.nightDate} (${reason})`);
  }
  const notes =
    gone.length > 0
      ? [
          `${gone.length} stored listing(s) that are not dance nights were retired: ${gone.slice(0, 12).join("; ")}${gone.length > 12 ? `, and ${gone.length - 12} more` : ""}`,
        ]
      : [];
  return { retired: gone.length, notes };
}

/**
 * Takes off the site the metro's stored listings on `nights` whose map point is outside its
 * outline (D-084: New York is the five boroughs). Rows written while the metro was a 40 km circle
 * (a concert at Prudential Center in Newark) would otherwise stay until their nights pass. A row
 * with no point is left to `placeUnplaced` and the out-of-metro check. Each is named.
 *
 * Also takes off the stored rows with no point and no venue whose title names a town outside the
 * metro (`titleNamesOutsideTown`, 2026-10-20). That part needs no outline, so it runs for a metro
 * with none.
 */
export async function retireOutsideMetro(
  db: Db,
  args: { metro: Metro; nights: readonly string[] },
): Promise<{ retired: number; notes: string[] }> {
  const { metro, nights } = args;
  if (nights.length === 0) return { retired: 0, notes: [] };
  const hasBounds = METRO_BOUNDS[metro.slug] !== undefined;
  const rows = hasBounds
    ? await db.execute<{
        id: string;
        title: string;
        night: string;
        lat: number;
        lng: number;
      }>(sql`
    select e.id, e.title, e.night_date::text as night,
      ST_Y(e.geo::geometry) as lat, ST_X(e.geo::geometry) as lng
    from ${events} e
    where e.metro_id = ${metro.id} and e.geo is not null
      and e.status in ('active', 'cancelled')
      and e.night_date = any(${`{${nights.join(",")}}`}::date[])
    order by e.night_date, e.title, e.id
  `)
    : [];
  const gone: string[] = [];
  for (const row of rows) {
    if (insideMetro(metro, { lat: Number(row.lat), lng: Number(row.lng) })) continue;
    await db
      .update(events)
      .set({ status: "removed", mergedIntoId: null, updatedAt: new Date() })
      .where(eq(events.id, row.id));
    await releaseMergedInto(db, row.id);
    gone.push(`${row.title} on ${row.night}`);
  }
  // Rows with no point and no venue whose title names a town outside the metro.
  const placeless = await db.execute<{ id: string; title: string; night: string }>(sql`
    select e.id, e.title, e.night_date::text as night
    from ${events} e
    where e.metro_id = ${metro.id} and e.geo is null and e.venue_id is null
      and e.status in ('active', 'cancelled')
      and e.night_date = any(${`{${nights.join(",")}}`}::date[])
    order by e.night_date, e.title, e.id
  `);
  for (const row of placeless) {
    const town = titleNamesOutsideTown(metro.slug, row.title);
    if (!town) continue;
    await db
      .update(events)
      .set({ status: "removed", mergedIntoId: null, updatedAt: new Date() })
      .where(eq(events.id, row.id));
    await releaseMergedInto(db, row.id);
    gone.push(`${row.title} on ${row.night} (the title names ${town})`);
  }
  const notes =
    gone.length > 0
      ? [
          `${gone.length} stored listing(s) outside ${metro.name} were taken off the site: ${gone.slice(0, 12).join("; ")}${gone.length > 12 ? `, and ${gone.length - 12} more` : ""}`,
        ]
      : [];
  return { retired: gone.length, notes };
}

/**
 * Takes off the site stored listings whose titles the screens leave out, whatever source stored them
 * (owner, 2026-10-19). `screenTitle` reads only the title, so it can be applied to every stored row
 * regardless of source.
 */
export async function retireScreenedTitles(
  db: Db,
  args: { metro: Metro; nights: readonly string[] },
): Promise<{ retired: number; notes: string[] }> {
  const { metro, nights } = args;
  if (nights.length === 0) return { retired: 0, notes: [] };
  const rows = await db.execute<{
    id: string;
    title: string;
    night: string;
    venue_name: string | null;
  }>(sql`
    select e.id, e.title, e.night_date::text as night, v.name as venue_name
    from ${events} e
    left join ${venues} v on v.id = e.venue_id
    where e.metro_id = ${metro.id}
      and e.status in ('active', 'cancelled')
      and e.night_date = any(${`{${nights.join(",")}}`}::date[])
    order by e.night_date, e.title, e.id
  `);
  const gone: string[] = [];
  for (const row of rows) {
    const screened = screenTitle(row.title, row.venue_name);
    if (!screened) continue;
    await db.transaction(async (tx) => {
      await tx
        .update(events)
        .set({ status: "removed", mergedIntoId: null, updatedAt: new Date() })
        .where(eq(events.id, row.id));
      // Rows merged into this one go with it, not released to active.
      await tx
        .update(events)
        .set({ status: "removed", mergedIntoId: null, updatedAt: new Date() })
        .where(and(eq(events.mergedIntoId, row.id), eq(events.status, "merged")));
    });
    gone.push(`${row.title} on ${row.night} (${screened.reason})`);
  }
  const notes =
    gone.length > 0
      ? [
          `${gone.length} stored listing(s) whose titles the screens leave out were taken off the site: ${gone.slice(0, 12).join("; ")}${gone.length > 12 ? `, and ${gone.length - 12} more` : ""}`,
        ]
      : [];
  return { retired: gone.length, notes };
}

/**
 * Restores class-like listings that were merged by the old same-times sibling rule (owner, 2026-10-19).
 * The rule merged parallel studio classes (Swingiversity Level 1 into a Level 2 choreo class) because
 * they shared venue, night, start and end. This brings them back.
 */
export async function restoreMergedClasses(
  db: Db,
  args: { metro: Metro; nights: readonly string[] },
): Promise<{ restored: number; notes: string[] }> {
  const { metro, nights } = args;
  if (nights.length === 0) return { restored: 0, notes: [] };
  const pairs = await db.execute<{
    id: string;
    title: string;
    listing_type: string | null;
    night: string;
    keeper_title: string;
    keeper_type: string | null;
  }>(sql`
    select r.id, r.title, r.listing_type, r.night_date::text as night,
           k.title as keeper_title, k.listing_type as keeper_type
    from ${events} r join ${events} k on k.id = r.merged_into_id
    where r.metro_id = ${metro.id} and r.status = 'removed'
      and k.status in ('active', 'cancelled')
      and r.night_date = any(${`{${nights.join(",")}}`}::date[]) and r.night_date = k.night_date
      and r.venue_id is not null and r.venue_id = k.venue_id
      and r.starts_at = k.starts_at and r.ends_at is not null and r.ends_at = k.ends_at
      and r.title_normalized <> k.title_normalized
      and exists (select 1 from ${eventSources} a join ${eventSources} b on b.source_id = a.source_id
                  where a.event_id = r.id and a.role = 'primary' and b.event_id = k.id and b.role = 'primary')
    order by night, r.title, r.id
  `);
  const restored: string[] = [];
  for (const row of pairs) {
    const rClass = isClassLike({ title: row.title, listingType: row.listing_type });
    const kClass = isClassLike({ title: row.keeper_title, listingType: row.keeper_type });
    if (!rClass && !kClass) continue;
    await db
      .update(events)
      .set({
        status: sql`case when ${events.confirmation} = 'cancelled' then 'cancelled'::event_status else 'active'::event_status end`,
        mergedIntoId: null,
        updatedAt: new Date(),
      })
      .where(eq(events.id, row.id));
    restored.push(`${row.title} on ${row.night}`);
  }
  const notes =
    restored.length > 0
      ? [
          `${restored.length} class(es) merged by the old same-times rule were listed again: ${restored.slice(0, 12).join("; ")}${restored.length > 12 ? `, and ${restored.length - 12} more` : ""}`,
        ]
      : [];
  return { restored: restored.length, notes };
}

/**
 * Takes a retired starting address's own listings off the site (docs/WORKSTREAMS.md): its rows on
 * `nights` (tonight onwards) whose primary source it is. Switching the source off stops it being
 * read, but nothing else would ever retire what it stored: a feed's or a page's rows go only after
 * that source's own complete read (D-070), which a retired source never has again. A seed that is
 * re-pointed to a new address would otherwise list every night twice, the old address's row
 * beside the new one's. Each row is named in the report.
 *
 * Its merged rows go too, else retiring the row they were merged into releases them back onto the
 * site (Ritmos / Boat Parties, 2026-10-18).
 */
/**
 * Retires an eventPageWeekly source's rule rows after `after` that it has not confirmed since
 * `cutoff` (D-465): a calendar that gives a weekly night only for its next date (DanceUS's rolling
 * window) is never a whole read, so a series it stopped listing would otherwise stay on the site
 * until its nights pass. The cutoff (8 days) is longer than the calendar's window, so one read in
 * which the night falls outside it drops nothing.
 */
export async function retireStaleWeekly(
  db: Db,
  args: { source: Source; after: string; cutoff: Date },
): Promise<{ retired: number; notes: string[] }> {
  const { source, after, cutoff } = args;
  const rows = await db
    .select({ id: events.id, title: events.title, nightDate: events.nightDate })
    .from(events)
    .where(
      and(
        sql`${events.nightDate} > ${after}`,
        inArray(events.status, ["active", "cancelled"]),
        eq(events.confirmation, "recurring_unconfirmed"),
        sql`exists (select 1 from ${eventSources} es where es.event_id = ${events.id} and es.source_id = ${source.id} and es.role = 'primary' and es.last_seen_at < ${cutoff.toISOString()})`,
      ),
    )
    .orderBy(events.nightDate, events.title);
  for (const row of rows) await retireRow(db, source, row.id, []);
  const named = rows.map((r) => `${r.title} on ${r.nightDate}`);
  const notes =
    rows.length > 0
      ? [
          `${rows.length} weekly listing(s) this calendar has not given for 8 days were taken off the site: ${named.slice(0, 12).join("; ")}${named.length > 12 ? `, and ${named.length - 12} more` : ""}`,
        ]
      : [];
  return { retired: rows.length, notes };
}

export async function retireRowsOfRetiredSource(
  db: Db,
  args: { source: Source; nights: readonly string[] },
): Promise<{ retired: number; notes: string[] }> {
  const { source, nights } = args;
  if (nights.length === 0) return { retired: 0, notes: [] };
  const rows = await db
    .select({
      id: events.id,
      title: events.title,
      nightDate: events.nightDate,
      status: events.status,
    })
    .from(events)
    .where(
      and(
        inArray(events.nightDate, [...nights]),
        inArray(events.status, ["active", "cancelled", "merged"]),
        writtenBy(source.id),
      ),
    )
    .orderBy(events.nightDate, events.title);
  for (const row of rows) await retireRow(db, source, row.id, []);
  const liveRows = rows.filter((r) => r.status === "active" || r.status === "cancelled");
  const named = liveRows.map((r) => `${r.title} on ${r.nightDate}`);
  const notes =
    liveRows.length > 0
      ? [
          `${liveRows.length} listing(s) of this retired address were taken off the site: ${named.slice(0, 12).join("; ")}${named.length > 12 ? `, and ${named.length - 12} more` : ""}`,
        ]
      : [];
  return { retired: liveRows.length, notes };
}

/**
 * Places stored listings that have no venue, from the venue their own primary source gave (its
 * current venue_name and venue_address provenance, and the row's own point), with the resolver the
 * write path uses and the input it passes, ticketing check included (D-082). Rows a run does not
 * write again (a night D-079 listed again, a source that failed this run) are placed as a write
 * would place them: a feed's own point is kept, never moved to where its address geocodes (D-071).
 * A caller's `restate` first applies the fixes a write applies (a source's rooms, `onlyHere` and
 * `venueAddress`, and known venues), so a config change reaches rows already stored; rows still
 * with no venue stay unplaced.
 */
export async function placeUnplaced(
  db: Db,
  args: {
    metro: Metro;
    nights: readonly string[];
    placeVenue: (input: VenueInput, apiPoint?: boolean) => Promise<ResolvedVenue | null>;
    /** The place an address names outside the metro, or null (`Geocoder.elsewhere`). */
    elsewhere?: (address: string) => Promise<string | null>;
    /** Apply the same source-specific fixes a fresh write would (rooms, venueAddress, known venues). */
    restate?: (row: {
      sourceUrl: string;
      sourceHasVenue: boolean;
      name: string | null;
      address: string | null;
    }) => { name: string | null; address: string | null };
  },
): Promise<{ placed: number; notes: string[] }> {
  if (args.nights.length === 0) return { placed: 0, notes: [] };
  const rows = await db.execute<{
    id: string;
    title: string;
    night: string;
    kind: Source["kind"];
    lat: number | null;
    lng: number | null;
    venue_name: string | null;
    venue_address: string | null;
    source_url: string;
    source_has_venue: boolean;
  }>(sql`
    select e.id, e.title, e.night_date::text as night, s.kind,
      ST_Y(e.geo::geometry) as lat, ST_X(e.geo::geometry) as lng,
      (select fp.value #>> '{}' from ${fieldProvenance} fp
        where fp.entity_type = 'event' and fp.entity_id = e.id and fp.field = 'venue_name'
          and fp.is_current and fp.source_id = es.source_id limit 1) as venue_name,
      (select fp.value #>> '{}' from ${fieldProvenance} fp
        where fp.entity_type = 'event' and fp.entity_id = e.id and fp.field = 'venue_address'
          and fp.is_current and fp.source_id = es.source_id limit 1) as venue_address,
      s.url as source_url,
      (s.venue_id is not null) as source_has_venue
    from ${events} e
    join ${eventSources} es on es.event_id = e.id and es.role = 'primary'
    join ${sources} s on s.id = es.source_id
    where e.metro_id = ${args.metro.id} and e.venue_id is null
      and e.status in ('active', 'cancelled')
      and e.night_date = any(${`{${args.nights.join(",")}}`}::date[])
    order by e.night_date, e.title, e.id
  `);
  const placed: string[] = [];
  const outside: string[] = [];
  for (const row of rows) {
    const stated = args.restate
      ? args.restate({
          sourceUrl: row.source_url,
          sourceHasVenue: row.source_has_venue === true,
          name: row.venue_name,
          address: row.venue_address,
        })
      : { name: row.venue_name, address: row.venue_address };
    if (!stated.name && !stated.address) continue;
    // A name or address stored before D-280 that is no place ("Various venues in Mexico City") stays unplaced.
    if (isNoPlace(stated.name) || isNoPlace(stated.address)) continue;
    // A row whose own address names a place outside the metro is not this metro's night (PR 2).
    const where =
      stated.address && row.lat === null && args.elsewhere
        ? await args.elsewhere(stated.address)
        : null;
    if (where) {
      await db
        .update(events)
        .set({ status: "removed", mergedIntoId: null, updatedAt: new Date() })
        .where(eq(events.id, row.id));
      await releaseMergedInto(db, row.id);
      outside.push(`${row.title} on ${row.night} (${where})`);
      continue;
    }
    const venue = await args.placeVenue(
      {
        name: stated.name,
        address: stated.address,
        url: null,
        location:
          row.lat === null || row.lng === null
            ? null
            : { lat: Number(row.lat), lng: Number(row.lng) },
      },
      checksApiPoint({ kind: row.kind }),
    );
    if (!venue) continue;
    const updated = await db
      .update(events)
      .set({ venueId: venue.venueId, geo: venue.location, updatedAt: new Date() })
      .where(and(eq(events.id, row.id), isNull(events.venueId)))
      .returning({ id: events.id });
    if (updated.length > 0) placed.push(`${row.title} on ${row.night}`);
  }
  const notes =
    placed.length > 0
      ? [
          `${placed.length} stored listing(s) with no venue were placed from the venue their source gave: ${placed.slice(0, 12).join("; ")}${placed.length > 12 ? `, and ${placed.length - 12} more` : ""}`,
        ]
      : [];
  if (outside.length > 0) {
    notes.push(
      `${outside.length} stored listing(s) whose address is outside ${args.metro.name} were retired: ${outside.join("; ")}`,
    );
  }
  return { placed: placed.length, notes };
}

/** The stored columns a fact of `checkListingFacts` is written to, and its provenance field. */
const STORED_FACTS: Partial<Record<FactChange["field"], string>> = {
  prices: "prices",
  is_free: "is_free",
  age_min: "age_min",
  indoor_outdoor: "indoor_outdoor",
  floor: "floor",
  dress_code: "dress_code",
  crowd_size_hint: "crowd_size_hint",
  level: "level",
  partner_required: "partner_required",
  music: "music",
};

/**
 * This source's stored rows that no read listed this run keep only the facts their own part of
 * the page writes (D-108). `writeEvents` rewrites a listed row from its checked read (D-100 to
 * D-104); a row the read did not list (a partial read, tonight's row, a renamed title) kept its
 * old read's facts. Selected as `untimedForUnwrittenTimes` selects, timed or not: one source
 * only, active or cancelled, on `nights`, not listed by id nor by title and night; a row whose
 * title the page no longer writes has no part and is left alone. Its facts are checked as a read's (`checkListingFacts`) against its parts
 * under both layouts, so a fact stands where either writes it. Its cancellation and organiser are
 * not checked here. A withdrawn fact's provenance stops being current.
 */
export async function withdrawUnwrittenFacts(
  db: DbOrTx,
  args: {
    source: Source;
    listedIds: readonly string[];
    nights: readonly string[];
    text: string;
    lang?: string | null;
    titles?: readonly string[];
    currency?: string | null;
  },
): Promise<string[]> {
  const { source, listedIds, nights, text, lang } = args;
  if (nights.length === 0 || !text.trim()) return [];
  const listed =
    listedIds.length === 0
      ? new Set<string>()
      : new Set(
          (
            await db
              .select({ titleNormalized: events.titleNormalized, night: events.nightDate })
              .from(events)
              .where(inArray(events.id, [...listedIds]))
          ).map((r) => `${r.titleNormalized}|${r.night}`),
        );
  const rows = await db
    .select({
      id: events.id,
      title: events.title,
      titleNormalized: events.titleNormalized,
      night: events.nightDate,
      lastVerifiedAt: events.lastVerifiedAt,
      prices: events.prices,
      isFree: events.isFree,
      ageMin: events.ageMin,
      level: events.level,
      partnerRequired: events.partnerRequired,
      dressCode: events.dressCode,
      floor: events.floor,
      indoorOutdoor: events.indoorOutdoor,
      music: events.music,
      crowdSizeHint: events.crowdSizeHint,
    })
    .from(events)
    .where(
      and(
        inArray(events.nightDate, [...nights]),
        inArray(events.status, ["active", "cancelled"]),
        sql`cardinality(${events.sourceIds}) = 1`,
        writtenBy(source.id),
        listedIds.length > 0 ? notInArray(events.id, [...listedIds]) : sql`true`,
      ),
    )
    .orderBy(events.nightDate, events.title);
  const titles = args.titles ?? [];
  const notes: string[] = [];
  for (const row of rows) {
    if (listed.has(`${row.titleNormalized}|${row.night}`)) continue;
    const date = row.lastVerifiedAt === null ? null : row.night;
    const own = [
      ...new Set(
        [true, false].flatMap((layout) =>
          ownBlockTexts(
            titleBlocks(text, row.title, titles, lang, layout, { facts: true }),
            date,
            lang,
            {
              lead: false,
            },
          ),
        ),
      ),
    ];
    if (own.length === 0) continue;
    const stored = rawListingSchema.parse({
      title: row.title,
      prices: row.prices.map((p) => ({ ...p })),
      is_free: row.isFree,
      age_min: row.ageMin,
      level: row.level,
      partner_required: row.partnerRequired,
      dress_code: row.dressCode,
      floor: row.floor,
      indoor_outdoor: row.indoorOutdoor,
      music: {
        djs: row.music?.djs ?? [],
        bands: row.music?.bands ?? [],
        genre_mix: row.music?.genreMix ?? null,
      },
      crowd_size_hint: row.crowdSizeHint,
    });
    const checked = checkListingFacts(stored, own, { others: titles, currency: args.currency });
    let fields = [
      ...new Set(
        checked.changes.flatMap((c) => (STORED_FACTS[c.field] ? [STORED_FACTS[c.field]!] : [])),
      ),
    ];
    if (fields.length === 0) continue;
    // Only a fact this page's model read stored (D-108): a structured reader's or an event page's
    // fact is not this page's to deny.
    const read = new Set(
      (
        await db
          .select({ field: fieldProvenance.field })
          .from(fieldProvenance)
          .where(
            and(
              eq(fieldProvenance.entityType, "event"),
              eq(fieldProvenance.entityId, row.id),
              eq(fieldProvenance.sourceId, source.id),
              eq(fieldProvenance.isCurrent, true),
              eq(fieldProvenance.method, "llm"),
              inArray(fieldProvenance.field, fields),
            ),
          )
      ).map((r) => r.field),
    );
    fields = fields.filter((f) => read.has(f));
    if (fields.length === 0) continue;
    const next = checked.listing;
    const music = next.music;
    const values: Record<string, unknown> = {
      prices: normalizePrices(next.prices, args.currency ?? null),
      is_free: next.is_free,
      age_min: next.age_min,
      level: sentenceCase(next.level),
      partner_required: next.partner_required,
      dress_code: next.dress_code,
      floor: next.floor,
      indoor_outdoor: next.indoor_outdoor,
      crowd_size_hint: next.crowd_size_hint,
      music:
        music.djs.length || music.bands.length || music.genre_mix
          ? {
              djs: music.djs,
              bands: music.bands,
              genreMix: music.genre_mix,
              liveMusic: music.bands.length > 0 ? true : (row.music?.liveMusic ?? null),
            }
          : null,
    };
    const set: Partial<typeof events.$inferInsert> = {};
    for (const field of fields) {
      const value = values[field];
      if (field === "prices") set.prices = value as Price[];
      if (field === "is_free") set.isFree = value as boolean | null;
      if (field === "age_min") set.ageMin = value as number | null;
      if (field === "level") set.level = value as string | null;
      if (field === "partner_required") set.partnerRequired = value as boolean | null;
      if (field === "dress_code") set.dressCode = value as string | null;
      if (field === "floor") set.floor = value as string | null;
      if (field === "indoor_outdoor")
        set.indoorOutdoor = value as "indoor" | "outdoor" | "both" | null;
      if (field === "crowd_size_hint") set.crowdSizeHint = value as string | null;
      if (field === "music") set.music = value as EventMusic | null;
    }
    await db.update(events).set(set).where(eq(events.id, row.id));
    const gone = fields.filter((f) => {
      const v = values[f];
      return v === null || (Array.isArray(v) && v.length === 0);
    });
    if (gone.length > 0) {
      await db
        .update(fieldProvenance)
        .set({ isCurrent: false })
        .where(
          and(
            eq(fieldProvenance.entityType, "event"),
            eq(fieldProvenance.entityId, row.id),
            eq(fieldProvenance.sourceId, source.id),
            inArray(fieldProvenance.field, gone),
          ),
        );
    }
    notes.push(
      `${row.title} on ${row.night} (${checked.changes
        .filter((c) => fields.includes(STORED_FACTS[c.field] ?? ""))
        .map((c) => c.detail)
        .join(", ")})`,
    );
  }
  return notes.length === 0
    ? []
    : [
        `${notes.length} stored listing(s) the read did not list held facts their part of the page does not write; withdrawn: ${notes.join("; ")}`,
      ];
}
