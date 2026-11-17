// Event pages behind a list (D-111): a list page names its events' own pages, and each of those
// carries a schema.org Event in JSON-LD. Following them reads every night exactly, with no model:
// NYC Swings' home page lists its /e/ pages in a JSON-LD ItemList, Big Apple Ranch's (Wix) lists
// its /event-details-registration/ pages the same way, and a Squarespace events page lists its
// items in HTML (src/adapters/feeds/squarespace.ts).
//
// Pages are hostile: links are matched by fixed patterns, must be http(s) and on the list's own
// site, and only each item page's JSON-LD is read (src/adapters/feeds/jsonld.ts).

import { extractJsonLd, findEvents, jsonLdToListings } from "@/src/adapters/feeds/jsonld";
import { feverEventBlocks, isFeverHost } from "@/src/adapters/feeds/fever";
import { familyOf, isStyleKey } from "@/config/styles";
import { decodeEntities, httpUrl } from "@/src/adapters/shared";
import { weekdayOfNight, weeklyRecurrence } from "@/src/adapters/feeds/weekly-rule";
import type { HarvestedListing, RunCtx } from "@/src/adapters/types";
import { MATERIALIZE_DAYS, WEEKDAYS, type Weekday } from "@/src/domain/recurrence";
import { addCalendarDays } from "@/src/domain/time";

/** The most item pages one source reads in a run: 25 pages at 5 s a page is about 2 minutes. */
export const MAX_ITEM_PAGES = 25;

/** An event's own page, with the night the list gives it when it gives one. */
export interface ItemLink {
  url: string;
  /** The night the list dates it (its first night, for a span), or null when it does not say. */
  night: string | null;
  /** The name the list gives it, when the list's is cleaner than the page's own. */
  title?: string;
  /** The last day of a span the list dates, so a span still running is read. */
  endDay?: string | null;
}

type Node = Record<string, unknown>;
const isNode = (v: unknown): v is Node => typeof v === "object" && v !== null && !Array.isArray(v);
const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : v == null ? [] : [v]);

/** One site, whatever the `www.`: a link elsewhere is not this list's event. */
export function sameSite(url: string, base: string): boolean {
  const host = (u: string) => new URL(u).hostname.toLowerCase().replace(/^www\./, "");
  return host(url) === host(base);
}

