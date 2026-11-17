import type { HarvestedListing } from "@/src/adapters/types";
import type { HttpClient } from "@/src/pipeline/http";
import { eventStartDates, EVENT_PAGE_TIMES_PER_SOURCE } from "@/src/pipeline/event-page-times";
import { foldForMatch } from "@/src/domain/text-facts";

/** The local date "YYYY-MM-DD" and time "HH:MM" (null when none) of a JSON-LD startDate in `tz`, or null. */
export function localDateAndTime(
  startDate: string,
  tz: string,
): { date: string; time: string | null } | null {
  const trimmed = startDate.trim();
  if (!trimmed) return null;

  // Check if it's just a date (no time part)
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return { date: trimmed, time: null };
  }

  // Check if it has a timezone indicator (Z or +/-)
  const hasTimezone = /(Z|[+-]\d{2}:?\d{2})$/.test(trimmed);

  if (!hasTimezone) {
    // No timezone: treat as local to the given tz (i.e., take the literal date and time)
    const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/);
    if (!match) return null;
    const year = match[1]!;
    const month = match[2]!;
    const day = match[3]!;
    const hour = match[4]!;
    const minute = match[5]!;
    const date = `${year}-${month}-${day}`;
    const time = `${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`;
    // Midnight times are considered date-only
    if (time === "00:00") {
      return { date, time: null };
    }
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

  // Midnight times are considered date-only
  if (time === "00:00") {
    return { date, time: null };
  }

  return { date, time };
}

