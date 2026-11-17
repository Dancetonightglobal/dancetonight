// Facts a listing's own words state outright, read deterministically (no model): the listing
// type, a lesson or dancing time, and a price phrase. Pure; used by every structured harvester
// (ICS, JSON-LD, APIs) for the parts their structure leaves out. For a page the model read, it
// also checks the read against the page (D-070): whether the page writes a date at all, which
// weekdays a recurrence phrase names, and the category label a listing site prints over a title.
//
// The text is third-party and hostile: it is only ever matched against fixed patterns here,
// never executed, followed or stored beyond a 300-character evidence quote (D-009).
//
// When the words do not say, the answer is "not stated": `other` for the type, null for a
// time, no rows for a price. A structured start time with no word attached is a start time,
// which the harvesters record as doors (the moment the thing begins), never as a lesson or as
// the dancing.

import { familyOf, matchStyles } from "@/config/styles";
import type { ListingType } from "@/src/domain/listing-types";
import type { StyleKey } from "@/config/styles";

export const EVIDENCE_CHARS = 300;

interface TypeRule {
  type: ListingType;
  pattern: RegExp;
}

// Order matters: the first rule whose pattern appears wins, so the specific kinds come before
// the general ones ("salsa class and social" is a social with a lesson, so "social" is checked
// before "class"; "practica" before "milonga").
const TYPE_RULES: readonly TypeRule[] = [
  {
    type: "festival_session",
    pattern: /\b(festival|congress|congreso|weekender|marathon|encuentro)\b/i,
  },
  { type: "practica", pattern: /\b(practica|práctica|practice session|pratique)\b/i },
  { type: "jam", pattern: /\b(jam|cypher|contact jam|open floor|freestyle session)\b/i },
  {
    type: "social",
    pattern:
      /\b(social|socials|milonga|soir[ée]e|baile|bal|ball|dance party|dance night|night of dancing|tanzabend|sociale)\b/i,
  },
  {
    type: "live_music_with_dancing",
    pattern:
      /\b(live (band|music|orchestra)|with the band|en vivo|en directo|concert and dance)\b/i,
  },
  {
    type: "club_night",
    pattern:
      /\b(club night|dj night|dj set|party|fiesta|rave|disco night|late night|antro|antros)\b/i,
  },
  {
    type: "class",
    pattern:
      /\b(class|classes|lesson|lessons|workshop|course|beginners? series|bootcamp|cours|clase|clases|kurs|taller)\b/i,
  },
  {
    type: "outdoor_public",
    pattern: /\b(in the park|park dance|on the pier|plaza|square dance in|outdoor)\b/i,
  },
  // A course level as the title's lead (D-602): "Level 1 - Newcomer West Coast Swing", "Level 2: Novice WCS",
  // "Level 3 Intermediate Salsa". It needs a separator or a skill word after the number, because "Level 3" is
  // also a floor ("Level 3 Rooftop Party"); a bare "Level 2 Salsa" is not read as a class.
  {
    type: "class",
    pattern:
      /^\s*level\s*\d+\s*(?:[-–—:]|(?:newcomers?|beginners?|novice|intermediate|advanced|improvers?)\b)/i,
  },
];

/** True when the words name a class, lesson or workshop anywhere in them. */
export function mentionsClass(text: string): boolean {
  return TYPE_RULES.some((rule) => rule.type === "class" && rule.pattern.test(text));
}

/** The listing type the words state, with the phrase that said so; `other` when nothing does. */
export function listingTypeFromText(
  title: string,
  description: string | null = null,
  styles: readonly StyleKey[] = [],
): { type: ListingType; evidence: string | null } {
  // "Party" and "fiesta" name a club night only when no partner-dance style is named: a kizomba
  // party or a salsa fiesta is a social.
  const partnerStyle = styles.some((s) => familyOf(s) !== "club");
  for (const text of [title, description ?? ""]) {
    for (const rule of TYPE_RULES) {
      const match = rule.pattern.exec(text);
      if (!match) continue;
      const type = rule.type === "club_night" && partnerStyle ? "social" : rule.type;
      return { type, evidence: quoteAround(text, match.index, match[0].length) };
    }
  }
  // A few styles are listing types by name.
  if (styles.includes("milonga")) return { type: "social", evidence: null };
  if (styles.includes("practica")) return { type: "practica", evidence: null };
  if (styles.includes("cypher") || styles.includes("freestyle_jam"))
    return { type: "jam", evidence: null };
  return { type: "other", evidence: null };
}

const TIME = String.raw`(\d{1,2})(?:[:.h](\d{2}))?\s*(a\.?m\.?|p\.?m\.?|h)?`;

/**
 * "7pm", "19:30", "7.30 pm", "21h", "9" (read as evening when no marker and below 12, the only
 * reading that makes sense for a dance). Returns "HH:MM" or null.
 */
export function readClock(hours: string, minutes?: string, marker?: string): string | null {
  let h = Number(hours);
  const m = minutes ? Number(minutes) : 0;
  if (!Number.isInteger(h) || h > 24 || m > 59) return null;
  const mark = marker?.toLowerCase().replace(/\./g, "") ?? "";
  if (mark === "pm" && h < 12) h += 12;
  else if (mark === "am" && h === 12) h = 0;
  else if (mark === "" && h >= 1 && h <= 11) h += 12;
  if (h === 24) h = 0;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

const LESSON_WORDS = String.raw`(?:lesson|class|workshop|beginners?(?: lesson| class)?|cours|clase|kurs)`;
const DANCING_WORDS = String.raw`(?:social(?: dancing)?|dancing|party|milonga|dance|bal|baile)`;
const JOIN = String.raw`\s*(?:at|from|starts?|begins?|@|:|-|–|à|a las|ab)?\s*`;

/** Times the words attach to a lesson or to the dancing: "lesson at 7pm, social from 8:30". */
export function timesFromText(text: string): {
  lesson: string | null;
  dancing: string | null;
  evidence: Record<string, string>;
} {
  const evidence: Record<string, string> = {};
  const find = (words: string) => {
    const re = new RegExp(String.raw`\b${words}${JOIN}${TIME}\b`, "gi");
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) {
      if (!match[1]) continue;
      // A bare 0 with no minutes or marker is a count ("beginner from 0"), not midnight (D-839).
      if (Number(match[1]) === 0 && !match[2] && !match[3]) continue;
      // Skip if the text right after the match is a duration (e.g., "2H", "90 mins")
      const after = text.slice(match.index + match[0].length);
      const duration = /^\s*(?:\d{1,2}\s*(?:m|mins?|minutes?)\b|(?:hrs?|hours?|mins?|minutes?)\b)/i;
      if (duration.test(after)) {
        // This match is a duration, not a time; keep searching.
        continue;
      }
      const time = readClock(match[1], match[2], match[3]);
      return { time, quote: time ? quoteAround(text, match.index, match[0].length) : null };
    }
    return { time: null, quote: null };
  };
  const lesson = find(LESSON_WORDS);
  const dancing = find(DANCING_WORDS);
  if (lesson.quote) evidence.lesson_time = lesson.quote;
  if (dancing.quote) evidence.dancing_time = dancing.quote;
  return { lesson: lesson.time, dancing: dancing.time, evidence };
}

const PRICE_PHRASE =
  /(?:\bfree\s+(?:entry|admission|entrance|event|of\s+charge|to\s+(?:attend|enter|join)|for\s+(?:all|everyone)|and\s+open\s+to)\b|\b(?:entry|admission|entrance|cover|ticket|tickets|price|cost|event|social|it|this)\s*(?:is|are|:|–|-)\s*free\b|(?:^|\n)[ \t]*free(?=[ \t]*(?:[!~(]|\n|$))|no cover|(?:suggested )?donation|pay what you (?:can|wish)|sliding scale|[$€£]\s?\d[\d.,]*|\b\d[\d.,]*\s?(?:€|(?:eur|usd|dollars?)\b))[^.!?\n]{0,60}/i;

/** The first sentence fragment that states a price, for `parsePriceText`. */
export function pricePhrase(text: string): { phrase: string; evidence: string } | null {
  const match = PRICE_PHRASE.exec(text);
  if (!match) return null;
  return { phrase: match[0].trim(), evidence: quoteAround(text, match.index, match[0].length) };
}

/** Styles named in a title first, then in the description. */
export function stylesFromText(title: string, description: string | null): StyleKey[] {
  const fromTitle = matchStyles(title).styles;
  if (fromTitle.length > 0 || !description) return fromTitle;
  return matchStyles(description).styles;
}

/** A short quote centred on a match, cut to the evidence cap and trimmed to whole words. */
export function quoteAround(
  text: string,
  index: number,
  length: number,
  max = EVIDENCE_CHARS,
): string {
  const flat = text.replace(/\s+/g, " ");
  if (flat.length <= max) return flat.trim();
  // Indices shift slightly when whitespace collapses; centre on the match in the flat text.
  const needle = text.slice(index, index + length).replace(/\s+/g, " ");
  const at = Math.max(0, flat.indexOf(needle));
  const pad = Math.max(0, Math.floor((max - needle.length) / 2));
  let start = Math.max(0, at - pad);
  const end = Math.min(flat.length, start + max);
  start = Math.max(0, end - max);
  let quote = flat.slice(start, end);
  if (start > 0) quote = quote.replace(/^\S*\s/, "");
  if (end < flat.length) quote = quote.replace(/\s\S*$/, "");
  return quote.trim().slice(0, max);
}

/**
 * Where a structured start time goes (see the header): the lesson for a class, else doors,
 * unless the words already put that same time on the lesson or the dancing. The words' own
 * times always stand.
 *
 * When a structured start is given, two rules apply to the times the words said (D-191,
 * Ecstatic Dance London's feed, 2026-10-28):
 * 1. A said dancing time earlier than the start (on the night clock) is dropped; an earlier lesson
 *    only when the text gives a clock range opening at the start.
 * 2. After such a range, and unless the type is "class", a later said dancing time is dropped:
 *    the range is the event itself ("7:00PM-9:45PM ... Fruit Social: 9:45PM").
 */
export function placeStartTime(
  type: ListingType,
  start: string | null,
  said: { lesson: string | null; dancing: string | null },
  text?: string,
): { doors: string | null; lesson: string | null; dancing: string | null } {
  let doors: string | null = null;
  let lesson = said.lesson;
  let dancing = said.dancing;

  // Minutes on the night clock: a time before 06:00 belongs to the small hours after midnight.
  const nightMinutes = (hhmm: string | null): number | null => {
    if (!hhmm) return null;
    const [h = 0, m = 0] = hhmm.split(":").map(Number);
    const total = h * 60 + m;
    return total < 6 * 60 ? total + 24 * 60 : total;
  };

  const startMins = nightMinutes(start);
  if (startMins !== null) {
    // Does the text give a clock range opening at the start? Then that range is the event itself.
    let opensAtStart = false;
    if (text) {
      const rangeRe = new RegExp(String.raw`${TIME}\s*(?:-|–|—|to)\s*${TIME}`, "gi");
      for (const match of text.matchAll(rangeRe)) {
        if (match[1] && readClock(match[1], match[2], match[3]) === start) {
          opensAtStart = true;
          break;
        }
      }
    }
    const before = (t: string | null) => t !== null && nightMinutes(t)! < startMins;
    const after = (t: string | null) => t !== null && nightMinutes(t)! > startMins;
    // Rule 1: dancing never starts before the event does. A lesson before the start is kept
    // (New York Tango's start is the milonga after its class) unless the event is a range opening
    // at the start, when an earlier lesson is an optional extra ("workshop 5:50pm-7pm").
    if (before(dancing)) dancing = null;
    if (opensAtStart && before(lesson)) lesson = null;
    // Rule 2: a later "social" after a range opening at the start is another part of the night.
    if (opensAtStart && type !== "class" && after(dancing)) dancing = null;
  }
  if (start) {
    if (type === "class" && !lesson) lesson = start;
    else if (start !== lesson && start !== dancing) doors = start;
  }
  return { doors, lesson, dancing };
}

// ---------------------------------------------------------------------------------------------
// Checking a model read against its page (D-070)

/** Lowercase, Latin accents stripped, whitespace collapsed; punctuation kept (dates need it). */
function flatten(text: string): string {
  return text.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ");
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const localesByLang = new Map<string, string[]>();

/** English plus the page's language, as Intl locales; an unknown tag falls back to English. */
function localesFor(lang: string | null | undefined): string[] {
  const key = lang ?? "";
  const cached = localesByLang.get(key);
  if (cached) return cached;
  const out = ["en"];
  const base = lang?.toLowerCase().split(/[-_]/)[0];
  if (base && base !== "en") {
    try {
      if (Intl.DateTimeFormat.supportedLocalesOf([base]).length > 0) out.push(base);
    } catch {
      // Not a language tag: English only.
    }
  }
  localesByLang.set(key, out);
  return out;
}

/** Month names by month and locales: building Intl formatters is the slow part of a date check. */
const monthNamesByKey = new Map<string, string[]>();

/** Month names, long and short, in English and the page's language, flattened. */
export function monthNames(month: number, lang: string | null | undefined): string[] {
  const locales = localesFor(lang);
  const key = `${month}|${locales.join(",")}`;
  const cached = monthNamesByKey.get(key);
  if (cached) return cached;
  const at = new Date(Date.UTC(2000, month - 1, 15));
  const names = new Set<string>();
  for (const locale of locales) {
    for (const width of ["long", "short"] as const) {
      const name = new Intl.DateTimeFormat(locale, { month: width, timeZone: "UTC" }).format(at);
      const flat = flatten(name).replace(/\.$/, "").trim();
      if (flat && !/\d/.test(flat)) names.add(flat);
    }
  }
  if (month === 9) names.add("sept");
  const out = [...names];
  monthNamesByKey.set(key, out);
  return out;
}

/**
 * True when the text writes this calendar date (ISO `YYYY-MM-DD`) in a form a reader would take
 * for it: "October 1", "Oct 1st", "Thursday, October 1, 2026", "1 October", "1st of October",
 * "1er octobre", "1. Oktober", "10/1", "1/10/2026", "1.10.", "11.14.26", "2026-10-01". Month names are read in
 * English and in the page's language. A page that says only "Every Thursday" states no date, so a
 * date a model gave beside it was the model's, not the page's.
 *
 * A stated year must be the date's (D-074): "October 1, 2020" and "Posted 10/1/2019" do not write
 * 2026-10-01. A date written with no year is taken for any year, as a reader takes it. A price is
 * not a date: "$10/15" does not write October 15 (D-080).
 */
export function statesDate(text: string, isoDate: string, lang?: string | null): boolean {
  return writesDate(text, isoDate, lang, true);
}

/** A currency sign before a number: "$10/15" is a price. */
const NOT_AFTER_NUMERIC = String.raw`(?<![\d/.$€£¥])`;

/**
 * `statesDate`. With `anyNumeric` false, a numeric date ("10/2", "1.10.") counts only when it is
 * unambiguous (D-080): it carries the date's year ("10/2/2026"), or it follows the date's weekday
 * ("Fri 10/2"). "1/2 price", "24/7" and "3/4 time" are not dates a listing's block gives it.
 */
function writesDate(
  text: string,
  isoDate: string,
  lang: string | null | undefined,
  anyNumeric: boolean,
): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match || !/\d/.test(text)) return false;
  const y = match[1]!;
  const flat = flatten(text);
  if (flat.includes(isoDate)) return true;
  const { named, numeric, hyphenated } = datePatternsFor(isoDate, lang);
  const ofThisYear = (year: string) => (year.length === 2 ? year === y.slice(2) : year === y);
  for (const p of named) {
    for (const found of flat.matchAll(p)) {
      // The year written inside the date, else one written just after it ("October 1, 2020").
      const year =
        found[1] ?? YEAR_AFTER.exec(flat.slice(found.index + found[0].length))?.[1] ?? null;
      if (year === null || ofThisYear(year)) return true;
    }
  }
  const weekdayBefore = anyNumeric ? null : weekdayEnding(weekdayCodeOf(isoDate), lang);
  for (const p of numeric) {
    for (const found of flat.matchAll(p)) {
      const year =
        found[1] ?? YEAR_AFTER.exec(flat.slice(found.index + found[0].length))?.[1] ?? null;
      if (year !== null && !ofThisYear(year)) continue;
      if (anyNumeric || year !== null || weekdayBefore!.test(flat.slice(0, found.index))) {
        return true;
      }
    }
  }
  // "Wed 04-11-2026" (day first) or "Wed 11-04-2026" (month first): read only with the date's year
  // and its weekday just before, so the weekday tells the two orders apart (D-666).
  const weekday = weekdayEnding(weekdayCodeOf(isoDate), lang);
  for (const p of hyphenated) {
    for (const found of flat.matchAll(p)) {
      if (found[1] === y && weekday.test(flat.slice(0, found.index))) return true;
    }
  }
  return false;
}

