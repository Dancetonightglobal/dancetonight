// Sympla city list page and each event page's embedded Next.js data (D-421).
// Reads public pages only, respecting robots.txt (User-agent: * Allow: /).

import {
  decodeEntities,
  httpUrl,
  isoToLocal,
  sha256,
  type LocalMoment,
  plainText,
} from "@/src/adapters/shared";
import { HttpError } from "@/src/pipeline/http";
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

export const MAX_LIST_PAGES = 6;
const MAX_EVENT_PAGES = 80;

/** Sympla's own categories that are never dance nights (Rio, 2026-10-29: a Halloween food menu was listed).
 * Not "curso-workshop": Rio's dance workshops are filed there (2026-10-29). */
export const NON_DANCE_CATEGORY_SLUGS: ReadonlySet<string> = new Set([
  "gastronomia-comidas-e-bebidas",
  "congresso-palestra",
  "religioso-espiritual",
  "infantil",
  "saude-e-bem-estar",
  "teatro-espetaculo",
  "stand-up-comedy",
]);

export interface SymplaListItem {
  id: number;
  name: string;
  url: string;
  start_date: string;
  end_date?: string;
  organizer?: { name?: string };
  location?: {
    name?: string;
    address?: string;
    address_num?: string;
    neighborhood?: string;
    city?: string;
    state?: string;
    zip_code?: string;
    lat?: number;
    lon?: number;
  };
}

/** Sympla's list data is third-party JSON: keep the organiser only when it is an object with a string name. */
function listOrganizer(value: unknown): SymplaListItem["organizer"] {
  if (typeof value !== "object" || value === null) return undefined;
  const name = (value as Record<string, unknown>).name;
  return typeof name === "string" ? { name } : undefined;
}

/** Copies each location field only when it has the expected type (strings, and numbers for lat/lon). */
function listLocation(value: unknown): SymplaListItem["location"] {
  if (typeof value !== "object" || value === null) return undefined;
  const o = value as Record<string, unknown>;
  const out: NonNullable<SymplaListItem["location"]> = {};
  for (const key of [
    "name",
    "address",
    "address_num",
    "neighborhood",
    "city",
    "state",
    "zip_code",
  ] as const) {
    const v = o[key];
    if (typeof v === "string") out[key] = v;
  }
  if (typeof o.lat === "number") out.lat = o.lat;
  if (typeof o.lon === "number") out.lon = o.lon;
  return out;
}

export function listSearchData(
  html: string,
): { items: SymplaListItem[]; total: number | null; limit: number | null } | null {
  // Find all flight script chunks
  const flightRegex = /<script[^>]*>self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)<\/script>/gi;
  const chunks: string[] = [];
  let match;
  while ((match = flightRegex.exec(html)) !== null) {
    const chunk = match[1];
    if (chunk === undefined) continue;
    try {
      // The chunk is a JSON string literal inside the push call
      const decoded = JSON.parse('"' + chunk + '"');
      if (typeof decoded === "string") {
        chunks.push(decoded);
      }
    } catch {
      // skip invalid chunk
    }
  }
  const joined = chunks.join("");
  const searchIdx = joined.indexOf('"searchDataResult":');
  if (searchIdx === -1) return null;
  // Find the opening brace after the colon
  let bracePos = searchIdx + '"searchDataResult":'.length;
  while (bracePos < joined.length && joined[bracePos] !== "{") {
    bracePos++;
  }
  if (bracePos >= joined.length) return null;
  // Parse balanced JSON object with string-aware scanning
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let i = bracePos; i < joined.length; i++) {
    const ch = joined[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (!inString) {
      if (ch === "{") {
        if (depth === 0) start = i;
        depth++;
      } else if (ch === "}") {
        depth--;
        if (depth === 0 && start !== -1) {
          const slice = joined.slice(start, i + 1);
          try {
            const data = JSON.parse(slice);
            if (data && Array.isArray(data.data)) {
              const items: SymplaListItem[] = [];
              for (const item of data.data) {
                if (
                  typeof item.id === "number" &&
                  typeof item.name === "string" &&
                  typeof item.url === "string" &&
                  typeof item.start_date === "string"
                ) {
                  items.push({
                    id: item.id,
                    name: item.name,
                    url: item.url,
                    start_date: item.start_date,
                    end_date: typeof item.end_date === "string" ? item.end_date : undefined,
                    organizer: listOrganizer(item.organizer),
                    location: listLocation(item.location),
                  });
                }
              }
              return {
                items,
                total: typeof data.total === "number" ? data.total : null,
                limit: typeof data.limit === "number" ? data.limit : null,
              };
            }
          } catch {
            // fall through
          }
          return null;
        }
      }
    }
  }
  return null;
}

