// Wix Events widget pages (Rio de Janeiro: Carioca da Gema, Rio Scenarium): the `wix_events` adapter.
// The page's <script type="application/json" id="wix-warmup-data"> holds each event list with its places,
// so no event page needs to be fetched. Event-detail links redirect (302), so the page's own JSON is the
// only readable source.

import { isoToLocal, sha256, type LocalMoment, plainText } from "@/src/adapters/shared";

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
import { buildListing, type StructuredEvent } from "@/src/adapters/structured";
import { withSourceStyle } from "@/src/adapters/feeds/event-pages";
import { currencyForCountry } from "@/src/domain/prices";
import { addCalendarDays } from "@/src/domain/time";
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

interface WixEvent {
  id: string;
  title: string;
  slug: string;
  status: number;
  description: string | null;
  scheduling: {
    config: {
      scheduleTbd: boolean;
      startDate: string;
      endDate: string | null;
      timeZoneId: string;
      endDateHidden: boolean;
    };
    formatted: string;
  };
  location: {
    name: string;
    address: string;
    coordinates: { lat: number; lng: number } | null;
  } | null;
}

function findEventsInObject(obj: unknown): WixEvent[] {
  const events: WixEvent[] = [];
  const seenIds = new Set<string>();

  function walk(current: unknown): void {
    // Recursively walk through arrays
    if (Array.isArray(current)) {
      for (const item of current) {
        walk(item);
      }
      return;
    }

    if (!isObject(current)) return;

    // Check if this object looks like a Wix event
    const scheduling = isObject(current.scheduling) ? current.scheduling : null;
    const config = scheduling && isObject(scheduling.config) ? scheduling.config : null;
    if (typeof current.title === "string" && config && typeof config.startDate === "string") {
      const id = typeof current.id === "string" ? current.id : "";
      if (id && !seenIds.has(id)) {
        seenIds.add(id);
        events.push({
          id,
          title: current.title,
          slug: typeof current.slug === "string" ? current.slug : "",
          status: typeof current.status === "number" ? current.status : 0,
          description: typeof current.description === "string" ? current.description : null,
          scheduling: {
            config: {
              scheduleTbd: Boolean(config.scheduleTbd),
              startDate: config.startDate,
              endDate: typeof config.endDate === "string" ? config.endDate : null,
              timeZoneId: typeof config.timeZoneId === "string" ? config.timeZoneId : "",
              endDateHidden: Boolean(config.endDateHidden),
            },
            formatted: typeof scheduling?.formatted === "string" ? scheduling.formatted : "",
          },
          location: isObject(current.location)
            ? {
                name: typeof current.location.name === "string" ? current.location.name : "",
                address:
                  typeof current.location.address === "string" ? current.location.address : "",
                coordinates: isObject(current.location.coordinates)
                  ? {
                      lat: Number(current.location.coordinates.lat),
                      lng: Number(current.location.coordinates.lng),
                    }
                  : null,
              }
            : null,
        });
      }
    }

    // Recursively walk through object properties
    for (const key in current) {
      walk(current[key]);
    }
  }

  walk(obj);
  return events;
}

export function parseWixEvents(html: string): WixEvent[] | null {
  // Extract the wix-warmup-data script
  const scriptRegex =
    /<script[^>]*type="application\/json"[^>]*id="wix-warmup-data"[^>]*>([\s\S]*?)<\/script>/i;
  const match = scriptRegex.exec(html);
  if (!match) {
    return null;
  }

  const scriptContent = (match[1] ?? "").trim();
  if (!scriptContent) {
    return null;
  }

  try {
    const data = JSON.parse(scriptContent);
    const events = findEventsInObject(data);
    return events;
  } catch {
    return null;
  }
}

function trimAll(str: string | null | undefined): string | null {
  if (str == null) return null;
  return str.trim();
}