const writesDatePatterns = new Map<
  string,
  { named: RegExp[]; numeric: RegExp[]; hyphenated: RegExp[] }
>();

/** `writesDate`'s patterns for one date in English and the page's language, compiled once. */
function datePatternsFor(
  isoDate: string,
  lang: string | null | undefined,
): { named: RegExp[]; numeric: RegExp[]; hyphenated: RegExp[] } {
  const key = `${isoDate}|${localesFor(lang).join(",")}`;
  const cached = writesDatePatterns.get(key);
  if (cached) return cached;
  const [y, mm, dd] = isoDate.split("-") as [string, string, string];
  const m = Number(mm);
  const d = Number(dd);
  const months = monthNames(m, lang).map(escapeRe).join("|");
  const day = `0?${d}`;
  // A numeric pattern's group 1, when it matched, is the year written inside the date.
  const named = [
    // "October 1", "Oct. 1st", "octobre 1"
    String.raw`(?<![\p{L}])(?:${months})\.?,?\s+(?:the\s+)?${day}(?:st|nd|rd|th)?(?![\d]|[:.]\d)`,
    // "1 October", "1st of October", "1 de octubre", "1er octobre", "1. Oktober"
    String.raw`(?<![\d/.:-])${day}(?:st|nd|rd|th|er|e|o|a|º)?\.?\s*(?:de\s+|of\s+)?(?:${months})(?![\p{L}])`,
    // "2026/10/01"
    String.raw`${y}/${mm}/${dd}`,
  ];
  const numeric = [
    // "10/1", "10/01/2026" (month first) and "1/10", "01/10/2026" (day first)
    String.raw`${NOT_AFTER_NUMERIC}0?${m}/${day}(?:/(\d{4}|\d{2}))?(?![\d/])`,
    String.raw`${NOT_AFTER_NUMERIC}${day}/0?${m}(?:/(\d{4}|\d{2}))?(?![\d/])`,
    // "1.10.", "01.10.2026"
    String.raw`${NOT_AFTER_NUMERIC}${day}\.0?${m}\.(\d{4}|\d{2})?(?!\d)`,
    // "11.14.26", "11.14.2026" (month first, as US pages write it): only with a year, so
    // "5.30" and "11.14" stay times and numbers.
    String.raw`${NOT_AFTER_NUMERIC}0?${m}\.${day}\.(\d{4}|\d{2})(?![\d.])`,
  ];
  // "04-11-2026", "4-11-2026" (day first) and "11-04-2026" (month first), always with a 4-digit year.
  const hyphenated = [
    String.raw`(?<![\d/.:-])${day}-0?${m}-(\d{4})(?![\d-])`,
    String.raw`(?<![\d/.:-])0?${m}-${day}-(\d{4})(?![\d-])`,
  ];
  const compiled = {
    named: named.map((p) => new RegExp(p, "gu")),
    numeric: numeric.map((p) => new RegExp(p, "gu")),
    hyphenated: hyphenated.map((p) => new RegExp(p, "gu")),
  };
  writesDatePatterns.set(key, compiled);
  return compiled;
}

const weekdayEndings = new Map<string, RegExp>();

/** Text, folded as `flatten`, that ends in this weekday's name or abbreviation ("Fri "). */
function weekdayEnding(code: string, lang: string | null | undefined): RegExp {
  const key = `${code}|${localesFor(lang).join(",")}`;
  const cached = weekdayEndings.get(key);
  if (cached) return cached;
  const days = dayLexicon(lang);
  const names = [
    ...[...days.exact].filter(([, c]) => c === code).map(([w]) => w),
    ...days.prefixes.filter(([, c]) => c === code).map(([w]) => w),
  ];
  const re = new RegExp(
    String.raw`(?<![\p{L}])(?:${[...new Set(names)].map(escapeRe).join("|")})\.?,?\s*$`,
    "u",
  );
  weekdayEndings.set(key, re);
  return re;
}

/** A year just after a date: ", 2026", " 2026"; not a clock time ("1930h", "19:30"). */
const YEAR_AFTER = /^,?\s*((?:19|20)\d{2})(?![\d:h])/;

const WEEKDAY_CODES = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const;

/** The weekday of a calendar date, as an RRULE BYDAY code. */
export function weekdayCodeOf(isoDate: string): (typeof WEEKDAY_CODES)[number] {
  return WEEKDAY_CODES[new Date(`${isoDate}T12:00:00Z`).getUTCDay()]!;
}

/**
 * The weekdays a phrase names ("Every 1st, 3rd, and 5th Sunday" names Sunday), as BYDAY codes,
 * in English and the page's language; empty when it names none. Full names and their plurals only:
 * "sun" and "sat" are English words too.
 */
export function weekdaysNamed(text: string, lang?: string | null): Set<string> {
  const flat = flatten(text);
  const found = new Set<string>();
  for (let i = 0; i < 7; i++) {
    // 2000-01-02 was a Sunday.
    const at = new Date(Date.UTC(2000, 0, 2 + i));
    for (const locale of localesFor(lang)) {
      const name = flatten(
        new Intl.DateTimeFormat(locale, { weekday: "long", timeZone: "UTC" }).format(at),
      );
      if (new RegExp(String.raw`(?<![\p{L}])${escapeRe(name)}s?(?![\p{L}])`, "u").test(flat)) {
        found.add(WEEKDAY_CODES[i]!);
      }
    }
  }
  return found;
}

/**
 * The kind of night a listing site's category label names, for labels that are a single word or
 * two and nothing else. The Ronda prints "milonga" on the line above every milonga's title.
 */
const CATEGORY_TYPES: Readonly<Record<string, ListingType>> = {
  milonga: "social",
  milongas: "social",
  social: "social",
  socials: "social",
  "social dance": "social",
  "social dancing": "social",
  practica: "practica",
  practicas: "practica",
  class: "class",
  classes: "class",
  lesson: "class",
  lessons: "class",
  workshop: "class",
  workshops: "class",
  festival: "festival_session",
  marathon: "festival_session",
  encuentro: "festival_session",
  jam: "jam",
};

/**
 * The category label printed on the line just above a title on a page, when that line is only a
 * category word ("milonga", "practica", "class"): the kind of night the page itself gives the
 * listing. Null when the title is not on the page at the start of a line, or the line above it is
 * anything else (a heading, a sentence, a date).
 */
export function categoryAbove(
  pageText: string,
  title: string,
): { type: ListingType; label: string } | null {
  const want = normalizeWords(title);
  if (!want) return null;
  const lines = pageText.split("\n");
  let previous: string | null = null;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (normalizeWords(trimmed).startsWith(want)) {
      if (previous === null) return null;
      const type = CATEGORY_TYPES[normalizeWords(previous)];
      return type ? { type, label: previous.slice(0, 40) } : null;
    }
    previous = trimmed;
  }
  return null;
}

