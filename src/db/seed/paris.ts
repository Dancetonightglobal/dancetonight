// Paris metro row (D-1040): the Metropole du Grand Paris (Paris and 129 communes), the outline in
// config/metro-bounds/paris.json. No demo venues or listings: the seed runner writes only the metro row.

import type { NewMetro } from "@/src/db/schema/metros";
import { seedId } from "@/src/db/seed/ids";

export const PARIS_TZ = "Europe/Paris";
export const PARIS_METRO = {
  slug: "paris",
  name: "Paris",
  countryCode: "FR",
  center: { lat: 48.8534, lng: 2.3488 }, // Point zero, parvis de Notre-Dame
  radiusKm: 30, // the outline's farthest points (Argenteuil, Viry-Chatillon) are about 24 km out
  tz: PARIS_TZ,
  languages: ["fr", "en"],
} as const;
export const PARIS_METRO_ID = seedId("metro", PARIS_METRO.slug);

/** Paris's metro row (D-1040): the Metropole du Grand Paris, the outline in config/metro-bounds/paris.json. */
export function parisMetroRow(): NewMetro & { id: string } {
  return {
    id: PARIS_METRO_ID,
    slug: PARIS_METRO.slug,
    name: PARIS_METRO.name,
    countryCode: PARIS_METRO.countryCode,
    center: { lng: PARIS_METRO.center.lng, lat: PARIS_METRO.center.lat },
    radiusKm: PARIS_METRO.radiusKm,
    tz: PARIS_METRO.tz,
    languages: [...PARIS_METRO.languages],
    geonamesId: 2988507, // Paris, GeoNames
    population: 7115576, // INSEE legal population, Metropole du Grand Paris (geo.api.gouv.fr, 2026-11-06)
    status: "active",
    adHoc: false,
  };
}
