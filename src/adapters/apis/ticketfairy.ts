// TicketFairy's public events API (robots.txt allows /api/v1/events/listing, checked 2026-11-07);
// the owner approved its use (D-1081). Reads events for a country and state, returns dance nights.
// TicketFairy lists every kind of event (concerts, retreats, talks): give its source rows
// `mixedCalendar: true` so the no-dance screen applies (coverage-114, 2026-11-07).

import { withSourceStyle } from "@/src/adapters/feeds/event-pages";
import { isoToLocal, sha256 } from "@/src/adapters/shared";
import { buildListing, inWindow } from "@/src/adapters/structured";
import type {
  HarvestedListing,
  HarvestResult,
  RunCtx,
  Source,
  SourceAdapter,
} from "@/src/adapters/types";
import type { Point } from "@/src/domain/listing";
import { addCalendarDays } from "@/src/domain/time";
import { currentNightDate } from "@/src/domain/tonight";
import { insideMetro } from "@/src/domain/metro-bounds";
import { HttpError } from "@/src/pipeline/http";

export const TICKETFAIRY_ENDPOINT = "https://www.ticketfairy.com/api/v1/events/listing";
export const TICKETFAIRY_INTERVAL_MS = 5000;
export const TICKETFAIRY_DAYS = 14;
export const TICKETFAIRY_MAX_PAGES = 10;

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getQueryParamsFromUrl(url: string): {
  country: string;
  state: string | null;
  city: string | null;
} {
  const parsed = new URL(url);
  const country = parsed.searchParams.get("country");
  if (!country) {
    throw new Error(`ticketfairy: source has no country`);
  }
  const state = parsed.searchParams.get("state");
  const city = parsed.searchParams.get("city");
  return { country, state, city };
}

export function ticketfairyQueryUrl(
  sourceUrl: string,
  fromNight: string,
  toNight: string,
  tz: string,
  cursor?: string,
): string {
  const { country, state } = getQueryParamsFromUrl(sourceUrl);
  const params = new URLSearchParams();
  params.set("country", country);
  if (state) {
    params.set("state", state);
  }
  params.set("from", fromNight);
  params.set("to", toNight);
  params.set("timezone", tz);
  params.set("size", "100");
  if (cursor) {
    params.set("cursor", cursor);
  }
  return `${TICKETFAIRY_ENDPOINT}?${params.toString()}`;
}

function collapseWhitespace(str: string): string {
  return str.replace(/\s+/g, " ").trim();
}

function sameName(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  // NFD normalization, remove combining marks, lowercase, trim
  return (
    a
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim() ===
    b
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim()
  );
}

function cleanTitle(title: string): string {
  let t = collapseWhitespace(title);
  // Remove leading/trailing "•"
  t = t.replace(/^•+|•+$/g, "").trim();
  return t;
}

function buildAddress(venue: Json): string | null {
  const street = typeof venue.street === "string" ? venue.street.trim() : null;
  const streetNumber = typeof venue.streetNumber === "string" ? venue.streetNumber.trim() : null;
  const city = typeof venue.city === "string" ? venue.city.trim() : null;
  const state = typeof venue.state === "string" ? venue.state.trim() : null;
  const postalCode = typeof venue.postalCode === "string" ? venue.postalCode.trim() : null;

  const parts: string[] = [];
  if (street) {
    const streetPart = streetNumber ? `${street} ${streetNumber}` : street;
    parts.push(streetPart);
  }
  if (city) parts.push(city);
  if (state) parts.push(state);
  if (postalCode) parts.push(postalCode);

  if (parts.length === 0) return null;
  return parts.join(", ");
}

function parseLatLng(venue: Json): Point | null {
  const latStr = typeof venue.latitude === "string" ? venue.latitude : null;
  const lngStr = typeof venue.longitude === "string" ? venue.longitude : null;
  if (!latStr || !lngStr) return null;
  const lat = Number.parseFloat(latStr);
  const lng = Number.parseFloat(lngStr);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const hidden = venue.hidden === true;
  if (hidden) return null;
  return { lat, lng };
}

function parsePrice(startingPrice: unknown): { amount: number; currency: string } | null {
  if (!isObject(startingPrice)) return null;
  const amount = startingPrice.amount;
  const currency = startingPrice.currency;
  if (typeof amount !== "string" && typeof amount !== "number") return null;
  const num = Number.parseFloat(String(amount));
  if (!Number.isFinite(num) || num <= 0) return null;
  if (typeof currency !== "string") return null;
  return { amount: num, currency };
}

