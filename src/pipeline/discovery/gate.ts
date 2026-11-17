// The page-level dance gate (D-040 step 3, D-124). Pure.
//
// An events page with no feed and no structure can be read only by a model, and every page
// switched on is one model read per harvest. The gate decides which of them earn that read, from
// the page discovery already fetched, without a model (D-040: discovery calls no model):
//
// 1. The page is HTML. A PDF deck or an image is not a calendar the extraction reads.
// 2. It lists nights to come: at least two distinct dates in the next GATE_HORIZON_DAYS, or a
//    weekly night ("every Thursday", "Latin Mix Saturdays").
// 3. A dance or salsa club's page passes on its nights alone: Overture says the place has a dance
//    floor, and its nights ("JULIAN JORDAN", "LAVISH SATURDAYS") rarely name a style. Any other
//    group (a lounge, an event venue) passes when the page names a dance style family, a generic
//    dance word (e.g., "dance", "baile", "dans"), or DJ nights. DJ nights count for every group
//    except a studio. A studio's page passes only when it lists socials (practica, milonga,
//    social dance party); class timetables are deferred (docs/WORKSTREAMS.md 2.8).
//
// What passes is still screened per listing (D-083's concert screen, through `mixedCalendar`).

import { matchStyles, type FamilyKey } from "@/config/styles";
import { addCalendarDays, localDateOf, toIsoDate } from "@/src/domain/time";
import { monthNames } from "@/src/domain/text-facts";
import {
  PARSE_LANGS,
  parseRecurrenceText,
  recurrenceDayTokens,
  normalizeRecurrenceText,
} from "@/src/domain/recurrence";

/** Fold text for case-insensitive matching: NFKD, combining marks stripped, lowercased, ı→i. */
function fold(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\u0131/g, "i");
}

/** Generic dance words that count as naming a dance, for every group except a studio. */
const DANCE_WORD =
  /(?<![\p{L}\p{N}])(dance|dances|dancing|dancers|dancer|baile|bailes|bailar|bailable|danza|danzas|danca|dancas|dancar|dansa|danses|danse|danser|dans|dansi|halay|horon|milonga|milongas|practica|practicas|ceilidh|ceili|contra dance|line dancing|social dance)(?![\p{L}\p{N}])/giu;
/** Chinese dance substrings (no letter-boundary needed). */
const CHINESE_DANCE = /跳舞|舞會|舞会/g;
/** DJ-related words, whole-word, case-insensitive. */
const DJ_WORD = /\b(dj|djs|b2b|open decks|dance party|all night long|selector|resident dj)\b/i;
/** Social words that make a studio's page pass. */
const SOCIAL_WORD =
  /(?<![\p{L}\p{N}])(social|socials|practica|practicas|milonga|milongas|dance party|baile social|soiree|soirees|jam|jams|fiesta|party night)(?![\p{L}\p{N}])/giu;

/** How far ahead a dated night counts. Two weeks of a club's calendar is what a run reads. */
export const GATE_HORIZON_DAYS = 45;

/** The groups that pass on dated nights alone (candidates.ts `priorityOf`). */
const NIGHTS_ALONE = new Set(["dance or salsa club"]);

/** Bump when the gate's rules change, so pages it held are judged again. */
export const GATE_VERSION = 4; // 4: generic dance words, DJ nights for all, studio socials, open feeds (D-559).

export interface GateVerdict {
  pass: boolean;
  /** In words, for the report and the row's health. */
  reason: string;
  /** Distinct upcoming dates the page writes, as ISO dates, at most 10. */
  dates: string[];
  /** Weekly nights the page writes ("every thursday", "saturdays"). */
  weekly: string[];
  families: FamilyKey[];
}

const MONTHS = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
] as const;

// "October 9, 2026", "Oct. 9", "Oct 9th", "SEPTEMBER 25TH", "October 8 , 2022", "November 8-11,
// 2018" (a range takes its first day and its year). Bounded: linear on any page.
const MONTH_DAY =
  /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]{0,6}\.? {1,3}(\d{1,2})(?:st|nd|rd|th)?\b(?: {0,2}[-–] {0,2}\d{1,2}(?:st|nd|rd|th)?\b)?(?: {0,3},? {0,3}(\d{4})\b)?/gi;
// Numeric slash dates: M/D, M/D/YYYY, M/D/YY. Not preceded/followed by digit or slash (except year part).
// Also not preceded by a colon (to avoid times like "12:10/30").
const NUMERIC_DATE = /(?<!\d|\/)(?<!\d:)(\d{1,2})\/(\d{1,2})(?:\/(\d{4}|\d{2}))?(?!\d|\/)/gi;
// "every Thursday", "Thursdays", "Fridays & Saturdays" (a plural weekday is a weekly night).
const WEEKLY =
  /\bevery (mon|tues|wednes|thurs|fri|satur|sun)day\b|\b(mon|tues|wednes|thurs|fri|satur|sun)days\b/gi;

