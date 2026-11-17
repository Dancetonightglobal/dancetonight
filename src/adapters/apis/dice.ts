// DICE browse pages (D-139; London D-197): the `dice` adapter.
// DICE's robots.txt allows everything except `/api/`. Its city browse pages are server-rendered
// and carry their events as JSON in `<script id="__NEXT_DATA__" type="application/json">`.
// We read only those pages, through the polite client, never `/api/`, never pagination cursors.
// A genre page with too few events redirects to the city's whole list (307, seen in Lisbon
// 2026-10-29); that read gives no listings and is whole, so rows it wrote before are retired.
//
// Fields read: id, name, status, dates.timezone, dates.event_start_date, dates.event_end_date,
// venues[0].name, venues[0].address, price.currency, price.amount, price.amount_from.

import { withSourceStyle } from "@/src/adapters/feeds/event-pages";
import { isoToLocal, plainText, sha256 } from "@/src/adapters/shared";
import { buildListing, inWindow } from "@/src/adapters/structured";
import type {
  HarvestedListing,
  HarvestResult,
  RunCtx,
  Source,
  SourceAdapter,
} from "@/src/adapters/types";
import type { ListingPrice } from "@/src/domain/listing";
import { MATERIALIZE_DAYS } from "@/src/domain/recurrence";
import { isValidZone } from "@/src/domain/time";
import { currentNightDate } from "@/src/domain/tonight";
import { CRAWL_INTERVAL_MS } from "@/src/pipeline/http";

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Finds the events array in the __NEXT_DATA__ script. Never throws. */
export function diceEventsFromPage(html: string): unknown[] {
  const match = html.match(
    /<script[^>]*id="__NEXT_DATA__"[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/i,
  );
  if (!match) return [];
  const jsonText = match[1];
  if (jsonText === undefined) return [];
  try {
    const data = JSON.parse(jsonText);
    if (!isObject(data)) return [];
    const props = data.props;
    if (!isObject(props)) return [];
    const pageProps = props.pageProps;
    if (!isObject(pageProps)) return [];
    const events = pageProps.events;
    return Array.isArray(events) ? events : [];
  } catch {
    return [];
  }
}

export interface DiceOptions {
  fetchedAt: Date;
  metroTz: string;
  fromNight: string;
  days?: number;
  pageUrl: string;
}

export function diceToListings(
  events: unknown[],
  options: DiceOptions,
): { listings: HarvestedListing[]; notes: string[] } {
  const days = options.days ?? MATERIALIZE_DAYS;
  const listings: HarvestedListing[] = [];
  const notes: string[] = [];

  for (const raw of events) {
    if (!isObject(raw)) continue;
    const id = typeof raw.id === "string" ? raw.id.trim() : null;
    const name = plainText(raw.name);
    if (!id || !name) continue;

    const status = typeof raw.status === "string" ? raw.status : null;
    const cancelled = status === "cancelled" || status === "postponed";

    const dates = isObject(raw.dates) ? raw.dates : {};
    const zoneRaw = typeof dates.timezone === "string" ? dates.timezone : null;
    const zone = zoneRaw && isValidZone(zoneRaw) ? zoneRaw : options.metroTz;

    const start = isoToLocal(dates.event_start_date, zone);
    if (!start) {
      notes.push(`no readable start: ${name}`);
      continue;
    }
    if (!inWindow(start.night, options.fromNight, days)) continue;

    const end = isoToLocal(dates.event_end_date, zone);

    // Venue
    const venues = Array.isArray(raw.venues) ? raw.venues : [];
    const venueObj = venues.find(isObject);
    const venueName = venueObj && typeof venueObj.name === "string" ? venueObj.name.trim() : null;
    const address =
      venueObj && typeof venueObj.address === "string" ? venueObj.address.trim() : null;

    // Prices
    const price = isObject(raw.price) ? raw.price : {};
    const currencyRaw = typeof price.currency === "string" ? price.currency.toUpperCase() : "USD";
    const currency = /^[A-Z]{3}$/.test(currencyRaw) ? currencyRaw : "USD";
    const amount = typeof price.amount === "number" ? price.amount : null;
    const amountFrom = typeof price.amount_from === "number" ? price.amount_from : null;

    // Cents. A fixed price is "Tickets", a lowest one "From"; zero either way is free.
    const cents = amount ?? amountFrom;
    const label = cents === 0 ? "Free" : amount !== null ? "Tickets" : "From";
    const prices: ListingPrice[] | null =
      cents === null ? null : [{ label, amount: cents / 100, currency, includes: null }];

    const eventUrl = `https://dice.fm/event/${id}`;
    const evidence: Record<string, string> = {
      start: `dates.event_start_date ${String(dates.event_start_date)} ${zone}`.slice(0, 300),
    };
    if (cancelled) {
      evidence.cancelled = `status ${status}`;
    }

    listings.push(
      buildListing(
        {
          externalId: `dice:${id}`,
          title: name,
          start,
          end: end && end.time && end.night === start.night ? end : null,
          description: null,
          venue: {
            name: venueName,
            address,
            url: null,
            location: null,
          },
          organizer: { name: null, url: null },
          prices,
          ticketUrl: eventUrl,
          eventUrl,
          cancelled,
          styles: [],
          evidence,
        },
        {
          sourceUrl: eventUrl,
          fetchedAt: options.fetchedAt,
          // Structured data from the page (__NEXT_DATA__), not a documented API.
          method: "jsonld",
          currency,
        },
      ),
    );
  }
  return { listings, notes };
}

export const diceAdapter: SourceAdapter = {
  id: "dice",
  tier: "D",
  countries: ["US", "GB", "ES", "PT", "DE", "FR"],
  limits: { perDomainIntervalMs: CRAWL_INTERVAL_MS },
  async harvest(source: Source, ctx: RunCtx): Promise<HarvestResult> {
    const url = source.feedUrl ?? source.url;
    const response = await ctx.http.request({
      url,
      purpose: "crawl",
      headers: { accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1" },
    });
    const requestPath = new URL(url).pathname.replace(/\/$/, "");
    const finalPath = response.url
      ? new URL(response.url).pathname.replace(/\/$/, "")
      : requestPath;
    if (response.url && finalPath.toLowerCase() !== requestPath.toLowerCase()) {
      // Only a move to another list of the same city is a sparse genre; anything else fails the read.
      const cityPrefix = /^\/browse\/[^/]+/i.exec(requestPath)?.[0]?.toLowerCase();
      if (!cityPrefix || !finalPath.toLowerCase().startsWith(`${cityPrefix}/`)) {
        throw new Error(`DICE redirected ${requestPath} to ${response.url}`);
      }
      const doc = {
        url,
        fetchedAt: response.fetchedAt,
        httpStatus: response.status,
        etag: response.etag,
        lastModified: response.lastModified,
        contentHash: sha256("[]"),
        cleanedText: null,
      };
      return {
        listings: [],
        notes: [`DICE sent this list to ${finalPath}: no events of its own (a sparse genre)`],
        doc,
        // It truthfully lists nothing: the ingest retires rows an earlier read of the redirect wrote.
        whole: true,
      };
    }
    const events = diceEventsFromPage(response.body);
    const fromNight = currentNightDate(ctx.now(), ctx.metro.tz);
    const { listings, notes } = diceToListings(events, {
      fetchedAt: response.fetchedAt,
      metroTz: ctx.metro.tz,
      fromNight,
      pageUrl: response.url || url,
    });
    const styledListings = listings.map((l) => withSourceStyle(l, source.styles));
    const contentHash = sha256(
      JSON.stringify(styledListings.map((l) => [l.externalId, l.listing])),
    );
    const doc = {
      url,
      fetchedAt: response.fetchedAt,
      httpStatus: response.status,
      etag: response.etag,
      lastModified: response.lastModified,
      contentHash,
      cleanedText: null,
    };
    if (events.length === 0) {
      return {
        listings: [],
        notes: ["no DICE event data on the page", ...notes],
        doc,
      };
    }
    return {
      listings: styledListings,
      notes: [`${events.length} event(s) on the page`, ...notes],
      doc,
    };
  },
};