export function ticketfairyToListings(
  events: unknown[],
  ctx: RunCtx,
  options: {
    fetchedAt: Date;
    fromNight: string;
    days?: number;
    state?: string | null;
    city?: string | null;
  },
): { listings: HarvestedListing[]; notes: string[] } {
  const days = options.days ?? TICKETFAIRY_DAYS;
  const listings: HarvestedListing[] = [];
  const notes: string[] = [];
  const seen = new Set<string>();
  let hiddenDateCount = 0;
  let outsideMetroCount = 0;
  let outsideWindowCount = 0;
  let noPointOutsideAreaCount = 0;

  for (const raw of events) {
    if (!isObject(raw)) continue;
    const event = raw;

    const url = typeof event.url === "string" ? event.url.trim() : null;
    if (!url) continue;
    const externalId = `ticketfairy:${url.split("/").pop()}`;
    if (seen.has(externalId)) continue;
    seen.add(externalId);

    const hideDate = event.hideDate === true;
    if (hideDate) {
      hiddenDateCount++;
      continue;
    }

    const titleRaw = typeof event.displayName === "string" ? event.displayName : "";
    const title = cleanTitle(titleRaw);
    if (!title) continue;

    const startDateRaw = typeof event.startDate === "string" ? event.startDate : null;
    const endDateRaw = typeof event.endDate === "string" ? event.endDate : null;
    const timezone = typeof event.timezone === "string" ? event.timezone : ctx.metro.tz;

    if (!startDateRaw) continue;
    const start = isoToLocal(startDateRaw, timezone);
    if (!start) continue;

    if (!inWindow(start.night, options.fromNight, days)) {
      outsideWindowCount++;
      continue;
    }

    let end = endDateRaw ? isoToLocal(endDateRaw, timezone) : null;
    if (end && end.night !== start.night) {
      // If end is on a different night, keep only if same night as start
      end = null;
    }

    // Venue
    const venue = isObject(event.venue) ? event.venue : {};
    const venueName = typeof venue.name === "string" ? venue.name.trim() : null;
    const address = buildAddress(venue);
    const point = parseLatLng(venue);

    // Determine if we should keep the event based on point and area matching
    let keepEvent = true;

    if (point) {
      // Event has a point: check if it's inside the metro
      if (!insideMetro(ctx.metro, point)) {
        outsideMetroCount++;
        keepEvent = false;
      }
    } else {
      // No point: check if venue matches source's state/city
      const venueState = typeof venue.state === "string" ? venue.state.trim() : null;
      const venueCity = typeof venue.city === "string" ? venue.city.trim() : null;

      if (options.city && sameName(venueCity, options.city)) {
        // City matches: keep
      } else if (
        options.state &&
        !options.city &&
        (sameName(venueState, options.state) || sameName(venueCity, options.state))
      ) {
        // State matches (and no city specified): keep
      } else if (!options.state && !options.city) {
        // No state or city in source: skip
        noPointOutsideAreaCount++;
        keepEvent = false;
      } else {
        // Doesn't match: skip
        noPointOutsideAreaCount++;
        keepEvent = false;
      }
    }

    if (!keepEvent) {
      continue;
    }

    const venueLocation: Point | null = point;

    // Price
    const priceRaw = event.startingPrice;
    const price = parsePrice(priceRaw);

    // Organizer
    const brand = isObject(event.brand) ? event.brand : {};
    const organizerName = typeof brand.name === "string" ? brand.name.trim() : null;

    // Evidence snippet
    const shortDesc = typeof event.shortDescription === "string" ? event.shortDescription : "";
    const snippet = shortDesc || titleRaw;
    const evidence = snippet.slice(0, 200);

    const listing = buildListing(
      {
        externalId,
        title,
        start,
        end,
        description: null,
        venue: {
          name: venueName,
          address,
          url: null,
          location: venueLocation,
        },
        organizer: { name: organizerName, url: null },
        prices: price
          ? [
              {
                label: "Tickets from",
                amount: price.amount,
                currency: price.currency,
                includes: null,
              },
            ]
          : null,
        ticketUrl: url,
        eventUrl: url,
        cancelled: false,
        styles: [],
        djs: [],
        evidence: { snippet: evidence },
      },
      {
        sourceUrl: url,
        fetchedAt: options.fetchedAt,
        method: "api",
        currency:
          price?.currency ??
          (isObject(event.currency) && typeof event.currency.currency === "string"
            ? event.currency.currency
            : null),
      },
    );
    // Set tz as per spec
    listing.tz = timezone;
    listings.push(listing);
  }

  if (hiddenDateCount > 0) {
    notes.push(`ticketfairy: ${hiddenDateCount} events with hidden dates`);
  }
  if (outsideMetroCount > 0) {
    notes.push(`ticketfairy: ${outsideMetroCount} events outside the metro`);
  }
  if (outsideWindowCount > 0) {
    notes.push(`ticketfairy: ${outsideWindowCount} events outside the window`);
  }
  if (noPointOutsideAreaCount > 0) {
    notes.push(
      `ticketfairy: ${noPointOutsideAreaCount} events with no venue point outside the source's area`,
    );
  }
  return { listings, notes };
}

