import { describe, expect, it } from "vitest";
import { rawListingSchema } from "@/src/domain/listing";
import { withKnownVenue } from "@/src/pipeline/source-venue";
import type { HarvestedListing } from "@/src/adapters/types";
import type { KnownVenue } from "@/config/known-venues";

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

const ENTRIES: KnownVenue[] = [
  { names: ["El Galpón"], address: "Passeig de Enric Sanchis 44, 08030 Barcelona" },
  { names: ["Downtown Cupey"], address: "54 Av. Paraná, San Juan, PR 00926" },
  {
    names: ["Música Bar & Lounge"],
    address: "2500 Calle Loíza, San Juan, PR 00913",
    streets: ["Pagan's Building Plaza"],
  },
  { names: ["Fábrica"], address: "Rua da Fábrica 12, 1950-128 Lisboa" },
];

describe("withKnownVenue: street forms with postcode+town, # prefix, and entry streets", () => {
  it("matches Barcelona address without postcode", () => {
    const out = withKnownVenue(
      makeListing("El Galpón", "Passeig de Enric Sanchis 44, Barcelona"),
      ENTRIES,
      "ES",
    );
    expect(out.listing.venue.address).toBe("Passeig de Enric Sanchis 44, 08030 Barcelona");
  });

  it("keeps different house number unchanged", () => {
    const out = withKnownVenue(
      makeListing("El Galpón", "Passeig de Enric Sanchis 46, Barcelona"),
      ENTRIES,
      "ES",
    );
    expect(out.listing.venue.address).toBe("Passeig de Enric Sanchis 46, Barcelona");
  });

  it("matches #54 Ave. Paraná with entry's 54 Av. Paraná", () => {
    const out = withKnownVenue(
      makeListing("Downtown Cupey", "#54 Ave. Paraná, San Juan, PR"),
      ENTRIES,
      "US",
    );
    expect(out.listing.venue.address).toBe("54 Av. Paraná, San Juan, PR 00926");
  });

  it("takes entry address when listing address includes entry's street phrase", () => {
    const out = withKnownVenue(
      makeListing(
        "Música Bar & Lounge",
        "Calle Loiza #2057, Pagan's Building Plaza, San Juan, PR 00912",
      ),
      ENTRIES,
      "US",
    );
    expect(out.listing.venue.address).toBe("2500 Calle Loíza, San Juan, PR 00913");
  });

  it("keeps own address when no street phrase and ZIP differs", () => {
    const out = withKnownVenue(
      makeListing("Música Bar & Lounge", "Calle Loiza #2057, San Juan, PR 00912"),
      ENTRIES,
      "US",
    );
    expect(out.listing.venue.address).toBe("Calle Loiza #2057, San Juan, PR 00912");
  });

  it("matches Lisbon address without postcode", () => {
    const out = withKnownVenue(makeListing("Fábrica", "Rua da Fabrica 12, Lisboa"), ENTRIES, "PT");
    expect(out.listing.venue.address).toBe("Rua da Fábrica 12, 1950-128 Lisboa");
  });

  it("handles postcode-only address gracefully", () => {
    const out = withKnownVenue(makeListing("El Galpón", "08030 Barcelona"), ENTRIES, "ES");
    // Should not throw; we don't assert specific result
    expect(out.listing.venue.address).toBeDefined();
  });
});
