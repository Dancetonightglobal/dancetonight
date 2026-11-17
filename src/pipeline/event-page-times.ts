import type { HarvestedListing } from "@/src/adapters/types";
import type { HttpClient } from "@/src/pipeline/http";

export const EVENT_PAGE_TIMES_PER_SOURCE = 8;

/** The local date "YYYY-MM-DD" and time "HH:MM" of a JSON-LD startDate in `tz`, or null. */
export function localStart(startDate: string, tz: string): { date: string; time: string } | null {
  // Trim whitespace
  const trimmed = startDate.trim();
  if (!trimmed) return null;

  // Check if it's just a date (no time part)
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return null;
  }

  // Check if it has a timezone indicator (Z or +/-)
  const hasTimezone = /(Z|[+-]\d{2}:?\d{2})$/.test(trimmed);

  if (!hasTimezone) {
    // No timezone: treat as local to the given tz (i.e., take the literal date and time)
    // Extract date and time parts directly
    const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/);
    if (!match) return null;
    const year = match[1]!;
    const month = match[2]!;
    const day = match[3]!;
    const hour = match[4]!;
    const minute = match[5]!;
    const date = `${year}-${month}-${day}`;
    const time = `${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`;
    // Don't return midnight times
    if (time === "00:00") return null;
    return { date, time };
  }

  // Has timezone: parse as Date and convert to target tz
  let dateObj: Date;
  try {
    dateObj = new Date(trimmed);
    if (isNaN(dateObj.getTime())) {
      return null;
    }
  } catch {
    return null;
  }

  // Format in the target timezone
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });

  const parts = formatter.formatToParts(dateObj);
  const year = parts.find((p) => p.type === "year")?.value;
  const month = parts.find((p) => p.type === "month")?.value;
  const day = parts.find((p) => p.type === "day")?.value;
  const hour = parts.find((p) => p.type === "hour")?.value;
  const minute = parts.find((p) => p.type === "minute")?.value;

  if (!year || !month || !day || !hour || !minute) {
    return null;
  }

  const date = `${year}-${month}-${day}`;
  const time = `${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`;

  // Don't return midnight times
  if (time === "00:00") {
    return null;
  }

  return { date, time };
}