interface SymplaEvent {
  id: number;
  name: string;
  startDateMultiFormat: { ISO8601: string };
  endDateMultiFormat?: { ISO8601: string };
  eventsAddress?: {
    name: string;
    address: string;
    addressNum: string;
    addressAlt: string;
    neighborhood: string;
    city: string;
    state: string;
    zipCode: string;
    geolocation?: { latitude: number; longitude: number };
  };
  eventsHost?: { name: string };
  eventsCategory?: { slug?: string | null } | null;
  cancelled: boolean;
  published: boolean;
  visible: boolean;
  privateEvent: boolean;
  onlineInfo: unknown;
  detail?: string;
  strippedDetail?: string;
  newUrl?: string;
}

function isSymplaEvent(obj: unknown): obj is SymplaEvent {
  if (typeof obj !== "object" || obj === null) return false;
  const o = obj as Record<string, unknown>;
  const startDateMultiFormat = o.startDateMultiFormat;
  if (typeof startDateMultiFormat !== "object" || startDateMultiFormat === null) return false;
  const startFormat = startDateMultiFormat as Record<string, unknown>;
  if (typeof startFormat.ISO8601 !== "string") return false;
  return (
    typeof o.id === "number" &&
    typeof o.name === "string" &&
    typeof o.cancelled === "boolean" &&
    typeof o.published === "boolean" &&
    typeof o.visible === "boolean" &&
    typeof o.privateEvent === "boolean"
  );
}

function extractEventFromNextData(html: string): SymplaEvent | null {
  const scriptRegex = /<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i;
  const match = scriptRegex.exec(html);
  if (!match) return null;
  const raw = match[1];
  if (raw === undefined) return null;
  try {
    const data = JSON.parse(raw);
    const event = data?.props?.pageProps?.hydrationData?.eventHydration?.event;
    if (isSymplaEvent(event)) {
      return event;
    }
  } catch {
    // fall through
  }
  return null;
}

function extractEventUrls(html: string, baseUrl: string): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();

  // Method 1: href attributes
  const hrefRegex = /href\s*=\s*["']([^"']*)["']/gi;
  let match;
  while ((match = hrefRegex.exec(html)) !== null) {
    const hrefMatch = match[1];
    if (hrefMatch === undefined) continue;
    const href = decodeEntities(hrefMatch);
    let resolved: string;
    try {
      const url = new URL(href, baseUrl);
      // Only accept http/https
      if (url.protocol !== "http:" && url.protocol !== "https:") continue;
      resolved = url.toString();
    } catch {
      continue;
    }
    const urlObj = new URL(resolved);
    const host = urlObj.hostname;
    // Accept both www.sympla.com.br and sympla.com.br
    if (
      (host === "www.sympla.com.br" || host === "sympla.com.br") &&
      urlObj.pathname.startsWith("/evento/")
    ) {
      // Path must be /evento/<slug>/<digits> (allow optional trailing slash or query)
      const pathMatch = urlObj.pathname.match(/^\/evento\/[^/]+\/\d+/);
      if (pathMatch) {
        const normalized = urlObj.toString();
        if (!seen.has(normalized)) {
          seen.add(normalized);
          urls.push(normalized);
        }
      }
    }
  }

  // Method 2: direct pattern matching for /evento/<slug>/<digits>
  const pathRegex = /\/evento\/[a-z0-9-]+\/\d+/gi;
  const pathMatches = html.match(pathRegex);
  if (pathMatches) {
    for (const path of pathMatches) {
      try {
        const url = new URL(path, baseUrl);
        if (url.protocol !== "http:" && url.protocol !== "https:") continue;
        const host = url.hostname;
        if (host !== "www.sympla.com.br" && host !== "sympla.com.br") continue;
        // Ensure the path matches the pattern (should already)
        if (!url.pathname.match(/^\/evento\/[^/]+\/\d+/)) continue;
        const normalized = url.toString();
        if (!seen.has(normalized)) {
          seen.add(normalized);
          urls.push(normalized);
        }
      } catch {
        // ignore
      }
    }
  }

  return urls;
}

