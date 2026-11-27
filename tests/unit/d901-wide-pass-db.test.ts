// D-901: the wide pass in the database. Two ticket sites list one night with different venue names
// or times the old candidate gates never paired (live scan, New York, 2026-11-27).
import { and, eq } from "drizzle-orm";
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

const NOW = new Date("2026-11-27T16:00:00Z");
const NIGHT = "2026-11-28";
const MEADOWS = { name: "The Meadows", point: { lat: 40.70636, lng: -73.93273 } };
const MONARCH = { name: "The Brooklyn Monarch", point: { lat: 40.70653, lng: -73.93248 } };
const PACHA_NY = { name: "Pacha New York", point: { lat: 40.7616, lng: -73.9993 } };
const BROOKLYN_PACHA = { name: "Brooklyn Pacha", point: { lat: 40.7177, lng: -73.9582 } };

let db: Db;
let metro: Metro;
let dice: Source;
let ra: Source;

function listing(
  source: Source,
  title: string,
  time: string,
  venue: { name: string; point: { lat: number; lng: number } },
  id: string,
) {
  const harvested: HarvestedListing = {
    listing: rawListingSchema.parse({
      title,
      listing_type: "party",
      styles: ["house"],
      venue: { name: venue.name },
      organizer: {},
      local_date: NIGHT,
      doors_time: time,
    }),
    externalId: id,
    tz: null,
    venueLocation: venue.point,
    recurrence: null,
    provenance: { sourceUrl: `${source.url}${id}`, fetchedAt: NOW, method: "api" },
  };
  const outcome = normalizeListing(harvested, { metro, source, now: NOW });
  if (!outcome.ok) throw new Error(outcome.reason);
  return outcome.event;
}

async function write(source: Source, list: ReturnType<typeof listing>[]) {
  return writeEvents(db, {
    metro,
    source,
    events: list,
    blocklist: EMPTY_BLOCKLIST,
    placeVenue: (input) => resolveVenue(db, metro, input),
  });
}

const active = async () =>
  (await db.select().from(events).where(eq(events.nightDate, NIGHT))).filter(
    (r) => r.status === "active",
  );

describeDb("the wide pass (D-901)", () => {
  beforeAll(async () => {
    db = await testDb("d901_wide_pass");
  });
  afterAll(closeTestDb);

  beforeEach(async () => {
    await resetDb();
    await db.insert(metros).values({
      slug: "nyc",
      name: "New York",
      countryCode: "US",
      center: { lat: 40.7128, lng: -74.006 },
      radiusKm: 40,
      tz: "America/New_York",
      languages: ["en"],
    });
    metro = (await loadMetro(db, "nyc"))!;
    dice = await upsertSource(db, metro.id, {
      url: "https://dice.fm/event/",
      kind: "ticketing_api",
      trustTier: "ticketing",
      discoveredBy: "seed_list",
    });
    ra = await upsertSource(db, metro.id, {
      url: "https://ra.co/events/",
      kind: "ticketing_api",
      trustTier: "ticketing",
      discoveredBy: "seed_list",
    });
  });

  it("merges one title two hours apart at the club's two names, which the old gates never paired", async () => {
    await write(dice, [listing(dice, "Tremendo (Mexa Sounds) [21+]", "20:00", MEADOWS, "t1")]);
    await write(ra, [listing(ra, "Tremendo (Mexa Sounds) [21+]", "22:00", MONARCH, "t2")]);
    const report = await dedupeMetro(db, metro, [NIGHT]);
    expect(report.wide.merged).toBe(1);
    expect(report.mergedPairs.map((m) => m.by)).toEqual(["wide"]);
    expect(await active()).toHaveLength(1);
  });

  it("queues one title at one start at two clubs miles apart, and merges it once the model says same", async () => {
    await write(dice, [listing(dice, "Mathame", "22:00", PACHA_NY, "m1")]);
    await write(ra, [listing(ra, "Mathame", "22:00", BROOKLYN_PACHA, "m2")]);
    const first = await dedupeMetro(db, metro, [NIGHT]);
    expect(first.wide).toMatchObject({ pairs: 1, merged: 0, queued: 1 });
    expect(await active()).toHaveLength(2);
    const queued = await db
      .select()
      .from(mergeDecisions)
      .where(eq(mergeDecisions.decision, "queued"));
    expect(queued).toHaveLength(1);

    // The model review's verdict (src/pipeline/dedupe-review.ts) is "same and sure".
    await db
      .update(mergeDecisions)
      .set({ decision: "llm_merge" })
      .where(and(eq(mergeDecisions.id, queued[0]!.id)));
    const second = await dedupeMetro(db, metro, [NIGHT]);
    expect(second.wide.merged).toBe(1);
    expect(second.mergedPairs.map((m) => m.by)).toEqual(["model"]);
    expect(await active()).toHaveLength(1);
  });

  it("never touches a pair the model called distinct", async () => {
    await write(dice, [listing(dice, "Mathame", "22:00", PACHA_NY, "d1")]);
    await write(ra, [listing(ra, "Mathame", "22:00", BROOKLYN_PACHA, "d2")]);
    await dedupeMetro(db, metro, [NIGHT]);
    await db.update(mergeDecisions).set({ decision: "llm_distinct" });
    const again = await dedupeMetro(db, metro, [NIGHT]);
    expect(again.wide).toMatchObject({ merged: 0, queued: 0 });
    expect(await active()).toHaveLength(2);
  });

  it("leaves generic titles alone: two pubs' Live DJ at one time", async () => {
    await write(dice, [listing(dice, "Live DJ", "21:00", MEADOWS, "g1")]);
    await write(ra, [listing(ra, "Live DJ", "21:00", PACHA_NY, "g2")]);
    const report = await dedupeMetro(db, metro, [NIGHT]);
    expect(report.wide).toMatchObject({ merged: 0, queued: 0 });
    expect(await active()).toHaveLength(2);
  });
});
