import { describe, expect, it } from "vitest";
import { rawListingSchema } from "@/src/domain/listing";
import { withKnownVenue, closedKnownVenue } from "@/src/pipeline/source-venue";
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

describe("closedKnownVenue (D-263)", () => {
  const known: KnownVenue[] = [
    {
      names: ["Mojito Club"],
      address: "Carrer del Rosselló, 217, 08008 Barcelona",
      closed: "closed per its own site, 2026-10-29",
    },
    {
      names: ["Antilla BCN"],
      address: "Carrer d'Aragó, 141, 08015 Barcelona",
    },
  ];

  it("1. A listing named 'Mojito Club' with no address, placed by withKnownVenue, returns the Mojito entry", () => {
    const listing = makeListing({
      name: "Mojito Club",
      address: null,
    });
    const after = withKnownVenue(listing, known, "ES");
    const closed = closedKnownVenue(after, known);
    expect(closed).not.toBeNull();
    expect(closed?.names).toContain("Mojito Club");
    expect(closed?.closed).toBe("closed per its own site, 2026-10-29");
  });

  it("2. A listing with address of Mojito Club and no name gives the Mojito entry", () => {
    const listing = makeListing({
      name: null,
      address: "Carrer del Rosselló, 217, 08008 Barcelona",
    });
    const after = withKnownVenue(listing, known, "ES");
    const closed = closedKnownVenue(after, known);
    expect(closed).not.toBeNull();
    expect(closed?.names).toContain("Mojito Club");
  });

  it("3. A listing named 'Antilla BCN' placed by withKnownVenue gives null (open venue)", () => {
    const listing = makeListing({
      name: "Antilla BCN",
      address: null,
    });
    const after = withKnownVenue(listing, known, "ES");
    const closed = closedKnownVenue(after, known);
    expect(closed).toBeNull();
  });

  it("4. A listing named 'Mojito Club' with different address gives null", () => {
    const listing = makeListing({
      name: "Mojito Club",
      address: "Calle Falsa 1, 28001 Madrid",
    });
    const after = withKnownVenue(listing, known, "ES");
    const closed = closedKnownVenue(after, known);
    expect(closed).toBeNull();
  });

  it("5. Edge cases", () => {
    // entry with closed: "   "
    const knownWithWhitespace: KnownVenue[] = [
      {
        names: ["Test Venue"],
        address: "Test Address",
        closed: "   ",
      },
    ];
    const listing = makeListing({
      name: "Test Venue",
      address: "Test Address",
    });
    const after = withKnownVenue(listing, knownWithWhitespace, "US");
    const closed = closedKnownVenue(after, knownWithWhitespace);
    expect(closed).toBeNull();

    // known undefined
    expect(closedKnownVenue(listing, undefined)).toBeNull();
    // known empty
    expect(closedKnownVenue(listing, [])).toBeNull();
    // listing with null address
    const listingNoAddress = makeListing({ name: "Test", address: null });
    expect(closedKnownVenue(listingNoAddress, known)).toBeNull();
  });
});
