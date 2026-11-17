// Tests for Colombian street address matching in sameStreet
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
    tz: "America/Bogota",
    venueLocation: null,
    recurrence: null,
    provenance: {
      sourceUrl: "https://example.com",
      fetchedAt: new Date(),
      method: "feed",
    },
  };
}

describe("withKnownVenue Colombian street matching", () => {
  it("matches Cr48#10-70 to Carrera 48 #10-70", () => {
    const knownVenue: KnownVenue = {
      names: ["Rama Soundgarden"],
      address: "Carrera 48 #10-70, Manila, El Poblado, Medellín",
    };
    const listing = makeListing({
      name: "Rama Soundgarden",
      address: "Cr48#10-70 El Poblado, (Manila) - Medellin",
    });
    const result = withKnownVenue(listing, [knownVenue], "CO");
    expect(result.listing.venue.address).toBe("Carrera 48 #10-70, Manila, El Poblado, Medellín");
  });

  it("matches Cl 10 #40-20 to Calle 10 # 40-20", () => {
    const knownVenue: KnownVenue = {
      names: ["Test Venue"],
      address: "Calle 10 # 40-20, El Poblado, Medellín",
    };
    const listing = makeListing({
      name: "Test Venue",
      address: "Cl 10 #40-20, Medellín",
    });
    const result = withKnownVenue(listing, [knownVenue], "CO");
    expect(result.listing.venue.address).toBe("Calle 10 # 40-20, El Poblado, Medellín");
  });

  it("matches Cra 43 A #7-50 to Carrera 43A No. 7-50", () => {
    const knownVenue: KnownVenue = {
      names: ["Test Venue"],
      address: "Carrera 43A No. 7-50, Medellín",
    };
    const listing = makeListing({
      name: "Test Venue",
      address: "Cra 43 A #7-50, Medellín",
    });
    const result = withKnownVenue(listing, [knownVenue], "CO");
    expect(result.listing.venue.address).toBe("Carrera 43A No. 7-50, Medellín");
  });

  it("does NOT match different street type (Calle vs Carrera)", () => {
    const knownVenue: KnownVenue = {
      names: ["Test Venue"],
      address: "Carrera 48 #10-70, Medellín",
    };
    const listing = makeListing({
      name: "Test Venue",
      address: "Calle 48 #10-70, Medellín",
    });
    const result = withKnownVenue(listing, [knownVenue], "CO");
    // Should keep its own address
    expect(result.listing.venue.address).toBe("Calle 48 #10-70, Medellín");
  });

  it("does NOT match different plate number", () => {
    const knownVenue: KnownVenue = {
      names: ["Test Venue"],
      address: "Carrera 48 #10-70, Medellín",
    };
    const listing = makeListing({
      name: "Test Venue",
      address: "Carrera 48 #10-72, Medellín",
    });
    const result = withKnownVenue(listing, [knownVenue], "CO");
    expect(result.listing.venue.address).toBe("Carrera 48 #10-72, Medellín");
  });

  it("US regression: matches English street abbreviations", () => {
    const knownVenue: KnownVenue = {
      names: ["DBA New Orleans"],
      address: "618 Frenchmen St, New Orleans, LA 70116",
    };
    const listing = makeListing({
      name: "DBA New Orleans",
      address: "618 Frenchmen Street, New Orleans, LA, USA",
    });
    const result = withKnownVenue(listing, [knownVenue], "US");
    expect(result.listing.venue.address).toBe("618 Frenchmen St, New Orleans, LA 70116");
  });
});
