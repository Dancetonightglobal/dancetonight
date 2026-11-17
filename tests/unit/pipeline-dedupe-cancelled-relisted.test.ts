// One source's cancelled page beside its live relisting of the same night merges into the live one (D-282).
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

describeDb("dedupe one source's cancelled page beside its live relisting (D-282)", () => {
  beforeAll(async () => {
    db = await testDb("dedupe_cancelled_relisted");
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

  it("merges one source's cancelled page into its live relisting at same venue and start", async () => {
    await write(ticketing, [
      event(
        ticketing,
        {
          title: "Cherry | House & Disco - XOYO",
          dancing_time: "22:30",
          venue: { name: "Xoyo" },
          cancelled: true,
        },
        "c1",
      ),
      event(
        ticketing,
        {
          title: "Cherry - House & Disco | XOYO [HALLOWEEN EDITION]",
          dancing_time: "22:30",
          venue: { name: "Xoyo" },
        },
        "c2",
      ),
    ]);
    const report = await dedupeMetro(db, metro, [NIGHT]);
    expect(report.merged).toBe(1);
    const rows = await db.select().from(events).where(eq(events.nightDate, NIGHT));
    expect(rows.filter((r) => r.status === "active")).toHaveLength(1);
    const active = rows.find((r) => r.status === "active");
    expect(active?.title).toBe("Cherry - House & Disco | XOYO [HALLOWEEN EDITION]");
    expect(rows.filter((r) => r.status === "merged")).toHaveLength(1);
  });

  it("does not release the merge on a second run", async () => {
    await write(ticketing, [
      event(
        ticketing,
        {
          title: "Cherry | House & Disco - XOYO",
          dancing_time: "22:30",
          venue: { name: "Xoyo" },
          cancelled: true,
        },
        "c1",
      ),
      event(
        ticketing,
        {
          title: "Cherry - House & Disco | XOYO [HALLOWEEN EDITION]",
          dancing_time: "22:30",
          venue: { name: "Xoyo" },
        },
        "c2",
      ),
    ]);
    await dedupeMetro(db, metro, [NIGHT]);
    const report2 = await dedupeMetro(db, metro, [NIGHT]);
    expect(report2.merged).toBe(0);
    const rows = await db.select().from(events).where(eq(events.nightDate, NIGHT));
    expect(rows.filter((r) => r.status === "active")).toHaveLength(1);
    expect(rows.filter((r) => r.status === "merged")).toHaveLength(1);
  });

  it("never merges a cancelled listing into another source's live one", async () => {
    await write(firstParty, [
      event(
        firstParty,
        {
          title: "Cherry | House & Disco - XOYO",
          dancing_time: "22:30",
          venue: { name: "Xoyo" },
          cancelled: true,
        },
        "f1",
      ),
    ]);
    await write(ticketing, [
      event(
        ticketing,
        {
          title: "Cherry - House & Disco | XOYO [HALLOWEEN EDITION]",
          dancing_time: "22:30",
          venue: { name: "Xoyo" },
        },
        "t1",
      ),
    ]);
    // Across sources the D-282 path does not act: the cancelled listing is never the merged side.
    await dedupeMetro(db, metro, [NIGHT]);
    const rows = await db.select().from(events).where(eq(events.nightDate, NIGHT));
    const cancelled = rows.find((r) => r.title === "Cherry | House & Disco - XOYO");
    expect(cancelled?.status).toBe("cancelled");
  });

  it("does not merge two live listings from same source with unlike titles", async () => {
    await write(ticketing, [
      event(
        ticketing,
        {
          title: "Cherry | House & Disco - XOYO",
          dancing_time: "22:30",
          venue: { name: "Xoyo" },
        },
        "c3",
      ),
      event(
        ticketing,
        {
          title: "Salsa Night",
          dancing_time: "22:30",
          venue: { name: "Xoyo" },
        },
        "c4",
      ),
    ]);
    const report = await dedupeMetro(db, metro, [NIGHT]);
    expect(report.merged).toBe(0);
    const rows = await db.select().from(events).where(eq(events.nightDate, NIGHT));
    expect(rows.filter((r) => r.status === "active")).toHaveLength(2);
  });
});
