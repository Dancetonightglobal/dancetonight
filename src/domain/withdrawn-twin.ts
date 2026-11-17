// D-868: Berlin Tanzschule Traumtänzer (read 2026-11-11). The model gave the Awakening
// card's 18:00-20:00 on Sat 11-14 the title of the Ballhaus Tanzparty card above it.
// When a night's own part writes a start, the withdrawn copy beside the read's timed
// listing of one title and night is dropped.
import type { HarvestedListing } from "@/src/adapters/types";
import { foldForMatch } from "@/src/domain/text-facts";

export function withdrawnTwins(listings: readonly HarvestedListing[]): HarvestedListing[] {
  const result: HarvestedListing[] = [];

  for (const x of listings) {
    // 1. x.timesWithdrawn is set
    if (!x.timesWithdrawn) continue;
    // 2. x.recurrence is null/undefined, and x.listing.local_date is a non-null string
    if (x.recurrence != null) continue;
    const date = x.listing.local_date;
    if (typeof date !== "string") continue;
    // 3. Find a twin y
    let hasTwin = false;
    for (const y of listings) {
      if (y === x) continue;
      // y must have no timesWithdrawn
      if (y.timesWithdrawn) continue;
      // Same local_date
      if (y.listing.local_date !== date) continue;
      // Same title after folding
      const xTitle = foldForMatch(x.listing.title.trim()).replace(/\s+/g, " ");
      const yTitle = foldForMatch(y.listing.title.trim()).replace(/\s+/g, " ");
      if (xTitle !== yTitle) continue;
      // At least one start: doors_time, lesson_time or dancing_time is a non-empty string
      const hasStart =
        (y.listing.doors_time && y.listing.doors_time.trim() !== "") ||
        (y.listing.lesson_time && y.listing.lesson_time.trim() !== "") ||
        (y.listing.dancing_time && y.listing.dancing_time.trim() !== "");
      if (!hasStart) continue;
      hasTwin = true;
      break;
    }
    if (hasTwin) {
      result.push(x);
    }
  }

  return result;
}
