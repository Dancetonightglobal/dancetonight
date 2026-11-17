// D-220: a street-matched UK known venue accepts a postcode in the same outward district.
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
    names: ["Ecstatic Dance London, Croftdown Road"],
    address: "53 Croftdown Road, London NW5 1HE",
    streets: ["Croftdown Road"],
  },
];
const feed =
  "13 Minutes from Gospel Oak Station... Between 51 & 53 Croftdown Road, London, England, NW5 1EL";

describe("withKnownVenue rule 4, GB outward code (D-220)", () => {
  it("takes the entry when the street matches and only the inward code differs", () => {
    const result = withKnownVenue(makeListing({ name: null, address: feed }), known, "GB");
    expect(result.listing.venue.address).toBe("53 Croftdown Road, London NW5 1HE");
    expect(result.listing.venue.name).toBe("Ecstatic Dance London, Croftdown Road");
  });

  it("keeps the listing when the outward code differs (NW1 vs NW5)", () => {
    const listing = makeListing({ name: null, address: "Croftdown Road, London NW1 1EL" });
    expect(withKnownVenue(listing, known, "GB")).toBe(listing);
  });

  it("keeps US ZIPs exact", () => {
    const us: KnownVenue[] = [
      { names: ["Some Hall"], address: "12 Elm St, New York, NY 10038", streets: ["Elm St"] },
    ];
    const listing = makeListing({ name: null, address: "Elm St, New York, NY 10039" });
    expect(withKnownVenue(listing, us, "US")).toBe(listing);
  });

  it("replaces a name that is the feed's directions text with the entry's name", () => {
    const listing = makeListing({ name: `${feed}, United Kingdom`, address: null });
    const result = withKnownVenue(listing, known, "GB");
    expect(result.listing.venue.name).toBe("Ecstatic Dance London, Croftdown Road");
    expect(result.listing.venue.address).toBe("53 Croftdown Road, London NW5 1HE");
  });

  it("keeps a real venue name when the street is only in the address", () => {
    const listing = makeListing({ name: "Gospel Oak Hall", address: "Croftdown Road, NW5 1EL" });
    const result = withKnownVenue(listing, known, "GB");
    expect(result.listing.venue.name).toBe("Gospel Oak Hall");
    expect(result.listing.venue.address).toBe("53 Croftdown Road, London NW5 1HE");
  });
});
