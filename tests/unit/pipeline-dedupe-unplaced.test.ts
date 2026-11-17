// Unplaced listings pair with placed ones when titles are near-identical and starts match (D-150).
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

const NOW = new Date("2026-10-29T16:00:00Z");
let db: Db;
let metro: Metro;
let ticketing: Source;
let firstParty: Source;

const VENUE_POINT = { lat: 25.7617, lng: -80.1918 };

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
      local_date: "2026-10-29",
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

describeDb("unplaced listings pair with placed ones (D-150)", () => {
  beforeAll(async () => {
    db = await testDb("dedupe_unplaced");
  });
  afterAll(closeTestDb);

  beforeEach(async () => {
    await resetDb();
    await db.insert(metros).values({
      slug: "mia",
      name: "Miami",
      countryCode: "US",
      center: { lat: 25.7617, lng: -80.1918 },
      radiusKm: 50,
      tz: "America/New_York",
      languages: ["en"],
    });
    metro = (await loadMetro(db, "mia"))!;
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

  it("merges placed with unplaced when titles match and starts are within 15 minutes", async () => {
    await write(ticketing, [
      event(
        ticketing,
        {
          title: "Latin Social Thursdays at Hole19 Scratch Kitchen + Bar!",
          dancing_time: "20:00",
          venue: { name: "Hole19 Scratch Kitchen + Bar" },
        },
        "placed",
      ),
    ]);
    await write(firstParty, [
      event(
        firstParty,
        {
          title: "Latin Social Thursdays at Hole19 Scratch Kitchen + Bar!",
          dancing_time: "20:00",
          venue: {},
        },
        "unplaced",
        null,
      ),
    ]);
    const report = await dedupeMetro(db, metro, ["2026-10-29"]);
    expect(report.merged).toBe(1);
    const rows = await db.select().from(events).where(eq(events.nightDate, "2026-10-29"));
    expect(rows.filter((r) => r.status === "merged")).toHaveLength(1);
    const active = rows.find((r) => r.status === "active");
    expect(active?.venueId).not.toBeNull();
  });

  it("survivor is unplaced copy (more trusted) and takes venue from placed copy", async () => {
    // firstParty is more trusted than ticketing (trust order: first_party > ticketing)
    await write(firstParty, [
      event(
        firstParty,
        {
          title: "Latin Social Thursdays at Hole19 Scratch Kitchen + Bar!",
          dancing_time: "20:00",
          venue: {},
        },
        "unplaced",
        null,
      ),
    ]);
    await write(ticketing, [
      event(
        ticketing,
        {
          title: "Latin Social Thursdays at Hole19 Scratch Kitchen + Bar!",
          dancing_time: "20:00",
          venue: { name: "Hole19 Scratch Kitchen + Bar" },
        },
        "placed",
      ),
    ]);
    const report = await dedupeMetro(db, metro, ["2026-10-29"]);
    expect(report.merged).toBe(1);
    const rows = await db.select().from(events).where(eq(events.nightDate, "2026-10-29"));
    expect(rows.filter((r) => r.status === "merged")).toHaveLength(1);
    const active = rows.find((r) => r.status === "active");
    expect(active?.venueId).not.toBeNull();
  });

  it("keeps unplaced and placed when starts differ by more than 15 minutes", async () => {
    await write(ticketing, [
      event(
        ticketing,
        {
          title: "Latin Social Thursdays at Hole19 Scratch Kitchen + Bar!",
          dancing_time: "19:00",
          venue: { name: "Hole19 Scratch Kitchen + Bar" },
        },
        "placed",
      ),
    ]);
    await write(firstParty, [
      event(
        firstParty,
        {
          title: "Latin Social Thursdays at Hole19 Scratch Kitchen + Bar!",
          dancing_time: "21:00",
          venue: {},
        },
        "unplaced",
        null,
      ),
    ]);
    const report = await dedupeMetro(db, metro, ["2026-10-29"]);
    expect(report.merged).toBe(0);
    const rows = await db.select().from(events).where(eq(events.nightDate, "2026-10-29"));
    expect(rows.filter((r) => r.status === "active")).toHaveLength(2);
  });

  it("keeps short generic title 'Salsa Night' unplaced and placed", async () => {
    await write(ticketing, [
      event(
        ticketing,
        {
          title: "Salsa Night",
          dancing_time: "20:00",
          venue: { name: "Venue X" },
        },
        "placed",
      ),
    ]);
    await write(firstParty, [
      event(
        firstParty,
        {
          title: "Salsa Night",
          dancing_time: "20:00",
          venue: {},
        },
        "unplaced",
        null,
      ),
    ]);
    const report = await dedupeMetro(db, metro, ["2026-10-29"]);
    expect(report.merged).toBe(0);
    const rows = await db.select().from(events).where(eq(events.nightDate, "2026-10-29"));
    expect(rows.filter((r) => r.status === "active")).toHaveLength(2);
  });

  it("keeps both placed at two venues far apart", async () => {
    const VENUE_POINT_B = { lat: 25.7767, lng: -80.2068 }; // ~2.2 km away: beyond D-803/D-811's 1.5 km
    await write(ticketing, [
      event(
        ticketing,
        {
          title: "Latin Social Thursdays at Hole19 Scratch Kitchen + Bar!",
          dancing_time: "20:00",
          venue: { name: "Hole19 Scratch Kitchen + Bar" },
        },
        "placed1",
      ),
    ]);
    await write(firstParty, [
      event(
        firstParty,
        {
          title: "Latin Social Thursdays at Hole19 Scratch Kitchen + Bar!",
          dancing_time: "20:00",
          venue: { name: "Different Venue" },
        },
        "placed2",
        VENUE_POINT_B,
      ),
    ]);
    const report = await dedupeMetro(db, metro, ["2026-10-29"]);
    expect(report.merged).toBe(0);
    const rows = await db.select().from(events).where(eq(events.nightDate, "2026-10-29"));
    expect(rows.filter((r) => r.status === "active")).toHaveLength(2);
  });

  it("keeps unalike titles with one unplaced", async () => {
    await write(ticketing, [
      event(
        ticketing,
        {
          title: "Latin Social Thursdays at Hole19",
          dancing_time: "20:00",
          venue: { name: "Hole19 Scratch Kitchen + Bar" },
        },
        "placed",
      ),
    ]);
    await write(firstParty, [
      event(
        firstParty,
        {
          title: "Bachata Fridays at Club Space",
          dancing_time: "20:00",
          venue: {},
        },
        "unplaced",
        null,
      ),
    ]);
    const report = await dedupeMetro(db, metro, ["2026-10-29"]);
    expect(report.merged).toBe(0);
    const rows = await db.select().from(events).where(eq(events.nightDate, "2026-10-29"));
    expect(rows.filter((r) => r.status === "active")).toHaveLength(2);
  });
});
