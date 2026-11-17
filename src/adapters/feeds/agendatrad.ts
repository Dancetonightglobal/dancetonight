// AgendaTrad reader: Ile-de-France bals folk and fest-noz from agendatrad.org
// Reads https://agendatrad.org/calendar/France/Ile-de-France (server-rendered regional calendar).
// Each public bal folk / bal trad / fest-noz in the 14-night window becomes a dated listing,
// with the address read from the event's own AgendaTrad page.
// Permission: AgendaTrad via the owner, 2026-11-10; facts only, links back.
// Note: robots.txt currently disallows all; a separate task adds the waiver.
import { isoToLocal, sha256, decodeEntities, type LocalMoment } from "@/src/adapters/shared";
import { buildListing, inWindow, type StructuredEvent } from "@/src/adapters/structured";
import type {
  HarvestedListing,
  HarvestResult,
  RunCtx,
  Source,
  SourceAdapter,
} from "@/src/adapters/types";
import { currencyForCountry } from "@/src/domain/prices";
import { MATERIALIZE_DAYS } from "@/src/domain/recurrence";
import { currentNightDate } from "@/src/domain/tonight";
import { CRAWL_INTERVAL_MS } from "@/src/pipeline/http";
import { addCalendarDays } from "@/src/domain/time";
import { MAX_ITEM_PAGES } from "@/src/adapters/feeds/event-pages";

/** An event link resolved against agendatrad.org, kept only when it stays on agendatrad.org (page text is untrusted). */
export function agendatradEventUrl(href: string): string | null {
  try {
    const u = new URL(href, "https://agendatrad.org/");
    const onSite = u.hostname === "agendatrad.org" || u.hostname === "www.agendatrad.org";
    return onSite && (u.protocol === "https:" || u.protocol === "http:") ? u.href : null;
  } catch {
    return null;
  }
}

export interface AgendatradRow {
  id: string;
  /** The event's AgendaTrad page, or null when the row links off-site (never fetched then). */
  url: string | null;
  title: string;
  types: string[];
  city: string | null;
  dept: string | null;
  start: string | null; // "YYYY-MM-DDTHH:MM" local, from datetime attr
  endTime: string | null; // "HH:MM" from "de HH:MM à HH:MM"
  timeText: string | null; // decoded text inside <time> element
}

/**
 * Parse AgendaTrad list page HTML.
 * Returns rows in page order, de-duplicated by id+start (keep the first).
 */