/** Letters and digits only, lowercase, single spaces: how a title is found on its page. */
function normalizeWords(text: string): string {
  return flatten(text)
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

// ---------------------------------------------------------------------------------------------
// Grounding a model read in its page (D-073)

/**
 * A phrase as it is compared with a page: compatibility-decomposed (NFKD), combining marks
 * dropped, lowercase, and every run of anything that is not a letter or a digit, in any script,
 * as one space. "Esa! Milonga" and "ESA MILONGA" fold alike; so do "English - Tuesdays" and
 * "English – Tuesdays", and "Café" and "Cafe".
 */
export function foldForMatch(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** A page folded once, for many phrases to be looked up in it. */
export interface FoldedPage {
  /** The folded words between single spaces, so a phrase is found on whole words. */
  spaced: string;
  /** The folded words run together. */
  compact: string;
  /** For each index of `compact`, 1 where a word of the page starts. */
  starts: Uint8Array;
  /** For each index of `compact` (and its length), 1 where a word of the page has just ended. */
  ends: Uint8Array;
  /** The folded words, in order. */
  words: readonly string[];
  /** For each word, the index in `compact` where it starts. */
  wordStarts: Uint32Array;
  /** For each word, which of `lines` it is on. */
  lineOf: Uint32Array;
  /** The page's lines that hold a word, as [first word, word after the last]. */
  lines: ReadonlyArray<readonly [number, number]>;
  /**
   * The text of each of `lines` as the page shows it, with every link target and printed URL
   * replaced by LINK_MARK (D-080): where a card's own link closes it on a one-line list.
   */
  texts: readonly string[];
}

/**
 * Labels that name a link as the item's own, in English (v1): "Learn more", "Tickets »". The
 * link matcher (D-073) reads a listing's link by them; a listing's block ends at one (D-080).
 */
export const GENERIC_LINK_LABEL =
  /(?:read more|learn more|more info(?:rmation)?|more details|event details|details|info|get tickets|buy tickets|tickets?|register(?: now| here)?|rsvp|book(?: now)?|event page|view event|see event|sign up)\s*[→>»›:.!)]*\s*$/i;

/** Where a link target or a printed URL stood in a line of `FoldedPage.texts`. */
export const LINK_MARK = "\u0001";

/**
 * Scripts written without spaces between words (Chinese, Japanese, Thai, Lao, Khmer, Myanmar):
 * each of their characters is taken for a word of its own, so a title inside a run of them
 * ("每周六晚上萨尔萨舞会") is found on its own characters, as a Latin title is on its words.
 */
const UNSPACED =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/gu;

/** Titles folded before: a read checks every title against every other one's place on the page. */
const foldedWords = new Map<string, string>();

/** `foldForMatch`, with each character of a script written without spaces as its own word. */
export function foldWords(text: string): string {
  const known = foldedWords.get(text);
  if (known !== undefined) return known;
  const folded = foldForMatch(text).replace(UNSPACED, " $& ").replace(/ {2,}/g, " ").trim();
  // Short texts only (titles and phrases), and never many: a page's lines are folded once each.
  if (text.length <= 200) {
    if (foldedWords.size >= 5_000) foldedWords.clear();
    foldedWords.set(text, folded);
  }
  return folded;
}

/** An http(s) URL printed as text, as `pageLinks` reads one (event-links.ts). */
const BARE_URL = /https?:\/\/[^\s[\]<>"'()]+/g;

/**
 * Folds a page for `findPhrase`. The targets of its links (`label [https://…]`, as cleanPageText
 * writes them) are left out, and so is every URL printed as text (cleanPageText writes a link
 * whose label is its own address bare, and pages print "Tickets: https://…"): a title is words
 * the page shows, and an invented title must not be found in some link's slug.
 */
export function foldPage(pageText: string): FoldedPage {
  const words: string[] = [];
  const lines: Array<readonly [number, number]> = [];
  const lineOfWord: number[] = [];
  const texts: string[] = [];
  const shown = pageText
    .replace(/\[https?:\/\/[^\]\s]*\]/g, ` ${LINK_MARK} `)
    .replace(BARE_URL, ` ${LINK_MARK} `);
  for (const line of shown.split("\n")) {
    const first = words.length;
    for (const word of foldWords(line).split(" ")) {
      if (!word) continue;
      words.push(word);
      lineOfWord.push(lines.length);
    }
    if (words.length > first) {
      lines.push([first, words.length]);
      texts.push(line);
    }
  }
  const lineOf = Uint32Array.from(lineOfWord);
  const compact = words.join("");
  const starts = new Uint8Array(compact.length + 1);
  const ends = new Uint8Array(compact.length + 1);
  const wordStarts = new Uint32Array(words.length);
  let at = 0;
  words.forEach((word, i) => {
    wordStarts[i] = at;
    starts[at] = 1;
    at += word.length;
    ends[at] = 1;
  });
  return {
    spaced: ` ${words.join(" ")} `,
    compact,
    starts,
    ends,
    words,
    wordStarts,
    lineOf,
    lines,
    texts,
  };
}

/**
 * Whether and how a page writes a phrase, both folded (`foldWords`): "exact" when it writes
 * the same words; "spacing" when it writes the same letters and digits, from the start of one of
 * its words to the end of one, with the breaks between words elsewhere ("N oche De Descarga" for
 * "Noche De Descarga", "Victoria's" for "Victorias"); null when it does not write it. Nothing
 * looser: a word left out, added, changed or moved is not the page's phrase.
 */
export function findPhrase(page: FoldedPage, phrase: string): "exact" | "spacing" | null {
  const folded = foldWords(phrase);
  if (!folded) return null;
  if (page.spaced.includes(` ${folded} `)) return "exact";
  const needle = folded.replace(/ /g, "");
  for (let k = page.compact.indexOf(needle); k >= 0; k = page.compact.indexOf(needle, k + 1)) {
    if (page.starts[k] && page.ends[k + needle.length]) return "spacing";
  }
  return null;
}

/**
 * Where a page writes a phrase, as `findPhrase` finds it (exactly or respaced), in the page's
 * words: each place as the index of its first word and the index after its last. "Noche Latina"
 * on "N oche Latina" is found from "n" to after "latina", so what the page writes beside a title
 * it spaces differently can still be read.
 */
const spansByPage = new WeakMap<FoldedPage, Map<string, Array<[number, number]>>>();

export function phraseSpans(page: FoldedPage, phrase: string): Array<[number, number]> {
  const needle = foldWords(phrase).replace(/ /g, "");
  let memo = spansByPage.get(page);
  if (!memo) spansByPage.set(page, (memo = new Map()));
  const known = memo.get(needle);
  if (known) return known;
  const found = spansOf(page, needle);
  memo.set(needle, found);
  return found;
}

function spansOf(page: FoldedPage, needle: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  if (!needle) return spans;
  // The last word that starts at or before an index of `compact`.
  const wordAt = (offset: number) => {
    let lo = 0;
    let hi = page.wordStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (page.wordStarts[mid]! <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
  for (let k = page.compact.indexOf(needle); k >= 0; k = page.compact.indexOf(needle, k + 1)) {
    if (page.starts[k] && page.ends[k + needle.length]) {
      spans.push([wordAt(k), wordAt(k + needle.length - 1) + 1]);
    }
  }
  return spans;
}

/** How near a listing's title (in words, either side) the page must write its recurrence reworded. */
export const RECURRENCE_NEAR_WORDS = 40;

/**
 * Words a recurrence is read without, in the model's phrase and on the page alike. "&", "+" and
 * "/" are not words once folded, so "and" goes too: "1st & 3rd", "1st and 3rd" and "1st, 3rd"
 * read the same.
 */
const RECURRENCE_FILLER = new Set(["every", "each", "on", "the", "weekly", "and", "of"]);
/** The "-feira" of a Portuguese weekday ("Quinta-feira", "às sextas-feiras"), read as nothing (D-294). */
const WEEKDAY_SUFFIX_FILLER = new Set(["feira", "feiras"]);

/** Ordinals as a recurrence names them, spelled out or in figures. */
const ORDINALS: Readonly<Record<string, string>> = {
  first: "1st",
  second: "2nd",
  third: "3rd",
  fourth: "4th",
  fifth: "5th",
  last: "last",
  "1st": "1st",
  "2nd": "2nd",
  "3rd": "3rd",
  "4th": "4th",
  "5th": "5th",
};
const ORDINAL_TOKENS = new Set(Object.values(ORDINALS));

/** English weekday abbreviations a page prints ("Mon & Wed", "Thurs"). */
const WEEKDAY_ABBREVIATIONS: Readonly<Record<string, string>> = {
  sun: "SU",
  mon: "MO",
  tue: "TU",
  tues: "TU",
  wed: "WE",
  weds: "WE",
  thu: "TH",
  thur: "TH",
  thurs: "TH",
  fri: "FR",
  sat: "SA",
};

interface DayLexicon {
  /** A folded word that is a weekday: its name, its plural or an abbreviation. */
  exact: Map<string, string>;
  /** Weekday names a page word may start with ("SaturdayTime", run together by the page). */
  prefixes: Array<[string, string]>;
}

const dayLexicons = new Map<string, DayLexicon>();

/** The weekday words of English and the page's language, folded, by BYDAY code. */
function dayLexicon(lang: string | null | undefined): DayLexicon {
  const key = localesFor(lang).join(",");
  const cached = dayLexicons.get(key);
  if (cached) return cached;
  const exact = new Map(Object.entries(WEEKDAY_ABBREVIATIONS));
  const prefixes: Array<[string, string]> = [];
  for (let i = 0; i < 7; i++) {
    // 2000-01-02 was a Sunday.
    const at = new Date(Date.UTC(2000, 0, 2 + i));
    for (const locale of localesFor(lang)) {
      const name = foldForMatch(
        new Intl.DateTimeFormat(locale, { weekday: "long", timeZone: "UTC" }).format(at),
      );
      if (!name) continue;
      if (name.includes(" ")) {
        // Portuguese "quinta-feira" (folded "quinta feira"): its first word names the day, as
        // "Quinta-feira" folds on the page (D-294). An exact word only, not a prefix ("quintal").
        const [head, tail, ...rest] = name.split(" ");
        if (head && tail === "feira" && rest.length === 0) {
          exact.set(head, WEEKDAY_CODES[i]!);
          exact.set(`${head}s`, WEEKDAY_CODES[i]!);
        }
        continue;
      }
      exact.set(name, WEEKDAY_CODES[i]!);
      exact.set(`${name}s`, WEEKDAY_CODES[i]!);
      prefixes.push([name, WEEKDAY_CODES[i]!]);
    }
  }
  const lexicon = { exact, prefixes };
  dayLexicons.set(key, lexicon);
  return lexicon;
}

/**
 * A folded word as a recurrence is compared: a weekday as "@" and its BYDAY code ("tuesdays",
 * "tues" and "tuesday" alike, and a word the page runs on from a weekday's name, "saturdaytime"),
 * an ordinal in figures ("first" as "1st"), filler as nothing, any other word as itself.
 */
function recurrenceToken(word: string, days: DayLexicon): string | null {
  if (RECURRENCE_FILLER.has(word)) return null;
  if (WEEKDAY_SUFFIX_FILLER.has(word)) return null;
  const ordinal = ORDINALS[word];
  if (ordinal) return ordinal;
  const day = days.exact.get(word) ?? days.prefixes.find(([name]) => word.startsWith(name))?.[1];
  return day ? `@${day}` : word;
}

const recurrenceTokens = (words: readonly string[], days: DayLexicon) =>
  words.map((w) => recurrenceToken(w, days)).filter((t): t is string => t !== null && t !== "");

/**
 * Whether the page writes a recurrence phrase, reworded, beside a listing's title (D-073): the
 * title found as `findPhrase` finds it, and beside it (`tokensNearTitle`: the rest of its line, the
 * words after it up to the next listing's title, a weekday heading over it) every weekday and
 * every ordinal the phrase names, both sides read alike (`recurrenceToken`). "Every 2nd & last Saturday" stands
 * for "Every 2nd & last SaturdayTime: 9pm", "every Monday and Wednesday" for "Mon & Wed", "first
 * Friday of the month" for "First Fridays Contra", "Every Tuesday, 8pm" for "Tuesdays 8-11pm". A
 * phrase naming neither ("nightly") must stand there word for word, filler aside. A weekday the
 * page does not name near the title is the model's, not the page's: "every Thursday", the
 * extraction prompt's own example, on a page that names only Fridays.
 */
export function recurrenceNearTitle(
  page: FoldedPage,
  title: string,
  phrase: string,
  lang?: string | null,
  others: readonly string[] = [],
): boolean {
  const days = dayLexicon(lang);
  const months = monthsByName(lang);
  const want = recurrenceTokens(foldWords(phrase).split(" "), days);
  if (want.length === 0) return false;
  const named = [...new Set(want.filter((t) => t.startsWith("@") || ORDINAL_TOKENS.has(t)))];
  for (const span of phraseSpans(page, title)) {
    const around = tokensNearTitle(
      page,
      span,
      otherSpans(page, title, span, others),
      days,
      months,
      false,
      lang,
    );
    if (named.length > 0) {
      if (named.every((t) => around.includes(t))) return true;
      continue;
    }
    // Word for word.
    for (let i = 0; i + want.length <= around.length; i++) {
      if (want.every((w, k) => around[i + k] === w)) return true;
    }
  }
  return false;
}

/**
 * The weekdays (BYDAY codes) a page names beside a title, wherever it writes the title, read as
 * `recurrenceNearTitle` reads them.
 */
export function weekdaysNearTitle(
  page: FoldedPage,
  title: string,
  lang?: string | null,
  others: readonly string[] = [],
  options: { besideOnly?: boolean } = {},
): Set<string> {
  const days = dayLexicon(lang);
  const months = monthsByName(lang);
  const found = new Set<string>();
  for (const span of phraseSpans(page, title)) {
    for (const t of tokensNearTitle(
      page,
      span,
      otherSpans(page, title, span, others),
      days,
      months,
      options.besideOnly === true,
      lang,
    )) {
      if (t.startsWith("@")) found.add(t.slice(1));
    }
  }
  return found;
}

/** How many lines above a title a weekday heading may stand and still govern it. */
const HEADING_LINES_UP = 40;

/** A day number or year beside a month name in a dated heading ("September 30", "2026"). */
const HEADING_NUMBER = /^\d{1,4}(?:st|nd|rd|th)?$/;

/** Words that make a line a listing's own detail, not a heading over several listings. */
const DETAIL_WORDS = new Set(["every", "each"]);
/** Filler a weekly grid's day heading may add: "EVERY FRIDAY", "Todos los viernes", "Cada martes", "Todas as quartas". */
const WEEKLY_HEADING_FILLER = new Set([
  "every",
  "each",
  "todos",
  "todas",
  "toda",
  "cada",
  "tous",
  "toutes",
  "chaque",
  "los",
  "las",
  "os",
  "as",
]);

/**
 * A line that is only a heading naming a weekday, as recurrence tokens (its weekdays and
 * ordinals), or null for any other line: a weekday heading over a week's classes ("MONDAYS",
 * "1st & 3rd Fridays of the month"), or a dated heading over a night's listings ("Wednesday,
 * September 30", "Sat Oct 3 2026"), whose weekday is the weekday of every night listed under it.
 * A line that says "every" or gives a time is a listing's own detail ("Every Thursday, 9pm"), not a
 * heading, and only stands beside its own listing.
 */
function weekdayHeading(
  page: FoldedPage,
  line: number,
  days: DayLexicon,
  months: ReadonlyMap<string, number>,
  weekly = false,
): string[] | null {
  // A line the page does not have (a line of only "🔥" or "—" folds to no lines) is no heading (D-824).
  const bounds = page.lines[line];
  if (bounds === undefined) return null;
  const [first, after] = bounds;
  const words = page.words.slice(first, after);
  if (!weekly && words.some((w) => DETAIL_WORDS.has(w))) return null;
  const tokens = recurrenceTokens(words, days);
  if (!tokens.some((t) => t.startsWith("@"))) return null;
  const dated = tokens.some((t) => months.has(t));
  const allowed = (t: string) =>
    t.startsWith("@") ||
    ORDINAL_TOKENS.has(t) ||
    months.has(t) ||
    t === "month" ||
    t === "months" ||
    (dated && HEADING_NUMBER.test(t)) ||
    (weekly && !dated && WEEKLY_HEADING_FILLER.has(t)) ||
    HEADING_ARTICLES.has(t);
  if (!tokens.every(allowed)) return null;
  return tokens.filter((t) => t.startsWith("@") || ORDINAL_TOKENS.has(t));
}

/**
 * The weekday codes ("MO".."SU") a line that is only a weekly weekday heading names ("Domingos",
 * "MIÉRCOLES", "Martes y Jueves"), or null: a dated heading, an ordinal one ("1st Fridays") or any
 * other line is not a weekly grid's day (D-402).
 */
export function weeklyHeadingDays(
  page: FoldedPage,
  line: number,
  lang: string | null | undefined,
): string[] | null {
  const months = monthsByName(lang);
  const tokens = weekdayHeading(page, line, dayLexicon(lang), months, true);
  if (!tokens || !tokens.every((t) => t.startsWith("@"))) return null;
  const [first, after] = page.lines[line]!;
  if (page.words.slice(first, after).some((w) => months.has(w))) return null;
  return [...new Set(tokens.map((t) => t.slice(1)))];
}

/** A heading line that names a date ("Thursday, October 1"): one night's listings follow it. */
function datedHeading(
  page: FoldedPage,
  line: number,
  days: DayLexicon,
  months: ReadonlyMap<string, number>,
): boolean {
  if (weekdayHeading(page, line, days, months) === null) return false;
  const [first, after] = page.lines[line]!;
  return page.words.slice(first, after).some((w) => months.has(w));
}

/** Where the page writes the read's other titles, apart from where it writes this one. */
function otherSpans(
  page: FoldedPage,
  title: string,
  span: readonly [number, number],
  others: readonly string[],
): Array<[number, number]> {
  const own = foldWords(title).replace(/ /g, "");
  const out: Array<[number, number]> = [];
  for (const other of new Set(others)) {
    if (foldWords(other).replace(/ /g, "") === own) continue;
    for (const o of phraseSpans(page, other)) {
      if (o[1] <= span[0] || o[0] >= span[1]) out.push(o);
    }
  }
  return out;
}

/**
 * The recurrence tokens that stand beside one place the page writes a title (D-073, D-074): the
 * rest of the title's own line before it, back to another listing's title on that line; up to 40
 * words after it, up to the next listing's title or the next night's dated heading; and the
 * nearest weekday or dated heading above it within 40 lines ("MONDAYS" over a list of classes,
 * "Wednesday, September 30" over a night's listings). Text on the lines before the title's is not
 * read, because on a dense list it is the previous entry's details, and that weekday is not this
 * listing's.
 *
 * A dated line directly under a title is that title's own date, as a Squarespace summary prints it
 * ("Salsa Thursdays", then "Sunday, October 4"), unless another listing's title follows it at
 * once, when it heads that listing's night: so it stays in the title's window, and it is not a
 * heading over the listings further down.
 */
function tokensNearTitle(
  page: FoldedPage,
  [start, end]: readonly [number, number],
  others: ReadonlyArray<readonly [number, number]>,
  days: DayLexicon,
  months: ReadonlyMap<string, number>,
  besideOnly = false,
  lang: string | null | undefined = null,
): string[] {
  const line = page.lineOf[start]!;
  const titleLines = new Set([line, ...others.map(([os]) => page.lineOf[os]!)]);
  // A dated line that belongs to the title on the line above it.
  const ownDate = (at: number) =>
    at > 0 &&
    titleLines.has(at - 1) &&
    !titleLines.has(at + 1) &&
    datedHeading(page, at, days, months);
  let from = page.lines[line]![0];
  let to = Math.min(page.words.length, end + RECURRENCE_NEAR_WORDS);
  for (const [os, oe] of others) {
    if (oe <= start && oe > from) from = oe;
    if (os >= end && os < to) to = os;
  }
  // Weekday headings over entries (Cubana Café: "LES MARDIS & JEUDIS" over "Dansez comme à Cuba"): the title's
  // window ends at the next weekday heading, the next entry's (D-073). The heading over the title is read strictly:
  // "Every Wednesday" over a class is the previous entry's detail, not a heading (extract-title-aside).
  const underHeading =
    line > 0 && weekdayHeading(page, line - 1, days, months) !== null && !ownDate(line - 1);
  for (let down = line + 1; down < page.lines.length && page.lines[down]![0] < to; down++) {
    if (
      (datedHeading(page, down, days, months) && !ownDate(down)) ||
      (underHeading && weekdayHeading(page, down, days, months, true) !== null)
    ) {
      to = page.lines[down]![0];
      break;
    }
  }
  // Without the title's own words when only what stands beside it counts ("Salsa Thursdays" names
  // a weekday, but a name is not a night: D-078 checks a date against the words around it). A
  // weekday written as part of a date ("Fri, Oct 30", "Tuesday, September 29, 2026") names that
  // date's weekday, not a recurrence, so it is left out (D-080), unless the listing's own words say
  // it is weekly: "Weekly social dance … Tue, Sep 29" is every Tuesday. Read from the title on, not
  // the words before it, which on a one-line list are the previous card's.
  const dated = datedWeekdays(page, lang);
  const weekly = writesWeekly(page, range(start, to));
  const keep = (i: number) => weekly || !dated[i];
  const indexes = besideOnly ? [...range(from, start), ...range(end, to)] : range(from, to);
  const beside = recurrenceTokens(
    indexes.filter(keep).map((i) => page.words[i]!),
    days,
  );
  for (let up = line - 1; up >= 0 && up >= line - HEADING_LINES_UP; up--) {
    if (ownDate(up)) continue;
    const heading = weekdayHeading(page, up, days, months);
    if (!heading) continue;
    // The nearest heading governs; a dated one ("Tuesday, September 29, 2026") gives its night,
    // not a weekday every week (The Ronda, run 30), so it adds no token.
    const [first, after] = page.lines[up]!;
    const undated = recurrenceTokens(
      range(first, after)
        .filter(keep)
        .map((i) => page.words[i]!),
      days,
    ).filter((t) => t.startsWith("@") || ORDINAL_TOKENS.has(t));
    return [...(undated.some((t) => t.startsWith("@")) ? undated : []), ...beside];
  }
  return beside;
}

const range = (from: number, to: number): number[] =>
  Array.from({ length: Math.max(0, to - from) }, (_, k) => from + k);

/** Words that join a weekday to its date without being part of it: "Friday the 2nd of October". */
const DATE_JOINERS = new Set(["the", "of", "de", "le", "el", "del"]);

/**
 * Articles and "and" a weekday heading may carry in the page's language: "LES MARDIS & JEUDIS" over Cubana
 * Café's "Dansez comme à Cuba" (Paris), "Los martes y jueves", "As terças e quintas", "Dienstags und
 * Donnerstags". They name no night, so they do not stop the line being a heading.
 */
const HEADING_ARTICLES = new Set(["les", "los", "las", "os", "as", "et", "y", "e", "und"]);

/**
 * Words before a weekday that make it a recurrence's, not a date's (D-080): "every", "each",
 * "other", an ordinal ("First Friday, October 2", "every 2nd Friday, October 9", "1st & 3rd
 * Friday, Oct 2"), "last", "weekly", and "every" in the page's language as the recurrence lexicon
 * reads it ("cada", "todos los", "tous les", "chaque", "jeden").
 */
const RECURRING_BEFORE = new Set([
  "every",
  "each",
  "other",
  "last",
  "weekly",
  ...Object.keys(ORDINALS),
  "cada",
  "todos",
  "todas",
  "chaque",
  "tous",
  "toutes",
  "jeden",
  "jedem",
  "jede",
]);

/** Words passed over looking back for `RECURRING_BEFORE`: "1st and 3rd Friday", "todos los". */
const RECURRING_JOINERS = new Set(["and", "y", "et", "und", "los", "las", "les", "the"]);

/** How many words before a weekday are read for a recurrence's word. */
const RECURRING_LOOKBACK = 4;

/** Words that say "every week" without naming a weekday, folded. */
const WEEKLY_WORDS = new Set(["weekly", "semanal", "semanalmente", "hebdomadaire", "wochentlich"]);
const EVERY_WORDS = new Set(["every", "each", "cada", "chaque", "jede", "jeden"]);
const WEEK_WORDS = new Set(["week", "semana", "semaine", "woche"]);

/**
 * Whether these words say the listing repeats every week without naming the weekday (D-080):
 * "Weekly social dance", "every week", "each week", "semanal", "chaque semaine". A weekday written
 * as part of a date beside them ("Tue, Sep 29") is then the weekly night's weekday too: NYC Swings'
 * "Midtown Swings – Weekly Swing Dance Party" card prints only its next date.
 */
function writesWeekly(page: FoldedPage, indexes: Iterable<number>): boolean {
  const w = page.words;
  for (const i of indexes) {
    const word = w[i]!;
    if (WEEKLY_WORDS.has(word)) return true;
    if (EVERY_WORDS.has(word) && WEEK_WORDS.has(w[i + 1] ?? "")) return true;
  }
  return false;
}

/** A day of the month as a page writes it: "2", "02", "2nd", "1er". */
const DAY_OF_MONTH = /^(\d{1,2})(?:st|nd|rd|th|er|e|o|a)?$/;

const datedByPage = new WeakMap<FoldedPage, Map<string, Uint8Array>>();

/**
 * For each word of a page, 1 when it is a weekday written as part of a date (D-080): a weekday's
 * name or abbreviation, not its plural, with a month's name and a day of the month right beside
 * it ("Fri, Oct 30", "Tuesday, September 29, 2026", "vendredi 2 octobre", "October 2 (Friday)"),
 * and no word of a recurrence before it on its line (`RECURRING_BEFORE`: "every", "other", an
 * ordinal, "last", "cada"...). Such a weekday is the date's, so it states no recurrence.
 * "Fridays, October 2 - 30", "every Friday, October 2", "every other Friday: Oct 2" and "First
 * Friday, October 2" stay weekdays. A weekday beside a numeric date ("Fri 10/2") is not read as
 * dated: the folded words cannot tell "10/2" from "10-2". Where the listing's own words say it is
 * weekly (`writesWeekly`), its callers count a dated weekday as a weekday again.
 */
export function datedWeekdays(page: FoldedPage, lang?: string | null): Uint8Array {
  const days = dayLexicon(lang);
  const key = localesFor(lang).join(",");
  let memo = datedByPage.get(page);
  if (!memo) datedByPage.set(page, (memo = new Map()));
  const known = memo.get(key);
  if (known) return known;
  const months = monthsByName(lang);
  const w = page.words;
  const out = new Uint8Array(w.length);
  const isDay = (word: string | undefined) => {
    const m = word ? DAY_OF_MONTH.exec(word) : null;
    return m !== null && Number(m[1]) >= 1 && Number(m[1]) <= 31;
  };
  const isMonth = (word: string | undefined) => word !== undefined && months.has(word);
  /** The next word after i in direction d, past joining words. */
  const step = (i: number, d: 1 | -1) => {
    let j = i + d;
    while (j >= 0 && j < w.length && DATE_JOINERS.has(w[j]!)) j += d;
    return j;
  };
  const plural = pluralWeekdays(lang);
  for (let i = 0; i < w.length; i++) {
    const word = w[i]!;
    if (plural.has(word)) continue;
    const isWeekday = days.exact.has(word) || days.prefixes.some(([name]) => word.startsWith(name));
    if (!isWeekday) continue;
    // "every other Friday", "First Friday", "1st & 3rd Friday": up to four words back on its line.
    let recurring = false;
    for (
      let back = i - 1;
      back >= 0 && i - back <= RECURRING_LOOKBACK && page.lineOf[back] === page.lineOf[i];
      back--
    ) {
      const before = w[back]!;
      if (RECURRING_BEFORE.has(before)) recurring = true;
      else if (!RECURRING_JOINERS.has(before)) break;
    }
    if (recurring) continue;
    const n1 = step(i, 1);
    const n2 = step(n1, 1);
    const p1 = step(i, -1);
    const p2 = step(p1, -1);
    if (
      (isMonth(w[n1]) && isDay(w[n2])) ||
      (isDay(w[n1]) && isMonth(w[n2])) ||
      (isDay(w[p1]) && isMonth(w[p2])) ||
      (isMonth(w[p1]) && isDay(w[p2]))
    ) {
      out[i] = 1;
    }
  }
  memo.set(key, out);
  return out;
}

const pluralsByLang = new Map<string, Set<string>>();

/** Weekday names' plurals ("fridays"), which name a recurrence, never one date's weekday. */
function pluralWeekdays(lang: string | null | undefined): Set<string> {
  const key = localesFor(lang).join(",");
  const cached = pluralsByLang.get(key);
  if (cached) return cached;
  const out = new Set<string>();
  for (let i = 0; i < 7; i++) {
    const at = new Date(Date.UTC(2000, 0, 2 + i));
    for (const locale of localesFor(lang)) {
      const name = foldForMatch(
        new Intl.DateTimeFormat(locale, { weekday: "long", timeZone: "UTC" }).format(at),
      );
      if (name && !name.includes(" ")) out.add(`${name}s`);
    }
  }
  pluralsByLang.set(key, out);
  return out;
}

/** Month numbers (1 to 12) by flattened name, long and short, in English and the page's language. */
const monthsByLang = new Map<string, Map<string, number>>();

function monthsByName(lang: string | null | undefined): Map<string, number> {
  const key = localesFor(lang).join(",");
  const cached = monthsByLang.get(key);
  if (cached) return cached;
  const out = new Map<string, number>();
  monthsByLang.set(key, out);
  for (let m = 1; m <= 12; m++) for (const name of monthNames(m, lang)) out.set(name, m);
  return out;
}

/**
 * True when the text writes some calendar date, whichever it is: a month name beside a day number
 * ("Fri, Oct 30", "30 October"), or a numeric date ("10/30", "30.10.2026", "2026-10-30"). A text
 * that only names weekdays ("Every Friday") writes none. It tells a block that dates its link from
 * one that does not; a false yes costs a link, never adds one.
 */
export function statesAnyDate(text: string, lang?: string | null): boolean {
  if (!/\d/.test(text)) return false;
  const flat = flatten(text);
  return anyDatePatterns(lang).some((p) => p.test(flat));
}

const anyDatePatternsByKey = new Map<string, RegExp[]>();

/** `statesAnyDate`'s patterns for English and the page's language, compiled once. */
function anyDatePatterns(lang: string | null | undefined): RegExp[] {
  const key = localesFor(lang).join(",");
  const cached = anyDatePatternsByKey.get(key);
  if (cached) return cached;
  const months = [...monthsByName(lang).keys()].map(escapeRe).join("|");
  const patterns = [
    String.raw`(?<![\p{L}])(?:${months})\.?,?\s+(?:the\s+)?\d{1,2}(?:st|nd|rd|th)?(?![\d]|[:.]\d)`,
    String.raw`(?<![\d/.:-])\d{1,2}(?:st|nd|rd|th|er|e|o|a|º)?\.?\s*(?:de\s+|of\s+)?(?:${months})(?![\p{L}])`,
    String.raw`(?<![\d/.])\d{1,2}/\d{1,2}(?:/(?:\d{4}|\d{2}))?(?![\d/])`,
    String.raw`(?<![\d.])\d{1,2}\.\d{1,2}\.(?:\d{4}|\d{2})?(?!\d)`,
    String.raw`(?<!\d)20\d\d-\d{2}-\d{2}(?!\d)`,
  ].map((p) => new RegExp(p, "u"));
  anyDatePatternsByKey.set(key, patterns);
  return patterns;
}

/**
 * True when the text writes a span of days that holds this date (ISO `YYYY-MM-DD`): "Oct 1st-5th,
 * 2026", "October 1 - 5", "Oct 30 – Nov 2". A festival's block dates its link by its span, so a
 * night inside the span is that link's night. A span longer than about two months is not read.
 */
export function statesDateInSpan(text: string, isoDate: string, lang?: string | null): boolean {
  const match = /^\d{4}-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match || !/\d/.test(text)) return false;
  const byName = monthsByName(lang);
  const { span } = monthPatterns(lang);
  // A day of the year as month * 32 + day: enough to order two dates without a calendar.
  const ordinal = (m: number, d: number) => m * 32 + d;
  for (const m of flatten(text).matchAll(span)) {
    const fromMonth = byName.get(m[1]!)!;
    const toMonth = m[3] ? byName.get(m[3])! : fromMonth;
    const from = ordinal(fromMonth, Number(m[2]));
    let to = ordinal(toMonth, Number(m[4]));
    let at = ordinal(Number(match[1]), Number(match[2]));
    // Across the new year: December 30 to January 2.
    if (to < from) {
      to += 13 * 32;
      if (at < from) at += 13 * 32;
    }
    if (to - from > 64) continue;
    if (at >= from && at <= to) return true;
  }
  return false;
}

const monthPatternsByKey = new Map<
  string,
  { span: RegExp; monthFirst: RegExp; dayFirst: RegExp }
>();

/** Patterns over every month name of English and the page's language, compiled once. */
function monthPatterns(lang: string | null | undefined) {
  const key = localesFor(lang).join(",");
  const cached = monthPatternsByKey.get(key);
  if (cached) return cached;
  const months = [...monthsByName(lang).keys()].map(escapeRe).join("|");
  const day = String.raw`(\d{1,2})(?:st|nd|rd|th)?`;
  const made = {
    span: new RegExp(
      String.raw`(?<![\p{L}])(${months})\.?\s+${day}\s*(?:-|–|—|to|through|thru|until)\s*(?:(${months})\.?\s+)?${day}(?![\d:])`,
      "gu",
    ),
    monthFirst: new RegExp(
      String.raw`(?<![\p{L}])(${months})\.?,?\s+(\d{1,2})(?:st|nd|rd|th)?(?![\d]|[:.]\d)`,
      "gu",
    ),
    dayFirst: new RegExp(
      String.raw`(?<![\d/.:-])(\d{1,2})(?:st|nd|rd|th|er|e|o|a|º)?\.?\s*(?:de\s+|of\s+)?(${months})(?![\p{L}])`,
      "gu",
    ),
  };
  monthPatternsByKey.set(key, made);
  return made;
}

// ---------------------------------------------------------------------------------------------
// Date headings (D-074)

const headingWordsByLang = new Map<string, Set<string>>();

/** Words a date heading may hold besides numbers: weekday and month names, and joining words. */
function headingWords(lang: string | null | undefined): Set<string> {
  const key = lang ?? "";
  const cached = headingWordsByLang.get(key);
  if (cached) return cached;
  // "Today · October 30", "Tomorrow · October 31": a day heading that names the day relative to now (D-285).
  const words = new Set(["tues", "thur", "thurs", "weds", "sept", "today", "tomorrow", "tonight"]);
  for (const w of [
    "of",
    "de",
    "del",
    "du",
    "the",
    "to",
    "through",
    "thru",
    "until",
    "and",
    "et",
    "y",
  ])
    words.add(w);
  const add = (name: string) => {
    for (const w of foldForMatch(name).split(" ")) if (w && !/\d/.test(w)) words.add(w);
  };
  for (const locale of localesFor(lang)) {
    for (let i = 0; i < 7; i++) {
      const at = new Date(Date.UTC(2000, 0, 2 + i));
      for (const weekday of ["long", "short"] as const)
        add(new Intl.DateTimeFormat(locale, { weekday, timeZone: "UTC" }).format(at));
    }
  }
  for (let m = 1; m <= 12; m++) for (const name of monthNames(m, lang)) add(name);
  headingWordsByLang.set(key, words);
  return words;
}

/**
 * True when a line is a date heading: it writes a date and nothing else, only weekday and month
 * names, day numbers and a year, joined by punctuation ("Thursday, October 1", "Friday, October 9
 * – Sunday, October 11", "10/1"). A line with any other word ("Saturday, October 24, 2026 | 7:00
 * PM", "September 28, 2026 Eileen O'Donnell") is not one, and neither is a line over 60
 * characters. Link targets are left out, as they are for a title (`foldPage`).
 */
export function isDateHeading(line: string, lang?: string | null): boolean {
  const bare = line.replace(/\[https?:\/\/[^\]\s]*\]/g, " ").trim();
  if (!bare || bare.length > 60 || !/\d/.test(bare) || !statesAnyDate(bare, lang)) return false;
  const known = headingWords(lang);
  return foldForMatch(bare)
    .split(" ")
    .filter(Boolean)
    .every((w) => /^\d{1,4}(?:st|nd|rd|th|er|e|o|a)?$/.test(w) || known.has(w));
}

/**
 * The first month and day a date heading writes, as "M-D" ("Oct 11 [link]" and "October 11, 2026"
 * are both "10-11"), or the heading folded when it writes no month by name ("10/11"). Tells a
 * heading that repeats its entry's date from one that starts another entry.
 */
export function headingDateKey(line: string, lang?: string | null): string {
  const flat = flatten(line.replace(/\[https?:\/\/[^\]\s]*\]/g, " "));
  const byName = monthsByName(lang);
  const months = [...byName.keys()].map(escapeRe).join("|");
  const monthFirst = new RegExp(
    String.raw`(?<![\p{L}])(${months})\.?,?\s+(\d{1,2})(?:st|nd|rd|th)?(?![\d]|[:.]\d)`,
    "u",
  ).exec(flat);
  if (monthFirst) return `${byName.get(monthFirst[1]!)}-${Number(monthFirst[2])}`;
  const dayFirst = new RegExp(
    String.raw`(?<![\d/.:-])(\d{1,2})(?:st|nd|rd|th|er|e|o|a|º)?\.?\s*(?:de\s+|of\s+)?(${months})(?![\p{L}])`,
    "u",
  ).exec(flat);
  if (dayFirst) return `${byName.get(dayFirst[2]!)}-${Number(dayFirst[1])}`;
  return foldForMatch(flat);
}

