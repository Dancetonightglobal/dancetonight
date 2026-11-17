// Placing a listing that gives only an address, and a stored row with no venue (D-082).
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";

import type { HarvestedListing, Metro, Source } from "@/src/adapters/types";
import type { Db } from "@/src/db/client";
import { events, metros, venues } from "@/src/db/schema";
import { rawListingSchema } from "@/src/domain/listing";
import { EMPTY_BLOCKLIST } from "@/src/pipeline/blocklist";
import { normalizeListing, type NormalizedEvent } from "@/src/pipeline/normalize";
import {
  loadMetro,
  placeUnplaced,
  resolveVenue,
  upsertSource,
  writeEvents,
  type VenueInput,
} from "@/src/pipeline/store";
import { closeTestDb, describeDb, resetDb, testDb } from "@/tests/unit/db-harness";

const NOW = new Date("2026-09-29T16:00:00Z");
const ADDRESS = "37 W 26th St, 2nd floor, NYC";
const BUILDING = { lat: 40.744505, lng: -73.9904434 };
/** A feed's own point for the same address, 400 m north of where the geocoder puts it. */
const FEED_POINT = { lat: 40.748105, lng: -73.9904434 };
let db: Db;
let metro: Metro;
let source: Source;
let asked: string[] = [];
const geocode = async (address: string) => {
  asked.push(address);
  return address === ADDRESS ? BUILDING : null;
};
const place = (input: VenueInput, apiPoint = false) =>
  resolveVenue(db, metro, input, geocode, { checkPoint: apiPoint });

function normalized(
  fields: Record<string, unknown>,
  extra: Partial<HarvestedListing> = {},
  from: Source = source,
): NormalizedEvent {
  const outcome = normalizeListing(
    {
      listing: rawListingSchema.parse({
        listing_type: "social",
        styles: [],
        venue: {},
        organizer: {},
        ...fields,
      }),
      externalId: null,
      tz: null,
      venueLocation: null,
      recurrence: null,
      provenance: { sourceUrl: "https://frimframjam.com/", fetchedAt: NOW, method: "llm" },
      ...extra,
    },
    { metro, source: from, now: NOW },
  );
  if (!outcome.ok) throw new Error(outcome.reason);
  return outcome.event;
}

