// One night at one venue and start, listed twice (D-150): the one-venue-one-start rule in a real
// dedupe pass, one source naming a night twice, and the possible-duplicates report.
import { and, eq, or } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";

import type { HarvestedListing, Metro, Source } from "@/src/adapters/types";
import type { Db } from "@/src/db/client";
import { events, mergeDecisions, metros } from "@/src/db/schema";
import { rawListingSchema } from "@/src/domain/listing";
import { EMPTY_BLOCKLIST } from "@/src/pipeline/blocklist";
import { dedupeMetro } from "@/src/pipeline/dedupe";
import { normalizeListing } from "@/src/pipeline/normalize";
import { loadMetro, resolveVenue, upsertSource, writeEvents } from "@/src/pipeline/store";
import { closeTestDb, describeDb, requireDbInCi, resetDb, testDb } from "@/tests/unit/db-harness";

requireDbInCi();

const NOW = new Date("2026-10-17T16:00:00Z");
let db: Db;
let metro: Metro;
let ticketing: Source;
let firstParty: Source;

const VENUE_POINT = { lat: 40.7652, lng: -73.9942 };

function event(
  source: Source,
  fields: Record<string, unknown>,
  id: string,
  venueLocation?: { lat: number; lng: number } | null,
) {
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
    venueLocation: venueLocation === undefined ? VENUE_POINT : venueLocation,
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

describeDb("one-venue-one-start rule (D-150)", () => {
  beforeAll(async () => {
    db = await testDb("dedupe_core");
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

  it("merges two sources listing 'Black Coffee' and 'Black Coffee - Ages 21+' at same venue and start", async () => {
    await write(ticketing, [
      event(
        ticketing,
        {
          title: "Black Coffee",
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
          title: "Black Coffee - Ages 21+",
          dancing_time: "22:00",
          venue: { name: "Venue V" },
        },
        "f1",
      ),
    ]);
    const report = await dedupeMetro(db, metro, ["2026-10-17"]);
    expect(report.merged).toBe(1);
    const rows = await db.select().from(events).where(eq(events.nightDate, "2026-10-17"));
    expect(rows.filter((r) => r.status === "merged")).toHaveLength(1);
  });

  it("merges one source listing 'Mireya' and 'Mireya Ramos (of Flor de Toloache)' at same venue and start", async () => {
    await write(firstParty, [
      event(
        firstParty,
        {
          title: "Mireya",
          dancing_time: "22:00",
          venue: { name: "Venue V" },
        },
        "a",
      ),
      event(
        firstParty,
        {
          title: "Mireya Ramos (of Flor de Toloache)",
          dancing_time: "22:00",
          venue: { name: "Venue V" },
        },
        "b",
      ),
    ]);
    const report = await dedupeMetro(db, metro, ["2026-10-17"]);
    expect(report.merged).toBe(1);
    const rows = await db.select().from(events).where(eq(events.nightDate, "2026-10-17"));
    expect(rows.filter((r) => r.status === "merged")).toHaveLength(1);
  });

  it("keeps 'Salsa' and 'Salsa Level 2' from one source at same venue and start (generic words)", async () => {
    await write(firstParty, [
      event(
        firstParty,
        {
          title: "Salsa",
          dancing_time: "22:00",
          venue: { name: "Venue V" },
        },
        "c",
      ),
      event(
        firstParty,
        {
          title: "Salsa Level 2",
          dancing_time: "22:00",
          venue: { name: "Venue V" },
        },
        "d",
      ),
    ]);
    const report = await dedupeMetro(db, metro, ["2026-10-17"]);
    expect(report.merged).toBe(0);
    expect(report.queued).toBe(0);
    const rows = await db.select().from(events).where(eq(events.nightDate, "2026-10-17"));
    expect(rows.filter((r) => r.status === "active")).toHaveLength(2);
  });

  it("keeps 'Mireya' and 'Mireya Ramos' at different starts", async () => {
    await write(firstParty, [
      event(
        firstParty,
        {
          title: "Mireya",
          dancing_time: "22:00",
          venue: { name: "Venue V" },
        },
        "e",
      ),
      event(
        firstParty,
        {
          title: "Mireya Ramos",
          dancing_time: "23:00",
          venue: { name: "Venue V" },
        },
        "f",
      ),
    ]);
    const report = await dedupeMetro(db, metro, ["2026-10-17"]);
    expect(report.merged).toBe(0);
    const rows = await db.select().from(events).where(eq(events.nightDate, "2026-10-17"));
    expect(rows.filter((r) => r.status === "active")).toHaveLength(2);
  });

  it("does not merge a cancelled listing with an active one at same venue and start", async () => {
    await write(ticketing, [
      event(
        ticketing,
        {
          title: "A Barn Dance",
          dancing_time: "22:00",
          venue: { name: "Venue V" },
        },
        "g",
      ),
    ]);
    await write(firstParty, [
      event(
        firstParty,
        {
          title: "CANCELLED: A Barn Dance",
          dancing_time: "22:00",
          venue: { name: "Venue V" },
          cancelled: true,
        },
        "h",
      ),
    ]);
    const report = await dedupeMetro(db, metro, ["2026-10-17"]);
    expect(report.merged).toBe(0);
    const rows = await db.select().from(events).where(eq(events.nightDate, "2026-10-17"));
    expect(rows.filter((r) => r.status === "active")).toHaveLength(1);
    expect(rows.filter((r) => r.confirmation === "cancelled")).toHaveLength(1);
  });

  it("adds to possible duplicates when titles share a non-generic word", async () => {
    await write(ticketing, [
      event(
        ticketing,
        {
          title: "Gypsy Jazz with Diego",
          dancing_time: "22:00",
          venue: { name: "Venue V" },
        },
        "i",
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
        "j",
      ),
    ]);
    const report = await dedupeMetro(db, metro, ["2026-10-17"]);
    expect(report.merged).toBe(0);
    expect(report.possible).toHaveLength(1);
    expect(report.possible[0]).toMatch(/Gypsy Jazz with Diego.*Gypsy Jazz with Ana/);
  });

  it("merges unplaced listings that share a ticket link", async () => {
    const ticketing2 = await upsertSource(db, metro.id, {
      url: "https://dice.fm/browse/b",
      kind: "ticketing_api",
      trustTier: "ticketing",
      discoveredBy: "seed_list",
    });
    const commonTicket = "https://dice.fm/event/abc";
    await write(ticketing, [
      event(
        ticketing,
        {
          title: "The Capulet Ball",
          dancing_time: "20:00",
          ticket_url: commonTicket,
          venue: {},
        },
        "unplaced1",
        null,
      ),
    ]);
    await write(ticketing2, [
      event(
        ticketing2,
        {
          title: "The Capulet Ball",
          dancing_time: "20:00",
          ticket_url: commonTicket,
          venue: {},
        },
        "unplaced2",
        null,
      ),
    ]);
    const report = await dedupeMetro(db, metro, ["2026-10-17"]);
    expect(report.merged).toBe(1);
    const rows = await db.select().from(events).where(eq(events.nightDate, "2026-10-17"));
    expect(rows.filter((r) => r.status === "merged")).toHaveLength(1);
  });

  it("does not merge unplaced listings with different ticket links", async () => {
    const ticketing2 = await upsertSource(db, metro.id, {
      url: "https://dice.fm/browse/b",
      kind: "ticketing_api",
      trustTier: "ticketing",
      discoveredBy: "seed_list",
    });
    await write(ticketing, [
      event(
        ticketing,
        {
          title: "The Capulet Ball",
          dancing_time: "20:00",
          ticket_url: "https://dice.fm/event/abc",
          venue: {},
        },
        "diff1",
        null,
      ),
    ]);
    await write(ticketing2, [
      event(
        ticketing2,
        {
          title: "The Capulet Ball",
          dancing_time: "20:00",
          ticket_url: "https://dice.fm/event/xyz",
          venue: {},
        },
        "diff2",
        null,
      ),
    ]);
    const report = await dedupeMetro(db, metro, ["2026-10-17"]);
    expect(report.merged).toBe(0);
    const rows = await db.select().from(events).where(eq(events.nightDate, "2026-10-17"));
    expect(rows.filter((r) => r.status === "merged")).toHaveLength(0);
  });

  it("flags unlike titles from two sources at one venue and start", async () => {
    await write(ticketing, [
      event(
        ticketing,
        {
          title: "Tiki Disco",
          dancing_time: "22:00",
          venue: { name: "Venue V" },
        },
        "tiki",
      ),
    ]);
    await write(firstParty, [
      event(
        firstParty,
        {
          title: "Afrobeats Night",
          dancing_time: "22:00",
          venue: { name: "Venue V" },
        },
        "afro",
      ),
    ]);
    const report = await dedupeMetro(db, metro, ["2026-10-17"]);
    expect(report.merged).toBe(0);
    expect(report.sameSlot).toHaveLength(1);
    expect(report.sameSlot[0]).toMatch(
      /Tiki Disco \| Afrobeats Night|Afrobeats Night \| Tiki Disco/,
    );
    expect(report.possible).toHaveLength(0);
    // Check that a merge_decisions row with decision 'queued' exists for the pair
    const rows = await db.select().from(events).where(eq(events.nightDate, "2026-10-17"));
    const [a, b] = rows as [(typeof rows)[number], (typeof rows)[number]];
    const decision = await db
      .select()
      .from(mergeDecisions)
      .where(
        and(
          or(eq(mergeDecisions.eventA, a.id), eq(mergeDecisions.eventA, b.id)),
          or(eq(mergeDecisions.eventB, a.id), eq(mergeDecisions.eventB, b.id)),
        ),
      );
    expect(decision).toHaveLength(1);
    expect(decision[0]?.decision).toBe("queued");
  });

  it("does not flag one source's two listings at one venue and start", async () => {
    await write(firstParty, [
      event(
        firstParty,
        {
          title: "Salsa Level 1",
          dancing_time: "20:00",
          venue: { name: "Venue V" },
        },
        "p",
      ),
      event(
        firstParty,
        {
          title: "Bachata Basics",
          dancing_time: "20:00",
          venue: { name: "Venue V" },
        },
        "q",
      ),
    ]);
    const report = await dedupeMetro(db, metro, ["2026-10-17"]);
    expect(report.sameSlot).toHaveLength(0);
  });

  it("does not flag unlike titles at different starts", async () => {
    await write(ticketing, [
      event(
        ticketing,
        {
          title: "Tiki Disco",
          dancing_time: "20:00",
          venue: { name: "Venue V" },
        },
        "tiki2",
      ),
    ]);
    await write(firstParty, [
      event(
        firstParty,
        {
          title: "Afrobeats Night",
          dancing_time: "22:00",
          venue: { name: "Venue V" },
        },
        "afro2",
      ),
    ]);
    const report = await dedupeMetro(db, metro, ["2026-10-17"]);
    expect(report.sameSlot).toHaveLength(0);
  });
});
