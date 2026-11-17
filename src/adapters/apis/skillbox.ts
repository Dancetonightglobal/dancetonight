// SkillBox (skillboxes.com) public JSON API adapter (D-621).
// robots.txt allows /servers/ (disallows only /admin/, /super-admin/, some /media/).
// The owner said yes to its terms (2026-10-31).

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
import { currentNightDate } from "@/src/domain/tonight";
import { CRAWL_INTERVAL_MS } from "@/src/pipeline/http";

export const SKILLBOX_LIST_URL =
  "https://www.skillboxes.com/servers/v3/api/event-new/get-event-new";
export const SKILLBOX_DETAILS_URL =
  "https://www.skillboxes.com/servers/v3/api/event-new/event-details";
// SkillBox city ids per metro (Delhi D-1140: its Delhi 2 and Noida 3 are both inside the outline).
export const SKILLBOX_CITIES: Readonly<Record<string, readonly number[]>> = {
  mumbai: [5],
  delhi: [2, 3],
};
export const MAX_SKILLBOX_LIST_PAGES = 12;
export const MAX_SKILLBOX_DETAILS = 30;

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Whether an item from the list is a dance night (techno, house, party, etc). */
export function isSkillboxDanceNight(item: unknown): boolean {
  if (!isObject(item)) return false;
  const category = typeof item.category === "string" ? item.category : "";
  const subcats = Array.isArray(item.subcategories) ? item.subcategories : [];
  const subcatNames = subcats
    .map((sc) => (isObject(sc) && typeof sc.name === "string" ? sc.name : ""))
    .filter(Boolean);
  const text = [category, ...subcatNames].join(" ").toLowerCase();
  // Exclude patterns
  const EXCLUDE = /metal|rock|classical|jazz|poetry|storytell|workshop|comedy|kids/i;
  if (EXCLUDE.test(text)) return false;
  // Include patterns
  const INCLUDE =
    /techno|house|trance|\bedm\b|electronic dance|\bdj\b|party|commercial music|afro|amapiano|disco|reggaeton|dance/i;
  return INCLUDE.test(text);
}

export interface SkillboxDetailOptions {
  fetchedAt: Date;
  metroTz: string;
  fromNight: string;
  days?: number;
}

