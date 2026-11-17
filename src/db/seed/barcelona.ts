// Barcelona metro row (D-360): the Barcelonès (Barcelona, L'Hospitalet de Llobregat, Badalona, Santa
// Coloma de Gramenet, Sant Adrià de Besòs), the outline in config/metro-bounds/barcelona.json.
// No demo venues or listings: the seed runner writes only the metro row.

import type { NewMetro } from "@/src/db/schema/metros";
import { seedId } from "@/src/db/seed/ids";

export const BARCELONA_TZ = "Europe/Madrid";
export const BARCELONA_METRO = {
  slug: "barcelona",
  name: "Barcelona",
  countryCode: "ES",
  center: { lat: 41.387, lng: 2.17 }, // Plaça de Catalunya
  radiusKm: 15,
  tz: BARCELONA_TZ,
  // Catalan and Spanish first: summaries wait until the summary check reads them (D-109, owner's 8A).
  languages: ["ca", "es", "en"],
} as const;
export const BARCELONA_METRO_ID = seedId("metro", BARCELONA_METRO.slug);

/** Barcelona's metro row (D-360): the Barcelonès, the outline in config/metro-bounds/barcelona.json. */
export function barcelonaMetroRow(): NewMetro & { id: string } {
  return {
    id: BARCELONA_METRO_ID,
    slug: BARCELONA_METRO.slug,
    name: BARCELONA_METRO.name,
    countryCode: BARCELONA_METRO.countryCode,
    center: { lng: BARCELONA_METRO.center.lng, lat: BARCELONA_METRO.center.lat },
    radiusKm: BARCELONA_METRO.radiusKm,
    tz: BARCELONA_METRO.tz,
    languages: [...BARCELONA_METRO.languages],
    geonamesId: 3128760, // Barcelona (city), GeoNames
    population: 2398280, // Barcelonès, Idescat 2025 (annual population census)
    status: "active",
    adHoc: false,
  };
}
