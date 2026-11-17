// San Juan is the five municipios (D-460): the Census TIGER outline with its water areas,
// Census barrios with Santurce's subbarrios as neighbourhoods (Who's On First has none for Puerto Rico),
// Puerto Rico addresses, 009 ZIP codes, and the towns around it that source titles name.
// Points are each venue's street address (2026-10-29).
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
import { raSources } from "@/config/sources/ra";
import { SAN_JUAN_RETIRED, SAN_JUAN_SOURCES } from "@/config/sources/san-juan";
import { insideMetro, metroPartAt } from "@/src/domain/metro-bounds";
import sanJuanNeighbourhoods from "@/config/neighbourhoods/san-juan.json";
import { neighbourhoodAt } from "@/src/domain/neighbourhoods";

const SAN_JUAN: Metro = {
  id: "sj",
  slug: "san-juan",
  name: "San Juan",
  countryCode: "US",
  center: { lat: 18.4494, lng: -66.0663 },
  radiusKm: 35,
  tz: "America/Puerto_Rico",
  languages: ["en", "es"],
};

describe("San Juan five municipios (D-460)", () => {
  it.each([
    ["La Factoría, Old San Juan", 18.4656, -66.117, "San Juan", "Old San Juan"],
    ["Condado Vanderbilt", 18.4585, -66.0746, "San Juan", "Condado"],
    ["Coca-Cola Music Hall", 18.4569, -66.0893, "San Juan", "Isla Grande"],
    ["Plaza de Río Piedras", 18.399, -66.05, "San Juan", "Río Piedras"],
    ["Fairmont El San Juan, Isla Verde", 18.444, -66.0193, "Carolina", "Cangrejo Arriba"],
  ])("puts %s inside, in its municipio and neighbourhood", (_name, lat, lng, municipio, hood) => {
    expect(metroPartAt("san-juan", { lat, lng })).toBe(municipio);
    expect(insideMetro(SAN_JUAN, { lat, lng })).toBe(true);
    expect(neighbourhoodAt({ lat, lng })).toBe(hood);
  });

  it("puts Los Almendros' point in Guaynabo", () => {
    expect(metroPartAt("san-juan", { lat: 18.3421385, lng: -66.1048292 })).toBe("Guaynabo");
  });

  it("keeps the water inside (San Juan Bay)", () => {
    expect(insideMetro(SAN_JUAN, { lat: 18.45, lng: -66.1 })).toBe(true);
  });

  it.each([
    ["Loíza town", 18.431, -65.88],
    ["Dorado", 18.459, -66.268],
    ["Piñones", 18.444, -65.96],
    ["Trujillo Alto", 18.354, -66.007],
  ])("leaves %s outside, though its circle reaches it", (_name, lat, lng) => {
    expect(metroPartAt("san-juan", { lat, lng })).toBeNull();
    expect(insideMetro(SAN_JUAN, { lat, lng })).toBe(false);
  });

  it("has 94 neighbourhoods, each name once, and none named San Juan", () => {
    const names = sanJuanNeighbourhoods.neighbourhoods.map((n) => n.name);
    expect(names).toHaveLength(94);
    expect(new Set(names).size).toBe(94);
    expect(names).not.toContain("San Juan");
  });
});

describe("San Juan in the shared tables", () => {
  it("reads Puerto Rico addresses and 009 ZIP codes", () => {
    expect(METRO_REGIONS["san-juan"]).toEqual(["PR"]);
    expect(METRO_POSTCODE_PREFIXES["san-juan"]).toEqual(["009"]);
  });

  it("names the towns around it, and none that is also a San Juan place", () => {
    const towns = METRO_OUTSIDE_TOWNS["san-juan"] ?? [];
    for (const town of [
      "Dorado",
      "Toa Baja",
      "Levittown",
      "Toa Alta",
      "Trujillo Alto",
      "Canóvanas",
      "Piñones",
      "Río Grande",
      "Luquillo",
      "Fajardo",
      "Caguas",
      "Humacao",
      "Arecibo",
      "Mayagüez",
      "Aguadilla",
      "Isabela",
      "Cabo Rojo",
      "Vieques",
      "Culebra",
      "Vega Baja",
      "Manatí",
      "Cayey",
      "Naguabo",
      "Ceiba",
      "Gurabo",
    ]) {
      expect(towns).toContain(town);
    }
    for (const name of [
      "Ponce",
      "Loíza",
      "Rincón",
      "Isla Verde",
      "Condado",
      "Carolina",
      "Bayamón",
      "Guaynabo",
      "Cataño",
    ]) {
      expect(towns).not.toContain(name);
    }
  });

  it.each([
    ["Salsa Night in Dorado", "Dorado"],
    ["Bomba en Calle Loíza", null],
    ["Fiesta en Trujillo Alto", "Trujillo Alto"],
    ["Concierto en Ponce", null],
  ])("takes %s for a night out of town", (title, town) => {
    expect(titleNamesOutsideTown("san-juan", title)).toBe(town);
  });

  it.each([
    "Salsa Night in Condado",
    "Bachata en Río Piedras",
    "Tango en Bayamón",
    "Merengue en Carolina",
  ])("keeps %s in San Juan", (title) => {
    expect(titleNamesOutsideTown("san-juan", title)).toBeNull();
  });

  it("wires its sources, retired addresses and known venues in", () => {
    expect(METRO_SOURCES["san-juan"]).toEqual([...SAN_JUAN_SOURCES, ...raSources("san-juan")]);
    expect(METRO_RETIRED_SOURCES["san-juan"]).toBe(SAN_JUAN_RETIRED);
    expect(KNOWN_VENUES["san-juan"]?.map((v) => v.names[0])).toEqual([
      "Dugout Sport Bar",
      "Dizparate",
      "24 Market Place",
      "Downtown Cupey",
      "Música Bar & Lounge",
      "Liberty Square",
      "Casa BACARDÍ",
      "El Boricua",
      "La Terraza de Bonanza",
      "Los Almendros",
    ]);
  });
});
