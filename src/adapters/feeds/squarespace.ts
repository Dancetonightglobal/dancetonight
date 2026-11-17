// Squarespace events pages (D-111): the `squarespace` adapter, rewritten under its old id because
// stored rows already carry that platform.
//
// Squarespace's robots.txt disallows `/*?format=json` and `?format=ical` for every crawler, so the
// adapter reads the events page itself, as a browser shows it. Its upcoming list
// (`<article class="eventlist-event eventlist-event--upcoming">`) dates each item
// (`<time class="event-date" datetime="YYYY-MM-DD">`), and each item's own page carries a
// schema.org Event in JSON-LD with its zone, place and offers. The adapter follows the items in
// the window (src/adapters/feeds/event-pages.ts) and, where an item page cannot be read or names
// no Event, takes what the list itself says: title, night, the times it prints, the place.
//
// A page with no events list at all is not this adapter's: it answers `readWithModel`, and the
// ingest reads the page with the model instead. It never returns no listings in place of a read.

import { matchStyles, type StyleKey } from "@/config/styles";
import {
  readItemPages,
  sameSite,
  withSourceStyle,
  type ItemLink,
} from "@/src/adapters/feeds/event-pages";
import { decodeEntities, httpUrl, isoToLocal, plainText, sha256 } from "@/src/adapters/shared";
import { buildListing } from "@/src/adapters/structured";
import type {
  HarvestedListing,
  HarvestResult,
  RunCtx,
  Source,
  SourceAdapter,
} from "@/src/adapters/types";
import { currencyForCountry } from "@/src/domain/prices";
import { addCalendarDays } from "@/src/domain/time";
import { currentNightDate } from "@/src/domain/tonight";
import { CRAWL_INTERVAL_MS } from "@/src/pipeline/http";

/** One upcoming item as the events page lists it. */
export interface ListedItem extends ItemLink {
  title: string;
  /** The last day of a span, when the list gives two dates. */
  endDay: string | null;
  /** Local clock times the list prints, 24-hour "HH:MM", or null. */
  startTime: string | null;
  endTime: string | null;
  /** The place line: a venue name, and the address its map link asks for. */
  venueName: string | null;
  address: string | null;
  categories: string[];
}

