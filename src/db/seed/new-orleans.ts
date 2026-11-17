// New Orleans metro row (D-340, D-555): Orleans Parish (= the City of New Orleans) and Jefferson Parish,
// the outline in config/metro-bounds/new-orleans.json. No demo venues or listings.

import type { NewMetro } from "@/src/db/schema/metros";
import { seedId } from "@/src/db/seed/ids";

export const NEW_ORLEANS_TZ = "America/Chicago";
export const NEW_ORLEANS_METRO = {
  slug: "new-orleans",
  name: "New Orleans",
  countryCode: "US",
  center: { lat: 29.9574, lng: -90.0629 }, // Jackson Square
  radiusKm: 45,
  tz: NEW_ORLEANS_TZ,
  languages: ["en"],
} as const;
export const NEW_ORLEANS_METRO_ID = seedId("metro", NEW_ORLEANS_METRO.slug);

/** New Orleans' metro row (D-340, D-555): Orleans Parish (= the City of New Orleans) and Jefferson Parish,
 * the outline in config/metro-bounds/new-orleans.json. No demo venues or listings.
 */
export function newOrleansMetroRow(): NewMetro & { id: string } {
  return {
    id: NEW_ORLEANS_METRO_ID,
    slug: NEW_ORLEANS_METRO.slug,
    name: NEW_ORLEANS_METRO.name,
    countryCode: NEW_ORLEANS_METRO.countryCode,
    center: { lng: NEW_ORLEANS_METRO.center.lng, lat: NEW_ORLEANS_METRO.center.lat },
    radiusKm: NEW_ORLEANS_METRO.radiusKm,
    tz: NEW_ORLEANS_METRO.tz,
    languages: [...NEW_ORLEANS_METRO.languages],
    geonamesId: 4335045,
    population: 824778, // 2020 Census: Orleans Parish 383,997 + Jefferson Parish 440,781 (D-555)
    status: "active",
    adHoc: false,
  };
}
