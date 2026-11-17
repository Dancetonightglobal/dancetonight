// Mumbai metro row (D-620): Greater Mumbai (the Mumbai City and Mumbai Suburban districts), the outline in
// config/metro-bounds/mumbai.json. No demo venues or listings: the seed runner writes only the metro row.

import type { NewMetro } from "@/src/db/schema/metros";
import { seedId } from "@/src/db/seed/ids";

export const MUMBAI_TZ = "Asia/Kolkata";
export const MUMBAI_METRO = {
  slug: "mumbai",
  name: "Mumbai",
  countryCode: "IN",
  center: { lat: 18.9398, lng: 72.8355 }, // Chhatrapati Shivaji Maharaj Terminus
  radiusKm: 40, // the outline's farthest point (Dahisar, the northern edge) is 37 km from the centre
  tz: MUMBAI_TZ,
  languages: ["en", "hi", "mr"],
} as const;
export const MUMBAI_METRO_ID = seedId("metro", MUMBAI_METRO.slug);

/** Mumbai's metro row (D-620): Greater Mumbai, the outline in config/metro-bounds/mumbai.json. */
export function mumbaiMetroRow(): NewMetro & { id: string } {
  return {
    id: MUMBAI_METRO_ID,
    slug: MUMBAI_METRO.slug,
    name: MUMBAI_METRO.name,
    countryCode: MUMBAI_METRO.countryCode,
    center: { lng: MUMBAI_METRO.center.lng, lat: MUMBAI_METRO.center.lat },
    radiusKm: MUMBAI_METRO.radiusKm,
    tz: MUMBAI_METRO.tz,
    languages: [...MUMBAI_METRO.languages],
    geonamesId: 1275339, // Mumbai, GeoNames
    population: 12442373, // Census of India 2011, Greater Mumbai
    status: "active",
    adHoc: false,
  };
}
