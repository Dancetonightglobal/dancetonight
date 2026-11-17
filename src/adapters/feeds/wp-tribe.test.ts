import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { Metro, RunCtx, Source } from "@/src/adapters/types";
import { wpTribeAdapter, wpTribeToListings, wpTribeUrl } from "@/src/adapters/feeds/wp-tribe";
import { createPoliteHttp, fixtureTransport, type Fixture } from "@/src/pipeline/http";
import { normalizeListing } from "@/src/pipeline/normalize";

// Built from the plugin's documented REST response shape; re-recorded on the first live run.
const fixture = (name: string) => readFileSync(path.join(__dirname, "__fixtures__", name), "utf8");
const NOW = new Date("2026-09-23T16:00:00Z");
const PAGE_1 =
  "https://swing.example/wp-json/tribe/events/v1/events?start_date=2026-09-23+00%3A00%3A00&end_date=2026-10-07+06%3A00%3A00&per_page=50";
const PAGE_2 =
  "https://swing.example/wp-json/tribe/events/v1/events?start_date=2026-09-23%2000%3A00%3A00&end_date=2026-10-07%2006%3A00%3A00&per_page=50&page=2";

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
  url: "https://swing.example/events/",
  kind: "wp_tribe",
  trustTier: "first_party",
  platform: null,
  feedUrl: null,
  metroId: "m",
  styles: [],
  etag: null,
  lastModified: null,
  contentHash: null,
};

const json = (url: string, body: string): Fixture => ({
  request: { method: "GET", url },
  response: { url, status: 200, headers: { "content-type": "application/json" }, body },
});