const UPCOMING =
  /<article\b[^>]*class="[^"]*\beventlist-event--upcoming\b[^"]*"[^>]*>([\s\S]*?)<\/article>/gi;

/** "8:30 PM", "8:30 p.m.", "8:30 PM", "20:30" as "HH:MM"; null when it is none of them. */
export function clock(text: string): string | null {
  const m = /^\s*(\d{1,2}):(\d{2})\s*(?:([ap])\.?\s*m\.?)?\s*$/i.exec(text.replace(/[  ]/g, " "));
  if (!m) return null;
  let hour = Number(m[1]);
  const minute = Number(m[2]);
  const half = m[3]?.toLowerCase();
  if (minute > 59 || hour > 23 || (half && (hour < 1 || hour > 12))) return null;
  if (half === "p" && hour < 12) hour += 12;
  if (half === "a" && hour === 12) hour = 0;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

const inner = (html: string, cls: string): string | null => {
  const m = new RegExp(
    `<[a-z0-9]+\\b[^>]*class="[^"]*\\b${cls}\\b[^"]*"[^>]*>([\\s\\S]*?)<\\/`,
    "i",
  ).exec(html);
  return m ? (plainText(decodeEntities(m[1] ?? "")) ?? null) : null;
};

/**
 * Whether the page is a Squarespace events list at all: its upcoming or past list is there, even
 * empty. A page without one is read with the model.
 */
export function isEventsList(html: string): boolean {
  return (
    /class="[^"]*\beventlist\b[^"]*\beventlist--(?:upcoming|past)\b/i.test(html) ||
    /class="[^"]*\beventlist-event\b/i.test(html)
  );
}

/** The upcoming items an events page lists, in its order. */
export function listedItems(html: string, pageUrl: string): ListedItem[] {
  const items: ListedItem[] = [];
  for (const m of html.matchAll(UPCOMING)) {
    const block = m[1] ?? "";
    const link =
      /<a\b[^>]*href="([^"]+)"[^>]*class="[^"]*\beventlist-title-link\b/i.exec(block) ??
      /class="[^"]*\beventlist-title-link\b[^"]*"[^>]*href="([^"]+)"/i.exec(block);
    const url = link ? httpUrl(decodeEntities(link[1] ?? ""), pageUrl) : null;
    const title = inner(block, "eventlist-title-link");
    if (!url || !title || !sameSite(url, pageUrl)) continue;
    const days = [
      ...block.matchAll(
        /<time\b[^>]*class="[^"]*\bevent-date\b[^"]*"[^>]*datetime="(\d{4}-\d{2}-\d{2})"/gi,
      ),
    ].map((d) => d[1]!);
    // A night that runs past midnight prints its start and end as two plain 12-hour times, each
    // with its own date: "11:01 PM" on the 29th, "2:01 AM" on the 30th.
    const overnight = [
      ...block.matchAll(/<time\b[^>]*class="event-time-12hr"[^>]*>([^<]+)<\/time>/gi),
    ].map((t) => t[1]);
    // Start time: try localized, then 12hr-start, then 24hr-start
    const startMatch =
      /class="[^"]*\bevent-time-localized-start\b[^"]*"[^>]*>([^<]+)</i.exec(block)?.[1] ??
      /class="[^"]*\bevent-time-localized\b[^"]*"[^>]*>\s*([^<]+)</i.exec(block)?.[1] ??
      /<time\b[^>]*class="[^"]*\bevent-time-12hr-start\b[^"]*"[^>]*>([^<]+)<\//i.exec(block)?.[1] ??
      /<time\b[^>]*class="[^"]*\bevent-time-24hr-start\b[^"]*"[^>]*>([^<]+)<\//i.exec(block)?.[1] ??
      overnight[0];
    const startRaw = startMatch ? decodeEntities(startMatch) : null;
    // End time: try localized-end, then 12hr-end, then 24hr-end
    const endMatch =
      /class="[^"]*\bevent-time-localized-end\b[^"]*"[^>]*>([^<]+)</i.exec(block)?.[1] ??
      /<time\b[^>]*class="[^"]*\bevent-time-12hr-end\b[^"]*"[^>]*>([^<]+)<\//i.exec(block)?.[1] ??
      /<time\b[^>]*class="[^"]*\bevent-time-24hr-end\b[^"]*"[^>]*>([^<]+)<\//i.exec(block)?.[1] ??
      overnight[1];
    const endRaw = endMatch ? decodeEntities(endMatch) : null;
    const addressBlock =
      /<li\b[^>]*class="[^"]*\beventlist-meta-address\b[^"]*"[^>]*>([\s\S]*?)<\/li>/i.exec(
        block,
      )?.[1] ?? "";
    const venueName = plainText(
      decodeEntities(addressBlock.replace(/<a\b[\s\S]*$/i, "").replace(/<[^>]+>/g, " ")),
    );
    const mapQuery = /href="https?:\/\/maps\.google\.com\/?\?q=([^"]+)"/i.exec(addressBlock)?.[1];
    let address: string | null = null;
    if (mapQuery) {
      try {
        address = plainText(decodeURIComponent(decodeEntities(mapQuery).replace(/\+/g, " ")));
      } catch {
        address = plainText(decodeEntities(mapQuery));
      }
    }
    const categories = [
      ...(
        /class="[^"]*\beventlist-cats\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i.exec(block)?.[1] ?? ""
      ).matchAll(/>([^<]+)<\/a>/g),
    ]
      .map((c) => plainText(decodeEntities(c[1] ?? "")))
      .filter((c): c is string => !!c);
    items.push({
      url,
      night: days[0] ?? null,
      endDay: days.length > 1 ? days[days.length - 1]! : null,
      title,
      startTime: startRaw ? clock(startRaw) : null,
      endTime: endRaw ? clock(endRaw) : null,
      venueName,
      address,
      categories,
    });
  }
  return items;
}

