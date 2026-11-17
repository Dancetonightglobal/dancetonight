// Dedupe distinct override (D-150): a model's "distinct" verdict does not block a pair the dedupe rules merge outright.
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

describeDb("dedupe distinct override (D-150)", () => {
  beforeAll(async () => {
    db = await testDb("dedupe_distinct_override");
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

  it("overrides llm_distinct when rules merge outright (same night, same venue, same end)", async () => {
    // Ticketing "Perreo Inferno Oct 31 21+"
    await write(ticketing, [
      event(
        ticketing,
        {
          title: "Perreo Inferno Oct 31 21+",
          dancing_time: "21:45",
          end_time: "05:00",
          venue: { name: "Venue V" },
        },
        "t1",
      ),
    ]);
    // First-party same title, different start, same end
    await write(firstParty, [
      event(
        firstParty,
        {
          title: "Perreo Inferno Oct 31 21+",
          dancing_time: "23:00",
          end_time: "05:00",
          venue: { name: "Venue V" },
        },
        "f1",
      ),
    ]);
    // Insert llm_distinct for the pair
    const rows = await db.select().from(events).where(eq(events.nightDate, "2026-10-17"));
    expect(rows).toHaveLength(2);
    const [a, b] = rows as [(typeof rows)[number], (typeof rows)[number]];
    await db.insert(mergeDecisions).values({
      id: pipelineId("merge", `${a.id}:${b.id}`),
      eventA: a.id,
      eventB: b.id,
      score: 0.5,
      decision: "llm_distinct",
      reasoning: JSON.stringify({ model: "test", reason: "different events" }),
    });

    const report = await dedupeMetro(db, metro, ["2026-10-17"]);
    // Should merge despite llm_distinct because rules now merge outright (auto_merge)
    expect(report.merged).toBe(1);
    const after = await db.select().from(events).where(eq(events.nightDate, "2026-10-17"));
    expect(after.filter((r) => r.status === "merged")).toHaveLength(1);
  });

  it("respects manual_distinct even when rules would merge", async () => {
    await write(ticketing, [
      event(
        ticketing,
        {
          title: "Perreo Inferno Oct 31 21+",
          dancing_time: "21:45",
          end_time: "05:00",
          venue: { name: "Venue V" },
        },
        "t2",
      ),
    ]);
    await write(firstParty, [
      event(
        firstParty,
        {
          title: "Perreo Inferno Oct 31 21+",
          dancing_time: "23:00",
          end_time: "05:00",
          venue: { name: "Venue V" },
        },
        "f2",
      ),
    ]);
    const rows = await db.select().from(events).where(eq(events.nightDate, "2026-10-17"));
    const [a, b] = rows as [(typeof rows)[number], (typeof rows)[number]];
    await db.insert(mergeDecisions).values({
      id: pipelineId("merge", `${a.id}:${b.id}`),
      eventA: a.id,
      eventB: b.id,
      score: 0.5,
      decision: "manual_distinct",
      reasoning: JSON.stringify({ reason: "person said distinct" }),
    });

    const report = await dedupeMetro(db, metro, ["2026-10-17"]);
    // manual_distinct always blocks
    expect(report.merged).toBe(0);
    const after = await db.select().from(events).where(eq(events.nightDate, "2026-10-17"));
    expect(after.every((r) => r.status === "active")).toBe(true);
  });

  it("keeps llm_distinct blocking when score is below auto-merge (queued)", async () => {
    // Two listings with unalike titles at one venue and start, score below auto-merge
    await write(ticketing, [
      event(
        ticketing,
        {
          title: "Gypsy Jazz with Diego",
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
          title: "Gypsy Jazz with Ana",
          dancing_time: "22:00",
          venue: { name: "Venue V" },
        },
        "f3",
      ),
    ]);
    const rows = await db.select().from(events).where(eq(events.nightDate, "2026-10-17"));
    const [a, b] = rows as [(typeof rows)[number], (typeof rows)[number]];
    await db.insert(mergeDecisions).values({
      id: pipelineId("merge", `${a.id}:${b.id}`),
      eventA: a.id,
      eventB: b.id,
      score: 0.5,
      decision: "llm_distinct",
      reasoning: JSON.stringify({ model: "test", reason: "different events" }),
    });

    const report = await dedupeMetro(db, metro, ["2026-10-17"]);
    // Should not merge (score not high enough) and llm_distinct remains blocking
    expect(report.merged).toBe(0);
    expect(report.queued).toBe(0); // not queued because distinct blocks
    const after = await db.select().from(events).where(eq(events.nightDate, "2026-10-17"));
    expect(after.every((r) => r.status === "active")).toBe(true);
  });

  it("overrides llm_distinct when one exact title at one venue starts up to 3 hours apart (D-769, D-788)", async () => {
    // NOTO 11-12: the model called the pair distinct before D-769; the venue's page says 8pm, DICE 10pm.
    await write(ticketing, [
      event(
        ticketing,
        { title: "PTO Thursdays: Mha Iri", dancing_time: "22:00", venue: { name: "Venue V" } },
        "t4",
      ),
    ]);
    await write(firstParty, [
      event(
        firstParty,
        { title: "PTO Thursdays: Mha Iri", dancing_time: "20:00", venue: { name: "Venue V" } },
        "f4",
      ),
    ]);
    const rows = await db.select().from(events).where(eq(events.nightDate, "2026-10-17"));
    expect(rows).toHaveLength(2);
    const [a, b] = rows as [(typeof rows)[number], (typeof rows)[number]];
    await db.insert(mergeDecisions).values({
      id: pipelineId("merge", `${a.id}:${b.id}`),
      eventA: a.id,
      eventB: b.id,
      score: 0.5,
      decision: "llm_distinct",
      reasoning: JSON.stringify({ model: "test", reason: "different start times" }),
    });

    const report = await dedupeMetro(db, metro, ["2026-10-17"]);
    expect(report.merged).toBe(1);
    const after = await db.select().from(events).where(eq(events.nightDate, "2026-10-17"));
    expect(after.filter((r) => r.status === "merged")).toHaveLength(1);
  });
});
