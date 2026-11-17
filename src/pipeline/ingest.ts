// One ingest run for one metro (PLAN 6.2, D-043): `pnpm ingest --metro nyc`.
//
//  1. the metro's seed sources are upserted (config/sources);
//  2. metro-wide APIs (Ticketmaster) are searched over the window;
//  3. every enabled source is harvested by its adapter; an unprobed `html` source is probed first
//     and becomes a feed, a platform, a JSON-LD page, or stays `html` for Phase 3; sources it
//     links to are added and harvested in the same run (one level deep);
//  4. every listing is screened (a title that names no event is counted and noted, D-060),
//     expanded (rules), normalised, placed on a venue, and written; a listing whose source gives
//     its night and no time is written as "Time not listed" (D-060);
//  5. duplicates across sources are merged (D-006);
//  6. raw page bodies older than 3 days are pruned (D-043), the window's venues without a Google
//     place ID are looked up by id only (D-066), and the run is recorded in job_runs.
//
// Nothing here stops the run on one source's failure: every outcome is reported, and the report
// says what came from where. Adapters that may not run (a flag, a country, a missing key) are
// listed with the reason.

import { DISCOVERY_ADAPTERS } from "@/src/adapters/registry/discovery";
import { PLATFORM_ADAPTERS } from "@/src/adapters/registry/platforms";
import { READER_ADAPTERS } from "@/src/adapters/registry/readers";
import { and, eq, sql } from "drizzle-orm";

import { titleNamesOutsideTown } from "@/config/metro-regions";
import { titleNamesVenueElsewhere } from "@/src/domain/title-elsewhere";
import { METRO_RETIRED_SOURCES, METRO_SOURCES } from "@/config/sources";
import { robotsWaiverLines } from "@/src/pipeline/robots-waiver";
import { diceAdapter } from "@/src/adapters/apis/dice";
import { eventbriteAdapter } from "@/src/adapters/apis/eventbrite";
import { ticketmasterAdapter } from "@/src/adapters/apis/ticketmaster";
import { raAdapter } from "@/src/adapters/apis/ra";
import { icsAdapter } from "@/src/adapters/feeds/ics";
import { jsonLdAdapter, jsonLdToListings, extractJsonLd } from "@/src/adapters/feeds/jsonld";
import { squarespaceAdapter } from "@/src/adapters/feeds/squarespace";
import { wpTribeAdapter } from "@/src/adapters/feeds/wp-tribe";
import { sha256 } from "@/src/adapters/shared";
import type {
  AdapterId,
  HarvestResult,
  Metro,
  RunCtx,
  Source,
  SourceAdapter,
  SourceCandidate,
} from "@/src/adapters/types";
import type { Db } from "@/src/db/client";
import { costLog, eventSources, events, jobRuns, sources as sourcesTable } from "@/src/db/schema";
import {
  screenStoredRow,
  screenTitle,
  screenUnlistedUntimed,
  type VenueCalendarFlags,
} from "@/src/domain/listing-screen";
import { insideMetro } from "@/src/domain/metro-bounds";
import { withListedDates } from "@/src/domain/dates-list";
import { fixedNightListings } from "@/src/domain/fixed-nights";
import { closedNightsIn, retireClosedNights } from "@/src/pipeline/closed-nights";
import { handCheckedPage } from "@/src/domain/hand-checked";
import type { SeedSource } from "@/config/sources/nyc";
import { withHouseHours } from "@/src/domain/house-hours";
import { withZuluAsLocal } from "@/src/domain/zulu-local";
import { MATERIALIZE_DAYS } from "@/src/domain/recurrence";
import {
  dateBesideTitle,
  foldPage,
  weekdayCodeOf,
  weekdaysNearTitle,
} from "@/src/domain/text-facts";
import { nextHarvestAt, timeBoxSpent, type ReadBy } from "@/src/domain/refresh";
import { addCalendarDays } from "@/src/domain/time";
import { currentNightDate, OPENABLE_NIGHTS } from "@/src/domain/tonight";
import { geoapifyGeocoder, type Geocoder } from "@/src/pipeline/geocode";
import { gsiGeocoder, withJapanFallback } from "@/src/pipeline/geocode-gsi";
import { placeFromEventPages, type EventPagePlacing } from "@/src/pipeline/event-page-venue";
import { timesFromEventPages } from "@/src/pipeline/event-page-times";
import { splitLessonBeforeDancing } from "@/src/pipeline/lesson-split";
import { wrongWeekdayScreen } from "@/src/pipeline/wrong-weekday";
import { datesFromEventPages } from "@/src/pipeline/event-page-dates";
import { weeklyFromEventPages } from "@/src/pipeline/event-page-weekly";
import { HttpError, type HttpClient, type HttpResponse } from "@/src/pipeline/http";
import type { AiClient } from "@/src/ai";
import { currencyForCountry } from "@/src/domain/prices";
import { cleanPageText } from "@/src/pipeline/clean";
import {
  extractPageInChunks,
  extractionToHarvested,
  REREADS_PER_RUN,
  emptyReadOfWindowNight,
  type ExtractionCache,
} from "@/src/pipeline/extract";
import {
  dropRuleNightsWithDatedTwin,
  dropUntimedWithTimedSibling,
  expandRecurrence,
  normalizeListing,
  windowNights,
  withoutPlaceholderTimes,
  withoutStartTimes,
  type NormalizedEvent,
} from "@/src/pipeline/normalize";
import {
  venueSeedFor,
  closedKnownVenue,
  withKnownVenue,
  withVenueRooms,
  restateVenue,
  withSeedVenue,
  withTitleVenue,
  withoutNoPlaceVenue,
} from "@/src/pipeline/source-venue";
import { clearNoPlaceVenues } from "@/src/pipeline/no-place-venues";
import { storeVenueNeighbourhoods } from "@/src/pipeline/venue-neighbourhoods";
import { otherCityLink } from "@/src/pipeline/city-links";
import { KNOWN_VENUES } from "@/config/known-venues";
import { failingSource, failureStreakNote, type FailingSource } from "@/src/pipeline/health";
import { PAGE_INSTEAD, PAGE_INSTEAD_NOTE, readsPageInstead } from "@/src/pipeline/ics-html-feed";
import { silentSources, silentSourceNote, type SilentSource } from "@/src/pipeline/silent-sources";
import { seedNightTitles } from "@/src/pipeline/seed-for-page";
import { outsideMatch, type OutsideListing } from "@/src/pipeline/outside-metro";
import { probePage } from "@/src/pipeline/probe";
import {
  emptySummaryReport,
  formatSummaryReport,
  summarizeListings,
  type SummaryReport,
} from "@/src/pipeline/summarize";
import { adapterFor, harvestSource, loadFlags, mayRun, type Gate } from "@/src/pipeline/runner";
import { withoutCachedReads } from "@/src/pipeline/uncached-cache";
import { isDanceCard, isDanceCardInText, withCardTitle } from "@/src/pipeline/card-title";
import {
  dedupeMetro,
  EMPTY_DEDUPE_REPORT,
  formatDedupeReport,
  refillMergedFacts,
  type DedupeReport,
} from "@/src/pipeline/dedupe";
import {
  reviewQueuedPairs,
  DEDUPE_REVIEW_DUE_RUN_MS,
  formatDedupeReview,
  emptyDedupeReviewReport,
  type DedupeReviewReport,
} from "@/src/pipeline/dedupe-review";
import { retirePageTwins } from "@/src/pipeline/page-twins";
import { retidyStoredTitles } from "@/src/pipeline/retidy-titles";
import { resolvePlaceIds, type PlaceIdReport } from "@/src/pipeline/place-ids";
import { restatePlacedStreetNamed } from "@/src/pipeline/restate-placed";
import { retireSamePageRows } from "@/src/pipeline/same-page-rows";
import { upgradeKnownVenueAddresses } from "@/src/pipeline/known-venue-address";
import {
  emptyVenueReport,
  noteOnce,
  formatVenueReport,
  removePlaceholderVenues,
  type VenueReport,
} from "@/src/pipeline/venue-checks";
import {
  clearPlaceholderTimes,
  countDue,
  deferHarvest,
  notDueSourceIds,
  loadBlocklist,
  loadSources,
  placeUnplaced,
  retireOutsideMetro,
  retireRowsOfRetiredSource,
  retireStaleWeekly,
  retireScreened,
  pruneRawDocuments,
  recordFetch,
  recordHealth,
  storedBySource,
  resolveVenue,
  retireClearedPlaceholders,
  retireInventedMidnights,
  retireSameSourceTwins,
  retireMovedCopies,
  retireSameSourceSiblings,
  retireUnlisted,
  untimedForUnwrittenTimes,
  withdrawUnwrittenFacts,
  storedPageText,
  upsertSource,
  writeEvents,
  type ResolvedVenue,
  type VenueInput,
  placeSeedSources,
  retireScreenedTitles,
  restoreMergedClasses,
} from "@/src/pipeline/store";

/**
 * Why a stored row of this source leaves the site after this run, or null. A row a read left out as outside the
 * metro goes. A row this run listed (written or kept) stays: it was just normalized under today's rules with its
 * own per-row venue flags (WWOZ's dance floors, D-342), which the source's flags do not carry. Any other stored row
 * is screened again by the source's flags (a rule that now leaves it out).
 */
export function storedRowRejectReason(
  row: {
    id: string;
    title: string;
    styles: readonly string[];
    startsAt: Date | null;
    nightDate: string;
    tz: string;
  },
  args: {
    outside: readonly OutsideListing[];
    listed: ReadonlySet<string>;
    metroName: string;
    flags: VenueCalendarFlags;
  },
): string | null {
  if (outsideMatch(args.outside, row, args.listed)) return `not in ${args.metroName}`;
  if (args.listed.has(row.id)) return null;
  return screenStoredRow(row, args.flags);
}

/** A registry of adapters by id; two adapters with one id is a mistake, never a silent override. */
export function adapterRegistry(
  adapters: readonly SourceAdapter[],
): ReadonlyMap<AdapterId, SourceAdapter> {
  const registry = new Map<AdapterId, SourceAdapter>();
  for (const adapter of adapters) {
    if (registry.has(adapter.id)) throw new Error(`two adapters share the id ${adapter.id}`);
    registry.set(adapter.id, adapter);
  }
  return registry;
}

export const REGISTRY: ReadonlyMap<AdapterId, SourceAdapter> = adapterRegistry([
  icsAdapter,
  jsonLdAdapter,
  wpTribeAdapter,
  squarespaceAdapter,
  diceAdapter,
  eventbriteAdapter,
  ticketmasterAdapter,
  raAdapter,
  // Each lane's own file (docs/WORKSTREAMS.md, section 4).
  ...READER_ADAPTERS,
  ...DISCOVERY_ADAPTERS,
  ...PLATFORM_ADAPTERS,
]);

/** Sources kept for link-out or later phases, never harvested. */
const NOT_HARVESTED = new Set(["social_link", "serp", "directory", "connected"]);

export interface SourceReport {
  url: string;
  adapter: string | null;
  status: "ok" | "unchanged" | "failed" | "skipped" | "waits_for_extraction" | "deferred";
  detail: string | null;
  listings: number;
  written: number;
  unplaced: number;
  rejected: number;
  /** Written with the night and no time: shown as "Time not listed" (D-060). */
  untimed: number;
  /** Of `untimed`, how many are on a placed venue, so they can appear on the site. */
  untimedPlaced: number;
  /** Titles screened as not an event: only a date or a heading, or a closure notice (D-060). */
  notEvents: number;
  tonight: number;
  notes: string[];
}

