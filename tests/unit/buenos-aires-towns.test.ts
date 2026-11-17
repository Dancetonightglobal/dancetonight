// Buenos Aires (D-400) in the shared tables: CABA postcodes (CPA C..., old 1000-1499), the Greater Buenos Aires
// towns that source titles name, and no province check, because the provinces are CABA street names (2026-10-29).
import { describe, expect, it } from "vitest";

import type { Metro } from "@/src/adapters/types";
import {
  COUNTRY_REGIONS,
  METRO_OUTSIDE_TOWNS,
  METRO_REGIONS,
  titleNamesOutsideTown,
} from "@/config/metro-regions";
import { postcodeOutsideMetro } from "@/src/pipeline/geocode";

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

describe("Buenos Aires in the shared tables (D-400)", () => {
  it("has no province check: the provinces are CABA streets", () => {
    expect(METRO_REGIONS["buenos-aires"]).toBeUndefined();
    expect(COUNTRY_REGIONS.AR).toBeUndefined();
  });

  it.each([
    "Av. Corrientes 1234, C1043AAZ CABA",
    "Riobamba 345 (1025) Capital Federal",
    "Gascón 1180, CP 1181",
  ])("keeps the CABA postcode in %s", (address) => {
    expect(postcodeOutsideMetro(address, BUENOS_AIRES)).toBeNull();
  });

  it.each([
    ["Av. Maipú 2500, B1636AAR Olivos", "postcode B1636AAR"],
    ["Mitre 750 (1870) Avellaneda", "postcode 1870"],
  ])("takes %s for outside CABA", (address, outside) => {
    expect(postcodeOutsideMetro(address, BUENOS_AIRES)).toBe(outside);
  });

  it("keeps an address with no postcode", () => {
    expect(postcodeOutsideMetro("Av. Corrientes 1414, CABA", BUENOS_AIRES)).toBeNull();
  });

  it("names the towns around it, and none that is also a CABA street", () => {
    const towns = METRO_OUTSIDE_TOWNS["buenos-aires"] ?? [];
    for (const town of [
      "Banfield",
      "Ingeniero Maschwitz",
      "Luis Guillón",
      "Adrogué",
      "Adrogue",
      "Hurlingham",
    ]) {
      expect(towns).toContain(town);
    }
    for (const name of [
      "Olivos",
      "Castelar",
      "Haedo",
      "Caseros",
      "Morón",
      "Lanús",
      "San Martín",
      "Vicente López",
      "Lomas de Zamora",
      "Avellaneda",
      "Quilmes",
      "La Plata",
      "Montevideo",
      "Córdoba",
      "Rosario",
    ]) {
      expect(towns).not.toContain(name);
    }
  });

  it.each([
    ["Milonga La Glorieta de Banfield", "Banfield"],
    ["Práctica en Ingeniero Maschwitz", "Ingeniero Maschwitz"],
    ["Milonga del Sur (Luis Guillón)", "Luis Guillón"],
    ["Tango en Adrogue", "Adrogue"],
  ])("takes %s for a night out of town", (title, town) => {
    expect(titleNamesOutsideTown("buenos-aires", title)).toBe(town);
  });

  it.each([
    "La Viruta Tango Club",
    "Milonga en Av. Córdoba",
    "Salsa en Palermo",
    "Práctica Morón y Caseros",
  ])("keeps %s in Buenos Aires", (title) => {
    expect(titleNamesOutsideTown("buenos-aires", title)).toBeNull();
  });
});
