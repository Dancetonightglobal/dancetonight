// Marrakesh metro row (D-1100): the Prefecture of Marrakech, the outline in config/metro-bounds/marrakesh.json. No
// demo venues or listings: the seed runner writes only the metro row.

import type { NewMetro } from "@/src/db/schema/metros";
import { seedId } from "@/src/db/seed/ids";

export const MARRAKESH_TZ = "Africa/Casablanca";
export const MARRAKESH_METRO = {
  slug: "marrakesh",
  name: "Marrakesh",
  countryCode: "MA",
  center: { lat: 31.6258, lng: -7.9892 }, // Jemaa el-Fnaa
  radiusKm: 60, // the outline's farthest point (the prefecture's north edge) is about 56 km out
  tz: MARRAKESH_TZ,
  languages: ["en", "fr", "ar"],
} as const;
export const MARRAKESH_METRO_ID = seedId("metro", MARRAKESH_METRO.slug);

/** Marrakesh's metro row (D-1100): the Prefecture of Marrakech, the outline in config/metro-bounds/marrakesh.json. */
export function marrakeshMetroRow(): NewMetro & { id: string } {
  return {
    id: MARRAKESH_METRO_ID,
    slug: MARRAKESH_METRO.slug,
    name: MARRAKESH_METRO.name,
    countryCode: MARRAKESH_METRO.countryCode,
    center: { lng: MARRAKESH_METRO.center.lng, lat: MARRAKESH_METRO.center.lat },
    radiusKm: MARRAKESH_METRO.radiusKm,
    tz: MARRAKESH_METRO.tz,
    languages: [...MARRAKESH_METRO.languages],
    geonamesId: 2542997, // Marrakesh (city), GeoNames
    population: 1560103, // Prefecture of Marrakech, HCP 2024 census (legal population)
    status: "active",
    adHoc: false,
  };
}
