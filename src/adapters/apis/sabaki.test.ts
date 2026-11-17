import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  SABAKI_BASE,
  SABAKI_METROS,
  SABAKI_PAGE_SIZE,
  sabakiAdapter,
  sabakiToListings,
  sabakiUrl,
} from "@/src/adapters/apis/sabaki";
import type { Metro, RunCtx } from "@/src/adapters/types";
import { createPoliteHttp, fixtureTransport, type Fixture } from "@/src/pipeline/http";
import { mayRun } from "@/src/pipeline/runner";
import { flagKey } from "@/src/adapters/types";

const FIXTURE_PATH = new URL("./__fixtures__/sabaki-events.json", import.meta.url).pathname;

const MIAMI: Metro = {
  id: "m1",
  slug: "miami",
  name: "Miami",
  countryCode: "US",
  center: { lat: 25.7617, lng: -80.1918 },
  radiusKm: 45,
  tz: "America/New_York",
  languages: ["en"],
};

const NYC: Metro = {
  id: "m2",
  slug: "nyc",
  name: "New York",
  countryCode: "US",
  center: { lat: 40.7128, lng: -74.006 },
  radiusKm: 40,
  tz: "America/New_York",
  languages: ["en"],
};

const NIGHTS = ["2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01"];

function ctx(metro: Metro = MIAMI): RunCtx & { requests: string[] } {
  const fixtures: Fixture[] = [
    {
      request: {
        method: "GET",
        url: sabakiUrl(metro, null),
      },
      response: {
        url: sabakiUrl(metro, null),
        status: 200,
        headers: {},
        body: readFileSync(FIXTURE_PATH, "utf8"),
      },
    },
  ];
  const transport = fixtureTransport(fixtures);
  const now = new Date("2026-10-27T12:00:00Z");
  let t = now.getTime();
  return {
    metro,
    now: () => new Date(t),
    http: createPoliteHttp({
      transport,
      userAgent: "test",
      now: () => t,
      sleep: async (ms) => void (t += ms),
    }),
    env: { SABAKI_API_KEY: "REDACTED-KEY-123" },
    log: () => {},
    requests: transport.requests,
  };
}

