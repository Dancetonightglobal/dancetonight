// Barcelona is the Barcelonès (D-360): ICGC outlines of its five municipalities, the Ajuntament's 73 barris
// inside the city and one outline per other municipality, 080/0890-0892/08930 postal codes, and the towns
// around it that source titles name. Points are each venue's street address (2026-10-29).
import { describe, expect, it } from "vitest";

import { DICE_GENRES } from "@/config/sources/dice";
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

const BARCELONA: Metro = {
  id: "m",
  slug: "barcelona",
  name: "Barcelona",
  countryCode: "ES",
  center: { lat: 41.387, lng: 2.17 },
  radiusKm: 15,
  tz: "Europe/Madrid",
  languages: ["ca", "es", "en"],
};

describe("the Barcelonès (D-360)", () => {
  it.each([
    [
      "Razzmatazz, Carrer dels Almogàvers 122",
      41.3976,
      2.1911,
      "Barcelona",
      "El Parc i la Llacuna del Poblenou",
    ],
    ["Sala Apolo, Carrer Nou de la Rambla 113", 41.3744, 2.1697, "Barcelona", "El Poble-sec"],
    ["Jamboree, Plaça Reial 17", 41.3803, 2.1753, "Barcelona", "El Barri Gòtic"],
    ["Luz de Gas, Carrer de Muntaner 246", 41.3956, 2.1453, "Barcelona", "Sant Gervasi - Galvany"],
    ["Plaça de Catalunya", 41.387, 2.17, "Barcelona", "La Dreta de l'Eixample"],
    [
      "Rambla de Just Oliveras, L'Hospitalet",
      41.3597,
      2.0997,
      "L'Hospitalet de Llobregat",
      "L'Hospitalet de Llobregat",
    ],
    ["Pont del Petroli, Badalona", 41.4441, 2.2391, "Badalona", "Badalona"],
  ])("puts %s inside, in its municipality and neighbourhood", (_name, lat, lng, part, hood) => {
    expect(metroPartAt("barcelona", { lat, lng })).toBe(part);
    expect(insideMetro(BARCELONA, { lat, lng })).toBe(true);
    expect(neighbourhoodAt({ lat, lng })).toBe(hood);
  });

  it.each([
    ["Cornellà de Llobregat", 41.355, 2.073],
    ["Esplugues de Llobregat", 41.3768, 2.088],
    ["Montgat", 41.465, 2.2797],
    ["Barcelona airport, El Prat", 41.2974, 2.0833],
    ["Sant Cugat del Vallès", 41.4722, 2.0864],
  ])("leaves %s outside, though its circle reaches it", (_name, lat, lng) => {
    expect(metroPartAt("barcelona", { lat, lng })).toBeNull();
    expect(insideMetro(BARCELONA, { lat, lng })).toBe(false);
  });

  it("names the 73 barris, and the other four municipalities as one outline each", () => {
    const names = new Set(NEIGHBOURHOODS.map((n) => n.name));
    for (const name of [
      "El Raval",
      "La Barceloneta",
      "La Vila de Gràcia",
      "Badalona",
      "Sant Adrià de Besòs",
    ]) {
      expect(names.has(name)).toBe(true);
    }
  });
});

describe("Barcelona in the shared tables", () => {
  it("has no region table (Spanish addresses are checked by country) and Barcelonès postal codes", () => {
    expect(METRO_REGIONS.barcelona).toBeUndefined();
    expect(METRO_POSTCODE_PREFIXES.barcelona).toEqual(["080", "0890", "0891", "0892", "08930"]);
  });

  it("names the towns around it, and none an Eixample street or an inside town shares", () => {
    const towns = METRO_OUTSIDE_TOWNS.barcelona ?? [];
    for (const town of ["Castelldefels", "Sitges", "Sant Cugat", "Mataró", "Cornellà"]) {
      expect(towns).toContain(town);
    }
    for (const name of [
      "Girona",
      "Tarragona",
      "Lleida",
      "València",
      "Santa Coloma",
      "Badalona",
      "Barcelona",
    ]) {
      expect(towns).not.toContain(name);
    }
  });

  it.each([
    ["Social de bachata a Castelldefels", "Castelldefels"],
    ["Swing a la platja de Sitges", "Sitges"],
    ["Blues al NOSE - Torredembarra", "Torredembarra"],
    ["TBA - Avda/ Mediterrani,24 17300 Blanes", "Blanes"],
    ["TBA - Kiosk del Rec (Igualada)", "Igualada"],
  ])("takes %s for a night out of town", (title, town) => {
    expect(titleNamesOutsideTown("barcelona", title)).toBe(town);
  });

  it.each([
    "Ball a la Sala Girona",
    "Ballada de sardanes a la plaça de Sarrià",
    "Salsa a Santa Coloma",
  ])("keeps %s in Barcelona", (title) => {
    expect(titleNamesOutsideTown("barcelona", title)).toBeNull();
  });

  it("wires its sources file in, with its retired sources and known venues", () => {
    expect(METRO_SOURCES.barcelona?.length).toBeGreaterThan(0);
    expect(METRO_RETIRED_SOURCES.barcelona?.length).toBe(DICE_GENRES.length - 6 + 13);
    expect(KNOWN_VENUES.barcelona?.length).toBe(25);
  });
});
