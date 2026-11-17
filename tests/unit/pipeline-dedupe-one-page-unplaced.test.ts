// D-884: one source's unplaced but timed copy beside its placed copy of one night, one exact title, one start and
// one shared ticket link, is one listing (NYC 2026-11-19, itsmenna.com "Discostan with Omid Walizadeh, Mansaf Mama"
// 22:30 on two of its event pages, both linking one RA ticket page; one copy had no venue).
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

const NOW = new Date("2026-11-16T16:00:00Z");
const NIGHT = "2026-11-19";
const CLUB = { lat: 40.7128, lng: -73.9573 };
const LIST = "https://itsmenna.com/events/";
const PAGE_A = "https://itsmenna.com/events/1459-discostan-with-omid-walizadeh-mansaf-mama/";
const PAGE_B = "https://itsmenna.com/events/1825-discostan-with-omid-walizadeh-mansaf-mama/";
const TICKET = "https://ra.co/events/2538187";
const OTHER_TICKET = "https://ra.co/events/2538999";
const TITLE = "Discostan with Omid Walizadeh, Mansaf Mama";
let db: Db;
let metro: Metro;
let src: Source;

function event(
  fields: Record<string, unknown>,
  id: string,
  eventUrl: string,
  point: { lat: number; lng: number } | null,
) {
  const harvested: HarvestedListing = {
    listing: rawListingSchema.parse({
      listing_type: "party",
      styles: ["house"],
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
    provenance: { sourceUrl: `${src.url}#${id}`, fetchedAt: NOW, method: "feed" },
  };
  const outcome = normalizeListing(harvested, { metro, source: src, now: NOW });
  if (!outcome.ok) throw new Error(outcome.reason);
  return outcome.event;
}

async function write(list: ReturnType<typeof event>[]) {
  return writeEvents(db, {
    metro,
    source: src,
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

const placed = () =>
  event(
    {
      title: TITLE,
      dancing_time: "22:30",
      ticket_url: TICKET,
      venue: { name: "Public Records", address: "233 Butler St, Brooklyn, NY 11217" },
    },
    "placed",
    PAGE_A,
    CLUB,
  );
const unplaced = (over: { title?: string; time?: string; ticket?: string } = {}) =>
  event(
    {
      title: over.title ?? TITLE,
      dancing_time: over.time ?? "22:30",
      ticket_url: over.ticket ?? TICKET,
    },
    "unplaced",
    PAGE_B,
    null,
  );

describeDb(
  "dedupe: one source's unplaced timed copy beside its placed copy, one title, one link (D-884)",
  () => {
    beforeAll(async () => {
      db = await testDb("dedupe_one_page_unplaced");
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
      src = await upsertSource(db, metro.id, {
        url: LIST,
        kind: "html",
        trustTier: "first_party",
        discoveredBy: "seed_list",
      });
    });

    it("merges the unplaced Discostan copy into the placed one", async () => {
      await write([placed(), unplaced()]);
      expect(await live()).toHaveLength(2);
      const report = await dedupeMetro(db, metro, [NIGHT]);
      expect(report.merged).toBe(1);
      const rows = await live();
      expect(rows).toHaveLength(1);
      expect(rows[0]?.venueId).not.toBeNull();
    });

    it("keeps another title on the same ticket link apart", async () => {
      await write([placed(), unplaced({ title: "Discostan Afterhours" })]);
      const report = await dedupeMetro(db, metro, [NIGHT]);
      expect(report.merged).toBe(0);
      expect(await live()).toHaveLength(2);
    });

    it("keeps the same title at another start apart", async () => {
      await write([placed(), unplaced({ time: "19:00" })]);
      const report = await dedupeMetro(db, metro, [NIGHT]);
      expect(report.merged).toBe(0);
      expect(await live()).toHaveLength(2);
    });

    it("keeps a generic title with no shared link apart", async () => {
      const generic = (id: string, page: string, ticket: string, point: typeof CLUB | null) =>
        event(
          {
            title: "Saturday Night Party",
            dancing_time: "22:30",
            ticket_url: ticket,
            ...(point
              ? { venue: { name: "Public Records", address: "233 Butler St, Brooklyn, NY 11217" } }
              : {}),
          },
          id,
          page,
          point,
        );
      await write([generic("g1", PAGE_A, TICKET, CLUB), generic("g2", PAGE_B, OTHER_TICKET, null)]);
      const report = await dedupeMetro(db, metro, [NIGHT]);
      expect(report.merged).toBe(0);
      expect(await live()).toHaveLength(2);
    });
  },
);
