import { ROW_ONLY_METROS } from "@/src/db/seed/metros";
import { NYC_METRO } from "@/src/db/seed/nyc-data";
import type { Point } from "@/src/data/repository";

/** Every listed city's slug -> centre, from the seed metro rows (the cities the city picker lists). */
export const CITY_CENTERS: Readonly<Record<string, Point>> = (() => {
  const centers: Record<string, Point> = {
    nyc: { lat: NYC_METRO.center.lat, lng: NYC_METRO.center.lng },
  };
  for (const [slug, rowFn] of Object.entries(ROW_ONLY_METROS)) {
    const row = rowFn();
    centers[slug] = { lat: row.center.lat, lng: row.center.lng };
  }
  return Object.freeze(centers);
})();

/**
 * "/san-juan" or "/san-juan/" -> the slug, lower-cased and decoded; anything else (more segments, "/", bad encoding,
 * characters other than a-z 0-9 and "-") -> null.
 */
export function cityPathSlug(pathname: string): string | null {
  // Remove leading/trailing slashes
  const trimmed = pathname.replace(/^\/|\/$/g, "");
  if (trimmed === "") return null;

  // Must be a single segment
  if (trimmed.includes("/")) return null;

  // Decode percent-encoded characters
  let decoded: string;
  try {
    decoded = decodeURIComponent(trimmed);
  } catch {
    return null;
  }

  const slug = decoded.toLowerCase();
  return /^[a-z0-9-]+$/.test(slug) ? slug : null;
}

/**
 * The home page's query for a city path, or null when the path names no city in `centers`.
 * Keeps every key of `search` except lat, lng and place (repeated keys keep all their values, in order),
 * then sets lat and lng to the centre with toFixed(5). Never mutates `search`.
 */
export function cityRewrite(
  pathname: string,
  search: URLSearchParams,
  centers: Readonly<Record<string, Point>> = CITY_CENTERS,
): URLSearchParams | null {
  const slug = cityPathSlug(pathname);
  if (slug === null) return null;

  // Own keys only: "/constructor" must not find Object.prototype's.
  if (!Object.hasOwn(centers, slug)) return null;
  const center = centers[slug]!;

  // Create a new URLSearchParams
  const result = new URLSearchParams();

  // Copy all entries except lat, lng, place
  for (const [key, value] of search.entries()) {
    if (key === "lat" || key === "lng" || key === "place") continue;
    result.append(key, value);
  }

  // Set the city's centre coordinates
  result.set("lat", center.lat.toFixed(5));
  result.set("lng", center.lng.toFixed(5));

  return result;
}
