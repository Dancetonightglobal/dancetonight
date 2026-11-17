import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  SKIDDLE_QUERIES,
  skiddleAdapter,
  skiddleToListings,
  skiddleUrl,
} from "@/src/adapters/apis/skiddle";
import type { Metro, RunCtx } from "@/src/adapters/types";
import { createPoliteHttp, fixtureTransport, type Fixture } from "@/src/pipeline/http";
import { mayRun } from "@/src/pipeline/runner";
import { flagKey } from "@/src/adapters/types";

const FIXTURE_PATH = new URL("./__fixtures__/skiddle-search.json", import.meta.url).pathname;

const LONDON: Metro = {
  id: "m1",
  slug: "london",
  name: "London",
  countryCode: "GB",
  center: { lat: 51.5074, lng: -0.1278 },
  radiusKm: 30,
  tz: "Europe/London",
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

function ctx(metro: Metro = LONDON): RunCtx & { requests: string[] } {
  const fixtures: Fixture[] = SKIDDLE_QUERIES.map((query) => {
    const url = skiddleUrl(metro, NIGHTS, query, "REDACTED-KEY-123", 0);
    const body = readFileSync(FIXTURE_PATH, "utf8");
    return {
      request: { method: "GET", url },
      response: { url, status: 200, headers: {}, body },
    };
  });
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
    env: { SKIDDLE_API_KEY: "REDACTED-KEY-123" },
    log: () => {},
    requests: transport.requests,
  };
}

describe("Skiddle", () => {
  it("skiddleUrl carries correct parameters", () => {
    const url = new URL(skiddleUrl(LONDON, NIGHTS, { eventcode: "CLUB" }, "test-key"));
    expect(url.searchParams.get("api_key")).toBe("test-key");
    expect(url.searchParams.get("latitude")).toBe("51.507400");
    expect(url.searchParams.get("longitude")).toBe("-0.127800");
    expect(url.searchParams.get("radius")).toBe("19"); // 30 km / 1.609 = 18.64 -> ceil 19
    expect(url.searchParams.get("minDate")).toBe("2026-10-29");
    expect(url.searchParams.get("maxDate")).toBe("2026-11-01");
    expect(url.searchParams.get("limit")).toBe("100");
    expect(url.searchParams.get("offset")).toBe("0");
    expect(url.searchParams.get("order")).toBe("date");
    expect(url.searchParams.get("description")).toBe("1");
    expect(url.searchParams.get("eventcode")).toBe("CLUB");
  });

  it("skiddleToListings keeps dance events and screens others", () => {
    const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8"));
    const { listings, screened } = skiddleToListings(fixture.results, {
      metro: LONDON,
      fetchedAt: new Date(),
    });

    expect(listings).toHaveLength(4);
    expect(screened).toHaveLength(2);

    const keptIds = listings.map((l) => l.externalId);
    expect(keptIds).toContain("skiddle:40001");
    expect(keptIds).toContain("skiddle:40002");
    expect(keptIds).toContain("skiddle:40004");
    expect(keptIds).toContain("skiddle:40006");

    const screenedReasons = screened.map((s) => s.reason);
    expect(screenedReasons).toContain("names no dance");
    expect(screenedReasons).toContain("not a dance night (Skiddle category KIDS)");
  });

  it("parses event 40001 correctly", () => {
    const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8"));
    const { listings } = skiddleToListings([fixture.results[0]], {
      metro: LONDON,
      fetchedAt: new Date(),
    });

    expect(listings).toHaveLength(1);
    const listing = listings[0]!;
    expect(listing.externalId).toBe("skiddle:40001");
    expect(listing.listing.title).toBe("Bottom Heavy: Jungle All Night");
    expect(listing.listing.local_date).toBe("2026-10-31");
    expect(listing.listing.doors_time).toBe("22:00");
    expect(listing.listing.end_time).toBe("04:00");
    expect(listing.listing.prices).toEqual([
      { label: "Entry", amount: 12.5, currency: "GBP", includes: null },
    ]);
    expect(listing.listing.venue?.address).toContain("SE14 5RR");
    expect(listing.eventUrl).toBe(
      "https://www.skiddle.com/whats-on/London/Venue-MOT/Bottom-Heavy/40001/",
    );
    expect(listing.listing.styles).toContain("dj_night");
  });

  it("handles cancelled and free events", () => {
    const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8"));
    const { listings } = skiddleToListings(fixture.results, {
      metro: LONDON,
      fetchedAt: new Date(),
    });

    const cancelled = listings.find((l) => l.externalId === "skiddle:40004");
    expect(cancelled?.listing.cancelled).toBe(true);

    const free = listings.find((l) => l.externalId === "skiddle:40006");
    expect(free?.listing.prices).toEqual([
      { label: "Free", amount: 0, currency: "GBP", includes: null },
    ]);
    expect(free?.listing.doors_time).toBeNull();
  });

  it("harvestMetro returns deduped listings", async () => {
    const run = ctx();
    const result = await skiddleAdapter.harvestMetro!(LONDON, NIGHTS, run);

    expect(run.requests).toHaveLength(SKIDDLE_QUERIES.length);
    expect(result.listings).toHaveLength(4);
    expect(result.notes).toHaveLength(SKIDDLE_QUERIES.length + 0); // listingNotes empty in fixture
    expect(result.notes![0]).toBe("CLUB: 6 events");
    // Ensure no note contains the API key
    for (const note of result.notes!) {
      expect(note).not.toContain("REDACTED-KEY-123");
    }
  });

  it("rejects on API error", async () => {
    const metro = LONDON;
    const fixtures: Fixture[] = [
      {
        request: {
          method: "GET",
          url: skiddleUrl(metro, NIGHTS, { eventcode: "CLUB" }, "bad-key", 0),
        },
        response: {
          url: skiddleUrl(metro, NIGHTS, { eventcode: "CLUB" }, "bad-key", 0),
          status: 200,
          headers: {},
          body: JSON.stringify({ error: 1, errormessage: "Invalid API key" }),
        },
      },
    ];
    const transport = fixtureTransport(fixtures);
    const now = new Date();
    let t = now.getTime();
    const runCtx: RunCtx = {
      metro,
      now: () => new Date(t),
      http: createPoliteHttp({
        transport,
        userAgent: "test",
        now: () => t,
        sleep: async (ms) => void (t += ms),
      }),
      env: { SKIDDLE_API_KEY: "bad-key" },
      log: () => {},
    };

    await expect(skiddleAdapter.harvestMetro!(metro, NIGHTS, runCtx)).rejects.toThrow(
      "Skiddle API error: Invalid API key",
    );
  });

  it("mayRun respects country restriction", () => {
    const flagKeyForSkiddle = flagKey("skiddle");
    const flags = new Map([[flagKeyForSkiddle, true]]);
    const env = { SKIDDLE_API_KEY: "x" };

    // US metro should not run
    const usResult = mayRun(skiddleAdapter, NYC, env, flags);
    expect(usResult).toEqual({
      run: false,
      reason: "wrong_country",
      detail: "serves GB only",
    });

    // GB metro should run
    const gbResult = mayRun(skiddleAdapter, LONDON, env, flags);
    expect(gbResult).toEqual({ run: true });
  });
});
