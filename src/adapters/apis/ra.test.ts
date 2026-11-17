import { describe, expect, it } from "vitest";

import fixture from "./__fixtures__/ra/eventlistings-miami.json";

function robotsFixture(body = "User-agent: *\nDisallow: /api/\n"): Fixture {
  return {
    request: {
      method: "GET",
      url: "https://ra.co/robots.txt",
      body: undefined,
    },
    response: {
      url: "https://ra.co/robots.txt",
      status: 200,
      headers: { "content-type": "text/plain" },
      body,
    },
  };
}

import {
  raAdapter,
  raToListings,
  isRaBlocked,
  RA_ENDPOINT,
  RA_PAGE_SIZE,
  RA_MAX_REQUESTS,
  RA_QUERY,
  RA_QUERY_MINIMAL,
} from "@/src/adapters/apis/ra";
import type { Metro, RunCtx, Source } from "@/src/adapters/types";
import { createPoliteHttp, fixtureTransport, type Fixture } from "@/src/pipeline/http";

const NOW = new Date("2026-10-31T16:00:00Z");
const MIAMI: Metro = {
  id: "m",
  slug: "miami",
  name: "Miami",
  countryCode: "US",
  center: { lat: 25.7617, lng: -80.1918 },
  radiusKm: 50,
  tz: "America/New_York",
  languages: ["en"],
};

const source: Source = {
  id: "s",
  url: "https://ra.co/graphql?area=38",
  kind: "ticketing_api",
  trustTier: "ticketing",
  platform: "ra",
  feedUrl: null,
  metroId: "m",
  styles: [],
  etag: null,
  lastModified: null,
  contentHash: null,
};

