// The model settles pairs the scorer queued (D-150): facts only, local times, one verdict per pair,
// and a quota stop that leaves the rest queued.
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";

import type { Metro, Source } from "@/src/adapters/types";
import type { AiClient } from "@/src/ai";
import type { Db } from "@/src/db/client";
import { events, mergeDecisions, metros, organizers, sources, venues } from "@/src/db/schema";
import { eventSources } from "@/src/db/schema/provenance";
import {
  emptyDedupeReviewReport,
  formatDedupeReview,
  reviewQueuedPairs,
} from "@/src/pipeline/dedupe-review";
import { closeTestDb, describeDb, requireDbInCi, resetDb, testDb } from "@/tests/unit/db-harness";

requireDbInCi();

let db: Db;
let metro: Metro;
let organizerFeed: Source;
let ticketing: Source;

async function insertEvent(
  title: string,
  nightDate: string,
  source: Source,
  externalId: string,
  venueId?: string,
  organizerId?: string,
) {
  const eventId = crypto.randomUUID();
  await db.insert(events).values({
    id: eventId,
    slug: `test-${eventId}`,
    title,
    titleNormalized: title.toLowerCase(),
    listingType: "social",
    styles: ["salsa"],
    nightDate,
    tz: "America/New_York",
    metroId: metro.id,
    venueId,
    organizerId,
    status: "active",
    confirmation: "confirmed_today",
    sourceIds: [source.id],
  });
  await db.insert(eventSources).values({
    id: crypto.randomUUID(),
    eventId,
    sourceId: source.id,
    sourceUrl: source.url,
    role: "primary",
    firstSeenAt: new Date(),
    lastSeenAt: new Date(),
  });
  return eventId;
}

