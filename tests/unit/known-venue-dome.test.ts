import { describe, expect, it } from "vitest";
import { rawListingSchema } from "@/src/domain/listing";
import { withKnownVenue } from "@/src/pipeline/source-venue";
import type { HarvestedListing } from "@/src/adapters/types";
import { KNOWN_VENUES } from "@/config/known-venues";

// D-753, daily check 11-05 (coverage 98 cause C): London Funky Mambo's Tuesday night had five cards on four venue
// records, one of them social-dance.today's "Junction Road" 900 m off. Every copy now lands on one record.

function makeListing(name: string, address: string | null): HarvestedListing {
  const raw = rawListingSchema.parse({
    title: "Funky Mambo",
    listing_type: "social",
    styles: ["salsa"],
    local_date: "2026-11-10",
    doors_time: "19:15",
    venue: { name, address, url: null },
    organizer: { name: null, url: null },
  });
  return {
    listing: raw,
    externalId: "test:1",
    tz: "Europe/London",
    venueLocation: { lat: 51.55272, lng: -0.14988 },
    recurrence: null,
    provenance: { sourceUrl: "https://example.com", fetchedAt: new Date(), method: "feed" },
  };
}

describe("Downstairs at The Dome, 178 Junction Road (D-753)", () => {
  const known = KNOWN_VENUES["london"];
  const cases: [string, string | null][] = [
    ["Downstairs at The Dome", "178 Junction Road, London N19 5QQ, United Kingdom"],
    ["Funky Mambo", "178 JUNCTION ROAD, LONDON, N19 5QQ"],
    ["Dirty Water Club London, 1996-2009", "178 Junction Road, London N19 5QQ"],
    ["Junction Road", "Junction Road, Tufnell Park, N19 5QQ, London, United Kingdom"],
  ];
  for (const [name, address] of cases) {
    it(`places "${name}" on the one record at the OSM point`, () => {
      const r = withKnownVenue(makeListing(name, address), known, "GB");
      expect(r.listing.venue.name).toBe("Downstairs at The Dome");
      expect(r.listing.venue.address).toBe("178 Junction Road, London N19 5QQ");
      expect(r.venueLocation?.lat).toBeCloseTo(51.5573, 3);
      expect(r.venueLocation?.lng).toBeCloseTo(-0.1384, 3);
    });
  }

  it("leaves another venue on Junction Road where it is", () => {
    const r = withKnownVenue(
      makeListing("Junction Road", "Junction Road, Croydon CR0 2DT"),
      known,
      "GB",
    );
    expect(r.listing.venue.address).toBe("Junction Road, Croydon CR0 2DT");
  });
});
