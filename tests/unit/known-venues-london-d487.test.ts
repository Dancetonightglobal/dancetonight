// London D-487: known venues for read 41157882789's postcode-only rows, and SwingdanceUK's
// workshops page retired.
import { describe, expect, it } from "vitest";

import { KNOWN_VENUES } from "@/config/known-venues";
import { LONDON_RETIRED, LONDON_SOURCES } from "@/config/sources/london";
import type { HarvestedListing } from "@/src/adapters/types";
import { rawListingSchema } from "@/src/domain/listing";
import { withKnownVenue } from "@/src/pipeline/source-venue";

function listing(name: string | null, address: string | null): HarvestedListing {
  const raw = rawListingSchema.parse({
    title: "Salsa and bachata night",
    listing_type: "social",
    styles: ["salsa"],
    local_date: "2026-11-02",
    doors_time: "19:30",
    venue: { name, address, url: null },
    organizer: { name: null, url: null },
  });
  return {
    listing: raw,
    externalId: "test:1",
    tz: "Europe/London",
    venueLocation: null,
    recurrence: null,
    provenance: { sourceUrl: "https://www.tickettailor.com/events/dancegps1" },
  } as unknown as HarvestedListing;
}

const london = KNOWN_VENUES.london ?? [];

describe("London known venues (D-487)", () => {
  it("places the Ticket Tailor venues that write only a name and a postcode", () => {
    const cases: [string, string, string][] = [
      ["The George IV", "The George IV, W4 2DR", "185 Chiswick High Road, London W4 2DR"],
      ["The Drayton Court", "The Drayton Court, W13 8PH", "2 The Avenue, London W13 8PH"],
      [
        "Be At One - Regent Street",
        "Be At One - Regent Street, W1F 9RA",
        "10 Beak Street, London W1F 9RA",
      ],
      ["Dance Staion", "Dance Staion, EC3A 3DH", "80 Leadenhall Street, London EC3A 3DH"],
    ];
    for (const [name, written, expected] of cases) {
      const placed = withKnownVenue(listing(name, written), london, "GB");
      expect(placed.listing.venue.address, name).toBe(expected);
      expect(placed.venueLocation, name).not.toBeNull();
    }
  });

  it("places the RSCDS Thursday Social's hall, St Columba's, Pont Street", () => {
    const placed = withKnownVenue(listing("St Columba's", null), london, "GB");
    expect(placed.listing.venue.address).toBe("Pont Street, London SW1X 0BD");
    expect(placed.venueLocation).not.toBeNull();
  });

  it("retires SwingdanceUK's workshops page, which never answered within 20 s", () => {
    const url = "https://swingdanceuk.com/classes/workshops/";
    expect(LONDON_SOURCES.some((s) => s.url === url)).toBe(false);
    expect(LONDON_RETIRED.some((r) => r.url === url)).toBe(true);
  });
});
