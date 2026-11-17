import { describe, expect, it } from "vitest";
import { scorePair, sameTitleSameEnd } from "@/src/domain/dedupe";
import type { DedupeSide, PairFacts } from "@/src/domain/dedupe";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach } from "vitest";

import type { HarvestedListing, Metro, Source } from "@/src/adapters/types";
import type { Db } from "@/src/db/client";
import { events, metros } from "@/src/db/schema";
import { rawListingSchema } from "@/src/domain/listing";
import { EMPTY_BLOCKLIST } from "@/src/pipeline/blocklist";
import { dedupeMetro } from "@/src/pipeline/dedupe";
import { normalizeListing } from "@/src/pipeline/normalize";
import { loadMetro, resolveVenue, upsertSource, writeEvents } from "@/src/pipeline/store";
import { closeTestDb, describeDb, requireDbInCi, resetDb, testDb } from "@/tests/unit/db-harness";

requireDbInCi();

const NOW = new Date("2026-11-05T16:00:00Z");
let db: Db;
let metro: Metro;
let ticketing: Source;
let firstParty: Source;

const VENUE_POINT_A = { lat: 40.7128, lng: -74.006 };
const VENUE_POINT_B = { lat: 40.7128, lng: -74.006 }; // same point

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
      local_date: "2026-11-05",
      ...fields,
    }),
    externalId: id,
    tz: null,
    venueLocation: venueLocation === undefined ? VENUE_POINT_A : venueLocation,
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

describe("sameTitleSameEnd pure function", () => {
  it("returns true when titles normalized equal and ends equal", () => {
    const a = { titleNormalized: "the do-over", endsAt: new Date("2026-11-06T04:00:00Z") };
    const b = { titleNormalized: "the do-over", endsAt: new Date("2026-11-06T04:00:00Z") };
    expect(sameTitleSameEnd(a, b)).toBe(true);
  });

  it("returns false when titles differ", () => {
    const a = { titleNormalized: "the do-over", endsAt: new Date("2026-11-06T04:00:00Z") };
    const b = {
      titleNormalized: "the do-over: 20 year anniversary",
      endsAt: new Date("2026-11-06T04:00:00Z"),
    };
    expect(sameTitleSameEnd(a, b)).toBe(false);
  });

  it("returns false when ends differ", () => {
    const a = { titleNormalized: "the do-over", endsAt: new Date("2026-11-06T04:00:00Z") };
    const b = { titleNormalized: "the do-over", endsAt: new Date("2026-11-06T02:00:00Z") };
    expect(sameTitleSameEnd(a, b)).toBe(false);
  });

  it("returns false when titleNormalized missing", () => {
    const a = { titleNormalized: null, endsAt: new Date("2026-11-06T04:00:00Z") };
    const b = { titleNormalized: "the do-over", endsAt: new Date("2026-11-06T04:00:00Z") };
    expect(sameTitleSameEnd(a, b)).toBe(false);
  });
});

describe("scorePair with same title and end", () => {
  const baseSide = (
    id: string,
    venueId: string | null,
    startsAt: Date | null,
    endsAt: Date | null,
    titleNormalized: string,
    venuePoint?: { lat: number; lng: number },
  ): DedupeSide => ({
    id,
    startsAt,
    endsAt,
    organizerId: null,
    organizerName: null,
    venueId,
    ticketUrl: null,
    canonicalUrl: null,
    trust: "ticketing",
    firstSeenAt: new Date("2026-10-01T00:00:00Z"),
    title: titleNormalized,
    titleNormalized,
    venuePoint,
  });

  it("auto-merges when same title, same end, same point, starts 120 min apart", () => {
    const a = baseSide(
      "a1",
      null,
      new Date("2026-11-05T22:00:00Z"),
      new Date("2026-11-06T04:00:00Z"),
      "the do-over",
      { lat: 40.7128, lng: -74.006 },
    );
    const b = baseSide(
      "b1",
      null,
      new Date("2026-11-05T20:00:00Z"),
      new Date("2026-11-06T04:00:00Z"),
      "the do-over",
      { lat: 40.7128, lng: -74.006 },
    );
    const facts: PairFacts = {
      titleSimilarity: 1.0,
      organizerSimilarity: null,
    };
    const scored = scorePair(a, b, facts);
    expect(scored.decision).toBe("auto_merge");
  });

  it("does not auto-merge when ends differ", () => {
    const a = baseSide(
      "a2",
      null,
      new Date("2026-11-05T22:00:00Z"),
      new Date("2026-11-06T04:00:00Z"),
      "the do-over",
      { lat: 40.7128, lng: -74.006 },
    );
    const b = baseSide(
      "b2",
      null,
      new Date("2026-11-05T20:00:00Z"),
      new Date("2026-11-06T02:00:00Z"),
      "the do-over",
      { lat: 40.7128, lng: -74.006 },
    );
    const facts: PairFacts = {
      titleSimilarity: 1.0,
      organizerSimilarity: null,
    };
    const scored = scorePair(a, b, facts);
    expect(scored.decision).not.toBe("auto_merge");
  });
});

