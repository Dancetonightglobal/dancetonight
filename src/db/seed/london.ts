// London metro row (D-200): Greater London, the outline in config/metro-bounds/london.json.
// No demo venues or listings: the seed runner writes only the metro row.

import type { NewMetro } from "@/src/db/schema/metros";
import { seedId } from "@/src/db/seed/ids";

export const LONDON_TZ = "Europe/London";
export const LONDON_METRO = {
  slug: "london",
  name: "London",
  countryCode: "GB",
  center: { lat: 51.5074, lng: -0.1278 }, // Charing Cross
  radiusKm: 35,
  tz: LONDON_TZ,
  languages: ["en"],
} as const;
export const LONDON_METRO_ID = seedId("metro", LONDON_METRO.slug);

/** London's metro row (D-200): Greater London, the outline in config/metro-bounds/london.json. */
export function londonMetroRow(): NewMetro & { id: string } {
  return {
    id: LONDON_METRO_ID,
    slug: LONDON_METRO.slug,
    name: LONDON_METRO.name,
    countryCode: LONDON_METRO.countryCode,
    center: { lng: LONDON_METRO.center.lng, lat: LONDON_METRO.center.lat },
    radiusKm: LONDON_METRO.radiusKm,
    tz: LONDON_METRO.tz,
    languages: [...LONDON_METRO.languages],
    geonamesId: 2643743,
    population: 8945309, // ONS mid-2023 Greater London
    status: "active",
    adHoc: false,
  };
}
