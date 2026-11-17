// Berlin is the Land (D-1020): the 12 Bezirke, the outline in config/metro-bounds/berlin.json,
// Ortsteile neighbourhoods, postcodes 10xxx,12xxx,13xxx,140xx,141xx, and the towns around it that listings name.
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

import berlinNeighbourhoods from "@/config/neighbourhoods/berlin.json";

const BERLIN: Metro = {
  id: "m",
  slug: "berlin",
  name: "Berlin",
  countryCode: "DE",
  center: { lat: 52.5163, lng: 13.3777 },
  radiusKm: 35,
  tz: "Europe/Berlin",
  languages: ["de", "en"],
};

describe("the Land Berlin (D-1020)", () => {
  it.each([
    ["Brandenburger Tor", 52.5163, 13.3777, "Mitte"],
    ["Berghain", 52.5111, 13.443, "Friedrichshain"],
    ["SO36", 52.5003, 13.4219, "Kreuzberg"],
    ["Clärchens Ballhaus", 52.5267, 13.3967, "Mitte"],
    ["Havanna", 52.4855, 13.354, "Schöneberg"],
  ])("puts %s inside, in its Ortsteil", (_name, lat, lng, hood) => {
    expect(insideMetro(BERLIN, { lat, lng })).toBe(true);
    expect(neighbourhoodAt({ lat, lng })).toBe(hood);
  });

  it("keeps the middle of the Spree (water) inside", () => {
    expect(insideMetro(BERLIN, { lat: 52.52, lng: 13.4 })).toBe(true);
  });

  it("includes Tegel airport (closed) inside", () => {
    expect(insideMetro(BERLIN, { lat: 52.559, lng: 13.287 })).toBe(true);
  });

  it.each([
    ["Potsdam", 52.3906, 13.0645],
    ["Schönefeld BER airport", 52.3667, 13.5033],
    ["Leipzig", 51.3397, 12.3731],
  ])("leaves %s outside", (_name, lat, lng) => {
    expect(insideMetro(BERLIN, { lat, lng })).toBe(false);
  });

  it("has 109 neighbourhood entries (97 Ortsteile + 12 Bezirke) from the berlin file", () => {
    expect(berlinNeighbourhoods.neighbourhoods.length).toBe(109);
    const names = berlinNeighbourhoods.neighbourhoods.map((n) => n.name);
    expect(names).toContain("Mitte");
    expect(names).toContain("Friedrichshain");
    expect(names).toContain("Kreuzberg");
    expect(names).toContain("Schöneberg");
    expect(names).toContain("Charlottenburg");
    expect(names).toContain("Pankow");
  });
});

describe("Berlin in the shared tables", () => {
  it("reads postcodes 10,12,13,140,141", () => {
    expect(METRO_POSTCODE_PREFIXES.berlin).toEqual(["10", "12", "13", "140", "141"]);
  });

  it("lists outside towns, never including Bezirke or Ortsteile inside", () => {
    const towns = METRO_OUTSIDE_TOWNS.berlin ?? [];
    expect(towns).not.toContain("Mitte");
    expect(towns).not.toContain("Friedrichshain");
    expect(towns).not.toContain("Kreuzberg");
    expect(towns).not.toContain("Schöneberg");
    expect(towns).not.toContain("Brandenburg");
    expect(towns).not.toContain("Frankfurt");
  });

  it.each([
    ["Salsa Night Potsdam", "Potsdam"],
    ["Tango in Leipzig", "Leipzig"],
    ["Party in Hamburg", "Hamburg"],
    ["Event in Copenhagen", "Copenhagen"],
  ])("takes %s for a night out of town", (title, town) => {
    expect(titleNamesOutsideTown("berlin", title)).toBe(town);
  });

  it.each([
    ["Tango am Potsdamer Platz", null],
    ["Party im Hamburger Bahnhof", null],
    ["Brandenburger Tor Silvester", null],
    ["Frankfurter Allee Festival", null],
  ])("keeps %s in Berlin", (title, expected) => {
    expect(titleNamesOutsideTown("berlin", title)).toBe(expected);
  });

  it("wires its sources in, its retired addresses and its known venues", () => {
    expect(METRO_SOURCES.berlin).toBeDefined();
    expect(METRO_RETIRED_SOURCES.berlin).toBeDefined();
    expect(KNOWN_VENUES.berlin).toBeInstanceOf(Array);
  });
});
