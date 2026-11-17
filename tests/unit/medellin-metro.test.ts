// Medellín is the 10 municipalities of the Área Metropolitana del Valle de Aburrá (D-640): the DANE MGN 2025 outline,
// CNMH barrios and comunas as neighbourhoods, Colombian 6-digit postcodes, and the towns around it that source titles name.
// Points are each venue's street address (2026-10-31).
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
import { MEDELLIN_RETIRED, MEDELLIN_SOURCES } from "@/config/sources/medellin";
import { insideMetro, metroPartAt } from "@/src/domain/metro-bounds";
import medellinNeighbourhoods from "@/config/neighbourhoods/medellin.json";
import { neighbourhoodAt } from "@/src/domain/neighbourhoods";

const MEDELLIN: Metro = {
  id: "md",
  slug: "medellin",
  name: "Medellín",
  countryCode: "CO",
  center: { lat: 6.2502, lng: -75.5688 },
  radiusKm: 40,
  tz: "America/Bogota",
  languages: ["es", "en"],
};

describe("Medellín ten municipalities (D-640)", () => {
  it.each([
    ["Parque Berrío", 6.2502, -75.5688, "Medellín", "La Candelaria"],
    ["Parque Lleras", 6.2087, -75.5676, "Medellín", "El Poblado"],
    ["El Tibiri", 6.2507, -75.5893, "Medellín", "Florida Nueva"],
    ["Salón Málaga", 6.2458, -75.5703, "Medellín", "Guayaquil"],
    ["Parque de Envigado", 6.171, -75.5866, "Envigado", "Envigado"],
    ["Parque de Sabaneta", 6.1515, -75.6163, "Sabaneta", "Sabaneta"],
    ["Parque de Itagüí", 6.172, -75.6112, "Itagüí", "Itagüí"],
  ])(
    "puts %s inside, in its municipality and neighbourhood",
    (_name, lat, lng, municipio, hood) => {
      expect(metroPartAt("medellin", { lat, lng })).toBe(municipio);
      expect(insideMetro(MEDELLIN, { lat, lng })).toBe(true);
      expect(neighbourhoodAt({ lat, lng })).toBe(hood);
    },
  );

  it("keeps the water inside (Río Medellín)", () => {
    expect(insideMetro(MEDELLIN, { lat: 6.25, lng: -75.57 })).toBe(true);
  });

  it.each([
    ["Rionegro town", 6.1551, -75.3737],
    ["Bogotá", 4.711, -74.0721],
  ])("leaves %s outside, though its circle reaches it", (_name, lat, lng) => {
    expect(metroPartAt("medellin", { lat, lng })).toBeNull();
    expect(insideMetro(MEDELLIN, { lat, lng })).toBe(false);
  });

  it("has 284 neighbourhoods, each name once", () => {
    const names = medellinNeighbourhoods.neighbourhoods.map((n) => n.name);
    expect(names).toHaveLength(284);
    expect(new Set(names).size).toBe(284);
  });
});

describe("Medellín in the shared tables", () => {
  it("reads Antioquia (05) postcode prefixes", () => {
    expect(METRO_POSTCODE_PREFIXES["medellin"]).toEqual(["05"]);
  });

  it("names the towns around it, and none that is also a Medellín place", () => {
    const towns = METRO_OUTSIDE_TOWNS["medellin"] ?? [];
    for (const town of [
      "Rionegro",
      "Llanogrande",
      "Guarne",
      "Marinilla",
      "La Ceja",
      "El Retiro",
      "Santa Fe de Antioquia",
      "San Jerónimo",
      "Guatapé",
      "El Peñol",
      "Jericó",
      "El Carmen de Viboral",
      "San Pedro de los Milagros",
      "Amagá",
      "Bogotá",
      "Cali",
      "Cartagena",
      "Barranquilla",
      "Pereira",
      "Manizales",
      "Bucaramanga",
      "Santa Marta",
      "Armenia",
    ]) {
      expect(towns).toContain(town);
    }
    for (const name of [
      "Belén",
      "Santa Elena",
      "San Antonio de Prado",
      "San Cristóbal",
      "Palmitas",
      "Altavista",
      "Jardín",
      "Caldas",
      "Medellín",
      "Bello",
      "Itagüí",
      "Envigado",
      "Sabaneta",
      "La Estrella",
      "Copacabana",
      "Girardota",
      "Barbosa",
    ]) {
      expect(towns).not.toContain(name);
    }
  });

  it.each([
    ["Salsa Night in Rionegro", "Rionegro"],
    ["Bachata en Guatapé", "Guatapé"],
    ["Fiesta en Bogotá", "Bogotá"],
    ["Concierto en Cali", "Cali"],
  ])("takes %s for a night out of town", (title, town) => {
    expect(titleNamesOutsideTown("medellin", title)).toBe(town);
  });

  it.each([
    "Salsa Night in Laureles",
    "Bachata en El Poblado",
    "Tango en Envigado",
    "Merengue en Bello",
  ])("keeps %s in Medellín", (title) => {
    expect(titleNamesOutsideTown("medellin", title)).toBeNull();
  });

  it("wires its sources, retired addresses and known venues in", () => {
    expect(METRO_SOURCES["medellin"]).toEqual([...MEDELLIN_SOURCES, ...raSources("medellin")]);
    expect(METRO_RETIRED_SOURCES["medellin"]).toBe(MEDELLIN_RETIRED);
    expect(KNOWN_VENUES["medellin"]?.map((venue) => venue.names[0])).toEqual(["Rama Soundgarden"]);
  });

  it("has a Resident Advisor source for area 374", () => {
    const ra = raSources("medellin");
    expect(ra).toHaveLength(1);
    expect(ra[0]?.platform).toBe("ra");
    expect(ra[0]?.label).toBe("Resident Advisor Medellín");
  });
});
