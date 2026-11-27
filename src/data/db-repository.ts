// The database repository: the same interface as the mock, over Drizzle and PostGIS. The
// SQL narrows by ST_DWithin on the event's point (its venue's when the denormalized geo is
// null), by night date and by listed status (active or cancelled); the night rule, filters,
// counts and sort then run through the shared mapper so both modes agree.
//
// The shared logic is tested on the mock; tests/unit/db-repository.test.ts runs this class
// against Postgres with PostGIS when TEST_DATABASE_URL is set (always on CI), for the night
// rule, counts, order and slug lookup, including listings whose time is not listed (D-060).
// Reads are reused for `cacheMs` when given (the app passes LISTINGS_CACHE_MS), and, with a
// sharedStore, across isolates until anything next runs (D-578). Callers must not mutate
// returned listings.

import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";

import {
  LISTED_STATUSES,
  countDays,
  haversineKm,
  pickerZone,
  inReach,
  selectNight,
  toListingSafe,
  unplacedInReach,
  withQueryContext,
  type SourceLink,
  type VenueRecord,
} from "@/src/data/listing-mapper";
import {
  MERGED_HOPS,
  METRO_MATCH_KM,
  type SlugAnswer,
  type DayCount,
  type ListingFilters,
  type ListNightQuery,
  type ListNightResult,
  type ListingsRepository,
  type MetroSummary,
  type Point,
  type CitySummary,
} from "@/src/data/repository";
import { getDb, type Db } from "@/src/db/client";
import {
  archivedEvents,
  eventSources,
  events,
  fieldProvenance,
  jobRuns,
  metros,
  organizers,
  series as seriesTable,
  sources,
  venues,
} from "@/src/db/schema";
import type { Listing } from "@/src/domain/listing";
import { addCalendarDays } from "@/src/domain/time";
import { currentNightDate, dayPicker, type NightDate } from "@/src/domain/tonight";
import { createTtlCache } from "./ttl-cache";
import { currentWaitUntil, sharedGet, sharedStamp, type SharedStore } from "./shared-cache";
import type { CitySnapshot } from "./city-snapshot";
import { metroStamp, snapshotKey, decodeSnapshot, snapshotStale } from "./city-snapshot";
import { SnapshotReader, roundedCenter } from "./snapshot-reader";
import { snapshotStore } from "@/src/edge/snapshot-store";
import { attachLinkFlags } from "@/src/data/link-flags";
import {
  CITY_DIRECTORY_KEY,
  encodeDirectory,
  decodeDirectory,
  citiesFromDirectory,
  metroFromDirectory,
  type CityDirectory,
} from "./city-directory";

/**
 * The venue columns the site reads (`VenueRecord`), named one by one rather than the whole row: a
 * column the pipeline adds (D-066's `google_place_checked_at`) reaches production when the next
 * ingest run migrates, which can be minutes after the site that would select it is deployed.
 */
const SITE_VENUE_COLUMNS = {
  id: venues.id,
  name: venues.name,
  location: venues.location,
  address: venues.address,
  neighborhood: venues.neighborhood,
  kind: venues.kind,
  danceFloor: venues.danceFloor,
  hours: venues.hours,
  googlePlaceId: venues.googlePlaceId,
} satisfies Record<keyof VenueRecord, unknown>;

/**
 * Whether `event_sources.event_url` exists yet (D-073, migration 0005). The site deploys when a
 * pull request merges, and the column arrives when the next ingest run migrates, minutes or hours
 * later; a query that named it before then would fail every page. So the site asks the catalogue
 * first and, until the column is there, reads no source's event page (cards fall back to "Listed
 * on"). A yes is remembered for the life of the process; a no is asked again after a minute, so a
 * running server picks the column up soon after the migration lands.
 */
const EVENT_URL_RECHECK_MS = 60_000;
let eventUrlColumn: { present: boolean; askedAt: number } | null = null;

async function hasEventUrlColumn(db: Db): Promise<boolean> {
  const now = Date.now();
  if (eventUrlColumn?.present) return true;
  if (eventUrlColumn && now - eventUrlColumn.askedAt < EVENT_URL_RECHECK_MS) return false;
  const rows = await db.execute(sql`
    select 1 from information_schema.columns
    where table_schema = current_schema() and table_name = 'event_sources' and column_name = 'event_url'
    limit 1`);
  eventUrlColumn = { present: rows.length > 0, askedAt: now };
  return eventUrlColumn.present;
}

