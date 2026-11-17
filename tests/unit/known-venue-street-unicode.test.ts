// Known venues: street and town phrases match when they start or end with an accented letter
import { describe, expect, it } from "vitest";
import { rawListingSchema } from "@/src/domain/listing";
import { withKnownVenue } from "@/src/pipeline/source-venue";
import type { HarvestedListing } from "@/src/adapters/types";
import type { KnownVenue } from "@/config/known-venues";

function makeListing(venue: { name?: string | null; address?: string | null }): HarvestedListing {
  const raw = rawListingSchema.parse({
    title: "Test Event",
    listing_type: "social",
    styles: ["salsa"],
    local_date: "2026-10-30",
    doors_time: "20:00",
    venue: { name: venue.name ?? null, address: venue.address ?? null, url: null },
    organizer: { name: null, url: null },
  });
  return {
    listing: raw,
    externalId: "test:1",
    tz: "America/Puerto_Rico",
    venueLocation: null,
    recurrence: null,
    provenance: { sourceUrl: "https://example.com", fetchedAt: new Date(), method: "feed" },
  };
}

const cupey: KnownVenue = {
  names: ["Downtown Cupey"],
  address: "54 Ave. Paraná, San Juan, PR 00926",
  streets: ["Ave. Paraná"],
};

describe("withKnownVenue with accented letters", () => {
  it("matches street phrase ending with accented letter", () => {
    const listing = makeListing({ name: null, address: "#54 Ave. Paraná, San Juan, PR" });
    const result = withKnownVenue(listing, [cupey], "US");
    expect(result.listing.venue.address).toBe("54 Ave. Paraná, San Juan, PR 00926");
    expect(result.listing.venue.name).toBe("Downtown Cupey");
  });

  it("matches street phrase at the very end of address", () => {
    const listing = makeListing({ name: null, address: "#54 Ave. Paraná" });
    const result = withKnownVenue(listing, [cupey], "US");
    expect(result.listing.venue.address).toBe("54 Ave. Paraná, San Juan, PR 00926");
    expect(result.listing.venue.name).toBe("Downtown Cupey");
  });

  it("does not match inside a longer word (Paranápolis)", () => {
    const listing = makeListing({ name: null, address: "10 Calle Paranápolis, San Juan, PR" });
    const result = withKnownVenue(listing, [cupey], "US");
    expect(result).toBe(listing);
    expect(result.listing.venue.address).toBe("10 Calle Paranápolis, San Juan, PR");
  });

  it("ASCII phrase still matches (Croftdown Road)", () => {
    const known: KnownVenue = {
      names: ["Some Hall"],
      address: "1 Croftdown Road, London NW5 1EL",
      streets: ["Croftdown Road"],
    };
    const listing = makeListing({ name: "Between 51 & 53 Croftdown Road NW5 1EL", address: null });
    const result = withKnownVenue(listing, [known], "GB");
    expect(result.listing.venue.address).toBe("1 Croftdown Road, London NW5 1EL");
    expect(result.listing.venue.name).toBe("Some Hall");
  });

  it("ASCII phrase does not match inside longer word (Mainstreet)", () => {
    const known: KnownVenue = {
      names: ["Main Bar"],
      address: "1 Main St, Austin, TX 78701",
      streets: ["Main St"],
    };
    const listing = makeListing({ name: null, address: "5 Mainstreet Plaza, Austin, TX" });
    const result = withKnownVenue(listing, [known], "US");
    expect(result).toBe(listing);
    expect(result.listing.venue.address).toBe("5 Mainstreet Plaza, Austin, TX");
  });

  it("town-only with accented town matches when town appears in known address", () => {
    const known: KnownVenue = {
      names: ["Bar Lapa"],
      address: "Rua do Lavradio 10, Centro, Rio de Janeiro - RJ, 20230-070",
      areas: [],
    };
    const listing = makeListing({ name: "Bar Lapa", address: "Rio de Janeiro" });
    const result = withKnownVenue(listing, [known], "BR");
    expect(result.listing.venue.address).toBe(
      "Rua do Lavradio 10, Centro, Rio de Janeiro - RJ, 20230-070",
    );
    expect(result.listing.venue.name).toBe("Bar Lapa");
  });

  it("town-only with different accented town does not match", () => {
    const known: KnownVenue = {
      names: ["Bar Lapa"],
      address: "Rua do Lavradio 10, Centro, Rio de Janeiro - RJ, 20230-070",
      areas: [],
    };
    const listing = makeListing({ name: "Bar Lapa", address: "São Cristóvão" });
    const result = withKnownVenue(listing, [known], "BR");
    expect(result).toBe(listing);
    expect(result.listing.venue.address).toBe("São Cristóvão");
  });
});
