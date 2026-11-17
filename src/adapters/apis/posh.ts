// Posh (posh.vip) hosts many NYC party and Latin dance nights. Its robots.txt allows `/e/` event
// pages and lists `Sitemap: https://posh.vip/sitemap-index.xml`; it disallows `/api/` (never touch
// it). The owner decided (2026-10-17) to read Posh as a public search index does: the recent-events
// sitemap names every new or changed event page, and each event page carries one schema.org Event,
// with exact coordinates, inside the page's Next.js data (not in a `<script type=ld+json>` tag).
// This adapter reads up to MAX_POSH_PAGES of them per run with no model and keeps only events whose
// coordinates are inside the metro (D-152). The per-run cap means the read is never whole.

import { extractJsonLd, findEvents, jsonLdToListings } from "@/src/adapters/feeds/jsonld";
import { withSourceStyle } from "@/src/adapters/feeds/event-pages";
import { sha256 } from "@/src/adapters/shared";
import type {
  HarvestResult,
  HarvestedListing,
  RunCtx,
  Source,
  SourceAdapter,
} from "@/src/adapters/types";
import { insideMetro } from "@/src/domain/metro-bounds";
import { MATERIALIZE_DAYS } from "@/src/domain/recurrence";
import { addCalendarDays } from "@/src/domain/time";
import { currentNightDate } from "@/src/domain/tonight";
import { CRAWL_INTERVAL_MS } from "@/src/pipeline/http";

/** The sitemap that lists recent event pages. */
export const POSH_SITEMAP = "https://posh.vip/sitemap-events-recent.xml";
/** 120 pages at 5 s a page is 10 minutes; the ingest reads sources one after another inside a 120-minute box. */
export const MAX_POSH_PAGES = 120;
/** Days of lastmod to consider recent. */
export const POSH_LASTMOD_DAYS = 3;
/** The recent-events sitemap is about 9 MB (50,000 URLs, 2026-10-18); the client's 5 MB cap refused it. */
export const POSH_SITEMAP_MAX_BYTES = 16 * 1024 * 1024;

/** Only names that cannot be NYC; "la" is deliberately absent: "viva-la-bachata". */
export const OTHER_CITY_TOKENS: ReadonlySet<string> = new Set([
  "dc",
  "dmv",
  "atl",
  "atlanta",
  "miami",
  "chicago",
  "houston",
  "htx",
  "dallas",
  "dfw",
  "austin",
  "atx",
  "london",
  "toronto",
  "philly",
  "philadelphia",
  "boston",
  "baltimore",
  "charlotte",
  "nashville",
  "orlando",
  "tampa",
  "vegas",
  "seattle",
  "denver",
  "detroit",
  "nola",
  "phoenix",
  "oakland",
  "sandiego",
  "losangeles",
  "richmond",
  "raleigh",
  "montreal",
]);

/**
 * Parse the sitemap XML for `<url>` entries.
 * @returns Array of { url, lastmod } where url is the decoded `<loc>` and lastmod is a Date or null.
 */