export interface IngestReport {
  metro: string;
  /** What this run read of what was due (D-088); the report opens with it. */
  refresh: RefreshReport;
  tonight: string;
  window: string[];
  adapters: Array<{ id: AdapterId; gate: Gate }>;
  sources: SourceReport[];
  /**
   * Every source that failed this run, with its streak and what it still has on the site (TWIS
   * F1, D-114). Report only: nothing is retired or hidden for a failed fetch.
   */
  failing: FailingSource[];
  /** Seeded sources that read fine but list nothing on the next 7 nights (D-559). Report only. */
  silent: SilentSource[];
  discovered: number;
  dedupe: DedupeReport;
  /** The model's verdicts on pairs the scorer queued (D-150), asked before dedupe so they act this run. */
  dedupeReview: DedupeReviewReport;
  totals: {
    listings: number;
    written: number;
    unplaced: number;
    rejected: number;
    untimed: number;
    untimedPlaced: number;
    notEvents: number;
    tonightListed: number;
    /**
     * Listed rows in the window, tonight on, with no venue: on the site as "Location not listed",
     * with no pin (D-082). Counted from the database after the run, whatever run wrote them.
     */
    unplacedListed: number;
  };
  /** Stored listings with no venue placed from the venue their source gave (D-082). */
  placing: { placed: number; notes: string[] };
  /** Listings still with no venue placed from their own event page's venue (D-164). */
  eventPages: EventPagePlacing;
  /**
   * The rows `totals.unplacedListed` counts, by night then title: what the site lists as "Location
   * not listed", so a run's report is the audit of it (D-082). `source` is the URL of the source
   * that listed it (its primary one), or null when no source row is left.
   */
  unplacedRows: Array<{ title: string; night: string; source: string | null }>;
  geocoderRequests: number;
  /** Google place IDs for the window's venues (D-066); null when no key is configured. */
  placeIds: PlaceIdReport | null;
  /** Listed points checked against their address, and placeholder addresses (D-071). */
  venues: VenueReport;
  pruned: number;
  /** Model extraction (PLAN 8.2, 8.5): what the day's allowance paid for. */
  ai: AiReport;
  /** Our own summaries of the window's listings (PLAN 8.3, D-109). */
  summaries: SummaryReport;
}

export interface RefreshReport {
  /** Every source was read, due or not: a forced full read, or `only`. */
  full: boolean;
  /** Sources due this run: read, or deferred when the time box ran out. */
  due: number;
  read: number;
  /** Sources not due this run, left alone. */
  skipped: number;
  /** Due sources the time box left for the next run, which reads them first. */
  deferred: number;
  /** Wall-clock minutes inside the run, from its start to its report (job setup not included). */
  runMinutes: number;
  /** Sources due at the next hourly run (this run's start plus an hour). */
  nextRunDue: number;
  /** The run's time box in minutes; null when it has none (a full read). */
  timeBoxMinutes: number | null;
}

export interface AiReport {
  /** False when no extraction client was given: pages then wait, as in Phase 2. */
  enabled: boolean;
  pagesRead: number;
  cached: number;
  escalated: number;
  /**
   * Parts of pages that write 3 or more of the window's nights whose base read listed none, read
   * again by the stronger model (D-074).
   */
  emptySuspect: number;
  deferred: number;
  calls: number;
  /** In the provider's own unit, by unit. */
  spent: { neuron: number; request: number; microdollar: number };
  /** Listings written from model extraction, against all listings written. */
  listingsFromModel: number;
}

/**
 * Model reading time per run: 30 minutes, half the ingest job's 60-minute limit, so the report
 * is always written. Pages past it are deferred, not failed.
 */
export const MODEL_TIME_BUDGET_MS = 30 * 60_000;

export interface IngestOptions {
  db: Db;
  metro: Metro;
  http: HttpClient;
  env: Readonly<Record<string, string | undefined>>;
  now: () => Date;
  log?: (line: string) => void;
  /** Harvest only these source URLs (for a quick check), due or not. */
  only?: readonly string[];
  /** Tests only: this metro's seeds instead of config's. */
  seeds?: readonly SeedSource[];
  /** Read every enabled source, due or not, with no time box (D-088): the dispatch input. */
  full?: boolean;
  /**
   * Wall-clock time the run may spend starting sources (D-088); a due source still waiting when it
   * is spent is deferred to the next run. Absent, or on a full read: no time box.
   */
  timeBoxMs?: number;
  /**
   * Wall-clock time a full read may spend starting sources (D-159); absent: none.
   */
  fullTimeBoxMs?: number;
  /** The wall clock the time box and run minutes are measured on; Date.now when unset. */
  wallClock?: () => number;
  /** The job_runs row to fill in; created by the caller so a crash still leaves a record. */
  runId?: string;
  /** Model extraction for pages no deterministic reader answers. Absent: they wait (Phase 2). */
  ai?: {
    client: AiClient;
    cache: ExtractionCache;
    /** Wall-clock time this run may spend waiting on model reads; MODEL_TIME_BUDGET_MS when unset. */
    timeBudgetMs?: number;
    /** Write the window's summaries after the run (D-109); the ingest job sets it on whole runs. */
    summarize?: boolean;
  } | null;
  /** Sources read at once in step 3 (D-160); 1 when unset. */
  concurrency?: number;
}

