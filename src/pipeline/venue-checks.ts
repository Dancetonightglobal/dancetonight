// Venue checks at ingest (D-071). Two ways a pin lands somewhere the venue is not:
//
// - A ticketing API's own point can be wrong. Ticketmaster puts Terminal 5 about 800 m from 610
//   West 56th Street and Brooklyn Steel about a kilometre from 319 Frost Street (run 26).
//   `resolveVenue` checks a Ticketmaster or Eventbrite point against its street address geocoded
//   to a building, and uses the building's point when the two are more than 150 m apart; the
//   venue a listing created at the wrong point moves. A feed's own point is the organiser's pin
//   and is not checked.
// - A placeholder address. A model read wrote "Tango Arts, 123 Main St, New York, NY", and the
//   geocoder found a 123 Main St in the Bronx. A placeholder is never geocoded, stored or searched
//   (`isPlaceholderAddress`), and a venue pinned from one before this check is removed here, so
//   its listings are unplaced rather than pinned somewhere invented.
//
// Both are reported in the run's report.

import { and, eq, isNotNull } from "drizzle-orm";

import type { Metro } from "@/src/adapters/types";
import type { Db } from "@/src/db/client";
import { events, venues } from "@/src/db/schema";
import { isPlaceholderAddress } from "@/src/pipeline/geocode";
import { SAME_DOOR_ROW_CAP } from "@/src/pipeline/venue-address-match";

export interface VenueReport {
  /** An API's point more than 150 m from its geocoded street address: the address's point used. */
  moved: string[];
  /** Listings naming a placeholder address: it was not geocoded, stored or searched. */
  placeholders: string[];
  /** Venues pinned from a placeholder address before D-071, removed; their listings unplaced. */
  removed: string[];
  /**
   * An API's point that could not be checked against its address: no geocoder in the run, or no
   * building-level answer (an outage, a quota, an address placed no better than a street).
   */
  unchecked: string[];
  /** Addresses the geocoder gave no point for, with why (`address: reason`). */
  refused?: string[];
  /** Starting pages placed at the venue whose own site they are, or left (D-087). */
  seedVenues?: string[];
  /** Address-only listings placed at the one named venue at the same street and number (address_match). */
  sameDoor?: string[];
  /** Address-only listings whose same-door search hit SAME_DOOR_ROW_CAP: left to the geocoder. */
  sameDoorCapped?: string[];
  /** Stored venues named by a canonical known venue's alias, renamed to its first name (D-265). */
  renamed?: string[];
}

export function emptyVenueReport(): VenueReport {
  return { moved: [], placeholders: [], removed: [], unchecked: [] };
}

/** Adds a line once: one venue is named by many listings, and each is resolved. */
export function noteOnce(lines: string[] | undefined, line: string): void {
  if (lines && !lines.includes(line)) lines.push(line);
}

/**
 * Removes the venues a listing created from a placeholder address before D-071, with their
 * listings' points: the listings stay, unplaced, and a listing whose source gives a point of its
 * own is placed again when it is next written, with no address. Only rows this pipeline created
 * (`seed_provider` "listing"): a seeded venue's address came from its seed, not from a listing.
 */
export async function removePlaceholderVenues(
  db: Db,
  metro: Metro,
  report: VenueReport,
): Promise<void> {
  const rows = await db
    .select({ id: venues.id, name: venues.name, address: venues.address })
    .from(venues)
    .where(
      and(
        eq(venues.metroId, metro.id),
        eq(venues.seedProvider, "listing"),
        isNotNull(venues.address),
      ),
    );
  for (const row of rows) {
    const address = row.address?.formatted ?? row.address?.line1 ?? null;
    if (!address || !isPlaceholderAddress(address)) continue;
    const listings = await db.transaction(async (tx) => {
      const unplaced = await tx
        .update(events)
        .set({ geo: null })
        .where(eq(events.venueId, row.id))
        .returning({ id: events.id });
      // Every reference to a venue is `on delete set null` (events, series, sources, census).
      await tx.delete(venues).where(eq(venues.id, row.id));
      return unplaced.length;
    });
    report.removed.push(
      `${row.name} ("${address}") removed; ${listings} ${listings === 1 ? "listing" : "listings"} unplaced`,
    );
  }
}

function sameDoorLines(report: VenueReport): string {
  const { sameDoor, sameDoorCapped } = report;
  const sameDoorCount = sameDoor?.length ?? 0;
  const cappedCount = sameDoorCapped?.length ?? 0;

  if (sameDoorCount === 0 && cappedCount === 0) {
    return "";
  }

  let lines = "";

  if (sameDoorCount > 0) {
    const n = sameDoorCount;
    lines += `\nSame street and number: ${n} ${n === 1 ? "address" : "addresses"} with no venue name placed at the named venue there (address_match).`;
    for (const note of sameDoor!.slice(0, 20)) {
      lines += `\n  - ${note}`;
    }
    if (n > 20) {
      lines += `\n  and ${n - 20} more`;
    }
  }

  if (cappedCount > 0) {
    const n = cappedCount;
    lines += `\naddress_match cap reached: ${n} ${n === 1 ? "address" : "addresses"} (more than ${SAME_DOOR_ROW_CAP} stored venues share its street word and number), left to the geocoder:`;
    for (const note of sameDoorCapped!.slice(0, 20)) {
      lines += `\n  - ${note}`;
    }
    if (n > 20) {
      lines += `\n  and ${n - 20} more`;
    }
  }

  return lines;
}

/**
 * The report's venue lines: what the checks changed this run, and the points they could not
 * check, so a run whose geocoder gave no answer does not read as one that found nothing wrong.
 */
export function formatVenueReport(report: VenueReport): string {
  const { moved, placeholders, removed, unchecked, refused } = report;
  // Starting pages placed at their venue this run (D-087): a line of their own, under the rest.
  const seeds = (report.seedVenues ?? []).map((note) => `\nStarting page venue: ${note}`).join("");
  const renamed = (report.renamed ?? [])
    .map((note) => `\nVenue renamed to canonical: ${note}`)
    .join("");
  const hasRefused = refused && refused.length > 0;

  if (moved.length + placeholders.length + removed.length + unchecked.length === 0 && !hasRefused) {
    const base = `Venues: no listed point far from its address, no placeholder addresses.`;
    const sameDoorSection = sameDoorLines(report);
    return base + sameDoorSection + seeds + renamed;
  }

  let line = `Venues: ${moved.length} listed ${moved.length === 1 ? "point" : "points"} more than 150 m from the geocoded address (the address's point used), ${placeholders.length} placeholder ${placeholders.length === 1 ? "address" : "addresses"} refused, ${removed.length} ${removed.length === 1 ? "venue" : "venues"} pinned from a placeholder removed.`;
  if (unchecked.length > 0)
    line += ` ${unchecked.length} listed ${unchecked.length === 1 ? "point" : "points"} not checked against the address (no geocoder, or no building-level answer).`;

  for (const note of [...moved, ...placeholders, ...removed, ...unchecked].slice(0, 20))
    line += `\n  - ${note}`;

  if (hasRefused) {
    const n = refused.length;
    line += `\nGeocoder refused ${n} ${n === 1 ? "address" : "addresses"}:`;
    for (const note of refused.slice(0, 40)) {
      line += `\n  - ${note}`;
    }
    if (n > 40) {
      line += `\n  and ${n - 40} more`;
    }
  }

  const sameDoorSection = sameDoorLines(report);
  return line + sameDoorSection + seeds + renamed;
}
