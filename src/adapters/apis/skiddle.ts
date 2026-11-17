// Skiddle's official events API for the UK (free key). The adapter searches the metro's area
// over the run's nights and returns dance nights as listings. Every listing links to its Skiddle
// page, crediting Skiddle as the source. Runs only in GB metros (D-029).
// Fixtures run with the key "REDACTED".

import { matchStyles, type StyleKey } from "@/config/styles";
import { httpUrl, plainText, sha256, type LocalMoment } from "@/src/adapters/shared";
import { buildListing } from "@/src/adapters/structured";
import type {
  HarvestedListing,
  HarvestResult,
  Metro,
  NightDate,
  RunCtx,
  SourceAdapter,
} from "@/src/adapters/types";
import type { ListingPrice, Point } from "@/src/domain/listing";
import { addCalendarDays } from "@/src/domain/time";
import { NIGHT_BOUNDARY_HOUR } from "@/src/domain/tonight";

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v)
    ? v
    : typeof v === "string"
      ? Number.parseFloat(v)
      : null;

export const SKIDDLE_BASE = "https://www.skiddle.com/api/v1/events/search/";
export const SKIDDLE_PAGE_SIZE = 100;
export const SKIDDLE_MAX_PAGES = 5;

export const SKIDDLE_QUERIES: ReadonlyArray<Record<string, string>> = [
  { eventcode: "CLUB" },
  { eventcode: "LGB" },
  { eventcode: "BARPUB" },
  { keyword: "salsa" },
  { keyword: "bachata" },
  { keyword: "kizomba" },
  { keyword: "swing" },
  { keyword: "lindy hop" },
  { keyword: "ceilidh" },
  { keyword: "tango" },
  { keyword: "roller disco" },
  { keyword: "silent disco" },
  { keyword: "ecstatic dance" },
];

export function skiddleUrl(
  metro: Metro,
  nights: NightDate[],
  query: Record<string, string>,
  apiKey: string,
  offset = 0,
): string {
  const url = new URL(SKIDDLE_BASE);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("latitude", metro.center.lat.toFixed(6));
  url.searchParams.set("longitude", metro.center.lng.toFixed(6));
  url.searchParams.set("radius", String(Math.ceil(metro.radiusKm / 1.609)));
  url.searchParams.set("minDate", nights[0]!);
  url.searchParams.set("maxDate", nights[nights.length - 1]!);
  url.searchParams.set("limit", String(SKIDDLE_PAGE_SIZE));
  url.searchParams.set("offset", String(offset));
  url.searchParams.set("order", "date");
  url.searchParams.set("description", "1");
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  return url.toString();
}

/** Daytime words: a club event with one of these really is a morning or day event. */
const DAYTIME =
  /\b(?:day|daytime|morning|brunch|breakfast|coffee|sunrise|afternoon|daylight|matinee|lunch|after ?hours|afters|after ?party)\b/i;

/**
 * D-886 (daily check 2026-11-16, London): Skiddle carries a promoter's 12-hour slip as given, so a club night's doors
 * read "09:00" beside RA's 9pm ("NQ JPN: House & Techno - Free Entry Until 3am") and the two copies never pair. A
 * club event (CLUB/LGB) whose doors open 06:00-11:59 and whose close is missing or crosses midnight, with no daytime
 * word in its title, opens 12 hours later. Returns the doors time to use.
 */
export function clubNightMorningSlip(
  eventCode: string | null,
  title: string | null,
  doorsOpen: string | null,
  doorsClose: string | null,
): string | null {
  if (eventCode !== "CLUB" && eventCode !== "LGB") return doorsOpen;
  const open = doorsOpen && /^(\d{2}):(\d{2})/.exec(doorsOpen);
  if (!open) return doorsOpen;
  const hour = Number(open[1]);
  if (hour < 6 || hour > 11) return doorsOpen;
  if (title && DAYTIME.test(title)) return doorsOpen;
  const close = doorsClose && /^\d{2}:\d{2}/.test(doorsClose) ? doorsClose.slice(0, 5) : null;
  if (close !== null && close > doorsOpen.slice(0, 5)) return doorsOpen; // closes the same day: a day event
  return `${String(hour + 12).padStart(2, "0")}:${open[2]}${doorsOpen.slice(5)}`;
}

