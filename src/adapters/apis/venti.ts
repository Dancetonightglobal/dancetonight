// Venti (venti.live), Argentina's party ticketer, read from its sitemap like Posh (owner, 2026-10-29).
// Its robots.txt allows `/evento/` event pages and lists `Sitemap: https://venti.live/sitemap.xml`;
// it disallows `/api/` (never touch it). The owner decided (2026-10-29) to read Venti as a public
// search index does: the sitemap names every event page, and each event page carries one
// schema.org Event, with exact coordinates, inside a normal JSON-LD script tag.
// This adapter reads up to MAX_VENTI_PAGES of them per run with no model and keeps only events
// whose coordinates are inside the metro (CABA). The per-run cap means the read is never whole.

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
import { currentNightDate } from "@/src/domain/tonight";
import { CRAWL_INTERVAL_MS } from "@/src/pipeline/http";

/** The sitemap that lists event pages. */
export const VENTI_SITEMAP = "https://venti.live/sitemap.xml";
/** 120 pages at 10 s crawl-delay is 20 minutes; the ingest reads sources one after another. */
export const MAX_VENTI_PAGES = 120;
/** Days of lastmod to consider recent. */
export const VENTI_LASTMOD_DAYS = 30;

/** Places outside CABA that appear in Venti slugs. */
export const OTHER_CITY_SLUGS: readonly string[] = [
  "rosario",
  "cordoba",
  "mardel",
  "mar-del-plata",
  "la-plata",
  "temperley",
  "pilar",
  "tortuguitas",
  "campana",
  "necochea",
  "bariloche",
  "carlos-paz",
  "mendoza",
  "tucuman",
  "salta",
  "neuquen",
  "bahia-blanca",
  "punta-del-este",
  "montevideo",
  "uruguay",
  "chaco",
  "corrientes",
  "santa-fe",
  "san-andres-de-giles",
  "casilda",
  "malaga",
  "barcelona",
  "madrid",
  "city-bell",
  "quilmes",
  "lanus",
  "moron",
  "tigre",
  "escobar",
  "san-isidro",
  "nordelta",
  "junin",
  "pergamino",
  "tandil",
  "parana",
  "posadas",
  "jujuy",
  "villa-gesell",
  "pinamar",
  "carilo",
  "miramar",
  "san-luis",
  "san-juan",
  "rio-cuarto",
  "zarate",
  "lujan",
];

/**
 * Parse the sitemap XML for `<url>` entries.
 * @returns Array of { url, lastmod } where url is the decoded `<loc>` and lastmod is a Date or null.
 */
