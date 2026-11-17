import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  daybreakerAdapter,
  daybreakerCards,
  daybreakerWhere,
} from "@/src/adapters/feeds/daybreaker";
import type { Metro, RunCtx, Source } from "@/src/adapters/types";
import { createPoliteHttp, fixtureTransport, type Fixture } from "@/src/pipeline/http";

const DIR = path.join(__dirname, "__fixtures__");
const listFixture = () => readFileSync(path.join(DIR, "daybreaker-events.html"), "utf8");
const eventFixture = () => readFileSync(path.join(DIR, "daybreaker-event-new-york.html"), "utf8");

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

const source = (url: string): Source => ({
  id: "s",
  url,
  kind: "html",
  trustTier: "first_party",
  platform: "daybreaker",
  feedUrl: null,
  metroId: "m",
  styles: ["morning_rave"],
  etag: null,
  lastModified: null,
  contentHash: null,
});

function ctx(fixtures: Fixture[], now: Date): RunCtx & { requests: string[] } {
  // Ensure each unique domain has a robots.txt fixture
  const seen = new Set<string>();
  const enhanced: Fixture[] = [];
  for (const f of fixtures) {
    const url = f.request.url;
    const domain = new URL(url).origin;
    if (!seen.has(domain)) {
      seen.add(domain);
      // Add a permissive robots.txt
      enhanced.push({
        request: { method: "GET", url: `${domain}/robots.txt` },
        response: {
          url: `${domain}/robots.txt`,
          status: 200,
          headers: { "content-type": "text/plain" },
          body: "User-agent: *\nAllow: /\n",
        },
      });
    }
    enhanced.push(f);
  }
  const transport = fixtureTransport(enhanced);
  let t = now.getTime();
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

describe("daybreaker reader", () => {
  it("extracts cards from the list fixture", () => {
    const cards = daybreakerCards(listFixture());
    expect(cards).toHaveLength(12);
    const first = cards[0];
    expect(first).toBeDefined();
    expect(first).toMatchObject({
      url: "https://www.daybreaker.com/event/new-york-10-23/",
      day: "2026-10-23",
      start: "21:00",
      end: "00:00",
      endNextDay: true,
      city: "New York",
      title: "Sauna Rave",
    });
    const eudemonia = cards.find((c) => c.url.includes("eudemonia-summit"));
    expect(eudemonia).toBeDefined();
    expect(eudemonia).toMatchObject({
      start: "07:30",
      end: "09:00",
      endNextDay: false,
    });
    const toronto = cards.find((c) => c.url.includes("toronto-12-11"));
    expect(toronto).toBeDefined();
    expect(toronto!.start).toBe("21:30");
  });

  it("extracts venue from event page", () => {
    const where = daybreakerWhere(eventFixture());
    expect(where).toBe("Othership Williamsburg, New York");
    expect(daybreakerWhere("<p>x</p>")).toBeNull();
  });

  it("harvests New York cards in window, reads event page, leaves out other cities", async () => {
    const now = new Date("2026-10-23T16:00:00Z"); // noon NYC
    const run = ctx(
      [
        {
          request: { method: "GET", url: "https://www.daybreaker.com/our-events/" },
          response: {
            url: "https://www.daybreaker.com/our-events/",
            status: 200,
            headers: { "content-type": "text/html" },
            body: listFixture(),
          },
        },
        {
          request: { method: "GET", url: "https://www.daybreaker.com/event/new-york-10-23/" },
          response: {
            url: "https://www.daybreaker.com/event/new-york-10-23/",
            status: 200,
            headers: { "content-type": "text/html" },
            body: eventFixture(),
          },
        },
      ],
      now,
    );
    const result = await daybreakerAdapter.harvest!(
      source("https://www.daybreaker.com/our-events/"),
      run,
    );
    // Only one New York card in window (10-23). 11-20 is outside window (window is 10-23..11-05)
    expect(result.listings).toHaveLength(1);
    const listing = result.listings[0]!;
    expect(listing).toBeDefined();
    expect(listing.listing.title).toBe("Sauna Rave");
    expect(listing.listing.venue.name).toBe("Othership Williamsburg, New York");
    expect(listing.eventUrl).toBe("https://www.daybreaker.com/event/new-york-10-23/");
    expect(result.whole).toBe(true);
    expect(result.leftOutTitles).toEqual(["Let's Be Friends", "Sauna Rave"]);
    expect(result.notes).toContain("8 other cities' night(s) left out"); // 12 total, 4 New York, 8 others
    expect(run.requests).toEqual([
      "GET https://www.daybreaker.com/robots.txt",
      "GET https://www.daybreaker.com/our-events/",
      "GET https://www.daybreaker.com/event/new-york-10-23/",
    ]);
    // No other city pages fetched
  });

  it("handles event page error, still creates listing", async () => {
    const now = new Date("2026-10-23T16:00:00Z");
    const run = ctx(
      [
        {
          request: { method: "GET", url: "https://www.daybreaker.com/our-events/" },
          response: {
            url: "https://www.daybreaker.com/our-events/",
            status: 200,
            headers: { "content-type": "text/html" },
            body: listFixture(),
          },
        },
        {
          request: { method: "GET", url: "https://www.daybreaker.com/event/new-york-10-23/" },
          response: {
            url: "https://www.daybreaker.com/event/new-york-10-23/",
            status: 404,
            headers: { "content-type": "text/html" },
            body: "Not found",
          },
        },
      ],
      now,
    );
    const result = await daybreakerAdapter.harvest!(
      source("https://www.daybreaker.com/our-events/"),
      run,
    );
    expect(result.listings).toHaveLength(1);
    const listing = result.listings[0]!;
    expect(listing).toBeDefined();
    expect(listing.listing.venue.name).toBeNull();
    expect(result.notes?.some((n) => n.includes("could not be read"))).toBe(true);
  });

  it("returns readWithModel when no cards", async () => {
    const now = new Date();
    const run = ctx(
      [
        {
          request: { method: "GET", url: "https://example.com/" },
          response: {
            url: "https://example.com/",
            status: 200,
            headers: { "content-type": "text/html" },
            body: "<html>no cards</html>",
          },
        },
      ],
      now,
    );
    const result = await daybreakerAdapter.harvest!(source("https://example.com/"), run);
    expect(result.readWithModel).toBe("the page shows no Daybreaker event cards");
  });

  it("returns readWithModel when metro has no city path", async () => {
    const now = new Date();
    const run = ctx(
      [
        {
          request: { method: "GET", url: "https://www.daybreaker.com/our-events/" },
          response: {
            url: "https://www.daybreaker.com/our-events/",
            status: 200,
            headers: { "content-type": "text/html" },
            body: listFixture(),
          },
        },
      ],
      now,
    );
    // Override metro slug to something not in CITY_PATHS
    const metro = { ...NYC, slug: "london" };
    const ctxWithLondon = { ...run, metro };
    const result = await daybreakerAdapter.harvest!(
      source("https://www.daybreaker.com/our-events/"),
      ctxWithLondon as RunCtx,
    );
    expect(result.readWithModel).toBe("Daybreaker has no city page for this metro");
  });
});
