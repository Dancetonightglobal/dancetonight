import { and, eq, inArray, isNotNull, notInArray, sql } from "drizzle-orm";
import type { FixedNight } from "@/src/domain/fixed-nights";
import type { Source } from "@/src/adapters/types";
import type { Db } from "@/src/db/client";
import { events, eventSources } from "@/src/db/schema";
import { retireRow } from "@/src/pipeline/store";
import { sharedTitleStems } from "@/src/domain/dedupe";
import { onWeeksOfMonth } from "@/src/domain/month-weeks";

/**
 * Returns closed nights from fixed nights that fall within the given nights.
 * A night is included if it lies within a closed range of a fixed night AND
 * its weekday matches one of the fixed night's days.
 */
export function closedNightsIn(
  fixedNights: readonly FixedNight[],
  nights: readonly string[],
): Array<{ night: string; title: string; cited: string }> {
  const result: Array<{ night: string; title: string; cited: string }> = [];

  for (const fixed of fixedNights) {
    const closed = fixed.closed;
    if (!closed || closed.length === 0) {
      continue;
    }

    // Validate closed ranges
    const validRanges = closed.filter((range) => {
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      return (
        dateRegex.test(range.from) &&
        dateRegex.test(range.to) &&
        range.from <= range.to &&
        range.cited?.trim()
      );
    });

    if (validRanges.length === 0) {
      continue;
    }

    // Compute weekday of each night
    for (const night of nights) {
      const date = new Date(`${night}T12:00:00Z`);
      const weekday = date.getUTCDay(); // 0 = Sunday, 6 = Saturday

      // Check if weekday matches any of the fixed night's days
      if (!fixed.days.includes(weekday)) {
        continue;
      }
      // A monthly night is only on its weeks of the month (D-827).
      if (fixed.weeksOfMonth && !onWeeksOfMonth(night, fixed.weeksOfMonth)) continue;

      // Check if night is within any valid closed range
      const matchingRange = validRanges.find((range) => range.from <= night && night <= range.to);
      if (matchingRange) {
        result.push({
          night,
          title: fixed.title,
          cited: matchingRange.cited,
        });
      }
    }
  }

  // Sort by night, then title
  result.sort((a, b) => {
    if (a.night !== b.night) {
      return a.night.localeCompare(b.night);
    }
    return a.title.localeCompare(b.title);
  });

  return result;
}

export async function retireClosedNights(
  db: Db,
  args: {
    source: Source;
    closed: ReadonlyArray<{ night: string; title: string; cited: string }>;
    listedIds: readonly string[];
  },
): Promise<{ retired: number; notes: string[] }> {
  const { source, closed, listedIds } = args;

  if (closed.length === 0) {
    return { retired: 0, notes: [] };
  }

  // Step 1: collect distinct venue ids from rows of this source with the closed titles
  const closedTitles = [...new Set(closed.map((c) => c.title))];
  const closedNights = [...new Set(closed.map((c) => c.night))];

  // Guard against empty arrays for inArray
  if (closedTitles.length === 0 || closedNights.length === 0) {
    return { retired: 0, notes: [] };
  }

  // Get venue ids from events of this source with matching titles
  const venueRows = await db
    .select({
      venueId: events.venueId,
    })
    .from(events)
    .innerJoin(eventSources, eq(eventSources.eventId, events.id))
    .where(
      and(
        eq(eventSources.sourceId, source.id),
        inArray(events.title, closedTitles),
        isNotNull(events.venueId),
      ),
    )
    .groupBy(events.venueId);

  const venueIds = venueRows.map((r) => r.venueId).filter((id): id is string => id !== null);
  const listed = [...listedIds];

  // Step 2: same-source rows (any role), once each
  const sameSourceJoined = await db
    .select({
      id: events.id,
      title: events.title,
      nightDate: events.nightDate,
    })
    .from(events)
    .innerJoin(eventSources, eq(eventSources.eventId, events.id))
    .where(
      and(
        eq(events.status, "active"),
        inArray(events.nightDate, closedNights),
        eq(eventSources.sourceId, source.id),
        listed.length > 0 ? notInArray(events.id, listed) : sql`true`,
      ),
    );
  const sameSourceRows = [...new Map(sameSourceJoined.map((r) => [r.id, r])).values()];
  const sameIds = sameSourceRows.map((r) => r.id);

  // Step 3: other-source twins at those venues (none when the fixed night has no venue yet)
  const otherSourceRows =
    venueIds.length === 0
      ? []
      : await db
          .select({
            id: events.id,
            title: events.title,
            nightDate: events.nightDate,
          })
          .from(events)
          .where(
            and(
              eq(events.status, "active"),
              inArray(events.nightDate, closedNights),
              inArray(events.venueId, venueIds),
              listed.length > 0 ? notInArray(events.id, listed) : sql`true`,
              sameIds.length > 0 ? notInArray(events.id, sameIds) : sql`true`,
            ),
          );

  // Filter other-source rows by title stem similarity with any title closed that night
  const otherSourceFiltered = otherSourceRows.filter((row) =>
    closed.some(
      (c) => c.night === row.nightDate && sharedTitleStems(row.title, c.title, undefined) >= 1,
    ),
  );

  const allRows = [...sameSourceRows, ...otherSourceFiltered];
  const retiredIds = new Set<string>();

  // Step 4: retire each row
  for (const row of allRows) {
    await retireRow(db, source, row.id, listedIds);
    retiredIds.add(row.id);
  }

  // Step 5: generate note
  const retired = retiredIds.size;
  const notes: string[] = [];

  if (retired > 0) {
    const entries = allRows.map((row) => {
      const closedEntry = closed.find((c) => c.night === row.nightDate)!;
      const cited = closedEntry.cited.slice(0, 80);
      return `${row.title} on ${row.nightDate} (${cited})`;
    });

    const list = entries.slice(0, 12).join("; ");
    const more = retired > 12 ? `, and ${retired - 12} more` : "";
    notes.push(
      `${retired} listing(s) on a night the venue's own page says is closed were taken off the site: ${list}${more}`,
    );
  }

  return { retired, notes };
}
