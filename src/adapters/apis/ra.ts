// Resident Advisor GraphQL event listings by area (D-505).
// Reads club nights from RA's public GraphQL endpoint with our honest bot User-Agent only.
// If RA blocks us we stop for the run; we never work around a block.

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
import type { Point } from "@/src/domain/listing";
import { addCalendarDays } from "@/src/domain/time";
import { currentNightDate } from "@/src/domain/tonight";
import { HttpError } from "@/src/pipeline/http";

export const RA_ENDPOINT = "https://ra.co/graphql";
export const RA_PAGE_SIZE = 50;
export const RA_MAX_REQUESTS = 6;
export const RA_INTERVAL_MS = 2000;
export const RA_DAYS = 14;

export const RA_QUERY = `query GET_EVENT_LISTINGS($filters: FilterInputDtoInput, $pageSize: Int, $page: Int) {
  eventListings(filters: $filters, pageSize: $pageSize, page: $page) {
    data {
      id
      listingDate
      event {
        id
        title
        date
        startTime
        endTime
        contentUrl
        isTicketed
        images { filename }
        venue { id name address contentUrl area { name } location { latitude longitude } }
        artists { name }
      }
    }
    totalResults
  }
}`;

export const RA_QUERY_MINIMAL = `query GET_EVENT_LISTINGS($filters: FilterInputDtoInput, $pageSize: Int, $page: Int) {
  eventListings(filters: $filters, pageSize: $pageSize, page: $page) {
    data { event { id title date venue { name } } }
    totalResults
  }
}`;

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function firstErrorMessage(parsed: Json): string {
  if (Array.isArray(parsed.errors) && parsed.errors.length > 0) {
    const first = parsed.errors[0];
    if (typeof first === "object" && first !== null && typeof first.message === "string") {
      return first.message.slice(0, 200);
    }
  }
  return "unknown error";
}

/** Whether a coordinate has at most two decimal places (41.37, 2.19, 41.4, 2), allowing float noise. */
function atMostTwoDecimals(value: number): boolean {
  const scaled = value * 100;
  return Math.abs(scaled - Math.round(scaled)) < 1e-6;
}

/** Whether RA has blocked us (403, 429, captcha, DataDome, non-JSON). */
export function isRaBlocked(status: number | null, body: string): boolean {
  if (status === 403 || status === 429) return true;
  // Check for captcha/datadome in non-JSON responses
  const lowerBody = body.toLowerCase();
  if (lowerBody.includes("captcha") || lowerBody.includes("datadome")) {
    // If it's not JSON, it's a block
    try {
      JSON.parse(body);
      // It's JSON, so we need to parse further
    } catch {
      // Not JSON -> block
      return true;
    }
  }
  try {
    const parsed = JSON.parse(body) as unknown;
    if (!isObject(parsed)) return true;
    const hasData = isObject(parsed.data) && isObject(parsed.data.eventListings);
    const hasErrors = Array.isArray(parsed.errors) && parsed.errors.length > 0;
    // If there's no data and no errors array, it's a block
    if (!hasData && !hasErrors) return true;
    // A non-empty errors array is a schema rejection (the fallback handles it), not a block
    if (hasErrors) return false;
    // If there's data, it's not a block
    if (hasData) return false;
    // Otherwise block
    return true;
  } catch {
    // Not JSON
    return true;
  }
}

function getAreaIdFromUrl(url: string): number {
  const parsed = new URL(url);
  const areaStr = parsed.searchParams.get("area");
  if (!areaStr) {
    throw new Error(`RA source has no area id: ${url}`);
  }
  const area = Number.parseInt(areaStr, 10);
  if (Number.isNaN(area)) {
    throw new Error(`RA source has no area id: ${url}`);
  }
  return area;
}

