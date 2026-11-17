import { describe, expect, it } from "vitest";
import { rawListingSchema } from "@/src/domain/listing";
import { withKnownVenue } from "@/src/pipeline/source-venue";
import { venueNameCandidates } from "@/src/pipeline/venue-name-fallback";
import type { HarvestedListing } from "@/src/adapters/types";
import type { KnownVenue } from "@/config/known-venues";

function makeListing({
  title = "Test Event",
  venueName = null,
  venueAddress = null,
  venueLocation = null,
}: {
  title?: string;
  venueName?: string | null;
  venueAddress?: string | null;
  venueLocation?: { lat: number; lng: number } | null;
}): HarvestedListing {
  const raw = rawListingSchema.parse({
    title,
    listing_type: "social",
    styles: ["swing"],
    local_date: "2026-10-11",
    doors_time: "20:00",
    venue: {
      name: venueName ?? null,
      address: venueAddress ?? null,
      url: null,
    },
    organizer: { name: null, url: null },
  });
  return {
    listing: raw,
    externalId: "test:1",
    tz: "America/New_York",
    venueLocation,
    recurrence: null,
    provenance: {
      sourceUrl: "https://example.com",
      fetchedAt: new Date(),
      method: "feed",
    },
  };
}

describe("venueNameCandidates", () => {
  it("returns empty array when venueName has no placeholder", () => {
    expect(venueNameCandidates("Pensão Amor", "x")).toEqual([]);
  });

  it("strips prefix placeholder with dash", () => {
    expect(venueNameCandidates("TBA - Pensão Amor", "x")).toEqual(["Pensão Amor"]);
  });

  it("strips prefix placeholder with colon", () => {
    expect(venueNameCandidates("Secret location: Otto Zutz", "x")).toEqual(["Otto Zutz"]);
  });

  it("strips prefix placeholder with at sign", () => {
    expect(venueNameCandidates("Location TBA @ Niceto Club", "x")).toEqual(["Niceto Club"]);
  });

  it("strips trailing parenthesised placeholder", () => {
    expect(venueNameCandidates("Pensão Amor (TBA)", "x")).toEqual(["Pensão Amor"]);
  });

  it("extracts from title after last ' ~ at '", () => {
    expect(venueNameCandidates(null, "João Melgueira ~ at Pensão Amor")).toEqual(["Pensão Amor"]);
  });

  it("extracts from title after last ' @ ' and cuts at ' | '", () => {
    expect(venueNameCandidates(null, "Salsa Night @ Pensão Amor | Lisboa")).toEqual([
      "Pensão Amor",
    ]);
  });

  it("extracts from title after last ' at the ' and cuts at ' - '", () => {
    expect(venueNameCandidates(null, "Live at the Jazz Café - late")).toEqual(["Jazz Café"]);
  });

  it("ignores result shorter than 3 characters", () => {
    expect(venueNameCandidates(null, "Party @ A")).toEqual([]);
  });
});

describe("withKnownVenue name fallback (D-559)", () => {
  const known: KnownVenue[] = [
    {
      names: ["Pensão Amor"],
      address: "R. do Alecrim 19, 1200-292 Lisboa",
      point: { lat: 38.707, lng: -9.144 },
    },
    {
      names: ["Otto Zutz"],
      address: "Carrer de Lincoln 15, 08006 Barcelona",
    },
    {
      names: ["Niceto Club"],
      address: "Av. Cnel. Niceto Vega 5510, C1414 CABA",
    },
    {
      names: ["Jazz Café"],
      address: "5 Parkway, London NW1 7PG",
    },
  ];

  it("places venue with placeholder prefix and no address", () => {
    const listing = makeListing({
      venueName: "TBA - Pensão Amor",
      venueAddress: null,
      venueLocation: null,
    });
    const result = withKnownVenue(listing, known, "PT");
    expect(result.listing.venue.address).toBe("R. do Alecrim 19, 1200-292 Lisboa");
    expect(result.listing.venue.name).toBe("Pensão Amor");
    expect(result.venueLocation).toEqual({ lat: 38.707, lng: -9.144 });
  });

  it("places venue with placeholder prefix and zero point", () => {
    const listing = makeListing({
      venueName: "TBA - Pensão Amor",
      venueAddress: null,
      venueLocation: { lat: 0, lng: 0 },
    });
    const result = withKnownVenue(listing, known, "PT");
    expect(result.listing.venue.address).toBe("R. do Alecrim 19, 1200-292 Lisboa");
    expect(result.listing.venue.name).toBe("Pensão Amor");
    expect(result.venueLocation).toEqual({ lat: 38.707, lng: -9.144 });
  });

  it("places venue null name with title containing separator", () => {
    const listing = makeListing({
      venueName: null,
      venueAddress: null,
      venueLocation: null,
      title: "João Melgueira ~ at Pensão Amor",
    });
    const result = withKnownVenue(listing, known, "PT");
    expect(result.listing.venue.address).toBe("R. do Alecrim 19, 1200-292 Lisboa");
    expect(result.listing.venue.name).toBe("Pensão Amor");
    expect(result.venueLocation).toEqual({ lat: 38.707, lng: -9.144 });
  });

  it("places venue with 'Secret location:' prefix", () => {
    const listing = makeListing({
      venueName: "Secret location: Otto Zutz",
      venueAddress: null,
      venueLocation: null,
    });
    const result = withKnownVenue(listing, known, "ES");
    expect(result.listing.venue.address).toBe("Carrer de Lincoln 15, 08006 Barcelona");
    expect(result.listing.venue.name).toBe("Otto Zutz");
    expect(result.venueLocation).toBeNull();
  });

  it("does NOT place when own address present", () => {
    const listing = makeListing({
      venueName: "TBA - Pensão Amor",
      venueAddress: "Rua X 1, Porto",
      venueLocation: null,
    });
    const result = withKnownVenue(listing, known, "PT");
    expect(result.listing.venue.address).toBe("Rua X 1, Porto");
    expect(result.listing.venue.name).toBe("TBA - Pensão Amor");
    expect(result.venueLocation).toBeNull();
  });

  it("does NOT place when real point present", () => {
    const listing = makeListing({
      venueName: "TBA - Pensão Amor",
      venueAddress: null,
      venueLocation: { lat: 38.7, lng: -9.1 },
    });
    const result = withKnownVenue(listing, known, "PT");
    expect(result.listing.venue.address).toBeNull();
    expect(result.listing.venue.name).toBe("TBA - Pensão Amor");
    expect(result.venueLocation).toEqual({ lat: 38.7, lng: -9.1 });
  });

  it("does NOT place when candidate matches nothing", () => {
    const listing = makeListing({
      venueName: "TBA - Unknown Bar",
      venueAddress: null,
      venueLocation: null,
    });
    const result = withKnownVenue(listing, known, "PT");
    expect(result).toBe(listing);
  });

  it("does NOT place when title contains no matching venue", () => {
    const listing = makeListing({
      venueName: null,
      venueAddress: null,
      venueLocation: null,
      title: "Party at Home",
    });
    const result = withKnownVenue(listing, known, "PT");
    expect(result).toBe(listing);
  });

  it("does NOT place when two candidates match two different entries", () => {
    const listing = makeListing({
      venueName: "TBA - Otto Zutz",
      venueAddress: null,
      venueLocation: null,
      title: "Night @ Niceto Club",
    });
    const result = withKnownVenue(listing, known, "ES");
    // Should be unchanged because multiple matching entries
    expect(result).toBe(listing);
  });
});
