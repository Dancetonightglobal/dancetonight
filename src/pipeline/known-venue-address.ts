// D-826: a stored venue named by a known venue takes its checked address when its own is only a city.
// Havanna Berlin: Salsa Vida made the venue first with only "Berlin, Germany"; every later read matched
// that venue by name and point, so the club's own address in config/known-venues.ts never reached its six cards.
// This function upgrades such addresses.

import type { KnownVenue } from "@/config/known-venues";
import type { Metro } from "@/src/adapters/types";
import type { Db } from "@/src/db/client";
import { venues } from "@/src/db/schema";
import { and, eq, inArray, sql } from "drizzle-orm";

/**
 * For each known venue, update stored venues that have only a city‑level address (no house number)
 * to use the known venue's checked address.
 *
 * @returns The number of venues upgraded and a note for each.
 */
export async function upgradeKnownVenueAddresses(
  db: Db,
  args: { metro: Metro; known: readonly KnownVenue[] | undefined },
): Promise<{ upgraded: number; notes: string[] }> {
  const { metro, known } = args;
  if (!known || known.length === 0) {
    return { upgraded: 0, notes: [] };
  }

  const notes: string[] = [];
  let totalUpgraded = 0;

  for (const entry of known) {
    // Prepare the list of normalized names (trimmed, lowercased)
    const normalizedNames = entry.names.map((n) => n.trim().toLowerCase());

    // First, select matching rows that satisfy the conditions
    const matchingRows = await db
      .select({
        id: venues.id,
        name: venues.name,
        old: sql<string | null>`${venues.address}->>'formatted'`,
      })
      .from(venues)
      .where(
        and(
          eq(venues.metroId, metro.id),
          eq(venues.seedProvider, "listing"),
          // inArray, not `= any(${array})`: drizzle spreads a JS array into a parameter list.
          inArray(sql`lower(btrim(${venues.name}))`, normalizedNames),
          sql`(${venues.address} is null or coalesce(${venues.address}->>'formatted', '') !~ '[0-9]')`,
        ),
      );

    if (matchingRows.length === 0) continue;

    const ids = matchingRows.map((r) => r.id);

    // Update those rows with the known venue's address
    const updated = await db
      .update(venues)
      .set({
        address: { formatted: entry.address },
        updatedAt: new Date(),
      })
      .where(and(eq(venues.metroId, metro.id), inArray(venues.id, ids)))
      .returning({ id: venues.id });

    const upgradedCount = updated.length;
    totalUpgraded += upgradedCount;

    // Create one note per upgraded row, using the old address from the SELECT result
    for (const row of matchingRows) {
      if (ids.includes(row.id)) {
        notes.push(
          `${row.name}: address "${row.old ?? "none"}" is only a city; the known venue's "${entry.address}" is used (D-826)`,
        );
      }
    }
  }

  return { upgraded: totalUpgraded, notes };
}
