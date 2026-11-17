// The home screen's state, read from and written back to the URL (PLAN section 11), so a
// filtered view is shareable and the back button works. Nothing here touches React or the DOM:
// the page parses the search params on the server, and every control is a link or a GET form
// whose href this module builds.
//
// Param names follow PLAN section 11: lat, lng, place, day, r, t, s, price, free, lvl, lesson,
// np, age, live, now, conf, sort, view. Two are added here and named in the report notes:
//   `f`      the family chips (PLAN lists `s` for styles; the approved design's chip row is a
//            family row, and ListingFilters carries both).
//   `filters` whether the more-filters sheet is open, so opening it is a normal navigation.

import { FAMILY_KEYS, type FamilyKey, type StyleKey, STYLE_KEYS } from "@/config/styles";
import type { ListingFilters, ListingSort, Point } from "@/src/data/repository";
import { NYC_METRO } from "@/src/db/seed/nyc-data";
import { LISTING_TYPE_KEYS, type ListingType } from "@/src/domain/listing-types";
import { isoDateSchema } from "@/src/domain/time";
import {
  currentNightDate,
  isOpenableNight,
  nightDateSchema,
  type NightDate,
} from "@/src/domain/tonight";

/** What Next hands a page as `searchParams`. */
export type RawParams = Record<string, string | string[] | undefined>;

/**
 * Where the page looks when the visitor has given no coordinates. The first-paint location flow
 * (IP geo headers, then "Use my exact location", then search) is PLAN section 11 and lands with
 * the geocoder in a later phase; until then mock mode opens on the seed metro (D-011), and the
 * centre is read from the seed rather than copied so the two cannot drift.
 */
export const DEFAULT_CENTER: Point = { lat: NYC_METRO.center.lat, lng: NYC_METRO.center.lng };
export const DEFAULT_RADIUS_KM: number = NYC_METRO.radiusKm;
export const DEFAULT_TZ: string = NYC_METRO.tz;

/** The radii the more-filters sheet offers, in km. */
/**
 * Kilometres, chosen so the miles a US dancer reads are round: 3, 5, 10 and 25 mi (the review of
 * 2026-09-28 found 3, 6, 16, 31 mi). 40 is also the New York metro's own radius.
 */
export const RADIUS_CHOICES = [5, 8, 16, 40];

/** The price ceilings the more-filters sheet offers, in the listings' currency. */
export const PRICE_CHOICES = [10, 20, 30] as const;

export const SEGMENTS = ["all", "social", "clubs", "classes", "other"] as const;
export type Segment = (typeof SEGMENTS)[number];

/**
 * The segmented control in terms of listing types. The four non-"all" segments partition
 * LISTING_TYPE_KEYS exactly: every type appears once, so no listing can fall out of the control.
 * A test asserts it.
 */
export const SEGMENT_TYPES: Readonly<Record<Exclude<Segment, "all">, readonly ListingType[]>> =
  Object.freeze({
    social: ["social", "practica", "jam", "live_music_with_dancing"],
    clubs: ["club_night"],
    classes: ["class"],
    other: ["festival_session", "outdoor_public", "venue_open_night", "other"],
  });

export type HomeView = "list" | "map";

/**
 * A night a `day` link asked for that the page does not open, and why: the page shows tonight
 * instead and says so, never silently (audit F16, 2026-09-29).
 */
export type UnopenedDay =
  | { reason: "over"; date: NightDate }
  | { reason: "not_yet"; date: NightDate }
  | { reason: "not_a_date" };

export interface HomeQuery {
  center: Point;
  /** True when the centre came from the URL rather than the fallback. */
  centerFromUrl: boolean;
  place: string | null;
  radiusKm: number;
  nightDate: NightDate;
  /** True when `nightDate` is the night in progress, which is the only night with a "now". */
  isTonight: boolean;
  /** The night the link asked for when the page opened tonight instead; null otherwise. */
  unopenedDay: UnopenedDay | null;
  segment: Segment;
  families: FamilyKey[];
  /** Style keys from `s`. No chip row draws them, so "Clear styles" clears them with the families. */
  styles: StyleKey[];
  sort: ListingSort;
  view: HomeView;
  sheetOpen: boolean;
  filters: ListingFilters;
}