export function parsePoshSitemap(xml: string): { url: string; lastmod: Date | null }[] {
  const entries: { url: string; lastmod: Date | null }[] = [];
  // Match each <url> block
  const urlRegex = /<url>\s*([\s\S]*?)\s*<\/url>/g;
  for (const match of xml.matchAll(urlRegex)) {
    const block = match[1];
    if (!block) continue;
    const locMatch = /<loc>\s*([^<]+?)\s*<\/loc>/s.exec(block);
    const lastmodMatch = /<lastmod>\s*([^<]+?)\s*<\/lastmod>/s.exec(block);
    let url = locMatch?.[1]?.trim() ?? "";
    if (!url) continue;
    // Decode XML entities
    url = url
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'");
    if (!url.startsWith("https://posh.vip/e/")) continue;
    // Must be exactly /e/<slug> with no further /, ?, or #
    try {
      const path = new URL(url).pathname;
      if (!/^\/e\/[^\/?#]+$/.test(path)) continue;
      const slug = path.slice(3);
      if (slug.length === 0) continue;
    } catch {
      continue;
    }
    let lastmod: Date | null = null;
    const lastmodStr = lastmodMatch?.[1]?.trim();
    if (lastmodStr) {
      const d = new Date(lastmodStr);
      if (!isNaN(d.getTime())) lastmod = d;
    }
    entries.push({ url, lastmod });
  }
  return entries;
}

/**
 * Extract JSON-LD blocks from Next.js flight data.
 * Scans for `self.__next_f.push([1,"..."])` strings, decodes them,
 * then looks for objects with "@context" containing "schema.org".
 */
export function poshEventBlocks(html: string): unknown[] {
  const blocks: unknown[] = [];
  // First, get regular JSON-LD blocks
  const { blocks: jsonLdBlocks } = extractJsonLd(html);
  blocks.push(...jsonLdBlocks);
  // Next.js flight data - capture the whole JSON string literal including escapes
  const flightRegex = /self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g;
  const flightStrings: string[] = [];
  for (const match of html.matchAll(flightRegex)) {
    const literal = match[1];
    if (!literal) continue;
    try {
      const decoded = JSON.parse(literal) as unknown;
      if (typeof decoded === "string") {
        flightStrings.push(decoded);
      }
    } catch {
      // skip malformed
      continue;
    }
  }
  const combined = flightStrings.join("");
  // Scan for objects with @context containing schema.org
  let i = 0;
  while (i < combined.length && blocks.length < 10) {
    const idx = combined.indexOf('"@context"', i);
    if (idx === -1) break;
    // Find nearest '{' before
    let bracePos = idx;
    while (bracePos >= 0 && combined[bracePos] !== "{") bracePos--;
    if (bracePos < 0) {
      i = idx + 1;
      continue;
    }
    // Parse one JSON value with balanced braces
    const start = bracePos;
    let depth = 0;
    let inString = false;
    let escape = false;
    let end = start;
    for (let j = start; j < combined.length; j++) {
      const ch = combined[j];
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
      } else if (!inString) {
        if (ch === "{") depth++;
        else if (ch === "}") {
          depth--;
          if (depth === 0) {
            end = j + 1;
            break;
          }
        }
      }
    }
    if (depth !== 0) {
      i = start + 1;
      continue;
    }
    const slice = combined.slice(start, end);
    try {
      const obj = JSON.parse(slice);
      if (obj && typeof obj === "object") {
        const ctx = obj["@context"];
        const hasSchemaOrg =
          (typeof ctx === "string" && ctx.includes("schema.org")) ||
          (Array.isArray(ctx) &&
            ctx.some((c) => typeof c === "string" && c.includes("schema.org")));
        if (hasSchemaOrg) {
          blocks.push(obj);
        }
      }
    } catch {
      // ignore
    }
    i = end;
  }
  return blocks;
}

/**
 * Select which URLs to read, applying recency, city token, and date filters.
 */
export function poshCandidates(
  entries: { url: string; lastmod: Date | null }[],
  now: Date,
  fromNight: string,
  days: number = MATERIALIZE_DAYS,
): string[] {
  const recentCutoff = new Date(now.getTime() - POSH_LASTMOD_DAYS * 24 * 60 * 60 * 1000);
  const startWindow = addCalendarDays(fromNight, -1);
  const endWindow = addCalendarDays(fromNight, days - 1);
  const candidates: { url: string; lastmod: Date | null }[] = [];
  for (const entry of entries) {
    // 1. lastmod not null and recent enough
    if (entry.lastmod === null || entry.lastmod < recentCutoff) continue;
    // 2. slug city token check
    const path = new URL(entry.url).pathname;
    const slug = path.slice(3).toLowerCase();
    const tokens = slug.split("-");
    if (tokens.some((t) => OTHER_CITY_TOKENS.has(t))) continue;
    // 3. date in slug
    const dateMatch = slug.match(/\d{4}-\d{2}-\d{2}/);
    if (dateMatch) {
      const date = dateMatch[0];
      if (date < startWindow || date > endWindow) continue;
    }
    candidates.push(entry);
  }
  // Sort newest lastmod first (all lastmod are non-null now)
  candidates.sort((a, b) => b.lastmod!.getTime() - a.lastmod!.getTime());
  // Deduplicate by URL
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const cand of candidates) {
    if (!seen.has(cand.url) && urls.length < MAX_POSH_PAGES) {
      seen.add(cand.url);
      urls.push(cand.url);
    }
  }
  return urls;
}

