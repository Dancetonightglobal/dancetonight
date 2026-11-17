// Los Angeles metro row (D-1160): Los Angeles County, the outline in config/metro-bounds/los-angeles.json.
// No demo venues or listings: the seed runner writes only the metro row.

import type { NewMetro } from "@/src/db/schema/metros";
import { seedId } from "@/src/db/seed/ids";

export const LOS_ANGELES_TZ = "America/Los_Angeles";
export const LOS_ANGELES_METRO = {
  slug: "los-angeles",
  name: "Los Angeles",
  countryCode: "US",
  center: { lat: 34.0537, lng: -118.2427 }, // Los Angeles City Hall, downtown
  radiusKm: 105, // the county's mainland reaches 104 km out (Gorman); the outline decides listings
  tz: LOS_ANGELES_TZ,
  languages: ["en", "es"],
} as const;
export const LOS_ANGELES_METRO_ID = seedId("metro", LOS_ANGELES_METRO.slug);

/** Los Angeles's metro row (D-1160): Los Angeles County, the outline in config/metro-bounds/los-angeles.json. */
export function losAngelesMetroRow(): NewMetro & { id: string } {
  return {
    id: LOS_ANGELES_METRO_ID,
    slug: LOS_ANGELES_METRO.slug,
    name: LOS_ANGELES_METRO.name,
    countryCode: LOS_ANGELES_METRO.countryCode,
    center: { lng: LOS_ANGELES_METRO.center.lng, lat: LOS_ANGELES_METRO.center.lat },
    radiusKm: LOS_ANGELES_METRO.radiusKm,
    tz: LOS_ANGELES_METRO.tz,
    languages: [...LOS_ANGELES_METRO.languages],
    geonamesId: 5368361, // Los Angeles (city), GeoNames
    population: 9757179, // US Census Vintage 2024, Los Angeles County, July 1 2024
    status: "active",
    adHoc: false,
  };
}
