import { describe, expect, it } from "vitest";

import { jsonLdAdapter } from "@/src/adapters/feeds/jsonld";
import type { Metro, RunCtx, Source } from "@/src/adapters/types";
import { createPoliteHttp, fixtureTransport, type Fixture } from "@/src/pipeline/http";

// D-880: a schema.org events page read whole is the source's word up to its last dated night.
// On trial: the adapter gives wholeThroughLogOnly, and the ingest only notes what it would retire.

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

function sourceAt(url: string): Source {
  return {
    id: "s",
    url,
    kind: "jsonld",
    trustTier: "first_party",
    platform: null,
    feedUrl: null,
    metroId: "m",
    styles: [],
    etag: null,
    lastModified: null,
    contentHash: null,
  } as Source;
}

const ROBOTS: Fixture = {
  request: { method: "GET", url: "https://club.example/robots.txt" },
  response: {
    url: "https://club.example/robots.txt",
    status: 200,
    headers: {},
    body: "User-agent: *\nDisallow:\n",
  },
};

function event(name: string, startDate: string): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "Event",
    name,
    startDate,
    location: { "@type": "Place", name: "Club", address: "1 Main St, New York, NY" },
  };
}

function page(blocks: string[]): string {
  const scripts = blocks.map((b) => `<script type="application/ld+json">${b}</script>`).join("\n");
  return `<html><head>${scripts}</head><body><h1>Events</h1></body></html>`;
}

function ctxWith(url: string, body: string): RunCtx {
  const transport = fixtureTransport([
    ROBOTS,
    {
      request: { method: "GET", url },
      response: { url, status: 200, headers: { "content-type": "text/html" }, body },
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

const URL = "https://club.example/events";

describe("a schema.org events page is whole through its last night, log only (D-880)", () => {
  it("gives the latest listed night and never sets whole or wholeThrough", async () => {
    // An event past the read's window is not listed, so it sets no later night.
    const body = page([
      JSON.stringify(event("Salsa Social", "2026-09-25T20:00:00-04:00")),
      JSON.stringify(event("Bachata Night", "2027-03-20T21:00:00-04:00")),
      JSON.stringify(event("Swing Jam", "2026-09-30T19:30:00-04:00")),
    ]);
    const result = await jsonLdAdapter.harvest!(sourceAt(URL), ctxWith(URL, body));
    expect(result.listings.length).toBe(2);
    expect(result.wholeThroughLogOnly).toBe("2026-09-30");
    expect(result.wholeThrough).toBeUndefined();
    expect(result.whole).toBeUndefined();
  });

  it("sets nothing when a JSON-LD block is not valid JSON", async () => {
    const body = page([
      JSON.stringify(event("Salsa Social", "2026-09-25T20:00:00-04:00")),
      '{"@type": "Event", "name": "Broken",',
    ]);
    const result = await jsonLdAdapter.harvest!(sourceAt(URL), ctxWith(URL, body));
    expect(result.wholeThroughLogOnly).toBeUndefined();
  });

  it.each([
    "https://club.example/events?page=2",
    "https://club.example/events?city=nyc&p=3",
    "https://club.example/events/page/2/",
  ])("sets nothing on one page of several: %s", async (url) => {
    const body = page([JSON.stringify(event("Salsa Social", "2026-09-25T20:00:00-04:00"))]);
    const result = await jsonLdAdapter.harvest!(sourceAt(url), ctxWith(url, body));
    expect(result.listings.length).toBe(1);
    expect(result.wholeThroughLogOnly).toBeUndefined();
  });

  it("sets nothing when every dated event is already past", async () => {
    const body = page([JSON.stringify(event("Salsa Social", "2026-09-10T20:00:00-04:00"))]);
    const result = await jsonLdAdapter.harvest!(sourceAt(URL), ctxWith(URL, body));
    expect(result.wholeThroughLogOnly).toBeUndefined();
  });

  it("sets nothing when the page has no events", async () => {
    const result = await jsonLdAdapter.harvest!(sourceAt(URL), ctxWith(URL, page([])));
    expect(result.wholeThroughLogOnly).toBeUndefined();
  });
});
