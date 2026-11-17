// The Tokyo starting list keeps its own promises (D-047, D-110, D-1220): one row per address, only http(s), no
// Squarespace ?format= view, no Resident Advisor pages in its own file (D-505), real style keys.
import { describe, expect, it } from "vitest";

import { METRO_SOURCES } from "@/config/sources";
import { TOKYO_RETIRED, TOKYO_SOURCES } from "@/config/sources/tokyo";
import { STYLES } from "@/config/styles";

const listed = TOKYO_SOURCES.map((seed) => seed.url);
const retired = TOKYO_RETIRED.map((gone) => gone.url);

describe("Tokyo's starting list", () => {
  it("lists each address once, retired addresses are unique, and every url is http(s)", () => {
    expect(new Set(listed).size).toBe(listed.length);
    expect(new Set(retired).size).toBe(retired.length);
    for (const url of [...listed, ...retired]) {
      expect(new URL(url).protocol).toMatch(/^https?:$/);
    }
  });

  it("never lists an address it has retired", () => {
    expect(listed.filter((url) => retired.includes(url))).toEqual([]);
  });

  it("asks for no ?format= view and keeps Resident Advisor out of its own file (D-505)", () => {
    for (const seed of TOKYO_SOURCES) {
      expect(seed.url).not.toMatch(/[?&]format=/);
      expect(seed.url).not.toMatch(/ra\.co|residentadvisor\.net/);
    }
  });

  it("every style named by a source is a real style key", () => {
    const styleKeys = STYLES.map((s) => s.key);
    for (const seed of TOKYO_SOURCES) {
      for (const style of seed.styles) {
        expect(styleKeys).toContain(style);
      }
    }
  });

  it("no source url is from a blocked host (facebook, instagram, peatix, iflyer, clubberia, zaiko, livepocket, timeout, calendar.google)", () => {
    const blockedHosts = [
      "facebook.com",
      "instagram.com",
      "peatix.com",
      "iflyer.tv",
      "clubberia.com",
      "zaiko.io",
      "livepocket.jp",
      "timeout.com",
      "calendar.google.com",
    ];
    for (const seed of TOKYO_SOURCES) {
      const host = new URL(seed.url).hostname;
      // A hand-checked own-Instagram seed is never fetched (D-796/D-797): it is read by hand in the owner's browser.
      const handCheckedIg = seed.handChecked === true && host === "www.instagram.com";
      for (const blocked of handCheckedIg
        ? blockedHosts.filter((b) => b !== "instagram.com")
        : blockedHosts) {
        expect(host).not.toContain(blocked);
      }
    }
  });

  it("every row with venuePage: true has a venueAddress starting with Japanese postcode and 東京都", () => {
    const venueRows = TOKYO_SOURCES.filter((s) => s.venuePage);
    for (const row of venueRows) {
      expect(row.venueAddress).toBeDefined();
      expect(row.venueAddress).toMatch(/^〒\d{3}-\d{4} 東京都/);
    }
  });

  it("the six Meetup rows have kind feed_ics, mixedCalendar true and feedUrl ending in /events/ical/", () => {
    const meetupRows = TOKYO_SOURCES.filter((s) => s.kind === "feed_ics");
    expect(meetupRows).toHaveLength(6);
    for (const row of meetupRows) {
      expect(row.mixedCalendar).toBe(true);
      expect(row.feedUrl).toBeDefined();
      expect(row.feedUrl).toMatch(/\/events\/ical\/$/);
    }
  });

  it("the Salsa Vida row has mixedCalendar false", () => {
    const salsaVida = TOKYO_SOURCES.find((s) => s.label === "Salsa Vida Tokyo");
    expect(salsaVida?.mixedCalendar).toBe(false);
  });

  it("is wired with METRO_SOURCES.tokyo containing every TOKYO_SOURCES url", () => {
    const all = METRO_SOURCES["tokyo"] ?? [];
    const metroUrls = all.map((s) => s.url);
    for (const source of TOKYO_SOURCES) {
      expect(metroUrls).toContain(source.url);
    }
  });

  it("lists Leon's event page and retires the undated weekly pages (D-1233)", () => {
    const leon = TOKYO_SOURCES.find((s) => s.url === "http://www.latinclub-leon.com/event.html");
    expect(leon).toBeDefined();
    expect(leon?.venuePage).toBe(true);

    // The undated weekly pages are retired
    const fiestaRow = TOKYO_SOURCES.find((s) => s.url === "https://www.fiesta-latinspotbar.com/");
    expect(fiestaRow).toBeUndefined();
    const lasRisasLessonRow = TOKYO_SOURCES.find(
      (s) => s.url === "https://www.lasrisas.com/lesson.html",
    );
    expect(lasRisasLessonRow).toBeUndefined();

    // They appear in TOKYO_RETIRED
    const retiredUrls = TOKYO_RETIRED.map((r) => r.url);
    expect(retiredUrls).toContain("https://www.fiesta-latinspotbar.com/");
    expect(retiredUrls).toContain("https://www.lasrisas.com/lesson.html");

    expect(TOKYO_SOURCES).toHaveLength(20);
  });

  it("reads Las Risas's and Studio JBA's Google Calendars through the API (D-1231)", () => {
    const lasRisasCalendar = TOKYO_SOURCES.find((s) => s.url === "https://www.lasrisas.com/");
    expect(lasRisasCalendar).toBeDefined();
    expect(lasRisasCalendar?.kind).toBe("feed_gcal");
    expect(lasRisasCalendar?.platform).toBe("feed_gcal");
    expect(lasRisasCalendar?.venuePage).toBe(true);
    expect(lasRisasCalendar?.onlyHere).toBe(true);
    expect(lasRisasCalendar?.mixedCalendar).toBe(true);
    expect(lasRisasCalendar?.venueAddress).toBeDefined();
    expect(lasRisasCalendar?.venueAddress).toMatch(/^〒/);
    expect(lasRisasCalendar?.venueAddress).toContain("東京都");

    const studioJBA = TOKYO_SOURCES.find((s) => s.url === "https://studiojba.com/schedule/");
    expect(studioJBA).toBeDefined();
    expect(studioJBA?.kind).toBe("feed_gcal");
    expect(studioJBA?.platform).toBe("feed_gcal");
    expect(studioJBA?.venuePage).toBe(true);
    expect(studioJBA?.onlyHere).toBe(true);
    expect(studioJBA?.mixedCalendar).toBe(true);
    expect(studioJBA?.venueAddress).toBeDefined();
    expect(studioJBA?.venueAddress).toMatch(/^〒/);
    expect(studioJBA?.venueAddress).toContain("東京都");

    // Ensure no TOKYO_SOURCES url contains calendar.google.com
    for (const source of TOKYO_SOURCES) {
      expect(source.url).not.toContain("calendar.google.com");
    }
  });

  it("lists Dance Hall Shinseiki's monthly schedule as a mixed ballroom calendar (D-1232)", () => {
    const shinseiki = TOKYO_SOURCES.find(
      (s) => s.url === "http://bossiweb.com/shinseiki/schedule/schedule.php",
    );
    expect(shinseiki).toBeDefined();
    expect(shinseiki?.kind).toBe("html");
    expect(shinseiki?.styles).toEqual(["ballroom"]);
    expect(shinseiki?.mixedCalendar).toBe(true);
    expect(shinseiki?.venuePage).toBe(true);
    expect(shinseiki?.onlyHere).toBe(true);
    expect(shinseiki?.venueAddress).toBeDefined();
    expect(shinseiki?.venueAddress).toMatch(/^〒110-0003 東京都台東区/);

    const zoukMeetup = TOKYO_SOURCES.find(
      (s) => s.url === "https://www.meetup.com/tokyo-bachata-salsa-zouk-meetup-group/events/",
    );
    expect(zoukMeetup).toBeDefined();
    expect(zoukMeetup?.styles).toContain("brazilian_zouk");
  });
  it("keeps the checked no-dance-word titles of JBA and Las Risas, and Shinseiki's bands (D-1233)", () => {
    const jbaRow = TOKYO_SOURCES.find((s) => s.url === "https://studiojba.com/schedule/");
    expect(jbaRow?.danceNights).toBeDefined();
    expect(jbaRow?.danceNights).not.toContain("お祭りマンボ");
    expect(jbaRow?.danceNights).toContain("SMILESALSA");
    // No entry containing "pv" (case-insensitive)
    const hasPv = jbaRow?.danceNights?.some((n) => n.toLowerCase().includes("pv"));
    expect(hasPv).toBe(false);

    const lasRisasCalendarRow = TOKYO_SOURCES.find((s) => s.url === "https://www.lasrisas.com/");
    expect(lasRisasCalendarRow?.danceNights).toBeDefined();
    expect(lasRisasCalendarRow?.danceNights).toContain("GOZARISAS in Latin Bar Las Risas");

    const shinseikiRow = TOKYO_SOURCES.find(
      (s) => s.url === "http://bossiweb.com/shinseiki/schedule/schedule.php",
    );
    expect(shinseikiRow?.bandsForDancers).toBe(true);
    expect(shinseikiRow?.mixedCalendar).toBe(true);
  });
  it("hand-checked Instagram seeds are weekly own-IG nights with evidence (D-796)", () => {
    const ig = TOKYO_SOURCES.filter((s) => new URL(s.url).hostname === "www.instagram.com");
    expect(ig.map((s) => s.url).sort()).toEqual([
      "https://www.instagram.com/artyfarty_tokyo/",
      "https://www.instagram.com/egoland_latin/",
      "https://www.instagram.com/elcafelatinojapan/",
    ]);
    for (const seed of ig) {
      expect(seed.handChecked).toBe(true);
      expect(seed.fixedNights?.length).toBeGreaterThan(0);
      for (const night of seed.fixedNights ?? []) {
        expect(night.checkedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(night.evidenceUrl).toMatch(/^https:\/\/www\.instagram\.com\/p\//);
        expect(night.danceCited).toBeTruthy();
      }
    }
  });

  it("reads ZOUK TOKYO and AiSOTOPE LOUNGE's own dated event pages (D-1238)", () => {
    const zouk = TOKYO_SOURCES.find((s) => s.url === "https://www.zoukgrouptky.com/");
    expect(zouk).toBeDefined();
    expect(zouk?.trustTier).toBe("first_party");
    expect(zouk?.kind).toBe("html");
    expect(zouk?.venuePage).toBe(true);
    expect(zouk?.onlyHere).toBe(true);
    expect(zouk?.venueAddress).toContain("銀座7-2-18");
    expect(zouk?.styles).toContain("dj_night");
    expect(zouk?.fixedNights).toBeUndefined();

    const aiso = TOKYO_SOURCES.find((s) => s.url === "https://aisotope-lounge.net/");
    expect(aiso).toBeDefined();
    expect(aiso?.trustTier).toBe("first_party");
    expect(aiso?.mixedCalendar).toBe(true);
    expect(aiso?.venuePage).toBe(true);
    expect(aiso?.venueAddress).toContain("新宿2-12-16");
    expect(aiso?.styles).toEqual(["queer_party", "dj_night"]);
  });
  it("reads MAHARAJA's dated schedule and lists KENTO'S Ginza's own opening hours (D-1239)", () => {
    const maharaja = TOKYO_SOURCES.find((s) => s.url === "https://maharaja-r.jp/schedule2/");
    expect(maharaja?.trustTier).toBe("first_party");
    expect(maharaja?.mixedCalendar).toBeUndefined(); // D-1243: a disco, not a mixed calendar
    expect(maharaja?.venueAddress).toContain("六本木6-1-3");
    expect(maharaja?.fixedNights).toBeUndefined();

    const kentos = TOKYO_SOURCES.find((s) => s.url === "https://ginza.kentos-group.co.jp/");
    expect(kentos?.bandsForDancers).toBe(true);
    expect(kentos?.venueAddress).toContain("銀座8-2-1");
    const nights = kentos?.fixedNights ?? [];
    expect(nights.map((n) => n.title)).toEqual([
      "Oldies live bands at KENTO'S Ginza",
      "Sunday oldies live bands at KENTO'S Ginza",
    ]);
    expect(nights.flatMap((n) => n.days).sort()).toEqual([0, 1, 2, 3, 4, 5, 6]);
    for (const night of nights) {
      expect(night.danceCited).toContain("踊るも良し");
      expect(night.checkedOn).toBeUndefined();
    }

    const arty = TOKYO_SOURCES.find((s) => s.url === "https://www.instagram.com/artyfarty_tokyo/");
    expect(arty?.handChecked).toBe(true);
    expect(arty?.fixedNights?.[0]?.days).toEqual([5, 6]);
  });
});
