import { httpUrl, sha256, isoToLocal, type LocalMoment } from "@/src/adapters/shared";
import { buildListing, inWindow } from "@/src/adapters/structured";
import type {
  HarvestedListing,
  HarvestResult,
  RunCtx,
  Source,
  SourceAdapter,
} from "@/src/adapters/types";
import { currencyForCountry } from "@/src/domain/prices";
import { MATERIALIZE_DAYS } from "@/src/domain/recurrence";
import { addCalendarDays } from "@/src/domain/time";
import { currentNightDate } from "@/src/domain/tonight";
import { titleNamesOutsideTown } from "@/config/metro-regions";
import { plainText, decodeEntities } from "@/src/adapters/shared";

export interface TangoMangoGridItem {
  date: string; // YYYY-MM-DD
  eventId: string;
  title: string;
}

export interface TangoMangoEvent {
  title: string | null;
  timeLines: string[];
  venueName: string | null;
  address: string | null;
  venueUrl: string | null;
  priceText: string | null;
}

/**
 * Parse the calendar grid HTML to extract events.
 * Each item is a div with onclick="loadevent(this,'<date>',<digits>,event)"
 */
export function parseTangoMangoGrid(html: string): TangoMangoGridItem[] {
  const items: TangoMangoGridItem[] = [];
  // Match div elements with the loadevent pattern
  const divPattern =
    /<div[^>]*onclick="loadevent\(this,'([^']+)',(\d+),event\)"[^>]*>([^<]+)<\/div>/g;
  let match;
  while ((match = divPattern.exec(html)) !== null) {
    const date = match[1];
    const eventId = match[2];
    const rawTitle = match[3];
    if (!date || !eventId || !rawTitle) continue;
    const title = plainText(rawTitle) ?? "";
    items.push({ date, eventId, title });
  }
  return items;
}

/**
 * Group grid items by event ID, with sorted unique dates.
 */
export function tangoMangoDatesById(
  items: TangoMangoGridItem[],
): Map<string, { title: string; dates: string[] }> {
  const map = new Map<string, { title: string; dates: Set<string> }>();
  for (const item of items) {
    const existing = map.get(item.eventId);
    if (existing) {
      existing.dates.add(item.date);
    } else {
      map.set(item.eventId, { title: item.title, dates: new Set([item.date]) });
    }
  }
  const result = new Map<string, { title: string; dates: string[] }>();
  for (const [id, { title, dates }] of map) {
    result.set(id, { title, dates: Array.from(dates).sort() });
  }
  return result;
}

/**
 * Check if title contains "private" (case-insensitive, word boundary).
 */
export function isPrivateLesson(title: string): boolean {
  return /\bprivate\b/i.test(title) || /\bprivates\b/i.test(title);
}

/**
 * Parse event details HTML.
 */