/** For tests: forget what the catalogue said. */
export function resetEventUrlColumnCheck(): void {
  eventUrlColumn = null;
}

const geographyPoint = (p: Point) =>
  sql`ST_SetSRID(ST_MakePoint(${p.lng}, ${p.lat}), 4326)::geography`;

export class DbListingsRepository implements ListingsRepository {
  constructor(
    private readonly db: () => Db = getDb,
    options: {
      cacheMs?: number;
      sharedStore?: SharedStore | null;
      snapshotTtlMs?: number;
      /** The clock background snapshot builds use (tests); default the real one. */
      snapshotNow?: () => Date;
    } = {},
  ) {
    const cacheMs = options.cacheMs ?? 0;
    this.sharedStore = options.sharedStore ?? null;
    this.snapshotTtlMs = options.snapshotTtlMs ?? 60_000;
    this.snapshotNow = options.snapshotNow ?? (() => new Date());
    this.listingsCache = createTtlCache<Listing[]>({
      ttlMs: cacheMs,
      maxEntries: 64,
    });
    this.metroCache = createTtlCache<MetroSummary | null>({
      ttlMs: cacheMs,
      maxEntries: 64,
    });
    this.citiesCache = createTtlCache<CitySummary[]>({
      ttlMs: cacheMs,
      maxEntries: 4,
    });
    this.slugCache = createTtlCache<Listing | null>({
      ttlMs: cacheMs,
      maxEntries: 256,
    });
    this.slugAnswerCache = createTtlCache<SlugAnswer>({
      ttlMs: cacheMs,
      maxEntries: 256,
    });
  }

  /**
   * Rebuild each city's snapshot that is missing, older than its city's stamp, or whose nights end before the
   * day picker's end (D-587). Sequential; a city that fails is reported and the rest continue.
   */
  async refreshCitySnapshots(now: Date): Promise<Record<string, string>> {
    const reader = this.snapshotReader();
    if (reader === null) {
      return {};
    }

    const store = snapshotStore();
    if (store === null) {
      return {};
    }

    const result: Record<string, string> = {};

    // Read every metro
    const db = this.db();
    const metrosRows = await db
      .select({
        id: metros.id,
        slug: metros.slug,
        name: metros.name,
        countryCode: metros.countryCode,
        center: metros.center,
        radiusKm: metros.radiusKm,
        tz: metros.tz,
        languages: metros.languages,
      })
      .from(metros)
      .where(eq(metros.adHoc, false))
      .orderBy(asc(metros.slug));

    const stamps = await this.metroStamps();

    for (const row of metrosRows) {
      const metro: MetroSummary = {
        id: row.id,
        slug: row.slug,
        name: row.name,
        countryCode: row.countryCode,
        center: { lat: row.center.lat, lng: row.center.lng },
        radiusKm: row.radiusKm,
        tz: row.tz,
        languages: row.languages,
        distanceKm: 0,
      };

      try {
        const text = await store.get(snapshotKey(metro.slug));
        const snap = text === null ? null : decodeSnapshot(text);

        if (snap === null) {
          result[metro.slug] = await reader.rebuild(metro.slug, metro.id);
        } else {
          const needed = this.pickerWindow(now, roundedCenter(metro.center), metro).nights;
          if (snapshotStale(snap, metroStamp(stamps, metro.id), needed)) {
            result[metro.slug] = await reader.rebuild(metro.slug, metro.id, snap.builtAt);
          } else {
            result[metro.slug] = "ok";
          }
        }
      } catch (e) {
        console.error(`city snapshot refresh failed: ${metro.slug}: ${String(e)}`);
        result[metro.slug] = "error";
      }
    }

    return result;
  }

