// The Raleigh starting list keeps its own promises (D-047, D-110): one row per address, only
// http(s), no Squarespace ?format= view, and no Resident Advisor pages (D-034).
import { describe, expect, it } from "vitest";

import { RALEIGH_RETIRED, RALEIGH_SOURCES } from "@/config/sources/raleigh";
import { STYLES } from "@/config/styles";

const listed = RALEIGH_SOURCES.map((seed) => seed.url);
const retired = RALEIGH_RETIRED.map((gone) => gone.url);

describe("Raleigh's starting list", () => {
  it("lists each address once, retired addresses are unique, and every url and feedUrl is http(s)", () => {
    expect(new Set(listed).size).toBe(listed.length);
    expect(new Set(retired).size).toBe(retired.length);
    for (const url of [...listed, ...retired]) {
      expect(new URL(url).protocol).toMatch(/^https?:$/);
    }
    for (const seed of RALEIGH_SOURCES) {
      if (seed.feedUrl) {
        expect(new URL(seed.feedUrl).protocol).toMatch(/^https?:$/);
      }
    }
  });

  it("never lists an address it has retired", () => {
    expect(listed.filter((url) => retired.includes(url))).toEqual([]);
  });

  it("asks for no ?format= view, which Squarespace's robots.txt disallows", () => {
    for (const seed of RALEIGH_SOURCES) {
      expect(seed.url).not.toMatch(/[?&]format=/);
      expect(seed.feedUrl ?? "").not.toMatch(/[?&]format=/);
    }
  });

  it("keeps Resident Advisor out of its own file: RA comes only from config/sources/ra.ts (D-505)", () => {
    for (const seed of RALEIGH_SOURCES) {
      expect(seed.url).not.toMatch(/ra\.co|residentadvisor\.net/);
      expect(seed.feedUrl ?? "").not.toMatch(/ra\.co|residentadvisor\.net/);
    }
  });

  it("every feed_ics source has a feedUrl", () => {
    for (const seed of RALEIGH_SOURCES) {
      if (seed.kind === "feed_ics") {
        expect(seed.feedUrl).toBeDefined();
      }
    }
  });

  it("every style named by a source is a real style key", () => {
    const styleKeys = STYLES.map((s) => s.key);
    for (const seed of RALEIGH_SOURCES) {
      for (const style of seed.styles) {
        expect(styleKeys).toContain(style);
      }
    }
  });

  it("places Carolina Dance Club's Meetup listings at the Raleigh Elks Lodge", () => {
    const cdc = RALEIGH_SOURCES.find(
      (s) => s.feedUrl === "https://www.meetup.com/carolina-dance-club/events/ical/",
    );
    expect(cdc).toBeDefined();
    expect(cdc?.venueAddress).toBe("5538 Leadmine Rd, Raleigh, NC 27612");
  });

  it("reads four own-site pages as first-party venue sources", () => {
    const urls = [
      "https://pbrcowboybar.com/cary/",
      "https://salsa4life.com/events/",
      "https://www.carolinadanceclub.com/",
      "https://flex-club.com/calendar/",
    ];
    for (const url of urls) {
      const seed = RALEIGH_SOURCES.find((s) => s.url === url);
      expect(seed).toBeDefined();
      expect(seed?.kind).toBe("html");
      expect(seed?.trustTier).toBe("first_party");
      expect(seed?.venueAddress).toMatch(/, NC 27\d{3}$/);
    }
  });

  it("weekly own-site nights use weeklyGrid", () => {
    const pbr = RALEIGH_SOURCES.find((s) => s.url === "https://pbrcowboybar.com/cary/");
    expect(pbr?.weeklyGrid).toBe(true);
    const salsa4life = RALEIGH_SOURCES.find((s) => s.url === "https://salsa4life.com/events/");
    expect(salsa4life?.weeklyGrid).toBe(true);
    const cdc = RALEIGH_SOURCES.find((s) => s.url === "https://www.carolinadanceclub.com/");
    expect(cdc?.weeklyGrid).toBe(true);
    const flex = RALEIGH_SOURCES.find((s) => s.url === "https://flex-club.com/calendar/");
    expect(flex?.weeklyGrid).toBeUndefined();
  });

  it("reads Eventbrite organisers through the API only, as mixed calendars (D-015, D-131)", () => {
    const organisers = RALEIGH_SOURCES.filter((s) => s.platform === "eventbrite");
    expect(organisers.length).toBe(15);
    for (const seed of organisers) {
      expect(seed.url).toMatch(/^https:\/\/www\.eventbrite\.com\/o\/(?:[a-z0-9-]+-)?\d+$/);
      expect(seed.kind).toBe("ticketing_api");
      expect(seed.trustTier).toBe("ticketing");
      expect(seed.mixedCalendar).toBe(true);
    }
  });

  it("reads Salsa Vida's Raleigh guide as a directory", () => {
    const guide = RALEIGH_SOURCES.find((s) => s.label === "Salsa Vida Raleigh");
    expect(guide?.url).toBe("https://www.salsavida.com/guides/north-carolina/raleigh/");
    expect(guide?.trustTier).toBe("directory");
  });

  it("reads Carolina Dance Club through its own Meetup iCalendar feed", () => {
    const cdc = RALEIGH_SOURCES.find(
      (s) => s.feedUrl === "https://www.meetup.com/carolina-dance-club/events/ical/",
    );
    expect(cdc?.kind).toBe("feed_ics");
  });

  it("reads TangoMango's Wake County page", () => {
    const tm = RALEIGH_SOURCES.find(
      (s) => s.url === "https://www.tangomango.org/index.php?show=Wake,NC",
    );
    expect(tm?.platform).toBe("tangomango");
  });

  it("no DICE, Facebook, Instagram or ma.to addresses", () => {
    for (const seed of RALEIGH_SOURCES) {
      expect(seed.url).not.toMatch(/dice\.fm|facebook\.com|instagram\.com|ma\.to/);
      expect(seed.feedUrl ?? "").not.toMatch(/dice\.fm|facebook\.com|instagram\.com|ma\.to/);
    }
  });

  it("places Raleigh Line Dance at Brier Creek and leaves out its daytime class", () => {
    const seed = RALEIGH_SOURCES.find(
      (s) => s.feedUrl === "https://www.meetup.com/raleigh-line-dance-group/events/ical/",
    );
    expect(seed).toBeDefined();
    expect(seed?.venueAddress).toBe("10810 Globe Rd, Morrisville, NC 27560");
    expect(seed?.notDanceNights).toContain("Line dance at Anne Gordon Center for Active Adults");
    const carmens = RALEIGH_SOURCES.find((s) => s.url === "https://carmenscubancafe.com/events");
    expect(carmens?.venuePage).toBe(true);
    expect(carmens?.venueAddress).toMatch(/, NC 27560$/);
  });

  it("reads Neptunes Parlour's own calendar; Motorco's is retired (D-758)", () => {
    const neptunes = RALEIGH_SOURCES.find(
      (s) => s.url === "https://www.neptunesraleigh.com/events",
    );
    expect(neptunes).toMatchObject({
      kind: "squarespace",
      platform: "squarespace",
      mixedCalendar: true,
    });
    expect(neptunes?.venueAddress).toMatch(/, NC 27601$/);
    // Motorco read fine three times (11-07..11-09) but never wrote a row.
    expect(RALEIGH_SOURCES.some((s) => s.url === "https://motorcomusic.com/calendar/")).toBe(false);
    expect(retired).toContain("https://motorcomusic.com/calendar/");
  });
});
