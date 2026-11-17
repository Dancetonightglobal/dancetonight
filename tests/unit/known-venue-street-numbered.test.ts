import { describe, expect, it } from "vitest";

import { KNOWN_VENUES } from "@/config/known-venues";
import type { HarvestedListing } from "@/src/adapters/types";
import { rawListingSchema } from "@/src/domain/listing";
import { withKnownVenue } from "@/src/pipeline/source-venue";

// D-879 (daily check 11-12, London): Kizuna's entry is street-only ("Hanbury Street, London E1 5JP", streets
// ["Hanbury Street"]). It took every listing on Hanbury Street, house number or not, so Juju's Bar and Stage and
// Ely's Yard Social (both 15 Hanbury Street) lost their number and landed on Kizuna's point as two venue rows,
// and "Sambroso Cuban Sundays" / "Cuban Sundays" showed twice every Sunday. Salsynergy Sundays showed twice too:
// ruedalibre's "St. Aldhelms Church, 2 Windmill Road, London" was geocoded to Chiswick, 21 km from the London
// Dance Factory copy next door at Gladys Aylward School, N18.

function listing(name: string | null, address: string | null): HarvestedListing {
  const raw = rawListingSchema.parse({
    title: "Cuban Sundays",
    listing_type: "social",
    styles: ["salsa"],
    local_date: "2026-11-15",
    doors_time: "16:00",
    venue: { name, address, url: null },
    organizer: { name: null, url: null },
  });
  return {
    listing: raw,
    externalId: "x",
    tz: null,
    venueLocation: null,
    recurrence: null,
    provenance: { sourceUrl: "https://example.com/" },
  } as unknown as HarvestedListing;
}

const london = KNOWN_VENUES.london ?? [];

describe("a street-only known venue and a listing with a house number (D-879)", () => {
  it("keeps Juju's own numbered Hanbury Street address", () => {
    const result = withKnownVenue(
      listing("Juju's Bar and Stage", "15 Hanbury Street, London"),
      london,
      "GB",
    );
    expect(result.listing.venue.address).toBe("15 Hanbury Street, London");
    expect(result.venueLocation).toBeNull();
  });

  it("keeps Ely's Yard's own numbered address with its postcode", () => {
    const own = "Ely's Yard, 15 Hanbury St, London E1 6QR, UK";
    const result = withKnownVenue(listing("Ely's Yard Social", own), london, "GB");
    expect(result.listing.venue.address).toBe(own);
  });

  it("still places a numberless Hanbury Street listing at Kizuna's entry", () => {
    const result = withKnownVenue(listing(null, "Hanbury Street, London E1 6QR"), london, "GB");
    expect(result.listing.venue.address).toBe("Hanbury Street, London E1 5JP");
    expect(result.listing.venue.name).toBe("Kizuna");
  });

  it("still places Kizuna by its name", () => {
    const result = withKnownVenue(listing("Kizuna", "Hanbury St, London E1 5JP"), london, "GB");
    expect(result.listing.venue.address).toBe("Hanbury Street, London E1 5JP");
    expect(result.venueLocation).toEqual({ lat: 51.520431, lng: -0.071193 });
  });

  it("still lets a numbered entry take its own street's listing (Croftdown Road)", () => {
    const result = withKnownVenue(
      listing(null, "Between 51 & 53 Croftdown Road, London, England, NW5 1EL, United Kingdom"),
      london,
      "GB",
    );
    expect(result.listing.venue.address).toBe("53 Croftdown Road, London NW5 1HE");
  });
});

describe("St Aldhelm's Church, Edmonton (D-879)", () => {
  const POINT = { lat: 51.61809, lng: -0.08041 };

  it("places ruedalibre's postcode-less address in Edmonton, not Chiswick", () => {
    const result = withKnownVenue(
      listing("St. Aldhelms Church", "2 Windmill Road, London"),
      london,
      "GB",
    );
    expect(result.listing.venue.name).toBe("St Aldhelm's Church");
    expect(result.listing.venue.address).toBe("2 Windmill Road, London N18 1PA");
    expect(result.venueLocation).toEqual(POINT);
  });

  it("puts the London Dance Factory copy next door on the same venue", () => {
    const result = withKnownVenue(
      listing(
        "The London Dance Factory",
        "Gladys Aylward School, 1 Windmill Rd, London, WSM, N18 1NB",
      ),
      london,
      "GB",
    );
    expect(result.listing.venue.name).toBe("St Aldhelm's Church");
    expect(result.listing.venue.address).toBe("2 Windmill Road, London N18 1PA");
    expect(result.venueLocation).toEqual(POINT);
  });

  it("leaves another Windmill Road (Chiswick, W4) alone", () => {
    const own = "21 Windmill Road, London W4 1RN";
    const result = withKnownVenue(listing("The Windmill Pub", own), london, "GB");
    expect(result.listing.venue.address).toBe(own);
  });
});