  private readonly sharedStore: SharedStore | null;
  private readonly snapshotTtlMs: number;
  private readonly snapshotNow: () => Date;
  private readonly listingsCache: ReturnType<typeof createTtlCache<Listing[]>>;
  private readonly metroCache: ReturnType<typeof createTtlCache<MetroSummary | null>>;
  private readonly citiesCache: ReturnType<typeof createTtlCache<CitySummary[]>>;
  private readonly slugCache: ReturnType<typeof createTtlCache<Listing | null>>;
  private readonly slugAnswerCache: ReturnType<typeof createTtlCache<SlugAnswer>>;
  /** One small read per isolate per minute: when anything last ran (D-578), shared across isolates (D-582). */
  private readonly stampCache = createTtlCache<string>({ ttlMs: 60_000, maxEntries: 1 });
  /** Per-isolate cache for the city directory */
  private directoryCache: { dir: CityDirectory | null; expiresAt: number } | null = null;

  private reader: SnapshotReader | null = null;
  private readerStore: ReturnType<typeof snapshotStore> | null = null;

  private snapshotReader(): SnapshotReader | null {
    const store = snapshotStore();
    if (store === null) return null;
    // One reader per KV binding object: a new binding (tests, a new isolate) gets a new reader.
    if (this.reader === null || this.readerStore !== store) {
      this.readerStore = store;
      this.reader = new SnapshotReader({
        store,
        shared: this.sharedStore,
        build: (slug, now) => this.buildCitySnapshot(slug, now),
        stamps: () => this.metroStamps(),
        background: (p) => {
          const w = currentWaitUntil();
          if (w) w(p);
          else void p.catch(() => {});
        },
        ttlMs: this.snapshotTtlMs,
        now: this.snapshotNow,
      });
    }
    return this.reader;
  }

  private changeStamp(): Promise<string> {
    return this.stampCache.get("stamp", async () => {
      const read = async (): Promise<string> => {
        const rows = await this.db()
          .select({
            at: sql<
              string | null
            >`greatest(max(${jobRuns.finishedAt}), max(${jobRuns.startedAt}))::text`,
          })
          .from(jobRuns);
        return rows[0]?.at ?? "none";
      };
      return sharedStamp({ store: this.sharedStore, read });
    });
  }

  /**
   * A city's read status for the on-demand refresh (D-899): when its last ingest finished well,
   * and when the one running now started. Null when no metro has this slug.
   */
  async ingestStatus(
    slug: string,
  ): Promise<{ lastSuccessAt: Date | null; runningSince: Date | null } | null> {
    const db = this.db();
    const metro = await db
      .select({ id: metros.id })
      .from(metros)
      .where(eq(metros.slug, slug))
      .limit(1);
    if (metro[0] === undefined) return null;
    const rows = await db
      .select({
        status: jobRuns.status,
        startedAt: jobRuns.startedAt,
        finishedAt: jobRuns.finishedAt,
      })
      .from(jobRuns)
      .where(and(eq(jobRuns.job, "ingest"), eq(jobRuns.metroId, metro[0].id)))
      .orderBy(desc(jobRuns.startedAt))
      .limit(20);
    const success = rows.find((r) => r.status === "succeeded");
    const running = rows.find((r) => r.status === "running");
    return {
      lastSuccessAt: success?.finishedAt ?? success?.startedAt ?? null,
      runningSince: running?.startedAt ?? null,
    };
  }

  /**
   * Jobs with no metro (e.g. dedupe-unmerge) are under the key null and touch every city.
   */
  async metroStamps(): Promise<Map<string | null, number>> {
    const rows = await this.db()
      .select({
        metroId: jobRuns.metroId,
        ms: sql<number>`(extract(epoch from greatest(max(${jobRuns.finishedAt}), max(${jobRuns.startedAt}))) * 1000)::float8`,
      })
      .from(jobRuns)
      .groupBy(jobRuns.metroId);
    const map = new Map<string | null, number>();
    for (const row of rows) {
      const ms = Number(row.ms);
      if (Number.isFinite(ms)) {
        map.set(row.metroId, ms);
      }
    }
    return map;
  }

