// Medellín metro row (D-640): the 10 municipalities of the Área Metropolitana del Valle de Aburrá,
// the outline in config/metro-bounds/medellin.json.

import type { NewMetro } from "@/src/db/schema/metros";
import { seedId } from "@/src/db/seed/ids";

export const MEDELLIN_TZ = "America/Bogota";
export const MEDELLIN_METRO = {
  slug: "medellin",
  name: "Medellín",
  countryCode: "CO",
  center: { lat: 6.2502, lng: -75.5688 }, // Parque Berrío
  radiusKm: 40,
  tz: MEDELLIN_TZ,
  languages: ["es", "en"],
} as const;
export const MEDELLIN_METRO_ID = seedId("metro", MEDELLIN_METRO.slug);

/** Medellín's metro row (D-640): the 10 municipalities, the outline in config/metro-bounds/medellin.json. */
export function medellinMetroRow(): NewMetro & { id: string } {
  return {
    id: MEDELLIN_METRO_ID,
    slug: MEDELLIN_METRO.slug,
    name: MEDELLIN_METRO.name,
    countryCode: MEDELLIN_METRO.countryCode,
    center: { lng: MEDELLIN_METRO.center.lng, lat: MEDELLIN_METRO.center.lat },
    radiusKm: MEDELLIN_METRO.radiusKm,
    tz: MEDELLIN_METRO.tz,
    languages: [...MEDELLIN_METRO.languages],
    geonamesId: 3674962, // Medellín, GeoNames
    population: 4194012, // DANE 2025 projection (CNPV 2018 base), the 10 municipalities: Medellín 2528343, Bello 601916, Itagüí 304527, Envigado 264637, Sabaneta 106652, Copacabana 90882, Caldas 89072, La Estrella 83089, Barbosa 63455, Girardota 61439
    status: "active",
    adHoc: false,
  };
}
