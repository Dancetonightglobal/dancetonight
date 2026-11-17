// D-226: a venue page placed at its venue still gives its address to a listing naming the venue another way.
import { describe, expect, it } from "vitest";
import { rawListingSchema } from "@/src/domain/listing";
import { withSeedVenue } from "@/src/pipeline/source-venue";
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
    tz: "Europe/London",
    venueLocation: null,
    recurrence: null,
    provenance: {
      sourceUrl: "https://earthackney.co.uk/events/",
      fetchedAt: new Date(),
      method: "feed",
    },
  };
}

describe("withSeedVenue (D-226)", () => {
  const seed = {
    label: "EartH Hackney",
    venueAddress: "11-17 Stoke Newington Road, London N16 8BH",
    venuePage: true,
  };

  it("sourcePlaced true, venue name matches label, no address -> address is the seed's", () => {
    const listing = makeListing({ name: "EartH Hackney", address: null });
    const result = withSeedVenue(listing, seed, true);
    expect(result.listing.venue.address).toBe("11-17 Stoke Newington Road, London N16 8BH");
    expect(result.listing.venue.name).toBe("EartH Hackney");
  });

  it("sourcePlaced true, venue name is prefix form -> address is the seed's", () => {
    const listing = makeListing({ name: "EartH", address: null });
    const result = withSeedVenue(listing, seed, true);
    expect(result.listing.venue.address).toBe("11-17 Stoke Newington Road, London N16 8BH");
    expect(result.listing.venue.name).toBe("EartH");
  });

  it("sourcePlaced true, no venue name -> listing returned unchanged (no address filled)", () => {
    const listing = makeListing({ name: null, address: null });
    const result = withSeedVenue(listing, seed, true);
    expect(result).toBe(listing);
    expect(result.listing.venue.address).toBeNull();
    expect(result.listing.venue.name).toBeNull();
  });

  it("sourcePlaced true, venue name is a different place -> unchanged", () => {
    const listing = makeListing({ name: "Oslo Hackney", address: null });
    const result = withSeedVenue(listing, seed, true);
    expect(result).toBe(listing);
    expect(result.listing.venue.address).toBeNull();
  });

  it("sourcePlaced false, no venue name -> name and address filled from seed", () => {
    const listing = makeListing({ name: null, address: null });
    const result = withSeedVenue(listing, seed, false);
    expect(result.listing.venue.name).toBe("EartH Hackney");
    expect(result.listing.venue.address).toBe("11-17 Stoke Newington Road, London N16 8BH");
  });

  it("seed undefined -> unchanged", () => {
    const listing = makeListing({ name: "EartH Hackney", address: null });
    const result = withSeedVenue(listing, undefined, true);
    expect(result).toBe(listing);
  });

  it("sourcePlaced false, venue name matches -> address filled", () => {
    const listing = makeListing({ name: "EartH Hackney", address: null });
    const result = withSeedVenue(listing, seed, false);
    expect(result.listing.venue.address).toBe("11-17 Stoke Newington Road, London N16 8BH");
  });
});
