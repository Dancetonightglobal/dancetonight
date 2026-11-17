// D-869: NYC "Viva Saturdays" (daily site check 2026-11-11, C) stood twice at 10pm on 11-14: tickeri's copy at
// "Viva Toro", "987 Grand Street, Brooklyn, NY 10038" (a Manhattan ZIP, geocoded to Grand St in Chinatown), and RA's
// at "Viva Toro Nightclub", "Viva Toro - 987 Grand Street" (East Williamsburg), 4.7 km apart. One checked entry
// puts both at 987 Grand St, Brooklyn, NY 11211.
import { describe, expect, it } from "vitest";

import { KNOWN_VENUES } from "@/config/known-venues";
import type { HarvestedListing } from "@/src/adapters/types";
import { rawListingSchema } from "@/src/domain/listing";
import { withKnownVenue } from "@/src/pipeline/source-venue";

function at(name: string, address: string | null): HarvestedListing {
  return {
    listing: rawListingSchema.parse({
      title: "Viva Saturdays",
      listing_type: "other",
      styles: [],
      local_date: "2026-11-14",
      doors_time: "22:00",
      venue: { name, address, url: null },
      organizer: { name: null, url: null },
    }),
    externalId: "t:1",
    tz: "America/New_York",
    venueLocation: { lat: 40.7173907, lng: -73.9913147 },
    recurrence: null,
    provenance: { sourceUrl: "https://example.com", fetchedAt: new Date(), method: "feed" },
  };
}

const ADDRESS = "987 Grand St, Brooklyn, NY 11211";
const POINT = { lat: 40.7133622, lng: -73.9353778 };

describe("Viva Toro, East Williamsburg (D-869)", () => {
  const known = KNOWN_VENUES.nyc ?? [];

  it("puts tickeri's Manhattan-ZIP copy and RA's copy on one checked venue", () => {
    for (const [name, address] of [
      ["Viva Toro", "987 Grand Street, Brooklyn, NY 10038"],
      ["Viva Toro Nightclub", "Viva Toro - 987 Grand Street"],
      ["Viva Toro", null],
    ] as const) {
      const placed = withKnownVenue(at(name, address), known);
      expect(placed.listing.venue).toMatchObject({ name: "Viva Toro", address: ADDRESS });
      expect(placed.venueLocation).toEqual(POINT);
    }
  });

  it("leaves another Grand Street address alone", () => {
    const other = withKnownVenue(at("Some Bar", "500 Grand St, New York, NY 10002"), known);
    expect(other.listing.venue).toMatchObject({
      name: "Some Bar",
      address: "500 Grand St, New York, NY 10002",
    });
  });
});
