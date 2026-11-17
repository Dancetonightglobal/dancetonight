// Tulum metro row (D-1080): the Tulum and Solidaridad (Playa del Carmen) municipios, the outline in
// config/metro-bounds/tulum.json. No demo venues or listings: the seed runner writes only the metro row.

import type { NewMetro } from "@/src/db/schema/metros";
import { seedId } from "@/src/db/seed/ids";

export const TULUM_TZ = "America/Cancun";
export const TULUM_METRO = {
  slug: "tulum",
  name: "Tulum",
  countryCode: "MX",
  // Akumal, midway between Tulum (26 km) and Playa del Carmen (36 km), so a visitor in either town is within
  // METRO_MATCH_KM (50 km) of the centre.
  center: { lat: 20.3969, lng: -87.3144 },
  radiusKm: 73, // the outline's farthest point, the Tulum municipio's western corner past Cobá, is 72 km out
  tz: TULUM_TZ,
  languages: ["es", "en"],
} as const;
export const TULUM_METRO_ID = seedId("metro", TULUM_METRO.slug);

/** Tulum's metro row (D-1080): the Tulum and Solidaridad municipios, the outline in config/metro-bounds/tulum.json. */
export function tulumMetroRow(): NewMetro & { id: string } {
  return {
    id: TULUM_METRO_ID,
    slug: TULUM_METRO.slug,
    name: TULUM_METRO.name,
    countryCode: TULUM_METRO.countryCode,
    center: { lng: TULUM_METRO.center.lng, lat: TULUM_METRO.center.lat },
    radiusKm: TULUM_METRO.radiusKm,
    tz: TULUM_METRO.tz,
    languages: [...TULUM_METRO.languages],
    geonamesId: 3515040, // Tulum, GeoNames
    population: 380521, // INEGI Censo 2020: Tulum 46,721 + Solidaridad 333,800
    status: "active",
    adHoc: false,
  };
}
