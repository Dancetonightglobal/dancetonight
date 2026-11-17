// The source adapter contract (PLAN.md 6.3, D-008, D-043). Adapters never write to the
// database and never call `fetch` themselves: every request goes through `ctx.http`, the polite
// client in src/pipeline/http.ts, which applies the blocklist, robots.txt, the per-domain limiter,
// conditional GETs, timeouts and the size cap. Adapters contain only source-specific parsing.
//
// Every adapter emits the same shape, `HarvestedListing`: the Phase 3 extraction row
// (`rawListingSchema` in src/domain/listing.ts: a local date, local times, prices as listed,
// a short evidence quote per field) plus what a deterministic source knows that a page does not,
// such as a stable id, coordinates or a real RRULE. Normalisation, dedupe and storage therefore
// have one input whatever produced it (D-043).

import type { DiscoveryAdapterId } from "@/src/adapters/registry/discovery";
import type { PlatformAdapterId } from "@/src/adapters/registry/platforms";
import type { ReaderAdapterId } from "@/src/adapters/registry/readers";
import type { Point, RawListing } from "@/src/domain/listing";
import type { HttpClient } from "@/src/pipeline/http";

export type Tier = "A" | "B" | "C" | "D";

export type AdapterId =
  | ReaderAdapterId
  | DiscoveryAdapterId
  | PlatformAdapterId
  | "ticketmaster"
  | "meetup"
  | "eventbrite"
  | "overture"
  | "google_places"
  | "overpass"
  | "feed_ics"
  | "feed_gcal"
  | "jsonld"
  | "wp_tribe"
  | "squarespace"
  | "wix"
  | "libcal"
  | "tockify"
  | "teamup"
  | "amilia"
  | "localist"
  | "engage"
  | "presence"
  | "open_data_paris"
  | "open_data_nyc"
  | "open_data_austin"
  | "open_data_berlin"
  | "studio_punchpass"
  | "studio_pike13"
  | "studio_mindbody"
  | "studio_momence"
  | "helloasso"
  | "billetto"
  | "tickster"
  | "moshtix"
  | "serp_discovery"
  | "firecrawl"
  | "llm_html"
  | "connect_discord"
  | "connect_telegram"
  | "connect_rss"
  | "predicthq"
  | "ra"
  | "dice"
  | "edmtrain"
  | "activenet"
  | "engage_discovery"
  | "campusgroups"
  | "apify_facebook"
  | "directory_pointers";

export type FlagKey = `adapter.${AdapterId}`;

export function flagKey(id: AdapterId): FlagKey {
  return `adapter.${id}`;
}

export interface AdapterLimits {
  /** Minimum spacing between requests to one registrable domain. Never below 5 s for crawling (D-021). */
  perDomainIntervalMs: number;
  /** Optional API-level requests per second. */
  rps?: number;
  /** Optional API-level requests per day. */
  perDay?: number;
}

export interface Metro {
  id: string;
  slug: string;
  name: string;
  countryCode: string;
  center: Point;
  radiusKm: number;
  tz: string;
  languages: string[];
}

/** A calendar date in the metro's zone, ISO YYYY-MM-DD. */
export type NightDate = string;

export interface Seed {
  kind: "venue_website" | "organizer_url" | "directory_pointer" | "feed_url";
  url: string;
  label?: string;
}

/** How a fact was obtained; mirrors the `provenance_method` enum in the database. */
export type ProvenanceMethod = "feed" | "jsonld" | "api" | "llm" | "serp" | "manual";

/** Where one listing came from. Per-field evidence lives on the listing itself (`listing.evidence`). */
export interface Provenance {
  /** The page or API URL the listing was read from: what the detail page links to. */
  sourceUrl: string;
  fetchedAt: Date;
  method: ProvenanceMethod;
}

export interface VenueCandidate {
  name: string;
  location: Point;
  address?: Record<string, string>;
  kind?: string;
  websiteUrl?: string;
  socials?: string[];
  overtureId?: string;
  osm?: { type: "node" | "way" | "relation"; id: number };
  googlePlaceId?: string;
  provenance: Provenance;
}

export interface SourceCandidate {
  url: string;
  kind: SourceKind;
  platform?: string;
  feedUrl?: string;
  trustTier: TrustTier;
  /** The adapter that found it, or `probe` (src/pipeline/probe.ts), or `seed_list` (config/sources). */
  discoveredBy: AdapterId | "probe" | "seed_list";
  label?: string;
}

/** Mirrors `source_kind` in the database. */
export type SourceKind =
  | "feed_ics"
  | "feed_gcal"
  | "jsonld"
  | "wp_tribe"
  | "squarespace"
  | "wix"
  | "platform_api"
  | "open_data"
  | "html"
  | "ticketing_api"
  | "serp"
  | "directory"
  | "social_link"
  | "connected";

