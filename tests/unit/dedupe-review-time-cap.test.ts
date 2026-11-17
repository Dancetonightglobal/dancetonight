import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";

import type { Metro, Source } from "@/src/adapters/types";
import type { AiClient } from "@/src/ai";
import type { Db } from "@/src/db/client";
import { events, mergeDecisions, metros, organizers, sources, venues } from "@/src/db/schema";
import { eventSources } from "@/src/db/schema/provenance";
import { reviewQueuedPairs } from "@/src/pipeline/dedupe-review";
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

describeDb("dedupe review time cap", () => {
  beforeAll(async () => {
    db = await testDb("dedupe_review_time_cap");
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

    // Create venue
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

    // Create three events for three queued pairs
    const eventA = await insertEvent(
      "Event A",
      "2026-10-25",
      organizerFeed,
      "event-a",
      venueId,
      organizerId,
    );
    const eventB = await insertEvent(
      "Event B",
      "2026-10-25",
      ticketing,
      "event-b",
      venueId,
      organizerId,
    );
    const eventC = await insertEvent(
      "Event C",
      "2026-10-25",
      organizerFeed,
      "event-c",
      venueId,
      organizerId,
    );
    const eventD = await insertEvent(
      "Event D",
      "2026-10-25",
      ticketing,
      "event-d",
      venueId,
      organizerId,
    );
    const eventE = await insertEvent(
      "Event E",
      "2026-10-25",
      organizerFeed,
      "event-e",
      venueId,
      organizerId,
    );
    const eventF = await insertEvent(
      "Event F",
      "2026-10-25",
      ticketing,
      "event-f",
      venueId,
      organizerId,
    );

    // Insert three queued pairs
    await db.insert(mergeDecisions).values({
      id: crypto.randomUUID(),
      eventA: eventA,
      eventB: eventB,
      score: 0.5,
      decision: "queued",
      reasoning: null,
    });
    await db.insert(mergeDecisions).values({
      id: crypto.randomUUID(),
      eventA: eventC,
      eventB: eventD,
      score: 0.4,
      decision: "queued",
      reasoning: null,
    });
    await db.insert(mergeDecisions).values({
      id: crypto.randomUUID(),
      eventA: eventE,
      eventB: eventF,
      score: 0.3,
      decision: "queued",
      reasoning: null,
    });
  });

  it("stops when time cap is reached", async () => {
    const times = [0, 0, 2000]; // first call returns 0, second 0, third 2000
    let callIdx = 0;
    const clock = () => {
      const val = times[callIdx] ?? 2000;
      callIdx++;
      return val;
    };

    const client = {
      mock: false,
      async run() {
        return {
          ok: true,
          provider: "gemini",
          model: "flash-lite",
          usage: { inputTokens: 500, outputTokens: 80, cost: 1, unit: "request" },
          value: { same: true, sure: true, reason: "test" },
        };
      },
    } as unknown as AiClient;

    const report = await reviewQueuedPairs(db, {
      metro,
      nights: ["2026-10-25"],
      client,
      limit: 40,
      maxMs: 1000,
      clock,
    });

    expect(report.asked).toBe(1);
    expect(report.stoppedForTime).toBe(true);
    expect(report.lines).toContainEqual(
      expect.stringMatching(/^stopped: the 1-second review cap is spent; 2 pair\(s\) stay queued/),
    );

    // Verify that two pairs remain queued
    const decisions = await db
      .select()
      .from(mergeDecisions)
      .where(eq(mergeDecisions.decision, "queued"));
    expect(decisions).toHaveLength(2);
  });

  it("processes all pairs when no time cap", async () => {
    const client = {
      mock: false,
      async run() {
        return {
          ok: true,
          provider: "gemini",
          model: "flash-lite",
          usage: { inputTokens: 500, outputTokens: 80, cost: 1, unit: "request" },
          value: { same: true, sure: true, reason: "test" },
        };
      },
    } as unknown as AiClient;

    const report = await reviewQueuedPairs(db, {
      metro,
      nights: ["2026-10-25"],
      client,
      limit: 40,
      // no maxMs
    });

    expect(report.asked).toBe(3);
    expect(report.stoppedForTime).toBe(false);
    expect(report.lines).not.toContainEqual(expect.stringMatching(/^stopped:/));

    // All pairs should be updated (llm_merge)
    const decisions = await db
      .select()
      .from(mergeDecisions)
      .where(eq(mergeDecisions.decision, "llm_merge"));
    expect(decisions).toHaveLength(3);
  });
});
