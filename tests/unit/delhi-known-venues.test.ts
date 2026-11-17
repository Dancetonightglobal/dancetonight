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
    styles: ["salsa"],
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
    tz: "Asia/Kolkata",
    venueLocation,
    recurrence: null,
    provenance: {
      sourceUrl: "https://example.com",
      fetchedAt: new Date(),
      method: "feed",
    },
  };
}

describe("Delhi known venues", () => {
  const delhiVenues = KNOWN_VENUES.delhi ?? [];

  it("places RA's Bianco row (rounded point dropped, address refused by the geocoder) at the checked point", () => {
    const listing = makeListing({
      title: "Stimming",
      venueName: "Bianco",
      venueAddress: "D1/A, South Extension, Block M, New Delhi, Delhi 110049",
      venueLocation: null,
    });
    const result = withKnownVenue(listing, delhiVenues, "IN");
    expect(result.venueLocation).toEqual({ lat: 28.5680656, lng: 77.2241058 });
  });

  it("every entry has a point inside the Delhi NCR box", () => {
    for (const venue of delhiVenues) {
      expect(venue.point!.lat).toBeGreaterThan(28.3);
      expect(venue.point!.lat).toBeLessThan(28.9);
      expect(venue.point!.lng).toBeGreaterThan(76.8);
      expect(venue.point!.lng).toBeLessThan(77.6);
    }
  });
});

describe("Delhi known venues: Zorba the Buddha", () => {
  it("places Zorba's own-page rows (address refused by the geocoder) at OSM's point", () => {
    const listing = makeListing({
      title: "Circle of Mystical Dances at Zorba the Buddha",
      venueName: "Zorba the Buddha",
      venueAddress: "7, Tropical Drive, Mehrauli-Gurgaon Road, Ghitorni, New Delhi 110030",
      venueLocation: null,
    });
    const result = withKnownVenue(listing, KNOWN_VENUES.delhi ?? [], "IN");
    expect(result.venueLocation).toEqual({ lat: 28.4981141, lng: 77.1480479 });
  });
});
