// Model verdicts on pairs from one source, and on a class beside a night that is not one (D-150).
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
const NIGHT = "2026-10-17";
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
      local_date: NIGHT,
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

async function nightRows() {
  return db.select().from(events).where(eq(events.nightDate, NIGHT));
}

/** Records the model's "same" verdict for the night's two listings. */
async function modelCallsSame() {
  const rows = await nightRows();
  expect(rows).toHaveLength(2);
  const [a, b] = rows.map((r) => r.id).sort();
  if (!a || !b) throw new Error("expected two events");
  await db.insert(mergeDecisions).values({
    id: pipelineId("merge", `${a}:${b}`),
    eventA: a,
    eventB: b,
    score: 0.5,
    decision: "llm_merge",
    reasoning: JSON.stringify({ model: "test", reason: "same event" }),
  });
}

describeDb("dedupe model verdicts on one source and on classes (D-150)", () => {
  beforeAll(async () => {
    db = await testDb("dedupe_same_source");
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
      url: "https://www.eventbrite.com/",
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

  it("merges one platform's two pages for a night when the model called them same", async () => {
    await write(ticketing, [
      event(
        ticketing,
        {
          title: "The Haunting on the Roof",
          listing_type: "club_night",
          dancing_time: "22:00",
          venue: { name: "High Bar" },
        },
        "t1",
      ),
      event(
        ticketing,
        {
          title: "Halloween Perreo on the Roof",
          listing_type: "club_night",
          dancing_time: "22:00",
          venue: { name: "High Bar" },
        },
        "t2",
      ),
    ]);
    await modelCallsSame();

    const report = await dedupeMetro(db, metro, [NIGHT]);
    expect(report.merged).toBe(1);
    expect(report.mergedPairs[0]?.by).toBe("model");
    const after = await nightRows();
    expect(after.filter((r) => r.status === "merged")).toHaveLength(1);
  });

  it("never acts on a model verdict for two listings of a first-party source", async () => {
    await write(firstParty, [
      event(
        firstParty,
        {
          title: "The Haunting on the Roof",
          listing_type: "club_night",
          dancing_time: "22:00",
          venue: { name: "High Bar" },
        },
        "f1",
      ),
      event(
        firstParty,
        {
          title: "Halloween Perreo on the Roof",
          listing_type: "club_night",
          dancing_time: "22:00",
          venue: { name: "High Bar" },
        },
        "f2",
      ),
    ]);
    await modelCallsSame();

    const report = await dedupeMetro(db, metro, [NIGHT]);
    expect(report.merged).toBe(0);
    const after = await nightRows();
    expect(after.every((r) => r.status === "active")).toBe(true);
  });

  it("never merges a class with a non-class on a model verdict, one source", async () => {
    await write(ticketing, [
      event(
        ticketing,
        {
          title: "WCS Level 3 with Sophie",
          listing_type: "class",
          dancing_time: "22:00",
          venue: { name: "Big Apple Ballroom" },
        },
        "t3",
      ),
      event(
        ticketing,
        {
          title: "PRACTICE",
          listing_type: "practica",
          dancing_time: "22:00",
          venue: { name: "Big Apple Ballroom" },
        },
        "t4",
      ),
    ]);
    await modelCallsSame();

    const report = await dedupeMetro(db, metro, [NIGHT]);
    expect(report.merged).toBe(0);
    const after = await nightRows();
    expect(after.every((r) => r.status === "active")).toBe(true);
  });

  it("never merges a class with a non-class on a model verdict, two sources", async () => {
    await write(ticketing, [
      event(
        ticketing,
        {
          title: "WCS Level 3 with Sophie",
          listing_type: "class",
          dancing_time: "22:00",
          venue: { name: "Big Apple Ballroom" },
        },
        "t5",
      ),
    ]);
    await write(firstParty, [
      event(
        firstParty,
        {
          title: "PRACTICE",
          listing_type: "practica",
          dancing_time: "22:00",
          venue: { name: "Big Apple Ballroom" },
        },
        "f5",
      ),
    ]);
    await modelCallsSame();

    const report = await dedupeMetro(db, metro, [NIGHT]);
    expect(report.merged).toBe(0);
    const after = await nightRows();
    expect(after.every((r) => r.status === "active")).toBe(true);
  });

  it("does not queue two first-party listings at one venue and start for model review", async () => {
    await write(firstParty, [
      event(
        firstParty,
        {
          title: "Salsa Rueda Night",
          listing_type: "social",
          dancing_time: "22:00",
          venue: { name: "Venue V" },
        },
        "f6",
      ),
      event(
        firstParty,
        {
          title: "Salsa Rueda Class",
          listing_type: "social",
          dancing_time: "22:00",
          venue: { name: "Venue V" },
        },
        "f7",
      ),
    ]);

    const report = await dedupeMetro(db, metro, [NIGHT]);
    expect(report.merged).toBe(0);
    const queued = await db
      .select()
      .from(mergeDecisions)
      .where(and(eq(mergeDecisions.decision, "queued")));
    expect(queued).toHaveLength(0);
  });
});