export async function runIngest(options: IngestOptions): Promise<IngestReport> {
  const { db, metro, http, env, now } = options;
  const log = options.log ?? (() => {});
  // An empty list means no filter: the CLI passes [] when --only is not given.
  const only = options.only?.length ? options.only : null;
  const tonight = currentNightDate(now(), metro.tz);
  const nights = windowNights(tonight, MATERIALIZE_DAYS);
  // When each source is next read (D-088), and the order of the next run's queue (loadSources).
  // A source this run deferred, for want of model time or of the run's time box, is stamped with
  // this run's start: due next run, and first (no source due since has an earlier stamp). One
  // never read, or that failed, has no stamp: due next run, after those. One read now is stamped
  // with its next time (`readStampFor`): its cadence, or sooner when it lists a night tonight. A
  // run reads only the sources that are due (PLAN 6.7).
  const deferredStamp = now();
  const runStart = deferredStamp;
  const full = options.full === true || only !== null;
  const wallClock = options.wallClock ?? Date.now;
  const startedMs = wallClock();
  const timeBoxMs =
    only !== null
      ? null // quick check has no time box
      : full
        ? (options.fullTimeBoxMs ?? null) // full read uses its own time box
        : (options.timeBoxMs ?? null); // due-only run uses its regular time box
  const readStampFor = async (source: Source, readBy: ReadBy): Promise<Date> => {
    const stored = await storedBySource(db, source.id, metro.id, tonight, tonight);
    return nextHarvestAt({ runStart, readBy, listsTonight: stored.listed > 0, zone: metro.tz });
  };
  const blocklist = await loadBlocklist(db);
  const flags = await loadFlags(db, metro.id);
  const ctx: RunCtx = {
    metro,
    now,
    http,
    env,
    log: (event, data) => log(`${event} ${data ? JSON.stringify(data) : ""}`),
  };

  const geocoder: (Geocoder & { requests: () => number }) | null = env.GEOAPIFY_API_KEY
    ? withJapanFallback(
        geoapifyGeocoder(http, metro, env.GEOAPIFY_API_KEY),
        gsiGeocoder(http, metro),
        metro,
      )
    : null;
  const venueCache = new Map<string, Promise<ResolvedVenue | null>>();
  const venueReport = emptyVenueReport();
  // An address the geocoder gives no point for is listed in the report with why.
  const geocodeNoting = async (address: string) => {
    const point = await geocoder!.geocode(address);
    if (!point && geocoder?.refusal) {
      const why = await geocoder.refusal(address);
      if (why) noteOnce((venueReport.refused ??= []), `${address}: ${why}`);
    }
    return point;
  };
  const placeVenue = (input: VenueInput, apiPoint = false) => {
    // A ticketing API's own point is checked against its street address, geocoded to a building
    // (D-071).
    const key = JSON.stringify([input.name, input.address, input.location, apiPoint]);
    let found = venueCache.get(key);
    if (!found) {
      found = resolveVenue(db, metro, input, geocoder ? geocodeNoting : undefined, {
        checkPoint: apiPoint,
        building: geocoder ? (a) => geocoder.building(a) : undefined,
        report: venueReport,
        known: KNOWN_VENUES[metro.slug],
      });
      venueCache.set(key, found);
    }
    return found;
  };

  const adapters = [...REGISTRY.values()].map((adapter) => ({
    id: adapter.id,
    gate: mayRun(adapter, metro, env, flags),
  }));
  const allowed = new Set(adapters.filter((a) => a.gate.run).map((a) => a.id));
  const report: IngestReport = {
    metro: metro.slug,
    refresh: {
      full,
      due: 0,
      read: 0,
      skipped: 0,
      deferred: 0,
      runMinutes: 0,
      nextRunDue: 0,
      timeBoxMinutes: timeBoxMs === null ? null : Math.round(timeBoxMs / 60_000),
    },
    tonight,
    window: nights,
    adapters,
    sources: [],
    failing: [],
    silent: [],
    discovered: 0,
    dedupe: { ...EMPTY_DEDUPE_REPORT, mergedPairs: [] },
    dedupeReview: emptyDedupeReviewReport(),
    summaries: emptySummaryReport(),
    totals: {
      listings: 0,
      written: 0,
      unplaced: 0,
      rejected: 0,
      untimed: 0,
      untimedPlaced: 0,
      notEvents: 0,
      tonightListed: 0,
      unplacedListed: 0,
    },
    placing: { placed: 0, notes: [] },
    eventPages: { asked: 0, placed: 0, removed: 0, notes: [] },
    unplacedRows: [],
    geocoderRequests: 0,
    placeIds: null,
    venues: venueReport,
    pruned: 0,
    ai: {
      enabled: !!options.ai,
      pagesRead: 0,
      cached: 0,
      escalated: 0,
      emptySuspect: 0,
      deferred: 0,
      calls: 0,
      spent: { neuron: 0, request: 0, microdollar: 0 },
      listingsFromModel: 0,
    },
  };

  /**
   * A failed harvest: the line says so, the source's health rolls forward, and the line's first
   * note and the report's failing list say how many runs in a row it has failed and what it still
   * has on the nights the site opens (D-114). Every failure path comes through here, so none is
   * left unsaid. The streak's report is only words: if reading it fails, the line still says
   * "failed this run" and the harvest goes on.
   */
  const markFailed = async (source: Source, line: SourceReport, detail: string) => {
    line.status = "failed";
    line.detail = detail;
    const health = await recordHealth(db, source.id, "failed", now(), detail, null);
    // A failed read is read again in full next run: a stored validator would answer "unchanged"
    // for a page whose listings were never all written.
    await db
      .update(sourcesTable)
      .set({ etag: null, lastModified: null, contentHash: null })
      .where(eq(sourcesTable.id, source.id));
    // A found calendar link that answers with a web page: its own page is read from now on (D-780).
    // A starting address keeps what its seed says.
    if (readsPageInstead(source, detail, health.consecutiveFailures ?? 0)) {
      const switched = await db
        .update(sourcesTable)
        .set(PAGE_INSTEAD)
        .where(
          and(
            eq(sourcesTable.id, source.id),
            sql`${sourcesTable.discoveredBy} is distinct from 'seed_list'`,
          ),
        )
        .returning({ id: sourcesTable.id });
      if (switched.length > 0) line.notes.push(PAGE_INSTEAD_NOTE);
    }
    let stored = {
      listed: 0,
      alone: 0,
      lastNight: null as string | null,
      lastSeenAt: null as Date | null,
    };
    try {
      stored = await storedBySource(
        db,
        source.id,
        metro.id,
        tonight,
        addCalendarDays(tonight, OPENABLE_NIGHTS - 1),
      );
    } catch (error) {
      line.notes.push(`its stored listings could not be counted: ${describe(error)}`);
    }
    const failing = failingSource(source.url, health, stored);
    report.failing.push(failing);
    line.notes.unshift(failureStreakNote(failing));
  };

  // Venues pinned from a placeholder address before D-071 go first, so no listing matches them.
  await removePlaceholderVenues(db, metro, report.venues);

  // 1. Seed sources.
  for (const seed of METRO_SOURCES[metro.slug] ?? []) {
    // A starting address says whether it is a venue's whole calendar, and is stored so (D-121).
    await upsertSource(
      db,
      metro.id,
      { ...seed, mixedCalendar: seed.mixedCalendar ?? false, discoveredBy: "seed_list" },
      // A starting address is read even where discovery had stored the same address switched off
      // (Good Room's site, 2026-10-11); a retired one is switched off again just below (D-047).
      { enable: true },
    );
  }
  // A starting page marked as a venue's own places its listings at that venue (D-087).
  report.venues.seedVenues = await placeSeedSources(db, metro.id, METRO_SOURCES[metro.slug] ?? []);
  // A venue stored before D-280 that is no place ("Various venues in Mexico City") loses its listings.
  report.venues.seedVenues.push(...(await clearNoPlaceVenues(db, metro.id)));
  // D-831: every read under a robots waiver says so in the run report.
  report.venues.seedVenues.push(...robotsWaiverLines(METRO_SOURCES[metro.slug] ?? []));
  // Store each venue's neighbourhood at ingest (D-499)
  report.venues.seedVenues.push(...(await storeVenueNeighbourhoods(db, metro.id)));
  // Retired starting addresses stop being fetched, and the report still names them (D-047). Their
  // listings from tonight on go too: nothing else would retire them (docs/WORKSTREAMS.md).
  for (const retired of METRO_RETIRED_SOURCES[metro.slug] ?? []) {
    const switchedOff = await db
      .update(sourcesTable)
      .set({ enabled: false })
      .where(and(eq(sourcesTable.metroId, metro.id), eq(sourcesTable.url, retired.url)))
      .returning();
    const line = emptyLine(retired.url, null);
    line.detail = `retired from the starting list: ${retired.reason}`;
    for (const source of switchedOff) {
      const gone = await retireRowsOfRetiredSource(db, {
        source,
        nights: nights.filter((night) => night >= tonight),
      });
      line.notes.push(...gone.notes);
    }
    report.sources.push(line);
  }

  // Titles the screens leave out go whatever source stored them (owner, 2026-10-19), and classes the
  // old same-times rule merged come back (D-157).
  const screenedTitles = await retireScreenedTitles(db, {
    metro,
    nights: nights.filter((n) => n >= tonight),
  });
  const restoredClasses = await restoreMergedClasses(db, {
    metro,
    nights: nights.filter((n) => n >= tonight),
  });
  // Stored titles saved before a tidy rule get it, whatever source stored them (D-810, Rio "| TAU" tails).
  const retidied = await retidyStoredTitles(db, {
    metro,
    nights: nights.filter((n) => n >= tonight),
  });

  /** Normalises and writes one source's listings, and fills its report line. */
  const metroSeeds = options.seeds ?? METRO_SOURCES[metro.slug] ?? [];
  const placeholdersByUrl = new Map(
    metroSeeds.map((seed) => [seed.url, seed.placeholderTimes ?? []]),
  );
  const seedsByUrl = new Map(metroSeeds.map((seed) => [seed.url, seed]));
  const store = async (
    source: Source,
    result: HarvestResult,
    line: SourceReport,
    // `rawPage`: the fetched HTML, for fixed weekly nights only (a footer line cleaning drops, D-524).
    options: { eventUrlUnchecked?: boolean; pageText?: string; rawPage?: string } = {},
  ) => {
    const normalized: NormalizedEvent[] = [];
    const screenedNotes: string[] = [];
    // Listings screened here by their key: the row this source stored under that key goes too (D-792).
    const screenedKeys: string[] = [];
    // Listings dated outside the window: left out, but named so a read that wrote nothing says why.
    const outsideWindow: string[] = [];
    const placeholders = placeholdersByUrl.get(source.url) ?? [];
    // Stored on the source (D-121): a starting address's flag, or a calendar discovery found.
    const mixedCalendar = source.mixedCalendar === true;
    // A dance-floor venue whose bands play for dancers (D-341): from its starting address only.
    const bandsForDancers = seedsByUrl.get(source.url)?.bandsForDancers === true;
    // From what local time its bands count (D-322).
    const bandsForDancersFrom = seedsByUrl.get(source.url)?.bandsForDancersFrom;
    // Its own dance nights that name no dance (D-264): from its starting address only.
    // A card marked as its club night ("93 CLUB ...") adds its cleaned title (D-292).
    // A calendar's later pages ("?page=2") keep their starting address's lists (seedNightTitles).
    const nightTitles = seedNightTitles(metroSeeds, source.url);
    const danceNights = [...nightTitles.danceNights];
    // Titles its lead checked as not dance nights, screened out on any calendar.
    const notDanceNights = nightTitles.notDanceNights;
    let placeholderListings = 0;
    let houseHoursApplied = 0;
    let zuluApplied = 0;
    // Prefix for detecting other-city links on multi-city pages (Daybreaker).
    const cityLinkPrefix = seedsByUrl.get(source.url)?.cityLinkPrefix;
    // Nights that are left out as not in this metro, to retire stored rows later.
    const outsideListings: OutsideListing[] = [];
    // Standing weekly nights a lead checked on the page: listed without the model while the page still
    // writes their line (fixed weekly nights, D-524 follow-up).
    const fixedSeed = seedsByUrl.get(source.url);
    let incoming = result.listings;
    const fixedPage = options.rawPage ?? options.pageText;
    if (fixedSeed?.fixedNights?.length && fixedPage !== undefined) {
      const replaced = new Set(
        fixedSeed.fixedNights
          .flatMap((f) => f.replacesTitles ?? [])
          .map((t) => t.trim().toLowerCase()),
      );
      const fixed = fixedNightListings(fixedSeed.fixedNights, {
        pageText: fixedPage,
        pageUrl: source.url,
        fetchedAt: now(),
        fromNight: tonight,
        currency: currencyForCountry(metro.countryCode ?? "US"),
        sourceStyles: fixedSeed.styles,
        venueName: fixedSeed.venuePage ? fixedSeed.label : null,
        venueAddress: fixedSeed.venueAddress ?? null,
        zone: metro.tz,
      });
      incoming = [
        ...result.listings.filter((l) => !replaced.has(l.listing.title.trim().toLowerCase())),
        ...fixed.listings,
      ];
      for (const f of fixedSeed.fixedNights) danceNights.push(f.title);
      line.notes.push(...fixed.notes);
    }
    for (const raw of incoming) {
      // JSON-LD times with wrong Z suffix (Comfama, Medellín).
      const zulu = withZuluAsLocal(raw, seedsByUrl.get(source.url)?.jsonldZuluIsLocal, metro.tz);
      if (zulu.applied) zuluApplied += 1;
      // A venue's own stated opening hours time its untimed nights (D-494, Lust in Rio).
      const housed = withHouseHours(zulu.listing, seedsByUrl.get(source.url)?.houseHours);
      if (housed.applied) houseHoursApplied += 1;
      const stated = housed.listing;
      // A card's date line, rooms and genre tags run into the title are cut off (D-224).
      const carded = withCardTitle(stated, seedsByUrl.get(source.url)?.cardTitle);
      if (carded === null) {
        line.notEvents += 1;
        screenedNotes.push(
          `${stated.listing.title.trim()}: not an event (only the card's date and time)`,
        );
        continue;
      }
      // A title the model already cleaned is found in the page under its card (D-297).
      const card = seedsByUrl.get(source.url)?.cardTitle;
      if (
        carded !== stated
          ? isDanceCard(stated.listing.title, card)
          : options.pageText !== undefined &&
            isDanceCardInText(stated.listing.title, options.pageText, card)
      ) {
        danceNights.push(carded.listing.title);
      }
      // Apply source venue address if source is not already placed at a seeded venue (D-138)
      // A room of the source's own venue is that venue ("Bad Room" at Good Room, 2026-10-15).
      // A venue written as "various venues", or only as the city ("London", D-840), is no place (D-280).
      const roomed = withVenueRooms(
        withoutNoPlaceVenue(carded, [metro.name]),
        seedsByUrl.get(source.url),
      );
      const venueSeed = venueSeedFor(source.url, metroSeeds);
      const ownVenue = withSeedVenue(roomed, venueSeed, source.venueId != null);
      // A regular night named in the title is held where the organiser's own page says (D-279).
      const titled = withTitleVenue(ownVenue, seedsByUrl.get(source.url)?.titleVenues, line.notes);
      // A listing naming a hand-checked venue with no address takes its address (D-161).
      const withVenue = withKnownVenue(titled, KNOWN_VENUES[metro.slug], metro.countryCode ?? "US");
      // A listing placed at a known venue that has closed is not listed there (D-263).
      const closedVenue = closedKnownVenue(withVenue, KNOWN_VENUES[metro.slug]);
      if (closedVenue) {
        line.notEvents += 1;
        screenedNotes.push(
          `${withVenue.listing.title.trim()}: venue closed (${closedVenue.names[0] ?? closedVenue.address}: ${closedVenue.closed})`,
        );
        continue;
      }

      // A clock time this site prints on every event is not a stated time (D-063).
      const placeheld = withoutPlaceholderTimes(withVenue, placeholders);
      // A site whose start clocks are shifted has stated no start time (theronda.us, 2026-10-14).
      // Use exact URL match for startTimesShifted
      const exactSeed = seedsByUrl.get(source.url);
      const shifted = exactSeed?.startTimesShifted
        ? withoutStartTimes(placeheld.harvested)
        : { harvested: placeheld.harvested, dropped: 0 };
      const harvested = shifted.harvested;
      if (placeheld.dropped + shifted.dropped > 0) placeholderListings += 1;
      // A title that is only a date, a heading or a closure notice is not an event (D-060): it is
      // screened once here, before a rule would repeat it on every night, and counted.
      const screened = screenTitle(harvested.listing.title, harvested.listing.venue.name);
      if (screened) {
        line.notEvents += 1;
        screenedNotes.push(`${harvested.listing.title.trim()}: not an event (${screened.reason})`);
        continue;
      }
      const { listings, error, linksDropped } = expandRecurrence(harvested, tonight, metro.tz);
      if (error) line.notes.push(`${harvested.listing.title}: ${error}`);
      if (linksDropped.length > 0) {
        line.notes.push(
          `${harvested.listing.title.trim()}: a rule's nights share no link to one night (${linksDropped.join(", ")}); dropped from its nights`,
        );
      }
      // A lesson that ends before the dancing is its own event (D-754).
      for (const one of listings.flatMap(splitLessonBeforeDancing)) {
        const outcome = normalizeListing(one, {
          metro,
          source: {
            ...source,
            mixedCalendar,
            bandsForDancers,
            bandsForDancersFrom,
            danceNights,
            notDanceNights,
          },
          now: now(),
        });
        // A site that prints its clocks wrong also files late nights under the wrong day: a title naming
        // its weekly day ("Tango Mondays") on another night is misdated (theronda.us, D-589); so does a model
        // read of a page (ruedalibre.co.uk, D-878).
        const wrongDay = outcome.ok
          ? wrongWeekdayScreen(outcome.event.title, outcome.event.nightDate, {
              startTimesShifted: exactSeed?.startTimesShifted,
              method: one.provenance.method,
            })
          : null;
        if (outcome.ok && wrongDay) {
          line.notEvents += 1;
          if (one.externalId) screenedKeys.push(one.externalId);
          screenedNotes.push(`${outcome.event.title}: not an event (${wrongDay.reason})`);
        } else if (outcome.ok) {
          if (nights.includes(outcome.event.nightDate)) normalized.push(outcome.event);
          else outsideWindow.push(`${outcome.event.title} (${outcome.event.nightDate})`);
        } else if (outcome.kind === "not_an_event") {
          line.notEvents += 1;
          if (one.externalId) screenedKeys.push(one.externalId);
          screenedNotes.push(`${outcome.title}: not an event (${outcome.reason})`);
        } else {
          line.rejected += 1;
          line.notes.push(`${outcome.title}: ${outcome.reason}`);
        }
      }
    }
    if (placeholderListings > 0)
      line.notes.push(
        `${placeholderListings} listing(s) gave only ${placeholders.join(" or ")}, which this site prints on every event: read as time not listed`,
      );
    if (zuluApplied > 0) {
      line.notes.push(
        `${zuluApplied} JSON-LD time(s) read as local wall clock (jsonldZuluIsLocal)`,
      );
    }
    if (houseHoursApplied > 0) {
      const hours = seedsByUrl.get(source.url)?.houseHours;
      line.notes.push(
        `${houseHoursApplied} listing(s) took the venue's stated hours (${hours?.start}${hours?.end ? `-${hours.end}` : ", no closing time"}; ${hours?.checked})`,
      );
    }
    // Within one source and run, a night listed both by a rule and by a dated listing is the dated
    // listing (D-070), and a night listed both with and without a time keeps the time.
    const { kept: siblingsKept, notes: siblingNotes } = dropUntimedWithTimedSibling(
      dropRuleNightsWithDatedTwin(normalized),
    );
    // A listing whose own address names a place outside the metro ("Warsaw, PL") is not this
    // metro's night, placed or not: it is left out and named, never listed as "Location not
    // listed" (PR 2). Only an address with no point of its own is asked about.
    const kept: NormalizedEvent[] = [];
    for (const event of siblingsKept) {
      // First check: does the event link to another city's page on a multi-city source?
      const otherCity = otherCityLink(
        [event.eventUrl, event.ticketUrl, event.canonicalUrl],
        cityLinkPrefix,
      );
      if (otherCity) {
        line.notEvents += 1;
        screenedNotes.push(`${event.title}: not in ${metro.name} (its link is ${otherCity})`);
        outsideListings.push({ title: event.title, night: event.nightDate });
        continue;
      }
      // A listing whose own point is outside the metro (Prudential Center in Newark, D-084).
      const outside =
        event.venue.location && !insideMetro(metro, event.venue.location)
          ? (event.venue.name ?? event.venue.address ?? "its own map point")
          : null;
      const where =
        outside ??
        (!event.venue.location && event.venue.address && geocoder?.elsewhere
          ? await geocoder.elsewhere(event.venue.address)
          : null);
      if (where) {
        line.notEvents += 1;
        screenedNotes.push(`${event.title}: not in ${metro.name} (the listing gives ${where})`);
        outsideListings.push({ title: event.title, night: event.nightDate });
        continue;
      }
      // A listing with no point and no address whose title or venue name names a town outside the
      // metro ("Hartford Tango Practica", 2026-10-20; "Paramus Firehouse", 2026-10-22) is not this
      // metro's night. One with a point or an address is never dropped by this rule.
      const placeless = !event.venue.location && (event.venue.address ?? "").trim() === "";
      const titleTown = placeless ? titleNamesOutsideTown(metro.slug, event.title) : null;
      const venueTown =
        placeless && !titleTown ? titleNamesOutsideTown(metro.slug, event.venue.name ?? "") : null;
      if (titleTown || venueTown) {
        line.notEvents += 1;
        screenedNotes.push(
          `${event.title}: not in ${metro.name} (the ${titleTown ? "title" : "venue"} names ${titleTown ?? venueTown})`,
        );
        outsideListings.push({ title: event.title, night: event.nightDate });
        continue;
      }
      // A title copied from another city's club night ("Sports Night Wednesday at SCALA London" on an LA
      // Saturday, RA 2581517, D-863): it names that city's venue and another weekday.
      const elsewhere = titleNamesVenueElsewhere(event.title, event.nightDate, [metro.name]);
      if (elsewhere) {
        line.notEvents += 1;
        screenedNotes.push(
          `${event.title}: not in ${metro.name} (the title names a ${elsewhere} venue)`,
        );
        outsideListings.push({ title: event.title, night: event.nightDate });
        continue;
      }
      kept.push(event);
    }
    line.notes.push(...siblingNotes, ...screenedNotes);
    if (outsideWindow.length > 0) {
      line.notes.push(
        `${outsideWindow.length} listing(s) dated outside the ${nights.length}-night window; left out: ${[...new Set(outsideWindow)].slice(0, 5).join(", ")}`,
      );
    }
    line.listings = kept.length;
    line.tonight = kept.filter((e) => e.nightDate === tonight).length;
    const rawDocumentId = result.doc
      ? await recordFetch(db, source.id, {
          etag: result.doc.etag,
          lastModified: result.doc.lastModified,
          contentHash: result.doc.contentHash,
          doc: {
            url: result.doc.url,
            fetchedAt: result.doc.fetchedAt,
            httpStatus: result.doc.httpStatus,
            cleanedText: result.doc.cleanedText,
            method: result.listings[0]?.provenance.method ?? "feed",
          },
        })
      : null;
    // Times stored before this source's placeholder was declared are withdrawn first (D-065), so
    // they no longer stand in the way of the untimed listings that replace them.
    const withdrawn = await clearPlaceholderTimes(db, { source, placeholders, nights });
    line.notes.push(...withdrawn.notes);
    const written = await writeEvents(db, {
      metro,
      source,
      events: kept,
      blocklist,
      placeVenue,
      rawDocumentId,
      keepEventUrls: options.eventUrlUnchecked === true,
    });
    // A survivor's re-harvest follows its own source; what merged listings add comes back (D-090).
    await refillMergedFacts(db, written.eventIds);
    line.written = written.written;
    line.unplaced = written.unplaced;
    // Rows this source stored before that its screens now leave out go, tonight included.
    const listed = new Set([...written.eventIds, ...written.keptIds]);
    const screenedRows = await retireScreened(db, {
      source,
      nights: nights.filter((night) => night >= tonight),
      keys: [...(result.screened ?? []).map((s) => s.externalId), ...screenedKeys],
      reject: (row) =>
        storedRowRejectReason(row, {
          outside: outsideListings,
          listed,
          metroName: metro.name,
          flags: {
            mixedCalendar,
            bandsForDancers,
            bandsForDancersFrom,
            danceNights,
            notDanceNights,
            styles: source.styles,
          },
        }),
    });
    line.notes.push(...screenedRows.notes);
    line.untimed = written.untimed;
    line.untimedPlaced = written.untimedPlaced;
    // Rows written before D-060 at an invented midnight give way to the untimed listing that
    // replaces them, on the first run of their source that writes it.
    const invented = await retireInventedMidnights(db, {
      source,
      writtenIds: written.eventIds,
      nights,
    });
    line.notes.push(...invented.notes.slice(0, 20));
    const replaced = await retireClearedPlaceholders(db, {
      source,
      placeholders,
      writtenIds: written.eventIds,
      nights,
    });
    line.notes.push(...replaced.notes.slice(0, 20));
    // A night this source stored before under another key is one listing, not two (2026-10-14).
    const twins = await retireSameSourceTwins(db, { source, writtenIds: written.eventIds });
    line.notes.push(...twins.notes.slice(0, 20));
    // A night this source now lists at a moved time leaves its older copy behind (D-277).
    const moved = await retireMovedCopies(db, {
      source,
      writtenIds: written.eventIds,
      listedIds: [...written.eventIds, ...written.keptIds],
    });
    line.notes.push(...moved.notes.slice(0, 20));
    const siblings = await retireSameSourceSiblings(db, { source, writtenIds: written.eventIds });
    line.notes.push(...siblings.notes.slice(0, 20));
    line.notes.push(...written.notes.filter((n) => !n.startsWith("venue not placed")).slice(0, 20));
    line.notes.push(...(result.notes ?? []));
    // Every row this run's listings stand for: the ones written and the timed rows kept for them.
    return {
      listedIds: [...written.eventIds, ...written.keptIds],
      // Timed rows kept for a listing the read gave no time: listed, but not vouched for.
      uncheckedIds: written.keptUncheckedIds,
      tonightTitles: [...new Set(kept.filter((e) => e.nightDate === tonight).map((e) => e.title))],
    };
  };

  /**
   * Reads a page no deterministic reader answered with the model (PLAN 6.5 step 6). `page` is
   * passed when the probe already fetched it; otherwise it is fetched with the stored validators,
   * and a 304 reuses the extraction cached under the stored content hash, or, when none is, reads
   * the text stored for it.
   */
  let modelMs = 0;
  // Cached parts whose check drops facts are re-read once, a few a run (D-101).
  const rereadBudget = { left: REREADS_PER_RUN };
  const readWithModel = async (
    source: Source,
    line: SourceReport,
    why: string,
    page?: HttpResponse,
  ): Promise<void> => {
    const ai = options.ai;
    if (!ai) {
      line.status = "waits_for_extraction";
      line.detail = `${why}; model extraction is not configured in this run`;
      await recordHealth(db, source.id, "ok", now(), null, await readStampFor(source, "model"));
      return;
    }
    let fetched =
      page ??
      (await http.request({
        url: source.url,
        purpose: "crawl",
        headers: { accept: "text/html" },
        conditional: { etag: source.etag, lastModified: source.lastModified },
      }));
    let pageUrl = fetched.url || source.url;
    // The text the model reads and the read is checked against. Always in hand (D-074): on a 304
    // it is the text stored when the page was last fetched, or, once that is pruned (D-043), the
    // page fetched again in full, even when the extraction cache holds the page's read, so the
    // checks against the page (D-070, D-073) always run. The cache is keyed by this text itself.
    let text: string;
    // True when `text` is to be stored as the page's text under its hash: fetched now, or a
    // stored text whose hash is not the source's (a changed page, for the store).
    let storeText = true;
    if (fetched.notModified) {
      if (!source.contentHash) {
        line.status = "unchanged";
        line.detail = "page unchanged since it was last read";
        await recordHealth(
          db,
          source.id,
          "unchanged",
          now(),
          null,
          await readStampFor(source, "model"),
        );
        return;
      }
      const stored = await storedPageText(db, source.id, source.contentHash);
      if (stored !== null) {
        text = stored;
        storeText = false;
      } else {
        fetched = await http.request({
          url: source.url,
          purpose: "crawl",
          headers: { accept: "text/html" },
        });
        pageUrl = fetched.url || source.url;
        text = cleanPageText(fetched.body, pageUrl);
      }
    } else {
      text = cleanPageText(fetched.body, pageUrl);
    }
    const hash = sha256(text);
    // Text whose hash is not the one stored for the source is a changed page: its hash and text are
    // recorded as a new fetch's would be.
    if (hash !== source.contentHash) storeText = true;
    // A stored night the page's own words contradict for its title goes, whatever this read
    // listed or could read (D-080): the page text is whole even when a part of the model's read
    // timed out, so NYC Swings' Flow Fridays on October 2, stored by run 26, goes although every
    // read since has been partial. The check needs no model, so it runs on the text in hand when
    // no part could be read or the run's model time is spent too. Tonight included; a night a
    // read listed stays. `titles` are the read's (none without a read), `lang` the page's.
    const pageText = text;
    const retireContradicted = async (
      listedIds: readonly string[],
      lang: string | null,
      titles: readonly string[],
      uncheckedIds: readonly string[] = [],
    ) => {
      if (!pageText.trim()) return;
      const contradictedRows = await retireUnlisted(db, {
        source,
        listedIds,
        nights: nights.filter((night) => night >= tonight),
        contradictedIn: { text: pageText, lang, titles },
        what: "on a night the page contradicts",
      });
      line.notes.unshift(...contradictedRows.notes);
      // And a stored row the read did not list keeps its times only where the listing's own part
      // of the page writes them; otherwise its night is listed with no time (seam review,
      // 2026-09-29). This too reads only the page. A read's title that is no event ("Oct 1", a
      // date alone: D-060) does not end another listing's part.
      const untimed = await untimedForUnwrittenTimes(db, {
        source,
        listedIds: listedIds.filter((id) => !uncheckedIds.includes(id)),
        nights: nights.filter((night) => night >= tonight),
        text: pageText,
        lang,
        titles: titles.filter((title) => screenTitle(title) === null),
        now: now(),
      });
      if (untimed.length > 0) {
        const rewritten = await writeEvents(db, {
          metro,
          source,
          events: untimed,
          blocklist,
          placeVenue,
        });
        await refillMergedFacts(db, rewritten.eventIds);
        line.notes.unshift(
          `${untimed.length} stored listing(s) at a time their part of the page does not write were listed with no time: ${untimed
            .map((e) => `${e.title} on ${e.nightDate}`)
            .join("; ")}`,
        );
      }
      // And its other facts only where its own part writes them (D-108).
      line.notes.unshift(
        ...(await withdrawUnwrittenFacts(db, {
          source,
          listedIds: listedIds.filter((id) => !uncheckedIds.includes(id)),
          nights: nights.filter((night) => night >= tonight),
          text: pageText,
          lang,
          titles: titles.filter((title) => screenTitle(title) === null),
          currency: currencyForCountry(metro.countryCode ?? ""),
        })),
      );
    };
    // A run spends at most `timeBudgetMs` waiting on the model, so a slow provider defers the
    // remaining pages to the next run instead of running into the job's own time limit.
    const budgetMs = ai.timeBudgetMs ?? MODEL_TIME_BUDGET_MS;
    if (modelMs >= budgetMs) {
      report.ai.deferred += 1;
      line.adapter = "llm";
      line.status = "deferred";
      line.detail = `${why}; deferred to a later run: this run's ${Math.round(budgetMs / 60_000)} minutes of model reading are spent`;
      await retireContradicted([], null, []);
      await recordHealth(db, source.id, "skipped", now(), null, deferredStamp);
      return;
    }
    // Nor once the run's time box is spent: a read started then runs past the box (London, 2026-11-01).
    if (timeBoxSpent(startedMs, wallClock(), timeBoxMs)) {
      report.ai.deferred += 1;
      line.adapter = "llm";
      line.status = "deferred";
      line.detail = `${why}; deferred to the next run: this run's ${report.refresh.timeBoxMinutes}-minute time box is spent`;
      await retireContradicted([], null, []);
      await recordHealth(db, source.id, "skipped", now(), null, deferredStamp);
      return;
    }
    log(`reading ${source.url} with the model`);
    const modelStarted = Date.now();
    const result = await extractPageInChunks(
      {
        pageText: text,
        header: {
          url: pageUrl,
          platform: source.platform === "probed" ? null : source.platform,
          today: tonight,
          tz: metro.tz,
        },
        metro: metro.slug,
      },
      ai.client,
      // A page whose cached read is wrong is read afresh (D-480).
      seedsByUrl.get(source.url)?.extractUncached ? withoutCachedReads(ai.cache) : ai.cache,
      {
        reread: {
          budget: rereadBudget,
          wants: (extraction) => {
            const out = extractionToHarvested(extraction, {
              pageUrl,
              fetchedAt: fetched.fetchedAt,
              today: tonight,
              pageText: text,
              directory: source.trustTier === "directory",
              countryCode: metro.countryCode,
              sourceStyles: source.styles,
            });
            return (
              out.factsDropped > 0 ||
              out.timesMissed > 0 ||
              emptyReadOfWindowNight(extraction, text, nights, out.listings)
            );
          },
        },
      },
    );
    modelMs += Date.now() - modelStarted;
    for (const call of result.calls) {
      report.ai.calls += 1;
      if (call.usage) report.ai.spent[call.usage.unit] += call.usage.cost;
      await db.insert(costLog).values({
        job: call.job,
        runId: options.runId ?? null,
        metroId: metro.id,
        sourceId: source.id,
        provider: call.provider ?? "none",
        model: call.model,
        inputTokens: call.usage?.inputTokens ?? 0,
        outputTokens: call.usage?.outputTokens ?? 0,
        requests: 1,
        // Only Bedrock bills in money (D-142); its cost is in microdollars.
        usd: call.usage?.unit === "microdollar" ? (call.usage.cost / 1_000_000).toFixed(6) : "0",
        cost: call.usage ? String(call.usage.cost) : null,
        unit: call.usage?.unit ?? null,
      });
    }
    line.adapter = "llm";
    // Parts whose base read listed nothing though they write the window's nights (D-074).
    if (result.emptySuspect) {
      report.ai.emptySuspect += result.emptySuspect;
      line.notes.push(
        `${result.emptySuspect} part(s) of the page write 3 or more of the window's nights but the base read listed none: read again by the stronger model`,
      );
    }
    if (result.status === "deferred") {
      report.ai.deferred += 1;
      line.status = "deferred";
      line.detail = `${why}; the model read was deferred to a later run (${result.detail})`;
      await retireContradicted([], null, []);
      await recordHealth(db, source.id, "skipped", now(), null, deferredStamp);
      return;
    }
    if (result.status === "failed") {
      await retireContradicted([], null, []);
      await markFailed(source, line, `model extraction: ${result.detail}`);
      return;
    }
    report.ai.pagesRead += 1;
    if (result.cached) report.ai.cached += 1;
    if (result.escalated) report.ai.escalated += 1;
    line.adapter = `llm (${result.cached ? "cached, " : ""}${result.model})`;
    if (result.extraction.page_kind === "not_relevant") {
      line.notes.push("the model found no dance events on this page");
    }
    // The read is checked against the page it came from (D-070, D-073), which is always in hand.
    const read = extractionToHarvested(result.extraction, {
      pageUrl,
      fetchedAt: fetched.fetchedAt,
      today: tonight,
      pageText: text,
      directory: source.trustTier === "directory",
      countryCode: metro.countryCode,
      sourceStyles: source.styles,
      weeklyGrid: seedsByUrl.get(source.url)?.weeklyGrid === true,
      venueLabel:
        seedsByUrl.get(source.url)?.venuePage === true
          ? seedsByUrl.get(source.url)?.label
          : undefined,
    });
    line.rejected += read.rejected.length;
    for (const r of read.rejected) line.notes.push(`${r.title}: ${r.reason}`);
    // A dates-only list whose nights' own pages give their starts (D-275, The Ave Live).
    // One event's page that lists its dates one per line: one night per listed date (D-491, Newham).
    const listed = seedsByUrl.get(source.url)?.datesList
      ? withListedDates(read.listings, text, nights, result.extraction.language)
      : { listings: read.listings, added: 0 };
    if (listed.added > 0) {
      line.notes.push(`${listed.added} night(s) taken from the page's list of dates`);
    }
    // A card that links its event's own page listing each date as JSON-LD: one night per date (D-483).
    const dated = seedsByUrl.get(source.url)?.eventPageDates
      ? await datesFromEventPages(listed.listings, {
          http,
          pageUrl,
          pageText: text,
          tz: metro.tz,
          nights,
        })
      : { listings: listed.listings, notes: [] };
    const timed = seedsByUrl.get(source.url)?.eventPageTimes
      ? await timesFromEventPages(dated.listings, {
          http,
          pageUrl,
          tz: metro.tz,
          limit: seedsByUrl.get(source.url)?.eventPageTimesLimit,
        })
      : { listings: dated.listings, notes: [] };
    const { listedIds, uncheckedIds, tonightTitles } = await store(
      source,
      {
        listings: timed.listings,
        doc: { ...docOf(fetched, hash), cleanedText: storeText ? text : null },
        notes: [...result.notes, ...read.notes, ...dated.notes, ...timed.notes],
      },
      line,
      { eventUrlUnchecked: read.unchecked, pageText: text, rawPage: fetched.body },
    );
    report.ai.listingsFromModel += line.written;
    // A whole read (every part of the page read, nothing deferred) that listed something is the
    // page's current word: this source's rows after tonight that it no longer lists are retired
    // (D-070). A partial read retires nothing, whatever it rejected: the part not read may list
    // them (review 2026-09-29). Tonight is left to the day-of check. A listing rejected because
    // the page does not write its title is not listed (D-073): its rows go with the others, and
    // when it was all a whole read had, the rows under its title go on their own. A whole read
    // that listed nothing retires, besides, this source's rows after tonight that the page no
    // longer gives on their night: their title is not written, or no date or weekday of the night
    // beside it (owner, 2026-10-23); a page that still writes a night keeps it. Nothing is ever
    // retired because a page writes none of the window's nights.
    // A title the page writes whose recurrence it does not (`recurrenceNotOnPage`) is never
    // retired as a title: its rows are left out of the above, and a whole read retires only those
    // on a night the page does not state beside the title (`dateBesideTitle`, D-080) and on a
    // weekday it does not name near the title, the nights an invented "every Thursday" made. The
    // page's own dated nights, and a real rule's nights whose wording the check could not match,
    // stay.
    // A fixed night's closed dates (config `closed`, the venue's own word) take this source's rows
    // and the venue's copies of that night off the site, tonight included (D-822).
    const closedNights = closedNightsIn(
      seedsByUrl.get(source.url)?.fixedNights ?? [],
      nights.filter((night) => night >= tonight),
    );
    if (closedNights.length > 0) {
      const closedRows = await retireClosedNights(db, { source, closed: closedNights, listedIds });
      line.notes.unshift(...closedRows.notes);
    }
    const later = nights.filter((night) => night > tonight);
    const ruleTitles = read.recurrenceNotOnPage;
    const readTitles = result.extraction.listings.map((l) => l.title.trim());
    if (!result.unread) {
      // A page that lists several cities' nights (cityLinkPrefix) writes other cities' titles and
      // dates too: no night is kept or listed again for it (Daybreaker, 2026-10-23).
      const cityLinkPrefix = seedsByUrl.get(source.url)?.cityLinkPrefix;
      const keepStated = cityLinkPrefix
        ? undefined
        : { text, lang: result.extraction.language, titles: readTitles };
      if (listedIds.length > 0) {
        const unlisted = await retireUnlisted(db, {
          source,
          listedIds,
          nights: later,
          exceptTitles: ruleTitles,
          keepStated,
          screen: {
            mixedCalendar: source.mixedCalendar === true,
            bandsForDancers: seedsByUrl.get(source.url)?.bandsForDancers === true,
            bandsForDancersFrom: seedsByUrl.get(source.url)?.bandsForDancersFrom,
            danceNights: seedNightTitles(metroSeeds, source.url).danceNights,
            notDanceNights: seedNightTitles(metroSeeds, source.url).notDanceNights,
            styles: source.styles,
          },
        });
        line.notes.unshift(...unlisted.notes);
      } else {
        if (read.notOnPage.length > 0) {
          const unlisted = await retireUnlisted(db, {
            source,
            listedIds,
            nights: later,
            titles: read.notOnPage,
          });
          line.notes.unshift(...unlisted.notes);
        }
        const unsupported = await retireUnlisted(db, {
          source,
          listedIds,
          nights: later,
          exceptTitles: ruleTitles,
          unsupportedIn: { text, lang: result.extraction.language },
        });
        line.notes.unshift(...unsupported.notes);
      }
      // A venue calendar's untimed row that names no dance, which this whole read did not list, is
      // not a dance night: the read left it out (D-167).
      if (source.mixedCalendar === true) {
        const listed = new Set(listedIds);
        const shows = await retireScreened(db, {
          source,
          nights: later,
          reject: (row) =>
            listed.has(row.id)
              ? null
              : (screenUnlistedUntimed(row, {
                  mixedCalendar: true,
                  bandsForDancers: seedsByUrl.get(source.url)?.bandsForDancers === true,
                  bandsForDancersFrom: seedsByUrl.get(source.url)?.bandsForDancersFrom,
                  danceNights: seedNightTitles(metroSeeds, source.url).danceNights,
                  notDanceNights: seedNightTitles(metroSeeds, source.url).notDanceNights,
                  styles: source.styles,
                })?.reason ?? null),
        });
        line.notes.unshift(...shows.notes);
      }
      if (ruleTitles.length > 0) {
        const lang = result.extraction.language;
        const folded = foldPage(text);
        const invented = await retireUnlisted(db, {
          source,
          listedIds,
          nights: later,
          titles: ruleTitles,
          keep: (row) =>
            dateBesideTitle(folded, row.title, row.night, lang, readTitles).stated ||
            weekdaysNearTitle(folded, row.title, lang, readTitles).has(weekdayCodeOf(row.night)),
          what: "on nights from a recurrence the page does not write (on no date or weekday it gives)",
        });
        line.notes.unshift(...invented.notes);
      }
    }
    // Tonight too (D-081): a title this whole read lists tonight replaces this source's other rows
    // of it tonight, whose time the page no longer gives (Ballroom and Smooth Practice, stored at
    // 10:30pm, read again at 9:30pm). A partial read retires nothing (D-070).
    if (!result.unread && tonightTitles.length > 0) {
      const retimed = await retireUnlisted(db, {
        source,
        listedIds,
        nights: [tonight],
        titles: tonightTitles,
        what: "tonight at a time the page no longer gives",
      });
      line.notes.unshift(...retimed.notes);
    }
    // A night the page contradicts for a title it writes (D-079) goes whatever the read missed,
    // and tonight too: the page gives Sunday beside Tango Y Te, so its Tuesday row is wrong now,
    // not after a day-of check (run 29 left it on tonight's list). A night this read listed stays.
    const byNight = new Map<string, string[]>();
    for (const { title, night } of read.contradicted) {
      if (night < tonight || !nights.includes(night)) continue;
      byNight.set(night, [...(byNight.get(night) ?? []), title]);
    }
    for (const [night, titles] of byNight) {
      const wrong = await retireUnlisted(db, {
        source,
        listedIds,
        nights: [night],
        titles,
        what: "on a night the page contradicts",
      });
      line.notes.unshift(...wrong.notes);
    }
    // A stored night the page's own words contradict for its title goes too (D-080, above).
    await retireContradicted(listedIds, result.extraction.language, readTitles, uncheckedIds);
    line.status = "ok";
    await recordHealth(db, source.id, "ok", now(), null, await readStampFor(source, "model"));
  };

  // Sources whose next time is after this run's start are not due and are left alone (D-088).
  const notDue = full ? new Set<string>() : await notDueSourceIds(db, metro.id, runStart);

  // 2. Metro-wide APIs. Their sources are registered here (so step 3 skips them) and searched
  // after step 3, so they do not spend the time box the pages and feeds need (D-195).
  const searched = new Set<string>();
  const metroSearches: { adapter: SourceAdapter; source: Source }[] = [];
  for (const adapter of REGISTRY.values()) {
    if (!adapter.harvestMetro || !allowed.has(adapter.id)) continue;
    const source = await upsertSource(db, metro.id, {
      url: `https://www.${adapter.id}.com/`,
      kind: "ticketing_api",
      platform: adapter.id,
      trustTier: "ticketing",
      discoveredBy: adapter.id,
    });
    searched.add(source.url);
    if (notDue.has(source.id)) {
      report.refresh.skipped += 1;
      continue;
    }
    metroSearches.push({ adapter, source });
  }

  // 3. Every due source, with discovered ones appended once. A source not due is left alone, and
  // a link to it does not queue it either (D-088).
  const enabled: Source[] = (await loadSources(db, metro.id, now())).filter(
    (s) => !NOT_HARVESTED.has(s.kind) && !searched.has(s.url) && (!only || only.includes(s.url)),
  );
  const queue = enabled.filter((s) => !notDue.has(s.id));
  report.refresh.skipped += enabled.length - queue.length;
  const queued = new Set(enabled.map((s) => s.url));
  // A page that still links to a retired starting address does not bring it back (D-110).
  const retiredUrls = new Set((METRO_RETIRED_SOURCES[metro.slug] ?? []).map((r) => r.url));
  const addDiscovered = async (candidates: SourceCandidate[]) => {
    for (const candidate of candidates) {
      if (queued.has(candidate.url) || retiredUrls.has(candidate.url)) continue;
      queued.add(candidate.url);
      const source = await upsertSource(db, metro.id, candidate);
      report.discovered += 1;
      if (!NOT_HARVESTED.has(source.kind) && !only && !notDue.has(source.id)) queue.push(source);
    }
  };

  // D-160: a few sources at once; the HTTP client still keeps each domain to one request at a time.
  const harvestOne = async (queuedSource: Source, line: SourceReport): Promise<void> => {
    // A hand-checked seed (a venue's own Instagram, D-796/D-797) is never fetched: its fresh fixed
    // nights are listed from their config lines; an expired check's stored rows go.
    const handSeed = seedsByUrl.get(queuedSource.url);
    if (handSeed?.handChecked) {
      const hand = handCheckedPage(handSeed.fixedNights ?? [], tonight);
      line.adapter = "hand_checked";
      line.notes.push(...hand.notes);
      const fresh = { ...handSeed, fixedNights: hand.fresh };
      // Only the fresh nights reach store's fixed-nights block (one worker per source URL).
      seedsByUrl.set(queuedSource.url, fresh);
      let listedIds: readonly string[];
      try {
        ({ listedIds } = await store(queuedSource, { listings: [] }, line, {
          pageText: hand.pageText,
        }));
      } finally {
        seedsByUrl.set(queuedSource.url, handSeed);
      }
      const gone = await retireUnlisted(db, {
        source: queuedSource,
        listedIds,
        nights: nights.filter((night) => night >= tonight),
        titles: hand.expired.map((f) => f.title),
        what: "its hand check is over 35 days old",
      });
      line.notes.unshift(...gone.notes);
      line.status = "ok";
      await recordHealth(
        db,
        queuedSource.id,
        "ok",
        now(),
        null,
        await readStampFor(queuedSource, "reader"),
      );
      return;
    }
    // D-251: a full read reads every page in full. A stored validator or hash would answer
    // "unchanged" and leave the stored rows as they were, never placed or screened again after a
    // config change (a seed's venueAddress, a known venue, a reader's new kind).
    let source =
      options.full === true
        ? { ...queuedSource, etag: null, lastModified: null, contentHash: null }
        : queuedSource;
    // Probe an unprobed page first. A page probed as plain HTML carries platform "probed"; any
    // other platform on an "html" row is stale (runs before PR #17 reset probed kinds to html),
    // so that page is probed again rather than left waiting forever.
    if (source.kind === "html" && source.platform !== "probed") {
      try {
        const page = await http.request({
          url: source.url,
          purpose: "crawl",
          headers: { accept: "text/html" },
        });
        const probe = probePage(page.url || source.url, page.body);
        await addDiscovered(probe.discovered);
        await db
          .update(sourcesTable)
          .set({
            kind: probe.kind,
            feedUrl: probe.feedUrl,
            platform: probe.platform ?? (probe.kind === "html" ? "probed" : null),
          })
          .where(eq(sourcesTable.id, source.id));
        source = { ...source, kind: probe.kind, feedUrl: probe.feedUrl, platform: probe.platform };
        line.notes.push(`probed: ${probe.reason}`);
        // A page naming its events' own pages goes on to its adapter, which follows them (D-111).
        if (probe.kind === "jsonld" && probe.platform !== "jsonld_items") {
          // The page is already in hand: read its events without fetching it again.
          const { blocks } = extractJsonLd(page.body);
          const result = jsonLdToListings(blocks, {
            pageUrl: page.url || source.url,
            fetchedAt: page.fetchedAt,
            metroTz: metro.tz,
            countryCode: metro.countryCode,
            fromNight: tonight,
          });
          line.adapter = "jsonld";
          await store(
            source,
            { ...result, doc: docOf(page, sha256(JSON.stringify(blocks))) },
            line,
            // A seed's fixed weekly nights are read off this page too (D-801).
            { rawPage: page.body },
          );
          line.status = "ok";
          await recordHealth(
            db,
            source.id,
            "ok",
            now(),
            null,
            await readStampFor(source, "reader"),
          );
          return;
        }
        if (probe.kind === "html") {
          await readWithModel(source, line, "no feed or structured events", page);
          return;
        }
      } catch (error) {
        await markFailed(source, line, describe(error));
        return;
      }
    }
    if (source.kind === "html") {
      try {
        await readWithModel(source, line, "no feed or structured events");
      } catch (error) {
        await markFailed(source, line, describe(error));
      }
      return;
    }

    const adapter = adapterFor(source, REGISTRY);
    line.adapter = adapter?.id ?? null;
    if (!adapter) {
      line.status = "skipped";
      line.detail = `no adapter for ${source.kind}${source.platform ? ` (${source.platform})` : ""}`;
      return;
    }
    const gate = mayRun(adapter, metro, env, flags);
    if (!gate.run && source.kind === "feed_gcal" && gate.reason !== "wrong_country") {
      // A page that embeds a Google Calendar is still a page: while the Calendar API reader is
      // off or has no key, the page is read as it was before that reader existed (D-130).
      const why = `the Google Calendar reader does not run (${gate.detail})`;
      try {
        await readWithModel(source, line, why);
      } catch (error) {
        await markFailed(source, line, `${why}; reading the page: ${describe(error)}`);
      }
      return;
    }
    if (!gate.run) {
      line.status = "skipped";
      line.detail = gate.detail;
      return;
    }
    log(`harvesting ${source.url} with ${adapter.id}`);
    // The seed's eventPageWeekly (D-466), titleAreaPrefix (D-515) and wallClockTimes (D-1083) flags reach the
    // adapter on the source; they are not stored.
    const seedFlags = seedsByUrl.get(source.url);
    const harvested =
      seedFlags?.eventPageWeekly || seedFlags?.titleAreaPrefix || seedFlags?.wallClockTimes
        ? {
            ...source,
            ...(seedFlags.eventPageWeekly ? { eventPageWeekly: true } : {}),
            ...(seedFlags.titleAreaPrefix ? { titleAreaPrefix: true } : {}),
            ...(seedFlags.wallClockTimes ? { wallClockTimes: true } : {}),
          }
        : source;
    const outcome = await harvestSource(adapter, harvested, ctx);
    if (outcome.status === "failed" && outcome.errorKind === "robots_disallowed") {
      // The page itself may be read, but not the data view the adapter asks for (Squarespace's
      // robots.txt refuses ?format=json to every crawler). The page is still a source.
      const policy = await http.robots(source.url);
      const page = new URL(source.url);
      if (policy.isAllowed(`${page.pathname}${page.search}`)) {
        const why = `robots.txt allows the page but not the ${adapter.id} data view (${outcome.error})`;
        try {
          await readWithModel(source, line, why);
        } catch (error) {
          await markFailed(source, line, `${why}; reading the page: ${describe(error)}`);
        }
        return;
      }
    }
    if (outcome.status === "failed") {
      await markFailed(source, line, `${outcome.errorKind}: ${outcome.error}`);
      return;
    }
    await addDiscovered(outcome.result.discovered ?? []);
    if (outcome.status === "unchanged") {
      line.status = "unchanged";
      if (outcome.result.doc) {
        await recordFetch(db, source.id, {
          etag: outcome.result.doc.etag,
          lastModified: outcome.result.doc.lastModified,
          contentHash: outcome.result.doc.contentHash,
        });
      }
      await recordHealth(
        db,
        source.id,
        "unchanged",
        now(),
        null,
        await readStampFor(source, "reader"),
      );
      return;
    }
    // The page is not this adapter's after all (lane 3, D-111): the model reads it.
    if (outcome.result.readWithModel) {
      try {
        await readWithModel(source, line, outcome.result.readWithModel);
      } catch (error) {
        await markFailed(source, line, describe(error));
      }
      return;
    }
    try {
      // A weekly night listed for its next date only, whose own page says it recurs (D-465).
      if (seedsByUrl.get(source.url)?.eventPageWeekly) {
        const weekly = await weeklyFromEventPages(outcome.result.listings, { http });
        outcome.result.listings = weekly.listings;
        line.notes.push(...weekly.notes);
      }
      // A seed's fixed weekly nights are read off its page whichever reader read it; a page probed to
      // a feed or to its JSON-LD skipped them silently (D-801, Zorba the Buddha, Delhi, 2026-11-09).
      let rawPage: string | undefined;
      if (seedsByUrl.get(source.url)?.fixedNights?.length) {
        try {
          const page = await http.request({
            url: source.url,
            purpose: "crawl",
            headers: { accept: "text/html" },
          });
          rawPage = page.body;
        } catch (error) {
          line.notes.push(`fixed weekly nights not checked: ${describe(error)}`);
        }
      }
      const { listedIds } = await store(
        source,
        outcome.result,
        line,
        rawPage === undefined ? {} : { rawPage },
      );
      // One event page, one night, one card (D-836): a structured read is rarely whole, so an event
      // page that moved its night's time or title left the old row beside the new (dancetomic Sepicó).
      const samePage = await retireSamePageRows(db, {
        source,
        listedIds,
        nights: nights.filter((night) => night >= tonight),
      });
      line.notes.unshift(...samePage.notes);
      // A read of every night in the window takes off this source's later rows it no longer lists,
      // the rows an earlier reader of the same page wrote among them (docs/WORKSTREAMS.md section 4).
      if (outcome.result.whole) {
        const unlisted = await retireUnlisted(db, {
          source,
          listedIds,
          nights: nights.filter((night) => night > tonight),
        });
        line.notes.unshift(...unlisted.notes);
        // Rows under a title the page gives only another city's cards: an earlier reader's misreads.
        if (outcome.result.leftOutTitles && outcome.result.leftOutTitles.length > 0) {
          const otherCity = await retireUnlisted(db, {
            source,
            listedIds,
            nights: nights.filter((night) => night > tonight),
            titles: outcome.result.leftOutTitles,
            what: "the page lists for another city only",
          });
          line.notes.unshift(...otherCity.notes);
        }
      } else if (outcome.result.wholeThrough) {
        // A feed capped at a count of events is the source's word up to its last night (D-859).
        const through = outcome.result.wholeThrough;
        const unlisted = await retireUnlisted(db, {
          source,
          listedIds,
          nights: nights.filter((night) => night > tonight && night <= through),
        });
        line.notes.unshift(...unlisted.notes);
      } else if (outcome.result.wholeThroughLogOnly) {
        // A schema.org events page read whole: note what it would retire, retire nothing (D-880).
        const through = outcome.result.wholeThroughLogOnly;
        const unlisted = await retireUnlisted(db, {
          source,
          listedIds,
          nights: nights.filter((night) => night > tonight && night <= through),
          logOnly: true,
        });
        line.notes.unshift(...unlisted.notes);
      }
      // Weekly nights the calendar has stopped giving, past its rolling window (D-465).
      if (seedsByUrl.get(source.url)?.eventPageWeekly) {
        const stale = await retireStaleWeekly(db, {
          source,
          after: tonight,
          cutoff: new Date(now().getTime() - 8 * 24 * 60 * 60 * 1000),
        });
        line.notes.unshift(...stale.notes);
      }
      line.status = "ok";
      await recordHealth(db, source.id, "ok", now(), null, await readStampFor(source, "reader"));
    } catch (error) {
      await markFailed(source, line, describe(error));
    }
  };

  let next = 0;
  const worker = async () => {
    while (next < queue.length) {
      const source = queue[next++]!;
      const line = emptyLine(source.url, null);
      report.sources.push(line);
      // The run's time box (D-088): once spent, the due sources left wait for the next run, first.
      if (timeBoxSpent(startedMs, wallClock(), timeBoxMs)) {
        line.status = "deferred";
        line.detail = `deferred to the next run: this run's ${report.refresh.timeBoxMinutes}-minute time box is spent`;
        report.refresh.deferred += 1;
        await deferHarvest(db, source.id, runStart);
        continue;
      }
      report.refresh.read += 1;
      try {
        await harvestOne(source, line);
      } catch (error) {
        await markFailed(source, line, describe(error));
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.max(1, Math.floor(options.concurrency ?? 1)) }, () => worker()),
  );

  // 3b. The metro-wide API searches registered in step 2, after the due sources: they can take
  // minutes (Skiddle about 9 in London, 2026-10-27) and are never deferred, so they no longer
  // spend the time box the pages and feeds need (D-195).
  for (const { adapter, source } of metroSearches) {
    report.refresh.read += 1;
    const line = emptyLine(source.url, adapter.id);
    try {
      log(`searching ${adapter.id} for ${metro.name}`);
      // Step 2 queues only adapters that have harvestMetro.
      const result = await adapter.harvestMetro!(metro, nights, ctx);
      const { listedIds } = await store(source, result, line);
      // A metro search that read its whole window (bcn_agenda, D-882) takes off this source's
      // later rows it no longer lists, as a whole page read does.
      if (result.whole) {
        const unlisted = await retireUnlisted(db, {
          source,
          listedIds,
          nights: nights.filter((night) => night > tonight),
        });
        line.notes.unshift(...unlisted.notes);
      }
      line.status = "ok";
      await recordHealth(db, source.id, "ok", now(), null, await readStampFor(source, "reader"));
    } catch (error) {
      await markFailed(source, line, describe(error));
    }
    report.sources.push(line);
  }

  // 4. Place stored rows with no venue, dedupe, prune, place IDs, totals. Placing comes first, so
  // a row it places can pair by its point in dedupe and gets its place ID in this run (D-082). It
  // takes the write path's resolver whole, the ticketing check included (D-071).
  // Stored listings at a point outside the metro's outline go (D-084: New York is the five
  // boroughs, and rows from the 40 km circle's Newark or Yonkers stay until their nights pass).
  const outsideRows = await retireOutsideMetro(db, {
    metro,
    nights: nights.filter((night) => night >= tonight),
  });
  // A source's untimed copy of its own timed listing on one event page, which no read may write
  // again (D-742: a ranked page dropped the event, so D-593's pass over written rows never ran).
  const pageTwins = await retirePageTwins(db, {
    metro,
    nights: nights.filter((night) => night >= tonight),
  });
  const restateRow = (row: {
    sourceUrl: string;
    sourceHasVenue: boolean;
    name: string | null;
    address: string | null;
  }) =>
    restateVenue(row, {
      sourceUrl: row.sourceUrl,
      sourceHasVenue: row.sourceHasVenue,
      seeds: metroSeeds,
      known: KNOWN_VENUES[metro.slug],
      countryCode: metro.countryCode ?? "US",
    });
  report.placing = await placeUnplaced(db, {
    metro,
    nights,
    placeVenue,
    elsewhere: geocoder?.elsewhere ? (a) => geocoder.elsewhere!(a) : undefined,
    restate: restateRow,
  });
  // Rows already placed under a venue named by a known venue's street (D-221), or by a canonical known
  // venue's other name (D-761), move to it: an unchanged feed is not re-read, so its stored rows never
  // meet the known venue otherwise.
  const streetNamed = await restatePlacedStreetNamed(db, {
    metro,
    nights,
    streets: (KNOWN_VENUES[metro.slug] ?? []).flatMap((venue) => venue.streets ?? []),
    names: (KNOWN_VENUES[metro.slug] ?? [])
      .filter((venue) => venue.canonical === true)
      .flatMap((venue) => venue.names.slice(1)),
    placeVenue,
    restate: restateRow,
  });
  report.placing.notes.push(...streetNamed.notes);
  // A venue a known venue names, stored with only a city, takes its checked address (D-826).
  const knownAddress = await upgradeKnownVenueAddresses(db, {
    metro,
    known: KNOWN_VENUES[metro.slug],
  });
  report.placing.notes.push(...knownAddress.notes);
  report.placing.notes.unshift(
    ...outsideRows.notes,
    ...pageTwins.notes,
    ...screenedTitles.notes,
    ...restoredClasses.notes,
    ...retidied.notes,
  );
  // Rows still with no venue take the one place their own event page's JSON-LD gives (D-164).
  report.eventPages = await placeFromEventPages(db, {
    metro,
    nights: nights.filter((night) => night >= tonight),
    http,
    placeVenue,
    elsewhere: geocoder?.elsewhere ? (a) => geocoder.elsewhere!(a) : undefined,
    known: KNOWN_VENUES[metro.slug],
  });
  // The model settles the pairs earlier runs queued (D-150), so its "same" merges in this pass.
  if (options.ai?.summarize) {
    report.dedupeReview = await reviewQueuedPairs(db, {
      metro,
      nights,
      client: options.ai.client,
      // A due-only run's review is capped so the job ends inside its 20 minutes (2026-11-01).
      maxMs: full ? undefined : DEDUPE_REVIEW_DUE_RUN_MS,
      clock: wallClock,
    });
  }
  report.dedupe = await dedupeMetro(db, metro, nights);
  // Summaries of what is listed now, after merges (D-109): tonight to the window's end.
  if (options.ai?.summarize) {
    report.summaries = await summarizeListings(db, {
      metro,
      nights: nights.filter((night) => night >= tonight),
      client: options.ai.client,
      now,
    });
  }
  report.pruned = await pruneRawDocuments(db, now());
  report.geocoderRequests = geocoder?.requests() ?? 0;
  // Google place IDs for the venues this window's listings use (D-066), so map links open the
  // venue's own listing. Only the id is asked for, which Google does not charge for.
  if (env.GOOGLE_MAPS_SERVER_KEY) {
    report.placeIds = await resolvePlaceIds(db, {
      http,
      apiKey: env.GOOGLE_MAPS_SERVER_KEY,
      metro,
      nights,
      now,
    });
  }
  for (const line of report.sources) {
    report.totals.listings += line.listings;
    report.totals.written += line.written;
    report.totals.unplaced += line.unplaced;
    report.totals.rejected += line.rejected;
    report.totals.untimed += line.untimed;
    report.totals.untimedPlaced += line.untimedPlaced;
    report.totals.notEvents += line.notEvents;
  }
  // Again at the end, so a venue gets its neighbourhood in the run that wrote it (D-585): the site
  // no longer works it out from the outlines.
  report.venues.seedVenues.push(...(await storeVenueNeighbourhoods(db, metro.id)));
  const [listed] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(events)
    .where(
      // Every listed row of tonight is on the site since D-082, a placed venue or not.
      sql`${events.metroId} = ${metro.id} and ${events.nightDate} = ${tonight} and ${events.status} in ('active', 'cancelled')`,
    );
  report.totals.tonightListed = listed?.n ?? 0;
  // Every listed row with no venue, tonight to the window's end, whatever run wrote it: counted,
  // and named in the report one by one (D-082).
  report.unplacedRows = await db
    .select({
      title: events.title,
      night: events.nightDate,
      source: sql<
        string | null
      >`(select s.url from ${eventSources} es join ${sourcesTable} s on s.id = es.source_id where es.event_id = ${events}.id order by es.role = 'primary' desc, es.first_seen_at limit 1)`,
    })
    .from(events)
    .where(
      sql`${events.metroId} = ${metro.id} and ${events.nightDate} >= ${tonight} and ${events.nightDate} <= ${nights.at(-1) ?? tonight} and ${events.status} in ('active', 'cancelled') and ${events.venueId} is null`,
    )
    .orderBy(events.nightDate, events.title, events.id);
  report.totals.unplacedListed = report.unplacedRows.length;
  report.silent = await silentSources(db, metro.id, tonight);
  report.refresh.due = report.refresh.read + report.refresh.deferred;
  report.refresh.nextRunDue = await countDue(
    db,
    metro.id,
    new Date(runStart.getTime() + 60 * 60_000),
    [...NOT_HARVESTED],
  );
  report.refresh.runMinutes = Math.round((wallClock() - startedMs) / 6_000) / 10;

  if (options.runId) {
    await db
      .update(jobRuns)
      .set({
        finishedAt: now(),
        status: "succeeded",
        stats: {
          listingsBySource: Object.fromEntries(report.sources.map((s) => [s.url, s.written])),
          newEvents: report.totals.written,
          mergedEvents: report.dedupe.merged,
          errors: report.sources.filter((s) => s.status === "failed").length,
          costUsd: 0,
        },
      })
      .where(eq(jobRuns.id, options.runId));
  }
  return report;
}

