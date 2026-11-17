// San Juan metro row (D-460): the five municipios of San Juan, Carolina, Guaynabo, Bayamón and Cataño,
// the outline in config/metro-bounds/san-juan.json.
// No demo venues or listings: the seed runner writes only the metro row.

import type { NewMetro } from "@/src/db/schema/metros";
import { seedId } from "@/src/db/seed/ids";

export const SAN_JUAN_TZ = "America/Puerto_Rico";
export const SAN_JUAN_METRO = {
  slug: "san-juan",
  name: "San Juan",
  countryCode: "US",
  center: { lat: 18.4494, lng: -66.0663 }, // La Placita de Santurce
  radiusKm: 35,
  tz: SAN_JUAN_TZ,
  languages: ["en", "es"],
} as const;
export const SAN_JUAN_METRO_ID = seedId("metro", SAN_JUAN_METRO.slug);

/** San Juan's metro row (D-460): the five municipios, the outline in config/metro-bounds/san-juan.json. */
export function sanJuanMetroRow(): NewMetro & { id: string } {
  return {
    id: SAN_JUAN_METRO_ID,
    slug: SAN_JUAN_METRO.slug,
    name: SAN_JUAN_METRO.name,
    countryCode: SAN_JUAN_METRO.countryCode,
    center: { lng: SAN_JUAN_METRO.center.lng, lat: SAN_JUAN_METRO.center.lat },
    radiusKm: SAN_JUAN_METRO.radiusKm,
    tz: SAN_JUAN_METRO.tz,
    languages: [...SAN_JUAN_METRO.languages],
    geonamesId: 4568127, // San Juan (city), GeoNames
    population: 795196, // 2020 Census, five municipios: San Juan 342259, Bayamón 185187, Carolina 154815, Guaynabo 89780, Cataño 23155
    status: "active",
    adHoc: false,
  };
}
