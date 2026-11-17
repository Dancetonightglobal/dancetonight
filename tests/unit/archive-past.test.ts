// Maintenance M1 (the owner 2026-11-16 'A', 1a, 2a): nights more than 30 days past (each city's own tonight) are written
// to one Google spreadsheet, a tab per month ("2026-10", with user reports on them in "reports 2026-10"), then
// deleted with their provenance; each deleted slug goes to archived_events so its address says the night passed.
// Nothing is deleted unless the sheet write succeeded; a dry run only counts. Re-runs never write a row twice.

import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { Db } from "@/src/db/client";
import { archivedEvents, events, fieldProvenance, metros, reports, venues } from "@/src/db/schema";
import {
  ARCHIVE_KEEP_DAYS,
  EVENT_HEADER,
  REPORT_HEADER,
  eventRow,
  monthTab,
  reportsTab,
  runArchive,
  selectPast,
} from "@/src/pipeline/archive-past";
import type { SheetsClient } from "@/src/pipeline/google-sheets";
import { closeTestDb, describeDb, requireDbInCi, resetDb, testDb } from "@/tests/unit/db-harness";

requireDbInCi();

const NOW = new Date("2026-11-16T16:00:00Z"); // tonight in New York is 2026-11-16; cutoff: nights before 2026-10-17
const NY = "America/New_York";

class FakeSheets implements SheetsClient {
  data = new Map<string, string[][]>();
  calls: string[] = [];
  failAppend = false;
  async tabs() {
    this.calls.push("tabs");
    return [...this.data.keys()];
  }
  async addTab(title: string) {
    this.calls.push(`addTab ${title}`);
    this.data.set(title, []);
  }
  async readColumn(tab: string, column: string) {
    this.calls.push(`read ${tab} ${column}`);
    return (this.data.get(tab) ?? []).map((r) => r[0] ?? "");
  }
  async append(tab: string, rows: string[][]) {
    this.calls.push(`append ${tab} ${rows.length}`);
    if (this.failAppend) throw new Error("Google Sheets append failed: 500");
    this.data.set(tab, [...(this.data.get(tab) ?? []), ...rows]);
  }
}

describe("archive tabs", () => {
  it("keeps 30 days and names a tab per month", () => {
    expect(ARCHIVE_KEEP_DAYS).toBe(30);
    expect(monthTab("2026-10-06")).toBe("2026-10");
    expect(reportsTab("2026-10-06")).toBe("reports 2026-10");
    expect(EVENT_HEADER[0]).toBe("event_id");
    expect(REPORT_HEADER[0]).toBe("report_id");
  });
});

let db: Db;
let metroId: string;
let venueId: string;

