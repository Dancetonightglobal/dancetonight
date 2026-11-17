// Istanbul is the province (D-680): the 39 districts, the outline in config/metro-bounds/istanbul.json,
// mahalle neighbourhoods, postcodes 34xxx, and the towns around it that listings name.
import { describe, expect, it } from "vitest";

import type { Metro } from "@/src/adapters/types";
import {
  METRO_OUTSIDE_TOWNS,
  METRO_POSTCODE_PREFIXES,
  titleNamesOutsideTown,
} from "@/config/metro-regions";
import { KNOWN_VENUES } from "@/config/known-venues";
import { METRO_RETIRED_SOURCES, METRO_SOURCES } from "@/config/sources";
import { insideMetro } from "@/src/domain/metro-bounds";
import { neighbourhoodAt } from "@/src/domain/neighbourhoods";

import istanbulNeighbourhoods from "@/config/neighbourhoods/istanbul.json";

const ISTANBUL: Metro = {
  id: "m",
  slug: "istanbul",
  name: "Istanbul",
  countryCode: "TR",
  center: { lat: 41.0369, lng: 28.985 },
  radiusKm: 100,
  tz: "Europe/Istanbul",
  languages: ["tr", "en"],
};

describe("the Istanbul province (D-680)", () => {
  it.each([
    ["Kanyon, Levent", 41.0784, 29.011, "Esentepe"],
    ["Zorlu PSM", 41.0676, 29.0167, "Levazım"],
    ["Bomonti Ada", 41.0569, 28.9813, "Cumhuriyet"],
    ["Moda, Kadıköy", 40.9845, 29.025, "Caferağa"],
    ["Galata Tower", 41.0256, 28.9742, "Bereketzade"],
    ["Hagia Sophia", 41.0086, 28.9802, "Cankurtaran"],
    ["Bebek", 41.077, 29.0435, "Bebek"],
    ["Silivri centre", 41.0736, 28.2464, "Silivri"],
    ["Şile centre", 41.1747, 29.6125, "Şile"],
  ])("puts %s inside, in its mahalle", (_name, lat, lng, hood) => {
    expect(insideMetro(ISTANBUL, { lat, lng })).toBe(true);
    expect(neighbourhoodAt({ lat, lng })).toBe(hood);
  });

  it("keeps the middle of the Bosphorus (water) inside", () => {
    expect(insideMetro(ISTANBUL, { lat: 41.045, lng: 29.025 })).toBe(true);
  });

  it("includes Büyükada (Princes' Islands)", () => {
    expect(insideMetro(ISTANBUL, { lat: 40.8717, lng: 29.1288 })).toBe(true);
  });

  it.each([
    ["Gebze", 40.8027, 29.4307],
    ["Çorlu", 41.1592, 27.8],
    ["Ankara", 39.9334, 32.8597],
  ])("leaves %s outside", (_name, lat, lng) => {
    expect(insideMetro(ISTANBUL, { lat, lng })).toBe(false);
  });

  it("has at least 760 neighbourhoods from the istanbul file", () => {
    expect(istanbulNeighbourhoods.neighbourhoods.length).toBeGreaterThanOrEqual(760);
    const names = istanbulNeighbourhoods.neighbourhoods.map((n) => n.name);
    expect(names).toContain("Adalar");
    expect(names).toContain("Eyüpsultan");
    expect(names).toContain("Şişli");
    expect(names).toContain("Beyoğlu");
    expect(names).toContain("Kadıköy");
    expect(names).toContain("Üsküdar");
  });
});

describe("Istanbul in the shared tables", () => {
  it("reads postcodes 34xxx", () => {
    expect(METRO_POSTCODE_PREFIXES.istanbul).toEqual(["34"]);
  });

  it("lists outside towns, never including districts or islands inside", () => {
    const towns = METRO_OUTSIDE_TOWNS.istanbul ?? [];
    expect(towns).not.toContain("Silivri");
    expect(towns).not.toContain("Şile");
    expect(towns).not.toContain("Çatalca");
    expect(towns).not.toContain("Adalar");
    expect(towns).not.toContain("Beyoğlu");
    expect(towns).not.toContain("Kadıköy");
  });

  it.each([
    ["Salsa Night Ankara", "Ankara"],
    ["İzmir Tango Festivali", "İzmir"],
  ])("takes %s for a night out of town", (title, town) => {
    expect(titleNamesOutsideTown("istanbul", title)).toBe(town);
  });

  it.each([
    ["Bodrum kat salsa partisi", null],
    ["Kuruçeşme Arena Party", null],
  ])("keeps %s in Istanbul", (title, expected) => {
    expect(titleNamesOutsideTown("istanbul", title)).toBe(expected);
  });

  it("wires its sources in, its retired addresses and its known venues", () => {
    expect(METRO_SOURCES.istanbul).toBeDefined();
    expect(METRO_RETIRED_SOURCES.istanbul).toBeDefined();
    expect(KNOWN_VENUES.istanbul).toBeInstanceOf(Array);
  });
});
