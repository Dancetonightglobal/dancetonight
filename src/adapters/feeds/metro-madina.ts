// Metro al Madina reader: Midnight Metro party nights (Beirut, D-1003)
// Metro al Madina, a venue in Hamra, Beirut, runs "Midnight Metro" dance parties about once a week
// on a calendar that is otherwise concerts, cabaret and stand-up. Its WordPress site has no JSON-LD,
// so the existing `jsonld_items` / `readItemPages` path cannot read it. This reader takes the cards
// on https://metromadina.com/events, keeps the window's `party` cards, reads each kept card's own page,
// and builds one listing per party night with `buildListing` (no model).

import { decodeEntities, isoToLocal, sha256 } from "@/src/adapters/shared";
import { buildListing, type StructuredEvent } from "@/src/adapters/structured";
import { isStyleKey } from "@/config/styles";
import { currencyForCountry } from "@/src/domain/prices";
import { addCalendarDays } from "@/src/domain/time";
import { currentNightDate } from "@/src/domain/tonight";
import { MATERIALIZE_DAYS } from "@/src/domain/recurrence";
import { CRAWL_INTERVAL_MS } from "@/src/pipeline/http";
import { MAX_ITEM_PAGES } from "@/src/adapters/feeds/event-pages";
import type {
  HarvestResult,
  HarvestedListing,
  RunCtx,
  Source,
  SourceAdapter,
} from "@/src/adapters/types";

export interface MetroMadinaCard {
  url: string;
  title: string;
  category: string;
  day: string | null;
}