export function parseTangoMangoEvent(html: string): TangoMangoEvent {
  // Extract the details block
  const detailsStart = html.indexOf("<div id=details>");
  if (detailsStart === -1) {
    return {
      title: null,
      timeLines: [],
      venueName: null,
      address: null,
      venueUrl: null,
      priceText: null,
    };
  }
  const afterDetails = html.slice(detailsStart);
  const detailsEnd = afterDetails.indexOf("<div class=noprint>");
  const detailsBlock = detailsEnd === -1 ? afterDetails : afterDetails.slice(0, detailsEnd);

  // Get title from the header table - look for any td with class styled in the entire HTML
  let title: string | null = null;
  // Search in the entire HTML for td with class styled
  const titleMatch = html.match(/<td[^>]*class\s*=\s*["']?styled["']?[^>]*>([^<]+)<\/td>/i);
  if (titleMatch && titleMatch[1]) {
    title = plainText(titleMatch[1]);
  }

  // Split on <br> tags, but keep empty lines to detect boundaries
  const rawLines = detailsBlock.split(/<br\s*\/?>/i);
  const lines = rawLines.map((line) => {
    // Remove any remaining HTML tags
    const cleaned = line.replace(/<[^>]*>/g, "");
    return decodeEntities(cleaned).trim().replace(/\s+/g, " ");
  });

  // Skip the first line which is weekday date
  const relevantLines = lines.slice(1);

  // Find time lines: up to first empty line
  let timeLines: string[] = [];
  let i = 0;
  for (; i < relevantLines.length; i++) {
    const line = relevantLines[i] ?? "";
    if (line === "") {
      // Empty line marks end of time block
      break;
    }
    const lowerLine = line.toLowerCase();
    if (lowerLine.includes("contact ahead for time")) {
      // According to spec, this is NOT a time line and timeLines should be empty
      timeLines = [];
      i++; // skip this line
      break;
    }
    // Check if line contains a time pattern (digit followed by colon) OR "to" pattern
    // Also, if line contains "$", it's a price line, not a time line
    if (line.includes("$")) {
      // Price line, stop collecting time lines
      break;
    }
    if (line.match(/\d+[:.]\d*/) || line.match(/\d+\s*(?:a|am|p|pm)?\s+to\s+\d+/i)) {
      timeLines.push(line);
    } else {
      // If no time pattern, stop collecting
      break;
    }
  }

  // The remaining lines after time block
  const remainingLines = relevantLines.slice(i);

  // Find price lines
  const priceLines: string[] = [];
  const otherLines: string[] = [];
  for (const line of remainingLines) {
    if (line === "") continue;
    if (line.includes("$")) {
      priceLines.push(line);
    } else {
      otherLines.push(line);
    }
  }

  // Venue name: first line that doesn't contain $, doesn't start with digit, and is not the last non-empty line
  // Also exclude lines containing "contact ahead" and lines that look like a city line (contain ", FL" or "FL")
  let venueName: string | null = null;
  if (otherLines.length > 0) {
    // Exclude the last line (city line)
    const candidates = otherLines.slice(0, -1);
    for (const line of candidates) {
      const lowerLine = line.toLowerCase();
      if (!/^\d/.test(line) && !line.includes("$") && !lowerLine.includes("contact ahead")) {
        // Exclude lines that look like city lines (contain ", FL" or "FL" or "Florida")
        if (
          !lowerLine.includes(", fl") &&
          !lowerLine.includes(" fl") &&
          !lowerLine.includes("florida")
        ) {
          venueName = line;
          break;
        }
      }
    }
  }

  // Address from Map link - use a more flexible regex, but only within details block
  let address: string | null = null;
  // The Map link sits just after the part read above, inside <div class=noprint>.
  const mapMatch = afterDetails.match(
    /href="https:\/\/maps\.google\.com\/maps\?[^"]*daddr=([^&" ]+)/i,
  );
  if (mapMatch && mapMatch[1]) {
    const encoded = mapMatch[1];
    const decoded = decodeURIComponent(encoded.replace(/\+/g, " "));
    address = decoded.replace(/,+/g, ",").replace(/\s+/g, " ").trim();
  }

  // Venue URL - look for "Venue website" link
  let venueUrl: string | null = null;
  const venueLinkMatch = html.match(/<a[^>]*href="([^"]*)"[^>]*>\s*Venue website\s*<\/a>/i);
  if (venueLinkMatch && venueLinkMatch[1]) {
    venueUrl = venueLinkMatch[1];
  }

  // Price text: only if there are price lines AND they are not part of time lines
  // According to spec, priceText should be lines containing "$", joined with " / "
  const priceText = priceLines.length > 0 ? priceLines.join(" / ") : null;

  return {
    title,
    timeLines,
    venueName,
    address,
    venueUrl,
    priceText,
  };
}

/**
 * Parse a time segment from a line. Minutes follow a colon or a dot ("11.10 am", Tango Times 30108).
 */
function parseTimeSegment(
  text: string,
): { start: string; end: string | null; label: string } | null {
  // Pattern 1: H[:MM]a? - H[:MM]a? <label>
  const pattern1 =
    /^(\d{1,2})(?:[:.](\d{2}))?\s*(a|am|p|pm)?\s*-\s*(\d{1,2})(?:[:.](\d{2}))?\s*(a|am|p|pm)?\s+(.+)$/i;
  const match1 = text.match(pattern1);
  if (match1) {
    const startHour = parseInt(match1[1] ?? "0");
    const startMin = match1[2] ? parseInt(match1[2]) : 0;
    const startSuffix = match1[3];
    const endHour = parseInt(match1[4] ?? "0");
    const endMin = match1[5] ? parseInt(match1[5]) : 0;
    const endSuffix = match1[6];
    const label = match1[7];
    if (!label) return null;

    const start = normalizeTime(startHour, startMin, startSuffix, true);
    const end = normalizeTime(endHour, endMin, endSuffix, false, start);
    return { start, end, label };
  }

  // Pattern 2: H[:MM]a? <label>
  const pattern2 = /^(\d{1,2})(?:[:.](\d{2}))?\s*(a|am|p|pm)?\s+(.+)$/i;
  const match2 = text.match(pattern2);
  if (match2) {
    const hour = parseInt(match2[1] ?? "0");
    const min = match2[2] ? parseInt(match2[2]) : 0;
    const suffix = match2[3];
    const label = match2[4];
    if (!label) return null;
    const start = normalizeTime(hour, min, suffix, true);
    return { start, end: null, label };
  }

  // Pattern 3: <label> H[:MM]a? to H[:MM]a?
  const pattern3 =
    /^(.+?)\s+(\d{1,2})(?:[:.](\d{2}))?\s*(a|am|p|pm)?\s+to\s+(\d{1,2})(?:[:.](\d{2}))?\s*(a|am|p|pm)?$/i;
  const match3 = text.match(pattern3);
  if (match3) {
    const label = match3[1]?.trim();
    if (!label) return null;
    const startHour = parseInt(match3[2] ?? "0");
    const startMin = match3[3] ? parseInt(match3[3]) : 0;
    const startSuffix = match3[4];
    const endHour = parseInt(match3[5] ?? "0");
    const endMin = match3[6] ? parseInt(match3[6]) : 0;
    const endSuffix = match3[7];

    const start = normalizeTime(startHour, startMin, startSuffix, true);
    const end = normalizeTime(endHour, endMin, endSuffix, false, start);
    return { start, end, label };
  }

  return null;
}

function normalizeTime(
  hour: number,
  minute: number,
  suffix: string | undefined,
  isStart: boolean,
  startTime?: string,
): string {
  let h = hour;
  const s = suffix ? suffix.toLowerCase() : null;

  // Apply suffix rules
  if (s === "p" || s === "pm") {
    if (h < 12) h += 12;
  } else if (s === "a" || s === "am") {
    if (h === 12) h = 0;
  } else {
    // No suffix
    if (isStart) {
      // Start hours 1-11 are pm, 12 is 12:00
      if (h >= 1 && h <= 11) h += 12;
      // h=12 stays 12
    } else {
      // End with no suffix: take pm value; if not after start, take am value
      const pmHour = h === 12 ? 12 : h + 12;
      // Check if pmHour is after start
      if (startTime) {
        const startHourStr = startTime.split(":")[0];
        const startMinuteStr = startTime.split(":")[1];
        const startHour = startHourStr ? parseInt(startHourStr) : 0;
        const startMinute = startMinuteStr ? parseInt(startMinuteStr) : 0;
        if (pmHour > startHour || (pmHour === startHour && minute > startMinute)) {
          h = pmHour;
        } else {
          // Take am value
          h = h === 12 ? 0 : h;
        }
      } else {
        // No start time, default to pm
        h = pmHour;
      }
    }
  }

  // Ensure hour is 0-23
  h = h % 24;
  return `${h.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`;
}

/**
 * Pick social time from time lines.
 */
export function pickSocialTime(
  timeLines: string[],
  title: string,
): { start: string; end: string | null; label: string } | null {
  const segments: { start: string; end: string | null; label: string }[] = [];

  for (const line of timeLines) {
    // A line that opens with a label holds "<label> H to H" segments joined by " - "
    // ("Class 8 to 9pm - Practilonga 9 to 11pm"); one that opens with a time is one segment ("9:00 - 1:30 Milonga").
    if (!/^\d/.test(line) && line.includes(" - ")) {
      // Split by " - " and treat each part as a separate segment
      const parts = line.split(" - ");
      for (const part of parts) {
        const trimmed = part.trim();
        const seg = parseTimeSegment(trimmed);
        if (seg) {
          segments.push(seg);
        }
      }
    } else {
      // Try to parse the whole line as a segment
      const segment = parseTimeSegment(line);
      if (segment) {
        segments.push(segment);
      }
    }
  }

  if (segments.length === 0) return null;

  // Check for social pattern
  const socialPattern = /milonga|pr[aá]ctica|practilonga|baile|ball|party|social/i;

  // First segment whose label matches social pattern
  const socialSegment = segments.find((seg) => socialPattern.test(seg.label));
  if (socialSegment) return socialSegment;

  // If title matches social pattern, return last segment
  if (socialPattern.test(title) && segments.length > 0)
    return segments[segments.length - 1] ?? null;

  // Otherwise return first segment
  return segments[0] ?? null;
}

// ---------------------------------------------------------------------------------------------
// Adapter

export const TANGOMANGO_BASE = "https://www.tangomango.org";
export const TANGOMANGO_INTERVAL_MS = 10_000; // robots.txt Crawl-delay: 10
export const TANGOMANGO_MAPPING_VERSION = 2; // 2: dotted minutes ("11.10 am")

export interface TangoMangoListingOptions {
  metro: { tz: string; countryCode: string; slug: string };
  fetchedAt: Date;
  fromNight: string;
}

/**
 * Convert parsed grid items and event details to listings.
 */
export function tangoMangoToListings(
  items: TangoMangoGridItem[],
  events: Map<string, TangoMangoEvent>,
  options: TangoMangoListingOptions,
): {
  listings: HarvestedListing[];
  screened: Array<{ externalId: string; title: string; reason: string }>;
} {
  const listings: HarvestedListing[] = [];
  const screened: Array<{ externalId: string; title: string; reason: string }> = [];
  const byId = tangoMangoDatesById(items);
  const zone = options.metro.tz;
  const currency = currencyForCountry(options.metro.countryCode);

  for (const [id, { title, dates: allDates }] of byId) {
    const event = events.get(id);
    if (!event) continue;
    const dates = allDates.filter((date) => inWindow(date, options.fromNight, MATERIALIZE_DAYS));
    if (dates.length === 0) continue;

    // Screen private lessons
    if (isPrivateLesson(title)) {
      screened.push({
        externalId: `tangomango:${id}`,
        title,
        reason: "a private lesson",
      });
      continue;
    }

    // Screen outside metro
    const town = titleNamesOutsideTown(options.metro.slug, event.address ?? "");
    if (town) {
      for (const date of dates) {
        screened.push({
          externalId: `tangomango:${id}:${date}`,
          title,
          reason: `outside the metro (${town})`,
        });
      }
      continue;
    }

    for (const date of dates) {
      const time = pickSocialTime(event.timeLines, title);
      let start: LocalMoment;
      let end: LocalMoment | null = null;

      if (time) {
        const startIso = `${date}T${time.start}`;
        start = isoToLocal(startIso, zone)!;
        if (time.end) {
          // Determine end day: if end <= start (after midnight), add one calendar day
          const startHour = Number(time.start.split(":")[0]);
          const endHour = Number(time.end.split(":")[0]);
          const endDay = endHour <= startHour && endHour < 6 ? addCalendarDays(date, 1) : date;
          const endIso = `${endDay}T${time.end}`;
          end = isoToLocal(endIso, zone);
        }
      } else {
        start = isoToLocal(date, zone)!;
      }

      const externalId = `tangomango:${id}:${date}`;
      const eventUrl = `${TANGOMANGO_BASE}/link.php?eventid=${id}&date=${date}`;

      listings.push(
        buildListing(
          {
            externalId,
            title,
            start,
            end,
            description: null,
            venue: {
              name: event.venueName,
              address: event.address,
              url: event.venueUrl,
              location: null,
            },
            organizer: { name: null, url: null },
            prices: null,
            ticketUrl: null,
            eventUrl,
            cancelled: false,
            styles: ["milonga"],
            evidence: {
              title: `"${title}"`,
              start: time ? `"${time.label}"` : "no time on the page",
            },
          },
          {
            sourceUrl: eventUrl,
            fetchedAt: options.fetchedAt,
            method: "api",
            currency,
          },
        ),
      );
    }
  }

  return { listings, screened };
}

export const tangoMangoAdapter: SourceAdapter = {
  id: "tangomango" as SourceAdapter["id"],
  tier: "A",
  countries: ["US"],
  limits: { perDomainIntervalMs: TANGOMANGO_INTERVAL_MS },
  async harvest(source: Source, ctx: RunCtx): Promise<HarvestResult> {
    const notes: string[] = [];
    const screened: Array<{ externalId: string; title: string; reason: string }> = [];

    // 1. Fetch grid
    const gridResponse = await ctx.http.request({
      url: source.url,
      purpose: "crawl",
      intervalMs: TANGOMANGO_INTERVAL_MS,
      headers: { accept: "text/html" },
    });
    if (gridResponse.status < 200 || gridResponse.status >= 300) {
      throw new Error(`tangomango: grid failed (HTTP ${gridResponse.status})`);
    }
    const body = gridResponse.body;
    if (!body.includes("loadevent(")) {
      throw new Error("tangomango: the calendar page no longer has the items this reader reads");
    }

    const items = parseTangoMangoGrid(body);
    const byId = tangoMangoDatesById(items);
    const fromNight = currentNightDate(ctx.now(), ctx.metro.tz);

    // Filter dates within window
    const keptIds = new Map<string, { title: string; dates: string[] }>();
    for (const [id, { title, dates }] of byId) {
      const keptDates = dates.filter((date) => inWindow(date, fromNight, MATERIALIZE_DAYS));
      if (keptDates.length > 0) {
        keptIds.set(id, { title, dates: keptDates });
      }
    }

    // Screen private lessons before any event page request
    for (const [id, { title }] of keptIds) {
      if (isPrivateLesson(title)) {
        screened.push({
          externalId: `tangomango:${id}`,
          title,
          reason: "a private lesson",
        });
        keptIds.delete(id);
      }
    }

    // Content hash
    const contentHash = sha256(
      JSON.stringify([
        TANGOMANGO_MAPPING_VERSION,
        fromNight,
        Array.from(keptIds.entries()).map(([id, { title, dates }]) => ({ id, title, dates })),
      ]),
    );
    const doc = {
      url: httpUrl(source.url) ?? `${TANGOMANGO_BASE}/`,
      fetchedAt: gridResponse.fetchedAt,
      httpStatus: 200,
      etag: null,
      lastModified: null,
      contentHash,
      cleanedText: null,
    };
    if (source.contentHash === contentHash) {
      return { listings: [], unchanged: true, doc };
    }

    // Fetch event pages (max 40)
    const events = new Map<string, TangoMangoEvent>();
    const ids = Array.from(keptIds.keys());
    const maxPages = Math.min(ids.length, 40);
    let whole = true;

    for (let i = 0; i < maxPages; i++) {
      const id = ids[i]!;
      const { dates } = keptIds.get(id)!;
      const firstDate = dates[0]!;
      const eventUrl = `${TANGOMANGO_BASE}/lib/loadevent.php?date=${firstDate}&eventid=${id}`;
      try {
        const eventResponse = await ctx.http.request({
          url: eventUrl,
          purpose: "crawl",
          intervalMs: TANGOMANGO_INTERVAL_MS,
          headers: { accept: "text/html" },
        });
        if (eventResponse.status < 200 || eventResponse.status >= 300) {
          notes.push(`tangomango:${id} event page failed (HTTP ${eventResponse.status})`);
          whole = false;
          continue;
        }
        const event = parseTangoMangoEvent(eventResponse.body);
        events.set(id, event);
      } catch {
        notes.push(`tangomango:${id} event page failed (network error)`);
        whole = false;
      }
    }
    if (ids.length > 40) {
      notes.push(`tangomango: ${ids.length - 40} event pages skipped (cap 40)`);
      whole = false;
    }

    // Build listings
    const { listings, screened: moreScreened } = tangoMangoToListings(items, events, {
      metro: ctx.metro,
      fetchedAt: gridResponse.fetchedAt,
      fromNight,
    });
    screened.push(...moreScreened);

    return {
      listings,
      doc,
      notes,
      screened,
      ...(whole ? { whole: true as const } : {}),
    };
  },
};
