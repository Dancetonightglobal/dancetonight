// Tokyo metro row (D-1221): mainland Tokyo Metropolis (the 23 special wards and the Tama municipalities, the Izu
// and Ogasawara islands left out), the outline in config/metro-bounds/tokyo.json. No demo venues or listings: the
// seed runner writes only the metro row.

import type { NewMetro } from "@/src/db/schema/metros";
import { seedId } from "@/src/db/seed/ids";

export const TOKYO_TZ = "Asia/Tokyo";
export const TOKYO_METRO = {
  slug: "tokyo",
  name: "Tokyo",
  countryCode: "JP",
  center: { lat: 35.6812, lng: 139.7671 }, // Tokyo Station, Marunouchi
  radiusKm: 75, // the outline's farthest point, Okutama's western edge, is about 74 km out
  tz: TOKYO_TZ,
  languages: ["ja", "en"],
} as const;
export const TOKYO_METRO_ID = seedId("metro", TOKYO_METRO.slug);

/** Tokyo's metro row (D-1221): mainland Tokyo Metropolis, the outline in config/metro-bounds/tokyo.json. */
export function tokyoMetroRow(): NewMetro & { id: string } {
  return {
    id: TOKYO_METRO_ID,
    slug: TOKYO_METRO.slug,
    name: TOKYO_METRO.name,
    countryCode: TOKYO_METRO.countryCode,
    center: { lng: TOKYO_METRO.center.lng, lat: TOKYO_METRO.center.lat },
    radiusKm: TOKYO_METRO.radiusKm,
    tz: TOKYO_METRO.tz,
    languages: [...TOKYO_METRO.languages],
    geonamesId: 1850147, // Tokyo, GeoNames
    population: 14100000, // Tokyo Metropolis, about 14.1 million (2025 estimate)
    status: "active",
    adHoc: false,
  };
}
