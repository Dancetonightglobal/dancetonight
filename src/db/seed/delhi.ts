// Delhi metro row (D-1140): NCT Delhi, Gurugram district and Gautam Buddh Nagar (Noida), the outline in
// config/metro-bounds/delhi.json. Languages en, hi, pa (D-1141). No demo venues or listings: the seed runner writes only the metro row.

import type { NewMetro } from "@/src/db/schema/metros";
import { seedId } from "@/src/db/seed/ids";

export const DELHI_TZ = "Asia/Kolkata";
export const DELHI_METRO = {
  slug: "delhi",
  name: "Delhi",
  countryCode: "IN",
  center: { lat: 28.6315, lng: 77.2167 }, // Connaught Place (Central Park)
  radiusKm: 75, // the outline's farthest point (Gurugram's south-west corner) is 74 km from the centre
  tz: DELHI_TZ,
  languages: ["en", "hi", "pa"],
} as const;
export const DELHI_METRO_ID = seedId("metro", DELHI_METRO.slug);

/** Delhi's metro row (D-1140): NCT Delhi + Gurugram + Noida, the outline in config/metro-bounds/delhi.json. */
export function delhiMetroRow(): NewMetro & { id: string } {
  return {
    id: DELHI_METRO_ID,
    slug: DELHI_METRO.slug,
    name: DELHI_METRO.name,
    countryCode: DELHI_METRO.countryCode,
    center: { lng: DELHI_METRO.center.lng, lat: DELHI_METRO.center.lat },
    radiusKm: DELHI_METRO.radiusKm,
    tz: DELHI_METRO.tz,
    languages: [...DELHI_METRO.languages],
    geonamesId: 1273294, // Delhi, GeoNames
    population: 19950488, // Census of India 2011: NCT Delhi 16,787,941 + Gurgaon 1,514,432 + Gautam Buddha Nagar 1,648,115
    status: "active",
    adHoc: false,
  };
}
