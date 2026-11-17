// DICE's New York browse pages (D-139): events from the page's own JSON, prices in cents, and the
// listing's own page at dice.fm/event/{id}. Event data saved from the DJ list on 2026-10-11.
import { describe, expect, it } from "vitest";

import { diceAdapter, diceEventsFromPage, diceToListings } from "@/src/adapters/apis/dice";
import { sha256 } from "@/src/adapters/shared";
import type { Metro, RunCtx, Source } from "@/src/adapters/types";
import { createPoliteHttp, fixtureTransport, type Fixture } from "@/src/pipeline/http";

// Noon in New York.
const NOW = new Date("2026-10-11T16:00:00Z");
const PAGE = "https://dice.fm/browse/new_york-5bbf4db0f06331478e9b2c59/music/dj";

const event = (
  id: string,
  name: string,
  start: string,
  end: string,
  venue: [string, string],
  price: { amount: number | null; amount_from: number | null },
  status = "on-sale",
) => ({
  id,
  name,
  status,
  dates: { timezone: "America/New_York", event_start_date: start, event_end_date: end },
  venues: [{ id: "v", name: venue[0], address: venue[1] }],
  price: { currency: "USD", ...price },
});

const EVENTS = [
  event(
    "6a60e546b3ccc400019f89ad",
    "FRANCIS MERCIER",
    "2026-10-11T18:00:00-04:00",
    "2026-10-12T02:00:00-04:00",
    ["Pacha New York", "140 Stewart Avenue, Brooklyn, New York 11237, United States"],
    { amount: null, amount_from: 5835 },
  ),
  event(
    "6ac40b09068dfd000184eb9a",
    "Ear, Nose + Throat: hazzi, Tagof, Lila, MarzAtta",
    "2026-10-11T19:00:00-04:00",
    "2026-10-12T04:00:00-04:00",
    [
      "Jupiter Disco",
      "Jupiter Disco, 1237 Flushing Ave, New York City, New York 11237, United States",
    ],
    { amount: 0, amount_from: null },
  ),
  event(
    "6abc1b718fc4080001a3c651",
    " Angie Ocampo / Maria Sifontes b2b Milo / VNUZ / Awa ",
    "2026-10-11T23:00:00-04:00",
    "2026-10-12T04:00:00-04:00",
    ["SILO Brooklyn ", "90 Scott Ave, Brooklyn, NY 11237, USA"],
    { amount: 3399, amount_from: null },
  ),
  event(
    "6aae314040665d000153e0d7",
    "Open Decks w/ Steen & Clübsession",
    "2026-10-13T19:00:00-04:00",
    "2026-10-14T02:00:00-04:00",
    ["SILO Brooklyn ", "90 Scott Ave, Brooklyn, NY 11237, USA"],
    { amount: null, amount_from: 0 },
  ),
];

const html = (data: unknown) =>
  `<html><body><div id="__next"></div><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(data)}</script></body></html>`;
const PAGE_HTML = html({ props: { pageProps: { events: EVENTS } } });

const options = {
  fetchedAt: NOW,
  metroTz: "America/New_York",
  fromNight: "2026-10-11",
  days: 14,
  pageUrl: PAGE,
};

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

const source: Source = {
  id: "s",
  url: PAGE,
  kind: "ticketing_api",
  trustTier: "ticketing",
  platform: "dice",
  feedUrl: null,
  metroId: "m",
  styles: ["dj_night"],
  etag: null,
  lastModified: null,
  contentHash: null,
};

const served = (url: string, body: string): Fixture => ({
  request: { method: "GET", url },
  response: { url, status: 200, headers: { "content-type": "text/html" }, body },
});

function ctx(fixtures: Fixture[]): RunCtx & { requests: string[] } {
  const transport = fixtureTransport(fixtures);
  let t = NOW.getTime();
  return {
    metro: NYC,
    now: () => new Date(t),
    http: createPoliteHttp({
      transport,
      userAgent: "t",
      now: () => t,
      sleep: async (ms) => void (t += ms),
    }),
    env: {},
    log: () => {},
    requests: transport.requests,
  };
}

const price = (label: string, amount: number) => [
  { label, amount, currency: "USD", includes: null },
];

