// Paris's starting sources (D-1040). France is in the EU: D-034's rules (official APIs, first-party public pages
// and feeds, robots.txt honoured, facts only, no unofficial endpoint without written consent); Facebook and
// Instagram never; Resident Advisor only through its GraphQL endpoint (D-505, area 44). HelloAsso, Billetweb and
// Weezevent wait for the owner's written permission asks (D-1040). The daily run seeds venues and discovers their
// websites (D-120).

import { describe, expect, it } from "vitest";

import { KNOWN_VENUES } from "@/config/known-venues";
import { PARIS_RETIRED, PARIS_SOURCES } from "@/config/sources/paris";
import { STYLES } from "@/config/styles";

const listed = PARIS_SOURCES.map((seed) => seed.url);
const retired = PARIS_RETIRED.map((gone) => gone.url);

describe("Paris's starting list", () => {
  it("lists each address once, retired addresses are unique, and every url and feedUrl is http(s)", () => {
    expect(new Set(listed).size).toBe(listed.length);
    expect(new Set(retired).size).toBe(retired.length);
    for (const url of [...listed, ...retired]) {
      expect(new URL(url).protocol).toMatch(/^https?:$/);
    }
    for (const seed of PARIS_SOURCES) {
      if (seed.feedUrl) {
        expect(new URL(seed.feedUrl).protocol).toMatch(/^https?:$/);
      }
    }
  });

  it("never lists an address it has retired", () => {
    expect(listed.filter((url) => retired.includes(url))).toEqual([]);
  });

  it("asks for no ?format= view, which Squarespace's robots.txt disallows", () => {
    for (const seed of PARIS_SOURCES) {
      expect(seed.url).not.toMatch(/[?&]format=/);
      expect(seed.feedUrl ?? "").not.toMatch(/[?&]format=/);
    }
  });

  it("keeps Resident Advisor out of its own file: RA comes only from config/sources/ra.ts (D-505)", () => {
    for (const seed of PARIS_SOURCES) {
      expect(seed.url).not.toMatch(/ra\.co|residentadvisor\.net/);
      expect(seed.feedUrl ?? "").not.toMatch(/ra\.co|residentadvisor\.net/);
    }
  });

  it("every feed_ics source has a feedUrl, and every squarespace source has platform: 'squarespace'", () => {
    for (const seed of PARIS_SOURCES) {
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
    for (const seed of PARIS_SOURCES) {
      for (const style of seed.styles) {
        expect(styleKeys).toContain(style);
      }
    }
  });

  it("reads Eventbrite organisers through the API only, as mixed calendars (D-015, D-131)", () => {
    const organisers = PARIS_SOURCES.filter((s) => s.platform === "eventbrite");
    // The list may be empty initially, but if present they must follow these rules
    for (const seed of organisers) {
      expect(seed.url).toMatch(/^https:\/\/www\.eventbrite\.(com|fr)\/o\/\d+$/);
      expect(seed.kind).toBe("ticketing_api");
      expect(seed.trustTier).toBe("ticketing");
      // LA SUNDAY is a club night's own list, not a mixed calendar (run 42450876185, 2026-11-08).
      if (seed.url !== "https://www.eventbrite.fr/o/47098959913")
        expect(seed.mixedCalendar).toBe(true);
    }
  });

  it("reads DICE's Paris browse pages (D-139, D-197) and any Meetup group's own feed", () => {
    const dice = PARIS_SOURCES.filter((s) => s.platform === "dice");
    // The list may be empty initially, but if present they must follow the pattern
    for (const seed of dice) {
      expect(seed.url).toMatch(/^https:\/\/dice\.fm\/browse\/paris-[a-f0-9]+\/music\//);
    }
    const meetups = PARIS_SOURCES.filter((s) => s.url.startsWith("https://www.meetup.com/"));
    for (const seed of meetups) {
      expect(seed.feedUrl).toMatch(/\/events\/ical\//);
    }
  });

  it("leaves out sources waiting for permission or the owner's terms reading (D-1040)", () => {
    for (const host of ["helloasso.com", "billetweb.fr", "weezevent.com"]) {
      expect(listed.some((url) => new URL(url).hostname.endsWith(host))).toBe(false);
    }
  });

  it("reads any directory sources as directories, never as the organiser", () => {
    const directories = PARIS_SOURCES.filter((s) => s.trustTier === "directory");
    for (const seed of directories) {
      // A directory with its own reader is kind "jsonld" (tango-argentin.fr's agenda, run 42450876185; AgendaTrad).
      expect(seed.kind).toBe(
        seed.platform === "tango_argentin" || seed.platform === "agendatrad" ? "jsonld" : "html",
      );
      expect(seed.url).not.toMatch(/\/tags\/|\.ics$/);
    }
  });

  it("reads any dance-only calendars as such, never screened as mixed ones", () => {
    const danceOnly = PARIS_SOURCES.filter((s) => s.mixedCalendar === false);
    for (const seed of danceOnly) {
      expect(seed.trustTier).toBe("directory");
    }
  });

  it("maps any titleVenues to their venues, each a Paris KnownVenue (D-279)", () => {
    for (const seed of PARIS_SOURCES) {
      if (seed.titleVenues) {
        const known = (KNOWN_VENUES.paris ?? []).flatMap((v) => v.names);
        for (const venue of Object.values(seed.titleVenues)) {
          expect(known).toContain(venue);
        }
      }
    }
  });
});
