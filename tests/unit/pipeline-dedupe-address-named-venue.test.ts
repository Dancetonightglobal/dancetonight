// D-790: London 11-07, ridleyroadmarketbar.com lists "CLUB MIX" at 20:00 at a venue row named by its street address
// ("49 Ridley Rd, London E8 2NP") and DICE lists "Club Mix till 4am!" at 18:00 at Ridley Road Market Bar ("49 Ridley
// Road; London E8 2NP"), 63 m apart: two cards. Now one.
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

const NOW = new Date("2026-11-06T16:00:00Z");
const NIGHT = "2026-11-07";
const SITE_POINT = { lat: 51.549, lng: -0.075 };
const DICE_POINT = { lat: 51.54957, lng: -0.075 };
let db: Db;
let metro: Metro;
let site: Source;
let dice: Source;

function event(
  source: Source,
  fields: Record<string, unknown>,
  id: string,
  venue: { name: string; address: string },
  point: { lat: number; lng: number },
) {
  const harvested: HarvestedListing = {
    listing: rawListingSchema.parse({
      listing_type: "club_night",
      styles: [],
      venue,
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

describeDb(
  "dedupe: a venue row named by the other's street address, closing-time title tail (D-790)",
  () => {
    beforeAll(async () => {
      db = await testDb("dedupe_address_named_venue");
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
      site = await upsertSource(db, metro.id, {
        url: "https://www.ridleyroadmarketbar.com/events/",
        kind: "html",
        trustTier: "first_party",
        discoveredBy: "seed_list",
      });
      dice = await upsertSource(db, metro.id, {
        url: "https://dice.fm/event/",
        kind: "html",
        trustTier: "ticketing",
        discoveredBy: "seed_list",
      });
    });

    it("merges CLUB MIX at 49 Ridley Rd and Club Mix till 4am! at Ridley Road Market Bar", async () => {
      await write(site, [
        event(
          site,
          { title: "CLUB MIX", dancing_time: "20:00" },
          "club-mix",
          { name: "49 Ridley Rd, London E8 2NP", address: "49 Ridley Rd, London E8 2NP" },
          SITE_POINT,
        ),
      ]);
      await write(dice, [
        event(
          dice,
          { title: "Club Mix till 4am!", dancing_time: "18:00" },
          "club-mix-dice",
          { name: "Ridley Road Market Bar", address: "49 Ridley Road; London E8 2NP" },
          DICE_POINT,
        ),
      ]);
      const before = await live();
      expect(before).toHaveLength(2);
      expect(before[0]!.venueId).not.toBe(before[1]!.venueId);
      const report = await dedupeMetro(db, metro, [NIGHT]);
      expect(report.merged).toBe(1);
      expect(await live()).toHaveLength(1);
    });

    it("keeps another title at the same two venue rows apart", async () => {
      await write(site, [
        event(
          site,
          { title: "CLUB MIX", dancing_time: "20:00" },
          "club-mix",
          { name: "49 Ridley Rd, London E8 2NP", address: "49 Ridley Rd, London E8 2NP" },
          SITE_POINT,
        ),
      ]);
      await write(dice, [
        event(
          dice,
          { title: "Soca Brunch Party", dancing_time: "18:00" },
          "soca",
          { name: "Ridley Road Market Bar", address: "49 Ridley Road; London E8 2NP" },
          DICE_POINT,
        ),
      ]);
      const report = await dedupeMetro(db, metro, [NIGHT]);
      expect(report.merged).toBe(0);
      expect(await live()).toHaveLength(2);
    });
  },
);
