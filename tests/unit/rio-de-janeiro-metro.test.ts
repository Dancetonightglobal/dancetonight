// Rio de Janeiro is the municipalities of Rio de Janeiro and Niterói (D-420): IBGE 2024 outlines plus 250 m of
// water, the city of Rio's 167 official bairros (none yet for Niterói), RJ addresses, Rio and Niterói CEP
// prefixes, and the towns around it that source titles name. Points are each venue's street address (2026-10-29).
import { describe, expect, it } from "vitest";

import type { Metro } from "@/src/adapters/types";
import {
  COUNTRY_REGIONS,
  METRO_OUTSIDE_TOWNS,
  METRO_POSTCODE_PREFIXES,
  METRO_REGIONS,
  titleNamesOutsideTown,
} from "@/config/metro-regions";
import { KNOWN_VENUES } from "@/config/known-venues";
import { METRO_RETIRED_SOURCES, METRO_SOURCES } from "@/config/sources";
import { raSources } from "@/config/sources/ra";
import { RIO_DE_JANEIRO_RETIRED, RIO_DE_JANEIRO_SOURCES } from "@/config/sources/rio-de-janeiro";
import { insideMetro, metroPartAt } from "@/src/domain/metro-bounds";
import { NEIGHBOURHOODS, neighbourhoodAt } from "@/src/domain/neighbourhoods";

const RIO: Metro = {
  id: "m",
  slug: "rio-de-janeiro",
  name: "Rio de Janeiro",
  countryCode: "BR",
  center: { lat: -22.9128, lng: -43.18 },
  radiusKm: 65,
  tz: "America/Sao_Paulo",
  languages: ["pt"],
};

describe("Rio de Janeiro and Niterói (D-420)", () => {
  it.each([
    ["Rio Scenarium, Rua do Lavradio 20", -22.9087, -43.1824, "Centro"],
    ["Circo Voador, Rua dos Arcos", -22.9137, -43.1795, "Lapa"],
    ["Copacabana Palace, Av. Atlântica 1702", -22.9671, -43.1787, "Copacabana"],
    ["Cidade das Artes, Av. das Américas 5300", -22.9997, -43.3657, "Barra da Tijuca"],
    ["Praça Saens Peña", -22.9244, -43.2325, "Tijuca"],
    ["Largo do Guimarães", -22.9198, -43.1863, "Santa Teresa"],
    ["Pedra do Sal", -22.8975, -43.1866, "Saúde"],
    [
      "Feira de São Cristóvão (the bairro's official name)",
      -22.8977,
      -43.2213,
      "Imperial de São Cristóvão",
    ],
  ])("puts %s inside, in its bairro", (_name, lat, lng, hood) => {
    expect(metroPartAt("rio-de-janeiro", { lat, lng })).toBe("Rio de Janeiro");
    expect(insideMetro(RIO, { lat, lng })).toBe(true);
    expect(neighbourhoodAt({ lat, lng })).toBe(hood);
  });

  it.each([
    ["MAC Niterói", -22.9078, -43.1257],
    ["Icaraí beach", -22.905, -43.11],
  ])("puts %s inside, in Niterói", (_name, lat, lng) => {
    expect(metroPartAt("rio-de-janeiro", { lat, lng })).toBe("Niterói");
    expect(insideMetro(RIO, { lat, lng })).toBe(true);
  });

  it.each([
    ["Píer Mauá", -22.8946, -43.1806],
    ["Marina da Glória", -22.9196, -43.17],
    ["Paquetá", -22.762, -43.108],
  ])("keeps %s inside (water and islands)", (_name, lat, lng) => {
    expect(insideMetro(RIO, { lat, lng })).toBe(true);
  });

  it.each([
    ["São Gonçalo", -22.8268, -43.0539],
    ["Duque de Caxias", -22.7856, -43.3117],
    ["Nova Iguaçu", -22.7592, -43.4511],
    ["Itaguaí", -22.8636, -43.7753],
    ["Maricá", -22.9194, -42.8186],
  ])("leaves %s outside, though its circle reaches it", (_name, lat, lng) => {
    expect(metroPartAt("rio-de-janeiro", { lat, lng })).toBeNull();
    expect(insideMetro(RIO, { lat, lng })).toBe(false);
  });

  it("names the city's official bairros", () => {
    const names = new Set(NEIGHBOURHOODS.map((n) => n.name));
    for (const bairro of [
      "Botafogo",
      "Ipanema",
      "Leblon",
      "Laranjeiras",
      "Campo Grande",
      "Madureira",
    ]) {
      expect(names.has(bairro)).toBe(true);
    }
  });
});

