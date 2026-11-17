import { describe, expect, it } from "vitest";
import { rawListingSchema } from "@/src/domain/listing";
import { withKnownVenue } from "@/src/pipeline/source-venue";
import type { HarvestedListing } from "@/src/adapters/types";
import { KNOWN_VENUES } from "@/config/known-venues";

// D-750, daily check 11-05 section A: two venues placed far off by one source.
// Buenos Aires: circuitopeñero's "LA PRACTICA FOLKLORICA", AV. SAENZ 459 was geocoded to Villa Crespo
// (-34.591,-58.435); ritmolibre had it right in Nueva Pompeya. London: ruedalibre's "UNDR House Of Flavaz"
// was geocoded to East London (51.555, 0.016); social-dance.today's "Undrw10", 3 Thorpe Close W10 is right.

function makeListing(name: string, address: string | null, tz: string): HarvestedListing {
  const raw = rawListingSchema.parse({
    title: "Test Event",
    listing_type: "social",
    styles: ["salsa"],
    local_date: "2026-11-08",
    doors_time: "13:00",
    venue: { name, address, url: null },
    organizer: { name: null, url: null },
  });
  return {
    listing: raw,
    externalId: "test:1",
    tz,
    venueLocation: null,
    recurrence: null,
    provenance: { sourceUrl: "https://example.com", fetchedAt: new Date(), method: "feed" },
  };
}

describe("La Práctica Folklórica, Nueva Pompeya (D-750)", () => {
  const known = KNOWN_VENUES["buenos-aires"];
  it("places circuitopeñero's upper-case copy at Av. Sáenz 459", () => {
    const r = withKnownVenue(
      makeListing("LA PRACTICA FOLKLORICA", "AV. SAENZ 459", "America/Argentina/Buenos_Aires"),
      known,
      "AR",
    );
    expect(r.listing.venue.address).toContain("Sáenz 459");
    expect(r.venueLocation?.lat).toBeCloseTo(-34.6448, 3);
    expect(r.venueLocation?.lng).toBeCloseTo(-58.4163, 3);
  });
  it("places ritmolibre's accented name there too", () => {
    const r = withKnownVenue(
      makeListing("La Práctica Folklórica", null, "America/Argentina/Buenos_Aires"),
      known,
      "AR",
    );
    expect(r.venueLocation?.lat).toBeCloseTo(-34.6448, 3);
  });
});

describe("UNDR, Thorpe Close W10 (D-750)", () => {
  const known = KNOWN_VENUES.london;
  it("places ruedalibre's 'UNDR House Of Flavaz' at 3 Thorpe Close", () => {
    const r = withKnownVenue(
      makeListing("UNDR House Of Flavaz", null, "Europe/London"),
      known,
      "GB",
    );
    expect(r.listing.venue.address).toBe("3 Thorpe Close, London W10 5XL");
    expect(r.venueLocation?.lat).toBeCloseTo(51.5183, 3);
  });
  it("stores social-dance.today's 'Undrw10' under the same name", () => {
    const a = withKnownVenue(
      makeListing("Undrw10", "3 Thorpe Close, London W10 5XL", "Europe/London"),
      known,
      "GB",
    );
    const b = withKnownVenue(
      makeListing("UNDR House Of Flavaz", null, "Europe/London"),
      known,
      "GB",
    );
    expect(a.listing.venue.name).toBe(b.listing.venue.name);
  });
});

describe("La Salsera, Almagro (D-750)", () => {
  const known = KNOWN_VENUES["buenos-aires"];
  const tz = "America/Argentina/Buenos_Aires";
  it("stores dancetomic's address-named venue as La Salsera", () => {
    const r = withKnownVenue(makeListing("Yatay 961, Almagro", "Yatay 961, CABA", tz), known, "AR");
    expect(r.listing.venue.name).toBe("La Salsera");
    expect(r.venueLocation?.lat).toBeCloseTo(-34.6004, 3);
  });
  it("places salsavida's La Salsera at the same point", () => {
    const r = withKnownVenue(makeListing("La Salsera", null, tz), known, "AR");
    expect(r.venueLocation?.lng).toBeCloseTo(-58.4282, 3);
  });
});
