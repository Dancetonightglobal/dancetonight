// Eventbrite API v3 (SOURCES 2.3, D-015): the `eventbrite` adapter. The public search endpoint is
// gone, so this reads organizers and venues we already know, officially:
//   GET /v3/organizers/{id}/events/?status=live&order_by=start_asc&expand=venue,ticket_availability
// (no `time_filter`: this endpoint answers 400 "time_filter - Unknown parameter", seen on ingest
// run 9; `status=live` already means published and not ended, and the window check trims the rest)
//   GET /v3/venues/{id}/events/?...  (same shape)
//   GET /v3/series/{id}/events/?time_filter=current_future&...  (a series parent's dated children, D-272)
// with `Authorization: Bearer {token}` (never in the URL), following `pagination.continuation`.
// No Eventbrite web page is ever read (D-015).
//
// A venue that sells through Eventbrite (Elsewhere) links event pages
// (`eventbrite.com/e/name-tickets-1992171479523`), not its organizer. A source may therefore be
// the venue's own page, seeded with platform `eventbrite` (D-131): the page is read for its event
// links, each link's organizer is asked of the API (GET /v3/events/{id}/ answers `organizer_id`),
// and those organizers' events are read under the page's address, so the venue's
// `mixedCalendar` flag (keyed by that address) screens its concerts. Event links are never kept
// as sources of their own: an organizer found that way would be listed whole, unscreened.
//
// Response fields read (built from the documented shape; re-recorded on the first live run):
// id, name.text, description.text, url, start/end {timezone, local}, status, online_event,
// is_free, venue {name, address {address_1, city, region, postal_code, latitude, longitude}},
// ticket_availability {is_free, minimum_ticket_price, maximum_ticket_price}.

import { decodeEntities, httpUrl, isoToLocal, plainText, sha256 } from "@/src/adapters/shared";
import { ownSite } from "@/src/domain/dedupe";
import { EVENTBRITE_HOST } from "@/src/domain/event-links";
import { priceRangeLabel } from "@/src/domain/price-range";
import { buildListing, inWindow } from "@/src/adapters/structured";
import { extractJsonLd, findEvents } from "@/src/adapters/feeds/jsonld";
import type {
  HarvestedListing,
  HarvestResult,
  RunCtx,
  Source,
  SourceAdapter,
} from "@/src/adapters/types";
import type { ListingPrice, Point } from "@/src/domain/listing";
import { MATERIALIZE_DAYS } from "@/src/domain/recurrence";
import { HttpError } from "@/src/pipeline/http";
import { isValidZone } from "@/src/domain/time";
import { currentNightDate } from "@/src/domain/tonight";

export const EVENTBRITE_API = "https://www.eventbriteapi.com/v3";
export const EVENTBRITE_MAX_PAGES = 5;
export const EVENTBRITE_MAX_STATUS_CHECKS = 6;
/** Series read per source per run (D-272). */
export const EVENTBRITE_MAX_SERIES = 4;
/**
 * Goes into the content hash, so a change to how events become listings is written on the next
 * run even when a source's events have not changed. 2: price ranges carry their currency and the
 * venue's point is checked against its address (D-071). 3: the organiser's own website, when
 * Eventbrite has one, is its URL in place of its Eventbrite page (lane 1, D-090). 4: sold-out
 * events' pages are read for a cancellation the API missed.
 */
export const EVENTBRITE_MAPPING_VERSION = 4;

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** Eventbrite's hosts and its API's, never a look-alike such as `eventbrite.com.evil.example`. */
const isEventbriteHost = (host: string) =>
  EVENTBRITE_HOST.test(host.toLowerCase()) || /^(www\.)?eventbriteapi\.com$/i.test(host);

/**
 * The organizer or venue an Eventbrite URL names: `eventbrite.com/o/name-12345` is an organizer,
 * `eventbrite.com/v/name-67890` or `/venues/67890` a venue. Null for anything else.
 */
export function eventbriteTarget(
  url: string,
): { kind: "organizers" | "venues"; id: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!isEventbriteHost(parsed.hostname)) return null;
  const organizer = /\/(?:o|organizers)\/(?:[^/]*-)?(\d{5,})\/?/.exec(parsed.pathname);
  if (organizer?.[1]) return { kind: "organizers", id: organizer[1] };
  const venue = /\/(?:v|venues)\/(?:[^/]*-)?(\d{5,})\/?/.exec(parsed.pathname);
  if (venue?.[1]) return { kind: "venues", id: venue[1] };
  return null;
}

