// A page that lists its events' own pages (D-111): the `jsonld_items` adapter. NYC Swings' home
// page names its 17 /e/ pages in a JSON-LD ItemList; Big Apple Ranch's Wix page names its
// /event-details-registration/ pages the same way. Each of those pages carries one schema.org
// Event (a weekly series gives its next night), so the adapter follows them
// (src/adapters/feeds/event-pages.ts) and reads them with no model.
//
// A read is never `whole`: a series' page names its next night only (D-111).
// Events the list page carries itself are read too. A page that names no event page and carries
// no event is not this adapter's: it answers `readWithModel`.

import {
  itemListLinks,
  readItemPages,
  wixDatedEventLinks,
  wixEventLinks,
  withSourceStyle,
  isXceedHost,
  xceedEventLinks,
  sameSite,
} from "@/src/adapters/feeds/event-pages";
import { isFeverHost } from "@/src/adapters/feeds/fever";
import { extractJsonLd, findEvents, jsonLdToListings } from "@/src/adapters/feeds/jsonld";
import { sha256 } from "@/src/adapters/shared";
import type {
  HarvestResult,
  HarvestedListing,
  RunCtx,
  Source,
  SourceAdapter,
} from "@/src/adapters/types";
import { sameLink } from "@/src/domain/event-link-matcher";
import { currentNightDate } from "@/src/domain/tonight";
import { CRAWL_INTERVAL_MS } from "@/src/pipeline/http";
import { normalizeForMatch } from "@/config/styles";

/** A night as a list page and an event page both state it: title, date and every start. */
function nightKey(l: HarvestedListing): string {
  const { title, local_date, doors_time, lesson_time, dancing_time } = l.listing;
  return [title.trim().toLowerCase(), local_date, doors_time, lesson_time, dancing_time].join("|");
}

function hasTime(l: HarvestedListing): boolean {
  const { doors_time, lesson_time, dancing_time } = l.listing;
  return !!(doors_time || lesson_time || dancing_time);
}

/** Allevents.in list pages carry date-only Events with their own pages (Mumbai, 2026-10-31). */
export function dateOnlyEventLinks(blocks: unknown[], pageUrl: string): string[] {
  type Node = Record<string, unknown>;
  const isNode = (v: unknown): v is Node =>
    typeof v === "object" && v !== null && !Array.isArray(v);
  // Return [] if any ItemList is present.
  const hasItemList = (nodes: unknown[], depth: number): boolean => {
    if (depth > 6) return false;
    for (const node of nodes) {
      if (Array.isArray(node)) {
        if (hasItemList(node, depth + 1)) return true;
        continue;
      }
      if (!isNode(node)) continue;
      const type = node["@type"];
      const types = Array.isArray(type) ? type.map(String) : type != null ? [String(type)] : [];
      if (types.includes("ItemList")) return true;
      const graph = node["@graph"];
      if (Array.isArray(graph) && hasItemList(graph, depth + 1)) return true;
    }
    return false;
  };
  if (hasItemList(blocks, 0)) return [];

  const events = findEvents(blocks);
  const urls: string[] = [];
  for (const event of events) {
    const startDate = event.startDate;
    if (typeof startDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) continue;
    const rawUrl = event.url;
    if (typeof rawUrl !== "string") continue;
    let resolved: URL;
    try {
      resolved = new URL(rawUrl, pageUrl);
    } catch {
      continue;
    }
    if (!["http:", "https:"].includes(resolved.protocol)) continue;
    const url = resolved.href;
    if (!sameSite(url, pageUrl)) continue;
    urls.push(url);
  }
  // deduplicate, preserving first occurrence order
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const url of urls) {
    if (!seen.has(url)) {
      seen.add(url);
      deduped.push(url);
    }
  }
  return deduped;
}

/** The event pages a list page names: its ItemList's, then any Wix event pages it links. */
export function eventPageLinks(html: string, pageUrl: string): string[] {
  const { blocks } = extractJsonLd(html);
  const links = [
    ...itemListLinks(blocks, pageUrl),
    ...wixEventLinks(html, pageUrl),
    ...wixDatedEventLinks(html, pageUrl),
    ...xceedEventLinks(html, pageUrl),
    ...dateOnlyEventLinks(blocks, pageUrl),
  ];
  return [...new Set(links)].filter((link) => !sameLink(link, pageUrl));
}