function buildAddress(event: SymplaEvent): string | null {
  const addr = event.eventsAddress;
  if (!addr) return null;
  const parts: string[] = [];
  const street = addr.address?.trim();
  const num = addr.addressNum?.trim();
  const neighborhood = addr.neighborhood?.trim();
  const city = addr.city?.trim();
  const state = addr.state?.trim();
  const zipCode = addr.zipCode?.trim();

  // Build address line: "<address>, <addressNum>"
  if (street) {
    const streetLine = num ? `${street}, ${num}` : street;
    parts.push(streetLine);
  }
  // Add neighborhood with " - " prefix if present
  if (neighborhood) {
    parts.push(` - ${neighborhood}`);
  }
  // Add city and state: ", <city> - <state>"
  if (city && state) {
    parts.push(`, ${city} - ${state}`);
  } else if (city) {
    parts.push(`, ${city}`);
  } else if (state) {
    parts.push(`, ${state}`);
  }
  // Add zipCode: ", <zipCode>"
  if (zipCode) {
    parts.push(`, ${zipCode}`);
  }

  // If we have at least the street part, join them without extra separators
  if (parts.length > 0) {
    // The first part is the street line, subsequent parts already include their separators
    return parts.join("").replace(/^[\s,-]+/, "") || null;
  }
  return null;
}

