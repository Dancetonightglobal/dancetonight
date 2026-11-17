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

describe("withKnownVenue point handling (D-260)", () => {
  const known: KnownVenue[] = [
    {
      names: ["Asado Argentino"],
      address: "C. Dinamarca 72, Juárez, Cuauhtémoc, 06600 Ciudad de México, CDMX",
      streets: ["Dinamarca 72"],
      point: { lat: 19.42605, lng: -99.15767 },
    },
    {
      names: ["Foro Lindbergh"],
      address: "Parque México, Av México s/n, Hipódromo, Cuauhtémoc, 06100 Ciudad de México, CDMX",
      point: { lat: 19.41186, lng: -99.16981 },
    },
    {
      names: ["Salón Sin Punto"],
      address: "Av. Insurgentes Sur 100, Roma Nte., 06700 Ciudad de México, CDMX",
    },
  ];

  it("1. Name match, no address on the listing: venue.address becomes entry address, venueLocation set to point", () => {
    const listing = makeListing({
      name: "Asado Argentino",
      address: null,
    });
    const result = withKnownVenue(listing, known, "MX");
    expect(result.listing.venue.address).toBe(
      "C. Dinamarca 72, Juárez, Cuauhtémoc, 06600 Ciudad de México, CDMX",
    );
    expect(result.venueLocation).toEqual({ lat: 19.42605, lng: -99.15767 });
  });

  it("2. Name match with identical address: venueLocation set to entry's point", () => {
    const listing = makeListing({
      name: "Asado Argentino",
      address: "C. Dinamarca 72, Juárez, Cuauhtémoc, 06600 Ciudad de México, CDMX",
    });
    const result = withKnownVenue(listing, known, "MX");
    expect(result.listing.venue.address).toBe(
      "C. Dinamarca 72, Juárez, Cuauhtémoc, 06600 Ciudad de México, CDMX",
    );
    expect(result.venueLocation).toEqual({ lat: 19.42605, lng: -99.15767 });
  });

  it("3. Street match: venue name null, address contains street phrase, venueLocation set to point", () => {
    const listing = makeListing({
      name: null,
      address: "Asado Argentino, C. Dinamarca 72, Juárez, Cuauhtémoc, 06600 Ciudad de México",
    });
    const result = withKnownVenue(listing, known, "MX");
    expect(result.listing.venue.address).toBe(
      "C. Dinamarca 72, Juárez, Cuauhtémoc, 06600 Ciudad de México, CDMX",
    );
    expect(result.venueLocation).toEqual({ lat: 19.42605, lng: -99.15767 });
  });

  it("4. Source point present and entry applied: entry's point wins", () => {
    const listing: HarvestedListing = {
      ...makeListing({
        name: "Asado Argentino",
        address: null,
      }),
      venueLocation: { lat: 19.4326, lng: -99.1332 },
    };
    const result = withKnownVenue(listing, known, "MX");
    expect(result.venueLocation).toEqual({ lat: 19.42605, lng: -99.15767 });
  });

  it("5. Entry without point: address taken, venueLocation stays null", () => {
    const listing = makeListing({
      name: "Salón Sin Punto",
      address: null,
    });
    const result = withKnownVenue(listing, known, "MX");
    expect(result.listing.venue.address).toBe(
      "Av. Insurgentes Sur 100, Roma Nte., 06700 Ciudad de México, CDMX",
    );
    expect(result.venueLocation).toBeNull();
  });

  it("6. Not applied: listing returned unchanged, venueLocation null", () => {
    const listing = makeListing({
      name: "Somewhere Else",
      address: "Calle Falsa 1, Coyoacán",
    });
    const result = withKnownVenue(listing, known, "MX");
    expect(result).toBe(listing);
    expect(result.listing.venue.address).toBe("Calle Falsa 1, Coyoacán");
    expect(result.venueLocation).toBeNull();
  });

  it("7. Input listing object is not mutated", () => {
    const listing = makeListing({
      name: "Asado Argentino",
      address: null,
    });
    const originalVenueLocation = listing.venueLocation;
    const originalAddress = listing.listing.venue.address;
    const result = withKnownVenue(listing, known, "MX");
    // Original unchanged
    expect(listing.venueLocation).toBe(originalVenueLocation);
    expect(listing.listing.venue.address).toBe(originalAddress);
    // New result has changes
    expect(result.venueLocation).not.toBe(originalVenueLocation);
    expect(result.listing.venue.address).not.toBe(originalAddress);
  });
});
