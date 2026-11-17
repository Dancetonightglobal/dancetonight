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

// D-879 (daily check 11-12, London): ruedalibre lists "Sambroso Cuban Sundays" at "Juju's Bar and Stage", DICE
// lists "Cuban Sundays" at "Ely's Yard Social", both 4pm-11pm. Both venue rows hold one street-only address
// ("Hanbury Street, London E1 5JP", no house number) at one point, so the street-address rule could not say they
// are one place and both cards showed every Sunday. One street-only address at one point, one start and one end,
// and one title's words inside the other's: one night. A generic short title, or starts hours apart, stay two.

const NOW = new Date("2026-11-12T16:00:00Z");
const NIGHT = "2026-11-15";
const HANBURY = { lat: 51.520431, lng: -0.071193 };
const STREET_ONLY = "Hanbury Street, London E1 5JP";

let db: Db;
let metro: Metro;
let ruedalibre: Source;
let dice: Source;

function event(
  source: Source,
  fields: Record<string, unknown>,
  id: string,
  venueName: string,
  point: { lat: number; lng: number } = HANBURY,
  address: string = STREET_ONLY,
) {
  const harvested: HarvestedListing = {
    listing: rawListingSchema.parse({
      listing_type: "social",
      styles: ["salsa"],
      venue: { name: venueName, address },
      organizer: {},
      local_date: NIGHT,
      ...fields,
    }),
    externalId: id,
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

async function active() {
  const rows = await db.select().from(events).where(eq(events.nightDate, NIGHT));
  return rows.filter((r) => r.status === "active");
}

describeDb("two venue rows at one street-only address and point (D-879)", () => {
  beforeAll(async () => {
    db = await testDb("dedupe_street_point_twin");
  });
  afterAll(closeTestDb);

  beforeEach(async () => {
    await resetDb();
    await db.insert(metros).values({
      slug: "london",
      name: "London",
      countryCode: "GB",
      center: { lat: 51.5074, lng: -0.1278 },
      radiusKm: 50,
      tz: "Europe/London",
      languages: ["en"],
    });
    metro = (await loadMetro(db, "london"))!;
    ruedalibre = await upsertSource(db, metro.id, {
      url: "https://ruedalibre.co.uk/events/",
      kind: "jsonld",
      trustTier: "directory",
      discoveredBy: "seed_list",
    });
    dice = await upsertSource(db, metro.id, {
      url: "https://dice.fm/browse/london",
      kind: "ticketing_api",
      trustTier: "ticketing",
      discoveredBy: "seed_list",
    });
  });

  it("merges Sambroso Cuban Sundays at Juju's into Cuban Sundays at Ely's Yard", async () => {
    await write(ruedalibre, [
      event(
        ruedalibre,
        { title: "Sambroso Cuban Sundays", doors_time: "16:00", end_time: "23:00" },
        "rl1",
        "Juju's Bar and Stage",
      ),
    ]);
    await write(dice, [
      event(
        dice,
        { title: "Cuban Sundays", listing_type: "other", doors_time: "16:00", end_time: "23:00" },
        "dice1",
        "Ely's Yard Social",
      ),
    ]);
    const report = await dedupeMetro(db, metro, [NIGHT]);
    expect(report.merged).toBe(1);
    expect(await active()).toHaveLength(1);
  });

  it("merges them at their own numbered address too (15 Hanbury Street, once Kizuna's entry lets it be)", async () => {
    const numbered = "15 Hanbury Street, London E1 6QR";
    await write(ruedalibre, [
      event(
        ruedalibre,
        { title: "Sambroso Cuban Sundays", doors_time: "16:00", end_time: "23:00" },
        "rl5",
        "Juju's Bar and Stage",
        HANBURY,
        numbered,
      ),
    ]);
    await write(dice, [
      event(
        dice,
        { title: "Cuban Sundays", listing_type: "other", doors_time: "16:00", end_time: "23:00" },
        "dice5",
        "Ely's Yard Social",
        HANBURY,
        numbered,
      ),
    ]);
    const report = await dedupeMetro(db, metro, [NIGHT]);
    expect(report.merged).toBe(1);
    expect(await active()).toHaveLength(1);
  });

  it("keeps two nights when the short title is generic (Salsa Sundays)", async () => {
    await write(ruedalibre, [
      event(
        ruedalibre,
        { title: "Cuban Salsa Sundays", doors_time: "16:00", end_time: "23:00" },
        "rl2",
        "Juju's Bar and Stage",
      ),
    ]);
    await write(dice, [
      event(
        dice,
        { title: "Salsa Sundays", doors_time: "16:00", end_time: "23:00" },
        "dice2",
        "Ely's Yard Social",
      ),
    ]);
    const report = await dedupeMetro(db, metro, [NIGHT]);
    expect(report.merged).toBe(0);
    expect(await active()).toHaveLength(2);
  });

  it("keeps two nights when the starts are hours apart", async () => {
    await write(ruedalibre, [
      event(
        ruedalibre,
        { title: "Sambroso Cuban Sundays", doors_time: "16:00", end_time: "23:00" },
        "rl3",
        "Juju's Bar and Stage",
      ),
    ]);
    await write(dice, [
      event(
        dice,
        { title: "Cuban Sundays", doors_time: "20:00", end_time: "23:00" },
        "dice3",
        "Ely's Yard Social",
      ),
    ]);
    const report = await dedupeMetro(db, metro, [NIGHT]);
    expect(report.merged).toBe(0);
    expect(await active()).toHaveLength(2);
  });

  it("keeps two nights at one street-only address geocoded to two points 200 m apart", async () => {
    await write(ruedalibre, [
      event(
        ruedalibre,
        { title: "Sambroso Cuban Sundays", doors_time: "16:00", end_time: "23:00" },
        "rl4",
        "Juju's Bar and Stage",
      ),
    ]);
    await write(dice, [
      event(
        dice,
        { title: "Cuban Sundays", doors_time: "16:00", end_time: "23:00" },
        "dice4",
        "Ely's Yard Social",
        { lat: 51.5222, lng: -0.0712 },
      ),
    ]);
    const report = await dedupeMetro(db, metro, [NIGHT]);
    expect(report.merged).toBe(0);
    expect(await active()).toHaveLength(2);
  });
});