  /**
   * Listed events on any of the night dates within reach: a placed one within the radius of its
   * point (its venue's when the denormalized geo is null), and, when `unplacedMetroId` is given,
   * the metro's listings with no venue (D-082). A LEFT JOIN, so a row with no venue is read.
   */
  private async queryListings(
    center: Point,
    radiusKm: number,
    nights: NightDate[],
    unplacedMetroId: string | null,
  ): Promise<Listing[]> {
    const db = this.db();
    const placed = sql`(${events.venueId} is not null and ST_DWithin(coalesce(${events.geo}, ${venues.location}), ${geographyPoint(center)}, ${radiusKm * 1000}))`;
    const rows = await db
      .select({
        event: events,
        venue: SITE_VENUE_COLUMNS,
        organizer: organizers,
        series: seriesTable,
      })
      .from(events)
      .leftJoin(venues, eq(events.venueId, venues.id))
      .leftJoin(organizers, eq(events.organizerId, organizers.id))
      .leftJoin(seriesTable, eq(events.seriesId, seriesTable.id))
      .where(
        and(
          inArray(events.status, LISTED_STATUSES),
          inArray(events.nightDate, nights),
          unplacedMetroId === null
            ? placed
            : sql`(${placed} or (${events.venueId} is null and ${events.metroId} = ${unplacedMetroId}))`,
        ),
      )
      // A deterministic order: a listing whose time is not listed has a NULL start (D-060) and
      // comes after the timed ones, then slug (unique) breaks every tie. selectNight re-sorts.
      .orderBy(sql`${events.startsAt} asc nulls last`, asc(events.slug));
    if (rows.length === 0) return [];
    return this.attachSources(db, rows);
  }

  /**
   * A city's own query (its centre as city links round it, its radius) from its KV snapshot, or
   * null: anything else, or no snapshot yet, reads the database as before (D-586 serve-old still
   * applies there). Never throws.
   */
  private async fromSnapshot(
    center: Point,
    radiusKm: number,
    nights: NightDate[],
    unplacedMetroId: string | null,
  ): Promise<Listing[] | null> {
    try {
      const reader = this.snapshotReader();
      if (reader === null) return null;
      const metro = await this.metroFor(center);
      if (metro === null) return null;
      const result = await reader.answer(
        {
          id: metro.id,
          slug: metro.slug,
          center: metro.center,
          radiusKm: metro.radiusKm,
        },
        center,
        radiusKm,
        nights,
        unplacedMetroId,
      );
      return result ?? null;
    } catch {
      // Any throw -> fall back to database
      return null;
    }
  }

  /**
   * Listed events on any of the night dates within reach: a placed one within the radius of its
   * point (its venue's when the denormalized geo is null), and, when `unplacedMetroId` is given,
   * the metro's listings with no venue (D-082). A LEFT JOIN, so a row with no venue is read.
   * A city's own query is answered from its snapshot first.
   */
  private async loadListings(
    center: Point,
    radiusKm: number,
    nights: NightDate[],
    unplacedMetroId: string | null,
  ): Promise<Listing[]> {
    // A city's own query: its snapshot (the owner 2026-11-03)
    const fromSnapshot = await this.fromSnapshot(center, radiusKm, nights, unplacedMetroId);
    if (fromSnapshot !== null) return fromSnapshot;

    const key = JSON.stringify([center.lat, center.lng, radiusKm, nights, unplacedMetroId]);
    return this.listingsCache.get(key, () =>
      sharedGet({
        store: this.sharedStore,
        namespace: "listings-v1",
        key,
        stamp: () => this.changeStamp(),
        load: () => this.queryListings(center, radiusKm, nights, unplacedMetroId),
      }),
    );
  }

  /** The metro whose listings with no location this query reaches, or null (unplacedInReach). */
  private async unplacedMetro(center: Point, radiusKm: number): Promise<string | null> {
    const metro = await this.metroFor(center);
    return metro !== null && unplacedInReach(metro, radiusKm) ? metro.id : null;
  }

