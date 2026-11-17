// D-789: a listing's address writing the street type short ("3 Thorpe Cl") still meets a known venue's street
// ("Thorpe Close"), so the canonical entry names and places it (UNDR, London, ruedalibre "UNDR House Of Flavaz").
import { describe, expect, it } from "vitest";
import type { KnownVenue } from "@/config/known-venues";
import type { HarvestedListing } from "@/src/adapters/types";
import { rawListingSchema } from "@/src/domain/listing";
import { withKnownVenue } from "@/src/pipeline/source-venue";

function listing(name: string, address: string): HarvestedListing {
  return {
    listing: rawListingSchema.parse({
      title: "Casa Tumbao: Classes, Social & Community",
      listing_type: "social",
      styles: ["salsa"],
      local_date: "2026-11-10",
      doors_time: "21:00",
      venue: { name, address, url: null },
      organizer: { name: null, url: null },
    }),
    externalId: "t:1",
    tz: "Europe/London",
    venueLocation: null,
    recurrence: null,
    provenance: {
      sourceUrl: "https://ruedalibre.co.uk/events/",
      fetchedAt: new Date(),
      method: "feed",
    },
  };
}

const UNDR: KnownVenue = {
  names: ["UNDR", "UNDR W10", "Undrw10", "UNDR House Of Flavaz", "House Of Flavaz"],
  address: "3 Thorpe Close, London W10 5XL",
  streets: ["Thorpe Close"],
  point: { lat: 51.5182896, lng: -0.2084052 },
  canonical: true,
};

describe("known venue street phrase with a short street type (D-789)", () => {
  it("takes the entry for 'Thorpe Cl' against the street 'Thorpe Close'", () => {
    const out = withKnownVenue(
      listing("UNDR House Of Flavaz", "3 Thorpe Cl, London, United Kingdom"),
      [UNDR],
      "GB",
    );
    expect(out.listing.venue.name).toBe("UNDR");
    expect(out.listing.venue.address).toBe("3 Thorpe Close, London W10 5XL");
    expect(out.venueLocation).toEqual({ lat: 51.5182896, lng: -0.2084052 });
  });

  it("matches the other way round: a long street type in the listing, a short one in the entry", () => {
    const entry: KnownVenue = {
      names: ["The Hall"],
      address: "1 Mill Ln, London",
      streets: ["Mill Ln"],
    };
    const out = withKnownVenue(
      listing("The Hall", "1 Mill Lane, London, United Kingdom"),
      [entry],
      "GB",
    );
    expect(out.listing.venue.address).toBe("1 Mill Ln, London");
  });

  it("keeps the listing's own address on another street", () => {
    const out = withKnownVenue(
      listing("UNDR House Of Flavaz", "3 Thorpe Rd, London, United Kingdom"),
      [UNDR],
      "GB",
    );
    expect(out.listing.venue.address).toBe("3 Thorpe Rd, London, United Kingdom");
  });
});
