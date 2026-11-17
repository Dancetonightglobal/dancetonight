/**
 * The city directory: every metro row plus the last night each non-ad-hoc city has a
 * listing, stored in Workers KV under `cities/v1` by the snapshot cron, so a fresh isolate
 * answers the city list and a city centre's metro without the database (the owner 2026-11-03).
 */

import { encodeShared, decodeShared } from "./shared-cache";
import { haversineKm } from "./listing-mapper";
import { roundedCenter } from "./snapshot-reader";
import { currentNightDate } from "@/src/domain/tonight";
import type { Point } from "./repository";
import type { MetroSummary, CitySummary } from "./repository";
import type { NightDate } from "@/src/domain/tonight";

export const CITY_DIRECTORY_KEY = "cities/v1";

export interface DirectoryMetro {
  id: string;
  slug: string;
  name: string;
  countryCode: string;
  center: Point;
  radiusKm: number;
  tz: string;
  languages: string[];
  adHoc: boolean;
  /** The latest night_date of an active, unmerged event in this metro, or null when it has none. */
  lastNight: NightDate | null;
}

export interface CityDirectory {
  v: 1;
  /** The metro stamp (max of every job_runs value, ms) when it was built; 0 when there were no runs. */
  stamp: number;
  builtAt: Date;
  /** In the order the database returned them: ORDER BY name. Keep that order; never re-sort. */
  metros: DirectoryMetro[];
}

/**
 * Encode a city directory to a string using encodeShared.
 */
export function encodeDirectory(dir: CityDirectory): string {
  return encodeShared(dir);
}

/**
 * Decode a city directory from a string.
 * Returns null on invalid JSON, v !== 1, or any validation failure.
 * Never throws.
 */
export function decodeDirectory(text: string): CityDirectory | null {
  try {
    const decoded = decodeShared<CityDirectory>(text);

    // Validate v
    if (decoded.v !== 1) {
      return null;
    }

    // Validate stamp
    if (typeof decoded.stamp !== "number" || !Number.isFinite(decoded.stamp)) {
      return null;
    }

    // Validate builtAt
    if (!(decoded.builtAt instanceof Date) || isNaN(decoded.builtAt.getTime())) {
      return null;
    }

    // Validate metros array
    if (!Array.isArray(decoded.metros)) {
      return null;
    }

    // Validate each metro entry
    for (const metro of decoded.metros) {
      if (
        typeof metro.id !== "string" ||
        typeof metro.slug !== "string" ||
        typeof metro.name !== "string" ||
        typeof metro.countryCode !== "string" ||
        typeof metro.tz !== "string" ||
        typeof metro.radiusKm !== "number" ||
        !Number.isFinite(metro.radiusKm) ||
        typeof metro.adHoc !== "boolean" ||
        !Array.isArray(metro.languages)
      ) {
        return null;
      }

      // Validate center
      if (
        typeof metro.center?.lat !== "number" ||
        !Number.isFinite(metro.center.lat) ||
        typeof metro.center?.lng !== "number" ||
        !Number.isFinite(metro.center.lng)
      ) {
        return null;
      }

      // Validate languages array elements
      for (const lang of metro.languages) {
        if (typeof lang !== "string") {
          return null;
        }
      }

      // Validate lastNight
      if (metro.lastNight !== null) {
        if (typeof metro.lastNight !== "string") {
          return null;
        }
        // Check format: YYYY-MM-DD
        if (!/^\d{4}-\d{2}-\d{2}$/.test(metro.lastNight)) {
          return null;
        }
      }
    }

    return decoded;
  } catch {
    return null;
  }
}

/**
 * Convert a directory to CitySummary array (for listCities).
 * Only includes metros with adHoc === false, preserving order.
 */
export function citiesFromDirectory(dir: CityDirectory, now: Date): CitySummary[] {
  const result: CitySummary[] = [];
  for (const metro of dir.metros) {
    if (metro.adHoc === false) {
      const hasListings =
        metro.lastNight !== null && metro.lastNight >= currentNightDate(now, metro.tz);
      result.push({
        slug: metro.slug,
        name: metro.name,
        center: { lat: metro.center.lat, lng: metro.center.lng },
        hasListings,
      });
    }
  }
  return result;
}

/**
 * Find which metro a point belongs to (for metroFor).
 * Returns null if zero or more than one metro matches by rounded center.
 */
export function metroFromDirectory(dir: CityDirectory, center: Point): MetroSummary | null {
  const rounded = roundedCenter(center);
  const matches: DirectoryMetro[] = [];

  for (const metro of dir.metros) {
    const metroRounded = roundedCenter(metro.center);
    if (rounded.lat === metroRounded.lat && rounded.lng === metroRounded.lng) {
      matches.push(metro);
    }
  }

  if (matches.length !== 1) {
    return null;
  }

  const m = matches[0]!;
  return {
    id: m.id,
    slug: m.slug,
    name: m.name,
    countryCode: m.countryCode,
    center: { lat: m.center.lat, lng: m.center.lng },
    radiusKm: m.radiusKm,
    tz: m.tz,
    languages: [...m.languages],
    distanceKm: haversineKm(center, m.center),
  };
}