function emptyLine(url: string, adapter: string | null): SourceReport {
  return {
    url,
    adapter,
    status: "skipped",
    detail: null,
    listings: 0,
    written: 0,
    unplaced: 0,
    rejected: 0,
    untimed: 0,
    untimedPlaced: 0,
    notEvents: 0,
    tonight: 0,
    notes: [],
  };
}

function describe(error: unknown): string {
  if (error instanceof HttpError) return `${error.kind}: ${error.message}`;
  if (
    error instanceof TypeError ||
    error instanceof RangeError ||
    error instanceof ReferenceError
  ) {
    // A fault in our own code: name the line it came from, so the run report finds it (CÉ LA VI Dubai, D-805).
    const frame = (error.stack ?? "").split("\n").find((l) => /\/src\/[^)]*\.ts:\d+/.test(l));
    const at = frame?.match(/(src\/[^):]+\.ts:\d+)/)?.[1];
    return at ? `${error.message} (at ${at})` : error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

function docOf(
  page: Awaited<ReturnType<HttpClient["request"]>>,
  contentHash: string,
): NonNullable<HarvestResult["doc"]> {
  return {
    url: page.url,
    fetchedAt: page.fetchedAt,
    httpStatus: page.status,
    etag: page.etag,
    lastModified: page.lastModified,
    contentHash,
    cleanedText: null,
  };
}