function ctx(fixtures: Fixture[]): RunCtx & { requests: string[] } {
  const transport = fixtureTransport(fixtures);
  let t = NOW.getTime();
  return {
    metro: MIAMI,
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

describe("RA adapter", () => {
  const fixtureRows = fixture.data.eventListings.data as unknown[];

  it("raToListings extracts 3 listings from fixture", () => {
    const { listings, notes } = raToListings(fixtureRows, {
      fetchedAt: NOW,
      metroTz: "America/New_York",
      fromNight: "2026-10-31",
    });
    expect(listings).toHaveLength(3);
    expect(listings.map((l) => l.externalId)).toEqual(["ra:2201001", "ra:2201002", "ra:2201003"]);
    const [first, second, third] = listings;
    expect(first?.listing.title).toBe("Daft Disko Halloween");
    expect(first?.listing.doors_time).toBe("22:00");
    expect(first?.listing.end_time).toBe("05:00");
    expect(first?.listing.venue?.name).toBe("Edge Miami");
    expect(first?.listing.music.djs).toEqual(["DJ A", "DJ B"]);
    expect(first?.eventUrl).toBe("https://ra.co/events/2201001");
    expect(first?.venueLocation).toEqual({ lat: 25.7907, lng: -80.136 });
    expect(second?.listing.title).toBe("Area 94");
    expect(second?.listing.end_time).toBeNull();
    expect(second?.venueLocation).toBeNull();
    // Third listing (2201003) should have time null (date-only)
    expect(third?.listing.doors_time).toBeNull();
    expect(notes).toContain("no start time: Late Night");
  });

  it("harvest sends POST with correct variables and headers", async () => {
    const requestBody = JSON.stringify({
      operationName: "GET_EVENT_LISTINGS",
      query: RA_QUERY,
      variables: {
        filters: {
          areas: { eq: 38 },
          listingDate: { gte: "2026-10-31T00:00:00.000Z", lte: "2026-11-13T23:59:59.999Z" },
        },
        pageSize: RA_PAGE_SIZE,
        page: 1,
      },
    });
    const run = ctx([
      robotsFixture(),
      {
        request: {
          method: "POST",
          url: RA_ENDPOINT,
          body: requestBody,
        },
        response: {
          url: RA_ENDPOINT,
          status: 200,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            data: {
              eventListings: {
                data: [],
                totalResults: 0,
              },
            },
          }),
        },
      },
    ]);
    const result = await raAdapter.harvest!(source, run);
    expect(result.listings).toEqual([]);
    expect(result.whole).toBe(true);
    // robots.txt request + 1 POST = 2 requests
    expect(run.requests).toHaveLength(2);
    // The note should include "0 RA listing(s), totalResults 0, 1 request(s)"
    expect(result.notes?.[0]).toMatch(
      /0 RA listing\(s\), totalResults 0, 1 request\(s\), full query/,
    );
    // Check that robots.txt note is present
    expect(result.notes).toContain("robots.txt allows /graphql");
  });

  it("pages until fewer than page size", async () => {
    const fullPage = Array.from({ length: RA_PAGE_SIZE }, (_, i) => ({
      id: `listing${i}`,
      event: {
        id: `event${i}`,
        title: `Event ${i}`,
        date: "2026-10-31T20:00:00.000",
        startTime: "2026-10-31T20:00:00.000",
        venue: { name: "Venue" },
      },
    }));
    const shortPage = fullPage.slice(0, 10);
    const run = ctx([
      robotsFixture(),
      {
        request: {
          method: "POST",
          url: RA_ENDPOINT,
          body: JSON.stringify({
            operationName: "GET_EVENT_LISTINGS",
            query: RA_QUERY,
            variables: {
              filters: {
                areas: { eq: 38 },
                listingDate: { gte: "2026-10-31T00:00:00.000Z", lte: "2026-11-13T23:59:59.999Z" },
              },
              pageSize: RA_PAGE_SIZE,
              page: 1,
            },
          }),
        },
        response: {
          url: RA_ENDPOINT,
          status: 200,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            data: {
              eventListings: {
                data: fullPage,
                totalResults: 60,
              },
            },
          }),
        },
      },
      {
        request: {
          method: "POST",
          url: RA_ENDPOINT,
          body: JSON.stringify({
            operationName: "GET_EVENT_LISTINGS",
            query: RA_QUERY,
            variables: {
              filters: {
                areas: { eq: 38 },
                listingDate: { gte: "2026-10-31T00:00:00.000Z", lte: "2026-11-13T23:59:59.999Z" },
              },
              pageSize: RA_PAGE_SIZE,
              page: 2,
            },
          }),
        },
        response: {
          url: RA_ENDPOINT,
          status: 200,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            data: {
              eventListings: {
                data: shortPage,
                totalResults: 60,
              },
            },
          }),
        },
      },
    ]);
    const result = await raAdapter.harvest!(source, run);
    // robots.txt + 2 POSTs = 3 requests
    expect(run.requests).toHaveLength(3);
    expect(result.notes?.[0]).toMatch(/RA listing/);
    expect(result.notes).toContain("robots.txt allows /graphql");
  });

  it("stops at RA_MAX_REQUESTS with note", async () => {
    const fullPage = Array.from({ length: RA_PAGE_SIZE }, (_, i) => ({
      id: `listing${i}`,
      event: {
        id: `event${i}`,
        title: `Event ${i}`,
        date: "2026-10-31T20:00:00.000",
        startTime: "2026-10-31T20:00:00.000",
        venue: { name: "Venue" },
      },
    }));
    const fixtures = [
      robotsFixture(),
      ...Array.from({ length: RA_MAX_REQUESTS }, (_, pageIndex) => ({
        request: {
          method: "POST" as const,
          url: RA_ENDPOINT,
          body: JSON.stringify({
            operationName: "GET_EVENT_LISTINGS",
            query: RA_QUERY,
            variables: {
              filters: {
                areas: { eq: 38 },
                listingDate: { gte: "2026-10-31T00:00:00.000Z", lte: "2026-11-13T23:59:59.999Z" },
              },
              pageSize: RA_PAGE_SIZE,
              page: pageIndex + 1,
            },
          }),
        },
        response: {
          url: RA_ENDPOINT,
          status: 200,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            data: {
              eventListings: {
                data: fullPage,
                totalResults: 1000,
              },
            },
          }),
        },
      })),
    ];
    const run = ctx(fixtures);
    const result = await raAdapter.harvest!(source, run);
    // robots.txt + RA_MAX_REQUESTS POSTs
    expect(run.requests).toHaveLength(RA_MAX_REQUESTS + 1);
    // The adapter should note that it stopped at max requests
    expect(result.notes?.some((note) => note.includes("stopped at RA_MAX_REQUESTS"))).toBe(true);
    // Also check that the note includes totalResults
    expect(result.notes?.some((note) => note.includes("totalResults 1000"))).toBe(true);
    expect(result.notes).toContain("robots.txt allows /graphql");
  });

  it("throws on block at page 1", async () => {
    const run = ctx([
      robotsFixture(),
      {
        request: {
          method: "POST",
          url: RA_ENDPOINT,
          body: JSON.stringify({
            operationName: "GET_EVENT_LISTINGS",
            query: RA_QUERY,
            variables: {
              filters: {
                areas: { eq: 38 },
                listingDate: { gte: "2026-10-31T00:00:00.000Z", lte: "2026-11-13T23:59:59.999Z" },
              },
              pageSize: RA_PAGE_SIZE,
              page: 1,
            },
          }),
        },
        response: {
          url: RA_ENDPOINT,
          status: 403,
          headers: { "content-type": "text/html" },
          body: "<html>blocked</html>",
        },
      },
    ]);
    await expect(raAdapter.harvest!(source, run)).rejects.toThrow("RA blocked");
  });

  it("returns page 1 listings and note when blocked on page 2", async () => {
    const page1 = Array.from({ length: RA_PAGE_SIZE }, (_, i) => ({
      id: `listing${i + 1}`,
      event: {
        id: `event${i + 1}`,
        title: `Event ${i + 1}`,
        date: "2026-10-31T00:00:00.000",
        startTime: "2026-10-31T20:00:00.000",
        venue: { name: "Venue" },
      },
    }));
    const run = ctx([
      robotsFixture(),
      {
        request: {
          method: "POST",
          url: RA_ENDPOINT,
          body: JSON.stringify({
            operationName: "GET_EVENT_LISTINGS",
            query: RA_QUERY,
            variables: {
              filters: {
                areas: { eq: 38 },
                listingDate: { gte: "2026-10-31T00:00:00.000Z", lte: "2026-11-13T23:59:59.999Z" },
              },
              pageSize: RA_PAGE_SIZE,
              page: 1,
            },
          }),
        },
        response: {
          url: RA_ENDPOINT,
          status: 200,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            data: {
              eventListings: {
                data: page1,
                totalResults: 100,
              },
            },
          }),
        },
      },
      {
        request: {
          method: "POST",
          url: RA_ENDPOINT,
          body: JSON.stringify({
            operationName: "GET_EVENT_LISTINGS",
            query: RA_QUERY,
            variables: {
              filters: {
                areas: { eq: 38 },
                listingDate: { gte: "2026-10-31T00:00:00.000Z", lte: "2026-11-13T23:59:59.999Z" },
              },
              pageSize: RA_PAGE_SIZE,
              page: 2,
            },
          }),
        },
        response: {
          url: RA_ENDPOINT,
          status: 200,
          headers: { "content-type": "text/html" },
          body: "<html>captcha-delivery</html>",
        },
      },
    ]);
    const result = await raAdapter.harvest!(source, run);
    expect(result.listings).toHaveLength(RA_PAGE_SIZE);
    // The note will be "RA blocked on page 2: blocked response (status 200); stopped"
    expect(result.notes?.some((note) => note.includes("blocked on page"))).toBe(true);
    expect(result.whole).toBeUndefined();
    expect(result.notes).toContain("robots.txt allows /graphql");
  });

  it("isRaBlocked detects blocks", () => {
    expect(isRaBlocked(403, "{}")).toBe(true);
    expect(isRaBlocked(429, "{}")).toBe(true);
    expect(isRaBlocked(200, "<html>captcha</html>")).toBe(true);
    expect(isRaBlocked(200, "DataDome block")).toBe(true);
    expect(isRaBlocked(200, "not json")).toBe(true);
    expect(isRaBlocked(200, '{"errors":[]}')).toBe(true);
    expect(isRaBlocked(200, '{"data":{"eventListings":{}}}')).toBe(false);
    // JSON with data.eventListings and title containing "Captcha" is not blocked
    expect(isRaBlocked(200, '{"data":{"eventListings":{}},"errors":[]}')).toBe(false);
    // JSON with captcha in the text but valid structure is not blocked
    expect(
      isRaBlocked(200, '{"data":{"eventListings":{"data":[{"event":{"title":"Captcha Night"}}]}}}'),
    ).toBe(false);
    // Non-JSON with captcha is blocked
    expect(isRaBlocked(200, "<html>captcha-delivery</html>")).toBe(true);
  });

  it("throws on source without area id", async () => {
    const badSource: Source = { ...source, url: "https://ra.co/graphql" };
    const run = ctx([robotsFixture()]);
    await expect(raAdapter.harvest!(badSource, run)).rejects.toThrow("RA source has no area id");
  });

  it("robots Disallow: /graphql -> harvest throws disallows /graphql and makes no POST", async () => {
    const run = ctx([
      {
        ...robotsFixture("User-agent: *\nDisallow: /graphql\n"),
      },
    ]);
    await expect(raAdapter.harvest!(source, run)).rejects.toThrow(
      "RA robots.txt disallows /graphql (rule: disallow /graphql)",
    );
    // No POST requests should be made
    expect(run.requests).toHaveLength(1); // only robots.txt
  });

  it("default robots -> notes include 'robots.txt allows /graphql'", async () => {
    const run = ctx([
      robotsFixture(),
      {
        request: {
          method: "POST",
          url: RA_ENDPOINT,
          body: JSON.stringify({
            operationName: "GET_EVENT_LISTINGS",
            query: RA_QUERY,
            variables: {
              filters: {
                areas: { eq: 38 },
                listingDate: { gte: "2026-10-31T00:00:00.000Z", lte: "2026-11-13T23:59:59.999Z" },
              },
              pageSize: RA_PAGE_SIZE,
              page: 1,
            },
          }),
        },
        response: {
          url: RA_ENDPOINT,
          status: 200,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            data: {
              eventListings: {
                data: [],
                totalResults: 0,
              },
            },
          }),
        },
      },
    ]);
    const result = await raAdapter.harvest!(source, run);
    expect(result.notes).toContain("robots.txt allows /graphql");
    expect(run.requests).toHaveLength(2); // robots.txt + POST
  });

  it("falls back to minimal query when full query rejected", async () => {
    const run = ctx([
      robotsFixture(),
      {
        request: {
          method: "POST",
          url: RA_ENDPOINT,
          body: JSON.stringify({
            operationName: "GET_EVENT_LISTINGS",
            query: RA_QUERY,
            variables: {
              filters: {
                areas: { eq: 38 },
                listingDate: { gte: "2026-10-31T00:00:00.000Z", lte: "2026-11-13T23:59:59.999Z" },
              },
              pageSize: RA_PAGE_SIZE,
              page: 1,
            },
          }),
        },
        response: {
          url: RA_ENDPOINT,
          status: 200,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            errors: [{ message: 'Cannot query field "location" on type "Venue"' }],
          }),
        },
      },
      {
        request: {
          method: "POST",
          url: RA_ENDPOINT,
          body: JSON.stringify({
            operationName: "GET_EVENT_LISTINGS",
            query: RA_QUERY_MINIMAL,
            variables: {
              filters: {
                areas: { eq: 38 },
                listingDate: { gte: "2026-10-31T00:00:00.000Z", lte: "2026-11-13T23:59:59.999Z" },
              },
              pageSize: RA_PAGE_SIZE,
              page: 1,
            },
          }),
        },
        response: {
          url: RA_ENDPOINT,
          status: 200,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            data: {
              eventListings: {
                data: [
                  {
                    id: "listing1",
                    event: {
                      id: "event1",
                      title: "Event",
                      date: "2026-10-31T00:00:00.000",
                      venue: { name: "Venue" },
                    },
                  },
                ],
                totalResults: 1,
              },
            },
          }),
        },
      },
    ]);
    const result = await raAdapter.harvest!(source, run);
    // The note will be "RA full query rejected: Cannot query field \"location\" on type \"Venue\"; using the minimal query"
    expect(result.notes?.some((note) => note.includes("RA full query rejected"))).toBe(true);
    expect(result.notes?.[0]).toMatch(/minimal query$/);
    expect(result.listings).toHaveLength(1);
    // The listing should have time null (date-only)
    expect(result.listings[0]?.listing.doors_time).toBeNull();
    expect(result.notes).toContain("robots.txt allows /graphql");
  });

  it("throws when both queries rejected", async () => {
    const run = ctx([
      robotsFixture(),
      {
        request: {
          method: "POST",
          url: RA_ENDPOINT,
          body: JSON.stringify({
            operationName: "GET_EVENT_LISTINGS",
            query: RA_QUERY,
            variables: {
              filters: {
                areas: { eq: 38 },
                listingDate: { gte: "2026-10-31T00:00:00.000Z", lte: "2026-11-13T23:59:59.999Z" },
              },
              pageSize: RA_PAGE_SIZE,
              page: 1,
            },
          }),
        },
        response: {
          url: RA_ENDPOINT,
          status: 200,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            errors: [{ message: 'Cannot query field "location"' }],
          }),
        },
      },
      {
        request: {
          method: "POST",
          url: RA_ENDPOINT,
          body: JSON.stringify({
            operationName: "GET_EVENT_LISTINGS",
            query: RA_QUERY_MINIMAL,
            variables: {
              filters: {
                areas: { eq: 38 },
                listingDate: { gte: "2026-10-31T00:00:00.000Z", lte: "2026-11-13T23:59:59.999Z" },
              },
              pageSize: RA_PAGE_SIZE,
              page: 1,
            },
          }),
        },
        response: {
          url: RA_ENDPOINT,
          status: 200,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            errors: [{ message: 'Cannot query field "event"' }],
          }),
        },
      },
    ]);
    await expect(raAdapter.harvest!(source, run)).rejects.toThrow(
      'RA query rejected: Cannot query field "event"',
    );
  });
});

