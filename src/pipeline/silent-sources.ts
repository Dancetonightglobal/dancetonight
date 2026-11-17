// Seeded sources that read fine but list nothing for weeks (D-559 fix 2): named in the run's report,
// so the owner sees them. Nothing is disabled, retired or hidden; the report only says they are silent.

import { sql } from "drizzle-orm";
import type { Db } from "@/src/db/client";
import { sources, events, eventSources } from "@/src/db/schema";
import { addCalendarDays } from "@/src/domain/time";
import { reportInstant } from "@/src/pipeline/health";

export interface SilentSource {
  url: string;
  /** health.lastSuccessAt, ISO. */
  lastSuccessAt: string;
  /** The newest event_sources.last_seen_at of any row it ever wrote (any night, any status); null = never. */
  lastRowSeenAt: string | null;
}

/** How many nights, tonight on, a source must list nothing on to be named. */
export const SILENT_NIGHTS = 7;

/**
 * Returns seeded, enabled sources of the metro whose last read succeeded but which have no listed row
 * on any of the next SILENT_NIGHTS nights. Report only: nothing is disabled, retired or hidden.
 */
export async function silentSources(
  db: Db,
  metroId: string,
  tonight: string, // ISO date
): Promise<SilentSource[]> {
  const lastNight = addCalendarDays(tonight, SILENT_NIGHTS - 1);
  const rows = await db
    .select({
      url: sources.url,
      lastSuccessAt: sql<string>`${sources.health}->>'lastSuccessAt'`,
      lastRowSeenAt: sql<
        string | null
      >`(select max(es.last_seen_at) from ${eventSources} es where es.source_id = ${sources}.id)`,
    })
    .from(sources)
    .where(
      sql`
        ${sources.metroId} = ${metroId}
        and ${sources.enabled} = true
        and (${sources.discoveredBy} is distinct from 'venue_websites')
        and (${sources.health}->>'lastSuccessAt') is not null
        and coalesce((${sources.health}->>'consecutiveFailures')::int, 0) = 0
        and not exists (
          select 1
          from ${eventSources} es
          join ${events} e on e.id = es.event_id
          where es.source_id = ${sources.id}
            and e.status in ('active', 'cancelled')
            and e.night_date between ${tonight}::date and ${lastNight}::date
        )
      `,
    )
    .orderBy(sources.url);

  return rows.map((r) => ({
    url: r.url,
    lastSuccessAt: r.lastSuccessAt,
    lastRowSeenAt: r.lastRowSeenAt ? new Date(r.lastRowSeenAt).toISOString() : null,
  }));
}

export function silentSourceNote(s: SilentSource): string {
  const lastSuccess = reportInstant(s.lastSuccessAt);
  if (s.lastRowSeenAt) {
    const lastSeen = reportInstant(s.lastRowSeenAt);
    return `read fine (last ${lastSuccess}) but lists nothing on the next ${SILENT_NIGHTS} nights; its last row was seen ${lastSeen}.`;
  }
  return `read fine (last ${lastSuccess}) but lists nothing on the next ${SILENT_NIGHTS} nights; it has written no row in the last 30 days (older nights are archived).`;
}