/**
 * How many of these nights (ISO dates) the text writes (`statesDate`, so a date stated in another
 * year is not one of them). A part of a page that writes three or more of the window's nights and
 * that a read listed nothing from is read again by the stronger model (D-074).
 */
export function windowNightsWritten(
  text: string,
  nights: readonly string[],
  lang?: string | null,
): number {
  return nights.filter((night) => statesDate(text, night, lang)).length;
}

/**
 * True when a date heading, or a line that writes a date, covers this date: it writes the date
 * (`statesDate`, year-aware), or a span that holds it ("Oct 1st-5th"), or it runs from one date to
 * another around it ("Friday, October 9 – Sunday, October 11"). With `anyNumeric` false, a numeric
 * date counts only when it is unambiguous (`writesDate`).
 */
function coversDate(
  context: string,
  isoDate: string,
  lang: string | null | undefined,
  anyNumeric = true,
): boolean {
  if (!/\d/.test(context)) return false;
  if (writesDate(context, isoDate, lang, anyNumeric) || statesDateInSpan(context, isoDate, lang)) {
    return true;
  }
  const match = /^\d{4}-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) return false;
  const byName = monthsByName(lang);
  const ordinal = (m: number, d: number) => m * 32 + d;
  const days: number[] = [];
  const flat = flatten(context);
  const { monthFirst, dayFirst } = monthPatterns(lang);
  for (const m of flat.matchAll(monthFirst)) days.push(ordinal(byName.get(m[1]!)!, Number(m[2])));
  for (const m of flat.matchAll(dayFirst)) days.push(ordinal(byName.get(m[2]!)!, Number(m[1])));
  if (days.length < 2) return false;
  const from = days[0]!;
  let to = days[days.length - 1]!;
  let at = ordinal(Number(match[1]), Number(match[2]));
  if (to < from) {
    to += 13 * 32;
    if (at < from) at += 13 * 32;
  }
  return to - from <= 64 && at >= from && at <= to;
}

