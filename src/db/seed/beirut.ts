// Beirut metro row (D-1000): Beirut Governorate plus the coastal Metn and Baabda cadastres next to it, the outline in
// config/metro-bounds/beirut.json. No demo venues or listings: the seed runner writes only the metro row.

import type { NewMetro } from "@/src/db/schema/metros";
import { seedId } from "@/src/db/seed/ids";

export const BEIRUT_TZ = "Asia/Beirut";
export const BEIRUT_METRO = {
  slug: "beirut",
  name: "Beirut",
  countryCode: "LB",
  center: { lat: 33.8959, lng: 35.5069 }, // Martyrs' Square
  radiusKm: 15, // the outline's farthest points (Dbayeh, Hadath) are about 9-10 km out
  tz: BEIRUT_TZ,
  languages: ["en", "fr", "ar"],
} as const;
export const BEIRUT_METRO_ID = seedId("metro", BEIRUT_METRO.slug);

/** Beirut's metro row (D-1000): Beirut Governorate plus the coastal Metn and Baabda cadastres, the outline in config/metro-bounds/beirut.json. */
export function beirutMetroRow(): NewMetro & { id: string } {
  return {
    id: BEIRUT_METRO_ID,
    slug: BEIRUT_METRO.slug,
    name: BEIRUT_METRO.name,
    countryCode: BEIRUT_METRO.countryCode,
    center: { lng: BEIRUT_METRO.center.lng, lat: BEIRUT_METRO.center.lat },
    radiusKm: BEIRUT_METRO.radiusKm,
    tz: BEIRUT_METRO.tz,
    languages: [...BEIRUT_METRO.languages],
    geonamesId: 276781, // Beirut (city), GeoNames
    population: 2400000, // Greater Beirut, about 2.4 million (2025 estimate)
    status: "active",
    adHoc: false,
  };
}
