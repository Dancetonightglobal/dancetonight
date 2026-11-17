// Dubai metro row (D-1060): the Emirate of Dubai with the Hatta exclave, the outline in
// config/metro-bounds/dubai.json. No demo venues or listings: the seed runner writes only the metro row.

import type { NewMetro } from "@/src/db/schema/metros";
import { seedId } from "@/src/db/seed/ids";

export const DUBAI_TZ = "Asia/Dubai";
export const DUBAI_METRO = {
  slug: "dubai",
  name: "Dubai",
  countryCode: "AE",
  center: { lat: 25.1972, lng: 55.2744 }, // Burj Khalifa, Downtown Dubai
  radiusKm: 105, // the outline's farthest point, Hatta's eastern edge, is 104 km out
  tz: DUBAI_TZ,
  languages: ["en", "ar"],
} as const;
export const DUBAI_METRO_ID = seedId("metro", DUBAI_METRO.slug);

/** Dubai's metro row (D-1060): the Emirate of Dubai with the Hatta exclave, the outline in config/metro-bounds/dubai.json. */
export function dubaiMetroRow(): NewMetro & { id: string } {
  return {
    id: DUBAI_METRO_ID,
    slug: DUBAI_METRO.slug,
    name: DUBAI_METRO.name,
    countryCode: DUBAI_METRO.countryCode,
    center: { lng: DUBAI_METRO.center.lng, lat: DUBAI_METRO.center.lat },
    radiusKm: DUBAI_METRO.radiusKm,
    tz: DUBAI_METRO.tz,
    languages: [...DUBAI_METRO.languages],
    geonamesId: 292223, // Dubai (city), GeoNames
    population: 4580300, // Dubai Data and Statistics Establishment, end of 2025
    status: "active",
    adHoc: false,
  };
}