export function skillboxDetailToListing(
  data: unknown,
  options: SkillboxDetailOptions,
): { listing: HarvestedListing | null; note: string | null; startMoved: boolean } {
  if (!isObject(data)) return { listing: null, note: "data is not an object", startMoved: false };
  const slug = typeof data.slug === "string" ? data.slug.trim() : null;
  const name = plainText(data.event_display_name);
  if (!slug || !name) {
    return { listing: null, note: "no slug or name", startMoved: false };
  }

  const days = options.days ?? MATERIALIZE_DAYS;
  const tz = options.metroTz;

  const start = isoToLocal(data.starttime_ldjson, tz);
  if (!start) {
    return { listing: null, note: `no readable start: ${name}`, startMoved: false };
  }

  // Check if we need to adjust AM/PM confusion
  let adjustedStart = start;
  let startMoved = false;
  const end = isoToLocal(data.endtime_ldjson, tz);

  if (start.time && end?.time) {
    const startHour = parseInt(start.time.slice(0, 2), 10);
    const startMinute = parseInt(start.time.slice(3, 5), 10);
    const endHour = parseInt(end.time.slice(0, 2), 10);
    const endMinute = parseInt(end.time.slice(3, 5), 10);

    // Calculate next day of start
    const nextDayDate = new Date(start.day);
    nextDayDate.setUTCDate(nextDayDate.getUTCDate() + 1);
    const nextDayStr = nextDayDate.toISOString().slice(0, 10);

    // Check conditions for AM/PM confusion
    if (startHour < 12 && end.day === nextDayStr && (endHour < 6 || end.time === "06:00")) {
      // Calculate span in minutes
      const startMinutes = startHour * 60 + startMinute;
      const endMinutes = endHour * 60 + endMinute;
      const span = 24 * 60 - startMinutes + endMinutes;

      if (span > 14 * 60) {
        // Move start 12 hours later
        const newHour = startHour + 12;
        const newTimeStr = `${newHour.toString().padStart(2, "0")}:${start.time.slice(3, 5)}`;
        const newDateTimeStr = `${start.day}T${newTimeStr}:00`;
        const newStart = isoToLocal(newDateTimeStr, tz);
        if (newStart) {
          adjustedStart = newStart;
          startMoved = true;
        }
      }
    }
  }

  if (!inWindow(adjustedStart.night, options.fromNight, days)) {
    return { listing: null, note: null, startMoved: false };
  }

  // Keep end only if it has a time and is on the same day or next day
  let endMoment = null;
  if (end && end.time) {
    const startDay = adjustedStart.day;
    const endDay = end.day;
    // Check if end.day is the day after start.day
    const nextDay = new Date(startDay);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    const nextDayStr = nextDay.toISOString().slice(0, 10);
    if (endDay === startDay || endDay === nextDayStr) {
      endMoment = end;
    }
  }

  // Venue
  const venueName = typeof data.venue_name === "string" ? data.venue_name.trim() || null : null;
  const addressRaw = typeof data.venue_address === "string" ? data.venue_address.trim() : "";
  const venueAddress = addressRaw || null;

  // Location
  let location = null;
  const latStr = typeof data.venue_latitude === "string" ? data.venue_latitude.trim() : "";
  const lngStr = typeof data.venue_longitude === "string" ? data.venue_longitude.trim() : "";
  const lat = parseFloat(latStr);
  const lng = parseFloat(lngStr);
  if (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    /^-?\d+\.\d{3,}$/.test(latStr) &&
    /^-?\d+\.\d{3,}$/.test(lngStr)
  ) {
    location = { lat, lng };
  }

  // Prices (INR)
  const minRaw = data.min_price;
  const maxRaw = data.max_price;
  const min = typeof minRaw === "number" ? minRaw : Number(minRaw);
  const max = typeof maxRaw === "number" ? maxRaw : Number(maxRaw);
  const minValid = Number.isFinite(min) && min >= 0;
  const maxValid = Number.isFinite(max) && max >= 0;
  let prices: ListingPrice[] | null = null;
  if (minValid && maxValid && min === 0 && max === 0) {
    prices = [{ label: "Free", amount: 0, currency: "INR", includes: null }];
  } else if (minValid && min > 0) {
    prices = [{ label: "From", amount: min, currency: "INR", includes: null }];
  } else if (maxValid && max > 0) {
    prices = [{ label: "Tickets", amount: max, currency: "INR", includes: null }];
  }

  // URLs
  const shareUrl = typeof data.share_url === "string" ? data.share_url.trim() : "";
  const eventUrl = shareUrl.startsWith("https://www.skillboxes.com/events/")
    ? shareUrl
    : `https://www.skillboxes.com/events/${slug}`;
  const ticketUrl = eventUrl;

  // Cancelled
  const status = typeof data.status === "number" ? data.status : Number(data.status);
  const cancelled = status !== 1;
  const evidence: Record<string, string> = {
    start: `starttime_ldjson ${String(data.starttime_ldjson)} ${tz}`.slice(0, 300),
  };
  if (cancelled) {
    evidence.cancelled = `status ${status}`;
  }
  if (startMoved) {
    evidence.startMoved = `organiser AM/PM: ${String(data.starttime_ldjson)} moved 12h`.slice(
      0,
      300,
    );
  }

  const listing = buildListing(
    {
      externalId: `skillbox:${slug}`,
      title: name,
      start: adjustedStart,
      end: endMoment,
      description: null,
      venue: {
        name: venueName,
        address: venueAddress,
        url: null,
        location,
      },
      organizer: { name: null, url: null },
      prices,
      ticketUrl,
      eventUrl,
      cancelled,
      styles: [],
      evidence,
    },
    {
      sourceUrl: eventUrl,
      fetchedAt: options.fetchedAt,
      // Use "api" as method (ticketmaster.ts uses "api" for its API)
      method: "api",
      currency: "INR",
    },
  );

  return { listing, note: null, startMoved };
}