function localMoment(date: string | null, time: string | null, zone: string): LocalMoment | null {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const hour = time && /^\d{2}:\d{2}/.test(time) ? Number(time.slice(0, 2)) : 12;
  return {
    day: date,
    night: hour < NIGHT_BOUNDARY_HOUR ? addCalendarDays(date, -1) : date,
    time: time && /^\d{2}:\d{2}/.test(time) ? time.slice(0, 5) : null,
    zone,
    absolute: false,
  };
}

function parsePrice(entryprice: unknown): ListingPrice[] | null {
  if (typeof entryprice !== "string") return null;
  const trimmed = entryprice.trim();
  if (trimmed === "") return null;
  if (/^free$/i.test(trimmed)) {
    return [{ label: "Free", amount: 0, currency: "GBP", includes: null }];
  }
  const parsed = Number.parseFloat(trimmed);
  if (Number.isFinite(parsed) && parsed > 0) {
    return [{ label: "Entry", amount: parsed, currency: "GBP", includes: null }];
  }
  if (parsed === 0) {
    return [{ label: "Free", amount: 0, currency: "GBP", includes: null }];
  }
  return null;
}

function venueOf(event: Json): {
  name: string | null;
  address: string | null;
  location: Point | null;
} {
  const venue = isObject(event.venue) ? event.venue : null;
  if (!venue) {
    return { name: null, address: null, location: null };
  }
  const name = str(venue.name);
  const addressParts = [str(venue.address), str(venue.town), str(venue.postcode)].filter(Boolean);
  const address = addressParts.length > 0 ? addressParts.join(", ") : null;
  const lat = num(venue.latitude);
  const lng = num(venue.longitude);
  const location = lat !== null && lng !== null && !(lat === 0 && lng === 0) ? { lat, lng } : null;
  return { name, address, location };
}

function isCancelled(cancelled: unknown): boolean {
  if (typeof cancelled === "string") {
    return cancelled === "1" || cancelled === "true";
  }
  if (typeof cancelled === "number") {
    return cancelled === 1;
  }
  if (typeof cancelled === "boolean") {
    return cancelled;
  }
  return false;
}

export function skiddleToListings(
  events: unknown[],
  options: { metro: Metro; fetchedAt: Date },
): {
  listings: HarvestedListing[];
  notes: string[];
  screened: Array<{ externalId: string; title: string; reason: string }>;
} {
  const listings: HarvestedListing[] = [];
  const notes: string[] = [];
  const screened: Array<{ externalId: string; title: string; reason: string }> = [];
  const seen = new Set<string>();

  for (const raw of events) {
    if (!isObject(raw)) continue;
    const event = raw;
    const id = str(event.id) ?? (typeof event.id === "number" ? String(event.id) : null);
    if (!id) continue;
    const externalId = `skiddle:${id}`;
    if (seen.has(externalId)) continue;
    seen.add(externalId);

    const name = plainText(event.eventname);
    if (!name) continue;

    const eventCode = str(event.EventCode)?.toUpperCase() ?? null;

    // Screen out non-dance categories
    const nonDanceCodes = ["KIDS", "SPORT", "COMEDY", "EXHIB", "FEST", "THEATRE", "ARTS"];
    if (eventCode && nonDanceCodes.includes(eventCode)) {
      screened.push({
        externalId,
        title: name,
        reason: `not a dance night (Skiddle category ${eventCode})`,
      });
      continue;
    }

    // Determine if we should keep the event
    if (eventCode === "CLUB") {
      // keep = true; // keep is not used
    } else {
      const styles = matchStyles(name).styles;
      const danceMatch = /\b(dance|dancing|disco|club night|dj|djs|rave|party)\b/i.test(name);
      if (styles.length === 0 && !danceMatch) {
        screened.push({
          externalId,
          title: name,
          reason: "names no dance",
        });
        continue;
      }
    }

    // Styles
    let styles: StyleKey[] = [];
    const matched = matchStyles(name).styles;
    if (matched.length > 0) {
      styles = matched;
    } else if (eventCode === "CLUB" || eventCode === "LGB") {
      styles = ["dj_night"];
    }

    // Start time
    const date = str(event.date);
    const openingTimes = isObject(event.openingtimes) ? event.openingtimes : null;
    const doorsClose0 = openingTimes ? str(openingTimes.doorsclose) : null;
    const doorsOpen = clubNightMorningSlip(
      eventCode,
      name,
      openingTimes ? str(openingTimes.doorsopen) : null,
      doorsClose0,
    );
    const start = localMoment(date, doorsOpen, options.metro.tz);
    if (!start) continue;

    // End time
    let end: LocalMoment | null = null;
    const doorsClose = doorsClose0;
    if (doorsClose && /^\d{2}:\d{2}/.test(doorsClose)) {
      end = localMoment(date, doorsClose, options.metro.tz);
      // If end is earlier than or equal to start, move to next day
      if (end?.time && start.time) {
        // Both are "HH:MM", so they compare as strings.
        if (end.time <= start.time) {
          end = localMoment(addCalendarDays(start.day, 1), doorsClose, options.metro.tz);
        }
      }
      // Only keep end if it's on the same night as start
      if (end && end.night !== start.night) {
        end = null;
      }
    }

    // Venue
    const venue = venueOf(event);

    // Price
    const entryprice = event.entryprice;
    const prices = parsePrice(entryprice);

    // Cancelled
    const cancelled = isCancelled(event.cancelled);

    // URLs
    const link = str(event.link);
    const ticketUrl = httpUrl(link);
    const eventUrl = ticketUrl;
    const sourceUrl = ticketUrl || `https://www.skiddle.com/e/${id}`;

    // Evidence
    const evidence: Record<string, string> = {
      title: `"${name}"`,
      start: `date ${date}${doorsOpen ? ` doors ${doorsOpen}` : ", no doors time"}`,
    };
    if (cancelled) {
      evidence.cancelled = "Skiddle cancelled";
    }

    listings.push(
      buildListing(
        {
          externalId,
          title: name,
          start,
          end: end?.time && end.night === start.night ? end : null,
          description: null,
          venue: {
            name: venue.name,
            address: venue.address,
            url: null,
            location: venue.location,
          },
          organizer: { name: null, url: null },
          prices,
          ticketUrl,
          eventUrl,
          cancelled,
          styles,
          evidence,
        },
        {
          sourceUrl,
          fetchedAt: options.fetchedAt,
          method: "api",
          currency: "GBP",
        },
      ),
    );
  }

  return { listings, notes, screened };
}

