// The Austin starting list keeps its own promises (D-047, D-110): one row per address, only
// http(s), no Squarespace ?format= view, and Resident Advisor only through config/sources/ra.ts (D-505).
import { describe, expect, it } from "vitest";

import { AUSTIN_RETIRED, AUSTIN_SOURCES } from "@/config/sources/austin";
import { METRO_SOURCES, METRO_RETIRED_SOURCES } from "@/config/sources";
import { RA_AREAS } from "@/config/sources/ra";
import { STYLES } from "@/config/styles";

const listed = AUSTIN_SOURCES.map((seed) => seed.url);
const retired = AUSTIN_RETIRED.map((gone) => gone.url);

describe("Austin's starting list", () => {
  it("lists each address once, retired addresses are unique, and every url and feedUrl is http(s)", () => {
    expect(new Set(listed).size).toBe(listed.length);
    expect(new Set(retired).size).toBe(retired.length);
    for (const url of [...listed, ...retired]) {
      expect(new URL(url).protocol).toMatch(/^https?:$/);
    }
    for (const seed of AUSTIN_SOURCES) {
      if (seed.feedUrl) {
        expect(new URL(seed.feedUrl).protocol).toMatch(/^https?:$/);
      }
    }
  });

  it("never lists an address it has retired", () => {
    expect(listed.filter((url) => retired.includes(url))).toEqual([]);
  });

  it("asks for no ?format= view, which Squarespace's robots.txt disallows", () => {
    for (const seed of AUSTIN_SOURCES) {
      expect(seed.url).not.toMatch(/[?&]format=/);
      expect(seed.feedUrl ?? "").not.toMatch(/[?&]format=/);
    }
  });

  it("keeps Resident Advisor out of its own file: RA comes only from config/sources/ra.ts (D-505)", () => {
    for (const seed of AUSTIN_SOURCES) {
      expect(seed.url).not.toMatch(/ra\.co|residentadvisor\.net/);
      expect(seed.feedUrl ?? "").not.toMatch(/ra\.co|residentadvisor\.net/);
    }
  });

  it("every feed_ics source has a feedUrl", () => {
    for (const seed of AUSTIN_SOURCES) {
      if (seed.kind === "feed_ics") {
        expect(seed.feedUrl).toBeDefined();
      }
    }
  });

  it("every style named by a source is a real style key", () => {
    const styleKeys = STYLES.map((s) => s.key);
    for (const seed of AUSTIN_SOURCES) {
      for (const style of seed.styles) {
        expect(styleKeys).toContain(style);
      }
    }
  });
});