describe("RA venue points (D-508)", () => {
  it("drops placeholder 26/-80 point, keeps venue name/address, one note", () => {
    const rows = [
      {
        id: "listing1",
        listingDate: "2026-10-31",
        event: {
          id: "2201004",
          title: "Event at ZeyZey",
          date: "2026-10-31T00:00:00.000",
          startTime: "2026-10-31T22:00:00.000",
          endTime: "2026-10-31T05:00:00.000",
          contentUrl: "https://ra.co/events/2201004",
          venue: {
            id: "venue1",
            name: "ZeyZey",
            address: "353 NE 61st St, Miami, FL 33137, USA",
            contentUrl: "https://ra.co/club/123",
            area: { name: "Miami" },
            location: { latitude: 26, longitude: -80 },
          },
          artists: [],
        },
      },
      {
        id: "listing2",
        listingDate: "2026-10-31",
        event: {
          id: "2201005",
          title: "Another at ZeyZey",
          date: "2026-10-31T00:00:00.000",
          startTime: "2026-10-31T23:00:00.000",
          endTime: "2026-10-31T06:00:00.000",
          contentUrl: "https://ra.co/events/2201005",
          venue: {
            id: "venue1",
            name: "ZeyZey",
            address: "353 NE 61st St, Miami, FL 33137, USA",
            contentUrl: "https://ra.co/club/123",
            area: { name: "Miami" },
            location: { latitude: 26, longitude: -80 },
          },
          artists: [],
        },
      },
    ];

    const { listings, notes } = raToListings(rows, {
      fetchedAt: NOW,
      metroTz: "America/New_York",
      fromNight: "2026-10-31",
    });

    expect(listings).toHaveLength(2);
    expect(listings[0]?.venueLocation).toBeNull();
    expect(listings[1]?.venueLocation).toBeNull();
    expect(listings[0]?.listing.venue?.name).toBe("ZeyZey");
    expect(listings[0]?.listing.venue?.address).toBe("353 NE 61st St, Miami, FL 33137, USA");
    // Only one note about the dropped point
    const dropNotes = notes.filter((n) => n.startsWith("RA point dropped"));
    expect(dropNotes).toHaveLength(1);
    expect(dropNotes[0]).toBe("RA point dropped (placeholder 26, -80): ZeyZey");
  });

  it("keeps good point inside the metro", () => {
    const rows = [
      {
        id: "listing4",
        listingDate: "2026-10-31",
        event: {
          id: "2201007",
          title: "Club Space Event",
          date: "2026-10-31T00:00:00.000",
          startTime: "2026-10-31T22:00:00.000",
          endTime: "2026-10-31T05:00:00.000",
          contentUrl: "https://ra.co/events/2201007",
          venue: {
            id: "venue3",
            name: "Club Space Miami",
            address: "34 NE 11th St, Miami, FL",
            contentUrl: "https://ra.co/club/789",
            area: { name: "Miami" },
            location: { latitude: 25.784476, longitude: -80.193136 },
          },
          artists: [],
        },
      },
    ];

    const { listings, notes } = raToListings(rows, {
      fetchedAt: NOW,
      metroTz: "America/New_York",
      fromNight: "2026-10-31",
    });

    expect(listings).toHaveLength(1);
    expect(listings[0]?.venueLocation).toEqual({ lat: 25.784476, lng: -80.193136 });
    const dropNotes = notes.filter((n) => n.startsWith("RA point dropped"));
    expect(dropNotes).toHaveLength(0);
  });

  it("drops two-decimal inside point (D-377 extends D-508)", () => {
    const rows = [
      {
        id: "listing5",
        listingDate: "2026-10-31",
        event: {
          id: "2201008",
          title: "Two Decimal Event",
          date: "2026-10-31T00:00:00.000",
          startTime: "2026-10-31T21:00:00.000",
          endTime: "2026-10-31T03:00:00.000",
          contentUrl: "https://ra.co/events/2201008",
          venue: {
            id: "venue4",
            name: "Two Decimal Club",
            address: "456 Some Ave, Miami, FL",
            contentUrl: "https://ra.co/club/999",
            area: { name: "Miami" },
            location: { latitude: 25.8, longitude: -80.19 },
          },
          artists: [],
        },
      },
    ];

    const { listings, notes } = raToListings(rows, {
      fetchedAt: NOW,
      metroTz: "America/New_York",
      fromNight: "2026-10-31",
    });

    expect(listings).toHaveLength(1);
    // With D-377, points where both lat and lng have at most two decimals are dropped
    expect(listings[0]?.venueLocation).toBeNull();
    const dropNotes = notes.filter((n) => n.startsWith("RA point dropped"));
    expect(dropNotes).toHaveLength(1);
    expect(dropNotes[0]).toBe("RA point dropped (rounded 25.8, -80.19): Two Decimal Club");
  });

  it("placeholder dropped, real outside point kept for the ingest screen", () => {
    const rows = [
      {
        id: "listing6",
        listingDate: "2026-10-31",
        event: {
          id: "2201009",
          title: "Placeholder Event",
          date: "2026-10-31T00:00:00.000",
          startTime: "2026-10-31T20:00:00.000",
          endTime: "2026-10-31T02:00:00.000",
          contentUrl: "https://ra.co/events/2201009",
          venue: {
            id: "venue5",
            name: "Placeholder Venue",
            address: "789 Place St, Miami, FL",
            contentUrl: "https://ra.co/club/111",
            area: { name: "Miami" },
            location: { latitude: 26, longitude: -80 },
          },
          artists: [],
        },
      },
      {
        id: "listing7",
        listingDate: "2026-10-31",
        event: {
          id: "2201010",
          title: "Outside Event",
          date: "2026-10-31T00:00:00.000",
          startTime: "2026-10-31T21:00:00.000",
          endTime: "2026-10-31T03:00:00.000",
          contentUrl: "https://ra.co/events/2201010",
          venue: {
            id: "venue6",
            name: "Far Club",
            address: "123 Far St, New York, NY",
            contentUrl: "https://ra.co/club/222",
            area: { name: "New York" },
            location: { latitude: 40.7128, longitude: -74.006 },
          },
          artists: [],
        },
      },
    ];

    const { listings, notes } = raToListings(rows, {
      fetchedAt: NOW,
      metroTz: "America/New_York",
      fromNight: "2026-10-31",
    });

    expect(listings).toHaveLength(2);
    // Placeholder should be dropped
    expect(listings[0]?.venueLocation).toBeNull();
    // A real outside point stays so ingest screens the row out
    expect(listings[1]?.venueLocation).toEqual({ lat: 40.7128, lng: -74.006 });
    const dropNotes = notes.filter((n) => n.startsWith("RA point dropped"));
    expect(dropNotes).toHaveLength(1);
    expect(dropNotes[0]).toBe("RA point dropped (placeholder 26, -80): Placeholder Venue");
  });

  it("drops points rounded to two decimals (D-377)", () => {
    const rows = [
      {
        id: "listing8",
        listingDate: "2026-10-31",
        event: {
          id: "2201011",
          title: "Azul Rooftop Event",
          date: "2026-10-31T00:00:00.000",
          startTime: "2026-10-31T22:00:00.000",
          endTime: "2026-10-31T05:00:00.000",
          contentUrl: "https://ra.co/events/2201011",
          venue: {
            id: "venue7",
            name: "Azul Rooftop Barceloneta",
            address: "Pg. de Joan de Borbó, 101, planta 8, Ciutat Vella, 08038 Barcelona",
            contentUrl: "https://ra.co/club/333",
            area: { name: "Barcelona" },
            location: { latitude: 41.37, longitude: 2.19 },
          },
          artists: [],
        },
      },
      {
        id: "listing9",
        listingDate: "2026-10-31",
        event: {
          id: "2201012",
          title: "Las Tres Chimeneas Event",
          date: "2026-10-31T00:00:00.000",
          startTime: "2026-10-31T23:00:00.000",
          endTime: "2026-10-31T06:00:00.000",
          contentUrl: "https://ra.co/events/2201012",
          venue: {
            id: "venue8",
            name: "Las Tres Chimeneas",
            address: "Las Tres Chimeneas, 08930 Sant Adrià de Besòs, Barcelona",
            contentUrl: "https://ra.co/club/444",
            area: { name: "Barcelona" },
            location: { latitude: 41.43, longitude: 2.24 },
          },
          artists: [],
        },
      },
      {
        id: "listing10",
        listingDate: "2026-10-31",
        event: {
          id: "2201013",
          title: "Sala Apolo Event",
          date: "2026-10-31T00:00:00.000",
          startTime: "2026-10-31T21:00:00.000",
          endTime: "2026-10-31T04:00:00.000",
          contentUrl: "https://ra.co/events/2201013",
          venue: {
            id: "venue9",
            name: "Sala Apolo",
            address: "Carrer Nou de la Rambla, 111; 08004 Barcelona; Spain",
            contentUrl: "https://ra.co/club/555",
            area: { name: "Barcelona" },
            location: { latitude: 41.374345, longitude: 2.169494 },
          },
          artists: [],
        },
      },
    ];

    const { listings, notes } = raToListings(rows, {
      fetchedAt: NOW,
      metroTz: "Europe/Madrid",
      fromNight: "2026-10-31",
    });

    expect(listings).toHaveLength(3);
    // First two should have venueLocation null
    expect(listings[0]?.venueLocation).toBeNull();
    expect(listings[1]?.venueLocation).toBeNull();
    // Third should keep its precise location
    expect(listings[2]?.venueLocation).toEqual({ lat: 41.374345, lng: 2.169494 });

    const dropNotes = notes.filter((n) => n.startsWith("RA point dropped"));
    expect(dropNotes).toHaveLength(2);
    expect(dropNotes).toContain("RA point dropped (rounded 41.37, 2.19): Azul Rooftop Barceloneta");
    expect(dropNotes).toContain("RA point dropped (rounded 41.43, 2.24): Las Tres Chimeneas");
  });
});

