import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { Db } from "@/src/db/client";
import { events, eventSources, sources, metros } from "@/src/db/schema";
import { loadMetro, recordHealth, upsertSource } from "@/src/pipeline/store";
import { silentSources, silentSourceNote, type SilentSource } from "@/src/pipeline/silent-sources";
import { closeTestDb, describeDb, requireDbInCi, resetDb, testDb } from "@/tests/unit/db-harness";

requireDbInCi();

describeDb("silent sources (D-559 fix 2)", () => {
  let db: Db;
  let metroId: string;

  beforeAll(async () => {
    db = await testDb("silent");
  });
  afterAll(closeTestDb);

  beforeEach(async () => {
    await resetDb();
    // Create NYC metro like in pipeline-failure-streak.test.ts
    await db.insert(metros).values({
      slug: "nyc",
      name: "New York",
      countryCode: "US",
      center: { lat: 40.7128, lng: -74.006 },
      radiusKm: 50,
      tz: "America/New_York",
      languages: ["en"],
    });
    const metroRow = await loadMetro(db, "nyc");
    metroId = metroRow!.id;
  });

  it("seeded source with active event within 7 nights -> NOT named", async () => {
    const source = await upsertSource(db, metroId, {
      url: "https://active.example",
      kind: "html",
      trustTier: "first_party",
      discoveredBy: "seed_list",
    });
    await recordHealth(db, source.id, "ok", new Date("2026-11-01T12:00:00Z"), null, null);
    // Insert an active event for 2026-11-04 (within 7 nights from tonight 2026-11-02)
    const [event] = await db
      .insert(events)
      .values({
        slug: "test-2026-11-04-abc",
        title: "Test Event",
        titleNormalized: "test event",
        listingType: "social",
        nightDate: "2026-11-04",
        tz: "America/New_York",
        status: "active",
        confirmation: "recurring_unconfirmed",
        metroId,
        sourceIds: [source.id],
        firstSeenAt: new Date(),
      })
      .returning({ id: events.id });
    await db.insert(eventSources).values({
      eventId: event!.id,
      sourceId: source.id,
      sourceUrl: source.url,
      role: "primary",
      firstSeenAt: new Date(),
      lastSeenAt: new Date(),
    });

    const result = await silentSources(db, metroId, "2026-11-02");
    expect(result).toHaveLength(0);
  });

  it("seeded source with event outside 7 nights -> named, lastRowSeenAt not null", async () => {
    const source = await upsertSource(db, metroId, {
      url: "https://outside.example",
      kind: "html",
      trustTier: "first_party",
      discoveredBy: "seed_list",
    });
    await recordHealth(db, source.id, "ok", new Date("2026-11-01T12:00:00Z"), null, null);
    // Event on 2026-11-20 (outside 7 nights from 2026-11-02)
    const [event] = await db
      .insert(events)
      .values({
        slug: "test-2026-11-20-abc",
        title: "Test Event",
        titleNormalized: "test event",
        listingType: "social",
        nightDate: "2026-11-20",
        tz: "America/New_York",
        status: "active",
        confirmation: "recurring_unconfirmed",
        metroId,
        sourceIds: [source.id],
        firstSeenAt: new Date(),
      })
      .returning({ id: events.id });
    const seenAt = new Date("2026-10-30T12:00:00Z");
    await db.insert(eventSources).values({
      eventId: event!.id,
      sourceId: source.id,
      sourceUrl: source.url,
      role: "primary",
      firstSeenAt: seenAt,
      lastSeenAt: seenAt,
    });

    const result = await silentSources(db, metroId, "2026-11-02");
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      url: "https://outside.example",
      lastSuccessAt: "2026-11-01T12:00:00.000Z",
      lastRowSeenAt: "2026-10-30T12:00:00.000Z",
    });
  });

  it("seeded source with no events -> named, lastRowSeenAt null", async () => {
    const source = await upsertSource(db, metroId, {
      url: "https://no-events.example",
      kind: "html",
      trustTier: "first_party",
      discoveredBy: "seed_list",
    });
    await recordHealth(db, source.id, "ok", new Date("2026-11-01T12:00:00Z"), null, null);

    const result = await silentSources(db, metroId, "2026-11-02");
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      url: "https://no-events.example",
      lastSuccessAt: "2026-11-01T12:00:00.000Z",
      lastRowSeenAt: null,
    });
  });

  it("seeded source with failed last read -> NOT named", async () => {
    const source = await upsertSource(db, metroId, {
      url: "https://failed.example",
      kind: "html",
      trustTier: "first_party",
      discoveredBy: "seed_list",
    });
    await recordHealth(db, source.id, "failed", new Date("2026-11-01T12:00:00Z"), "403", null);

    const result = await silentSources(db, metroId, "2026-11-02");
    expect(result).toHaveLength(0);
  });

  it("venue_websites discovered source -> NOT named", async () => {
    const source = await upsertSource(db, metroId, {
      url: "https://venue.example",
      kind: "html",
      trustTier: "first_party",
      discoveredBy: "venue_websites",
    });
    await recordHealth(db, source.id, "ok", new Date("2026-11-01T12:00:00Z"), null, null);

    const result = await silentSources(db, metroId, "2026-11-02");
    expect(result).toHaveLength(0);
  });

  it("disabled seeded source -> NOT named", async () => {
    const source = await upsertSource(db, metroId, {
      url: "https://disabled.example",
      kind: "html",
      trustTier: "first_party",
      discoveredBy: "seed_list",
    });
    await db.update(sources).set({ enabled: false }).where(eq(sources.id, source.id));
    await recordHealth(db, source.id, "ok", new Date("2026-11-01T12:00:00Z"), null, null);

    const result = await silentSources(db, metroId, "2026-11-02");
    expect(result).toHaveLength(0);
  });

  it("seeded source never read (no lastSuccessAt) -> NOT named", async () => {
    await upsertSource(db, metroId, {
      url: "https://never-read.example",
      kind: "html",
      trustTier: "first_party",
      discoveredBy: "seed_list",
    });
    // Don't call recordHealth, so health remains empty

    const result = await silentSources(db, metroId, "2026-11-02");
    expect(result).toHaveLength(0);
  });

  it("seeded source with only 'removed' event in 7 nights -> named", async () => {
    const source = await upsertSource(db, metroId, {
      url: "https://removed.example",
      kind: "html",
      trustTier: "first_party",
      discoveredBy: "seed_list",
    });
    await recordHealth(db, source.id, "ok", new Date("2026-11-01T12:00:00Z"), null, null);
    // Event with status 'removed' on 2026-11-04
    const [event] = await db
      .insert(events)
      .values({
        slug: "test-2026-11-04-rem",
        title: "Test Event",
        titleNormalized: "test event",
        listingType: "social",
        nightDate: "2026-11-04",
        tz: "America/New_York",
        status: "removed",
        confirmation: "recurring_unconfirmed",
        metroId,
        sourceIds: [source.id],
        firstSeenAt: new Date(),
      })
      .returning({ id: events.id });
    await db.insert(eventSources).values({
      eventId: event!.id,
      sourceId: source.id,
      sourceUrl: source.url,
      role: "primary",
      firstSeenAt: new Date(),
      lastSeenAt: new Date(),
    });

    const result = await silentSources(db, metroId, "2026-11-02");
    expect(result).toHaveLength(1);
    expect(result[0]!.url).toBe("https://removed.example");
  });

  it("another metro's silent source -> NOT named", async () => {
    // Create another metro
    await db.insert(metros).values({
      slug: "lon",
      name: "London",
      countryCode: "GB",
      center: { lat: 51.5074, lng: -0.1276 },
      radiusKm: 50,
      tz: "Europe/London",
      languages: ["en"],
    });
    const london = await loadMetro(db, "lon");
    const source = await upsertSource(db, london!.id, {
      url: "https://london.example",
      kind: "html",
      trustTier: "first_party",
      discoveredBy: "seed_list",
    });
    await recordHealth(db, source.id, "ok", new Date("2026-11-01T12:00:00Z"), null, null);

    const result = await silentSources(db, metroId, "2026-11-02");
    expect(result).toHaveLength(0);
  });
});

describe("silentSourceNote", () => {
  it("with last row", () => {
    const source: SilentSource = {
      url: "https://example.com",
      lastSuccessAt: "2026-09-28T16:00:00Z",
      lastRowSeenAt: "2026-09-20T12:00:00Z",
    };
    const note = silentSourceNote(source);
    expect(note).toBe(
      "read fine (last Mon, Sep 28, 12pm ET) but lists nothing on the next 7 nights; its last row was seen Sun, Sep 20, 8am ET.",
    );
  });

  it("without last row", () => {
    const source: SilentSource = {
      url: "https://example.com",
      lastSuccessAt: "2026-09-28T16:00:00Z",
      lastRowSeenAt: null,
    };
    const note = silentSourceNote(source);
    expect(note).toBe(
      "read fine (last Mon, Sep 28, 12pm ET) but lists nothing on the next 7 nights; it has never written a row.",
    );
  });
});
