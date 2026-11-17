// Hong Kong known venues: the geocoder refused these sources' own addresses (run 41172032324, 2026-10-31),
// so each entry repeats the source's string and its hand-checked point is used.
import { describe, expect, it } from "vitest";

import { KNOWN_VENUES } from "@/config/known-venues";
import type { HarvestedListing } from "@/src/adapters/types";
import { rawListingSchema } from "@/src/domain/listing";
import { withKnownVenue } from "@/src/pipeline/source-venue";

function listingAt(
  name: string,
  address: string,
  point: { lat: number; lng: number } | null,
): HarvestedListing {
  const raw = rawListingSchema.parse({
    title: "Test Night",
    listing_type: "club_night",
    styles: ["house"],
    local_date: "2026-11-06",
    doors_time: "22:00",
    venue: { name, address, url: null },
    organizer: { name: null, url: null },
  });
  return {
    listing: raw,
    externalId: "test:hk",
    tz: "Asia/Hong_Kong",
    venueLocation: point,
    recurrence: null,
    provenance: {
      sourceUrl: "https://ra.co/graphql?area=71",
      fetchedAt: new Date(0),
      method: "feed",
    },
  };
}

const cases: [string, string, { lat: number; lng: number }][] = [
  [
    "Casual",
    "3rd Floor, 1 Lockhart Road, Wan Chai, Hong Kong Island",
    { lat: 22.2785656, lng: 114.1689344 },
  ],
  [
    "The Fringe Club",
    "2 Lower Albert Road, Central, Hong Kong",
    { lat: 22.2802533, lng: 114.1557449 },
  ],
  [
    "Hong Kong Observation Wheel & AIA Vitality Park",
    "33 Man Kwong Street  Central, HKI",
    { lat: 22.2853165, lng: 114.1617716 },
  ],
];

describe("Hong Kong known venues", () => {
  it.each(cases)("%s takes its hand-checked point", (name, address, point) => {
    const out = withKnownVenue(listingAt(name, address, null), KNOWN_VENUES["hong-kong"], "HK");
    expect(out.venueLocation).toEqual(point);
    expect(out.listing.venue.address).toBe(address);
  });

  it("replaces RA's wrong point for the Observation Wheel", () => {
    const [name, address, point] = cases[2]!;
    const out = withKnownVenue(
      listingAt(name, address, { lat: 60.17, lng: 24.94 }),
      KNOWN_VENUES["hong-kong"],
      "HK",
    );
    expect(out.venueLocation).toEqual(point);
  });

  it("every entry has a point in Hong Kong", () => {
    for (const venue of KNOWN_VENUES["hong-kong"] ?? []) {
      const p = venue.point;
      expect(p, venue.names[0]).toBeDefined();
      expect(p!.lat).toBeGreaterThan(22.1);
      expect(p!.lat).toBeLessThan(22.6);
      expect(p!.lng).toBeGreaterThan(113.8);
      expect(p!.lng).toBeLessThan(114.5);
    }
  });
});

describe("Hong Kong known venues: Fringe rooms", () => {
  it("places the Fringe Dairy room at the Fringe Club", () => {
    const out = withKnownVenue(
      listingAt("Fringe Dairy", "2 Lower Albert Road, Central, Hong Kong", null),
      KNOWN_VENUES["hong-kong"],
      "HK",
    );
    expect(out.venueLocation).toEqual({ lat: 22.2802533, lng: 114.1557449 });
  });
});
