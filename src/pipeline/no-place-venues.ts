/**
 * Clear stored venues that are no place ("Various venues in Mexico City", "Multiple neighborhoods",
 * "Varios lugares", "Por confirmar") as per D-280. Listings that were pinned at such venues become
 * "Location not listed" instead of being pinned at a city centre.
 */
import { eq } from "drizzle-orm";
import type { Db } from "@/src/db/client";
import { events, metros, series, sources, venues } from "@/src/db/schema";
import { isCityOnlyPlace } from "@/src/domain/city-only-venue";
import { isNoPlace } from "@/src/pipeline/source-venue";

export async function clearNoPlaceVenues(db: Db, metroId: string, now?: Date): Promise<string[]> {
  const updatedAt = now ?? new Date();

  // 1. Select venues of this metro
  const metroVenues = await db
    .select({ id: venues.id, name: venues.name, address: venues.address })
    .from(venues)
    .where(eq(venues.metroId, metroId));

  // A venue named only as the city ("London", D-840) is no place either, whatever address its seed gave it:
  // listings matched to it by that name were pinned there (79 London nights at a Wimbledon "London", 2026-11-10).
  const [metro] = await db.select({ name: metros.name }).from(metros).where(eq(metros.id, metroId));
  const cityNames = metro ? [metro.name] : [];

  // 2. Keep those where isNoPlace(name) || isNoPlace(address) || the name is only the city
  const noPlaceVenues = metroVenues.filter(
    (v) =>
      isNoPlace(v.name) || isNoPlace(v.address?.formatted) || isCityOnlyPlace(v.name, cityNames),
  );

  if (noPlaceVenues.length === 0) {
    return [];
  }

  const lines: string[] = [];

  for (const venue of noPlaceVenues) {
    // Count updates for each table
    const eventUpdates = await db
      .update(events)
      .set({ venueId: null, geo: null, updatedAt })
      .where(eq(events.venueId, venue.id))
      .returning({ id: events.id });

    const seriesUpdates = await db
      .update(series)
      .set({ venueId: null, updatedAt })
      .where(eq(series.venueId, venue.id))
      .returning({ id: series.id });

    const sourceUpdates = await db
      .update(sources)
      .set({ venueId: null })
      .where(eq(sources.venueId, venue.id))
      .returning({ id: sources.id });

    const eCount = eventUpdates.length;
    const sCount = seriesUpdates.length;
    const kCount = sourceUpdates.length;

    // Skip if all counts are zero
    if (eCount === 0 && sCount === 0 && kCount === 0) {
      continue;
    }

    lines.push(
      `"${venue.name}" is no place (D-280): its venue taken off ${eCount} listings, ${sCount} series and ${kCount} sources`,
    );
  }

  return lines;
}
