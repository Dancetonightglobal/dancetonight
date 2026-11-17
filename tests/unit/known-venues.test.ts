// Known venues: a listing that names a hand-checked venue and gives no address is placed there.
import { describe, expect, it } from "vitest";
import { KNOWN_VENUES } from "@/config/known-venues";
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
  const known = KNOWN_VENUES.nyc;

  it("places 'The Last Word, Astoria' at the known address and keeps the name", () => {
    const listing = makeListing({ name: "The Last Word, Astoria" });
    const result = withKnownVenue(listing, known);
    expect(result).not.toBe(listing);
    expect(result.listing.venue.address).toBe("31-30 Ditmars Blvd, Astoria, NY 11105");
    expect(result.listing.venue.name).toBe("The Last Word, Astoria");
  });

  it("matches 'last word' in lowercase without 'the'", () => {
    const listing = makeListing({ name: "last word" });
    const result = withKnownVenue(listing, known);
    expect(result.listing.venue.address).toBe("31-30 Ditmars Blvd, Astoria, NY 11105");
  });

  it("matches 'Laissez-Faire' to the Laissez Faire entry", () => {
    const listing = makeListing({ name: "Laissez-Faire" });
    const result = withKnownVenue(listing, known);
    expect(result.listing.venue.address).toBe("10 Theatre Alley, New York, NY 10038");
  });

  it('places "Mirelle\'s" with no address at the known address', () => {
    const listing = makeListing({ name: "Mirelle's" });
    const result = withKnownVenue(listing, known);
    expect(result).not.toBe(listing);
    expect(result.listing.venue.address).toBe("170 Post Ave, Westbury, NY 11590");
    expect(result.listing.venue.name).toBe("Mirelle's");
  });

  it("places 'Starlight Dance Center' with no address at the known address", () => {
    const listing = makeListing({ name: "Starlight Dance Center" });
    const result = withKnownVenue(listing, known);
    expect(result).not.toBe(listing);
    expect(result.listing.venue.address).toBe("7 High St, Nutley, NJ 07110");
    expect(result.listing.venue.name).toBe("Starlight Dance Center");
  });

  it("keeps a listing that already has an address", () => {
    const listing = makeListing({ name: "The Last Word", address: "1 Other St" });
    const result = withKnownVenue(listing, known);
    expect(result).toBe(listing);
    expect(result.listing.venue.address).toBe("1 Other St");
  });

  it("uses the known address when the listing's misspelt address has the same ZIP", () => {
    const listing = makeListing({
      name: "Laissez Faire",
      address: "10 Theater Alley, New York City, New York 10038, United States",
    });
    const result = withKnownVenue(listing, known);
    expect(result).not.toBe(listing);
    expect(result.listing.venue.address).toBe("10 Theatre Alley, New York, NY 10038");
    expect(result.listing.venue.name).toBe("Laissez Faire");
  });

  it("uses the known address when the listing's ZIP is ZIP+4 of the same ZIP", () => {
    const listing = makeListing({
      name: "Laissez Faire",
      address: "10 Theater Alley, New York, NY 10038-1234",
    });
    const result = withKnownVenue(listing, known);
    expect(result.listing.venue.address).toBe("10 Theatre Alley, New York, NY 10038");
  });

  it("keeps the listing's address when its ZIP differs", () => {
    const listing = makeListing({
      name: "Laissez Faire",
      address: "500 Collins Ave, Miami Beach, FL 33139",
    });
    const result = withKnownVenue(listing, known);
    expect(result).toBe(listing);
    expect(result.listing.venue.address).toBe("500 Collins Ave, Miami Beach, FL 33139");
  });

  it("returns the same object when the address already is the known address", () => {
    const listing = makeListing({
      name: "The Last Word",
      address: "31-30 Ditmars Blvd, Astoria, NY 11105",
    });
    const result = withKnownVenue(listing, known);
    expect(result).toBe(listing);
  });

  it("does not match on ZIP alone when the name is not known", () => {
    const listing = makeListing({
      name: "Some Other Bar",
      address: "10 Theater Alley, New York, NY 10038",
    });
    const result = withKnownVenue(listing, known);
    expect(result).toBe(listing);
  });

  it("keeps a town-only address that is not the known venue's town", () => {
    const listing = makeListing({ name: "The Last Word", address: "Austin, TX" });
    const result = withKnownVenue(listing, known);
    expect(result).toBe(listing);
    expect(result.listing.venue.address).toBe("Austin, TX");
  });

  it("does not match 'The Last Word Lounge'", () => {
    const listing = makeListing({ name: "The Last Word Lounge" });
    const result = withKnownVenue(listing, known);
    expect(result).toBe(listing);
  });

  it("returns the same object when the name is null", () => {
    const listing = makeListing({ name: null });
    const result = withKnownVenue(listing, known);
    expect(result).toBe(listing);
  });

  it("returns the same object when the name is empty", () => {
    const base = makeListing({ name: null });
    const listing: HarvestedListing = {
      ...base,
      listing: { ...base.listing, venue: { ...base.listing.venue, name: "" } },
    };
    const result = withKnownVenue(listing, known);
    expect(result).toBe(listing);
  });

  it("returns the same object when the metro has no list", () => {
    const listing = makeListing({ name: "The Last Word" });
    const result = withKnownVenue(listing, undefined);
    expect(result).toBe(listing);
  });

  it("has a name and a ZIP-ended address for every nyc entry", () => {
    expect(known).toBeDefined();
    for (const entry of known ?? []) {
      expect(entry.names.length).toBeGreaterThan(0);
      expect(entry.address).toMatch(/\b\d{5}$/);
    }
  });
});
