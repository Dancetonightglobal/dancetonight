// D-279: withTitleVenue fills a listing's venue from a title phrase map.
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

describe("withTitleVenue", () => {
  const map = {
    "Milonga Guapa": "Academia do Lumiar",
    "Outra Milonga": "Clube Ferroviario",
    "Fusion Dance Party": "Galeria Antecâmara",
  };

  it("fills venue name when title matches phrase and venue is empty", () => {
    const listing = makeListing("Milonga Guapa - 1a sexta", { name: null, address: null });
    const result = withTitleVenue(listing, map);
    expect(result.listing.venue.name).toBe("Academia do Lumiar");
    expect(result.listing.venue.address).toBeNull();
  });

  it("matches case-insensitively and ignores punctuation", () => {
    const listing = makeListing("MILONGA GUAPA!", { name: null, address: null });
    const result = withTitleVenue(listing, map);
    expect(result.listing.venue.name).toBe("Academia do Lumiar");
  });

  it("matches another phrase", () => {
    const listing = makeListing("Outra Milonga com DJ", { name: null, address: null });
    const result = withTitleVenue(listing, map);
    expect(result.listing.venue.name).toBe("Clube Ferroviario");
  });

  it("does not fill when venue name already exists", () => {
    const listing = makeListing("Milonga Guapa", { name: "Some Bar", address: null });
    const result = withTitleVenue(listing, map);
    expect(result.listing.venue.name).toBe("Some Bar");
  });

  it("does not fill when address exists (even without name)", () => {
    const listing = makeListing("Milonga Guapa", { name: null, address: "Rua X 1, Lisboa" });
    const result = withTitleVenue(listing, map);
    expect(result.listing.venue.name).toBeNull();
  });

  it("does not fill when venueLocation exists", () => {
    const listing = makeListing(
      "Milonga Guapa",
      { name: null, address: null },
      { lat: 38.7, lng: -9.1 },
    );
    const result = withTitleVenue(listing, map);
    expect(result.listing.venue.name).toBeNull();
  });

  it("requires whole-word match", () => {
    const listing = makeListing("Milonga Guapalooza", { name: null, address: null });
    const result = withTitleVenue(listing, map);
    expect(result.listing.venue.name).toBeNull();
  });

  it("returns unchanged when titleVenues is undefined", () => {
    const listing = makeListing("Milonga Guapa", { name: null, address: null });
    const result = withTitleVenue(listing, undefined);
    expect(result).toBe(listing);
  });

  it("does not mutate input object", () => {
    const listing = makeListing("Milonga Guapa", { name: null, address: null });
    const originalVenue = { ...listing.listing.venue };
    const result = withTitleVenue(listing, map);
    expect(listing.listing.venue).toEqual(originalVenue);
    expect(result).not.toBe(listing);
  });

  // New tests for D-502
  it("fills when venue name starts with mapped venue name (Galeria Antecâmara - Rua de Cabo Verde 17A)", () => {
    const listing = makeListing("Fusion Dance Party", {
      name: "Galeria Antecâmara - Rua de Cabo Verde 17A",
      address: null,
    });
    const result = withTitleVenue(listing, map);
    expect(result.listing.venue.name).toBe("Galeria Antecâmara");
    expect(result.listing.venue.address).toBeNull();
  });

  it("fills when venue name is a street line (Rua de Santa Apolónia 59) and address exists", () => {
    const listing = makeListing("Outra Milonga", {
      name: "Rua de Santa Apolónia 59",
      address: "Rua de Santa Apolónia 59, 1100-468 Lisboa, Portugal",
    });
    const result = withTitleVenue(listing, map);
    expect(result.listing.venue.name).toBe("Clube Ferroviario");
    expect(result.listing.venue.address).toBe(
      "Rua de Santa Apolónia 59, 1100-468 Lisboa, Portugal",
    );
  });

  it("fills when venue name is a street line (158 Bleecker St)", () => {
    const listing = makeListing("Milonga Guapa", {
      name: "158 Bleecker St",
      address: null,
    });
    const result = withTitleVenue(listing, map);
    expect(result.listing.venue.name).toBe("Academia do Lumiar");
    expect(result.listing.venue.address).toBeNull();
  });

  it("does not fill when venue name is not a street line (Some Bar 12)", () => {
    const listing = makeListing("Milonga Guapa", {
      name: "Some Bar 12",
      address: null,
    });
    const result = withTitleVenue(listing, map);
    expect(result.listing.venue.name).toBe("Some Bar 12");
    expect(result.listing.venue.address).toBeNull();
  });

  it("does not fill when venueLocation exists even with street line", () => {
    const listing = makeListing(
      "Milonga Guapa",
      { name: "Rua X 1", address: null },
      { lat: 38.7, lng: -9.1 },
    );
    const result = withTitleVenue(listing, map);
    expect(result.listing.venue.name).toBe("Rua X 1");
    expect(result.listing.venue.address).toBeNull();
  });

  it("does not fill when venue name is a different prefix (Academia do Lumiarense)", () => {
    const listing = makeListing("Milonga Guapa", {
      name: "Academia do Lumiarense",
      address: null,
    });
    const result = withTitleVenue(listing, map);
    expect(result.listing.venue.name).toBe("Academia do Lumiarense");
    expect(result.listing.venue.address).toBeNull();
  });

  it("does not mutate input object for Fusion case", () => {
    const listing = makeListing("Fusion Dance Party", {
      name: "Galeria Antecâmara - Rua de Cabo Verde 17A",
      address: null,
    });
    const originalVenue = { ...listing.listing.venue };
    const result = withTitleVenue(listing, map);
    expect(listing.listing.venue).toEqual(originalVenue);
    expect(result).not.toBe(listing);
  });
});