describe("Sabaki", () => {
  it("sabakiUrl carries correct parameters", () => {
    const url = new URL(sabakiUrl(MIAMI, null));
    expect(url.searchParams.get("limit")).toBe("500");
    expect(url.searchParams.get("countryCodes")).toBe("US");
    expect(url.searchParams.get("lat")).toBe("25.761700");
    expect(url.searchParams.get("lng")).toBe("-80.191800");
    expect(url.searchParams.get("radiusKm")).toBe("45");
    expect(url.searchParams.has("cursor")).toBe(false);

    const urlWithCursor = new URL(sabakiUrl(MIAMI, "abc123"));
    expect(urlWithCursor.searchParams.get("cursor")).toBe("abc123");

    const largeRadius: Metro = { ...MIAMI, radiusKm: 300 };
    const largeUrl = new URL(sabakiUrl(largeRadius, null));
    expect(largeUrl.searchParams.get("radiusKm")).toBe("200");
  });

  it("sabakiToListings keeps dance events and screens others", () => {
    const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8"));
    const { listings, screened, notes } = sabakiToListings(fixture.items, {
      metro: MIAMI,
      nights: NIGHTS,
      fetchedAt: new Date(),
    });

    expect(listings).toHaveLength(2);
    expect(screened).toHaveLength(2);
    expect(notes).toContain("sabaki:ev6 has no eventUrl, skipped");

    const keptIds = listings.map((l) => l.externalId);
    expect(keptIds).toContain("sabaki:ev1");
    expect(keptIds).toContain("sabaki:ev2");

    const ev1 = listings.find((l) => l.externalId === "sabaki:ev1");
    expect(ev1?.eventUrl).toBe(
      "https://sabaki.dance/event/ev1?utm_source=partner&utm_medium=api&utm_campaign=dancetonight",
    );
    expect(ev1?.provenance.sourceUrl).toBe(ev1?.eventUrl);
    expect(ev1?.listing.local_date).toBe("2026-10-30");
    expect(ev1?.listing.doors_time ?? ev1?.listing.dancing_time).toBe("21:00");
    expect(ev1?.listing.end_time).toBe("01:00");
    expect(ev1?.listing.styles).toContain("salsa");

    const ev2 = listings.find((l) => l.externalId === "sabaki:ev2");
    expect(ev2?.venueLocation).toBeNull();
    expect(ev2?.listing.end_time).toBeNull();
    expect(ev2?.listing.styles).toContain("bachata");

    const screenedReasons = screened.map((s) => s.reason);
    expect(screenedReasons).toContain("a class, not a social (Sabaki eventType course)");
    expect(screenedReasons).toContain("names no dance");
  });

  it("gives no venue location when latitude is not a number", () => {
    const { listings } = sabakiToListings(
      [
        {
          eventId: "blank",
          title: "Salsa Social",
          eventUrl: "https://sabaki.dance/event/blank?utm_source=partner",
          startDateTime: "2026-10-30T21:00:00-04:00",
          danceStyles: ["Salsa"],
          latitude: "",
          longitude: "-80.19",
        },
      ],
      { metro: MIAMI, nights: NIGHTS, fetchedAt: new Date("2026-10-27T12:00:00Z") },
    );
    expect(listings).toHaveLength(1);
    expect(listings[0]?.venueLocation).toBeNull();
  });

  it("puts a 1:30am start on the previous night in the metro's zone", () => {
    const { listings } = sabakiToListings(
      [
        {
          eventId: "late",
          title: "Late Salsa Social",
          eventUrl: "https://sabaki.dance/event/late?utm_source=partner",
          startDateTime: "2026-11-01T01:30:00-04:00",
          danceStyles: ["Salsa"],
        },
      ],
      { metro: MIAMI, nights: NIGHTS, fetchedAt: new Date("2026-10-27T12:00:00Z") },
    );
    expect(listings).toHaveLength(1);
    expect(listings[0]?.listing.local_date).toBe("2026-10-31");
  });

  it("harvestMetro returns listings for enabled metro", async () => {
    const run = ctx();
    const result = await sabakiAdapter.harvestMetro!(MIAMI, NIGHTS, run);

    expect(run.requests).toHaveLength(1);
    expect(result.listings).toHaveLength(2);
    expect(result.notes).toContain("page 1: 7 events");
  });

  it("harvestMetro returns empty result for non-enabled metro", async () => {
    const run = ctx(NYC);
    const result = await sabakiAdapter.harvestMetro!(NYC, NIGHTS, run);

    expect(run.requests).toHaveLength(0);
    expect(result.listings).toHaveLength(0);
    expect(result.notes).toContain("sabaki: not enabled for nyc");
  });

  it("paging works", async () => {
    const page1 = {
      items: [
        {
          eventId: "p1",
          eventUrl: "https://example.com/p1",
          title: "Page1",
          startDateTime: "2026-10-30T20:00:00-04:00",
          danceStyles: ["Salsa"],
        },
      ],
      nextCursor: "cursor123",
    };
    const page2 = {
      items: [
        {
          eventId: "p2",
          eventUrl: "https://example.com/p2",
          title: "Page2",
          startDateTime: "2026-10-30T21:00:00-04:00",
          danceStyles: ["Bachata"],
        },
      ],
      nextCursor: null,
    };
    const fixtures: Fixture[] = [
      {
        request: { method: "GET", url: sabakiUrl(MIAMI, null) },
        response: {
          url: sabakiUrl(MIAMI, null),
          status: 200,
          headers: {},
          body: JSON.stringify(page1),
        },
      },
      {
        request: { method: "GET", url: sabakiUrl(MIAMI, "cursor123") },
        response: {
          url: sabakiUrl(MIAMI, "cursor123"),
          status: 200,
          headers: {},
          body: JSON.stringify(page2),
        },
      },
    ];
    const transport = fixtureTransport(fixtures);
    const now = new Date();
    let t = now.getTime();
    const runCtx: RunCtx = {
      metro: MIAMI,
      now: () => new Date(t),
      http: createPoliteHttp({
        transport,
        userAgent: "test",
        now: () => t,
        sleep: async (ms) => void (t += ms),
      }),
      env: { SABAKI_API_KEY: "key" },
      log: () => {},
    };

    const result = await sabakiAdapter.harvestMetro!(MIAMI, NIGHTS, runCtx);
    expect(result.listings).toHaveLength(2);
    expect(result.notes).toContain("page 1: 1 events");
    expect(result.notes).toContain("page 2: 1 events");
  });

  it("rejects on API error", async () => {
    const fixtures: Fixture[] = [
      {
        request: { method: "GET", url: sabakiUrl(MIAMI, null) },
        response: {
          url: sabakiUrl(MIAMI, null),
          status: 200,
          headers: {},
          body: JSON.stringify({ notItems: true }),
        },
      },
    ];
    const transport = fixtureTransport(fixtures);
    const now = new Date();
    let t = now.getTime();
    const runCtx: RunCtx = {
      metro: MIAMI,
      now: () => new Date(t),
      http: createPoliteHttp({
        transport,
        userAgent: "test",
        now: () => t,
        sleep: async (ms) => void (t += ms),
      }),
      env: { SABAKI_API_KEY: "key" },
      log: () => {},
    };

    await expect(sabakiAdapter.harvestMetro!(MIAMI, NIGHTS, runCtx)).rejects.toThrow(
      "Sabaki API: unexpected response (status 200)",
    );
  });

  it("mayRun respects country restriction", () => {
    const flagKeyForSabaki = flagKey("sabaki");
    const flags = new Map([[flagKeyForSabaki, true]]);
    const env = { SABAKI_API_KEY: "x" };

    // ES metro (Barcelona) should run
    const barcelona: Metro = {
      id: "m3",
      slug: "barcelona",
      name: "Barcelona",
      countryCode: "ES",
      center: { lat: 41.3851, lng: 2.1734 },
      radiusKm: 30,
      tz: "Europe/Madrid",
      languages: ["ca", "es"],
    };
    const esResult = mayRun(sabakiAdapter, barcelona, env, flags);
    expect(esResult).toEqual({ run: true });

    // US metro (NYC) also passes country check (US is allowed)
    const usResult = mayRun(sabakiAdapter, NYC, env, flags);
    expect(usResult).toEqual({ run: true });
  });
});