export function raToListings(
  rows: unknown[],
  options: {
    fetchedAt: Date;
    metroTz: string;
    fromNight: string;
    days?: number;
  },
): { listings: HarvestedListing[]; notes: string[] } {
  const days = options.days ?? RA_DAYS;
  const listings: HarvestedListing[] = [];
  const notes: string[] = [];
  const seen = new Set<string>();
  const droppedVenues = new Set<string>();
  let placeholder23_59Count = 0;

  for (const raw of rows) {
    if (!isObject(raw)) continue;
    const data = raw;
    if (!isObject(data.event)) continue;
    const event = data.event;

    const idRaw = event.id;
    const id =
      typeof idRaw === "string" ? idRaw.trim() : typeof idRaw === "number" ? String(idRaw) : null;
    if (!id) continue;
    const externalId = `ra:${id}`;
    if (seen.has(externalId)) continue;
    seen.add(externalId);

    const title = plainText(event.title);
    if (!title) continue;

    // Determine start
    const startTimeRaw = typeof event.startTime === "string" ? event.startTime : null;
    const dateRaw = typeof event.date === "string" ? event.date : null;
    let start: ReturnType<typeof isoToLocal> | null = null;
    if (startTimeRaw) {
      start = isoToLocal(startTimeRaw, options.metroTz);
    } else if (dateRaw) {
      // Use only the date part (YYYY-MM-DD) to get a time-null start
      const dateOnly = dateRaw.slice(0, 10); // "2026-10-31"
      start = isoToLocal(dateOnly, options.metroTz);
      notes.push(`no start time: ${title}`);
    }
    if (!start) {
      notes.push(`no readable start: ${title}`);
      continue;
    }

    // D-521: 23:59 start time is a placeholder, read as no time
    let startToUse = start;
    if (start.time && start.time.trim() === "23:59") {
      startToUse = { ...start, time: null };
      placeholder23_59Count++;
    }

    if (!inWindow(startToUse.night, options.fromNight, days)) {
      continue;
    }

    // Determine end
    const endTimeRaw = typeof event.endTime === "string" ? event.endTime : null;
    const end = endTimeRaw ? isoToLocal(endTimeRaw, options.metroTz) : null;
    // If start became untimed (23:59 placeholder), do not keep an end
    const endToUse =
      start.time === "23:59"
        ? null
        : end && end.time && end.night === startToUse.night
          ? end
          : null;

    // Venue
    const venue = isObject(event.venue) ? event.venue : {};
    const venueName = typeof venue.name === "string" ? venue.name.trim() : null;
    const venueAddress = typeof venue.address === "string" ? venue.address.trim() : null;
    const location = isObject(venue.location) ? venue.location : {};
    const lat =
      typeof location.latitude === "number"
        ? location.latitude
        : typeof location.latitude === "string"
          ? Number.parseFloat(location.latitude)
          : Number.NaN;
    const lng =
      typeof location.longitude === "number"
        ? location.longitude
        : typeof location.longitude === "string"
          ? Number.parseFloat(location.longitude)
          : Number.NaN;
    // Determine if we should keep the point
    let keepPoint: boolean =
      Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0);
    let dropReason: string | null = null;
    const venueLabel = venueName || venueAddress || "no venue";

    if (keepPoint) {
      // Check for placeholder (whole degrees)
      if (Number.isInteger(lat) && Number.isInteger(lng)) {
        keepPoint = false;
        dropReason = `placeholder ${String(lat)}, ${String(lng)}`;
      } else if (atMostTwoDecimals(lat) && atMostTwoDecimals(lng)) {
        // A point rounded to two decimals is about 1 km off: Azul Rooftop Barceloneta's 41.37, 2.19 is in the sea
        // (D-377). The row is placed by its venue name and address instead.
        keepPoint = false;
        dropReason = `rounded ${String(lat)}, ${String(lng)}`;
      }
    }

    // Track notes for dropped points per venue label
    const venueNotesKey = `venue-drop:${venueLabel}`;
    if (!keepPoint && dropReason && !droppedVenues.has(venueNotesKey)) {
      droppedVenues.add(venueNotesKey);
      notes.push(`RA point dropped (${dropReason}): ${venueLabel}`);
    }

    const venueLocation: Point | null = keepPoint ? { lat, lng } : null;

    // DJs
    const artists = Array.isArray(event.artists) ? event.artists : [];
    const djs = artists
      .map((a) =>
        typeof a === "object" && a !== null && typeof a.name === "string" ? a.name.trim() : null,
      )
      .filter((name): name is string => !!name && name.length > 0)
      .slice(0, 20);

    const eventUrl = `https://ra.co/events/${id}`;
    const evidence: Record<string, string> = {
      start: `startTime ${startTimeRaw ?? dateRaw ?? "null"} ${options.metroTz}`.slice(0, 300),
    };

    listings.push(
      buildListing(
        {
          externalId,
          title,
          start: startToUse,
          end: endToUse,
          description: null,
          venue: {
            name: venueName,
            address: venueAddress,
            url: null,
            location: venueLocation,
          },
          organizer: { name: null, url: null },
          prices: null,
          ticketUrl: eventUrl,
          eventUrl,
          cancelled: false,
          styles: [],
          djs,
          evidence,
        },
        {
          sourceUrl: eventUrl,
          fetchedAt: options.fetchedAt,
          method: "api",
          currency: "USD",
        },
      ),
    );
  }
  if (placeholder23_59Count > 0) {
    notes.push(`${placeholder23_59Count} RA start time(s) of 23:59 read as no time`);
  }
  return { listings, notes };
}

