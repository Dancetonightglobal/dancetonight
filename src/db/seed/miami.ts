// Miami metro row (D-320): Miami-Dade County, the outline in config/metro-bounds/miami.json.
// No demo venues or listings: the seed runner writes only the metro row.

import type { NewMetro } from "@/src/db/schema/metros";
import { seedId } from "@/src/db/seed/ids";

export const MIAMI_TZ = "America/New_York";
export const MIAMI_METRO = {
  slug: "miami",
  name: "Miami",
  countryCode: "US",
  center: { lat: 25.7797, lng: -80.1897 }, // Freedom Tower, downtown Miami
  radiusKm: 60,
  tz: MIAMI_TZ,
  languages: ["en", "es"],
} as const;
export const MIAMI_METRO_ID = seedId("metro", MIAMI_METRO.slug);

/** Miami's metro row (D-320): Miami-Dade County, the outline in config/metro-bounds/miami.json. */
export function miamiMetroRow(): NewMetro & { id: string } {
  return {
    id: MIAMI_METRO_ID,
    slug: MIAMI_METRO.slug,
    name: MIAMI_METRO.name,
    countryCode: MIAMI_METRO.countryCode,
    center: { lng: MIAMI_METRO.center.lng, lat: MIAMI_METRO.center.lat },
    radiusKm: MIAMI_METRO.radiusKm,
    tz: MIAMI_METRO.tz,
    languages: [...MIAMI_METRO.languages],
    geonamesId: 4164138, // Miami (city), GeoNames
    population: 2838461, // US Census Vintage 2024, Miami-Dade County, July 1 2024
    status: "active",
    adHoc: false,
  };
}
