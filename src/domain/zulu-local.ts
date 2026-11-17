import type { HarvestedListing } from "@/src/adapters/types";
import { isoToLocal } from "@/src/adapters/shared";

/**
 * Adjust a listing whose JSON-LD evidence writes a Z suffix for local wall-clock times.
 * Returns a copy with times shifted to local wall-clock interpretation.
 */
export function withZuluAsLocal(
  listing: HarvestedListing,
  on: boolean | string | undefined,
  metroTz: string,
): { listing: HarvestedListing; applied: boolean } {
  // true: the source writes "Z"; a string: the one wrong offset it writes ("-08:00", Salsa Vida Beirut).
  const suffix =
    on === true ? "Z" : typeof on === "string" && /^[+-]\d{2}:\d{2}$/.test(on) ? on : null;
  if (suffix === null) {
    return { listing, applied: false };
  }
  const tail = suffix.replace("+", "\\+");

  const evidence = listing.listing.evidence;
  const startEvidence = evidence?.start;
  if (typeof startEvidence !== "string") {
    return { listing, applied: false };
  }

  // Pattern: "startDate 2026-11-27T20:00:00Z"
  const startMatch = startEvidence.match(
    new RegExp(`^startDate (\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}(?::\\d{2}(?:\\.\\d+)?)?)${tail}$`),
  );
  if (!startMatch) {
    return { listing, applied: false };
  }

  const rawWithZ = startMatch[1] + suffix;
  const rawWithoutZ = startMatch[1]; // without Z suffix

  const zone = listing.tz ?? metroTz;
  const oldStart = isoToLocal(rawWithZ, zone);
  const newStart = isoToLocal(rawWithoutZ, zone);

  if (!oldStart || !newStart || oldStart.time === null) {
    return { listing, applied: false };
  }

  // Build a copy of the listing.listing
  const copy = { ...listing.listing };

  // Shift times that match oldStart.time
  if (copy.doors_time === oldStart.time) copy.doors_time = newStart.time;
  if (copy.lesson_time === oldStart.time) copy.lesson_time = newStart.time;
  if (copy.dancing_time === oldStart.time) copy.dancing_time = newStart.time;

  // Shift local_date if it matches oldStart.night
  if (copy.local_date === oldStart.night) {
    copy.local_date = newStart.night;
  }

  // Handle end evidence if present
  const endEvidence = evidence?.end_time;
  if (typeof endEvidence === "string") {
    const endMatch = endEvidence.match(
      new RegExp(`^endDate (\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}(?::\\d{2}(?:\\.\\d+)?)?)${tail}$`),
    );
    if (endMatch) {
      const rawEndWithZ = endMatch[1] + suffix;
      const rawEndWithoutZ = endMatch[1];
      const oldEnd = isoToLocal(rawEndWithZ, zone);
      const newEnd = isoToLocal(rawEndWithoutZ, zone);
      if (oldEnd && newEnd && oldEnd.time !== null && copy.end_time === oldEnd.time) {
        copy.end_time = newEnd.time;
      }
    }
  }

  return {
    listing: {
      ...listing,
      listing: copy,
    },
    applied: true,
  };
}
