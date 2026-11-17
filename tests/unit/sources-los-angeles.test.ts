// The Los Angeles starting list keeps its own promises (D-047, D-110, D-1160): one row per address, only http(s), no
// Squarespace ?format= view, no Resident Advisor pages in its own file (D-505), real style keys.
import { describe, expect, it } from "vitest";

import { METRO_SOURCES } from "@/config/sources";
import { LOS_ANGELES_RETIRED, LOS_ANGELES_SOURCES } from "@/config/sources/los-angeles";
import { STYLES } from "@/config/styles";
import { lineOnPage } from "@/src/domain/fixed-nights";

const listed = LOS_ANGELES_SOURCES.map((seed) => seed.url);
const retired = LOS_ANGELES_RETIRED.map((gone) => gone.url);

describe("Los Angeles's starting list", () => {
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
    for (const seed of LOS_ANGELES_SOURCES) {
      expect(seed.url).not.toMatch(/[?&]format=/);
      expect(seed.url).not.toMatch(/ra\.co|residentadvisor\.net/);
    }
  });

  it("every style named by a source is a real style key", () => {
    const styleKeys = STYLES.map((s) => s.key);
    for (const seed of LOS_ANGELES_SOURCES) {
      for (const style of seed.styles) {
        expect(styleKeys).toContain(style);
      }
    }
  });
  it("reads DICE's DJ and Party pages and the 32 genre pages that answered 200, never the redirects", () => {
    const dice = LOS_ANGELES_SOURCES.filter((s) => s.platform === "dice").map((s) => s.url);
    const browse = "https://dice.fm/browse/losangeles-5982e13c613de866017c3e3a/music";
    expect(dice).toHaveLength(34);
    expect(dice).toContain(`${browse}/dj`);
    expect(dice).toContain(`${browse}/party`);
    expect(dice).toContain(`${browse}/party/salsa`);
    expect(dice).not.toContain(`${browse}/dj/latin`);
    expect(dice).not.toContain(`${browse}/party/roller_skating`);
  });

  it("reads Out x Out's Los Angeles events as a mixed directory calendar (D-558)", () => {
    const oxo = LOS_ANGELES_SOURCES.find(
      (s) => s.url === "https://outxout.com/events/los-angeles-ca",
    );
    expect(oxo?.kind).toBe("jsonld");
    expect(oxo?.trustTier).toBe("directory");
    expect(oxo?.mixedCalendar).toBe(true);
  });

  it("reads TangoMango's Los Angeles county page with its reader", () => {
    const tm = LOS_ANGELES_SOURCES.find((s) => s.platform === "tangomango");
    expect(tm?.url).toBe("https://www.tangomango.org/index.php?show=Los%20Angeles,CA");
    expect(tm?.styles).toEqual(["milonga"]);
  });

  it("is wired with Resident Advisor area 23 on top", () => {
    const all = METRO_SOURCES["los-angeles"] ?? [];
    expect(all).toHaveLength(LOS_ANGELES_SOURCES.length + 1);
    expect(all.filter((s) => s.platform === "ra").map((s) => s.url)).toEqual([
      "https://ra.co/graphql?area=23",
    ]);
  });
  it("adds weeknight salsa, bachata, swing and country sources", () => {
    const urls = [
      "https://where-to-dance-salsa.com/salsa/los-angeles/",
      "https://where-to-dance-salsa.com/bachata/los-angeles/",
      "https://danceruniversity.com/events/",
      "https://www.cowboypalace.com/",
      "https://3vinos.com/",
      "https://www.pbda.dance/dances",
    ];
    for (const url of urls) {
      expect(listed).toContain(url);
    }
    // Check where-to-dance-salsa entries are directories
    const salsaDir = LOS_ANGELES_SOURCES.find(
      (s) => s.url === "https://where-to-dance-salsa.com/salsa/los-angeles/",
    );
    expect(salsaDir?.trustTier).toBe("directory");
    const bachataDir = LOS_ANGELES_SOURCES.find(
      (s) => s.url === "https://where-to-dance-salsa.com/bachata/los-angeles/",
    );
    expect(bachataDir?.trustTier).toBe("directory");
    // SwingDance.LA answered 403 on the first scheduled read: retired, never listed (2026-11-07)
    expect(listed).not.toContain("https://www.swingdance.la/events/");
    expect(retired).toContain("https://www.swingdance.la/events/");
    // The Palos Verdes land conservancy calendar lists nature walks, no dance: retired (2026-11-10)
    expect(retired).toContain("https://pvplc.org/mec_calendars/full-calendar/");
    expect(listed).not.toContain("https://pvplc.org/mec_calendars/full-calendar/");
    // Sweetwater WeHo's weeklies are a mixer, drag, karaoke and Pass the Aux, no dance: retired (2026-11-10)
    expect(retired).toContain("https://www.sweetwaterweho.com/watch");
    expect(listed).not.toContain("https://www.sweetwaterweho.com/watch");
    // 18th Street Arts Center lists talks and openings, no dance: retired (2026-11-11)
    expect(retired).toContain("https://18thstreet.org/");
    expect(listed).not.toContain("https://18thstreet.org/");
    // Concerts, theatre, symphony, punk, a country club and burlesque, no dance: retired (2026-11-12)
    for (const url of [
      "https://thekiaforum.com/",
      "https://www.eastwestplayers.org/",
      "https://pasadenasymphony-pops.org/",
      "https://www.backyardpartyla.com/shows",
      "https://www.chevychasecc.com/calendar",
      "https://www.harvelles.com/",
      "https://longbeach.harvelles.com/events",
    ]) {
      expect(retired).toContain(url);
      expect(listed).not.toContain(url);
    }
    // Skiptown Playhouse (theatre) and Rancho Vista Golf Club (food night), no dance: retired (2026-11-12)
    for (const url of [
      "https://www.skiptownplayhouse.com/calendar",
      "https://www.ranchovistagolfclub.com/weddings/",
    ]) {
      expect(retired).toContain(url);
      expect(listed).not.toContain(url);
    }
    // Job fairs, an academic calendar, a kids' program, museum talks and a Vegas-mixed promoter: retired (2026-11-13)
    for (const url of [
      "https://www.dav.org/",
      "https://cal.lmu.edu/",
      "https://www.azusatheater.com/upcoming-programs.html",
      "https://grammymuseum.org/programs/",
      "https://vipnightlife.com/events/",
    ]) {
      expect(retired).toContain(url);
      expect(listed).not.toContain(url);
    }
    // Cowboy Palace, 3 Vino's and PBDA are first-party venue pages
    const cowboy = LOS_ANGELES_SOURCES.find((s) => s.url === "https://www.cowboypalace.com/");
    expect(cowboy?.trustTier).toBe("first_party");
    expect(cowboy?.venuePage).toBe(true);
    expect(cowboy?.venueAddress).toBeTruthy();
    const vinos = LOS_ANGELES_SOURCES.find((s) => s.url === "https://3vinos.com/");
    expect(vinos?.trustTier).toBe("first_party");
    expect(vinos?.venuePage).toBe(true);
    expect(vinos?.venueAddress).toBeTruthy();
    const pbda = LOS_ANGELES_SOURCES.find((s) => s.url === "https://www.pbda.dance/dances");
    expect(pbda?.trustTier).toBe("first_party");
    expect(pbda?.venuePage).toBe(true);
    expect(pbda?.venueAddress).toBeTruthy();
    // No kizomba page
    expect(listed.some((url) => url.includes("where-to-dance-salsa.com/kizomba"))).toBe(false);
  });
  it("adds Stud Country LA, LindyGroove and Ecstatic Dance LA as first-party sources", () => {
    const stud = LOS_ANGELES_SOURCES.find((s) => s.url === "https://studcountry.us/LA");
    expect(stud?.trustTier).toBe("first_party");
    expect(stud?.venueAddress).toBeUndefined();
    expect(stud?.mixedCalendar).toBe(true);

    const lindy = LOS_ANGELES_SOURCES.find((s) => s.url === "https://www.lindygroove.la/");
    expect(lindy?.trustTier).toBe("first_party");
    expect(lindy?.venuePage).toBe(true);
    expect(lindy?.venueAddress).toBe("200 S Euclid Ave, Pasadena, CA 91101");

    const ecstatic = LOS_ANGELES_SOURCES.find(
      (s) => s.url === "https://www.ecstaticdancela.com/tickets",
    );
    expect(ecstatic?.trustTier).toBe("first_party");
    expect(ecstatic?.venueAddress).toBeUndefined();
    expect(ecstatic?.mixedCalendar).toBe(true);
  });
  it("adds Boardner's as a first-party source with venue page and mixed calendar", () => {
    const boardners = LOS_ANGELES_SOURCES.find((s) => s.url === "https://www.boardners.com/");
    expect(boardners?.trustTier).toBe("first_party");
    expect(boardners?.venuePage).toBe(true);
    expect(boardners?.mixedCalendar).toBe(true);
    expect(boardners?.venueAddress).toBe("1652 N Cherokee Ave, Los Angeles, CA 90028");
  });

  it("seeds The Regent, Teragram Ballroom and The Bellwether as mixed-calendar venue pages (D-1168)", () => {
    for (const [url, address] of [
      ["https://regentdtla.com/events/", "448 S Main St, Los Angeles, CA 90013"],
      ["https://teragramballroom.com/calendar/", "1234 W 7th St, Los Angeles, CA 90017"],
      ["https://thebellwetherla.com/calendar/", "333 S Boylston St, Los Angeles, CA 90017"],
    ] as const) {
      const seed = LOS_ANGELES_SOURCES.find((s) => s.url === url);
      expect(seed?.trustTier).toBe("first_party");
      expect(seed?.venuePage).toBe(true);
      expect(seed?.onlyHere).toBe(true);
      expect(seed?.mixedCalendar).toBe(true);
      expect(seed?.venueAddress).toBe(address);
    }
  });
  it("seeds The Venice West and 1720 as mixed-calendar venue pages (D-1169)", () => {
    for (const [url, address] of [
      ["https://thevenicewest.com/", "1717 Lincoln Blvd, Venice, CA 90291"],
      ["https://1720.la/events/", "1720 E 16th St, Los Angeles, CA 90021"],
    ] as const) {
      const seed = LOS_ANGELES_SOURCES.find((s) => s.url === url);
      expect(seed?.trustTier).toBe("first_party");
      expect(seed?.venuePage).toBe(true);
      expect(seed?.onlyHere).toBe(true);
      expect(seed?.mixedCalendar).toBe(true);
      expect(seed?.venueAddress).toBe(address);
    }
  });
});