export function metroMadinaCards(html: string, pageUrl: string): MetroMadinaCard[] {
  const cards: MetroMadinaCard[] = [];
  const seenUrls = new Set<string>();

  // Each card is one <div class="tab-col" ...> block, ending before the next card or the list's closing divs.
  const cardRegex =
    /<div\s+[^>]*class\s*=\s*["'][^"']*tab-col[^"']*["'][^>]*>([\s\S]*?)<\/div>\s*(?=<div\s+class\s*=\s*["'][^"']*tab-col|<\/div>\s*<\/div>)/gi;

  let cardMatch;
  while ((cardMatch = cardRegex.exec(html)) !== null) {
    const cardContent = cardMatch[0]; // The entire matched div

    // Extract data-cat
    const catMatch = cardContent.match(/data-cat\s*=\s*(["'])([^"']*)\1/i);
    const category = catMatch?.[2]?.toLowerCase() ?? "";

    // Extract data-date
    const dateMatch = cardContent.match(/data-date\s*=\s*(["'])(\d{4}-\d{2}-\d{2})\1/i);
    const day = dateMatch?.[2] ?? null;

    // Extract href from the first <a> with class containing "event-details"
    const hrefMatch = cardContent.match(
      /<a\s+[^>]*class\s*=\s*["'][^"']*event-details[^"']*["'][^>]*href\s*=\s*(["'])([^"']*)\1/i,
    );
    let url = "";
    if (hrefMatch) {
      try {
        url = new URL(hrefMatch[2] ?? "", pageUrl).toString();
      } catch {
        continue;
      }
    } else {
      // Try any href in the card
      const anyHrefMatch = cardContent.match(/<a\s+[^>]*href\s*=\s*(["'])([^"']*)\1/i);
      if (anyHrefMatch) {
        try {
          url = new URL(anyHrefMatch[2] ?? "", pageUrl).toString();
        } catch {
          continue;
        }
      } else {
        continue;
      }
    }

    // Skip non-http(s) URLs
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      continue;
    }

    // Extract title from span with class "title"
    const titleMatch = cardContent.match(
      /<span\s+[^>]*class\s*=\s*["'][^"']*title[^"']*["'][^>]*>([^<]*)<\/span>/i,
    );
    let title = "";
    if (titleMatch) {
      title = decodeEntities(titleMatch[1] ?? "")
        .replace(/\s+/g, " ")
        .trim();
    } else {
      continue;
    }

    // Skip cards without title
    if (!title) {
      continue;
    }

    // Keep only first occurrence of each URL
    if (seenUrls.has(url)) {
      continue;
    }
    seenUrls.add(url);

    cards.push({
      url,
      title,
      category,
      day,
    });
  }

  return cards;
}

export interface MetroMadinaPage {
  title: string | null;
  category: string | null;
  day: string | null;
  doors: string | null;
}

export function metroMadinaPage(html: string): MetroMadinaPage {
  // Extract title from h1.mem-hero-title
  const titleMatch = html.match(
    /<h1\s+[^>]*class\s*=\s*["'][^"']*mem-hero-title[^"']*["'][^>]*>([^<]*)<\/h1>/i,
  );
  const title = titleMatch ? decodeEntities(titleMatch[1] ?? "").trim() : null;

  // Extract category from span.mem-meta-category
  const categoryMatch = html.match(
    /<span\s+[^>]*class\s*=\s*["'][^"']*mem-meta-category[^"']*["'][^>]*>([^<]*)<\/span>/i,
  );
  const category = categoryMatch ? (categoryMatch[1]?.trim() ?? null) : null;

  // Extract day from span.mem-meta-dates
  let day: string | null = null;
  const datesMatch = html.match(
    /<span\s+[^>]*class\s*=\s*["'][^"']*mem-meta-dates[^"']*["'][^>]*>([^<]*)<\/span>/i,
  );
  if (datesMatch) {
    const datesText = datesMatch[1] ?? "";
    // Replace &nbsp; with space
    const cleaned = datesText.replace(/&nbsp;/g, " ");
    // Look for pattern: Weekday, DD Mon YYYY
    // First, try to find a date pattern after "From:" or the first date
    const datePattern =
      /\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*,?\s+(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{4})\b/i;
    const matches = cleaned.match(datePattern);
    if (matches) {
      // Take the first match
      const dayNum = matches[1]!.padStart(2, "0");
      const monthAbbr = matches[2]!.substring(0, 3).toLowerCase();
      const year = matches[3]!;
      const monthMap: Record<string, string> = {
        jan: "01",
        feb: "02",
        mar: "03",
        apr: "04",
        may: "05",
        jun: "06",
        jul: "07",
        aug: "08",
        sep: "09",
        oct: "10",
        nov: "11",
        dec: "12",
      };
      const monthNum = monthMap[monthAbbr];
      if (monthNum) {
        day = `${year}-${monthNum}-${dayNum}`;
      }
    }
  }

  // Extract doors time from "Doors Open: <b>H:MM AM|PM</b>" or "Show Starts: <b>H:MM AM|PM</b>"
  let doors: string | null = null;
  const doorsMatch = html.match(/Doors Open:\s*<b>([^<]+)<\/b>/i);
  const showMatch = html.match(/Show Starts:\s*<b>([^<]+)<\/b>/i);
  const timeText = (doorsMatch?.[1] ?? showMatch?.[1] ?? "").trim();
  if (timeText) {
    // Parse time like "11:30 PM" or "1:00 AM"
    const timePattern = /(\d{1,2}):(\d{2})\s*(AM|PM)/i;
    const timeMatch = timeText.match(timePattern);
    if (timeMatch) {
      let hour = parseInt(timeMatch[1]!, 10);
      const minute = timeMatch[2]!;
      const period = timeMatch[3]!.toUpperCase();
      if (period === "PM" && hour !== 12) {
        hour += 12;
      } else if (period === "AM" && hour === 12) {
        hour = 0;
      }
      doors = `${hour.toString().padStart(2, "0")}:${minute}`;
    }
  }

  return {
    title,
    category,
    day,
    doors,
  };
}

export const metroMadinaAdapter: SourceAdapter = {
  id: "metro_madina",
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
    const cards = metroMadinaCards(page.body, pageUrl);
    if (cards.length === 0) {
      throw new Error("Metro al Madina's events page shows no cards");
    }

    const tz = ctx.metro.tz;
    const fromNight = currentNightDate(ctx.now(), tz);
    const lastNight = addCalendarDays(fromNight, MATERIALIZE_DAYS - 1);

    // Filter cards: must be party, within window, and on metromadina.com
    const kept = cards.filter((card) => {
      if (card.category !== "party") return false;
      if (!card.day) return false;
      if (card.day < fromNight || card.day > lastNight) return false;
      try {
        const urlObj = new URL(card.url);
        const hostname = urlObj.hostname.toLowerCase();
        if (!(hostname === "metromadina.com" || hostname === "www.metromadina.com")) {
          return false;
        }
      } catch {
        return false;
      }
      return true;
    });

    // Sort by day (earliest first) and cap at MAX_ITEM_PAGES
    const sorted = [...kept].sort((a, b) => (a.day ?? "").localeCompare(b.day ?? ""));
    const reading = sorted.slice(0, MAX_ITEM_PAGES);

    const notes: string[] = [];
    const listings: HarvestedListing[] = [];
    let whole = true;
    if (sorted.length > reading.length) {
      // A capped read must not retire the nights it did not read.
      whole = false;
      notes.push(
        `${sorted.length - reading.length} party night(s) past the ${MAX_ITEM_PAGES}-page cap not read`,
      );
    }

    for (const card of reading) {
      let pageData: MetroMadinaPage;
      let fetchedAt: Date;
      try {
        const eventPage = await ctx.http.request({
          url: card.url,
          purpose: "crawl",
          headers: { accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1" },
        });
        fetchedAt = eventPage.fetchedAt;
        if (eventPage.status < 200 || eventPage.status >= 300) {
          throw new Error(`HTTP ${eventPage.status}`);
        }
        pageData = metroMadinaPage(eventPage.body);
      } catch (error) {
        whole = false;
        notes.push(`${card.url}: ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }

      // Drop if category is set and not Party (case-insensitive)
      if (pageData.category && pageData.category.toLowerCase() !== "party") {
        notes.push(`${card.url}: page category "${pageData.category}" is not Party`);
        continue;
      }

      // Determine night: page's day, else card's day
      const night = pageData.day ?? card.day;
      if (!night) {
        notes.push(`${card.url}: no date found`);
        continue;
      }
      if (night < fromNight || night > lastNight) {
        notes.push(`${card.url}: night ${night} outside window`);
        continue;
      }

      // Check doors time
      if (!pageData.doors) {
        notes.push(`${card.url}: no doors time`);
        continue;
      }

      // Adjust date if doors time is before 06:00 (next calendar date)
      let adjustedNight = night;
      const doorsHour = Number(pageData.doors.slice(0, 2));
      if (doorsHour < 6) {
        // Move to next day
        adjustedNight = addCalendarDays(night, 1);
      }

      // Build start time
      const start = isoToLocal(`${adjustedNight}T${pageData.doors}:00`, tz);
      if (!start) {
        notes.push(`${card.url}: could not parse start time`);
        continue;
      }

      const externalId = `metro_madina:${card.url}:${night}`;
      const title = pageData.title ?? card.title;

      const structured: StructuredEvent = {
        externalId,
        title,
        start,
        end: null,
        description: null,
        venue: {
          name: "Metro al Madina",
          // From the venue's own contact page, metromadina.com/contact-us (2026-11-06): "Aresco Center, -1,
          // Justinian street, Clemenceau, Hamra, Beirut" (Metro left the Saroulla Building on Hamra Street).
          address: "Aresco Center, Justinian Street, Clemenceau, Hamra, Beirut",
          url: "https://metromadina.com",
          location: null,
        },
        organizer: { name: "Metro al Madina", url: "https://metromadina.com" },
        prices: null,
        ticketUrl: null,
        eventUrl: card.url,
        cancelled: false,
        styles: source.styles.filter(isStyleKey),
        // A DJ dance party: "party" is not a ListingType; "club_night" is the closest.
        type: "club_night",
      };

      const currency = currencyForCountry(ctx.metro.countryCode);
      const built = buildListing(structured, {
        sourceUrl: card.url,
        fetchedAt,
        method: "feed",
        currency,
      });

      listings.push(built);
    }

    notes.unshift(`${kept.length} party night(s) in the window of ${cards.length} listed`);

    const doc = {
      url,
      fetchedAt: page.fetchedAt,
      httpStatus: page.status,
      etag: page.etag,
      lastModified: page.lastModified,
      contentHash: sha256(JSON.stringify(listings.map((l) => [l.externalId, l.listing]))),
      cleanedText: null,
    };

    const result: HarvestResult = {
      listings,
      notes,
      doc,
    };

    if (whole) {
      result.whole = true;
    }

    return result;
  },
};