export const symplaAdapter: SourceAdapter = {
  id: "sympla",
  tier: "A",
  limits: { perDomainIntervalMs: CRAWL_INTERVAL_MS },
  async harvest(source: Source, ctx: RunCtx): Promise<HarvestResult> {
    const url = source.feedUrl ?? source.url;
    const tz = ctx.metro.tz;
    const fromNight = currentNightDate(ctx.now(), tz);
    const lastNight = addCalendarDays(fromNight, MATERIALIZE_DAYS - 1);

    const listPage = await ctx.http.request({
      url,
      purpose: "crawl",
      headers: { accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1" },
    });

    // Initialize notes early
    const notes: string[] = [];

    // Determine if we should follow pagination
    const baseUrl = listPage.url || url;
    const urlObj = new URL(baseUrl);
    const host = urlObj.hostname;
    const path = urlObj.pathname;
    const shouldFollow =
      (host === "www.sympla.com.br" || host === "sympla.com.br") && path.startsWith("/eventos/");

    // Get start page number
    let startPage = 1;
    if (shouldFollow) {
      const pageParam = urlObj.searchParams.get("page");
      if (pageParam) {
        const parsed = parseInt(pageParam, 10);
        if (!isNaN(parsed) && parsed >= 1) {
          startPage = parsed;
        }
      }
    }

    // Collect event URLs from all pages
    const allEventUrls = new Set<string>();
    const biletoItems = new Map<number, SymplaListItem>();
    const pagesRead: string[] = [];
    let currentPage = startPage;
    let pageCountWithEvents = 0;
    let knownTotal: number | null = null;
    let knownLimit: number | null = null;

    const listPages = shouldFollow ? MAX_LIST_PAGES : 1;
    for (let i = 0; i < listPages; i++) {
      // Build page URL
      const pageUrl = new URL(baseUrl);
      pageUrl.searchParams.set("page", String(currentPage));
      const pageUrlStr = pageUrl.toString();

      let pageHtml: string;
      let pageFinalUrl: string;
      if (i === 0) {
        // First page is already fetched
        pageHtml = listPage.body;
        pageFinalUrl = baseUrl;
      } else {
        // Fetch subsequent pages
        try {
          const pageResp = await ctx.http.request({
            url: pageUrlStr,
            purpose: "crawl",
            headers: { accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1" },
          });
          pageHtml = pageResp.body;
          pageFinalUrl = pageResp.url || pageUrlStr;
        } catch {
          // Stop on any error
          break;
        }
      }

      const urlsBefore = allEventUrls.size;
      const biletoBefore = biletoItems.size;
      const urls = extractEventUrls(pageHtml, pageFinalUrl);
      for (const u of urls) {
        allEventUrls.add(u);
      }
      const searchData = listSearchData(pageHtml);
      if (searchData) {
        if (searchData.total !== null) knownTotal = searchData.total;
        if (searchData.limit !== null) knownLimit = searchData.limit;
        for (const item of searchData.items) {
          const url = httpUrl(item.url.trim(), pageFinalUrl);
          if (!url) continue;
          const urlObj = new URL(url);
          const host = urlObj.hostname;
          const path = urlObj.pathname;
          if (
            (host === "www.sympla.com.br" || host === "sympla.com.br") &&
            path.startsWith("/evento/")
          ) {
            allEventUrls.add(url);
          } else if (host === "bileto.sympla.com.br") {
            if (!biletoItems.has(item.id)) {
              biletoItems.set(item.id, item);
            }
          }
        }
      }

      pagesRead.push(pageUrlStr);

      const hadAnyNew = allEventUrls.size > urlsBefore || biletoItems.size > biletoBefore;
      if (hadAnyNew) {
        pageCountWithEvents++;
      }

      // Stop if this page added no new events (URLs or bileto items)
      if (!hadAnyNew) {
        break;
      }

      // Stop if we know total and limit and we've reached the last page
      if (knownTotal !== null && knownLimit !== null && knownLimit > 0) {
        const lastPage = Math.ceil(knownTotal / knownLimit);
        if (currentPage >= lastPage) {
          break;
        }
      }

      currentPage++;
    }

    const eventUrls = Array.from(allEventUrls);

    // Handle empty page A
    if (eventUrls.length === 0 && biletoItems.size === 0) {
      if (startPage >= 2) {
        const result: HarvestResult = {
          listings: [],
          notes: ["the page lists no Sympla event links (past the last page)"],
          doc: {
            url: baseUrl,
            fetchedAt: listPage.fetchedAt,
            httpStatus: listPage.status,
            etag: listPage.etag,
            lastModified: listPage.lastModified,
            contentHash: sha256(JSON.stringify([])),
            cleanedText: null,
          },
        };
        return result;
      } else {
        throw new Error("the page lists no Sympla event links");
      }
    }

    // Add note about list pages if we read more than one page
    if (pagesRead.length > 1) {
      notes.push(`read ${pageCountWithEvents} list page(s)`);
    }

    const listings: HarvestedListing[] = [];
    const toRead = eventUrls.slice(0, MAX_EVENT_PAGES);
    const over = eventUrls.length - MAX_EVENT_PAGES;
    if (over > 0) {
      notes.push(`${over} event page(s) after the first ${MAX_EVENT_PAGES} not read`);
    }

    let skippedNotPublic = 0;
    let skippedOnlineNoPlace = 0;
    let skippedOutsideWindow = 0;
    let skippedCategory = 0;
    let fetchFailures = 0;

    // Process bileto items
    const biletoProcessed = Array.from(biletoItems.values());
    const biletoInWindow: SymplaListItem[] = [];
    for (const item of biletoProcessed) {
      const startMoment = isoToLocal(item.start_date, tz);
      if (!startMoment) {
        skippedOutsideWindow++;
        continue;
      }
      if (startMoment.night < fromNight || startMoment.night > lastNight) {
        skippedOutsideWindow++;
        continue;
      }
      biletoInWindow.push(item);
    }

    if (biletoInWindow.length > 0) {
      notes.push(`${biletoInWindow.length} bileto event(s) read from the list data`);
    }

    for (const item of biletoInWindow) {
      let startMoment = isoToLocal(item.start_date, tz)!;
      let endMoment: LocalMoment | null = null;
      if (item.end_date) {
        const end = isoToLocal(item.end_date, tz);
        if (end && end.night === startMoment.night && end.time !== startMoment.time) {
          endMoment = end;
        }
        // Sympla's list data gives some nights start == end at 23:59 (Rio Scenarium): a placeholder,
        // not a time; keep the date, drop the time (coverage-80, 2026-10-31).
        if (
          end &&
          end.day === startMoment.day &&
          end.time === "23:59" &&
          startMoment.time === "23:59"
        ) {
          startMoment = { ...startMoment, time: null };
        }
      }

      const venueName = item.location?.name?.trim() || null;
      // Build address
      const addr = item.location;
      const street = addr?.address?.trim();
      const num = addr?.address_num?.trim();
      const neighborhood = addr?.neighborhood?.trim();
      const city = addr?.city?.trim();
      const state = addr?.state?.trim();
      const zipCode = addr?.zip_code?.trim();

      const parts: string[] = [];
      if (street) {
        const streetLine = num && num !== "0" && num !== "" ? `${street}, ${num}` : street;
        parts.push(streetLine);
      }
      if (neighborhood) {
        parts.push(` - ${neighborhood}`);
      }
      if (city && state) {
        parts.push(`, ${city} - ${state}`);
      } else if (city) {
        parts.push(`, ${city}`);
      } else if (state) {
        parts.push(`, ${state}`);
      }
      if (zipCode) {
        parts.push(`, ${zipCode}`);
      }
      const venueAddress = parts.length > 0 ? parts.join("").replace(/^[\s,-]+/, "") : null;

      let venueLocation = null;
      const lat = addr?.lat;
      const lon = addr?.lon;
      if (
        lat !== undefined &&
        lon !== undefined &&
        typeof lat === "number" &&
        typeof lon === "number" &&
        Number.isFinite(lat) &&
        Number.isFinite(lon) &&
        !(lat === 0 && lon === 0)
      ) {
        venueLocation = { lat, lng: lon };
      }

      const ticketUrl = httpUrl(item.url, baseUrl);
      if (!ticketUrl) continue;

      const structured: StructuredEvent = {
        externalId: `sympla-bileto:${item.id}`,
        title: item.name.trim(),
        start: startMoment,
        end: endMoment,
        description: null,
        venue: {
          name: venueName,
          address: venueAddress,
          url: null,
          location: venueLocation,
        },
        organizer: {
          name: item.organizer?.name?.trim() || null,
          url: null,
        },
        prices: null,
        ticketUrl,
        eventUrl: ticketUrl,
        cancelled: false,
      };

      const currency = currencyForCountry(ctx.metro.countryCode);
      const built = buildListing(structured, {
        sourceUrl: baseUrl,
        fetchedAt: listPage.fetchedAt,
        method: "feed",
        currency,
      });
      const styled = withSourceStyle(built, source.styles);
      listings.push(styled);
    }

    // Process /evento pages
    for (const eventUrl of toRead) {
      let eventPage;
      try {
        eventPage = await ctx.http.request({
          url: eventUrl,
          purpose: "crawl",
          headers: { accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1" },
        });
      } catch (error) {
        fetchFailures++;
        const why = error instanceof HttpError ? error.kind : "error";
        notes.push(`${eventUrl}: its page could not be read (${why})`);
        continue;
      }

      const event = extractEventFromNextData(eventPage.body);
      if (!event) {
        fetchFailures++;
        notes.push(`${eventUrl}: its page could not be read (no event data)`);
        continue;
      }

      // Skip conditions
      if (event.privateEvent || !event.published || !event.visible) {
        skippedNotPublic++;
        continue;
      }
      const categorySlug = event.eventsCategory?.slug?.trim().toLowerCase() ?? "";
      if (NON_DANCE_CATEGORY_SLUGS.has(categorySlug)) {
        skippedCategory++;
        continue;
      }
      if (event.onlineInfo !== null || !event.eventsAddress) {
        skippedOnlineNoPlace++;
        continue;
      }

      const startMoment = isoToLocal(event.startDateMultiFormat.ISO8601, tz);
      if (!startMoment) {
        skippedOutsideWindow++;
        continue;
      }
      if (startMoment.night < fromNight || startMoment.night > lastNight) {
        skippedOutsideWindow++;
        continue;
      }

      // Build end moment only if same night
      let endMoment: LocalMoment | null = null;
      if (event.endDateMultiFormat?.ISO8601) {
        const end = isoToLocal(event.endDateMultiFormat.ISO8601, tz);
        if (end && end.night === startMoment.night) {
          endMoment = end;
        }
      }

      const venueName = event.eventsAddress?.name?.trim() || null;
      const venueAddress = buildAddress(event);
      let venueLocation = null;
      const geo = event.eventsAddress?.geolocation;
      if (
        geo &&
        typeof geo.latitude === "number" &&
        typeof geo.longitude === "number" &&
        Number.isFinite(geo.latitude) &&
        Number.isFinite(geo.longitude)
      ) {
        venueLocation = { lat: geo.latitude, lng: geo.longitude };
      }

      const eventUrlFinal =
        event.newUrl && httpUrl(event.newUrl, eventUrl) ? event.newUrl : eventPage.url || eventUrl;

      const structured: StructuredEvent = {
        externalId: `sympla:${event.id}`,
        title: event.name.trim(),
        start: startMoment,
        end: endMoment,
        description: plainText(event.detail || event.strippedDetail),
        venue: {
          name: venueName,
          address: venueAddress,
          url: null,
          location: venueLocation,
        },
        organizer: {
          name: event.eventsHost?.name?.trim() || null,
          url: null,
        },
        prices: null,
        ticketUrl: eventUrlFinal,
        eventUrl: eventUrlFinal,
        cancelled: event.cancelled === true,
      };

      const currency = currencyForCountry(ctx.metro.countryCode);
      const built = buildListing(structured, {
        sourceUrl: eventPage.url || eventUrl,
        fetchedAt: eventPage.fetchedAt,
        method: "feed",
        currency,
      });
      const styled = withSourceStyle(built, source.styles);
      listings.push(styled);
    }

    if (skippedNotPublic > 0) {
      notes.push(`${skippedNotPublic} event(s) not public left out`);
    }
    if (skippedCategory > 0) {
      notes.push(`${skippedCategory} event(s) in a non-dance Sympla category left out`);
    }
    if (skippedOnlineNoPlace > 0) {
      notes.push(`${skippedOnlineNoPlace} event(s) online or no place left out`);
    }
    if (skippedOutsideWindow > 0) {
      notes.push(`${skippedOutsideWindow} event(s) outside the window left out`);
    }

    const doc = {
      url: listPage.url || url,
      fetchedAt: listPage.fetchedAt,
      httpStatus: listPage.status,
      etag: listPage.etag,
      lastModified: listPage.lastModified,
      contentHash: sha256(JSON.stringify(listings.map((l) => [l.externalId, l.listing]))),
      cleanedText: null,
    };

    const result: HarvestResult = {
      listings,
      notes,
      doc,
    };

    // whole only when every event page was read (no failures and no cap)
    if (fetchFailures === 0 && over <= 0) {
      result.whole = true;
    }

    return result;
  },
};
