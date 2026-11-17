// D-855: El Fenn's own Sol Sundays page stores its rows under the source label "Sol Sundays at El Fenn", while
// Tidar and RA write "El Fenn Hotel". Without `canonical` each name made its own venue, so the 11-22 night showed
// twice (Tidar's timed card at El Fenn Hotel, the page's untimed one at "Sol Sundays at El Fenn"; diag 43072946384).
import { describe, expect, it } from "vitest";
import type { HarvestedListing } from "@/src/adapters/types";
import { rawListingSchema } from "@/src/domain/listing";
import { withKnownVenue } from "@/src/pipeline/source-venue";
import { KNOWN_VENUES } from "@/config/known-venues";

function listing(name: string, address: string | null): HarvestedListing {
  return {
    listing: rawListingSchema.parse({
      title: "SOL SUNDAYS",
      listing_type: "dj_night",
      styles: [],
      local_date: "2026-11-22",
      dancing_time: "17:00",
      venue: { name, address, url: null },
      organizer: { name: null, url: null },
    }),
    externalId: "test:el-fenn",
    tz: "Africa/Casablanca",
    venueLocation: null,
    recurrence: null,
    provenance: {
      sourceUrl: "https://el-fenn.com/sol-sundays-at-el-fenn/",
      fetchedAt: new Date("2026-11-11T08:00:00Z"),
      method: "llm",
    },
  };
}

describe("El Fenn is one venue under every name its sources write (D-855)", () => {
  const known = KNOWN_VENUES.marrakesh ?? [];
  const entry = known.find((v) => v.names.includes("Sol Sundays at El Fenn"));

  it("is a canonical entry whose first name is the stored venue's, El Fenn Hotel", () => {
    expect(entry?.canonical).toBe(true);
    expect(entry?.names[0]).toBe("El Fenn Hotel");
  });

  // The page's rows come with the seed's venueAddress, the entry's own address (config/sources/marrakesh.ts).
  it.each([
    ["Sol Sundays at El Fenn", null],
    ["Sol Sundays at El Fenn", entry?.address ?? ""],
    ["El Fenn", null],
    ["El Fenn Hotel", entry?.address ?? ""],
    ["El Fenn Hotel and Rooftop Bar", null],
  ])("%s (%s) is stored as El Fenn Hotel at the checked point", (name, address) => {
    const result = withKnownVenue(listing(name, address), known, "MA");
    expect(result.listing.venue.name).toBe("El Fenn Hotel");
    expect(result.venueLocation).toEqual({ lat: 31.6269841, lng: -7.9932304 });
  });
});