  private async attachSources(
    db: Db,
    rows: {
      event: typeof events.$inferSelect;
      venue: VenueRecord | null;
      organizer: typeof organizers.$inferSelect | null;
      series: typeof seriesTable.$inferSelect | null;
    }[],
  ): Promise<Listing[]> {
    const ids = rows.map((r) => r.event.id);
    const withEventUrl = await hasEventUrlColumn(db);
    const links = await db
      .select({
        eventId: eventSources.eventId,
        url: eventSources.sourceUrl,
        role: eventSources.role,
        lastSeenAt: eventSources.lastSeenAt,
        trustTier: sources.trustTier,
        eventUrl: withEventUrl ? eventSources.eventUrl : sql<string | null>`null`,
      })
      .from(eventSources)
      .leftJoin(sources, eq(eventSources.sourceId, sources.id))
      .where(inArray(eventSources.eventId, ids));
    const linksByEvent = new Map<string, SourceLink[]>();
    for (const link of links) {
      const list = linksByEvent.get(link.eventId) ?? [];
      list.push({
        url: link.url,
        role: link.role,
        lastSeenAt: link.lastSeenAt,
        trustTier: link.trustTier ?? null,
        eventUrl: link.eventUrl,
      });
      linksByEvent.set(link.eventId, list);
    }

    const conflicting = rows
      .filter((r) => r.event.confirmation === "conflicting")
      .map((r) => r.event.id);
    const provenanceByEvent = new Map<
      string,
      { field: string; value: unknown; sourceUrl: string | null }[]
    >();
    if (conflicting.length > 0) {
      const provenance = await db
        .select({
          entityId: fieldProvenance.entityId,
          field: fieldProvenance.field,
          value: fieldProvenance.value,
          sourceUrl: fieldProvenance.sourceUrl,
        })
        .from(fieldProvenance)
        .where(
          and(
            eq(fieldProvenance.entityType, "event"),
            eq(fieldProvenance.isCurrent, true),
            inArray(fieldProvenance.entityId, conflicting),
          ),
        );
      for (const row of provenance) {
        const list = provenanceByEvent.get(row.entityId) ?? [];
        list.push({ field: row.field, value: row.value, sourceUrl: row.sourceUrl });
        provenanceByEvent.set(row.entityId, list);
      }
    }

    const listings = rows.flatMap((r) => {
      const listing = toListingSafe({
        event: r.event,
        venue: r.venue,
        organizer: r.organizer,
        series: r.series,
        sources: linksByEvent.get(r.event.id) ?? [],
        provenance: provenanceByEvent.get(r.event.id) ?? [],
      });
      return listing ? [listing] : [];
    });
    // D-768: a card whose own link failed the daily check carries when; it stays listed.
    return attachLinkFlags(db, listings);
  }

  async listNight(query: ListNightQuery): Promise<ListNightResult> {
    // Tonight also reads the night before, so a set that is still in progress at 6:30am shows.
    // A listing from the night before whose time is not listed is never in progress, and its
    // night window has closed, so the night rule leaves it out (D-060).
    const nights = [query.nightDate, addCalendarDays(query.nightDate, -1)];
    const metroId = await this.unplacedMetro(query.center, query.radiusKm);
    const candidates = await this.loadListings(query.center, query.radiusKm, nights, metroId);
    return selectNight(candidates, { ...query, unplaced: metroId !== null });
  }

  async getBySlug(slug: string, now: Date): Promise<Listing | null> {
    const rawListing = await this.slugCache.get(slug, () =>
      sharedGet({
        store: this.sharedStore,
        namespace: "slug-v1",
        key: slug,
        stamp: () => this.changeStamp(),
        load: async () => {
          const db = this.db();
          const rows = await db
            .select({
              event: events,
              venue: SITE_VENUE_COLUMNS,
              organizer: organizers,
              series: seriesTable,
            })
            .from(events)
            .leftJoin(venues, eq(events.venueId, venues.id))
            .leftJoin(organizers, eq(events.organizerId, organizers.id))
            .leftJoin(seriesTable, eq(events.seriesId, seriesTable.id))
            .where(and(eq(events.slug, slug), inArray(events.status, LISTED_STATUSES)))
            .limit(1);
          const listing = (await this.attachSources(db, rows))[0];
          return listing ?? null;
        },
      }),
    );
    return rawListing ? withQueryContext(rawListing, null, now) : null;
  }

