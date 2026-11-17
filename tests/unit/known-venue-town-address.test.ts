// Tests for town-only and same-street address handling in withKnownVenue
import { describe, expect, it } from "vitest";
import { rawListingSchema } from "@/src/domain/listing";
import { withKnownVenue } from "@/src/pipeline/source-venue";
import type { HarvestedListing } from "@/src/adapters/types";
import type { KnownVenue } from "@/config/known-venues";

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

describe("withKnownVenue town-only and same-street address handling", () => {
  // Use the existing known venues for rule 2 tests
  const knownNyc = [
    {
      names: ["The Last Word"],
      address: "31-30 Ditmars Blvd, Astoria, NY 11105",
    },
    {
      names: ["Laissez Faire", "Laissez-Faire"],
      address: "10 Theatre Alley, New York, NY 10038",
    },
  ];

  // Custom list for rule 3 tests (The Keep)
  const keepList: KnownVenue[] = [
    { names: ["The Keep"], address: "205 Cypress Ave, Ridgewood, NY 11385" },
  ];

  describe("rule 2: town-only address (no digits)", () => {
    it("takes checked address for 'Astoria'", () => {
      const listing = makeListing({ name: "The Last Word", address: "Astoria" });
      const result = withKnownVenue(listing, knownNyc);
      expect(result.listing.venue.address).toBe("31-30 Ditmars Blvd, Astoria, NY 11105");
      expect(result.listing.venue.name).toBe("The Last Word");
    });

    it("takes checked address for 'Astoria, NY'", () => {
      const listing = makeListing({ name: "The Last Word", address: "Astoria, NY" });
      const result = withKnownVenue(listing, knownNyc);
      expect(result.listing.venue.address).toBe("31-30 Ditmars Blvd, Astoria, NY 11105");
      expect(result.listing.venue.name).toBe("The Last Word");
    });

    it("takes checked address for 'Astoria, New York'", () => {
      const listing = makeListing({ name: "The Last Word", address: "Astoria, New York" });
      const result = withKnownVenue(listing, knownNyc);
      expect(result.listing.venue.address).toBe("31-30 Ditmars Blvd, Astoria, NY 11105");
      expect(result.listing.venue.name).toBe("The Last Word");
    });

    it("keeps own address for 'Austin, TX'", () => {
      const listing = makeListing({ name: "The Last Word", address: "Austin, TX" });
      const result = withKnownVenue(listing, knownNyc);
      expect(result).toBe(listing);
      expect(result.listing.venue.address).toBe("Austin, TX");
    });

    it("keeps own address for 'Brooklyn' (not matching known address)", () => {
      const listing = makeListing({ name: "The Last Word", address: "Brooklyn" });
      const result = withKnownVenue(listing, knownNyc);
      expect(result).toBe(listing);
      expect(result.listing.venue.address).toBe("Brooklyn");
    });
  });

  describe("rule 3: address with digits but no ZIP", () => {
    it("takes checked address for '205 Cypress Ave, Brooklyn'", () => {
      const listing = makeListing({ name: "The Keep", address: "205 Cypress Ave, Brooklyn" });
      const result = withKnownVenue(listing, keepList);
      expect(result.listing.venue.address).toBe("205 Cypress Ave, Ridgewood, NY 11385");
      expect(result.listing.venue.name).toBe("The Keep");
    });

    it("takes checked address for '205 Cypress Avenue'", () => {
      const listing = makeListing({ name: "The Keep", address: "205 Cypress Avenue" });
      const result = withKnownVenue(listing, keepList);
      expect(result.listing.venue.address).toBe("205 Cypress Ave, Ridgewood, NY 11385");
      expect(result.listing.venue.name).toBe("The Keep");
    });

    it("keeps own address for '207 Cypress Ave, Brooklyn'", () => {
      const listing = makeListing({ name: "The Keep", address: "207 Cypress Ave, Brooklyn" });
      const result = withKnownVenue(listing, keepList);
      expect(result).toBe(listing);
      expect(result.listing.venue.address).toBe("207 Cypress Ave, Brooklyn");
    });

    it("keeps own address for '1 Other St'", () => {
      const listing = makeListing({ name: "The Keep", address: "1 Other St" });
      const result = withKnownVenue(listing, keepList);
      expect(result).toBe(listing);
      expect(result.listing.venue.address).toBe("1 Other St");
    });
  });
});
