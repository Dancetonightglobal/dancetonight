import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  apiItemsToIcs,
  calendarEventsUrl,
  calendarWindow,
  descriptionText,
  googleCalendarAdapter,
  googleCalendarEmbedUrl,
  googleCalendarIds,
  googleCalendarIdsInHtml,
} from "@/src/adapters/apis/google-calendar";
import type { Metro, RunCtx, Source } from "@/src/adapters/types";
import { mayRun } from "@/src/pipeline/runner";
import { createPoliteHttp, type TransportRequest } from "@/src/pipeline/http";
import { normalizeListing } from "@/src/pipeline/normalize";
import { probePage } from "@/src/pipeline/probe";

const FIXTURES = path.join(__dirname, "__fixtures__/google-calendar");
const fixture = (name: string) => readFileSync(path.join(FIXTURES, name), "utf8");

const NOW = new Date("2026-10-04T16:00:00Z"); // Sunday, noon in New York
const NYC: Metro = {
  id: "m",
  slug: "nyc",
  name: "New York",
  countryCode: "US",
  center: { lat: 40.7128, lng: -74.006 },
  radiusKm: 40,
  tz: "America/New_York",
  languages: ["en"],
};
const PAGE = "https://wcs.example/";
const SOURCE: Source = {
  id: "s",
  url: PAGE,
  kind: "feed_gcal",
  trustTier: "first_party",
  platform: "feed_gcal",
  // What earlier runs stored: the ICS address of the embed's first calendar only.
  feedUrl:
    "https://calendar.google.com/calendar/ical/socials%40group.calendar.google.com/public/basic.ics",
  metroId: "m",
  styles: ["west_coast_swing"],
  etag: null,
  lastModified: null,
  contentHash: null,
};
const EMBED_PAGE = `<!doctype html><html><body>
<iframe src="https://calendar.google.com/calendar/embed?height=600&amp;src=socials%40group.calendar.google.com&amp;src=classes%40group.calendar.google.com&amp;src=gone%40group.calendar.google.com&amp;ctz=America%2FNew_York"></iframe>
<a href="https://calendar.google.com/calendar/render?action=TEMPLATE&amp;text=Add">Add to my calendar</a>
</body></html>`;

const SOCIALS = fixture("events-wcs-socials.json");
// The classes calendar shares the Thursday social with the socials calendar (one iCalUID, one start).
// It also states UTC as its zone (times still read in New York's), and one cancelled class comes
// back, as `showDeleted=true` returns it, with no title and no start of its own.
const CLASSES = JSON.stringify({
  timeZone: "UTC",
  items: [
    JSON.parse(SOCIALS).items[0],
    {
      id: "class0001_20261007T233000Z",
      status: "confirmed",
      summary: "Beginner West Coast Swing class",
      start: { dateTime: "2026-10-07T19:30:00-04:00" },
      end: { dateTime: "2026-10-07T20:30:00-04:00" },
      iCalUID: "class0001@google.com",
      recurringEventId: "class0001",
    },
    {
      id: "class0001_20261014T233000Z",
      status: "cancelled",
      recurringEventId: "class0001",
      originalStartTime: { dateTime: "2026-10-14T19:30:00-04:00" },
    },
  ],
});

function ctxWith(
  respond: (req: TransportRequest) => {
    status: number;
    body: string;
    headers?: Record<string, string>;
  },
  env: Record<string, string> = { GOOGLE_CALENDAR_API_KEY: "test-calendar-key" },
): RunCtx & { seen: TransportRequest[] } {
  const seen: TransportRequest[] = [];
  let t = NOW.getTime();
  return {
    metro: NYC,
    now: () => new Date(t),
    env,
    log: () => {},
    seen,
    http: createPoliteHttp({
      userAgent: "DanceTonightBot/1.0",
      now: () => t,
      sleep: async (ms) => void (t += ms),
      transport: async (req) => {
        seen.push(req);
        const answer = respond(req);
        return { url: req.url, headers: answer.headers ?? {}, ...answer };
      },
    }),
  };
}