/** Paths that name one event's page on the platforms we read (Spanish /evento/: Ritmo Libre, 2026-10-30). */
const EVENT_PATH =
  /\/(e|events?|eventos?|calendar|all-events|event-details(?:-registration)?)\/[^/?#]+/i;
/** Fever's event pages: /m/714987 or /m/714987/en (Barcelona, 2026-10-30). */
const FEVER_EVENT_PATH = /^\/m\/\d+(?:\/[a-z]{2})?\/?$/i;

/**
 * The event pages a page's JSON-LD ItemLists name (not its breadcrumbs): each element's `url`, or
 * its `item` as a link or a node with a `url`. Only same-site links to an event-like path count,
 * so a list of products or posts is never followed.
 */
export function itemListLinks(blocks: unknown[], pageUrl: string): string[] {
  const out: string[] = [];
  const visit = (value: unknown, depth: number) => {
    if (depth > 6) return;
    for (const node of asArray(value)) {
      if (Array.isArray(node)) {
        visit(node, depth + 1);
        continue;
      }
      if (!isNode(node)) continue;
      const types = asArray(node["@type"]).map(String);
      if (types.includes("ItemList")) {
        for (const element of asArray(node.itemListElement)) {
          if (!isNode(element)) continue;
          const item = element.item;
          const raw =
            element.url ?? (typeof item === "string" ? item : isNode(item) ? item.url : null);
          const url = httpUrl(raw, pageUrl);
          if (url && sameSite(url, pageUrl)) {
            const pathname = new URL(url).pathname;
            if (
              EVENT_PATH.test(pathname) ||
              (isFeverHost(url) && FEVER_EVENT_PATH.test(pathname))
            ) {
              out.push(url);
            }
          }
        }
      }
      visit(node["@graph"], depth + 1);
    }
  };
  visit(blocks, 0);
  return [...new Set(out)];
}

/** Wix Events pages a Wix page links to: `/event-details/…` and `/event-details-registration/…`. */
export function wixEventLinks(html: string, pageUrl: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(
    /["'](https?:\/\/[^"'<>\s]+\/event-details(?:-registration)?\/[^"'<>\s?#]+)/gi,
  )) {
    const url = httpUrl(decodeEntities(m[1] ?? ""), pageUrl);
    if (url && sameSite(url, pageUrl)) out.push(url);
  }
  return [...new Set(out)];
}

/** Whether a URL's host is Xceed's. */
export function isXceedHost(url: string): boolean {
  const host = new URL(url).hostname.toLowerCase();
  return host === "xceed.me" || host.endsWith(".xceed.me");
}

/** Xceed's event pages a city list links (/en/barcelona/event/<slug>/<id>), same host, no ItemList. */
export function xceedEventLinks(html: string, pageUrl: string): string[] {
  if (!isXceedHost(pageUrl)) return [];
  const out: string[] = [];
  // A relative path after a quote, or an absolute URL; the id's digits end it (a stray "\" is dropped).
  for (const m of html.matchAll(
    /(?:["'=(]|^)((?:https?:\/\/[^"'<>\s/]+)?\/[a-z-]+\/[a-z-]+\/event\/[a-z0-9-]+\/\d+)/gim,
  )) {
    const url = httpUrl(decodeEntities(m[1] ?? ""), pageUrl);
    if (url && sameSite(url, pageUrl)) out.push(url);
  }
  return [...new Set(out)];
}

/** Detects Wix sites by their static assets. */
const WIX_MARKER = /static\.parastorage\.com|wixstatic\.com/i;

/** Matches /events/<slug> where slug ends with a date pattern. */
const DATED_EVENT_PATH =
  /\/events\/[^/?#&<>\s]+-(?:\d{1,2}-\d{1,2}-\d{2}(?:-\d+)?|\d{4}-\d{2}-\d{2}(?:-\d{2}-\d{2})?)$/i;

/**
 * Wix dynamic event pages (/events/<slug>-M-D-YY or YYYY-MM-DD) a Wix page links to.
 * Returns [] for non-Wix sites.
 */
export function wixDatedEventLinks(html: string, pageUrl: string): string[] {
  if (!WIX_MARKER.test(html)) return [];
  const out: string[] = [];
  for (const m of html.matchAll(/["'](https?:\/\/[^"'<>\s?#&]+)/gi)) {
    const raw = m[1] ?? "";
    const decoded = decodeEntities(raw);
    // Stop at first of ? # & < > whitespace (the regex above stops at " ' < >)
    const clean = decoded.split(/[?#&<>]|\s/)[0]!;
    if (!DATED_EVENT_PATH.test(clean)) continue;
    const url = httpUrl(clean, pageUrl);
    if (url && sameSite(url, pageUrl)) out.push(url);
  }
  return [...new Set(out)];
}

export interface ItemRead {
  listings: HarvestedListing[];
  notes: string[];
  /** Every link in the window was read: none left over the cap, none failed. */
  whole: boolean;
  /** Item pages fetched. */
  fetched: number;
}

/**
 * Reads the event pages in the window: a link the list dates outside it is not fetched, one it
 * does not date is. At most `MAX_ITEM_PAGES`, the dated ones first, in the list's order. A page
 * that cannot be read, or carries no Event, is named in the notes; `fallback` (a Squarespace
 * list's own fields) then stands in for it when given.
 */
export async function readItemPages(
  links: readonly ItemLink[],
  ctx: RunCtx,
  options: {
    fromNight: string;
    days?: number;
    fallback?: (link: ItemLink, why: string) => HarvestedListing[];
    adjust?: (link: ItemLink, listings: HarvestedListing[]) => HarvestedListing[];
    maxPages?: number;
    wallClock?: boolean;
  },
): Promise<ItemRead> {
  const days = options.days ?? MATERIALIZE_DAYS;
  const max = options.maxPages ?? MAX_ITEM_PAGES;
  const lastNight = addCalendarDays(options.fromNight, days - 1);
  // A span's first night may be before tonight and the span still on: its last day decides.
  const wanted = links.filter(
    (link) =>
      link.night === null ||
      (link.night <= lastNight &&
        (link.endDay ?? link.night) >= addCalendarDays(options.fromNight, -1)),
  );
  const ordered = [
    ...wanted.filter((l) => l.night !== null),
    ...wanted.filter((l) => l.night === null),
  ];
  const reading = ordered.slice(0, max);
  const notes: string[] = [];
  const listings: HarvestedListing[] = [];
  let whole = ordered.length <= max;
  if (!whole) {
    notes.push(`${ordered.length} event pages in the window; read the first ${max}`);
  }
  let fetched = 0;
  for (const link of reading) {
    let why: string;
    try {
      const page = await ctx.http.request({
        url: link.url,
        purpose: "crawl",
        headers: { accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1" },
      });
      fetched += 1;
      const found = extractJsonLd(page.body).blocks;
      // Fever's event pages carry no Event JSON-LD: their inline plan data stands in (2026-10-30).
      const blocks =
        findEvents(found).length > 0 ? found : feverEventBlocks(page.body, page.url || link.url);
      if (findEvents(blocks).length > 0) {
        const read = jsonLdToListings(blocks, {
          pageUrl: page.url || link.url,
          fetchedAt: page.fetchedAt,
          metroTz: ctx.metro.tz,
          countryCode: ctx.metro.countryCode,
          fromNight: options.fromNight,
          days,
          title: link.title,
          wallClock: options.wallClock === true,
        });
        // Apply weekly recurrence from meta description (Salsa Vida pattern)
        const withWeekly = read.listings.map((l) => weeklyFromDescription(page.body, l));
        let adjustedListings = withWeekly;
        if (options.adjust) {
          adjustedListings = options.adjust(link, withWeekly);
        }
        listings.push(...adjustedListings);
        notes.push(...read.notes);
        continue;
      }
      why = "no schema.org event on the page";
    } catch (error) {
      whole = false;
      why = error instanceof Error ? error.message : String(error);
    }
    const stand = options.fallback?.(link, why) ?? [];
    // A page that names no Event (a challenge page, a page drawn in the browser) with nothing to
    // stand in for it is a night not read: the read is partial and retires nothing.
    if (stand.length === 0) whole = false;
    listings.push(...stand);
    notes.push(
      stand.length > 0 ? `${link.url}: ${why}; read from the list instead` : `${link.url}: ${why}`,
    );
  }
  return { listings, notes, whole, fetched };
}

const DAY_WORD =
  /^(mon|tue|wed|thu|fri|sat|sun)(?:day|days|sday|sdays|nesday|nesdays|rsday|rsdays|urday|urdays)?$/;
const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&#038;": "&",
  "&#8217;": "\u2019",
  "&quot;": '"',
};

/**
 * Salsa Vida's event page gives its next night as its one Event; its description names the weekdays
 * ("Every Monday, Tuesday ... & Saturday"). Such a listing becomes a weekly series from that night,
 * when the night is one of the days named.
 */
export function weeklyFromDescription(html: string, listing: HarvestedListing): HarvestedListing {
  const night = listing.listing.local_date;
  if (listing.recurrence !== null || night === null) return listing;
  const meta = (attr: string) =>
    new RegExp(`<meta\\s[^>]*${attr}[^>]*>`, "i")
      .exec(html)?.[0]
      .match(/content=(["'])(.*?)\1/i)?.[2];
  const raw = meta(`name=["']description["']`) ?? meta(`property=["']og:description["']`);
  if (!raw) return listing;
  const text = raw.replace(/&amp;|&#038;|&#8217;|&quot;/g, (e) => ENTITIES[e]!);
  const found = /\bevery\s+((?:[a-z]+\.?(?:\s*(?:,|&|\band\b)\s*|\s+|$))+)/i.exec(text);
  if (!found) return listing;
  const days: Weekday[] = [];
  for (const word of found[1]!.split(/\s*(?:,|&|\band\b)\s*|\s+/i).filter(Boolean)) {
    const m = DAY_WORD.exec(word.toLowerCase().replace(/\.$/, ""));
    if (!m) break;
    days.push(WEEKDAYS[["mon", "tue", "wed", "thu", "fri", "sat", "sun"].indexOf(m[1]!)]!);
  }
  if (days.length === 0) return listing;
  const weekday = weekdayOfNight(night);
  if (!days.includes(weekday)) return listing;
  const time =
    listing.listing.doors_time ?? listing.listing.dancing_time ?? listing.listing.lesson_time;
  const phrase = `Every ${found[1]!.trim().replace(/[.,]$/, "")}`;
  return {
    ...listing,
    recurrence: weeklyRecurrence(days, night, time || null),
    listing: { ...listing.listing, recurrence_text: phrase },
  };
}

/**
 * A dance organiser's "w/ DJs Molly Meng & Ryan Swift" is its own dance with DJs, not a club night:
 * the words name only club styles (`dj_night`), and the source is known for one dance style
 * (Frim Fram Jam, Lindy hop). Its styles become the source's; any other listing is left alone.
 */
export function withSourceStyle(
  listing: HarvestedListing,
  sourceStyles: readonly string[],
): HarvestedListing {
  const known = sourceStyles.filter(isStyleKey);
  const hint = known.length === 1 ? known[0]! : null;
  const styles = listing.listing.styles;
  if (!hint || familyOf(hint) === "club" || styles.length === 0) return listing;
  if (!styles.every((style) => isStyleKey(style) && familyOf(style) === "club")) return listing;
  return { ...listing, listing: { ...listing.listing, styles: [hint] } };
}
