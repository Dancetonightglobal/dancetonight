import { describe, expect, it } from "vitest";
import { rawListingSchema } from "@/src/domain/listing";
import { withKnownVenue } from "@/src/pipeline/source-venue";
import type { HarvestedListing } from "@/src/adapters/types";
import { KNOWN_VENUES } from "@/config/known-venues";

// D-889 (weekly review 2026-11-23): one club under two venue rows showed one night twice (Penthouse Dubai and
// "The Penthouse", House of Yes and "The Onyx Room at House of Yes", Alexandra Palace geocoded to Mortlake beside
// "Alexandra Palace Theatre", Crobar and RA's "Crobar - Buenos Aires"). A canonical known venue stores every name
// under its first name at its checked point, so both copies land on one venue row and the night merges.
function listing(name: string, address: string | null): HarvestedListing {
  return {
    listing: rawListingSchema.parse({
      title: "Night",
      listing_type: "club_night",
      styles: ["house"],
      local_date: "2026-11-27",
      doors_time: "22:00",
      venue: { name, address, url: null },
      organizer: { name: null, url: null },
    }),
    externalId: "t:1",
    tz: null,
    venueLocation: null,
    recurrence: null,
    provenance: { sourceUrl: "https://example.com", fetchedAt: new Date(), method: "feed" },
  };
}

describe("D-889 one club, one venue row", () => {
  it.each([
    ["dubai", "AE", "The Penthouse", null, "Penthouse Dubai", { lat: 25.1040786, lng: 55.1490731 }],
    [
      "dubai",
      "AE",
      "Penthouse Dubai",
      null,
      "Penthouse Dubai",
      { lat: 25.1040786, lng: 55.1490731 },
    ],
    [
      "nyc",
      "US",
      "The Onyx Room at House of Yes",
      "2 Wyckoff Ave, Brooklyn, NY 11237",
      "House of Yes",
      { lat: 40.7067833, lng: -73.9235822 },
    ],
    ["nyc", "US", "House of Yes", null, "House of Yes", { lat: 40.7067833, lng: -73.9235822 }],
    [
      "london",
      "GB",
      "Alexandra Palace Theatre",
      "Alexandra Palace Way, London N22 7AY",
      "Alexandra Palace",
      { lat: 51.5943495, lng: -0.1306402 },
    ],
    [
      "london",
      "GB",
      "Alexandra Palace",
      "Alexandra Palace Way, London N22 7AY",
      "Alexandra Palace",
      { lat: 51.5943495, lng: -0.1306402 },
    ],
    [
      "buenos-aires",
      "AR",
      "Crobar - Buenos Aires",
      null,
      "Crobar",
      { lat: -34.5692392, lng: -58.420215 },
    ],
  ])("%s %s: %s is stored as %s", (metro, cc, name, address, expected, point) => {
    const out = withKnownVenue(listing(name, address), KNOWN_VENUES[metro], cc);
    expect(out.listing.venue.name).toBe(expected);
    expect(out.venueLocation).toEqual(point);
  });
});