describeDb("dedupe review by model", () => {
  beforeAll(async () => {
    db = await testDb("dedupe_review");
  });
  afterAll(closeTestDb);

  beforeEach(async () => {
    await resetDb();
    await db.insert(metros).values({
      slug: "nyc",
      name: "New York",
      countryCode: "US",
      center: { lat: 40.7128, lng: -74.006 },
      radiusKm: 50,
      tz: "America/New_York",
      languages: ["en"],
    });
    metro = (await db.select().from(metros).where(eq(metros.slug, "nyc")))[0] as Metro;

    // Create sources
    const [orgSource] = await db
      .insert(sources)
      .values({
        id: crypto.randomUUID(),
        metroId: metro.id,
        url: "https://organizer.example/calendar",
        kind: "feed_ics",
        trustTier: "first_party",
        discoveredBy: "seed_list",
      })
      .returning();
    organizerFeed = orgSource as Source;

    const [ticketingSource] = await db
      .insert(sources)
      .values({
        id: crypto.randomUUID(),
        metroId: metro.id,
        url: "https://tickets.example/events",
        kind: "ticketing_api",
        trustTier: "ticketing",
        discoveredBy: "seed_list",
      })
      .returning();
    ticketing = ticketingSource as Source;

    // Create venue using Drizzle insert to ensure JSON is serialized correctly
    const venueId = crypto.randomUUID();
    await db.insert(venues).values({
      id: venueId,
      metroId: metro.id,
      name: "Test Venue",
      nameNormalized: "test venue",
      address: { line1: "123 Main St" },
      location: sql`ST_SetSRID(ST_MakePoint(${-74.006}, ${40.7128}), 4326)::geography`,
      tz: "America/New_York",
    });

    // Create organizer
    const [organizer] = await db
      .insert(organizers)
      .values({
        id: crypto.randomUUID(),
        metroId: metro.id,
        name: "Test Organizer",
        nameNormalized: "test organizer",
      })
      .returning();
    if (!organizer) throw new Error("Failed to create organizer");
    const organizerId = organizer.id;

    // Create two events for testing
    const eventA = await insertEvent(
      "Salsa Night",
      "2026-10-25",
      organizerFeed,
      "event-a",
      venueId,
      organizerId,
    );
    const eventB = await insertEvent(
      "Salsa Social",
      "2026-10-25",
      ticketing,
      "event-b",
      venueId,
      organizerId,
    );

    // Insert queued decision
    await db.insert(mergeDecisions).values({
      id: crypto.randomUUID(),
      eventA: eventA,
      eventB: eventB,
      score: 0.5,
      decision: "queued",
      reasoning: null,
    });
  });

  it("converts queued to llm_merge when model says same and sure", async () => {
    const client = {
      mock: false,
      async run() {
        return {
          ok: true,
          provider: "gemini",
          model: "flash-lite",
          usage: { inputTokens: 500, outputTokens: 80, cost: 1, unit: "request" },
          value: { same: true, sure: true, reason: "lineup added" },
        };
      },
    } as unknown as AiClient;

    const report = await reviewQueuedPairs(db, {
      metro,
      nights: ["2026-10-25"],
      client,
      limit: 40,
    });
    expect(report).toMatchObject({
      asked: 1,
      merged: 1,
      distinct: 0,
      unsure: 0,
      failed: 0,
    });
    expect(report.lines[0]).toContain("same: Salsa Night | Salsa Social");

    const decisions = await db.select().from(mergeDecisions);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.decision).toBe("llm_merge");
    const reasoning = JSON.parse(decisions[0]?.reasoning || "{}");
    expect(reasoning.model).toBe("flash-lite");
    expect(reasoning.prompt).toBe("dedupe-v2");
    expect(reasoning.reason).toBe("lineup added");
  });

  it("converts queued to llm_distinct when model says not same and sure", async () => {
    const client = {
      mock: false,
      async run() {
        return {
          ok: true,
          provider: "gemini",
          model: "flash-lite",
          usage: { inputTokens: 500, outputTokens: 80, cost: 1, unit: "request" },
          value: { same: false, sure: true, reason: "different events" },
        };
      },
    } as unknown as AiClient;

    const report = await reviewQueuedPairs(db, {
      metro,
      nights: ["2026-10-25"],
      client,
      limit: 40,
    });
    expect(report).toMatchObject({
      asked: 1,
      merged: 0,
      distinct: 1,
      unsure: 0,
      failed: 0,
    });
    expect(report.lines[0]).toContain("distinct: Salsa Night | Salsa Social");

    const decisions = await db.select().from(mergeDecisions);
    expect(decisions[0]?.decision).toBe("llm_distinct");
  });

  it("leaves queued when model says unsure", async () => {
    const client = {
      mock: false,
      async run() {
        return {
          ok: true,
          provider: "gemini",
          model: "flash-lite",
          usage: { inputTokens: 500, outputTokens: 80, cost: 1, unit: "request" },
          value: { same: true, sure: false, reason: "not enough info" },
        };
      },
    } as unknown as AiClient;

    const report = await reviewQueuedPairs(db, {
      metro,
      nights: ["2026-10-25"],
      client,
      limit: 40,
    });
    expect(report).toMatchObject({
      asked: 1,
      merged: 0,
      distinct: 0,
      unsure: 1,
      failed: 0,
    });
    expect(report.lines).toEqual(["unsure: Salsa Night | Salsa Social (not enough info)"]);

    const decisions = await db.select().from(mergeDecisions);
    expect(decisions[0]?.decision).toBe("queued");
  });

  it("skips queued pair if one event is merged", async () => {
    // Mark eventB as merged
    const eventBId = (await db.select().from(events).where(eq(events.title, "Salsa Social")))[0]
      ?.id;
    await db.update(events).set({ status: "merged" }).where(eq(events.id, eventBId!));
    // Insert another queued pair with both active events
    const eventC = await insertEvent("Event C", "2026-10-25", organizerFeed, "event-c");
    const eventD = await insertEvent("Event D", "2026-10-25", ticketing, "event-d");
    await db.insert(mergeDecisions).values({
      id: crypto.randomUUID(),
      eventA: eventC,
      eventB: eventD,
      score: 0.3,
      decision: "queued",
      reasoning: null,
    });

    const client = {
      mock: false,
      async run() {
        return {
          ok: true,
          provider: "gemini",
          model: "flash-lite",
          usage: { inputTokens: 500, outputTokens: 80, cost: 1, unit: "request" },
          value: { same: true, sure: true, reason: "lineup added" },
        };
      },
    } as unknown as AiClient;

    const report = await reviewQueuedPairs(db, {
      metro,
      nights: ["2026-10-25"],
      client,
      limit: 40,
    });
    // Only the pair with both active events should be asked
    expect(report.asked).toBe(1);
    expect(report.merged).toBe(1);
    // The pair with a merged event should be skipped
    const decisions = await db
      .select()
      .from(mergeDecisions)
      .where(eq(mergeDecisions.decision, "queued"));
    expect(decisions).toHaveLength(1); // The original pair with merged event remains queued
  });

  it("stops on quota_exhausted", async () => {
    // Insert another queued pair
    const eventC = await insertEvent("Event C", "2026-10-25", organizerFeed, "event-c");
    const eventD = await insertEvent("Event D", "2026-10-25", ticketing, "event-d");
    await db.insert(mergeDecisions).values({
      id: crypto.randomUUID(),
      eventA: eventC,
      eventB: eventD,
      score: 0.3,
      decision: "queued",
      reasoning: null,
    });

    let callCount = 0;
    const client = {
      mock: false,
      async run() {
        callCount++;
        if (callCount === 1) {
          return {
            ok: false,
            reason: "quota_exhausted",
            provider: null,
            detail: "spent",
          };
        }
        return {
          ok: true,
          provider: "gemini",
          model: "flash-lite",
          usage: { inputTokens: 500, outputTokens: 80, cost: 1, unit: "request" },
          value: { same: true, sure: true, reason: "should not be called" },
        };
      },
    } as unknown as AiClient;

    const report = await reviewQueuedPairs(db, {
      metro,
      nights: ["2026-10-25"],
      client,
      limit: 40,
    });
    expect(report.asked).toBe(1);
    expect(report.failed).toBe(1);
    expect(callCount).toBe(1); // Second call never happens
  });

  it("does nothing when client.mock is true", async () => {
    const client = {
      mock: true,
      async run() {
        throw new Error("Should not be called");
      },
    } as unknown as AiClient;

    const report = await reviewQueuedPairs(db, {
      metro,
      nights: ["2026-10-25"],
      client,
      limit: 40,
    });
    expect(report.asked).toBe(0);
  });

  it("formats times correctly with timezone", async () => {
    // Create an event with a UTC start time that converts to local time
    const eventId = crypto.randomUUID();
    await db.insert(events).values({
      id: eventId,
      slug: `test-${eventId}`,
      title: "Time Test Event",
      titleNormalized: "time test event",
      listingType: "social",
      styles: ["salsa"],
      nightDate: "2026-10-17",
      tz: "America/New_York",
      dancingAt: new Date("2026-10-18T02:00:00Z"), // 22:00 NY time on 2026-10-17
      metroId: metro.id,
      status: "active",
      confirmation: "confirmed_today",
      sourceIds: [organizerFeed.id],
    });
    await db.insert(eventSources).values({
      id: crypto.randomUUID(),
      eventId,
      sourceId: organizerFeed.id,
      sourceUrl: organizerFeed.url,
      role: "primary",
      firstSeenAt: new Date(),
      lastSeenAt: new Date(),
    });

    // Create a queued pair with this event and another
    const eventOther = await insertEvent("Other Event", "2026-10-17", ticketing, "other");
    await db.insert(mergeDecisions).values({
      id: crypto.randomUUID(),
      eventA: eventId,
      eventB: eventOther,
      score: 0.5,
      decision: "queued",
      reasoning: null,
    });

    let receivedUserTurn = "";
    const client = {
      mock: false,
      async run(request: { job: { id: string }; user: string }) {
        receivedUserTurn = request.user;
        return {
          ok: true,
          provider: "gemini",
          model: "flash-lite",
          usage: { inputTokens: 500, outputTokens: 80, cost: 1, unit: "request" },
          value: { same: true, sure: true, reason: "test" },
        };
      },
    } as unknown as AiClient;

    await reviewQueuedPairs(db, {
      metro,
      nights: ["2026-10-17"],
      client,
      limit: 40,
    });

    // Check that the time is formatted as 2026-10-17 22:00
    expect(receivedUserTurn).toContain('"starts": "2026-10-17 22:00"');
  });

  it("formatDedupeReview returns empty array for empty report", () => {
    const report = emptyDedupeReviewReport();
    const lines = formatDedupeReview(report);
    expect(lines).toEqual([]);
  });
});