/**
 * The last page's non-empty lines, which of them are date headings, and each line folded without
 * its link targets: one read checks many titles against one page, so it is split and folded once.
 */
let lastHeaded: {
  text: string;
  lang: string;
  lines: string[];
  headings: boolean[];
  bare: string[];
  folded: string[];
} | null = null;

function headedLines(pageText: string, lang: string | null | undefined) {
  if (lastHeaded?.text !== pageText || lastHeaded.lang !== (lang ?? "")) {
    const lines = pageText
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    const bare = lines.map((line) => line.replace(/\[https?:\/\/[^\]\s]*\]/g, " "));
    lastHeaded = {
      text: pageText,
      lang: lang ?? "",
      lines,
      headings: lines.map((line) => isDateHeading(line, lang)),
      bare,
      folded: bare.map((line) => ` ${foldForMatch(line)} `),
    };
  }
  return lastHeaded;
}

/**
 * A short label line between a title and its date ("Fecha", "Date:"): 20 characters or fewer, at
 * most 3 words, letters only, an optional colon (D-517).
 */
function isDateLabel(line: string): boolean {
  const text = line.trim();
  return /^[\p{L} ]{1,20}:?$/u.test(text) && text.split(/\s+/).length <= 3;
}

/**
 * A label line over a list of a listing's dates ("DATES", "Upcoming dates:", "Fechas", "Termine"):
 * a date word, not any short line ("Featured" over Frim Fram Jam's next date is not one, D-821).
 */
