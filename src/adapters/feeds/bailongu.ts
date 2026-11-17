// Bailongu (Barcelona) monthly agenda pages: Sunday socials at Passatge d'Utset 11-13.
// Pages: https://www.bailongu.com/agenda/YYYY-M (month not zero-padded). robots.txt allows /agenda.
// Structure: <ul class="agenda-list"> with month headers, day headers, and event items.

import { isoToLocal, sha256 } from "@/src/adapters/shared";
import { buildListing, type StructuredEvent } from "@/src/adapters/structured";
import { isStyleKey, type StyleKey } from "@/config/styles";
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

// Catalan month names (lowercase)
const CATALAN_MONTHS: Readonly<Record<string, number>> = {
  gener: 1,
  febrer: 2,
  març: 3,
  abril: 4,
  maig: 5,
  juny: 6,
  juliol: 7,
  agost: 8,
  setembre: 9,
  octubre: 10,
  novembre: 11,
  desembre: 12,
};

// Simple HTML entity decoder (covers common entities in the fixtures)
function decodeEntities(text: string): string {
  // First decode &amp; to avoid double encoding
  let result = text.replace(/&amp;/g, "&");
  // Then decode other entities
  const entities: Record<string, string> = {
    "&nbsp;": " ",
    "&agrave;": "à",
    "&Agrave;": "À",
    "&egrave;": "è",
    "&Egrave;": "È",
    "&eacute;": "é",
    "&Eacute;": "É",
    "&ccedil;": "ç",
    "&Ccedil;": "Ç",
    "&iuml;": "ï",
    "&Iuml;": "Ï",
    "&ouml;": "ö",
    "&Ouml;": "Ö",
    "&uuml;": "ü",
    "&Uuml;": "Ü",
    "&euro;": "€",
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

export interface BailonguEvent {
  date: string; // YYYY-MM-DD
  title: string;
  text: string; // description (paragraphs joined)
  href: string | null;
}

export function parseBailonguMonth(html: string): BailonguEvent[] {
  const events: BailonguEvent[] = [];

  // Find the agenda list
  const listMatch = /<ul class="agenda-list">([\s\S]*?)<\/ul>/.exec(html);
  if (!listMatch) return events;

  const listContent = listMatch[1] ?? "";
  const lines = listContent.split(/(?=<li)/);

  let currentYear: number | null = null;
  let currentMonth: number | null = null;
  let currentDay: number | null = null;

  for (const line of lines) {
    // Month header
    const monthMatch = /<li class="agenda-month">\s*<h2>([^<]+)<\/h2>/.exec(line);
    if (monthMatch) {
      const monthText = decodeEntities((monthMatch[1] ?? "").trim());
      const parts = monthText.split(/\s*-\s*/);
      if (parts.length === 2) {
        const monthName = (parts[0] ?? "").toLowerCase().trim();
        const year = parseInt((parts[1] ?? "").trim(), 10);
        if (CATALAN_MONTHS[monthName] && !isNaN(year)) {
          currentMonth = CATALAN_MONTHS[monthName];
          currentYear = year;
        }
      }
      continue;
    }

    // Day header
    const dayMatch = /<li class="agenda-day-header">\s*<span>([^<]+)<\/span>/.exec(line);
    if (dayMatch) {
      const dayText = decodeEntities((dayMatch[1] ?? "").trim());
      const dayNumMatch = /(\d+)/.exec(dayText);
      if (dayNumMatch && currentYear && currentMonth) {
        currentDay = parseInt(dayNumMatch[1] ?? "0", 10);
      }
      continue;
    }

    // Event
    const eventMatch = /<li class="agenda-event">([\s\S]*?)<\/li>/.exec(line);
    if (eventMatch && currentYear && currentMonth && currentDay) {
      const eventContent = eventMatch[1] ?? "";

      // Extract href and title from <a><h3>
      const linkMatch = /<a\s+(?:[^>]*?\s+)?href="([^"]*)"[^>]*>\s*<h3>([^<]+)<\/h3>/.exec(
        eventContent,
      );
      const hrefRaw = linkMatch?.[1];
      const href = hrefRaw && /^https?:\/\//.test(hrefRaw) ? decodeEntities(hrefRaw) : null;
      const titleRaw = linkMatch?.[2];
      const title = titleRaw ? decodeEntities(stripTags(titleRaw)).trim() : "";

      // Extract all <p> content
      const paragraphs: string[] = [];
      const pRegex = /<p>(.*?)<\/p>/gs;
      let pMatch;
      while ((pMatch = pRegex.exec(eventContent)) !== null) {
        paragraphs.push(decodeEntities(stripTags(pMatch[1] ?? "")));
      }
      const text = paragraphs.join("\n");

      const dateStr = `${currentYear}-${String(currentMonth).padStart(2, "0")}-${String(currentDay).padStart(2, "0")}`;

      events.push({
        date: dateStr,
        title,
        text,
        href,
      });
    }
  }

  return events;
}

