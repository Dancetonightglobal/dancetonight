// Snapshot cron DB test: refreshCitySnapshots.

import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "vitest";

import { decodeSnapshot } from "@/src/data/city-snapshot";
import { DbListingsRepository } from "@/src/data/db-repository";
import { dayPicker } from "@/src/domain/tonight";
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

describeDb("Snapshot cron refreshCitySnapshots", () => {
  beforeAll(async () => {
    db = await testDb("snapshot_cron");
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

    // Insert one finished jobRuns row for each metro (so each has its own stamp)
    await db.insert(jobRuns).values([
      {
        job: "ingest",
        metroId: nycId,
        startedAt: new Date("2026-09-20T22:00:00Z"),
        finishedAt: new Date("2026-09-20T22:30:00Z"),
        status: "succeeded",
      },
      {
        job: "ingest",
        metroId: phlId,
        startedAt: new Date("2026-09-20T22:00:00Z"),
        finishedAt: new Date("2026-09-20T22:30:00Z"),
        status: "succeeded",
      },
    ]);
  });

  afterEach(() => {
    setSnapshotStoreForTests(undefined);
    delete (globalThis as Record<symbol, unknown>)[Symbol.for("__cloudflare-context__")];
  });

  it("1. Empty KV -> both built", async () => {
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
    const result = await repo.refreshCitySnapshots(NOW);
    expect(result).toEqual({ nyc: "built", phl: "built" });
    expect(fake.has("city/nyc")).toBe(true);
    expect(fake.has("city/phl")).toBe(true);
  });

  it("2. Immediately again (delete lock/* keys first) -> ok", async () => {
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

    // First build
    const repo1 = new DbListingsRepository(() => db, { snapshotTtlMs: 0, snapshotNow: () => NOW });
    await repo1.refreshCitySnapshots(NOW);
    // Delete lock keys
    fake.delete("lock/nyc");
    fake.delete("lock/phl");

    const repo2 = new DbListingsRepository(() => db, { snapshotTtlMs: 0, snapshotNow: () => NOW });
    const result = await repo2.refreshCitySnapshots(NOW);
    expect(result).toEqual({ nyc: "ok", phl: "ok" });
  });

  it("3. Insert newer job run for nyc -> nyc rebuilt, phl ok", async () => {
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

    // Build initial snapshots
    const repo1 = new DbListingsRepository(() => db, { snapshotTtlMs: 0, snapshotNow: () => NOW });
    await repo1.refreshCitySnapshots(NOW);
    // Delete lock keys
    fake.delete("lock/nyc");
    fake.delete("lock/phl");

    // Insert newer job run for nyc
    await db.insert(jobRuns).values({
      job: "ingest",
      metroId: nycId,
      startedAt: new Date("2026-09-20T23:55:00Z"), // after NOW
      finishedAt: null,
      status: "running",
    });

    const repo2 = new DbListingsRepository(() => db, { snapshotTtlMs: 0, snapshotNow: () => NOW });
    const result = await repo2.refreshCitySnapshots(NOW);
    expect(result).toEqual({ nyc: "built", phl: "ok" });
  });

  it("4. Day rollover -> both rebuilt", async () => {
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

    // Build initial snapshots
    const repo1 = new DbListingsRepository(() => db, { snapshotTtlMs: 0, snapshotNow: () => NOW });
    await repo1.refreshCitySnapshots(NOW);
    // Delete lock keys
    fake.delete("lock/nyc");
    fake.delete("lock/phl");

    // The picker runs through the next full weekend: Monday's window is inside Sunday's (no
    // rebuild), Saturday's reaches the weekend after, past the snapshot's last night.
    const MONDAY = new Date("2026-09-21T23:42:00Z");
    const monday = new DbListingsRepository(() => db, {
      snapshotTtlMs: 0,
      snapshotNow: () => MONDAY,
    });
    expect(await monday.refreshCitySnapshots(MONDAY)).toEqual({ nyc: "ok", phl: "ok" });
    const NEXT_DAY = new Date("2026-09-26T23:42:00Z");
    const repo2 = new DbListingsRepository(() => db, {
      snapshotTtlMs: 0,
      snapshotNow: () => NEXT_DAY,
    });
    const result = await repo2.refreshCitySnapshots(NEXT_DAY);
    expect(result).toEqual({ nyc: "built", phl: "built" });

    // nyc's new snapshot holds the new picker's last night
    const rebuilt = decodeSnapshot(fake.get("city/nyc") ?? "");
    const lastPickerNight = dayPicker(NEXT_DAY, NY).at(-1)?.nightDate;
    expect(lastPickerNight).toBeDefined();
    expect(rebuilt?.nights).toContain(lastPickerNight);
  });

  it("5. No store -> empty result", async () => {
    setSnapshotStoreForTests(null);
    const repo = new DbListingsRepository(() => db, { snapshotTtlMs: 0, snapshotNow: () => NOW });
    const result = await repo.refreshCitySnapshots(NOW);
    expect(result).toEqual({});
  });

  it("6. KV get throws for phl only -> phl error, nyc handled", async () => {
    const fake = new Map<string, string>();
    const jobs: Promise<unknown>[] = [];
    (globalThis as Record<symbol, unknown>)[Symbol.for("__cloudflare-context__")] = {
      ctx: { waitUntil: (p: Promise<unknown>) => jobs.push(p) },
    };
    setSnapshotStoreForTests({
      get: async (key) => {
        if (key === "city/phl") {
          throw new Error("KV error");
        }
        return fake.get(key) ?? null;
      },
      put: async (key, value) => {
        fake.set(key, value);
      },
      delete: async (key) => {
        fake.delete(key);
      },
    });

    // Build initial snapshot for nyc only
    const repo1 = new DbListingsRepository(() => db, { snapshotTtlMs: 0, snapshotNow: () => NOW });
    await repo1.refreshCitySnapshots(NOW);
    // Delete lock keys
    fake.delete("lock/nyc");
    fake.delete("lock/phl");

    const repo2 = new DbListingsRepository(() => db, { snapshotTtlMs: 0, snapshotNow: () => NOW });
    const result = await repo2.refreshCitySnapshots(NOW);
    expect(result).toEqual({ nyc: "ok", phl: "error" });
  });
});