  async resolveSlug(slug: string): Promise<SlugAnswer> {
    return this.slugAnswerCache.get(slug, () =>
      sharedGet({
        store: this.sharedStore,
        namespace: "resolve-v1",
        key: slug,
        stamp: () => this.changeStamp(),
        load: async () => {
          const rows = await this.db().execute<{ slug: string; status: string; depth: number }>(sql`
            with recursive chain(id, slug, status, merged_into_id, depth) as (
              select id, slug, status::text, merged_into_id, 0 from events where slug = ${slug}
              union all
              select e.id, e.slug, e.status::text, e.merged_into_id, c.depth + 1
              from chain c join events e on e.id = c.merged_into_id
              -- A merged row, or one retired into the listing that replaced it (D-081's timed row,
              -- an invented midnight), leads to that listing.
              where (c.status = 'merged' or c.status = 'removed') and c.depth < ${MERGED_HOPS}
            )
            select slug, status, depth from chain order by depth desc limit 1
          `);
          const last = [...rows][0];
          if (!last || !(LISTED_STATUSES as readonly string[]).includes(last.status)) {
            // A past night the retention job deleted keeps its address (M1).
            const archived = await this.db()
              .select({
                title: archivedEvents.title,
                nightDate: archivedEvents.nightDate,
                venueName: archivedEvents.venueName,
                metroSlug: archivedEvents.metroSlug,
              })
              .from(archivedEvents)
              .where(eq(archivedEvents.slug, slug))
              .limit(1);
            if (archived.length > 0) {
              const row = archived[0]!;
              return {
                kind: "passed",
                title: row.title,
                nightDate: row.nightDate,
                venueName: row.venueName,
                metroSlug: row.metroSlug,
              };
            }
            return { kind: "gone" };
          }
          return Number(last.depth) === 0 ? { kind: "listed" } : { kind: "moved", slug: last.slug };
        },
      }),
    );
  }

  /**
   * Read the city directory from KV, cached per-isolate for snapshotTtlMs.
   * Returns null if no store, key missing/invalid, or get throws.
   */
  private async directory(): Promise<CityDirectory | null> {
    const store = snapshotStore();
    if (store === null) {
      return null;
    }

    const now = this.snapshotNow().getTime();
    if (this.directoryCache !== null && now < this.directoryCache.expiresAt) {
      return this.directoryCache.dir;
    }

    try {
      const text = await store.get(CITY_DIRECTORY_KEY);
      const decoded = text === null ? null : decodeDirectory(text);
      this.directoryCache = { dir: decoded, expiresAt: now + this.snapshotTtlMs };
      return decoded;
    } catch {
      // store.get threw
      return null;
    }
  }

  /** The day picker's nights in the picker zone, and the nights to read for them (from last night). */
  private pickerWindow(now: Date, center: Point, metro: MetroSummary | null) {
    const tz = pickerZone(metro, center);
    const tonight = currentNightDate(now, tz);
    const pickerNights = dayPicker(now, tz);
    const nights = Array.from({ length: pickerNights.length + 1 }, (_, i) =>
      addCalendarDays(tonight, i - 1),
    );
    return { pickerNights, nights };
  }

  async dayCounts(
    center: Point,
    radiusKm: number,
    now: Date,
    filters: ListingFilters = {},
  ): Promise<DayCount[]> {
    const metro = await this.metroFor(center);
    const { pickerNights, nights } = this.pickerWindow(now, center, metro);
    const unplaced = unplacedInReach(metro, radiusKm);
    const candidates = await this.loadListings(
      center,
      radiusKm,
      nights,
      unplaced ? (metro?.id ?? null) : null,
    );
    // The list keeps a venue by great-circle distance (selectNight); PostGIS's ST_DWithin measures
    // on the spheroid, so a venue at the edge can pass one and fail the other. Counting by the
    // list's own rule keeps each day's count equal to that day's list, as the mock does.
    const near = candidates.filter((l) => inReach(l, center, radiusKm, unplaced));
    // The picker zone picks the picker's dates; each listing is counted by the same rule listNight
    // uses, so tonight's count is tonight's unfiltered list, "Time not listed" rows included.
    return countDays(near, pickerNights, now, filters);
  }