export function parseAgendatradList(html: string): AgendatradRow[] {
  const rows: AgendatradRow[] = [];
  const seen = new Set<string>();

  // A row's own markup holds nested </div>s (the poster), so split on the row openers instead.
  const parts = html.split(/<div\s+class=event\s+id=event_/i).slice(1);
  for (const part of parts) {
    const id = part.match(/^([^>\s]+)/)?.[1] ?? "";
    const block = part;

    // Find link - href may be quoted or unquoted, and there may be extra attributes
    const linkMatch = block.match(
      /<a\s+class=event_title\s+href=(["']?)([^"'\s>]+)\1[^>]*>([^<]+)<\/a>/,
    );
    if (!linkMatch) continue;
    const href = linkMatch[2] ?? "";
    const rawTitle = linkMatch[3] ?? "";
    const title = decodeEntities(rawTitle).trim();
    const url = agendatradEventUrl(href);

    // Extract types
    const types: string[] = [];
    const typeRegex = /badge-event_types">([^<]+)</g;
    let typeMatch;
    while ((typeMatch = typeRegex.exec(block)) !== null) {
      const typeText = decodeEntities(typeMatch[1] ?? "").trim();
      if (typeText) types.push(typeText);
    }

    // Extract city and dept
    const cityMatch = block.match(/<p\s+class=event_city>([^<]+)<small>\((\d+)\)<\/small>/);
    let city: string | null = null;
    let dept: string | null = null;
    if (cityMatch) {
      city = decodeEntities(cityMatch[1] ?? "").trim();
      dept = cityMatch[2] ?? null;
    }

    // Extract start datetime
    const datetimeMatch = block.match(/datetime=(["']?)([^"'\s>]+)\1/);
    let start: string | null = null;
    if (datetimeMatch) {
      const dt = datetimeMatch[2] ?? "";
      // Take first 16 chars "YYYY-MM-DDTHH:MM"
      start = dt.slice(0, 16);
    }

    // Extract endTime from "de HH:MM à HH:MM"
    const timeTextMatch = block.match(/de\s+(\d{2}):(\d{2})\s+à\s+(\d{2}):(\d{2})/);
    let endTime: string | null = null;
    if (timeTextMatch) {
      const hour = timeTextMatch[3] ?? "";
      const minute = timeTextMatch[4] ?? "";
      endTime = `${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`;
    }

    // Extract timeText from <time> element
    const timeTagMatch = block.match(/<time[^>]*>([^<]+)<\/time>/);
    let timeText: string | null = null;
    if (timeTagMatch) {
      timeText = decodeEntities(timeTagMatch[1] ?? "").trim();
    }

    const key = `${id}:${start}`;
    if (seen.has(key)) continue;
    seen.add(key);

    rows.push({
      id,
      url,
      title,
      types,
      city,
      dept,
      start,
      endTime,
      timeText,
    });
  }
  return rows;
}

export interface AgendatradAddress {
  address: string | null;
  venueName: string | null;
  location: { lat: number; lng: number } | null;
}

/**
 * Parse event page for address, venue name, and location.
 */
export function parseAgendatradAddress(html: string): AgendatradAddress {
  // Find <address> block
  const addressMatch = html.match(/<address[^>]*>([\s\S]*?)<\/address>/);
  if (!addressMatch) {
    return { address: null, venueName: null, location: null };
  }
  const inner = addressMatch[1] ?? "";
  // Split by <br> tags
  const lines = inner
    .split(/<br\s*\/?>/)
    .map((line) => {
      // Strip tags, decode, trim
      const stripped = line.replace(/<[^>]+>/g, "");
      return decodeEntities(stripped).trim();
    })
    .filter((line) => line.length > 0 && line !== "France");

  if (lines.length === 0) {
    return { address: null, venueName: null, location: null };
  }

  // Find postcode line (5 digits)
  let postcodeLineIndex = -1;
  let postcodeLine = "";
  for (let i = 0; i < lines.length; i++) {
    if (/^\d{5}\b/.test(lines[i] ?? "")) {
      postcodeLineIndex = i;
      postcodeLine = lines[i] ?? "";
      break;
    }
  }

  // Street is first line if it's not the postcode line
  const street = postcodeLineIndex !== 0 ? (lines[0] ?? null) : null;

  // Venue name lines between street and postcode line
  let venueName: string | null = null;
  if (postcodeLineIndex > 1) {
    const venueLines = lines.slice(1, postcodeLineIndex);
    const joined = venueLines.join(", ");
    if (joined) venueName = joined;
  }

  // Build address
  let address: string | null = null;
  if (street && postcodeLine) {
    address = `${street}, ${postcodeLine}`;
  } else if (postcodeLine) {
    address = postcodeLine;
  } else if (street) {
    address = street;
  }

  // Extract location from OSM link
  let location: { lat: number; lng: number } | null = null;
  const osmMatch = html.match(/mlat=([\d.]+)[^&]*&[^&]*mlon=([\d.]+)/);
  if (osmMatch) {
    const lat = parseFloat(osmMatch[1] ?? "");
    const lng = parseFloat(osmMatch[2] ?? "");
    if (!isNaN(lat) && !isNaN(lng)) {
      location = { lat, lng };
    }
  }

  return { address, venueName, location };
}

export const agendatradAdapter: SourceAdapter = {
  id: "agendatrad",
  tier: "A",
  limits: { perDomainIntervalMs: CRAWL_INTERVAL_MS },
  async harvest(source: Source, ctx: RunCtx): Promise<HarvestResult> {
    const listUrl = source.feedUrl ?? source.url;
    const fromNight = currentNightDate(ctx.now(), ctx.metro.tz);
    const fallbackCurrency = currencyForCountry(ctx.metro.countryCode);

    // Helper to fetch a page
    const fetchPage = async (
      pageNum: number,
    ): Promise<{
      body: string;
      fetchedAt: Date;
      status: number;
      etag: string | null;
      lastModified: string | null;
    }> => {
      const url = pageNum === 1 ? listUrl : `${listUrl}?page=${pageNum}`;
      const resp = await ctx.http.request({
        url,
        purpose: "crawl",
        headers: { accept: "text/html" },
      });
      return {
        body: resp.body,
        fetchedAt: resp.fetchedAt,
        status: resp.status,
        etag: resp.etag,
        lastModified: resp.lastModified,
      };
    };

    const notes: string[] = [];
    const keptRows: AgendatradRow[] = [];
    let pageNum = 1;
    const maxPages = 3;
    let notBalCount = 0;
    let outsideCount = 0;
    let firstPageData: {
      fetchedAt: Date;
      status: number;
      etag: string | null;
      lastModified: string | null;
    } | null = null;

    while (pageNum <= maxPages) {
      let pageData: {
        body: string;
        fetchedAt: Date;
        status: number;
        etag: string | null;
        lastModified: string | null;
      };
      try {
        pageData = await fetchPage(pageNum);
      } catch (err) {
        if (pageNum === 1) {
          throw err;
        }
        notes.push(`page ${pageNum} failed: ${(err as Error).message}`);
        break;
      }
      if (pageNum === 1) {
        firstPageData = pageData;
      }

      const body = pageData.body;

      // Check for event rows
      if (!body.includes("<div class=event id=event_")) {
        if (pageNum === 1) {
          throw new Error("AgendaTrad calendar page had no event rows");
        }
        // Later page without rows is fine
        break;
      }

      const rows = parseAgendatradList(body);
      if (rows.length === 0) {
        if (pageNum === 1) {
          throw new Error("AgendaTrad calendar page had no event rows");
        }
        break;
      }

      // Filter rows
      for (const row of rows) {
        // Check types
        const isBal = row.types.some(
          (t) => t.includes("Bal trad / Bal folk") || t.includes("Fest-noz / Fest-deiz"),
        );
        if (!isBal) {
          notBalCount++;
          continue;
        }

        // Skip stage/atelier
        const lowerTitle = row.title.toLowerCase().trim();
        if (lowerTitle.startsWith("stage") || lowerTitle.startsWith("atelier")) {
          notBalCount++;
          continue;
        }

        // Check dept
        if (!row.dept || !["75", "77", "78", "91", "92", "93", "94", "95"].includes(row.dept)) {
          outsideCount++;
          continue;
        }

        // Check date window
        if (!row.start) continue;
        const date = row.start.slice(0, 10);
        if (!inWindow(date, fromNight, MATERIALIZE_DAYS)) {
          continue;
        }

        keptRows.push(row);
      }

      // Determine if we should fetch next page
      const lastRow = rows[rows.length - 1];
      const lastRowInWindow = lastRow?.start
        ? inWindow(lastRow.start.slice(0, 10), fromNight, MATERIALIZE_DAYS)
        : false;
      const hasNextPage = body.includes(`?page=${pageNum + 1}"`);
      if (lastRowInWindow && hasNextPage) {
        pageNum++;
      } else {
        break;
      }
    }

    // Add skip notes
    if (notBalCount > 0) notes.push(`${notBalCount} not a bal (stage/atelier/other type)`);
    if (outsideCount > 0) notes.push(`${outsideCount} outside Ile-de-France`);

    // Unchanged short-circuit
    const contentHash = sha256(JSON.stringify(keptRows));
    const doc = {
      url: listUrl,
      fetchedAt: firstPageData?.fetchedAt ?? ctx.now(),
      httpStatus: firstPageData?.status ?? 200,
      etag: firstPageData?.etag ?? null,
      lastModified: firstPageData?.lastModified ?? null,
      contentHash,
      cleanedText: null,
    };
    if (source.contentHash === contentHash) {
      return { listings: [], unchanged: true, doc };
    }

    // Fetch event pages
    const listings: HarvestedListing[] = [];
    let unreadPages = 0;
    let beyondCap = 0;

    let processed = 0;
    for (const row of keptRows) {
      processed++;
      let addressInfo: AgendatradAddress = { address: null, venueName: null, location: null };
      if (processed > MAX_ITEM_PAGES) {
        // Over the cap: listed with the town as its address, page not read.
        beyondCap++;
      } else if (row.url) {
        try {
          const resp = await ctx.http.request({
            url: row.url,
            purpose: "crawl",
            headers: { accept: "text/html" },
          });
          addressInfo = parseAgendatradAddress(resp.body);
        } catch {
          // An unread event page leaves the town as the address (counted below).
        }
        if (!addressInfo.address) unreadPages++;
      } else {
        unreadPages++; // off-site link: no page read
      }

      if (!addressInfo.address && row.city) {
        addressInfo.address = row.dept ? `${row.city} (${row.dept})` : row.city;
      }

      const startDateTime = row.start;
      if (!startDateTime) continue;
      const start = isoToLocal(startDateTime, ctx.metro.tz);
      if (!start) continue;

      let end: LocalMoment | null = null;
      if (row.endTime) {
        const startTime = startDateTime.slice(11, 16); // "HH:MM"
        const endDate =
          row.endTime <= startTime
            ? addCalendarDays(startDateTime.slice(0, 10), 1)
            : startDateTime.slice(0, 10);
        const endDateTime = `${endDate}T${row.endTime}`;
        end = isoToLocal(endDateTime, ctx.metro.tz);
      }

      const evidence: Record<string, string> = {};
      if (row.timeText) {
        evidence.start = row.timeText.slice(0, 300);
      }
      if (addressInfo.address) {
        evidence.venue_address = addressInfo.address.slice(0, 300);
      }

      const externalId = `agendatrad:${row.id}:${startDateTime.slice(0, 10)}`;

      const structuredEvent: StructuredEvent = {
        externalId,
        title: row.title,
        start,
        end,
        description: null,
        venue: {
          name: addressInfo.venueName,
          address: addressInfo.address,
          url: null,
          location: addressInfo.location,
        },
        organizer: { name: null, url: null },
        prices: null,
        ticketUrl: null,
        eventUrl: row.url ?? listUrl,
        cancelled: false,
        styles: ["folk"],
        evidence,
      };

      listings.push(
        buildListing(structuredEvent, {
          sourceUrl: listUrl,
          fetchedAt: firstPageData?.fetchedAt ?? ctx.now(),
          method: "api",
          currency: fallbackCurrency,
        }),
      );
    }

    if (unreadPages > 0) {
      notes.push(`${unreadPages} event page(s) unread: address is the town`);
    }
    if (beyondCap > 0) {
      notes.push(`${beyondCap} bal(s) beyond the event-page cap: address is the town`);
    }

    return { listings, notes, doc };
  },
};
