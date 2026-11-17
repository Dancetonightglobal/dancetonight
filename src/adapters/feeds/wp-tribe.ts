// WordPress "The Events Calendar" REST API (PLAN 6.5 step 3): the `wp_tribe` adapter.
// `GET {site}/wp-json/tribe/events/v1/events?start_date=...&end_date=...&per_page=50`, following
// `next_rest_url` for a bounded number of pages.
//
// Fields read, per the plugin's REST reference (built from the documented shape; re-recorded
// against a live site on the first networked run, D-043): id, title, description, url,
// start_date / end_date (site-local "YYYY-MM-DD HH:MM:SS"), timezone, all_day, cost and
// cost_details, venue (venue, address, city, state, zip, geo_lat, geo_lng), organizer
// (organizer, website), categories, status.

import { httpUrl, isoToLocal, plainText, sha256 } from "@/src/adapters/shared";
import { buildListing, inWindow } from "@/src/adapters/structured";
import type {
  HarvestedListing,
  HarvestResult,
  RunCtx,
  Source,
  SourceAdapter,
} from "@/src/adapters/types";
import { isPlatformEventPage, isTicketingEventPage } from "@/src/domain/event-links";
import type { Point } from "@/src/domain/listing";
import { currencyForCountry, currencyInText, parsePriceText } from "@/src/domain/prices";
import { MATERIALIZE_DAYS } from "@/src/domain/recurrence";
import { matchStyles, type StyleKey } from "@/config/styles";
import { addCalendarDays, isValidZone } from "@/src/domain/time";
import { currentNightDate } from "@/src/domain/tonight";
import { CRAWL_INTERVAL_MS } from "@/src/pipeline/http";

export const WP_TRIBE_PATH = "/wp-json/tribe/events/v1/events";
/** Pages followed per harvest; 50 events a page covers any dance calendar's two weeks. */
export const WP_TRIBE_MAX_PAGES = 4;

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function num(value: unknown): number | null {
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : NaN;
  return Number.isFinite(n) ? n : null;
}

/** The API address for a site, with the window as query parameters. */
export function wpTribeUrl(siteOrApiUrl: string, fromNight: string, days: number): string {
  const url = new URL(siteOrApiUrl);
  if (!url.pathname.includes("/wp-json/tribe/events/")) url.pathname = WP_TRIBE_PATH;
  url.search = "";
  url.searchParams.set("start_date", `${fromNight} 00:00:00`);
  url.searchParams.set("end_date", `${addCalendarDays(fromNight, days)} 06:00:00`);
  url.searchParams.set("per_page", "50");
  return url.toString();
}

export interface WpTribeOptions {
  /** The site's own events page: where a listing with no page of its own links to. */
  siteUrl: string;
  fetchedAt: Date;
  metroTz: string;
  countryCode: string;
  fromNight: string;
  days?: number;
  /** The source is a venue's whole calendar (`SeedSource.mixedCalendar`): its categories are the
   * venue's own tags, not dance evidence (#198, D-322), so they give no styles. */
  mixedCalendar?: boolean;
}

