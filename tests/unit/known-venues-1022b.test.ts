// Known venues: a listing that names a hand-checked venue and gives no address is placed there.
import { describe, expect, it } from "vitest";
import { KNOWN_VENUES } from "@/config/known-venues";
import { NYC_SOURCES } from "@/config/sources/nyc";
import { rawListingSchema } from "@/src/domain/listing";
import { withKnownVenue } from "@/src/pipeline/source-venue";
import type { HarvestedListing } from "@/src/adapters/types";

function makeListing(venue: { name?: string | null; address?: string | null }): HarvestedListing {
  const raw = rawListingSchema.parse({
    title: "Test Event",
    listing_type: "social",
    styles: ["swing"],
    local_date: "2026-10-11",
    doors_time: "20:00",
    venue: {
      name: venue.name ?? null,
      address: venue.address ?? null,
      url: null,
    },
    organizer: { name: null, url: null },
  });
  return {
    listing: raw,
    externalId: "test:1",
    tz: "America/New_York",
    venueLocation: null,
    recurrence: null,
    provenance: {
      sourceUrl: "https://example.com",
      fetchedAt: new Date(),
      method: "feed",
    },
  };
}

describe("withKnownVenue", () => {
  const known = KNOWN_VENUES.nyc ?? [];

  it("places 'Domino park' (lower-case p) at the known address and keeps the name", () => {
    const listing = makeListing({ name: "Domino park" });
    const result = withKnownVenue(listing, known);
    expect(result).not.toBe(listing);
    expect(result.listing.venue.address).toBe("15 River St, Brooklyn, NY 11249");
    expect(result.listing.venue.name).toBe("Domino park");
  });

  it("places 'Othership Williamsburg' at the known address", () => {
    const listing = makeListing({ name: "Othership Williamsburg" });
    const result = withKnownVenue(listing, known);
    expect(result.listing.venue.address).toBe("25 Kent Ave, Brooklyn, NY 11249");
  });

  it("places 'La Capilla del Tango' at the known address", () => {
    const listing = makeListing({ name: "La Capilla del Tango" });
    const result = withKnownVenue(listing, known);
    expect(result.listing.venue.address).toBe("543 Main St, New York, NY 10044");
  });

  it("keeps a listing that already has the exact known address", () => {
    const listing = makeListing({
      name: "The Keep",
      address: "205 Cypress Ave, Ridgewood, NY 11385",
    });
    const result = withKnownVenue(listing, known);
    expect(result).toBe(listing);
    expect(result.listing.venue.address).toBe("205 Cypress Ave, Ridgewood, NY 11385");
  });

  it("places Brooklyn Heights International Folk Dancers at its church", () => {
    const source = NYC_SOURCES.find(
      (seed) => seed.url === "https://brooklynheightsfolkdancers.org/events/list/",
    );
    expect(source?.venueAddress).toBe("125 Henry St, Brooklyn, NY 11201");
    expect(source?.onlyHere).toBe(true);
  });

  it("places DICE's 'The Newsroom, New York City' at the Newsroom Speakeasy", () => {
    const listing = makeListing({ name: "The Newsroom, New York City" });
    const result = withKnownVenue(listing, known);
    expect(result).not.toBe(listing);
    expect(result.listing.venue.address).toBe("11-01 43rd Ave, Long Island City, NY 11101");
    expect(result.listing.venue.name).toBe("The Newsroom, New York City");
  });
});
