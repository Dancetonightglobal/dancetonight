// Beirut is the governorate plus the coastal Metn and Baabda cadastres next to it (the owner 2026-11-06, D-1000):
// the outline in config/metro-bounds/beirut.json, cadastral-area neighbourhoods from HDX COD-AB (CC BY-IGO),
// no postcodes (Lebanese addresses do not use them), and the towns around it that listings name.
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
import { neighbourhoodAt } from "@/src/domain/neighbourhoods";

import beirutNeighbourhoods from "@/config/neighbourhoods/beirut.json";

const BEIRUT: Metro = {
  id: "m",
  slug: "beirut",
  name: "Beirut",
  countryCode: "LB",
  center: { lat: 33.8959, lng: 35.5069 },
  radiusKm: 15,
  tz: "Asia/Beirut",
  languages: ["en", "fr", "ar"],
};

describe("the Beirut area (D-1000)", () => {
  it.each([
    ["AUB, Bliss Street", 33.9006, 35.48, "Ain el Mreisseh"],
    ["Hamra Street", 33.8963, 35.4823, "Ras Beirut"],
    ["Mar Mikhael, Armenia Street", 33.8975, 35.5245, "Medawar"],
    ["The Grand Factory, Karantina", 33.903, 35.531, "Medawar"],
    ["Badaro", 33.8745, 35.513, "Mazraa"],
    ["Sin el Fil", 33.875, 35.537, "Sin el Fil"],
  ])("puts %s inside, in its cadastral area", (_name, lat, lng, hood) => {
    expect(insideMetro(BEIRUT, { lat, lng })).toBe(true);
    expect(neighbourhoodAt({ lat, lng })).toBe(hood);
  });

  it.each([
    ["Zaitunay Bay (marina)", 33.9013, 35.495],
    ["Raouche rock (sea)", 33.89, 35.4703],
    ["Dbayeh waterfront", 33.9435, 35.5865],
  ])("keeps %s (water's edge) inside", (_name, lat, lng) => {
    expect(insideMetro(BEIRUT, { lat, lng })).toBe(true);
  });

  it.each([
    ["Jounieh", 33.98, 35.617],
    ["Beit Meri", 33.857, 35.5946],
    ["Khalde", 33.78, 35.49],
    ["Byblos", 34.1208, 35.6481],
  ])("leaves %s outside", (_name, lat, lng) => {
    expect(insideMetro(BEIRUT, { lat, lng })).toBe(false);
  });

  it("has the 38 cadastral areas", () => {
    const names = beirutNeighbourhoods.neighbourhoods.map((n) => n.name);
    expect(names.length).toBe(38);
    for (const n of [
      "Achrafieh",
      "Ras Beirut",
      "Downtown Beirut",
      "Bourj Hammoud",
      "Dbayeh",
      "Chiyah",
    ]) {
      expect(names).toContain(n);
    }
  });
});

describe("Beirut in the shared tables", () => {
  it("has no postcode prefixes (Lebanese addresses carry none)", () => {
    expect(METRO_POSTCODE_PREFIXES.beirut).toBeUndefined();
  });

  it("lists outside towns, never a place inside", () => {
    const towns = METRO_OUTSIDE_TOWNS.beirut ?? [];
    for (const inside of [
      "Beirut",
      "Achrafieh",
      "Hamra",
      "Baabda",
      "Dbayeh",
      "Sin el Fil",
      "Antelias",
    ]) {
      expect(towns).not.toContain(inside);
    }
  });

  it.each([
    ["Salsa Night Jounieh", "Jounieh"],
    ["Techno in Byblos", "Byblos"],
    ["Batroun Beach Party", "Batroun"],
  ])("takes %s for a night out of town", (title, town) => {
    expect(titleNamesOutsideTown("beirut", title)).toBe(town);
  });

  it.each([
    ["Bachata Night at Mar Mikhael"],
    ["Hamra Salsa Social"],
    ["Whiskey Sour Night"],
    ["Dubai Nights Party"],
  ])("keeps %s in Beirut", (title) => {
    expect(titleNamesOutsideTown("beirut", title)).toBeNull();
  });

  it("reads Resident Advisor area 547 (Beirut, Lebanon)", () => {
    expect(RA_AREAS.beirut).toBe(547);
  });

  it("wires its sources in, its retired addresses and its known venues", () => {
    expect(METRO_SOURCES.beirut).toBeDefined();
    expect(METRO_RETIRED_SOURCES.beirut).toBeDefined();
    expect(KNOWN_VENUES.beirut).toBeInstanceOf(Array);
  });
});
