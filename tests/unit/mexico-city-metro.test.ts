// Mexico City is Ciudad de México (D-440): the 16 alcaldías outline, IECM colonias over the alcaldías,
// Mexican addresses, 01-16 postal code prefixes, and the towns around it that source titles name.
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
import { MEXICO_CITY_SOURCES } from "@/config/sources/mexico-city";
import { raSources } from "@/config/sources/ra";
import { insideMetro, metroPartAt } from "@/src/domain/metro-bounds";
import { NEIGHBOURHOODS, neighbourhoodAt } from "@/src/domain/neighbourhoods";

const MEXICO_CITY: Metro = {
  id: "mc",
  slug: "mexico-city",
  name: "Mexico City",
  countryCode: "MX",
  center: { lat: 19.4326, lng: -99.1332 },
  radiusKm: 45,
  tz: "America/Mexico_City",
  languages: ["es", "en"],
};

describe("Ciudad de México (D-440)", () => {
  it.each([
    ["Zócalo", 19.4326, -99.1332, "Centro"],
    ["Salón Los Ángeles, Lerdo 206", 19.4497, -99.1436, "Guerrero"],
    ["Mama Rumba, Querétaro 230", 19.41412, -99.16459, "Roma Norte"],
    ["California Dancing Club, Calzada de Tlalpan 1189", 19.37395, -99.14128, "San Simón Ticumac"],
    ["Xochimilco embarcadero", 19.2573, -99.1036, "Xaltocan"],
    ["Santa Fe", 19.359, -99.26, "Lomas de Santa Fe II"],
    ["AICM airport", 19.4361, -99.0719, "Peñón de los Baños"],
    // Ex Fábrica de Harina, Primavera 106: WOF's alcaldía outline put it in Miguel Hidalgo.
    ["Ex Fábrica de Harina, Primavera 106", 19.464177, -99.190468, "Ángel Zimbrón"],
    ["Kartharsis Studio, Mérida 124", 19.418144, -99.157051, "Roma Norte"],
  ])("puts %s inside, in its colonia", (_name, lat, lng, hood) => {
    expect(metroPartAt("mexico-city", { lat, lng })).toBe("Ciudad de México");
    expect(insideMetro(MEXICO_CITY, { lat, lng })).toBe(true);
    expect(neighbourhoodAt({ lat, lng })).toBe(hood);
  });

  it.each([
    ["Ciudad Nezahualcóyotl", 19.4006, -99.0148],
    ["Ciudad Satélite, Naucalpan", 19.509, -99.237],
    ["Tlalnepantla", 19.54, -99.195],
    ["Ecatepec", 19.601, -99.05],
    ["Interlomas, Huixquilucan", 19.396, -99.281],
  ])("leaves %s outside", (_name, lat, lng) => {
    expect(metroPartAt("mexico-city", { lat, lng })).toBeNull();
    expect(insideMetro(MEXICO_CITY, { lat, lng })).toBe(false);
  });

  it("reads 01-16 postal code prefixes and no region entry", () => {
    const prefixes = METRO_POSTCODE_PREFIXES["mexico-city"];
    expect(prefixes).toHaveLength(16);
    for (let i = 1; i <= 16; i++) {
      expect(prefixes).toContain(i.toString().padStart(2, "0"));
    }
    expect(METRO_REGIONS["mexico-city"]).toBeUndefined();
  });

  it("detects outside towns in titles", () => {
    expect(
      titleNamesOutsideTown("mexico-city", "Salsa Nights at Blue Mojito, Nezahualcóyotl"),
    ).toBe("Nezahualcóyotl");
    expect(
      titleNamesOutsideTown("mexico-city", "Weekend Parties at Gran Salón Victoria, Tlalnepantla"),
    ).toBe("Tlalnepantla");
    expect(titleNamesOutsideTown("mexico-city", "Mama Rumba Mexico City: Salsa Nights")).toBeNull();
    expect(titleNamesOutsideTown("mexico-city", "Bachata Feeling at Be Bops Roma")).toBeNull();
  });

  it("keeps the 16 alcaldía names in NEIGHBOURHOODS as the fallback", () => {
    const names = new Set(NEIGHBOURHOODS.map((n) => n.name));
    for (const alcaldia of [
      "Cuauhtémoc",
      "Benito Juárez",
      "Xochimilco",
      "Álvaro Obregón",
      "Venustiano Carranza",
    ]) {
      expect(names.has(alcaldia)).toBe(true);
    }
  });

  it("wires its sources in, with its known venues and its retired addresses", () => {
    expect(METRO_SOURCES["mexico-city"]).toEqual([
      ...MEXICO_CITY_SOURCES,
      ...raSources("mexico-city"),
    ]);
    // D-446: Departamento's agenda is a radio schedule; then six dead feeds discovery switched on (2026-11-01).
    expect(METRO_RETIRED_SOURCES["mexico-city"]?.map((r) => r.url)).toEqual([
      "https://www.vteatro.com/",
      "https://depa.radio/agenda",
      "http://www.elduxdevenecia.com",
      "https://gentedemezcal.com/en/",
      "https://www.centrodidacticocultural.mx/",
      "https://cultura.uam.mx/",
      "https://foro.engranica.com/",
      "https://mc.jpf.go.jp/",
    ]);
    // D-443: Salón Los Ángeles, placed from its own footer.
    expect(KNOWN_VENUES["mexico-city"]?.map((v) => v.address)).toContain(
      "Lerdo 206, Guerrero, 06300 Ciudad de México",
    );
  });
});
