import type { Db } from "@/src/db/client";
import type { Source } from "@/src/adapters/types";
import { events, eventSources } from "@/src/db/schema";
import { and, eq, inArray, notInArray, isNotNull, sql } from "drizzle-orm";
import { retireRow } from "@/src/pipeline/store";

/**
 * Daily site check 2026-11-10 (Buenos Aires): dancetomic's "Sepicó Social Dance" event page
 * gave 11-10 at 9pm on 11-04 and at 10pm on 11-10. The JSON-LD reader is never a whole read,
 * so retireUnlisted never runs for it and the 9pm row stayed beside the 10pm one.
 * A source's event page gives one start per session on a night: when a read lists an event page
 * on a night, this source's other rows of that same event page on that night, which this read
 * did not list, are out of date and go.
 *
 * Only rows of this source whose own event page this read listed on the same night are touched.
 * A page whose sessions the read all lists keeps them.
 */
export async function retireSamePageRows(
  db: Db,
  args: { source: Source; listedIds: readonly string[]; nights: readonly string[] },
): Promise<{ retired: number; notes: string[] }> {
  // 1. If listedIds is empty or nights is empty, return without querying
  if (args.listedIds.length === 0 || args.nights.length === 0) {
    return { retired: 0, notes: [] };
  }

  // 2. Build set of keys `${night}|${eventUrl}` from listed events
  const listedRows = await db
    .select({
      nightDate: events.nightDate,
      eventUrl: eventSources.eventUrl,
    })
    .from(events)
    .innerJoin(eventSources, eq(eventSources.eventId, events.id))
    .where(
      and(
        inArray(events.id, [...args.listedIds]),
        inArray(events.nightDate, [...args.nights]),
        eq(eventSources.sourceId, args.source.id),
        eq(eventSources.role, "primary"),
        isNotNull(eventSources.eventUrl),
      ),
    );

  const listedKeySet = new Set<string>();
  for (const row of listedRows) {
    listedKeySet.add(`${row.nightDate}|${row.eventUrl}`);
  }

  if (listedKeySet.size === 0) {
    return { retired: 0, notes: [] };
  }

  // 3. Find candidate rows to retire
  const candidateRows = await db
    .select({
      id: events.id,
      title: events.title,
      nightDate: events.nightDate,
      eventUrl: eventSources.eventUrl,
    })
    .from(events)
    .innerJoin(eventSources, eq(eventSources.eventId, events.id))
    .where(
      and(
        inArray(events.nightDate, [...args.nights]),
        inArray(events.status, ["active", "cancelled"]),
        notInArray(events.id, [...args.listedIds]),
        eq(eventSources.sourceId, args.source.id),
        eq(eventSources.role, "primary"),
        isNotNull(eventSources.eventUrl),
      ),
    )
    .orderBy(events.nightDate, events.title);

  // Deduplicate by event id and filter by listedKeySet
  const seenIds = new Set<string>();
  const toRetire: Array<{ id: string; title: string; nightDate: string }> = [];
  for (const row of candidateRows) {
    if (seenIds.has(row.id)) continue;
    const key = `${row.nightDate}|${row.eventUrl}`;
    if (listedKeySet.has(key)) {
      seenIds.add(row.id);
      toRetire.push({ id: row.id, title: row.title, nightDate: row.nightDate });
    }
  }

  // 4. Retire each row
  let retired = 0;
  for (const row of toRetire) {
    await retireRow(db, args.source, row.id, args.listedIds);
    retired++;
  }

  // 5. Generate notes if any rows were retired
  const notes: string[] = [];
  if (retired > 0) {
    const named = toRetire
      .slice(0, 12)
      .map((r) => `${r.title} on ${r.nightDate}`)
      .join("; ");
    const more = retired > 12 ? `, and ${retired - 12} more` : "";
    notes.push(
      `${retired} listing(s) whose event page this read gives at another time or title were taken off the site: ${named}${more}`,
    );
  }

  return { retired, notes };
}
