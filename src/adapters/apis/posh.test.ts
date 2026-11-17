import { readFileSync } from "node:fs";
import path from "node:path";

import { findEvents } from "@/src/adapters/feeds/jsonld";
import { describe, expect, it } from "vitest";

import {
  parsePoshSitemap,
  poshCandidates,
  poshEventBlocks,
  poshAdapter,
  POSH_SITEMAP,
  MAX_POSH_PAGES,
  POSH_LASTMOD_DAYS,
  OTHER_CITY_TOKENS,
} from "@/src/adapters/apis/posh";
import type { Metro, RunCtx, Source } from "@/src/adapters/types";
import { createPoliteHttp, type TransportRequest } from "@/src/pipeline/http";

const FIXTURES_DIR = path.join(__dirname, "__fixtures__/posh");
const SITEMAP = readFileSync(path.join(FIXTURES_DIR, "sitemap-events-recent.xml"), "utf8");
const ABYSS_HTML = readFileSync(path.join(FIXTURES_DIR, "event-abyss-brooklyn.html"), "utf8");
const ARLINGTON_HTML = readFileSync(path.join(FIXTURES_DIR, "event-viva-arlington.html"), "utf8");

const NOW = new Date("2026-10-16T20:00:00Z");
const TONIGHT = "2026-10-16";
const NYC: Metro = {
  id: "m",
  slug: "nyc",
  name: "New York",
  countryCode: "US",
  center: { lat: 40.7128, lng: -74.006 },
  radiusKm: 40,
  tz: "America/New_York",
  languages: ["en"],
};
const SOURCE: Source = {
  id: "s",
  url: "https://posh.vip/",
  kind: "platform_api",
  trustTier: "directory",
  platform: "posh",
  feedUrl: null,
  metroId: "m",
  styles: ["salsa", "bachata"],
  etag: null,
  lastModified: null,
  contentHash: null,
};

describe("parsePoshSitemap", () => {
  it("extracts /e/ entries and decodes entities", () => {
    const entries = parsePoshSitemap(SITEMAP);
    expect(entries).toHaveLength(6); // 6 /e/ entries, the /g/ one dropped
    // Check that the salsa entry with &amp; is decoded
    const salsaEntry = entries.find(
      (e) => e.url === "https://posh.vip/e/salsa-&-bachata-thursdays",
    );
    expect(salsaEntry).toBeDefined();
    expect(salsaEntry?.url).toBe("https://posh.vip/e/salsa-&-bachata-thursdays");
    expect(entries.every((e) => e.url.startsWith("https://posh.vip/e/"))).toBe(true);
  });
});

describe("poshCandidates", () => {
  const entries = parsePoshSitemap(SITEMAP);
  it("filters by lastmod, city tokens, and date in slug", () => {
    const candidates = poshCandidates(entries, NOW, TONIGHT);
    // Should keep: abyss (lastmod 2026-10-16), viva-la-bachata (lastmod 2026-10-16)
    // salsa-&-bachata-thursdays has lastmod 2026-10-14 which is within 3 days, but note: the test fixture's lastmod is 2026-10-14T11:00:00.000Z, which is within 3 days of NOW (2026-10-16T20:00:00Z)
    // Drop: -dc- slug (contains dc), 2026-09-01 dated slug (out of window), old-summer-party (lastmod 2026-09-20)
    // Also drop the entry with null lastmod (the /g/ one already filtered out by parsePoshSitemap)
    expect(candidates).toHaveLength(3);
    expect(candidates[0]).toMatch(/abyss/); // newest lastmod first
    expect(candidates[1]).toMatch(/viva-la-bachata/);
    expect(candidates[2]).toMatch(/salsa-&-bachata-thursdays/);
    expect(candidates).not.toContain(
      "https://posh.vip/e/saturday-tokyo-pearl-singles-dating-mixer-dc-2026-10-18-3-0",
    );
    expect(candidates).not.toContain("https://posh.vip/e/rooftop-salsa-night-2026-09-01");
    expect(candidates).not.toContain("https://posh.vip/e/old-summer-party");
  });
});

type Geo = { name?: string; location?: { geo?: { latitude?: number; longitude?: number } } };

