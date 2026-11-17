// Maintenance M1 (the owner 2026-11-16): nights more than ARCHIVE_KEEP_DAYS past each city's
// tonight are copied to one Google spreadsheet (a tab per month, user reports in "reports <month>"),
// then deleted with their field_provenance (no FK) while event_sources, merge_decisions and reports cascade;
// each slug goes to archived_events so its address says the night has passed. Sheet first, delete after;
// re-runs never duplicate.

import { sql } from "drizzle-orm";
import type { Db } from "@/src/db/client";
import type { SheetsClient } from "@/src/pipeline/google-sheets";
import { currentNightDate } from "@/src/domain/tonight";
import { addCalendarDays, localDateOf } from "@/src/domain/time";

export const ARCHIVE_KEEP_DAYS = 30;

export const EVENT_HEADER = [
  "event_id",
  "night_date",
  "city",
  "title",
  "venue",
  "address",
  "starts_local",
  "ends_local",
  "styles",
  "listing_type",
  "link",
  "ticket_url",
  "status",
] as const;

export const REPORT_HEADER = [
  "report_id",
  "event_id",
  "kind",
  "status",
  "message",
  "proposed",
  "created_at",
] as const;

export function monthTab(nightDate: string): string {
  return nightDate.slice(0, 7); // "YYYY-MM"
}

export function reportsTab(nightDate: string): string {
  return `reports ${monthTab(nightDate)}`;
}

export interface PastEvent {
  id: string;
  slug: string;
  title: string;
  nightDate: string;
  metroSlug: string;
  tz: string;
  venueName: string | null;
  venueAddress: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
  styles: string[];
  listingType: string;
  canonicalUrl: string | null;
  ticketUrl: string | null;
  status: string;
}

export async function selectPast(db: Db, now: Date, limit: number): Promise<PastEvent[]> {
  // Step 1: get distinct time zones
  const prefilter = addCalendarDays(localDateOf(now, "UTC"), -(ARCHIVE_KEEP_DAYS - 2));
  const zonesRows = await db.execute<{ tz: string }>(sql`
    SELECT DISTINCT COALESCE(m.tz, e.tz) AS tz
    FROM events e
    LEFT JOIN metros m ON m.id = e.metro_id
    WHERE e.night_date < ${prefilter}
  `);

  const zones = zonesRows.map((row) => row.tz);
  if (zones.length === 0) {
    return [];
  }

  // Step 2: compute cutoff for each zone
  const zoneCutoffs = zones.map((tz) => ({
    tz,
    cutoff: addCalendarDays(currentNightDate(now, tz), -ARCHIVE_KEEP_DAYS),
  }));

  // Build VALUES clause
  const values = sql.join(
    zoneCutoffs.map((zc) => sql`(${zc.tz}::text, ${zc.cutoff}::date)`),
    sql`, `,
  );

  const rows = await db.execute<{
    id: string;
    slug: string;
    title: string;
    night_date: string;
    metro_slug: string;
    tz: string;
    venue_name: string | null;
    venue_address: string | null;
    starts_at: Date | null;
    ends_at: Date | null;
    styles: string[];
    listing_type: string;
    canonical_url: string | null;
    ticket_url: string | null;
    status: string;
  }>(sql`
    SELECT
      e.id,
      e.slug,
      e.title,
      e.night_date::text as night_date,
      COALESCE(m.slug, '') AS metro_slug,
      COALESCE(m.tz, e.tz) AS tz,
      v.name AS venue_name,
      v.address->>'formatted' AS venue_address,
      e.starts_at,
      e.ends_at,
      e.styles,
      e.listing_type::text as listing_type,
      e.canonical_url,
      e.ticket_url,
      e.status::text as status
    FROM events e
    LEFT JOIN metros m ON m.id = e.metro_id
    LEFT JOIN venues v ON v.id = e.venue_id
    JOIN (VALUES ${values}) AS z(tz, cutoff)
      ON z.tz = COALESCE(m.tz, e.tz)
    WHERE e.night_date < z.cutoff
    ORDER BY e.night_date, e.id
    LIMIT ${limit}
  `);

  return rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    title: row.title,
    nightDate: row.night_date,
    metroSlug: row.metro_slug,
    tz: row.tz,
    venueName: row.venue_name,
    venueAddress: row.venue_address,
    startsAt: row.starts_at === null ? null : new Date(row.starts_at),
    endsAt: row.ends_at === null ? null : new Date(row.ends_at),
    styles: row.styles,
    listingType: row.listing_type,
    canonicalUrl: row.canonical_url,
    ticketUrl: row.ticket_url,
    status: row.status,
  }));
}

export function eventRow(e: PastEvent): string[] {
  function formatLocal(date: Date | null, tz: string): string {
    if (!date) return "";
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    return formatter.format(date).replace(",", "");
  }

  return [
    e.id,
    e.nightDate,
    e.metroSlug,
    e.title,
    e.venueName ?? "",
    e.venueAddress ?? "",
    formatLocal(e.startsAt, e.tz),
    formatLocal(e.endsAt, e.tz),
    e.styles.join(", "),
    e.listingType,
    e.canonicalUrl ?? "",
    e.ticketUrl ?? "",
    e.status,
  ];
}