export async function datesFromEventPages(
  listings: readonly HarvestedListing[],
  ctx: {
    http: HttpClient;
    pageUrl: string; // the source page that was read
    pageText: string; // cleaned page text; links are written "label [url]"
    tz: string; // metro IANA zone
    nights: readonly string[]; // the read window, "YYYY-MM-DD", in order
    limit?: number;
  },
): Promise<{ listings: HarvestedListing[]; notes: string[] }> {
  const notes: string[] = [];
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
  const candidates: Array<{
    listing: HarvestedListing;
    index: number;
    url: string;
  }> = [];

  // Helper to check if a URL is same host and not the same page
  const isSameHostAndNotPage = (url: string): boolean => {
    const host = getHost(url);
    if (!host || host !== pageHost) return false;
    // Compare ignoring trailing slash
    const normalize = (u: string) => u.replace(/\/$/, "");
    return normalize(url) !== normalize(ctx.pageUrl);
  };

  // Regex to find links in cleaned page text: label [url]
  const linkRegex = /([^\n\[\]]*)\[(https?:\/\/[^\s\]]+)\]/g;
  const links: Array<{ label: string; url: string }> = [];
  let match;
  while ((match = linkRegex.exec(ctx.pageText)) !== null) {
    const [, label, url] = match;
    if (label && url) {
      links.push({ label: label.trim(), url });
    }
  }

  for (let i = 0; i < listings.length; i++) {
    const listing = listings[i]!;
    const { local_date, recurrence_text } = listing.listing;
    const hasRecurrence = recurrence_text && recurrence_text.trim() !== "";
    const hasRecurrenceObj = listing.recurrence !== null;

    // A listing is a candidate if it has no date, or has recurrence text, or has a recurrence object
    if (!local_date || hasRecurrence || hasRecurrenceObj) {
      let candidateUrl: string | null = null;

      // 1. Use eventUrl if valid
      if (listing.eventUrl && isSameHostAndNotPage(listing.eventUrl)) {
        candidateUrl = listing.eventUrl;
      } else {
        // 2. Title-matched card link
        const foldedTitle = foldForMatch(listing.listing.title);
        if (foldedTitle.length >= 4) {
          const matchingLinks = links.filter((link) => {
            if (!isSameHostAndNotPage(link.url)) return false;
            const foldedLabel = foldForMatch(link.label);
            return foldedLabel.includes(foldedTitle);
          });
          const distinctUrls = [...new Set(matchingLinks.map((l) => l.url))];
          if (distinctUrls.length === 1) {
            candidateUrl = distinctUrls[0]!;
          }
        }
      }

      if (candidateUrl) {
        candidates.push({ listing, index: i, url: candidateUrl });
      }
    }
  }

  // Cache for fetched URLs: URL -> startDates[]
  const urlCache = new Map<string, string[]>();
  const urlErrors = new Map<string, string>();

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
        notes.push(`${remaining} event page(s) not read for dates (limit ${limit} a source)`);
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
      notes.push(`${url}: event page not read for dates (${message})`);
    }
  }

  // Build replacements map: index -> copies (empty array means drop)
  const replacements = new Map<number, HarvestedListing[]>();
  const candidateIndices = new Set(candidates.map((c) => c.index));

  // Pre‑compute existing folded titles per date from non-candidate listings
  const foldedTitlesByDate = new Map<string, Set<string>>();
  for (let i = 0; i < listings.length; i++) {
    if (candidateIndices.has(i)) continue; // skip candidates
    const listing = listings[i]!;
    if (listing.listing.local_date) {
      const folded = foldForMatch(listing.listing.title);
      const set = foldedTitlesByDate.get(listing.listing.local_date) ?? new Set();
      set.add(folded);
      foldedTitlesByDate.set(listing.listing.local_date, set);
    }
  }

  let totalCopies = 0;
  let pagesUsed = 0;

  for (const [url, candidatesForUrl] of urlToCandidates) {
    const startDates = urlCache.get(url);
    const error = urlErrors.get(url);

    if (error || !startDates) {
      continue; // leave candidates unchanged
    }

    // Collect distinct local dates in window, with time and raw startDate
    const dateInfo = new Map<string, { time: string | null; raw: string }>();
    for (const sd of startDates) {
      const local = localDateAndTime(sd, ctx.tz);
      if (!local) continue;
      if (!ctx.nights.includes(local.date)) continue;
      // Keep the first time we encounter for this date
      if (!dateInfo.has(local.date)) {
        dateInfo.set(local.date, { time: local.time, raw: sd });
      }
    }

    if (dateInfo.size === 0) {
      continue;
    }

    let urlProducedCopies = false;

    for (const candidate of candidatesForUrl) {
      const { listing, index } = candidate;
      const copies: HarvestedListing[] = [];

      // Dates in window order
      const windowOrderedDates = [...dateInfo.keys()].sort(
        (a, b) => ctx.nights.indexOf(a) - ctx.nights.indexOf(b),
      );

      for (const date of windowOrderedDates) {
        // Skip if another listing with same folded title already has this date
        const folded = foldForMatch(listing.listing.title);
        const existing = foldedTitlesByDate.get(date)?.has(folded);
        if (existing) {
          continue;
        }

        const info = dateInfo.get(date)!;
        const { time, raw } = info;

        // Build copy
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { fromRule: _fromRule, ...rest } = listing;
        const copy: HarvestedListing = {
          ...rest,
          listing: {
            ...rest.listing,
            local_date: date,
            recurrence_text: null,
            evidence: {
              ...rest.listing.evidence,
              local_date: `startDate ${raw}`,
            },
          },
          recurrence: null,
          externalId: null,
          eventUrl: url,
        };

        // If model gave NO doors/lesson/dancing time AND page gave a time for this date,
        // set dancing_time to that time
        const hasModelTime =
          rest.listing.doors_time != null ||
          rest.listing.lesson_time != null ||
          rest.listing.dancing_time != null;
        if (!hasModelTime && time !== null) {
          copy.listing.dancing_time = time;
          copy.listing.evidence.dancing_time = `startDate ${raw}`;
        }

        // Remove recurrence_text from evidence if present
        if (copy.listing.evidence.recurrence_text) {
          delete copy.listing.evidence.recurrence_text;
        }

        copies.push(copy);

        // Update foldedTitlesByDate for subsequent candidates
        const set = foldedTitlesByDate.get(date) ?? new Set();
        set.add(folded);
        foldedTitlesByDate.set(date, set);
      }

      if (copies.length > 0) {
        replacements.set(index, copies);
        totalCopies += copies.length;
        urlProducedCopies = true;
      } else {
        // Every date was skipped; drop the candidate
        replacements.set(index, []);
      }
    }

    if (urlProducedCopies) {
      pagesUsed++;
    }
  }

  // Build final list
  const result = listings.flatMap((listing, index) => {
    const copies = replacements.get(index);
    if (copies !== undefined) {
      return copies;
    }
    return [listing];
  });

  if (totalCopies > 0) {
    notes.push(`${totalCopies} night(s) taken from ${pagesUsed} event page(s)' list of dates`);
  }

  return { listings: result, notes };
}