describe("Austin in the shared metro sources", () => {
  it("METRO_SOURCES.austin holds exactly one RA GraphQL source, for area 321 (D-505)", () => {
    const sources = METRO_SOURCES.austin ?? [];
    const ra = sources.filter((s) => s.platform === "ra");
    expect(ra).toHaveLength(1);
    expect(ra[0]!.url).toBe("https://ra.co/graphql?area=321");
    expect(ra[0]!.kind).toBe("ticketing_api");
    expect(RA_AREAS.austin).toBe(321);
    expect(sources).toHaveLength(AUSTIN_SOURCES.length + 1);
  });

  it("reads the first batch: Salsa Vida, TangoMango Travis, Austin Tango Society, Swing Syndicate, DICE", () => {
    const byUrl = new Map(AUSTIN_SOURCES.map((s) => [s.url, s]));
    expect(byUrl.get("https://www.salsavida.com/guides/texas/austin/")?.trustTier).toBe(
      "directory",
    );
    expect(byUrl.get("https://www.tangomango.org/index.php?show=Travis,TX")?.platform).toBe(
      "tangomango",
    );
    const gcal = AUSTIN_SOURCES.filter((s) => s.kind === "feed_gcal");
    expect(gcal).toHaveLength(2);
    for (const s of gcal)
      expect(s.feedUrl).toMatch(/^https:\/\/calendar\.google\.com\/calendar\/ical\//);
    const swing = byUrl.get("https://www.meetup.com/swing-dancing-atx/events/");
    expect(swing?.feedUrl).toBe("https://www.meetup.com/swing-dancing-atx/events/ical/");
    expect(swing?.venueAddress).toBe("2312 San Gabriel St, Austin, TX 78705");
    expect(byUrl.get("https://kingdomnightclub.com/")?.venueAddress).toBe(
      "505 E 7th St, Austin, TX 78701",
    );
    expect(byUrl.get("https://www.eventbrite.com/o/oilcan-harrys-33046707923")?.platform).toBe(
      "eventbrite",
    );
    expect(byUrl.get("https://posh.vip/sitemap-events-recent.xml")?.platform).toBe("posh");
    expect(byUrl.get("https://www.esquinatango.org/events/")?.trustTier).toBe("first_party");
    // DICE's Austin pages served a gig list; retired after the first read.
    expect(AUSTIN_SOURCES.filter((s) => s.platform === "dice")).toEqual([]);
  });

  it("reads the third batch: Donn's Depot, Go Dance Studio, TAADA, Create Austin, Highland Lounge", () => {
    const byUrl = new Map(AUSTIN_SOURCES.map((s) => [s.url, s]));
    // Donn's Depot answers 403 to CI: hand-checked in the owner's browser instead (D-798), never fetched.
    expect(byUrl.get("https://donnsdepot.com/")?.handChecked).toBe(true);
    const goDance = byUrl.get("https://godancestudio.squarespace.com/calendar");
    expect(goDance?.kind).toBe("squarespace");
    // TAADA's 3rd Saturday contra is read from TAADA's own page, not twice.
    expect(goDance?.notDanceNights).toContain("Contra Dance");
    expect(byUrl.get("https://taada.us/wp/events/")?.trustTier).toBe("first_party");
    const create = byUrl.get("https://createaustin.org/events/");
    expect(create?.feedUrl).toBe("https://createaustin.org/events/?ical=1");
    expect(create?.mixedCalendar).toBe(true);
    const highland = byUrl.get("https://www.highlandlounge.com/");
    expect(highland?.fixedNights?.map((n) => [n.days, n.start, n.end])).toEqual([
      [[5], "21:30", "03:30"],
      [[6], "21:30", "03:30"],
    ]);
    for (const night of highland?.fixedNights ?? []) expect(night.danceCited).not.toBe("");
    expect(byUrl.get("https://19hz.info/eventlisting_Texas.php")?.platform).toBe("nineteenhz");
  });

  it("reads the fourth batch: Sam's Town Point, Austin Uptown Dance, four Eventbrite organisers", () => {
    const byUrl = new Map(AUSTIN_SOURCES.map((s) => [s.url, s]));
    const sams = byUrl.get("https://samstownpoint.com/events");
    expect(sams?.bandsForDancers).toBe(true);
    expect(sams?.venueAddress).toBe("2115 Allred Dr, Austin, TX 78748");
    expect(byUrl.get("https://www.austinuptowndance.com/main-events")?.kind).toBe("squarespace");
    const organisers = AUSTIN_SOURCES.filter((s) => s.platform === "eventbrite").map((s) => s.url);
    expect(organisers).toEqual(
      expect.arrayContaining([
        "https://www.eventbrite.com/o/double-or-nothing-two-step-118223927791",
        "https://www.eventbrite.com/o/be-bachata-dance-academy-106710443641",
        "https://www.eventbrite.com/o/balledjo-american-social-guild-76880320293",
      ]),
    );
  });

  it("METRO_RETIRED_SOURCES.austin holds the first read's retirements", () => {
    expect(METRO_RETIRED_SOURCES.austin?.map((r) => r.url)).toEqual(retired);
    expect(retired).not.toContain("https://donnsdepot.com/");
  });
});