describe("poshEventBlocks", () => {
  it("extracts one Event from abyss fixture", () => {
    const blocks = poshEventBlocks(ABYSS_HTML);
    expect(blocks.length).toBeGreaterThanOrEqual(1);
    const events = findEvents(blocks);
    expect(events).toHaveLength(1);
    const event = events[0] as Geo;
    expect(event.name).toContain("DEEP END FRIDAY");
    expect(event.location?.geo?.latitude).toBeCloseTo(40.7067);
    expect(event.location?.geo?.longitude).toBeCloseTo(-73.9226);
  });

  it("extracts one Event from arlington fixture", () => {
    const blocks = poshEventBlocks(ARLINGTON_HTML);
    expect(blocks.length).toBeGreaterThanOrEqual(1);
    const events = findEvents(blocks);
    expect(events).toHaveLength(1);
    const event = events[0] as Geo;
    expect(event.name).toContain("Viva La Bachata");
    expect(event.location?.geo?.latitude).toBeCloseTo(38.88);
    expect(event.location?.geo?.longitude).toBeCloseTo(-77.11);
  });

  it("returns empty array for empty html", () => {
    expect(poshEventBlocks("")).toEqual([]);
  });

  it("does not throw on malformed flight data", () => {
    const html = `<script>self.__next_f.push([1,"invalid\\""])</script>`;
    expect(() => poshEventBlocks(html)).not.toThrow();
    expect(poshEventBlocks(html)).toEqual([]); // extractJsonLd returns empty blocks
  });
});

describe("poshAdapter", () => {
  it("harvests events inside metro", async () => {
    const seenUrls: string[] = [];
    let t = NOW.getTime();
    const ctx: RunCtx = {
      metro: NYC,
      now: () => new Date(t),
      env: {},
      log: () => {},
      http: createPoliteHttp({
        userAgent: "test",
        now: () => t,
        sleep: async (ms) => {
          t += ms;
        },
        transport: async (req: TransportRequest) => {
          seenUrls.push(req.url);
          if (req.url === POSH_SITEMAP) {
            return { url: req.url, status: 200, headers: {}, body: SITEMAP };
          }
          if (req.url === "https://posh.vip/e/deep-end-friday-at-abyss-brooklyn-1") {
            return { url: req.url, status: 200, headers: {}, body: ABYSS_HTML };
          }
          if (req.url === "https://posh.vip/e/-viva-la-bachata-sunday-social-copy") {
            return { url: req.url, status: 200, headers: {}, body: ARLINGTON_HTML };
          }
          if (req.url === "https://posh.vip/e/salsa-&-bachata-thursdays") {
            // Simulate a 404 for the third candidate
            return { url: req.url, status: 404, headers: {}, body: "" };
          }
          // robots.txt
          if (req.url === "https://posh.vip/robots.txt") {
            return { url: req.url, status: 200, headers: {}, body: "User-Agent: *\nAllow: /\n" };
          }
          throw new Error(`Unexpected request: ${req.url}`);
        },
      }),
    };
    const result = await poshAdapter.harvest!(SOURCE, ctx);
    // Should have fetched sitemap and the three candidates
    expect(seenUrls).toContain(POSH_SITEMAP);
    expect(seenUrls).toContain("https://posh.vip/e/deep-end-friday-at-abyss-brooklyn-1");
    expect(seenUrls).toContain("https://posh.vip/e/-viva-la-bachata-sunday-social-copy");
    expect(seenUrls).toContain("https://posh.vip/e/salsa-&-bachata-thursdays");
    // No /api/ URLs
    expect(seenUrls.every((u) => !u.includes("/api/"))).toBe(true);
    // One listing inside metro (abyss), one outside (arlington)
    expect(result.listings).toHaveLength(1);
    const listing = result.listings[0];
    expect(listing).toBeDefined();
    expect(listing!.listing.title).toContain("DEEP END FRIDAY");
    expect(listing!.listing.local_date).toBe("2026-10-16");
    // Notes
    expect(result.notes?.[0]).toMatch(
      /6 event pages in the sitemap; 3 recent and not another city's; 2 read; 1 events in the metro, 1 outside it, 0 without coordinates/,
    );
    // doc
    expect(result.doc).toBeDefined();
    expect(result.doc?.url).toBe(POSH_SITEMAP);
  });
});

describe("constants", () => {
  it("exports constants", () => {
    expect(POSH_SITEMAP).toBe("https://posh.vip/sitemap-events-recent.xml");
    expect(MAX_POSH_PAGES).toBe(120);
    expect(POSH_LASTMOD_DAYS).toBe(3);
    expect(OTHER_CITY_TOKENS.has("dc")).toBe(true);
    expect(OTHER_CITY_TOKENS.has("la")).toBe(false);
  });
});
