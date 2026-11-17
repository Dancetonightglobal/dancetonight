// D-864: RA's copy with no place and no time beside DICE's placed 11pm copy, one exact title, is one night
// (Barcelona "Wave Fest x Bad Decisions" at Sala Bikini, daily report 2026-11-11).
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

const NOW = new Date("2026-11-11T16:00:00Z");
const NIGHT = "2026-11-12";
let db: Db;
let metro: Metro;
let dice: Source;
let ra: Source;

const BIKINI = { lat: 41.3874, lng: 2.1301 };

function event(
  source: Source,
  fields: Record<string, unknown>,
  id: string,
  venueLocation: { lat: number; lng: number } | null,
) {
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
    venueLocation,
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

describeDb("a bare copy beside a placed, timed copy with one title (D-864)", () => {
  beforeAll(async () => {
    db = await testDb("dedupe_bare_copy");
  });
  afterAll(closeTestDb);

  beforeEach(async () => {
    await resetDb();
    await db.insert(metros).values({
      slug: "bcn",
      name: "Barcelona",
      countryCode: "ES",
      center: { lat: 41.3874, lng: 2.1686 },
      radiusKm: 40,
      tz: "Europe/Madrid",
      languages: ["es", "ca", "en"],
    });
    metro = (await loadMetro(db, "bcn"))!;
    dice = await upsertSource(db, metro.id, {
      url: "https://dice.fm/",
      kind: "ticketing_api",
      trustTier: "ticketing",
      discoveredBy: "seed_list",
    });
    ra = await upsertSource(db, metro.id, {
      url: "https://ra.co/",
      kind: "ticketing_api",
      trustTier: "ticketing",
      discoveredBy: "seed_list",
    });
  });

  async function pair(
    titleDice: string,
    titleRa: string,
    raTicket = "https://ra.co/events/2581907",
  ) {
    await write(dice, [
      event(
        dice,
        {
          title: titleDice,
          dancing_time: "23:00",
          venue: { name: "Sala Bikini", address: "Av. Diagonal 547, Barcelona" },
          ticket_url: "https://dice.fm/event/6af346f4769a18000179669e",
        },
        "dice",
        BIKINI,
      ),
    ]);
    await write(ra, [event(ra, { title: titleRa, venue: {}, ticket_url: raTicket }, "ra", null)]);
    return dedupeMetro(db, metro, [NIGHT]);
  }

  it("merges RA's bare Wave Fest into DICE's placed 11pm copy", async () => {
    const report = await pair("Wave Fest x Bad Decisions", "Wave Fest x Bad Decisions");
    expect(report.merged).toBe(1);
    const rows = await db.select().from(events).where(eq(events.nightDate, NIGHT));
    const active = rows.filter((r) => r.status === "active");
    expect(active).toHaveLength(1);
    expect(active[0]?.venueId).not.toBeNull();
    expect(active[0]?.startsAt).not.toBeNull();
  });

  it("keeps a generic title apart", async () => {
    const report = await pair("Salsa Social Night", "Salsa Social Night");
    expect(report.merged).toBe(0);
  });

  it("keeps different titles apart", async () => {
    const report = await pair("Wave Fest x Bad Decisions", "Wave Fest x Good Decisions");
    expect(report.merged).toBe(0);
  });

  it("keeps two pages on one seller apart", async () => {
    const report = await pair(
      "Wave Fest x Bad Decisions",
      "Wave Fest x Bad Decisions",
      "https://dice.fm/event/another-page",
    );
    expect(report.merged).toBe(0);
  });
});
