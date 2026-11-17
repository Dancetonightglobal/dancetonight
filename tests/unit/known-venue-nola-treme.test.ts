// New Orleans: WWOZ's "Takin' It to the Streets" parade pages give a route start with a name and no street address.
// The Family Ties Second Line Parade (2026-11-14) starts at "Treme Center", so the adapter writes
// "Route starts at Treme Center" with no address. The KnownVenue places it by its name.
import { describe, expect, it } from "vitest";
import { KNOWN_VENUES } from "@/config/known-venues";
import type { HarvestedListing } from "@/src/adapters/types";
import { rawListingSchema } from "@/src/domain/listing";
import { withKnownVenue } from "@/src/pipeline/source-venue";

function makeListing(name: string | null, address: string | null): HarvestedListing {
  const raw = rawListingSchema.parse({
    title: "Family Ties Second Line Parade",
    listing_type: "party",
    styles: [],
    local_date: "2026-11-14",
    doors_time: "13:00",
    venue: { name, address, url: null },
    organizer: { name: null, url: null },
  });
  return {
    listing: raw,
    externalId: "test:1",
    tz: "America/Chicago",
    venueLocation: null,
    recurrence: null,
    provenance: {
      sourceUrl: "https://www.wwoz.org/events/1378681",
      fetchedAt: new Date(),
      method: "feed",
    },
  };
}

const ENTRIES = KNOWN_VENUES["new-orleans"] ?? [];

describe("Tremé Center, New Orleans", () => {
  it("places a 'Route starts at Treme Center' row at the Tremé Center", () => {
    const out = withKnownVenue(makeListing("Route starts at Treme Center", null), ENTRIES, "US");
    expect(out.listing.venue.address).toBe("900 N Villere St, New Orleans, LA 70116");
    expect(out.venueLocation).toBeNull();
  });

  it("places a 'Treme Center' row at the Tremé Center", () => {
    const out = withKnownVenue(makeListing("Treme Center", null), ENTRIES, "US");
    expect(out.listing.venue.address).toBe("900 N Villere St, New Orleans, LA 70116");
    expect(out.venueLocation).toBeNull();
  });

  it("leaves an unmatched 'Route starts at' row unchanged", () => {
    const out = withKnownVenue(makeListing("Route starts at Some Other Bar", null), ENTRIES, "US");
    expect(out.listing.venue.address).toBeNull();
    expect(out.venueLocation).toBeNull();
  });
});
