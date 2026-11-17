import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  parseTangoMangoGrid,
  tangoMangoDatesById,
  isPrivateLesson,
  parseTangoMangoEvent,
  pickSocialTime,
  type TangoMangoGridItem,
  tangoMangoAdapter,
  tangoMangoToListings,
  TANGOMANGO_BASE,
  TANGOMANGO_INTERVAL_MS,
} from "@/src/adapters/apis/tangomango";
import type { RunCtx, Source } from "@/src/adapters/types";
import { createPoliteHttp, fixtureTransport, type Fixture } from "@/src/pipeline/http";

const MIAMI_METRO = {
  id: "m1",
  slug: "miami",
  name: "Miami",
  countryCode: "US",
  center: { lat: 25.7617, lng: -80.1918 },
  radiusKm: 45,
  tz: "America/New_York",
  languages: ["en"],
};

function ctx(): RunCtx & { requests: string[] } {
  const fixtures: Fixture[] = [
    {
      request: {
        method: "GET",
        url: "https://www.tangomango.org/robots.txt",
      },
      response: {
        url: "https://www.tangomango.org/robots.txt",
        status: 200,
        headers: {},
        body: "User-agent: *\nCrawl-delay: 10\nDisallow: /admin/\n",
      },
    },
    {
      request: {
        method: "GET",
        url: "https://www.tangomango.org/index.php?show=Miami-Dade,FL",
      },
      response: {
        url: "https://www.tangomango.org/index.php?show=Miami-Dade,FL",
        status: 200,
        headers: {},
        body: readFileSync(
          new URL("./__fixtures__/tangomango/grid-miami-dade.html", import.meta.url),
          "utf8",
        ),
      },
    },
    {
      request: {
        method: "GET",
        url: `${TANGOMANGO_BASE}/lib/loadevent.php?date=2026-10-27&eventid=30821`,
      },
      response: {
        url: `${TANGOMANGO_BASE}/lib/loadevent.php?date=2026-10-27&eventid=30821`,
        status: 200,
        headers: {},
        body: readFileSync(
          new URL("./__fixtures__/tangomango/detail-30821.html", import.meta.url),
          "utf8",
        ),
      },
    },
    {
      request: {
        method: "GET",
        url: `${TANGOMANGO_BASE}/lib/loadevent.php?date=2026-11-03&eventid=30821`,
      },
      response: {
        url: `${TANGOMANGO_BASE}/lib/loadevent.php?date=2026-11-03&eventid=30821`,
        status: 200,
        headers: {},
        body: readFileSync(
          new URL("./__fixtures__/tangomango/detail-30821.html", import.meta.url),
          "utf8",
        ),
      },
    },
    {
      request: {
        method: "GET",
        url: `${TANGOMANGO_BASE}/lib/loadevent.php?date=2026-11-04&eventid=22434`,
      },
      response: {
        url: `${TANGOMANGO_BASE}/lib/loadevent.php?date=2026-11-04&eventid=22434`,
        status: 200,
        headers: {},
        body: readFileSync(
          new URL("./__fixtures__/tangomango/detail-22434.html", import.meta.url),
          "utf8",
        ),
      },
    },
    {
      request: {
        method: "GET",
        url: `${TANGOMANGO_BASE}/lib/loadevent.php?date=2026-11-03&eventid=29368`,
      },
      response: {
        url: `${TANGOMANGO_BASE}/lib/loadevent.php?date=2026-11-03&eventid=29368`,
        status: 200,
        headers: {},
        body: readFileSync(
          new URL("./__fixtures__/tangomango/detail-29368.html", import.meta.url),
          "utf8",
        ),
      },
    },
    {
      request: {
        method: "GET",
        url: `${TANGOMANGO_BASE}/lib/loadevent.php?date=2026-11-05&eventid=30749`,
      },
      response: {
        url: `${TANGOMANGO_BASE}/lib/loadevent.php?date=2026-11-05&eventid=30749`,
        status: 200,
        headers: {},
        body: readFileSync(
          new URL("./__fixtures__/tangomango/detail-30749.html", import.meta.url),
          "utf8",
        ),
      },
    },
    {
      request: {
        method: "GET",
        url: `${TANGOMANGO_BASE}/lib/loadevent.php?date=2026-11-06&eventid=30315`,
      },
      response: {
        url: `${TANGOMANGO_BASE}/lib/loadevent.php?date=2026-11-06&eventid=30315`,
        status: 200,
        headers: {},
        body: readFileSync(
          new URL("./__fixtures__/tangomango/detail-30315.html", import.meta.url),
          "utf8",
        ),
      },
    },
  ];
  const transport = fixtureTransport(fixtures);
  const now = new Date("2026-10-30T16:00:00Z");
  let t = now.getTime();
  return {
    metro: MIAMI_METRO,
    now: () => new Date(t),
    http: createPoliteHttp({
      transport,
      userAgent: "test",
      now: () => t,
      sleep: async (ms) => void (t += ms),
    }),
    env: {},
    log: () => {},
    requests: transport.requests,
  };
}

