/**
 * D-810: Re-apply tidyTitle to stored upcoming rows whose titles were saved before a tidy rule existed.
 * Rio's Sympla rows first stored on 10-30 keep Portuguese weekday-and-date tails that newer reads would cut.
 * This pass ensures those rows get the same tidying as fresh reads.
 */
import { sql, eq } from "drizzle-orm";

import type { Db } from "@/src/db/client";
import type { Metro } from "@/src/adapters/types";
import { events } from "@/src/db/schema";
import { tidyTitle } from "@/src/domain/title-tidy";
import { normalizeForMatch } from "@/config/styles";

export async function retidyStoredTitles(
  db: Db,
  args: { metro: Metro; nights: readonly string[] },
): Promise<{ retitled: number; notes: string[] }> {
  if (args.nights.length === 0) {
    return { retitled: 0, notes: [] };
  }

  // Select active/cancelled events for the given nights
  const rows = await db
    .select({
      id: events.id,
      title: events.title,
      night: sql<string>`${events.nightDate}::text`,
    })
    .from(events)
    .where(
      sql`${events.metroId} = ${args.metro.id}
        AND ${events.status} IN ('active', 'cancelled')
        AND ${events.nightDate} = any(${`{${args.nights.join(",")}}`}::date[])`,
    )
    .orderBy(events.nightDate, events.title, events.id);

  const changes: Array<{ id: string; oldTitle: string; newTitle: string; night: string }> = [];
  const now = new Date();

  for (const row of rows) {
    const tidied = tidyTitle(row.title, row.night);
    if (tidied === row.title) continue;
    const trimmed = tidied.trim();
    if (trimmed.length === 0) continue;

    changes.push({
      id: row.id,
      oldTitle: row.title,
      newTitle: tidied,
      night: row.night,
    });

    await db
      .update(events)
      .set({
        title: tidied,
        titleNormalized: normalizeForMatch(tidied),
        updatedAt: now,
      })
      .where(eq(events.id, row.id));
  }

  if (changes.length === 0) {
    return { retitled: 0, notes: [] };
  }

  const noteParts = changes
    .slice(0, 12)
    .map((c) => `"${c.oldTitle}" -> "${c.newTitle}" on ${c.night}`);
  let note = `${changes.length} stored title(s) re-tidied: ${noteParts.join("; ")}`;
  if (changes.length > 12) {
    note += `, and ${changes.length - 12} more`;
  }

  return { retitled: changes.length, notes: [note] };
}
