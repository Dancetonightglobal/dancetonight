/**
 * Store each venue's neighbourhood at ingest (step 1 of taking outlines out of the Worker) (D-499)
 */
import { eq } from "drizzle-orm";
import type { Db } from "@/src/db/client";
import { venues } from "@/src/db/schema";
import type { Point } from "@/src/domain/listing";
import { neighbourhoodAt } from "@/src/domain/neighbourhoods";

export function neighbourhoodUpdates(
  rows: readonly { id: string; location: Point | null; neighborhood: string | null }[],
  at: (p: Point) => string | null = neighbourhoodAt,
): { id: string; neighborhood: string | null }[] {
  const updates: { id: string; neighborhood: string | null }[] = [];

  for (const row of rows) {
    if (row.location === null) {
      // Skip rows without location
      continue;
    }

    const computed = at(row.location);
    if (computed !== row.neighborhood) {
      updates.push({ id: row.id, neighborhood: computed });
    }
  }

  return updates;
}

export async function storeVenueNeighbourhoods(db: Db, metroId: string): Promise<string[]> {
  // Select venues with location and current neighborhood
  const venueRows = await db
    .select({
      id: venues.id,
      location: venues.location,
      neighborhood: venues.neighborhood,
    })
    .from(venues)
    .where(eq(venues.metroId, metroId));

  // Convert location from {lat, lng} to Point
  const rows = venueRows.map((row) => ({
    id: row.id,
    location: row.location ? { lat: row.location.lat, lng: row.location.lng } : null,
    neighborhood: row.neighborhood,
  }));

  const updates = neighbourhoodUpdates(rows);

  if (updates.length === 0) {
    return [];
  }

  // Update each changed venue
  for (const update of updates) {
    await db
      .update(venues)
      .set({
        neighborhood: update.neighborhood,
        updatedAt: new Date(),
      })
      .where(eq(venues.id, update.id));
  }

  return [`${updates.length} venue neighbourhood(s) set`];
}