/** Mirrors `trust_tier`; field precedence follows this order (D-006). */
export type TrustTier = "first_party" | "ticketing" | "serp" | "directory" | "unofficial";

/**
 * The wall-clock time an untimed rule is anchored at (D-060). It exists for date arithmetic only:
 * noon falls on the calendar day the rule names, so every occurrence's night is that day, and it
 * is never shown or stored as a start.
 */
export const UNTIMED_RULE_ANCHOR = "12:00";

/** A recurrence a source states outright (an ICS RRULE), as opposed to one inferred from prose. */
export interface HarvestedRecurrence {
  /** The RRULE body without the `RRULE:` prefix, e.g. `FREQ=WEEKLY;BYDAY=TH`. */
  rrule: string;
  /**
   * The first occurrence in wall-clock local time, `YYYY-MM-DDTHH:MM`. For a rule whose time is
   * not listed, the date at UNTIMED_RULE_ANCHOR.
   */
  dtstartLocal: string;
  /** Local dates the source excludes (EXDATE), `YYYY-MM-DD`. */
  exdates: string[];
  /**
   * False when the source states the rule's days and no time ("every Tuesday", an all-day ICS
   * rule): its nights carry no invented start and are listed as "Time not listed" (D-060).
   * Absent means true.
   */
  timeListed?: boolean;
}

/** One listing as a harvester produced it, before normalisation. */
export interface HarvestedListing {
  /** The extraction row: title, type, styles, local date and times, venue, prices, evidence. */
  listing: RawListing;
  /**
   * The source's own id for this occurrence (a Ticketmaster event id, an ICS UID plus its
   * recurrence id). Stable across runs, so a re-harvest updates the same row. Null when the
   * source has none; the pipeline then keys on date, time and title.
   */
  externalId: string | null;
  /** The IANA zone the local date and times are in, when the source states one; else the metro's. */
  tz: string | null;
  /** Coordinates the source gives for the venue, if any. */
  venueLocation: Point | null;
  /** Set when the source states a rule; the pipeline materialises it (D-005). */
  recurrence: HarvestedRecurrence | null;
  provenance: Provenance;
  /**
   * The event's own page, when the source links one (an ICS URL, a directory's page for the event):
   * stored as the event's canonical URL, never as a ticket link (D-070). `listing.ticket_url` is
   * only ever an explicit ticket or offer link. Absent: the canonical URL is `provenance.sourceUrl`.
   */
  eventUrl?: string | null;
  /** Set by the pipeline, never by an adapter: this night was materialised from `recurrence`. */
  fromRule?: boolean;
  /**
   * Set by the model-read check (D-081): the read gave a start time, and none stands. `pageStarts`
   * and `pageEnds` are the starts and ends the listing's own part of the page writes (24-hour
   * "HH:MM"), so a stored row whose every time is among them is kept, not replaced (seam review,
   * 2026-09-29).
   */
  timesWithdrawn?: { pageStarts: string[]; pageEnds: string[] };
  /**
   * Set by the model-read check (D-105): the read's organiser is a neighbour's, written on the page
   * only inside other listings' parts. The stored row stops pointing at it, as for a directory's
   * own name (D-070), where an organiser merely not read this run is kept.
   */
  organizerWithdrawn?: true;
  /**
   * Per-venue screen flags a directory adapter sets per row (D-342: WWOZ Livewire's dance-floor
   * venues); each field that is set overrides the source's for this listing.
   */
  venueFlags?: {
    bandsForDancers?: boolean;
    bandsForDancersFrom?: string | null;
    danceBandKinds?: boolean;
    lateNightKeep?: boolean;
  };
}

export interface RawDoc {
  url: string;
  fetchedAt: Date;
  httpStatus: number;
  etag: string | null;
  lastModified: string | null;
  contentHash: string;
  /** Kept 3 days (D-043). */
  cleanedText: string | null;
}

