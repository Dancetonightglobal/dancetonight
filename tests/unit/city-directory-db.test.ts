// City directory DB test: buildCityDirectory, refreshCityDirectory, listCities and metroFor from KV.

import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "vitest";

import { DbListingsRepository } from "@/src/data/db-repository";
import { CITY_DIRECTORY_KEY, decodeDirectory } from "@/src/data/city-directory";
import { setSnapshotStoreForTests } from "@/src/edge/snapshot-store";
import { events, jobRuns, metros, venues } from "@/src/db/schema";
import { closeTestDb, describeDb, requireDbInCi, resetDb, testDb } from "@/tests/unit/db-harness";

requireDbInCi();

const NY = "America/New_York";
/** Sunday 20 September 2026, 7:42pm in New York. */
const NOW = new Date("2026-09-20T23:42:00Z");
const TONIGHT = "2026-09-20";
const TOMORROW = "2026-09-21";
const PAST_NIGHT = "2026-09-19";

let db: Awaited<ReturnType<typeof testDb>>;
let nycId: string;
let phlId: string;
let adhocId: string;
const venueIds: Record<"nyc1" | "phl1", string> = {
  nyc1: "",
  phl1: "",
};

describeDb("City directory DB", () => {
  beforeAll(async () => {
    db = await testDb("city_directory");
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
        {
          slug: "adhoc-x",
          name: "Adhoc X",
          countryCode: "US",
          center: { lat: 38.9072, lng: -77.0369 },
          radiusKm: 30,
          tz: NY,
          languages: ["en"],
          adHoc: true,
        },
      ])
      .returning({ id: metros.id, slug: metros.slug });
    for (const m of insertedMetros) {
      if (m.slug === "nyc") nycId = m.id;
      if (m.slug === "phl") phlId = m.id;
      if (m.slug === "adhoc-x") adhocId = m.id;
    }

    // Insert venues
    const insertedVenues = await db
      .insert(venues)
      .values([
        { name: "nyc1", nameNormalized: "nyc1", location: { lat: 40.7128, lng: -74.006 }, tz: NY },
        { name: "phl1", nameNormalized: "phl1", location: { lat: 39.9526, lng: -75.1652 }, tz: NY },
      ])
      .returning({ id: venues.id, name: venues.name });
    for (const v of insertedVenues) {
      venueIds[v.name as keyof typeof venueIds] = v.id;
    }

    // Insert events
    await db.insert(events).values([
      {
        slug: "tonight-nyc",
        title: "tonight-nyc",
        titleNormalized: "tonight-nyc",
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
        slug: "past-phl",
        title: "past-phl",
        titleNormalized: "past-phl",
        listingType: "social",
        styles: ["salsa"],
        nightDate: PAST_NIGHT,
        tz: NY,
        confirmation: "recurring_unconfirmed",
        venueId: venueIds.phl1,
        status: "active",
        metroId: phlId,
      },
      {
        slug: "cancelled-phl",
        title: "cancelled-phl",
        titleNormalized: "cancelled-phl",
        listingType: "social",
        styles: ["salsa"],
        nightDate: TOMORROW,
        tz: NY,
        confirmation: "recurring_unconfirmed",
        venueId: venueIds.phl1,
        status: "cancelled",
        metroId: phlId,
      },
    ]);

    // Insert one job_runs row for nyc
    await db.insert(jobRuns).values({
      job: "ingest",
      metroId: nycId,
      startedAt: new Date("2026-09-20T22:00:00Z"),
      finishedAt: new Date("2026-09-20T22:30:00Z"),
      status: "succeeded",
    });
  });

  afterEach(() => {
    setSnapshotStoreForTests(undefined);
    delete (globalThis as Record<symbol, unknown>)[Symbol.for("__cloudflare-context__")];
  });

  it("1. buildCityDirectory: 3 metros ordered by name; correct lastNight values", async () => {
    const repo = new DbListingsRepository(() => db, { snapshotTtlMs: 0, snapshotNow: () => NOW });
    const dir = await repo.buildCityDirectory(NOW);

    expect(dir.v).toBe(1);
    expect(dir.metros).toHaveLength(3);
    expect(dir.metros.map((m) => m.name)).toEqual(["Adhoc X", "New York", "Philadelphia"]);

    const nyc = dir.metros.find((m) => m.slug === "nyc")!;
    const phl = dir.metros.find((m) => m.slug === "phl")!;
    const adhoc = dir.metros.find((m) => m.slug === "adhoc-x")!;

    expect(nyc.lastNight).toBe(TONIGHT);
    expect(phl.lastNight).toBe(PAST_NIGHT);
    expect(adhoc.lastNight).toBeNull();
    expect(adhoc.adHoc).toBe(true);
    expect(nyc.adHoc).toBe(false);
    expect(phl.adHoc).toBe(false);
  });

  it("2. refreshCityDirectory with empty KV -> built, key present", async () => {
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
    const result = await repo.refreshCityDirectory(NOW);
    expect(result).toBe("built");
    expect(fake.has(CITY_DIRECTORY_KEY)).toBe(true);
    const decoded = decodeDirectory(fake.get(CITY_DIRECTORY_KEY)!);
    expect(decoded).not.toBeNull();
    expect(decoded!.metros).toHaveLength(3);

    // Second call -> ok
    const result2 = await repo.refreshCityDirectory(NOW);
    expect(result2).toBe("ok");
  });

  it("3. After inserting newer job_runs row -> built again", async () => {
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
    await repo.refreshCityDirectory(NOW);
    const firstStamp = decodeDirectory(fake.get(CITY_DIRECTORY_KEY)!)!.stamp;

    // Insert newer job run
    await db.insert(jobRuns).values({
      job: "ingest",
      metroId: nycId,
      startedAt: new Date("2026-09-20T23:55:00Z"),
      finishedAt: null,
      status: "running",
    });

    const result = await repo.refreshCityDirectory(NOW);
    expect(result).toBe("built");
    const secondStamp = decodeDirectory(fake.get(CITY_DIRECTORY_KEY)!)!.stamp;
    expect(secondStamp).toBeGreaterThan(firstStamp);
  });

  it("4. Fake KV whose get throws -> failed, no throw", async () => {
    const jobs: Promise<unknown>[] = [];
    (globalThis as Record<symbol, unknown>)[Symbol.for("__cloudflare-context__")] = {
      ctx: { waitUntil: (p: Promise<unknown>) => jobs.push(p) },
    };
    setSnapshotStoreForTests({
      get: async () => {
        throw new Error("KV error");
      },
      put: async () => {},
      delete: async () => {},
    });

    const repo = new DbListingsRepository(() => db, { snapshotTtlMs: 0, snapshotNow: () => NOW });
    const result = await repo.refreshCityDirectory(NOW);
    expect(result).toBe("failed");
  });

  it("5. With directory in KV, new repo with throwing db: listCities works", async () => {
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

    // Build directory
    const repo1 = new DbListingsRepository(() => db, { snapshotTtlMs: 0, snapshotNow: () => NOW });
    await repo1.refreshCityDirectory(NOW);

    // New repo with throwing db
    const throwingDb = () => {
      throw new Error("no db");
    };
    const repo2 = new DbListingsRepository(throwingDb, {
      snapshotTtlMs: 0,
      snapshotNow: () => NOW,
    });
    const cities = await repo2.listCities(NOW);
    expect(cities).toHaveLength(2); // nyc and phl, no adhoc
    expect(cities.map((c) => c.slug)).toEqual(["nyc", "phl"]);
    const nycCity = cities.find((c) => c.slug === "nyc")!;
    const phlCity = cities.find((c) => c.slug === "phl")!;
    expect(nycCity.hasListings).toBe(true);
    expect(phlCity.hasListings).toBe(false);
  });

  it("6. Same throwing-db repo: metroFor of city centre returns nyc, non-centre rejects", async () => {
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

    // Build directory
    const repo1 = new DbListingsRepository(() => db, { snapshotTtlMs: 0, snapshotNow: () => NOW });
    await repo1.refreshCityDirectory(NOW);

    // New repo with throwing db
    const throwingDb = () => {
      throw new Error("no db");
    };
    const repo2 = new DbListingsRepository(throwingDb, {
      snapshotTtlMs: 0,
      snapshotNow: () => NOW,
    });

    // City centre
    const nycCentre = { lat: 40.7128, lng: -74.006 };
    const metro = await repo2.metroFor(nycCentre);
    expect(metro).not.toBeNull();
    expect(metro!.slug).toBe("nyc");

    // Point 5 km away (not a centre)
    const notCentre = { lat: 40.7128 + 0.045, lng: -74.006 }; // ~5 km
    await expect(repo2.metroFor(notCentre)).rejects.toThrow("no db");
  });

  it("7. No store: listCities equals database answer", async () => {
    setSnapshotStoreForTests(null);
    const repo = new DbListingsRepository(() => db, { snapshotTtlMs: 0, snapshotNow: () => NOW });
    const cities = await repo.listCities(NOW);
    expect(cities).toHaveLength(2);
    expect(cities.map((c) => c.name)).toEqual(["New York", "Philadelphia"]); // ordered by name
    const nycCity = cities.find((c) => c.name === "New York")!;
    const phlCity = cities.find((c) => c.name === "Philadelphia")!;
    expect(nycCity.hasListings).toBe(true);
    expect(phlCity.hasListings).toBe(false);
  });

  it("8. Store present but no cities/v1 key: listCities works from db, KV unchanged", async () => {
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
    const cities = await repo.listCities(NOW);
    expect(cities).toHaveLength(2);
    expect(fake.has(CITY_DIRECTORY_KEY)).toBe(false); // not written by listCities
  });
});
