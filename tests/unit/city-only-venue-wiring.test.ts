// D-840: a venue written only as the city ("London") is no place, in the listing and in the stored venues.
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { HarvestedListing } from "@/src/adapters/types";
import type { Db } from "@/src/db/client";
import { events, metros, venues } from "@/src/db/schema";
import { rawListingSchema } from "@/src/domain/listing";
import { clearNoPlaceVenues } from "@/src/pipeline/no-place-venues";
import { withoutNoPlaceVenue } from "@/src/pipeline/source-venue";
import { closeTestDb, describeDb, resetDb, testDb } from "@/tests/unit/db-harness";

function makeListing(venue: { name: string | null; address: string | null }): HarvestedListing {
  const raw = rawListingSchema.parse({
    title: "Ceilidh Club",
    listing_type: "social",
    styles: ["ceilidh"],
    local_date: "2026-11-13",
    doors_time: "20:00",
    venue: { name: venue.name, address: venue.address, url: null },
    organizer: { name: null, url: null },
  });
  return {
    listing: raw,
    externalId: "test:1",
    tz: "Europe/London",
    venueLocation: { lat: 51.5072, lng: -0.1276 },
    recurrence: null,
    provenance: {
      sourceUrl: "https://folkdance.page/index.ics",
      fetchedAt: new Date(),
      method: "feed",
    },
  };
}

describe("withoutNoPlaceVenue with city names", () => {
  it("clears a venue written only as the city", () => {
    const out = withoutNoPlaceVenue(makeListing({ name: "London", address: null }), ["London"]);
    expect(out.listing.venue.name).toBeNull();
    expect(out.listing.venue.address).toBeNull();
    expect(out.venueLocation).toBeNull();
  });

  it("keeps a real venue, and keeps 'London' when no city names are given", () => {
    const real = makeListing({
      name: "Cecil Sharp House",
      address: "2 Regent's Park Road, London NW1 7AY",
    });
    expect(withoutNoPlaceVenue(real, ["London"])).toBe(real);
    const bare = makeListing({ name: "London", address: null });
    expect(withoutNoPlaceVenue(bare)).toBe(bare);
  });
});

const LON_METRO_ID = "00000000-0000-4000-8000-000000000003";
const NOW = new Date("2026-11-10T20:00:00Z");

describeDb("clearNoPlaceVenues: a venue named only as the city (D-840)", () => {
  let db: Db;

  beforeAll(async () => {
    db = await testDb("city_only_venue");
  });
  afterAll(closeTestDb);

  beforeEach(async () => {
    await resetDb();
    await db.insert(metros).values({
      id: LON_METRO_ID,
      slug: "london",
      name: "London",
      countryCode: "GB",
      center: { lat: 51.5072, lng: -0.1276 },
      radiusKm: 40,
      tz: "Europe/London",
      languages: ["en"],
    });
  });

  it("unpins listings from a venue named 'London', keeps a real venue", async () => {
    const cityVenueId = "00000000-0000-4000-8000-0000000000b1";
    const realVenueId = "00000000-0000-4000-8000-0000000000b2";
    await db.insert(venues).values([
      {
        id: cityVenueId,
        name: "London",
        nameNormalized: "london",
        location: { lat: 51.4155, lng: -0.2098 },
        address: { formatted: "265-269 Kingston Rd Wimbledon, Wimbledon, London" },
        tz: "Europe/London",
        kind: "other",
        danceFloor: "unknown",
        metroId: LON_METRO_ID,
      },
      {
        id: realVenueId,
        name: "Cecil Sharp House",
        nameNormalized: "cecil sharp house",
        location: { lat: 51.5389, lng: -0.1494 },
        tz: "Europe/London",
        kind: "other",
        danceFloor: "yes",
        metroId: LON_METRO_ID,
      },
    ]);
    const base = {
      listingType: "social" as const,
      styles: ["ceilidh"],
      nightDate: "2026-11-13",
      tz: "Europe/London",
      confirmation: "recurring_unconfirmed" as const,
    };
    await db.insert(events).values([
      {
        ...base,
        slug: "ceilidh-club-city",
        title: "Ceilidh Club",
        titleNormalized: "ceilidh club",
        venueId: cityVenueId,
        geo: { lat: 51.4155, lng: -0.2098 },
      },
      {
        ...base,
        slug: "ceilidh-club-real",
        title: "London Ceilidh Club",
        titleNormalized: "london ceilidh club",
        venueId: realVenueId,
        geo: { lat: 51.5389, lng: -0.1494 },
      },
    ]);

    const lines = await clearNoPlaceVenues(db, LON_METRO_ID, NOW);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('"London" is no place');

    const city = await db.select().from(events).where(eq(events.slug, "ceilidh-club-city"));
    expect(city[0]?.venueId).toBeNull();
    expect(city[0]?.geo).toBeNull();
    const real = await db.select().from(events).where(eq(events.slug, "ceilidh-club-real"));
    expect(real[0]?.venueId).toBe(realVenueId);
  });
});
