// Nashville metro row (D-1200): Davidson County, the consolidated Metropolitan Government of Nashville and
// Davidson County, the outline in config/metro-bounds/nashville.json.
// No demo venues or listings: the seed runner writes only the metro row.

import type { NewMetro } from "@/src/db/schema/metros";
import { seedId } from "@/src/db/seed/ids";

export const NASHVILLE_TZ = "America/Chicago";
export const NASHVILLE_METRO = {
  slug: "nashville",
  name: "Nashville",
  countryCode: "US",
  center: { lat: 36.1659, lng: -86.7844 }, // Tennessee State Capitol, downtown Nashville
  radiusKm: 35,
  tz: NASHVILLE_TZ,
  languages: ["en"],
} as const;
export const NASHVILLE_METRO_ID = seedId("metro", NASHVILLE_METRO.slug);

/** Nashville's metro row (D-1200): Davidson County, the outline in config/metro-bounds/nashville.json. */
export function nashvilleMetroRow(): NewMetro & { id: string } {
  return {
    id: NASHVILLE_METRO_ID,
    slug: NASHVILLE_METRO.slug,
    name: NASHVILLE_METRO.name,
    countryCode: NASHVILLE_METRO.countryCode,
    center: { lng: NASHVILLE_METRO.center.lng, lat: NASHVILLE_METRO.center.lat },
    radiusKm: NASHVILLE_METRO.radiusKm,
    tz: NASHVILLE_METRO.tz,
    languages: [...NASHVILLE_METRO.languages],
    geonamesId: 4644585, // Nashville (city), GeoNames
    population: 729505, // US Census Vintage 2024, Davidson County, July 1 2024
    status: "active",
    adHoc: false,
  };
}
