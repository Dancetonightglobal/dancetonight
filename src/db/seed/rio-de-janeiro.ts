// Rio de Janeiro metro row (D-420): the municipalities of Rio de Janeiro and Niterói, the outline in
// config/metro-bounds/rio-de-janeiro.json. No demo venues or listings: the seed runner writes only the metro row.

import type { NewMetro } from "@/src/db/schema/metros";
import { seedId } from "@/src/db/seed/ids";

export const RIO_DE_JANEIRO_TZ = "America/Sao_Paulo";
export const RIO_DE_JANEIRO_METRO = {
  slug: "rio-de-janeiro",
  name: "Rio de Janeiro",
  countryCode: "BR",
  center: { lat: -22.9128, lng: -43.18 }, // Arcos da Lapa, Lapa
  radiusKm: 65, // Santa Cruz and Guaratiba, the city's far west, are ~60 km from Lapa
  tz: RIO_DE_JANEIRO_TZ,
  languages: ["pt"],
} as const;
export const RIO_DE_JANEIRO_METRO_ID = seedId("metro", RIO_DE_JANEIRO_METRO.slug);

/** Rio de Janeiro's metro row (D-420): Rio de Janeiro and Niterói, the outline in config/metro-bounds/rio-de-janeiro.json. */
export function rioDeJaneiroMetroRow(): NewMetro & { id: string } {
  return {
    id: RIO_DE_JANEIRO_METRO_ID,
    slug: RIO_DE_JANEIRO_METRO.slug,
    name: RIO_DE_JANEIRO_METRO.name,
    countryCode: RIO_DE_JANEIRO_METRO.countryCode,
    center: { lng: RIO_DE_JANEIRO_METRO.center.lng, lat: RIO_DE_JANEIRO_METRO.center.lat },
    radiusKm: RIO_DE_JANEIRO_METRO.radiusKm,
    tz: RIO_DE_JANEIRO_METRO.tz,
    // Portuguese first: no "In short" summaries until summarize.ts reads Portuguese (D-109).
    languages: [...RIO_DE_JANEIRO_METRO.languages],
    geonamesId: 3451190, // Rio de Janeiro (city), GeoNames
    population: 6693172, // IBGE Censo 2022: Rio de Janeiro 6,211,423 + Niterói 481,749
    status: "active",
    adHoc: false,
  };
}