  async nightWithDays(
    query: ListNightQuery,
  ): Promise<{ night: ListNightResult; days: DayCount[] }> {
    const metro = await this.metroFor(query.center);
    const { pickerNights, nights } = this.pickerWindow(query.now, query.center, metro);
    // A picked night outside the picker (and the night before it, for sets still on) is read too;
    // in the usual case it is inside, so the cache key is dayCounts' own.
    for (const night of [query.nightDate, addCalendarDays(query.nightDate, -1)]) {
      if (!nights.includes(night)) nights.push(night);
    }
    const unplaced = unplacedInReach(metro, query.radiusKm);
    const candidates = await this.loadListings(
      query.center,
      query.radiusKm,
      nights,
      unplaced ? (metro?.id ?? null) : null,
    );
    // selectNight keeps only the picked night's rows, so the wider read gives the same list.
    const night = selectNight(candidates, { ...query, unplaced });
    const near = candidates.filter((l) => inReach(l, query.center, query.radiusKm, unplaced));
    return { night, days: countDays(near, pickerNights, query.now, query.filters ?? {}) };
  }

  async metroFor(center: Point): Promise<MetroSummary | null> {
    const dir = await this.directory();
    if (dir) {
      const m = metroFromDirectory(dir, center);
      if (m) return m;
    }

    const key = JSON.stringify([center.lat, center.lng]);
    return this.metroCache.get(key, () =>
      sharedGet({
        store: this.sharedStore,
        namespace: "metro-v1",
        key,
        stamp: () => this.changeStamp(),
        load: async () => {
          const db = this.db();
          const rows = await db
            .select({
              id: metros.id,
              slug: metros.slug,
              name: metros.name,
              countryCode: metros.countryCode,
              center: metros.center,
              radiusKm: metros.radiusKm,
              tz: metros.tz,
              languages: metros.languages,
              distanceM: sql<number>`ST_Distance(${metros.center}, ${geographyPoint(center)})`,
            })
            .from(metros)
            .where(
              sql`ST_DWithin(${metros.center}, ${geographyPoint(center)}, ${METRO_MATCH_KM * 1000})`,
            )
            .orderBy(sql`ST_Distance(${metros.center}, ${geographyPoint(center)})`)
            .limit(1);
          const row = rows[0];
          if (!row) return null;
          const metroCenter = { lat: row.center.lat, lng: row.center.lng };
          return {
            id: row.id,
            slug: row.slug,
            name: row.name,
            countryCode: row.countryCode,
            center: metroCenter,
            radiusKm: row.radiusKm,
            tz: row.tz,
            languages: row.languages,
            distanceKm: Number.isFinite(row.distanceM)
              ? row.distanceM / 1000
              : haversineKm(center, metroCenter),
          };
        },
      }),
    );
  }

  async listCities(now: Date): Promise<CitySummary[]> {
    const dir = await this.directory();
    if (dir) {
      return citiesFromDirectory(dir, now);
    }

    const minuteKey = Math.floor(now.getTime() / 60_000);
    const key = `cities-${minuteKey}`;
    return this.citiesCache.get(key, () =>
      sharedGet({
        store: this.sharedStore,
        namespace: "cities-v1",
        key,
        stamp: () => this.changeStamp(),
        load: async () => {
          // The night turns at 6am local (NIGHT_BOUNDARY_HOUR), in each city's own zone.
          const tonight = sql`((${now.toISOString()}::timestamptz at time zone ${metros.tz}) - interval '6 hours')::date`;
          const rows = await this.db()
            .select({
              slug: metros.slug,
              name: metros.name,
              center: metros.center,
              // Written out with table names: Drizzle prints a column bare inside a select list, which
              // here would compare an event's metro_id with its own id.
              hasListings: sql<boolean>`exists (
                select 1 from events e
                where e.metro_id = metros.id
                  and e.status = 'active'
                  and e.merged_into_id is null
                  and e.night_date >= ${tonight}
              )`,
            })
            .from(metros)
            .where(eq(metros.adHoc, false))
            .orderBy(asc(metros.name));
          return rows.map((row) => ({
            slug: row.slug,
            name: row.name,
            center: { lat: row.center.lat, lng: row.center.lng },
            hasListings: Boolean(row.hasListings),
          }));
        },
      }),
    );
  }

