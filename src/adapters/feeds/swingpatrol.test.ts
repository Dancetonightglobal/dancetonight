import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { swingPatrolAdapter, parseSwingPatrolPage } from "@/src/adapters/feeds/swingpatrol";
import type { Metro, RunCtx, Source } from "@/src/adapters/types";
import { createPoliteHttp, fixtureTransport, type Fixture } from "@/src/pipeline/http";

const DIR = path.join(__dirname, "__fixtures__");
const WATERLOO_HTML = readFileSync(path.join(DIR, "swingpatrol-waterloo-2026-11-01.html"), "utf8");
const ANGEL_HTML = readFileSync(path.join(DIR, "swingpatrol-angel-2026-11-01.html"), "utf8");

const LONDON: Metro = {
  id: "lon",
  slug: "london",
  name: "London",
  countryCode: "GB",
  center: { lat: 51.5074, lng: -0.1278 },
  radiusKm: 50,
  tz: "Europe/London",
  languages: ["en"],
};

const source = (url: string): Source => ({
  id: "swingpatrol",
  url,
  kind: "html",
  trustTier: "first_party",
  platform: "swingpatrol",
  feedUrl: null,
  metroId: "lon",
  styles: ["lindy_hop"],
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
      request: { method: "GET", url: "https://www.swingpatrol.co.uk/robots.txt" },
      response: {
        url: "https://www.swingpatrol.co.uk/robots.txt",
        status: 200,
        headers: { "content-type": "text/plain" },
        body: "User-agent: *\nAllow: /\nDisallow:\n",
      },
    },
    ...fixtures,
  ]);
  let t = now.getTime();
  return {
    metro: LONDON,
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

describe("parseSwingPatrolPage", () => {
  it("parses Waterloo fixture", () => {
    const result = parseSwingPatrolPage(WATERLOO_HTML);
    expect(result.levels).toHaveLength(2);
    expect(result.levels[0]!.level).toBe(1);
    expect(result.levels[0]!.time).toBe("19:00");
    expect(result.levels[0]!.rows).toHaveLength(4);
    expect(result.levels[0]!.rows[0]).toMatchObject({
      monthDay: "November 5",
      title: "Beginner Lindy Hop",
    });
    expect(result.levels[1]!.level).toBe(2);
    expect(result.levels[1]!.time).toBe("20:15");
    expect(result.levels[1]!.rows[0]).toMatchObject({
      monthDay: "November 5",
      title: "Intermediate Swing",
    });
    expect(result.venue.name).toBe("Living Space");
    expect(result.venue.address).toBe("1 Coral St, London SE1 7BE");
    expect(result.venue.location).toEqual({ lat: 51.5009636, lng: -0.10877979999998 });
  });

  it("parses Angel fixture", () => {
    const result = parseSwingPatrolPage(ANGEL_HTML);
    expect(result.levels).toHaveLength(3);
    expect(result.levels[0]!.level).toBe(1);
    expect(result.levels[0]!.time).toBe("19:00");
    expect(result.levels[1]!.level).toBe(2);
    expect(result.levels[1]!.time).toBe("20:15");
    expect(result.levels[2]!.level).toBe(3);
    expect(result.levels[2]!.time).toBe("21:30");
    // Check venue parsing with two spaces after dash
    // The fixture may contain either Exmouth Market Centre or The Langham Club
    expect(result.venue.name).toBeTruthy();
    expect(result.venue.address).toBeTruthy();
    // Location should be present
    expect(result.venue.location).toBeTruthy();
  });
});

describe("swingPatrol reader", () => {
  it("harvests Waterloo page at 2026-11-01", async () => {
    const NOW = new Date("2026-11-01T12:00:00Z"); // fromNight 2026-11-01, window to 2026-11-14
    const run = ctx([html("https://www.swingpatrol.co.uk/classes/waterloo/", WATERLOO_HTML)], NOW);
    const result = await swingPatrolAdapter.harvest!(
      source("https://www.swingpatrol.co.uk/classes/waterloo/"),
      run,
    );

    // Should keep only 4 listings: Nov 5 and Nov 12 for levels 1 and 2 (Nov 19 and Nov 26 are outside window)
    expect(result.listings).toHaveLength(4);
    const dates = result.listings.map((l) => l.listing.local_date).sort();
    expect(dates).toEqual(["2026-11-05", "2026-11-05", "2026-11-12", "2026-11-12"]);
    const titles = result.listings.map((l) => l.listing.title);
    expect(titles).toContain("Beginner Lindy Hop");
    expect(titles).toContain("Intermediate Swing");
    expect(result.whole).toBe(true);
  });

  it("harvests Angel page at 2026-11-01, skipping closed rows", async () => {
    const NOW = new Date("2026-11-01T12:00:00Z");
    const run = ctx([html("https://www.swingpatrol.co.uk/classes/angel/", ANGEL_HTML)], NOW);
    const result = await swingPatrolAdapter.harvest!(
      source("https://www.swingpatrol.co.uk/classes/angel/"),
      run,
    );

    // Should have listings for Nov 9 (Beginner, Intermediate, Advanced) - Nov 2 is closed
    expect(result.listings).toHaveLength(3);
    result.listings.forEach((listing) => {
      expect(listing.listing.local_date).toBe("2026-11-09");
    });
    expect(result.notes).toContain("3 closed class date(s) left out");
    expect(result.whole).toBe(true);
  });

  it("handles year rollover", async () => {
    // The Waterloo page with its four Thursdays moved across the new year.
    const htmlContent = WATERLOO_HTML.replace(/November 5</g, "December 24<")
      .replace(/November 12</g, "December 31<")
      .replace(/November 19</g, "January 7<")
      .replace(/November 26</g, "January 14<");
    const NOW = new Date("2026-12-20T12:00:00Z"); // fromNight 2026-12-20, window to 2027-01-02
    const url = "https://www.swingpatrol.co.uk/classes/waterloo/";
    const run = ctx([html(url, htmlContent)], NOW);
    const result = await swingPatrolAdapter.harvest!(source(url), run);

    // Dec 24 and Dec 31 2026 at both levels; Jan 7 2027 is past the 14 nights.
    const dates = result.listings.map((l) => l.listing.local_date).sort();
    expect(dates).toEqual(["2026-12-24", "2026-12-24", "2026-12-31", "2026-12-31"]);
    expect(result.whole).toBe(true);

    // Run on 2026-12-28 the January rows land in 2027, not 2026.
    const later = ctx([html(url, htmlContent)], new Date("2026-12-28T12:00:00Z"));
    const next = await swingPatrolAdapter.harvest!(source(url), later);
    expect(next.listings.map((l) => l.listing.local_date)).toContain("2027-01-07");
  });

  it("rejects page with no dated tables", async () => {
    const htmlContent = "<html><body>Class Listing</body></html>";
    const NOW = new Date("2026-11-01T12:00:00Z");
    const run = ctx([html("https://www.swingpatrol.co.uk/classes/empty/", htmlContent)], NOW);
    await expect(
      swingPatrolAdapter.harvest!(source("https://www.swingpatrol.co.uk/classes/empty/"), run),
    ).rejects.toThrow(/no dated class table/);
  });

  it("rejects non-200 response", async () => {
    const NOW = new Date("2026-11-01T12:00:00Z");
    const transport = fixtureTransport([
      {
        request: { method: "GET", url: "https://www.swingpatrol.co.uk/robots.txt" },
        response: {
          url: "https://www.swingpatrol.co.uk/robots.txt",
          status: 200,
          headers: { "content-type": "text/plain" },
          body: "User-agent: *\nAllow: /\nDisallow:\n",
        },
      },
      {
        request: { method: "GET", url: "https://www.swingpatrol.co.uk/classes/bad/" },
        response: {
          url: "https://www.swingpatrol.co.uk/classes/bad/",
          status: 404,
          headers: { "content-type": "text/html" },
          body: "Not Found",
        },
      },
    ]);
    let t = NOW.getTime();
    const run: RunCtx = {
      metro: LONDON,
      now: () => new Date(t),
      http: createPoliteHttp({
        transport,
        userAgent: "t",
        now: () => t,
        sleep: async (ms) => void (t += ms),
      }),
      env: {},
      log: () => {},
    };
    await expect(
      swingPatrolAdapter.harvest!(source("https://www.swingpatrol.co.uk/classes/bad/"), run),
    ).rejects.toThrow(/404/);
  });
});
