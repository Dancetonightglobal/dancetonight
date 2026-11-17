import type { SeedSource } from "@/config/sources/nyc";
import type { StyleKey } from "@/config/styles";
import type { HarvestedListing, ProvenanceMethod } from "@/src/adapters/types";
import type { LocalMoment } from "@/src/adapters/shared";
import { buildListing, type StructuredEvent } from "@/src/adapters/structured";
import { weeklyRecurrence, firstNightOn } from "@/src/adapters/feeds/weekly-rule";
import { firstMonthlyNight, monthlyRecurrence, validWeeksOfMonth } from "@/src/domain/month-weeks";
import { WEEKDAYS, type Weekday } from "@/src/domain/recurrence";
import { addCalendarDays } from "@/src/domain/time";
import { NIGHT_BOUNDARY_HOUR } from "@/src/domain/tonight";

function hourOf(time: string): number {
  return Number(time.slice(0, 2));
}

export type FixedNight = NonNullable<SeedSource["fixedNights"]>[number];

export interface FixedNightsOptions {
  pageText: string; // the cleaned page text the run fetched
  pageUrl: string;
  fetchedAt: Date;
  fromNight: string; // "YYYY-MM-DD", tonight in the metro
  currency: string | null;
  sourceStyles: readonly StyleKey[];
  venueName: string | null;
  venueAddress: string | null;
  /** The metro's IANA zone: the nights' wall-clock times are in it. */
  zone: string;
}

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  nbsp: " ",
  quot: '"',
  apos: "'",
  lt: "<",
  gt: ">",
  ndash: "-",
  mdash: "-",
};

/** Decodes the HTML entities a raw page uses for text: named basics and numeric (&#8211; &#x2013;). */
function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === "#") {
      const n =
        code[1] === "x" || code[1] === "X"
          ? parseInt(code.slice(2), 16)
          : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : whole;
    }
    return NAMED_ENTITIES[code.toLowerCase()] ?? whole;
  });
}

/**
 * The visible text of a page (raw HTML or cleaned text), normalised for matching: script, style,
 * noscript and template blocks go (Wix embeds its data there), every tag becomes a space, entities
 * are decoded, dashes, quotes, case and spacing are ignored.
 */
