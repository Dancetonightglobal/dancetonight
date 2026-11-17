// Swing Patrol's class pages: each level's dated table and time, no model (D-524).
// Pages: https://www.swingpatrol.co.uk/classes/<branch>/. robots.txt allows all.
// Structure: level times in <dd>, dated tables in <div class="tab-pane" id="pills-N">.

import { isoToLocal, sha256 } from "@/src/adapters/shared";
import { buildListing, type StructuredEvent } from "@/src/adapters/structured";
import { isStyleKey } from "@/config/styles";
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

// English month names (lowercase)
const ENGLISH_MONTHS: Readonly<Record<string, number>> = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
};

function decodeEntities(text: string): string {
  // First decode &amp; to avoid double encoding
  let result = text.replace(/&amp;/g, "&");
  // Then decode other entities
  const entities: Record<string, string> = {
    "&nbsp;": " ",
    "&#039;": "'",
    "&quot;": '"',
    "&lt;": "<",
    "&gt;": ">",
  };
  for (const [entity, replacement] of Object.entries(entities)) {
    result = result.replace(new RegExp(entity, "g"), replacement);
  }
  return result;
}

function stripTags(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface SwingPatrolLevel {
  level: number;
  time: string | null; // HH:MM
  rows: Array<{ monthDay: string; title: string; note: string }>;
}

export interface SwingPatrolVenue {
  name: string | null;
  address: string | null;
  location: { lat: number; lng: number } | null;
}

export function parseSwingPatrolPage(html: string): {
  levels: SwingPatrolLevel[];
  venue: SwingPatrolVenue;
} {
  const levels: SwingPatrolLevel[] = [];
  const venue: SwingPatrolVenue = { name: null, address: null, location: null };

  // Parse venue from iframe title
  const iframeTitleMatch = /title="(Swing Patrol Venues[^"]*)"/i.exec(html);
  if (iframeTitleMatch) {
    const title = decodeEntities(iframeTitleMatch[1] ?? "").trim();
    // Format: "Swing Patrol Venues - Waterloo: Living Space, 1 Coral St, London SE1 7BE"
    // or "Swing Patrol Venues - Harringay:  The Langham Club, 21 Langham Street, London W1W 6BY"
    // Try pattern with dash first
    const altMatch = /Swing Patrol Venues\s*-\s*([^:]+):\s*(.+)/.exec(title);
    if (altMatch) {
      const rest = altMatch[2]?.trim();
      if (rest) {
        const commaIndex = rest.indexOf(",");
        if (commaIndex !== -1) {
          venue.name = rest.substring(0, commaIndex).trim();
          venue.address = rest.substring(commaIndex + 1).trim();
        } else {
          venue.name = rest;
          venue.address = null;
        }
      }
    } else {
      // Fallback pattern
      const branchMatch = /Swing Patrol Venues[^:]*:\s*(.+)/.exec(title);
      if (branchMatch) {
        const rest = branchMatch[1]?.trim();
        if (rest) {
          const commaIndex = rest.indexOf(",");
          if (commaIndex !== -1) {
            venue.name = rest.substring(0, commaIndex).trim();
            venue.address = rest.substring(commaIndex + 1).trim();
          } else {
            venue.name = rest;
            venue.address = null;
          }
        }
      }
    }
  }

  // Parse location from marker
  const markerMatch = /<div class="marker" data-lat="([^"]+)" data-lng="([^"]+)">/.exec(html);
  if (markerMatch) {
    const lat = parseFloat(markerMatch[1] ?? "");
    const lng = parseFloat(markerMatch[2] ?? "");
    if (!isNaN(lat) && !isNaN(lng)) {
      venue.location = { lat, lng };
    }
  }

  // Parse level times from <dd> content - look for any <dd> that contains level times
  // The pattern might be: <dd><ul><li><strong>Level 1:</strong> 7:00</li>...
  const timeRegex = /Level\s+(\d+):<\/strong>\s*(\d{1,2}):(\d{2})/g;
  const times: Record<number, string> = {};
  let match;
  while ((match = timeRegex.exec(html)) !== null) {
    const level = parseInt(match[1] ?? "0", 10);
    let hour = parseInt(match[2] ?? "0", 10);
    const minute = parseInt(match[3] ?? "0", 10);
    // Convert to 24-hour: 1-11 PM -> add 12, 12 stays 12
    if (hour >= 1 && hour <= 11) {
      hour += 12;
    } else if (hour === 12) {
      // hour stays 12
    }
    times[level] = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  }

  // Parse level tables - look for all divs with id starting with "pills-"
  // We need to find each tab-pane and its content, which may be nested
  // The HTML structure is: <div class="tab-pane fade" id="pills-1" ...> ... <table> ... </table> ... </div>
  // We'll search for the pattern more broadly, including simple HTML without extra attributes
  const paneRegex =
    /<div\s+[^>]*class="[^"]*tab-pane[^"]*"[^>]*id="pills-(\d+)"[^>]*>([\s\S]*?)<\/div>\s*(?=<div|$)/gi;
  let paneMatch;
  while ((paneMatch = paneRegex.exec(html)) !== null) {
    const level = parseInt(paneMatch[1] ?? "0", 10);
    const paneContent = paneMatch[2] ?? "";

    // Look for a table within the pane content
    const tableMatch = /<table[^>]*>([\s\S]*?)<\/table>/is.exec(paneContent);
    if (!tableMatch) continue;

    const rows: Array<{ monthDay: string; title: string; note: string }> = [];
    const tableHtml = tableMatch[1] ?? "";

    // Extract rows from the table
    const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let rowMatch;
    while ((rowMatch = rowRegex.exec(tableHtml)) !== null) {
      const rowHtml = rowMatch[1] ?? "";
      // Extract cells
      const cellRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
      const cells: string[] = [];
      let cellMatch;
      while ((cellMatch = cellRegex.exec(rowHtml)) !== null) {
        cells.push(decodeEntities(stripTags(cellMatch[1] ?? "")).trim());
      }
      if (cells.length >= 2) {
        const monthDay = cells[0] ?? "";
        const title = cells[1] ?? "";
        const note = cells[2] ?? "";
        if (monthDay && title) {
          rows.push({ monthDay, title, note });
        }
      }
    }

    levels.push({
      level,
      time: times[level] ?? null,
      rows,
    });
  }

  return { levels, venue };
}

function parseMonthDay(
  monthDay: string,
  fromYear: number,
  fromMonth: number,
): { year: number; month: number; day: number } | null {
  const parts = monthDay.trim().split(/\s+/);
  if (parts.length < 2) return null;
  const monthName = parts[0]?.toLowerCase();
  const dayMatch = /(\d+)/.exec(parts[1] ?? "");
  if (!monthName || !dayMatch) return null;
  const month = ENGLISH_MONTHS[monthName];
  if (!month) return null;
  const day = parseInt(dayMatch[1] ?? "0", 10);
  if (day < 1 || day > 31) return null;

  // Determine year
  let year = fromYear;
  // If the row's month is more than 6 months before fromNight's month, use next year
  if (month < fromMonth - 6) {
    year = fromYear + 1;
  } else if (month > fromMonth + 6) {
    year = fromYear - 1;
  }

  return { year, month, day };
}

export const swingPatrolAdapter: SourceAdapter = {
  id: "swingpatrol",
  tier: "A",
  limits: { perDomainIntervalMs: CRAWL_INTERVAL_MS },
  async harvest(source: Source, ctx: RunCtx): Promise<HarvestResult> {
    const url = source.url;
    const tz = ctx.metro.tz;
    const fromNight = currentNightDate(ctx.now(), tz);
    const lastNight = addCalendarDays(fromNight, MATERIALIZE_DAYS - 1);

    const notes: string[] = [];
    const listings: HarvestedListing[] = [];
    const seenExternalIds = new Set<string>();

    // Fetch page
    const page = await ctx.http.request({
      url,
      purpose: "crawl" as const,
      headers: { accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1" },
    });

    if (page.status !== 200) {
      throw new Error(`HTTP ${page.status}`);
    }

    const parsed = parseSwingPatrolPage(page.body);

    // Validate we have data
    if (parsed.levels.length === 0) {
      throw new Error("Swing Patrol page has no dated class table (layout changed?)");
    }
    const totalRows = parsed.levels.reduce((sum, level) => sum + level.rows.length, 0);
    if (totalRows === 0) {
      throw new Error("Swing Patrol page has no dated class table (layout changed?)");
    }

    const fromParts = fromNight.split("-").map(Number);
    const fromYear = fromParts[0] ?? 0;
    const fromMonth = fromParts[1] ?? 0;

    let closedCount = 0;
    let noTimeCount = 0;
    let unparseableDateCount = 0;

    for (const level of parsed.levels) {
      const time = level.time;
      for (const row of level.rows) {
        // Skip closed/cancelled rows
        if (/\bclosed\b|\bcancel/i.test(row.title)) {
          closedCount++;
          continue;
        }

        // Skip if no time for this level
        if (!time) {
          noTimeCount++;
          continue;
        }

        // Parse date
        const date = parseMonthDay(row.monthDay, fromYear, fromMonth);
        if (!date) {
          unparseableDateCount++;
          continue;
        }

        const dateStr = `${date.year}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`;
        if (dateStr < fromNight || dateStr > lastNight) {
          continue;
        }

        const externalId = `swingpatrol:${url}:${dateStr}:L${level.level}`;
        if (seenExternalIds.has(externalId)) continue;
        seenExternalIds.add(externalId);

        const start = isoToLocal(`${dateStr} ${time}:00`, tz);
        if (!start) continue;

        const description = `${row.title}, Level ${level.level}, ${time}`;

        const structured: StructuredEvent = {
          externalId,
          title: row.title,
          start,
          end: null,
          description,
          venue: {
            name: parsed.venue.name,
            address: parsed.venue.address,
            url: null,
            location: parsed.venue.location,
          },
          organizer: { name: "Swing Patrol", url: null },
          prices: null,
          ticketUrl: null,
          eventUrl: url,
          cancelled: false,
          styles: source.styles.filter(isStyleKey),
          type: "class",
        };

        const currency = currencyForCountry(ctx.metro.countryCode);
        const built = buildListing(structured, {
          sourceUrl: url,
          fetchedAt: page.fetchedAt,
          method: "feed",
          currency,
        });

        listings.push(built);
      }
    }

    // Add notes
    if (closedCount > 0) {
      notes.push(`${closedCount} closed class date(s) left out`);
    }
    if (noTimeCount > 0) {
      notes.push(`${noTimeCount} row(s) with no level time left out`);
    }
    if (unparseableDateCount > 0) {
      notes.push(`${unparseableDateCount} row(s) with unparseable date left out`);
    }

    const doc = {
      url,
      fetchedAt: page.fetchedAt,
      httpStatus: page.status,
      etag: page.etag,
      lastModified: page.lastModified,
      contentHash: sha256(JSON.stringify(listings.map((l) => [l.externalId, l.listing]))),
      cleanedText: null,
    };

    const result: HarvestResult = {
      listings,
      notes,
      doc,
      whole: true as const,
    };

    return result;
  },
};