const monthDayRegexCache = new Map<string, { regex: RegExp; map: Map<string, number> }>();

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The upcoming dates a page's text writes, from `today` to `today + GATE_HORIZON_DAYS`. */
export function upcomingDates(
  text: string,
  today: string,
  options?: { languages?: readonly string[]; countryCode?: string },
): string[] {
  const languages = options?.languages ?? ["en"];
  const countryCode = options?.countryCode ?? "US";
  const [y, m] = today.split("-").map(Number) as [number, number];
  const last = addCalendarDays(today, GATE_HORIZON_DAYS);
  const out = new Set<string>();

  // Helper to fold text for matching
  const fold = (s: string) =>
    s
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/\u0131/g, "i");

  // English month-day loop (unchanged)
  for (const hit of text.matchAll(MONTH_DAY)) {
    const month = MONTHS.indexOf(hit[1]!.toLowerCase().slice(0, 3) as (typeof MONTHS)[number]) + 1;
    const day = Number(hit[2]);
    if (day < 1 || day > 31) continue;
    // A date with no year is this year's, or next year's when its month has passed (a December
    // page listing January).
    const year = hit[3] ? Number(hit[3]) : month < m ? y + 1 : y;
    // "February 31" is no date.
    if (new Date(Date.UTC(year, month - 1, day)).getUTCDate() !== day) continue;
    const iso = toIsoDate(year, month, day);
    if (iso >= today && iso <= last) out.add(iso);
  }

  const foldedText = fold(text);

  // Non-English month names (day-first)
  for (const lang of languages) {
    const base = lang.toLowerCase().split(/[-_]/)[0];
    if (base === "en") continue;
    // Build regex once per language (cache)
    const cacheKey = `${lang}:${countryCode}`;
    if (!monthDayRegexCache.has(cacheKey)) {
      const namesByMonth = new Map<string, number>();
      const nameParts: string[] = [];
      for (let month = 1; month <= 12; month++) {
        for (const name of monthNames(month, lang)) {
          const folded = fold(name);
          namesByMonth.set(folded, month);
          nameParts.push(folded);
        }
      }
      // longest first
      nameParts.sort((a, b) => b.length - a.length);
      const pattern = `(?<![\\p{L}\\p{N}])(\\d{1,2})(?:\\s*[-–]\\s*\\d{1,2})?\\s*(?:de\\s+)?(${nameParts.map(escapeRegExp).join("|")})\\.?(?:\\s*(?:de\\s+)?(\\d{4}))?(?![\\p{L}])`;
      monthDayRegexCache.set(cacheKey, { regex: new RegExp(pattern, "gu"), map: namesByMonth });
    }
    const { regex, map } = monthDayRegexCache.get(cacheKey)!;
    for (const match of foldedText.matchAll(regex)) {
      const day = Number(match[1]);
      const monthName = match[2] ?? "";
      const yearStr = match[3];
      const month = map.get(monthName);
      if (!month || day < 1 || day > 31) continue;
      const year = yearStr ? Number(yearStr) : month < m ? y + 1 : y;
      if (new Date(Date.UTC(year, month - 1, day)).getUTCDate() !== day) continue;
      const iso = toIsoDate(year, month, day);
      if (iso >= today && iso <= last) out.add(iso);
    }
  }

  // Numeric dates
  if (countryCode === "US" || countryCode === "PR") {
    // M/D
    for (const hit of foldedText.matchAll(NUMERIC_DATE)) {
      const month = Number(hit[1]);
      const day = Number(hit[2]);
      if (month < 1 || month > 12 || day < 1 || day > 31) continue;
      const yearPart = hit[3];
      let year: number;
      if (yearPart) {
        const yp = Number(yearPart);
        year = yp < 100 ? 2000 + yp : yp;
      } else {
        year = month < m ? y + 1 : y;
      }
      if (new Date(Date.UTC(year, month - 1, day)).getUTCDate() !== day) continue;
      const iso = toIsoDate(year, month, day);
      if (iso >= today && iso <= last) out.add(iso);
    }
  } else {
    // D/M
    for (const hit of foldedText.matchAll(NUMERIC_DATE)) {
      const day = Number(hit[1]);
      const month = Number(hit[2]);
      if (month < 1 || month > 12 || day < 1 || day > 31) continue;
      const yearPart = hit[3];
      let year: number;
      if (yearPart) {
        const yp = Number(yearPart);
        year = yp < 100 ? 2000 + yp : yp;
      } else {
        year = month < m ? y + 1 : y;
      }
      if (new Date(Date.UTC(year, month - 1, day)).getUTCDate() !== day) continue;
      const iso = toIsoDate(year, month, day);
      if (iso >= today && iso <= last) out.add(iso);
    }
    // Dotted D.M.YYYY (only with 4-digit year)
    const DOTTED = /(?<![\d.])(\d{1,2})\.(\d{1,2})\.(\d{4})(?![\d.])/gi;
    for (const hit of foldedText.matchAll(DOTTED)) {
      const day = Number(hit[1]);
      const month = Number(hit[2]);
      const year = Number(hit[3]);
      if (month < 1 || month > 12 || day < 1 || day > 31) continue;
      if (new Date(Date.UTC(year, month - 1, day)).getUTCDate() !== day) continue;
      const iso = toIsoDate(year, month, day);
      if (iso >= today && iso <= last) out.add(iso);
    }
  }

  return [...out].sort();
}