describeDb("same title, same end, far start dedupe", () => {
  beforeAll(async () => {
    db = await testDb("dedupe_same_end");
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
      url: "https://ra.co/",
      kind: "ticketing_api",
      trustTier: "ticketing",
      discoveredBy: "seed_list",
    });
    firstParty = await upsertSource(db, metro.id, {
      url: "https://dice.fm/",
      kind: "ticketing_api",
      trustTier: "ticketing",
      discoveredBy: "seed_list",
    });
  });

  it("merges two sources with same title, same point, same end, starts 120 min apart", async () => {
    // RA: starts 22:00, ends 04:00, venue "314 Scholes"
    await write(ticketing, [
      event(
        ticketing,
        {
          title: "The Do-Over: 20 Year Anniversary",
          dancing_time: "22:00",
          end_time: "04:00",
          venue: { name: "314 Scholes" },
        },
        "ra1",
        VENUE_POINT_A,
      ),
    ]);
    // DICE: starts 20:00, ends 04:00, venue "314 Scholes Street"
    await write(firstParty, [
      event(
        firstParty,
        {
          title: "The Do-Over: 20 Year Anniversary",
          dancing_time: "20:00",
          end_time: "04:00",
          venue: { name: "314 Scholes Street" },
        },
        "dice1",
        VENUE_POINT_B,
      ),
    ]);
    const report = await dedupeMetro(db, metro, ["2026-11-05"]);
    expect(report.merged).toBe(1);
    const rows = await db.select().from(events).where(eq(events.nightDate, "2026-11-05"));
    expect(rows.filter((r) => r.status === "merged")).toHaveLength(1);
  });

  it("does not merge when ends differ", async () => {
    await write(ticketing, [
      event(
        ticketing,
        {
          title: "The Do-Over: 20 Year Anniversary",
          dancing_time: "22:00",
          end_time: "04:00",
          venue: { name: "314 Scholes" },
        },
        "ra2",
        VENUE_POINT_A,
      ),
    ]);
    await write(firstParty, [
      event(
        firstParty,
        {
          title: "The Do-Over: 20 Year Anniversary",
          dancing_time: "20:00",
          end_time: "02:00",
          venue: { name: "314 Scholes Street" },
        },
        "dice2",
        VENUE_POINT_B,
      ),
    ]);
    const report = await dedupeMetro(db, metro, ["2026-11-05"]);
    expect(report.merged).toBe(0);
    const rows = await db.select().from(events).where(eq(events.nightDate, "2026-11-05"));
    expect(rows.filter((r) => r.status === "active")).toHaveLength(2);
  });

  it("does not merge when venues far apart", async () => {
    const farPoint = { lat: 40.8, lng: -74.1 };
    await write(ticketing, [
      event(
        ticketing,
        {
          title: "The Do-Over: 20 Year Anniversary",
          dancing_time: "22:00",
          end_time: "04:00",
          venue: { name: "314 Scholes" },
        },
        "ra3",
        VENUE_POINT_A,
      ),
    ]);
    await write(firstParty, [
      event(
        firstParty,
        {
          title: "The Do-Over: 20 Year Anniversary",
          dancing_time: "20:00",
          end_time: "04:00",
          venue: { name: "Far Venue" },
        },
        "dice3",
        farPoint,
      ),
    ]);
    const report = await dedupeMetro(db, metro, ["2026-11-05"]);
    expect(report.merged).toBe(0);
    const rows = await db.select().from(events).where(eq(events.nightDate, "2026-11-05"));
    expect(rows.filter((r) => r.status === "active")).toHaveLength(2);
  });
});
