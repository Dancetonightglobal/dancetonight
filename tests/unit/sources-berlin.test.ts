import { withKnownVenue } from "@/src/pipeline/source-venue";
// The Berlin starting list keeps its own promises (D-1020): one row per address, only
// http(s), no Squarespace ?format= view, and no Resident Advisor pages (D-505).
import { describe, expect, it } from "vitest";

import { KNOWN_VENUES } from "@/config/known-venues";
import { BERLIN_RETIRED, BERLIN_SOURCES } from "@/config/sources/berlin";
import { STYLES } from "@/config/styles";
import { lineOnPage } from "@/src/domain/fixed-nights";

const listed = BERLIN_SOURCES.map((seed) => seed.url);
const retired = BERLIN_RETIRED.map((gone) => gone.url);

describe("Berlin's starting list", () => {
  it("lists each address once, retired addresses are unique, and every url and feedUrl is http(s)", () => {
    expect(new Set(listed).size).toBe(listed.length);
    expect(new Set(retired).size).toBe(retired.length);
    for (const url of [...listed, ...retired]) {
      expect(new URL(url).protocol).toMatch(/^https?:$/);
    }
    for (const seed of BERLIN_SOURCES) {
      if (seed.feedUrl) {
        expect(new URL(seed.feedUrl).protocol).toMatch(/^https?:$/);
      }
    }
  });

  it("never lists an address it has retired", () => {
    expect(listed.filter((url) => retired.includes(url))).toEqual([]);
  });

  it("asks for no ?format= view, which Squarespace's robots.txt disallows", () => {
    for (const seed of BERLIN_SOURCES) {
      expect(seed.url).not.toMatch(/[?&]format=/);
      expect(seed.feedUrl ?? "").not.toMatch(/[?&]format=/);
    }
  });

  it("keeps Resident Advisor out of its own file: RA comes only from config/sources/ra.ts (D-505)", () => {
    for (const seed of BERLIN_SOURCES) {
      expect(seed.url).not.toMatch(/ra\.co|residentadvisor\.net/);
      expect(seed.feedUrl ?? "").not.toMatch(/ra\.co|residentadvisor\.net/);
    }
  });

  it("every feed_ics source has a feedUrl, and every squarespace source has platform: 'squarespace'", () => {
    for (const seed of BERLIN_SOURCES) {
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
    for (const seed of BERLIN_SOURCES) {
      for (const style of seed.styles) {
        expect(styleKeys).toContain(style);
      }
    }
  });

  it("reads Eventbrite organisers through the API only, as mixed calendars (D-015, D-131)", () => {
    const organisers = BERLIN_SOURCES.filter((s) => s.platform === "eventbrite");
    // The list may be empty initially, but if present they must follow these rules
    for (const seed of organisers) {
      expect(seed.url).toMatch(/^https:\/\/www\.eventbrite\.(com|de)\/o\/\d+$/);
      expect(seed.kind).toBe("ticketing_api");
      expect(seed.trustTier).toBe("ticketing");
      expect(seed.mixedCalendar).toBe(true);
    }
  });

  it("reads DICE's Berlin browse pages (D-139, D-197) and any Meetup group's own feed", () => {
    const dice = BERLIN_SOURCES.filter((s) => s.platform === "dice");
    // The list may be empty initially, but if present they must follow the pattern
    for (const seed of dice) {
      expect(seed.url).toMatch(/^https:\/\/dice\.fm\/browse\/berlin-[a-f0-9]+\/music\//);
    }
    const meetups = BERLIN_SOURCES.filter((s) => s.url.startsWith("https://www.meetup.com/"));
    for (const seed of meetups) {
      expect(seed.feedUrl).toMatch(/\/events\/ical\//);
    }
  });

  it("leaves out sources waiting for permission or the owner's terms reading (D-1020)", () => {
    for (const host of ["eventim.de", "ticketmaster.de", "koka36.de", "urbanite.net"]) {
      expect(listed.some((url) => new URL(url).hostname.endsWith(host))).toBe(false);
    }
  });

  it("reads any directory sources as directories, never as the organiser", () => {
    const directories = BERLIN_SOURCES.filter((s) => s.trustTier === "directory");
    for (const seed of directories) {
      expect(seed.kind).toBe("html");
      expect(seed.url).not.toMatch(/\/tags\/|\.ics$/);
    }
  });

  it("reads any dance-only calendars as such, never screened as mixed ones", () => {
    const danceOnly = BERLIN_SOURCES.filter((s) => s.mixedCalendar === false);
    for (const seed of danceOnly) {
      expect(seed.trustTier).toBe("directory");
    }
  });

  it("maps any titleVenues to their venues, each a Berlin KnownVenue (D-279)", () => {
    for (const seed of BERLIN_SOURCES) {
      if (seed.titleVenues) {
        const known = (KNOWN_VENUES.berlin ?? []).flatMap((v) => v.names);
        for (const venue of Object.values(seed.titleVenues)) {
          expect(known).toContain(venue);
        }
      }
    }
  });

  it("knows RA's Berlin club venues (read 2, 2026-11-06)", () => {
    const names = (KNOWN_VENUES.berlin ?? []).flatMap((v) => v.names);
    expect(names).toEqual(
      expect.arrayContaining(["Soda Club Berlin", "Havanna", "Eierschale Dahlem"]),
    );
    for (const v of KNOWN_VENUES.berlin ?? []) expect(v.address).toMatch(/\b1[0-4]\d{3} Berlin$/);
  });

  it("places Salsa Vida's Havanna ('Berlin, Germany') and the berlin.de Eierschale title at their clubs (read 2026-11-08)", () => {
    const at = (name: string, address: string) =>
      withKnownVenue(
        { listing: { title: "x", venue: { name, address } } } as never,
        KNOWN_VENUES.berlin,
        "DE",
      ).listing.venue;
    expect(at("Havanna", "Berlin, Germany")).toMatchObject({
      name: "Havanna Berlin",
      address: "Hauptstraße 30, 10827 Berlin",
    });
    expect(
      at("FrühTanz in der Eierschale Dahlem", "Podbielskiallee 50, 14195 Berlin"),
    ).toMatchObject({
      name: "Eierschale Dahlem",
    });
  });

  it("places Traumtänzer's three branches from its grid's 'school - branch, street' names (read 2026-11-11)", () => {
    const at = (name: string, address?: string) =>
      withKnownVenue(
        { listing: { title: "x", venue: { name, address } } } as never,
        KNOWN_VENUES.berlin,
        "DE",
      ).listing.venue;
    expect(at("Tanzschule Traumtänzer - Mariendorf", "Großbeerenstraße 46-52,")).toMatchObject({
      name: "Tanzschule Traumtänzer - Mariendorf",
      address: "Großbeerenstraße 46-52, 12107 Berlin",
    });
    expect(
      at("Tanzschule Traumtänzer - Kurfürstendamm, Westfälische Straße", "Westfälische Straße"),
    ).toMatchObject({
      name: "Tanzschule Traumtänzer - Kurfürstendamm",
      address: "Westfälische Straße 49, 10711 Berlin",
    });
    expect(at("Tanzschule Traumtänzer - Flughafen Tempelhof", "Columbiadamm 8")).toMatchObject({
      name: "Tanzschule Traumtänzer - Flughafen Tempelhof",
      address: "Columbiadamm 8, 12101 Berlin",
    });
    // Großbeerenstraße 46 in Kreuzberg is another place: no street-only match to Mariendorf.
    expect(at("Some Bar", "Großbeerenstraße 46, 10965 Berlin")).toMatchObject({ name: "Some Bar" });
  });

  it("reads its first sources (D-1023): DICE DJ and Party only, Salsa Vida, where-to-dance-salsa, tangosociety.de", () => {
    const dice = BERLIN_SOURCES.filter((s) => s.platform === "dice").map((s) => s.url);
    expect(dice).toEqual([
      "https://dice.fm/browse/berlin-5e426dbb749e68e3e923d1e4/music/dj",
      "https://dice.fm/browse/berlin-5e426dbb749e68e3e923d1e4/music/party",
    ]);
    expect(listed).toContain("https://www.salsavida.com/guides/germany/berlin/");
    for (const style of ["salsa", "bachata", "kizomba"]) {
      expect(listed).toContain(`https://where-to-dance-salsa.com/${style}/berlin/`);
    }
    const tango = BERLIN_SOURCES.filter((s) => new URL(s.url).hostname === "www.tangosociety.de");
    expect(tango).toHaveLength(7);
    for (const seed of tango) {
      expect(seed.styles).toEqual(["tango"]);
      expect(seed.trustTier).toBe("directory");
    }
    expect(BERLIN_SOURCES.filter((s) => s.platform === "eventbrite")).toHaveLength(26);
    expect(BERLIN_SOURCES).toHaveLength(59);
    expect(BERLIN_RETIRED).toHaveLength(2);
  });

  it("lists Havanna's Wed/Fri/Sat nights from the Hours block on its own events page (read 2026-11-09)", () => {
    const seed = BERLIN_SOURCES.find((s) => s.url === "https://www.havanna-berlin.de/events");
    const page =
      "Hours Wednesday 20:00 – open end Friday 22:00 – open end Saturday 22:00 – open end Social";
    expect(seed?.fixedNights?.map((n) => n.days)).toEqual([[3], [5], [6]]);
    for (const night of seed?.fixedNights ?? []) expect(lineOnPage(night.line, page)).toBe(true);
  });
});
