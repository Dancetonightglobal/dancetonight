import { describe, expect, it } from "vitest";
import { rawListingSchema } from "@/src/domain/listing";
import { withKnownVenue } from "@/src/pipeline/source-venue";
import type { HarvestedListing } from "@/src/adapters/types";
import type { KnownVenue } from "@/config/known-venues";
import { KNOWN_VENUES } from "@/config/known-venues";

function makeListing(venue: { name?: string | null; address?: string | null }): HarvestedListing {
  const raw = rawListingSchema.parse({
    title: "Test Event",
    listing_type: "social",
    styles: ["swing"],
    local_date: "2026-10-30",
    doors_time: "20:00",
    venue: { name: venue.name ?? null, address: venue.address ?? null, url: null },
    organizer: { name: null, url: null },
  });
  return {
    listing: raw,
    externalId: "test:1",
    tz: "America/Chicago",
    venueLocation: null,
    recurrence: null,
    provenance: { sourceUrl: "https://example.com", fetchedAt: new Date(), method: "feed" },
  };
}

describe("withKnownVenue canonical entries (D-265)", () => {
  const canon: KnownVenue = {
    names: ["Blue Nile", "Blue Nile - Balcony Room"],
    address: "532 Frenchmen St, New Orleans, LA 70116",
    canonical: true,
  };
  const plain: KnownVenue = {
    names: ["Blue Nile", "Blue Nile - Balcony Room"],
    address: "532 Frenchmen St, New Orleans, LA 70116",
  };

  it("1. canon, listing { name: 'Blue Nile - Balcony Room' } (no address) -> venue.name 'Blue Nile', address the entry's", () => {
    const listing = makeListing({ name: "Blue Nile - Balcony Room" });
    const result = withKnownVenue(listing, [canon], "US");
    expect(result.listing.venue.name).toBe("Blue Nile");
    expect(result.listing.venue.address).toBe("532 Frenchmen St, New Orleans, LA 70116");
  });

  it("2. canon, listing { name: 'Blue Nile - Balcony Room', address: entry's } -> name 'Blue Nile'", () => {
    const listing = makeListing({
      name: "Blue Nile - Balcony Room",
      address: "532 Frenchmen St, New Orleans, LA 70116",
    });
    const result = withKnownVenue(listing, [canon], "US");
    expect(result.listing.venue.name).toBe("Blue Nile");
    expect(result.listing.venue.address).toBe("532 Frenchmen St, New Orleans, LA 70116");
  });

  it("3. plain, listing { name: 'Blue Nile - Balcony Room' } -> name stays 'Blue Nile - Balcony Room'", () => {
    const listing = makeListing({ name: "Blue Nile - Balcony Room" });
    const result = withKnownVenue(listing, [plain], "US");
    expect(result.listing.venue.name).toBe("Blue Nile - Balcony Room");
    expect(result.listing.venue.address).toBe("532 Frenchmen St, New Orleans, LA 70116");
  });

  it("4. canon, listing { name: 'Blue Nile - Balcony Room', address: different postcode } -> returned unchanged", () => {
    const listing = makeListing({
      name: "Blue Nile - Balcony Room",
      address: "100 Main St, Boston, MA 02110",
    });
    const result = withKnownVenue(listing, [canon], "US");
    expect(result.listing.venue.name).toBe("Blue Nile - Balcony Room");
    expect(result.listing.venue.address).toBe("100 Main St, Boston, MA 02110");
  });

  it("5. canon plus point, listing { name: 'Blue Nile - Balcony Room' } -> name 'Blue Nile' and venueLocation equals point", () => {
    const entryWithPoint: KnownVenue = {
      ...canon,
      point: { lat: 29.9655, lng: -90.0579 },
    };
    const listing = makeListing({ name: "Blue Nile - Balcony Room" });
    const result = withKnownVenue(listing, [entryWithPoint], "US");
    expect(result.listing.venue.name).toBe("Blue Nile");
    expect(result.listing.venue.address).toBe("532 Frenchmen St, New Orleans, LA 70116");
    expect(result.venueLocation).toEqual({ lat: 29.9655, lng: -90.0579 });
  });

  it("6. Real config: withKnownVenue uses KNOWN_VENUES['new-orleans'] -> name 'Blue Nile'", () => {
    const listing = makeListing({ name: "Blue Nile - Balcony Room" });
    const result = withKnownVenue(listing, KNOWN_VENUES["new-orleans"], "US");
    expect(result.listing.venue.name).toBe("Blue Nile");
    expect(result.listing.venue.address).toBe("532 Frenchmen St, New Orleans, LA 70116");
  });
});