export interface HarvestResult {
  listings: HarvestedListing[];
  /** The fetched document, when the adapter read one; its hash drives change detection (PLAN 6.7). */
  doc?: RawDoc;
  /** True when the server answered 304 or the content hash matched: nothing to do. */
  unchanged?: boolean;
  /** Further sources this one points at (an organizer's feed, a venue's calendar). */
  discovered?: SourceCandidate[];
  /** Plain notes for the run report: skipped items and why. Never page text. */
  notes?: string[];
  /**
   * Items the adapter read and left out as no dance night, by the id a listing of it would carry
   * (`externalId`). A row this source stored for one before is retired (PR 2): Ticketmaster's
   * Don Omar concert was stored as a hip-hop night while its genre alone named a style.
   */
  screened?: ReadonlyArray<{ externalId: string; title: string; reason: string }>;
  /**
   * The adapter read every night the source lists in the window (no cap, no page that failed).
   * The ingest then retires this source's rows after tonight that the read did not list
   * (docs/WORKSTREAMS.md section 4, D-111). A capped or partial read leaves it unset.
   */
  whole?: true;
  /**
   * The read listed every night the source gives up to this night (YYYY-MM-DD) and stopped there:
   * a feed capped at a count of events (an iCalendar export of a WordPress events list). The ingest
   * retires this source's rows after tonight, up to this night, that the read did not list (D-859).
   */
  wholeThrough?: string;
  /**
   * As `wholeThrough`, but the ingest only notes the rows it would retire and retires none (D-880):
   * a schema.org events page read whole, on trial before its unlisted rows are taken off.
   */
  wholeThroughLogOnly?: string;
  /**
   * Titles of the nights the page lists for other metros only (Daybreaker's other cities). On a
   * whole read the ingest retires this source's rows after tonight under these titles that the
   * read did not list: an earlier reader stored another city's night as this metro's.
   */
  leftOutTitles?: readonly string[];
  /**
   * The page is not this adapter's after all (a Squarespace page with no events list): the ingest
   * reads it with the model instead, for this reason. Never a read that found no events.
   */
  readWithModel?: string;
}

export interface ProbeResult {
  adapter: AdapterId;
  kind: SourceKind;
  platform?: string;
  feedUrl?: string;
  confidence: number;
}

/** A source row as the pipeline hands it to an adapter. */
export interface Source {
  id: string;
  url: string;
  kind: SourceKind;
  trustTier: TrustTier;
  platform: string | null;
  feedUrl: string | null;
  metroId: string | null;
  /** Taxonomy keys the source is known for; a hint when a listing names no style. */
  styles: string[];
  /**
   * A venue's whole calendar, dances among concerts (D-083): its listings go through
   * `screenNoDance`. From `sources.mixed_calendar` (D-121). Absent means false.
   */
  mixedCalendar?: boolean;
  /**
   * The seed's `eventPageWeekly` flag (D-465, D-466), set by the ingest run when it calls the adapter; not stored.
   * An adapter may read rules from its event pages only when it is set. Absent means false.
   */
  eventPageWeekly?: boolean;
  /**
   * The seed's `titleAreaPrefix` flag (D-515), set by the ingest run when it calls the adapter; not stored.
   * The source starts its titles with its own area label ("Carolina / Isla Verde: "); the adapter drops it.
   */
  titleAreaPrefix?: boolean;
  /**
   * The seed's `wallClockTimes` flag (D-1083), set by the ingest run when it calls the adapter; not stored.
   * The source's JSON-LD times are local wall-clock times with a wrong UTC offset (Salsa Vida's Quintana Roo
   * guides write -06:00 for UTC-5 Cancun): its JSON-LD readers drop the offset and read the clock in the
   * listing's zone.
   */
  wallClockTimes?: boolean;
  /**
   * The venue whose own website this source is (D-123, from `sources.venue_id`): a listing that
   * names no other place is placed there. Absent or null means the source is not one venue's.
   */
  venueId?: string | null;
  etag: string | null;
  lastModified: string | null;
  contentHash: string | null;
}

export interface RunCtx {
  metro: Metro;
  now: () => Date;
  /** The polite client. The only way an adapter reaches the network. */
  http: HttpClient;
  /** Secrets and switches the adapter needs, read from the environment by the pipeline. */
  env: Readonly<Record<string, string | undefined>>;
  log: (event: string, data?: Record<string, unknown>) => void;
  signal?: AbortSignal;
}

export interface SourceAdapter {
  readonly id: AdapterId;
  readonly tier: Tier;
  readonly limits: AdapterLimits;
  /** Region-scoped adapters run only in metros whose country matches (D-029). */
  readonly countries?: readonly string[];
  /**
   * Environment variables the adapter cannot run without. When one is missing the runner
   * reports the adapter as "not configured" instead of calling it.
   */
  readonly requiredEnv?: readonly string[];

  seedVenues?(metro: Metro, ctx: RunCtx): AsyncIterable<VenueCandidate>;
  discoverSources?(metro: Metro, seeds: Seed[], ctx: RunCtx): AsyncIterable<SourceCandidate>;
  harvest?(source: Source, ctx: RunCtx): Promise<HarvestResult>;
  /** Metro-wide API search (Ticketmaster): no source row, just the metro and a night range. */
  harvestMetro?(metro: Metro, nights: NightDate[], ctx: RunCtx): Promise<HarvestResult>;
  fastPath?(metro: Metro, night: NightDate, ctx: RunCtx): Promise<HarvestedListing[]>;
  /** "Is this URL mine?" from the URL and, when given, the fetched page. */
  probe?(url: URL, page?: { html: string; headers: Record<string, string> }): ProbeResult | null;
}
