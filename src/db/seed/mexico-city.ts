// Mexico City metro row (D-440): Ciudad de México, its 16 alcaldías, the outline in config/metro-bounds/mexico-city.json.
// No demo venues or listings: the seed runner writes only the metro row.

import type { NewMetro } from "@/src/db/schema/metros";
import { seedId } from "@/src/db/seed/ids";

export const MEXICO_CITY_TZ = "America/Mexico_City";
export const MEXICO_CITY_METRO = {
  slug: "mexico-city",
  name: "Mexico City",
  countryCode: "MX",
  center: { lat: 19.4326, lng: -99.1332 }, // Zócalo
  radiusKm: 45,
  tz: MEXICO_CITY_TZ,
  languages: ["es", "en"],
} as const;
export const MEXICO_CITY_METRO_ID = seedId("metro", MEXICO_CITY_METRO.slug);

/** Mexico City's metro row (D-440): Ciudad de México, its 16 alcaldías, the outline in config/metro-bounds/mexico-city.json. */
export function mexicoCityMetroRow(): NewMetro & { id: string } {
  return {
    id: MEXICO_CITY_METRO_ID,
    slug: MEXICO_CITY_METRO.slug,
    name: MEXICO_CITY_METRO.name,
    countryCode: MEXICO_CITY_METRO.countryCode,
    center: { lng: MEXICO_CITY_METRO.center.lng, lat: MEXICO_CITY_METRO.center.lat },
    radiusKm: MEXICO_CITY_METRO.radiusKm,
    tz: MEXICO_CITY_METRO.tz,
    languages: [...MEXICO_CITY_METRO.languages],
    geonamesId: 3530597, // Mexico City, GeoNames
    population: 9209944, // INEGI Censo 2020, Ciudad de México
    status: "active",
    adHoc: false,
  };
}