function extractTimeRange(
  text: string,
): { startHour: number; startMinute: number; endHour: number; endMinute: number } | null {
  const timeRegex = /\bde\s+(\d{1,2})(?:[:.](\d{2}))?\s*h?\s+a\s+(\d{1,2})(?:[:.](\d{2}))?\s*h\b/i;
  const match = timeRegex.exec(text);
  if (!match) return null;

  const startHour = parseInt(match[1] ?? "0", 10);
  const startMinute = match[2] !== undefined ? parseInt(match[2], 10) : 0;
  const endHour = parseInt(match[3] ?? "0", 10);
  const endMinute = match[4] !== undefined ? parseInt(match[4], 10) : 0;

  return { startHour, startMinute, endHour, endMinute };
}

function extractPrice(text: string): number | null {
  const priceMatch = /Entrada\s+(\d+)\s*€/i.exec(text);
  return priceMatch ? parseInt(priceMatch[1] ?? "0", 10) : null;
}

function getStyles(title: string, sourceStyles: readonly StyleKey[]): StyleKey[] {
  const lowerTitle = title.toLowerCase();
  if (lowerTitle.includes("salsongu")) {
    return ["salsa", "bachata"];
  }
  if (lowerTitle.includes("son cub")) {
    return ["son"];
  }
  if (lowerTitle.includes("rock")) {
    return ["rock_n_roll", "ballroom"];
  }
  if (lowerTitle.includes("bailongu ball")) {
    return ["ballroom"];
  }
  if (lowerTitle.includes("sevillan")) {
    return ["sevillanas"];
  }
  return [...sourceStyles];
}

