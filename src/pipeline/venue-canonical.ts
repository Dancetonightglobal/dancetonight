import { eq } from "drizzle-orm";
import type { KnownVenue } from "@/config/known-venues";
import { normalizeForMatch } from "@/config/styles";
import type { Db } from "@/src/db/client";
import { venues } from "@/src/db/schema";
import { noteOnce, type VenueReport } from "@/src/pipeline/venue-checks";

/** The canonical known venue whose first name is this listing venue name (normalised), or null. */
export function canonicalEntryFor(
  name: string | null,
  known: readonly KnownVenue[] | undefined,
): KnownVenue | null {
  if (!name || !known || known.length === 0) return null;
  const normalized = normalizeForMatch(name);
  for (const entry of known) {
    if (entry.canonical !== true) continue;
    const first = entry.names[0];
    if (!first) continue;
    const firstNormalized = normalizeForMatch(first);
    if (firstNormalized === normalized) {
      return entry;
    }
  }
  return null;
}

/**
 * A stored venue a listing matched, named by one of a canonical known venue's other names, takes the entry's
 * first name (D-265 follow-up). Returns the new name when it renamed, else null.
 */
export async function renameToCanonical(
  db: Db,
  venueId: string,
  listingVenueName: string | null,
  known: readonly KnownVenue[] | undefined,
  report?: VenueReport,
): Promise<string | null> {
  const entry = canonicalEntryFor(listingVenueName, known);
  if (!entry) return null;

  const newName = entry.names[0];
  if (!newName) return null;

  const rows = await db.select({ name: venues.name }).from(venues).where(eq(venues.id, venueId));
  const row = rows[0];
  if (!row) return null;

  const storedName = row.name;
  if (storedName === newName) return null;

  const storedNormalized = normalizeForMatch(storedName);
  const isAlias = entry.names
    .slice(1)
    .some((alias) => normalizeForMatch(alias) === storedNormalized);
  if (!isAlias) return null;

  await db
    .update(venues)
    .set({
      name: newName,
      nameNormalized: normalizeForMatch(newName),
    })
    .where(eq(venues.id, venueId));

  if (report) {
    noteOnce((report.renamed ??= []), `${storedName} -> ${newName}`);
  }

  return newName;
}