const answer = (req: TransportRequest) => {
  if (req.url === "https://wcs.example/robots.txt")
    return { status: 200, body: "User-agent: *\nDisallow: /admin\n" };
  if (req.url === PAGE) return { status: 200, body: EMBED_PAGE };
  if (req.url.includes("/calendars/socials%40"))
    return {
      status: 200,
      body: SOCIALS,
      headers: { "cache-control": "private, max-age=0, must-revalidate, no-transform" },
    };
  if (req.url.includes("/calendars/classes%40")) return { status: 200, body: CLASSES };
  if (req.url.includes("/calendars/gone%40"))
    return { status: 404, body: '{"error":{"code":404,"message":"Not Found"}}' };
  return { status: 500, body: "unexpected" };
};

describe("Google Calendar ids", () => {
  it("reads every calendar of an embed, an ICS address and a bare id", () => {
    expect(
      googleCalendarIds(
        "https://calendar.google.com/calendar/embed?src=a%40group.calendar.google.com&src=b%40group.calendar.google.com&ctz=America%2FNew_York",
      ),
    ).toEqual(["a@group.calendar.google.com", "b@group.calendar.google.com"]);
    expect(
      googleCalendarIds(
        "https://calendar.google.com/calendar/ical/abc123%40group.calendar.google.com/public/basic.ics",
      ),
    ).toEqual(["abc123@group.calendar.google.com"]);
    expect(googleCalendarIds("abc123@group.calendar.google.com")).toEqual([
      "abc123@group.calendar.google.com",
    ]);
    expect(googleCalendarIds("https://example.org/calendar/embed?src=a%40b.com")).toEqual([]);
    expect(
      googleCalendarIds("https://calendar.google.com/calendar/render?action=TEMPLATE&text=x"),
    ).toEqual([]);
  });

  it("finds all 29 calendars of nycwcs.com's embed, where the ICS address kept the first", () => {
    const ids = googleCalendarIdsInHtml(fixture("nycwcs-home.html.txt"));
    expect(ids).toHaveLength(29);
    expect(ids[0]).toBe("08u807p33lqlmd7jtmit9149qc@group.calendar.google.com");
    // Each is a whole id: none has the next line's text glued on.
    expect(ids.every((id) => /^[a-z0-9]{26}@group\.calendar\.google\.com$/.test(id))).toBe(true);
  });

  it("never glues the words after an address onto its last id, and decodes a base64 cid", () => {
    expect(
      googleCalendarIdsInHtml(
        "<p>https://calendar.google.com/calendar/embed?src=abc%40group.calendar.google.com\nEvery Thursday</p>",
      ),
    ).toEqual(["abc@group.calendar.google.com"]);
    expect(
      googleCalendarIdsInHtml(
        '<iframe src="https://calendar.google.com/calendar/embed?height=600\n  &amp;src=a%40group.calendar.google.com\n  &amp;src=b%40group.calendar.google.com"></iframe>',
      ),
    ).toEqual(["a@group.calendar.google.com", "b@group.calendar.google.com"]);
    const cid = Buffer.from("club@group.calendar.google.com").toString("base64url");
    expect(googleCalendarIds(`https://calendar.google.com/calendar/u/0/r?cid=${cid}`)).toEqual([
      "club@group.calendar.google.com",
    ]);
    // Swingland's embed: base64url srcs, the second a holiday calendar (its "#" is not an id).
    const holidays = Buffer.from("en.uk#holiday@group.v.calendar.google.com").toString("base64url");
    expect(
      googleCalendarIds(
        `https://calendar.google.com/calendar/embed?src=aW5mb0Bzd2luZ2xhbmQuY29t&src=${holidays}`,
      ),
    ).toEqual(["info@swingland.com"]);
  });

  it("finds CDNY's calendar inside Google Sites' escaped blob, and the NYC Blues Calendar", () => {
    expect(googleCalendarIdsInHtml(fixture("cdny-calendar-events.excerpt.txt"))).toEqual([
      "4e2tnmgfn2ph2tvaefa8ldbuqo@group.calendar.google.com",
    ]);
    expect(googleCalendarIdsInHtml(fixture("bdny-calendar.excerpt.txt"))).toEqual([
      "1e9b52lqfh7sqvt57e74e4orms@group.calendar.google.com",
    ]);
  });

  it("ignores calendar addresses inside <script> data, such as SomSardana's Next.js payload", () => {
    // somsardana.cat (2026-10-30) carries one cobla's own calendar link in its React Server Component
    // payload, escaped as JSON; the page embeds no calendar, and the probe read the wrong calendar.
    const rsc =
      '<script>self.__next_f.push([1,"{\\"web\\":\\"https:\\/\\/calendar.google.com\\/calendar\\/embed?src=cobla%40group.calendar.google.com\\u0026ctz=Europe%2FMadrid\\"}"])</script>';
    const json =
      '<script type="application/json" id="__NEXT_DATA__">{"cal":"https://calendar.google.com/calendar/embed?src=data%40group.calendar.google.com"}</script>';
    expect(
      googleCalendarIdsInHtml(`<html><body><h1>Agenda</h1>${rsc}${json}</body></html>`),
    ).toEqual([]);
    // A real embed on the same page is still found, and only it.
    expect(
      googleCalendarIdsInHtml(
        `<html><body>${rsc}<iframe src="https://calendar.google.com/calendar/embed?src=club%40group.calendar.google.com"></iframe>${json}</body></html>`,
      ),
    ).toEqual(["club@group.calendar.google.com"]);
    // A calendar wired up in plain JavaScript is still the page's own.
    expect(
      googleCalendarIdsInHtml(
        '<script>var c = "https://calendar.google.com/calendar/embed?src=js%40group.calendar.google.com";</script>',
      ),
    ).toEqual(["js@group.calendar.google.com"]);
    expect(
      googleCalendarIdsInHtml(
        '<SCRIPT TYPE="application/ld+json">{"url":"https://calendar.google.com/calendar/embed?src=ld%40group.calendar.google.com"}</SCRIPT>',
      ),
    ).toEqual([]);
    expect(
      probePage("https://somsardana.cat/sardanisme/agenda", `<html><body>${rsc}</body></html>`)
        .kind,
    ).not.toBe("feed_gcal");
  });

  it("leaves a page with its own schema.org events to them, beside a calendar link", () => {
    const html = `<html><head><script type="application/ld+json">${JSON.stringify({
      "@context": "https://schema.org",
      "@type": "Event",
      name: "Friday social",
      startDate: "2026-10-09T21:00:00-04:00",
      location: { "@type": "Place", name: "Studio", address: "1 Main St, New York, NY" },
    })}</script></head><body><a href="https://calendar.google.com/calendar/u/0/r?cid=club@group.calendar.google.com">Subscribe</a></body></html>`;
    expect(probePage("https://club.example/", html).kind).toBe("jsonld");
  });

  it("probes an embed as one source naming every calendar", () => {
    const outcome = probePage("https://www.nycwcs.com/", fixture("nycwcs-home.html.txt"));
    expect(outcome.kind).toBe("feed_gcal");
    expect(outcome.platform).toBe("feed_gcal");
    expect(outcome.reason).toBe("the page embeds 29 Google Calendars");
    expect(outcome.feedUrls).toHaveLength(29);
    expect(googleCalendarIds(outcome.feedUrl!)).toHaveLength(29);
    expect(googleCalendarEmbedUrl(["a@b.com"])).toBe(
      "https://calendar.google.com/calendar/embed?src=a%40b.com",
    );
  });
});