export function formatPlaceIds(placeIds: PlaceIdReport | null): string {
  if (!placeIds) return "Google place IDs: not looked up (no GOOGLE_MAPS_SERVER_KEY).";
  const p = placeIds;
  const parts = [
    `Google place IDs: ${p.due} venues due, ${p.asked} asked, ${p.found} found, ${p.notFound} not found`,
  ];
  if (p.disagreed > 0)
    parts.push(`${p.disagreed} not stored (the name alone, searched nearby, gives another place)`);
  if (p.excluded > 0)
    parts.push(`${p.excluded} not stored (on the hand-kept list of wrong places)`);
  if (p.taken > 0) parts.push(`${p.taken} the same place as another venue`);
  if (p.failed > 0) parts.push(`${p.failed} failed`);
  let line = parts.join(", ") + ".";
  // Every venue due that has no answer yet, including the one whose request stopped the run.
  const waiting = p.due - p.found - p.notFound - p.taken - p.disagreed - p.excluded;
  if (waiting > 0) line += ` ${waiting} wait for the next run.`;
  // Stored ids not yet checked by the name alone searched nearby (every id once after migration
  // 0006, D-077), and any on the hand-kept list.
  if (p.toRecheck > 0) {
    line += ` Re-checked by name: ${p.toRecheck}, ${p.rechecked} re-checked, ${p.rechecked - p.cleared} kept, ${p.cleared} cleared.`;
    if (p.toRecheck > p.rechecked) line += ` ${p.toRecheck - p.rechecked} wait for the next run.`;
  }
  line += ` ${p.requests} ${p.requests === 1 ? "request" : "requests"}.`;
  if (p.stopped) line += ` Stopped: ${p.stopped}.`;
  for (const note of p.notes.slice(0, 12)) line += `\n  - ${note}`;
  return line;
}

