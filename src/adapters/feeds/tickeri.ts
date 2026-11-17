// Tickeri's list pages: the Latin community's ticket site for New York, New Jersey and Connecticut.
// The page's __NEXT_DATA__ script holds Apollo state with Event and Venue entries, so no event page
// needs to be fetched. robots.txt allows /local/ (only /search, /api/, /checkout, /promoter are
// disallowed). Owner's answer 2026-10-25: add it.

import { isoToLocal, sha256, type LocalMoment } from "@/src/adapters/shared";
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

interface TickeriEvent {
  id: string;
  url: string;
  name: string;
  eventDate: {
    date: {
      isoDateTime: string;
      localDate: string;
      localTime: string;
    };
    endDate: {
      isoDateTime: string;
      localDate: string;
      localTime: string;
    } | null;
  };
  venue: {
    __ref: string;
  };
}

interface TickeriVenue {
  id: string;
  name: string | null;
  location: {
    lat: number;
    long: number;
  } | null;
  address: {
    street: string | null;
    city: string | null;
    postal: string | null;
    regionShort: string | null;
  } | null;
}

function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function obj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function parsePage(
  html: string,
): { events: TickeriEvent[]; venues: Map<string, TickeriVenue> } | null {
  const scriptMatch = html.match(
    /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/,
  );
  if (!scriptMatch) {
    return null;
  }
  let data: unknown;
  try {
    data = JSON.parse(scriptMatch[1] ?? "");
  } catch {
    return null;
  }
  const root = obj(data);
  const props = root && obj(root.props);
  const pageProps = props && obj(props.pageProps);
  const apolloState = pageProps && obj(pageProps.apolloState);
  if (!apolloState) {
    return null;
  }

  const events: TickeriEvent[] = [];
  const venues = new Map<string, TickeriVenue>();

  for (const [key, value] of Object.entries(apolloState)) {
    const val = obj(value);
    if (!val) continue;

    if (key.startsWith("Event:")) {
      const typename = str(val.__typename);
      if (typename !== "Event") continue;
      const url = str(val.url);
      const name = str(val.name);
      const eventDate = obj(val.eventDate);
      const date = eventDate && obj(eventDate.date);
      const isoDateTime = date && str(date.isoDateTime);
      if (!url || !name || !isoDateTime) continue;

      const endDate = eventDate && obj(eventDate.endDate);
      events.push({
        id: str(val.id) || key,
        url,
        name,
        eventDate: {
          date: {
            isoDateTime,
            localDate: str(date.localDate) || "",
            localTime: str(date.localTime) || "",
          },
          endDate: endDate
            ? {
                isoDateTime: str(endDate.isoDateTime) || "",
                localDate: str(endDate.localDate) || "",
                localTime: str(endDate.localTime) || "",
              }
            : null,
        },
        venue: { __ref: str(obj(val.venue)?.__ref) ?? "" },
      });
    } else if (key.startsWith("Venue:")) {
      const typename = str(val.__typename);
      if (typename !== "Venue") continue;
      const name = str(val.name);
      const location = obj(val.location);
      const address = obj(val.address);
      venues.set(key, {
        id: str(val.id) || key,
        name,
        location: location
          ? {
              lat: num(location.lat) ?? 0,
              long: num(location.long) ?? 0,
            }
          : null,
        address: address
          ? {
              street: str(address.street),
              city: str(address.city),
              postal: str(address.postal),
              regionShort: str(address.regionShort),
            }
          : null,
      });
    }
  }

  return { events, venues };
}

function trimAll(str: string | null | undefined): string | null {
  if (str == null) return null;
  return str.trim();
}

