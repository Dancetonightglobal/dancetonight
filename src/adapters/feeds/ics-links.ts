// D-873: read a page that links one .ics file per event (Traumtänzer Berlin)
// The page acts as an index: each on-site .ics link is fetched and read as a calendar.

import { sha256 } from "@/src/adapters/shared";
import { icsToListings, parseIcs } from "@/src/adapters/feeds/ics";
import { currentNightDate } from "@/src/domain/tonight";
import { MATERIALIZE_DAYS } from "@/src/domain/recurrence";
import { CRAWL_INTERVAL_MS } from "@/src/pipeline/http";
import type {
  HarvestResult,
  HarvestedListing,
  RunCtx,
  Source,
  SourceAdapter,
} from "@/src/adapters/types";

export const MAX_ICS_LINKS = 60;

/**
 * Find every on-site .ics link in the HTML.
 * Returns absolute URLs, unique, in first-seen order, capped at MAX_ICS_LINKS.
 */
export function icsLinksOn(html: string, pageUrl: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  let pageHostNoWww: string;
  try {
    pageHostNoWww = new URL(pageUrl).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return [];
  }

  // Regular expression to match href attributes
  const hrefRegex = /href\s*=\s*(["'])(.*?)\1/gi;
  let match;
  while ((match = hrefRegex.exec(html)) !== null) {
    if (result.length >= MAX_ICS_LINKS) break;

    const rawHref = match[2] ?? "";
    // Decode HTML entities (e.g., &amp; to &)
    const decodedHref = rawHref.replace(/&amp;/g, "&");

    let resolvedUrl: URL;
    try {
      resolvedUrl = new URL(decodedHref, pageUrl);
    } catch {
      continue; // skip invalid URL
    }

    // Keep only http/https
    if (!(resolvedUrl.protocol === "http:" || resolvedUrl.protocol === "https:")) {
      continue;
    }

    // Hostname comparison: case-insensitive, allow www. prefix difference
    const linkHostNoWww = resolvedUrl.hostname.toLowerCase().replace(/^www\./, "");
    if (pageHostNoWww !== linkHostNoWww) {
      continue;
    }

    // Path must contain ".ics" (case-insensitive)
    if (!resolvedUrl.pathname.toLowerCase().includes(".ics")) {
      continue;
    }

    // Remove fragment
    resolvedUrl.hash = "";
    const finalUrl = resolvedUrl.toString();

    if (!seen.has(finalUrl)) {
      seen.add(finalUrl);
      result.push(finalUrl);
    }
  }

  return result;
}

export const icsLinksAdapter: SourceAdapter = {
  id: "ics_links",
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

    const links = icsLinksOn(page.body, pageUrl);
    if (links.length === 0) {
      throw new Error("the page shows no calendar links");
    }

    const fromNight = currentNightDate(ctx.now(), ctx.metro.tz);
    const allListings: HarvestedListing[] = [];
    const seenIds = new Set<string>();
    const notes: string[] = [];
    let failedCount = 0;

    for (const link of links) {
      try {
        const response = await ctx.http.request({
          url: link,
          purpose: "crawl",
          headers: { accept: "text/calendar, text/plain;q=0.8, */*;q=0.1" },
        });

        if (response.status >= 400) {
          throw new Error(`HTTP ${response.status}`);
        }

        if (!/BEGIN:VCALENDAR/i.test(response.body)) {
          throw new Error("not an iCalendar file");
        }

        const calendar = parseIcs(response.body);
        const { listings, notes: icsNotes } = icsToListings(calendar, {
          sourceUrl: source.url,
          fetchedAt: response.fetchedAt,
          metroTz: ctx.metro.tz,
          countryCode: ctx.metro.countryCode,
          fromNight,
          days: MATERIALIZE_DAYS,
          ownLabel: null,
        });

        // Deduplicate by externalId (first wins); a listing with no id is kept
        for (const listing of listings) {
          const id = listing.externalId;
          if (id === null || !seenIds.has(id)) {
            if (id !== null) seenIds.add(id);
            allListings.push(listing);
          }
        }

        if (icsNotes.length > 0) {
          notes.push(...icsNotes);
        }
      } catch {
        failedCount++;
      }
    }

    if (failedCount === links.length) {
      throw new Error(`none of ${links.length} calendar link(s) could be read`);
    }

    if (failedCount > 0) {
      notes.push(`${failedCount} of ${links.length} calendar link(s) could not be read`);
    }

    const doc = {
      url,
      fetchedAt: page.fetchedAt,
      httpStatus: page.status,
      etag: page.etag,
      lastModified: page.lastModified,
      contentHash: sha256(JSON.stringify(allListings.map((l) => [l.externalId, l.listing]))),
      cleanedText: null,
    };

    const result: HarvestResult = {
      listings: allListings,
      notes,
      doc,
    };

    return result;
  },
};
