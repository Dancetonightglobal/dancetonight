// Austin metro row (D-1180): Travis County plus the City of Austin's parts in Williamson and Hays Counties, the
// outline in config/metro-bounds/austin.json. No demo venues or listings: the seed runner writes only the metro row.

import type { NewMetro } from "@/src/db/schema/metros";
import { seedId } from "@/src/db/seed/ids";

export const AUSTIN_TZ = "America/Chicago";
export const AUSTIN_METRO = {
  slug: "austin",
  name: "Austin",
  countryCode: "US",
  center: { lat: 30.2747, lng: -97.7404 }, // Texas State Capitol, downtown Austin
  radiusKm: 50,
  tz: AUSTIN_TZ,
  languages: ["en", "es"],
} as const;
export const AUSTIN_METRO_ID = seedId("metro", AUSTIN_METRO.slug);

/** Austin's metro row (D-1180): Travis County and the City of Austin, the outline in config/metro-bounds/austin.json. */
export function austinMetroRow(): NewMetro & { id: string } {
  return {
    id: AUSTIN_METRO_ID,
    slug: AUSTIN_METRO.slug,
    name: AUSTIN_METRO.name,
    countryCode: AUSTIN_METRO.countryCode,
    center: { lng: AUSTIN_METRO.center.lng, lat: AUSTIN_METRO.center.lat },
    radiusKm: AUSTIN_METRO.radiusKm,
    tz: AUSTIN_METRO.tz,
    languages: [...AUSTIN_METRO.languages],
    geonamesId: 4671654, // Austin (city), GeoNames
    population: 1363767, // US Census Vintage 2024, Travis County, July 1 2024
    status: "active",
    adHoc: false,
  };
}
