// Buenos Aires metro row (D-400): the Ciudad Autónoma de Buenos Aires (CABA), the outline in config/metro-bounds/buenos-aires.json.
// No demo venues or listings: the seed runner writes only the metro row.

import type { NewMetro } from "@/src/db/schema/metros";
import { seedId } from "@/src/db/seed/ids";

export const BUENOS_AIRES_TZ = "America/Argentina/Buenos_Aires";
export const BUENOS_AIRES_METRO = {
  slug: "buenos-aires",
  name: "Buenos Aires",
  countryCode: "AR",
  center: { lat: -34.6037, lng: -58.3816 }, // the Obelisco, Avenida 9 de Julio
  radiusKm: 25,
  tz: BUENOS_AIRES_TZ,
  languages: ["es", "en"],
} as const;
export const BUENOS_AIRES_METRO_ID = seedId("metro", BUENOS_AIRES_METRO.slug);

/** Buenos Aires' metro row (D-400): the Ciudad Autónoma de Buenos Aires (CABA), the outline in config/metro-bounds/buenos-aires.json. */
export function buenosAiresMetroRow(): NewMetro & { id: string } {
  return {
    id: BUENOS_AIRES_METRO_ID,
    slug: BUENOS_AIRES_METRO.slug,
    name: BUENOS_AIRES_METRO.name,
    countryCode: BUENOS_AIRES_METRO.countryCode,
    center: { lng: BUENOS_AIRES_METRO.center.lng, lat: BUENOS_AIRES_METRO.center.lat },
    radiusKm: BUENOS_AIRES_METRO.radiusKm,
    tz: BUENOS_AIRES_METRO.tz,
    languages: [...BUENOS_AIRES_METRO.languages],
    geonamesId: 3435910, // Buenos Aires (city), GeoNames
    population: 3121707, // INDEC Censo 2022, Ciudad Autónoma de Buenos Aires
    status: "active",
    adHoc: false,
  };
}
