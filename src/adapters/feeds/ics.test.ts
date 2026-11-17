import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  contentHashOf,
  icsAdapter,
  icsToListings,
  parseDurationMinutes,
  parseIcs,
  resolveTzid,
  splitLocation,
  unfold,
} from "@/src/adapters/feeds/ics";
import type { HarvestedListing, Metro, RunCtx, Source } from "@/src/adapters/types";
import { createPoliteHttp, fixtureTransport, type Fixture } from "@/src/pipeline/http";
import { expandRecurrence, normalizeListing } from "@/src/pipeline/normalize";

// Hand-built in the Google Calendar export format, with every case the parser must survive.
const ICS = readFileSync(path.join(__dirname, "__fixtures__/salsa-example.ics"), "utf8");
const FEED = "https://salsa.example/calendar.ics";
const NOW = new Date("2026-09-23T16:00:00Z"); // Wednesday, noon in New York

const NYC: Metro = {
  id: "m",
  slug: "nyc",
  name: "New York",
  countryCode: "US",
  center: { lat: 40.7128, lng: -74.006 },
  radiusKm: 50,
  tz: "America/New_York",
  languages: ["en"],
};

const SOURCE: Source = {
  id: "s",
  url: "https://salsa.example/calendar",
  kind: "feed_ics",
  trustTier: "first_party",
  platform: null,
  feedUrl: FEED,
  metroId: "m",
  styles: [],
  etag: null,
  lastModified: null,
  contentHash: null,
};

function ctxWith(fixtures: Fixture[]): RunCtx & { requests: string[] } {
  const transport = fixtureTransport(fixtures);
  let t = NOW.getTime();
  return {
    metro: NYC,
    now: () => new Date(t),
    http: createPoliteHttp({
      transport,
      userAgent: "DanceTonightBot/1.0",
      now: () => t,
      sleep: async (ms) => {
        t += ms;
      },
    }),
    env: {},
    log: () => {},
    requests: transport.requests,
  };
}

const ROBOTS: Fixture = {
  request: { method: "GET", url: "https://salsa.example/robots.txt" },
  response: {
    url: "https://salsa.example/robots.txt",
    status: 200,
    headers: {},
    body: "User-agent: *\nDisallow: /private\n",
  },
};
const FEED_OK: Fixture = {
  request: { method: "GET", url: FEED },
  response: {
    url: FEED,
    status: 200,
    headers: { etag: '"v7"', "content-type": "text/calendar" },
    body: ICS,
  },
};

/** Expands rules over the window and normalises everything, like the ingest job does. */
function nightsOf(listings: HarvestedListing[]) {
  return listings
    .flatMap((l) => expandRecurrence(l, "2026-09-23", NYC.tz, 14).listings)
    .map((l) => normalizeListing(l, { metro: NYC, source: SOURCE, now: NOW }));
}