describe("the Calendar API reader", () => {
  it("is off by default and, switched on without a key, reports what it needs", () => {
    const off = new Map([["adapter.feed_gcal", false]]);
    expect(mayRun(googleCalendarAdapter, NYC, {}, off)).toEqual({
      run: false,
      reason: "flag_off",
      detail: "adapter.feed_gcal is off",
    });
    const on = new Map([["adapter.feed_gcal", true]]);
    expect(mayRun(googleCalendarAdapter, NYC, {}, on)).toEqual({
      run: false,
      reason: "not_configured",
      detail: "needs GOOGLE_CALENDAR_API_KEY",
    });
    expect(mayRun(googleCalendarAdapter, NYC, { GOOGLE_CALENDAR_API_KEY: "k" }, on)).toEqual({
      run: true,
    });
  });

  it("asks for single instances over the window", () => {
    const window = calendarWindow("2026-10-04", 14);
    expect(window).toEqual({
      timeMin: "2026-10-03T00:00:00Z",
      timeMax: "2026-10-20T00:00:00Z",
    });
    const url = new URL(calendarEventsUrl("a@group.calendar.google.com", window, "tok"));
    expect(url.pathname).toBe("/calendar/v3/calendars/a%40group.calendar.google.com/events");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: "2500",
      showDeleted: "true",
      pageToken: "tok",
    });
  });

  it("reads the page's calendars with the key in a header, skipping a gone calendar", async () => {
    const ctx = ctxWith(answer);
    const result = await googleCalendarAdapter.harvest!(SOURCE, ctx);

    // The page first (robots.txt, then the page), then one API call per calendar.
    expect(ctx.seen.map((r) => new URL(r.url).pathname)).toEqual([
      "/robots.txt",
      "/",
      "/calendar/v3/calendars/socials%40group.calendar.google.com/events",
      "/calendar/v3/calendars/classes%40group.calendar.google.com/events",
      "/calendar/v3/calendars/gone%40group.calendar.google.com/events",
    ]);
    const api = ctx.seen.filter((r) => r.url.startsWith("https://www.googleapis.com/"));
    expect(api.every((r) => r.headers["x-goog-api-key"] === "test-calendar-key")).toBe(true);
    expect(ctx.seen.every((r) => !r.url.includes("test-calendar-key"))).toBe(true);
    // Nothing on calendar.google.com is fetched: its robots.txt closes it.
    expect(ctx.seen.some((r) => new URL(r.url).hostname === "calendar.google.com")).toBe(false);

    expect(result.notes).toEqual([
      "calendar socials: 4 events in the window",
      "calendar classes: 2 events in the window",
      "calendar gone is not public or no longer exists",
      "Calendar API Cache-Control: private, max-age=0, must-revalidate, no-transform",
      "an event with no title was skipped",
    ]);
    // Because a calendar (gone) returned 404, whole should be undefined.
    expect(result.whole).toBeUndefined();

    const events = result.listings.map((l) => {
      const o = normalizeListing(l, { metro: NYC, source: SOURCE, now: NOW });
      if (!o.ok) throw new Error(o.reason);
      return o.event;
    });
    expect(
      events.map((e) => [e.title, e.nightDate, e.startsAt?.toISOString() ?? null, e.listingType]),
    ).toEqual([
      ["THURSDAY NIGHT WCS SOCIAL", "2026-10-08", "2026-10-09T01:00:00.000Z", "social"],
      ["Fall WCS weekend (all day)", "2026-10-11", null, "other"],
      // 12:30am on Saturday belongs to Friday night (D-004).
      ["LATE NIGHT WCS PRACTICE", "2026-10-09", "2026-10-10T04:30:00.000Z", "social"],
      ["Beginner West Coast Swing class", "2026-10-07", "2026-10-07T23:30:00.000Z", "class"],
      // The cancelled class keeps its night's id and its series' title, and is written cancelled.
      ["Beginner West Coast Swing class", "2026-10-14", "2026-10-14T23:30:00.000Z", "class"],
    ]);
    expect(events.map((e) => e.cancelled)).toEqual([false, false, false, false, true]);
    expect(result.listings.at(-1)!.externalId).toBe("class0001_20261014T233000Z");
    // A calendar that states UTC is still read in New York's clock (D-130).
    expect(result.listings.every((l) => l.tz === "America/New_York")).toBe(true);
    expect(
      result.listings.at(-2)!.listing.dancing_time ?? result.listings.at(-2)!.listing.lesson_time,
    ).toBe("19:30");
    const thursday = result.listings[0]!;
    expect(thursday.listing.prices.map((p) => p.amount)).toEqual([15, 10]);
    expect(thursday.externalId).toBe("4abc123def456_20261009T000000Z");
    // The listing links to the page that embeds the calendar, never to calendar.google.com.
    expect(thursday.provenance.sourceUrl).toBe(PAGE);
    expect(thursday.eventUrl ?? null).toBeNull();
    expect(result.doc?.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("reports the source unchanged when the calendars answer the same", async () => {
    const first = await googleCalendarAdapter.harvest!(SOURCE, ctxWith(answer));
    const again = await googleCalendarAdapter.harvest!(
      { ...SOURCE, contentHash: first.doc!.contentHash },
      ctxWith(answer),
    );
    expect(again.unchanged).toBe(true);
    expect(again.listings).toEqual([]);
  });

  it("sets whole:true when all calendars are read without limit, 404, or page cap", async () => {
    // Create a source with only one calendar, which answers a single page.
    const singleSource: Source = {
      ...SOURCE,
      url: "https://example.com/",
      feedUrl:
        "https://calendar.google.com/calendar/ical/single%40group.calendar.google.com/public/basic.ics",
    };
    const ctx = ctxWith((req) => {
      if (req.url.includes("single%40")) {
        return {
          status: 200,
          body: JSON.stringify({
            items: [
              {
                id: "event1",
                summary: "Test Event",
                start: { dateTime: "2026-10-05T19:00:00-04:00" },
                end: { dateTime: "2026-10-05T21:00:00-04:00" },
                iCalUID: "event1@google.com",
                status: "confirmed",
              },
            ],
          }),
          headers: { "cache-control": "public, max-age=3600" },
        };
      }
      // robots.txt and page (no calendars in page)
      if (req.url === "https://example.com/robots.txt")
        return { status: 200, body: "User-agent: *\nDisallow:\n" };
      if (req.url === "https://example.com/") return { status: 200, body: "<html></html>" };
      return { status: 500, body: "unexpected" };
    });
    const result = await googleCalendarAdapter.harvest!(singleSource, ctx);
    expect(result.whole).toBe(true);
  });

  it("does not set whole when a calendar hits the page cap", async () => {
    // Create a source with one calendar that returns a nextPageToken on every page.
    const pagingSource: Source = {
      ...SOURCE,
      url: "https://example.com/",
      feedUrl:
        "https://calendar.google.com/calendar/ical/paging%40group.calendar.google.com/public/basic.ics",
    };
    let pageCount = 0;
    const ctx = ctxWith((req) => {
      if (req.url.includes("paging%40")) {
        pageCount++;
        return {
          status: 200,
          body: JSON.stringify({
            items: [
              {
                id: `event${pageCount}`,
                summary: "Page Event",
                start: { dateTime: "2026-10-05T19:00:00-04:00" },
                end: { dateTime: "2026-10-05T21:00:00-04:00" },
                iCalUID: `event${pageCount}@google.com`,
                status: "confirmed",
              },
            ],
            // We need more pages than GOOGLE_CALENDAR_MAX_PAGES (4) to trigger the page cap.
            // So return a token for the first 4 pages, and undefined on the 5th.
            nextPageToken: pageCount < 5 ? "token" : undefined,
          }),
        };
      }
      if (req.url === "https://example.com/robots.txt")
        return { status: 200, body: "User-agent: *\nDisallow:\n" };
      if (req.url === "https://example.com/") return { status: 200, body: "<html></html>" };
      return { status: 500, body: "unexpected" };
    });
    const result = await googleCalendarAdapter.harvest!(pagingSource, ctx);
    expect(result.whole).toBeUndefined();
    // Should have logged the page cap note.
    expect(result.notes).toEqual(
      expect.arrayContaining([expect.stringMatching(/more than \d+ pages, the rest not read/)]),
    );
  });

  it("stops on a refused key, and reads the stored calendars when the page is down", async () => {
    await expect(
      googleCalendarAdapter.harvest!(
        SOURCE,
        ctxWith((req) =>
          req.url.startsWith("https://www.googleapis.com/")
            ? { status: 403, body: '{"error":{"message":"API key not valid"}}' }
            : answer(req),
        ),
      ),
    ).rejects.toThrow(/403/);

    const down = await googleCalendarAdapter.harvest!(
      SOURCE,
      ctxWith((req) => (req.url === PAGE ? { status: 500, body: "" } : answer(req))),
    );
    expect(down.notes?.[0]).toMatch(/^the page could not be read/);
    expect(down.notes).toContain("calendar socials: 4 events in the window");
    expect(down.listings.length).toBeGreaterThan(0);
  });

  it("turns HTML descriptions into lines and drops a twice-listed instance", () => {
    expect(descriptionText("Lesson 8pm<br>Social 9pm &amp; late<p>x</p>")).toBe(
      "Lesson 8pm\nSocial 9pm & late x",
    );
    const item = JSON.parse(SOCIALS).items[0];
    const seen = new Set<string>();
    expect(apiItemsToIcs([item], seen)).toHaveLength(1);
    expect(apiItemsToIcs([{ ...item, id: "other-calendar-copy" }], seen)).toHaveLength(0);
  });
});
