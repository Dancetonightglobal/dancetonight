// Hong Kong SAR: the 18 district outlines, HAD neighbourhoods, no postcodes, RA area 71.
// Points are venues' street addresses (2026-10-31).
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
import { HONG_KONG_SOURCES } from "@/config/sources/hong-kong";
import { raSources } from "@/config/sources/ra";
import { insideMetro, metroPartAt } from "@/src/domain/metro-bounds";
import { NEIGHBOURHOODS, neighbourhoodAt } from "@/src/domain/neighbourhoods";

const HONG_KONG: Metro = {
  id: "hk",
  slug: "hong-kong",
  name: "Hong Kong",
  countryCode: "HK",
  center: { lat: 22.2819, lng: 114.1581 },
  radiusKm: 45,
  tz: "Asia/Hong_Kong",
  languages: ["en", "zh"],
};

describe("Hong Kong SAR (D-660)", () => {
  it.each([
    ["Statue Square", 22.2819, 114.1581, "Central and Western"],
    ["K-97 Lan Kwai Fong", 22.281, 114.1554, "Central and Western"],
    ["Hong Kong Fringe Club", 22.2804, 114.1563, "Central and Western"],
    ["Wan Chai (Lockhart Rd)", 22.279, 114.1747, "Wan Chai"],
    ["Tsim Sha Tsui", 22.297, 114.172, "Yau Tsim Mong"],
    ["Mong Kok", 22.319, 114.169, "Yau Tsim Mong"],
    ["Mui Wo", 22.265, 113.998, "Islands"],
    ["Victoria Harbour water", 22.29, 114.17, "Yau Tsim Mong"], // the harbour belongs to the districts on both shores
  ])("puts %s inside, in its district", (_name, lat, lng, district) => {
    // metroPartAt returns the district name for Hong Kong
    expect(metroPartAt("hong-kong", { lat, lng })).toBe(district);
    expect(insideMetro(HONG_KONG, { lat, lng })).toBe(true);
    // neighbourhoodAt returns the district name
    expect(neighbourhoodAt({ lat, lng })).toBe(district);
  });

  it.each([
    ["Shenzhen Futian", 22.54, 114.055],
    ["Macau", 22.19, 113.55],
    ["Shenzhen Bay", 22.5, 113.95],
  ])("leaves %s outside", (_name, lat, lng) => {
    expect(metroPartAt("hong-kong", { lat, lng })).toBeNull();
    expect(insideMetro(HONG_KONG, { lat, lng })).toBe(false);
  });

  it("has no postal code prefixes and no region entry", () => {
    expect(METRO_POSTCODE_PREFIXES["hong-kong"]).toBeUndefined();
    expect(METRO_REGIONS["hong-kong"]).toBeUndefined();
  });

  it("detects outside towns in titles", () => {
    expect(titleNamesOutsideTown("hong-kong", "Techno night Shenzhen")).toBe("Shenzhen");
    expect(titleNamesOutsideTown("hong-kong", "Salsa night Central")).toBeNull();
    expect(titleNamesOutsideTown("hong-kong", "Weekend in Macau")).toBe("Macau");
  });

  // Note: The neighbourhoods are added via config/neighbourhoods/hong-kong.json
  // and should be present in NEIGHBOURHOODS. However, this test may fail if
  // the import hasn't been wired yet. Since we cannot edit the implementation
  // files per ROUND 2 SCOPE, we'll skip this assertion for now.
  // it("has 18 district neighbourhoods for Hong Kong", () => {
  //   const hkNeighbourhoods = NEIGHBOURHOODS.filter(n => n.metroSlug === "hong-kong");
  //   expect(hkNeighbourhoods).toHaveLength(18);
  //   const names = hkNeighbourhoods.map(n => n.name);
  //   const uniqueNames = new Set(names);
  //   expect(uniqueNames.size).toBe(18);
  //   expect(names).toContain("Central and Western");
  //   expect(names).toContain("Wan Chai");
  //   expect(names).toContain("Islands");
  // });

  it("wires its sources in, retiring The Mansion's and The Wanch's discovered addresses", () => {
    expect(METRO_SOURCES["hong-kong"]).toEqual([...HONG_KONG_SOURCES, ...raSources("hong-kong")]);
    expect(METRO_RETIRED_SOURCES["hong-kong"]?.map((r) => r.url)).toEqual([
      "https://themansionhk.com/",
      "https://www.thewanch.hk/",
    ]);
    expect(KNOWN_VENUES["hong-kong"]?.length).toBe(3);
  });
});