export function isDatesLabel(line: string): boolean {
  return /^(?:(?:upcoming|next|event|show|tour|our|all|more|prochaines|pr[oó]ximas)\s+)?(?:dates?|when|fechas?|termine|daten|datum|datas|date\s+e\s+orari)(?:\s+(?:[aà]\s+venir|2\d{3}))?\s*:?$/iu.test(
    line.trim(),
  );
}

/**
 * Where a page lists a title against another night (D-074). Each line that writes the title
 * (folded, whole words) is under the nearest date heading above it (`isDateHeading`). Returns
 * that heading when every such line is under a heading and none of them is this date's; null when
 * the title is on no line, or any line that writes it is under no heading or is this date's. A
 * line is this date's when its heading covers the date, when the line itself writes the date, or
 * when the very next line is a heading that covers it (a page that prints each date below its
 * title, as Squarespace's event list does). A short label line ("Fecha", "Date:", ≤20 chars,
 * ≤3 words, letters only) between the title and its date is skipped (Club Oráculo). The Gotham
 * Jazz that run 21 dated October 1 is listed only under "Wednesday, September 30" and
 * "Wednesday, October 7".
 */
export function listedOnlyUnderOtherDates(
  pageText: string,
  title: string,
  isoDate: string,
  lang?: string | null,
): string | null {
  const want = foldForMatch(title);
  if (!want) return null;
  const { lines, headings, bare: bareLines, folded } = headedLines(pageText, lang);
  let above: string | null = null;
  let first: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (headings[i]) {
      above = line;
      continue;
    }
    if (!folded[i]!.includes(` ${want} `)) continue;
    const bare = bareLines[i]!;
    if (above === null || coversDate(above, isoDate, lang) || coversDate(bare, isoDate, lang)) {
      return null;
    }
    // Check the line directly below, and also two lines below if there is a short label in between.
    let below: string | null = null;
    if (headings[i + 1]) {
      below = lines[i + 1]!;
    } else if (i + 2 < lines.length && headings[i + 2]) {
      // See if the line between is a short label line.
      if (isDateLabel(lines[i + 1]!)) {
        below = lines[i + 2]!;
      }
    }
    if (below !== null && coversDate(below, isoDate, lang)) return null;
    first ??= above;
  }
  return first;
}

/** "Every Sunday", "every 2nd & last Saturday", "each other Friday of the month": English only. */
const EVERY_WEEKDAY =
  /\b(?:every|each)\s+(?:other\s+)?(?:(?:first|second|third|fourth|last|1st|2nd|3rd|4th|5th)(?:\s*(?:,|&|and|\+)\s*(?:first|second|third|fourth|last|1st|2nd|3rd|4th|5th))*\s+)?(?:mon|tues|wednes|thurs|fri|satur|sun)days?(?:\s+of\s+the\s+month)?/i;

/**
 * The recurrence a page writes right after a title, as the page words it ("Date: Every Sunday -
 * Time: 3:00pm", under "Tango Y Te"), up to 300 characters on and never past another of the read's
 * titles; null when the page writes none there, or the title is not written as given. English
 * phrases only: elsewhere a listing whose date the page contradicts is simply not listed on it.
 */
