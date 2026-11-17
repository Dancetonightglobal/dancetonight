// Philadelphia metro row (D-300): the City of Philadelphia plus its near suburbs
// (D-511: Delaware County, the Main Line, Glenside), the outline in config/metro-bounds/philadelphia.json. No demo venues or listings.

import type { NewMetro } from "@/src/db/schema/metros";
import { seedId } from "@/src/db/seed/ids";

export const PHILADELPHIA_TZ = "America/New_York";
export const PHILADELPHIA_METRO = {
  slug: "philadelphia",
  name: "Philadelphia",
  countryCode: "US",
  center: { lat: 39.9524, lng: -75.1636 }, // City Hall
  radiusKm: 30,
  tz: PHILADELPHIA_TZ,
  languages: ["en"],
} as const;
export const PHILADELPHIA_METRO_ID = seedId("metro", PHILADELPHIA_METRO.slug);

/** Philadelphia's metro row (D-300): the City of Philadelphia plus its near suburbs
 * (D-511: Delaware County, the Main Line, Glenside), the outline in config/metro-bounds/philadelphia.json. No demo venues or listings.
 */
export function philadelphiaMetroRow(): NewMetro & { id: string } {
  return {
    id: PHILADELPHIA_METRO_ID,
    slug: PHILADELPHIA_METRO.slug,
    name: PHILADELPHIA_METRO.name,
    countryCode: PHILADELPHIA_METRO.countryCode,
    center: { lng: PHILADELPHIA_METRO.center.lng, lat: PHILADELPHIA_METRO.center.lat },
    radiusKm: PHILADELPHIA_METRO.radiusKm,
    tz: PHILADELPHIA_METRO.tz,
    languages: [...PHILADELPHIA_METRO.languages],
    geonamesId: 4560349,
    population: 1603797, // 2020 Census, City of Philadelphia
    status: "active",
    adHoc: false,
  };
}