export const skiddleAdapter: SourceAdapter = {
  id: "skiddle" as SourceAdapter["id"],
  tier: "A",
  countries: ["GB"],
  requiredEnv: ["SKIDDLE_API_KEY"],
  limits: { perDomainIntervalMs: 1000, rps: 1, perDay: 1000 },
  async harvestMetro(metro: Metro, nights: NightDate[], ctx: RunCtx): Promise<HarvestResult> {
    const key = ctx.env.SKIDDLE_API_KEY!;
    const allEvents: unknown[] = [];
    const notes: string[] = [];
    let fetchedAt = ctx.now();

    for (const query of SKIDDLE_QUERIES) {
      for (let page = 0; page < SKIDDLE_MAX_PAGES; page++) {
        const offset = page * SKIDDLE_PAGE_SIZE;
        const response = await ctx.http.request({
          url: skiddleUrl(metro, nights, query, key, offset),
          purpose: "api",
          intervalMs: 1000,
          headers: { accept: "application/json" },
        });
        fetchedAt = response.fetchedAt;
        const body = JSON.parse(response.body) as unknown;
        if (isObject(body) && body.error && body.error !== 0) {
          const msg = str(body.errormessage) || "unknown error";
          throw new Error(`Skiddle API error: ${msg}`);
        }
        const events = isObject(body) && Array.isArray(body.results) ? body.results : [];
        allEvents.push(...events);
        if (page === 0) {
          const queryLabel = query.eventcode ? query.eventcode : `keyword ${query.keyword}`;
          notes.push(`${queryLabel}: ${events.length} events`);
        }
        if (events.length < SKIDDLE_PAGE_SIZE) break;
        if (
          isObject(body) &&
          (typeof body.totalcount === "string" || typeof body.totalcount === "number")
        ) {
          const total = Number(body.totalcount);
          if (!Number.isNaN(total) && offset + SKIDDLE_PAGE_SIZE >= total) break;
        }
      }
    }

    const {
      listings,
      notes: listingNotes,
      screened,
    } = skiddleToListings(allEvents, {
      metro,
      fetchedAt,
    });
    notes.push(...listingNotes);

    return {
      listings,
      notes,
      screened,
      doc: {
        url: SKIDDLE_BASE,
        fetchedAt,
        httpStatus: 200,
        etag: null,
        lastModified: null,
        contentHash: sha256(JSON.stringify(listings.map((l) => [l.externalId, l.listing]))),
        cleanedText: null,
      },
    };
  },
};
