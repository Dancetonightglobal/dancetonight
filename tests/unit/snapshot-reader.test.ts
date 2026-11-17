import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SnapshotReader } from "@/src/data/snapshot-reader";
import type { SnapshotMetro, SnapshotReaderDeps } from "@/src/data/snapshot-reader";
import type { CitySnapshot } from "@/src/data/city-snapshot";
import type { Listing } from "@/src/domain/listing";
import type { NightDate } from "@/src/domain/tonight";
import type { SnapshotStore } from "@/src/edge/snapshot-store";
import type { SharedStore } from "@/src/data/shared-cache";
import { encodeShared } from "@/src/data/shared-cache";

describe("SnapshotReader", () => {
  const NYC_METRO: SnapshotMetro = {
    id: "m-nyc",
    slug: "nyc",
    center: { lat: 40.7128, lng: -74.006 },
    radiusKm: 50,
  };

  const NIGHTS: NightDate[] = [
    "2026-11-02",
    "2026-11-03",
    "2026-11-04",
    "2026-11-05",
    "2026-11-06",
    "2026-11-07",
    "2026-11-08",
    "2026-11-09",
  ];

  function createListing(slug: string, nightDate: NightDate): Listing {
    return {
      slug,
      nightDate,
    } as Listing;
  }

  function createSnapshot(stamp: number, nights: NightDate[], listings: Listing[]): CitySnapshot {
    return {
      v: 1,
      metroId: NYC_METRO.id,
      slug: NYC_METRO.slug,
      center: NYC_METRO.center,
      radiusKm: NYC_METRO.radiusKm,
      unplacedMetroId: null,
      stamp,
      builtAt: new Date(stamp),
      nights,
      listings,
    };
  }

  let kv: Map<string, string>;
  let kvGetCalls: number;
  let lockPutOptions: { expirationTtl?: number } | undefined;
  let kvShouldThrow: boolean;
  let shared: Map<string, string>;
  let sharedGetCalls: number;
  let buildDb: Listing[];
  let buildStamp: number;
  let stampsMap: Map<string | null, number>;
  let backgroundJobs: Promise<unknown>[];
  let logMessages: string[];

  function createFakeStore(): SnapshotStore {
    return {
      async get(key: string): Promise<string | null> {
        kvGetCalls++;
        if (kvShouldThrow) throw new Error("KV get error");
        return kv.get(key) ?? null;
      },
      async put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void> {
        if (key.startsWith("lock/")) lockPutOptions = options;
        if (kvShouldThrow) throw new Error("KV put error");
        kv.set(key, value);
      },
      async delete(key: string): Promise<void> {
        kv.delete(key);
      },
    };
  }

  function createFakeShared(): SharedStore {
    return {
      async get(url: string): Promise<string | null> {
        sharedGetCalls++;
        return shared.get(url) ?? null;
      },
      async put(url: string, body: string): Promise<void> {
        shared.set(url, body);
      },
    };
  }

  function createBuild(): Promise<CitySnapshot | null> {
    return Promise.resolve(
      createSnapshot(
        buildStamp,
        NIGHTS,
        buildDb.filter((l) => l.nightDate === NIGHTS[0]),
      ),
    );
  }

  function createStamps(): Promise<Map<string | null, number>> {
    return Promise.resolve(new Map(stampsMap));
  }

  let fakeNow: Date;
  function createDeps(overrides?: Partial<SnapshotReaderDeps>): SnapshotReaderDeps {
    return {
      store: createFakeStore(),
      shared: createFakeShared(),
      build: createBuild,
      stamps: createStamps,
      background: (p) => backgroundJobs.push(p),
      ttlMs: 0,
      maxBytes: 20 * 1024 * 1024,
      now: () => fakeNow,
      log: (msg) => logMessages.push(msg),
      ...overrides,
    };
  }

  beforeEach(() => {
    kv = new Map();
    kvGetCalls = 0;
    lockPutOptions = undefined;
    kvShouldThrow = false;
    shared = new Map();
    sharedGetCalls = 0;
    buildDb = [];
    buildStamp = 1000;
    stampsMap = new Map([[NYC_METRO.id, 1000]]);
    backgroundJobs = [];
    logMessages = [];
    fakeNow = new Date();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("1. Searched place (center 40.75, -73.99) -> null, and KV, shared and stamps were never called", async () => {
    const reader = new SnapshotReader(createDeps());
    const result = await reader.answer(
      NYC_METRO,
      { lat: 40.75, lng: -73.99 },
      50,
      ["2026-11-02"],
      null,
    );
    expect(result).toBeNull();
    expect(kvGetCalls).toBe(0);
    expect(sharedGetCalls).toBe(0);
  });

  it("2. Other radius (10) -> null, nothing called", async () => {
    const reader = new SnapshotReader(createDeps());
    const result = await reader.answer(NYC_METRO, NYC_METRO.center, 10, ["2026-11-02"], null);
    expect(result).toBeNull();
    expect(kvGetCalls).toBe(0);
    expect(sharedGetCalls).toBe(0);
  });

  it("3. No snapshot in KV -> null; one background job; after it, KV has city/nyc and lock/nyc", async () => {
    const deps = createDeps();
    const reader = new SnapshotReader(deps);
    const result = await reader.answer(NYC_METRO, NYC_METRO.center, 50, ["2026-11-02"], null);
    expect(result).toBeNull();
    expect(backgroundJobs).toHaveLength(1);
    await Promise.all(backgroundJobs);
    expect(kv.get("city/nyc")).toBeDefined();
    expect(kv.get("lock/nyc")).toBe("1");
    expect(lockPutOptions).toEqual({ expirationTtl: 120 });
  });

  it("4. Center given unrounded (40.712800001) is still the city's own query", async () => {
    const snapshot = createSnapshot(1000, NIGHTS, [createListing("e1", "2026-11-02")]);
    const encoded = encodeShared(snapshot);
    kv.set("city/nyc", encoded);
    const reader = new SnapshotReader(createDeps());
    const result = await reader.answer(
      NYC_METRO,
      { lat: 40.712800001, lng: -74.006 },
      50,
      ["2026-11-02"],
      null,
    );
    expect(result).toHaveLength(1);
  });

  it("5. Fresh snapshot -> returns only the requested nights' rows in order; no background job", async () => {
    const listings = [createListing("e1", "2026-11-02"), createListing("e2", "2026-11-03")];
    const snapshot = createSnapshot(1000, NIGHTS, listings);
    const encoded = encodeShared(snapshot);
    kv.set("city/nyc", encoded);
    const reader = new SnapshotReader(createDeps());
    const result = await reader.answer(NYC_METRO, NYC_METRO.center, 50, ["2026-11-02"], null);
    expect(result).toEqual([listings[0]]);
    expect(backgroundJobs).toHaveLength(0);
  });

  it("6. Stale (stamps nyc moved past snap.stamp) -> returns OLD rows now and schedules one rebuild", async () => {
    const oldListings = [createListing("old", "2026-11-02")];
    const snapshot = createSnapshot(1000, NIGHTS, oldListings);
    const encoded = encodeShared(snapshot);
    kv.set("city/nyc", encoded);
    stampsMap.set(NYC_METRO.id, 2000); // newer stamp
    const reader = new SnapshotReader(createDeps());
    const result = await reader.answer(NYC_METRO, NYC_METRO.center, 50, ["2026-11-02"], null);
    expect(result).toEqual(oldListings);
    expect(backgroundJobs).toHaveLength(1);
    // After rebuild, KV should have new snapshot
    await Promise.all(backgroundJobs);
    expect(kv.get("city/nyc")).toBeDefined();
  });

  it("7. A run in another city only (stamps { 'm-phl': huge }, nyc has its own older entry) -> no rebuild", async () => {
    const snapshot = createSnapshot(1000, NIGHTS, []);
    const encoded = encodeShared(snapshot);
    kv.set("city/nyc", encoded);
    stampsMap.clear();
    stampsMap.set("m-phl", 9999);
    stampsMap.set(NYC_METRO.id, 1000);
    const reader = new SnapshotReader(createDeps());
    const result = await reader.answer(NYC_METRO, NYC_METRO.center, 50, ["2026-11-02"], null);
    expect(result).toEqual([]);
    expect(backgroundJobs).toHaveLength(0);
  });

  it("8. A null-metro run newer than the snapshot -> rebuild", async () => {
    const snapshot = createSnapshot(1000, NIGHTS, []);
    kv.set("city/nyc", JSON.stringify(snapshot));
    stampsMap.clear();
    stampsMap.set(null, 2000);
    const reader = new SnapshotReader(createDeps());
    await reader.answer(NYC_METRO, NYC_METRO.center, 50, ["2026-11-02"], null);
    expect(backgroundJobs).toHaveLength(1);
  });

  it("9. Rollover: requested nights outside snapshot -> null and schedule rebuild", async () => {
    const snapshot = createSnapshot(1000, NIGHTS, []);
    kv.set("city/nyc", JSON.stringify(snapshot));
    const reader = new SnapshotReader(createDeps());
    const result = await reader.answer(
      NYC_METRO,
      NYC_METRO.center,
      50,
      ["2026-11-10", "2026-11-09"],
      null,
    );
    expect(result).toBeNull();
    expect(backgroundJobs).toHaveLength(1);
  });

  it("10. Two answer() calls before the background job settles -> exactly one job", async () => {
    const reader = new SnapshotReader(createDeps());
    const p1 = reader.answer(NYC_METRO, NYC_METRO.center, 50, ["2026-11-02"], null);
    const p2 = reader.answer(NYC_METRO, NYC_METRO.center, 50, ["2026-11-02"], null);
    await Promise.all([p1, p2]);
    expect(backgroundJobs).toHaveLength(1);
  });

  it("11. background: null -> stale snapshot still served, no job", async () => {
    const snapshot = createSnapshot(1000, NIGHTS, []);
    const encoded = encodeShared(snapshot);
    kv.set("city/nyc", encoded);
    stampsMap.set(NYC_METRO.id, 2000);
    const deps = createDeps({ background: null });
    const reader = new SnapshotReader(deps);
    const result = await reader.answer(NYC_METRO, NYC_METRO.center, 50, ["2026-11-02"], null);
    expect(result).toEqual([]);
    expect(backgroundJobs).toHaveLength(0);
  });

  it("12. KV get throws -> answer() resolves null (no throw)", async () => {
    kvShouldThrow = true;
    const reader = new SnapshotReader(createDeps());
    const result = await reader.answer(NYC_METRO, NYC_METRO.center, 50, ["2026-11-02"], null);
    expect(result).toBeNull();
  });

  it("13. rebuild with KV put throwing -> 'failed', old KV value unchanged", async () => {
    const oldSnapshot = createSnapshot(1000, NIGHTS, []);
    const encoded = encodeShared(oldSnapshot);
    kv.set("city/nyc", encoded);
    kvShouldThrow = true;
    const reader = new SnapshotReader(createDeps());
    const result = await reader.rebuild("nyc", NYC_METRO.id);
    expect(result).toBe("failed");
    expect(kv.get("city/nyc")).toBe(encoded);
    // The next stale answer() should schedule again only after 60s cooldown
    // Reset throw flag so KV get works
    kvShouldThrow = false;
    // Advance clock 30s -> first schedule (since snapshot is stale)
    fakeNow = new Date(fakeNow.getTime() + 30_000);
    stampsMap.set(NYC_METRO.id, 2000); // newer stamp
    const result2 = await reader.answer(NYC_METRO, NYC_METRO.center, 50, ["2026-11-02"], null);
    expect(result2).toEqual([]);
    expect(backgroundJobs).toHaveLength(1); // first schedule adds a job
    // Advance clock another 60s (total 90s) -> cooldown passed, new job
    fakeNow = new Date(fakeNow.getTime() + 60_000);
    const beforeJobs = backgroundJobs.length;
    const result3 = await reader.answer(NYC_METRO, NYC_METRO.center, 50, ["2026-11-02"], null);
    expect(result3).toEqual([]);
    expect(backgroundJobs).toHaveLength(beforeJobs + 1);
  });

  it("14. rebuild with lock present -> 'locked', build not called", async () => {
    kv.set("lock/nyc", "1");
    let buildCalled = false;
    const deps = createDeps({
      build: async () => {
        buildCalled = true;
        return null;
      },
    });
    const reader = new SnapshotReader(deps);
    const result = await reader.rebuild("nyc", NYC_METRO.id);
    expect(result).toBe("locked");
    expect(buildCalled).toBe(false);
  });

  it("15. rebuild when KV snapshot stamp >= current stamp and builtAt 10 min ago -> 'fresh'", async () => {
    const snapshot = createSnapshot(2000, NIGHTS, []);
    snapshot.builtAt = new Date(Date.now() - 10 * 60 * 1000); // 10 minutes ago
    const encoded = encodeShared(snapshot);
    kv.set("city/nyc", encoded);
    stampsMap.set(NYC_METRO.id, 2000);
    const reader = new SnapshotReader(createDeps());
    const result = await reader.rebuild("nyc", NYC_METRO.id);
    expect(result).toBe("fresh");
  });

  it("16. rebuild with maxBytes 10 -> 'too-big', old KV value unchanged, log called", async () => {
    const oldSnapshot = createSnapshot(1000, NIGHTS, []);
    const encoded = encodeShared(oldSnapshot);
    kv.set("city/nyc", encoded);
    // Make the snapshot stale so rebuild proceeds
    stampsMap.set(NYC_METRO.id, 2000);
    const deps = createDeps({ maxBytes: 10 });
    const reader = new SnapshotReader(deps);
    const result = await reader.rebuild("nyc", NYC_METRO.id);
    expect(result).toBe("too-big");
    expect(logMessages.some((m) => m.includes("nyc"))).toBe(true);
    expect(kv.get("city/nyc")).toBe(encoded);
  });

  it("17. build returns null -> 'missing'", async () => {
    const deps = createDeps({
      build: async () => null,
    });
    const reader = new SnapshotReader(deps);
    const result = await reader.rebuild("nyc", NYC_METRO.id);
    expect(result).toBe("missing");
  });

  it("18. Shared cache: with ttlMs 0 and a shared fake, the second answer() reads from shared, not KV", async () => {
    const snapshot = createSnapshot(1000, NIGHTS, []);
    const snapshotText = encodeShared(snapshot);
    shared.set("https://shared-cache.dancetonight.internal/snapshot-v1/nyc", snapshotText);
    const deps = createDeps({ ttlMs: 0 });
    const reader = new SnapshotReader(deps);
    // First answer will read from shared for snapshot and for stamps (2 gets)
    await reader.answer(NYC_METRO, NYC_METRO.center, 50, ["2026-11-02"], null);
    // Second answer will also read from shared for snapshot and stamps (another 2 gets)
    await reader.answer(NYC_METRO, NYC_METRO.center, 50, ["2026-11-02"], null);
    // With ttlMs=0, the per‑isolate cache is not used, so each answer will try shared.
    // Since shared has the snapshot, it won't go to KV. So kvGetCalls should remain 0.
    expect(kvGetCalls).toBe(0);
    // sharedGetCalls: first answer: 2 gets (snapshot + stamps), second answer: 2 gets (snapshot + stamps) = 4 total
    expect(sharedGetCalls).toBe(4);
  });

  it("19. Retry cooldown: after a rebuild attempt, another stale answer within 60s does not schedule", async () => {
    const snapshot = createSnapshot(1000, NIGHTS, []);
    const encoded = encodeShared(snapshot);
    kv.set("city/nyc", encoded);
    const reader = new SnapshotReader(createDeps());
    // First answer with stale stamp triggers rebuild
    stampsMap.set(NYC_METRO.id, 2000);
    await reader.answer(NYC_METRO, NYC_METRO.center, 50, ["2026-11-02"], null);
    expect(backgroundJobs).toHaveLength(1);
    // Wait for rebuild to settle
    await Promise.all(backgroundJobs);
    // Advance clock 30s (still within cooldown)
    fakeNow = new Date(fakeNow.getTime() + 30_000);
    // Another stale answer (stamp still newer) should NOT schedule another job
    await reader.answer(NYC_METRO, NYC_METRO.center, 50, ["2026-11-02"], null);
    expect(backgroundJobs).toHaveLength(1);
    // Advance clock past cooldown (61s total)
    fakeNow = new Date(fakeNow.getTime() + 31_000);
    await reader.answer(NYC_METRO, NYC_METRO.center, 50, ["2026-11-02"], null);
    expect(backgroundJobs).toHaveLength(2);
  });

  it("20. Rollover: KV holds the very snapshot judged stale (same builtAt, stamp unchanged) -> rebuilds", async () => {
    const snapshot = createSnapshot(2000, NIGHTS, []);
    kv.set("city/nyc", encodeShared(snapshot));
    stampsMap.set(NYC_METRO.id, 2000);
    let buildCalled = false;
    const reader = new SnapshotReader(
      createDeps({
        build: async () => {
          buildCalled = true;
          return createSnapshot(2000, [...NIGHTS.slice(1), "2026-11-10"], []);
        },
      }),
    );
    const result = await reader.rebuild("nyc", NYC_METRO.id, snapshot.builtAt);
    expect(result).toBe("built");
    expect(buildCalled).toBe(true);
  });

  it("21. KV snapshot newer than the one judged stale (another data centre rebuilt it) -> 'fresh'", async () => {
    const snapshot = createSnapshot(2000, NIGHTS, []);
    kv.set("city/nyc", encodeShared(snapshot));
    stampsMap.set(NYC_METRO.id, 2000);
    let buildCalled = false;
    const reader = new SnapshotReader(
      createDeps({
        build: async () => {
          buildCalled = true;
          return null;
        },
      }),
    );
    const result = await reader.rebuild(
      "nyc",
      NYC_METRO.id,
      new Date(snapshot.builtAt.getTime() - 1),
    );
    expect(result).toBe("fresh");
    expect(buildCalled).toBe(false);
  });
});