export const skillboxAdapter: SourceAdapter = {
  id: "skillbox",
  tier: "D",
  countries: ["IN"],
  limits: { perDomainIntervalMs: CRAWL_INTERVAL_MS },
  async harvest(source: Source, ctx: RunCtx): Promise<HarvestResult> {
    const cityIds = SKILLBOX_CITIES[ctx.metro.slug];
    if (cityIds === undefined || cityIds.length === 0) {
      throw new Error(`SkillBox has no city id for ${ctx.metro.slug}`);
    }

    const headers = {
      "content-type": "application/json",
      accept: "application/json",
      deviceType: "Angular 1",
    };

    // Page through list for each city
    const items: unknown[] = [];
    const seenIds = new Set<string | number>();
    const notes: string[] = [];
    let first: {
      fetchedAt: Date;
      status: number;
      etag: string | null;
      lastModified: string | null;
    } | null = null;
    let totalListRequests = 0;

    for (const cityId of cityIds) {
      let page = 1;
      let next = true;

      while (next && totalListRequests < MAX_SKILLBOX_LIST_PAGES) {
        const body = JSON.stringify({
          opcode: "search",
          type: "upcoming",
          page,
          city: cityId,
        });
        const response = await ctx.http.request({
          url: SKILLBOX_LIST_URL,
          method: "POST",
          body,
          purpose: "crawl",
          headers,
        });
        totalListRequests++;

        first ??= {
          fetchedAt: response.fetchedAt,
          status: response.status,
          etag: response.etag,
          lastModified: response.lastModified,
        };
        let parsed;
        try {
          parsed = JSON.parse(response.body);
        } catch {
          notes.push(`list page ${page} of city ${cityId} is not JSON: paging stopped`);
          break;
        }
        if (!isObject(parsed)) {
          notes.push(
            `list page ${page} of city ${cityId} response is not an object: paging stopped`,
          );
          break;
        }
        // Check if success is not true
        if (parsed.success !== true) {
          notes.push(`list page ${page} of city ${cityId} did not succeed: paging stopped`);
          break;
        }
        const listItems = Array.isArray(parsed.items) ? parsed.items : [];
        for (const item of listItems) {
          if (!isObject(item)) continue;
          const id =
            typeof item.EventId === "number" || typeof item.EventId === "string"
              ? item.EventId
              : typeof item.slug === "string"
                ? item.slug
                : null;
          if (id === null) continue;
          if (seenIds.has(id)) continue;
          seenIds.add(id);
          items.push(item);
        }
        next = parsed.next === true;
        page++;
      }
    }

    // Filter dance nights
    const danceItems = items.filter(
      (item) =>
        isObject(item) &&
        typeof item.slug === "string" &&
        item.slug.trim() !== "" &&
        isSkillboxDanceNight(item),
    );

    // Request details
    const listings: HarvestedListing[] = [];
    const fromNight = currentNightDate(ctx.now(), ctx.metro.tz);
    const detailSlugs = danceItems
      .slice(0, MAX_SKILLBOX_DETAILS)
      .map((item) => (isObject(item) && typeof item.slug === "string" ? item.slug.trim() : ""))
      .filter(Boolean);
    const skipped = danceItems.length - detailSlugs.length;
    if (skipped > 0) {
      notes.push(`${skipped} dance night(s) skipped by the cap of ${MAX_SKILLBOX_DETAILS}`);
    }

    let startMovedCount = 0;
    for (const slug of detailSlugs) {
      const body = JSON.stringify({ slug });
      let response;
      try {
        response = await ctx.http.request({
          url: SKILLBOX_DETAILS_URL,
          method: "POST",
          body,
          purpose: "crawl",
          headers,
        });
      } catch {
        notes.push(`detail request failed for ${slug}`);
        continue;
      }
      let parsed;
      try {
        parsed = JSON.parse(response.body);
      } catch {
        notes.push(`detail response not JSON for ${slug}`);
        continue;
      }
      if (!isObject(parsed) || parsed.success !== true || !isObject(parsed.data)) {
        notes.push(`detail success false or missing data for ${slug}`);
        continue;
      }
      const { listing, note, startMoved } = skillboxDetailToListing(parsed.data, {
        fetchedAt: response.fetchedAt,
        metroTz: ctx.metro.tz,
        fromNight,
      });
      if (note) {
        notes.push(note);
      }
      if (listing) {
        listings.push(listing);
        if (startMoved) {
          startMovedCount++;
        }
      }
    }

    if (startMovedCount > 0) {
      notes.push(`SkillBox: ${startMovedCount} start time(s) moved 12h, organiser AM/PM`);
    }

    // Apply source styles
    const styledListings = listings.map((l) => withSourceStyle(l, source.styles));

    // Build doc
    const contentHash = sha256(
      JSON.stringify(styledListings.map((l) => [l.externalId, l.listing])),
    );
    const doc = {
      url: SKILLBOX_LIST_URL,
      fetchedAt: first?.fetchedAt ?? ctx.now(),
      httpStatus: first?.status ?? 0,
      etag: first?.etag ?? null,
      lastModified: first?.lastModified ?? null,
      contentHash,
      cleanedText: null,
    };

    notes.unshift(
      `${items.length} list item(s), ${danceItems.length} dance night(s), ${detailSlugs.length} detail(s) read`,
    );

    return {
      listings: styledListings,
      notes,
      doc,
    };
  },
};
