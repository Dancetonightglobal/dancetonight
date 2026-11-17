// City snapshot building and per-city change stamps.

import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";

import { DbListingsRepository } from "@/src/data/db-repository";
import { answerFromSnapshot, decodeSnapshot, encodeSnapshot } from "@/src/data/city-snapshot";
import { selectNight } from "@/src/data/listing-mapper";
import { addCalendarDays } from "@/src/domain/time";
import { events, jobRuns, metros, venues } from "@/src/db/schema";
import { closeTestDb, describeDb, requireDbInCi, resetDb, testDb } from "@/tests/unit/db-harness";

requireDbInCi();

const NY = "America/New_York";
/** Sunday 20 September 2026, 7:42pm in New York. */
const NOW = new Date("2026-09-20T23:42:00Z");
const TONIGHT = "2026-09-20";
const TOMORROW = "2026-09-21";

let db: Awaited<ReturnType<typeof testDb>>;
let repo: DbListingsRepository;
let nycId: string;
let phlId: string;
const venueIds: Record<"nyc1" | "nyc2" | "nyc3" | "phl1", string> = {
  nyc1: "",
  nyc2: "",
  nyc3: "",
  phl1: "",
};

describeDb("City snapshot building", () => {
  beforeAll(async () => {
    db = await testDb("city_snapshot");
    repo = new DbListingsRepository(() => db);
  });
  afterAll(closeTestDb);

  beforeEach(async () => {
    await resetDb();

    // Insert metros
    const insertedMetros = await db
      .insert(metros)
      .values([
        {
          slug: "nyc",
          name: "New York",
          countryCode: "US",
          center: { lat: 40.7128, lng: -74.006 },
          radiusKm: 50,
          tz: NY,
          languages: ["en"],
          adHoc: false,
        },
        {
          slug: "phl",
          name: "Philadelphia",
          countryCode: "US",
          center: { lat: 39.9526, lng: -75.1652 },
          radiusKm: 40,
          tz: NY,
          languages: ["en"],
          adHoc: false,
        },
      ])
      .returning({ id: metros.id, slug: metros.slug });
    for (const m of insertedMetros) {
      if (m.slug === "nyc") nycId = m.id;
      if (m.slug === "phl") phlId = m.id;
    }

    // Insert venues
    const insertedVenues = await db
      .insert(venues)
      .values([
        { name: "nyc1", nameNormalized: "nyc1", location: { lat: 40.7128, lng: -74.006 }, tz: NY },
        { name: "nyc2", nameNormalized: "nyc2", location: { lat: 40.72, lng: -74.01 }, tz: NY },
        { name: "nyc3", nameNormalized: "nyc3", location: { lat: 40.7, lng: -74.02 }, tz: NY },
        { name: "phl1", nameNormalized: "phl1", location: { lat: 39.9526, lng: -75.1652 }, tz: NY },
      ])
      .returning({ id: venues.id, name: venues.name });
    for (const v of insertedVenues) {
      venueIds[v.name as keyof typeof venueIds] = v.id;
    }

    // Insert events
    await db.insert(events).values([
      // NYC events
      {
        slug: "tonight-near",
        title: "tonight-near",
        titleNormalized: "tonight-near",
        listingType: "social",
        styles: ["salsa"],
        nightDate: TONIGHT,
        tz: NY,
        confirmation: "recurring_unconfirmed",
        venueId: venueIds.nyc1,
        status: "active",
        metroId: nycId,
      },
      {
        slug: "tonight-mid",
        title: "tonight-mid",
        titleNormalized: "tonight-mid",
        listingType: "social",
        styles: ["salsa"],
        nightDate: TONIGHT,
        tz: NY,
        confirmation: "recurring_unconfirmed",
        venueId: venueIds.nyc2,
        status: "active",
        metroId: nycId,
      },
      {
        slug: "tomorrow-near",
        title: "tomorrow-near",
        titleNormalized: "tomorrow-near",
        listingType: "social",
        styles: ["salsa"],
        nightDate: TOMORROW,
        tz: NY,
        confirmation: "recurring_unconfirmed",
        venueId: venueIds.nyc1,
        status: "active",
        metroId: nycId,
      },
      {
        slug: "yesterday-near",
        title: "yesterday-near",
        titleNormalized: "yesterday-near",
        listingType: "social",
        styles: ["salsa"],
        nightDate: "2026-09-19",
        tz: NY,
        confirmation: "recurring_unconfirmed",
        venueId: venueIds.nyc1,
        status: "active",
        metroId: nycId,
      },
      {
        slug: "far-future",
        title: "far-future",
        titleNormalized: "far-future",
        listingType: "social",
        styles: ["salsa"],
        nightDate: "2026-10-20",
        tz: NY,
        confirmation: "recurring_unconfirmed",
        venueId: venueIds.nyc1,
        status: "active",
        metroId: nycId,
      },
      // Unplaced NYC event
      {
        slug: "unplaced-nyc",
        title: "unplaced-nyc",
        titleNormalized: "unplaced-nyc",
        listingType: "social",
        styles: ["salsa"],
        nightDate: TONIGHT,
        tz: NY,
        confirmation: "recurring_unconfirmed",
        venueId: null,
        status: "active",
        metroId: nycId,
      },
      // PHL event
      {
        slug: "tonight-phl",
        title: "tonight-phl",
        titleNormalized: "tonight-phl",
        listingType: "social",
        styles: ["salsa"],
        nightDate: TONIGHT,
        tz: NY,
        confirmation: "recurring_unconfirmed",
        venueId: venueIds.phl1,
        status: "active",
        metroId: phlId,
      },
    ]);
  });

  it("returns null for non-existent metro", async () => {
    const result = await repo.buildCitySnapshot("nope", NOW);
    expect(result).toBeNull();
  });

  it("builds snapshot for nyc", async () => {
    const snap = await repo.buildCitySnapshot("nyc", NOW);
    expect(snap).not.toBeNull();
    expect(snap!.slug).toBe("nyc");
    expect(snap!.center).toEqual({ lat: 40.7128, lng: -74.006 });
    expect(snap!.radiusKm).toBe(50);
    expect(snap!.nights).toEqual([...snap!.nights].sort());
    expect(snap!.nights[0]).toBe("2026-09-19"); // night before tonight
    expect(snap!.nights).toContain(TONIGHT);
    expect(snap!.nights).toContain(TOMORROW);
    expect(snap!.nights).not.toContain("2026-10-20");
    // Should contain NYC events but not PHL
    const slugs = snap!.listings.map((l) => l.slug);
    expect(slugs).toContain("tonight-near");
    expect(slugs).toContain("tonight-mid");
    expect(slugs).toContain("tomorrow-near");
    expect(slugs).toContain("unplaced-nyc");
    expect(slugs).not.toContain("tonight-phl");
    expect(slugs).not.toContain("far-future");
    // Check unplacedMetroId
    expect(snap!.unplacedMetroId).toBe(nycId);
  });

  it("matches DB path for tonight and tomorrow", async () => {
    const snap = await repo.buildCitySnapshot("nyc", NOW);
    expect(snap).not.toBeNull();

    for (const nightDate of [TONIGHT, TOMORROW] as const) {
      const dbResult = await repo.listNight({
        center: { lat: 40.7128, lng: -74.006 },
        radiusKm: 50,
        nightDate,
        now: NOW,
        sort: "start",
        filters: {},
      });
      const fromSnap = answerFromSnapshot(
        snap!,
        snap!.center,
        50,
        [nightDate, addCalendarDays(nightDate, -1)],
        snap!.unplacedMetroId,
      );
      expect(fromSnap).not.toBeNull();
      const selected = selectNight(fromSnap!, {
        center: snap!.center,
        radiusKm: 50,
        nightDate,
        now: NOW,
        sort: "start",
        unplaced: snap!.unplacedMetroId !== null,
        filters: {},
      });
      expect(selected.listings).toEqual(dbResult.listings);
      expect(selected.counts).toEqual(dbResult.counts);
    }
  });

  it("survives KV round trip", async () => {
    const snap = await repo.buildCitySnapshot("nyc", NOW);
    expect(snap).not.toBeNull();
    const encoded = encodeSnapshot(snap!);
    expect(encoded).not.toBeNull();
    const decoded = decodeSnapshot(encoded!);
    expect(decoded).not.toBeNull();
    // Compare relevant fields
    expect(decoded!.slug).toBe(snap!.slug);
    expect(decoded!.center).toEqual(snap!.center);
    expect(decoded!.radiusKm).toBe(snap!.radiusKm);
    expect(decoded!.nights).toEqual(snap!.nights);
    expect(decoded!.listings.length).toBe(snap!.listings.length);
    // The decoded snapshot answers exactly like the database (Dates and nulls survive the trip).
    const fromKv = answerFromSnapshot(
      decoded!,
      decoded!.center,
      50,
      [TONIGHT, addCalendarDays(TONIGHT, -1)],
      decoded!.unplacedMetroId,
    );
    expect(fromKv).not.toBeNull();
    const query = { center: decoded!.center, radiusKm: 50, nightDate: TONIGHT, now: NOW };
    const dbResult = await repo.listNight({ ...query, sort: "start", filters: {} });
    const selected = selectNight(fromKv!, {
      ...query,
      sort: "start",
      unplaced: decoded!.unplacedMetroId !== null,
      filters: {},
    });
    expect(selected.listings.length).toBeGreaterThan(0);
    expect(selected).toEqual(dbResult);
  });

  it("computes stamps correctly", async () => {
    // Insert job runs
    await db.insert(jobRuns).values([
      {
        job: "ingest",
        metroId: nycId,
        startedAt: new Date("2026-09-20T10:00:00Z"),
        finishedAt: new Date("2026-09-20T10:30:00Z"),
        status: "succeeded",
      },
      {
        job: "ingest",
        metroId: phlId,
        startedAt: new Date("2026-09-20T12:00:00Z"),
        finishedAt: null,
        status: "running",
      },
      {
        job: "dedupe-unmerge",
        metroId: null,
        startedAt: new Date("2026-09-20T11:00:00Z"),
        finishedAt: new Date("2026-09-20T11:05:00Z"),
        status: "succeeded",
      },
    ]);

    const stamps = await repo.metroStamps();
    expect(stamps.get(nycId)).toBe(Date.parse("2026-09-20T10:30:00Z"));
    expect(stamps.get(phlId)).toBe(Date.parse("2026-09-20T12:00:00Z"));
    expect(stamps.get(null)).toBe(Date.parse("2026-09-20T11:05:00Z"));

    // Build snapshot and check stamp
    const snap = await repo.buildCitySnapshot("nyc", NOW);
    expect(snap!.stamp).toBe(Date.parse("2026-09-20T11:05:00Z")); // null-metro job beats nyc's own

    // Insert a newer nyc run
    await db.insert(jobRuns).values({
      job: "ingest",
      metroId: nycId,
      startedAt: new Date("2026-09-20T13:00:00Z"),
      finishedAt: null,
      status: "running",
    });
    const stamps2 = await repo.metroStamps();
    expect(stamps2.get(nycId)).toBe(Date.parse("2026-09-20T13:00:00Z"));
    expect(stamps2.get(phlId)).toBe(Date.parse("2026-09-20T12:00:00Z"));
    const snap2 = await repo.buildCitySnapshot("nyc", NOW);
    expect(snap2!.stamp).toBe(Date.parse("2026-09-20T13:00:00Z"));

    // Insert a newer null-metro run
    await db.insert(jobRuns).values({
      job: "global-job",
      metroId: null,
      startedAt: new Date("2026-09-20T14:00:00Z"),
      finishedAt: null,
      status: "running",
    });
    const stamps3 = await repo.metroStamps();
    expect(stamps3.get(null)).toBe(Date.parse("2026-09-20T14:00:00Z"));
    const snap3 = await repo.buildCitySnapshot("nyc", NOW);
    expect(snap3!.stamp).toBe(Date.parse("2026-09-20T14:00:00Z"));
  });

  it("handles empty job_runs", async () => {
    await db.delete(jobRuns);
    const stamps = await repo.metroStamps();
    expect(stamps.size).toBe(0);
    const snap = await repo.buildCitySnapshot("nyc", NOW);
    expect(snap!.stamp).toBe(0);
  });

  it("metro with no own runs follows global max", async () => {
    // Clear and insert only phl rows
    await db.delete(jobRuns);
    await db.insert(jobRuns).values({
      job: "ingest",
      metroId: phlId,
      startedAt: new Date("2026-09-20T12:00:00Z"),
      finishedAt: new Date("2026-09-20T12:20:00Z"),
      status: "succeeded",
    });
    const stamps = await repo.metroStamps();
    expect(stamps.get(phlId)).toBe(Date.parse("2026-09-20T12:20:00Z"));
    const snap = await repo.buildCitySnapshot("nyc", NOW);
    // nyc has no own entry, so should use max of all values (12:20)
    expect(snap!.stamp).toBe(Date.parse("2026-09-20T12:20:00Z"));
  });
});