describe("the ICS parser", () => {
  it("unfolds continuation lines", () => {
    expect(unfold("DESCRIPTION:ab\r\n c\r\n\td\r\nEND:X")).toEqual(["DESCRIPTION:abcd", "END:X"]);
  });

  it("reads events, skipping nested alarms, and unescapes text", () => {
    const calendar = parseIcs(ICS);
    expect(calendar.name).toBe("Salsa Example NYC");
    expect(calendar.tzid).toBe("America/New_York");
    expect(calendar.events).toHaveLength(8);
    const first = calendar.events[0]!;
    expect(first.description).toContain("$20 at the door, $15 students.");
    expect(first.description).not.toContain("reminder");
    expect(first.location).toBe("Copacabana, 625 W 51st St, New York, NY 10019");
    expect(first.rrule).toBe("FREQ=WEEKLY;BYDAY=TH");
  });

  it("resolves IANA, vendor-prefixed and Windows zone names", () => {
    expect(resolveTzid("America/New_York")).toBe("America/New_York");
    expect(resolveTzid("/mozilla.org/20050126_1/America/New_York")).toBe("America/New_York");
    expect(resolveTzid("Eastern Standard Time")).toBe("America/New_York");
    expect(resolveTzid("Romance Standard Time")).toBe("Europe/Paris");
    expect(resolveTzid("Nowhere/Special")).toBeNull();
  });

  it("parses durations", () => {
    expect(parseDurationMinutes("PT4H")).toBe(240);
    expect(parseDurationMinutes("P1DT2H30M")).toBe(1590);
    expect(parseDurationMinutes("nonsense")).toBeNull();
  });

  it("splits a location into a venue name and an address", () => {
    expect(splitLocation("Copacabana, 625 W 51st St, New York")).toEqual({
      name: "Copacabana",
      address: "Copacabana, 625 W 51st St, New York",
    });
    expect(splitLocation("245 W 29th St, New York")).toEqual({
      name: null,
      address: "245 W 29th St, New York",
    });
    expect(splitLocation("Central Park Bandshell")).toEqual({
      name: "Central Park Bandshell",
      address: null,
    });
  });

  it("hashes content without the volatile stamps", () => {
    const restamped = ICS.replace(/DTSTAMP:\d{8}T\d{6}Z/g, "DTSTAMP:20270101T000000Z");
    expect(contentHashOf(restamped)).toBe(contentHashOf(ICS));
    expect(contentHashOf(ICS.replace("Bachata Night", "Bachata Nite"))).not.toBe(
      contentHashOf(ICS),
    );
  });
});

