// The Mumbai starting list keeps its own promises (D-047, D-110): one row per address, only
// http(s), no Squarespace ?format= view, and no Resident Advisor pages (D-505).
import { describe, expect, it } from "vitest";

import { KNOWN_VENUES } from "@/config/known-venues";
import { MUMBAI_RETIRED, MUMBAI_SOURCES } from "@/config/sources/mumbai";
import { STYLES } from "@/config/styles";
import { isNamedDanceNight } from "@/src/domain/listing-screen";

const listed = MUMBAI_SOURCES.map((seed) => seed.url);
const retired = MUMBAI_RETIRED.map((gone) => gone.url);

describe("Mumbai's starting list", () => {
  it("lists each address once, retired addresses are unique, and every url and feedUrl is http(s)", () => {
    expect(new Set(listed).size).toBe(listed.length);
    expect(new Set(retired).size).toBe(retired.length);
    for (const url of [...listed, ...retired]) {
      expect(new URL(url).protocol).toMatch(/^https?:$/);
    }
    for (const seed of MUMBAI_SOURCES) {
      if (seed.feedUrl) {
        expect(new URL(seed.feedUrl).protocol).toMatch(/^https?:$/);
      }
    }
  });

  it("never lists an address it has retired", () => {
    expect(listed.filter((url) => retired.includes(url))).toEqual([]);
  });

  it("asks for no ?format= view, which Squarespace's robots.txt disallows", () => {
    for (const seed of MUMBAI_SOURCES) {
      expect(seed.url).not.toMatch(/[?&]format=/);
      expect(seed.feedUrl ?? "").not.toMatch(/[?&]format=/);
    }
  });

  it("keeps Resident Advisor out of its own file: RA comes only from config/sources/ra.ts (D-505)", () => {
    for (const seed of MUMBAI_SOURCES) {
      expect(seed.url).not.toMatch(/ra\.co|residentadvisor\.net/);
      expect(seed.feedUrl ?? "").not.toMatch(/ra\.co|residentadvisor\.net/);
    }
  });

  it("every feed_ics source has a feedUrl, and every squarespace source has platform: 'squarespace'", () => {
    for (const seed of MUMBAI_SOURCES) {
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
    for (const seed of MUMBAI_SOURCES) {
      for (const style of seed.styles) {
        expect(styleKeys).toContain(style);
      }
    }
  });

  it("reads Eventbrite organisers through the API only, as mixed calendars (D-015, D-131)", () => {
    const organisers = MUMBAI_SOURCES.filter((s) => s.platform === "eventbrite");
    // The list may be empty initially, but if present they must follow these rules
    for (const seed of organisers) {
      expect(seed.url).toMatch(/^https:\/\/www\.eventbrite\.(com|tr)\/o\/\d+$/);
      expect(seed.kind).toBe("ticketing_api");
      expect(seed.trustTier).toBe("ticketing");
      expect(seed.mixedCalendar).toBe(true);
    }
  });

  it("reads DICE's Mumbai browse pages (D-139, D-197) and any Meetup group's own feed", () => {
    const dice = MUMBAI_SOURCES.filter((s) => s.platform === "dice");
    // The list may be empty initially, but if present they must follow the pattern
    for (const seed of dice) {
      expect(seed.url).toMatch(/^https:\/\/dice\.fm\/browse\/mumbai-[a-f0-9]+\/music\//);
    }
    const meetups = MUMBAI_SOURCES.filter((s) => s.url.startsWith("https://www.meetup.com/"));
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
    const directories = MUMBAI_SOURCES.filter((s) => s.trustTier === "directory");
    for (const seed of directories) {
      // Directory sources can be html, jsonld (e.g., Xceed in Barcelona) or a platform API (SkillBox)
      expect(["html", "jsonld", "platform_api"]).toContain(seed.kind);
      expect(seed.url).not.toMatch(/\/tags\/|\.ics$/);
    }
  });

  it("reads any dance-only calendars as such, never screened as mixed ones", () => {
    const danceOnly = MUMBAI_SOURCES.filter((s) => s.mixedCalendar === false);
    for (const seed of danceOnly) {
      expect(seed.trustTier).toBe("directory");
    }
  });

  it("maps any titleVenues to their venues, each an Mumbai KnownVenue (D-279)", () => {
    for (const seed of MUMBAI_SOURCES) {
      if (seed.titleVenues) {
        const known = (KNOWN_VENUES.mumbai ?? []).flatMap((v) => v.names);
        for (const venue of Object.values(seed.titleVenues)) {
          expect(known).toContain(venue);
        }
      }
    }
  });

  it("reads Salsa Vida's Mumbai guide as a directory, and retires the Los Angeles calendar", () => {
    const salsaVida = MUMBAI_SOURCES.find(
      (seed) => seed.url === "https://www.salsavida.com/guides/india/mumbai/",
    );
    expect(salsaVida?.trustTier).toBe("directory");
    expect(salsaVida?.kind).toBe("html");
    expect(retired).toContain("https://rjdance.com/calendar/");
  });

  it("lists Zerua's events page and screens its Top of Twilight bar night", () => {
    const zerua = MUMBAI_SOURCES.find(
      (seed) => seed.url === "https://zeruamumbai.com/upcoming-events/",
    );
    expect(zerua?.trustTier).toBe("first_party");
    expect(zerua?.notDanceNights).toEqual(["Top of Twilight"]);
  });

  it("reads Allevents.in as mixed JSON-LD directories with its checked non-dance titles", () => {
    const platformSeeds = MUMBAI_SOURCES.filter((seed) => /allevents\.in/.test(seed.url));
    expect(platformSeeds).toHaveLength(4);
    for (const seed of platformSeeds) {
      expect(seed.kind).toBe("jsonld");
      expect(seed.platform).toBe("jsonld_items");
      expect(seed.trustTier).toBe("directory");
      expect(seed.mixedCalendar).toBe(true);
      expect(seed.notDanceNights).toContain("CHEMBUR KIDS CARNIVAL");
      expect(seed.notDanceNights).toContain("Bollywood Musical Jashn Season 4");
      expect(seed.notDanceNights).toContain(
        "Lebanese Food Festival at the Poolside Cafe | 3rd to 10th November.",
      );
      expect(seed.danceNights).toEqual(["Bombay Velvet *"]);
    }
  });

  it("reads District's nightlife and music pages once a day as mixed JSON-LD directories (D-542)", () => {
    const district = MUMBAI_SOURCES.filter((seed) => seed.url.includes("district.in"));
    expect(district.map((seed) => seed.url).sort()).toEqual([
      "https://www.district.in/events/music-in-mumbai-book-tickets",
      "https://www.district.in/events/nightlife-in-mumbai-book-tickets",
      "https://www.district.in/events/nightlife-this-weekend-in-mumbai",
    ]);
    for (const seed of district) {
      expect(seed.kind).toBe("jsonld");
      expect(seed.platform).toBe("jsonld_items");
      expect(seed.trustTier).toBe("directory");
      expect(seed.mixedCalendar).toBe(true);
      expect(seed.notDanceNights).toContain("Karaoke Thursday at Nosh and Beyond Café and Bar");
      // robots.txt blocks /*?: no query-string paging.
      expect(seed.url).not.toContain("?");
    }
    const retiredDistrict = MUMBAI_RETIRED.filter((r) => r.url.includes("district.in"));
    expect(retiredDistrict.map((r) => r.url).sort()).toEqual([
      "https://www.district.in/events/social-mixers-in-mumbai-book-tickets",
      "https://www.district.in/events/upcoming-events-in-mumbai",
    ]);
  });

  it("keeps Allevents' Bombay Velvet DJ nights past the no-dance screen (D-620)", () => {
    const seed = MUMBAI_SOURCES.find((s) => s.url === "https://allevents.in/mumbai/parties?page=3");
    expect(
      isNamedDanceNight("Bombay Velvet 2.0 Ft. DJ Ganesh at Dragonfly", seed?.danceNights),
    ).toBe(true);
    expect(isNamedDanceNight("Velvet Bombay Night", seed?.danceNights)).toBe(false);
  });

  it("retires the non-dance calendars discovery switched on (2026-11-01)", () => {
    expect(retired).toContain("https://warehouse.g5a.org/calendar/");
    expect(retired).toContain("https://www.raceconferences.com/");
    expect(retired).toContain("https://vrohospitality.com/");
    expect(retired).toContain("https://www.powaifinearts.org/");
    expect(retired).toContain("https://ymcabombay.org/");
    expect(MUMBAI_SOURCES.some((seed) => retired.includes(seed.url))).toBe(false);
  });

  it("reads SkillBox through its platform API as a directory filtered by its dance categories (D-621)", () => {
    const skillbox = MUMBAI_SOURCES.filter((seed) => seed.platform === "skillbox");
    expect(skillbox).toHaveLength(1);
    expect(skillbox[0]).toMatchObject({
      url: "https://www.skillboxes.com/events",
      kind: "platform_api",
      trustTier: "directory",
      mixedCalendar: false,
      styles: ["club"],
    });
    expect(skillbox[0]?.notDanceNights).toEqual(["Damru live at Waves- Sonic Diwali"]);
  });

  it("reads Kitty Su's own events page as a page source (blocked-platform audit, D-758)", () => {
    const kittySu = MUMBAI_SOURCES.find((s) => s.url === "https://kittysu.com/events");
    expect(kittySu).toMatchObject({
      kind: "html",
      trustTier: "first_party",
      label: "Kitty Su",
      styles: ["club"],
    });
    expect(kittySu?.platform).toBeUndefined();
  });

  it("places 92NY at its Lexington Avenue address (blocked-platform audit, D-758)", () => {
    const y = KNOWN_VENUES.nyc?.find((v) => v.names.includes("92NY"));
    expect(y?.address).toBe("1395 Lexington Ave, New York, NY 10128");
  });
});
