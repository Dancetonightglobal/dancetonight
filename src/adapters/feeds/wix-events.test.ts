import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { wixEventsAdapter, parseWixEvents } from "@/src/adapters/feeds/wix-events";
import type { Metro, RunCtx, Source } from "@/src/adapters/types";
import { createPoliteHttp, fixtureTransport, type Fixture } from "@/src/pipeline/http";

const DIR = path.join(__dirname, "__fixtures__");
const FIXTURE_HTML = readFileSync(path.join(DIR, "carioca-da-gema-shows.html"), "utf8");

const URL = "https://www.barcariocadagema.com.br/shows";

const RIO: Metro = {
  id: "m",
  slug: "rio",
  name: "Rio de Janeiro",
  countryCode: "BR",
  center: { lat: -22.9068, lng: -43.1729 },
  radiusKm: 50,
  tz: "America/Sao_Paulo",
  languages: ["pt"],
};

const source = (url: string): Source => ({
  id: "s",
  url,
  kind: "jsonld",
  trustTier: "first_party",
  platform: "wix",
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
      request: { method: "GET", url: "https://www.barcariocadagema.com.br/robots.txt" },
      response: {
        url: "https://www.barcariocadagema.com.br/robots.txt",
        status: 200,
        headers: { "content-type": "text/plain" },
        body: "User-Agent: *\nDisallow: /auth\nDisallow: /login\nDisallow: /tickets\n",
      },
    },
    ...fixtures,
  ]);
  let t = now.getTime();
  return {
    metro: RIO,
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

const NOW = new Date("2026-10-29T15:00:00Z"); // 12:00 in São Paulo; window 2026-10-29..2026-11-11 (14 days)

describe("wix events reader", () => {
  it("parseWixEvents returns 18 events from fixture", () => {
    const events = parseWixEvents(FIXTURE_HTML);
    expect(events).toHaveLength(18);
    expect(events![0]!.title).toBe("Andrezão do Cacique");
  });

  it("parseWixEvents returns null for html without warmup script", () => {
    expect(parseWixEvents("<html></html>")).toBeNull();
  });

  it("parseWixEvents returns [] for warmup script with no events", () => {
    const html = `<script type="application/json" id="wix-warmup-data">{}</script>`;
    expect(parseWixEvents(html)).toEqual([]);
  });

  it("harvests the fixture correctly", async () => {
    const run = ctx([html(URL, FIXTURE_HTML)], NOW);
    const result = await wixEventsAdapter.harvest!(source(URL), run);

    expect(run.requests).toEqual([
      "GET https://www.barcariocadagema.com.br/robots.txt",
      `GET ${URL}`,
    ]);
    // Count events in window: from 2026-10-29 to 2026-11-11 inclusive
    // The fixture has 18 events total, but only those within the window should be included
    // Let's count: events from 2026-10-29 to 2026-11-11 (inclusive) are:
    // 2026-10-29, 2026-10-30, 2026-10-31, 2026-11-01, 2026-11-03, 2026-11-04,
    // 2026-11-05, 2026-11-06, 2026-11-07, 2026-11-10, 2026-11-11
    // That's 11 events (2026-11-12T00:30:00Z is 2026-11-11 night, but might be filtered for other reasons)
    expect(result.listings).toHaveLength(11);

    const first = result.listings[0]!;
    expect(first.listing.title).toBe("Andrezão do Cacique");
    expect(first.listing.local_date).toBe("2026-10-29");
    expect(first.listing.doors_time).toBe("19:30"); // 22:30Z in São Paulo (UTC-3)
    expect(first.listing.venue.name).toBe("Carioca da Gema");
    expect(first.externalId).toMatch(/^wix:[a-f0-9-]+$/);
    expect(first.listing.end_time).toBeNull(); // endDateHidden is true
  });

  it("handles startDate 2026-11-13T00:30:00.000Z as 21:30 on 2026-11-12", async () => {
    const run = ctx([html(URL, FIXTURE_HTML)], new Date("2026-11-05T15:00:00Z"));
    const result = await wixEventsAdapter.harvest!(source(URL), run);
    const late = result.listings.filter(
      (l) => l.listing.title === "Andrezão do Cacique" && l.listing.local_date === "2026-11-12",
    );
    expect(late).toHaveLength(1);
    expect(late[0]!.listing.doors_time).toBe("21:30");
  });

  it("notes the events after the window", async () => {
    const run = ctx([html(URL, FIXTURE_HTML)], NOW);
    const result = await wixEventsAdapter.harvest!(source(URL), run);
    expect(result.notes).toContain("7 event(s) after the window or before tonight left out");
  });

  it("skips scheduleTbd events and adds note", async () => {
    // Modify the fixture to change only the first event's scheduleTbd to true
    const modifiedHtml = FIXTURE_HTML.replace('"scheduleTbd": false', '"scheduleTbd": true');
    const run = ctx([html(URL, modifiedHtml)], NOW);
    const result = await wixEventsAdapter.harvest!(source(URL), run);

    expect(result.notes).toContain("1 event(s) with no date yet left out");
    expect(result.listings).toHaveLength(10);
  });

  it("throws when page has no warmup data", async () => {
    const run = ctx([html(URL, "<html></html>")], NOW);
    await expect(wixEventsAdapter.harvest!(source(URL), run)).rejects.toThrow(/no Wix warmup data/);
  });

  it("marks result as whole", async () => {
    const run = ctx([html(URL, FIXTURE_HTML)], NOW);
    const result = await wixEventsAdapter.harvest!(source(URL), run);
    expect(result.whole).toBe(true);
  });
});
