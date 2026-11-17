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
    tz: "Europe/Lisbon",
    dancingAt: new Date("2026-11-07T23:59:00Z"),
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

describeDb("dedupe review title part rule", () => {
  beforeAll(async () => {
    db = await testDb("dedupe_review_title_part");
  });
  afterAll(closeTestDb);

  beforeEach(async () => {
    await resetDb();
    await db.insert(metros).values({
      slug: "lisbon",
      name: "Lisbon",
      countryCode: "PT",
      center: { lat: 38.7223, lng: -9.1393 },
      radiusKm: 50,
      tz: "Europe/Lisbon",
      languages: ["pt"],
    });
    metro = (await db.select().from(metros).where(eq(metros.slug, "lisbon")))[0] as Metro;

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

    // Create venue Casa Capitão
    const venueId = crypto.randomUUID();
    await db.insert(venues).values({
      id: venueId,
      metroId: metro.id,
      name: "Casa Capitão",
      nameNormalized: "casa capitao",
      address: { line1: "Rua do Capitão" },
      location: sql`ST_SetSRID(ST_MakePoint(${-9.1393}, ${38.7223}), 4326)::geography`,
      tz: "Europe/Lisbon",
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
      "Último Embrasa do Ano",
      "2026-11-07",
      organizerFeed,
      "event-a",
      venueId,
      organizerId,
    );
    const eventB = await insertEvent(
      "BAILE | EMBRASA: DJ SAZE + DJ Lorrany + Rafa Militão + bieu s2 + GAVI + Ana Lauriz + Tarik + Naomy Vissolela + Xavbeatzz b2b Brilhante | Último Embrasa do Ano",
      "2026-11-07",
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

  it("settles pair by rule without model call when venue and start match", async () => {
    const client = {
      mock: false,
      async run() {
        throw new Error("must not be called");
      },
    } as unknown as AiClient;

    const report = await reviewQueuedPairs(db, {
      metro,
      nights: ["2026-11-07"],
      client,
      limit: 40,
    });
    expect(report.asked).toBe(0);
    expect(report.merged).toBe(1);
    expect(report.lines[0]).toMatch(/^same \(title part\):/);

    const decisions = await db.select().from(mergeDecisions);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.decision).toBe("llm_merge");
    const reasoning = JSON.parse(decisions[0]?.reasoning || "{}");
    expect(reasoning.rule).toBe("title-part");
  });

  it("asks model when starts differ and adds unsure line", async () => {
    // Update second event's startsAt to one hour later
    const eventBId = (
      await db
        .select()
        .from(events)
        .where(
          eq(
            events.title,
            "BAILE | EMBRASA: DJ SAZE + DJ Lorrany + Rafa Militão + bieu s2 + GAVI + Ana Lauriz + Tarik + Naomy Vissolela + Xavbeatzz b2b Brilhante | Último Embrasa do Ano",
          ),
        )
    )[0]?.id;
    await db
      .update(events)
      .set({ dancingAt: new Date("2026-11-08T00:59:00Z") })
      .where(eq(events.id, eventBId!));

    const client = {
      mock: false,
      async run() {
        return {
          ok: true,
          provider: "gemini",
          model: "flash-lite",
          usage: { inputTokens: 500, outputTokens: 80, cost: 1, unit: "request" },
          value: { same: true, sure: false, reason: "different lineups" },
        };
      },
    } as unknown as AiClient;

    const report = await reviewQueuedPairs(db, {
      metro,
      nights: ["2026-11-07"],
      client,
      limit: 40,
    });
    expect(report.asked).toBe(1);
    expect(report.unsure).toBe(1);
    expect(report.lines[0]).toMatch(/^unsure:/);
    expect(report.lines[0]).toContain("(different lineups)");

    const decisions = await db.select().from(mergeDecisions);
    expect(decisions[0]?.decision).toBe("queued");
  });
});
