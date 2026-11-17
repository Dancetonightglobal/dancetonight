// Pune metro row (D-1120): the Pune Municipal Corporation with its two cantonments, Pimpri-Chinchwad and
// Hinjewadi, the outline in config/metro-bounds/pune.json. No demo venues or listings: the seed runner writes
// only the metro row.

import type { NewMetro } from "@/src/db/schema/metros";
import { seedId } from "@/src/db/seed/ids";

export const PUNE_TZ = "Asia/Kolkata";
export const PUNE_METRO = {
  slug: "pune",
  name: "Pune",
  countryCode: "IN",
  center: { lat: 18.5196, lng: 73.8553 }, // Shaniwar Wada, the old city
  radiusKm: 25, // the outline's farthest point (Pimpri-Chinchwad's northern edge) is 24 km from the centre
  tz: PUNE_TZ,
  languages: ["en", "mr", "hi"],
} as const;
export const PUNE_METRO_ID = seedId("metro", PUNE_METRO.slug);

/** Pune's metro row (D-1120): Pune, Pimpri-Chinchwad and Hinjewadi, the outline in config/metro-bounds/pune.json. */
export function puneMetroRow(): NewMetro & { id: string } {
  return {
    id: PUNE_METRO_ID,
    slug: PUNE_METRO.slug,
    name: PUNE_METRO.name,
    countryCode: PUNE_METRO.countryCode,
    center: { lng: PUNE_METRO.center.lng, lat: PUNE_METRO.center.lat },
    radiusKm: PUNE_METRO.radiusKm,
    tz: PUNE_METRO.tz,
    languages: [...PUNE_METRO.languages],
    geonamesId: 1259229, // Pune, GeoNames
    population: 4852150, // Census of India 2011: Pune (3,124,458) plus Pimpri-Chinchwad (1,727,692) municipal corporations
    status: "active",
    adHoc: false,
  };
}
