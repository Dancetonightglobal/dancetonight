// D-198: a venue page's listings named as a short or long form of its label take its address.
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

describe("withSourceVenue (venuePage prefix rule D-198)", () => {
  it("venuePage true, label longer, listing name shorter prefix -> applies address", () => {
    const seed = {
      label: "The Greyhound (Peckham)",
      venueAddress: "123 Peckham Rd",
      venuePage: true,
    };
    const listing = makeListing({ name: "The Greyhound" });
    const result = withSourceVenue(listing, seed);
    expect(result.listing.venue.address).toBe("123 Peckham Rd");
    expect(result.listing.venue.name).toBe("The Greyhound"); // kept as written
  });

  it("venuePage true, label shorter, listing name longer prefix -> applies address", () => {
    const seed = { label: "EartH", venueAddress: "1 Hackney Rd", venuePage: true };
    const listing = makeListing({ name: "EartH Hackney" });
    const result = withSourceVenue(listing, seed);
    expect(result.listing.venue.address).toBe("1 Hackney Rd");
    expect(result.listing.venue.name).toBe("EartH Hackney");
  });

  it("venuePage true, prefix but shorter key <4 chars -> no match", () => {
    const seed = { label: "The", venueAddress: "some address", venuePage: true };
    const listing = makeListing({ name: "The Place" });
    const result = withSourceVenue(listing, seed);
    expect(result).toBe(listing); // unchanged
  });

  it("venuePage true, not a prefix (different words) -> no match", () => {
    const seed = { label: "Greyhound Tavern", venueAddress: "addr", venuePage: true };
    const listing = makeListing({ name: "Greyhound Peckham" });
    const result = withSourceVenue(listing, seed);
    expect(result).toBe(listing);
  });

  it("venuePage true, prefix but not whole-word (eart vs earth) -> no match", () => {
    const seed = { label: "EartH Hackney", venueAddress: "addr", venuePage: true };
    const listing = makeListing({ name: "Eart" });
    const result = withSourceVenue(listing, seed);
    expect(result).toBe(listing);
  });

  it("venuePage false, equal keys still match", () => {
    const seed = { label: "Signal", venueAddress: "175 Morgan Ave", venuePage: false };
    const listing = makeListing({ name: "Signal" });
    const result = withSourceVenue(listing, seed);
    expect(result.listing.venue.address).toBe("175 Morgan Ave");
  });

  it("venuePage false, prefix rule not applied -> no match", () => {
    const seed = { label: "The Greyhound (Peckham)", venueAddress: "addr", venuePage: false };
    const listing = makeListing({ name: "The Greyhound" });
    const result = withSourceVenue(listing, seed);
    expect(result).toBe(listing);
  });

  it("venuePage true, listing already has non-empty address -> overrides when address not street and name matches", () => {
    const seed = { label: "The Greyhound (Peckham)", venueAddress: "new addr", venuePage: true };
    const listing = makeListing({ name: "The Greyhound", address: "existing addr" });
    const result = withSourceVenue(listing, seed);
    // D-250: address is not a street address, name matches label, so override
    expect(result.listing.venue.address).toBe("new addr");
    expect(result.listing.venue.name).toBe("The Greyhound");
  });

  it("no seed -> unchanged", () => {
    const listing = makeListing({ name: "The Greyhound" });
    const result = withSourceVenue(listing, undefined);
    expect(result).toBe(listing);
  });

  it("seed without venueAddress -> unchanged", () => {
    const seed = { label: "The Greyhound (Peckham)", venuePage: true };
    const listing = makeListing({ name: "The Greyhound" });
    const result = withSourceVenue(listing, seed);
    expect(result).toBe(listing);
  });

  it("listing name null, venuePage true -> applies label and address", () => {
    const seed = { label: "The Greyhound (Peckham)", venueAddress: "123 Rd", venuePage: true };
    const listing = makeListing({ name: null });
    const result = withSourceVenue(listing, seed);
    expect(result.listing.venue.name).toBe("The Greyhound (Peckham)");
    expect(result.listing.venue.address).toBe("123 Rd");
  });

  it("listing name empty string, venuePage true -> applies label and address", () => {
    const seed = { label: "The Greyhound (Peckham)", venueAddress: "123 Rd", venuePage: true };
    const listing = makeListing({ name: "" });
    const result = withSourceVenue(listing, seed);
    expect(result.listing.venue.name).toBe("The Greyhound (Peckham)");
    expect(result.listing.venue.address).toBe("123 Rd");
  });

  it("venuePage true, EartH for EartH Hackney -> applies address", () => {
    const seed = {
      label: "EartH Hackney",
      venueAddress: "11-17 Stoke Newington Road",
      venuePage: true,
    };
    const result = withSourceVenue(makeListing({ name: "EartH" }), seed);
    expect(result.listing.venue.address).toBe("11-17 Stoke Newington Road");
  });

  it("venuePage true, another venue named after the area (Hackney) -> no match", () => {
    const seed = { label: "EartH Hackney", venueAddress: "addr", venuePage: true };
    const listing = makeListing({ name: "Hackney" });
    expect(withSourceVenue(listing, seed)).toBe(listing);
  });
});
