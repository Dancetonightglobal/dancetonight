// D-882: three twins the daily check found still two cards after their rules shipped, run through the whole
// dedupe step (London C Jam and Cuban Sundays, NYC Animal, live rows of 2026-11-13).
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

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
let db: Db;

type Point = { lat: number; lng: number };

function event(
  metro: Metro,
  source: Source,
  night: string,
  fields: Record<string, unknown>,
  id: string,
  venueLocation: Point | null,
) {
  const harvested: HarvestedListing = {
    listing: rawListingSchema.parse({
      listing_type: "social",
      styles: [],
      venue: {},
      organizer: {},
      local_date: night,
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

async function write(metro: Metro, source: Source, list: ReturnType<typeof event>[]) {
  return writeEvents(db, {
    metro,
    source,
    events: list,
    blocklist: EMPTY_BLOCKLIST,
    placeVenue: (input) => resolveVenue(db, metro, input),
  });
}

async function active(night: string) {
  const rows = await db.select().from(events).where(eq(events.nightDate, night));
  return rows.filter((r) => r.status === "active");
}

async function source(
  metro: Metro,
  url: string,
  trustTier: "first_party" | "directory" | "ticketing",
) {
  return upsertSource(db, metro.id, {
    url,
    kind: trustTier === "ticketing" ? "ticketing_api" : "html",
    trustTier,
    discoveredBy: "seed_list",
  });
}

describeDb("twins the candidate step left apart (D-882)", () => {
  let london: Metro;
  let nyc: Metro;

  beforeAll(async () => {
    db = await testDb("dedupe_twin_candidates");
  });
  afterAll(closeTestDb);

  beforeEach(async () => {
    await resetDb();
    await db.insert(metros).values([
      {
        slug: "london",
        name: "London",
        countryCode: "GB",
        center: { lat: 51.5072, lng: -0.1276 },
        radiusKm: 40,
        tz: "Europe/London",
        languages: ["en"],
      },
      {
        slug: "nyc",
        name: "New York",
        countryCode: "US",
        center: { lat: 40.7128, lng: -74.006 },
        radiusKm: 40,
        tz: "America/New_York",
        languages: ["en"],
      },
    ]);
    london = (await loadMetro(db, "london"))!;
    nyc = (await loadMetro(db, "nyc"))!;
  });

  describe("C Jam: a directory's untimed copy beside a timed copy that already took the directory's other row", () => {
    const NIGHT = "2026-11-17";
    const BEDFORD: Point = { lat: 51.4427643, lng: -0.1495007 };
    const venue = { name: "The Bedford", address: "77 Bedford Hill, London SW12 9HD" };

    async function run(untimedTitle: string) {
      const swingland = await source(london, "https://www.swingland.com/events/", "first_party");
      const sol = await source(london, "https://www.swingoutlondon.co.uk/", "directory");
      await write(london, swingland, [
        event(
          london,
          swingland,
          NIGHT,
          {
            title: "C Jam @ The Bedford",
            listing_type: "jam",
            dancing_time: "18:30",
            end_time: "22:30",
            venue,
          },
          "cjam",
          BEDFORD,
        ),
        event(
          london,
          swingland,
          NIGHT,
          {
            title: "Social dancing at C Jam",
            listing_type: "jam",
            dancing_time: "21:00",
            end_time: "22:30",
            venue,
          },
          "cjam-social",
          BEDFORD,
        ),
      ]);
      await write(london, sol, [
        event(
          london,
          sol,
          NIGHT,
          { title: "C Jam - The Bedford in Balham", venue },
          "sol-cjam-class",
          BEDFORD,
        ),
      ]);
      await dedupeMetro(db, london, [NIGHT]);
      await write(london, sol, [
        event(
          london,
          sol,
          NIGHT,
          { title: "C Jam - The Bedford in Balham", venue },
          "sol-cjam-class",
          BEDFORD,
        ),
        event(london, sol, NIGHT, { title: untimedTitle, venue }, "sol-cjam", BEDFORD),
      ]);
      await dedupeMetro(db, london, [NIGHT]);
      return active(NIGHT);
    }

    it("merges the untimed C Jam into C Jam @ The Bedford", async () => {
      const rows = await run("C Jam");
      expect(rows.map((r) => r.title).sort()).toEqual([
        "C Jam @ The Bedford",
        "Social dancing at C Jam",
      ]);
    });

    it("keeps a generic untimed title apart", async () => {
      const rows = await run("Jam");
      expect(rows).toHaveLength(3);
    });
  });

  describe("Cuban Sundays: two venue rows at one point, one start and end, one title inside the other", () => {
    const NIGHT = "2026-11-15";
    const ELYS: Point = { lat: 51.5204972, lng: -0.0735952 };

    async function run(diceTitle: string) {
      const rueda = await source(london, "https://ruedalibre.co.uk/events/", "first_party");
      const dice = await source(london, "https://dice.fm/", "ticketing");
      await write(london, rueda, [
        event(
          london,
          rueda,
          NIGHT,
          {
            title: "Sambroso Cuban Sundays",
            listing_type: "live_music_with_dancing",
            dancing_time: "16:00",
            end_time: "23:00",
            venue: {
              name: "Juju's Bar and Stage",
              address:
                "Juju's Bar and Stage, Ely's Yard, 15 Hanbury Street, London, United Kingdom",
            },
          },
          "rueda",
          ELYS,
        ),
      ]);
      await write(london, dice, [
        event(
          london,
          dice,
          NIGHT,
          {
            title: diceTitle,
            listing_type: "other",
            doors_time: "16:00",
            end_time: "23:00",
            venue: {
              name: "Ely's Yard Social",
              address: "Ely's Yard, 15 Hanbury St, London E1 6QR, UK",
            },
            ticket_url: "https://dice.fm/event/6abd872fb0fb410001513400",
          },
          "dice",
          ELYS,
        ),
      ]);
      // Two venue rows, as live: "Juju's Bar and Stage" and "Ely's Yard Social".
      expect(new Set((await active(NIGHT)).map((r) => r.venueId)).size).toBe(2);
      await dedupeMetro(db, london, [NIGHT]);
      return active(NIGHT);
    }

    it("merges DICE's Cuban Sundays into Sambroso Cuban Sundays", async () => {
      expect(await run("Cuban Sundays")).toHaveLength(1);
    });

    it("keeps a generic title at the other venue row apart", async () => {
      expect(await run("Sunday Social")).toHaveLength(2);
    });
  });

  describe("Animal: two venue rows of one address 158 m apart, one end, starts 3 hours apart", () => {
    const NIGHT = "2026-11-12";
    const ANIMAL_NYC: Point = { lat: 40.7174563, lng: -73.9480255 };
    const ANIMAL: Point = { lat: 40.7187094, lng: -73.9471446 };
    const address = "307 Meeker Avenue, Brooklyn, NY 11211";

    async function run(
      siteTitle: string,
      raTitle = "ANIMAL Thursday BEARS ARE ANIMALS w/ Gregorio P, Jacob Meehan",
      raDoors = "19:00",
    ) {
      const site = await source(nyc, "https://animal.nyc/", "first_party");
      const ra = await source(nyc, "https://ra.co/graphql?area=8", "ticketing");
      await write(nyc, site, [
        event(
          nyc,
          site,
          NIGHT,
          {
            title: siteTitle,
            listing_type: "club_night",
            dancing_time: "16:00",
            end_time: "04:00",
            venue: { name: "Animal NYC", address },
          },
          "site",
          ANIMAL_NYC,
        ),
      ]);
      await write(nyc, ra, [
        event(
          nyc,
          ra,
          NIGHT,
          {
            title: raTitle,
            listing_type: "other",
            doors_time: raDoors,
            end_time: "04:00",
            venue: { name: "Animal", address },
            ticket_url: "https://ra.co/events/2583236",
          },
          "ra",
          ANIMAL,
        ),
      ]);
      // Two venue rows, as live: "Animal NYC" and "Animal".
      expect(new Set((await active(NIGHT)).map((r) => r.venueId)).size).toBe(2);
      await dedupeMetro(db, nyc, [NIGHT]);
      return active(NIGHT);
    }

    it("merges the site's Bears Are Animals into RA's copy", async () => {
      expect(await run("Bears Are Animals")).toHaveLength(1);
    });

    it("merges the site's Horrorchata b2b Tok.io into RA's 10pm copy", async () => {
      expect(
        await run(
          "Horrorchata b2b Tok.io",
          "ANIMAL Friday Night w/ Horrorchata b2b Tok.io",
          "22:00",
        ),
      ).toHaveLength(1);
    });

    it("keeps a different night at the other venue row apart", async () => {
      expect(await run("Techno Thursday")).toHaveLength(2);
    });
  });
});
