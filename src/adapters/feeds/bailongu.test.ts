import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { bailonguAdapter, parseBailonguMonth } from "@/src/adapters/feeds/bailongu";
import type { Metro, RunCtx, Source } from "@/src/adapters/types";
import { createPoliteHttp, fixtureTransport, type Fixture } from "@/src/pipeline/http";

const DIR = path.join(__dirname, "__fixtures__");
const OCTOBER_HTML = readFileSync(path.join(DIR, "bailongu-2026-10.html"), "utf8");
const NOVEMBER_HTML = readFileSync(path.join(DIR, "bailongu-2026-11.html"), "utf8");

const BARCELONA: Metro = {
  id: "bcn",
  slug: "barcelona",
  name: "Barcelona",
  countryCode: "ES",
  center: { lat: 41.3851, lng: 2.1734 },
  radiusKm: 50,
  tz: "Europe/Madrid",
  languages: ["ca", "es"],
};

const source = (): Source => ({
  id: "bailongu",
  url: "https://www.bailongu.com/agenda",
  kind: "jsonld",
  trustTier: "first_party",
  platform: "bailongu",
  feedUrl: null,
  metroId: "bcn",
  styles: ["salsa", "bachata", "ballroom"],
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
      request: { method: "GET", url: "https://www.bailongu.com/robots.txt" },
      response: {
        url: "https://www.bailongu.com/robots.txt",
        status: 200,
        headers: { "content-type": "text/plain" },
        body: "User-agent: *\nAllow: /agenda\nDisallow: /intranet\nDisallow: /login\nDisallow: /register\nCrawl-delay: 1\n",
      },
    },
    ...fixtures,
  ]);
  let t = now.getTime();
  return {
    metro: BARCELONA,
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

describe("parseBailonguMonth", () => {
  it("parses October fixture", () => {
    const events = parseBailonguMonth(OCTOBER_HTML);
    expect(events).toHaveLength(4);

    expect(events[0]).toMatchObject({
      date: "2026-10-04",
      title: "Salsongu-bachatongu",
      href: "https://www.bailongu.com/pagina/salsongu-bachatongu",
    });
    expect(events[0]!.text).toContain("Vine a practicar salsa i bachata");

    expect(events[1]).toMatchObject({
      date: "2026-10-18",
      title: "Bailongu ball",
      href: "https://www.bailongu.com/pagina/bailongu-ball",
    });

    expect(events[2]).toMatchObject({
      date: "2026-10-19",
      title: "Nous cursos!",
      href: "https://www.bailongu.com/cursos-ball-barcelona?term=207&c=12",
    });

    expect(events[3]).toMatchObject({
      date: "2026-10-25",
      title: "Ballem al carrer!",
      href: "https://bailongu.com/pagina/ballem-al-carrer",
    });
  });

  it("parses November fixture", () => {
    const events = parseBailonguMonth(NOVEMBER_HTML);
    expect(events.length).toBeGreaterThan(10);

    const first = events[0];
    expect(first).toMatchObject({
      date: "2026-11-08",
      title: "Son cubà",
      href: "https://bailongu.com/pagina/soncuba",
    });
    expect(first!.text).toContain("Vine a practicar SON CUBÀ");

    const second = events[1];
    expect(second).toMatchObject({
      date: "2026-11-08",
      title: "Salsongu-bachatongu",
      href: "https://www.bailongu.com/pagina/salsongu-bachatongu",
    });
  });
});

describe("bailongu reader", () => {
  it("reads October page only (window 2026-10-18 to 2026-10-31)", async () => {
    const NOW = new Date("2026-10-18T12:00:00Z"); // fromNight 2026-10-18
    const run = ctx([html("https://www.bailongu.com/agenda/2026-10", OCTOBER_HTML)], NOW);
    const result = await bailonguAdapter.harvest!(source(), run);

    // Should keep only Bailongu ball (2026-10-18), screen workshops and street events
    expect(result.listings).toHaveLength(1);
    const listing = result.listings[0]!;
    expect(listing.listing.local_date).toBe("2026-10-18");
    expect(listing.listing.title).toContain("Bailongu ball");
    expect(listing.listing.doors_time).toBe("19:00");
    expect(listing.listing.end_time).toBe("22:00");
    expect(listing.listing.venue.name).toBe("Bailongu");

    expect(result.notes).toContain("1 workshop/course row(s) left out");
    expect(result.notes).toContain("1 street event(s) left out");
    expect(result.whole).toBe(true);
  });

  it("keeps the 15th and 22nd's socials with their styles and screens every workshop", async () => {
    const NOW = new Date("2026-11-15T12:00:00Z"); // fromNight 2026-11-15, window to 2026-11-28
    const run = ctx([html("https://www.bailongu.com/agenda/2026-11", NOVEMBER_HTML)], NOW);
    const result = await bailonguAdapter.harvest!(source(), run);
    const rows = result.listings.map((l) => [
      l.listing.local_date,
      l.listing.title,
      l.listing.doors_time,
      l.listing.end_time,
      l.listing.listing_type,
      [...l.listing.styles].sort().join(","),
    ]);
    expect(rows).toEqual([
      ["2026-11-15", "Bailongu rock", "19:00", "22:00", "practica", "ballroom,rock_n_roll"],
      ["2026-11-15", "Bailongu ball", "19:00", "22:00", "practica", "ballroom"],
      ["2026-11-22", "Sevillanes", "19:00", "22:00", "practica", "sevillanas"],
      ["2026-11-22", "Salsongu-bachatongu", "19:00", "22:00", "practica", "bachata,salsa"],
    ]);
    expect(result.listings[0]!.listing.prices).toEqual([
      { label: "Entry", amount: 10, currency: "EUR", includes: null },
    ]);
    expect((result.notes ?? []).some((n) => /workshop\/course row\(s\) left out/.test(n))).toBe(
      true,
    );
  });

  it("reads November page only (window 2026-11-01 to 2026-11-14)", async () => {
    const NOW = new Date("2026-11-01T12:00:00Z"); // fromNight 2026-11-01
    const run = ctx([html("https://www.bailongu.com/agenda/2026-11", NOVEMBER_HTML)], NOW);
    const result = await bailonguAdapter.harvest!(source(), run);

    // Should keep Son cubà and Salsongu-bachatongu on 2026-11-08
    expect(result.listings).toHaveLength(2);

    const sorted = result.listings.sort((a, b) => a.listing.title.localeCompare(b.listing.title));
    expect(sorted[0]!.listing.title).toContain("Salsongu-bachatongu");
    expect(sorted[0]!.listing.local_date).toBe("2026-11-08");
    expect(sorted[0]!.listing.doors_time).toBe("19:00");

    expect(sorted[1]!.listing.title).toContain("Son cubà");
    expect(sorted[1]!.listing.local_date).toBe("2026-11-08");
    expect(sorted[1]!.listing.doors_time).toBe("19:00");

    // No workshops in the window (2026-11-01 to 2026-11-14), so no note
    // The workshops are on 2026-11-15 and 2026-11-22, which are outside
    expect(result.whole).toBe(true);
  });

  it("reads both October and November pages (window 2026-10-26 to 2026-11-08)", async () => {
    const NOW = new Date("2026-10-26T12:00:00Z"); // fromNight 2026-10-26
    const run = ctx(
      [
        html("https://www.bailongu.com/agenda/2026-10", OCTOBER_HTML),
        html("https://www.bailongu.com/agenda/2026-11", NOVEMBER_HTML),
      ],
      NOW,
    );
    const result = await bailonguAdapter.harvest!(source(), run);

    // Should only keep events from November 8 (October events are either screened or outside window)
    expect(result.listings).toHaveLength(2);
    result.listings.forEach((listing) => {
      expect(listing.listing.local_date).toBe("2026-11-08");
    });

    expect(result.whole).toBe(true);
  });

  it("handles page fetch failure", async () => {
    const NOW = new Date("2026-11-01T12:00:00Z");
    const run = ctx(
      [
        {
          request: { method: "GET", url: "https://www.bailongu.com/agenda/2026-11" },
          response: {
            url: "https://www.bailongu.com/agenda/2026-11",
            status: 500,
            headers: { "content-type": "text/html" },
            body: "<html>Error</html>",
          },
        },
      ],
      NOW,
    );
    const result = await bailonguAdapter.harvest!(source(), run);

    // The note should contain "not read (HTTP 500)"
    expect(result.notes).toHaveLength(1);
    expect((result.notes ?? [])[0]).toContain("/agenda/2026-11: not read (");
    expect(result.whole).not.toBe(true);
    expect(result.listings).toHaveLength(0);
  });

  it("uses correct URL without zero-padding", async () => {
    const NOW = new Date("2026-10-18T12:00:00Z");
    const run = ctx([html("https://www.bailongu.com/agenda/2026-10", OCTOBER_HTML)], NOW);
    await bailonguAdapter.harvest!(source(), run);

    // Verify the request URL matches expected format
    expect(run.requests).toContain("GET https://www.bailongu.com/agenda/2026-10");
  });
});