describe("Los Angeles's own-site Latin venues (2026-11-07)", () => {
  it("reads each venue's own page at its own address only", () => {
    const own = LOS_ANGELES_SOURCES.filter((s) => s.venuePage);
    expect(own.map((s) => s.label)).toEqual([
      "El Floridita",
      "Stevens Steakhouse",
      "The Mixx",
      "Crown Pasadena",
      "Cantina Ixtapa",
      "Cowboy Palace Saloon",
      "3 Vino's",
      "PBDA (Pasadena Ballroom Dance Association)",
      "LindyGroove",
      "Boardner's",
      "The Regent",
      "Teragram Ballroom",
      "The Bellwether",
      "The Venice West",
      "1720",
    ]);
    for (const seed of own) {
      expect(seed.trustTier).toBe("first_party");
      expect(seed.onlyHere).toBe(true);
      expect(seed.venueAddress).toMatch(/, CA 9\d{4}$/);
    }
  });

  it("reads Salseros LA as an organiser page, not one venue", () => {
    const org = LOS_ANGELES_SOURCES.find((s) => s.label === "Salseros LA");
    expect(org?.trustTier).toBe("first_party");
    expect(org?.venuePage).toBeUndefined();
  });
});

describe("Los Angeles's 19hz table (D-1161)", () => {
  it("reads 19hz.info's Los Angeles page with the nineteenhz reader, as a directory", () => {
    const hz = LOS_ANGELES_SOURCES.find((s) => s.platform === "nineteenhz");
    expect(hz?.url).toBe("https://19hz.info/eventlisting_LosAngeles.php");
    expect(hz?.trustTier).toBe("directory");
    expect(hz?.kind).toBe("platform_api");
  });
});