describe("RA 23:59 placeholder (D-521)", () => {
  it("23:59 start time becomes null, note added", () => {
    const rows = [
      {
        id: "listing1",
        listingDate: "2026-11-01",
        event: {
          id: "2202001",
          title: "Be Techno KAS:ST",
          date: "2026-11-01T00:00:00.000",
          startTime: "2026-11-01T23:59:00.000",
          endTime: "2026-11-02T05:00:00.000",
          contentUrl: "https://ra.co/events/2202001",
          venue: {
            id: "venue1",
            name: "Crobar",
            address: "Av. del Libertador 388, Buenos Aires",
            location: { latitude: -34.58, longitude: -58.37 },
          },
          artists: [],
        },
      },
    ];

    const { listings, notes } = raToListings(rows, {
      fetchedAt: NOW,
      metroTz: "America/Argentina/Buenos_Aires",
      fromNight: "2026-11-01",
    });

    expect(listings).toHaveLength(1);
    const listing = listings[0];
    expect(listing?.listing.doors_time).toBeNull();
    expect(listing?.listing.end_time).toBeNull(); // end should be dropped
    expect(listing?.listing.local_date).toBe("2026-11-01");
    // note about 23:59
    const placeholderNote = notes.find((n) => n.includes("RA start time(s) of 23:59"));
    expect(placeholderNote).toBe("1 RA start time(s) of 23:59 read as no time");
  });

  it("23:00 start time unchanged, no note", () => {
    const rows = [
      {
        id: "listing2",
        listingDate: "2026-11-01",
        event: {
          id: "2202002",
          title: "Normal Event",
          date: "2026-11-01T00:00:00.000",
          startTime: "2026-11-01T23:00:00.000",
          endTime: "2026-11-02T03:00:00.000",
          contentUrl: "https://ra.co/events/2202002",
          venue: {
            id: "venue2",
            name: "Normal Club",
            location: { latitude: -34.6, longitude: -58.4 },
          },
          artists: [],
        },
      },
    ];

    const { listings, notes } = raToListings(rows, {
      fetchedAt: NOW,
      metroTz: "America/Argentina/Buenos_Aires",
      fromNight: "2026-11-01",
    });

    expect(listings).toHaveLength(1);
    expect(listings[0]?.listing.doors_time).toBe("23:00");
    const placeholderNote = notes.find((n) => n.includes("RA start time(s) of 23:59"));
    expect(placeholderNote).toBeUndefined();
  });

  it("two 23:59 events produce one note with count 2", () => {
    const rows = [
      {
        id: "listing3",
        listingDate: "2026-11-01",
        event: {
          id: "2202003",
          title: "First 23:59",
          date: "2026-11-01T00:00:00.000",
          startTime: "2026-11-01T23:59:00.000",
          endTime: "2026-11-02T06:00:00.000",
          contentUrl: "https://ra.co/events/2202003",
          venue: {
            id: "venue3",
            name: "Club A",
            location: { latitude: -34.55, longitude: -58.45 },
          },
          artists: [],
        },
      },
      {
        id: "listing4",
        listingDate: "2026-11-01",
        event: {
          id: "2202004",
          title: "Second 23:59",
          date: "2026-11-01T00:00:00.000",
          startTime: "2026-11-01T23:59:00.000",
          endTime: "2026-11-02T07:00:00.000",
          contentUrl: "https://ra.co/events/2202004",
          venue: {
            id: "venue4",
            name: "Club B",
            location: { latitude: -34.56, longitude: -58.46 },
          },
          artists: [],
        },
      },
    ];

    const { listings, notes } = raToListings(rows, {
      fetchedAt: NOW,
      metroTz: "America/Argentina/Buenos_Aires",
      fromNight: "2026-11-01",
    });

    expect(listings).toHaveLength(2);
    expect(listings[0]?.listing.doors_time).toBeNull();
    expect(listings[1]?.listing.doors_time).toBeNull();
    const placeholderNote = notes.find((n) => n.includes("RA start time(s) of 23:59"));
    expect(placeholderNote).toBe("2 RA start time(s) of 23:59 read as no time");
  });
});
