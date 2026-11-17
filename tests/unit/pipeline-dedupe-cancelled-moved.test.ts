// One source lists a session cancelled at its old time beside the same session live at its new time (D-594).
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

const NOW = new Date("2026-10-17T16:00:00Z");
const NIGHT = "2026-10-17";
let db: Db;
let metro: Metro;
let ticketing: Source;
let firstParty: Source;

const VENUE_POINT = { lat: 40.7652, lng: -73.9942 };

function event(source: Source, fields: Record<string, unknown>, id: string) {
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
    venueLocation: VENUE_POINT,
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

describeDb(
  "dedupe one source's cancelled page at its old time beside the live one at its new time (D-594)",
  () => {
    beforeAll(async () => {
      db = await testDb("dedupe_cancelled_moved");
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
        url: "https://www.eventbrite.com/",
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
    // Swingland 2026-11-09 (daily check 11-05): "A-Train @ The Hammersmith Club" cancelled at 6:45pm and live at
    // 7pm in one read; nycwcs "Level 4 w/ Dimitri" cancelled 6:30pm, live 7pm. Both showed side by side.
    it("merges one source's cancelled session into its live one a few minutes later", async () => {
      await write(firstParty, [
        event(
          firstParty,
          {
            title: "A-Train @ The Hammersmith Club",
            doors_time: "18:45",
            venue: { name: "The Hammersmith Club" },
            cancelled: true,
          },
          "a1",
        ),
        event(
          firstParty,
          {
            title: "A-Train @ The Hammersmith Club",
            doors_time: "19:00",
            venue: { name: "The Hammersmith Club" },
          },
          "a2",
        ),
      ]);
      const report = await dedupeMetro(db, metro, [NIGHT]);
      expect(report.merged).toBe(1);
      const rows = await db.select().from(events).where(eq(events.nightDate, NIGHT));
      const active = rows.filter((r) => r.status === "active");
      expect(active).toHaveLength(1);
      expect(active[0]?.confirmation).not.toBe("cancelled");
      expect(active[0]?.startsAt?.toISOString()).toBe("2026-10-17T23:00:00.000Z");
      expect(rows.filter((r) => r.status === "merged")).toHaveLength(1);
    });

    it("merges a class cancelled at its lesson time into the live one 30 minutes earlier", async () => {
      await write(firstParty, [
        event(
          firstParty,
          {
            title: "Level 4 w/ Dimitri (Novice) Competitor Training",
            listing_type: "class",
            lesson_time: "18:30",
            venue: { name: "Danznik Studios" },
            cancelled: true,
          },
          "d1",
        ),
        event(
          firstParty,
          {
            title: "Level 4 w/ Dimitri (Novice) Competitor Training",
            listing_type: "class",
            lesson_time: "19:00",
            venue: { name: "Danznik Studios" },
          },
          "d2",
        ),
      ]);
      const report = await dedupeMetro(db, metro, [NIGHT]);
      expect(report.merged).toBe(1);
      const rows = await db.select().from(events).where(eq(events.nightDate, NIGHT));
      expect(rows.filter((r) => r.status === "active")).toHaveLength(1);
    });

    it("keeps a cancelled early session apart from a live late one hours later", async () => {
      await write(firstParty, [
        event(
          firstParty,
          {
            title: "Swing Social",
            doors_time: "17:00",
            venue: { name: "The Hammersmith Club" },
            cancelled: true,
          },
          "s1",
        ),
        event(
          firstParty,
          { title: "Swing Social", doors_time: "21:00", venue: { name: "The Hammersmith Club" } },
          "s2",
        ),
      ]);
      const report = await dedupeMetro(db, metro, [NIGHT]);
      expect(report.merged).toBe(0);
    });

    it("keeps two of one source's sessions with different titles apart", async () => {
      await write(firstParty, [
        event(
          firstParty,
          {
            title: "Beginners Lindy",
            doors_time: "18:45",
            venue: { name: "The Hammersmith Club" },
            cancelled: true,
          },
          "b1",
        ),
        event(
          firstParty,
          {
            title: "Advanced Balboa",
            doors_time: "19:00",
            venue: { name: "The Hammersmith Club" },
          },
          "b2",
        ),
      ]);
      const report = await dedupeMetro(db, metro, [NIGHT]);
      expect(report.merged).toBe(0);
    });

    it("keeps two live sessions of one source apart (only a cancelled one gives way)", async () => {
      await write(firstParty, [
        event(
          firstParty,
          { title: "Swing Social", doors_time: "18:45", venue: { name: "The Hammersmith Club" } },
          "l1",
        ),
        event(
          firstParty,
          { title: "Swing Social", doors_time: "19:00", venue: { name: "The Hammersmith Club" } },
          "l2",
        ),
      ]);
      const report = await dedupeMetro(db, metro, [NIGHT]);
      expect(report.merged).toBe(0);
    });
  },
);
