// Istanbul metro row (D-680): Istanbul province, its 39 districts, the outline in
// config/metro-bounds/istanbul.json. No demo venues or listings: the seed runner writes only the metro row.

import type { NewMetro } from "@/src/db/schema/metros";
import { seedId } from "@/src/db/seed/ids";

export const ISTANBUL_TZ = "Europe/Istanbul";
export const ISTANBUL_METRO = {
  slug: "istanbul",
  name: "Istanbul",
  countryCode: "TR",
  center: { lat: 41.0369, lng: 28.985 }, // Taksim Square
  radiusKm: 100, // the outline's farthest points (Silivri's western edge, Sile's eastern) are about 85-95 km out
  tz: ISTANBUL_TZ,
  languages: ["tr", "en"],
} as const;
export const ISTANBUL_METRO_ID = seedId("metro", ISTANBUL_METRO.slug);

/** Istanbul's metro row (D-680): Istanbul province, the outline in config/metro-bounds/istanbul.json. */
export function istanbulMetroRow(): NewMetro & { id: string } {
  return {
    id: ISTANBUL_METRO_ID,
    slug: ISTANBUL_METRO.slug,
    name: ISTANBUL_METRO.name,
    countryCode: ISTANBUL_METRO.countryCode,
    center: { lng: ISTANBUL_METRO.center.lng, lat: ISTANBUL_METRO.center.lat },
    radiusKm: ISTANBUL_METRO.radiusKm,
    tz: ISTANBUL_METRO.tz,
    languages: [...ISTANBUL_METRO.languages],
    geonamesId: 745044, // Istanbul (city), GeoNames
    population: 15701602, // TUIK ADNKS 2024, Istanbul province
    status: "active",
    adHoc: false,
  };
}