export const ticketfairyAdapter: SourceAdapter = {
  id: "ticketfairy",
  tier: "A",
  limits: { perDomainIntervalMs: TICKETFAIRY_INTERVAL_MS },
  async harvest(source: Source, ctx: RunCtx): Promise<HarvestResult> {
    const url = source.feedUrl ?? source.url;
    const { state, city } = getQueryParamsFromUrl(url); // throws when the source has no country

    // Check robots.txt
    const policy = await ctx.http.robots("https://www.ticketfairy.com/");
    if (!policy.isAllowed("/api/v1/events/listing")) {
      throw new Error(
        policy.unreadable
          ? `ticketfairy: robots.txt unreadable (${policy.unreadable}); not read`
          : `ticketfairy: robots.txt disallows /api/v1/events/listing (rule: ${policy.ruleFor("/api/v1/events/listing") ?? "unknown"})`,
      );
    }

    const fromNight = currentNightDate(ctx.now(), ctx.metro.tz);
    const toNight = addCalendarDays(fromNight, TICKETFAIRY_DAYS - 1);

    const allListings: HarvestedListing[] = [];
    const allNotes: string[] = ["robots.txt allows /api/v1/events/listing"];
    let totalEvents = 0;
    let pagesRead = 0;
    let cursor: string | null = null;

    do {
      const queryUrl = ticketfairyQueryUrl(
        url,
        fromNight,
        toNight,
        ctx.metro.tz,
        cursor ?? undefined,
      );
      let response;
      try {
        response = await ctx.http.request({
          url: queryUrl,
          purpose: "api",
          intervalMs: TICKETFAIRY_INTERVAL_MS,
          maxBytes: 5 * 1024 * 1024,
          headers: { accept: "application/json" },
        });
      } catch (err) {
        if (err instanceof HttpError && typeof err.status === "number") {
          throw new Error(`ticketfairy: download failed (HTTP ${err.status})`);
        }
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`ticketfairy: download failed (${message})`);
      }

      if (response.status < 200 || response.status >= 300) {
        throw new Error(`ticketfairy: download failed (HTTP ${response.status})`);
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(response.body);
      } catch {
        throw new Error("ticketfairy: unexpected body");
      }

      if (!isObject(parsed) || parsed.success !== true) {
        throw new Error("ticketfairy: unexpected body");
      }

      const data = parsed.data;
      if (!isObject(data) || !Array.isArray(data.events)) {
        throw new Error("ticketfairy: unexpected body");
      }

      const events = data.events;
      totalEvents += events.length;
      pagesRead++;

      const { listings, notes } = ticketfairyToListings(events, ctx, {
        fetchedAt: response.fetchedAt,
        fromNight,
        days: TICKETFAIRY_DAYS,
        state,
        city,
      });
      allListings.push(...listings);
      allNotes.push(...notes);

      const pagination = isObject(data.pagination) ? data.pagination : {};
      cursor = typeof pagination.nextCursor === "string" ? pagination.nextCursor : null;

      if (pagesRead >= TICKETFAIRY_MAX_PAGES) {
        allNotes.push("ticketfairy: stopped after 10 pages");
        break;
      }
    } while (cursor !== null);

    const styledListings = allListings.map((l) => withSourceStyle(l, source.styles));
    const contentHash = sha256(
      JSON.stringify(styledListings.map((l) => [l.externalId, l.listing])),
    );
    const doc = {
      url,
      fetchedAt: ctx.now(),
      httpStatus: 200,
      etag: null,
      lastModified: null,
      contentHash,
      cleanedText: null,
    };

    const resultNotes = [
      `ticketfairy: ${totalEvents} events read, ${allListings.length} listings`,
      ...allNotes,
    ];
    if (allListings.length === 0) {
      resultNotes.push("ticketfairy: no listings in the window");
    }

    const result: HarvestResult = {
      listings: styledListings,
      notes: resultNotes,
      doc,
      whole: true,
    };
    return result;
  },
};