/** Whether a page-only events page earns a model read (D-124). */
export function danceGate(input: {
  /** The page's visible text. */
  text: string;
  /** The response's content type, when it gave one. */
  contentType: string | null;
  /** The place's group (candidates.ts `priorityOf`). */
  group: string;
  now: Date;
  tz: string;
  /** Languages the metro speaks (default ["en"]). */
  languages?: readonly string[];
  /** Country code for date order (default "US"). */
  countryCode?: string;
}): GateVerdict {
  const today = localDateOf(input.now, input.tz);
  const languages = input.languages ?? ["en"];
  const countryCode = input.countryCode ?? "US";
  const dates = upcomingDates(input.text, today, { languages, countryCode }).slice(0, 10);
  const weeklySet = new Set<string>();
  // English weekly regex (unchanged)
  for (const match of input.text.matchAll(WEEKLY)) {
    weeklySet.add(match[0].toLowerCase().replace(/\s+/g, " "));
  }
  // Non-English weekly detection via recurrence parser
  const norm = normalizeRecurrenceText(input.text);
  const tokens = norm.split(" ");
  for (const lang of languages) {
    const base = lang.toLowerCase().split(/[-_]/)[0];
    if (base === "en") continue;
    const parseLang = PARSE_LANGS.find((l) => l === base);
    if (!parseLang) continue;
    const dayWords = new Set(recurrenceDayTokens(parseLang));
    const tried = new Set<string>();
    let hits = 0;
    for (let i = 0; i < tokens.length && hits < 200; i++) {
      if (!dayWords.has(tokens[i]!)) continue;
      hits++;
      windows: for (let s = Math.max(0, i - 3); s <= i; s++) {
        for (let e = i + 1; e <= Math.min(tokens.length, i + 3); e++) {
          const window = tokens.slice(s, e).join(" ");
          if (tried.has(window)) continue;
          tried.add(window);
          let rule: string | null = null;
          try {
            rule = parseRecurrenceText(window, parseLang);
          } catch {
            // ignore
          }
          if (
            rule?.startsWith("FREQ=WEEKLY") &&
            rule.includes("BYDAY=") &&
            !rule.includes("BYSETPOS") &&
            !rule.includes("INTERVAL")
          ) {
            weeklySet.add(window);
            break windows;
          }
        }
      }
    }
  }
  const weekly = [...weeklySet].slice(0, 7);
  const styleLangs = [...new Set(["en", "es", ...languages])];
  const { families } = matchStyles(input.text, styleLangs);
  const verdict = (pass: boolean, reason: string): GateVerdict => ({
    pass,
    reason,
    dates,
    weekly,
    families,
  });

  if (input.contentType && !/html/i.test(input.contentType))
    return verdict(false, `not a web page (${input.contentType.split(";")[0]!.trim()})`);
  if (input.group === "dance studio") {
    // A studio's page passes only when it lists socials.
    const nights =
      dates.length >= 2
        ? `${dates.length} dates to come`
        : weekly.length > 0
          ? `a weekly night (${weekly[0]})`
          : null;
    if (!nights)
      return verdict(
        false,
        dates.length === 1
          ? "one date to come, no weekly night"
          : "no dates to come and no weekly night",
      );
    const folded = fold(input.text);
    const socialMatch = folded.match(SOCIAL_WORD);
    if (socialMatch) {
      const word = socialMatch[0];
      return verdict(true, `${nights}, and the studio's page lists socials (${word})`);
    }
    return verdict(false, "a dance studio's class timetable (deferred)");
  }
  const nights =
    dates.length >= 2
      ? `${dates.length} dates to come`
      : weekly.length > 0
        ? `a weekly night (${weekly[0]})`
        : null;
  if (!nights)
    return verdict(
      false,
      dates.length === 1
        ? "one date to come, no weekly night"
        : "no dates to come and no weekly night",
    );
  if (NIGHTS_ALONE.has(input.group)) return verdict(true, `${nights} on a dance club's page`);
  // DJ nights count for every group except a studio (already handled above).
  const hasDjWord = DJ_WORD.test(input.text);
  if (hasDjWord) {
    return verdict(true, `${nights}, and the page lists DJ nights`);
  }
  // Generic dance words count for every group except a studio.
  const folded = fold(input.text);
  const danceWordMatch = folded.match(DANCE_WORD) || folded.match(CHINESE_DANCE);
  if (danceWordMatch) {
    const word = danceWordMatch[0];
    return verdict(true, `${nights}, and the page names dancing (${word})`);
  }
  if (families.length === 0) return verdict(false, `${nights}, but the page names no dance`);
  return verdict(true, `${nights}, and the page names ${families.join(", ")}`);
}
