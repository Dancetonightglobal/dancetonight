// Lisbon is the Área Metropolitana de Lisboa (D-380): the 18 municipalities from DGT's CAOP2025 (CC BY 4.0),
// the river between Lisbon and Almada inside; the City of Lisbon's 24 parishes and the other 17 towns by name
// as neighbourhoods; CTT postcodes 1xxx and 26xx-29xx; and the towns around it that listings name. Points are
// each venue's street address (2026-10-29).
import { describe, expect, it } from "vitest";

import type { Metro, HarvestedListing } from "@/src/adapters/types";
import { rawListingSchema } from "@/src/domain/listing";
import { withTitleVenue } from "@/src/pipeline/source-venue";
import { raSources } from "@/config/sources/ra";
import {
  METRO_OUTSIDE_TOWNS,
  METRO_POSTCODE_PREFIXES,
  titleNamesOutsideTown,
} from "@/config/metro-regions";
import { KNOWN_VENUES } from "@/config/known-venues";
import { METRO_RETIRED_SOURCES, METRO_SOURCES } from "@/config/sources";
import { insideMetro } from "@/src/domain/metro-bounds";
import { NEIGHBOURHOODS, neighbourhoodAt } from "@/src/domain/neighbourhoods";

const LISBON: Metro = {
  id: "m",
  slug: "lisbon",
  name: "Lisbon",
  countryCode: "PT",
  center: { lat: 38.7076, lng: -9.1365 },
  radiusKm: 60,
  tz: "Europe/Lisbon",
  languages: ["pt", "en"],
};

describe("the Lisbon Metropolitan Area (D-380)", () => {
  it.each([
    ["B.Leza, Cais do Gás, Cais do Sodré", 38.7062, -9.1468, "Misericórdia"],
    ["Barrio Latino, Santos", 38.7067, -9.156, "Estrela"],
    ["Lux Frágil, Santa Apolónia", 38.7146, -9.1222, "São Vicente"],
    ["LX Factory, Alcântara", 38.7033, -9.1786, "Alcântara"],
    ["Praça do Comércio", 38.7076, -9.1365, "Santa Maria Maior"],
    ["Cacilhas, Almada", 38.687, -9.148, "Almada"],
    ["Cascais centre", 38.697, -9.421, "Cascais"],
    ["Ericeira", 38.963, -9.417, "Mafra"],
    ["Setúbal centre", 38.524, -8.893, "Setúbal"],
  ])("puts %s inside, in its parish or town", (_name, lat, lng, hood) => {
    expect(insideMetro(LISBON, { lat, lng })).toBe(true);
    expect(neighbourhoodAt({ lat, lng })).toBe(hood);
  });

  it("keeps the river between Lisbon and Almada inside", () => {
    expect(insideMetro(LISBON, { lat: 38.7, lng: -9.15 })).toBe(true);
  });

  it.each([
    ["Torres Vedras", 39.0911, -9.2586],
    ["Arruda dos Vinhos", 38.9842, -9.0778],
    ["Benavente", 38.9813, -8.8099],
  ])("leaves %s outside, though its circle reaches it", (_name, lat, lng) => {
    expect(insideMetro(LISBON, { lat, lng })).toBe(false);
  });

  it("names parishes inside the city and towns outside it, never the long merged parish names", () => {
    const names = new Set(NEIGHBOURHOODS.map((n) => n.name));
    for (const name of [
      "Misericórdia",
      "Arroios",
      "Parque das Nações",
      "Almada",
      "Sintra",
      "Oeiras",
    ]) {
      expect(names.has(name)).toBe(true);
    }
    expect(names.has("Lisboa")).toBe(false);
    expect([...names].some((name) => name.startsWith("União das freguesias"))).toBe(false);
  });
});

describe("Lisbon RA title venues (D-519 D1)", () => {
  it("includes Pensão Amor in known venues", () => {
    const pensao = KNOWN_VENUES.lisbon?.find((v) => v.names.includes("Pensão Amor"));
    expect(pensao).toBeDefined();
    expect(pensao?.point).toEqual({ lat: 38.7072647, lng: -9.1437283 });
  });

  it("raSources for lisbon has titleVenues mapping", () => {
    const source = raSources("lisbon")[0];
    expect(source?.titleVenues).toEqual({ "at Pensão Amor": "Pensão Amor" });
  });

  it("raSources for london has no titleVenues", () => {
    const source = raSources("london")[0];
    expect("titleVenues" in (source ?? {})).toBe(false);
  });

  it("fills venue name from RA title phrase", () => {
    // Helper copied from title-venues.test.ts
    function makeListing(
      title: string,
      venue: { name?: string | null; address?: string | null },
      venueLocation?: { lat: number; lng: number } | null,
    ): HarvestedListing {
      const raw = rawListingSchema.parse({
        title,
        listing_type: "social",
        styles: ["salsa"],
        local_date: "2026-10-11",
        doors_time: "20:00",
        venue: {
          name: venue.name ?? null,
          address: venue.address ?? null,
          url: null,
        },
        organizer: { name: null, url: null },
      });
      return {
        listing: raw,
        externalId: "test:1",
        tz: "Europe/Lisbon",
        venueLocation: venueLocation ?? null,
        recurrence: null,
        provenance: {
          sourceUrl: "https://example.com",
          fetchedAt: new Date(),
          method: "feed",
        },
      };
    }

    const listing = makeListing("João Melgueira ~ at Pensão Amor", { name: null, address: null });
    const source = raSources("lisbon")[0];
    const result = withTitleVenue(listing, source?.titleVenues);
    expect(result.listing.venue.name).toBe("Pensão Amor");
  });
});

