// 19hz.info reader: dated club nights from a region's listing table (D-526, D-1161)
// https://19hz.info/eventlisting_LosAngeles.php
// No terms page, robots.txt 404, owner said read it daily (D-1161).

import { buildListing } from "@/src/adapters/structured";
import type {
  HarvestedListing,
  HarvestResult,
  RunCtx,
  Source,
  SourceAdapter,
} from "@/src/adapters/types";
import { currentNightDate } from "@/src/domain/tonight";
import { CRAWL_INTERVAL_MS } from "@/src/pipeline/http";
import { currencyForCountry, parsePriceText } from "@/src/domain/prices";
import { addCalendarDays } from "@/src/domain/time";
import { httpUrl, sha256, isoToLocal, decodeEntities } from "@/src/adapters/shared";
import { isStyleKey } from "@/config/styles";
import { MATERIALIZE_DAYS } from "@/src/domain/recurrence";
import { titleNamesOutsideTown, METRO_REGIONS } from "@/config/metro-regions";

export interface NineteenHzRow {
  sortDate: string | null; // "2026-11-06"
  dateText: string;
  timeText: string;
  title: string;
  url: string | null;
  venue: string | null;
  town: string | null;
  tags: string[];
  priceText: string;
  organisers: string;
}

/**
 * Extract rows from 19hz HTML table.
 */
export function nineteenHzRows(html: string): NineteenHzRow[] {
  const rows: NineteenHzRow[] = [];

  // Find all table rows
  const trMatches = html.match(/<tr[\s\S]*?<\/tr>/g);
  if (!trMatches) return rows;

  for (const tr of trMatches) {
    // Skip header rows (contain <th>)
    if (tr.includes("<th")) continue;

    // Split on <td> openings (not on </td>)
    const tdParts: string[] = [];
    let remaining = tr;
    while (true) {
      const match = remaining.match(/<td[^>]*>/);
      if (!match) break;
      const startIdx = match.index! + match[0].length;
      remaining = remaining.slice(startIdx);

      // Find next <td> or </tr>
      const nextTd = remaining.search(/<td[^>]*>|<\/tr>/);
      if (nextTd === -1) break;
      const cellContent = remaining.slice(0, nextTd);
      tdParts.push(cellContent);
      remaining = remaining.slice(nextTd);
    }

    if (tdParts.length < 6) continue;

    // Cell 0: Date/time
    const dateTimeContent = tdParts[0] ?? "";
    const dateText = decodeEntities((dateTimeContent.split("<br>")[0] || "").trim());
    const timeMatch = dateTimeContent.match(/\(([^)]+)\)/);
    const timeText = timeMatch ? decodeEntities(timeMatch[1] ?? "") : "";

    // Cell 1: Title and venue
    const titleContent = tdParts[1] ?? "";

    // Extract link
    const linkMatch = titleContent.match(/<a\s+[^>]*href=['"]([^'"]*)['"][^>]*>([\s\S]*?)<\/a>/);
    const title = linkMatch ? decodeEntities((linkMatch[2] ?? "").trim()) : "";
    const url = linkMatch ? (linkMatch[1] ?? null) : null;

    // Extract venue and town
    const venueMatch = titleContent.match(/@\s*([^(]+)\s*\(([^)]+)\)/);
    let venue: string | null = null;
    let town: string | null = null;
    if (venueMatch) {
      venue = decodeEntities((venueMatch[1] ?? "").trim());
      town = decodeEntities((venueMatch[2] ?? "").trim());
    }

    // Cell 2: Tags
    const tagsText = decodeEntities((tdParts[2] ?? "").trim());
    const tags = tagsText
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    // Cell 3: Price and age
    const priceText = decodeEntities((tdParts[3] ?? "").trim());

    // Cell 4: Organisers
    const organisers = decodeEntities((tdParts[4] ?? "").trim());

    // Cell 6: Sort date (if present)
    let sortDate: string | null = null;
    if (tdParts.length >= 7) {
      const sortDateCell = tdParts[6] ?? "";
      const sortDateMatch = sortDateCell.match(
        /<div\s+class=['"]shrink['"][^>]*>([\s\S]*?)<\/div>/,
      );
      if (sortDateMatch) {
        const dateStr = decodeEntities((sortDateMatch[1] ?? "").trim());
        if (dateStr) {
          const [year, month, day] = dateStr.split("/");
          if (year && month && day) {
            sortDate = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
          }
        }
      }
    }

    rows.push({
      sortDate,
      dateText,
      timeText,
      title,
      url,
      venue,
      town,
      tags,
      priceText,
      organisers,
    });
  }

  return rows;
}

