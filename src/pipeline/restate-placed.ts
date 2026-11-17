// D-221: move placed listings whose venue name holds a known venue's street phrase.
// D-761: move rows placed under a canonical known venue's other name to its first name.
// Some stored listings are already placed under a venue whose name is the source's
// directions text (e.g., "13 Minutes from Gospel Oak Station, Between 51 & 53 Croftdown Road NW5 1EL").
// A known venue (config/known-venues.ts, `KnownVenue.streets`) now covers that street, and
// `restateVenue` (src/pipeline/source-venue.ts, rule 4) turns such a name into the entry's name and address.
// This function moves those rows to the known venue, leaving the old venue row intact.
import type { Db } from "@/src/db/client";
import type { Metro, Source } from "@/src/adapters/types";
import { checksApiPoint, type VenueInput, type ResolvedVenue } from "@/src/pipeline/store";
import { events, eventSources, sources, venues, fieldProvenance } from "@/src/db/schema";
import { and, eq, sql, type SQL } from "drizzle-orm";

export async function restatePlacedStreetNamed(
  db: Db,
  args: {
    metro: Metro;
    nights: readonly string[];
    /** Every street phrase of the metro's known venues (KnownVenue.streets, flattened). */
    streets: readonly string[];
    /** Other names of canonical known venues (slice(1) of their names). */
    names?: readonly string[];
    placeVenue: (input: VenueInput, apiPoint?: boolean) => Promise<ResolvedVenue | null>;
    restate: (row: {
      sourceUrl: string;
      sourceHasVenue: boolean;
      name: string | null;
      address: string | null;
    }) => { name: string | null; address: string | null };
  },
): Promise<{ moved: number; notes: string[] }> {
  const { metro, nights, streets, names, placeVenue, restate } = args;
  if (nights.length === 0 || (streets.length === 0 && (names?.length ?? 0) === 0)) {
    return { moved: 0, notes: [] };
  }

  // A street phrase anywhere in the venue's name, or exactly one of the other names (trimmed, any case).
  const conditions: SQL[] = [];

  // Street condition: ILIKE any pattern
  if (streets.length > 0) {
    const patterns = sql.join(
      streets.map((street) => sql`${`%${street}%`}`),
      sql`, `,
    );
    conditions.push(sql`v.name ilike any(array[${patterns}]::text[])`);
  }

  // Exact name condition: lower(btrim(v.name)) = any(array[...])
  if (names && names.length > 0) {
    const trimmedNames = names.map((name) => name.trim().toLowerCase());
    const namePlaceholders = sql.join(
      trimmedNames.map((name) => sql`${name}`),
      sql`, `,
    );
    conditions.push(sql`lower(btrim(v.name)) = any(array[${namePlaceholders}]::text[])`);
  }

  const whereClause = sql`(${sql.join(conditions, sql` or `)})`;

  const rows = await db.execute<{
    id: string;
    title: string;
    night: string;
    kind: Source["kind"];
    venue_id: string;
    lat: number | null;
    lng: number | null;
    venue_name: string | null;
    venue_address: string | null;
    source_url: string;
    source_has_venue: boolean;
    venue_row_name: string;
  }>(sql`
    select e.id, e.venue_id, e.title, e.night_date::text as night, s.kind,
      ST_Y(e.geo::geometry) as lat, ST_X(e.geo::geometry) as lng,
      (select fp.value #>> '{}' from ${fieldProvenance} fp
        where fp.entity_type = 'event' and fp.entity_id = e.id and fp.field = 'venue_name'
          and fp.is_current and fp.source_id = es.source_id limit 1) as venue_name,
      (select fp.value #>> '{}' from ${fieldProvenance} fp
        where fp.entity_type = 'event' and fp.entity_id = e.id and fp.field = 'venue_address'
          and fp.is_current and fp.source_id = es.source_id limit 1) as venue_address,
      s.url as source_url,
      (s.venue_id is not null) as source_has_venue,
      v.name as venue_row_name
    from ${events} e
    join ${eventSources} es on es.event_id = e.id and es.role = 'primary'
    join ${sources} s on s.id = es.source_id
    join ${venues} v on v.id = e.venue_id
    where e.metro_id = ${metro.id} and e.venue_id is not null
      and e.status in ('active', 'cancelled')
      and e.night_date = any(${`{${nights.join(",")}}`}::date[])
      and ${whereClause}
    order by e.night_date, e.title, e.id
  `);

  const moved: string[] = [];
  for (const row of rows) {
    const stated = restate({
      sourceUrl: row.source_url,
      sourceHasVenue: row.source_has_venue === true,
      name: row.venue_name ?? row.venue_row_name,
      address: row.venue_address,
    });
    // Skip if restate didn't produce a valid name/address
    if (!stated.name?.trim() || !stated.address?.trim()) continue;
    // Skip if restate changed nothing (name unchanged)
    if (stated.name === row.venue_row_name) continue;

    const location =
      row.lat !== null && row.lng !== null ? { lat: Number(row.lat), lng: Number(row.lng) } : null;
    const venue = await placeVenue(
      {
        name: stated.name,
        address: stated.address,
        url: null,
        location,
      },
      checksApiPoint({ kind: row.kind }),
    );
    if (!venue || venue.venueId === row.venue_id) continue;

    const updated = await db
      .update(events)
      .set({
        venueId: venue.venueId,
        geo: venue.location,
        updatedAt: new Date(),
      })
      .where(and(eq(events.id, row.id), eq(events.venueId, row.venue_id)))
      .returning({ id: events.id });
    if (updated.length > 0) moved.push(`${row.title} on ${row.night}`);
  }

  const notes =
    moved.length > 0
      ? [
          `${moved.length} placed listing(s) named by a known venue's street or other name were moved to that venue: ${moved.slice(0, 12).join("; ")}${moved.length > 12 ? `, and ${moved.length - 12} more` : ""}`,
        ]
      : [];
  return { moved: moved.length, notes };
}