export async function runArchive(o: {
  db: Db;
  sheets: SheetsClient | null;
  now: Date;
  dryRun: boolean;
  batchSize?: number;
  maxBatches?: number;
}): Promise<{ dryRun: boolean; events: number; reports: number; months: string[] }> {
  const batchSize = o.batchSize ?? 500;
  const maxBatches = o.maxBatches ?? 40;
  const { db, sheets, now, dryRun } = o;

  if (dryRun) {
    // Count events and reports without writing
    const allEvents = await selectPast(db, now, 1_000_000);
    const eventIds = allEvents.map((e) => e.id);

    let reportsCount = 0;
    if (eventIds.length > 0) {
      const reportsRows = await db.execute<{ count: string }>(sql`
        SELECT COUNT(*) FROM reports WHERE event_id = any(${`{${eventIds.join(",")}}`}::uuid[])
      `);
      reportsCount = parseInt(reportsRows[0]?.count ?? "0", 10);
    }

    const months = [...new Set(allEvents.map((e) => monthTab(e.nightDate)))].sort();

    return {
      dryRun: true,
      events: allEvents.length,
      reports: reportsCount,
      months,
    };
  }

  if (!sheets) {
    throw new Error("Sheets client required when not dry run");
  }
  const sheet: SheetsClient = sheets;

  let totalEvents = 0;
  let totalReports = 0;
  const monthsSeen = new Set<string>();

  // Cache for tabs and their existing IDs
  const tabCache = new Map<string, Set<string>>();
  const allTabs = await sheets.tabs();

  // Helper to ensure a tab exists and its cache is populated
  async function ensureTab(tab: string, header: readonly string[]): Promise<Set<string>> {
    const cached = tabCache.get(tab);
    if (cached !== undefined) return cached;

    if (!allTabs.includes(tab)) {
      await sheet.addTab(tab);
      allTabs.push(tab);
      // A new tab gets its header first; an existing tab already has one.
      await sheet.append(tab, [[...header]]);
      const emptySet = new Set<string>();
      tabCache.set(tab, emptySet);
      return emptySet;
    }

    // Read existing IDs
    const existing = await sheet.readColumn(tab, "A");
    const idSet = new Set(existing.slice(1)); // Skip header
    tabCache.set(tab, idSet);
    return idSet;
  }

  for (let batchNum = 0; batchNum < maxBatches; batchNum++) {
    const events = await selectPast(db, now, batchSize);
    if (events.length === 0) break;

    const eventIds = events.map((e) => e.id);
    events.forEach((e) => monthsSeen.add(monthTab(e.nightDate)));

    // Group events by month
    const eventsByMonth = new Map<string, PastEvent[]>();
    for (const event of events) {
      const month = monthTab(event.nightDate);
      if (!eventsByMonth.has(month)) {
        eventsByMonth.set(month, []);
      }
      eventsByMonth.get(month)!.push(event);
    }

    // Write events
    for (const [month, monthEvents] of eventsByMonth) {
      const tab = month;
      const existingIds = await ensureTab(tab, EVENT_HEADER);
      const rowsToAdd = monthEvents.filter((e) => !existingIds.has(e.id)).map((e) => eventRow(e));

      if (rowsToAdd.length > 0) {
        await sheet.append(tab, rowsToAdd);
        for (const e of monthEvents) existingIds.add(e.id);
      }
    }

    // Fetch reports for these events
    const reportsRows = await db.execute<{
      id: string;
      event_id: string;
      kind: string;
      status: string;
      message: string;
      proposed: string;
      created_at: Date | string;
    }>(sql`
      SELECT
        id,
        event_id,
        kind::text as kind,
        status::text as status,
        coalesce(message, '') as message,
        coalesce(proposed::text, '') as proposed,
        created_at
      FROM reports
      WHERE event_id = any(${`{${eventIds.join(",")}}`}::uuid[])
    `);

    // Never contact details or IP hashes: only these columns leave the database.
    const reports = [...reportsRows];
    totalReports += reports.length;

    // Group reports by event's month
    const reportsByMonth = new Map<string, typeof reports>();
    for (const report of reports) {
      const event = events.find((e) => e.id === report.event_id);
      if (!event) continue;
      const month = monthTab(event.nightDate);
      if (!reportsByMonth.has(month)) {
        reportsByMonth.set(month, []);
      }
      reportsByMonth.get(month)!.push(report);
    }

    // Write reports
    for (const [month, monthReports] of reportsByMonth) {
      const tab = reportsTab(month);
      const existingIds = await ensureTab(tab, REPORT_HEADER);
      const rowsToAdd = monthReports
        .filter((r) => !existingIds.has(r.id))
        .map((r): string[] => [
          r.id,
          r.event_id,
          r.kind,
          r.status,
          r.message,
          r.proposed,
          new Date(r.created_at).toISOString(),
        ]);

      if (rowsToAdd.length > 0) {
        await sheet.append(tab, rowsToAdd);
        for (const r of monthReports) existingIds.add(r.id);
      }
    }

    // Delete after successful writes
    await db.transaction(async (tx) => {
      // Insert into archived_events (multi-row)
      if (events.length > 0) {
        const values = sql.join(
          events.map(
            (e) =>
              sql`(${e.slug}, ${e.id}::uuid, ${e.title}, ${e.nightDate}::date, ${e.metroSlug}, ${e.venueName})`,
          ),
          sql`, `,
        );
        await tx.execute(sql`
          INSERT INTO archived_events (slug, event_id, title, night_date, metro_slug, venue_name)
          VALUES ${values}
          ON CONFLICT (slug) DO NOTHING
        `);
      }

      // Delete field_provenance
      if (eventIds.length > 0) {
        await tx.execute(sql`
          DELETE FROM field_provenance
          WHERE entity_type = 'event' AND entity_id = any(${`{${eventIds.join(",")}}`}::uuid[])
        `);
      }

      // Delete events
      if (eventIds.length > 0) {
        await tx.execute(sql`
          DELETE FROM events WHERE id = any(${`{${eventIds.join(",")}}`}::uuid[])
        `);
      }
    });

    totalEvents += events.length;
  }

  return {
    dryRun: false,
    events: totalEvents,
    reports: totalReports,
    months: [...monthsSeen].sort(),
  };
}
