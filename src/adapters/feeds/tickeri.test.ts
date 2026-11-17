import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { tickeriAdapter } from "@/src/adapters/feeds/tickeri";
import type { Metro, RunCtx, Source } from "@/src/adapters/types";
import { createPoliteHttp, fixtureTransport, type Fixture } from "@/src/pipeline/http";

// Two pages of https://www.tickeri.com/local/tristate (2026-10-25), cut to their events and
// venues. Page 2's last event was moved to 2026-11-20, past the window, so the read stops there.
const DIR = path.join(__dirname, "__fixtures__");
const page = (n: number) => readFileSync(path.join(DIR, `tickeri-page-${n}.html`), "utf8");

const LIST = "https://www.tickeri.com/local/tristate";

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

const source = (): Source => ({
  id: "s",
  url: LIST,
  kind: "jsonld",
  trustTier: "first_party",
  platform: "tickeri",
  feedUrl: null,
  metroId: "m",
  styles: [],
  etag: null,
  lastModified: null,
  contentHash: null,
});

const html = (url: string, body: string): Fixture => ({
  request: { method: "GET", url },
  response: { url, status: 200, headers: { "content-type": "text/html" }, body },
});

function ctx(fixtures: Fixture[], now: Date): RunCtx & { requests: string[] } {
  const transport = fixtureTransport([
    {
      request: { method: "GET", url: "https://www.tickeri.com/robots.txt" },
      response: {
        url: "https://www.tickeri.com/robots.txt",
        status: 200,
        headers: { "content-type": "text/plain" },
        body: "User-agent: *\nDisallow: /search\nDisallow: /api/\n",
      },
    },
    ...fixtures,
  ]);
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

const NOW = new Date("2026-10-25T16:00:00Z"); // noon in New York; window 10-25..11-07

describe("tickeri reader", () => {
  it("reads every page up to the first event past the window, whole", async () => {
    const run = ctx([html(`${LIST}?page=1`, page(1)), html(`${LIST}?page=2`, page(2))], NOW);
    const result = await tickeriAdapter.harvest!(source(), run);

    expect(run.requests).toEqual([
      "GET https://www.tickeri.com/robots.txt",
      `GET ${LIST}?page=1`,
      `GET ${LIST}?page=2`,
    ]);
    expect(result.whole).toBe(true);
    // 16 on page 1, 15 on page 2; the 11-20 event is past the window. Places outside the metro
    // (Paterson, Norwalk, Philadelphia) are kept here: the ingest leaves them out by their point.
    expect(result.listings).toHaveLength(31);
    expect(result.listings.every((l) => l.listing.local_date! <= "2026-11-07")).toBe(true);
    expect(result.listings.some((l) => l.listing.title.startsWith("NYC Halloween Bar Crawl"))).toBe(
      false,
    );
  });

  it("gives each event its own page, venue, address, point and start", async () => {
    const run = ctx([html(`${LIST}?page=1`, page(1)), html(`${LIST}?page=2`, page(2))], NOW);
    const result = await tickeriAdapter.harvest!(source(), run);

    const bacano = result.listings.find((l) => l.listing.title.startsWith("Ritmos Bacano"));
    expect(bacano).toBeDefined();
    const url =
      "https://www.tickeri.com/events/key8uqsw5sq4/ritmos-bacano-colombian-salsa-vallenato-reggaeton-party-nyc";
    expect(bacano!.eventUrl).toBe(url);
    expect(bacano!.externalId).toBe(url);
    expect(bacano!.listing.local_date).toBe("2026-10-28");
    expect(bacano!.listing.doors_time).toBe("17:00");
    expect(bacano!.listing.end_time).toBeNull();
    expect(bacano!.listing.venue.name).toBe("Ritmos 60");
    expect(bacano!.listing.venue.address).toBe("32-23 Steinway Street, Queens, NY 11103");
    expect(bacano!.venueLocation).toEqual({ lat: 40.7584175, lng: -73.9192693 });
    // Prices are not read: the list's minimum may be a free RSVP tier.
    expect(bacano!.listing.prices).toEqual([]);
  });

  it("takes an end that falls within a day of the start", async () => {
    const run = ctx([html(`${LIST}?page=1`, page(1)), html(`${LIST}?page=2`, page(2))], NOW);
    const result = await tickeriAdapter.harvest!(source(), run);

    const tulum = result.listings.find((l) => l.listing.venue.name === "Tulum Night Club");
    expect(tulum).toBeDefined();
    expect(tulum!.listing.local_date).toBe("2026-10-25");
    expect(tulum!.listing.doors_time).toBe("22:00");
    expect(tulum!.listing.end_time).toBe("04:00");
  });

  it("stops at a page with no events and still reads whole", async () => {
    const empty = page(1).replace(/"Event:[^"]+"/g, '"Gone:x"');
    const run = ctx([html(`${LIST}?page=1`, page(1)), html(`${LIST}?page=2`, empty)], NOW);
    const result = await tickeriAdapter.harvest!(source(), run);

    expect(result.whole).toBe(true);
    expect(result.listings).toHaveLength(16);
  });

  it("fails a first page that carries no event data", async () => {
    const run = ctx([html(`${LIST}?page=1`, "<html><body>Just a moment...</body></html>")], NOW);
    await expect(tickeriAdapter.harvest!(source(), run)).rejects.toThrow(/no event data/);
  });
});
