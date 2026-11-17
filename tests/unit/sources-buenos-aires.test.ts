// Buenos Aires' starting list keeps its own promises (D-401): one row per address, only http(s), no Resident
// Advisor (D-034), and never Facebook, Instagram, Hoy Milonga or Passline (owner, 2026-10-29).
import { describe, expect, it } from "vitest";

import { BUENOS_AIRES_RETIRED, BUENOS_AIRES_SOURCES } from "@/config/sources/buenos-aires";
import { STYLES } from "@/config/styles";

const listed = BUENOS_AIRES_SOURCES.map((seed) => seed.url);
const retired = BUENOS_AIRES_RETIRED.map((gone) => gone.url);

describe("Buenos Aires' starting list", () => {
  it("each url listed once; retired urls unique; every url (and any feedUrl) is http or https", () => {
    expect(new Set(listed).size).toBe(listed.length);
    expect(new Set(retired).size).toBe(retired.length);
    for (const url of [...listed, ...retired]) {
      expect(new URL(url).protocol).toMatch(/^https?:$/);
    }
    for (const seed of BUENOS_AIRES_SOURCES) {
      if (seed.feedUrl) {
        expect(new URL(seed.feedUrl).protocol).toMatch(/^https?:$/);
      }
    }
  });

  it("never lists a retired url", () => {
    expect(listed.filter((url) => retired.includes(url))).toEqual([]);
  });

  it("no url or feedUrl host matches ra.co, residentadvisor.net, facebook.com, instagram.com, hoy-milonga.com, passline.com", () => {
    const forbiddenHosts = [
      /(\.|^)ra\.co$/,
      /(\.|^)residentadvisor\.net$/,
      /(\.|^)facebook\.com$/,
      /(\.|^)instagram\.com$/,
      /(\.|^)hoy-milonga\.com$/,
      /(\.|^)passline\.com$/,
    ];
    for (const seed of BUENOS_AIRES_SOURCES) {
      const host = new URL(seed.url).hostname;
      for (const pattern of forbiddenHosts) {
        expect(host).not.toMatch(pattern);
      }
      if (seed.feedUrl) {
        const feedHost = new URL(seed.feedUrl).hostname;
        for (const pattern of forbiddenHosts) {
          expect(feedHost).not.toMatch(pattern);
        }
      }
    }
  });

  it("every style of every source is a key in STYLES", () => {
    const styleKeys = STYLES.map((s) => s.key);
    for (const seed of BUENOS_AIRES_SOURCES) {
      for (const style of seed.styles) {
        expect(styleKeys).toContain(style);
      }
    }
  });

  it("Salsa Vida Buenos Aires is trustTier: 'directory'", () => {
    const guide = BUENOS_AIRES_SOURCES.find((s) => s.label === "Salsa Vida Buenos Aires");
    expect(guide?.trustTier).toBe("directory");
  });

  it("Crobar is kind: 'jsonld', trustTier: 'first_party', venuePage: true", () => {
    const crobar = BUENOS_AIRES_SOURCES.find((s) => s.label === "Crobar");
    expect(crobar?.kind).toBe("jsonld");
    expect(crobar?.trustTier).toBe("first_party");
    expect(crobar?.venuePage).toBe(true);
  });

  it("Niceto and Konex each have venuePage: true, mixedCalendar: true and a venueAddress containing 'CABA'", () => {
    const niceto = BUENOS_AIRES_SOURCES.find((s) => s.label === "Niceto Club");
    expect(niceto?.venuePage).toBe(true);
    expect(niceto?.mixedCalendar).toBe(true);
    expect(niceto?.venueAddress).toContain("CABA");

    const konex = BUENOS_AIRES_SOURCES.find((s) => s.label === "Ciudad Cultural Konex");
    expect(konex?.venuePage).toBe(true);
    expect(konex?.mixedCalendar).toBe(true);
    expect(konex?.venueAddress).toContain("CABA");
  });

  it("reads Ritmo Libre's CABA socials as a directory, following its event pages", () => {
    const ritmo = BUENOS_AIRES_SOURCES.find((s) => s.label === "Ritmo Libre CABA");
    expect(ritmo?.url).toBe("https://www.ritmolibre.ar/agenda-baile/sociales/caba");
    expect(ritmo?.kind).toBe("jsonld");
    expect(ritmo?.platform).toBe("jsonld_items");
    expect(ritmo?.trustTier).toBe("directory");
    expect(ritmo?.mixedCalendar).toBe(true);
    expect(ritmo?.notDanceNights).toContain("Instructorado de Bachata Femme");
  });

  it("reads La Paz Arriba from Qué Hacemos' venue page as a mixed directory", () => {
    const lpa = BUENOS_AIRES_SOURCES.find((s) => s.label === "La Paz Arriba (Qué Hacemos)");
    expect(lpa?.url).toBe("https://www.quehacemos.com.ar/venues/la-paz-arriba");
    expect(lpa?.kind).toBe("jsonld");
    expect(lpa?.trustTier).toBe("directory");
    expect(lpa?.mixedCalendar).toBe(true);
    expect(lpa?.venueAddress).toContain("Callao 1082");
  });

  it("the four Eventbrite rows have platform: 'eventbrite', kind: 'ticketing_api', mixedCalendar: true, and their url host is 'www.eventbrite.com.ar'", () => {
    const eventbrites = BUENOS_AIRES_SOURCES.filter((s) => s.platform === "eventbrite");
    expect(eventbrites).toHaveLength(4);
    for (const seed of eventbrites) {
      expect(seed.kind).toBe("ticketing_api");
      expect(seed.mixedCalendar).toBe(true);
      expect(new URL(seed.url).hostname).toBe("www.eventbrite.com.ar");
    }
  });

  it("reads the weekly milonga grids (D-402) as first-party venue pages with a CABA address", () => {
    for (const label of ["Club Gricel", "La Viruta Tango Club", "Cachirulo (El Beso)"]) {
      const seed = BUENOS_AIRES_SOURCES.find((s) => s.label === label);
      expect(seed?.kind).toBe("html");
      expect(seed?.trustTier).toBe("first_party");
      expect(seed?.venuePage).toBe(true);
      expect(seed?.onlyHere).toBe(true);
      expect(seed?.venueAddress).toContain("CABA");
      expect(seed?.styles).toContain("tango");
      expect(seed?.weeklyGrid).toBe(true);
    }
  });

  // Raised from 12 to 15 for the six 5Rhythms class pages (D-523): BA's daily read costs about $0.05 of AI.
  // Raised to 16 for Mandarine Park (blocked-platform audit, D-758; the owner 2026-11-06).
  it("at most 16 sources are model-read pages: count entries with kind === 'html'; expect <= 16", () => {
    const htmlSources = BUENOS_AIRES_SOURCES.filter((s) => s.kind === "html");
    expect(htmlSources.length).toBeLessThanOrEqual(16);
  });

  it("retires Club Cultural Matienzo with a reason", () => {
    const gone = BUENOS_AIRES_RETIRED.find((r) => r.url === "https://www.ccmatienzo.com.ar/");
    expect(gone?.reason).toContain("__NEXT_DATA__");
  });

  it("reads the six 5Rhythms class pages at Niceto Vega 5390 (D-523)", () => {
    const fiveRhythms = BUENOS_AIRES_SOURCES.filter((seed) =>
      seed.url.startsWith("https://www.5rhythms.com/classes/"),
    );
    expect(fiveRhythms).toHaveLength(6);
    for (const seed of fiveRhythms) {
      expect(seed.styles).toEqual(["five_rhythms"]);
      expect(seed.kind).toBe("html");
    }
  });

  it("reads Dancetomic and Bailar with their permission, following their event pages (D-404)", () => {
    for (const [label, url] of [
      ["Dancetomic Buenos Aires", "https://dancetomic.com/eventos/buenos-aires"],
      ["Bailar Buenos Aires", "https://getbailar.com/dance/buenos-aires"],
    ] as const) {
      const seed = BUENOS_AIRES_SOURCES.find((s) => s.label === label);
      expect(seed?.url).toBe(url);
      expect(seed?.kind).toBe("jsonld");
      expect(seed?.platform).toBe("jsonld_items");
      expect(seed?.mixedCalendar).toBe(true);
    }
  });

  it("names FEL!ZA's shows and talks as not dance nights, keeping its DJ nights", async () => {
    const { isNamedDanceNight } = await import("@/src/domain/listing-screen");
    const feliza = BUENOS_AIRES_SOURCES.find((s) => s.url === "https://felizarcoiris.com/agenda");
    expect(feliza?.kind).toBe("jsonld");
    const skip = feliza?.notDanceNights;
    for (const title of [
      "TALENTOS QUEER FELIZA",
      "Hostea y recibe: Trakyna",
      "Karaoke Drag",
      "Stylist:",
      "Cineclub: Fabulosos Desconocidos",
      "Charlar en un lugar seguro, así empieza la noche",
      "Tina - Autopublicación",
      "Campeonato de Metegol Femme: 3 chicas por grupo",
      "Conocé gente nueva desde temprano",
    ])
      expect(isNamedDanceNight(title, skip)).toBe(true);
    for (const title of [
      "PUTIPOP",
      "Patio Marica",
      "Charlee Espinoza musicalizando",
      "Milonga Cuir de Tango para Todes",
    ])
      expect(isNamedDanceNight(title, skip)).toBe(false);
  });
});
