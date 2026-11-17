import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { mennaAdapter, mennaCards } from "@/src/adapters/feeds/menna";
import type { Metro, RunCtx, Source } from "@/src/adapters/types";
import { createPoliteHttp, fixtureTransport, type Fixture } from "@/src/pipeline/http";

// https://itsmenna.com/events (2026-10-25) cut to five cards: two parties in the window (Habibti
// Club 10-30, YA MASKHARA 10-28), a concert (Music only), a party moved to 2026-12-12 (past the
// window) and YALLAWEEN on 10-24 (over). Each event page is cut to its title and JSON-LD.
const DIR = path.join(__dirname, "__fixtures__");
const read = (name: string) => readFileSync(path.join(DIR, name), "utf8");

const LIST = "https://itsmenna.com/events";
const HABIBTI = "https://itsmenna.com/events/1660-habibti-club-halloween-edition/";
const MASKHARA = "https://itsmenna.com/events/1536-ya-maskhara-a-swana-masquerade/";

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
  platform: "menna",
  feedUrl: null,
  metroId: "m",
  styles: [],
  etag: null,
  lastModified: null,
  contentHash: null,
});

const html = (url: string, body: string, status = 200): Fixture => ({
  request: { method: "GET", url },
  response: { url, status, headers: { "content-type": "text/html" }, body },
});

function ctx(fixtures: Fixture[], now: Date): RunCtx & { requests: string[] } {
  const transport = fixtureTransport([
    {
      request: { method: "GET", url: "https://itsmenna.com/robots.txt" },
      response: {
        url: "https://itsmenna.com/robots.txt",
        status: 200,
        headers: { "content-type": "text/plain" },
        body: "User-agent: *\nAllow: /\n",
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

describe("mennaCards", () => {
  it("reads each card's link, title, categories and dates", () => {
    const cards = mennaCards(read("menna-events.html"), LIST);
    expect(cards).toHaveLength(5);
    expect(cards[0]).toEqual({
      url: HABIBTI,
      title: "Habibti Club- Halloween Edition",
      categories: ["Music", "Party"],
      day: "2026-10-30",
      endDay: "2026-10-30",
    });
    expect(cards.map((c) => c.categories.includes("Party"))).toEqual([
      true,
      true,
      false,
      true,
      true,
    ]);
  });
});

describe("menna reader", () => {
  it("reads only the window's Party and Dance cards' own pages", async () => {
    const run = ctx(
      [
        html(LIST, read("menna-events.html")),
        html(HABIBTI, read("menna-event-1660.html")),
        html(MASKHARA, read("menna-event-1536.html")),
      ],
      NOW,
    );
    const result = await mennaAdapter.harvest!(source(), run);

    expect(run.requests).toEqual([
      "GET https://itsmenna.com/robots.txt",
      `GET ${LIST}`,
      `GET ${HABIBTI}`,
      `GET ${MASKHARA}`,
    ]);
    expect(result.listings.map((l) => l.listing.title).sort()).toEqual([
      "Habibti Club- Halloween Edition",
      "YA MASKHARA! يا مسخرة! A SWANA Masquerade",
    ]);
    const maskhara = result.listings.find((l) => l.eventUrl === MASKHARA);
    expect(maskhara!.listing.local_date).toBe("2026-10-28");
    expect(maskhara!.listing.doors_time).toBe("18:00");
    expect(maskhara!.listing.venue.name).toBe("Kween");
    expect(result.whole).toBe(true);
    expect(result.notes).toContain("2 party or dance night(s) in the window of 5 listed");
  });

  it("is not whole when an event page cannot be read", async () => {
    const run = ctx(
      [
        html(LIST, read("menna-events.html")),
        html(HABIBTI, "Server error", 500),
        html(MASKHARA, read("menna-event-1536.html")),
      ],
      NOW,
    );
    const result = await mennaAdapter.harvest!(source(), run);

    expect(result.whole).toBeUndefined();
    expect(result.listings.map((l) => l.eventUrl)).toEqual([MASKHARA]);
  });

  it("fails a page that shows no event cards", async () => {
    const run = ctx([html(LIST, "<html><body>Maintenance</body></html>")], NOW);
    await expect(mennaAdapter.harvest!(source(), run)).rejects.toThrow(/no event cards/);
  });
});
