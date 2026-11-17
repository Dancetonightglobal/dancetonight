import { describe, expect, it } from "vitest";
import { withSeedVenue } from "@/src/pipeline/source-venue";
import type { HarvestedListing } from "@/src/adapters/types";

function makeListing(venue: { name?: string | null; address?: string | null }): HarvestedListing {
  return {
    listing: {
      title: "Test Event",
      listing_type: "social",
      styles: ["salsa"],
      local_date: "2026-10-11",
      doors_time: "20:00",
      venue: {
        name: venue.name ?? null,
        address: venue.address ?? null,
        url: null,
      },
      organizer: { name: null, url: null },
    },
    externalId: "test:1",
    tz: "Europe/London",
    venueLocation: null,
    recurrence: null,
    provenance: {
      sourceUrl: "https://mandalatickets.com/events/",
      fetchedAt: new Date(),
      method: "feed",
    },
  } as unknown as HarvestedListing;
}

describe("withSeedVenue - unnamed listing with non-street address", () => {
  const mandalaSeed = {
    label: "Mandala Playa del Carmen",
    venueAddress: "1 Avenida Nte., Centro, 77710 Playa del Carmen, Q.R.",
    venuePage: true,
  };

  const vagalumeSeed = {
    label: "Vagalume Tulum",
    venueAddress: "QROO 15, Tulum Beach, 77776 Q.R.",
    venuePage: true,
  };

  it("name null, address 'Mandala', mandala, placed false -> name 'Mandala Playa del Carmen', address = seed's", () => {
    const listing = makeListing({ name: null, address: "Mandala" });
    const result = withSeedVenue(listing, mandalaSeed, false);
    expect(result.listing.venue.name).toBe("Mandala Playa del Carmen");
    expect(result.listing.venue.address).toBe(
      "1 Avenida Nte., Centro, 77710 Playa del Carmen, Q.R.",
    );
  });

  it("same with placed true -> same result", () => {
    const listing = makeListing({ name: null, address: "Mandala" });
    const result = withSeedVenue(listing, mandalaSeed, true);
    expect(result.listing.venue.name).toBe("Mandala Playa del Carmen");
    expect(result.listing.venue.address).toBe(
      "1 Avenida Nte., Centro, 77710 Playa del Carmen, Q.R.",
    );
  });

  it("name '  ', address 'Tulum', vagalume, placed true -> name 'Vagalume Tulum', address = seed's", () => {
    const listing = makeListing({ name: "  ", address: "Tulum" });
    const result = withSeedVenue(listing, vagalumeSeed, true);
    expect(result.listing.venue.name).toBe("Vagalume Tulum");
    expect(result.listing.venue.address).toBe("QROO 15, Tulum Beach, 77776 Q.R.");
  });

  it("name null, street address, mandala -> unchanged", () => {
    const listing = makeListing({ name: null, address: "45 Calle 12 Nte, Playa del Carmen" });
    const result = withSeedVenue(listing, mandalaSeed, false);
    expect(result.listing.venue.name).toBeNull();
    expect(result.listing.venue.address).toBe("45 Calle 12 Nte, Playa del Carmen");
  });

  it("name 'Coco Bongo', address 'Playa del Carmen', mandala -> unchanged", () => {
    const listing = makeListing({ name: "Coco Bongo", address: "Playa del Carmen" });
    const result = withSeedVenue(listing, mandalaSeed, false);
    expect(result.listing.venue.name).toBe("Coco Bongo");
    expect(result.listing.venue.address).toBe("Playa del Carmen");
  });

  it("name null, address 'Mandala', seed with venuePage: false -> unchanged", () => {
    const seed = { ...mandalaSeed, venuePage: false };
    const listing = makeListing({ name: null, address: "Mandala" });
    const result = withSeedVenue(listing, seed, false);
    expect(result.listing.venue.name).toBeNull();
    expect(result.listing.venue.address).toBe("Mandala");
  });

  it("name null, address null, mandala, placed true -> unchanged", () => {
    const listing = makeListing({ name: null, address: null });
    const result = withSeedVenue(listing, mandalaSeed, true);
    expect(result.listing.venue.name).toBeNull();
    expect(result.listing.venue.address).toBeNull();
  });

  it("name null, address null, mandala, placed false -> name and address filled", () => {
    const listing = makeListing({ name: null, address: null });
    const result = withSeedVenue(listing, mandalaSeed, false);
    expect(result.listing.venue.name).toBe("Mandala Playa del Carmen");
    expect(result.listing.venue.address).toBe(
      "1 Avenida Nte., Centro, 77710 Playa del Carmen, Q.R.",
    );
  });
});
