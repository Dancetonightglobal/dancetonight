// Viewcy's search and organiser pages: a ticket site for small arts and community events.
// The page's self.__next_f.push scripts (Next.js flight data) hold each event list with its places,
// so no event page needs to be fetched. robots.txt allows /discover and profile pages (disallows /auth, /login,
// /tickets, /registrations, /manage). Owner's answer 2026-10-25: add it.

import { isoToLocal, sha256, type LocalMoment, httpUrl } from "@/src/adapters/shared";
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

interface ViewcyEvent {
  id: string;
  name: string;
  url: string;
  startsAt: string;
  endsAt: string | null;
  location: {
    name: string | null;
    address: string | null;
    city: string | null;
    state: string | null;
    zipcode: string | null;
    latitude: number | null;
    longitude: number | null;
  } | null;
}

interface ViewcyEventList {
  data: ViewcyEvent[];
  page: number;
  totalPages: number;
  perPage: number;
  totalCount: number;
  hasNextPage: boolean;
}

function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function obj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
}

function arr(v: unknown): unknown[] | null {
  return Array.isArray(v) ? v : null;
}

function parsePage(html: string): { lists: ViewcyEventList[] } | null {
  // Collect all self.__next_f.push([1,"..."]) scripts
  const regex = /self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g;
  const matches: string[] = [];
  let match;
  while ((match = regex.exec(html)) !== null) {
    const quoted = match[1];
    if (!quoted) continue;
    try {
      const jsonString = JSON.parse(quoted);
      if (typeof jsonString === "string") {
        matches.push(jsonString);
      }
    } catch {
      // Skip invalid JSON
    }
  }

  if (matches.length === 0) {
    return null;
  }

  const joined = matches.join("");

  // Find event lists: search for "events":{"data":[ or "upcomingEvents":{"data":[
  const lists: ViewcyEventList[] = [];

  // Helper to extract JSON object from a starting position
  const extractObject = (text: string, startPos: number): string | null => {
    let pos = startPos;
    let braceCount = 0;
    let inString = false;
    let escapeNext = false;

    for (let i = pos; i < text.length; i++) {
      const char = text[i];

      if (escapeNext) {
        escapeNext = false;
        continue;
      }

      if (char === "\\") {
        escapeNext = true;
        continue;
      }

      if (char === '"' && !escapeNext) {
        inString = !inString;
        continue;
      }

      if (!inString) {
        if (char === "{") {
          if (braceCount === 0) {
            pos = i;
          }
          braceCount++;
        } else if (char === "}") {
          braceCount--;
          if (braceCount === 0) {
            return text.substring(pos, i + 1);
          }
        }
      }
    }
    return null;
  };

  // Search for both patterns
  const patterns = [
    { key: '"events":', listKey: "events" },
    { key: '"upcomingEvents":', listKey: "upcomingEvents" },
  ];

  for (const pattern of patterns) {
    let searchPos = 0;
    while (true) {
      const idx = joined.indexOf(pattern.key, searchPos);
      if (idx === -1) break;

      // Only an object that opens with its data list, right after the key, is an event list.
      const objStart = idx + pattern.key.length;
      if (!joined.startsWith('{"data":[', objStart)) {
        searchPos = idx + 1;
        continue;
      }

      const objText = extractObject(joined, objStart);
      if (objText) {
        try {
          const parsed = JSON.parse(objText);
          const data = arr(parsed.data);
          if (data) {
            const events: ViewcyEvent[] = [];
            for (const item of data) {
              const eventObj = obj(item);
              if (!eventObj) continue;

              const name = str(eventObj.name);
              const url = str(eventObj.url);
              const startsAt = str(eventObj.startsAt);
              if (!name || !url || !startsAt) continue;

              const locationObj = obj(eventObj.location);
              let location = null;
              if (locationObj) {
                location = {
                  name: str(locationObj.name),
                  address: str(locationObj.address),
                  city: str(locationObj.city),
                  state: str(locationObj.state),
                  zipcode: str(locationObj.zipcode),
                  latitude: num(locationObj.latitude),
                  longitude: num(locationObj.longitude),
                };
              }

              events.push({
                id: str(eventObj.id) || "",
                name,
                url,
                startsAt,
                endsAt: str(eventObj.endsAt),
                location,
              });
            }

            lists.push({
              data: events,
              page: num(parsed.page) ?? 1,
              totalPages: num(parsed.totalPages) ?? 1,
              perPage: num(parsed.perPage) ?? events.length,
              totalCount: num(parsed.totalCount) ?? events.length,
              hasNextPage: !!parsed.hasNextPage,
            });
          }
        } catch {
          // Skip invalid object
        }
      }
      searchPos = idx + 1;
    }
  }

  if (lists.length === 0) {
    return null;
  }

  return { lists };
}

