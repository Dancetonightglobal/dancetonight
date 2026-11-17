// D-817 (Tokyo-6 gap report 2026-11-10): Salsa Vida's guide (a directory) lists "El Café Latino Roppongi" at 19:30
// every night, and the venue's own hand-checked source lists "Latin Social at El Cafe Latino" at 21:00 on Tue/Thu/Fri:
// two cards for one night at one venue. A directory-only copy beside a first-party copy at one venue on one night,
// starts within 90 minutes, is that night: it merges into the first-party copy, whatever its title.
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
const NIGHT = "2026-11-12";
const ECL = { lat: 35.6623, lng: 139.7321 };
const ECL_NAME = "El Cafe Latino";
// ~1 km away: another venue.
const OTHER = { lat: 35.6703, lng: 139.7401 };

let db: Db;
let metro: Metro;
let guide: Source;
let own: Source;
let meetup: Source;

function event(
  source: Source,
  fields: Record<string, unknown>,
  id: string,
  venueName = ECL_NAME,
  point = ECL,
) {
  const harvested: HarvestedListing = {
    listing: rawListingSchema.parse({
      listing_type: "social",
      styles: ["salsa"],
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

describeDb(
  "dedupe: a directory copy gives way to the venue's own copy of the night (D-817)",
  () => {
    beforeAll(async () => {
      db = await testDb("dedupe_directory_yields");
    });
    afterAll(closeTestDb);

    beforeEach(async () => {
      await resetDb();
      await db.insert(metros).values({
        slug: "tokyo",
        name: "Tokyo",
        countryCode: "JP",
        center: { lat: 35.6812, lng: 139.7671 },
        radiusKm: 60,
        tz: "Asia/Tokyo",
        languages: ["ja", "en"],
      });
      metro = (await loadMetro(db, "tokyo"))!;
      guide = await upsertSource(db, metro.id, {
        url: "https://www.salsavida.com/guides/japan/tokyo/",
        kind: "html",
        trustTier: "directory",
        discoveredBy: "seed_list",
      });
      own = await upsertSource(db, metro.id, {
        url: "https://www.instagram.com/elcafelatinojapan/",
        kind: "html",
        trustTier: "first_party",
        discoveredBy: "seed_list",
      });
      meetup = await upsertSource(db, metro.id, {
        url: "https://www.meetup.com/salsatokyo/",
        kind: "html",
        trustTier: "first_party",
        discoveredBy: "seed_list",
      });
    });

    it("merges Salsa Vida's 19:30 El Café Latino Roppongi into the venue's 21:00 Latin Social", async () => {
      await write(guide, [
        event(guide, { title: "El Café Latino Roppongi", dancing_time: "19:30" }, "sv"),
      ]);
      await write(own, [
        event(own, { title: "Latin Social at El Cafe Latino", dancing_time: "21:00" }, "own"),
      ]);
      const before = await live();
      expect(before).toHaveLength(2);
      expect(before[0]!.venueId).toBe(before[1]!.venueId);
      await dedupeMetro(db, metro, [NIGHT]);
      const after = await live();
      expect(after).toHaveLength(1);
      expect(after[0]!.title).toBe("Latin Social at El Cafe Latino");
    });

    it("keeps two first-party copies with unlike titles at one venue apart", async () => {
      await write(meetup, [event(meetup, { title: "Bachata Night", dancing_time: "19:30" }, "m")]);
      await write(own, [
        event(own, { title: "Latin Social at El Cafe Latino", dancing_time: "21:00" }, "own"),
      ]);
      await dedupeMetro(db, metro, [NIGHT]);
      expect(await live()).toHaveLength(2);
    });

    it("keeps a directory copy whose start is over 90 minutes from the venue's own", async () => {
      await write(guide, [
        event(guide, { title: "El Café Latino Roppongi", dancing_time: "18:00" }, "sv"),
      ]);
      await write(own, [
        event(own, { title: "Latin Social at El Cafe Latino", dancing_time: "21:00" }, "own"),
      ]);
      await dedupeMetro(db, metro, [NIGHT]);
      expect(await live()).toHaveLength(2);
    });

    it("keeps a directory copy at another venue", async () => {
      await write(guide, [
        event(
          guide,
          { title: "Salsa at Bar Leon", dancing_time: "20:30" },
          "sv",
          "Bar Leon",
          OTHER,
        ),
      ]);
      await write(own, [
        event(own, { title: "Latin Social at El Cafe Latino", dancing_time: "21:00" }, "own"),
      ]);
      await dedupeMetro(db, metro, [NIGHT]);
      expect(await live()).toHaveLength(2);
    });

    it("keeps a directory class beside the venue's own social", async () => {
      await write(guide, [
        event(
          guide,
          { title: "Salsa Class at El Cafe Latino", dancing_time: "19:30", listing_type: "class" },
          "sv",
        ),
      ]);
      await write(own, [
        event(own, { title: "Latin Social at El Cafe Latino", dancing_time: "21:00" }, "own"),
      ]);
      await dedupeMetro(db, metro, [NIGHT]);
      expect(await live()).toHaveLength(2);
    });
  },
);