  /**
   * Build a city directory with every metro row and each metro's last listed night.
   */
  async buildCityDirectory(now: Date): Promise<CityDirectory> {
    const db = this.db();
    const rows = await db
      .select({
        id: metros.id,
        slug: metros.slug,
        name: metros.name,
        countryCode: metros.countryCode,
        center: metros.center,
        radiusKm: metros.radiusKm,
        tz: metros.tz,
        languages: metros.languages,
        adHoc: metros.adHoc,
        lastNight: sql<
          string | null
        >`(select max(e.night_date)::text from events e where e.metro_id = metros.id and e.status = 'active' and e.merged_into_id is null)`,
      })
      .from(metros)
      .orderBy(asc(metros.name));

    const metrosArray = rows.map((row) => ({
      id: row.id,
      slug: row.slug,
      name: row.name,
      countryCode: row.countryCode,
      center: { lat: row.center.lat, lng: row.center.lng },
      radiusKm: row.radiusKm,
      tz: row.tz,
      languages: row.languages,
      adHoc: row.adHoc,
      lastNight: row.lastNight,
    }));

    const stamps = await this.metroStamps();
    const stampValues = Array.from(stamps.values());
    const stamp = stampValues.length > 0 ? Math.max(...stampValues) : 0;

    return {
      v: 1,
      stamp,
      builtAt: now,
      metros: metrosArray,
    };
  }

  /**
   * Refresh the city directory in KV if it is stale or missing.
   */
  async refreshCityDirectory(now: Date): Promise<"built" | "ok" | "failed"> {
    const store = snapshotStore();
    if (store === null) {
      return "ok";
    }

    try {
      const stamps = await this.metroStamps();
      const stampValues = Array.from(stamps.values());
      const currentStamp = stampValues.length > 0 ? Math.max(...stampValues) : 0;

      const existing = await store.get(CITY_DIRECTORY_KEY);
      if (existing !== null) {
        const decoded = decodeDirectory(existing);
        if (decoded !== null && decoded.stamp >= currentStamp) {
          // Cache the directory in the per-isolate cache
          this.directoryCache = {
            dir: decoded,
            expiresAt: this.snapshotNow().getTime() + this.snapshotTtlMs,
          };
          return "ok";
        }
      }

      // Build and store new directory
      const dir = await this.buildCityDirectory(now);
      await store.put(CITY_DIRECTORY_KEY, encodeDirectory(dir));
      this.directoryCache = { dir, expiresAt: this.snapshotNow().getTime() + this.snapshotTtlMs };
      return "built";
    } catch (e) {
      console.error(`city directory refresh failed: ${String(e)}`);
      return "failed";
    }
  }

  /**
   * Build a city snapshot for the given metro slug.
   * Returns null if the metro does not exist.
   */
  async buildCitySnapshot(slug: string, now: Date): Promise<CitySnapshot | null> {
    // Read the metro row
    const rows = await this.db()
      .select({
        id: metros.id,
        slug: metros.slug,
        name: metros.name,
        countryCode: metros.countryCode,
        center: metros.center,
        radiusKm: metros.radiusKm,
        tz: metros.tz,
        languages: metros.languages,
      })
      .from(metros)
      .where(eq(metros.slug, slug))
      .limit(1);
    const row = rows[0];
    if (!row) return null;

    const metro: MetroSummary = {
      id: row.id,
      slug: row.slug,
      name: row.name,
      countryCode: row.countryCode,
      center: { lat: row.center.lat, lng: row.center.lng },
      radiusKm: row.radiusKm,
      tz: row.tz,
      languages: row.languages,
      distanceKm: 0,
    };

    // A job that finishes while we build then leaves the snapshot stale, never missing rows.
    const stamps = await this.metroStamps();
    const stamp = metroStamp(stamps, metro.id);

    // city links carry toFixed(5), src/ui/home/city-path.ts, so the page's query centre equals this.
    const center = {
      lat: Number(metro.center.lat.toFixed(5)),
      lng: Number(metro.center.lng.toFixed(5)),
    };

    const { nights } = this.pickerWindow(now, center, metro);
    const unplacedMetroId = unplacedInReach(metro, metro.radiusKm) ? metro.id : null;
    const listings = await this.queryListings(center, metro.radiusKm, nights, unplacedMetroId);

    return {
      v: 1,
      metroId: metro.id,
      slug: metro.slug,
      center,
      radiusKm: metro.radiusKm,
      unplacedMetroId,
      stamp,
      builtAt: new Date(),
      nights: [...nights].sort(),
      listings,
    };
  }
}
