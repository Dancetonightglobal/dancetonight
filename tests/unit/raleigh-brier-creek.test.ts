// Raleigh Line Dance's Meetup listings carry no LOCATION: they take the source's venueAddress under its label,
// and the Brier Creek known venue gives them its name and its checked point (the geocoder calls the address too
// vague, run 41181212406).
import { describe, expect, it } from "vitest";

import { KNOWN_VENUES } from "@/config/known-venues";
import { RALEIGH_SOURCES } from "@/config/sources/raleigh";
import type { HarvestedListing } from "@/src/adapters/types";
import { rawListingSchema } from "@/src/domain/listing";
import { withKnownVenue, withSourceVenue } from "@/src/pipeline/source-venue";

describe("Raleigh Line Dance at Brier Creek", () => {
  it("places a no-location listing at Brier Creek Community Center with its point", () => {
    const seed = RALEIGH_SOURCES.find(
      (s) => s.feedUrl === "https://www.meetup.com/raleigh-line-dance-group/events/ical/",
    );
    expect(seed).toBeDefined();
    const raw = rawListingSchema.parse({
      title: "Raleigh line dance Wednesday nights - Brier Creek!",
      listing_type: "class",
      styles: ["line_dance"],
      local_date: "2026-11-04",
      doors_time: "19:00",
      venue: { name: null, address: null, url: null },
      organizer: { name: null, url: null },
    });
    const listing: HarvestedListing = {
      listing: raw,
      externalId: "test:raleigh-line-dance-1",
      tz: "America/New_York",
      venueLocation: null,
      recurrence: null,
      provenance: {
        sourceUrl: "https://www.meetup.com/raleigh-line-dance-group/events/",
        fetchedAt: new Date(),
        method: "feed",
      },
    };
    const placed = withKnownVenue(withSourceVenue(listing, seed), KNOWN_VENUES.raleigh, "US");
    expect(placed.listing.venue.name).toBe("Brier Creek Community Center");
    expect(placed.listing.venue.address).toBe("10810 Globe Rd, Morrisville, NC 27560");
    expect(placed.venueLocation).toEqual({ lat: 35.90052, lng: -78.80675 });
  });
});
