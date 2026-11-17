// D-138: withSourceVenue places a starting source's listings at the venue address it states.
import { describe, expect, it } from "vitest";
import { rawListingSchema } from "@/src/domain/listing";
import { withSourceVenue } from "@/src/pipeline/source-venue";
import type { HarvestedListing } from "@/src/adapters/types";

function makeListing(venue: { name?: string | null; address?: string | null }): HarvestedListing {
  const raw = rawListingSchema.parse({
    title: "Test Event",
    listing_type: "social",
    styles: ["salsa"],
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

describe("withSourceVenue", () => {
  const seed = { label: "Signal", venueAddress: "175 Morgan Ave, Brooklyn, NY 11237" };

  it("returns unchanged when no seed", () => {
    const listing = makeListing({});
    const result = withSourceVenue(listing, undefined);
    expect(result).toBe(listing);
  });

  it("returns unchanged when seed has no venueAddress", () => {
    const listing = makeListing({});
    const result = withSourceVenue(listing, { label: "Signal" });
    expect(result).toBe(listing);
  });

  it("returns unchanged when listing already has an address", () => {
    const listing = makeListing({ address: "123 Main St" });
    const result = withSourceVenue(listing, seed);
    expect(result).toBe(listing);
  });

  it("returns unchanged when listing names another place", () => {
    const listing = makeListing({ name: "Elsewhere Hall" });
    const result = withSourceVenue(listing, seed);
    expect(result).toBe(listing);
  });

  it("applies address when listing names 'The Signal' (normalized matches label)", () => {
    const listing = makeListing({ name: "The Signal" });
    const result = withSourceVenue(listing, seed);
    // Should apply because normalized name matches label after dropping "the"
    expect(result).not.toBe(listing);
    expect(result.listing.venue.name).toBe("The Signal");
    expect(result.listing.venue.address).toBe(seed.venueAddress);
  });

  it("applies label and address when venue name is null", () => {
    const listing = makeListing({ name: null, address: null });
    const result = withSourceVenue(listing, seed);
    expect(result).not.toBe(listing);
    expect(result.listing.venue.name).toBe("Signal");
    expect(result.listing.venue.address).toBe(seed.venueAddress);
  });

  it("applies address when venue name matches label exactly", () => {
    const listing = makeListing({ name: "Signal" });
    const result = withSourceVenue(listing, seed);
    expect(result).not.toBe(listing);
    expect(result.listing.venue.name).toBe("Signal");
    expect(result.listing.venue.address).toBe(seed.venueAddress);
  });

  it("keeps existing venue.url", () => {
    const raw = rawListingSchema.parse({
      title: "Test",
      listing_type: "social",
      styles: ["salsa"],
      local_date: "2026-10-11",
      doors_time: "20:00",
      venue: {
        name: null,
        address: null,
        url: "https://signalnyc.club",
      },
      organizer: { name: null, url: null },
    });
    const listing: HarvestedListing = {
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
    const result = withSourceVenue(listing, seed);
    expect(result.listing.venue.url).toBe("https://signalnyc.club");
    expect(result.listing.venue.address).toBe(seed.venueAddress);
  });

  it("does not mutate input object", () => {
    const listing = makeListing({ name: null, address: null });
    const originalVenue = { ...listing.listing.venue };
    const result = withSourceVenue(listing, seed);
    expect(listing.listing.venue).toEqual(originalVenue);
    expect(result).not.toBe(listing);
  });
});
