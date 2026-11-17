// Tests for street matching with one-letter typos in sameStreet
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

describe("withKnownVenue street matching with one-letter typo (rule 3)", () => {
  const knownVenue: KnownVenue = {
    names: ["DBA New Orleans", "d.b.a."],
    address: "618 Frenchmen St, New Orleans, LA 70116",
  };

  it("matches 'Frenchman St' to 'Frenchmen St' (one-letter typo)", () => {
    const listing = makeListing({
      name: "DBA New Orleans",
      address: "DBA New Orleans, 618 Frenchman St, New Orleans, LA, USA",
    });
    const result = withKnownVenue(listing, [knownVenue], "US");
    expect(result.listing.venue.address).toBe("618 Frenchmen St, New Orleans, LA 70116");
  });

  it("matches 'Frenchman Street' to 'Frenchmen St' after abbreviation normalization", () => {
    const listing = makeListing({
      name: "DBA New Orleans",
      address: "618 Frenchman Street, New Orleans, LA, USA",
    });
    const result = withKnownVenue(listing, [knownVenue], "US");
    expect(result.listing.venue.address).toBe("618 Frenchmen St, New Orleans, LA 70116");
  });

  it("does not match when house number differs", () => {
    const listing = makeListing({
      name: "DBA New Orleans",
      address: "620 Frenchman St, New Orleans, LA, USA",
    });
    const result = withKnownVenue(listing, [knownVenue], "US");
    // Should keep its own address
    expect(result.listing.venue.address).toBe("620 Frenchman St, New Orleans, LA, USA");
  });

  it("does not match when words are under 5 letters", () => {
    const listing = makeListing({
      name: "Some Venue",
      address: "618 Main St, New Orleans, LA",
    });
    const known: KnownVenue = {
      names: ["Some Venue"],
      address: "618 Maine St, New Orleans, LA 70116",
    };
    const result = withKnownVenue(listing, [known], "US");
    // "Main" vs "Maine" are 4 letters, so no match
    expect(result.listing.venue.address).toBe("618 Main St, New Orleans, LA");
  });

  it("does not match when two words differ", () => {
    const listing = makeListing({
      name: "Some Venue",
      address: "618 Frenchman Ave, New Orleans, LA",
    });
    const known: KnownVenue = {
      names: ["Some Venue"],
      address: "618 Frenchmen St, New Orleans, LA 70116",
    };
    const result = withKnownVenue(listing, [known], "US");
    // "Ave" vs "St" differ, and "Frenchman" vs "Frenchmen" also differ -> two differences
    expect(result.listing.venue.address).toBe("618 Frenchman Ave, New Orleans, LA");
  });

  it("matches exact same street (no typo)", () => {
    const listing = makeListing({
      name: "DBA New Orleans",
      address: "618 Frenchmen St, New Orleans, LA",
    });
    const result = withKnownVenue(listing, [knownVenue], "US");
    expect(result.listing.venue.address).toBe("618 Frenchmen St, New Orleans, LA 70116");
  });

  it("matches when street part is first part with house number", () => {
    const listing = makeListing({
      name: "12 Brooklyn Ave",
      address: "12 Brooklyn Ave, Brooklyn",
    });
    const known: KnownVenue = {
      names: ["12 Brooklyn Ave"],
      address: "12 Brooklyn Ave, Brooklyn, NY 11216",
    };
    const result = withKnownVenue(listing, [known], "US");
    expect(result.listing.venue.address).toBe("12 Brooklyn Ave, Brooklyn, NY 11216");
  });
});
