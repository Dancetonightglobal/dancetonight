// Medellín's starting list keeps its own promises (D-047, D-110): one row per address, only
// http(s), Resident Advisor only through the D-505 ra source, and no Facebook or Instagram.
import { describe, expect, it } from "vitest";

import { MEDELLIN_RETIRED, MEDELLIN_SOURCES } from "@/config/sources/medellin";
import { STYLES } from "@/config/styles";
import { fixedNightListings } from "@/src/domain/fixed-nights";

const listed = MEDELLIN_SOURCES.map((seed) => seed.url);
const retired = MEDELLIN_RETIRED.map((gone) => gone.url);

describe("Medellín's starting list", () => {
  it("lists each address once, retired addresses are unique, and every url and feedUrl is http(s)", () => {
    expect(new Set(listed).size).toBe(listed.length);
    expect(new Set(retired).size).toBe(retired.length);
    for (const url of [...listed, ...retired]) {
      expect(new URL(url).protocol).toMatch(/^https?:$/);
    }
    for (const seed of MEDELLIN_SOURCES) {
      if (seed.feedUrl) {
        expect(new URL(seed.feedUrl).protocol).toMatch(/^https?:$/);
      }
    }
  });

  it("never lists an address it has retired", () => {
    expect(listed.filter((url) => retired.includes(url))).toEqual([]);
  });

  it("stays off Resident Advisor (ra.co, residentadvisor.net), Facebook and Instagram", () => {
    for (const seed of MEDELLIN_SOURCES) {
      const urlHost = new URL(seed.url).hostname;
      expect(urlHost).not.toMatch(/(\.|^)ra\.co$/);
      expect(urlHost).not.toMatch(/(\.|^)residentadvisor\.net$/);
      expect(urlHost).not.toMatch(/(\.|^)facebook\.com$/);
      expect(urlHost).not.toMatch(/(\.|^)instagram\.com$/);
      if (seed.feedUrl) {
        const feedHost = new URL(seed.feedUrl).hostname;
        expect(feedHost).not.toMatch(/(\.|^)ra\.co$/);
        expect(feedHost).not.toMatch(/(\.|^)residentadvisor\.net$/);
        expect(feedHost).not.toMatch(/(\.|^)facebook\.com$/);
        expect(feedHost).not.toMatch(/(\.|^)instagram\.com$/);
      }
    }
  });

  it("every style named by a source is a real style key", () => {
    const styleKeys = STYLES.map((s) => s.key);
    for (const seed of MEDELLIN_SOURCES) {
      for (const style of seed.styles) {
        expect(styleKeys).toContain(style);
      }
    }
  });

  it("reads Salsa Vida Medellín as a directory", () => {
    const salsaVida = MEDELLIN_SOURCES.find(
      (s) => s.url === "https://www.salsavida.com/guides/colombia/medellin/",
    );
    expect(salsaVida).toBeDefined();
    expect(salsaVida?.trustTier).toBe("directory");
    expect(salsaVida?.kind).toBe("html");
    expect(salsaVida?.styles).toContain("salsa");
  });

  it("reads Dancefree's own Squarespace calendar, with its socials named and private classes left out", () => {
    const dancefree = MEDELLIN_SOURCES.find(
      (s) => s.url === "https://www.dancefree.com.co/calendar",
    );
    expect(dancefree).toBeDefined();
    expect(dancefree?.kind).toBe("squarespace");
    expect(dancefree?.platform).toBe("squarespace");
    expect(dancefree?.trustTier).toBe("first_party");
    expect(dancefree?.venuePage).toBe(true);
    expect(dancefree?.onlyHere).toBe(true);
    expect(dancefree?.mixedCalendar).toBe(true);
    expect(dancefree?.venueAddress).toBe("Calle 10A #40-27, El Poblado, Medellín");
    expect(dancefree?.danceNights).toEqual(["Bar/Social"]);
    expect(dancefree?.notDanceNights).toEqual(["Private Classes"]);
  });

  it("reads Casa Ritmo Latino's own events page", () => {
    const casa = MEDELLIN_SOURCES.find(
      (s) =>
        s.url === "https://casaritmolatino.com/academia-de-baile-en-medellin-colombia-eventos/",
    );
    expect(casa).toBeDefined();
    expect(casa?.kind).toBe("html");
    expect(casa?.trustTier).toBe("first_party");
    expect(casa?.venuePage).toBe(true);
    expect(casa?.onlyHere).toBe(true);
    expect(casa?.venueAddress).toBe("Cra. 81 #34A-71, Laureles, Medellín");
  });

  it("Club Oráculo is listed once with onlyHere: true, mixedCalendar: true, correct venueAddress, and notDanceNights containing Jueves de Karaoke", () => {
    const club = MEDELLIN_SOURCES.find((s) => s.url === "https://cluboraculo.com/eventos/");
    expect(club).toBeDefined();
    expect(club?.onlyHere).toBe(true);
    expect(club?.mixedCalendar).toBe(true);
    expect(club?.venueAddress).toBe("Cra. 36 #8A-123, El Poblado, Medellín");
    expect(club?.notDanceNights).toContain("Jueves de Karaoke");
  });

  it("Salsa Vida lessons page is listed with trustTier: directory and notDanceNights contains expected entries", () => {
    const lessons = MEDELLIN_SOURCES.find(
      (s) => s.url === "https://www.salsavida.com/guides/colombia/medellin/lessons/",
    );
    expect(lessons).toBeDefined();
    expect(lessons?.trustTier).toBe("directory");
    expect(lessons?.notDanceNights).toContain("Tuesday Free Salsa Class at Wandering Paisa Hostel");
    expect(lessons?.notDanceNights).toContain(
      "Salsa Nivel Intermedio en Línea at Nueva Guardia Dance Club",
    );
  });

  it("Casa Ritmo Latino has danceNights containing Jueves de Casa Ritmo Latino", () => {
    const casa = MEDELLIN_SOURCES.find(
      (s) =>
        s.url === "https://casaritmolatino.com/academia-de-baile-en-medellin-colombia-eventos/",
    );
    expect(casa?.danceNights).toEqual(["Jueves de Casa Ritmo Latino"]);
  });

  it("Pura frecuencia is an Eventbrite source with correct platform and kind", () => {
    const pura = MEDELLIN_SOURCES.find((s) => s.url === "https://www.eventbrite.com/o/81689349493");
    expect(pura).toBeDefined();
    expect(pura?.platform).toBe("eventbrite");
    expect(pura?.kind).toBe("ticketing_api");
  });

  it("retires domebi.com/events with a reason mentioning concerts", () => {
    const domebi = MEDELLIN_RETIRED.find((r) => r.url === "https://www.domebi.com/events");
    expect(domebi).toBeDefined();
    expect(domebi?.reason).toContain("concerts");
  });

  it("reads Teatro Victoria's own home page as a weekly grid of named club nights", () => {
    const teatro = MEDELLIN_SOURCES.find((s) => s.url === "https://teatrovictoria.co/");
    expect(teatro).toBeDefined();
    expect(teatro?.kind).toBe("html");
    expect(teatro?.trustTier).toBe("first_party");
    expect(teatro?.label).toBe("Teatro Victoria");
    expect(teatro?.venuePage).toBe(true);
    expect(teatro?.onlyHere).toBe(true);
    expect(teatro?.mixedCalendar).toBe(true);
    expect(teatro?.weeklyGrid).toBe(true);
    expect(teatro?.venueAddress).toBe("Carrera 35 # 8A-73, El Poblado, Medellín");
    expect(teatro?.danceNights).toContain("Gringos Tuesday");
    expect(teatro?.danceNights).toContain("Miércoles de Solteras");
    expect(teatro?.danceNights).toContain("Jueves de Parranda Vallenata");
    expect(teatro?.styles).toContain("reggaeton");
  });

  it("lists Bar Chiquita's Medellín hours as fixed weekly nights, citing its own dancing words", () => {
    const chiquita = MEDELLIN_SOURCES.find((s) => s.url === "https://www.barchiquita.com/");
    expect(chiquita).toBeDefined();
    expect(chiquita?.venuePage).toBe(true);
    expect(chiquita?.onlyHere).toBe(true);
    expect(chiquita?.venueAddress).toBe("Cra. 37 #8a-88, El Poblado, Medellín");
    expect(chiquita?.fixedNights).toHaveLength(3);

    for (const fn of chiquita?.fixedNights ?? []) {
      expect(fn.danceCited).toContain("noches locas de perreo");
      expect(fn.danceCited).toContain("2026-10-31");
    }

    const allDays = (chiquita?.fixedNights ?? []).flatMap((fn) => fn.days).sort((a, b) => a - b);
    expect(allDays).toEqual([0, 2, 3, 4, 5, 6]);

    const pageText =
      "Horario Bar Chiquita Medellin Martes a jueves: 6:00 p.m. a 2:00 a.m. Viernes y sábados: 7:00 p.m. a 3:00 a.m. Domingos: 6:00 p.m. a 2:00 a.m Bar Chiquita Bogotá Martes a Miércoles y jueves: Piso 1, 2 y 3 de 9:00 p.m. a 2:00 a.m.";

    const result = fixedNightListings(chiquita?.fixedNights ?? [], {
      pageText,
      pageUrl: "https://www.barchiquita.com/",
      fetchedAt: new Date("2026-11-01T12:00:00Z"),
      fromNight: "2026-11-02",
      currency: "COP",
      sourceStyles: [...chiquita!.styles],
      venueName: "Bar Chiquita",
      venueAddress: chiquita?.venueAddress ?? null,
      zone: "America/Bogota",
    });

    expect(result.listings).toHaveLength(3);
    for (const listing of result.listings) {
      expect(listing.listing.title).toMatch(/^Bar Chiquita: drag show y perreo \(/);
    }
    // Each night is its own row: a fixed night's id is built from its title.
    expect(new Set(result.listings.map((l) => l.listing.title)).size).toBe(3);

    const resultBogota = fixedNightListings(chiquita?.fixedNights ?? [], {
      pageText: "Horario Bar Chiquita Bogotá",
      pageUrl: "https://www.barchiquita.com/",
      fetchedAt: new Date("2026-11-01T12:00:00Z"),
      fromNight: "2026-11-02",
      currency: "COP",
      sourceStyles: [...chiquita!.styles],
      venueName: "Bar Chiquita",
      venueAddress: chiquita?.venueAddress ?? null,
      zone: "America/Bogota",
    });

    expect(resultBogota.listings).toHaveLength(0);
  });
});