/**
 * Parse time text to extract start and end times.
 * Returns [startTime, endTime] where times are in HH:MM format (24-hour).
 * Returns null if no time can be parsed.
 */
function parseTimeRange(timeText: string): [string, string | null] | null {
  if (!timeText.trim()) return null;

  // Match patterns like "9pm-2am", "10:30pm-2am", "7pm", "4am-11am", "4pm"
  const timeMatch = timeText.match(/(\d{1,2}(?::\d{2})?)([ap]m)(?:-(\d{1,2}(?::\d{2})?)([ap]m))?/i);
  if (!timeMatch) return null;

  const startHourStr = timeMatch[1] ?? "";
  const startPeriod = (timeMatch[2] ?? "").toLowerCase();
  const endHourStr = timeMatch[3] ?? "";
  const endPeriod = (timeMatch[4] ?? "").toLowerCase();

  const startHour = parseInt(startHourStr.split(":")[0] ?? "0", 10);
  const startMinute = startHourStr.includes(":")
    ? parseInt(startHourStr.split(":")[1] ?? "0", 10)
    : 0;
  const endHour = endHourStr ? parseInt(endHourStr.split(":")[0] ?? "0", 10) : null;
  const endMinute = endHourStr?.includes(":") ? parseInt(endHourStr.split(":")[1] ?? "0", 10) : 0;

  // Convert to 24-hour format
  let start24 = startHour;
  if (startPeriod === "pm" && startHour !== 12) start24 += 12;
  if (startPeriod === "am" && startHour === 12) start24 = 0;

  let end24: number | null = null;
  if (endHour !== null && endPeriod) {
    end24 = endHour;
    if (endPeriod === "pm" && endHour !== 12) end24 += 12;
    if (endPeriod === "am" && endHour === 12) end24 = 0;
  }

  const startTime = `${start24.toString().padStart(2, "0")}:${startMinute.toString().padStart(2, "0")}`;
  const endTime =
    end24 !== null
      ? `${end24.toString().padStart(2, "0")}:${endMinute.toString().padStart(2, "0")}`
      : null;

  return [startTime, endTime];
}

/**
 * Check if venue should be skipped.
 */
function skipVenue(venue: string | null): boolean {
  if (!venue) return true;
  const lower = venue.toLowerCase();
  return lower === "tba" || lower === "tbd" || lower === "secret location" || lower.trim() === "";
}

/**
 * Check if URL should be kept (not Facebook/Instagram).
 */
function keepUrl(url: string | null): boolean {
  if (!url) return false;
  const parsed = httpUrl(url);
  if (!parsed) return false;
  const host = new URL(parsed).hostname.toLowerCase();
  return !(
    host.includes("instagram.com") ||
    host.includes("facebook.com") ||
    host.includes("fb.me")
  );
}

