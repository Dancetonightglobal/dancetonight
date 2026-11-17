// One source's cancelled page beside another source's live listing stays separate (D-283).
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
import { chooseSurvivor, type DedupeSide } from "@/src/domain/dedupe";

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

describeDb("dedupe cancelled cross source (D-283)", () => {
  beforeAll(async () => {
    db = await testDb("dedupe_cancelled_cross_source");
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

  it("keeps another source's live listing beside a cancelled first-party one", async () => {
    // Write first-party cancelled listing
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
    const rowsAfterFirst = await db.select().from(events).where(eq(events.nightDate, NIGHT));
    expect(rowsAfterFirst).toHaveLength(1);

    // Write ticketing live listing
    await write(ticketing, [
      event(
        ticketing,
        {
          title: "Cherry | House & Disco - XOYO",
          dancing_time: "22:30",
          venue: { name: "Xoyo" },
        },
        "t1",
      ),
    ]);
    const rowsAfterSecond = await db.select().from(events).where(eq(events.nightDate, NIGHT));
    expect(rowsAfterSecond).toHaveLength(2);

    // Run dedupe
    const report = await dedupeMetro(db, metro, [NIGHT]);
    expect(report.merged).toBe(0);

    const finalRows = await db.select().from(events).where(eq(events.nightDate, NIGHT));
    expect(finalRows).toHaveLength(2);
    const cancelledRows = finalRows.filter((r) => r.status === "cancelled");
    const activeRows = finalRows.filter((r) => r.status === "active");
    expect(cancelledRows).toHaveLength(1);
    expect(activeRows).toHaveLength(1);
    expect(finalRows.filter((r) => r.status === "merged")).toHaveLength(0);
  });

  it("frees a live listing merged into another source's cancelled one", async () => {
    // Write both listings
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
          title: "Cherry | House & Disco - XOYO",
          dancing_time: "22:30",
          venue: { name: "Xoyo" },
        },
        "t1",
      ),
    ]);
    const rows = await db.select().from(events).where(eq(events.nightDate, NIGHT));
    expect(rows).toHaveLength(2);
    const firstPartyRow = rows.find(
      (r) => r.title === "Cherry | House & Disco - XOYO" && r.status === "cancelled",
    )!;
    const ticketingRow = rows.find((r) => r.id !== firstPartyRow.id)!;

    // Simulate old bad merge: live ticketing row merged into cancelled first-party row
    await db
      .update(events)
      .set({ status: "merged", mergedIntoId: firstPartyRow.id })
      .where(eq(events.id, ticketingRow.id));

    // Run dedupe
    const report = await dedupeMetro(db, metro, [NIGHT]);
    expect(report.released).toHaveLength(1);

    const finalRows = await db.select().from(events).where(eq(events.nightDate, NIGHT));
    const finalTicketing = finalRows.find((r) => r.id === ticketingRow.id);
    expect(finalTicketing?.status).toBe("active");
    expect(finalTicketing?.mergedIntoId).toBeNull();
    const finalFirstParty = finalRows.find((r) => r.id === firstPartyRow.id);
    expect(finalFirstParty?.status).toBe("cancelled");
  });
});

describe("chooseSurvivor with cancelled vs live", () => {
  it("keeps a live side over a more trusted cancelled one", () => {
    const first: DedupeSide = {
      id: "f",
      startsAt: new Date("2026-09-26T01:00:00Z"),
      organizerId: null,
      organizerName: null,
      venueId: "v1",
      ticketUrl: null,
      canonicalUrl: null,
      trust: "first_party",
      firstSeenAt: new Date("2026-09-20T00:00:00Z"),
      cancelled: true,
    };
    const ticket: DedupeSide = {
      id: "t",
      startsAt: new Date("2026-09-26T01:00:00Z"),
      organizerId: null,
      organizerName: null,
      venueId: "v1",
      ticketUrl: null,
      canonicalUrl: null,
      trust: "ticketing",
      firstSeenAt: new Date("2026-09-20T00:00:00Z"),
      cancelled: false,
    };
    expect(chooseSurvivor(first, ticket).survivor.id).toBe("t");
    expect(chooseSurvivor(ticket, first).survivor.id).toBe("t");
  });
});
