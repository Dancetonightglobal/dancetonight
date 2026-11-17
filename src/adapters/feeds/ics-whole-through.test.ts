import { describe, expect, it } from "vitest";

import { icsAdapter } from "@/src/adapters/feeds/ics";
import type { Metro, RunCtx, Source } from "@/src/adapters/types";
import { createPoliteHttp, fixtureTransport, type Fixture } from "@/src/pipeline/http";

// D-859: an iCalendar feed is the source's word up to the last night it gives. A WordPress events
// export (?ical=1) stops after a count of events, so the read is whole only through that night.

const FEED = "https://club.example/events/?ical=1";
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
  url: "https://club.example/",
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

const ROBOTS: Fixture = {
  request: { method: "GET", url: "https://club.example/robots.txt" },
  response: {
    url: "https://club.example/robots.txt",
    status: 200,
    headers: {},
    body: "User-agent: *\nDisallow:\n",
  },
};

function vevent(uid: string, lines: string[]): string {
  return ["BEGIN:VEVENT", `UID:${uid}`, `SUMMARY:Salsa night ${uid}`, ...lines, "END:VEVENT"].join(
    "\r\n",
  );
}

function calendar(events: string[]): string {
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//test//EN", ...events, "END:VCALENDAR"].join(
    "\r\n",
  );
}

function ctxWith(body: string): RunCtx {
  const transport = fixtureTransport([
    ROBOTS,
    {
      request: { method: "GET", url: FEED },
      response: { url: FEED, status: 200, headers: { "content-type": "text/calendar" }, body },
    },
  ]);
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
  };
}

describe("an iCalendar read is whole through its last night (D-859)", () => {
  it("gives the latest night of its dated events, beyond the window too", async () => {
    const body = calendar([
      vevent("a", ["DTSTART:20260924T230000Z"]),
      vevent("b", ["DTSTART:20261020T230000Z"]),
      vevent("c", ["DTSTART:20260930T230000Z"]),
    ]);
    const result = await icsAdapter.harvest!(SOURCE, ctxWith(body));
    expect(result.wholeThrough).toBe("2026-10-20");
    expect(result.whole).toBeUndefined();
  });

  it("gives the last night inside the window when the feed stops there", async () => {
    const body = calendar([
      vevent("a", ["DTSTART:20260924T230000Z"]),
      vevent("c", ["DTSTART:20260930T230000Z"]),
    ]);
    const result = await icsAdapter.harvest!(SOURCE, ctxWith(body));
    expect(result.wholeThrough).toBe("2026-09-30");
  });

  it("counts a start before 6am as the night before", async () => {
    // 05:00Z on the 28th is 1am in New York: the night of the 27th.
    const body = calendar([
      vevent("a", ["DTSTART:20260924T230000Z"]),
      vevent("late", ["DTSTART:20260928T050000Z"]),
    ]);
    const result = await icsAdapter.harvest!(SOURCE, ctxWith(body));
    expect(result.wholeThrough).toBe("2026-09-27");
  });

  it("reads an all-day date as its own night", async () => {
    const body = calendar([vevent("day", ["DTSTART;VALUE=DATE:20261002"])]);
    const result = await icsAdapter.harvest!(SOURCE, ctxWith(body));
    expect(result.wholeThrough).toBe("2026-10-02");
  });

  it("ignores a weekly rule: its nights run on, so they set no end", async () => {
    const body = calendar([
      vevent("rule", ["DTSTART:20260901T230000Z", "RRULE:FREQ=WEEKLY;BYDAY=TU"]),
      vevent("a", ["DTSTART:20260925T230000Z"]),
    ]);
    const result = await icsAdapter.harvest!(SOURCE, ctxWith(body));
    expect(result.wholeThrough).toBe("2026-09-25");
  });

  it("sets nothing when the feed has only a rule", async () => {
    const body = calendar([
      vevent("rule", ["DTSTART:20260901T230000Z", "RRULE:FREQ=WEEKLY;BYDAY=TU"]),
    ]);
    const result = await icsAdapter.harvest!(SOURCE, ctxWith(body));
    expect(result.wholeThrough).toBeUndefined();
  });

  it("sets nothing when every dated event is already past", async () => {
    const body = calendar([
      vevent("old", ["DTSTART:20250101T000000Z"]),
      vevent("old2", ["DTSTART:20260910T230000Z"]),
    ]);
    const result = await icsAdapter.harvest!(SOURCE, ctxWith(body));
    expect(result.wholeThrough).toBeUndefined();
  });

  it("sets nothing for an empty calendar", async () => {
    const result = await icsAdapter.harvest!(SOURCE, ctxWith(calendar([])));
    expect(result.wholeThrough).toBeUndefined();
  });
});