describeDb("runArchive", () => {
  beforeAll(async () => {
    db = await testDb("archive_past");
  });
  afterAll(closeTestDb);

  beforeEach(async () => {
    await resetDb();
    const [m] = await db
      .insert(metros)
      .values({
        slug: "nyc",
        name: "New York",
        countryCode: "US",
        center: { lat: 40.7128, lng: -74.006 },
        radiusKm: 50,
        tz: NY,
        languages: ["en"],
      })
      .returning({ id: metros.id });
    metroId = m!.id;
    const [v] = await db
      .insert(venues)
      .values({
        name: "Lincoln Center Plaza",
        nameNormalized: "lincoln center plaza",
        location: { lat: 40.7725, lng: -73.9835 },
        address: { formatted: "10 Lincoln Center Plaza, New York, NY 10023" } as never,
        tz: NY,
      })
      .returning({ id: venues.id });
    venueId = v!.id;
  });

  async function event(
    slug: string,
    nightDate: string,
    fields: Partial<typeof events.$inferInsert> = {},
  ) {
    const [r] = await db
      .insert(events)
      .values({
        slug,
        title: slug.replace(/-/g, " "),
        titleNormalized: slug,
        listingType: "social",
        styles: ["salsa", "bachata"],
        nightDate,
        tz: NY,
        confirmation: "recurring_unconfirmed",
        metroId,
        ...fields,
      })
      .returning({ id: events.id });
    return r!.id;
  }

  async function provenance(entityId: string) {
    await db.insert(fieldProvenance).values({
      entityType: "event",
      entityId,
      field: "title",
      value: "x",
      sourceUrl: "https://salsa.example/",
      fetchedAt: NOW,
      method: "feed",
    } as never);
  }

  async function seed() {
    const old = await event("salsa-under-the-stars", "2026-10-06", {
      venueId,
      dancingAt: new Date("2026-10-07T01:00:00Z"),
      endsAt: new Date("2026-10-07T04:30:00Z"),
      canonicalUrl: "https://salsa.example/stars",
      ticketUrl: "https://tix.example/stars",
    });
    const merged = await event("salsa-stars-copy", "2026-10-06", {
      status: "merged",
      mergedIntoId: old,
    });
    const cancelled = await event("tango-called-off", "2026-10-16", {
      status: "cancelled",
      confirmation: "cancelled",
    });
    const boundary = await event("swing-on-the-cutoff", "2026-10-17");
    const recent = await event("bachata-last-week", "2026-11-06");
    for (const id of [old, merged, cancelled, boundary, recent]) await provenance(id);
    await db.insert(reports).values({
      eventId: old,
      kind: "problem",
      message: "Moved indoors",
      contact: "someone@example.com",
      ipHash: "abc",
    } as never);
    return { old, merged, cancelled, boundary, recent };
  }

  it("selects every status before each city's cutoff, oldest first, and nothing on or after it", async () => {
    const ids = await seed();
    const past = await selectPast(db, NOW, 100);
    expect(past.map((p) => p.id).sort()).toEqual([ids.old, ids.merged, ids.cancelled].sort());
    expect(past[past.length - 1]!.nightDate).toBe("2026-10-16");
    const stars = past.find((p) => p.id === ids.old)!;
    expect(stars).toMatchObject({
      slug: "salsa-under-the-stars",
      metroSlug: "nyc",
      venueName: "Lincoln Center Plaza",
      venueAddress: "10 Lincoln Center Plaza, New York, NY 10023",
      status: "active",
    });
  });

  it("writes one row per event with local times in the event's zone", async () => {
    const ids = await seed();
    const stars = (await selectPast(db, NOW, 100)).find((p) => p.id === ids.old)!;
    expect(eventRow(stars)).toEqual([
      ids.old,
      "2026-10-06",
      "nyc",
      "salsa under the stars",
      "Lincoln Center Plaza",
      "10 Lincoln Center Plaza, New York, NY 10023",
      "2026-10-06 21:00",
      "2026-10-07 00:30",
      "salsa, bachata",
      "social",
      "https://salsa.example/stars",
      "https://tix.example/stars",
      "active",
    ]);
  });

  it("archives to the month tabs, then deletes the rows and their provenance, keeping their addresses", async () => {
    const ids = await seed();
    const sheets = new FakeSheets();
    const result = await runArchive({ db, sheets, now: NOW, dryRun: false });
    expect(result).toMatchObject({ dryRun: false, events: 3, reports: 1, months: ["2026-10"] });

    const tab = sheets.data.get("2026-10")!;
    expect(tab[0]).toEqual([...EVENT_HEADER]);
    expect(
      tab
        .slice(1)
        .map((r) => r[0])
        .sort(),
    ).toEqual([ids.old, ids.merged, ids.cancelled].sort());
    const reportTab = sheets.data.get("reports 2026-10")!;
    expect(reportTab[0]).toEqual([...REPORT_HEADER]);
    expect(reportTab).toHaveLength(2);
    expect(reportTab[1]![1]).toBe(ids.old);
    expect(reportTab[1]!.join(" ")).toContain("Moved indoors");
    // No contact details or IP hashes leave the database.
    expect(reportTab[1]!.join(" ")).not.toContain("someone@example.com");
    expect(reportTab[1]!.join(" ")).not.toContain("abc");

    const left = await db.select({ id: events.id }).from(events);
    expect(left.map((r) => r.id).sort()).toEqual([ids.boundary, ids.recent].sort());
    const prov = await db.select({ id: fieldProvenance.entityId }).from(fieldProvenance);
    expect(prov.map((r) => r.id).sort()).toEqual([ids.boundary, ids.recent].sort());
    expect(await db.select().from(reports)).toHaveLength(0);

    const kept = await db.select().from(archivedEvents);
    expect(kept.map((r) => r.slug).sort()).toEqual(
      ["salsa-stars-copy", "salsa-under-the-stars", "tango-called-off"].sort(),
    );
    const stars = kept.find((r) => r.slug === "salsa-under-the-stars")!;
    expect(stars).toMatchObject({
      eventId: ids.old,
      title: "salsa under the stars",
      nightDate: "2026-10-06",
      metroSlug: "nyc",
      venueName: "Lincoln Center Plaza",
    });
  });

  it("never writes a row twice when a run is repeated after a failed delete", async () => {
    const ids = await seed();
    const sheets = new FakeSheets();
    // An earlier run wrote the sheet but died before deleting.
    sheets.data.set("2026-10", [[...EVENT_HEADER], [ids.old, "2026-10-06"]]);
    await runArchive({ db, sheets, now: NOW, dryRun: false });
    const firstColumn = sheets.data.get("2026-10")!.map((r) => r[0]);
    expect(firstColumn.filter((id) => id === ids.old)).toHaveLength(1);
    expect(firstColumn.filter((id) => id === "event_id")).toHaveLength(1);
    expect(firstColumn).toHaveLength(4);
    const again = await runArchive({ db, sheets, now: NOW, dryRun: false });
    expect(again.events).toBe(0);
  });

  it("deletes nothing when the sheet write fails", async () => {
    await seed();
    const sheets = new FakeSheets();
    sheets.failAppend = true;
    await expect(runArchive({ db, sheets, now: NOW, dryRun: false })).rejects.toThrow(
      /append failed/,
    );
    expect(await db.select().from(events)).toHaveLength(5);
    expect(await db.select().from(archivedEvents)).toHaveLength(0);
  });

  it("only counts on a dry run, with no sheet calls", async () => {
    await seed();
    const sheets = new FakeSheets();
    const result = await runArchive({ db, sheets, now: NOW, dryRun: true });
    expect(result).toMatchObject({ dryRun: true, events: 3, reports: 1, months: ["2026-10"] });
    expect(sheets.calls).toEqual([]);
    expect(await db.select().from(events)).toHaveLength(5);
    const dry = await runArchive({ db, sheets: null, now: NOW, dryRun: true });
    expect(dry.events).toBe(3);
  });

  it("works in batches", async () => {
    const ids = await seed();
    const sheets = new FakeSheets();
    const result = await runArchive({ db, sheets, now: NOW, dryRun: false, batchSize: 2 });
    expect(result.events).toBe(3);
    // Two data appends (2 rows, then 1) after the header.
    expect(
      sheets.calls.filter((c) => c === "append 2026-10 2" || c === "append 2026-10 1"),
    ).toHaveLength(3);
    expect(sheets.data.get("2026-10")).toHaveLength(4);
    const left = await db
      .select({ id: events.id })
      .from(events)
      .where(inArray(events.id, [ids.old]));
    expect(left).toHaveLength(0);
    expect(await db.select().from(events).where(eq(events.id, ids.recent))).toHaveLength(1);
  });
});
