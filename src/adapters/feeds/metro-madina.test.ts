import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { MAX_ITEM_PAGES } from "@/src/adapters/feeds/event-pages";
import {
  metroMadinaAdapter,
  metroMadinaCards,
  metroMadinaPage,
} from "@/src/adapters/feeds/metro-madina";
import type { Metro, RunCtx, Source } from "@/src/adapters/types";
import { createPoliteHttp, fixtureTransport, type Fixture } from "@/src/pipeline/http";

const DIR = path.join(__dirname, "__fixtures__");
const read = (name: string) => readFileSync(path.join(DIR, name), "utf8");

const LIST = "https://metromadina.com/events";
const HOUSSAM = "https://metromadina.com/event/midnight-metro-with-houssam-3-2";

const BEIRUT: Metro = {
  id: "b",
  slug: "beirut",
  name: "Beirut",
  countryCode: "LB",
  center: { lat: 33.8938, lng: 35.5018 },
  radiusKm: 50,
  tz: "Asia/Beirut",
  languages: ["ar", "en"],
};

const source = (): Source => ({
  id: "s",
  url: LIST,
  kind: "jsonld",
  trustTier: "first_party",
  platform: "metro_madina",
  feedUrl: null,
  metroId: "b",
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
      request: { method: "GET", url: "https://metromadina.com/robots.txt" },
      response: {
        url: "https://metromadina.com/robots.txt",
        status: 200,
        headers: { "content-type": "text/plain" },
        body: "User-agent: *\nAllow: /\n",
      },
    },
    ...fixtures,
  ]);
  let t = now.getTime();
  return {
    metro: BEIRUT,
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

const NOW = new Date("2026-11-06T12:00:00Z"); // window 2026-11-06 .. 2026-11-19

describe("metroMadinaCards", () => {
  it("reads each card's link, title, category and day", () => {
    const cards = metroMadinaCards(read("metro-madina-events.html"), LIST);
    expect(cards).toHaveLength(4);
    const houssam = cards.find((c) => c.url === HOUSSAM);
    expect(houssam).toEqual({
      url: HOUSSAM,
      title: "Midnight Metro with Houssam & Koshari",
      category: "party",
      day: "2026-11-06",
    });
    expect(cards.map((c) => c.category)).toEqual(["concert", "party", "party", "party"]);
  });
});

describe("metroMadinaPage", () => {
  it("reads party page", () => {
    const page = metroMadinaPage(read("metro-madina-event-party.html"));
    expect(page.title).toBe("Midnight Metro with Houssam & Koshari");
    expect(page.category).toBe("Party");
    expect(page.day).toBe("2026-11-06");
    expect(page.doors).toBe("23:30");
  });

  it("reads concert page", () => {
    const page = metroMadinaPage(read("metro-madina-event-concert.html"));
    expect(page.category).toBe("Concert");
    expect(page.day).toBe("2026-11-06");
    expect(page.doors).toBe("20:15");
  });
});

describe("metro_madina reader", () => {
  it("reads only the window's party cards", async () => {
    const run = ctx(
      [
        html(LIST, read("metro-madina-events.html")),
        html(HOUSSAM, read("metro-madina-event-party.html")),
      ],
      NOW,
    );
    const result = await metroMadinaAdapter.harvest!(source(), run);

    expect(run.requests).toEqual([
      "GET https://metromadina.com/robots.txt",
      `GET ${LIST}`,
      `GET ${HOUSSAM}`,
    ]);
    expect(result.listings).toHaveLength(1);
    const listing = result.listings[0]!;
    expect(listing.externalId).toBe(`metro_madina:${HOUSSAM}:2026-11-06`);
    expect(listing.listing.title).toBe("Midnight Metro with Houssam & Koshari");
    expect(listing.listing.local_date).toBe("2026-11-06");
    expect(listing.listing.doors_time).toBe("23:30");
    expect(listing.listing.venue.name).toBe("Metro al Madina");
    expect(result.whole).toBe(true);
    expect(result.notes).toContain("1 party night(s) in the window of 4 listed");
  });

  it("adjusts doors time before 06:00 to next calendar date", async () => {
    const partyHtml = read("metro-madina-event-party.html").replace("11:30 PM", "1:00 AM");
    const run = ctx([html(LIST, read("metro-madina-events.html")), html(HOUSSAM, partyHtml)], NOW);
    const result = await metroMadinaAdapter.harvest!(source(), run);
    expect(result.listings).toHaveLength(1);
    // A 1:00 AM doors on the 11-06 card is 2026-11-07 01:00, still the 11-06 night.
    expect(result.listings[0]!.listing.local_date).toBe("2026-11-06");
    expect(result.listings[0]!.listing.doors_time).toBe("01:00");
  });

  it("fails when list page has no cards", async () => {
    const run = ctx([html(LIST, "<html><body>No cards</body></html>")], NOW);
    await expect(metroMadinaAdapter.harvest!(source(), run)).rejects.toThrow(
      /Metro al Madina's events page shows no cards/,
    );
  });

  it("drops page with non-party category", async () => {
    const run = ctx(
      [
        html(LIST, read("metro-madina-events.html")),
        html(HOUSSAM, read("metro-madina-event-concert.html")), // concert page for party card
      ],
      NOW,
    );
    const result = await metroMadinaAdapter.harvest!(source(), run);
    expect(result.listings).toHaveLength(0);
    expect(
      (result.notes ?? []).some((note) => note.includes('page category "Concert" is not Party')),
    ).toBe(true);
    expect(result.whole).toBe(true); // because no kept cards after filtering
  });

  it("is not whole when a page fetch fails", async () => {
    const run = ctx(
      [html(LIST, read("metro-madina-events.html")), html(HOUSSAM, "Server error", 500)],
      NOW,
    );
    const result = await metroMadinaAdapter.harvest!(source(), run);
    expect(result.listings).toHaveLength(0);
    expect(result.whole).toBeUndefined();
    expect((result.notes ?? []).some((note) => note.startsWith(`${HOUSSAM}:`))).toBe(true);
  });

  it("is not whole when more party nights are listed than the page cap", async () => {
    const urls = Array.from(
      { length: MAX_ITEM_PAGES + 1 },
      (_, n) => `https://metromadina.com/event/midnight-metro-${n}`,
    );
    const list = urls
      .map(
        (u, n) =>
          `<div class="tab-col" data-cat="party" data-date="2026-11-06" data-target="${n}"><a class="event-details" href="${u}"><span class="title">Midnight Metro ${n}</span></a></div>`,
      )
      .join("\n");
    const party = read("metro-madina-event-party.html");
    const run = ctx(
      [
        html(
          LIST,
          `<html><body><div class="recurring-events"><div class="tab-content">${list}</div></div></body></html>`,
        ),
        ...urls.map((u) => html(u, party)),
      ],
      NOW,
    );
    const result = await metroMadinaAdapter.harvest!(source(), run);
    expect(result.listings).toHaveLength(MAX_ITEM_PAGES);
    expect(run.requests).not.toContain(`GET ${urls[MAX_ITEM_PAGES]}`);
    expect(result.whole).toBeUndefined();
    expect((result.notes ?? []).some((note) => note.includes("cap not read"))).toBe(true);
  });
});