/** Every JSON-LD Event startDate on a page (types "Event" or ending in "Event", in arrays and @graph). */
export function eventStartDates(html: string): string[] {
  const results: string[] = [];

  // Find all script tags with type application/ld+json
  const scriptRegex =
    /<script\s+[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi;
  const matches = html.matchAll(scriptRegex);

  for (const match of matches) {
    const content = match[1] ?? "";
    try {
      const parsed = JSON.parse(content);
      // Walk the parsed object
      const walk = (node: unknown): void => {
        if (Array.isArray(node)) {
          node.forEach(walk);
          return;
        }
        if (typeof node === "object" && node !== null) {
          const obj = node as Record<string, unknown>;
          // Check if it's an Event type
          const type = obj["@type"];
          const isEvent =
            (typeof type === "string" && (type === "Event" || type.endsWith("Event"))) ||
            (Array.isArray(type) &&
              type.some(
                (t: unknown) => typeof t === "string" && (t === "Event" || t.endsWith("Event")),
              ));

          if (isEvent && typeof obj.startDate === "string") {
            results.push(obj.startDate);
          }

          // Walk through all values
          for (const key in obj) {
            const value = obj[key];
            if (value && (typeof value === "object" || Array.isArray(value))) {
              walk(value);
            }
          }
        }
      };

      walk(parsed);
    } catch {
      // Skip invalid JSON
      continue;
    }
  }

  return results;
}

export async function timesFromEventPages(
  listings: readonly HarvestedListing[],
  ctx: { http: HttpClient; pageUrl: string; tz: string; limit?: number },
): Promise<{ listings: HarvestedListing[]; notes: string[] }> {
  const notes: string[] = [];
  const result: HarvestedListing[] = [];
  const limit = ctx.limit ?? EVENT_PAGE_TIMES_PER_SOURCE;

  // Extract hostname without www
  const getHost = (url: string): string | null => {
    try {
      const parsed = new URL(url);
      return parsed.hostname.replace(/^www\./i, "");
    } catch {
      return null;
    }
  };

  const pageHost = getHost(ctx.pageUrl);
  if (!pageHost) {
    // If pageUrl is invalid, return all unchanged
    return { listings: [...listings], notes: [] };
  }

  // Identify candidate listings
  const candidates: Array<{ listing: HarvestedListing; index: number; url: string }> = [];
  for (let i = 0; i < listings.length; i++) {
    const listing = listings[i]!;
    const { local_date, doors_time, lesson_time, dancing_time } = listing.listing;

    // Must have a date and no times
    if (!local_date || doors_time != null || lesson_time != null || dancing_time != null) {
      continue;
    }

    // Must have an eventUrl
    if (!listing.eventUrl) {
      continue;
    }

    // Check if eventUrl is same host as pageUrl
    const eventHost = getHost(listing.eventUrl);
    if (!eventHost || eventHost !== pageHost) {
      continue;
    }

    // Must be http or https
    if (!listing.eventUrl.startsWith("http://") && !listing.eventUrl.startsWith("https://")) {
      continue;
    }

    candidates.push({ listing, index: i, url: listing.eventUrl });
  }

  // Cache for fetched URLs: URL -> startDates[] or Error
  const urlCache = new Map<string, string[]>();
  const urlErrors = new Map<string, string>();
  let timedCount = 0;

  // Process distinct URLs in order, up to limit
  const distinctUrls: string[] = [];
  const urlToCandidates = new Map<string, typeof candidates>();
  for (const candidate of candidates) {
    const url = candidate.url;
    if (!urlToCandidates.has(url)) {
      distinctUrls.push(url);
      urlToCandidates.set(url, []);
    }
    urlToCandidates.get(url)!.push(candidate);
  }

  let fetchedCount = 0;
  for (const url of distinctUrls) {
    if (fetchedCount >= limit) {
      const remaining = distinctUrls.length - fetchedCount;
      if (remaining > 0) {
        notes.push(`${remaining} event page(s) not read (limit ${limit} a source)`);
      }
      break;
    }

    fetchedCount++;

    try {
      const response = await ctx.http.request({
        url,
        purpose: "crawl",
        headers: { accept: "text/html" },
      });

      const startDates = eventStartDates(response.body);
      urlCache.set(url, startDates);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      urlErrors.set(url, message);
      notes.push(`${url}: event page not read (${message})`);
    }
  }

  // Apply cached results to all candidates
  for (let i = 0; i < listings.length; i++) {
    result[i] = listings[i]!;
  }

  for (const [url, candidatesForUrl] of urlToCandidates) {
    const startDates = urlCache.get(url);
    const error = urlErrors.get(url);

    // If there was an error, we leave all candidates unchanged (already set to original)
    if (error) {
      continue;
    }

    if (startDates) {
      for (const candidate of candidatesForUrl) {
        const { listing } = candidate;
        let foundTime: string | null = null;
        let rawStartDate: string | null = null;

        for (const startDate of startDates) {
          const local = localStart(startDate, ctx.tz);
          if (local && local.date === listing.listing.local_date) {
            foundTime = local.time;
            rawStartDate = startDate;
            break;
          }
        }

        if (foundTime) {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { timesWithdrawn: _withdrawn, ...rest } = listing;
          const updatedListing: HarvestedListing = {
            ...rest,
            listing: {
              ...rest.listing,
              dancing_time: foundTime,
              evidence: {
                ...rest.listing.evidence,
                dancing_time: `startDate ${rawStartDate}`,
              },
            },
          };
          result[candidate.index] = updatedListing;
          timedCount++;
        }
      }
    }
  }

  if (timedCount > 0) {
    notes.push(`${timedCount} listing(s) timed from their own event page`);
  }

  return { listings: result, notes };
}
