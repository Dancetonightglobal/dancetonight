// The Delhi starting list keeps its own promises (D-047, D-110): one row per address, only
// http(s), no Squarespace ?format= view, and no Resident Advisor pages (D-505).
import { describe, expect, it } from "vitest";

import { KNOWN_VENUES } from "@/config/known-venues";
import { DELHI_RETIRED, DELHI_SOURCES, DISTRICT_NOT_DANCE } from "@/config/sources/delhi";
import { STYLES } from "@/config/styles";
import { isNamedDanceNight } from "@/src/domain/listing-screen";

const listed = DELHI_SOURCES.map((seed) => seed.url);
const retired = DELHI_RETIRED.map((gone) => gone.url);

describe("Delhi's starting list", () => {
  it("lists each address once, retired addresses are unique, and every url and feedUrl is http(s)", () => {
    expect(new Set(listed).size).toBe(listed.length);
    expect(new Set(retired).size).toBe(retired.length);
    for (const url of [...listed, ...retired]) {
      expect(new URL(url).protocol).toMatch(/^https?:$/);
    }
    for (const seed of DELHI_SOURCES) {
      if (seed.feedUrl) {
        expect(new URL(seed.feedUrl).protocol).toMatch(/^https?:$/);
      }
    }
  });

  it("never lists an address it has retired", () => {
    expect(listed.filter((url) => retired.includes(url))).toEqual([]);
  });

  it("asks for no ?format= view, which Squarespace's robots.txt disallows", () => {
    for (const seed of DELHI_SOURCES) {
      expect(seed.url).not.toMatch(/[?&]format=/);
      expect(seed.feedUrl ?? "").not.toMatch(/[?&]format=/);
    }
  });

  it("keeps Resident Advisor out of its own file: RA comes only from config/sources/ra.ts (D-505)", () => {
    for (const seed of DELHI_SOURCES) {
      expect(seed.url).not.toMatch(/ra\.co|residentadvisor\.net/);
      expect(seed.feedUrl ?? "").not.toMatch(/ra\.co|residentadvisor\.net/);
    }
  });

  it("every feed_ics source has a feedUrl, and every squarespace source has platform: 'squarespace'", () => {
    for (const seed of DELHI_SOURCES) {
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
    for (const seed of DELHI_SOURCES) {
      for (const style of seed.styles) {
        expect(styleKeys).toContain(style);
      }
    }
  });

  it("reads Eventbrite organisers through the API only, as mixed calendars (D-015, D-131)", () => {
    const organisers = DELHI_SOURCES.filter((s) => s.platform === "eventbrite");
    // The list may be empty initially, but if present they must follow these rules
    for (const seed of organisers) {
      expect(seed.url).toMatch(/^https:\/\/www\.eventbrite\.(com|tr)\/o\/\d+$/);
      expect(seed.kind).toBe("ticketing_api");
      expect(seed.trustTier).toBe("ticketing");
      expect(seed.mixedCalendar).toBe(true);
    }
  });

  it("reads DICE's Delhi browse pages (D-139, D-197) and any Meetup group's own feed", () => {
    const dice = DELHI_SOURCES.filter((s) => s.platform === "dice");
    // The list may be empty initially, but if present they must follow the pattern
    for (const seed of dice) {
      expect(seed.url).toMatch(/^https:\/\/dice\.fm\/browse\/delhi-[a-f0-9]+\/music\//);
    }
    const meetups = DELHI_SOURCES.filter((s) => s.url.startsWith("https://www.meetup.com/"));
    for (const seed of meetups) {
      expect(seed.feedUrl).toMatch(/\/events\/ical\//);
    }
  });

  it("reads any directory sources as directories, never as the organiser", () => {
    const directories = DELHI_SOURCES.filter((s) => s.trustTier === "directory");
    for (const seed of directories) {
      // Directory sources can be html, jsonld (e.g., Xceed in Barcelona) or a platform API (SkillBox)
      expect(["html", "jsonld", "platform_api"]).toContain(seed.kind);
      expect(seed.url).not.toMatch(/\/tags\/|\.ics$/);
    }
  });

  it("reads any dance-only calendars as such, never screened as mixed ones", () => {
    const danceOnly = DELHI_SOURCES.filter((s) => s.mixedCalendar === false);
    for (const seed of danceOnly) {
      expect(seed.trustTier).toBe("directory");
    }
  });

  it("maps any titleVenues to their venues, each a Delhi KnownVenue (D-279)", () => {
    for (const seed of DELHI_SOURCES) {
      if (seed.titleVenues) {
        const known = (KNOWN_VENUES.delhi ?? []).flatMap((v) => v.names);
        for (const venue of Object.values(seed.titleVenues)) {
          expect(known).toContain(venue);
        }
      }
    }
  });

  it("the Allevents rows are exactly the 3 urls above, each kind: 'jsonld', platform: 'jsonld_items', mixedCalendar: true", () => {
    const allevents = DELHI_SOURCES.filter((s) => s.url.includes("allevents.in"));
    expect(allevents).toHaveLength(3);
    expect(allevents.map((s) => s.url)).toEqual([
      "https://allevents.in/new-delhi/parties",
      "https://allevents.in/new-delhi/parties?page=2",
      "https://allevents.in/new-delhi/parties?page=3",
    ]);
    for (const seed of allevents) {
      expect(seed.kind).toBe("jsonld");
      expect(seed.platform).toBe("jsonld_items");
      expect(seed.mixedCalendar).toBe(true);
    }
  });

  it("isNamedDanceNight('Disco Flower Workshop', row.notDanceNights) is true for the first Allevents row, and isNamedDanceNight('Adam Port Official Afterparty', row.notDanceNights) is false", () => {
    const firstAllevents = DELHI_SOURCES.find(
      (s) => s.url === "https://allevents.in/new-delhi/parties",
    );
    expect(firstAllevents).toBeDefined();
    expect(isNamedDanceNight("Disco Flower Workshop", firstAllevents?.notDanceNights)).toBe(true);
    expect(isNamedDanceNight("Adam Port Official Afterparty", firstAllevents?.notDanceNights)).toBe(
      false,
    );
  });

  it("isNamedDanceNight('\"YAARAANA\" MUSHAIRA & KAVI SAMMELAN', row.notDanceNights) is true", () => {
    const firstAllevents = DELHI_SOURCES.find(
      (s) => s.url === "https://allevents.in/new-delhi/parties",
    );
    expect(firstAllevents).toBeDefined();
    expect(
      isNamedDanceNight('"YAARAANA" MUSHAIRA & KAVI SAMMELAN', firstAllevents?.notDanceNights),
    ).toBe(true);
  });

  it("the TicketFairy row has platform 'ticketfairy', trustTier 'ticketing', mixedCalendar true", () => {
    const ticketFairy = DELHI_SOURCES.find((s) => s.platform === "ticketfairy");
    expect(ticketFairy).toBeDefined();
    expect(ticketFairy?.platform).toBe("ticketfairy");
    expect(ticketFairy?.trustTier).toBe("ticketing");
    expect(ticketFairy?.mixedCalendar).toBe(true);
  });

  it("the Salsa Vida row's styles are ['salsa', 'bachata', 'kizomba']", () => {
    const salsaVida = DELHI_SOURCES.find(
      (s) => s.url === "https://www.salsavida.com/guides/india/new-delhi/",
    );
    expect(salsaVida).toBeDefined();
    expect(salsaVida?.styles).toEqual(["salsa", "bachata", "kizomba"]);
  });

  it("reads SkillBox for Delhi through its API as a dance-only directory", () => {
    const skillbox = DELHI_SOURCES.find((s) => s.platform === "skillbox");
    expect(skillbox).toBeDefined();
    expect(skillbox?.kind).toBe("platform_api");
    expect(skillbox?.trustTier).toBe("directory");
    expect(skillbox?.mixedCalendar).toBe(false);
  });

  it("reads Privee and Kitty Su from their own pages", () => {
    const privee = DELHI_SOURCES.find((s) => s.url === "https://www.priveenewdelhi.com/events");
    expect(privee).toBeDefined();
    expect(privee?.kind).toBe("html");
    expect(privee?.trustTier).toBe("first_party");

    const kittySu = DELHI_SOURCES.find((s) => s.url === "https://www.kittysu.com/events");
    expect(kittySu).toBeDefined();
    expect(kittySu?.kind).toBe("html");
    expect(kittySu?.trustTier).toBe("first_party");

    // Ensure no Delhi row uses the Mumbai URL
    const mumbaiKittySu = DELHI_SOURCES.find((s) => s.url === "https://kittysu.com/events");
    expect(mumbaiKittySu).toBeUndefined();
  });

  it("the District rows are exactly the 2 urls, each kind: 'jsonld', platform: 'jsonld_items', mixedCalendar: true, notDanceNights equal to DISTRICT_NOT_DANCE", () => {
    const districtRows = DELHI_SOURCES.filter((s) =>
      s.url.includes("district.in/events/nightlife"),
    );
    expect(districtRows).toHaveLength(2);
    expect(districtRows.map((s) => s.url)).toEqual([
      "https://www.district.in/events/nightlife-in-delhi-book-tickets",
      "https://www.district.in/events/nightlife-this-weekend-in-delhi",
    ]);
    for (const row of districtRows) {
      expect(row.kind).toBe("jsonld");
      expect(row.platform).toBe("jsonld_items");
      expect(row.mixedCalendar).toBe(true);
      expect(row.notDanceNights).toEqual(DISTRICT_NOT_DANCE);
    }
  });

  it("isNamedDanceNight('Karaoke Night at Gonzo', row.notDanceNights) is true and isNamedDanceNight('Afro Arabic House - Friday Special', row.notDanceNights) is false for the first District row", () => {
    const firstDistrict = DELHI_SOURCES.find(
      (s) => s.url === "https://www.district.in/events/nightlife-in-delhi-book-tickets",
    );
    expect(firstDistrict).toBeDefined();
    expect(isNamedDanceNight("Karaoke Night at Gonzo", firstDistrict?.notDanceNights)).toBe(true);
    expect(
      isNamedDanceNight("Afro Arabic House - Friday Special", firstDistrict?.notDanceNights),
    ).toBe(false);
  });

  it("the two Zorba rows have kind: 'jsonld', trustTier: 'ticketing', styles ['ecstatic'], no platform and no mixedCalendar", () => {
    const zorbaRows = DELHI_SOURCES.filter(
      (s) =>
        s.url.includes("district.in/events/drums-dance") ||
        s.url.includes("district.in/events/circle-of-mystical-dances"),
    );
    expect(zorbaRows).toHaveLength(2);
    for (const row of zorbaRows) {
      expect(row.kind).toBe("jsonld");
      expect(row.trustTier).toBe("ticketing");
      expect(row.styles).toEqual(["ecstatic"]);
      expect(row.platform).toBeUndefined();
      expect(row.mixedCalendar).toBeUndefined();
    }
  });

  it("the Soho row has platform: 'eventbrite', kind: 'ticketing_api', mixedCalendar: true", () => {
    const sohoRow = DELHI_SOURCES.find(
      (s) => s.platform === "eventbrite" && s.url.includes("120880646548"),
    );
    expect(sohoRow).toBeDefined();
    expect(sohoRow?.platform).toBe("eventbrite");
    expect(sohoRow?.kind).toBe("ticketing_api");
    expect(sohoRow?.mixedCalendar).toBe(true);
  });
});
