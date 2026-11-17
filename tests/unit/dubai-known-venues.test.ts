import { describe, expect, it } from "vitest";
import { rawListingSchema } from "@/src/domain/listing";
import { withKnownVenue } from "@/src/pipeline/source-venue";
import type { HarvestedListing } from "@/src/adapters/types";
import { KNOWN_VENUES } from "@/config/known-venues";

function makeListing({
  title = "Test Event",
  venueName = null,
  venueAddress = null,
  venueLocation = null,
}: {
  title?: string;
  venueName?: string | null;
  venueAddress?: string | null;
  venueLocation?: { lat: number; lng: number } | null;
}): HarvestedListing {
  const raw = rawListingSchema.parse({
    title,
    listing_type: "social",
    styles: ["swing"],
    local_date: "2026-10-11",
    doors_time: "20:00",
    venue: {
      name: venueName ?? null,
      address: venueAddress ?? null,
      url: null,
    },
    organizer: { name: null, url: null },
  });
  return {
    listing: raw,
    externalId: "test:1",
    tz: "America/New_York",
    venueLocation,
    recurrence: null,
    provenance: {
      sourceUrl: "https://example.com",
      fetchedAt: new Date(),
      method: "feed",
    },
  };
}

describe("Dubai known venues", () => {
  const dubaiVenues = KNOWN_VENUES.dubai ?? [];

  it("has 12 entries", () => {
    expect(dubaiVenues).toHaveLength(12);
  });

  it("each entry has a point within Dubai bounds", () => {
    for (const venue of dubaiVenues) {
      expect(venue.point).toBeDefined();
      expect(venue.point!.lat).toBeGreaterThanOrEqual(24.7);
      expect(venue.point!.lat).toBeLessThanOrEqual(25.4);
      expect(venue.point!.lng).toBeGreaterThanOrEqual(54.9);
      expect(venue.point!.lng).toBeLessThanOrEqual(55.7);
    }
  });

  describe("withKnownVenue places listings correctly", () => {
    // Test the four specific pairs
    it("places Little Havana with null name and matching address", () => {
      const listing = makeListing({
        venueName: null,
        venueAddress: "Little Havana, Sofitel Dubai Jumeirah Beach Hotel, The Walk, JBR, Dubai",
        venueLocation: null,
      });
      const result = withKnownVenue(listing, dubaiVenues, "AE");
      expect(result.venueLocation).toEqual({ lat: 25.0752952, lng: 55.1322303 });
    });

    it("places Bohemia with matching name and address", () => {
      const listing = makeListing({
        venueName: "Bohemia",
        venueAddress:
          "Bohemia, FIVE Palm Jumeirah Hotel, No 1 The Palm Jumeirah, Palm Jumeirah, Dubai",
        venueLocation: null,
      });
      const result = withKnownVenue(listing, dubaiVenues, "AE");
      expect(result.venueLocation).toEqual({ lat: 25.1036823, lng: 55.1474466 });
    });

    it("places The Phoenix Dubai - Lounge & Club with matching name and address", () => {
      const listing = makeListing({
        venueName: "The Phoenix Dubai - Lounge & Club",
        venueAddress: "Mezzanine Floor, Media Rotana Hotel, Barsha Heights (TECOM), Dubai, U.A.E",
        venueLocation: null,
      });
      const result = withKnownVenue(listing, dubaiVenues, "AE");
      expect(result.venueLocation).toEqual({ lat: 25.0997602, lng: 55.1796406 });
    });

    it("places Coya Club with matching name and address", () => {
      const listing = makeListing({
        venueName: "Coya Club",
        venueAddress:
          "Restaurant Village Four Seasons Resort - Jumeirah Beach Road - Jumeirah 2 - Jumeirah - Dubai",
        venueLocation: null,
      });
      const result = withKnownVenue(listing, dubaiVenues, "AE");
      expect(result.venueLocation).toEqual({ lat: 25.202165, lng: 55.2396872 });
    });
  });

  it("does NOT place Lucky Voice with mismatched address", () => {
    const listing = makeListing({
      venueName: "Lucky Voice",
      venueAddress: "Kite Beach, Jumeirah 3, Dubai",
      venueLocation: null,
    });
    const result = withKnownVenue(listing, dubaiVenues, "AE");
    // Should remain unchanged because address doesn't match
    expect(result.venueLocation).toBeNull();
    expect(result.listing.venue.address).toBe("Kite Beach, Jumeirah 3, Dubai");
  });
});
