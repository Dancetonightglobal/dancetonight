import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  wwozStreetsEventLinks,
  isParadeTitle,
  parseWwozParade,
  wwozStreetsAdapter,
} from "./wwoz-streets";
import type { Source, RunCtx } from "@/src/adapters/types";
import { createPoliteHttp, fixtureTransport, type Fixture } from "@/src/pipeline/http";
import { normalizeListing } from "@/src/pipeline/normalize";

const fixturesDir = join(__dirname, "__fixtures__", "wwoz-streets");
const readFixture = (name: string): string => readFileSync(join(fixturesDir, name), "utf-8");

describe("wwoz-streets", () => {
  describe("wwozStreetsEventLinks", () => {
    it("extracts event links from programme page", () => {
      const html = readFixture("wwoz-streets-2026-11-01.html");
      const links = wwozStreetsEventLinks(html);

      // Should contain these three in order
      expect(links).toContain("https://www.wwoz.org/events/1379251");
      expect(links).toContain("https://www.wwoz.org/events/1407171");
      expect(links).toContain("https://www.wwoz.org/events/1378681");

      // Check order relative to each other
      const idx1 = links.indexOf("https://www.wwoz.org/events/1379251");
      const idx2 = links.indexOf("https://www.wwoz.org/events/1407171");
      const idx3 = links.indexOf("https://www.wwoz.org/events/1378681");

      expect(idx1).toBeLessThan(idx2);
      expect(idx2).toBeLessThan(idx3);

      // No duplicates
      expect(links).toEqual([...new Set(links)]);

      // All entries match pattern
      links.forEach((link) => {
        expect(link).toMatch(/^https:\/\/www\.wwoz\.org\/events\/\d+$/);
      });
    });
  });

  describe("isParadeTitle", () => {
    it("returns true for parade titles", () => {
      expect(isParadeTitle("We Are One Second Line Parade")).toBe(true);
      expect(isParadeTitle("Family Ties Second Line Parade")).toBe(true);
      expect(isParadeTitle("All Saints Day Parade")).toBe(true);
      expect(isParadeTitle("Sudan Second-Line")).toBe(true);
    });

    it("returns false for non-parade titles", () => {
      expect(isParadeTitle("Backstreet Cultural Museum Grand Opening")).toBe(false);
      expect(isParadeTitle("Powerhouses of Knowledge")).toBe(false);
    });
  });

  describe("parseWwozParade", () => {
    it("returns null for empty HTML", () => {
      const result = parseWwozParade("<html></html>", "https://www.wwoz.org/events/1");
      expect(result).toBeNull();
    });

    it("parses We Are One Second Line Parade", () => {
      const html = readFixture("wwoz-streets-event-1379251.html");
      const result = parseWwozParade(html, "https://www.wwoz.org/events/1379251");

      expect(result).not.toBeNull();
      if (!result) return;

      expect(result.eventId).toBe("1379251");
      expect(result.eventUrl).toBe("https://www.wwoz.org/events/1379251");
      expect(result.title).toBe("We Are One Second Line Parade");
      expect(result.date).toBe("2026-11-01");
      expect(result.startTime).toBe("12:30");
      expect(result.endTime).toBe("16:30");
      expect(result.dateText).toBe("Sunday, November 1, 2026 - 12:30pm to 4:30pm");
      expect(result.routeStart).toBe("Verret's Lounge & Bar 1738 Washington Ave");
      expect(result.venueName).toBe("Verret's Lounge & Bar");
      expect(result.venueAddress).toBe("1738 Washington Ave, New Orleans, LA");
      expect(result.routeEnd).toMatch(/^Verret's Lounge/);
    });

    it("parses Family Ties Second Line Parade", () => {
      const html = readFixture("wwoz-streets-event-1378681.html");
      const result = parseWwozParade(html, "https://www.wwoz.org/events/1378681");

      expect(result).not.toBeNull();
      if (!result) return;

      expect(result.eventId).toBe("1378681");
      expect(result.date).toBe("2026-11-14");
      expect(result.startTime).toBe("13:00");
      expect(result.endTime).toBe("17:00");
      expect(result.routeStart).toBe("Treme Center");
      expect(result.venueName).toBe("Treme Center");
      expect(result.venueAddress).toBeNull();
      expect(result.routeEnd).toBe("Lilly's Lounge (740 N. Broad St.)");
    });

    it("parses All Saints Day Parade", () => {
      const html = readFixture("wwoz-streets-event-1407171.html");
      const result = parseWwozParade(html, "https://www.wwoz.org/events/1407171");

      expect(result).not.toBeNull();
      if (!result) return;

      expect(result.eventId).toBe("1407171");
      expect(result.date).toBe("2026-11-01");
      expect(result.startTime).toBe("14:00");
      expect(result.endTime).toBeNull();
      expect(result.venueName).toBe("Saint Augustine Church (OUTDOORS)");
      expect(result.venueAddress).toBe("1210 Governor Nicholls Street, New Orleans, LA 70116");
    });
  });
});

describe("wwozStreetsAdapter", () => {
  const NEW_ORLEANS = {
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
    id: "wwoz_streets",
    url: "https://www.wwoz.org/programs/inthestreet",
    kind: "jsonld",
    trustTier: "directory",
    platform: "wwoz_streets",
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
          body: "User-agent: *\nCrawl-delay: 10\nAllow: /calendar/\nAllow: /programs/\nAllow: /events/\n",
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

  it("keeps a parade through normalize with the directory's flags: no style, no mixed calendar (D-556)", async () => {
    const fixtures: Fixture[] = [
      html(
        "https://www.wwoz.org/programs/inthestreet",
        readFixture("wwoz-streets-2026-11-01.html"),
      ),
      html("https://www.wwoz.org/events/1379251", readFixture("wwoz-streets-event-1379251.html")),
      html("https://www.wwoz.org/events/1378681", readFixture("wwoz-streets-event-1378681.html")),
      html("https://www.wwoz.org/events/1407171", readFixture("wwoz-streets-event-1407171.html")),
      html("https://www.wwoz.org/events/786791", readFixture("wwoz-streets-event-786791.html")),
    ];
    const now = new Date("2026-11-01T15:00:00Z");
    const run = ctx(fixtures, now);
    const result = await wwozStreetsAdapter.harvest!(source(), run);
    const weAreOne = result.listings.find((l) => l.externalId === "wwoz:1379251");
    expect(weAreOne).toBeDefined();
    const outcome = normalizeListing(weAreOne!, {
      metro: NEW_ORLEANS,
      source: {
        url: "https://www.wwoz.org/programs/inthestreet",
        trustTier: "directory",
        styles: [],
      },
      now,
    });
    if (!outcome.ok) throw new Error(`dropped: ${outcome.kind}: ${outcome.reason}`);
    expect(outcome.event.listingType).toBe("outdoor_public");
    expect(outcome.event.nightDate).toBe("2026-11-01");
  });

  it("harvests parades within the window", async () => {
    const fixtures: Fixture[] = [
      html(
        "https://www.wwoz.org/programs/inthestreet",
        readFixture("wwoz-streets-2026-11-01.html"),
      ),
      html("https://www.wwoz.org/events/1379251", readFixture("wwoz-streets-event-1379251.html")),
      html("https://www.wwoz.org/events/1378681", readFixture("wwoz-streets-event-1378681.html")),
      html("https://www.wwoz.org/events/1407171", readFixture("wwoz-streets-event-1407171.html")),
      html("https://www.wwoz.org/events/786791", readFixture("wwoz-streets-event-786791.html")),
    ];

    const now = new Date("2026-11-01T15:00:00Z");
    const run = ctx(fixtures, now);
    const result = await wwozStreetsAdapter.harvest!(source(), run);

    // Check externalIds
    const externalIds = result.listings.map((l) => l.externalId);
    expect(externalIds).toContain("wwoz:1379251");
    expect(externalIds).toContain("wwoz:1378681");
    expect(externalIds).toContain("wwoz:1407171");
    expect(externalIds).not.toContain("wwoz:786791");

    // Check We Are One listing
    const weAreOne = result.listings.find((l) => l.externalId === "wwoz:1379251");
    expect(weAreOne?.listing.venue?.name).toBe("Route starts at Verret's Lounge & Bar");
    expect(weAreOne?.listing.venue?.address).toBe("1738 Washington Ave, New Orleans, LA");
    expect(weAreOne?.listing.listing_type).toBe("outdoor_public");

    // Check All Saints Day listing
    const allSaints = result.listings.find((l) => l.externalId === "wwoz:1407171");
    expect(allSaints?.listing.venue?.name).toBe(
      "Route starts at Saint Augustine Church (OUTDOORS)",
    );
    expect(allSaints?.listing.venue?.address).toBe(
      "1210 Governor Nicholls Street, New Orleans, LA 70116",
    );

    // Check notes
    expect(result.notes?.[0]).toMatch(/3 parade\(s\) of \d+ linked page\(s\)/);
  });
});