export const bailonguAdapter: SourceAdapter = {
  id: "bailongu",
  tier: "A",
  limits: { perDomainIntervalMs: CRAWL_INTERVAL_MS },
  async harvest(source: Source, ctx: RunCtx): Promise<HarvestResult> {
    const baseUrl = source.url; // https://www.bailongu.com/agenda
    const tz = ctx.metro.tz;
    const fromNight = currentNightDate(ctx.now(), tz);
    const lastNight = addCalendarDays(fromNight, MATERIALIZE_DAYS - 1);

    const notes: string[] = [];
    const listings: HarvestedListing[] = [];
    const seenExternalIds = new Set<string>();

    // Determine which months to fetch
    const monthsToFetch: Array<{ year: number; month: number }> = [];
    const fromParts = fromNight.split("-").map(Number);
    const lastParts = lastNight.split("-").map(Number);
    const fromYear = fromParts[0] ?? 0;
    const fromMonth = fromParts[1] ?? 0;
    const lastYear = lastParts[0] ?? 0;
    const lastMonth = lastParts[1] ?? 0;

    // Add months touched by the window
    const addMonth = (year: number, month: number) => {
      if (!monthsToFetch.some((m) => m.year === year && m.month === month)) {
        monthsToFetch.push({ year, month });
      }
    };

    addMonth(fromYear, fromMonth);
    addMonth(lastYear, lastMonth);

    // Sort by year-month
    monthsToFetch.sort((a, b) => a.year - b.year || a.month - b.month);

    let allPagesSuccessful = true;
    let firstPage: {
      fetchedAt: Date;
      status: number;
      etag: string | null;
      lastModified: string | null;
    } | null = null;

    let noTimeCount = 0;
    let workshopCount = 0;
    let streetEventCount = 0;

    for (const { year, month } of monthsToFetch) {
      const url = `${baseUrl}/${year}-${month}`; // no zero-padding
      try {
        const page = await ctx.http.request({
          url,
          purpose: "crawl" as const,
          headers: { accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1" },
        });

        if (page.status !== 200) {
          notes.push(`${url}: not read (HTTP ${page.status})`);
          allPagesSuccessful = false;
          continue;
        }

        if (!firstPage) {
          firstPage = {
            fetchedAt: page.fetchedAt,
            status: page.status,
            etag: page.etag,
            lastModified: page.lastModified,
          };
        }

        const events = parseBailonguMonth(page.body);

        for (const event of events) {
          // Compare dates as strings (YYYY-MM-DD)
          if (event.date < fromNight || event.date > lastNight) {
            continue;
          }

          // Screen workshops/courses
          const trimmedTitle = event.title.trim();
          if (/^(tallers?|nous cursos)/i.test(trimmedTitle)) {
            workshopCount++;
            continue;
          }

          // Screen street events
          if (
            event.text.split("\n").some((line) => line.trim().toLowerCase().startsWith("carrer "))
          ) {
            streetEventCount++;
            continue;
          }

          // Extract time
          const timeRange = extractTimeRange(event.text);
          if (!timeRange) {
            noTimeCount++;
            continue;
          }

          // Build start and end moments
          const hhmm = (h: number, m: number) =>
            `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
          const startTime = hhmm(timeRange.startHour, timeRange.startMinute);
          const endTime = hhmm(timeRange.endHour, timeRange.endMinute);

          const start = isoToLocal(`${event.date} ${startTime}:00`, tz);
          if (!start) continue;

          // Determine end date
          const endDate =
            timeRange.endHour < timeRange.startHour ||
            (timeRange.endHour === timeRange.startHour &&
              timeRange.endMinute < timeRange.startMinute)
              ? addCalendarDays(event.date, 1)
              : event.date;
          const end = isoToLocal(`${endDate} ${endTime}:00`, tz);

          const externalId = `bailongu:${event.date}:${event.title}`;
          if (seenExternalIds.has(externalId)) continue;
          seenExternalIds.add(externalId);

          const priceAmount = extractPrice(event.text);
          const prices = priceAmount
            ? [{ label: "Entry", amount: priceAmount, currency: "EUR", includes: null }]
            : null;

          const structured: StructuredEvent = {
            externalId,
            title: event.title.trim(),
            start,
            end,
            description: event.text,
            venue: {
              name: "Bailongu",
              address: "Passatge d'Utset 11-13, 08013 Barcelona",
              url: null,
              location: null,
            },
            organizer: { name: null, url: null },
            prices,
            ticketUrl: null,
            eventUrl: event.href,
            cancelled: false,
            styles: getStyles(event.title, source.styles.filter(isStyleKey)),
            type: "practica",
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
      } catch (error) {
        notes.push(`${url}: not read (${error instanceof Error ? error.message : String(error)})`);
        allPagesSuccessful = false;
      }
    }

    // Add notes
    if (noTimeCount > 0) {
      notes.push(`${noTimeCount} event(s) with no time left out`);
    }
    if (workshopCount > 0) {
      notes.push(`${workshopCount} workshop/course row(s) left out`);
    }
    if (streetEventCount > 0) {
      notes.push(`${streetEventCount} street event(s) left out`);
    }

    // Determine if whole
    const whole = allPagesSuccessful && monthsToFetch.length > 0;

    const doc = {
      url: `${baseUrl}/${monthsToFetch[0]?.year}-${monthsToFetch[0]?.month}` || baseUrl,
      fetchedAt: firstPage?.fetchedAt ?? ctx.now(),
      httpStatus: firstPage?.status ?? 200,
      etag: firstPage?.etag ?? null,
      lastModified: firstPage?.lastModified ?? null,
      contentHash: sha256(JSON.stringify(listings.map((l) => [l.externalId, l.listing]))),
      cleanedText: null,
    };

    const result: HarvestResult = {
      listings,
      notes,
      doc,
    };
    if (whole) {
      result.whole = true as const;
    }

    return result;
  },
};