export const nineteenHzAdapter: SourceAdapter = {
  id: "nineteenhz",
  tier: "A",
  countries: ["US", "CA"],
  limits: { perDomainIntervalMs: CRAWL_INTERVAL_MS },
  async harvest(source: Source, ctx: RunCtx): Promise<HarvestResult> {
    const url = source.feedUrl ?? source.url;
    // robots.txt answers 404 today (allowed); if 19hz adds a Disallow, stop reading (coverage, 2026-11-07).
    const path = new URL(url).pathname;
    const policy = await ctx.http.robots(url);
    if (!policy.isAllowed(path)) {
      throw new Error(
        policy.unreadable
          ? `19hz robots.txt unreadable (${policy.unreadable}); not read`
          : `19hz robots.txt disallows ${path} (rule: ${policy.ruleFor(path) ?? "unknown"})`,
      );
    }
    const page = await ctx.http.request({
      url,
      purpose: "crawl",
      headers: { accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1" },
    });

    const rows = nineteenHzRows(page.body);
    if (rows.length === 0) {
      throw new Error("19hz page shows no dated rows");
    }

    const fromNight = currentNightDate(ctx.now(), ctx.metro.tz);
    const lastNight = addCalendarDays(fromNight, MATERIALIZE_DAYS - 1);
    const currency = currencyForCountry(ctx.metro.countryCode);

    const notes: string[] = [];
    const listings: HarvestedListing[] = [];

    let dated = 0;
    let weeklySkipped = 0;
    let inWindow = 0;
    let outside = 0;
    let noVenue = 0;
    let noTime = 0;
    let listed = 0;

    for (const row of rows) {
      // Count dated vs weekly
      if (row.sortDate) {
        dated++;
      } else {
        weeklySkipped++;
        continue;
      }

      // Parse start date and time
      const timeRange = parseTimeRange(row.timeText);
      if (!timeRange) {
        noTime++;
        continue;
      }
      const [startTime, endTime] = timeRange;

      const startDateTime = `${row.sortDate}T${startTime}`;
      const startLocal = isoToLocal(startDateTime, ctx.metro.tz);
      if (!startLocal) {
        noTime++;
        continue;
      }

      // Window filter
      if (startLocal.night < fromNight || startLocal.night > lastNight) {
        continue;
      }
      inWindow++;

      // Venue filter
      if (skipVenue(row.venue)) {
        noVenue++;
        continue;
      }

      // Metro filter
      if (row.town) {
        const towns = row.town.split("/").map((t) => t.trim());
        const isOutside = towns.some((town) => {
          // Check town alone
          if (titleNamesOutsideTown(ctx.metro.slug, town) !== null) {
            return true;
          }
          // Check town with state abbreviation
          const regions = METRO_REGIONS[ctx.metro.slug];
          if (regions && regions.length > 0) {
            const state = regions[0]; // e.g., "CA"
            const townWithState = `${town}, ${state}`;
            if (titleNamesOutsideTown(ctx.metro.slug, townWithState) !== null) {
              return true;
            }
          }
          return false;
        });
        if (isOutside) {
          outside++;
          continue;
        }
      }

      // URL handling
      let ticketUrl: string | null = null;
      let eventUrl: string | null = null;
      if (keepUrl(row.url)) {
        ticketUrl = httpUrl(row.url);
        eventUrl = ticketUrl;
      } else {
        eventUrl = url;
      }

      // Price parsing
      const pricePart = row.priceText.split("|")[0]?.trim();
      let prices = null;
      if (pricePart && !/^(21\+|18\+|All Ages)$/i.test(pricePart)) {
        prices = parsePriceText(pricePart, currency);
      }

      // End time handling
      let endLocal = null;
      if (endTime) {
        let endDate = row.sortDate;
        // If end time is earlier than start time (crossing midnight), add one day
        const startParts = startTime.split(":").map(Number);
        const endParts = endTime.split(":").map(Number);
        const sh = startParts[0] ?? 0;
        const sm = startParts[1] ?? 0;
        const eh = endParts[0] ?? 0;
        const em = endParts[1] ?? 0;
        if (eh < sh || (eh === sh && em < sm)) {
          endDate = addCalendarDays(endDate, 1);
        }
        const endDateTime = `${endDate}T${endTime}`;
        endLocal = isoToLocal(endDateTime, ctx.metro.tz);
      }

      // Venue handling: a bare venue name ("Kingdom") gets its town as the address hint, so the row places and merges
      // with the same night from RA, Etix or DICE (Austin's first read, coverage-116, 2026-11-07).
      let venueName: string | null = null;
      let venueAddress: string | null = null;
      if (row.venue) {
        const isStreetAddress = /^\d/.test(row.venue);
        if (isStreetAddress) {
          // Street address: name null, address includes town if present.
          venueName = null;
          venueAddress = row.town ? `${row.venue}, ${row.town}` : row.venue;
        } else {
          // Bare venue name: keep name, address becomes "Venue, Town" if town exists.
          venueName = row.venue;
          venueAddress = row.town ? `${row.venue}, ${row.town}` : null;
        }
      }

      // Keyed on the ticket page when there is one, so a title edit on 19hz keeps the same row (coverage, 2026-11-07).
      const idKey = ticketUrl ?? `${row.sortDate}|${row.venue}|${row.title}`;
      const externalId = `19hz:${sha256(idKey).slice(0, 16)}`;

      const built = buildListing(
        {
          externalId,
          title: row.title,
          start: startLocal,
          end: endLocal,
          description: null,
          venue: {
            name: venueName,
            address: venueAddress,
            url: null,
            location: null,
          },
          organizer: { name: row.organisers || null, url: null },
          prices,
          ticketUrl,
          eventUrl,
          cancelled: false,
          styles: source.styles.filter(isStyleKey),
          type: "social",
          evidence: {
            start: `${row.dateText} ${row.timeText}, 19hz`,
          },
        },
        {
          sourceUrl: url,
          fetchedAt: page.fetchedAt,
          method: "feed",
          currency,
        },
      );
      listings.push(built);
      listed++;
    }

    notes.unshift(
      `${rows.length} rows; ${dated} dated; ${weeklySkipped} weekly rows skipped; ${inWindow} in the window; ${outside} outside the metro; ${noVenue} no venue; ${noTime} no time; ${listed} listed`,
    );

    return {
      listings,
      notes,
      doc: {
        url,
        fetchedAt: page.fetchedAt,
        httpStatus: page.status,
        etag: page.etag,
        lastModified: page.lastModified,
        contentHash: sha256(JSON.stringify(listings.map((l) => [l.externalId, l.listing]))),
        cleanedText: null,
      },
    };
  },
};