describe("DICE browse pages (D-139)", () => {
  it("finds the events in the page's own JSON, and nothing in a page without it", () => {
    expect(diceEventsFromPage(PAGE_HTML)).toHaveLength(4);
    expect(diceEventsFromPage("<html><body>No data</body></html>")).toEqual([]);
    expect(
      diceEventsFromPage('<script id="__NEXT_DATA__" type="application/json">{not json</script>'),
    ).toEqual([]);
    expect(diceEventsFromPage(html({ props: { pageProps: { events: {} } } }))).toEqual([]);
  });

  it("reads each night: title, start, place, prices in cents and its own page", () => {
    const { listings, notes } = diceToListings(EVENTS, options);
    expect(notes).toEqual([]);
    expect(listings.map((l) => l.externalId)).toEqual(EVENTS.map((e) => `dice:${e.id}`));
    const [pacha, jupiter, silo, decks] = listings.map((l) => l.listing);
    expect(pacha!.local_date).toBe("2026-10-11");
    expect([pacha!.doors_time, pacha!.dancing_time]).toContain("18:00");
    expect(silo!.title).toBe("Angie Ocampo / Maria Sifontes b2b Milo / VNUZ / Awa");
    expect(silo!.venue).toMatchObject({
      name: "SILO Brooklyn",
      address: "90 Scott Ave, Brooklyn, NY 11237, USA",
    });
    expect(pacha!.prices).toEqual(price("From", 58.35));
    expect(jupiter!.prices).toEqual(price("Free", 0));
    expect(silo!.prices).toEqual(price("Tickets", 33.99));
    expect(decks!.prices).toEqual(price("Free", 0));
    expect(listings[0]!.eventUrl).toBe("https://dice.fm/event/6a60e546b3ccc400019f89ad");
  });

  it("keeps only the window's nights", () => {
    const later = diceToListings(EVENTS, { ...options, fromNight: "2026-10-12", days: 1 });
    expect(later.listings).toEqual([]);
  });

  it("marks a cancelled night, and notes a night with no start", () => {
    const cancelled = { ...EVENTS[0]!, status: "cancelled" };
    const undated = { ...EVENTS[1]!, dates: {} };
    const { listings, notes } = diceToListings([cancelled, undated], options);
    expect(listings).toHaveLength(1);
    expect(listings[0]!.listing.cancelled).toBe(true);
    expect(notes).toEqual([`no readable start: ${EVENTS[1]!.name}`]);
  });

  it("harvests the page through the polite client, never asking /api/", async () => {
    const run = ctx([
      served("https://dice.fm/robots.txt", "User-agent: *\nDisallow: /api/\n"),
      served(PAGE, PAGE_HTML),
    ]);
    const result = await diceAdapter.harvest!(source, run);
    expect(result.listings).toHaveLength(4);
    expect(result.notes?.[0]).toBe("4 event(s) on the page");
    expect(run.requests.some((url) => url.includes("/api/"))).toBe(false);
  });

  it("returns no listings when the genre page redirects to the city's whole list", async () => {
    const redirectedUrl = "https://dice.fm/browse/new_york-5bbf4db0f06331478e9b2c59/music/gig";
    const run = ctx([
      served("https://dice.fm/robots.txt", "User-agent: *\nDisallow: /api/\n"),
      {
        request: { method: "GET", url: PAGE },
        response: {
          url: redirectedUrl,
          status: 200,
          headers: { "content-type": "text/html" },
          body: PAGE_HTML,
        },
      },
    ]);
    const result = await diceAdapter.harvest!(source, run);
    expect(result.listings).toHaveLength(0);
    expect(result.notes?.[0]).toMatch(/^DICE sent this list to \//);
    expect(result.doc?.contentHash).toBe(sha256("[]"));
    expect(result.whole).toBe(true);
  });

  it("fails the read when DICE redirects out of the city's lists", async () => {
    const run = ctx([
      served("https://dice.fm/robots.txt", "User-agent: *\nDisallow: /api/\n"),
      {
        request: { method: "GET", url: PAGE },
        response: {
          url: "https://dice.fm/login",
          status: 200,
          headers: { "content-type": "text/html" },
          body: "<html></html>",
        },
      },
    ]);
    await expect(diceAdapter.harvest!(source, run)).rejects.toThrow(/DICE redirected/);
  });

  it("harvests normally when the response has a trailing slash", async () => {
    const run = ctx([
      served("https://dice.fm/robots.txt", "User-agent: *\nDisallow: /api/\n"),
      {
        request: { method: "GET", url: PAGE },
        response: {
          url: PAGE + "/",
          status: 200,
          headers: { "content-type": "text/html" },
          body: PAGE_HTML,
        },
      },
    ]);
    const result = await diceAdapter.harvest!(source, run);
    expect(result.listings).toHaveLength(4);
    expect(result.notes?.[0]).toBe("4 event(s) on the page");
  });
});
