// London: Sway Bar known venue (2026-11-01), so a row naming only "Sway Bar" lands at Holborn.
import { describe, expect, it } from "vitest";

import { KNOWN_VENUES } from "@/config/known-venues";
import type { HarvestedListing } from "@/src/adapters/types";
import { rawListingSchema } from "@/src/domain/listing";
import { withKnownVenue } from "@/src/pipeline/source-venue";

function listing(name: string | null, address: string | null): HarvestedListing {
  const raw = rawListingSchema.parse({
    title: "Latin Krazy Thursday",
    listing_type: "social",
    styles: ["salsa"],
    local_date: "2026-11-05",
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
    provenance: { sourceUrl: "https://www.latinkrazy.com/" },
  } as unknown as HarvestedListing;
}

const london = KNOWN_VENUES.london ?? [];
const SWAY = "Sway, 61-65 Great Queen Street, London WC2B 5BZ";

describe("London known venue: Sway Bar", () => {
  it("places a row that names only Sway Bar at Great Queen Street", () => {
    const placed = withKnownVenue(listing("Sway Bar", null), london, "GB");
    expect(placed.listing.venue.address).toBe(SWAY);
    expect(placed.venueLocation).not.toBeNull();
  });

  it("places latinkrazy.com's address form at the same venue", () => {
    const placed = withKnownVenue(
      listing("SWAY BAR", "61-65 Great Queen Street London WC2B 5BZ"),
      london,
      "GB",
    );
    expect(placed.listing.venue.address).toBe(SWAY);
    expect(placed.venueLocation).not.toBeNull();
  });
});