describeDb("placing a listing that gives only an address (D-082)", () => {
  beforeAll(async () => {
    db = await testDb("unplaced_placing");
  });
  afterAll(closeTestDb);
  beforeEach(async () => {
    await resetDb();
    asked = [];
    await db.insert(metros).values({
      slug: "nyc",
      name: "New York",
      countryCode: "US",
      center: { lat: 40.7128, lng: -74.006 },
      radiusKm: 40,
      tz: "America/New_York",
      languages: ["en"],
      status: "active",
    });
    metro = (await loadMetro(db, "nyc"))!;
    source = await upsertSource(db, metro.id, {
      url: "https://frimframjam.com/",
      kind: "html",
      trustTier: "first_party",
      discoveredBy: "seed_list",
    });
    // A studio next door, 20 m away: never the address-only listing's venue.
    await db.insert(venues).values({
      name: "Next Door Studio",
      nameNormalized: "next door studio",
      location: { lat: 40.74465, lng: -73.99035 },
      tz: "America/New_York",
      metroId: metro.id,
    });
  });

  it("creates a venue named by the address at its building, shared with a listing that named the address", async () => {
    const byAddress = await place({ name: null, address: ADDRESS, url: null, location: null });
    expect(byAddress).toMatchObject({ created: true, location: BUILDING });
    const [row] = await db.select().from(venues).where(eq(venues.id, byAddress!.venueId));
    expect(row?.name).toBe(ADDRESS);
    expect(row?.address).toEqual({ formatted: ADDRESS });
    // The NYLX Warmup row: the model wrote the address as the venue's name.
    const byName = await place({ name: ADDRESS, address: null, url: null, location: null });
    expect(byName?.venueId).toBe(byAddress?.venueId);
  });

  it("leaves a listing with no name and an address the geocoder cannot place unplaced", async () => {
    expect(
      await place({ name: null, address: "Norfolk St", url: null, location: null }),
    ).toBeNull();
  });

  it("places a stored unplaced row from its source's venue provenance, once", async () => {
    // Written before the fix: resolveVenue returned null for an address with no name.
    const event = normalized({
      title: "Frim Fram Jam",
      local_date: "2026-10-01",
      dancing_time: "21:00",
      venue: { address: ADDRESS },
    });
    await writeEvents(db, {
      metro,
      source,
      events: [event],
      blocklist: EMPTY_BLOCKLIST,
      placeVenue: async () => null,
    });
    expect((await db.select().from(events))[0]?.venueId).toBeNull();
    const healed = await placeUnplaced(db, { metro, nights: ["2026-10-01"], placeVenue: place });
    expect(healed.placed).toBe(1);
    expect(healed.notes[0]).toContain("Frim Fram Jam on 2026-10-01");
    const [stored] = await db.select().from(events);
    expect(stored?.venueId).not.toBeNull();
    expect(stored?.geo).toEqual(BUILDING);
    expect(
      (await placeUnplaced(db, { metro, nights: ["2026-10-01"], placeVenue: place })).placed,
    ).toBe(0);
  });

  it("leaves a stored row whose venue is no place unplaced (D-280)", async () => {
    // As Salsa Vida wrote Somos Casineros before D-280: a name and address that are no one place.
    const event = normalized({
      title: "Somos Casineros",
      local_date: "2026-10-01",
      dancing_time: "19:00",
      venue: {
        name: "Various venues in Mexico City",
        address: "Multiple neighborhoods, Mexico City, CDMX, Mexico",
      },
    });
    await writeEvents(db, {
      metro,
      source,
      events: [event],
      blocklist: EMPTY_BLOCKLIST,
      placeVenue: async () => null,
    });
    const tried: VenueInput[] = [];
    const healed = await placeUnplaced(db, {
      metro,
      nights: ["2026-10-01"],
      placeVenue: async (input) => {
        tried.push(input);
        return place(input);
      },
    });
    expect(healed.placed).toBe(0);
    expect(tried).toEqual([]);
    expect((await db.select().from(events))[0]?.venueId).toBeNull();
  });

  it("keeps a feed's own point for a nameless listing with an address (D-071)", async () => {
    // An iCalendar LOCATION that starts with a digit gives no venue name, only the address, and
    // the feed's GEO point is 400 m from the geocoder's building; no venue stands within 150 m of
    // it, and Next Door Studio stands 20 m from the building.
    const feed = await upsertSource(db, metro.id, {
      url: "https://calendar.example/dance.ics",
      kind: "feed_ics",
      trustTier: "first_party",
      discoveredBy: "seed_list",
    });
    const listed = (night: string) =>
      normalized(
        {
          title: "Frim Fram Jam",
          local_date: night,
          dancing_time: "21:00",
          venue: { address: ADDRESS },
        },
        {
          venueLocation: FEED_POINT,
          provenance: { sourceUrl: feed.url, fetchedAt: NOW, method: "feed" },
        },
        feed,
      );

    // The write path: a venue named by the address, at the feed's own point.
    await writeEvents(db, {
      metro,
      source: feed,
      events: [listed("2026-10-01")],
      blocklist: EMPTY_BLOCKLIST,
      placeVenue: place,
    });
    const [written] = await db.select().from(events).where(eq(events.nightDate, "2026-10-01"));
    expect(written?.venueId).not.toBeNull();
    expect(written?.geo).toEqual(FEED_POINT);
    const [venue] = await db.select().from(venues).where(eq(venues.id, written!.venueId!));
    expect(venue?.name).toBe(ADDRESS);
    expect(venue?.location).toEqual(FEED_POINT);

    // A stored row of the same feed with no venue: placed at its own point, not the building.
    await writeEvents(db, {
      metro,
      source: feed,
      events: [listed("2026-10-08")],
      blocklist: EMPTY_BLOCKLIST,
      placeVenue: async () => null,
    });
    const healed = await placeUnplaced(db, { metro, nights: ["2026-10-08"], placeVenue: place });
    expect(healed.placed).toBe(1);
    const [stored] = await db.select().from(events).where(eq(events.nightDate, "2026-10-08"));
    expect(stored?.geo).toEqual(FEED_POINT);
    expect(stored?.venueId).toBe(written?.venueId);
    // The feed gave the point, so the geocoder was never asked.
    expect(asked).toEqual([]);
  });
});
