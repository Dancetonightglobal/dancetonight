// Marrakesh is the Prefecture of Marrakech (the owner 2026-11-07, D-1100): the outline in config/metro-bounds/marrakesh.json
// (HDX COD-AB Morocco admin2, CC BY-IGO), no neighbourhood outlines yet (Who's On First Morocco has points only),
// Barid Al-Maghrib 40xxx postcodes, and the towns around it that listings name.
import { describe, expect, it } from "vitest";

import type { Metro } from "@/src/adapters/types";
import {
  METRO_OUTSIDE_TOWNS,
  METRO_POSTCODE_PREFIXES,
  titleNamesOutsideTown,
} from "@/config/metro-regions";
import { KNOWN_VENUES } from "@/config/known-venues";
import { METRO_RETIRED_SOURCES, METRO_SOURCES } from "@/config/sources";
import { RA_AREAS } from "@/config/sources/ra";
import { insideMetro } from "@/src/domain/metro-bounds";
import { postcodeOutsideMetro } from "@/src/pipeline/geocode";

const MARRAKESH: Metro = {
  id: "m",
  slug: "marrakesh",
  name: "Marrakesh",
  countryCode: "MA",
  center: { lat: 31.6258, lng: -7.9892 },
  radiusKm: 60,
  tz: "Africa/Casablanca",
  languages: ["en", "fr", "ar"],
};

describe("the Marrakesh area (D-1100)", () => {
  it.each([
    ["Jemaa el-Fnaa", 31.6258, -7.9892],
    ["Comptoir Darna, Hivernage", 31.6224, -8.0118],
    ["Pacha Marrakech, Zone Hoteliere de l'Aguedal", 31.5862, -7.9978],
    ["The Source, km 10 Route de l'Ourika", 31.5665, -7.9562],
    ["the Palmeraie", 31.67, -7.96],
  ])("puts %s inside", (_name, lat, lng) => {
    expect(insideMetro(MARRAKESH, { lat, lng })).toBe(true);
  });

  it.each([
    ["Setti Fatma, Ourika valley", 31.23, -7.68],
    ["Amizmiz", 31.215, -8.238],
    ["Essaouira", 31.5085, -9.7595],
    ["Casablanca", 33.5731, -7.5898],
  ])("leaves %s outside", (_name, lat, lng) => {
    expect(insideMetro(MARRAKESH, { lat, lng })).toBe(false);
  });
});

describe("Marrakesh in the shared tables", () => {
  it("takes 40xxx postcodes as inside and other Moroccan codes as outside", () => {
    expect(
      postcodeOutsideMetro("Avenue Echouhada, Hivernage 40000 Marrakech", MARRAKESH),
    ).toBeNull();
    expect(postcodeOutsideMetro("Km 10 Route de l'Ourika, 40160 Marrakech", MARRAKESH)).toBeNull();
    expect(
      postcodeOutsideMetro("10 Bd de l'Ocean Atlantique, Casablanca 20052", MARRAKESH),
    ).not.toBeNull();
    expect(METRO_POSTCODE_PREFIXES.marrakesh).toEqual(["40"]);
  });

  it("lists outside towns, never a place inside or a road out of town", () => {
    const towns = METRO_OUTSIDE_TOWNS.marrakesh ?? [];
    for (const inside of [
      "Marrakech",
      "Marrakesh",
      "Gueliz",
      "Hivernage",
      "Palmeraie",
      "Ourika",
      "Agafay",
      "Amizmiz",
    ]) {
      expect(towns).not.toContain(inside);
    }
  });

  it.each([
    ["Techno Night Casablanca", "Casablanca"],
    ["Sunset Party Essaouira", "Essaouira"],
  ])("takes %s for a night out of town", (title, town) => {
    expect(titleNamesOutsideTown("marrakesh", title)).toBe(town);
  });

  it.each([
    ["Salsa Night at Gueliz"],
    ["Pool Party km 10 Route de l'Ourika"],
    ["Agafay Desert Rave"],
  ])("keeps %s in Marrakesh", (title) => {
    expect(titleNamesOutsideTown("marrakesh", title)).toBeNull();
  });

  it("reads Resident Advisor area 173 (Morocco)", () => {
    expect(RA_AREAS.marrakesh).toBe(173);
  });

  it("wires its sources in, its retired addresses and its known venues", () => {
    expect(METRO_SOURCES.marrakesh).toBeDefined();
    expect(METRO_RETIRED_SOURCES.marrakesh).toBeDefined();
    expect(KNOWN_VENUES.marrakesh).toBeInstanceOf(Array);
  });
});