function ctx(): RunCtx & { requests: string[] } {
  const transport = fixtureTransport([
    json("https://swing.example/robots.txt", "User-agent: *\nDisallow: /wp-admin/\n"),
    json(PAGE_1, fixture("wp-tribe-page-1.json")),
    json(PAGE_2, fixture("wp-tribe-page-2.json")),
  ]);
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

describe("the WordPress Events Calendar adapter", () => {
  it("builds the API address from the site's events page", () => {
    expect(wpTribeUrl("https://swing.example/events/", "2026-09-23", 14)).toBe(PAGE_1);
  });

  it("follows the pages and reads events with their zone, cost, venue and categories", async () => {
    const run = ctx();
    const result = await wpTribeAdapter.harvest!(SOURCE, run);
    expect(run.requests).toEqual([
      "GET https://swing.example/robots.txt",
      `GET ${PAGE_1}`,
      `GET ${PAGE_2}`,
    ]);
    const events = result.listings.map((l) => {
      const o = normalizeListing(l, { metro: NYC, source: SOURCE, now: NOW });
      if (!o.ok) throw new Error(o.reason);
      return o.event;
    });
    // The draft is not published, so it is not read.
    expect(events.map((e) => e.title)).toEqual([
      "Lindy Hop Social – Savoy Night",
      "Balboa & Blues Late Night",
    ]);

    const [savoy, balboa] = events;
    expect(savoy).toMatchObject({
      nightDate: "2026-09-24",
      listingType: "social",
      styles: ["lindy_hop"],
      prices: [{ label: "Entry", amount: 18, currency: "USD", includes: null }],
      // "Event website" is a page about the event, not a stated ticket link (D-070); the event's
      // page on the calendar is its own page (D-073).
      ticketUrl: null,
      canonicalUrl: "https://swing.example/event/savoy-night/",
      eventUrl: "https://swing.example/event/savoy-night/",
      key: "wp:swing.example?id=412",
      venue: {
        name: "Swing 46",
        address: "349 W 46th St, New York, NY, 10036",
        location: { lat: 40.7603, lng: -73.9892 },
      },
      organizer: { name: "Swing Example NYC", url: "https://swing.example/" },
    });
    expect(savoy?.lessonAt?.toISOString()).toBe("2026-09-24T23:30:00.000Z");
    expect(savoy?.dancingAt?.toISOString()).toBe("2026-09-25T00:30:00.000Z");
    expect(savoy?.endsAt?.toISOString()).toBe("2026-09-25T04:00:00.000Z");
    expect(savoy?.provenance).toMatchObject({
      sourceUrl: "https://swing.example/event/savoy-night/",
      method: "api",
    });

    expect(balboa).toMatchObject({ isFree: true, styles: ["balboa"], nightDate: "2026-09-26" });
    expect(balboa?.endsAt?.toISOString()).toBe("2026-09-27T06:00:00.000Z");
  });

  it("lists an all-day event as untimed on its first night (D-060)", () => {
    const { listings, notes } = wpTribeToListings(
      [
        {
          id: 501,
          status: "publish",
          title: "Brooklyn Social",
          all_day: true,
          start_date: "2026-09-25 00:00:00",
          end_date: "2026-09-27 23:59:59",
          timezone: "America/New_York",
          url: "https://swing.example/event/brooklyn-social/",
          venue: { venue: "Brooklyn Commons", address: "495 Flatbush Ave", city: "Brooklyn" },
        },
      ],
      {
        siteUrl: "https://swing.example/events/",
        fetchedAt: NOW,
        metroTz: NYC.tz,
        countryCode: "US",
        fromNight: "2026-09-23",
        days: 14,
      },
    );
    expect(notes).toEqual([]);
    expect(listings).toHaveLength(1);
    const o = normalizeListing(listings[0]!, { metro: NYC, source: SOURCE, now: NOW });
    // The 00:00:00 of an all-day event is not a start: the night is the day, and no time is listed.
    expect(o).toMatchObject({
      ok: true,
      untimed: true,
      event: {
        key: "wp:501",
        nightDate: "2026-09-25",
        startsAt: null,
        endsAt: null,
        evidence: expect.objectContaining({
          start: "start_date 2026-09-25 00:00:00 America/New_York",
        }),
      },
    });
  });

  it("takes the calendar's page as the event's, and its website as tickets only on a ticket seller (D-073)", () => {
    const event = (id: number, website: string | null) => ({
      id,
      status: "publish",
      title: `Night ${id}`,
      start_date: "2026-09-25 20:00:00",
      end_date: "2026-09-25 23:00:00",
      timezone: "America/New_York",
      url: `https://swing.example/event/night-${id}/`,
      website,
      venue: { venue: "Swing 46", address: "349 W 46th St", city: "New York" },
    });
    const { listings } = wpTribeToListings(
      [
        event(1, "https://www.eventbrite.com/e/night-1-tickets-555"),
        event(2, "https://organiser.example/"),
        event(3, "https://www.eventbrite.com/o/organiser-123"),
        event(4, null),
      ],
      {
        siteUrl: "https://swing.example/events/",
        fetchedAt: NOW,
        metroTz: NYC.tz,
        countryCode: "US",
        fromNight: "2026-09-23",
        days: 14,
      },
    );
    expect(listings.map((l) => [l.eventUrl, l.listing.ticket_url])).toEqual([
      ["https://swing.example/event/night-1/", "https://www.eventbrite.com/e/night-1-tickets-555"],
      ["https://swing.example/event/night-2/", null],
      ["https://swing.example/event/night-3/", null],
      ["https://swing.example/event/night-4/", null],
    ]);
  });

  it("takes a Facebook, Meetup or Partiful event as the event's page, never tickets (review #18)", () => {
    const event = (id: number, url: string | null, website: string) => ({
      id,
      status: "publish",
      title: `Night ${id}`,
      start_date: "2026-09-25 20:00:00",
      end_date: "2026-09-25 23:00:00",
      timezone: "America/New_York",
      url,
      website,
      venue: { venue: "Swing 46", address: "349 W 46th St", city: "New York" },
    });
    const facebook = "https://www.facebook.com/events/123456789/";
    const meetup = "https://www.meetup.com/nyc-swing/events/301234567/";
    const partiful = "https://partiful.com/e/abcDEF";
    const { listings } = wpTribeToListings(
      [
        event(1, "https://swing.example/event/night-1/", facebook),
        event(2, null, facebook),
        event(3, null, meetup),
        event(4, null, partiful),
        event(5, null, "https://www.facebook.com/swingexample"),
      ],
      {
        siteUrl: "https://swing.example/events/",
        fetchedAt: NOW,
        metroTz: NYC.tz,
        countryCode: "US",
        fromNight: "2026-09-23",
        days: 14,
      },
    );
    expect(listings.map((l) => [l.eventUrl, l.listing.ticket_url])).toEqual([
      ["https://swing.example/event/night-1/", null],
      [facebook, null],
      [meetup, null],
      [partiful, null],
      [undefined, null],
    ]);
  });

  it("refuses an answer that is not the events API", async () => {
    const transport = fixtureTransport([
      json("https://swing.example/robots.txt", ""),
      json(PAGE_1, "<html>not here</html>"),
    ]);
    const run: RunCtx = {
      ...ctx(),
      http: createPoliteHttp({ transport, userAgent: "t", sleep: async () => {} }),
    };
    await expect(wpTribeAdapter.harvest!(SOURCE, run)).rejects.toThrow("did not answer with JSON");
  });
});