function buildAddress(address: TickeriVenue["address"]): string | null {
  if (!address) return null;
  const parts = [
    trimAll(address.street),
    trimAll(address.city),
    address.regionShort
      ? `${trimAll(address.regionShort)} ${trimAll(address.postal)}`.trim()
      : trimAll(address.postal),
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : null;
}

export const tickeriAdapter: SourceAdapter = {
  id: "tickeri",
  tier: "A",
  limits: { perDomainIntervalMs: CRAWL_INTERVAL_MS },
  async harvest(source: Source, ctx: RunCtx): Promise<HarvestResult> {
    const base = source.feedUrl ?? source.url;
    const fromNight = currentNightDate(ctx.now(), ctx.metro.tz);
    const lastNight = addCalendarDays(fromNight, MATERIALIZE_DAYS - 1);

    const listings: HarvestedListing[] = [];
    const notes: string[] = [];
    let pageNum = 1;
    let whole = false;
    let firstPageUrl = "";
    let firstPageFetchedAt = new Date();
    let firstPageStatus = 200;
    let firstPageEtag: string | null = null;
    let firstPageLastModified: string | null = null;

    const seenUrls = new Set<string>();
    const eventsOutsideWindow: string[] = [];

    while (pageNum <= 40) {
      const url = base.includes("?") ? `${base}&page=${pageNum}` : `${base}?page=${pageNum}`;
      const page = await ctx.http.request({
        url,
        purpose: "crawl",
        headers: { accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1" },
      });
      if (pageNum === 1) {
        firstPageUrl = page.url || url;
        firstPageFetchedAt = page.fetchedAt;
        firstPageStatus = page.status;
        firstPageEtag = page.etag;
        firstPageLastModified = page.lastModified;
      }

      const parsed = parsePage(page.body);
      if (!parsed) {
        if (pageNum === 1) {
          throw new Error("Tickeri's page carries no event data");
        }
        notes.push(`page ${pageNum} carries no event data; read stopped`);
        break;
      }

      const { events, venues } = parsed;

      if (events.length === 0) {
        whole = true;
        break;
      }

      let hasEventPastWindow = false;
      for (const event of events) {
        const eventDate = event.eventDate.date.localDate;
        if (eventDate > lastNight) {
          hasEventPastWindow = true;
        }

        if (!event.url || !event.name || !event.eventDate.date.isoDateTime) {
          continue;
        }

        if (seenUrls.has(event.url)) {
          continue;
        }

        if (eventDate < fromNight || eventDate > lastNight) {
          eventsOutsideWindow.push(event.name);
          continue;
        }

        const startMoment = isoToLocal(event.eventDate.date.isoDateTime, ctx.metro.tz);
        if (!startMoment) {
          continue;
        }

        let endMoment: LocalMoment | null = null;
        if (event.eventDate.endDate?.isoDateTime) {
          const startInstant = new Date(event.eventDate.date.isoDateTime);
          const endInstant = new Date(event.eventDate.endDate.isoDateTime);
          if (!isNaN(startInstant.getTime()) && !isNaN(endInstant.getTime())) {
            const diffHours = (endInstant.getTime() - startInstant.getTime()) / (1000 * 60 * 60);
            if (diffHours > 0 && diffHours <= 24) {
              endMoment = isoToLocal(event.eventDate.endDate.isoDateTime, ctx.metro.tz);
            }
          }
        }

        const venueRef = event.venue?.__ref;
        const venue = venueRef ? venues.get(venueRef) : null;
        const venueName = trimAll(venue?.name);
        const venueAddress = venue?.address ? buildAddress(venue.address) : null;
        let venueLocation = null;
        if (
          venue?.location &&
          typeof venue.location.lat === "number" &&
          typeof venue.location.long === "number" &&
          Number.isFinite(venue.location.lat) &&
          Number.isFinite(venue.location.long)
        ) {
          venueLocation = { lat: venue.location.lat, lng: venue.location.long };
        }

        const structured: StructuredEvent = {
          externalId: event.url,
          title: trimAll(event.name) || "",
          start: startMoment,
          end: endMoment,
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
          eventUrl: event.url,
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
        seenUrls.add(event.url);
      }

      if (hasEventPastWindow) {
        whole = true;
        break;
      }

      pageNum++;
    }

    if (pageNum > 40) {
      notes.push("read the first 40 pages only");
    }

    if (eventsOutsideWindow.length > 0) {
      const unique = [...new Set(eventsOutsideWindow)].length;
      notes.push(`${unique} event(s) after the window or before tonight left out`);
    }

    const doc = {
      url: firstPageUrl,
      fetchedAt: firstPageFetchedAt,
      httpStatus: firstPageStatus,
      etag: firstPageEtag,
      lastModified: firstPageLastModified,
      contentHash: sha256(JSON.stringify(listings.map((l) => [l.externalId, l.listing]))),
      cleanedText: null,
    };

    const result: HarvestResult = {
      listings,
      notes,
      doc,
    };
    if (whole) {
      result.whole = true as const;
    }

    return result;
  },
};