describe("Rio de Janeiro in the shared tables", () => {
  it("reads RJ addresses and Rio and Niterói CEPs", () => {
    expect(METRO_REGIONS["rio-de-janeiro"]).toEqual(["RJ"]);
    expect(COUNTRY_REGIONS.BR).toContainEqual(["RJ", "Rio de Janeiro"]);
    expect(COUNTRY_REGIONS.BR).toHaveLength(27);
    const prefixes = METRO_POSTCODE_PREFIXES["rio-de-janeiro"] ?? [];
    const inside = (cep: string) => prefixes.some((p) => cep.startsWith(p));
    // Rio Scenarium 20230-070, Copacabana 22070-001, Barra 22640-102, Santa Cruz 23510-000, Niterói 24220-031.
    for (const cep of ["20230070", "22070", "22640102", "23510000", "24220031"])
      expect(inside(cep)).toBe(true);
    // Itaguaí 23815-000, São Gonçalo 24440-000, Duque de Caxias 25010-000, São Paulo 01310-100.
    for (const cep of ["23815000", "24440", "25010000", "01310100"])
      expect(inside(cep)).toBe(false);
  });

  it("names the towns around it, and none that is also a Rio place or a common word", () => {
    const towns = METRO_OUTSIDE_TOWNS["rio-de-janeiro"] ?? [];
    for (const town of [
      "São Gonçalo",
      "Sao Goncalo",
      "Duque de Caxias",
      "Petrópolis",
      "Búzios",
      "São Paulo",
    ]) {
      expect(towns).toContain(town);
    }
    for (const name of [
      "Niterói",
      "Campo Grande",
      "Santa Cruz",
      "Natal",
      "Vitória",
      "Fortaleza",
      "Recife",
    ]) {
      expect(towns).not.toContain(name);
    }
  });

  it.each([
    ["Baile de Forró em São Gonçalo", "São Gonçalo"],
    ["SAMBA NA PRAÇA - NOVA IGUAÇU", "Nova Iguaçu"],
    ["Gafieira Paulistana: turnê São Paulo", "São Paulo"],
  ])("takes %s for a night out of town", (title, town) => {
    expect(titleNamesOutsideTown("rio-de-janeiro", title)).toBe(town);
  });

  it.each(["Baile de Natal na Gafieira", "Forró da Vitória", "Roda de Samba em Campo Grande"])(
    "keeps %s in Rio",
    (title) => {
      expect(titleNamesOutsideTown("rio-de-janeiro", title)).toBeNull();
    },
  );

  it("wires its sources, retired addresses and known venues in", () => {
    expect(METRO_SOURCES["rio-de-janeiro"]).toEqual([
      ...RIO_DE_JANEIRO_SOURCES,
      ...raSources("rio-de-janeiro"),
    ]);
    expect(METRO_RETIRED_SOURCES["rio-de-janeiro"]).toBe(RIO_DE_JANEIRO_RETIRED);
    // Bip Bip: Mapa do Samba's geo is in Botafogo; the checked point is its Copacabana door (OSM, 2026-10-31).
    // Clube dos Democráticos: the geocoder gives Rua do Riachuelo 91 low confidence; point from Buser (2026-11-02).
    expect(KNOWN_VENUES["rio-de-janeiro"]!.map((v) => v.names[0])).toEqual([
      "Bip Bip",
      "Clube dos Democráticos",
    ]);
    expect(KNOWN_VENUES["rio-de-janeiro"]![0]!.point).toEqual({ lat: -22.979849, lng: -43.190506 });
    expect(KNOWN_VENUES["rio-de-janeiro"]![1]!.point).toEqual({
      lat: -22.9144483,
      lng: -43.1832826,
    });
    expect(KNOWN_VENUES["rio-de-janeiro"]![1]!.streets).toEqual(["Rua do Riachuelo, 91"]);
  });
});
