// Tests for street matching and UK postcodes in withKnownVenue
import { describe, expect, it } from "vitest";
import { rawListingSchema } from "@/src/domain/listing";
import { withKnownVenue } from "@/src/pipeline/source-venue";
import type { HarvestedListing } from "@/src/adapters/types";
import type { KnownVenue } from "@/config/known-venues";
import { postcodeOf } from "@/src/domain/postcode";

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

describe("postcodeOf", () => {
  it("extracts GB postcode: '51 Croftdown Road, London NW5 1HE' -> 'NW51HE'", () => {
    expect(postcodeOf("51 Croftdown Road, London NW5 1HE", "GB")).toBe("NW51HE");
  });
  it("extracts GB postcode: 'N19GU' -> 'N19GU'", () => {
    expect(postcodeOf("N19GU", "GB")).toBe("N19GU");
  });
  it("returns null for outward code alone: 'N1'", () => {
    expect(postcodeOf("N1", "GB")).toBeNull();
  });
  it("extracts US ZIP: '10 Theatre Alley, New York, NY 10038-1234' -> '10038'", () => {
    expect(postcodeOf("10 Theatre Alley, New York, NY 10038-1234", "US")).toBe("10038");
  });
  it("takes the last postcode in an address", () => {
    expect(postcodeOf("Flat 2, E8 3RL, now at NW5 1HE", "GB")).toBe("NW51HE");
    expect(postcodeOf("Suite 12498, 239 W 14th St, NY 10011", "US")).toBe("10011");
  });
  it("returns null for US ZIP in GB call", () => {
    expect(postcodeOf("10038", "GB")).toBeNull();
  });
});

describe("withKnownVenue street matching (rule 4)", () => {
  const knownWithStreets: KnownVenue[] = [
    {
      names: ["Ecstatic Dance London, Croftdown Road"],
      address: "51 Croftdown Road, London NW5 1HE",
      streets: ["Croftdown Road"],
    },
    {
      names: ["Another Venue"],
      address: "123 Other St, London E8 3RL",
      streets: ["Other St"],
    },
  ];

  it("places listing with null name and address containing street phrase", () => {
    const listing = makeListing({
      name: null,
      address: "13 Minutes from Gospel Oak Station... Between 51 & 53 Croftdown Road",
    });
    const result = withKnownVenue(listing, knownWithStreets, "GB");
    expect(result.listing.venue.address).toBe("51 Croftdown Road, London NW5 1HE");
    expect(result.listing.venue.name).toBe("Ecstatic Dance London, Croftdown Road");
  });

  it("matches with abbreviation 'croftdown rd.'", () => {
    const listing = makeListing({
      name: null,
      address: "croftdown rd.",
    });
    const result = withKnownVenue(listing, knownWithStreets, "GB");
    expect(result.listing.venue.address).toBe("51 Croftdown Road, London NW5 1HE");
  });

  it("does not match when address has different GB postcode", () => {
    const listing = makeListing({
      name: null,
      address: "Croftdown Road, London E8 3RL",
    });
    const result = withKnownVenue(listing, knownWithStreets, "GB");
    expect(result).toBe(listing);
    expect(result.listing.venue.address).toBe("Croftdown Road, London E8 3RL");
  });

  it("returns unchanged when two entries both match", () => {
    const knownTwo = [
      {
        names: ["Venue A"],
        address: "51 Croftdown Road, London NW5 1HE",
        streets: ["Croftdown Road"],
      },
      {
        names: ["Venue B"],
        address: "52 Croftdown Road, London NW5 1HE",
        streets: ["Croftdown Road"],
      },
    ];
    const listing = makeListing({
      name: null,
      address: "Croftdown Road",
    });
    const result = withKnownVenue(listing, knownTwo, "GB");
    expect(result).toBe(listing);
  });

  it("returns unchanged when entry has no streets", () => {
    const knownNoStreets = [
      {
        names: ["Venue A"],
        address: "51 Croftdown Road, London NW5 1HE",
        // no streets
      },
    ];
    const listing = makeListing({
      name: null,
      address: "Croftdown Road",
    });
    const result = withKnownVenue(listing, knownNoStreets, "GB");
    expect(result).toBe(listing);
  });

  it("does not match 'Croftdownroad' (no word boundary)", () => {
    const listing = makeListing({
      name: null,
      address: "Croftdownroad",
    });
    const result = withKnownVenue(listing, knownWithStreets, "GB");
    expect(result).toBe(listing);
  });

  it("name match wins over street match but keeps own address when rules don't apply", () => {
    const knownMixed = [
      {
        names: ["Ecstatic Dance London, Croftdown Road"],
        address: "51 Croftdown Road, London NW5 1HE",
        streets: ["Croftdown Road"],
      },
      {
        names: ["Other Venue"],
        address: "123 Other St, London E8 3RL",
        streets: ["Other St"],
      },
    ];
    const listing = makeListing({
      name: "Other Venue",
      address: "Croftdown Road", // street matches first entry, but name matches second
    });
    const result = withKnownVenue(listing, knownMixed, "GB");
    // Name matches second entry, but address "Croftdown Road" doesn't match known address
    // (no postcode match, not town-only match, not same street), so keep original address
    expect(result.listing.venue.address).toBe("Croftdown Road");
  });

  it("GB rule 1: name match with same postcode", () => {
    const known = [
      {
        names: ["Gospel Oak Hall"],
        address: "Gospel Oak, London NW5 1HE",
      },
    ];
    const listing = makeListing({
      name: "Gospel Oak Hall",
      address: "Gospel Oak, London NW5 1HE",
    });
    const result = withKnownVenue(listing, known, "GB");
    expect(result).toBe(listing); // unchanged because address already matches
  });

  it("default countryCode US works for NYC-style ZIP rule", () => {
    const known = [
      {
        names: ["Laissez Faire"],
        address: "10 Theatre Alley, New York, NY 10038",
      },
    ];
    const listing = makeListing({
      name: "Laissez Faire",
      address: "10 Theater Alley, New York, NY 10038-1234",
    });
    const result = withKnownVenue(listing, known); // default "US"
    expect(result.listing.venue.address).toBe("10 Theatre Alley, New York, NY 10038");
  });
});
