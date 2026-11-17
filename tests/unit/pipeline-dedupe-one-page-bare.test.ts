// D-866: one source's bare copy (no place, no time) beside its placed, timed copy of one night, both pointing at one
// specific event page, is one listing (NYC 2026-11-11, sensualmovementusa "Roofchata Wednesdays" 9pm at 230 5th Ave
// and "Roofchata Wednesdays at 230 Fifth (Bachata Party)" untimed, "Location not listed"; daily report 2026-11-11).
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
const NIGHT = "2026-11-11";
const ROOF = { lat: 40.7441, lng: -73.9883 };
const LIST = "https://sensualmovementusa.com/"; // the site home: not an event page
const PAGE =
  "https://sensualmovementusa.com/product/socials/nyc-socials/roofchata-wednesdays-bachata-party/";
const OTHER_PAGE = "https://sensualmovementusa.com/product/socials/nyc-socials/sensual-sundays/";
let db: Db;
let metro: Metro;
let sm: Source;

function event(
  fields: Record<string, unknown>,
  id: string,
  eventUrl: string,
  point: { lat: number; lng: number } | null,
) {
  const harvested: HarvestedListing = {
    listing: rawListingSchema.parse({
      listing_type: "social",
      styles: ["bachata"],
      venue: {},
      organizer: {},
      local_date: NIGHT,
      ...fields,
    }),
    externalId: id,
    eventUrl,
    tz: null,
    venueLocation: point,
    recurrence: null,
    provenance: { sourceUrl: `${sm.url}#${id}`, fetchedAt: NOW, method: "feed" },
  };
  const outcome = normalizeListing(harvested, { metro, source: sm, now: NOW });
  if (!outcome.ok) throw new Error(outcome.reason);
  return outcome.event;
}

async function write(list: ReturnType<typeof event>[]) {
  return writeEvents(db, {
    metro,
    source: sm,
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

const placed = (eventUrl = PAGE) =>
  event(
    {
      title: "Roofchata Wednesdays",
      dancing_time: "21:00",
      venue: { name: "230 Fifth", address: "230 5th Ave, New York, NY 10001" },
    },
    "placed",
    eventUrl,
    ROOF,
  );
const bare = (eventUrl = PAGE, title = "Roofchata Wednesdays at 230 Fifth (Bachata Party)") =>
  event({ title }, "bare", eventUrl, null);

describeDb(
  "dedupe: one source's bare copy beside its placed copy of one event page (D-866)",
  () => {
    beforeAll(async () => {
      db = await testDb("dedupe_one_page_bare");
    });
    afterAll(closeTestDb);

    beforeEach(async () => {
      await resetDb();
      await db.insert(metros).values({
        slug: "nyc",
        name: "New York",
        countryCode: "US",
        center: { lat: 40.7128, lng: -74.006 },
        radiusKm: 60,
        tz: "America/New_York",
        languages: ["en"],
      });
      metro = (await loadMetro(db, "nyc"))!;
      sm = await upsertSource(db, metro.id, {
        url: LIST,
        kind: "html",
        trustTier: "first_party",
        discoveredBy: "seed_list",
      });
    });

    it("merges the bare Roofchata copy into the placed 9pm copy", async () => {
      await write([placed(), bare()]);
      expect(await live()).toHaveLength(2);
      const report = await dedupeMetro(db, metro, [NIGHT]);
      expect(report.merged).toBe(1);
      const rows = await live();
      expect(rows).toHaveLength(1);
      expect(rows[0]?.venueId).not.toBeNull();
      expect(rows[0]?.startsAt).not.toBeNull();
    });

    it("keeps a bare copy of another event page apart", async () => {
      await write([placed(), bare(OTHER_PAGE, "Sensual Sundays")]);
      const report = await dedupeMetro(db, metro, [NIGHT]);
      expect(report.merged).toBe(0);
      expect(await live()).toHaveLength(2);
    });

    it("keeps two listings that share only the source's list page", async () => {
      await write([placed(LIST), bare(LIST)]);
      const report = await dedupeMetro(db, metro, [NIGHT]);
      expect(report.merged).toBe(0);
      expect(await live()).toHaveLength(2);
    });
  },
);
