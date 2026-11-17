// Buenos Aires is the Ciudad Autónoma de Buenos Aires (CABA): the 48 official barrios with Puerto Madero's docks and a Río de la Plata strip,
// and the city's own barrio outlines (BA Data, CC BY 2.5 AR). Points are each venue's street address (2026-10-29).
import { describe, expect, it } from "vitest";

import type { Metro } from "@/src/adapters/types";
import { KNOWN_VENUES } from "@/config/known-venues";
import { METRO_RETIRED_SOURCES, METRO_SOURCES } from "@/config/sources";
import { raSources } from "@/config/sources/ra";
import { BUENOS_AIRES_RETIRED, BUENOS_AIRES_SOURCES } from "@/config/sources/buenos-aires";
import { insideMetro, metroPartAt } from "@/src/domain/metro-bounds";
import barriosFile from "@/config/neighbourhoods/buenos-aires.json";
import { NEIGHBOURHOODS, neighbourhoodAt } from "@/src/domain/neighbourhoods";

const BUENOS_AIRES: Metro = {
  id: "ba",
  slug: "buenos-aires",
  name: "Buenos Aires",
  countryCode: "AR",
  center: { lat: -34.6037, lng: -58.3816 },
  radiusKm: 25,
  tz: "America/Argentina/Buenos_Aires",
  languages: ["es", "en"],
};

describe("Ciudad Autónoma de Buenos Aires (D-400)", () => {
  it.each([
    ["Obelisco", -34.6037, -58.3816, "San Nicolás"],
    ["Salón Canning", -34.5918, -58.4251, "Palermo"],
    ["Confitería Ideal", -34.6049, -58.3767, "San Nicolás"],
    ["Club Gricel", -34.6243, -58.4053, "San Cristóbal"],
    ["Aeroparque Jorge Newbery", -34.5592, -58.4158, "Palermo"],
  ])("puts %s inside, in its neighbourhood", (_name, lat, lng, hood) => {
    expect(metroPartAt("buenos-aires", { lat, lng })).toBe("Ciudad Autónoma de Buenos Aires");
    expect(insideMetro(BUENOS_AIRES, { lat, lng })).toBe(true);
    expect(neighbourhoodAt({ lat, lng })).toBe(hood);
  });

  it.each([
    ["the Río de la Plata off the Costanera", -34.55, -58.4],
    ["Punta Carrasco on the Costanera", -34.556, -58.404],
    ["Puerto Madero's Dique 3", -34.6085, -58.3645],
  ])("keeps %s inside (water and docks count, D-085)", (_name, lat, lng) => {
    expect(insideMetro(BUENOS_AIRES, { lat, lng })).toBe(true);
  });

  it.each([
    ["Olivos", -34.51, -58.487],
    ["Vicente López shore", -34.523, -58.47],
    ["Dock Sud", -34.648, -58.345],
    ["Avellaneda", -34.663, -58.365],
  ])("leaves %s outside, though its circle reaches it", (_name, lat, lng) => {
    expect(metroPartAt("buenos-aires", { lat, lng })).toBeNull();
    expect(insideMetro(BUENOS_AIRES, { lat, lng })).toBe(false);
  });

  it("has the 48 official barrios, with their accents", () => {
    const barrios = barriosFile.neighbourhoods;
    expect(barrios).toHaveLength(48);
    const names = new Set(barrios.map((n) => n.name));
    // By entry, not name: other metros have barrios of the same name (Mexico City's San Cristóbal).
    expect(
      NEIGHBOURHOODS.filter((n) => (barrios as ReadonlyArray<unknown>).includes(n)),
    ).toHaveLength(48);
    expect(names.has("Buenos Aires")).toBe(false);
    for (const name of [
      "Palermo",
      "San Telmo",
      "Núñez",
      "Agronomía",
      "Villa General Mitre",
      "Monserrat",
    ]) {
      expect(names.has(name)).toBe(true);
    }
  });

  it("wires its sources, retired addresses and known venues in", () => {
    expect(METRO_SOURCES["buenos-aires"]).toEqual([
      ...BUENOS_AIRES_SOURCES,
      ...raSources("buenos-aires"),
    ]);
    expect(METRO_RETIRED_SOURCES["buenos-aires"]).toBe(BUENOS_AIRES_RETIRED);
    const known = KNOWN_VENUES["buenos-aires"] ?? [];
    expect(known.slice(0, 3).map((v) => v.names[0])).toEqual(["Club Gricel", "El Beso", "Crobar"]);
    // The Mapa Milonguero's venues (D-403): 35 more, each with a checked point and the adapter's address;
    // La Salsera and La Práctica Folklórica (D-750).
    expect(known).toHaveLength(40);
    for (const venue of known.slice(3)) {
      expect(venue.point, venue.names[0]).toBeDefined();
      expect(venue.address, venue.names[0]).toMatch(/, CABA$/);
    }
  });
});