/** The event id an Eventbrite event address names (`/e/any-slug-1992171479523`), or null. */
export function eventbriteEventId(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!isEventbriteHost(parsed.hostname)) return null;
  return /^\/e\/(?:[^/]*-)?(\d{9,})(?:\/|$)/.exec(parsed.pathname)?.[1] ?? null;
}

/**
 * Every Eventbrite event id a page links, in order. Script-built pages write links
 * protocol-relative (`//www.eventbrite.com/e/…`) or JSON-escaped (`https:\/\/…\/e\/…`), and an
 * entity may follow the id (`…-123&amp;aff=x`), so the text is unescaped first.
 */
export function eventbriteEventIdsInHtml(html: string): string[] {
  const text = decodeEntities(html.replace(/\\\//g, "/"));
  const ids: string[] = [];
  for (const m of text.matchAll(
    /(?:https?:)?\/\/[a-z0-9.-]*eventbrite\.[a-z.]+\/e\/(?:[^"'<>\s?#&/]*-)?(\d{9,})(?=[/?#&"'<>\s]|$)/gi,
  )) {
    const url = m[0].startsWith("//") ? `https:${m[0]}` : m[0];
    if (eventbriteEventId(url)) ids.push(m[1]!);
  }
  return [...new Set(ids)];
}

/** Organizers looked up from one venue page's event links per run; each costs one request. */
export const EVENTBRITE_MAX_LOOKUPS = 4;

export function eventbriteEventsUrl(
  target: { kind: string; id: string },
  continuation?: string,
): string {
  const url = new URL(`${EVENTBRITE_API}/${target.kind}/${target.id}/events/`);
  url.searchParams.set("status", "live");
  url.searchParams.set("order_by", "start_asc");
  url.searchParams.set("expand", "venue,ticket_availability,organizer");
  if (continuation) url.searchParams.set("continuation", continuation);
  return url.toString();
}

/** URL for reading children of a series parent (D-272). */
export function eventbriteSeriesUrl(
  seriesId: string,
  continuation?: string,
  plain = false,
): string {
  const url = new URL(`${EVENTBRITE_API}/series/${seriesId}/events/`);
  if (!plain) {
    url.searchParams.set("time_filter", "current_future");
    url.searchParams.set("order_by", "start_asc");
  }
  url.searchParams.set("expand", "venue,ticket_availability,organizer");
  if (continuation) url.searchParams.set("continuation", continuation);
  return url.toString();
}

function pricesOf(event: Json): ListingPrice[] | null {
  const tickets = isObject(event.ticket_availability) ? event.ticket_availability : null;
  if (event.is_free === true || tickets?.is_free === true)
    return [{ label: "Free", amount: 0, currency: "USD", includes: null }];
  if (!tickets) return null;
  const money = (v: unknown) =>
    isObject(v) && typeof v.major_value === "string" && str(v.currency)
      ? { amount: Number(v.major_value), currency: String(v.currency).toUpperCase() }
      : null;
  const min = money(tickets.minimum_ticket_price);
  const max = money(tickets.maximum_ticket_price);
  if (!min || !Number.isFinite(min.amount)) return null;
  if (max && Number.isFinite(max.amount) && max.amount > min.amount) {
    return [
      {
        label: priceRangeLabel("Tickets", min.amount, max.amount, min.currency),
        amount: null,
        currency: min.currency,
        includes: null,
      },
    ];
  }
  return [{ label: "Tickets", amount: min.amount, currency: min.currency, includes: null }];
}

function venueOf(event: Json): {
  name: string | null;
  address: string | null;
  location: Point | null;
} {
  const venue = isObject(event.venue) ? event.venue : null;
  if (!venue) return { name: null, address: null, location: null };
  const address = isObject(venue.address) ? venue.address : {};
  const lat = Number(address.latitude);
  const lng = Number(address.longitude);
  return {
    name: plainText(venue.name),
    address:
      str(address.localized_address_display) ??
      ([address.address_1, address.city, address.region, address.postal_code]
        .map(str)
        .filter(Boolean)
        .join(", ") ||
        null),
    location:
      Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0)
        ? { lat, lng }
        : null,
  };
}

/** Helper to compute start night and zone for an event object (used by soldOutToCheck). */
function startNightAndZone(event: Json, metroTz: string): { night: string | null; zone: string } {
  const startInfo = isObject(event.start) ? event.start : {};
  const zone =
    str(startInfo.timezone) && isValidZone(String(startInfo.timezone))
      ? String(startInfo.timezone)
      : metroTz;
  const start = isoToLocal(startInfo.local, zone);
  return { night: start?.night ?? null, zone };
}

/**
 * Returns ids of events that are sold-out, live, in-window, and have a URL.
 * Used to decide which event pages to fetch for a possible cancellation.
 */
export function soldOutToCheck(
  events: unknown[],
  options: { metroTz: string; fromNight: string; days?: number },
): string[] {
  const days = options.days ?? MATERIALIZE_DAYS;
  const ids: string[] = [];
  for (const ev of events.filter(isObject)) {
    const id = str(ev.id);
    const url = httpUrl(ev.url);
    if (!id || !url) continue;
    const status = str(ev.status);
    if (status && /cancel(?:ed|l)/i.test(status)) continue;
    const tickets = isObject(ev.ticket_availability) ? ev.ticket_availability : null;
    if (!tickets || tickets.is_sold_out !== true) continue;
    const { night } = startNightAndZone(ev, options.metroTz);
    if (!night || !inWindow(night, options.fromNight, days)) continue;
    ids.push(id);
  }
  return ids;
}

/**
 * Returns true if the HTML contains a JSON-LD event node with eventStatus EventCancelled.
 * Uses the exported functions from jsonld.ts.
 */
// The page's own event object, as its app renders it: "live" shows an ordinary (sold-out or sales-ended) event.
const PAGE_EVENT_LIVE = /"url":"https?:\/\/[^"]*eventbrite\.[^"]*\/e\/[^"]*","status":"live"/;

/**
 * JSON-LD EventCancelled counts only when the page's own event object is not "live" (D-795): Pune's
 * "Ecstatic Dance Workshop" (2002629957111) carried EventCancelled while the page showed "Sales ended".
 */
export function pageSaysCancelled(html: string): boolean {
  if (PAGE_EVENT_LIVE.test(html)) return false;
  const { blocks } = extractJsonLd(html);
  const eventNodes = findEvents(blocks);
  for (const node of eventNodes) {
    const status = node.eventStatus;
    if (typeof status === "string" && /EventCancelled/i.test(status)) {
      return true;
    }
  }
  return false;
}

export function eventbriteToListings(
  events: unknown[],
  options: { fetchedAt: Date; metroTz: string; fromNight: string; days?: number },
): { listings: HarvestedListing[]; notes: string[] } {
  const days = options.days ?? MATERIALIZE_DAYS;
  const listings: HarvestedListing[] = [];
  const notes: string[] = [];
  for (const event of events.filter(isObject)) {
    const id = str(event.id);
    const title = isObject(event.name) ? plainText(event.name.text) : null;
    if (!id || !title) continue;
    if (event.online_event === true) {
      notes.push(`online only, skipped: ${title}`);
      continue;
    }
    const startInfo = isObject(event.start) ? event.start : {};
    const endInfo = isObject(event.end) ? event.end : {};
    const zone =
      str(startInfo.timezone) && isValidZone(String(startInfo.timezone))
        ? String(startInfo.timezone)
        : options.metroTz;
    const start = isoToLocal(startInfo.local, zone);
    if (!start) {
      notes.push(`no readable start: ${title}`);
      continue;
    }
    // Out of the window: another run lists it. A date with no time is a night whose time is not
    // listed (D-060), not a skip.
    if (!inWindow(start.night, options.fromNight, days)) continue;
    const end = isoToLocal(endInfo.local, zone);
    const venue = venueOf(event);
    const organizer = isObject(event.organizer) ? event.organizer : null;
    const url = httpUrl(event.url);
    const cancelled = event.status === "canceled" || event.status === "cancelled";
    listings.push(
      buildListing(
        {
          externalId: `eb:${id}`,
          title,
          start,
          end: end?.time && end.night === start.night ? end : null,
          description: isObject(event.description)
            ? plainText(event.description.text)
            : plainText(event.summary),
          venue: { ...venue, url: null },
          organizer: {
            name: organizer ? plainText(organizer.name) : null,
            // The organiser's own website when Eventbrite has one (CDNY's is cdny.org), else its
            // Eventbrite page: the organizer link pairs its nights with its own site's (D-090).
            url: organizer
              ? ownSite(httpUrl(organizer.website))
                ? httpUrl(organizer.website)
                : httpUrl(organizer.url)
              : null,
          },
          prices: pricesOf(event),
          ticketUrl: url,
          // The seller's page for the event is its own page too (D-073).
          eventUrl: url,
          cancelled,
          evidence: {
            start: `start.local ${String(startInfo.local)} ${zone}`,
            ...(cancelled ? { cancelled: `status ${String(event.status)}` } : {}),
          },
        },
        {
          sourceUrl: url ?? `https://www.eventbrite.com/e/${id}`,
          fetchedAt: options.fetchedAt,
          method: "api",
          currency: null,
        },
      ),
    );
  }
  return { listings, notes };
}

type Target = { kind: "organizers" | "venues"; id: string };

async function readTarget(
  target: Target,
  ctx: RunCtx,
  token: string,
): Promise<{ events: unknown[]; fetchedAt: Date }> {
  const events: unknown[] = [];
  let continuation: string | undefined;
  let fetchedAt = ctx.now();
  for (let page = 0; page < EVENTBRITE_MAX_PAGES; page++) {
    const response = await ctx.http.request({
      url: eventbriteEventsUrl(target, continuation),
      purpose: "api",
      intervalMs: 1_000,
      headers: { accept: "application/json", authorization: `Bearer ${token}` },
    });
    fetchedAt = response.fetchedAt;
    const body = JSON.parse(response.body) as Json;
    if (Array.isArray(body.events)) events.push(...body.events);
    const pagination = isObject(body.pagination) ? body.pagination : {};
    if (pagination.has_more_items !== true || typeof pagination.continuation !== "string") break;
    continuation = pagination.continuation;
  }
  return { events, fetchedAt };
}

/** The organizer of one event, asked of the API (D-131). Null when the event is gone. */
async function organizerOf(eventId: string, ctx: RunCtx, token: string): Promise<string | null> {
  try {
    const response = await ctx.http.request({
      url: `${EVENTBRITE_API}/events/${eventId}/`,
      purpose: "api",
      intervalMs: 1_000,
      headers: { accept: "application/json", authorization: `Bearer ${token}` },
    });
    const body = JSON.parse(response.body) as unknown;
    const raw = isObject(body) ? body.organizer_id : null;
    const id = typeof raw === "number" ? String(raw) : str(raw);
    return id && /^\d{5,}$/.test(id) ? id : null;
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) return null;
    throw error;
  }
}

export const eventbriteAdapter: SourceAdapter = {
  id: "eventbrite",
  tier: "A",
  // Eventbrite documents an hourly limit (SOURCES 2.3, unverified figure); one request a second
  // keeps a New York run far under it.
  limits: { perDomainIntervalMs: 1_000 },
  requiredEnv: ["EVENTBRITE_PRIVATE_TOKEN"],
  async harvest(source: Source, ctx: RunCtx): Promise<HarvestResult> {
    const token = ctx.env.EVENTBRITE_PRIVATE_TOKEN!;
    const notes: string[] = [];
    const events: unknown[] = [];
    const seen = new Set<string>();
    let fetchedAt = ctx.now();
    const read = async (target: Target) => {
      const answer = await readTarget(target, ctx, token);
      fetchedAt = answer.fetchedAt;
      for (const event of answer.events) {
        const id = isObject(event) ? str(event.id) : null;
        if (id && seen.has(id)) continue;
        if (id) seen.add(id);
        events.push(event);
      }
    };

    const direct = eventbriteTarget(source.feedUrl ?? "") ?? eventbriteTarget(source.url);
    if (direct) await read(direct);
    else {
      const page = httpUrl(source.url);
      if (!page || isEventbriteHost(new URL(page).hostname)) {
        throw new Error("not an Eventbrite organizer or venue address, nor a venue page");
      }
      // A venue's own page: its event links lead to the organizers that sell its nights. An
      // event an organizer already read lists is not looked up again, so a venue that sells
      // everything through one organizer costs one lookup.
      const response = await ctx.http.request({
        url: page,
        purpose: "crawl",
        headers: { accept: "text/html" },
      });
      const eventIds = eventbriteEventIdsInHtml(response.body);
      if (eventIds.length === 0) throw new Error("the page links no Eventbrite event");
      const organizers = new Set<string>();
      let lookups = 0;
      const unread: string[] = [];
      for (const id of eventIds) {
        if (seen.has(id)) continue;
        if (lookups >= EVENTBRITE_MAX_LOOKUPS) {
          unread.push(id);
          continue;
        }
        lookups += 1;
        const organizer = await organizerOf(id, ctx, token);
        if (!organizer || organizers.has(organizer)) continue;
        organizers.add(organizer);
        notes.push(`organizer ${organizer}, from the page's link to event ${id}`);
        await read({ kind: "organizers", id: organizer });
      }
      if (organizers.size === 0) {
        throw new Error("none of the page's Eventbrite events could be read");
      }
      if (unread.length > 0) {
        notes.push(
          `${unread.length} of the page's events are in no organizer read, and were not looked up (limit ${EVENTBRITE_MAX_LOOKUPS} a run): ${unread.slice(0, 5).join(", ")}`,
        );
      }
    }

    // A series parent stands for its dated children, read from the series (D-272): the parent's
    // own start is the series' first night (Da Sunday Cookout's, in 2023).
    const parents = events.filter(
      (e): e is Json => isObject(e) && e.is_series_parent === true && !!str(e.id),
    );
    const readSeries = async (id: string, plain: boolean): Promise<unknown[]> => {
      const children: unknown[] = [];
      let continuation: string | undefined;
      for (let page = 0; page < EVENTBRITE_MAX_PAGES; page++) {
        const response = await ctx.http.request({
          url: eventbriteSeriesUrl(id, continuation, plain),
          purpose: "api",
          intervalMs: 1_000,
          headers: { accept: "application/json", authorization: `Bearer ${token}` },
        });
        const body = JSON.parse(response.body) as Json;
        if (Array.isArray(body.events)) children.push(...body.events);
        const pagination = isObject(body.pagination) ? body.pagination : {};
        if (pagination.has_more_items !== true || typeof pagination.continuation !== "string") {
          break;
        }
        continuation = pagination.continuation;
      }
      return children;
    };
    for (const parent of parents.slice(0, EVENTBRITE_MAX_SERIES)) {
      const id = str(parent.id)!;
      let children: unknown[];
      try {
        try {
          children = await readSeries(id, false);
        } catch (error) {
          // A parameter the endpoint does not know answers 400 (as `time_filter` did for organizers).
          if (!(error instanceof HttpError && error.status === 400)) throw error;
          children = await readSeries(id, true);
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        notes.push(`series ${id}: children not read (${msg})`);
        continue;
      }
      events.splice(events.indexOf(parent), 1);
      for (const child of children) {
        const childId = isObject(child) ? str(child.id) : null;
        if (!isObject(child) || !childId || seen.has(childId)) continue;
        seen.add(childId);
        events.push({
          ...child,
          venue: child.venue ?? parent.venue,
          organizer: child.organizer ?? parent.organizer,
        });
      }
      notes.push(`series ${id}: ${children.length} dated event(s) read`);
    }
    if (parents.length > EVENTBRITE_MAX_SERIES) {
      notes.push(
        `${parents.length - EVENTBRITE_MAX_SERIES} series not read (limit ${EVENTBRITE_MAX_SERIES} a run)`,
      );
    }

    // Check sold-out event pages for cancellations the API missed.
    const ids = soldOutToCheck(events, {
      metroTz: ctx.metro.tz,
      fromNight: currentNightDate(ctx.now(), ctx.metro.tz),
    });
    const toCheck = ids.slice(0, EVENTBRITE_MAX_STATUS_CHECKS);
    const skipped = ids.slice(EVENTBRITE_MAX_STATUS_CHECKS);
    for (const id of toCheck) {
      const event = events.find((e) => isObject(e) && str(e.id) === id);
      if (!isObject(event)) continue;
      const url = httpUrl(event.url);
      if (!url) continue;
      try {
        const response = await ctx.http.request({
          url,
          purpose: "crawl",
          headers: { accept: "text/html" },
        });
        if (pageSaysCancelled(response.body)) {
          // Replace the event with a shallow copy that has status "canceled".
          const updated = { ...event, status: "canceled" };
          const idx = events.indexOf(event);
          events[idx] = updated;
          notes.push(`event ${id} cancelled on its page (API said live)`);
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        notes.push(`event ${id}: page not read (${msg})`);
      }
    }
    if (skipped.length > 0) {
      notes.push(
        `${skipped.length} sold-out events not checked (limit ${EVENTBRITE_MAX_STATUS_CHECKS} a run)`,
      );
    }

    const contentHash = sha256(JSON.stringify([EVENTBRITE_MAPPING_VERSION, events]));
    const doc = {
      url: source.url,
      fetchedAt,
      httpStatus: 200,
      etag: null,
      lastModified: null,
      contentHash,
      cleanedText: null,
    };
    if (source.contentHash === contentHash) return { listings: [], unchanged: true, doc, notes };
    const result = eventbriteToListings(events, {
      fetchedAt,
      metroTz: ctx.metro.tz,
      fromNight: currentNightDate(ctx.now(), ctx.metro.tz),
    });
    return { listings: result.listings, doc, notes: [...notes, ...result.notes] };
  },
};
