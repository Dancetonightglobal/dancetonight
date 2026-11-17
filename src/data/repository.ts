// The read interface the app uses in both modes (D-011): the mock repository serves the New
// York seed in memory, the database repository runs the same queries through Drizzle. Pages
// and API handlers depend on this interface only; src/data/index.ts picks the implementation.

import { z } from "zod";

import type { FamilyKey, StyleKey } from "@/config/styles";
import type { Listing } from "@/src/domain/listing";
import type { ListingType } from "@/src/domain/listing-types";
import type { NightDate } from "@/src/domain/tonight";

export interface Point {
  lat: number;
  lng: number;
}

export const pointSchema = z.object({
  lat: z.number().finite().min(-90).max(90),
  lng: z.number().finite().min(-180).max(180),
});

/** The "more filters" sheet (SPEC section 2). Every field is optional; unset means "any". */
export interface ListingFilters {
  families?: FamilyKey[];
  styles?: StyleKey[];
  types?: ListingType[];
  /** Only listings marked free. */
  free?: boolean;
  /** Cheapest listed price at or under this amount (in the listing's currency), or free. */
  maxPrice?: number;
  beginnerFriendly?: boolean;
  lessonIncluded?: boolean;
  noPartnerNeeded?: boolean;
  /**
   * The viewer's age bracket: "all" keeps only listings with no age minimum; 18 and 21 keep
   * listings whose minimum is at most that age (or none).
   */
  age?: "all" | 18 | 21;
  liveMusic?: boolean;
  /**
   * Only listings in progress at `now`. A listing whose time is not listed never matches: it is
   * never in progress, because nothing says it has begun (D-060).
   */
  onNow?: boolean;
  /**
   * Only listings the organiser's own page or a ticket page confirms tonight
   * (isConfirmedByOrganiser): exactly the cards that say "On the organizer's page" or "On the
   * ticket page" (D-061, D-072).
   */
  confirmedOnly?: boolean;
  /**
   * Free text the dancer typed: every word must appear in the listing's title, venue, address,
   * organizer, DJs, bands, music, styles, families or listing type (src/domain/search.ts).
   */
  text?: string;
}

/**
 * "start": timed listings by start (ties by distance, then slug), then the listings whose time is
 * not listed, by distance, then slug; map pin numbers are list positions, so theirs continue
 * after the timed cards. "distance": by distance (ties by start with no time last, then slug).
 * An unknown distance sorts last (D-060).
 */
export type ListingSort = "start" | "distance";

export interface ListNightQuery {
  center: Point;
  radiusKm: number;
  /**
   * The night to list; tonight uses the tonight rule (in progress counts), other nights the stored
   * night date. A listing whose time is not listed is on its stored night: tonight for the whole
   * night window until 06:00 local (or until a listed end passes), and on its night when a future
   * night is picked (D-060).
   */
  nightDate: NightDate;
  now: Date;
  filters?: ListingFilters;
  sort: ListingSort;
}

/**
 * Every count is what the dancer gets by tapping the thing it labels, with every other filter
 * unchanged, so a number never contradicts the list it leads to (review, 2026-09-28).
 */
export interface ListingCounts {
  /**
   * Listings per family under every filter but the family one: the segment, styles and the
   * more-filters switches all apply. Families combine with "or", so a chip's number is the same
   * whether it is on or off, and a selected chip's number is its cards in the list.
   */
  byFamily: Partial<Record<FamilyKey, number>>;
  /** Listings per type under every filter but the segment's types. */
  byType: Partial<Record<ListingType, number>>;
  /** Listings per style under every filter but the style one. */
  byStyle: Partial<Record<StyleKey, number>>;
  /** The listings the list shows: every filter applied. */
  total: number;
  /** The night's listings within reach before any filter, to tell "nothing on" from "nothing matches". */
  night: number;
}

export interface ListNightResult {
  listings: Listing[];
  counts: ListingCounts;
}

export interface DayCount {
  nightDate: NightDate;
  /** "Tonight", "Tomorrow", then "Wed, Sep 23". */
  label: string;
  count: number;
}

export interface MetroSummary {
  id: string;
  slug: string;
  name: string;
  countryCode: string;
  center: Point;
  radiusKm: number;
  tz: string;
  languages: string[];
  /** Great-circle distance from the query point to the metro centre. */
  distanceKm: number;
}

/**
 * What an event address answers (D-092): the listing is listed; it was merged into another, which
 * stands under `slug`; or there is no listing to show (gone, or never ours); or a past night the
 * retention job archived (M1).
 */
export type SlugAnswer =
  | { kind: "listed" }
  | { kind: "moved"; slug: string }
  | { kind: "gone" }
  | {
      kind: "passed";
      title: string;
      nightDate: string;
      venueName: string | null;
      metroSlug: string;
    };

/** How many merges an old address follows to the listing that stands (D-092). */
export const MERGED_HOPS = 3;

/** A city the site covers, for the city switcher in the home heading. */
export interface CitySummary {
  slug: string;
  name: string;
  center: Point;
  /** True when at least one listed event is on tonight's night or later, in the city's zone. */
  hasListings: boolean;
}

export interface ListingsRepository {
  /**
   * Tonight's or a chosen night's listings around a point, each with distance and live status.
   * Listings whose time is not listed (startsAt null) are included and counted, with live status
   * kind "time_not_listed" (D-060).
   */
  listNight(query: ListNightQuery): Promise<ListNightResult>;
  /**
   * One listing by slug, with live status for `now`; null when unknown or not active (cancelled
   * rows are kept, marked). A listing whose time is not listed is returned like any other.
   */
  getBySlug(slug: string, now: Date): Promise<Listing | null>;
  /**
   * Where an event address leads (D-092): a merged listing's address follows `merged_into_id`, at
   * most MERGED_HOPS merges, to a listed survivor. One indexed lookup, for `proxy.ts`.
   */
  resolveSlug(slug: string): Promise<SlugAnswer>;
  /**
   * Counts for the day picker (through the next full weekend). Each night is counted by the same rule listNight uses,
   * under `filters` (the ones a day's link carries; "On now" only on tonight), so a day's count is
   * the list that tapping it shows, untimed listings included.
   */
  dayCounts(
    center: Point,
    radiusKm: number,
    now: Date,
    filters?: ListingFilters,
  ): Promise<DayCount[]>;
  /**
   * listNight and dayCounts for one page view, from one read of the listings (the home page asks for
   * both). Equal to calling the two separately with the same arguments.
   */
  nightWithDays(query: ListNightQuery): Promise<{ night: ListNightResult; days: DayCount[] }>;
  /** The nearest metro whose centre is within 50 km of the point (PLAN section 10), or null. */
  metroFor(center: Point): Promise<MetroSummary | null>;
  /**
   * Every city we cover (metros that are not ad hoc), sorted by name, each with whether it has a
   * listing tonight or later. For the city switcher in the home heading.
   */
  listCities(now: Date): Promise<CitySummary[]>;
}

/** A metro is "near" a point when its centre is within this distance (PLAN section 10). */
export const METRO_MATCH_KM = 50;