describe("the ICS adapter, end to end through the polite client", () => {
  it("reads robots.txt first, then the feed, and turns it into tonight's listings", async () => {
    const ctx = ctxWith([ROBOTS, FEED_OK]);
    const result = await icsAdapter.harvest!(SOURCE, ctx);
    expect(ctx.requests).toEqual(["GET https://salsa.example/robots.txt", `GET ${FEED}`]);
    expect(result.doc?.etag).toBe('"v7"');
    expect(result.notes).toContain("an event with no title was skipped");

    const outcomes = nightsOf(result.listings);
    const events = outcomes.flatMap((o) => (o.ok ? [o.event] : []));
    const byTitle = (title: string) => events.filter((e) => e.title === title);

    // The weekly rule: Oct 1 from the rule; Sep 24 replaced by its override.
    const rule = byTitle("Thursday Salsa Social");
    expect(rule.map((e) => e.nightDate)).toEqual(["2026-10-01"]);
    expect(rule[0]).toMatchObject({
      listingType: "social",
      styles: ["salsa"],
      confirmation: "recurring_unconfirmed",
      prices: [
        { label: "At the door", amount: 20, currency: "USD", includes: null },
        { label: "Students", amount: 15, currency: "USD", includes: null },
      ],
    });
    expect(rule[0]?.lessonAt?.toISOString()).toBe("2026-10-02T00:00:00.000Z");
    expect(rule[0]?.dancingAt?.toISOString()).toBe("2026-10-02T01:00:00.000Z");
    expect(rule[0]?.endsAt?.toISOString()).toBe("2026-10-02T03:30:00.000Z");
    // The page's instruction to list it as free changed nothing.
    expect(rule[0]?.isFree).toBe(false);

    const override = byTitle("Thursday Salsa Social (late start)");
    expect(override).toHaveLength(1);
    expect(override[0]).toMatchObject({
      nightDate: "2026-09-24",
      key: "salsa-thursday@example.org@2026-09-24",
    });
    expect(override[0]?.startsAt?.toISOString()).toBe("2026-09-25T01:00:00.000Z");

    // A UTC one-off with a duration, coordinates and a URL. An iCalendar URL is the event's page,
    // whatever its host: its canonical URL, never "Get tickets" (D-070).
    const bachata = byTitle("Bachata Night")[0];
    expect(bachata).toMatchObject({
      nightDate: "2026-09-25",
      isFree: true,
      ticketUrl: null,
      canonicalUrl: "https://tickets.example/bachata",
      eventUrl: "https://tickets.example/bachata",
      venue: { name: "The Loft", location: { lat: 40.7209, lng: -73.9897 } },
    });
    expect(bachata?.doorsAt?.toISOString()).toBe("2026-09-26T00:00:00.000Z");
    expect(bachata?.endsAt?.toISOString()).toBe("2026-09-26T04:00:00.000Z");

    // An all-day event keeps the time its words state.
    const picnic = byTitle("Swing dance in the park")[0];
    expect(picnic).toMatchObject({
      listingType: "outdoor_public",
      styles: ["lindy_hop"],
      nightDate: "2026-09-27",
    });
    expect(picnic?.dancingAt?.toISOString()).toBe("2026-09-27T18:00:00.000Z");

    // A Windows zone name, and a cancellation.
    const practica = byTitle("Tango Practica")[0];
    expect(practica).toMatchObject({
      cancelled: true,
      confirmation: "cancelled",
      listingType: "practica",
      tz: "America/New_York",
    });
    expect(practica?.doorsAt?.toISOString()).toBe("2026-09-30T23:30:00.000Z");

    // 00:30 on Sunday belongs to Saturday night.
    const late = byTitle("Late night kizomba")[0];
    expect(late).toMatchObject({
      nightDate: "2026-09-26",
      venue: { name: null, address: "245 W 29th St, New York" },
    });

    // Nothing from the past.
    expect(byTitle("Salsa social that already happened")).toEqual([]);
    expect(outcomes.filter((o) => !o.ok)).toEqual([]);
  });

  it("lists all-day one-offs and all-day rules as untimed, a span on its first night (D-060)", () => {
    const calendar = parseIcs(
      [
        "BEGIN:VCALENDAR",
        "X-WR-TIMEZONE:America/New_York",
        "BEGIN:VEVENT",
        "UID:brooklyn-0925@example.org",
        "DTSTART;VALUE=DATE:20260925",
        "DTEND;VALUE=DATE:20260926",
        "SUMMARY:Brooklyn Social",
        "LOCATION:Brooklyn Commons\\, 495 Flatbush Ave\\, Brooklyn",
        "END:VEVENT",
        "BEGIN:VEVENT",
        "UID:english-tuesdays@example.org",
        "DTSTART;VALUE=DATE:20260901",
        "RRULE:FREQ=WEEKLY;BYDAY=TU",
        "EXDATE;VALUE=DATE:20260929",
        "SUMMARY:English - Tuesdays",
        "END:VEVENT",
        "BEGIN:VEVENT",
        "UID:zouk-weekender@example.org",
        "DTSTART;VALUE=DATE:20261002",
        "DTEND;VALUE=DATE:20261005",
        "SUMMARY:Zouk Weekender",
        "END:VEVENT",
        "BEGIN:VEVENT",
        "UID:closed-1126@example.org",
        "DTSTART;VALUE=DATE:20260926",
        "SUMMARY:Studio closed",
        "END:VEVENT",
        "END:VCALENDAR",
      ].join("\r\n"),
    );
    const { listings, notes } = icsToListings(calendar, {
      sourceUrl: SOURCE.url,
      fetchedAt: NOW,
      metroTz: NYC.tz,
      countryCode: "US",
      fromNight: "2026-09-23",
      days: 14,
    });
    // The all-day rule is no longer skipped.
    expect(notes).toEqual([]);
    const rule = listings.find((l) => l.listing.title === "English - Tuesdays");
    expect(rule?.recurrence).toMatchObject({
      rrule: "FREQ=WEEKLY;BYDAY=TU",
      dtstartLocal: "2026-09-01T12:00",
      exdates: ["2026-09-29"],
      timeListed: false,
    });

    const outcomes = nightsOf(listings);
    const events = outcomes.flatMap((o) => (o.ok ? [o.event] : []));
    const untimed = (title: string) =>
      events.filter((e) => e.title === title).map((e) => [e.nightDate, e.startsAt, e.key]);
    expect(untimed("Brooklyn Social")).toEqual([["2026-09-25", null, "brooklyn-0925@example.org"]]);
    // Tuesdays from the rule, on the rule's own day, minus the EXDATE; never at midnight.
    expect(untimed("English - Tuesdays")).toEqual([
      ["2026-10-06", null, "english-tuesdays@example.org@2026-10-06"],
    ]);
    // A three-day span is one listing, on its first night.
    expect(untimed("Zouk Weekender")).toEqual([["2026-10-02", null, "zouk-weekender@example.org"]]);
    const brooklyn = events.find((e) => e.title === "Brooklyn Social");
    expect(brooklyn?.evidence.start).toBe("DTSTART;VALUE=DATE 2026-09-25");
    // The closure notice reaches normalize and is screened there, counted as not an event.
    expect(outcomes.filter((o) => !o.ok)).toEqual([
      { ok: false, kind: "not_an_event", reason: "a closure notice", title: "Studio closed" },
    ]);
  });

  it("does not take a URL differently named events share as each one's page (review #19)", () => {
    const vevent = (uid: string, day: string, title: string, url: string, extra: string[] = []) => [
      "BEGIN:VEVENT",
      `UID:${uid}`,
      `DTSTART;TZID=America/New_York:${day}T210000`,
      `SUMMARY:${title}`,
      `URL:${url}`,
      ...extra,
      "END:VEVENT",
    ];
    const list = "https://studio.example/upcoming-events";
    const calendar = parseIcs(
      [
        "BEGIN:VCALENDAR",
        ...vevent("salsa@x", "20260925", "Salsa Social", list),
        // The same list, spelled with a trailing slash.
        ...vevent("bachata@x", "20260926", "Bachata Night", `${list}/`),
        // A rule and its override share a title and a URL: that is the series' own page.
        ...vevent("zouk@x", "20260924", "Zouk Wednesdays", "https://studio.example/e/zouk", [
          "RRULE:FREQ=WEEKLY;BYDAY=WE",
        ]),
        ...vevent("zouk@x", "20261001", "Zouk Wednesdays", "https://studio.example/e/zouk", [
          "RECURRENCE-ID;TZID=America/New_York:20261001T210000",
        ]),
        "END:VCALENDAR",
      ].join("\r\n"),
    );
    const { listings } = icsToListings(calendar, {
      sourceUrl: SOURCE.url,
      fetchedAt: NOW,
      metroTz: NYC.tz,
      countryCode: "US",
      fromNight: "2026-09-23",
      days: 14,
    });
    const pages = listings.map((l) => [l.listing.title, l.eventUrl ?? null]);
    expect(pages).toContainEqual(["Salsa Social", null]);
    expect(pages).toContainEqual(["Bachata Night", null]);
    expect(pages.filter(([title]) => title === "Zouk Wednesdays")).toEqual([
      ["Zouk Wednesdays", "https://studio.example/e/zouk"],
      ["Zouk Wednesdays", "https://studio.example/e/zouk"],
    ]);
  });

  it("stops at a 304 without reading anything", async () => {
    const ctx = ctxWith([
      ROBOTS,
      {
        request: { method: "GET", url: FEED },
        response: { url: FEED, status: 304, headers: {}, body: "" },
      },
    ]);
    const result = await icsAdapter.harvest!({ ...SOURCE, etag: '"v7"' }, ctx);
    expect(result).toEqual({ listings: [], unchanged: true });
  });

  it("stops when the content hash has not changed", async () => {
    const ctx = ctxWith([ROBOTS, FEED_OK]);
    const result = await icsAdapter.harvest!({ ...SOURCE, contentHash: contentHashOf(ICS) }, ctx);
    expect(result.unchanged).toBe(true);
    expect(result.listings).toEqual([]);
  });

  it("refuses a feed robots.txt disallows", async () => {
    const ctx = ctxWith([
      {
        ...ROBOTS,
        response: { ...ROBOTS.response, body: "User-agent: *\nDisallow: /calendar.ics\n" },
      },
    ]);
    await expect(icsAdapter.harvest!(SOURCE, ctx)).rejects.toMatchObject({
      kind: "robots_disallowed",
    });
  });

  it("says so when the address is not a calendar", async () => {
    const ctx = ctxWith([
      ROBOTS,
      {
        request: { method: "GET", url: FEED },
        response: { url: FEED, status: 200, headers: {}, body: "<html>Log in</html>" },
      },
    ]);
    await expect(icsAdapter.harvest!(SOURCE, ctx)).rejects.toThrow("not an iCalendar file");
  });
});
