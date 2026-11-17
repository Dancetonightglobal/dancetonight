// Cache event-page reads under the change stamp (D-580): tests for the per-isolate TtlCache and
// shared Cloudflare Cache API behaviour on getBySlug and resolveSlug.

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";

import { DbListingsRepository } from "@/src/data/db-repository";
import { STAMP_URL, type SharedStore } from "@/src/data/shared-cache";
import type { Db } from "@/src/db/client";
import { events, jobRuns, metros, sources, eventSources, venues } from "@/src/db/schema";
import { closeTestDb, describeDb, requireDbInCi, resetDb, testDb } from "@/tests/unit/db-harness";

requireDbInCi();

const NY = "America/New_York";
const NOW = new Date("2026-09-20T23:42:00Z");

describeDb("Slug cache (D-580)", () => {
  let db: Db;
  let venueId: string;
  let eventId: string;
  let sourceId: string;

  // In-memory shared store for testing
  // expireStamp() stands in for the shared stamp's 60 s lifetime running out (D-582).
  const createMemoryStore = (): SharedStore & { expireStamp(): void } => {
    const map = new Map<string, string>();
    return {
      expireStamp(): void {
        map.delete(STAMP_URL);
      },
      async get(url: string): Promise<string | null> {
        return map.get(url) ?? null;
      },
      async put(url: string, body: string): Promise<void> {
        map.set(url, body);
      },
    };
  };

  beforeAll(async () => {
    db = await testDb("slug_cache");
  });
  afterAll(closeTestDb);

  beforeEach(async () => {
    await resetDb();
    // Minimal seed similar to db-repository.test.ts
    await db.insert(metros).values({
      slug: "nyc",
      name: "New York",
      countryCode: "US",
      center: { lat: 40.7128, lng: -74.006 },
      radiusKm: 50,
      tz: NY,
      languages: ["en"],
    });
    const [venue] = await db
      .insert(venues)
      .values({
        name: "Test Venue",
        nameNormalized: "test venue",
        location: { lat: 40.7081, lng: -73.9571 },
        tz: NY,
      })
      .returning({ id: venues.id });
    venueId = venue!.id;
    const [event] = await db
      .insert(events)
      .values({
        slug: "test-event",
        title: "Original Title",
        titleNormalized: "original title",
        listingType: "social",
        styles: ["salsa"],
        nightDate: "2026-09-20",
        tz: NY,
        confirmation: "recurring_unconfirmed",
        venueId,
        status: "active",
      })
      .returning({ id: events.id });
    eventId = event!.id;
    const [source] = await db
      .insert(sources)
      .values({
        url: "https://organiser.example/",
        kind: "html",
        trustTier: "first_party",
      })
      .returning({ id: sources.id });
    sourceId = source!.id;
    await db.insert(eventSources).values({
      eventId,
      sourceId,
      sourceUrl: "https://organiser.example/",
      role: "primary",
    });
  });

  it("shared across isolates: old title served from store until stamp moves", async () => {
    const store = createMemoryStore();
    const repoA = new DbListingsRepository(() => db, {
      cacheMs: 120_000,
      sharedStore: store,
    });
    const listing1 = await repoA.getBySlug("test-event", NOW);
    expect(listing1?.title).toBe("Original Title");

    // Update title in DB
    await db.update(events).set({ title: "Updated Title" }).where(eq(events.slug, "test-event"));

    // New repo with same store should still return old title (cached)
    const repoB = new DbListingsRepository(() => db, {
      cacheMs: 120_000,
      sharedStore: store,
    });
    const listing2 = await repoB.getBySlug("test-event", NOW);
    expect(listing2?.title).toBe("Original Title");

    // Insert a job_runs row to move the stamp
    await db.insert(jobRuns).values({
      job: "test-job",
      startedAt: new Date(),
      finishedAt: new Date(),
      status: "succeeded",
    });
    store.expireStamp();

    // Another new repo should now get the updated title
    const repoC = new DbListingsRepository(() => db, {
      cacheMs: 120_000,
      sharedStore: store,
    });
    const listing3 = await repoC.getBySlug("test-event", NOW);
    expect(listing3?.title).toBe("Updated Title");
  });

  it("now is applied after the cache", async () => {
    const store = createMemoryStore();
    const repo = new DbListingsRepository(() => db, {
      cacheMs: 120_000,
      sharedStore: store,
    });
    // First call reads DB
    const listing1 = await repo.getBySlug("test-event", NOW);
    expect(listing1?.title).toBe("Original Title");

    // Spy on store.get to verify cache hit
    let getCallCount = 0;
    const originalGet = store.get;
    store.get = async (url) => {
      getCallCount++;
      return originalGet.call(store, url);
    };

    // Second call with different now should hit cache
    const laterNow = new Date(NOW.getTime() + 3600000);
    const listing2 = await repo.getBySlug("test-event", laterNow);
    expect(listing2?.title).toBe("Original Title");
    expect(getCallCount).toBe(0); // the per-isolate cache answers; neither the store nor the DB is read

    // Restore
    store.get = originalGet;
  });

  it("missing slug returns null and null is cached", async () => {
    const store = createMemoryStore();
    const repoA = new DbListingsRepository(() => db, {
      cacheMs: 120_000,
      sharedStore: store,
    });
    const result1 = await repoA.getBySlug("non-existent", NOW);
    expect(result1).toBeNull();

    // Insert a new event with that slug
    await db.insert(events).values({
      slug: "non-existent",
      title: "New Event",
      titleNormalized: "new event",
      listingType: "social",
      styles: ["salsa"],
      nightDate: "2026-09-20",
      tz: NY,
      confirmation: "recurring_unconfirmed",
      venueId,
      status: "active",
    });

    // New repo with same store should still return null (cached)
    const repoB = new DbListingsRepository(() => db, {
      cacheMs: 120_000,
      sharedStore: store,
    });
    const result2 = await repoB.getBySlug("non-existent", NOW);
    expect(result2).toBeNull();

    // Move stamp
    await db.insert(jobRuns).values({
      job: "test-job",
      startedAt: new Date(),
      finishedAt: new Date(),
      status: "succeeded",
    });
    store.expireStamp();

    // Now should get the new event
    const repoC = new DbListingsRepository(() => db, {
      cacheMs: 120_000,
      sharedStore: store,
    });
    const result3 = await repoC.getBySlug("non-existent", NOW);
    expect(result3?.title).toBe("New Event");
  });

  it("resolveSlug caches and respects stamp", async () => {
    const store = createMemoryStore();
    const repoA = new DbListingsRepository(() => db, {
      cacheMs: 120_000,
      sharedStore: store,
    });
    const answer1 = await repoA.resolveSlug("test-event");
    expect(answer1).toEqual({ kind: "listed" });

    // Mark event as merged
    const [mergedEvent] = await db
      .insert(events)
      .values({
        slug: "merged-event",
        title: "Merged Event",
        titleNormalized: "merged event",
        listingType: "social",
        styles: ["salsa"],
        nightDate: "2026-09-20",
        tz: NY,
        confirmation: "recurring_unconfirmed",
        venueId,
        status: "active",
      })
      .returning({ id: events.id });
    await db
      .update(events)
      .set({ status: "merged", mergedIntoId: mergedEvent!.id })
      .where(eq(events.slug, "test-event"));

    // New repo with same store should still answer "listed"
    const repoB = new DbListingsRepository(() => db, {
      cacheMs: 120_000,
      sharedStore: store,
    });
    const answer2 = await repoB.resolveSlug("test-event");
    expect(answer2).toEqual({ kind: "listed" });

    // Move stamp
    await db.insert(jobRuns).values({
      job: "test-job",
      startedAt: new Date(),
      finishedAt: new Date(),
      status: "succeeded",
    });
    store.expireStamp();

    // Now should get moved answer
    const repoC = new DbListingsRepository(() => db, {
      cacheMs: 120_000,
      sharedStore: store,
    });
    const answer3 = await repoC.resolveSlug("test-event");
    expect(answer3).toEqual({ kind: "moved", slug: "merged-event" });
  });

  it("no options: immediate DB reads", async () => {
    const repo = new DbListingsRepository(() => db); // No cacheMs, no sharedStore
    const listing1 = await repo.getBySlug("test-event", NOW);
    expect(listing1?.title).toBe("Original Title");

    // Update title
    await db.update(events).set({ title: "Updated Title" }).where(eq(events.slug, "test-event"));

    // Should see update immediately
    const listing2 = await repo.getBySlug("test-event", NOW);
    expect(listing2?.title).toBe("Updated Title");
  });
});
