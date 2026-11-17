// Nashville is Davidson County (D-1200), the consolidated Metropolitan Government of Nashville and Davidson
// County: the Census TIGER outline, Who's On First neighbourhoods with the county's satellite cities as the
// coarser fallback, Tennessee addresses, 370-372 ZIP codes, and the towns around it that source titles name.
// Points are each venue's street address, from the Census geocoder (2026-11-07).
import { describe, expect, it } from "vitest";

import type { Metro } from "@/src/adapters/types";
import {
  METRO_OUTSIDE_TOWNS,
  METRO_POSTCODE_PREFIXES,
  METRO_REGIONS,
  titleNamesOutsideTown,
} from "@/config/metro-regions";
import { KNOWN_VENUES } from "@/config/known-venues";
import { METRO_RETIRED_SOURCES, METRO_SOURCES } from "@/config/sources";
import { insideMetro, metroPartAt } from "@/src/domain/metro-bounds";
import { NEIGHBOURHOODS, neighbourhoodAt } from "@/src/domain/neighbourhoods";

const NASHVILLE: Metro = {
  id: "m",
  slug: "nashville",
  name: "Nashville",
  countryCode: "US",
  center: { lat: 36.1659, lng: -86.7844 },
  radiusKm: 35,
  tz: "America/Chicago",
  languages: ["en"],
};

describe("Davidson County (D-1200)", () => {
  it.each([
    ["Tootsie's Orchid Lounge, 422 Broadway", 36.160769, -86.777926, "Downtown"],
    ["Wildhorse Saloon, 120 2nd Ave N", 36.162541, -86.775518, "The District"],
    ["Exit/In, 2208 Elliston Pl", 36.151266, -86.804268, "Elliston Place"],
    ["The Basement East, 917 Woodland St", 36.17545, -86.755476, "East Nashville"],
    ["Belle Meade", 36.0989, -86.8653, "Belle Meade"],
  ])("puts %s inside, in its neighbourhood", (_name, lat, lng, hood) => {
    expect(metroPartAt("nashville", { lat, lng })).toBe("Davidson County");
    expect(insideMetro(NASHVILLE, { lat, lng })).toBe(true);
    expect(neighbourhoodAt({ lat, lng })).toBe(hood);
  });

  it.each([
    ["Franklin", 35.9251, -86.8689],
    ["Hendersonville", 36.3048, -86.62],
    ["Mount Juliet", 36.2001, -86.5186],
    ["La Vergne", 36.0156, -86.5819],
  ])("leaves %s outside, though its circle reaches it", (_name, lat, lng) => {
    expect(metroPartAt("nashville", { lat, lng })).toBeNull();
    expect(insideMetro(NASHVILLE, { lat, lng })).toBe(false);
  });

  it("leaves out the City of Nashville and WOF's bare compass names, and keeps the satellite cities", () => {
    const names = new Set(NEIGHBOURHOODS.map((n) => n.name));
    for (const name of ["Nashville", "Northeast", "Southeast"]) expect(names.has(name)).toBe(false);
    for (const town of ["Belle Meade", "Berry Hill", "Forest Hills", "Oak Hill"]) {
      expect(names.has(town)).toBe(true);
    }
  });
});

describe("Nashville in the shared tables", () => {
  it("reads Tennessee addresses and 370-372 ZIP codes", () => {
    expect(METRO_REGIONS.nashville).toEqual(["TN"]);
    expect(METRO_POSTCODE_PREFIXES.nashville).toEqual(["370", "371", "372"]);
  });

  it("names the towns around it, and none that is also a Davidson County place or street", () => {
    const towns = METRO_OUTSIDE_TOWNS.nashville ?? [];
    for (const town of ["Franklin, TN", "Murfreesboro, TN", "Hendersonville", "Mount Juliet"]) {
      expect(towns).toContain(town);
    }
    for (const name of [
      "Nashville",
      "Brentwood",
      "Goodlettsville",
      "Franklin",
      "Murfreesboro",
      "Gallatin",
      "Lebanon",
      "Nolensville",
      "Memphis",
      "Chattanooga",
    ]) {
      expect(towns).not.toContain(name);
    }
  });

  it.each([
    ["Line Dancing in Franklin, TN", "Franklin, TN"],
    ["Salsa Night - Hendersonville", "Hendersonville"],
  ])("takes %s for a night out of town", (title, town) => {
    expect(titleNamesOutsideTown("nashville", title)).toBe(town);
  });

  it.each([
    "Two-Step Night at the Nashville Palace",
    "Salsa on Nolensville Pike",
    "Chattanooga Choo Choo Swing Night",
    "Memphis Jookin Cypher",
    "Bachata Night on Murfreesboro Pike",
  ])("keeps %s in Nashville", (title) => {
    expect(titleNamesOutsideTown("nashville", title)).toBeNull();
  });

  it("wires its sources, retired addresses and known venues in", () => {
    // Resident Advisor's Nashville area (D-505, D-1200).
    expect(METRO_SOURCES.nashville?.map((s) => s.url)).toContain("https://ra.co/graphql?area=653");
    expect(METRO_RETIRED_SOURCES.nashville).toEqual([]);
    expect(KNOWN_VENUES.nashville).toEqual([]);
  });
});
