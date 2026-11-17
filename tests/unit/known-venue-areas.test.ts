// A town-only address that names a known venue's neighbourhood takes its checked address (menna).
import { describe, expect, it } from "vitest";
import { rawListingSchema } from "@/src/domain/listing";
import { withKnownVenue } from "@/src/pipeline/source-venue";
import type { HarvestedListing } from "@/src/adapters/types";
import { KNOWN_VENUES, type KnownVenue } from "@/config/known-venues";

function makeListing(name: string, address: string | null): HarvestedListing {
  const raw = rawListingSchema.parse({
    title: "Test Event",
    listing_type: "party",
    styles: [],
    local_date: "2026-10-28",
    doors_time: "21:00",
    venue: { name, address, url: null },
    organizer: { name: null, url: null },
  });
  return {
    listing: raw,
    externalId: "test:1",
    tz: "America/New_York",
    venueLocation: null,
    recurrence: null,
    provenance: { sourceUrl: "https://itsmenna.com/events", fetchedAt: new Date(), method: "feed" },
  };
}

const KWEEN: KnownVenue[] = [
  { names: ["Kween"], address: "34-10 30th Ave, Astoria, NY 11103", areas: ["Astoria"] },
  {
    names: ["Laziza"],
    address: "306A Malcolm X Blvd, Brooklyn, NY 11233",
    areas: ["Bed-Stuy", "Bedford-Stuyvesant"],
  },
  { names: ["DROM"], address: "85 Avenue A, New York, NY 10009", areas: ["East Village"] },
];

describe("withKnownVenue: neighbourhood-only addresses", () => {
  it("places a listing whose address is one of the venue's areas", () => {
    const out = withKnownVenue(makeListing("Laziza", "Bed-Stuy, NY, US"), KWEEN);
    expect(out.listing.venue.address).toBe("306A Malcolm X Blvd, Brooklyn, NY 11233");
    expect(out.listing.venue.name).toBe("Laziza");
  });

  it("matches the area whatever its case, and a name with its address after a comma", () => {
    const out = withKnownVenue(
      makeListing("DROM, 85 Avenue A, New York, NY 10009, USA", "east village, NY, US"),
      KWEEN,
    );
    expect(out.listing.venue.address).toBe("85 Avenue A, New York, NY 10009");
  });

  it("keeps the listing's own address for a neighbourhood the venue does not list", () => {
    const out = withKnownVenue(makeListing("Laziza", "Astoria, NY, US"), KWEEN);
    expect(out.listing.venue.address).toBe("Astoria, NY, US");
  });

  it("still takes a town the checked address names (Astoria)", () => {
    const out = withKnownVenue(makeListing("Kween", "Astoria, NY, US"), KWEEN);
    expect(out.listing.venue.address).toBe("34-10 30th Ave, Astoria, NY 11103");
  });

  it("an entry with no areas behaves as before", () => {
    const plain: KnownVenue[] = [
      { names: ["Laziza"], address: "306A Malcolm X Blvd, Brooklyn, NY 11233" },
    ];
    const out = withKnownVenue(makeListing("Laziza", "Bed-Stuy, NY, US"), plain);
    expect(out.listing.venue.address).toBe("Bed-Stuy, NY, US");
  });

  it("the NYC list carries DROM, Kween and Laziza with their areas", () => {
    for (const [name, area] of [
      ["DROM", "East Village"],
      ["Kween", "Astoria"],
      ["Laziza", "Bed-Stuy"],
    ] as const) {
      const out = withKnownVenue(makeListing(name, `${area}, NY, US`), KNOWN_VENUES.nyc);
      expect(out.listing.venue.address).toMatch(/\b\d{5}$/);
    }
  });
});