describe("Lisbon in the shared tables", () => {
  it("reads CTT postcodes 1xxx and 26xx-29xx", () => {
    expect(METRO_POSTCODE_PREFIXES.lisbon).toEqual(["1", "26", "27", "28", "29"]);
  });

  it("names the towns around it, and none that is also a word or a place inside", () => {
    const towns = METRO_OUTSIDE_TOWNS.lisbon ?? [];
    for (const town of ["Coimbra", "Torres Vedras", "Comporta", "Algarve", "Évora"]) {
      expect(towns).toContain(town);
    }
    for (const name of [
      "Porto",
      "Madeira",
      "Alentejo",
      "Sintra",
      "Ericeira",
      "Setúbal",
      "Cascais",
    ]) {
      expect(towns).not.toContain(name);
    }
  });

  it.each([
    ["Kizomba Weekend Coimbra 2026", "Coimbra"],
    ["Sunset Party na Comporta", "Comporta"],
    ["Bachata Night Torres Vedras", "Torres Vedras"],
  ])("takes %s for a night out of town", (title, town) => {
    expect(titleNamesOutsideTown("lisbon", title)).toBe(town);
  });

  it.each([
    "Sunset DJ & Porto Tonic Premium Boat Experience",
    "Baile na Casa do Alentejo",
    "Kizomba Social Cascais",
  ])("keeps %s in Lisbon", (title) => {
    expect(titleNamesOutsideTown("lisbon", title)).toBeNull();
  });

  it("wires its sources in, its retired addresses and its known venues", () => {
    expect(METRO_SOURCES.lisbon?.length).toBeGreaterThan(0);
    const retired = METRO_RETIRED_SOURCES.lisbon?.map((r) => r.url) ?? [];
    expect(retired).not.toContain("https://www.eventbrite.pt/o/51891766343");
    expect(METRO_SOURCES.lisbon?.map((s) => s.url)).toContain(
      "https://www.eventbrite.pt/o/51891766343",
    );
    expect(retired.length).toBe(41);
    expect(retired).toContain("https://cocktailteam.net/agenda-de-cursos/");
    expect(retired[0]).toBe(
      "https://www.timeout.com/time-out-market-lisboa/things-to-do/samba-de-gafieira",
    );
    expect(retired).toContain(
      "https://dice.fm/browse/lisbon-5db997662b6fd8302bc10d91/music/party/salsa",
    );
    const dice = (METRO_SOURCES.lisbon ?? [])
      .filter((s) => s.platform === "dice")
      .map((s) => s.url);
    expect(dice).toContain(
      "https://dice.fm/browse/lisbon-5db997662b6fd8302bc10d91/music/dj/techno",
    );
    expect(dice).not.toContain(
      "https://dice.fm/browse/lisbon-5db997662b6fd8302bc10d91/music/dj/latin",
    );
    expect(dice.length).toBe(9);
    expect(KNOWN_VENUES.lisbon?.map((v) => v.address)).toEqual([
      "Largo da Luz 2, 1600-498 Lisboa",
      "Av. 24 de Julho 49, 1200-479 Lisboa",
      "Cais do Gás 1, Lisboa",
      "Rua Maria 73, Lisboa",
      "Rua do Diário de Notícias 59, Lisboa",
      "Rua Júlio de Andrade 3, Lisboa",
      "Rua José Pinheiro de Melo 60, Lisboa",
      "Avenida de Brasília 254, 1200-676 Lisboa",
      "Doca de Santo Amaro, Armazém 1, 1350-353 Lisboa",
      "Rua da Fábrica de Material de Guerra 1, 1950-128 Lisboa",
      "Largo Júlio de Castilho 3, 1600-483 Lisboa",
      "Campus de Campolide, Rua de Campolide, 1070-124 Lisboa",
      "Avenida da Liberdade, 2830-248 Barreiro",
      "Largo José Saramago, 1100-016 Lisboa",
      "Rua Sousa Lopes 12B, Loja 33, 1600-207 Lisboa",
      "Largo do Intendente Pina Manique 45, 1100-285 Lisboa",
      "Rua da Imprensa Nacional 104B, 1250-127 Lisboa",
      "Rua da Cintura do Porto de Lisboa, 1200-109 Lisboa",
      "Calçada do Desterro 7, 1100-089 Lisboa",
      "Rua de Santa Apolónia 59, 1100-468 Lisboa",
      "Rua da Penha de França 77, 1170-034 Lisboa",
      "Rua da Praia de Pedrouços 76, 1400-282 Lisboa",
      "Rua Júlio Moreira 5, 2775-562 Carcavelos",
      "Largo das Fontaínhas 19, 1300-501 Lisboa",
      "Rua Alves Torgo 37, 1000-034 Lisboa",
      "Largo de Santos 2, 1200-808 Lisboa",
      "Rua Flores do Lima 8A, 1700-196 Lisboa",
      "Rua de Cabo Verde 17A, 1170-203 Lisboa",
      "Avenida dos Bombeiros Voluntários, 2600-098 Vila Franca de Xira",
      "Estrada dos Álamos 402, 2810-144 Almada",
      "Rua do Alecrim 19, 1200-292 Lisboa",
      "Avenida Infante Dom Henrique, Armazéns 8 e 9, 1900-320 Lisboa",
    ]);
  });
});
