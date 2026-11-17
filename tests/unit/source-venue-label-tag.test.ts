import { describe, expect, it } from "vitest";
import { rawListingSchema } from "@/src/domain/listing";
import { seedVenueName, withVenueRooms, withSourceVenue } from "@/src/pipeline/source-venue";
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

describe("seedVenueName", () => {
  it("removes trailing platform tag (Our Philly)", () => {
    expect(seedVenueName("Brasil's Nightclub (Our Philly)")).toBe("Brasil's Nightclub");
  });

  it("removes trailing platform tag (Eventbrite)", () => {
    expect(seedVenueName("NOTO Events (Eventbrite)")).toBe("NOTO Events");
  });

  it("removes trailing platform tag (Meetup)", () => {
    expect(seedVenueName("Espresso Beats (Meetup)")).toBe("Espresso Beats");
  });

  it("removes trailing platform tag (Qué Hacemos)", () => {
    expect(seedVenueName("La Paz Arriba (Qué Hacemos)")).toBe("La Paz Arriba");
  });

  it("removes trailing platform tag case-insensitively", () => {
    expect(seedVenueName("NOTO Events (eventbrite)")).toBe("NOTO Events");
  });

  it("removes trailing platform tag with trailing spaces", () => {
    expect(seedVenueName("Brasil's Nightclub (Our Philly)  ")).toBe("Brasil's Nightclub");
  });

  it("removes only one trailing tag", () => {
    expect(seedVenueName("Afro Events Miami, PRIVE Fridays (Eventbrite)")).toBe(
      "Afro Events Miami, PRIVE Fridays",
    );
  });

  it("does not remove non-trailing brackets", () => {
    expect(seedVenueName("Salsa (Eventbrite) Night")).toBe("Salsa (Eventbrite) Night");
  });

  it("does not remove unknown platform tags", () => {
    expect(seedVenueName("Copper Blues Miami (Doral)")).toBe("Copper Blues Miami (Doral)");
    expect(seedVenueName("The Monster (Spunk)")).toBe("The Monster (Spunk)");
    expect(seedVenueName("Tavern on Camac (Ascend)")).toBe("Tavern on Camac (Ascend)");
    expect(seedVenueName("Cachirulo (El Beso)")).toBe("Cachirulo (El Beso)");
  });

  it("returns trimmed label when tag would leave empty string", () => {
    expect(seedVenueName("(Eventbrite)")).toBe("(Eventbrite)");
  });

  it("returns trimmed label unchanged when no matching tag", () => {
    expect(seedVenueName("Some Venue")).toBe("Some Venue");
  });
});

describe("withVenueRooms with platform tag removal", () => {
  it("removes platform tag when onlyHere places at source venue", () => {
    const seed = { label: "Brasil's Nightclub (Our Philly)", onlyHere: true };
    const listing = makeListing({ name: "Zouk Tuesdays", address: null });
    const result = withVenueRooms(listing, seed);
    expect(result.listing.venue.name).toBe("Brasil's Nightclub");
    expect(result.listing.venue.address).toBeNull();
  });

  it("removes platform tag when room matches", () => {
    const seed = { label: "Good Room (Eventbrite)", venueRooms: ["Bad Room"] };
    const listing = makeListing({ name: "Bad Room", address: null });
    const result = withVenueRooms(listing, seed);
    expect(result.listing.venue.name).toBe("Good Room");
    expect(result.listing.venue.address).toBeNull();
  });
});

describe("withSourceVenue with platform tag removal", () => {
  const seed = {
    label: "Brasil's Nightclub (Our Philly)",
    venueAddress: "112 Chestnut St, Philadelphia, PA 19106",
    venuePage: true,
  };

  it("matches venue name without tag and applies address", () => {
    const listing = makeListing({ name: "Brasil's Nightclub", address: null });
    const result = withSourceVenue(listing, seed);
    expect(result.listing.venue.address).toBe("112 Chestnut St, Philadelphia, PA 19106");
    expect(result.listing.venue.name).toBe("Brasil's Nightclub");
  });

  it("fills missing venue name with tag removed", () => {
    const listing = makeListing({ name: null, address: null });
    const result = withSourceVenue(listing, seed);
    expect(result.listing.venue.name).toBe("Brasil's Nightclub");
    expect(result.listing.venue.address).toBe("112 Chestnut St, Philadelphia, PA 19106");
  });

  it("does not change listing with different venue name", () => {
    const listing = makeListing({ name: "Some Other Bar", address: null });
    const result = withSourceVenue(listing, seed);
    expect(result).toBe(listing);
    expect(result.listing.venue.name).toBe("Some Other Bar");
    expect(result.listing.venue.address).toBeNull();
  });
});
