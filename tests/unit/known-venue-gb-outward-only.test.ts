// D-284: GB outward code only ("King's Cross WC1X") takes the known venue in that district.
import { describe, expect, it } from "vitest";
import { rawListingSchema } from "@/src/domain/listing";
import { withKnownVenue } from "@/src/pipeline/source-venue";
import type { HarvestedListing } from "@/src/adapters/types";
import type { KnownVenue } from "@/config/known-venues";

function makeListing(venue: { name?: string | null; address?: string | null }): HarvestedListing {
  const raw = rawListingSchema.parse({
    title: "Test Event",
    listing_type: "social",
    styles: ["swing"],
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

const known: KnownVenue[] = [
  {
    names: ["The Example Hall"],
    address: "1 Example Street, London WC1X 9DH",
  },
];

describe("withKnownVenue GB outward code only (D-284)", () => {
  it("takes entry address when address is only outward code 'WC1X'", () => {
    const listing = makeListing({ name: "The Example Hall", address: "WC1X" });
    const result = withKnownVenue(listing, known, "GB");
    expect(result.listing.venue.address).toBe("1 Example Street, London WC1X 9DH");
  });

  it("takes entry address when address includes words plus outward code 'King's Cross WC1X'", () => {
    const listing = makeListing({ name: "The Example Hall", address: "King's Cross WC1X" });
    const result = withKnownVenue(listing, known, "GB");
    expect(result.listing.venue.address).toBe("1 Example Street, London WC1X 9DH");
  });

  it("keeps own address when outward code differs ('Islington N1')", () => {
    const listing = makeListing({ name: "The Example Hall", address: "Islington N1" });
    const result = withKnownVenue(listing, known, "GB");
    expect(result.listing.venue.address).toBe("Islington N1");
  });

  it("keeps own address when house number present ('12 Gray's Inn Road WC1X')", () => {
    const listing = makeListing({ name: "The Example Hall", address: "12 Gray's Inn Road WC1X" });
    const result = withKnownVenue(listing, known, "GB");
    expect(result.listing.venue.address).toBe("12 Gray's Inn Road WC1X");
  });

  it("keeps own address for non-GB country (US)", () => {
    const listing = makeListing({ name: "The Example Hall", address: "WC1X" });
    const result = withKnownVenue(listing, known, "US");
    expect(result.listing.venue.address).toBe("WC1X");
  });
});
