/**
 * A snapshot of a city's listings, stored in Workers KV under key `city/<slug>`.
 * Built when the city's read finishes and kept until its next read, so city pages
 * are answered without the database. Listings are chosen by distance, so no two
 * cities may be within 80 km of each other (their snapshots would overlap).
 * (the owner 2026-11-03)
 */

import { encodeShared, decodeShared } from "./shared-cache";
import type { Listing } from "@/src/domain/listing";
import type { NightDate } from "@/src/domain/tonight";
import type { Point } from "./repository";

export const SNAPSHOT_VERSION = 1;
/** Workers KV allows 25 MiB per value; we refuse anything over 20 MiB (UTF-8 bytes). */
export const SNAPSHOT_MAX_BYTES = 20 * 1024 * 1024;

export interface CitySnapshot {
  v: 1;
  metroId: string;
  slug: string;
  /** The metro's own centre and radius: the query the snapshot answers. */
  center: Point;
  radiusKm: number;
  /** The metro id whose unplaced listings were included, or null when none were. */
  unplacedMetroId: string | null;
  /** metroStamp() at build time, milliseconds since epoch (0 = no job has ever run). */
  stamp: number;
  builtAt: Date;
  /** Night dates the snapshot holds, ascending, no duplicates. */
  nights: NightDate[];
  /** Exactly the rows the database query returned for (center, radiusKm, nights, unplacedMetroId), in its order. */
  listings: Listing[];
}

export function snapshotKey(slug: string): string {
  return `city/${slug}`;
}

/** encodeShared(snapshot), or null when its UTF-8 byte length (TextEncoder) exceeds maxBytes. */
export function encodeSnapshot(
  snapshot: CitySnapshot,
  maxBytes = SNAPSHOT_MAX_BYTES,
): string | null {
  const encoded = encodeShared(snapshot);
  const byteLength = new TextEncoder().encode(encoded).length;
  if (byteLength > maxBytes) {
    return null;
  }
  return encoded;
}

/** decodeShared, then validated; null on invalid JSON, v !== 1, or any field missing / of the wrong type
 *  (check: metroId, slug strings; center.lat/lng finite numbers; radiusKm finite number; unplacedMetroId string or
 *  null; stamp finite number; builtAt a Date with a valid time; nights an array of strings; listings an array).
 *  Never throws. */
export function decodeSnapshot(text: string): CitySnapshot | null {
  try {
    const decoded = decodeShared<CitySnapshot>(text);

    // Validate v
    if (decoded.v !== 1) {
      return null;
    }

    // Validate required fields
    if (
      typeof decoded.metroId !== "string" ||
      typeof decoded.slug !== "string" ||
      typeof decoded.center?.lat !== "number" ||
      !Number.isFinite(decoded.center.lat) ||
      typeof decoded.center?.lng !== "number" ||
      !Number.isFinite(decoded.center.lng) ||
      typeof decoded.radiusKm !== "number" ||
      !Number.isFinite(decoded.radiusKm) ||
      (decoded.unplacedMetroId !== null && typeof decoded.unplacedMetroId !== "string") ||
      typeof decoded.stamp !== "number" ||
      !Number.isFinite(decoded.stamp) ||
      !(decoded.builtAt instanceof Date) ||
      isNaN(decoded.builtAt.getTime()) ||
      !Array.isArray(decoded.nights) ||
      !Array.isArray(decoded.listings)
    ) {
      return null;
    }

    // Validate nights array elements
    for (const night of decoded.nights) {
      if (typeof night !== "string") {
        return null;
      }
    }

    return decoded;
  } catch {
    return null;
  }
}

/**
 * The listings the database query (center, radiusKm, nights, unplacedMetroId) would return, from the snapshot,
 * or null when the snapshot cannot answer it. It can answer only when ALL hold:
 * center.lat === snapshot.center.lat and center.lng === snapshot.center.lng (exact, no tolerance);
 * radiusKm === snapshot.radiusKm; unplacedMetroId === snapshot.unplacedMetroId; nights is non-empty and every
 * night is in snapshot.nights. Then: snapshot.listings filtered to those whose nightDate is in nights, order kept.
 * Duplicate or unordered nights in the argument are fine. Never mutates the snapshot.
 */
export function answerFromSnapshot(
  snapshot: CitySnapshot,
  center: Point,
  radiusKm: number,
  nights: NightDate[],
  unplacedMetroId: string | null,
): Listing[] | null {
  // Check exact equality for center
  if (center.lat !== snapshot.center.lat || center.lng !== snapshot.center.lng) {
    return null;
  }

  if (radiusKm !== snapshot.radiusKm) {
    return null;
  }

  if (unplacedMetroId !== snapshot.unplacedMetroId) {
    return null;
  }

  if (nights.length === 0) {
    return null;
  }

  // Check that every night is in snapshot.nights
  const snapshotNightsSet = new Set(snapshot.nights);
  for (const night of nights) {
    if (!snapshotNightsSet.has(night)) {
      return null;
    }
  }

  // Filter listings to those whose nightDate is in nights
  const result = snapshot.listings.filter((listing) => nights.includes(listing.nightDate));

  return result;
}

/**
 * A metro's change stamp from per-metro job stamps. `stamps` maps metro id -> latest job start/finish (ms) and
 * the key null -> the latest of jobs with no metro (they touch every city, e.g. dedupe-unmerge).
 * Result = max(own, null-key). A metro with no own entry follows the GLOBAL stamp: the max of every value in the
 * map. Empty map -> 0.
 */
export function metroStamp(stamps: ReadonlyMap<string | null, number>, metroId: string): number {
  if (stamps.size === 0) {
    return 0;
  }

  const own = stamps.get(metroId);
  const global = stamps.get(null);

  if (own !== undefined) {
    // When the metro has its own entry, result = max(own, global ?? 0)
    return Math.max(own, global ?? 0);
  } else {
    // No own entry: use the max of all values in the map
    let maxGlobal = 0;
    for (const value of stamps.values()) {
      if (value > maxGlobal) {
        maxGlobal = value;
      }
    }
    return maxGlobal;
  }
}

/** True when currentStamp > snapshot.stamp, or some night in `needed` is not in snapshot.nights. */
export function snapshotStale(
  snapshot: CitySnapshot,
  currentStamp: number,
  needed: NightDate[],
): boolean {
  if (currentStamp > snapshot.stamp) {
    return true;
  }

  const snapshotNightsSet = new Set(snapshot.nights);
  for (const night of needed) {
    if (!snapshotNightsSet.has(night)) {
      return true;
    }
  }

  return false;
}
