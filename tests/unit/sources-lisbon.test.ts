// The Lisbon starting list keeps its own promises (D-047, D-110): one row per address, only
// http(s), no Squarespace ?format= view, and no Resident Advisor pages (D-034).
import { describe, expect, it } from "vitest";

import { KNOWN_VENUES } from "@/config/known-venues";
import { LISBON_RETIRED, LISBON_SOURCES } from "@/config/sources/lisbon";
import { STYLES } from "@/config/styles";

const listed = LISBON_SOURCES.map((seed) => seed.url);
const retired = LISBON_RETIRED.map((gone) => gone.url);

describe("Lisbon's starting list", () => {
  it("lists each address once, retired addresses are unique, and every url and feedUrl is http(s)", () => {
    expect(new Set(listed).size).toBe(listed.length);
    expect(new Set(retired).size).toBe(retired.length);
    for (const url of [...listed, ...retired]) {
      expect(new URL(url).protocol).toMatch(/^https?:$/);
    }
    for (const seed of LISBON_SOURCES) {
      if (seed.feedUrl) {
        expect(new URL(seed.feedUrl).protocol).toMatch(/^https?:$/);
      }
    }
  });

  it("never lists an address it has retired", () => {
    expect(listed.filter((url) => retired.includes(url))).toEqual([]);
  });

  it("asks for no ?format= view, which Squarespace's robots.txt disallows", () => {
    for (const seed of LISBON_SOURCES) {
      expect(seed.url).not.toMatch(/[?&]format=/);
      expect(seed.feedUrl ?? "").not.toMatch(/[?&]format=/);
    }
  });

  it("keeps Resident Advisor out of its own file: RA comes only from config/sources/ra.ts (D-505)", () => {
    for (const seed of LISBON_SOURCES) {
      expect(seed.url).not.toMatch(/ra\.co|residentadvisor\.net/);
      expect(seed.feedUrl ?? "").not.toMatch(/ra\.co|residentadvisor\.net/);
    }
  });

  it("every feed_ics source has a feedUrl, and every squarespace source has platform: 'squarespace'", () => {
    for (const seed of LISBON_SOURCES) {
      if (seed.kind === "feed_ics") {
        expect(seed.feedUrl).toBeDefined();
      }
      if (seed.kind === "squarespace") {
        expect(seed.platform).toBe("squarespace");
      }
    }
  });

  it("every style named by a source is a real style key", () => {
    const styleKeys = STYLES.map((s) => s.key);
    for (const seed of LISBON_SOURCES) {
      for (const style of seed.styles) {
        expect(styleKeys).toContain(style);
      }
    }
  });

  it("reads Eventbrite organisers through the API only, as mixed calendars (D-015, D-131)", () => {
    const organisers = LISBON_SOURCES.filter((s) => s.platform === "eventbrite");
    expect(organisers.length).toBe(6);
    for (const seed of organisers) {
      expect(seed.url).toMatch(/^https:\/\/www\.eventbrite\.pt\/o\/\d+$/);
      expect(seed.kind).toBe("ticketing_api");
      expect(seed.trustTier).toBe("ticketing");
      expect(seed.mixedCalendar).toBe(true);
    }
  });

  it("reads DICE's Lisbon browse pages (D-139, D-197) and one Meetup group's own feed (D-035 Q6)", () => {
    const dice = LISBON_SOURCES.filter((s) => s.platform === "dice");
    expect(dice.length).toBeGreaterThan(2);
    for (const seed of dice) {
      expect(seed.url).toMatch(
        /^https:\/\/dice\.fm\/browse\/lisbon-5db997662b6fd8302bc10d91\/music\//,
      );
    }
    const meetups = LISBON_SOURCES.filter((s) => s.url.startsWith("https://www.meetup.com/"));
    expect(meetups.map((s) => s.feedUrl)).toEqual([
      "https://www.meetup.com/dance-connect-salsa-bachata-kizomba/events/ical/",
      "https://www.meetup.com/bachata_lisboa/events/ical/",
    ]);
  });

  it("leaves out sources waiting for permission or the owner's terms reading (D-034, D-381, D-382)", () => {
    for (const host of ["agendalx.pt", "shotgun.live"]) {
      expect(listed.some((url) => new URL(url).hostname.endsWith(host))).toBe(false);
    }
  });

  it("reads ma.to only for the two venue pages the owner allowed (D-563)", () => {
    const mato = listed.filter((url) => new URL(url).hostname.endsWith("ma.to"));
    expect(mato.sort()).toEqual([
      "https://ma.to/venue/afrolisbon",
      "https://ma.to/venue/embrasaclube",
    ]);
  });

  it("screens SerVivo as a mixed calendar and retires CASA-LAC's programme", () => {
    expect(LISBON_SOURCES.find((s) => s.url === "https://www.servivo.earth/")?.mixedCalendar).toBe(
      true,
    );
    expect(LISBON_SOURCES.some((s) => s.url === "https://www.casa-lac.com/programa")).toBe(false);
    expect(LISBON_RETIRED.some((s) => s.url === "https://www.casa-lac.com/programa")).toBe(true);
  });

  it("reads Salsa Vida's Lisbon guide as a directory, never as the organiser (D-321)", () => {
    const guide = LISBON_SOURCES.find((s) => s.label === "Salsa Vida Lisbon");
    expect(guide?.url).toBe("https://www.salsavida.com/guides/portugal/lisbon/");
    expect(guide?.trustTier).toBe("directory");
  });

  it("reads Viral Agenda and where-to-dance-salsa as directories, with the owners' permission (D-383)", () => {
    const hosts = ["www.viralagenda.com", "where-to-dance-salsa.com"];
    const permitted = LISBON_SOURCES.filter((s) => hosts.includes(new URL(s.url).hostname));
    expect(permitted.length).toBe(12);
    for (const seed of permitted) {
      expect(seed.trustTier).toBe("directory");
      expect(seed.kind).toBe("html");
      expect(seed.url).not.toMatch(/\/tags\/|\.ics$/);
    }
  });

  it("reads salsalisbon and TangoLX as dance-only calendars, never screened as mixed ones", () => {
    const salsa = LISBON_SOURCES.find((s) => s.url === "https://salsalisbon.com/");
    expect(salsa?.trustTier).toBe("directory");
    expect(salsa?.mixedCalendar).toBe(false);
    const tango = LISBON_SOURCES.find((s) => s.url === "https://www.tangolx.com/");
    expect(tango?.kind).toBe("feed_gcal");
    expect(tango?.mixedCalendar).not.toBe(true);
    const jazzy = LISBON_SOURCES.find(
      (s) => s.url === "https://www.viralagenda.com/pt/p/jazzydancestudiossantos",
    );
    expect(jazzy?.trustTier).toBe("directory");
    expect(jazzy?.mixedCalendar).toBe(false);
  });

  it("maps TangoLX's regular milongas to their venues, each a Lisbon KnownVenue (D-279)", () => {
    const tangolx = LISBON_SOURCES.find((s) => s.url === "https://www.tangolx.com/");
    const titleVenues = tangolx?.titleVenues ?? {};
    expect(titleVenues["Milonga Guapa"]).toBe("Academia do Lumiar");
    expect(titleVenues["Fusion Dance Party"]).toBe("Galeria Antecâmara");
    expect(Object.keys(titleVenues).length).toBe(12);
    const known = (KNOWN_VENUES.lisbon ?? []).flatMap((v) => v.names);
    for (const venue of Object.values(titleVenues)) {
      expect(known).toContain(venue);
    }
  });

  it("reads Lisboa Rio Club's Xceed page and Bonança's 3cket page (blocked-platform audit, D-758)", () => {
    const rio = LISBON_SOURCES.find(
      (s) => s.url === "https://xceed.me/en/lisboa/venue/lisboa-rio-club",
    );
    expect(rio?.kind).toBe("jsonld");
    expect(rio?.platform).toBe("jsonld_items");
    const bonanca = LISBON_SOURCES.find((s) => s.url === "https://3cket.com/pt/organizer/Bonanca");
    expect(bonanca?.kind).toBe("html");
    expect(bonanca?.venuePage).toBe(true);
    expect(bonanca?.venueAddress).toBe("Doca de Belém, 1400-038 Lisboa");
  });
});
