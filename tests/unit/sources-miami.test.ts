// The Miami starting list keeps its own promises (D-047, D-110): one row per address, only
// http(s), no Squarespace ?format= view, and no Resident Advisor pages (D-034).
import { describe, expect, it } from "vitest";

import { MIAMI_RETIRED, MIAMI_SOURCES } from "@/config/sources/miami";
import { STYLES } from "@/config/styles";

const listed = MIAMI_SOURCES.map((seed) => seed.url);
const retired = MIAMI_RETIRED.map((gone) => gone.url);

describe("Miami's starting list", () => {
  it("lists each address once, retired addresses are unique, and every url and feedUrl is http(s)", () => {
    expect(new Set(listed).size).toBe(listed.length);
    expect(new Set(retired).size).toBe(retired.length);
    for (const url of [...listed, ...retired]) {
      expect(new URL(url).protocol).toMatch(/^https?:$/);
    }
    for (const seed of MIAMI_SOURCES) {
      if (seed.feedUrl) {
        expect(new URL(seed.feedUrl).protocol).toMatch(/^https?:$/);
      }
    }
  });

  it("never lists an address it has retired", () => {
    expect(listed.filter((url) => retired.includes(url))).toEqual([]);
  });

  it("asks for no ?format= view, which Squarespace's robots.txt disallows", () => {
    for (const seed of MIAMI_SOURCES) {
      expect(seed.url).not.toMatch(/[?&]format=/);
      expect(seed.feedUrl ?? "").not.toMatch(/[?&]format=/);
    }
  });

  it("keeps Resident Advisor out of its own file: RA comes only from config/sources/ra.ts (D-505)", () => {
    for (const seed of MIAMI_SOURCES) {
      expect(seed.url).not.toMatch(/ra\.co|residentadvisor\.net/);
      expect(seed.feedUrl ?? "").not.toMatch(/ra\.co|residentadvisor\.net/);
    }
  });

  it("every feed_ics source has a feedUrl, and every squarespace source has platform: 'squarespace'", () => {
    for (const seed of MIAMI_SOURCES) {
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
    for (const seed of MIAMI_SOURCES) {
      for (const style of seed.styles) {
        expect(styleKeys).toContain(style);
      }
    }
  });

  it("reads Eventbrite organisers through the API only, as mixed calendars (D-015, D-131)", () => {
    const organisers = MIAMI_SOURCES.filter((s) => s.platform === "eventbrite");
    expect(organisers.length).toBe(31);
    for (const seed of organisers) {
      expect(seed.url).toMatch(/^https:\/\/www\.eventbrite\.com\/o\/(?:[a-z0-9-]+-)?\d+$/);
      expect(seed.kind).toBe("ticketing_api");
      expect(seed.trustTier).toBe("ticketing");
      expect(seed.mixedCalendar).toBe(true);
    }
  });

  it("reads DICE's Miami browse pages (D-139, D-197) and two Meetup groups' own feeds (D-035 Q6)", () => {
    const dice = MIAMI_SOURCES.filter((s) => s.platform === "dice");
    expect(dice.length).toBeGreaterThan(2);
    for (const seed of dice) {
      expect(seed.url).toMatch(
        /^https:\/\/dice\.fm\/browse\/miami-5e3bf1b0fe75488ec46cdf9f\/music\//,
      );
    }
    const meetups = MIAMI_SOURCES.filter((s) => s.url.startsWith("https://www.meetup.com/"));
    expect(meetups.map((s) => s.feedUrl)).toEqual([
      "https://www.meetup.com/miamisalsaevents/events/ical/",
      "https://www.meetup.com/the-salsa-cooperative-miami/events/ical/",
    ]);
  });

  it("leaves out organisers that meet outside Miami-Dade", () => {
    // VK Dance Arena / Bachata Overdose and Miami Bachata Motion are in Hallandale Beach; the "swingdance"
    // Meetup group meets in Fort Lauderdale.
    for (const id of ["41065630183", "121360881827"]) {
      expect(listed.some((url) => url.endsWith(id))).toBe(false);
    }
    expect(listed.some((url) => url.includes("meetup.com/swingdance"))).toBe(false);
  });

  it("reads Salsa Vida's Miami guide as a directory, never as the organiser (D-321)", () => {
    const guide = MIAMI_SOURCES.find((s) => s.label === "Salsa Vida Miami");
    expect(guide?.url).toBe("https://www.salsavida.com/guides/florida/miami/");
    expect(guide?.trustTier).toBe("directory");
  });

  it("reads the recall-gap sources: Afro Events Miami, Hoy Como Ayer, EXPANSION", () => {
    expect(retired).toContain("https://www.eventbrite.com/o/city-of-coral-gables-8842135697");
    expect(retired).toContain("https://www.eventbrite.com/o/pier-5-56549886523");
    expect(listed).toContain("https://www.eventbrite.com/o/afro-events-miami-15315193124");
    const hoy = MIAMI_SOURCES.find((s) => s.url === "https://ma.to/venue/hoycomoayer.miami");
    expect(hoy?.trustTier).toBe("directory");
    expect(hoy?.kind).toBe("html");
    const expansion = MIAMI_SOURCES.find(
      (s) => s.url === "https://www.ecstatic-flow.com/danceevents",
    );
    expect(expansion?.kind).toBe("wix");
    expect(expansion?.platform).toBe("wix_events");
    expect(expansion?.styles).toEqual(["ecstatic_dance"]);
  });

  it("reads Copper Blues Doral, never danceus.org or sabaki.dance (their terms forbid it)", () => {
    expect(listed.some((url) => url.includes("danceus.org"))).toBe(false);
    expect(listed.some((url) => url.includes("sabaki.dance"))).toBe(false);
    const copper = MIAMI_SOURCES.find(
      (s) => s.url === "https://copperblueslive.com/locations/miami/live-music/",
    );
    expect(copper?.trustTier).toBe("first_party");
    expect(copper?.venuePage).toBe(true);
    expect(copper?.mixedCalendar).toBe(true);
    expect(copper?.venueAddress).toBe("3450 NW 83rd Ave, Suite 224, Doral, FL 33122");
  });

  it("reads where-to-dance-salsa's Miami salsa and bachata pages as directories (D-323)", () => {
    for (const url of [
      "https://where-to-dance-salsa.com/salsa/miami/",
      "https://where-to-dance-salsa.com/bachata/miami/",
    ]) {
      const page = MIAMI_SOURCES.find((s) => s.url === url);
      expect(page?.trustTier).toBe("directory");
      expect(page?.kind).toBe("html");
    }
  });

  it("reads Out x Out's Miami events calendar as a mixed directory, with permission (D-545, D-558)", () => {
    const oxo = MIAMI_SOURCES.filter((s) => s.url.startsWith("https://outxout.com/"));
    expect(oxo.map((s) => s.url)).toEqual(["https://outxout.com/events/miami-fl"]);
    expect(oxo[0]?.kind).toBe("jsonld");
    expect(oxo[0]?.trustTier).toBe("directory");
    expect(oxo[0]?.mixedCalendar).toBe(true);
    expect(oxo[0]?.notDanceNights).toContain("The Real Drag Brunch of Miami (Sunday)");
    expect(oxo[0]?.notDanceNights).toContain("Tacos, Tequila & Tiaras");
  });

  it("retires the non-dance sources discovery switched on before the 11-01 full read", () => {
    for (const url of [
      "https://www.implantseminars.com/",
      "https://bottledblondescottsdale.com/events/",
      "https://calendar.mdc.edu/",
      "https://regattagrove.com/events",
      "http://www.lagniappehouse.com/music-schedule.html",
      "http://acscc.org/",
      "https://churchillspub.com/cart/",
      "https://ligacontraelcancer.org",
      "https://www.mooseintl.org/",
    ]) {
      expect(retired).toContain(url);
      expect(listed).not.toContain(url);
    }
  });

  it("retires the non-dance sources discovery switched on before the 11-02 daily read", () => {
    for (const url of ["https://palacesouthbeach.com/", "https://themojitobar.com"]) {
      expect(retired).toContain(url);
      expect(listed).not.toContain(url);
    }
  });

  it("lists Rosario's stated nightly hours as fixed nights, citing its dancing (D-527)", () => {
    const rosario = MIAMI_SOURCES.find((s) => s.url === "https://rosariomiami.com/contact/");
    expect(rosario?.trustTier).toBe("first_party");
    expect(rosario?.venuePage).toBe(true);
    expect(rosario?.onlyHere).toBe(true);
    const nights = rosario?.fixedNights ?? [];
    expect(nights.map((n) => n.days)).toEqual([
      [0, 1, 2, 3, 4],
      [5, 6],
    ]);
    expect(nights.map((n) => [n.start, n.end])).toEqual([
      ["21:00", "05:00"],
      ["19:00", "05:00"],
    ]);
    for (const n of nights) expect(n.danceCited).toContain("LATIN PARTY");
  });

  it("reads The White Elephant Bar's ma.to venue page as a mixed directory", () => {
    const we = MIAMI_SOURCES.find((s) => s.url === "https://ma.to/venue/thewhiteelephantbar");
    expect(we?.trustTier).toBe("directory");
    expect(we?.mixedCalendar).toBe(true);
  });
});
