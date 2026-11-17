// Coordinates to IANA zone (D-003). Server only: geo-tz ships polygon data that is far too
// large for the client, which never needs it because the API returns the zone. Kept apart
// from the pure functions in time.ts and tonight.ts so those stay import-free of geo-tz.

import { find } from "geo-tz";
import { z } from "zod";

export const pointSchema = z.object({
  lat: z.number().finite().min(-90).max(90),
  lng: z.number().finite().min(-180).max(180),
});

/**
 * Every IANA zone whose polygon contains the point, most specific first.
 * Empty for an invalid point. Open ocean resolves to an "Etc/GMT±N" zone.
 */
export function zonesForPoint(lat: number, lng: number): string[] {
  const parsed = pointSchema.safeParse({ lat, lng });
  if (!parsed.success) return [];
  return find(parsed.data.lat, parsed.data.lng);
}

/** The IANA zone at a point, or null when the point is invalid or unresolved. */
export function zoneForPoint(lat: number, lng: number): string | null {
  return zonesForPoint(lat, lng)[0] ?? null;
}
