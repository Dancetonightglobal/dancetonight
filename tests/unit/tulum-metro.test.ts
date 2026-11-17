// Tulum is the Tulum and Solidaridad (Playa del Carmen) municipios (D-1080), outline in config/metro-bounds/tulum.json.
import { describe, expect, it } from "vitest";

import type { Metro } from "@/src/adapters/types";
import {
  METRO_OUTSIDE_TOWNS,
  METRO_POSTCODE_PREFIXES,
  titleNamesOutsideTown,
} from "@/config/metro-regions";
import { KNOWN_VENUES } from "@/config/known-venues";
import type { HarvestedListing } from "@/src/adapters/types";
import { withKnownVenue, withSeedVenue } from "@/src/pipeline/source-venue";
import { METRO_RETIRED_SOURCES, METRO_SOURCES } from "@/config/sources";
import { insideMetro } from "@/src/domain/metro-bounds";
import { neighbourhoodAt } from "@/src/domain/neighbourhoods";
import { RA_AREAS } from "@/config/sources/ra";

const TULUM: Metro = {
  id: "m",
  slug: "tulum",
  name: "Tulum",
  countryCode: "MX",
  center: { lat: 20.3969, lng: -87.3144 },
  radiusKm: 73,
  tz: "America/Cancun",
  languages: ["es", "en"],
};

describe("the Tulum metro (D-1080)", () => {
  it.each([
    ["Akumal, centre", 20.3969, -87.3144],
    ["Tulum centro, Avenida Tulum", 20.2114, -87.4654],
    ["Tulum ruins on the shore", 20.2148, -87.429],
    ["Tulum beach road (hotel zone)", 20.165, -87.456],
    ["Aldea Zamá", 20.201, -87.456],
    ["Cobá", 20.483, -87.7389],
    ["Puerto Aventuras", 20.5063, -87.2276],
    ["Xcaret", 20.5796, -87.1278],
    ["Playa del Carmen, Quinta Avenida and Calle 12", 20.6283, -87.0706],
    ["Playacar", 20.6104, -87.0856],
  ])("puts %s inside", (_name, lat, lng) => {
    expect(insideMetro(TULUM, { lat, lng })).toBe(true);
  });

  it.each([
    ["Cozumel, San Miguel", 20.508, -86.95],
    ["Puerto Morelos", 20.847, -86.875],
    ["Cancún", 21.1619, -86.8515],
    ["Felipe Carrillo Puerto", 19.58, -88.045],
    ["Valladolid", 20.6896, -88.2016],
  ])("leaves %s outside", (_name, lat, lng) => {
    expect(insideMetro(TULUM, { lat, lng })).toBe(false);
  });

  it.each([
    ["Tulum centro", 20.2114, -87.4654, "Tulum"],
    ["Tulum beach road", 20.165, -87.456, "Tulum area"],
    ["Akumal", 20.3969, -87.3144, "Tulum area"],
    ["Puerto Aventuras", 20.5063, -87.2276, "Puerto Aventuras"],
    ["Quinta Avenida", 20.6283, -87.0706, "Playa del Carmen"],
    ["Xcaret", 20.5796, -87.1278, "Playa del Carmen area"],
  ])("names %s's neighbourhood", (_name, lat, lng, hood) => {
    expect(neighbourhoodAt({ lat, lng })).toBe(hood);
  });
});

describe("Tulum in the shared tables", () => {
  it("reads Quintana Roo 777xx postcodes", () => {
    expect(METRO_POSTCODE_PREFIXES.tulum).toEqual(["777"]);
  });

  it("lists outside towns, never a town inside", () => {
    const towns = METRO_OUTSIDE_TOWNS.tulum ?? [];
    expect(towns).toContain("Cancún");
    expect(towns).toContain("Cozumel");
    for (const inside of [
      "Akumal",
      "Cobá",
      "Puerto Aventuras",
      "Xcaret",
      "Riviera Maya",
      "Playa del Carmen",
    ]) {
      expect(towns).not.toContain(inside);
    }
  });

  it.each([
    ["Salsa night in Cancún", "Cancún"],
    ["Cozumel Beach Party", "Cozumel"],
  ])("takes %s for a night out of town", (title, town) => {
    expect(titleNamesOutsideTown("tulum", title)).toBe(town);
  });

  it.each([
    ["Riviera Maya Salsa Social"],
    ["Akumal Full Moon Party"],
    ["Playa del Carmen Bachata Night"],
  ])("keeps %s in Tulum", (title) => {
    expect(titleNamesOutsideTown("tulum", title)).toBeNull();
  });

  it("wires its sources in, its retired addresses and its known venues", () => {
    expect(METRO_SOURCES.tulum).toBeDefined();
    expect(METRO_RETIRED_SOURCES.tulum).toEqual([]);
  });

  it("places the Mandala clubs' rows at a checked point inside the metro (their seed addresses are vague)", () => {
    const known = KNOWN_VENUES.tulum ?? [];
    const clubs = (METRO_SOURCES.tulum ?? []).filter(
      (s) => s.url.startsWith("https://mandalatickets.com/") && !s.url.endsWith("/mandala"),
    );
    expect(clubs).toHaveLength(5);
    for (const club of clubs) {
      const entry = known.find((k) => k.address === club.venueAddress);
      expect(entry, club.label).toBeDefined();
      expect(entry?.names).toContain(club.label);
      expect(entry?.point, club.label).toBeDefined();
      if (entry?.point) expect(insideMetro(TULUM, entry.point), club.label).toBe(true);
    }
  });

  it("a club page's row with no place, or only the club's name, takes the club's checked point", () => {
    const seed = (METRO_SOURCES.tulum ?? []).find((s) => s.label === "Rakata Playa del Carmen");
    expect(seed).toBeDefined();
    for (const name of [null, "RAKATA"]) {
      const row = {
        listing: {
          title: "RAKATA",
          listing_type: "club_night",
          styles: ["dj_night"],
          local_date: "2026-11-13",
          doors_time: "20:00",
          venue: { name, address: null, url: null },
          organizer: { name: null, url: null },
        },
        externalId: "test:rakata",
        tz: "America/Cancun",
        venueLocation: null,
        recurrence: null,
        provenance: { sourceUrl: seed?.url, fetchedAt: new Date(), method: "llm" },
      } as unknown as HarvestedListing;
      const placed = withKnownVenue(withSeedVenue(row, seed, false), KNOWN_VENUES.tulum, "MX");
      expect(placed.listing.venue.address, String(name)).toBe(seed?.venueAddress);
      expect(placed.venueLocation, String(name)).toEqual({ lat: 20.6271883, lng: -87.0711791 });
    }
  });

  it("reads Resident Advisor for Tulum (523) and Playa del Carmen (684)", () => {
    expect(RA_AREAS.tulum).toBe(523);
    const ra = (METRO_SOURCES.tulum ?? []).filter((s) => s.platform === "ra");
    expect(ra.map((s) => s.label).sort()).toEqual([
      "Resident Advisor Playa del Carmen",
      "Resident Advisor Tulum",
    ]);
  });
});
