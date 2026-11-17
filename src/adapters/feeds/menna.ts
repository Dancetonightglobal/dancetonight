// menna's SWANA calendar: Arab, Persian, Turkish and Armenian parties among concerts, films, talks
// and classes. The page lists about 160 cards; about 10 in a two-week window are parties, 7 of
// those on no source we read. Each card is an `<article class="event-card">` with data attributes;
// each event's own page carries one schema.org Event, read by `readItemPages`.
// Only the window's Party and Dance cards are kept, and only their pages are read.

import { readItemPages, withSourceStyle } from "@/src/adapters/feeds/event-pages";
import { decodeEntities, sha256 } from "@/src/adapters/shared";
import type {
  HarvestResult,
  HarvestedListing,
  RunCtx,
  Source,
  SourceAdapter,
} from "@/src/adapters/types";
import { currentNightDate } from "@/src/domain/tonight";
import { CRAWL_INTERVAL_MS } from "@/src/pipeline/http";
import { MATERIALIZE_DAYS } from "@/src/domain/recurrence";
import { addCalendarDays } from "@/src/domain/time";

export interface MennaCard {
  url: string;
  title: string;
  categories: string[];
  day: string | null;
  endDay: string | null;
}

/** Extract event cards from menna's events page HTML. */
export function mennaCards(html: string, pageUrl: string): MennaCard[] {
  const cards: MennaCard[] = [];
  const seenUrls = new Set<string>();

  // Find all article elements with class containing "event-card"
  // The card's facts are attributes of its <article> tag; its link and title are inside it.
  const articleRegex = /(<article[^>]*class="[^"]*event-card[^"]*"[^>]*>)([\s\S]*?)<\/article>/gi;
  let articleMatch;

  while ((articleMatch = articleRegex.exec(html)) !== null) {
    const cardTag = articleMatch[1] ?? "";
    const cardContent = articleMatch[2] ?? "";

    // Extract data-categories - handle both single and double quotes
    const categoriesMatch = cardTag.match(/data-categories\s*=\s*(["'])(.*?)\1/);
    const categories = categoriesMatch
      ? (categoriesMatch[2] ?? "")
          .split(",")
          .map((c) => c.trim())
          .filter((c) => c.length > 0)
      : [];

    // Extract dates - handle both single and double quotes
    const dateMatch = cardTag.match(/data-date-iso\s*=\s*(["'])(\d{4}-\d{2}-\d{2})\1/);
    const day = dateMatch?.[2] ?? null;
    const endDateMatch = cardTag.match(/data-date-end-iso\s*=\s*(["'])(\d{4}-\d{2}-\d{2})\1/);
    const endDay = endDateMatch?.[2] ?? null;

    // Extract href from the first <a> with class containing "event-card-link"
    // Look for href attribute in any <a> tag that has class containing event-card-link
    // Handle both single and double quotes for href
    const hrefMatch = cardContent.match(
      /<a[^>]*class\s*=\s*["'][^"']*event-card-link[^"']*["'][^>]*href\s*=\s*(["'])([^"']*)\1/i,
    );
    let url = "";
    if (hrefMatch) {
      try {
        url = new URL(hrefMatch[2] ?? "", pageUrl).toString();
      } catch {
        // Invalid URL, skip this card
        continue;
      }
    } else {
      // Try a more general approach: find any href in the card
      const anyHrefMatch = cardContent.match(/<a[^>]*href\s*=\s*(["'])([^"']*)\1/i);
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

    // Extract title from event-title element - handle both single and double quotes
    const titleMatch = cardContent.match(
      /<h3[^>]*class\s*=\s*["'][^"']*event-title[^"']*["'][^>]*>([^<]*)<\/h3>/i,
    );
    let title = "";
    if (titleMatch) {
      title = decodeEntities(titleMatch[1] ?? "")
        .replace(/\s+/g, " ")
        .trim();
    } else {
      // Try to find any h3 in the card
      const h3Match = cardContent.match(/<h3[^>]*>([^<]*)<\/h3>/i);
      if (h3Match) {
        title = decodeEntities(h3Match[1] ?? "")
          .replace(/\s+/g, " ")
          .trim();
      }
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
      categories,
      day,
      endDay,
    });
  }

  return cards;
}

/** menna tags that make a "Party" card a fair, market or match, not a dance night (D-779). */
const NOT_A_NIGHT_TAGS = new Set([
  "Food",
  "Shopping",
  "Sport",
  "Wellness",
  "Kids",
  "Fashion",
  "Art",
  "Sustainability",
]);

export const mennaAdapter: SourceAdapter = {
  id: "menna",
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
    const cards = mennaCards(page.body, pageUrl);
    if (cards.length === 0) {
      throw new Error("menna's page shows no event cards");
    }

    const fromNight = currentNightDate(ctx.now(), ctx.metro.tz);
    const lastNight = addCalendarDays(fromNight, MATERIALIZE_DAYS - 1);

    const kept = cards.filter((card) => {
      // Must have Party or Dance category. menna also tags food fairs, markets and sports "Party" (D-779: "NYC Halal
      // Fest 2026", Food,Community,Party, 11-07): a Party card with one of those tags and no Music is not a night.
      const fair =
        card.categories.some((c) => NOT_A_NIGHT_TAGS.has(c)) && !card.categories.includes("Music");
      const hasPartyOrDance =
        (card.categories.includes("Party") && !fair) || card.categories.includes("Dance");
      // Must not have Literature category
      const hasLiterature = card.categories.includes("Literature");
      // Must have a day
      if (!card.day) return false;
      // Check window: day <= lastNight AND (endDay ?? day) >= fromNight
      const end = card.endDay ?? card.day;
      return hasPartyOrDance && !hasLiterature && card.day <= lastNight && end >= fromNight;
    });

    const read = await readItemPages(
      kept.map((c) => ({ url: c.url, night: c.day, endDay: c.endDay })),
      ctx,
      { fromNight },
    );

    const listings: HarvestedListing[] = read.listings.map((l) =>
      withSourceStyle(l, source.styles),
    );

    const notes = [
      `${kept.length} party or dance night(s) in the window of ${cards.length} listed`,
      ...read.notes,
    ];

    const result: HarvestResult = {
      listings,
      notes,
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

    if (read.whole) {
      result.whole = true;
    }

    return result;
  },
};
