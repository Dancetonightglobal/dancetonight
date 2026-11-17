// A town-only address ending in a wave-1 country name still matches a known venue (Lisbon, 2026-10-29).
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

const teatro: KnownVenue[] = [
  { names: ["Teatro da Luz"], address: "Largo da Luz 2, 1600-498 Lisboa" },
];

describe("town-only address with a country name", () => {
  it("takes the checked address for 'Lisboa, PT'", () => {
    const listing = makeListing({ name: "Teatro da Luz", address: "Lisboa, PT" });
    const result = withKnownVenue(listing, teatro, "PT");
    expect(result.listing.venue.address).toBe("Largo da Luz 2, 1600-498 Lisboa");
  });

  it("takes the checked address for 'Lisboa, Portugal'", () => {
    const listing = makeListing({ name: "Teatro da Luz", address: "Lisboa, Portugal" });
    const result = withKnownVenue(listing, teatro, "PT");
    expect(result.listing.venue.address).toBe("Largo da Luz 2, 1600-498 Lisboa");
  });

  it("keeps its own address for another town: 'Porto, PT'", () => {
    const listing = makeListing({ name: "Teatro da Luz", address: "Porto, PT" });
    const result = withKnownVenue(listing, teatro, "PT");
    expect(result.listing.venue.address).toBe("Porto, PT");
  });
});