export const poshAdapter: SourceAdapter = {
  id: "posh",
  tier: "A",
  countries: ["US"],
  limits: { perDomainIntervalMs: CRAWL_INTERVAL_MS },
  async harvest(source: Source, ctx: RunCtx): Promise<HarvestResult> {
    const url = source.feedUrl ?? POSH_SITEMAP;
    const sitemap = await ctx.http.request({
      url,
      purpose: "crawl",
      headers: { accept: "application/xml,text/xml;q=0.9,*/*;q=0.1" },
      maxBytes: POSH_SITEMAP_MAX_BYTES,
    });
    const entries = parsePoshSitemap(sitemap.body);
    const fromNight = currentNightDate(ctx.now(), ctx.metro.tz);
    const candidates = poshCandidates(entries, ctx.now(), fromNight);
    const notes: string[] = [];
    const listings: HarvestedListing[] = [];
    let readCount = 0;
    let inMetroCount = 0;
    let outsideCount = 0;
    let noCoordsCount = 0;
    const fetchErrors: string[] = [];
    let failed = 0;
    for (const candidate of candidates) {
      try {
        const page = await ctx.http.request({
          url: candidate,
          purpose: "crawl",
          headers: { accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1" },
        });
        readCount++;
        const blocks = poshEventBlocks(page.body);
        const eventNodes = findEvents(blocks);
        const isRecord = (v: unknown): v is Record<string, unknown> =>
          typeof v === "object" && v !== null && !Array.isArray(v);
        const num = (v: unknown): number => {
          if (typeof v === "number") return v;
          if (typeof v === "string" && v.trim() !== "") return Number(v);
          return NaN;
        };
        for (const node of eventNodes) {
          const location = isRecord(node) && isRecord(node.location) ? node.location : null;
          const geo = location && isRecord(location.geo) ? location.geo : null;
          let lat: number | undefined;
          let lng: number | undefined;
          if (geo) {
            lat = num(geo.latitude);
            lng = num(geo.longitude);
          }
          if (
            lat !== undefined &&
            lng !== undefined &&
            Number.isFinite(lat) &&
            Number.isFinite(lng)
          ) {
            if (insideMetro(ctx.metro, { lat, lng })) {
              inMetroCount++;
              const read = jsonLdToListings([node], {
                pageUrl: page.url || candidate,
                fetchedAt: page.fetchedAt,
                metroTz: ctx.metro.tz,
                countryCode: ctx.metro.countryCode,
                fromNight,
              });
              const styled = read.listings.map((l) => withSourceStyle(l, source.styles));
              listings.push(...styled);
              notes.push(...read.notes);
            } else {
              outsideCount++;
            }
          } else {
            noCoordsCount++;
          }
        }
      } catch (error) {
        // A page that cannot be read is named (the first five) and counted; the others are read.
        failed++;
        if (fetchErrors.length < 5) {
          const msg = error instanceof Error ? error.message : String(error);
          fetchErrors.push(`${candidate}: ${msg}`);
        }
      }
    }
    if (failed > fetchErrors.length) {
      fetchErrors.push(`${failed - fetchErrors.length} more pages could not be read`);
    }
    notes.unshift(
      `${entries.length} event pages in the sitemap; ${candidates.length} recent and not another city's; ${readCount} read; ${inMetroCount} events in the metro, ${outsideCount} outside it, ${noCoordsCount} without coordinates`,
    );
    if (fetchErrors.length > 0) {
      notes.push(...fetchErrors);
    }
    return {
      listings,
      notes,
      doc: {
        url,
        fetchedAt: sitemap.fetchedAt,
        httpStatus: sitemap.status,
        etag: sitemap.etag,
        lastModified: sitemap.lastModified,
        contentHash: sha256(JSON.stringify(listings.map((l) => [l.externalId, l.listing]))),
        cleanedText: null,
      },
    };
  },
};