export function wpTribeToListings(
  events: unknown[],
  options: WpTribeOptions,
): { listings: HarvestedListing[]; notes: string[] } {
  const days = options.days ?? MATERIALIZE_DAYS;
  const fallbackCurrency = currencyForCountry(options.countryCode);
  const listings: HarvestedListing[] = [];
  const notes: string[] = [];

  for (const raw of events) {
    if (!isObject(raw)) continue;
    const title = plainText(raw.title);
    if (!title) continue;
    if (raw.status && raw.status !== "publish") continue;
    const zone =
      typeof raw.timezone === "string" && isValidZone(raw.timezone)
        ? raw.timezone
        : options.metroTz;
    const allDay = raw.all_day === true;
    const start = isoToLocal(
      allDay ? String(raw.start_date ?? "").slice(0, 10) : raw.start_date,
      zone,
    );
    if (!start) {
      notes.push(`no readable start: ${title}`);
      continue;
    }
    if (!inWindow(start.night, options.fromNight, days)) continue;
    const end = allDay ? null : isoToLocal(raw.end_date, zone);

    const venue = isObject(raw.venue) ? raw.venue : null;
    let location: Point | null = null;
    if (venue) {
      const lat = num(venue.geo_lat);
      const lng = num(venue.geo_lng);
      if (lat !== null && lng !== null && !(lat === 0 && lng === 0)) location = { lat, lng };
    }
    const address = venue
      ? [venue.address, venue.city, venue.state ?? venue.province, venue.zip]
          .map(plainText)
          .filter((p): p is string => !!p)
          .join(", ") || null
      : null;

    const organizer = Array.isArray(raw.organizer)
      ? raw.organizer.find(isObject)
      : isObject(raw.organizer)
        ? raw.organizer
        : null;

    // `cost` is the organiser's own text ("$15", "Free", "$10 – $20"); its currency symbol wins.
    const cost = plainText(raw.cost);
    const details = isObject(raw.cost_details) ? raw.cost_details : null;
    const currency =
      (cost && currencyInText(cost, null)) ??
      (details && typeof details.currency_code === "string" ? details.currency_code : null) ??
      fallbackCurrency;
    const prices = cost ? parsePriceText(cost, currency) : null;

    const categories = Array.isArray(raw.categories)
      ? raw.categories
          .filter(isObject)
          .map((c) => plainText(c.name) ?? "")
          .join(", ")
      : "";
    let styles: StyleKey[] = [];
    if (!options.mixedCalendar) {
      styles = categories ? matchStyles(categories).styles : [];
    }
    // When mixedCalendar is true, styles remains empty regardless of categories.

    const evidence: Record<string, string> = {};
    evidence.start = `start_date ${String(raw.start_date)} ${zone}`.slice(0, 300);
    if (end?.time) evidence.end_time = `end_date ${String(raw.end_date)}`.slice(0, 300);
    if (cost && prices && prices.length > 0) evidence.prices = `cost ${cost}`.slice(0, 300);
    if (!options.mixedCalendar && styles.length > 0) {
      evidence.styles = `categories ${categories}`.slice(0, 300);
    }

    const pageUrl = httpUrl(raw.url);
    const website = httpUrl(raw.website);
    listings.push(
      buildListing(
        {
          externalId: raw.id !== undefined ? `wp:${String(raw.global_id ?? raw.id)}` : null,
          title,
          start,
          end: end && end.time && end.night === start.night ? end : null,
          description: plainText(raw.description),
          venue: {
            name: venue ? plainText(venue.venue) : null,
            address,
            url: venue ? httpUrl(venue.url) : null,
            location,
          },
          organizer: {
            name: organizer ? plainText(organizer.organizer) : null,
            url: organizer ? httpUrl(organizer.website) : null,
          },
          prices: prices && prices.length > 0 ? prices : null,
          // The event's page on the calendar is its own page (D-073). "Event website" is a page
          // about the event, not a stated ticket link (D-070), unless it is a ticket seller's page
          // for this one event. An event platform's page for it (a Facebook, Meetup or Partiful
          // event) sells nothing: it is the event's page when the calendar gives none (review
          // #18). Otherwise it is not used.
          ticketUrl: website && isTicketingEventPage(website) ? website : null,
          eventUrl: pageUrl ?? (website && isPlatformEventPage(website) ? website : null),
          cancelled: false,
          styles,
          evidence,
        },
        {
          sourceUrl: pageUrl ?? options.siteUrl,
          fetchedAt: options.fetchedAt,
          method: "api",
          currency,
        },
      ),
    );
  }
  return { listings, notes };
}

export const wpTribeAdapter: SourceAdapter = {
  id: "wp_tribe",
  tier: "A",
  limits: { perDomainIntervalMs: CRAWL_INTERVAL_MS },
  async harvest(source: Source, ctx: RunCtx): Promise<HarvestResult> {
    const fromNight = currentNightDate(ctx.now(), ctx.metro.tz);
    let next: string | null = wpTribeUrl(source.feedUrl ?? source.url, fromNight, MATERIALIZE_DAYS);
    const events: unknown[] = [];
    let first: Awaited<ReturnType<RunCtx["http"]["request"]>> | null = null;
    for (let page = 0; next && page < WP_TRIBE_MAX_PAGES; page++) {
      const response = await ctx.http.request({
        url: next,
        purpose: "crawl",
        headers: { accept: "application/json" },
        // Conditional headers apply to the first page only; later pages follow its answer.
        conditional:
          page === 0 ? { etag: source.etag, lastModified: source.lastModified } : undefined,
      });
      if (page === 0 && response.notModified) return { listings: [], unchanged: true };
      first ??= response;
      let body: unknown;
      try {
        body = JSON.parse(response.body);
      } catch {
        throw new Error("the events API did not answer with JSON");
      }
      if (!isObject(body) || !Array.isArray(body.events))
        throw new Error("not a Tribe events response");
      events.push(...body.events);
      next = typeof body.next_rest_url === "string" ? httpUrl(body.next_rest_url) : null;
    }
    const contentHash = sha256(JSON.stringify(events));
    const doc = {
      url: source.feedUrl ?? source.url,
      fetchedAt: first!.fetchedAt,
      httpStatus: first!.status,
      etag: first!.etag,
      lastModified: first!.lastModified,
      contentHash,
      cleanedText: null,
    };
    if (source.contentHash === contentHash) return { listings: [], unchanged: true, doc };
    const { listings, notes } = wpTribeToListings(events, {
      siteUrl: source.url,
      fetchedAt: first!.fetchedAt,
      metroTz: ctx.metro.tz,
      countryCode: ctx.metro.countryCode,
      fromNight,
      mixedCalendar: source.mixedCalendar === true,
    });
    if (next) notes.push(`stopped after ${WP_TRIBE_MAX_PAGES} pages`);
    return { listings, doc, notes };
  },
};
