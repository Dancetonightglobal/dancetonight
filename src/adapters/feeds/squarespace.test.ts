import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { MAX_ITEM_PAGES } from "@/src/adapters/feeds/event-pages";
import {
  clock,
  isEventsList,
  listedItems,
  listedToListing,
  squarespaceAdapter,
} from "@/src/adapters/feeds/squarespace";
import type { Metro, RunCtx, Source } from "@/src/adapters/types";
import { createPoliteHttp, fixtureTransport, type Fixture } from "@/src/pipeline/http";

// Pages saved from the live sites on 2026-10-04 (src/adapters/feeds/__fixtures__/event-pages,
// trimmed to what the reader reads). Noon in New York that day.
const NOW = new Date("2026-10-04T16:00:00Z");
const DIR = path.join(__dirname, "__fixtures__/event-pages");
const fixture = (name: string) => readFileSync(path.join(DIR, name), "utf8");
const page = (url: string, body: string, status = 200): Fixture => ({
  request: { method: "GET", url },
  response: { url, status, headers: { "content-type": "text/html" }, body },
});
const robots = (origin: string): Fixture =>
  page(
    `${origin}/robots.txt`,
    "User-agent: *\nDisallow: /*?format=json\nDisallow: /*?format=ical\n",
  );

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

const source = (url: string, feedUrl: string | null = null): Source => ({
  id: "s",
  url,
  kind: "squarespace",
  trustTier: "first_party",
  platform: "squarespace",
  feedUrl,
  metroId: "m",
  styles: [],
  etag: null,
  lastModified: null,
  contentHash: null,
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

const CONTRA = "https://www.brooklyncontra.org";

describe("a Squarespace events page, read as a browser shows it (D-111)", () => {
  it("reads 12-hour clocks as Squarespace prints them", () => {
    expect(clock("8:30 PM")).toBe("20:30");
    expect(clock("8:30 PM")).toBe("20:30");
    expect(clock("4:30 p.m.")).toBe("16:30");
    expect(clock("12:00 a.m.")).toBe("00:00");
    expect(clock("12:15 PM")).toBe("12:15");
    expect(clock("20:30")).toBe("20:30");
    expect(clock("13:00 PM")).toBeNull();
    expect(clock("TBA")).toBeNull();
  });

  it("lists the upcoming items with their nights, clocks and places", () => {
    const items = listedItems(fixture("brooklyncontra-events.html"), `${CONTRA}/events`);
    expect(items).toHaveLength(22);
    expect(items[0]).toMatchObject({
      url: `${CONTRA}/events/2026-07-25-jwff8-pe62l-dn66s-wpj3r`,
      night: "2026-10-04",
      title: "A Contra Dance for All!",
      startTime: "16:30",
      endTime: "20:00",
      venueName: "Camp Friendship",
    });
    expect(items[0]!.address).toMatch(/^339 8th Street/);
    // A span names its first and last day.
    expect(items.find((i) => i.title === "Five Borough Fling")).toMatchObject({
      night: "2026-11-06",
      endDay: "2026-11-08",
    });
  });

  it("follows only the items in the window, and reads each page's Event under the list's title", async () => {
    const run = ctx([
      robots(CONTRA),
      page(`${CONTRA}/events`, fixture("brooklyncontra-events.html")),
      page(
        `${CONTRA}/events/2026-07-25-jwff8-pe62l-dn66s-wpj3r`,
        fixture("brooklyncontra-20261004.html"),
      ),
      page(`${CONTRA}/events/gather-round-2026-shfn8`, fixture("brooklyncontra-gather-round.html")),
    ]);
    const result = await squarespaceAdapter.harvest!(
      source("https://brooklyncontra.org/", `${CONTRA}/events`),
      run,
    );
    // 22 upcoming items; 2 fall on the nights 10/4 to 10/17. No ?format= view is ever asked for.
    expect(run.requests).toEqual([
      `GET ${CONTRA}/robots.txt`,
      `GET ${CONTRA}/events`,
      `GET ${CONTRA}/events/2026-07-25-jwff8-pe62l-dn66s-wpj3r`,
      `GET ${CONTRA}/events/gather-round-2026-shfn8`,
    ]);
    expect(result.whole).toBe(true);
    expect(result.readWithModel).toBeUndefined();
    const rows = result.listings.map(({ listing, provenance }) => ({
      title: listing.title,
      night: listing.local_date,
      start: listing.doors_time ?? listing.dancing_time ?? listing.lesson_time,
      end: listing.end_time,
      venue: listing.venue.name,
      method: provenance.method,
      page: provenance.sourceUrl,
    }));
    expect(rows).toEqual([
      {
        title: "A Contra Dance for All!",
        night: "2026-10-04",
        start: "16:30",
        end: "20:00",
        venue: "Camp Friendship",
        method: "jsonld",
        page: `${CONTRA}/events/2026-07-25-jwff8-pe62l-dn66s-wpj3r`,
      },
      {
        title: "A Barn Dance in Battery Park City!",
        night: "2026-10-17",
        start: "17:00",
        end: "18:30",
        venue: "Battery Park City Robert Wagner Jr. Park",
        method: "jsonld",
        page: `${CONTRA}/events/gather-round-2026-shfn8`,
      },
    ]);
    expect(result.listings[0]!.listing.venue.address).toMatch(/339 8th Street.*Brooklyn/);
  });

  it("takes an item from the list when its page cannot be read, and calls the read partial", async () => {
    const run = ctx([
      robots(CONTRA),
      page(`${CONTRA}/events`, fixture("brooklyncontra-events.html")),
      page(`${CONTRA}/events/2026-07-25-jwff8-pe62l-dn66s-wpj3r`, "Not found", 404),
      page(`${CONTRA}/events/gather-round-2026-shfn8`, fixture("brooklyncontra-gather-round.html")),
    ]);
    const result = await squarespaceAdapter.harvest!(source(`${CONTRA}/events`), run);
    expect(result.whole).toBeUndefined();
    const first = result.listings.find((l) => l.listing.local_date === "2026-10-04")!;
    expect(first.listing).toMatchObject({ title: "A Contra Dance for All!", end_time: "20:00" });
    expect(first.listing.doors_time ?? first.listing.dancing_time).toBe("16:30");
    expect(first.listing.venue.name).toBe("Camp Friendship");
    expect(result.notes?.some((n) => n.includes("read from the list instead"))).toBe(true);
  });

  it("reads Frim Fram Jam's Thursdays and Blues Dance New York's empty fortnight", async () => {
    const FFJ = "https://frimframjam.com";
    const run = ctx([
      robots(FFJ),
      page(`${FFJ}/calendar`, fixture("frimframjam-calendar.html")),
      page(`${FFJ}/calendar/20261008`, fixture("frimframjam-20261008.html")),
      page(`${FFJ}/calendar/20261015`, fixture("frimframjam-20261015.html")),
    ]);
    const ffj = await squarespaceAdapter.harvest!(
      { ...source(`${FFJ}/calendar`), styles: ["lindy_hop"] },
      run,
    );
    expect(
      ffj.listings.map((l) => [
        l.listing.local_date,
        l.listing.doors_time,
        l.listing.title,
        l.listing.styles,
      ]),
    ).toEqual([
      // "w/ DJs" names a DJ night's words; on a Lindy hop organiser's page it is its swing night.
      ["2026-10-08", "20:30", "Oct 8- NYLX Warmup w/ DJs TJ Savino & Claire Lorman", ["lindy_hop"]],
      ["2026-10-15", "20:30", "Oct 15 - Third Thursdays w/ Eyal Vilner", []],
    ]);
    expect(ffj.whole).toBe(true);

    const BLUES = "https://www.bluesdancenewyork.com";
    const blues = ctx([robots(BLUES), page(`${BLUES}/events`, fixture("bluesdance-events.html"))]);
    const empty = await squarespaceAdapter.harvest!(source(`${BLUES}/events`), blues);
    // Its next dance is 10/30: a whole read of a list with nothing in the window, not a failure.
    expect(empty.listings).toEqual([]);
    expect(empty.whole).toBe(true);
    expect(empty.readWithModel).toBeUndefined();
  });

  it("hands a page with no events list to the model, never answering it with no listings", async () => {
    const SITE = "https://square.example";
    const html = `<html><head><meta name="generator" content="Squarespace"></head>
      <body><p>Socials every Friday at 8pm.</p></body></html>`;
    expect(isEventsList(html)).toBe(false);
    const run = ctx([robots(SITE), page(`${SITE}/socials`, html)]);
    const result = await squarespaceAdapter.harvest!(source(`${SITE}/socials`), run);
    expect(result.readWithModel).toBe("the page has no Squarespace events list");
    expect(result.whole).toBeUndefined();
  });

  it("reads at most the cap of event pages, and then calls the read partial", async () => {
    const SITE = "https://many.example";
    const n = MAX_ITEM_PAGES + 2;
    const article = (i: number) =>
      `<article class="eventlist-event eventlist-event--upcoming"><h1 class="eventlist-title"><a href="/events/${i}" class="eventlist-title-link">Social ${i}</a></h1>
       <time class="event-date" datetime="2026-10-05">Monday</time></article>`;
    const list = `<div class="eventlist eventlist--upcoming">${Array.from({ length: n }, (_, i) => article(i)).join("")}</div>`;
    const event = (i: number) =>
      `<script type="application/ld+json">{"@type":"Event","name":"Social ${i}","startDate":"2026-10-05T20:00:00-0400","location":{"@type":"Place","name":"Hall","address":"1 Main St, New York, NY"}}</script>`;
    const run = ctx([
      robots(SITE),
      page(`${SITE}/events`, list),
      ...Array.from({ length: n }, (_, i) => page(`${SITE}/events/${i}`, event(i))),
    ]);
    const result = await squarespaceAdapter.harvest!(source(`${SITE}/events`), run);
    expect(result.listings).toHaveLength(MAX_ITEM_PAGES);
    expect(result.whole).toBeUndefined();
    expect(result.notes?.[1]).toBe(
      `${n} event pages in the window; read the first ${MAX_ITEM_PAGES}`,
    );
  });

  it("puts a list item that starts after midnight on the night before, and an end past midnight on its night", () => {
    const at = (startTime: string, endTime: string | null) =>
      listedToListing(
        {
          url: "https://x.example/events/late",
          night: "2026-10-10",
          endDay: null,
          title: "Late social",
          startTime,
          endTime,
          venueName: "Hall",
          address: null,
          categories: ["Salsa"],
        },
        { fetchedAt: NOW, zone: "America/New_York", countryCode: "US" },
      )!.listing;
    expect(at("01:00", null).local_date).toBe("2026-10-09");
    const late = at("22:00", "02:00");
    expect(late.local_date).toBe("2026-10-10");
    expect(late.end_time).toBe("02:00");
    expect(late.styles).toContain("salsa");
  });
});
