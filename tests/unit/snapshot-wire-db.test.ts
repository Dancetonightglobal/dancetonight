// Snapshot reader wired into DbListingsRepository (DB test).

import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "vitest";

import { DbListingsRepository } from "@/src/data/db-repository";
import { setSnapshotStoreForTests } from "@/src/edge/snapshot-store";
import { events, jobRuns, metros, venues } from "@/src/db/schema";
import { closeTestDb, describeDb, requireDbInCi, resetDb, testDb } from "@/tests/unit/db-harness";

requireDbInCi();

const NY = "America/New_York";
/** Sunday 20 September 2026, 7:42pm in New York. */
const NOW = new Date("2026-09-20T23:42:00Z");
const TONIGHT = "2026-09-20";
const TOMORROW = "2026-09-21";

let db: Awaited<ReturnType<typeof testDb>>;
let nycId: string;
let phlId: string;
const venueIds: Record<"nyc1" | "nyc2", string> = {
  nyc1: "",
  nyc2: "",
};

describeDb("Snapshot reader wired into repository", () => {
  beforeAll(async () => {
    db = await testDb("snapshot_wire");
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
      ])
      .returning({ id: venues.id, name: venues.name });
    for (const v of insertedVenues) {
      venueIds[v.name as keyof typeof venueIds] = v.id;
    }

    // Insert events
    await db.insert(events).values([
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
        slug: "tomorrow-near",
        title: "tomorrow-near",
        titleNormalized: "tomorrow-near",
        listingType: "social",
        styles: ["salsa"],
        nightDate: TOMORROW,
        tz: NY,
        confirmation: "recurring_unconfirmed",
        venueId: venueIds.nyc2,
        status: "active",
        metroId: nycId,
      },
    ]);
  });

  afterEach(() => {
    setSnapshotStoreForTests(undefined);
    delete (globalThis as Record<symbol, unknown>)[Symbol.for("__cloudflare-context__")];
  });

  it("empty KV: city query answers from database and builds snapshot", async () => {
    const fake = new Map<string, string>();
    const jobs: Promise<unknown>[] = [];
    (globalThis as Record<symbol, unknown>)[Symbol.for("__cloudflare-context__")] = {
      ctx: { waitUntil: (p: Promise<unknown>) => jobs.push(p) },
    };
    setSnapshotStoreForTests({
      get: async (key) => fake.get(key) ?? null,
      put: async (key, value) => {
        fake.set(key, value);
      },
      delete: async (key) => {
        fake.delete(key);
      },
    });

    const repo = new DbListingsRepository(() => db, { snapshotTtlMs: 0, snapshotNow: () => NOW });
    const query = {
      center: { lat: 40.7128, lng: -74.006 },
      radiusKm: 50,
      nightDate: TONIGHT,
      now: NOW,
      sort: "start" as const,
      filters: {},
    };
    const result = await repo.listNight(query);
    expect(result.listings).toHaveLength(1);
    expect(result.listings[0]?.slug).toBe("tonight-near");

    // Wait for background rebuilds
    await Promise.all(jobs);
    expect(fake.has("city/nyc")).toBe(true);
    expect(fake.has("lock/nyc")).toBe(true);
  });

  it("snapshot answers after build, even when database is empty", async () => {
    // Build snapshot
    const fake = new Map<string, string>();
    const jobs: Promise<unknown>[] = [];
    (globalThis as Record<symbol, unknown>)[Symbol.for("__cloudflare-context__")] = {
      ctx: { waitUntil: (p: Promise<unknown>) => jobs.push(p) },
    };
    setSnapshotStoreForTests({
      get: async (key) => fake.get(key) ?? null,
      put: async (key, value) => {
        fake.set(key, value);
      },
      delete: async (key) => {
        fake.delete(key);
      },
    });

    const repo1 = new DbListingsRepository(() => db, { snapshotTtlMs: 0, snapshotNow: () => NOW });
    const query = {
      center: { lat: 40.7128, lng: -74.006 },
      radiusKm: 50,
      nightDate: TONIGHT,
      now: NOW,
      sort: "start" as const,
      filters: {},
    };
    const nightResult = await repo1.listNight(query);
    const dayCounts = await repo1.dayCounts(query.center, 50, NOW);
    const nightWithDays = await repo1.nightWithDays(query);
    await Promise.all(jobs);

    // Record values
    const recordedListings = nightResult.listings;
    const recordedDayCounts = dayCounts;
    const recordedNightWithDays = nightWithDays;

    // Delete all events
    await db.delete(events);

    // New repository, same fake KV
    const repo2 = new DbListingsRepository(() => db, { snapshotTtlMs: 0, snapshotNow: () => NOW });
    const nightResult2 = await repo2.listNight(query);
    const dayCounts2 = await repo2.dayCounts(query.center, 50, NOW);
    const nightWithDays2 = await repo2.nightWithDays(query);

    expect(nightResult2.listings).toEqual(recordedListings);
    expect(dayCounts2).toEqual(recordedDayCounts);
    expect(nightWithDays2).toEqual(recordedNightWithDays);
  });

  it("searched place (different center/radius) returns no listings (database)", async () => {
    const fake = new Map<string, string>();
    const jobs: Promise<unknown>[] = [];
    (globalThis as Record<symbol, unknown>)[Symbol.for("__cloudflare-context__")] = {
      ctx: { waitUntil: (p: Promise<unknown>) => jobs.push(p) },
    };
    setSnapshotStoreForTests({
      get: async (key) => fake.get(key) ?? null,
      put: async (key, value) => {
        fake.set(key, value);
      },
      delete: async (key) => {
        fake.delete(key);
      },
    });
    const opts = { snapshotTtlMs: 0, snapshotNow: () => NOW };
    const city = { center: { lat: 40.7128, lng: -74.006 }, radiusKm: 50 };
    const base = { nightDate: TONIGHT, now: NOW, sort: "start" as const, filters: {} };
    await new DbListingsRepository(() => db, opts).listNight({ ...city, ...base });
    await Promise.all(jobs);
    expect(fake.has("city/nyc")).toBe(true);
    await db.delete(events);

    const repo = new DbListingsRepository(() => db, opts);
    const searched = await repo.listNight({
      center: { lat: 40.73, lng: -73.99 },
      radiusKm: 10,
      ...base,
    });
    expect(searched.listings).toHaveLength(0);
    // The city's own query still answers from its snapshot.
    expect((await repo.listNight({ ...city, ...base })).listings).toHaveLength(1);
  });
  it("no store (null) falls back to database", async () => {
    // Build snapshot first
    const fake = new Map<string, string>();
    const jobs: Promise<unknown>[] = [];
    (globalThis as Record<symbol, unknown>)[Symbol.for("__cloudflare-context__")] = {
      ctx: { waitUntil: (p: Promise<unknown>) => jobs.push(p) },
    };
    setSnapshotStoreForTests({
      get: async (key) => fake.get(key) ?? null,
      put: async (key, value) => {
        fake.set(key, value);
      },
      delete: async (key) => {
        fake.delete(key);
      },
    });

    const repo1 = new DbListingsRepository(() => db, { snapshotTtlMs: 0, snapshotNow: () => NOW });
    const query = {
      center: { lat: 40.7128, lng: -74.006 },
      radiusKm: 50,
      nightDate: TONIGHT,
      now: NOW,
      sort: "start" as const,
      filters: {},
    };
    await repo1.listNight(query);
    await Promise.all(jobs);

    // Delete events
    await db.delete(events);

    // Set store to null
    setSnapshotStoreForTests(null);
    const repo2 = new DbListingsRepository(() => db, { snapshotTtlMs: 0, snapshotNow: () => NOW });
    const result = await repo2.listNight(query);
    expect(result.listings).toHaveLength(0);
  });

  it("stale snapshot serves old while rebuilding", async () => {
    const fake = new Map<string, string>();
    const jobs: Promise<unknown>[] = [];
    (globalThis as Record<symbol, unknown>)[Symbol.for("__cloudflare-context__")] = {
      ctx: { waitUntil: (p: Promise<unknown>) => jobs.push(p) },
    };
    setSnapshotStoreForTests({
      get: async (key) => fake.get(key) ?? null,
      put: async (key, value) => {
        fake.set(key, value);
      },
      delete: async (key) => {
        fake.delete(key);
      },
    });

    // Build initial snapshot
    const repo1 = new DbListingsRepository(() => db, { snapshotTtlMs: 0, snapshotNow: () => NOW });
    const query = {
      center: { lat: 40.7128, lng: -74.006 },
      radiusKm: 50,
      nightDate: TONIGHT,
      now: NOW,
      sort: "start" as const,
      filters: {},
    };
    const oldResult = await repo1.listNight(query);
    expect(oldResult.listings).toHaveLength(1);
    await Promise.all(jobs);

    // The fake KV never expires the first build's lock (real KV drops it after 120 s).
    fake.delete("lock/nyc");

    // Insert a newer job run for nyc (started after snapshot's stamp)
    await db.insert(jobRuns).values({
      job: "ingest",
      metroId: nycId,
      startedAt: new Date("2026-09-20T23:50:00Z"), // after NOW
      finishedAt: null,
      status: "running",
    });
    // Insert a new event tonight
    await db.insert(events).values({
      slug: "new-tonight",
      title: "new-tonight",
      titleNormalized: "new-tonight",
      listingType: "social",
      styles: ["salsa"],
      nightDate: TONIGHT,
      tz: NY,
      confirmation: "recurring_unconfirmed",
      venueId: venueIds.nyc1,
      status: "active",
      metroId: nycId,
    });

    // New repository: first query returns old list (served while rebuilding)
    const repo2 = new DbListingsRepository(() => db, { snapshotTtlMs: 0, snapshotNow: () => NOW });
    const result1 = await repo2.listNight(query);
    expect(result1.listings).toEqual(oldResult.listings);

    // Wait for background rebuild
    await Promise.all(jobs);

    // Another new repository should see the new event
    const repo3 = new DbListingsRepository(() => db, { snapshotTtlMs: 0, snapshotNow: () => NOW });
    const result2 = await repo3.listNight(query);
    expect(result2.listings).toHaveLength(2);
    const slugs = result2.listings.map((l) => l.slug);
    expect(slugs).toContain("tonight-near");
    expect(slugs).toContain("new-tonight");
  });

  it("job run in another metro does not schedule rebuild", async () => {
    const fake = new Map<string, string>();
    const jobs: Promise<unknown>[] = [];
    (globalThis as Record<symbol, unknown>)[Symbol.for("__cloudflare-context__")] = {
      ctx: { waitUntil: (p: Promise<unknown>) => jobs.push(p) },
    };
    setSnapshotStoreForTests({
      get: async (key) => fake.get(key) ?? null,
      put: async (key, value) => {
        fake.set(key, value);
      },
      delete: async (key) => {
        fake.delete(key);
      },
    });

    // nyc has a run of its own; a city with none follows the global stamp (moved by any city).
    await db.insert(jobRuns).values({
      job: "ingest",
      metroId: nycId,
      startedAt: new Date("2026-09-20T22:00:00Z"),
      finishedAt: new Date("2026-09-20T22:30:00Z"),
      status: "succeeded",
    });

    // Build snapshot for nyc
    const repo1 = new DbListingsRepository(() => db, { snapshotTtlMs: 0, snapshotNow: () => NOW });
    const query = {
      center: { lat: 40.7128, lng: -74.006 },
      radiusKm: 50,
      nightDate: TONIGHT,
      now: NOW,
      sort: "start" as const,
      filters: {},
    };
    await repo1.listNight(query);
    await Promise.all(jobs);

    // Insert a newer job run for phl
    await db.insert(jobRuns).values({
      job: "ingest",
      metroId: phlId,
      startedAt: new Date("2026-09-20T23:55:00Z"),
      finishedAt: null,
      status: "running",
    });

    // Clear jobs array
    jobs.length = 0;

    // New repository: city query should not schedule rebuild (jobs stays empty)
    const repo2 = new DbListingsRepository(() => db, { snapshotTtlMs: 0, snapshotNow: () => NOW });
    await repo2.listNight(query);
    expect(jobs).toHaveLength(0);
  });
});
