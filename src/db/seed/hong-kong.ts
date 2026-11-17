// Hong Kong metro row (D-660): the HKSAR's 18 districts, the outline in config/metro-bounds/hong-kong.json.
// No demo venues or listings: the seed runner writes only the metro row.

import type { NewMetro } from "@/src/db/schema/metros";
import { seedId } from "@/src/db/seed/ids";

export const HONG_KONG_TZ = "Asia/Hong_Kong";
export const HONG_KONG_METRO = {
  slug: "hong-kong",
  name: "Hong Kong",
  countryCode: "HK",
  center: { lat: 22.2819, lng: 114.1581 }, // Statue Square, Central
  radiusKm: 45, // the outline's farthest sea edge is 42 km from Central
  tz: HONG_KONG_TZ,
  languages: ["en", "zh"],
} as const;
export const HONG_KONG_METRO_ID = seedId("metro", HONG_KONG_METRO.slug);

/** Hong Kong's metro row (D-660): the HKSAR's 18 districts, the outline in config/metro-bounds/hong-kong.json. */
export function hongKongMetroRow(): NewMetro & { id: string } {
  return {
    id: HONG_KONG_METRO_ID,
    slug: HONG_KONG_METRO.slug,
    name: HONG_KONG_METRO.name,
    countryCode: HONG_KONG_METRO.countryCode,
    center: { lng: HONG_KONG_METRO.center.lng, lat: HONG_KONG_METRO.center.lat },
    radiusKm: HONG_KONG_METRO.radiusKm,
    tz: HONG_KONG_METRO.tz,
    languages: [...HONG_KONG_METRO.languages],
    geonamesId: 1819729, // Hong Kong, GeoNames
    population: 7413070, // 2021 Population Census
    status: "active",
    adHoc: false,
  };
}
