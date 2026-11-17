import { describe, expect, it } from "vitest";
import { rawListingSchema } from "@/src/domain/listing";
import { withTitleVenue } from "@/src/pipeline/source-venue";
import type { HarvestedListing } from "@/src/adapters/types";

function makeListing(
  title: string,
  venue: { name?: string | null; address?: string | null },
  venueLocation?: { lat: number; lng: number } | null,
): HarvestedListing {
  const raw = rawListingSchema.parse({
    title,
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
    venueLocation: venueLocation ?? null,
    recurrence: null,
    provenance: {
      sourceUrl: "https://example.com",
      fetchedAt: new Date(),
      method: "feed",
    },
  };
}

describe("withTitleVenue area-only address", () => {
  const map = {
    "Tango Mia": "Tango Mia",
    Tormenta: "Milonga Tormenta",
  };

  it("fills name and nulls address for area-only address, adds note", () => {
    const listing = makeListing("Tango Mia Milonga", {
      name: null,
      address: "Taksim / İstanbul",
    });
    const notes: string[] = [];
    const result = withTitleVenue(listing, map, notes);
    expect(result.listing.venue.name).toBe("Tango Mia");
    expect(result.listing.venue.address).toBeNull();
    expect(notes).toEqual([
      'Tango Mia Milonga: area-only address "Taksim / İstanbul" replaced by title venue Tango Mia',
    ]);
  });

  it("works with empty string name and trimmed address", () => {
    const listing = makeListing("Milonga Tormenta", {
      name: "",
      address: "  Kadıköy / İstanbul ",
    });
    const notes: string[] = [];
    const result = withTitleVenue(listing, map, notes);
    expect(result.listing.venue.name).toBe("Milonga Tormenta");
    expect(result.listing.venue.address).toBeNull();
    expect(notes).toEqual([
      'Milonga Tormenta: area-only address "Kadıköy / İstanbul" replaced by title venue Milonga Tormenta',
    ]);
  });

  it("keeps street address unchanged", () => {
    const listing = makeListing("Tango Mia Milonga", {
      name: null,
      address: "Sahne Sokağı No:5, Beyoğlu",
    });
    const notes: string[] = [];
    const result = withTitleVenue(listing, map, notes);
    expect(result.listing.venue.name).toBeNull();
    expect(result.listing.venue.address).toBe("Sahne Sokağı No:5, Beyoğlu");
    expect(notes).toEqual([]);
  });

  it("keeps postcode address unchanged", () => {
    const listing = makeListing("Tango Mia Milonga", {
      name: null,
      address: "Kadıköy 34710",
    });
    const notes: string[] = [];
    const result = withTitleVenue(listing, map, notes);
    expect(result.listing.venue.name).toBeNull();
    expect(result.listing.venue.address).toBe("Kadıköy 34710");
    expect(notes).toEqual([]);
  });

  it("does not apply when name present even with area-only address", () => {
    const listing = makeListing("Tango Mia Milonga", {
      name: "Other Bar",
      address: "Taksim / İstanbul",
    });
    const notes: string[] = [];
    const result = withTitleVenue(listing, map, notes);
    expect(result.listing.venue.name).toBe("Other Bar");
    expect(result.listing.venue.address).toBe("Taksim / İstanbul");
    expect(notes).toEqual([]);
  });

  it("no title match leaves listing unchanged", () => {
    const listing = makeListing("Salsa Night", {
      name: null,
      address: "Taksim / İstanbul",
    });
    const notes: string[] = [];
    const result = withTitleVenue(listing, map, notes);
    expect(result.listing.venue.name).toBeNull();
    expect(result.listing.venue.address).toBe("Taksim / İstanbul");
    expect(notes).toEqual([]);
  });

  it("venueLocation present prevents any change", () => {
    const listing = makeListing(
      "Tango Mia Milonga",
      { name: null, address: "Taksim" },
      { lat: 41, lng: 29 },
    );
    const notes: string[] = [];
    const result = withTitleVenue(listing, map, notes);
    expect(result.listing.venue.name).toBeNull();
    expect(result.listing.venue.address).toBe("Taksim");
    expect(result.venueLocation).toEqual({ lat: 41, lng: 29 });
    expect(notes).toEqual([]);
  });

  it("works without notes argument", () => {
    const listing = makeListing("Tango Mia Milonga", {
      name: null,
      address: "Taksim / İstanbul",
    });
    const result = withTitleVenue(listing, map);
    expect(result.listing.venue.name).toBe("Tango Mia");
    expect(result.listing.venue.address).toBeNull();
  });
});