// Xceed's city lists link ~45 nights (Barcelona, 2026-10-30), Fever's ~26: read them all, not the usual 25.
const XCEED_MAX_PAGES = 60;

export const jsonLdItemsAdapter: SourceAdapter = {
  id: "jsonld_items",
  tier: "A",
  limits: { perDomainIntervalMs: CRAWL_INTERVAL_MS },
  async harvest(source: Source, ctx: RunCtx): Promise<HarvestResult> {
    const url = source.feedUrl ?? source.url;
    const page = await ctx.http.request({
      url,
      purpose: "crawl",
      headers: { accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1" },
    });
    const pageUrl = page.url || url;
    const fromNight = currentNightDate(ctx.now(), ctx.metro.tz);
    const links = eventPageLinks(page.body, pageUrl);
    const { blocks } = extractJsonLd(page.body);
    const own =
      findEvents(blocks).length > 0
        ? jsonLdToListings(blocks, {
            pageUrl,
            fetchedAt: page.fetchedAt,
            metroTz: ctx.metro.tz,
            countryCode: ctx.metro.countryCode,
            fromNight,
            wallClock: source.wallClockTimes === true,
          })
        : { listings: [], notes: [] };
    if (links.length === 0 && own.listings.length === 0) {
      return { listings: [], readWithModel: "the page names no event pages and carries no event" };
    }
    const read = await readItemPages(
      links.map((link) => ({ url: link, night: null })),
      ctx,
      {
        fromNight,
        maxPages: isXceedHost(pageUrl) || isFeverHost(pageUrl) ? XCEED_MAX_PAGES : undefined,
        wallClock: source.wallClockTimes === true,
      },
    );
    // One night read both on the list and on its own page is one listing: the page's. The two give
    // it different ids (Salsa Vida, 2026-10-14), so the night itself is compared too.
    const fromPages = new Set(read.listings.map((l) => l.externalId));
    const pageNights = new Set(read.listings.map(nightKey));
    // Count list rows dropped by the new date-only rule
    let dateOnlyDropped = 0;
    const filteredOwn = own.listings.filter((listRow) => {
      // Existing conditions
      if (fromPages.has(listRow.externalId) || pageNights.has(nightKey(listRow))) {
        return false;
      }
      // New condition: drop date-only list row when its event page gives the night a time
      if (!hasTime(listRow)) {
        const sameDatePageRows = read.listings.filter(
          (pageRow) =>
            pageRow.listing.local_date === listRow.listing.local_date && hasTime(pageRow),
        );
        for (const pageRow of sameDatePageRows) {
          // Match by event URL
          if (
            listRow.eventUrl &&
            pageRow.eventUrl &&
            sameLink(listRow.eventUrl, pageRow.eventUrl)
          ) {
            dateOnlyDropped++;
            return false;
          }
          // Match by normalized title
          if (
            normalizeForMatch(listRow.listing.title.trim()) ===
            normalizeForMatch(pageRow.listing.title.trim())
          ) {
            dateOnlyDropped++;
            return false;
          }
        }
      }
      return true;
    });
    const listings = [...read.listings, ...filteredOwn].map((l) =>
      withSourceStyle(l, source.styles),
    );
    const notes = [`${links.length} event page(s) named; ${read.fetched} read`];
    if (dateOnlyDropped > 0) {
      notes.push(
        `${dateOnlyDropped} date-only list row(s) dropped for their event page's timed row`,
      );
    }
    return {
      listings,
      notes: [...notes, ...own.notes, ...read.notes],
      // Never whole: a weekly series' page gives only its next night, so the nights after it are
      // not read, and a whole read would take the model's correct rows for them off the site.
      doc: {
        url,
        fetchedAt: page.fetchedAt,
        httpStatus: page.status,
        etag: page.etag,
        lastModified: page.lastModified,
        contentHash: sha256(JSON.stringify(listings.map((l) => [l.externalId, l.listing]))),
        cleanedText: null,
      },
    };
  },
};
