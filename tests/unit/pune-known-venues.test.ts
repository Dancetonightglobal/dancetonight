import { describe, expect, it } from "vitest";
import { rawListingSchema } from "@/src/domain/listing";
import { withKnownVenue } from "@/src/pipeline/source-venue";
import type { HarvestedListing } from "@/src/adapters/types";
import { KNOWN_VENUES } from "@/config/known-venues";

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
    listing_type: "club_night",
    styles: [],
    local_date: "2026-11-14",
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
    tz: "Asia/Kolkata",
    venueLocation,
    recurrence: null,
    provenance: {
      sourceUrl: "https://ra.co/events/2580778",
      fetchedAt: new Date(),
      method: "feed",
    },
  };
}

const RA_ADDRESS =
  "Unit No. 101, Mezz & 1st Floor, Cello Platina, C.T.S No. 1183, Fergusson College Rd, Shivajinagar, Pune, Maharashtra 411005";

describe("Pune known venues", () => {
  const puneVenues = KNOWN_VENUES.pune ?? [];

  it("places RA's Antisocial Pune row (rounded point dropped, address refused) at the checked point", () => {
    const listing = makeListing({
      title: "Bass Tapri feat. Dreokt, Ov3rdrive, Ankan & more",
      venueName: "Antisocial Pune",
      venueAddress: RA_ADDRESS,
      venueLocation: null,
    });
    const result = withKnownVenue(listing, puneVenues, "IN");
    expect(result.venueLocation).toEqual({ lat: 18.529, lng: 73.84362 });
  });

  it("matches the Cello Platina address when the venue name differs", () => {
    const listing = makeListing({
      venueName: "Some Other Name",
      venueAddress: RA_ADDRESS,
      venueLocation: null,
    });
    const result = withKnownVenue(listing, puneVenues, "IN");
    expect(result.venueLocation).toEqual({ lat: 18.529, lng: 73.84362 });
  });

  it("does not place Mumbai's antiSOCIAL from the Pune list", () => {
    expect(KNOWN_VENUES.mumbai ?? []).toEqual(
      expect.not.arrayContaining([
        expect.objectContaining({ names: expect.arrayContaining(["Antisocial Pune"]) }),
      ]),
    );
  });

  it("every entry has a point inside the Pune box", () => {
    for (const venue of puneVenues) {
      expect(venue.point!.lat).toBeGreaterThan(18.3);
      expect(venue.point!.lat).toBeLessThan(18.8);
      expect(venue.point!.lng).toBeGreaterThan(73.6);
      expect(venue.point!.lng).toBeLessThan(74.1);
    }
  });
});
