// Dedupe model review integration (D-150): the model's verdicts act, possible duplicates are queued.
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";

import type { HarvestedListing, Metro, Source } from "@/src/adapters/types";
import type { Db } from "@/src/db/client";
import { events, mergeDecisions, metros } from "@/src/db/schema";
import { rawListingSchema } from "@/src/domain/listing";
import { EMPTY_BLOCKLIST } from "@/src/pipeline/blocklist";
import { dedupeMetro } from "@/src/pipeline/dedupe";
import { normalizeListing } from "@/src/pipeline/normalize";
import {
  loadMetro,
  pipelineId,
  resolveVenue,
  upsertSource,
  writeEvents,
} from "@/src/pipeline/store";
import { closeTestDb, describeDb, requireDbInCi, resetDb, testDb } from "@/tests/unit/db-harness";

requireDbInCi();

const NOW = new Date("2026-10-17T16:00:00Z");
let db: Db;
let metro: Metro;
let ticketing: Source;
let firstParty: Source;

const VENUE_POINT = { lat: 40.7652, lng: -73.9942 };

function event(source: Source, fields: Record<string, unknown>, id: string) {
  const harvested: HarvestedListing = {
    listing: rawListingSchema.parse({
      listing_type: "social",
      styles: [],
      venue: {},
      organizer: {},
      local_date: "2026-10-17",
      ...fields,
    }),
    externalId: id,
    tz: null,
    venueLocation: VENUE_POINT,
    recurrence: null,
    provenance: { sourceUrl: `${source.url}#${id}`, fetchedAt: NOW, method: "feed" },
  };
  const outcome = normalizeListing(harvested, { metro, source, now: NOW });
  if (!outcome.ok) throw new Error(outcome.reason);
  return outcome.event;
}

async function write(source: Source, list: ReturnType<typeof event>[]) {
  return writeEvents(db, {
    metro,
    source,
    events: list,
    blocklist: EMPTY_BLOCKLIST,
    placeVenue: (input) => resolveVenue(db, metro, input),
  });
}

