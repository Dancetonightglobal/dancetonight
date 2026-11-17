// Lisbon metro row (D-380): the Área Metropolitana de Lisboa, its 18 municipalities, the outline in
// config/metro-bounds/lisbon.json. No demo venues or listings: the seed runner writes only the metro row.

import type { NewMetro } from "@/src/db/schema/metros";
import { seedId } from "@/src/db/seed/ids";

export const LISBON_TZ = "Europe/Lisbon";
export const LISBON_METRO = {
  slug: "lisbon",
  name: "Lisbon",
  countryCode: "PT",
  center: { lat: 38.7076, lng: -9.1365 }, // Praça do Comércio
  radiusKm: 60, // the outline's farthest point (Montijo's eastern part) is 56 km from the centre
  tz: LISBON_TZ,
  languages: ["pt", "en"],
} as const;
export const LISBON_METRO_ID = seedId("metro", LISBON_METRO.slug);

/** Lisbon's metro row (D-380): the Lisbon Metropolitan Area, the outline in config/metro-bounds/lisbon.json. */
export function lisbonMetroRow(): NewMetro & { id: string } {
  return {
    id: LISBON_METRO_ID,
    slug: LISBON_METRO.slug,
    name: LISBON_METRO.name,
    countryCode: LISBON_METRO.countryCode,
    center: { lng: LISBON_METRO.center.lng, lat: LISBON_METRO.center.lat },
    radiusKm: LISBON_METRO.radiusKm,
    tz: LISBON_METRO.tz,
    languages: [...LISBON_METRO.languages],
    geonamesId: 2267057, // Lisbon (city), GeoNames
    population: 2870208, // INE Census 2021, Área Metropolitana de Lisboa
    status: "active",
    adHoc: false,
  };
}