export const raAdapter: SourceAdapter = {
  id: "ra",
  tier: "D",
  limits: { perDomainIntervalMs: RA_INTERVAL_MS },
  async harvest(source: Source, ctx: RunCtx): Promise<HarvestResult> {
    const url = source.feedUrl ?? source.url;
    const area = getAreaIdFromUrl(url);

    // Check robots.txt allows /graphql before reading (D-505)
    const policy = await ctx.http.robots(RA_ENDPOINT);
    if (!policy.isAllowed("/graphql")) {
      throw new Error(
        policy.unreadable
          ? `RA robots.txt unreadable (${policy.unreadable}); not read`
          : `RA robots.txt disallows /graphql (rule: ${policy.ruleFor("/graphql") ?? "unknown"})`,
      );
    }

    const fromNight = currentNightDate(ctx.now(), ctx.metro.tz);
    const toNight = addCalendarDays(fromNight, RA_DAYS - 1);
    const from = `${fromNight}T00:00:00.000Z`;
    const to = `${toNight}T23:59:59.999Z`;

    const allListings: HarvestedListing[] = [];
    const allNotes: string[] = ["robots.txt allows /graphql"];
    let totalResults = 0;
    let rowsSeen = 0;
    let pagesRead = 0;
    let blocked = false;
    let blockReason = "";
    let useMinimalQuery = false;
    let page = 1;

    while (page <= RA_MAX_REQUESTS) {
      const query = useMinimalQuery ? RA_QUERY_MINIMAL : RA_QUERY;
      const variables = {
        filters: {
          areas: { eq: area },
          listingDate: { gte: from, lte: to },
        },
        pageSize: RA_PAGE_SIZE,
        page,
      };
      const body = JSON.stringify({
        operationName: "GET_EVENT_LISTINGS",
        query,
        variables,
      });

      let response;
      try {
        // D-505: no browser UA, no Referer spoofing, no cookies.
        // The polite client sends our honest User-Agent; we don't add any extra headers.
        response = await ctx.http.request({
          url: RA_ENDPOINT,
          method: "POST",
          purpose: "api",
          intervalMs: RA_INTERVAL_MS,
          headers: {
            accept: "application/json",
            "content-type": "application/json",
          },
          body,
        });
      } catch (err) {
        if (err instanceof HttpError && (err.status === 403 || err.status === 429)) {
          blocked = true;
          blockReason = `HTTP ${err.status}`;
          break;
        }
        throw err;
      }

      // Check for block
      if (isRaBlocked(response.status, response.body)) {
        blocked = true;
        blockReason = `blocked response (status ${response.status})`;
        break;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(response.body);
      } catch {
        blocked = true;
        blockReason = "invalid JSON";
        break;
      }

      if (!isObject(parsed)) {
        blocked = true;
        blockReason = "response not an object";
        break;
      }

      // Schema fallback: full query rejected?
      if (
        !useMinimalQuery &&
        page === 1 &&
        Array.isArray(parsed.errors) &&
        parsed.errors.length > 0
      ) {
        const hasData = isObject(parsed.data) && isObject(parsed.data.eventListings);
        if (!hasData) {
          // No data, only errors -> try minimal query once
          const message = firstErrorMessage(parsed);
          allNotes.push(`RA full query rejected: ${message}; using the minimal query`);
          useMinimalQuery = true;
          // Re-send page 1 with minimal query
          continue; // do not increment page
        }
        // Has data alongside errors -> not a rejection, just note
        const message = firstErrorMessage(parsed);
        allNotes.push(`RA GraphQL errors: ${message}`);
      }

      // After possibly switching to minimal query, check if we have data
      if (!isObject(parsed.data) || !isObject(parsed.data.eventListings)) {
        // If we're using minimal query and there are errors, that's a rejection
        if (useMinimalQuery && Array.isArray(parsed.errors) && parsed.errors.length > 0) {
          const message = firstErrorMessage(parsed);
          throw new Error(`RA query rejected: ${message}`);
        }
        // Otherwise treat as block
        blocked = true;
        blockReason = "no data.eventListings";
        break;
      }

      const eventListings = parsed.data.eventListings;
      const rows = Array.isArray(eventListings.data) ? eventListings.data : [];
      rowsSeen += rows.length;
      pagesRead++;
      totalResults =
        typeof eventListings.totalResults === "number" ? eventListings.totalResults : 0;

      const { listings, notes } = raToListings(rows, {
        fetchedAt: response.fetchedAt,
        metroTz: ctx.metro.tz,
        fromNight,
        days: RA_DAYS,
      });
      allListings.push(...listings);
      allNotes.push(...notes);

      // Stop conditions
      if (rows.length < RA_PAGE_SIZE) break;
      if (rowsSeen >= totalResults) break;

      page++;
    }

    // If we made RA_MAX_REQUESTS requests and still have more pages, add a note
    if (page > RA_MAX_REQUESTS && rowsSeen < totalResults) {
      allNotes.push(`stopped at RA_MAX_REQUESTS pages; totalResults ${totalResults}`);
    }

    if (blocked) {
      if (pagesRead === 0) {
        throw new Error(`RA blocked: ${blockReason}`);
      }
      allNotes.push(`RA blocked on page ${page}: ${blockReason}; stopped`);
    }

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
      `${allListings.length} RA listing(s), totalResults ${totalResults}, ${pagesRead} request(s), ${useMinimalQuery ? "minimal" : "full"} query`,
      ...allNotes,
    ];
    if (allListings.length === 0 && !blocked) {
      resultNotes.push("no RA listings in the window");
    }

    const result: HarvestResult = {
      listings: styledListings,
      notes: resultNotes,
      doc,
    };
    if (!blocked) {
      result.whole = true;
    }
    return result;
  },
};
