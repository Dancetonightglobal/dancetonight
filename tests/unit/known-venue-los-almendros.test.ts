// San Juan: Viajando y Bailando's "Salsa en Vivo al Aire Libre" rows give only "PR-169, Guaynabo, PR" (no name,
// no ZIP; run 41207121279). The Los Almendros KnownVenue places them by its street phrase.
import { describe, expect, it } from "vitest";
import { KNOWN_VENUES } from "@/config/known-venues";
import type { HarvestedListing } from "@/src/adapters/types";
import { rawListingSchema } from "@/src/domain/listing";
import { withKnownVenue } from "@/src/pipeline/source-venue";

function makeListing(name: string | null, address: string | null): HarvestedListing {
  const raw = rawListingSchema.parse({
    title: "Guaynabo: Salsa en Vivo al Aire Libre",
    listing_type: "party",
    styles: [],
    local_date: "2026-11-05",
    doors_time: "19:00",
    venue: { name, address, url: null },
    organizer: { name: null, url: null },
  });
  return {
    listing: raw,
    externalId: "test:1",
    tz: "America/Puerto_Rico",
    venueLocation: null,
    recurrence: null,
    provenance: {
      sourceUrl: "https://viajandoybailando.com/mec-category/puerto-rico/",
      fetchedAt: new Date(),
      method: "feed",
    },
  };
}

const ENTRIES = KNOWN_VENUES["san-juan"] ?? [];

describe("Los Almendros, Guaynabo (San Juan)", () => {
  it("places a nameless 'PR-169, Guaynabo, PR' row at Los Almendros", () => {
    const out = withKnownVenue(makeListing(null, "PR-169, Guaynabo, PR"), ENTRIES, "US");
    expect(out.listing.venue.address).toBe("PR-169, Guaynabo, PR");
    expect(out.venueLocation).toEqual({ lat: 18.3421385, lng: -66.1048292 });
  });

  it("places a row named Los Almendros", () => {
    const out = withKnownVenue(makeListing("Los Almendros", "PR-169, Guaynabo, PR"), ENTRIES, "US");
    expect(out.venueLocation).toEqual({ lat: 18.3421385, lng: -66.1048292 });
  });

  it("leaves PR-169 in another town alone", () => {
    const out = withKnownVenue(makeListing(null, "PR-169, Cataño, PR"), ENTRIES, "US");
    expect(out.venueLocation).toBeNull();
  });
});