function trimAll(str: string | null | undefined): string | null {
  if (str == null) return null;
  return str.trim();
}

function buildAddress(location: ViewcyEvent["location"]): string | null {
  if (!location) return null;

  const address = trimAll(location.address);
  const city = trimAll(location.city);
  const state = trimAll(location.state);
  const zipcode = trimAll(location.zipcode);

  const stateZip = [state, zipcode].filter(Boolean).join(" ").trim();

  const parts = [address, city, stateZip].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : null;
}

export const viewcyAdapter: SourceAdapter = {
  id: "viewcy",
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

    const parsed = parsePage(page.body);
    if (!parsed) {
      throw new Error("Viewcy's page carries no event list");
    }

    const listings: HarvestedListing[] = [];
    const notes: string[] = [];
    const seenIds = new Set<string>();
    let eventsOutsideWindow = 0;
    let eventsNoPlace = 0;
    let totalEventsInLists = 0;
    let totalCountInLists = 0;
    let allListsHaveNoNextPage = true;

    for (const list of parsed.lists) {
      totalEventsInLists += list.data.length;
      totalCountInLists += list.totalCount;
      if (list.hasNextPage) {
        allListsHaveNoNextPage = false;
      }

      for (const event of list.data) {
        const eventUrl = httpUrl(event.url, "https://www.viewcy.com");
        if (!eventUrl) continue;

        const externalId = `${eventUrl}#${event.startsAt}`;
        if (seenIds.has(externalId)) continue;
        seenIds.add(externalId);

        const start = isoToLocal(event.startsAt, tz);
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
            (event.location.latitude != null &&
              event.location.longitude != null &&
              Number.isFinite(event.location.latitude) &&
              Number.isFinite(event.location.longitude)));

        if (!hasPlace) {
          eventsNoPlace++;
          continue;
        }

        let end: LocalMoment | null = null;
        if (event.endsAt) {
          const endInstant = new Date(event.endsAt);
          const startInstant = new Date(event.startsAt);
          if (!isNaN(endInstant.getTime()) && !isNaN(startInstant.getTime())) {
            const diffHours = (endInstant.getTime() - startInstant.getTime()) / (1000 * 60 * 60);
            if (diffHours > 0 && diffHours <= 24) {
              end = isoToLocal(event.endsAt, tz);
            }
          }
        }

        const venueName = trimAll(event.location?.name);
        const venueAddress = buildAddress(event.location);
        let venueLocation = null;
        if (
          event.location?.latitude != null &&
          event.location?.longitude != null &&
          Number.isFinite(event.location.latitude) &&
          Number.isFinite(event.location.longitude)
        ) {
          venueLocation = { lat: event.location.latitude, lng: event.location.longitude };
        }

        const structured: StructuredEvent = {
          externalId,
          title: event.name.trim(),
          start,
          end,
          description: null,
          venue: {
            name: venueName,
            address: venueAddress,
            url: null,
            location: venueLocation,
          },
          organizer: { name: null, url: null },
          prices: null,
          ticketUrl: null,
          eventUrl: eventUrl,
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
    }

    if (eventsOutsideWindow > 0) {
      notes.push(`${eventsOutsideWindow} event(s) after the window or before tonight left out`);
    }
    if (eventsNoPlace > 0) {
      notes.push(`${eventsNoPlace} event(s) in the window name no place; left out`);
    }

    if (!allListsHaveNoNextPage && totalEventsInLists > 0) {
      notes.push(`read the first ${totalEventsInLists} of ${totalCountInLists} events listed`);
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
    };
    if (allListsHaveNoNextPage) {
      result.whole = true as const;
    }

    return result;
  },
};