export function recurrencePhraseAfterTitle(
  pageText: string,
  title: string,
  others: readonly string[] = [],
): string | null {
  const lower = pageText.toLowerCase();
  const own = title.trim().toLowerCase();
  if (!own) return null;
  const bounds = [...new Set(others.map((o) => o.trim().toLowerCase()))].filter(
    (o) => o && o !== own,
  );
  for (let at = lower.indexOf(own); at >= 0; at = lower.indexOf(own, at + 1)) {
    const from = at + own.length;
    let to = Math.min(pageText.length, from + 300);
    // The next of the read's titles within the 300 characters, read in that window only.
    const window = lower.slice(from, to + 300);
    for (const o of bounds) {
      const next = window.indexOf(o);
      if (next >= 0 && from + next < to) to = from + next;
    }
    const found = EVERY_WEEKDAY.exec(pageText.slice(from, to));
    if (found) return found[0];
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// The dates a page gives a listing beside its title (D-080)

/** Words before a title on its own line that may date it ("Oct 2 - Salsa Social"). */
export const DATE_LEAD_WORDS = 4;

/** Words a listing's block runs on over the lines under its title, at most. */
export const DATE_BLOCK_WORDS = 60;

/** How a page dates one listing: what `dateBesideTitle` answers. */
export interface DateBeside {
  /** A block of the title writes this date, or a span or a range that holds it. */
  stated: boolean;
  /**
   * When the date is not stated: the date the page gives the title instead, as the page writes it
   * ("Fri, Oct 30", "Tuesday, September 29, 2026"), from a heading over the title, the title's
   * own line or the lines under it; null when the page gives it no other date there, or gives the
   * night's weekday beside it as a weekday (not a date's), so the night may be a rule's.
   */
  otherDate: string | null;
  /**
   * The night's weekday stands in a block as a weekday, not a date's ("Every Friday", "Fridays
   * 9pm"), or an undated weekday heading is over the title ("FRIDAYS"): the night may be a rule's.
   */
  weekdayBeside: boolean;
  /** The date is stated in a labelled list of the listing's dates ("DATES" over them, D-821). */
  listed?: true;
}

interface BlockPiece {
  text: string;
  /** The date here is the listing's own, not a neighbour's that the block may have run into. */
  strong: boolean;
  /** Word indexes of the page this piece covers, for the weekday guard. */
  words: readonly number[];
  /** A line of a labelled list of dates (D-821). */
  listed?: true;
}

/** A line's text folded as `foldWords` folds it, with where each of its words stands. */
function lineWords(text: string): { flat: string; at: Array<[number, number]> } {
  const flat = text.normalize("NFKD").replace(/\p{M}/gu, "");
  const at: Array<[number, number]> = [];
  for (const m of flat.matchAll(/[\p{L}\p{N}]+/gu)) {
    let runStart = m.index;
    let i = m.index;
    for (const ch of m[0]) {
      if (
        /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u.test(
          ch,
        )
      ) {
        if (i > runStart) at.push([runStart, i]);
        at.push([i, i + ch.length]);
        runStart = i + ch.length;
      }
      i += ch.length;
    }
    if (i > runStart) at.push([runStart, i]);
  }
  return { flat, at };
}

const shownText = (text: string) => text.split(LINK_MARK).join(" ");

/** Words before a title on its line that may date it when they open with a date. */
const DATE_LEAD_WORDS_DATED = 12;

/** How many lines of dates and times directly above a title are its own date (D-080). */
const DATE_LINES_ABOVE = 3;

/** Words a date-and-time line holds besides numbers and weekday and month names. */
const DATE_LINE_WORDS = new Set([
  "am",
  "pm",
  "a",
  "p",
  "m",
  "h",
  "hs",
  "noon",
  "midnight",
  "uhr",
  "hrs",
  "the",
  "of",
  "de",
  "del",
  "du",
  "le",
  "la",
  "el",
  "to",
  "until",
  "till",
  "thru",
  "through",
  "from",
  "at",
  "and",
  "y",
  "et",
  "und",
  "au",
  "al",
  "bis",
  "um",
  "ab",
  // Time zones a card prints after its time ("8:00 PM EDT").
  "est",
  "edt",
  "cst",
  "cdt",
  "ct",
  "mst",
  "mdt",
  "mt",
  "pst",
  "pdt",
  "pt",
  "gmt",
  "bst",
  "utc",
  "cet",
  "cest",
]);

/** A number as a date or time line writes it: "2", "2nd", "2026", "8pm", "00pm", "20h30". */
const DATE_LINE_NUMBER = /^\d{1,4}(?:st|nd|rd|th|er|e|o|a|am|pm|p|h|h\d{2})?$/;

const dateLinesByPage = new WeakMap<FoldedPage, Map<string, Int8Array>>();

/**
 * What line `j` of a page is, as dates and times go: 2 when it holds only dates and times and names
 * a weekday or a month ("Sat, Oct 3 · 8:00 PM EDT", "Fri 2", "October 2 @ 8:00 pm - 11:00 pm"), 1
 * when it holds only numbers and times ("3", "8:00 pm – 11:00 pm"), 0 for any other line.
 */
function dateLineAt(page: FoldedPage, j: number, lang: string | null | undefined): 0 | 1 | 2 {
  const key = lang ?? "";
  let memo = dateLinesByPage.get(page);
  if (!memo) dateLinesByPage.set(page, (memo = new Map()));
  let kinds = memo.get(key);
  if (!kinds) memo.set(key, (kinds = new Int8Array(page.texts.length).fill(-1)));
  if (kinds[j] === -1) {
    const [first, after] = page.lines[j]!;
    const days = dayLexicon(lang);
    const months = monthsByName(lang);
    let kind: 0 | 1 | 2 =
      after - first <= 16 && shownText(page.texts[j]!).trim().length <= 80 ? 1 : 0;
    for (let i = first; i < after && kind > 0; i++) {
      const w = page.words[i]!;
      if (months.has(w) || isWeekdayWord(w, days)) kind = 2;
      else if (!DATE_LINE_NUMBER.test(w) && !DATE_LINE_WORDS.has(w)) kind = 0;
    }
    kinds[j] = kind;
  }
  return kinds[j] as 0 | 1 | 2;
}

const isWeekdayWord = (word: string, days: DayLexicon) =>
  days.exact.has(word) || days.prefixes.some(([name]) => word.startsWith(name));

// A card's date-and-time line, as the time checks read it (D-081, title-blocks.ts).
const CARD_WEEKDAY =
  "mon|tue|tues|wed|weds|thu|thur|thurs|fri|sat|sun|monday|tuesday|wednesday|thursday|friday|saturday|sunday|mondays|tuesdays|wednesdays|thursdays|fridays|saturdays|sundays";
/** Spanish, Portuguese and Catalan weekdays, accents folded (D-490). No two-letter Catalan forms: "dj" is a DJ. */
const CARD_WEEKDAY_INTL =
  "lun|mie|jue|vie|sab|dom|lunes|martes|miercoles|jueves|viernes|sabado|sabados|domingo|domingos|seg|ter|qua|qui|sex|segunda|terca|quarta|quinta|sexta|dilluns|dimarts|dimecres|dijous|divendres|dissabte|diumenge|feira";
const CARD_MONTH =
  "jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december";
/** Spanish, Portuguese and Catalan months, accents folded (D-490). Not "set" or "out": English words. */
const CARD_MONTH_INTL =
  "ene|enero|febrero|marzo|abr|abril|mayo|junio|julio|ago|agosto|septiembre|setiembre|octubre|noviembre|dic|diciembre|fev|fevereiro|marco|maio|junho|julho|setembro|outubro|novembro|dez|dezembro|gener|febrer|marc|maig|juny|juliol|agost|setembre|novembre|desembre";
/** Time zones a card prints after its time ("8:00 PM EDT"). */
const CARD_ZONE = "et|edt|est|ct|cdt|cst|mt|mdt|mst|pt|pdt|pst|gmt|utc|bst|cet|cest";
const CARD_DATE_TIME_WORD = new RegExp(
  `^(?:\\d{1,4}(?:st|nd|rd|th)?|\\d{1,2}(?:am|pm|a|p|h)|\\d{1,2}h\\d{2}|am|pm|a|p|m|noon|midnight|${CARD_WEEKDAY}|${CARD_WEEKDAY_INTL}|${CARD_MONTH}|${CARD_MONTH_INTL}|to|until|at|from|de|del|las|los|hasta|ate|as|hrs|hr|free|uhr|${CARD_ZONE}|hs|a)$`,
  "i",
);
const CARD_WEEKDAY_WORD = new RegExp(`^(?:${CARD_WEEKDAY}|${CARD_WEEKDAY_INTL})$`, "i");
/** What separates a card line's date and time from the words after it. */
const CARD_SEPARATOR = /\s*[·|@•,]\s*|\s[-–—]\s/g;
/** A clock time: "8pm", "8:00 PM", "20:00", "21h", noon, midnight. */
export const CLOCK =
  /(?<![\d:.])\d{1,2}(?::\d{2})?\s*(?:[ap]\.?\s?m\b|[ap](?![a-z]))|(?<![\d:.])\d{1,2}[:h]\d{2}(?!\d)|(?<![\d:.])\d{1,2}h(?![a-z\d])|\bnoon\b|\bmidnight\b/i;
/** A link target as cleanPageText writes it (`label [https://…]`), or a URL printed as text. */
const CARD_LINK = /\[https?:\/\/[^\]\s]*\]|https?:\/\/[^\s[\]<>"'()]+/g;

const cardWords = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
const allDateTime = (text: string) => {
  const words = cardWords(text);
  return words.length > 0 && words.every((w) => CARD_DATE_TIME_WORD.test(w));
};

/** Whether a text writes a date (`statesAnyDate`) or names a weekday. */
export const datesOrNamesWeekday = (text: string, lang?: string | null): boolean =>
  statesAnyDate(text, lang) || cardWords(text).some((w) => CARD_WEEKDAY_WORD.test(w));

/**
 * The dates and times a line writes, when it is a date-and-time line: the whole line when it holds
 * only dates, times, zones and joining words ("October 4, 2026", "Thu, Oct 1, 8:00 PM EDT",
 * "4:30 p.m. – 8:00 p.m."); its first part when it writes a date (and maybe a time), then a
 * separator and other words ("Thu Oct 1 · 8pm · Club X"); null otherwise.
 */
export function dateTimePart(line: string, lang?: string | null): string | null {
  const shown = line.replace(CARD_LINK, " ").trim();
  if (!shown) return null;
  if (allDateTime(shown)) return shown;
  let part: string | null = null;
  for (const sep of shown.matchAll(CARD_SEPARATOR)) {
    const head = shown.slice(0, sep.index);
    if (!allDateTime(head)) break;
    part = head;
  }
  return part !== null && datesOrNamesWeekday(part, lang) ? part : null;
}

/** Labels a line may open with before its date: "Date:", "When:", "Next:", "Next dance:", "On". */
const DATE_LABEL_HEADS = new Set([
  "date",
  "dates",
  "when",
  "next",
  "upcoming",
  "on",
  "fecha",
  "cuando",
  "proxima",
  "proximo",
  "quand",
  "prochain",
  "prochaine",
  "datum",
  "wann",
  "nachste",
  "nachster",
  "nachsten",
]);
const DATE_LABEL_TAILS = new Set([
  "date",
  "dates",
  "dance",
  "event",
  "social",
  "class",
  "session",
  "night",
  "one",
  "milonga",
  "practica",
]);

/** Catalan weekday abbreviations ("Dg." is diumenge). */
const CA_WEEKDAY_SHORT = new Set(["dl", "dt", "dc", "dj", "dv", "ds", "dg"]);

/** One category word in capitals before a card's date: "BALLADA Dg. 01 Nov.", "LIVE Fri 31 Oct" (D-371). */
const CATEGORY_WORD = /^\p{Lu}{3,}$/u;

/** Whether page word `i`, shown as `shown`, is a category word: capitals, and no weekday or month ("FRI"). */
const isCategoryWord = (
  page: FoldedPage,
  i: number,
  shown: string,
  lang: string | null | undefined,
) =>
  CATEGORY_WORD.test(shown) &&
  !isWeekdayWord(page.words[i]!, dayLexicon(lang)) &&
  !monthsByName(lang).has(page.words[i]!);

/** Whether line `j` opens with a category word and then a date (the next one-line card, D-371). */
function categoryThenDate(page: FoldedPage, j: number, lang: string | null | undefined): boolean {
  const [jf, ja] = page.lines[j]!;
  const words = lineWords(page.texts[j]!);
  return (
    ja - jf > 1 &&
    words.at.length === ja - jf &&
    isCategoryWord(page, jf, words.flat.slice(...words.at[0]!), lang) &&
    opensWithDate(page, jf + 1, ja, lang)
  );
}

/**
 * Whether the words [from, to) of a page open with a date (D-080): after an optional short label
 * ("Date:", "Next:", "When:") and a weekday, a month and a day of the month in either order ("Oct
 * 6th - Calling: …", "Next: Sunday, October 4 with DJ Ana", "Fri 2 Oct, 10:00 PM"). A date inside
 * a sentence ("Renovations finished September 15", "Posted September 1, 2026 by admin") does not.
 */
function opensWithDate(
  page: FoldedPage,
  from: number,
  to: number,
  lang: string | null | undefined,
): boolean {
  const w = page.words;
  const months = monthsByName(lang);
  const at = (n: number) => (n < to ? w[n] : undefined);
  const isDay = (word: string | undefined) => {
    const m = word ? DAY_OF_MONTH.exec(word) : null;
    return m !== null && Number(m[1]) >= 1 && Number(m[1]) <= 31;
  };
  const isMonth = (word: string | undefined) => word !== undefined && months.has(word);
  let i = from;
  if (DATE_LABEL_HEADS.has(at(i) ?? "")) {
    i++;
    if (DATE_LABEL_TAILS.has(at(i) ?? "")) i++;
  }
  const word = at(i);
  // D-371: Catalan "Dg. 01 Nov." (SomSardana). The two-letter forms count only here, where a day
  // and a month must follow ("dj" alone is a DJ).
  const caDay =
    word !== undefined &&
    CA_WEEKDAY_SHORT.has(word) &&
    localesFor(lang).some((l) => l === "ca" || l === "es");
  if (word !== undefined && (caDay || isWeekdayWord(word, dayLexicon(lang)))) i++;
  while (DATE_JOINERS.has(at(i) ?? "")) i++;
  const next = (n: number) => {
    let k = n + 1;
    while (DATE_JOINERS.has(at(k) ?? "")) k++;
    return at(k);
  };
  return (isMonth(at(i)) && isDay(next(i))) || (isDay(at(i)) && isMonth(next(i)));
}

/**
 * The blocks a page gives a listing, one for each place it writes the title (`phraseSpans`):
 *
 * - the nearest date heading above the title within 40 lines (`isDateHeading`: "Tuesday, September
 *   29, 2026" over The Ronda's milongas), which is weak when it stands directly under another
 *   title's line (that title's own date, as a Squarespace summary prints it);
 * - up to three lines of dates and times directly above the title's line ("Sat, Oct 3 · 8:00 PM"
 *   over an Eventbrite or Meetup card, "Fri 2" and "October 2 @ 8:00 pm - 11:00 pm" over The Events
 *   Calendar's title): the listing's own date, weak on the same terms;
 * - the words before the title on its line, when there are at most four since the line began,
 *   another title ended or a link stood ("Oct 2 - Salsa Social"), or at most twelve that open with
 *   a date ("Fri, Oct 2 • 9:00 PM - Salsa Social"), which are weak: on a one-line list they may be
 *   the previous card's;
 * - the rest of the title's line, up to the next title or the first link after the title's own
 *   (a card's "Learn More"): "Fri, Oct 30 • 8:30 PM" in NYC Swings' Flow Fridays card;
 * - when the line runs on to its end, the lines under it, up to the next title's line, a date
 *   heading (a date heading directly under the title is the title's own date, or one after a short
 *   label line ("Fecha", D-517), and the first date heading below a block that writes no date yet
 *   is taken, weak, and ends it), or 60 words. A date in them is the listing's own (strong) only on
 *   the line directly under the title or on a line that opens with it ("Date: Oct 3"); one inside a
 *   sentence further down ("Renovations finished September 15") is not. When the listing's date
 *   stood before its title (above it, or leading its line), a line that opens with a date opens the
 *   next listing: it is taken, weak, and ends it.
 */
const headingsByPage = new WeakMap<FoldedPage, Map<string, Int8Array>>();

/** Whether line `k` of a page is a date heading (`isDateHeading`), asked once per page and line. */
function dateHeadingAt(page: FoldedPage, k: number, lang: string | null | undefined): boolean {
  const key = lang ?? "";
  let memo = headingsByPage.get(page);
  if (!memo) headingsByPage.set(page, (memo = new Map()));
  let flags = memo.get(key);
  if (!flags) memo.set(key, (flags = new Int8Array(page.texts.length).fill(-1)));
  if (flags[k] === -1) flags[k] = isDateHeading(shownText(page.texts[k]!), lang) ? 1 : 0;
  return flags[k] === 1;
}

type Block = { pieces: BlockPiece[]; headingDays: string[] };
const blocksByPage = new WeakMap<FoldedPage, Map<string, Block[]>>();

function titleBlocks(
  page: FoldedPage,
  title: string,
  others: readonly string[],
  lang: string | null | undefined,
): Block[] {
  const key = `${lang ?? ""}\u0000${foldWords(title)}\u0000${[...new Set(others.map(foldWords))].sort().join("\u0001")}`;
  let memo = blocksByPage.get(page);
  if (!memo) blocksByPage.set(page, (memo = new Map()));
  const known = memo.get(key);
  if (known) return known;
  const made = buildBlocks(page, title, others, lang);
  memo.set(key, made);
  return made;
}

/** Whether a text names a date by a month's name, or as 2026-10-02: "10/2" alone does not. */
const namesDate = (text: string, lang: string | null | undefined) =>
  firstDateIn(text, lang, "0000") !== null;

function buildBlocks(
  page: FoldedPage,
  title: string,
  others: readonly string[],
  lang: string | null | undefined,
): Block[] {
  const days = dayLexicon(lang);
  const months = monthsByName(lang);
  const own = phraseSpans(page, title);
  const blocks: Array<{ pieces: BlockPiece[]; headingDays: string[] }> = [];
  for (const span of own) {
    const [s, e] = span;
    const stops = [...otherSpans(page, title, span, others), ...own.filter((o) => o !== span)].sort(
      (a, b) => a[0] - b[0],
    );
    const stopLines = new Set(stops.map(([os]) => page.lineOf[os]!));
    const k = page.lineOf[s]!;
    const kEnd = page.lineOf[e - 1]!;
    const pieces: BlockPiece[] = [];
    let headingDays: string[] = [];
    // A heading above.
    for (let up = k - 1; up >= 0 && up >= k - HEADING_LINES_UP; up--) {
      const text = shownText(page.texts[up]!);
      if (dateHeadingAt(page, up, lang)) {
        pieces.push({ text, strong: !stopLines.has(up - 1), words: [] });
        break;
      }
      const heading = weekdayHeading(page, up, days, months);
      if (heading) {
        headingDays = heading.filter((t) => t.startsWith("@")).map((t) => t.slice(1));
        break;
      }
    }
    // Dates and times directly above the title's line: the listing's own date, unless they stand
    // directly under another title's line (that title's own, as a Squarespace summary prints it).
    // Read up from the title to the first line that, with those under it, names a date ("OCT" over
    // "3" is October 3): one date, never a run of cards' dates read as a span.
    let dateBefore = false;
    for (
      let top = k - 1;
      top >= 0 && k - top <= DATE_LINES_ABOVE && !stopLines.has(top) && dateLineAt(page, top, lang);
      top--
    ) {
      const text = range(top, k)
        .map((j) => shownText(page.texts[j]!).trim())
        .join(" ");
      if (!namesDate(text, lang)) continue;
      const neighbours = top > 0 && stopLines.has(top - 1);
      pieces.push({ text, strong: !neighbours, words: [] });
      dateBefore = !neighbours;
      break;
    }
    // The title's own line: the words before it, and the rest of it.
    const [lineFirst, lineAfter] = page.lines[k]!;
    const line = lineWords(page.texts[k]!);
    const aligned = line.at.length === lineAfter - lineFirst;
    const offset = (word: number) => line.at[word - lineFirst]!;
    if (aligned) {
      let leadFrom = lineFirst;
      for (const [os, oe] of stops)
        if (oe <= s && oe > leadFrom && page.lineOf[os] === k) leadFrom = oe;
      const mark = line.flat.lastIndexOf(LINK_MARK, offset(s)[0]);
      if (mark >= 0) {
        while (leadFrom < s && offset(leadFrom)[0] < mark) leadFrom++;
      }
      // A one-line card: a category word, its date, then the title ("BALLADA Dg. 01 Nov. 2026 …").
      const cardLead =
        s > leadFrom + 1 &&
        isCategoryWord(page, leadFrom, line.flat.slice(...offset(leadFrom)), lang) &&
        opensWithDate(page, leadFrom + 1, s, lang);
      const leadDated = s > leadFrom && (cardLead || opensWithDate(page, leadFrom, s, lang));
      if (
        s > leadFrom &&
        (s - leadFrom <= DATE_LEAD_WORDS || (leadDated && s - leadFrom <= DATE_LEAD_WORDS_DATED))
      ) {
        pieces.push({
          text: shownText(line.flat.slice(offset(leadFrom)[0], offset(s)[0])),
          // A short lead states its date, never contradicts; a one-line card's own date does (D-371).
          strong: cardLead,
          // A weekday in the lead is the listing's ("Monday | Salsa Mondays | 8pm").
          words: range(leadFrom, s),
        });
        if (leadDated) dateBefore = true;
      }
    }
    const endLine = kEnd === k ? line : lineWords(page.texts[kEnd]!);
    const [endFirst, endAfter] = page.lines[kEnd]!;
    let closedMidLine = false;
    if (endLine.at.length === endAfter - endFirst) {
      const from = endLine.at[e - 1 - endFirst]![1];
      let stop = endLine.flat.length;
      let stopWord = endAfter;
      for (const [os] of stops) {
        if (os >= e && page.lineOf[os] === kEnd) {
          stop = endLine.at[os - endFirst]![0];
          stopWord = os;
          break;
        }
      }
      // The first card link after the title: a link labelled "Learn More", "Tickets" and the
      // like closes a card on a one-line list. A link inside a sentence ("our Code of Conduct
      // [link] and ...") does not.
      let mark = -1;
      for (
        let m = endLine.flat.indexOf(LINK_MARK, from);
        m >= 0 && m < stop;
        m = endLine.flat.indexOf(LINK_MARK, m + 1)
      ) {
        const before = endLine.flat.slice(from, m).split(LINK_MARK).pop()!;
        if (GENERIC_LINK_LABEL.test(before)) {
          mark = m;
          break;
        }
      }
      if (mark >= 0 && mark < stop) {
        stop = mark;
        stopWord = e;
        while (stopWord < endAfter && endLine.at[stopWord - endFirst]![0] < mark) stopWord++;
      }
      // A card's own link, or the next title on the line, closes the block.
      closedMidLine = stopWord < endAfter || mark >= 0;
      pieces.push({
        text: shownText(endLine.flat.slice(from, stop)),
        strong: true,
        words: range(e, stopWord),
      });
    } else {
      pieces.push({ text: shownText(page.texts[kEnd]!), strong: true, words: range(e, endAfter) });
    }
    // The lines under it.
    if (!closedMidLine) {
      let count = 0;
      const dated = () => pieces.some((p) => namesDate(p.text, lang));
      // A label line over two or more date lines ("DATES" / "Sunday 25th October" / "Sunday 8th
      // November", El Fenn): every date in the run is the listing's own, past the word cap (D-821).
      const labelOver = (j: number) =>
        isDatesLabel(shownText(page.texts[j]!)) &&
        j + 2 < page.lines.length &&
        dateHeadingAt(page, j + 1, lang) &&
        dateHeadingAt(page, j + 2, lang);
      let labelRun: boolean = false;
      for (
        let j = kEnd + 1;
        j < page.lines.length && (count < DATE_BLOCK_WORDS || labelRun || labelOver(j));
        j++
      ) {
        const [jf, ja] = page.lines[j]!;
        const text = shownText(page.texts[j]!);
        // The next title's line is that listing's, the words before it too ("Oct 3 - Bachata").
        if (stopLines.has(j)) break;
        const under = j === kEnd + 1;
        const inRun: boolean = labelRun && dateHeadingAt(page, j, lang);
        labelRun = inRun || labelOver(j);
        if (dateHeadingAt(page, j, lang)) {
          const ownSlot =
            under || inRun || (j === kEnd + 2 && isDateLabel(shownText(page.texts[kEnd + 1]!)));
          if (ownSlot && !dateBefore) {
            pieces.push({
              text,
              strong: true,
              words: range(jf, ja),
              ...(inRun ? { listed: true as const } : {}),
            });
            count += ja - jf;
            continue;
          }
          // Directly under a title whose date also stood above it, a date may be this listing's
          // (a summary that prints each date below its title, the one above being the previous
          // listing's) or the next one's: it states, never contradicts.
          if (ownSlot || !dated()) pieces.push({ text, strong: false, words: [] });
          break;
        }
        const opens =
          opensWithDate(page, jf, ja, lang) || (dateBefore && categoryThenDate(page, j, lang));
        // The listing's date stood before its title: a line that opens with a date is the next
        // card's ("Sat 3" / "October 3 @ 8:00 pm" in The Events Calendar), or this listing's in a
        // layout that prints each date below its title. It states, never contradicts, and it ends
        // the block.
        if (dateBefore && (opens || dateLineAt(page, j, lang) === 2)) {
          pieces.push({ text, strong: false, words: [] });
          break;
        }
        pieces.push({ text, strong: under || opens, words: range(jf, ja) });
        count += ja - jf;
        // A line that ends in a card's own link ("Details", "Tickets") closes the block.
        const parts = page.texts[j]!.split(LINK_MARK);
        if (parts.slice(0, -1).some((label) => GENERIC_LINK_LABEL.test(label))) break;
      }
    }
    blocks.push({ pieces, headingDays });
  }
  return blocks;
}

/**
 * Whether a page gives a listing this date beside its own title (D-080), rather than anywhere on
 * the page: NYC Swings writes "Fri, Oct 2" on the Swingiversity card and "Fri, Oct 30" on the
 * Flow Fridays card, so October 2 is not stated for Flow Fridays, and Oct 30 is the date the page
 * gives it instead. See `titleBlocks` for where a block runs. A numeric date ("1/2 price", "24/7",
 * "$10/15") neither states nor contradicts a night, unless it carries the night's year or follows
 * its weekday ("Fri 10/2"). "Weekly" in the listing's own words (`writesWeekly`) makes a date's
 * weekday the weekly night's weekday too.
 */
export function dateBesideTitle(
  page: FoldedPage,
  title: string,
  isoDate: string,
  lang?: string | null,
  others: readonly string[] = [],
): DateBeside {
  const days = dayLexicon(lang);
  const dated = datedWeekdays(page, lang);
  const spans = phraseSpans(page, title);
  const titleWords = new Set<number>();
  for (const [s, e] of spans) for (const i of range(s, e)) titleWords.add(i);
  const titleWeekly = spans.length > 0 && writesWeekly(page, range(spans[0]![0], spans[0]![1]));
  const weekday = weekdayCodeOf(isoDate);
  let other: string | null = null;
  let listedOther: string | null = null;
  let weekdayBeside = false;
  for (const { pieces, headingDays } of titleBlocks(page, title, others, lang)) {
    if (headingDays.includes(weekday)) weekdayBeside = true;
    const weekly = titleWeekly || pieces.some((piece) => writesWeekly(page, piece.words));
    for (const piece of pieces) {
      if (coversDate(piece.text, isoDate, lang, false)) {
        return {
          stated: true,
          otherDate: null,
          weekdayBeside: false,
          ...(piece.listed ? { listed: true as const } : {}),
        };
      }
      if (piece.strong && other === null)
        other = firstDateIn(piece.text, lang, isoDate.slice(0, 4))?.text ?? null;
      // A labelled list of the listing's dates is every night it has: a night off the list is
      // contradicted, though a rule's weekday stands beside it ("every other Sunday", D-821).
      if (piece.listed && listedOther === null)
        listedOther = firstDateIn(piece.text, lang, isoDate.slice(0, 4))?.text ?? null;
      for (const i of piece.words) {
        if ((dated[i] && !weekly) || titleWords.has(i)) continue;
        const w = page.words[i]!;
        const code = days.exact.get(w) ?? days.prefixes.find(([name]) => w.startsWith(name))?.[1];
        if (code === weekday) weekdayBeside = true;
      }
    }
  }
  if (listedOther !== null) return { stated: false, otherDate: listedOther, weekdayBeside: false };
  return { stated: false, otherDate: weekdayBeside ? null : other, weekdayBeside };
}

/**
 * The date a page gives a listing instead of this night, when its own words contradict the night
 * (D-074, D-080): the title is written only under other nights' headings (`listedOnlyUnderOtherDates`),
 * or its own block dates it otherwise (`dateBesideTitle`). Null when the page does not write the
 * title, states the night beside it, or gives the night's weekday beside it as a weekday (the
 * night may be a rule's the model read before). Deterministic: the whole page text is read, so it
 * holds whatever part of the page the model could read. `beside`, when the caller has it, is
 * `dateBesideTitle` for the same title and night.
 */
export function contradictingDate(
  page: FoldedPage,
  pageText: string,
  title: string,
  isoDate: string,
  lang?: string | null,
  others: readonly string[] = [],
  beside?: DateBeside,
): { kind: "heading" | "beside"; text: string } | null {
  if (phraseSpans(page, title).length === 0) return null;
  const b = beside ?? dateBesideTitle(page, title, isoDate, lang, others);
  if (b.stated || b.weekdayBeside) return null;
  const heading = listedOnlyUnderOtherDates(pageText, title, isoDate, lang);
  if (heading) return { kind: "heading", text: heading.slice(0, 60) };
  return b.otherDate ? { kind: "beside", text: b.otherDate } : null;
}

const datePatternsByKey = new Map<string, RegExp[]>();

/** `firstDateIn`'s patterns for the page's language, compiled once. */
function datePatterns(lang: string | null | undefined): RegExp[] {
  const key = localesFor(lang).join(",");
  const cached = datePatternsByKey.get(key);
  if (cached) return cached;
  const months = [...monthsByName(lang).keys()].map(escapeRe).join("|");
  const weekday = String.raw`(?:(?:mon|tue|tues|wed|weds|thu|thur|thurs|fri|sat|sun)[a-z]*\.?,?\s+)?`;
  const year = String.raw`(?:,?\s+((?:19|20)\d{2})(?![\d:h]))?`;
  // No numeric day and month ("10/2"): "1/2 price", "$10/15", "24/7" and "3/4 time" are not the
  // date a page gives a listing (D-080).
  const patterns = [
    String.raw`${weekday}(?<![\p{L}])(?:${months})\.?,?\s+(?:the\s+)?\d{1,2}(?:st|nd|rd|th)?(?![\d]|[:.]\d)${year}`,
    String.raw`${weekday}(?<![\d/.:-])\d{1,2}(?:st|nd|rd|th|er|e|o|a|º)?\.?\s*(?:de\s+|of\s+)?(?:${months})(?![\p{L}])${year}`,
    String.raw`(?<!\d)(20\d\d)-\d{2}-\d{2}(?!\d)`,
  ].map((p) => new RegExp(p, "giu"));
  datePatternsByKey.set(key, patterns);
  return patterns;
}

/** A post's own date, not an event's: "Posted September 1, 2026 by admin", "Updated: Oct 2". */
const PUBLISHED_BEFORE =
  /(?:posted|updated|published|publi[eé]|publicado|ver[oö]ffentlicht)(?:\s+(?:on|le|el|am))?\s*[:\-–—]?\s*$/i;

/**
 * The first date a text writes by a month's name, as written ("Fri, Oct 30"), and where, whose
 * stated year, if any, is not before `fromYear`: "July 19, 2023" over a news item and "© 2026" do
 * not date a night in 2026 otherwise. A post's own date ("Posted September 1, 2026") is not one.
 * Null when it writes none.
 */
function firstDateIn(
  text: string,
  lang: string | null | undefined,
  fromYear: string,
): { at: number; text: string } | null {
  let best: { at: number; text: string } | null = null;
  for (const re of datePatterns(lang)) {
    for (const m of text.matchAll(re)) {
      const y = m[1] ? (m[1].length === 2 ? `20${m[1]}` : m[1]) : null;
      if (y !== null && y < fromYear) continue;
      if (PUBLISHED_BEFORE.test(text.slice(Math.max(0, m.index - 30), m.index))) continue;
      if (!best || m.index < best.at) best = { at: m.index, text: m[0].trim().slice(0, 60) };
      break;
    }
  }
  return best;
}
