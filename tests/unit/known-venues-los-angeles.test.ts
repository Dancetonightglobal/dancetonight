// Los Angeles venues two sources spell differently land on one venue record, so the same night merges (D-265).
import { describe, expect, it } from "vitest";

import { KNOWN_VENUES } from "@/config/known-venues";
import type { HarvestedListing } from "@/src/adapters/types";
import { rawListingSchema } from "@/src/domain/listing";
import { withKnownVenue } from "@/src/pipeline/source-venue";

function listingAt(name: string, address: string | null): HarvestedListing {
  const raw = rawListingSchema.parse({
    title: "Salsa & Bachata Social",
    listing_type: "social",
    styles: ["salsa"],
    local_date: "2026-11-09",
    doors_time: "20:30",
    venue: { name, address, url: null },
    organizer: { name: null, url: null },
  });
  return {
    listing: raw,
    externalId: "test:la",
    tz: "America/Los_Angeles",
    venueLocation: null,
    recurrence: null,
    provenance: { sourceUrl: "https://example.com", fetchedAt: new Date(), method: "feed" },
  };
}

const known = KNOWN_VENUES["los-angeles"];

describe("Los Angeles known venues (2026-11-07)", () => {
  it.each([
    [
      "Crown City Dance (Crown Theatre)",
      "Pasadena",
      "Crown Theatre",
      "140 S Rosemead Blvd, Pasadena, CA 91107",
    ],
    ["Crown Theatre", null, "Crown Theatre", "140 S Rosemead Blvd, Pasadena, CA 91107"],
    [
      "Steven's Steak & Seafood House",
      "Los Angeles",
      "Stevens Steakhouse",
      "5332 Stevens Pl, Commerce, CA 90040",
    ],
    [
      "The Continental Club",
      "Los Angeles",
      "The Continental Club",
      "116 W 4th St, Los Angeles, CA 90013",
    ],
  ])("files %s (address %s) under %s", (name, address, canonical, street) => {
    const result = withKnownVenue(listingAt(name, address), known, "US");
    expect(result.listing.venue.name).toBe(canonical);
    expect(result.listing.venue.address).toBe(street);
  });

  it("every entry has a ZIP and is canonical", () => {
    for (const venue of known ?? []) {
      expect(venue.address).toMatch(/, CA 9\d{4}$/);
      expect(venue.canonical).toBe(true);
    }
  });
});
