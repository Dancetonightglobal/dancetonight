/**
 * Retire a source's untimed copy of its own timed listing on one event page (D-742).
 *
 * In allevents Mumbai, "Weekend In House Pool Party, Belly Dance" (2026-11-08) was listed twice by ONE source:
 * a timed row and an untimed row with the same event page (`canonical_url`), night, normalised title and venue.
 * The event fell off the ranked pages, so no read writes either row, and D-593's twin pass (written rows only)
 * never runs. This metro-wide pass retires such untimed copies into the timed row, whether read or not.
 *
 * We exclude pairs whose shared URL is the source's own listing page (prod 2026-11-05: 56 same-source pairs
 * sharing the source's URL were different listings; only one pair on a real event page was a true twin).
 *
 * Also retire a source's untimed, unplaced line that names its own listing that night (D-744).
 * In Swing Out London's classes list, a line "King's Cross (Mixed) at The Cable Street Rag Band @ Jamboree with Dis Swing Thing"
 * (no time, no venue) appears beside the listing "The Cable Street Rag Band @ Jamboree" for the same night.
 * The untimed, unplaced line is retired into the listing whose title it contains.
 */

import { sql } from "drizzle-orm";
import type { Db } from "@/src/db/client";
import type { Metro } from "@/src/adapters/types";
import { events, eventSources, sources } from "@/src/db/schema";
import { retireInto } from "@/src/pipeline/store";

export async function retirePageTwins(
  db: Db,
  args: { metro: Metro; nights: readonly string[] },
): Promise<{ retired: number; notes: string[] }> {
  const { metro, nights } = args;

  // If no nights are provided, return early without querying
  if (nights.length === 0) {
    return { retired: 0, notes: [] };
  }

  // Query to find untimed/timed pairs matching the criteria
  const rows = await db.execute<{
    uid: string;
    tid: string;
    title: string;
    night: string;
  }>(sql`
    SELECT
      u.id AS uid,
      t.id AS tid,
      u.title,
      u.night_date::text AS night
    FROM ${events} u
    INNER JOIN ${events} t
      ON u.metro_id = t.metro_id
      AND u.night_date = t.night_date
      AND u.canonical_url = t.canonical_url
      AND u.title_normalized = t.title_normalized
      AND u.venue_id IS NOT DISTINCT FROM t.venue_id
    INNER JOIN ${eventSources} ues
      ON u.id = ues.event_id AND ues.role = 'primary'
    INNER JOIN ${eventSources} tes
      ON t.id = tes.event_id AND tes.role = 'primary'
    INNER JOIN ${sources} s
      ON ues.source_id = s.id AND tes.source_id = s.id
    WHERE u.metro_id = ${metro.id}
      AND u.night_date = any(${`{${nights.join(",")}}`}::date[])
      AND u.status = 'active'
      AND t.status = 'active'
      AND u.starts_at IS NULL
      AND t.starts_at IS NOT NULL
      AND u.canonical_url IS NOT NULL
      AND t.canonical_url IS NOT NULL
      AND s.url <> u.canonical_url
    ORDER BY u.night_date, u.title, u.id
  `);

  // Group by untimed row ID (uid) to find those with exactly one timed partner
  const pairsByUntimed = new Map<string, { tid: string; title: string; night: string }[]>();

  for (const row of rows) {
    const existing = pairsByUntimed.get(row.uid) || [];
    existing.push({ tid: row.tid, title: row.title, night: row.night });
    pairsByUntimed.set(row.uid, existing);
  }

  const notes: string[] = [];
  let retired = 0;

  // Process each untimed row that has exactly one timed partner
  for (const [uid, partners] of pairsByUntimed.entries()) {
    // Two timed partners: which session the untimed row stands for is unknown, so it stays.
    const only = partners[0];
    if (partners.length !== 1 || !only) continue;
    await retireInto(db, uid, only.tid);
    retired++;
    notes.push(
      `${only.title}: listed by this source on ${only.night} with and without a time on one event page; the untimed copy was retired`,
    );
  }

  // Second pass: D-744 - retire untimed, unplaced lines that name another listing from the same source
  const rows2 = await db.execute<{
    uid: string;
    tid: string;
    utitle: string;
    ttitle: string;
    night: string;
  }>(sql`
    SELECT
      u.id AS uid,
      t.id AS tid,
      u.title AS utitle,
      t.title AS ttitle,
      u.night_date::text AS night
    FROM ${events} u
    INNER JOIN ${events} t
      ON u.metro_id = t.metro_id
      AND u.night_date = t.night_date
      AND u.id <> t.id
    INNER JOIN ${eventSources} ues
      ON u.id = ues.event_id AND ues.role = 'primary'
    INNER JOIN ${eventSources} tes
      ON t.id = tes.event_id AND tes.role = 'primary'
    WHERE u.metro_id = ${metro.id}
      AND u.night_date = any(${`{${nights.join(",")}}`}::date[])
      AND u.status = 'active'
      AND t.status = 'active'
      AND ues.source_id = tes.source_id
      AND u.starts_at IS NULL
      AND u.venue_id IS NULL
      AND length(t.title_normalized) >= 12
      AND u.title_normalized <> t.title_normalized
      AND position(' ' || t.title_normalized || ' ' in ' ' || u.title_normalized || ' ') > 0
    ORDER BY u.night_date, u.title, u.id
  `);

  // Group by untimed row ID (uid) to find those with exactly one target partner
  const pairsByUntimed2 = new Map<
    string,
    { tid: string; utitle: string; ttitle: string; night: string }[]
  >();

  for (const row of rows2) {
    const existing = pairsByUntimed2.get(row.uid) || [];
    existing.push({ tid: row.tid, utitle: row.utitle, ttitle: row.ttitle, night: row.night });
    pairsByUntimed2.set(row.uid, existing);
  }

  // Process each untimed row that has exactly one target partner
  for (const [uid, partners] of pairsByUntimed2.entries()) {
    // Two or more target partners: which listing the untimed row stands for is unknown, so it stays.
    const only = partners[0];
    if (partners.length !== 1 || !only) continue;
    await retireInto(db, uid, only.tid);
    retired++;
    notes.push(
      `${only.utitle}: a line of this source on ${only.night} with no time or place names its listing "${only.ttitle}"; it was retired into that listing`,
    );
  }

  return { retired, notes };
}