export const wixEventsAdapter: SourceAdapter = {
  id: "wix_events",
  tier: "A",
  limits: { perDomainIntervalMs: CRAWL_INTERVAL_MS },
  async harvest(source: Source, ctx: RunCtx): Promise<HarvestResult> {
    const url = source.feedUrl ?? source.url;
    const tz = ctx.metro.tz;
    const fromNight = currentNightDate(ctx.now(), tz);
    const lastNight = addCalendarDays(fromNight, MATERIALIZE_DAYS - 1);

    const page = await ctx.http.request({
      url,
      purpose: "crawl",
      headers: { accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1" },
    });

    const events = parseWixEvents(page.body);
    if (events === null) {
      throw new Error("the page carries no Wix warmup data");
    }

    const listings: HarvestedListing[] = [];
    const notes: string[] = [];
    const seenIds = new Set<string>();
    let eventsOutsideWindow = 0;
    let eventsNoDateYet = 0;
    let eventsNoPlace = 0;

    for (const event of events) {
      if (event.scheduling.config.scheduleTbd) {
        eventsNoDateYet++;
        continue;
      }

      const eventId = `wix:${event.id}`;
      if (seenIds.has(eventId)) continue;
      seenIds.add(eventId);

      // Determine timezone
      const eventTz = event.scheduling.config.timeZoneId || tz;

      // Parse start
      const start = isoToLocal(event.scheduling.config.startDate, eventTz);
      if (!start) continue;

      if (start.night < fromNight || start.night > lastNight) {
        eventsOutsideWindow++;
        continue;
      }

      // Check if event has a valid place
      const hasPlace =
        event.location &&
        (trimAll(event.location.name) ||
          trimAll(event.location.address) ||
          (event.location.coordinates &&
            Number.isFinite(event.location.coordinates.lat) &&
            Number.isFinite(event.location.coordinates.lng)));

      if (!hasPlace) {
        eventsNoPlace++;
        continue;
      }

      // Parse end if available and not hidden
      let end: LocalMoment | null = null;
      if (!event.scheduling.config.endDateHidden && event.scheduling.config.endDate && start.time) {
        const endMoment = isoToLocal(event.scheduling.config.endDate, eventTz);
        if (endMoment && endMoment.night === start.night) {
          end = endMoment;
        }
      }

      const venueName = trimAll(event.location?.name);
      const venueAddress = trimAll(event.location?.address);
      let venueLocation = null;
      if (
        event.location?.coordinates?.lat != null &&
        event.location?.coordinates?.lng != null &&
        Number.isFinite(event.location.coordinates.lat) &&
        Number.isFinite(event.location.coordinates.lng)
      ) {
        venueLocation = {
          lat: event.location.coordinates.lat,
          lng: event.location.coordinates.lng,
        };
      }

      const structured: StructuredEvent = {
        externalId: eventId,
        title: event.title.trim(),
        start,
        end,
        description: plainText(event.description),
        venue: {
          name: venueName,
          address: venueAddress,
          url: null,
          location: venueLocation,
        },
        organizer: { name: null, url: null },
        prices: null,
        ticketUrl: null,
        eventUrl: page.url || url,
        cancelled: false,
      };

      const currency = currencyForCountry(ctx.metro.countryCode);
      const built = buildListing(structured, {
        sourceUrl: page.url || url,
        fetchedAt: page.fetchedAt,
        method: "feed",
        currency,
      });
      const styled = withSourceStyle(built, source.styles);
      listings.push(styled);
    }

    if (eventsNoDateYet > 0) {
      notes.push(`${eventsNoDateYet} event(s) with no date yet left out`);
    }
    if (eventsOutsideWindow > 0) {
      notes.push(`${eventsOutsideWindow} event(s) after the window or before tonight left out`);
    }
    if (eventsNoPlace > 0) {
      notes.push(`${eventsNoPlace} event(s) in the window name no place; left out`);
    }

    const doc = {
      url: page.url || url,
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
      whole: true as const,
    };

    return result;
  },
};