export function parseVentiSitemap(xml: string): { url: string; lastmod: Date | null }[] {
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
    if (!url.startsWith("https://venti.live/evento/")) continue;
    // Must be exactly /evento/<slug> with no further /, ?, or #
    try {
      const path = new URL(url).pathname;
      if (!/^\/evento\/[^\/?#]+$/.test(path)) continue;
      const slug = path.slice(8);
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
 * Select which URLs to read, applying recency and city slug filters.
 */
export function ventiCandidates(
  entries: { url: string; lastmod: Date | null }[],
  now: Date,
): string[] {
  const recentCutoff = new Date(now.getTime() - VENTI_LASTMOD_DAYS * 24 * 60 * 60 * 1000);
  const candidates: { url: string; lastmod: Date | null }[] = [];
  for (const entry of entries) {
    // 1. lastmod not null and recent enough
    if (entry.lastmod === null || entry.lastmod < recentCutoff) continue;
    // 2. slug city token check
    const path = new URL(entry.url).pathname;
    const slug = path.slice(8).toLowerCase();
    // Check if any OTHER_CITY_SLUGS appears as a whole hyphen-separated token
    // Using regex pattern (^|-)place($|-) as per spec
    let shouldSkip = false;
    for (const city of OTHER_CITY_SLUGS) {
      // Create regex that matches city as a whole token in the slug
      const pattern = new RegExp(`(^|-)${city}($|-)`);
      if (pattern.test(slug)) {
        shouldSkip = true;
        break;
      }
    }
    if (shouldSkip) continue;
    candidates.push(entry);
  }
  // Sort newest lastmod first (stable for ties: keep sitemap order)
  candidates.sort((a, b) => b.lastmod!.getTime() - a.lastmod!.getTime());
  // Deduplicate by URL
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const cand of candidates) {
    if (!seen.has(cand.url) && urls.length < MAX_VENTI_PAGES) {
      seen.add(cand.url);
      urls.push(cand.url);
    }
  }
  return urls;
}

/**
 * Check if a startDate string represents Venti's 23:59 placeholder in the metro's timezone.
 * If yes, return the local calendar date (YYYY-MM-DD) without time; otherwise return null.
 */
function isVentiPlaceholder(startDate: unknown, metroTz: string): string | null {
  if (typeof startDate !== "string") return null;
  try {
    const date = new Date(startDate);
    if (isNaN(date.getTime())) return null;
    // Get local hour and minute in metro timezone
    const timeFormatter = new Intl.DateTimeFormat("en-US", {
      timeZone: metroTz,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const timeParts = timeFormatter.formatToParts(date);
    const hour = timeParts.find((p) => p.type === "hour")?.value;
    const minute = timeParts.find((p) => p.type === "minute")?.value;
    // Get the local date
    const dateFormatter = new Intl.DateTimeFormat("en-US", {
      timeZone: metroTz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const dateParts = dateFormatter.formatToParts(date);
    const year = dateParts.find((p) => p.type === "year")?.value;
    const month = dateParts.find((p) => p.type === "month")?.value;
    const day = dateParts.find((p) => p.type === "day")?.value;

    if (hour === "23" && minute === "59") {
      return `${year}-${month}-${day}`;
    }
  } catch {
    // ignore
  }
  return null;
}

export const ventiAdapter: SourceAdapter = {
  id: "venti",
  tier: "A",
  countries: ["AR"],
  limits: { perDomainIntervalMs: CRAWL_INTERVAL_MS },
  async harvest(source: Source, ctx: RunCtx): Promise<HarvestResult> {
    const url = source.feedUrl ?? VENTI_SITEMAP;
    const sitemap = await ctx.http.request({
      url,
      purpose: "crawl",
      headers: { accept: "application/xml,text/xml;q=0.9,*/*;q=0.1" },
    });
    const entries = parseVentiSitemap(sitemap.body);
    const fromNight = currentNightDate(ctx.now(), ctx.metro.tz);
    const candidates = ventiCandidates(entries, ctx.now());
    const notes: string[] = [];
    const listings: HarvestedListing[] = [];
    let readCount = 0;
    let inMetroCount = 0;
    let outsideCount = 0;
    let noCoordsCount = 0;
    let placeholderCount = 0;
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
        const { blocks } = extractJsonLd(page.body);
        const eventNodes = findEvents(blocks);
        const isRecord = (v: unknown): v is Record<string, unknown> =>
          typeof v === "object" && v !== null && !Array.isArray(v);
        const num = (v: unknown): number => {
          if (typeof v === "number") return v;
          if (typeof v === "string" && v.trim() !== "") return Number(v);
          return NaN;
        };
        for (const node of eventNodes) {
          // Handle Venti's 23:59 placeholder
          let processedNode = node;
          const placeholderDate = isVentiPlaceholder(node.startDate, ctx.metro.tz);
          if (placeholderDate) {
            placeholderCount++;
            // Create a shallow copy with startDate replaced by date-only string
            processedNode = { ...node, startDate: placeholderDate };
          }
          const location =
            isRecord(processedNode) && isRecord(processedNode.location)
              ? processedNode.location
              : null;
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
              const read = jsonLdToListings([processedNode], {
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
    if (placeholderCount > 0) {
      notes.push(`${placeholderCount} start times of 23:59 read as no time`);
    }
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