/** A listing from the list's own fields, for an item whose page names no Event. */
export function listedToListing(
  item: ListedItem,
  options: { fetchedAt: Date; zone: string; countryCode: string },
): HarvestedListing | null {
  if (!item.night) return null;
  // Wall-clock text in the site's zone; a start before 6am belongs to the night before (D-004).
  const start = isoToLocal(
    item.startTime ? `${item.night}T${item.startTime}` : item.night,
    options.zone,
  );
  if (!start) return null;
  // An end earlier on the clock than the start is after midnight: 8pm to 1am.
  const endDay =
    item.endTime && item.startTime && item.endTime <= item.startTime
      ? addCalendarDays(item.night, 1)
      : item.night;
  const end = item.endTime ? isoToLocal(`${endDay}T${item.endTime}`, options.zone) : null;
  const styles: StyleKey[] =
    item.categories.length > 0 ? matchStyles(item.categories.join(", ")).styles : [];
  const evidence: Record<string, string> = {
    start: `listed ${item.night}${item.startTime ? ` ${item.startTime}` : ""}`,
  };
  if (styles.length > 0) evidence.styles = `categories ${item.categories.join(", ")}`.slice(0, 300);
  return buildListing(
    {
      externalId: `${item.url}#${item.night}`,
      title: item.title,
      start,
      // An end on a later night is a span, not an end time; a list that dates an after-midnight
      // end on the next day ("2:01 AM" on the 30th) is still the same night.
      end:
        end &&
        end.night === start.night &&
        (!item.endDay || item.endDay === addCalendarDays(item.night, 1))
          ? end
          : null,
      description: null,
      venue: { name: item.venueName, address: item.address, url: null, location: null },
      organizer: { name: null, url: null },
      prices: null,
      ticketUrl: null,
      eventUrl: item.url,
      cancelled: false,
      styles,
      evidence,
    },
    {
      sourceUrl: item.url,
      fetchedAt: options.fetchedAt,
      method: "jsonld",
      currency: currencyForCountry(options.countryCode),
    },
  );
}

export const squarespaceAdapter: SourceAdapter = {
  id: "squarespace",
  tier: "A",
  limits: { perDomainIntervalMs: CRAWL_INTERVAL_MS },
  async harvest(source: Source, ctx: RunCtx): Promise<HarvestResult> {
    const url = source.feedUrl ?? source.url;
    const page = await ctx.http.request({
      url,
      purpose: "crawl",
      headers: { accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1" },
    });
    if (!isEventsList(page.body)) {
      return { listings: [], readWithModel: "the page has no Squarespace events list" };
    }
    const pageUrl = page.url || url;
    const items = listedItems(page.body, pageUrl);
    const fromNight = currentNightDate(ctx.now(), ctx.metro.tz);
    const byUrl = new Map(items.map((item) => [item.url, item]));
    const read = await readItemPages(items, ctx, {
      fromNight,
      fallback: (link) => {
        const item = byUrl.get(link.url);
        const listing = item
          ? listedToListing(item, {
              fetchedAt: page.fetchedAt,
              zone: ctx.metro.tz,
              countryCode: ctx.metro.countryCode,
            })
          : null;
        return listing ? [listing] : [];
      },
      adjust: (link, listings) => {
        const item = byUrl.get(link.url);
        if (!item || !item.startTime || !item.night) return listings;
        return listings.map((listing) => {
          // Only adjust listings on the same night or the day before (for after-midnight starts)
          const listingNight = listing.listing.local_date;
          const prevNight = addCalendarDays(item.night!, -1);
          if (listingNight !== item.night && listingNight !== prevNight) return listing;
          // Determine which time field to update
          const timeField =
            listing.listing.doors_time !== null
              ? "doors_time"
              : listing.listing.dancing_time !== null
                ? "dancing_time"
                : listing.listing.lesson_time !== null
                  ? "lesson_time"
                  : null;
          if (!timeField) return listing;
          // Update the time
          const updatedListing = { ...listing };
          updatedListing.listing = { ...listing.listing };
          updatedListing.listing[timeField] = item.startTime;
          if (item.endTime) {
            updatedListing.listing.end_time = item.endTime;
          }
          updatedListing.listing.local_date = item.night!;
          updatedListing.tz = ctx.metro.tz;
          // Update evidence
          const evidence = { ...updatedListing.listing.evidence };
          evidence.start = `listed ${item.night} ${item.startTime}`;
          updatedListing.listing.evidence = evidence;
          return updatedListing;
        });
      },
    });
    const listings = read.listings.map((l) => withSourceStyle(l, source.styles));
    const contentHash = sha256(JSON.stringify(listings.map((l) => [l.externalId, l.listing])));
    return {
      listings,
      notes: [
        `${items.length} upcoming item(s) listed; ${read.fetched} event page(s) read`,
        ...read.notes,
      ],
      whole: read.whole ? true : undefined,
      doc: {
        url,
        fetchedAt: page.fetchedAt,
        httpStatus: page.status,
        etag: page.etag,
        lastModified: page.lastModified,
        contentHash,
        cleanedText: null,
      },
    };
  },
};