/** A source's notes, each written once in first-seen order, a repeated one with its count: "… (x7)" (D-274). */
export function groupNotes(notes: readonly string[]): string[] {
  const seen = new Map<string, number>();
  const order: string[] = [];
  for (const note of notes) {
    if (!seen.has(note)) {
      seen.set(note, 1);
      order.push(note);
    } else {
      seen.set(note, seen.get(note)! + 1);
    }
  }
  return order.map((note) => {
    const count = seen.get(note)!;
    return count === 1 ? note : `${note} (x${count})`;
  });
}

/** The report's first line (D-088): what was due, what was read, and what the next run has. */
export function formatRefresh(r: RefreshReport): string {
  const scope = r.full
    ? r.timeBoxMinutes === null
      ? "Full read: every source, due or not."
      : `Full read: every source, due or not. Read ${r.read}, deferred ${r.deferred} (time box ${r.timeBoxMinutes} min).`
    : `Due ${r.due}: read ${r.read}, deferred ${r.deferred} (time box ${r.timeBoxMinutes === null ? "none" : `${r.timeBoxMinutes} min`}). Not due, skipped: ${r.skipped}.`;
  return `${scope} Run ${r.runMinutes} min. Due at the next hourly run: ${r.nextRunDue}.`;
}

/** The report as plain text for the run log and the checkpoint. */
export function formatReport(report: IngestReport): string {
  const lines: string[] = [];
  lines.push(formatRefresh(report.refresh));
  lines.push(
    `Ingest for ${report.metro}: tonight is ${report.tonight}; window ${report.window[0]} to ${report.window.at(-1)}.`,
  );
  // Failing sources first, where the owner looks (D-114): the full address, since two sources
  // can share a host (two Eventbrite organizers), and the error, which says what to do about it.
  if (report.failing.length === 0) {
    lines.push("Failing sources: none this run.");
  } else {
    lines.push(`Failing sources (${report.failing.length}):`);
    for (const f of report.failing)
      lines.push(
        `  ${f.url}: ${failureStreakNote(f)}${f.lastError ? ` Last error: ${f.lastError}` : ""}`,
      );
  }
  if (report.silent.length > 0) {
    lines.push(`Silent sources (${report.silent.length}):`);
    for (const s of report.silent) lines.push(`  ${s.url}: ${silentSourceNote(s)}`);
  }
  lines.push("");
  lines.push("Adapters:");
  for (const a of report.adapters)
    lines.push(`  ${a.id}: ${a.gate.run ? "runs" : `${a.gate.reason} (${a.gate.detail})`}`);
  lines.push("");
  lines.push("Sources:");
  for (const s of report.sources) {
    // A metro-wide search's source key is a made-up address (step 2): name the search instead.
    const where =
      s.adapter && s.url === `https://www.${s.adapter}.com/`
        ? `${s.adapter} (metro-wide search)`
        : `${s.url}${s.adapter ? ` via ${s.adapter}` : ""}`;
    lines.push(
      `  [${s.status}] ${where}: ${s.written} written (${s.tonight} tonight), ${s.unplaced} unplaced, ${s.rejected} rejected, ${s.untimed} time not listed, ${s.notEvents} not events${s.detail ? `; ${s.detail}` : ""}`,
    );
    for (const note of groupNotes(s.notes).slice(0, 8)) lines.push(`      - ${note}`);
  }
  lines.push("");
  lines.push(
    `Discovered ${report.discovered} new sources. Geocoder requests: ${report.geocoderRequests}. Page bodies pruned: ${report.pruned}.`,
  );
  lines.push(formatVenueReport(report.venues));
  lines.push(
    `Stored listings with no venue: ${report.placing.placed} placed from the venue their source gave.`,
  );
  for (const note of report.placing.notes.slice(0, 4)) lines.push(`  - ${note}`);
  lines.push(
    `Event pages: ${report.eventPages.asked} read, ${report.eventPages.placed} placed from the page's own venue.`,
  );
  for (const note of report.eventPages.notes.slice(0, 8)) lines.push(`  - ${note}`);
  lines.push(formatPlaceIds(report.placeIds));
  lines.push(...formatDedupeReport(report.dedupe));
  lines.push(...formatDedupeReview(report.dedupeReview));
  lines.push(...formatSummaryReport(report.summaries));
  if (report.ai.enabled) {
    const spent = [
      report.ai.spent.neuron ? `${report.ai.spent.neuron.toFixed(1)} neurons` : null,
      report.ai.spent.request ? `${report.ai.spent.request} requests` : null,
      report.ai.spent.microdollar
        ? `$${(report.ai.spent.microdollar / 1_000_000).toFixed(4)} on Bedrock`
        : null,
    ]
      .filter(Boolean)
      .join(", ");
    lines.push(
      `Model extraction: ${report.ai.pagesRead} pages read (${report.ai.cached} from the cache, ${report.ai.escalated} escalated, ${report.ai.emptySuspect} empty reads of dated parts escalated), ${report.ai.deferred} deferred, ${report.ai.calls} model calls, ${spent || "nothing"} spent. Listings from model extraction: ${report.ai.listingsFromModel} of ${report.totals.written}.`,
    );
  } else {
    lines.push("Model extraction: not configured in this run; pages without a feed wait.");
  }
  const t = report.totals;
  lines.push(
    `Totals: ${t.written} listings written, ${t.unplaced} without a placed venue, ${t.rejected} rejected with a reason, ${t.untimed} time not listed (untimed written ${t.untimed}, placed ${t.untimedPlaced}), ${t.notEvents} not events. Listed for tonight: ${t.tonightListed}. Listed with "Location not listed", ${report.window[0]} to ${report.window.at(-1)}: ${t.unplacedListed}.`,
  );
  // Each of them by name, so the first run after a deploy says what the site now shows (D-082).
  for (const row of report.unplacedRows.slice(0, UNPLACED_ROWS_SHOWN)) {
    lines.push(`Location not listed: ${row.title}, ${row.night}, ${hostOf(row.source)}`);
  }
  if (report.unplacedRows.length > UNPLACED_ROWS_SHOWN) {
    lines.push(`and ${report.unplacedRows.length - UNPLACED_ROWS_SHOWN} more`);
  }
  return lines.join("\n");
}

/** How many listings with no location the report names one by one (D-082). */
const UNPLACED_ROWS_SHOWN = 30;

/** "sobs.com" for a source URL, for the report; the URL itself when it cannot be parsed. */
function hostOf(url: string | null): string {
  if (url === null) return "no source";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