describeDb("dedupe model review (D-150)", () => {
  beforeAll(async () => {
    db = await testDb("dedupe_model");
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
    metro = (await loadMetro(db, "nyc"))!;
    ticketing = await upsertSource(db, metro.id, {
      url: "https://dice.fm/",
      kind: "ticketing_api",
      trustTier: "ticketing",
      discoveredBy: "seed_list",
    });
    firstParty = await upsertSource(db, metro.id, {
      url: "https://example.com/",
      kind: "html",
      trustTier: "first_party",
      discoveredBy: "seed_list",
    });
  });

  it("merges a pair the model already called same (llm_merge)", async () => {
    // Two active listings at same venue and start, titles that would not auto-merge.
    await write(ticketing, [
      event(
        ticketing,
        {
          title: "Gypsy Jazz with Diego",
          dancing_time: "22:00",
          venue: { name: "Venue V" },
        },
        "t1",
      ),
    ]);
    await write(firstParty, [
      event(
        firstParty,
        {
          title: "Diego's Gypsy Jazz Night",
          dancing_time: "22:00",
          venue: { name: "Venue V" },
        },
        "f1",
      ),
    ]);
    // Insert a merge_decisions row with llm_merge for the pair.
    const rows = await db.select().from(events).where(eq(events.nightDate, "2026-10-17"));
    expect(rows).toHaveLength(2);
    const [a, b] = rows as [(typeof rows)[number], (typeof rows)[number]];
    await db.insert(mergeDecisions).values({
      id: pipelineId("merge", `${a.id}:${b.id}`),
      eventA: a.id,
      eventB: b.id,
      score: 0.5,
      decision: "llm_merge",
      reasoning: JSON.stringify({ model: "test", reason: "same event" }),
    });

    const report = await dedupeMetro(db, metro, ["2026-10-17"]);
    expect(report.merged).toBe(1);
    expect(report.mergedPairs[0]?.by).toBe("model");
    const after = await db.select().from(events).where(eq(events.nightDate, "2026-10-17"));
    expect(after.filter((r) => r.status === "merged")).toHaveLength(1);
  });

  it("queues a possible duplicate pair (one venue, one start, shared non-generic word)", async () => {
    await write(ticketing, [
      event(
        ticketing,
        {
          title: "Gypsy Jazz with Diego",
          dancing_time: "22:00",
          venue: { name: "Venue V" },
        },
        "t2",
      ),
    ]);
    await write(firstParty, [
      event(
        firstParty,
        {
          title: "Gypsy Jazz with Ana",
          dancing_time: "22:00",
          venue: { name: "Venue V" },
        },
        "f2",
      ),
    ]);
    const report = await dedupeMetro(db, metro, ["2026-10-17"]);
    // Should not merge (score not high enough), but should be queued as possible duplicate.
    expect(report.merged).toBe(0);
    expect(report.possible.length).toBeGreaterThan(0);
    expect(report.possible[0]).toMatch(/Gypsy Jazz with Diego.*Gypsy Jazz with Ana/);
    // Check that a merge_decisions row with decision 'queued' exists for the pair.
    const rows = await db.select().from(events).where(eq(events.nightDate, "2026-10-17"));
    const [a, b] = rows as [(typeof rows)[number], (typeof rows)[number]];
    const decision = await db
      .select()
      .from(mergeDecisions)
      .where(and(eq(mergeDecisions.eventA, a.id), eq(mergeDecisions.eventB, b.id)));
    expect(decision).toHaveLength(1);
    expect(decision[0]?.decision).toBe("queued");
  });

  it("recordDecision does not overwrite llm_merge with queued", async () => {
    // Create two events
    await write(ticketing, [
      event(
        ticketing,
        {
          title: "Event A",
          dancing_time: "22:00",
          venue: { name: "Venue V" },
        },
        "t3",
      ),
    ]);
    await write(firstParty, [
      event(
        firstParty,
        {
          title: "Event B",
          dancing_time: "22:00",
          venue: { name: "Venue V" },
        },
        "f3",
      ),
    ]);
    const rows = await db.select().from(events).where(eq(events.nightDate, "2026-10-17"));
    const [a, b] = rows as [(typeof rows)[number], (typeof rows)[number]];
    // First insert llm_merge
    await db.insert(mergeDecisions).values({
      id: pipelineId("merge", `${a.id}:${b.id}`),
      eventA: a.id,
      eventB: b.id,
      score: 0.8,
      decision: "llm_merge",
      reasoning: JSON.stringify({ model: "test" }),
    });
    // Try to record a queued decision (should not overwrite)
    const { recordDecision } = await import("@/src/pipeline/dedupe");
    await recordDecision(db, a.id, b.id, 0.5, "queued", JSON.stringify({ possible: true }));
    const after = await db
      .select()
      .from(mergeDecisions)
      .where(and(eq(mergeDecisions.eventA, a.id), eq(mergeDecisions.eventB, b.id)));
    expect(after[0]?.decision).toBe("llm_merge");
    expect(after[0]?.score).toBe(0.8);
  });

  it("recordDecision updates queued row with new score", async () => {
    await write(ticketing, [
      event(
        ticketing,
        {
          title: "Event C",
          dancing_time: "22:00",
          venue: { name: "Venue V" },
        },
        "t4",
      ),
    ]);
    await write(firstParty, [
      event(
        firstParty,
        {
          title: "Event D",
          dancing_time: "22:00",
          venue: { name: "Venue V" },
        },
        "f4",
      ),
    ]);
    const rows = await db.select().from(events).where(eq(events.nightDate, "2026-10-17"));
    const [a, b] = rows as [(typeof rows)[number], (typeof rows)[number]];
    // First insert queued
    await db.insert(mergeDecisions).values({
      id: pipelineId("merge", `${a.id}:${b.id}`),
      eventA: a.id,
      eventB: b.id,
      score: 0.3,
      decision: "queued",
      reasoning: JSON.stringify({ possible: true }),
    });
    const { recordDecision } = await import("@/src/pipeline/dedupe");
    await recordDecision(db, a.id, b.id, 0.7, "queued", JSON.stringify({ possible: true }));
    const after = await db
      .select()
      .from(mergeDecisions)
      .where(and(eq(mergeDecisions.eventA, a.id), eq(mergeDecisions.eventB, b.id)));
    expect(after[0]?.decision).toBe("queued");
    expect(after[0]?.score).toBe(0.7);
  });

  it("pair with llm_distinct is not merged and not in possible duplicates", async () => {
    await write(ticketing, [
      event(
        ticketing,
        {
          title: "Salsa Night",
          dancing_time: "22:00",
          venue: { name: "Venue V" },
        },
        "t5",
      ),
    ]);
    await write(firstParty, [
      event(
        firstParty,
        {
          title: "Salsa Social",
          dancing_time: "22:00",
          venue: { name: "Venue V" },
        },
        "f5",
      ),
    ]);
    const rows = await db.select().from(events).where(eq(events.nightDate, "2026-10-17"));
    const [a, b] = rows as [(typeof rows)[number], (typeof rows)[number]];
    // Insert llm_distinct
    await db.insert(mergeDecisions).values({
      id: pipelineId("merge", `${a.id}:${b.id}`),
      eventA: a.id,
      eventB: b.id,
      score: 0.5,
      decision: "llm_distinct",
      reasoning: JSON.stringify({ model: "test", reason: "different events" }),
    });
    const report = await dedupeMetro(db, metro, ["2026-10-17"]);
    expect(report.merged).toBe(0);
    // Should not appear in possible duplicates because distinct pairs are excluded.
    expect(
      report.possible.some((p) => p.includes("Salsa Night") && p.includes("Salsa Social")),
    ).toBe(false);
  });
});
