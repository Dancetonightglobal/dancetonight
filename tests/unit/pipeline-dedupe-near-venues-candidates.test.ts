// D-811: D-803 (#1376) merges two sources' one exact title at one start at two venue rows within 1.5 km, but
// the candidate query only admitted venue rows within 150 m (or near-identical names), so those pairs never
// reached it. Daily check 2026-11-09: London "Fuego" 23:45 at "FIRE Nightclub London" (Skiddle) and "Fire Night
// Club Vauxhall" (DICE), ~170 m apart; NYC "Rhythm in Ritual..." 22:00 at "The Onyx Room at House of Yes" (RA)
// and "House of Yes" (calendar.houseofyes.org), ~1.2 km apart. Both still two cards. Now each is one.
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";

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

const NOW = new Date("2026-11-09T16:00:00Z");
const NIGHT = "2026-11-14";
// The two FIRE rows as stored on prod (diag 42676592684), ~150-170 m apart.
const SKIDDLE_FIRE = { lat: 51.4846, lng: -0.1237 };
const DICE_FIRE = { lat: 51.4861, lng: -0.1228 };
// ~1.2 km apart, as the two House of Yes rows.
const ONYX = { lat: 51.4846, lng: -0.1237 };
const HOUSE = { lat: 51.4904, lng: -0.1102 };
// ~2.2 km apart: beyond D-803's 1.5 km.
const FAR = { lat: 51.4846, lng: -0.0915 };

let db: Db;
let metro: Metro;
let skiddle: Source;
let dice: Source;

function event(
  source: Source,
  fields: Record<string, unknown>,
  id: string,
  venueName: string,
  point: { lat: number; lng: number },
) {
  const harvested: HarvestedListing = {
    listing: rawListingSchema.parse({
      listing_type: "other",
      styles: [],
      venue: { name: venueName },
      organizer: {},
      local_date: NIGHT,
      ...fields,
    }),
    externalId: id,
    eventUrl: `${source.url}${id}`,
    tz: null,
    venueLocation: point,
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

async function live() {
  return (await db.select().from(events).where(eq(events.nightDate, NIGHT))).filter(
    (r) => r.status === "active",
  );
}

async function pair(
  title: [string, string],
  time: string,
  venues: [string, string],
  points: [{ lat: number; lng: number }, { lat: number; lng: number }],
  types: [string, string] = ["other", "other"],
) {
  await write(skiddle, [
    event(
      skiddle,
      { title: title[0], dancing_time: time, listing_type: types[0] },
      "a",
      venues[0],
      points[0],
    ),
  ]);
  await write(dice, [
    event(
      dice,
      { title: title[1], dancing_time: time, listing_type: types[1] },
      "b",
      venues[1],
      points[1],
    ),
  ]);
  const before = await live();
  expect(before).toHaveLength(2);
  expect(before[0]!.venueId).not.toBe(before[1]!.venueId);
}

describeDb("dedupe: D-803 pairs at venue rows over 150 m apart are candidates (D-811)", () => {
  beforeAll(async () => {
    db = await testDb("dedupe_near_venues_candidates");
  });
  afterAll(closeTestDb);

  beforeEach(async () => {
    await resetDb();
    await db.insert(metros).values({
      slug: "london",
      name: "London",
      countryCode: "GB",
      center: { lat: 51.5074, lng: -0.1278 },
      radiusKm: 60,
      tz: "Europe/London",
      languages: ["en"],
    });
    metro = (await loadMetro(db, "london"))!;
    skiddle = await upsertSource(db, metro.id, {
      url: "https://www.skiddle.com/whats-on/",
      kind: "html",
      trustTier: "ticketing",
      discoveredBy: "seed_list",
    });
    dice = await upsertSource(db, metro.id, {
      url: "https://dice.fm/event/",
      kind: "html",
      trustTier: "ticketing",
      discoveredBy: "seed_list",
    });
  });

  it("merges Fuego at FIRE Nightclub London and Fire Night Club Vauxhall", async () => {
    await pair(
      ["Fuego", "Fuego"],
      "23:45",
      ["FIRE Nightclub London", "Fire Night Club Vauxhall"],
      [SKIDDLE_FIRE, DICE_FIRE],
    );
    const report = await dedupeMetro(db, metro, [NIGHT]);
    expect(report.merged).toBe(1);
    expect(await live()).toHaveLength(1);
  });

  it("merges Beyond After Hours at 03:00 at the two FIRE rows", async () => {
    await pair(
      ["Beyond After Hours", "Beyond After Hours"],
      "03:00",
      ["FIRE Nightclub London", "Fire Night Club Vauxhall"],
      [SKIDDLE_FIRE, DICE_FIRE],
    );
    await dedupeMetro(db, metro, [NIGHT]);
    expect(await live()).toHaveLength(1);
  });

  it("merges Rhythm in Ritual at The Onyx Room at House of Yes and House of Yes, 1.2 km apart", async () => {
    const title = "Rhythm in Ritual: Native Sun, JazzyWoo, DJ Shiftee";
    await pair(
      [title, title],
      "22:00",
      ["The Onyx Room at House of Yes", "House of Yes"],
      [ONYX, HOUSE],
      ["other", "club_night"],
    );
    await dedupeMetro(db, metro, [NIGHT]);
    expect(await live()).toHaveLength(1);
  });

  it("keeps two titles at the two FIRE rows apart", async () => {
    await pair(
      ["Fuego", "Beyond After Hours"],
      "23:45",
      ["FIRE Nightclub London", "Fire Night Club Vauxhall"],
      [SKIDDLE_FIRE, DICE_FIRE],
    );
    await dedupeMetro(db, metro, [NIGHT]);
    expect(await live()).toHaveLength(2);
  });

  it("keeps one title at two starts apart", async () => {
    await write(skiddle, [
      event(
        skiddle,
        { title: "Fuego", dancing_time: "22:00" },
        "a",
        "FIRE Nightclub London",
        SKIDDLE_FIRE,
      ),
    ]);
    await write(dice, [
      event(
        dice,
        { title: "Fuego", dancing_time: "23:45" },
        "b",
        "Fire Night Club Vauxhall",
        DICE_FIRE,
      ),
    ]);
    await dedupeMetro(db, metro, [NIGHT]);
    expect(await live()).toHaveLength(2);
  });

  it("keeps one title at one start 2.2 km apart", async () => {
    await pair(
      ["Fuego", "Fuego"],
      "23:45",
      ["Fire Night Club Vauxhall", "Ministry of Sound"],
      [SKIDDLE_FIRE, FAR],
    );
    await dedupeMetro(db, metro, [NIGHT]);
    expect(await live()).toHaveLength(2);
  });
});
