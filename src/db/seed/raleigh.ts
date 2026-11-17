// Raleigh metro row (D-600): Wake and Durham Counties (D-601), the outline in config/metro-bounds/raleigh.json.
// No demo venues or listings: the seed runner writes only the metro row.

import type { NewMetro } from "@/src/db/schema/metros";
import { seedId } from "@/src/db/seed/ids";

export const RALEIGH_TZ = "America/New_York";
export const RALEIGH_METRO = {
  slug: "raleigh",
  name: "Raleigh",
  countryCode: "US",
  center: { lat: 35.7804, lng: -78.6391 }, // North Carolina State Capitol, downtown Raleigh
  radiusKm: 45,
  tz: RALEIGH_TZ,
  languages: ["en", "es"],
} as const;
export const RALEIGH_METRO_ID = seedId("metro", RALEIGH_METRO.slug);

/** Raleigh's metro row (D-600): Wake and Durham Counties (D-601), the outline in config/metro-bounds/raleigh.json. */
export function raleighMetroRow(): NewMetro & { id: string } {
  return {
    id: RALEIGH_METRO_ID,
    slug: RALEIGH_METRO.slug,
    name: RALEIGH_METRO.name,
    countryCode: RALEIGH_METRO.countryCode,
    center: { lng: RALEIGH_METRO.center.lng, lat: RALEIGH_METRO.center.lat },
    radiusKm: RALEIGH_METRO.radiusKm,
    tz: RALEIGH_METRO.tz,
    languages: [...RALEIGH_METRO.languages],
    geonamesId: 4487042, // Raleigh (city), GeoNames
    population: 1232444, // US Census Vintage 2024, Wake County, July 1 2024
    status: "active",
    adHoc: false,
  };
}