// Weekly nights four own sites state as text with no dates (the model listed none on the 17:27 read, 2026-11-07).
// Each excerpt is copied from the page fetched that day.
describe("Los Angeles's fixed weekly nights (2026-11-07)", () => {
  const pages: Record<string, string> = {
    "https://stevenssteakhouse.com/classes/":
      "<h2>Bachata Classes</h2><p>Learn How To Dance Bachata In Los Angeles every week on Wednesdays and Sundays " +
      "at Stevens Steakhouse with Demetrio &amp; Nicole!</p>",
    "https://www.cowboypalace.com/":
      "<p>The Cowboy Palace Saloon has live country music Wednesday through Sunday nights. Who knows, maybe " +
      "you'll find your new favorite band!</p>",
    "https://3vinos.com/":
      "<h3>Food \u2022 Bar \u2022 Entertainment \u2022 Dance</h3><p>Join us Wednesday\u2019s for Salsa Night. " +
      "Friday &amp; Saturdays for dancing!</p>",
    "https://www.lindygroove.la/":
      "<p>Join us every Thursday at the Pasadena Masonic Temple in a 5,400 Sq Ft sprung hardwood floor.</p>",
  };
  const withFixed = LOS_ANGELES_SOURCES.filter((seed) => seed.fixedNights?.length);

  it("gives exactly these four sources fixed nights", () => {
    expect(withFixed.map((seed) => seed.url).sort()).toEqual(Object.keys(pages).sort());
  });

  it("quotes a line each page writes, with real weekdays, times, styles and a dance citation", () => {
    const styleKeys = STYLES.map((s) => s.key);
    for (const seed of withFixed) {
      for (const night of seed.fixedNights ?? []) {
        expect(lineOnPage(night.line, pages[seed.url] ?? "")).toBe(true);
        expect(night.days.length).toBeGreaterThan(0);
        for (const day of night.days) expect(day >= 0 && day <= 6).toBe(true);
        if (night.start !== null) expect(night.start).toMatch(/^\d{2}:\d{2}$/);
        if (night.end !== undefined) expect(night.end).toMatch(/^\d{2}:\d{2}$/);
        for (const style of night.styles ?? []) expect(styleKeys).toContain(style);
        expect(night.danceCited.trim().length).toBeGreaterThan(0);
      }
    }
    const titles = withFixed.flatMap((seed) => (seed.fixedNights ?? []).map((n) => n.title));
    expect(new Set(titles).size).toBe(titles.length);
  });

  it("reads LindyGroove's plain page, so its fixed night is listed", () => {
    const lindy = LOS_ANGELES_SOURCES.find((seed) => seed.url === "https://www.lindygroove.la/");
    expect(lindy?.platform).toBe("probed");
    expect(lindy?.fixedNights?.[0]?.days).toEqual([4]);
  });
});
