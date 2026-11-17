// The Philadelphia starting list keeps its own promises (D-047, D-110): one row per address, only
// http(s), no Squarespace ?format= view, and no Resident Advisor pages (D-034).
import { describe, expect, it } from "vitest";

import { PHILADELPHIA_RETIRED, PHILADELPHIA_SOURCES } from "@/config/sources/philadelphia";
import { STYLES } from "@/config/styles";

const listed = PHILADELPHIA_SOURCES.map((seed) => seed.url);
const retired = PHILADELPHIA_RETIRED.map((gone) => gone.url);

describe("Philadelphia's starting list", () => {
  it("lists each address once, retired addresses are unique, and every url and feedUrl is http(s)", () => {
    expect(new Set(listed).size).toBe(listed.length);
    expect(new Set(retired).size).toBe(retired.length);
    for (const url of [...listed, ...retired]) {
      expect(new URL(url).protocol).toMatch(/^https?:$/);
    }
    for (const seed of PHILADELPHIA_SOURCES) {
      if (seed.feedUrl) {
        expect(new URL(seed.feedUrl).protocol).toMatch(/^https?:$/);
      }
    }
  });

  it("never lists an address it has retired", () => {
    expect(listed.filter((url) => retired.includes(url))).toEqual([]);
  });

  it("asks for no ?format= view, which Squarespace's robots.txt disallows", () => {
    for (const seed of PHILADELPHIA_SOURCES) {
      expect(seed.url).not.toMatch(/[?&]format=/);
      expect(seed.feedUrl ?? "").not.toMatch(/[?&]format=/);
    }
  });

  it("keeps Resident Advisor out of its own file: RA comes only from config/sources/ra.ts (D-505)", () => {
    for (const seed of PHILADELPHIA_SOURCES) {
      const urlHost = new URL(seed.url).hostname;
      expect(urlHost).not.toMatch(/(\.|^)ra\.co$/);
      expect(urlHost).not.toMatch(/(\.|^)residentadvisor\.net$/);
      if (seed.feedUrl) {
        const feedHost = new URL(seed.feedUrl).hostname;
        expect(feedHost).not.toMatch(/(\.|^)ra\.co$/);
        expect(feedHost).not.toMatch(/(\.|^)residentadvisor\.net$/);
      }
    }
  });

  it("every feed_ics source has a feedUrl, and every squarespace source has platform: 'squarespace'", () => {
    for (const seed of PHILADELPHIA_SOURCES) {
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
    for (const seed of PHILADELPHIA_SOURCES) {
      for (const style of seed.styles) {
        expect(styleKeys).toContain(style);
      }
    }
  });

  it("reads Eventbrite organisers through the API only; clubs and promoters of dance nights only are not mixed calendars (D-015, D-131)", () => {
    const organisers = PHILADELPHIA_SOURCES.filter((s) => s.platform === "eventbrite");
    expect(organisers.length).toBe(19);
    for (const seed of organisers) {
      expect(seed.url).toMatch(/^https:\/\/www\.eventbrite\.com\/o\/[a-z0-9-]+-\d+$/);
      expect(seed.kind).toBe("ticketing_api");
      expect(seed.trustTier).toBe("ticketing");
    }
    // Venues and organisers that also sell shows, concerts or games nights stay mixed calendars.
    expect(
      organisers
        .filter((s) => s.mixedCalendar)
        .map((s) => s.url.replace(/^.*\/o\//, ""))
        .sort(),
    ).toEqual([
      "bob-barbaras-lounge-32476913085",
      "concert-crave-31633224317",
      "franky-bradleys-19213387803",
      "infusion-lounge-12259966201",
      "riot-nerd-13231604389",
      "the-trestle-inn-1583205400",
    ]);
  });

  it("every venueAddress is a City of Philadelphia ZIP or a near-suburb address (D-511)", () => {
    const nearSuburbs = [
      "129 Park Ave, Swarthmore, PA 19081",
      "49 E Lancaster Ave, Ardmore, PA 19003",
      "615 Montgomery Ave, Merion Station, PA 19066",
    ];
    for (const seed of PHILADELPHIA_SOURCES) {
      if (seed.venueAddress && !nearSuburbs.includes(seed.venueAddress)) {
        expect(seed.venueAddress).toMatch(/, Philadelphia, PA 191\d\d$/);
      }
    }
  });

  it("reads DICE's Philadelphia DJ and Party pages and its house genre page", () => {
    const diceSources = PHILADELPHIA_SOURCES.filter((s) => s.platform === "dice");
    expect(diceSources.length).toBe(3);
    expect(diceSources.some((s) => s.url.includes("/party/"))).toBe(false);
    for (const seed of diceSources) {
      expect(seed.url).toMatch(
        /^https:\/\/dice\.fm\/browse\/philadelphia-60f5b88857fe332ef6268244\/music\//,
      );
      expect(seed.label).toMatch(/^DICE Philadelphia: /);
    }
  });

  it("never reads a site that refused us or a Salsa Vida page outside Pennsylvania", () => {
    for (const seed of PHILADELPHIA_SOURCES) {
      expect(seed.url).not.toMatch(/brasilsnightclub\.com|ma\.to|facebook\.com|instagram\.com/);
      expect(seed.feedUrl ?? "").not.toMatch(
        /brasilsnightclub\.com|ma\.to|facebook\.com|instagram\.com/,
      );
    }
    const salsaVida = PHILADELPHIA_SOURCES.find((s) => s.label === "Salsa Vida Philadelphia");
    expect(salsaVida?.url).toContain("/guides/pennsylvania/philadelphia/");
  });

  it("seeds Ecstatic Dance Philly's TicketSpice dates page (D-573)", () => {
    const source = PHILADELPHIA_SOURCES.find(
      (s) => s.url === "https://phillyecstaticdance.ticketspice.com/info",
    );
    expect(source?.label).toBe("Ecstatic Dance Philly");
    expect(source?.styles).toEqual(["ecstatic_dance"]);
    expect(source?.venueAddress).toBe("1417 N 2nd St, Philadelphia, PA 19122");
  });

  it("reads Thursday Contra from its Meetup iCalendar export", () => {
    const contra = PHILADELPHIA_SOURCES.find((s) => s.label === "Thursday Contra (PATMAD)");
    expect(contra?.kind).toBe("feed_ics");
    expect(contra?.feedUrl).toBe("https://www.meetup.com/Mt-Airy-Contra-Dance/events/ical/");
  });

  it("reads Park Avenue Contra from its public Google Calendar", () => {
    const source = PHILADELPHIA_SOURCES.find(
      (s) => s.label === "Park Avenue Contra (Google Calendar)",
    );
    expect(source?.kind).toBe("feed_gcal");
    expect(source?.feedUrl).toBe(
      "https://calendar.google.com/calendar/ical/park.ave.contra%40gmail.com/public/basic.ics",
    );
    expect(source?.venueAddress).toContain("Swarthmore, PA 19081");
  });

  it("reads Pivot Ballroom's events page at its Ardmore address", () => {
    const source = PHILADELPHIA_SOURCES.find((s) => s.label === "Pivot Ballroom (Ardmore)");
    expect(source?.kind).toBe("html");
    expect(source?.mixedCalendar).toBe(true);
    expect(source?.venueAddress).toBe("49 E Lancaster Ave, Ardmore, PA 19003");
  });

  it("reads Saint Lazarus's weekly nights from its own page", () => {
    const source = PHILADELPHIA_SOURCES.find((s) => s.label === "Saint Lazarus Bar");
    expect(source?.weeklyGrid).toBe(true);
    expect(source?.mixedCalendar).toBe(true);
    expect(source?.danceNights).toContain("Ladies First Monday");
    expect(source?.danceNights).toContain("Tuesday Night Hangout");
  });

  describe("Philadelphia gap-analysis additions (D-524)", () => {
    it("reads Woody's weekly grid from its own page", () => {
      const source = PHILADELPHIA_SOURCES.find((s) => s.url === "https://www.woodysbar.com/");
      expect(source).toBeDefined();
      expect(source?.kind).toBe("html");
      expect(source?.trustTier).toBe("first_party");
      expect(source?.venueAddress).toBe("202 S 13th St, Philadelphia, PA 19107");
      expect(source?.weeklyGrid).toBe(true);
      expect(source?.danceNights).toContain("WKND Part 2");
      expect(source?.notDanceNights).toContain("Rosewood Mondays");
    });

    it("lists Woody's Thursday to Saturday nights from its own menu lines", () => {
      const source = PHILADELPHIA_SOURCES.find((s) => s.url === "https://www.woodysbar.com/");
      expect(source?.fixedNights).toHaveLength(3);
      const nights = source!.fixedNights!;
      const thu = nights[0]!;
      const fri = nights[1]!;
      const sat = nights[2]!;
      expect(thu.days).toEqual([4]);
      expect(thu.start).toBe("19:00");
      expect(thu.end).toBe("02:00");
      expect(thu.danceCited).toBeTruthy();
      expect(thu.line).toBe("JUST RNB THURSDAYS");
      expect(thu.replacesTitles).toContain("Thursdays Just R&B");
      expect(fri.days).toEqual([5]);
      expect(fri.start).toBe("19:00");
      expect(fri.end).toBe("02:00");
      expect(fri.danceCited).toBeTruthy();
      expect(fri.line).toBe("FRIDAYS: WKND PART 1");
      expect(sat.days).toEqual([6]);
      expect(sat.start).toBe("19:00");
      expect(sat.end).toBe("02:00");
      expect(sat.danceCited).toBeTruthy();
      expect(sat.line).toBe("SATURDAY NIGHT: WKND PT. 2");
    });

    it("gives the Trestle Inn's dance parties a 9pm start", () => {
      const source = PHILADELPHIA_SOURCES.find((s) => s.url === "https://thetrestleinn.com/");
      expect(source?.houseHours).toBeDefined();
      expect(source?.houseHours?.start).toBe("21:00");
      expect(source?.houseHours?.end).toBe("02:00");
      expect(source?.houseHours?.days).toEqual([4, 5, 6]);
    });

    it("reads Germantown Country Dancers from its own page", () => {
      const source = PHILADELPHIA_SOURCES.find(
        (s) => s.url === "https://germantowncountrydancers.org/",
      );
      expect(source).toBeDefined();
      expect(source?.styles).toEqual(["english_country"]);
      expect(source?.venueAddress).toBe("615 Montgomery Ave, Merion Station, PA 19066");
      expect(source?.weeklyGrid).toBe(true);
    });

    it("has a fixedNights entry for the Trestle Inn", () => {
      const source = PHILADELPHIA_SOURCES.find((s) => s.url === "https://thetrestleinn.com/");
      expect(source?.fixedNights).toHaveLength(1);
      const fixed = source?.fixedNights![0];
      expect(fixed?.title).toBe("Trestle Inn Dance Party");
      expect(fixed?.days).toEqual([4, 5, 6]);
      expect(fixed?.start).toBe("21:00");
      expect(fixed?.danceCited).toBeTruthy();
    });

    it("lets the Trestle Inn's fixed night replace the read's long title", () => {
      const source = PHILADELPHIA_SOURCES.find((s) => s.url === "https://thetrestleinn.com/");
      const fixed = source?.fixedNights![0];
      expect(fixed?.replacesTitles).toContain(
        "dance parties featuring all vinyl DJs and Philly's only troupe of Go Go dancers, The Trestle Specials",
      );
    });

    it("lists the Folk Dance Council's Tuesday folk dancing as a fixed weekly night", () => {
      const source = PHILADELPHIA_SOURCES.find((s) => s.url === "https://folkdancecouncil.org/");
      expect(source).toBeDefined();
      expect(source?.venueAddress).toBe("6815 Emlen St, Philadelphia, PA 19119");
      expect(source?.fixedNights).toHaveLength(1);
      const fixed = source?.fixedNights![0];
      expect(fixed?.title).toBe("International Folk Dancing (Folk Dance Council)");
      expect(fixed?.days).toEqual([2]);
      expect(fixed?.start).toBe("19:30");
      expect(fixed?.end).toBe("21:30");
      expect(fixed?.danceCited).toBeTruthy();
      expect(fixed?.line).toContain("every Tuesday evening at 7:30 - 9:30 pm");
    });
  });
});
