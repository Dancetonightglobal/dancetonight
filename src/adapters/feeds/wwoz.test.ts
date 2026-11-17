import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  parseWwozNight,
  wwozVenueFlags,
  wwozAdapter,
  wwozSkipReason,
} from "@/src/adapters/feeds/wwoz";
import type { Metro, RunCtx, Source } from "@/src/adapters/types";
import { createPoliteHttp, fixtureTransport, type Fixture } from "@/src/pipeline/http";

const DIR = path.join(__dirname, "__fixtures__");
const read = (name: string) => readFileSync(path.join(DIR, name), "utf8");

const FIXTURE = read("wwoz-livewire-2026-10-29.html");
const BASE_URL = "https://www.wwoz.org/calendar/livewire-music";

const NEW_ORLEANS: Metro = {
  id: "nola",
  slug: "new-orleans",
  name: "New Orleans",
  countryCode: "US",
  center: { lat: 29.9511, lng: -90.0715 },
  radiusKm: 50,
  tz: "America/Chicago",
  languages: ["en"],
};

const source = (): Source => ({
  id: "wwoz",
  url: BASE_URL,
  kind: "jsonld",
  trustTier: "directory",
  platform: "wwoz",
  feedUrl: null,
  metroId: "nola",
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
      request: { method: "GET", url: "https://www.wwoz.org/robots.txt" },
      response: {
        url: "https://www.wwoz.org/robots.txt",
        status: 200,
        headers: { "content-type": "text/plain" },
        body: "User-agent: *\nCrawl-delay: 10\nAllow: /calendar/\n",
      },
    },
    ...fixtures,
  ]);
  let t = now.getTime();
  return {
    metro: NEW_ORLEANS,
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

describe("parseWwozNight", () => {
  it("reads exactly 80 gigs across 59 distinct venue slugs", () => {
    const gigs = parseWwozNight(FIXTURE, `${BASE_URL}?date=2026-10-29`, "2026-10-29");
    expect(gigs).toHaveLength(80);
    const slugs = new Set(gigs.map((g) => g.venueSlug));
    expect(slugs.size).toBe(59);
  });

  it("contains Big Joe Kennedy at 21st Amendment", () => {
    const gigs = parseWwozNight(FIXTURE, `${BASE_URL}?date=2026-10-29`, "2026-10-29");
    const found = gigs.find((g) => g.eventId === "1393961");
    expect(found).toEqual({
      venueSlug: "21st-amendment",
      venueName: "21st Amendment",
      eventId: "1393961",
      eventUrl: "https://www.wwoz.org/events/1393961",
      title: "Big Joe Kennedy",
      date: "2026-10-29",
      startTime: "15:00",
      originalTimeText: "3:00pm",
      listedDate: "Thursday, October 29",
      pageUrl: "https://www.wwoz.org/calendar/livewire-music?date=2026-10-29",
      fetchedAt: expect.any(Date),
    });
  });

  it("contains Marty Peters & The Party Meters", () => {
    const gigs = parseWwozNight(FIXTURE, `${BASE_URL}?date=2026-10-29`, "2026-10-29");
    const found = gigs.find((g) => g.eventId === "1393936");
    expect(found?.title).toBe("Marty Peters & The Party Meters");
    expect(found?.startTime).toBe("20:00");
  });

  it("has Spotted Cat with 3 gigs at 14:00, 18:00, 22:00", () => {
    const gigs = parseWwozNight(FIXTURE, `${BASE_URL}?date=2026-10-29`, "2026-10-29");
    const spotted = gigs.filter((g) => g.venueSlug === "spotted-cat");
    expect(spotted).toHaveLength(3);
    const times = spotted.map((g) => g.startTime).sort();
    expect(times).toEqual(["14:00", "18:00", "22:00"]);
  });

  it("has Vaughan's Lounge with Corey Henry at 22:30", () => {
    const gigs = parseWwozNight(FIXTURE, `${BASE_URL}?date=2026-10-29`, "2026-10-29");
    const vaughan = gigs.find(
      (g) => g.venueSlug === "vaughans-lounge" && g.title.includes("Corey Henry"),
    );
    expect(vaughan?.startTime).toBe("22:30");
  });

  it("decodes Café Negril correctly", () => {
    const gigs = parseWwozNight(FIXTURE, `${BASE_URL}?date=2026-10-29`, "2026-10-29");
    const negril = gigs.find((g) => g.venueSlug === "cafe-negril");
    expect(negril?.venueName).toBe("Café Negril");
  });

  it("converts 12:30am to 00:30", () => {
    const html = `
    <div class="panel panel-default">
      <h3 class="panel-title"><a href="/organizations/test">Test</a></h3>
      <div class="panel-body">
        <p class="truncate"><a href="/events/999">Test</a></p>
        <p>Thursday, October 29 at 12:30am</p>
      </div>
    </div>`;
    const gigs = parseWwozNight(html, BASE_URL, "2026-10-29");
    expect(gigs[0]?.startTime).toBe("00:30");
    // Written under the page's own date, so it is the next calendar day: still the night of 10-29.
    expect(gigs[0]?.date).toBe("2026-10-30");
  });

  it("handles noon and midnight", () => {
    const htmlNoon = `
    <div class="panel panel-default">
      <h3 class="panel-title"><a href="/organizations/test">Test</a></h3>
      <div class="panel-body">
        <p class="truncate"><a href="/events/999">Test</a></p>
        <p>Thursday, October 29 at Noon</p>
      </div>
    </div>`;
    const gigsNoon = parseWwozNight(htmlNoon, BASE_URL, "2026-10-29");
    expect(gigsNoon[0]?.startTime).toBe("12:00");

    const htmlMidnight = `
    <div class="panel panel-default">
      <h3 class="panel-title"><a href="/organizations/test">Test</a></h3>
      <div class="panel-body">
        <p class="truncate"><a href="/events/999">Test</a></p>
        <p>Thursday, October 29 at Midnight</p>
      </div>
    </div>`;
    const gigsMidnight = parseWwozNight(htmlMidnight, BASE_URL, "2026-10-29");
    expect(gigsMidnight[0]?.startTime).toBe("00:00");
  });

  it("handles year boundary: January 2 on night 2026-12-31", () => {
    const html = `
    <div class="panel panel-default">
      <h3 class="panel-title"><a href="/organizations/test">Test</a></h3>
      <div class="panel-body">
        <p class="truncate"><a href="/events/999">Test</a></p>
        <p>Monday, January 2 at 8:00pm</p>
      </div>
    </div>`;
    const gigs = parseWwozNight(html, BASE_URL, "2026-12-31");
    expect(gigs[0]?.date).toBe("2027-01-02");
  });

  it("skips panels without /organizations/ link", () => {
    const html = `
    <div class="panel panel-default">
      <h4 class="panel-title">Site Menu</h4>
      <div class="panel-body">
        <p>Some content</p>
      </div>
    </div>`;
    const gigs = parseWwozNight(html, BASE_URL, "2026-10-29");
    expect(gigs).toHaveLength(0);
  });

  it("skips rows without time", () => {
    const html = `
    <div class="panel panel-default">
      <h3 class="panel-title"><a href="/organizations/test">Test</a></h3>
      <div class="panel-body">
        <p class="truncate"><a href="/events/999">Test</a></p>
        <p>Thursday, October 29</p>
      </div>
    </div>`;
    const gigs = parseWwozNight(html, BASE_URL, "2026-10-29");
    expect(gigs).toHaveLength(0);
  });

  it("deduplicates by eventId", () => {
    const html = `
    <div class="panel panel-default">
      <h3 class="panel-title"><a href="/organizations/test">Test</a></h3>
      <div class="panel-body">
        <p class="truncate"><a href="/events/999">Test</a></p>
        <p>Thursday, October 29 at 8:00pm</p>
        <p class="truncate"><a href="/events/999">Test Duplicate</a></p>
        <p>Thursday, October 29 at 8:00pm</p>
      </div>
    </div>`;
    const gigs = parseWwozNight(html, BASE_URL, "2026-10-29");
    expect(gigs).toHaveLength(1);
  });
});

describe("wwozVenueFlags", () => {
  it("returns correct flags for spotted-cat", () => {
    expect(wwozVenueFlags("spotted-cat")).toEqual({
      bandsForDancers: true,
      bandsForDancersFrom: null,
      danceBandKinds: true,
    });
  });

  it("returns bandsForDancersFrom for maple-leaf", () => {
    const flags = wwozVenueFlags("maple-leaf");
    expect(flags.bandsForDancersFrom).toBe("19:00");
    expect(flags.bandsForDancers).toBe(true);
    expect(flags.danceBandKinds).toBe(true);
  });

  it("returns danceBandKinds: false for preservation-hall", () => {
    expect(wwozVenueFlags("preservation-hall")).toEqual({
      danceBandKinds: false,
      lateNightKeep: false,
    });
  });

  it("treats the Bayou Bar and the AllWays Twilight Room as seated, but not the AllWays main room", () => {
    for (const slug of ["bayou-bar-pontchartrain", "twilight-room-allways-lounge"]) {
      expect(wwozVenueFlags(slug)).toEqual({ danceBandKinds: false, lateNightKeep: false });
    }
    expect(wwozVenueFlags("allways-lounge").danceBandKinds).toBe(true);
  });

  it("returns danceBandKinds: true for unknown venue", () => {
    expect(wwozVenueFlags("okay-bar")).toEqual({
      danceBandKinds: true,
      lateNightKeep: false,
    });
  });
});

describe("wwozSkipReason", () => {
  it("returns null for non-seated venue with no pickers' jam", () => {
    expect(wwozSkipReason("Swing Night", "allways-lounge")).toBeNull();
  });

  it("returns pickers' jam reason for bluegrass jam", () => {
    expect(wwozSkipReason("Bluegrass Jam", "okay-bar")).toBe("a pickers' jam, not a dance");
  });

  it("returns pickers' jam reason for pickin' jam", () => {
    expect(wwozSkipReason("NOLA Pickin’ Party Bluegrass Jam", "okay-bar")).toBe(
      "a pickers' jam, not a dance",
    );
  });

  it("returns pickers' jam reason for a pickin' jam without the word bluegrass", () => {
    expect(wwozSkipReason("Monday Pickin' Jam", "okay-bar")).toBe("a pickers' jam, not a dance");
  });

  it("keeps a seated room's gig that names a style", () => {
    expect(wwozSkipReason("Salsa Night with lesson", "twilight-room-allways-lounge")).toBeNull();
  });

  it("returns null for bluegrass brunch (no jam)", () => {
    expect(wwozSkipReason("Bluegrass Brunch", "okay-bar")).toBeNull();
  });

  it("returns null for Django Jazz Jam (no bluegrass/pickin)", () => {
    expect(wwozSkipReason("Django Jazz Jam", "okay-bar")).toBeNull();
  });

  it("returns seated room reason for gig without dance word or style", () => {
    expect(wwozSkipReason("Heather Littlefield + Pat Reedy", "twilight-room-allways-lounge")).toBe(
      "a seated room's gig that names no dance",
    );
  });

  it("returns null for seated room gig with dance word", () => {
    expect(wwozSkipReason("Swing Dance Night", "twilight-room-allways-lounge")).toBeNull();
  });

  it("returns null for seated room gig with style", () => {
    expect(wwozSkipReason("Zydeco Dance Party", "twilight-room-allways-lounge")).toBeNull();
  });

  it("returns null for same title at non-seated venue", () => {
    expect(wwozSkipReason("Heather Littlefield + Pat Reedy", "allways-lounge")).toBeNull();
  });
});

describe("wwozAdapter.harvest", () => {
  const NOW = new Date("2026-10-29T20:00:00Z"); // 3pm in Chicago

  it("requests 14 nights and returns 49 listings", async () => {
    // 80 gigs minus 31 seated-room gigs that name no dance (wwozSkipReason)
    const fixtures: Fixture[] = [];
    for (let i = 0; i < 14; i++) {
      const date = new Date(NOW);
      date.setDate(date.getDate() + i);
      const dateStr = date.toISOString().split("T")[0];
      const url = `${BASE_URL}?date=${dateStr}`;
      if (i === 0) {
        fixtures.push(html(url, FIXTURE));
      } else {
        fixtures.push(html(url, "<html><body></body></html>"));
      }
    }

    const run = ctx(fixtures, NOW);
    const result = await wwozAdapter.harvest!(source(), run);

    // Check requests
    expect(run.requests).toHaveLength(15); // robots.txt + 14 nights
    expect(run.requests[1]).toContain("?date=2026-10-29");
    expect(run.requests[14]).toContain("?date=2026-11-11");

    // Check listings
    expect(result.listings).toHaveLength(49);
    const spottedCat22 = result.listings.find((l) => l.externalId === "wwoz:1401266");
    expect(spottedCat22?.eventUrl).toBe("https://www.wwoz.org/events/1401266");
    expect(spottedCat22?.venueFlags?.bandsForDancers).toBe(true);

    expect(result.notes?.[0]).toMatch(/80 gig\(s\) on \d+ night\(s\) read of \d+/);
    expect(
      result.notes?.some((n) => /^31 gig\(s\) skipped as not dances: .*, and 19 more$/.test(n)),
    ).toBe(true);
  });

  it("throws when first page has zero gigs", async () => {
    const run = ctx([html(`${BASE_URL}?date=2026-10-29`, "<html><body></body></html>")], NOW);
    await expect(wwozAdapter.harvest!(source(), run)).rejects.toThrow("WWOZ's page shows no gigs");
  });

  it("continues when later night throws", async () => {
    const fixtures: Fixture[] = [
      html(`${BASE_URL}?date=2026-10-29`, FIXTURE),
      {
        request: { method: "GET", url: `${BASE_URL}?date=2026-10-30` },
        response: {
          url: `${BASE_URL}?date=2026-10-30`,
          status: 500,
          headers: { "content-type": "text/html" },
          body: "Server error",
        },
      },
    ];
    for (let i = 2; i < 14; i++) {
      const date = new Date(NOW);
      date.setDate(date.getDate() + i);
      const dateStr = date.toISOString().split("T")[0];
      fixtures.push(html(`${BASE_URL}?date=${dateStr}`, "<html><body></body></html>"));
    }

    const run = ctx(fixtures, NOW);
    const result = await wwozAdapter.harvest!(source(), run);

    expect(result.listings).toHaveLength(49);
    expect((result.notes ?? []).some((n) => n.includes("2026-10-30"))).toBe(true);
  });

  it("skips seated-room gig without dance word and adds skip note", async () => {
    // Build a minimal HTML with a seated venue gig that has no dance word
    const htmlSeated = `
    <div class="panel panel-default">
      <h3 class="panel-title"><a href="/organizations/preservation-hall">Preservation Hall</a></h3>
      <div class="panel-body">
        <p class="truncate"><a href="/events/999999">Heather Littlefield + Pat Reedy</a></p>
        <p>Thursday, October 29 at 8:00pm</p>
      </div>
    </div>`;
    const fixtures: Fixture[] = [html(`${BASE_URL}?date=2026-10-29`, htmlSeated)];
    for (let i = 1; i < 14; i++) {
      const date = new Date(NOW);
      date.setDate(date.getDate() + i);
      const dateStr = date.toISOString().split("T")[0];
      fixtures.push(html(`${BASE_URL}?date=${dateStr}`, "<html><body></body></html>"));
    }

    const run = ctx(fixtures, NOW);
    const result = await wwozAdapter.harvest!(source(), run);

    // The gig should be skipped because it's in a seated room and has no dance word/style
    expect(result.listings).toHaveLength(0);
    const skipNote = result.notes?.find((n) => n.includes("skipped as not dances"));
    expect(skipNote).toMatch(/1 gig\(s\) skipped as not dances/);
  });
});
