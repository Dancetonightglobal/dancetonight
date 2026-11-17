// The Istanbul starting list keeps its own promises (D-047, D-110): one row per address, only
// http(s), no Squarespace ?format= view, and no Resident Advisor pages (D-505).
import { describe, expect, it } from "vitest";

import { KNOWN_VENUES } from "@/config/known-venues";
import { ISTANBUL_RETIRED, ISTANBUL_SOURCES } from "@/config/sources/istanbul";
import { STYLES } from "@/config/styles";

const listed = ISTANBUL_SOURCES.map((seed) => seed.url);
const retired = ISTANBUL_RETIRED.map((gone) => gone.url);

describe("Istanbul's starting list", () => {
  it("lists each address once, retired addresses are unique, and every url and feedUrl is http(s)", () => {
    expect(new Set(listed).size).toBe(listed.length);
    expect(new Set(retired).size).toBe(retired.length);
    for (const url of [...listed, ...retired]) {
      expect(new URL(url).protocol).toMatch(/^https?:$/);
    }
    for (const seed of ISTANBUL_SOURCES) {
      if (seed.feedUrl) {
        expect(new URL(seed.feedUrl).protocol).toMatch(/^https?:$/);
      }
    }
  });

  it("never lists an address it has retired", () => {
    expect(listed.filter((url) => retired.includes(url))).toEqual([]);
  });

  it("asks for no ?format= view, which Squarespace's robots.txt disallows", () => {
    for (const seed of ISTANBUL_SOURCES) {
      expect(seed.url).not.toMatch(/[?&]format=/);
      expect(seed.feedUrl ?? "").not.toMatch(/[?&]format=/);
    }
  });

  it("keeps Resident Advisor out of its own file: RA comes only from config/sources/ra.ts (D-505)", () => {
    for (const seed of ISTANBUL_SOURCES) {
      expect(seed.url).not.toMatch(/ra\.co|residentadvisor\.net/);
      expect(seed.feedUrl ?? "").not.toMatch(/ra\.co|residentadvisor\.net/);
    }
  });

  it("every feed_ics source has a feedUrl, and every squarespace source has platform: 'squarespace'", () => {
    for (const seed of ISTANBUL_SOURCES) {
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
    for (const seed of ISTANBUL_SOURCES) {
      for (const style of seed.styles) {
        expect(styleKeys).toContain(style);
      }
    }
  });

  it("reads Eventbrite organisers through the API only, as mixed calendars (D-015, D-131)", () => {
    const organisers = ISTANBUL_SOURCES.filter((s) => s.platform === "eventbrite");
    // The list may be empty initially, but if present they must follow these rules
    for (const seed of organisers) {
      expect(seed.url).toMatch(/^https:\/\/www\.eventbrite\.(com|tr)\/o\/\d+$/);
      expect(seed.kind).toBe("ticketing_api");
      expect(seed.trustTier).toBe("ticketing");
      expect(seed.mixedCalendar).toBe(true);
    }
  });

  it("reads DICE's Istanbul browse pages (D-139, D-197) and any Meetup group's own feed", () => {
    const dice = ISTANBUL_SOURCES.filter((s) => s.platform === "dice");
    // The list may be empty initially, but if present they must follow the pattern
    for (const seed of dice) {
      expect(seed.url).toMatch(/^https:\/\/dice\.fm\/browse\/istanbul-[a-f0-9]+\/music\//);
    }
    const meetups = ISTANBUL_SOURCES.filter((s) => s.url.startsWith("https://www.meetup.com/"));
    for (const seed of meetups) {
      expect(seed.feedUrl).toMatch(/\/events\/ical\//);
    }
  });

  it("leaves out sources waiting for permission or the owner's terms reading (D-680)", () => {
    for (const host of [
      "biletix.com",
      "passo.com.tr",
      "bubilet.com",
      "biletinial.com",
      "mobilet.com",
    ]) {
      expect(listed.some((url) => new URL(url).hostname.endsWith(host))).toBe(false);
    }
  });

  it("reads any directory sources as directories, never as the organiser", () => {
    const directories = ISTANBUL_SOURCES.filter((s) => s.trustTier === "directory");
    for (const seed of directories) {
      expect(seed.kind).toBe("html");
      expect(seed.url).not.toMatch(/\/tags\/|\.ics$/);
    }
  });

  it("reads any dance-only calendars as such, never screened as mixed ones", () => {
    const danceOnly = ISTANBUL_SOURCES.filter((s) => s.mixedCalendar === false);
    for (const seed of danceOnly) {
      expect(seed.trustTier).toBe("directory");
    }
  });

  it("maps any titleVenues to their venues, each an Istanbul KnownVenue (D-279)", () => {
    for (const seed of ISTANBUL_SOURCES) {
      if (seed.titleVenues) {
        const known = (KNOWN_VENUES.istanbul ?? []).flatMap((v) => v.names);
        for (const venue of Object.values(seed.titleVenues)) {
          expect(known).toContain(venue);
        }
      }
    }
  });

  it("knows RA's Istanbul club venues (read 2, 2026-10-31)", () => {
    const names = (KNOWN_VENUES.istanbul ?? []).flatMap((v) => v.names);
    expect(names).toEqual(
      expect.arrayContaining(["NOH Extended", "74 Hall", "IF Performance Hall Beşiktaş"]),
    );
    for (const v of KNOWN_VENUES.istanbul ?? []) expect(v.address).toMatch(/\b34\d{3}\b/);
    const hall = (KNOWN_VENUES.istanbul ?? []).find((v) => v.names.includes("74 Hall"));
    expect(hall?.point).toEqual({ lat: 40.9790922, lng: 28.8735522 });
  });

  it("reads Babylon, Swing Planet and Tango Noa from their own sites (D-686)", () => {
    const babylon = ISTANBUL_SOURCES.find((s) => s.url === "https://www.babylon.com.tr/");
    const swingPlanet = ISTANBUL_SOURCES.find(
      (s) => s.url === "https://www.swingplanet.com.tr/dersler-ve-etkinlikler",
    );
    const tangoNoa = ISTANBUL_SOURCES.find((s) => s.url === "https://tangonoa.com/etkinlikler/");
    const tangoDans = ISTANBUL_SOURCES.find((s) => s.url === "https://tangodans.com/en/milongas");

    expect(babylon).toBeDefined();
    expect(swingPlanet).toBeDefined();
    expect(tangoNoa).toBeDefined();
    expect(tangoDans).toBeDefined();

    for (const s of [babylon, swingPlanet, tangoNoa]) {
      expect(s?.kind).toBe("html");
      expect(s?.trustTier).toBe("first_party");
    }

    expect(babylon?.mixedCalendar).toBe(true);
    expect(babylon?.eventPageTimes).toBe(true);
    expect(babylon?.onlyHere).toBe(true);
    expect(babylon?.venuePage).toBe(true);
    expect(babylon?.venueAddress).toContain("Bomonti");

    expect(swingPlanet?.mixedCalendar).toBe(true);
    expect(swingPlanet?.venuePage).toBeFalsy();
    expect(swingPlanet?.onlyHere).toBeFalsy();

    expect(tangoNoa?.weeklyGrid).toBe(true);
    expect(tangoNoa?.onlyHere).toBe(true);
    expect(tangoNoa?.venuePage).toBe(true);
    expect(tangoNoa?.styles).toContain("milonga");

    expect(tangoDans?.trustTier).toBe("directory");
    expect(tangoDans?.weeklyGrid).toBe(true);
    expect(tangoDans?.styles).toContain("milonga");
  });

  it("reads Salsa Vida's Istanbul guide as a directory, not its festival-only lessons page", () => {
    const sv = ISTANBUL_SOURCES.filter((s) => new URL(s.url).hostname === "www.salsavida.com");
    expect(sv.map((s) => s.url)).toEqual(["https://www.salsavida.com/guides/turkey/istanbul/"]);
    expect(sv[0]?.trustTier).toBe("directory");
    expect(sv[0]?.kind).toBe("html");
    expect(sv[0]?.mixedCalendar).toBe(false); // Salsa Vida lists only dance nights (D-772, D-321)
  });

  it("states Swing Planet's two practicas as fixed nights at its studios, with titleVenues mapping to known venues", () => {
    const swingPlanet = ISTANBUL_SOURCES.find(
      (s) => s.url === "https://www.swingplanet.com.tr/dersler-ve-etkinlikler",
    );
    expect(swingPlanet).toBeDefined();
    expect(swingPlanet?.fixedNights).toHaveLength(2);

    const fn = swingPlanet?.fixedNights ?? [];
    expect(fn[0]?.days).toEqual([3]);
    expect(fn[0]?.start).toBe("20:30");
    expect(fn[1]?.days).toEqual([5]);
    expect(fn[1]?.start).toBe("20:45");

    const istanbulVenues = KNOWN_VENUES.istanbul ?? [];
    const venueNames = istanbulVenues.flatMap((v) => v.names);

    for (const fixed of fn) {
      const titleVenues = swingPlanet?.titleVenues ?? {};
      const venueKey = Object.keys(titleVenues).find((k) => fixed.title.includes(k));
      expect(venueKey).toBeDefined();
      const venueName = venueKey === undefined ? undefined : titleVenues[venueKey];
      expect(venueNames).toContain(venueName);
    }
  });
});