describe("Tango Mango parser", () => {
  describe("parseTangoMangoGrid", () => {
    it("extracts grid items from HTML", () => {
      const html = readFileSync(
        new URL("./__fixtures__/tangomango/grid-miami-dade.html", import.meta.url),
        "utf8",
      );
      const items = parseTangoMangoGrid(html);
      expect(items).toHaveLength(164);
      expect(items[0]).toEqual({
        date: "2026-10-25",
        eventId: "30711",
        title: "Diego Santana Private Lessons",
      });
      // Check that event 30821 appears on multiple dates
      const event30821 = items.filter((item) => item.eventId === "30821");
      expect(event30821.length).toBeGreaterThan(1);
      const dates30821 = event30821.map((item) => item.date);
      expect(dates30821).toContain("2026-10-27");
      expect(dates30821).toContain("2026-11-03");
      expect(event30821[0]?.title).toBe("Milonga del Pecado");
    });
  });

  describe("tangoMangoDatesById", () => {
    it("groups items by event ID with sorted unique dates", () => {
      const items: TangoMangoGridItem[] = [
        { date: "2026-10-27", eventId: "30821", title: "Milonga del Pecado" },
        { date: "2026-11-03", eventId: "30821", title: "Milonga del Pecado" },
        { date: "2026-10-25", eventId: "30711", title: "Diego Santana Private Lessons" },
        { date: "2026-10-26", eventId: "30711", title: "Diego Santana Private Lessons" },
        { date: "2026-10-25", eventId: "30711", title: "Diego Santana Private Lessons" }, // duplicate date
      ];
      const map = tangoMangoDatesById(items);
      expect(map.size).toBe(2);
      expect(map.get("30821")).toEqual({
        title: "Milonga del Pecado",
        dates: ["2026-10-27", "2026-11-03"],
      });
      expect(map.get("30711")).toEqual({
        title: "Diego Santana Private Lessons",
        dates: ["2026-10-25", "2026-10-26"],
      });
    });
  });

  describe("isPrivateLesson", () => {
    it("returns true for titles containing 'private' or 'privates'", () => {
      expect(isPrivateLesson("Diego Santana Private Lessons")).toBe(true);
      expect(isPrivateLesson("Exclusive Tango Private Sessions with Los Villagra")).toBe(true);
      expect(isPrivateLesson("Privates Adrian Veredice in North Miami Beach")).toBe(true);
      expect(isPrivateLesson("Tango Times Private Lessons")).toBe(true);
      expect(isPrivateLesson("private lesson")).toBe(true);
      expect(isPrivateLesson("PRIVATES with me")).toBe(true);
    });
    it("returns false for titles without private", () => {
      expect(isPrivateLesson("Milonga del Pecado")).toBe(false);
      expect(isPrivateLesson("Tango Times Dance Studio")).toBe(false);
      expect(isPrivateLesson("Public milonga")).toBe(false);
    });
  });

  describe("parseTangoMangoEvent", () => {
    const fixtures = [
      { id: "30821", name: "Milonga del Pecado" },
      { id: "22434", name: "Diego's Milonga Hallowen Party" },
      { id: "29368", name: "VK DANCE Arena event" },
      { id: "30749", name: "VK DANCE Arena class/practilonga" },
      { id: "30711", name: "Private lesson" },
      { id: "30315", name: "Miami Tango Role Switch Championship & Festival" },
    ];

    fixtures.forEach(({ id, name }) => {
      it(`parses ${name} (${id}) correctly`, () => {
        const html = readFileSync(
          new URL(`./__fixtures__/tangomango/detail-${id}.html`, import.meta.url),
          "utf8",
        );
        const event = parseTangoMangoEvent(html);
        // Check expectations from spec
        if (id === "30821") {
          expect(event.title).toBe("Milonga del Pecado");
          expect(event.timeLines).toEqual([
            "7:00 First steps into Tango",
            "8:00 Tango Laboratory",
            "9:00 - 1:30 Milonga del Pecado",
          ]);
          expect(event.venueName).toBeNull();
          expect(event.address).toBe("18145 NE 19th Ave, North Miami, FL");
          expect(event.venueUrl).toBeNull();
          expect(event.priceText).toBeNull();
        } else if (id === "22434") {
          expect(event.title).toBe("Diego's Milonga Hallowen Party");
          expect(event.timeLines).toEqual(["8:30 Tango Classes", "9:30 - 1:00a Milonga"]);
          expect(event.venueName).toBe("Power Rumba");
          expect(event.address).toBe("16117 Biscayne Blvd, North Miami, FL");
          expect(event.venueUrl).toBeNull();
          expect(event.priceText).toBe("$25");
        } else if (id === "29368") {
          expect(event.timeLines).toEqual([
            "8:00 - 9:00 Open Level Class",
            "9:00 - 10:00 Intermediate Class",
            "10:00 - 11:00 Guide Práctica",
          ]);
          expect(event.venueName).toBe("VK DANCE Arena");
          expect(event.address).toBe("3129 W. Hallandale Beach Blv, Hallandale, FL");
          expect(event.venueUrl).toBeNull();
          expect(event.priceText).toBe(
            "$20 each Class / $25 1 Class + Guide Practica / $35 Full package (2 Classes + Guide Práctica)",
          );
        } else if (id === "30749") {
          expect(event.timeLines).toEqual(["Class 8 to 9pm - Practilonga 9 to 11pm"]);
          expect(event.venueName).toBe("VK DANCE Arena");
          expect(event.address).toBe("3129 W. Hallandale Beach Blv, Hallandale, FL");
          expect(event.venueUrl).toBeNull();
          expect(event.priceText).toBe("Class: $15 / Class and práctica: $20 / only practica: $10");
        } else if (id === "30711") {
          expect(event.timeLines).toEqual([]);
          // A private lesson: screened by title, its other fields are not used.
          expect(event.address).toBeNull();
          expect(event.venueUrl).toBeNull();
          expect(event.priceText).toBeNull();
        } else if (id === "30315") {
          expect(event.title).toBe("Miami Tango Role Switch Championship & Festival");
          expect(event.timeLines).toEqual([]);
          expect(event.venueName).toBeNull();
          expect(event.address).toBe("Miami, FL");
          expect(event.venueUrl).toBe("https://miamitangoroleswitch.com");
          expect(event.priceText).toBeNull();
        }
      });
    });
  });

  describe("pickSocialTime", () => {
    it("picks social time for 30821", () => {
      const timeLines = [
        "7:00 First steps into Tango",
        "8:00 Tango Laboratory",
        "9:00 - 1:30 Milonga del Pecado",
      ];
      const result = pickSocialTime(timeLines, "Milonga del Pecado");
      expect(result).toEqual({
        start: "21:00",
        end: "01:30",
        label: "Milonga del Pecado",
      });
    });

    it("picks social time for 22434", () => {
      const timeLines = ["8:30 Tango Classes", "9:30 - 1:00a Milonga"];
      const result = pickSocialTime(timeLines, "Diego's Milonga Hallowen Party");
      expect(result).toEqual({
        start: "21:30",
        end: "01:00",
        label: "Milonga",
      });
    });

    it("picks social time for 29368", () => {
      const timeLines = [
        "8:00 - 9:00 Open Level Class",
        "9:00 - 10:00 Intermediate Class",
        "10:00 - 11:00 Guide Práctica",
      ];
      const result = pickSocialTime(timeLines, "Some title");
      expect(result).toEqual({
        start: "22:00",
        end: "23:00",
        label: "Guide Práctica",
      });
    });

    it("picks social time for 30749", () => {
      const timeLines = ["Class 8 to 9pm - Practilonga 9 to 11pm"];
      const result = pickSocialTime(timeLines, "Some title");
      expect(result).toEqual({
        start: "21:00",
        end: "23:00",
        label: "Practilonga",
      });
    });

    it("returns null for empty timeLines", () => {
      const result = pickSocialTime([], "Some title");
      expect(result).toBeNull();
    });

    it("reads a dot as the minutes separator (Tango Times 30108, 2026-11-05)", () => {
      expect(pickSocialTime(["from 10 am to 11.10 am"], "Tango Times Dance Studio")).toEqual({
        start: "10:00",
        end: "11:10",
        label: "from",
      });
      expect(pickSocialTime(["9.30 - 11.45 Milonga"], "Some title")).toEqual({
        start: "21:30",
        end: "23:45",
        label: "Milonga",
      });
      expect(pickSocialTime(["8.15 Tango Classes"], "Some title")).toEqual({
        start: "20:15",
        end: null,
        label: "Tango Classes",
      });
    });

    it("picks first segment when no social pattern matches", () => {
      const timeLines = ["8:30 Tango Classes"];
      const result = pickSocialTime(timeLines, "Tango Times Dance Studio");
      expect(result).toEqual({
        start: "20:30",
        end: null,
        label: "Tango Classes",
      });
    });
  });

  describe("tangoMangoAdapter", () => {
    it("harvest asks for grid then event pages, respects interval", async () => {
      const run = ctx();
      const source: Source = {
        id: "test",
        url: "https://www.tangomango.org/index.php?show=Miami-Dade,FL",
        kind: "platform_api",
        platform: "tangomango",
        trustTier: "first_party",
        styles: [],
        feedUrl: null,
        metroId: null,
        etag: null,
        lastModified: null,
        contentHash: null,
      };
      const result = await tangoMangoAdapter.harvest!(source, run);
      // robots.txt + grid + 5 event pages = at least 7 requests (polite client may fetch robots.txt multiple times)
      expect(run.requests.length).toBeGreaterThanOrEqual(7);
      // No request for private lesson 30711
      expect(run.requests.some((req) => req.includes("eventid=30711"))).toBe(false);
      // Order: robots.txt first, then grid
      expect(run.requests[0]).toContain("robots.txt");
      expect(run.requests[1]).toContain("index.php?show=Miami-Dade,FL");
      // Interval check
      expect(tangoMangoAdapter.limits.perDomainIntervalMs).toBe(TANGOMANGO_INTERVAL_MS);
      expect(TANGOMANGO_INTERVAL_MS).toBe(10_000);
      // Milonga del Pecado 2026-11-03 listing
      const listing = result.listings.find((l) => l.externalId === "tangomango:30821:2026-11-03");
      expect(listing).toBeDefined();
      expect(listing?.listing.local_date ?? "").toBe("2026-11-03");
      expect(listing?.listing.doors_time ?? listing?.listing.dancing_time).toBe("21:00");
      expect(listing?.listing.end_time).toBe("01:30");
      expect(listing?.eventUrl).toBe(
        "https://www.tangomango.org/link.php?eventid=30821&date=2026-11-03",
      );
      // VK Dance Arena (Hallandale) screened
      const screened = (result.screened ?? []).filter((s) =>
        s.reason.includes("outside the metro"),
      );
      expect(screened.length).toBeGreaterThan(0);
      const vkIds = ["29368", "30749"];
      for (const id of vkIds) {
        expect(
          (result.screened ?? []).some(
            (s) => s.externalId.startsWith(`tangomango:${id}`) && s.reason.includes("Hallandale"),
          ),
        ).toBe(true);
      }
      // Private lesson screened
      expect(
        (result.screened ?? []).some(
          (s) => s.externalId === "tangomango:30711" && s.reason === "a private lesson",
        ),
      ).toBe(true);
      // No listing for dates before 2026-10-30
      const oldDates = result.listings.filter((l) => (l.listing.local_date ?? "") < "2026-10-30");
      expect(oldDates).toHaveLength(0);
      // Festival 30315 has no time
      const festival = result.listings.find((l) => l.externalId === "tangomango:30315:2026-11-06");
      expect(festival?.listing.doors_time).toBeNull();
      expect(festival?.listing.dancing_time).toBeNull();
      expect(festival?.listing.venue.address).toBe("Miami, FL");
    });

    it("returns unchanged when contentHash matches", async () => {
      const source: Source = {
        id: "test",
        url: "https://www.tangomango.org/index.php?show=Miami-Dade,FL",
        kind: "platform_api",
        platform: "tangomango",
        trustTier: "first_party",
        styles: [],
        feedUrl: null,
        metroId: null,
        etag: null,
        lastModified: null,
        contentHash: null,
      };
      const first = await tangoMangoAdapter.harvest!(source, ctx());
      expect(first.unchanged).toBeUndefined();
      const hash = first.doc?.contentHash ?? null;
      expect(hash).not.toBeNull();
      const run = ctx();
      const second = await tangoMangoAdapter.harvest!({ ...source, contentHash: hash }, run);
      expect(second.unchanged).toBe(true);
      expect(second.listings).toHaveLength(0);
      expect(run.requests.some((req) => req.includes("loadevent.php"))).toBe(false);
    });

    it("tangoMangoToListings works with fake metro without outside towns", () => {
      const items: TangoMangoGridItem[] = [
        {
          date: "2026-11-05",
          eventId: "30749",
          title: "Class And Practilonga With Alex And Martina",
        },
      ];
      const html = readFileSync(
        new URL("./__fixtures__/tangomango/detail-30749.html", import.meta.url),
        "utf8",
      );
      const events = new Map([["30749", parseTangoMangoEvent(html)]]);
      const { listings, screened } = tangoMangoToListings(items, events, {
        metro: { tz: "America/New_York", countryCode: "US", slug: "testville" },
        fetchedAt: new Date("2026-10-30T16:00:00Z"),
        fromNight: "2026-10-30",
      });
      expect(screened).toHaveLength(0);
      expect(listings).toHaveLength(1);
      const listing = listings[0];
      expect(listing?.listing.local_date).toBe("2026-11-05");
      // "Class" in the title: buildListing's existing class rules file the start as the lesson time.
      expect(
        listing?.listing.dancing_time ??
          listing?.listing.lesson_time ??
          listing?.listing.doors_time,
      ).toBe("21:00");
      expect(listing?.listing.end_time).toBe("23:00");
      expect(listing?.listing.venue.name).toBe("VK DANCE Arena");
    });
  });
});