function one(params: RawParams, key: string): string | null {
  const value = params[key];
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed === "" ? null : trimmed;
}

/** A URL flag: present and not "0"/"false" means on. Absent means off. */
function flag(params: RawParams, key: string): boolean {
  const raw = one(params, key);
  if (raw === null) return false;
  return raw !== "0" && raw.toLowerCase() !== "false";
}

function number(params: RawParams, key: string): number | null {
  const raw = one(params, key);
  if (raw === null) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

/** A comma list, keeping only members of `allowed`, de-duplicated, in the order given. */
export function parseList<T extends string>(raw: string | null, allowed: readonly T[]): T[] {
  if (raw === null) return [];
  const out: T[] = [];
  for (const part of raw.split(",")) {
    const key = part.trim();
    if (allowed.includes(key as T) && !out.includes(key as T)) out.push(key as T);
  }
  return out;
}

/**
 * A searched place that names a metro we list moves the centre there: the point in the URL is
 * dropped, so the page opens on that metro's own centre. The metro's name must not also be used as
 * search text, so `place` is removed as well. Any other search filters the night's listings by
 * event, venue, style and more (src/domain/search.ts).
 */
export function resolvePlace(params: RawParams, metroName: string | null): RawParams {
  const place = one(params, "place");
  if (place === null || metroName === null) return params;
  if (place.toLowerCase() !== metroName.toLowerCase()) return params;
  return Object.fromEntries(
    Object.entries(params).filter(([key]) => key !== "lat" && key !== "lng" && key !== "place"),
  );
}

export function parseCenter(params: RawParams): Point | null {
  const lat = number(params, "lat");
  const lng = number(params, "lng");
  if (lat === null || lng === null) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

function parseAge(raw: string | null): ListingFilters["age"] {
  if (raw === "all") return "all";
  if (raw === "18") return 18;
  if (raw === "21") return 21;
  return undefined;
}

/**
 * The whole home query. `tz` is the metro's zone, so "which night is tonight" is decided in the
 * dancer's city rather than the server's (CLAUDE.md: all tonight logic goes through the zone).
 */
export function parseHomeParams(
  params: RawParams,
  now: Date,
  tz: string,
  defaultRadiusKm: number = DEFAULT_RADIUS_KM,
  defaultNight?: NightDate,
): HomeQuery {
  const center = parseCenter(params);
  const tonight = currentNightDate(now, tz);

  // Any night the home page can open does, in the picker or beyond it (a shared link, the event
  // page's way back): tonight through tonight + 12 (isOpenableNight, D-075). A night that is over,
  // one not yet listed or a typed non-date opens tonight, never a past night or an unread one
  // (D-067). In the early hours, the default night may be the coming night (D-518).
  const dayRaw = one(params, "day");
  const opens = dayRaw !== null && isOpenableNight(dayRaw, now, tz);
  const nightDate = nightDateSchema.parse(opens ? dayRaw : (defaultNight ?? tonight));
  const unopenedDay: UnopenedDay | null =
    dayRaw === null || opens
      ? null
      : !isoDateSchema.safeParse(dayRaw).success
        ? { reason: "not_a_date" }
        : dayRaw < tonight
          ? { reason: "over", date: dayRaw }
          : { reason: "not_yet", date: dayRaw };

  const segmentRaw = one(params, "t");
  const segment: Segment = SEGMENTS.includes(segmentRaw as Segment)
    ? (segmentRaw as Segment)
    : "all";

  const families = parseList(one(params, "f"), FAMILY_KEYS);
  const styles = parseList(one(params, "s"), STYLE_KEYS);

  const radius = number(params, "r");
  const radiusKm = radius !== null && radius > 0 && radius <= 200 ? radius : defaultRadiusKm;

  // `price` carries all three states the sheet offers: "any" (absent), "free", or a ceiling.
  const priceRaw = one(params, "price");
  const maxPrice = priceRaw !== null && priceRaw !== "free" ? number(params, "price") : null;
  const free = priceRaw === "free" || flag(params, "free");
  const age = parseAge(one(params, "age"));

  const filters: ListingFilters = {};
  if (segment !== "all") filters.types = [...SEGMENT_TYPES[segment]];
  if (families.length > 0) filters.families = families;
  if (styles.length > 0) filters.styles = styles as StyleKey[];
  if (free) filters.free = true;
  if (maxPrice !== null && maxPrice >= 0) filters.maxPrice = maxPrice;
  if (flag(params, "lvl")) filters.beginnerFriendly = true;
  if (flag(params, "lesson")) filters.lessonIncluded = true;
  if (flag(params, "np")) filters.noPartnerNeeded = true;
  if (age !== undefined) filters.age = age;
  if (flag(params, "live")) filters.liveMusic = true;
  // Only tonight has a now: on any other night "On now" would empty the list (review, 2026-09-28).
  if (flag(params, "now") && nightDate === tonight) filters.onNow = true;
  if (flag(params, "conf")) filters.confirmedOnly = true;

  // The search box's text (the `place` param): any search that did not name a metro filters the
  // night's listings by event, venue, style and more (src/domain/search.ts).
  const searchText = one(params, "place");
  if (searchText !== null) filters.text = searchText.slice(0, 100);

  return {
    center: center ?? DEFAULT_CENTER,
    centerFromUrl: center !== null,
    place: one(params, "place"),
    radiusKm,
    nightDate,
    isTonight: nightDate === tonight,
    unopenedDay,
    segment,
    families,
    styles: styles as StyleKey[],
    sort: one(params, "sort") === "distance" ? "distance" : "start",
    view: one(params, "view") === "map" ? "map" : "list",
    sheetOpen: flag(params, "filters"),
    filters,
  };
}

/** How many of the more-filters sheet's switches are on, for "{count} filters on". */
export function activeFilterCount(query: HomeQuery): number {
  const f = query.filters;
  const switches = [
    f.free === true,
    f.maxPrice !== undefined,
    f.beginnerFriendly === true,
    f.lessonIncluded === true,
    f.noPartnerNeeded === true,
    f.age !== undefined,
    f.liveMusic === true,
    f.onNow === true,
    f.confirmedOnly === true,
    query.radiusKm !== DEFAULT_RADIUS_KM,
  ];
  return switches.filter(Boolean).length;
}

/**
 * The current URL with some params changed. `null` removes one. Params this module does not know
 * about are carried through, so a link never quietly drops state someone else put in the URL.
 * Keys are sorted so the same view always has the same URL (shareable, cacheable, testable).
 */
export function hrefWith(params: RawParams, patch: Record<string, string | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (key in patch) continue;
    if (Array.isArray(value)) {
      for (const item of value) search.append(key, item);
    } else if (typeof value === "string") {
      search.set(key, value);
    }
  }
  for (const [key, value] of Object.entries(patch)) {
    if (value !== null) search.set(key, value);
  }
  search.sort();
  const query = search.toString();
  return query === "" ? "/" : `/?${query}`;
}

/**
 * The params every link and form on the page carries forward. A `day` the page did not open is
 * left out, so a filter, sort or view tap gives the night on screen and its count, not the asked
 * night again (audit F16). The address bar keeps the link as it was: reloaded once the night
 * opens, it opens that night.
 */
export function linkParams(params: RawParams, query: Pick<HomeQuery, "unopenedDay">): RawParams {
  if (query.unopenedDay === null) return params;
  return Object.fromEntries(Object.entries(params).filter(([key]) => key !== "day"));
}

/** Toggling one family chip on or off, keeping the rest of the row. */
export function toggleFamilyHref(
  params: RawParams,
  current: readonly FamilyKey[],
  family: FamilyKey,
): string {
  const next = current.includes(family)
    ? current.filter((f) => f !== family)
    : [...current, family];
  return hrefWith(params, { f: next.length === 0 ? null : next.join(",") });
}

/** Everything the more-filters form must carry forward as hidden inputs, as name/value pairs. */
export function carriedParams(params: RawParams, except: readonly string[]): [string, string][] {
  const out: [string, string][] = [];
  for (const [key, value] of Object.entries(params)) {
    if (except.includes(key)) continue;
    if (Array.isArray(value)) for (const item of value) out.push([key, item]);
    else if (typeof value === "string") out.push([key, value]);
  }
  return out;
}

export { FAMILY_KEYS, LISTING_TYPE_KEYS };