function normalizeForMatch(text: string): string {
  let cleaned = text.replace(/<(script|style|noscript|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ");
  cleaned = cleaned.replace(/<[^>]*>/g, " ");
  cleaned = decodeEntities(cleaned);
  cleaned = cleaned.normalize("NFKC");
  cleaned = cleaned.replace(/[\u2010-\u2015\u2212]/g, "-");
  cleaned = cleaned.replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"');
  cleaned = cleaned.replace(/\s+/g, " ").trim();
  return cleaned.toLowerCase();
}

export function lineOnPage(line: string, pageText: string): boolean {
  const normalizedLine = normalizeForMatch(line);
  if (!normalizedLine) return false;
  const normalizedPage = normalizeForMatch(pageText);
  return normalizedPage.includes(normalizedLine);
}

export function fixedNightListings(
  fixed: readonly FixedNight[],
  options: FixedNightsOptions,
): { listings: HarvestedListing[]; notes: string[] } {
  const listings: HarvestedListing[] = [];
  const notes: string[] = [];

  for (const entry of fixed) {
    // Check danceCited
    if (!entry.danceCited?.trim()) {
      notes.push(
        `${entry.title}: fixed night has no danceCited (where dancing is stated); not listed`,
      );
      continue;
    }

    // Check days
    const monthly = entry.weeksOfMonth;
    if (entry.days.length === 0 || (monthly !== undefined && !validWeeksOfMonth(monthly))) {
      notes.push(`${entry.title}: fixed night has bad days or times in config; not listed`);
      continue;
    }

    // Check start/end format if provided
    const timeRegex = /^([01]\d|2[0-3]):[0-5]\d$/;
    if (entry.start !== null && !timeRegex.test(entry.start)) {
      notes.push(`${entry.title}: fixed night has bad days or times in config; not listed`);
      continue;
    }
    if (entry.end !== undefined && !timeRegex.test(entry.end)) {
      notes.push(`${entry.title}: fixed night has bad days or times in config; not listed`);
      continue;
    }

    // Validate closed ranges if present
    if (entry.closed) {
      let hasInvalidClosed = false;
      for (const range of entry.closed) {
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (!dateRegex.test(range.from) || !dateRegex.test(range.to)) {
          hasInvalidClosed = true;
          break;
        }
        if (range.from > range.to) {
          hasInvalidClosed = true;
          break;
        }
        if (!range.cited.trim()) {
          hasInvalidClosed = true;
          break;
        }
      }
      if (hasInvalidClosed) {
        notes.push(`${entry.title}: fixed night has a bad closed range in config; not listed`);
        continue;
      }
    }

    // Check if line is on page
    if (!lineOnPage(entry.line, options.pageText)) {
      notes.push(`${entry.title}: the page no longer writes "${entry.line}"; not listed`);
      continue;
    }

    // Convert days numbers to Weekday strings
    const weekdays: Weekday[] = entry.days.map((n) => WEEKDAYS[(n + 6) % 7]!);

    // Find first night
    const night = monthly
      ? firstMonthlyNight(weekdays, monthly, options.fromNight)
      : firstNightOn(weekdays, options.fromNight);
    if (!night) {
      // Should not happen because days is non-empty
      notes.push(`${entry.title}: could not find a matching night; not listed`);
      continue;
    }

    // A start before the night boundary (06:00, D-004) is after midnight: on the calendar day after the
    // night. The weekly rule is written in calendar days, so its weekdays and first date move with it;
    // the listing's night stays the night the config names.
    const startAfterMidnight = entry.start !== null && hourOf(entry.start) < NIGHT_BOUNDARY_HOUR;
    // The day after the 2nd Wednesday is not always the 2nd Thursday: a monthly rule cannot move (D-827).
    if (monthly && startAfterMidnight) {
      notes.push(
        `${entry.title}: a monthly fixed night starting after midnight is not supported; not listed`,
      );
      continue;
    }
    const startDay = startAfterMidnight ? addCalendarDays(night, 1) : night;
    const ruleDays = startAfterMidnight
      ? weekdays.map((w) => WEEKDAYS[(WEEKDAYS.indexOf(w) + 1) % 7]!)
      : weekdays;
    const recurrence = monthly
      ? monthlyRecurrence(ruleDays, monthly, startDay, entry.start)
      : weeklyRecurrence(ruleDays, startDay, entry.start);

    // Build exdates from closed ranges
    const exdatesSet = new Set<string>();
    if (entry.closed) {
      for (const range of entry.closed) {
        // Skip ranges entirely before fromNight
        if (range.to < options.fromNight) {
          continue;
        }
        // Add note for ranges that are at least partially after fromNight
        if (range.to >= options.fromNight) {
          notes.push(`${entry.title}: closed ${range.from} to ${range.to} (${range.cited})`);
        }
        // Determine start date for exdates: max(range.from, options.fromNight)
        const start = range.from >= options.fromNight ? range.from : options.fromNight;
        let current = start;
        let steps = 0;
        // Cap each range at 400 days to avoid infinite loops
        while (current <= range.to && steps < 400) {
          exdatesSet.add(current);
          current = addCalendarDays(current, 1);
          steps++;
        }
      }
    }
    // Convert to sorted array
    const exdates = Array.from(exdatesSet).sort();
    recurrence.exdates = exdates;

    // The end is on the start's calendar day, or the day after when it is not later than the start.
    const endDay =
      entry.end && entry.start && entry.end <= entry.start
        ? addCalendarDays(startDay, 1)
        : startDay;

    const startMoment: LocalMoment = {
      day: startDay,
      night,
      time: entry.start,
      zone: options.zone,
      absolute: false,
    };

    const endMoment: LocalMoment | null =
      entry.end && entry.start
        ? {
            day: endDay,
            // An end after midnight still belongs to the listing's night (D-004).
            night,
            time: entry.end,
            zone: options.zone,
            absolute: false,
          }
        : null;

    // Build StructuredEvent
    const venueName = entry.venue?.trim() ? entry.venue.trim() : options.venueName;
    const event: StructuredEvent = {
      externalId: `${options.pageUrl}#fixed:${entry.title}`,
      title: entry.title,
      start: startMoment,
      end: endMoment,
      description: null,
      venue: {
        name: venueName,
        address: options.venueAddress,
        url: null,
        location: null,
      },
      organizer: { name: null, url: null },
      prices: null,
      ticketUrl: null,
      eventUrl: null,
      cancelled: false,
      styles: [...(entry.styles ?? options.sourceStyles)],
      evidence: {
        start: `page line "${entry.line}"`.slice(0, 300),
      },
    };

    // Build listing
    const listing = buildListing(event, {
      sourceUrl: options.pageUrl,
      fetchedAt: options.fetchedAt,
      method: "manual" as ProvenanceMethod,
      currency: options.currency,
    });

    // Attach recurrence
    listing.recurrence = recurrence;

    listings.push(listing);
    notes.push(
      `${entry.title}: fixed ${monthly ? "monthly" : "weekly"} night from the page line "${entry.line}"`,
    );
  }

  return { listings, notes };
}
