// D-832: an onlyHere row placed at the source's venue loses its own point too. After D-829 the
// Nashville Palace's Wix line-dance rows were named "The Nashville Palace" but kept the Wix pin
// (36.1518, -86.6841, 7 km off), so resolveVenue matched the second venue row near that pin.
import { describe, expect, it } from "vitest";
import { rawListingSchema } from "@/src/domain/listing";
import { withVenueRooms } from "@/src/pipeline/source-venue";
import type { HarvestedListing } from "@/src/adapters/types";

const WIX_PIN = { lat: 36.15179, lng: -86.68411 };

function makeListing(
  venue: { name?: string | null; address?: string | null },
  venueLocation: { lat: number; lng: number } | null,
): HarvestedListing {
  return {
    listing: rawListingSchema.parse({
      title: "Line Dance Lessons 21+",
      listing_type: "class",
      styles: ["line_dance"],
      local_date: "2026-11-20",
      doors_time: "19:30",
      venue: { name: venue.name ?? null, address: venue.address ?? null, url: null },
      organizer: { name: null, url: null },
    }),
    externalId: "wix:1",
    tz: "America/Chicago",
    venueLocation,
    recurrence: null,
    provenance: {
      sourceUrl: "https://www.thefamousnashvillepalace.com/calendar",
      fetchedAt: new Date(),
      method: "feed",
    },
  };
}

const seed = {
  label: "The Nashville Palace",
  venueAddress: "2611 McGavock Pike, Nashville, TN 37214",
  onlyHere: true,
};

describe("withVenueRooms drops the listing's own point when it places at the source venue (D-832)", () => {
  it("drops the Wix pin of a row at the venue's own street address", () => {
    const result = withVenueRooms(
      makeListing(
        { name: "Nashville Palace", address: "2611 McGavock Pike, Nashville, TN 37214" },
        WIX_PIN,
      ),
      seed,
    );
    expect(result.listing.venue.name).not.toBe("Nashville Palace");
    expect(result.venueLocation).toBeNull();
  });

  it("drops the pin of a row with no street address", () => {
    const result = withVenueRooms(makeListing({ name: "Main Stage" }, WIX_PIN), seed);
    expect(result.venueLocation).toBeNull();
  });

  it("keeps the pin of a row at another street address", () => {
    const pin = { lat: 36.16, lng: -86.78 };
    const result = withVenueRooms(
      makeListing({ name: "Off-site Hall", address: "100 Broadway, Nashville, TN 37201" }, pin),
      seed,
    );
    expect(result.venueLocation).toEqual(pin);
  });

  it("keeps the pin without onlyHere", () => {
    const result = withVenueRooms(
      makeListing(
        { name: "Nashville Palace", address: "2611 McGavock Pike, Nashville, TN 37214" },
        WIX_PIN,
      ),
      { ...seed, onlyHere: false },
    );
    expect(result.venueLocation).toEqual(WIX_PIN);
  });
});
