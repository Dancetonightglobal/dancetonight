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
    tz: "Asia/Beirut",
    venueLocation,
    recurrence: null,
    provenance: {
      sourceUrl: "https://example.com",
      fetchedAt: new Date(),
      method: "feed",
    },
  };
}

describe("Beirut known venues", () => {
  const venues = KNOWN_VENUES.beirut ?? [];

  it("has 2 entries, each with a point inside the Beirut box", () => {
    expect(venues).toHaveLength(2);
    for (const venue of venues) {
      expect(venue.point).toBeDefined();
      expect(venue.point!.lat).toBeGreaterThanOrEqual(33.81);
      expect(venue.point!.lat).toBeLessThanOrEqual(33.96);
      expect(venue.point!.lng).toBeGreaterThanOrEqual(35.46);
      expect(venue.point!.lng).toBeLessThanOrEqual(35.62);
    }
  });

  it("places the metro_madina reader's rows at Metro al Madina", () => {
    const listing = makeListing({
      venueName: "Metro al Madina",
      venueAddress: "Aresco Center, Justinian Street, Clemenceau, Hamra, Beirut",
    });
    const result = withKnownVenue(listing, venues, "LB");
    expect(result.venueLocation).toEqual({ lat: 33.8956529, lng: 35.4913418 });
  });

  it("places RA's B018 rows at B018", () => {
    const listing = makeListing({
      venueName: "B018",
      venueAddress: "lot # 371, La Quarantaine, Medwar Beirut, Lebanon",
    });
    const result = withKnownVenue(listing, venues, "LB");
    expect(result.venueLocation).toEqual({ lat: 33.8985227, lng: 35.5342198 });
  });

  it("does not place another Karantina club at B018", () => {
    const listing = makeListing({
      venueName: "D Beirut",
      venueAddress: "La Quarantaine, Beirut, Lebanon",
    });
    const result = withKnownVenue(listing, venues, "LB");
    expect(result.venueLocation).toBeNull();
  });
});
