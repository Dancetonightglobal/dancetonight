import { describe, it, expect } from "vitest";
import type { Metro } from "@/src/adapters/types";
import {
  agendaToListings,
  detailFromHtml,
  rowsNeedingDetail,
  extractTownFromText,
} from "./agendadeltango";
import bcnData from "./__fixtures__/agendadeltango-bcn.json";
import { readFileSync } from "fs";
import { join } from "path";

describe("agendadeltango adapter", () => {
  const metro: Metro = {
    id: "barcelona",
    name: "Barcelona",
    languages: ["ca", "es", "en"],
    slug: "barcelona",
    tz: "Europe/Madrid",
    center: { lat: 41.3851, lng: 2.1734 },
    radiusKm: 30,
    countryCode: "ES",
  };

  const nights = [
    "2026-10-29",
    "2026-10-30",
    "2026-10-31",
    "2026-11-01",
    "2026-11-02",
    "2026-11-03",
    "2026-11-04",
  ];

  const fetchedAt = new Date("2026-10-29T12:00:00Z");

  it("extracts dance events in Barcelona metro", () => {
    const livingTangoHtml = readFileSync(
      join(__dirname, "__fixtures__", "agendadeltango-living-tango.html"),
      "utf-8",
    );
    const detail = detailFromHtml(livingTangoHtml);
    expect(detail).toEqual({
      locality: "Barcelona",
      street: "Calle Pallars 65-71, Ático 4",
    });

    const detailLookup = new Map();
    detailLookup.set(
      "https://agendadeltango.com/milongas/living-tango-barcelona/2026-10-31/",
      detail,
    );

    const { listings, notes } = agendaToListings(bcnData, {
      metro,
      nights,
      fetchedAt,
      detailLookup,
      detailFetchCount: 1,
    });

    expect(notes.some((n) => n.includes("agendadeltango:"))).toBe(true);
    expect(notes).toEqual(
      expect.arrayContaining([
        expect.stringMatching(
          /agendadeltango: \d+ events, \d+ dance, \d+ listings for the nights, 1 detail pages/,
        ),
      ]),
    );

    // Should have Casa Valencia, La Morocha, C/ Pallars, Living Tango
    expect(listings).toHaveLength(4);

    // Casa Valencia
    const casaValencia = listings.find(
      (l) => l.externalId === "agendadeltango:2026-10-29-milonga-e359",
    );
    expect(casaValencia).toBeDefined();
    expect(casaValencia?.listing.title).toBe("Milonga Casa Valencia");
    expect(casaValencia?.listing.listing_type).toBe("social");
    expect(casaValencia?.listing.styles).toEqual(["milonga"]);
    expect(casaValencia?.listing.doors_time).toBe("21:30");
    expect(casaValencia?.listing.venue.name).toBe("Casa de Valencia");
    expect(casaValencia?.listing.venue.address).toMatch(/08037/);
    expect(casaValencia?.listing.venue.address).toMatch(/, barcelona$/i);
    expect(casaValencia?.eventUrl).toBe(
      "https://agendadeltango.com/milongas/milonga-casa-valencia/2026-10-29/",
    );

    // La Morocha
    const laMorocha = listings.find(
      (l) => l.externalId === "agendadeltango:2026-10-30-milonga-e350",
    );
    expect(laMorocha).toBeDefined();
    expect(laMorocha?.listing.title).toBe("La Morocha Milonga");
    expect(laMorocha?.listing.listing_type).toBe("social");
    expect(laMorocha?.listing.styles).toEqual(["milonga"]);

    // C/ Pallars (no URL, town extracted from text)
    const pallars = listings.find((l) => l.externalId === "agendadeltango:2026-11-04-milonga-m217");
    expect(pallars).toBeDefined();
    expect(pallars?.listing.title).toBe("La Tanguería");
    expect(pallars?.listing.venue.address).toMatch(/, barcelona$/i);

    // Living Tango (via detail lookup)
    const livingTango = listings.find(
      (l) => l.externalId === "agendadeltango:2026-10-31-milonga-e361",
    );
    expect(livingTango).toBeDefined();
    expect(livingTango?.listing.title).toBe("Living Tango Barcelona");
    expect(livingTango?.listing.venue.address).toMatch(/barcelona$/i);
  });

  it("filters out non-dance events", () => {
    const { listings } = agendaToListings(bcnData, {
      metro,
      nights,
      fetchedAt,
    });

    const concert = listings.find((l) => l.externalId?.includes("concierto"));
    expect(concert).toBeUndefined();
  });

  it("filters out events outside Barcelona metro", () => {
    const { listings } = agendaToListings(bcnData, {
      metro,
      nights,
      fetchedAt,
    });

    const lleida = listings.find((l) => l.externalId?.includes("2026-10-29-milonga-m55"));
    expect(lleida).toBeUndefined();

    const blanes = listings.find((l) => l.externalId?.includes("2026-10-29-milonga-m9"));
    expect(blanes).toBeUndefined();

    const reus = listings.find((l) => l.externalId?.includes("2026-10-31-milonga-m223"));
    expect(reus).toBeUndefined();

    const matadepera = listings.find((l) => l.externalId?.includes("2026-10-31-milonga-e362"));
    expect(matadepera).toBeUndefined();
  });

  it("deduplicates events by key", () => {
    const { listings } = agendaToListings(bcnData, {
      metro,
      nights,
      fetchedAt,
    });

    const casaValenciaCount = listings.filter(
      (l) => l.externalId === "agendadeltango:2026-10-29-milonga-e359",
    ).length;
    expect(casaValenciaCount).toBe(1);
  });

  it("eventsOf function deduplicates by key", () => {
    // This is an internal function, but we can test it indirectly through rowsNeedingDetail
    // which uses eventsOf
    const rows = rowsNeedingDetail(bcnData, { metro, nights });
    // Check that we don't have duplicate keys
    const keys = rows.map((r) => r.key);
    const uniqueKeys = new Set(keys);
    expect(keys.length).toBe(uniqueKeys.size);
  });

  it("filters by nights parameter", () => {
    const singleNight = ["2026-10-29"];
    const { listings } = agendaToListings(bcnData, {
      metro,
      nights: singleNight,
      fetchedAt,
    });

    expect(listings).toHaveLength(1);
    expect(listings[0]?.externalId).toBe("agendadeltango:2026-10-29-milonga-e359");
  });

  it("handles práctica detection", () => {
    const { listings } = agendaToListings(bcnData, {
      metro,
      nights,
      fetchedAt,
    });

    const practicas = listings.filter((l) => l.listing.listing_type === "practica");
    expect(practicas).toHaveLength(0);
  });

  it("throws on invalid data", () => {
    expect(() => {
      agendaToListings({}, { metro, nights, fetchedAt });
    }).toThrow('agendadeltango: data file no longer has "dias"');

    expect(() => {
      agendaToListings({ dias: "not an array" }, { metro, nights, fetchedAt });
    }).toThrow('agendadeltango: data file no longer has "dias"');
  });

  it("rowsNeedingDetail returns correct URLs", () => {
    const rows = rowsNeedingDetail(bcnData, { metro, nights });
    // Living Tango should be in the list (no town in parentheses)
    const livingTangoRow = rows.find((r) => r.key === "2026-10-31-milonga-e361");
    expect(livingTangoRow).toBeDefined();
    expect(livingTangoRow?.url).toBe(
      "https://agendadeltango.com/milongas/living-tango-barcelona/2026-10-31/",
    );

    // Matadepera row should NOT be included because it has a town "(Matadepera)"
    const matadeperaRow = rows.find((r) => r.key === "2026-10-31-milonga-e362");
    expect(matadeperaRow).toBeUndefined();
  });

  it("without detail lookup, Living Tango is filtered out", () => {
    const { listings } = agendaToListings(bcnData, {
      metro,
      nights,
      fetchedAt,
    });
    const livingTango = listings.find(
      (l) => l.externalId === "agendadeltango:2026-10-31-milonga-e361",
    );
    expect(livingTango).toBeUndefined();
  });
  it("extractTownFromText returns canonical town names", () => {
    // Test with accent-insensitive matching
    expect(extractTownFromText("Carrer Ample 2 Sant Adria de Besos")).toBe("Sant Adrià de Besòs");
    expect(extractTownFromText("Carrer Ample 2 sant adria de besos")).toBe("Sant Adrià de Besòs");
    expect(extractTownFromText("Carrer Ample 2 Barcelona")).toBe("Barcelona");
    expect(extractTownFromText("Carrer Ample 2 barcelona")).toBe("Barcelona");
    expect(extractTownFromText("Carrer Ample 2 L'Hospitalet de Llobregat")).toBe(
      "L'Hospitalet de Llobregat",
    );
    expect(extractTownFromText("Carrer Ample 2 l'hospitalet de llobregat")).toBe(
      "L'Hospitalet de Llobregat",
    );
    expect(extractTownFromText("Carrer Ample 2 Badalona")).toBe("Badalona");
    expect(extractTownFromText("Carrer Ample 2 Santa Coloma de Gramenet")).toBe(
      "Santa Coloma de Gramenet",
    );

    // Should return null for non-metro towns
    expect(extractTownFromText("Carrer Ample 2 Sabadell")).toBeNull();
    expect(extractTownFromText("Carrer Ample 2 Reus")).toBeNull();
  });
});
