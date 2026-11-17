import { describe, expect, it } from "vitest";

import type { Metro } from "@/src/adapters/types";
import { parsePlaces, splitLinks, toVenueRow, type OverturePlace } from "@/src/jobs/seed-venues";

const NYC: Metro = {
  id: "11111111-1111-4111-8111-111111111111",
  slug: "nyc",
  name: "New York",
  countryCode: "US",
  center: { lat: 40.7128, lng: -74.006 },
  radiusKm: 50,
  tz: "America/New_York",
  languages: ["en"],
};

// The shape scripts/overture_places.py writes, from the 2026-09-23.0 release.
const place = (over: Partial<OverturePlace> = {}): OverturePlace => ({
  id: "0aa1",
  name: "Danceteria",
  category: "dance_club",
  lat: 40.7447,
  lng: -73.9907,
  confidence: 0.91,
  websites: ["https://www.facebook.com/danceteria", "https://danceteria.example/"],
  socials: ["https://www.instagram.com/danceteria"],
  address: {
    freeform: "30 W 21st St",
    locality: "New York",
    postcode: "10010",
    region: "NY",
    country: "US",
  },
  datasets: ["Overture", "meta"],
  licenses: ["CDLA-Permissive-2.0"],
  release: "2026-09-23.0",
  ...over,
});

describe("the Overture venue loader", () => {
  it("separates the venue's own site from its social profiles", () => {
    expect(
      splitLinks(
        ["https://www.facebook.com/x", "https://x.example/"],
        ["https://instagram.com/x", "javascript:alert(1)"],
      ),
    ).toEqual({
      website: "https://x.example/",
      socials: { facebook: "https://www.facebook.com/x", instagram: "https://instagram.com/x" },
    });
  });

  it("maps a place to a venue row with its kind, floor, zone and per-row licence", () => {
    expect(toVenueRow(place(), NYC)).toMatchObject({
      name: "Danceteria",
      nameNormalized: "danceteria",
      kind: "night_club",
      danceFloor: "yes",
      tz: "America/New_York",
      overtureId: "0aa1",
      seedProvider: "overture 2026-09-23.0 (Overture, meta)",
      seedLicence: "CDLA-Permissive-2.0",
      websiteUrl: "https://danceteria.example/",
      address: { formatted: "30 W 21st St, New York, NY, 10010" },
    });
    expect(toVenueRow(place({ category: "dance_studio" }), NYC)).toMatchObject({
      kind: "studio",
      danceFloor: "unknown",
    });
  });

  it("leaves out places outside the radius, below confidence or outside the seed categories", () => {
    expect(toVenueRow(place({ lat: 41.5, lng: -74.0 }), NYC)).toBeNull();
    expect(toVenueRow(place({ confidence: 0.2 }), NYC)).toBeNull();
    expect(toVenueRow(place({ category: "restaurant" }), NYC)).toBeNull();
  });

  it("leaves out places inside the radius but outside the metro's outline (D-755)", () => {
    // Jersey City NJ: 4 km from the NYC centre, outside the five boroughs.
    expect(toVenueRow(place({ lat: 40.7178, lng: -74.0431 }), NYC)).toBeNull();
    // Brooklyn: inside the outline.
    expect(toVenueRow(place({ lat: 40.6782, lng: -73.9442 }), NYC)).not.toBeNull();
  });

  it("counts lines it cannot read instead of guessing", () => {
    const { places, invalid } = parsePlaces(`${JSON.stringify(place())}\nnot json\n{"id":"x"}\n`);
    expect(places).toHaveLength(1);
    expect(invalid).toBe(2);
  });
});
