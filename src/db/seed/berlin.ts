// Berlin metro row (D-1020): Land Berlin, its 12 Bezirke, the outline in
// config/metro-bounds/berlin.json. No demo venues or listings: the seed runner writes only the metro row.

import type { NewMetro } from "@/src/db/schema/metros";
import { seedId } from "@/src/db/seed/ids";

export const BERLIN_TZ = "Europe/Berlin";
export const BERLIN_METRO = {
  slug: "berlin",
  name: "Berlin",
  countryCode: "DE",
  center: { lat: 52.5163, lng: 13.3777 }, // Brandenburger Tor
  radiusKm: 35, // the outline's farthest point (Müggelheim's south-eastern edge) is about 27 km out
  tz: BERLIN_TZ,
  languages: ["de", "en"],
} as const;
export const BERLIN_METRO_ID = seedId("metro", BERLIN_METRO.slug);

/** Berlin's metro row (D-1020): Land Berlin, the outline in config/metro-bounds/berlin.json. */
export function berlinMetroRow(): NewMetro & { id: string } {
  return {
    id: BERLIN_METRO_ID,
    slug: BERLIN_METRO.slug,
    name: BERLIN_METRO.name,
    countryCode: BERLIN_METRO.countryCode,
    center: { lng: BERLIN_METRO.center.lng, lat: BERLIN_METRO.center.lat },
    radiusKm: BERLIN_METRO.radiusKm,
    tz: BERLIN_METRO.tz,
    languages: [...BERLIN_METRO.languages],
    geonamesId: 2950159, // Berlin, GeoNames
    population: 3897145, // Amt für Statistik Berlin-Brandenburg, residents registered at 2024-12-31 (unverified exact figure)
    status: "active",
    adHoc: false,
  };
}
