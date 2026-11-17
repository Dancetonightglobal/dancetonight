import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  extractJsonLd,
  findEvents,
  jsonLdAdapter,
  jsonLdToListings,
  offersToPrices,
  eventPagePlace,
} from "@/src/adapters/feeds/jsonld";
import type { Metro, RunCtx, Source } from "@/src/adapters/types";
import { createPoliteHttp, fixtureTransport, type Fixture } from "@/src/pipeline/http";
import { normalizeListing } from "@/src/pipeline/normalize";

// Hand-built in the shapes WordPress (The Events Calendar) and Squarespace emit.
const HTML = readFileSync(path.join(__dirname, "__fixtures__/studio-events.html"), "utf8");
const PAGE = "https://studio.example/events/";
const NOW = new Date("2026-09-23T16:00:00Z");

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
  url: PAGE,
  kind: "jsonld",
  trustTier: "first_party",
  platform: null,
  feedUrl: null,
  metroId: "m",
  styles: [],
  etag: null,
  lastModified: null,
  contentHash: null,
};

function ctxWith(fixtures: Fixture[]): RunCtx {
  let t = NOW.getTime();
  return {
    metro: NYC,
    now: () => new Date(t),
    http: createPoliteHttp({
      transport: fixtureTransport(fixtures),
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

const FIXTURES: Fixture[] = [
  {
    request: { method: "GET", url: "https://studio.example/robots.txt" },
    response: { url: "https://studio.example/robots.txt", status: 404, headers: {}, body: "" },
  },
  {
    request: { method: "GET", url: PAGE },
    response: { url: PAGE, status: 200, headers: { "content-type": "text/html" }, body: HTML },
  },
];

describe("JSON-LD extraction", () => {
  it("parses valid blocks, counts broken ones, and finds events in @graph, ItemList and arrays", () => {
    const { blocks, invalid } = extractJsonLd(HTML);
    expect(blocks).toHaveLength(2);
    expect(invalid).toBe(1);
    expect(findEvents(blocks).map((e) => e.name)).toEqual([
      "West Coast Swing Friday &amp; Social",
      "Hustle Night",
      "Online Salsa Footwork",
      "Bachata Sensual Social",
      "Next Month Showcase",
      undefined,
    ]);
  });

  it("finds the events a place lists under `event`", () => {
    const blocks = [
      {
        "@context": "https://schema.org",
        "@type": "PerformingArtsTheater",
        name: "La Paz Arriba",
        event: [
          { "@type": "Event", name: "Salsa Arriba", startDate: "2026-10-28T19:30:00-03:00" },
          { "@type": "Event", name: "Muy Martes", startDate: "2026-10-27T20:30:00-03:00" },
        ],
      },
    ];
    expect(findEvents(blocks).map((e) => e.name)).toEqual(["Salsa Arriba", "Muy Martes"]);
  });

  it("turns offers into price rows, and a range into one row with no single amount", () => {
    expect(
      offersToPrices({ "@type": "Offer", price: "15.00", priceCurrency: "USD" }, null).prices,
    ).toEqual([{ label: "Entry", amount: 15, currency: "USD", includes: null }]);
    expect(
      offersToPrices(
        { "@type": "AggregateOffer", lowPrice: 10, highPrice: 20, priceCurrency: "EUR" },
        null,
      ).prices,
    ).toEqual([{ label: "Tickets, €10 to €20", amount: null, currency: "EUR", includes: null }]);
    expect(offersToPrices({ "@type": "Offer", price: "0" }, "USD").prices).toEqual([
      { label: "Free", amount: 0, currency: "USD", includes: null },
    ]);
    expect(offersToPrices(undefined, "USD")).toEqual({ prices: null, url: null });
  });
});

describe("the JSON-LD adapter, end to end", () => {
  it("reads a studio page into listings, skipping online, out-of-window and unnamed events", async () => {
    const result = await jsonLdAdapter.harvest!(SOURCE, ctxWith(FIXTURES));
    expect(result.notes).toEqual(
      expect.arrayContaining([
        "online only, skipped: Online Salsa Footwork",
        "an event with no name was skipped",
        "1 JSON-LD block(s) on the page were not valid JSON",
      ]),
    );
    const events = result.listings.map((l) => {
      const outcome = normalizeListing(l, { metro: NYC, source: SOURCE, now: NOW });
      if (!outcome.ok) throw new Error(outcome.reason);
      return outcome.event;
    });
    expect(events.map((e) => e.title)).toEqual([
      "West Coast Swing Friday & Social",
      "Hustle Night",
      "Bachata Sensual Social",
    ]);

    const [wcs, hustle, bachata] = events;
    expect(wcs).toMatchObject({
      nightDate: "2026-09-25",
      listingType: "social",
      styles: ["west_coast_swing"],
      ticketUrl: "https://tickets.example/wcs-friday",
      isFree: false,
      venue: {
        name: "Example Dance Studio",
        address: "39 W 19th St, New York, NY, 10011, US",
        location: { lat: 40.74, lng: -73.993 },
      },
      organizer: { name: "Example Dance Studio", url: "https://studio.example/" },
      prices: [
        { label: "Lesson and social", amount: 25, currency: "USD", includes: null },
        { label: "Social only", amount: 15, currency: "USD", includes: null },
      ],
    });
    expect(wcs?.lessonAt?.toISOString()).toBe("2026-09-26T00:00:00.000Z");
    expect(wcs?.dancingAt?.toISOString()).toBe("2026-09-26T01:00:00.000Z");
    expect(wcs?.endsAt?.toISOString()).toBe("2026-09-26T04:30:00.000Z");
    expect(wcs?.provenance.sourceUrl).toBe("https://studio.example/events/wcs-friday/");
    expect(wcs?.eventUrl).toBe("https://studio.example/events/wcs-friday/");

    // Wall-clock time with no offset is read in the metro's zone.
    expect(hustle?.doorsAt?.toISOString()).toBe("2026-09-27T01:30:00.000Z");
    expect(hustle).toMatchObject({
      styles: ["hustle"],
      prices: [{ label: "Tickets, $10 to $20", amount: null, currency: "USD", includes: null }],
      music: { djs: ["DJ Rubén"], bands: ["The Hustle Band"] },
      // No offer states a ticket link: the event's own page is its canonical URL (D-070).
      ticketUrl: null,
      canonicalUrl: "https://studio.example/events/hustle/",
    });

    expect(bachata).toMatchObject({
      cancelled: true,
      confirmation: "cancelled",
      isFree: true,
      styles: ["bachata"],
    });
  });

  it("takes an event's url as its own page, but not a list page's own address (D-073)", () => {
    const place = { "@type": "Place", name: "Studio K", address: "245 W 29th St, New York, NY" };
    const node = (name: string, startDate: string, url: string) => ({
      "@type": "DanceEvent",
      name,
      startDate,
      url,
      location: place,
    });
    const read = (pageUrl: string, nodes: unknown[]) =>
      jsonLdToListings([{ "@context": "https://schema.org", "@graph": nodes }], {
        pageUrl,
        fetchedAt: NOW,
        metroTz: NYC.tz,
        countryCode: "US",
        fromNight: "2026-09-23",
        days: 14,
      }).listings.map((l) => l.eventUrl ?? null);
    const LIST = "https://studio.example/events";
    // A list of different events that each give the list's address: none is its own page.
    expect(
      read(LIST, [
        node("Salsa Social", "2026-09-25T21:00", LIST),
        node("Bachata Social", "2026-09-26T21:00", `${LIST}/`),
        node("Zouk Social", "2026-09-27T21:00", `${LIST}/zouk-social`),
      ]),
    ).toEqual([null, null, `${LIST}/zouk-social`]);
    // One event's page with its dates: the page is the event's own.
    const ONE = "https://studio.example/events/salsa-social";
    expect(
      read(ONE, [
        node("Salsa Social", "2026-09-25T21:00", ONE),
        node("Salsa Social", "2026-10-02T21:00", ONE),
      ]),
    ).toEqual([ONE, ONE]);
  });

  it("lists a date-only startDate as untimed, a multi-day span on its first night only (D-060)", () => {
    const place = {
      "@type": "Place",
      name: "Brooklyn Commons",
      address: "495 Flatbush Ave, Brooklyn, NY",
    };
    const { listings, notes } = jsonLdToListings(
      [
        {
          "@context": "https://schema.org",
          "@graph": [
            {
              "@type": "DanceEvent",
              name: "Brooklyn Social",
              startDate: "2026-09-25",
              url: "https://studio.example/events/brooklyn-social/",
              location: place,
            },
            {
              "@type": "Festival",
              name: "Zouk Weekender",
              startDate: "2026-10-02",
              endDate: "2026-10-04",
              location: place,
            },
            { "@type": "Event", name: "Studio closed", startDate: "2026-09-26", location: place },
          ],
        },
      ],
      {
        pageUrl: PAGE,
        fetchedAt: NOW,
        metroTz: NYC.tz,
        countryCode: "US",
        fromNight: "2026-09-23",
        days: 14,
      },
    );
    expect(notes).toEqual([]);
    const outcomes = listings.map((l) =>
      normalizeListing(l, { metro: NYC, source: SOURCE, now: NOW }),
    );
    expect(outcomes[0]).toMatchObject({
      ok: true,
      untimed: true,
      event: {
        title: "Brooklyn Social",
        nightDate: "2026-09-25",
        startsAt: null,
        key: "https://studio.example/events/brooklyn-social/#2026-09-25",
        evidence: expect.objectContaining({ start: "startDate 2026-09-25" }),
      },
    });
    // One listing on the first night, with no end time invented from the span.
    expect(outcomes[1]).toMatchObject({
      ok: true,
      untimed: true,
      event: { title: "Zouk Weekender", nightDate: "2026-10-02", endsAt: null },
    });
    // A closure notice passes the adapter and is screened as not an event before it is stored.
    expect(outcomes[2]).toMatchObject({ ok: false, kind: "not_an_event", title: "Studio closed" });
  });

  it("reads the same events as unchanged on the next visit", async () => {
    const first = await jsonLdAdapter.harvest!(SOURCE, ctxWith(FIXTURES));
    const second = await jsonLdAdapter.harvest!(
      { ...SOURCE, contentHash: first.doc!.contentHash },
      ctxWith(FIXTURES),
    );
    expect(second.unchanged).toBe(true);
  });

  describe("eventPagePlace", () => {
    it("reads a single Event with a PostalAddress", () => {
      const obj = {
        "@context": "https://schema.org",
        "@type": "Event",
        name: "West Coast Swing Friday",
        location: {
          "@type": "Place",
          name: "Urbane Arts Club",
          address: {
            "@type": "PostalAddress",
            streetAddress: "1016 Beverley Rd",
            addressLocality: "Brooklyn",
            addressRegion: "NY",
            postalCode: "11218",
            addressCountry: "US",
          },
        },
      };
      const html = `<html><head><script type="application/ld+json">${JSON.stringify(
        obj,
      )}</script></head></html>`;
      const place = eventPagePlace(html);
      expect(place).toEqual({
        name: "Urbane Arts Club",
        address: "1016 Beverley Rd, Brooklyn, NY, 11218, US",
        location: null,
        evidence: "location Urbane Arts Club, 1016 Beverley Rd, Brooklyn, NY, 11218, US",
      });
    });

    it("includes geo coordinates when present", () => {
      const obj = {
        "@context": "https://schema.org",
        "@type": "Event",
        location: {
          "@type": "Place",
          name: "Urbane Arts Club",
          address: "1016 Beverley Rd, Brooklyn, NY 11218",
          geo: { "@type": "GeoCoordinates", latitude: 40.64, longitude: -73.96 },
        },
      };
      const html = `<html><head><script type="application/ld+json">${JSON.stringify(
        obj,
      )}</script></head></html>`;
      const place = eventPagePlace(html);
      expect(place).toMatchObject({
        name: "Urbane Arts Club",
        address: "1016 Beverley Rd, Brooklyn, NY 11218",
        location: { lat: 40.64, lng: -73.96 },
      });
      expect(place?.evidence).toBe(
        "location Urbane Arts Club, 1016 Beverley Rd, Brooklyn, NY 11218",
      );
    });

    it("unifies addresses that differ only in case and punctuation", () => {
      const obj = {
        "@context": "https://schema.org",
        "@graph": [
          {
            "@type": "Event",
            name: "Event A",
            location: {
              "@type": "Place",
              address: "11-01 43rd Ave, Long Island City, NY 11101",
            },
          },
          {
            "@type": "Event",
            name: "Event B",
            location: {
              "@type": "Place",
              address: "11-01 43rd ave, Long Island City, NY 11101",
            },
          },
        ],
      };
      const html = `<html><head><script type="application/ld+json">${JSON.stringify(
        obj,
      )}</script></head></html>`;
      const place = eventPagePlace(html);
      expect(place).not.toBeNull();
      expect(place?.address).toBe("11-01 43rd Ave, Long Island City, NY 11101");
    });

    it("returns null for two different addresses", () => {
      const obj = {
        "@context": "https://schema.org",
        "@graph": [
          {
            "@type": "Event",
            location: { "@type": "Place", address: "1016 Beverley Rd, Brooklyn, NY 11218" },
          },
          {
            "@type": "Event",
            location: { "@type": "Place", address: "245 W 29th St, New York, NY 10001" },
          },
        ],
      };
      const html = `<html><head><script type="application/ld+json">${JSON.stringify(
        obj,
      )}</script></head></html>`;
      const place = eventPagePlace(html);
      expect(place).toBeNull();
    });

    it("returns null for online-only events", () => {
      const obj = {
        "@context": "https://schema.org",
        "@type": "Event",
        eventAttendanceMode: "https://schema.org/OnlineEventAttendanceMode",
        location: { "@type": "VirtualLocation", url: "https://zoom.us/j/1" },
      };
      const html = `<html><head><script type="application/ld+json">${JSON.stringify(
        obj,
      )}</script></head></html>`;
      const place = eventPagePlace(html);
      expect(place).toBeNull();
    });

    it("returns null for pages without relevant JSON-LD", () => {
      const html = `<html><head><script type="application/ld+json">{
        "@context": "https://schema.org",
        "@type": "Organization",
        "name": "Example Studio"
      }</script></head></html>`;
      const place = eventPagePlace(html);
      expect(place).toBeNull();
    });

    it("returns null for pages with no JSON-LD", () => {
      const html = `<html><body>No script</body></html>`;
      const place = eventPagePlace(html);
      expect(place).toBeNull();
    });
  });
});
