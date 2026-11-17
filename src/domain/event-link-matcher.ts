// Reading a page the model read for each listing's own link (D-073): the text cleanPageText wrote,
// links as "label [url]". Which links the page carries, what dates a URL carries, and each
// listing's own link among them (`findEventLinks`). Pure: page text in, links out, no model and no
// fetch. The bar is zero wrong links: a listing it is unsure of gets no link. Only the ingest
// imports this; the card reads the URL rules in src/domain/event-links.ts, which stays light.

import { getDomain } from "tldts";

import {
  isHostedEventPage,
  isTicketingEventPage,
  looksLikeEventPage,
  parseHttpUrl,
} from "@/src/domain/event-links";
import {
  foldForMatch,
  GENERIC_LINK_LABEL,
  isDateHeading,
  statesAnyDate,
  statesDate,
  statesDateInSpan,
} from "@/src/domain/text-facts";

/** Query parameters that say who sent the visitor, never which page: dropped before comparing. */
// D-883: Ticketmaster's venue-site links add camefrom=CFC_<venue>_web&brand=<venue> (LA Meredith Marks, 2026-11-13).
const TRACKING_PARAM = /^(?:utm_.*|aff|fbclid|gclid|camefrom)$/i;
const TICKETMASTER_HOST = /(?:^|\.)ticketmaster\.[a-z.]+$/i;

/** The URL without its tracking parameters (`utm_*`, `aff`, `fbclid`, `gclid`). */
export function stripTracking(url: string): string {
  const parsed = parseHttpUrl(url);
  if (parsed === null) return url;
  for (const key of [...parsed.searchParams.keys()]) {
    if (TRACKING_PARAM.test(key)) parsed.searchParams.delete(key);
    else if (key === "brand" && TICKETMASTER_HOST.test(parsed.hostname))
      parsed.searchParams.delete(key);
  }
  return parsed.toString();
}

/**
 * A URL as two links to the same page compare: host without "www.", path without a trailing
 * slash and with each segment's escapes written one way ("salsa-%26-bachata" and
 * "salsa-&-bachata" are one page; a malformed escape is kept as written), the query without
 * tracking parameters; not the scheme and not the fragment. Null for anything that is not an
 * http(s) URL.
 */
export function linkKey(url: string): string | null {
  const parsed = parseHttpUrl(stripTracking(url));
  if (parsed === null) return null;
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  const path = parsed.pathname
    .split("/")
    .map((segment) => {
      try {
        return encodeURIComponent(decodeURIComponent(segment));
      } catch {
        return segment;
      }
    })
    .join("/")
    .replace(/\/+$/, "");
  return `${host}${path}${parsed.search}`;
}

/** True when two URLs name the same page (`linkKey`). */
export function sameLink(a: string, b: string): boolean {
  const key = linkKey(a);
  return key !== null && key === linkKey(b);
}

const BRACKETED_LINK = /\[(https?:\/\/[^\]\s]+)\]/g;

/**
 * Every link a cleaned page carries: the targets cleanPageText writes as "label [url]", and a URL
 * the page prints as text (a link whose label is its own URL, or "Tickets: https://…").
 */
export function pageLinks(pageText: string): string[] {
  const out = [...pageText.matchAll(BRACKETED_LINK)].map((m) => m[1]!);
  const rest = pageText.replace(BRACKETED_LINK, " ");
  for (const m of rest.matchAll(/https?:\/\/[^\s[\]<>"'()]+/g)) {
    out.push(m[0].replace(/[.,;:!?]+$/, ""));
  }
  return out;
}

/** The order a country writes a numeric day and month in: "mdy" (10-3-26 is October 3) or "dmy". */
export type DateOrder = "mdy" | "dmy";

/** Countries and territories that write the month first. */
const MONTH_FIRST = new Set(["US", "PR", "GU", "VI", "AS", "MP", "UM", "PH", "FM", "MH", "PW"]);
/** Countries that write both orders, or the year first: a numeric date there is ambiguous. */
const MIXED_ORDER = new Set(["CA", "CN", "JP", "KR", "TW", "HU", "LT", "IR", "MN"]);

/** The metro's numeric date order, or null when its country writes both. */
export function dateOrderFor(countryCode: string | null | undefined): DateOrder | null {
  const code = countryCode?.toUpperCase() ?? "";
  if (MONTH_FIRST.has(code)) return "mdy";
  if (!code || MIXED_ORDER.has(code)) return null;
  return "dmy";
}

const MONTH =
  "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const MONTH_KEYS = [
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
];

export interface UrlDates {
  /**
   * The dates the URL's path or query carries, ISO `YYYY-MM-DD`; `XXXX-MM-DD` when it gives a
   * month and day and no year ("…-oct-30th-tickets-…").
   */
  dates: string[];
  /** True when it carries a numeric date whose order cannot be told (3-10-26 where both are used). */
  unread: boolean;
}

/**
 * The dates a URL carries in its path or query: 2026-10-02, 20261001, 2026/10/01, 2026-10-2; a
 * numeric n-n-yy or n-n-yyyy (SOB's `…-10-3-26/`, Ticketmaster's `…-10-01-2026/event/…`,
 * `?date=10/02/2026`) read in the metro's order, and unread when the order is unknown and both
 * readings are dates; a numeric n-n with no year (`…/salsa-10-02`) read the same way when it can
 * only be a month and day; "sept-25-2026", "25-sept-2026", "oct-30th", "oct2". Each reader blanks
 * what it read, so a looser one after it does not read the same digits a second way.
 */
export function urlDates(url: string, order: DateOrder | null): UrlDates {
  const parsed = parseHttpUrl(url);
  if (parsed === null) return { dates: [], unread: false };
  let path: string;
  try {
    path = decodeURIComponent(`${parsed.pathname}${parsed.search}`).toLowerCase();
  } catch {
    path = `${parsed.pathname}${parsed.search}`.toLowerCase();
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  const valid = (m: number, d: number) => m >= 1 && m <= 12 && d >= 1 && d <= 31;
  const dates: string[] = [];
  let unread = false;
  const read = (pattern: RegExp, each: (m: RegExpMatchArray) => void) => {
    for (const m of path.matchAll(pattern)) each(m);
    path = path.replace(pattern, (whole) => " ".repeat(whole.length));
  };
  /** Month and day from two numbers in the metro's order; null when neither order is one. */
  const monthDay = (a: number, b: number): [number, number] | "unread" | null => {
    if (order === "mdy") return valid(a, b) ? [a, b] : null;
    if (order === "dmy") return valid(b, a) ? [b, a] : null;
    if (valid(a, b) && valid(b, a) && a !== b) return "unread";
    if (valid(a, b)) return [a, b];
    return valid(b, a) ? [b, a] : null;
  };
  const iso = (m: RegExpMatchArray) => {
    if (valid(Number(m[3]), Number(m[4]))) {
      dates.push(`${m[1]}-${pad(Number(m[3]))}-${pad(Number(m[4]))}`);
    }
  };
  read(/(?<!\d)(20\d\d)([-_/.]?)(\d\d)\2(\d\d)(?!\d)/g, iso);
  read(/(?<!\d)(20\d\d)([-_/.])(\d{1,2})\2(\d{1,2})(?!\d)/g, iso);
  read(/(?<!\d)(\d{1,2})[-_./](\d{1,2})[-_./](20\d\d|\d\d)(?!\d)/g, (m) => {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const year = m[3]!.length === 2 ? `20${m[3]}` : m[3]!;
    let md: [number, number] | null = null;
    if (order === "mdy") md = valid(a, b) ? [a, b] : null;
    else if (order === "dmy") md = valid(b, a) ? [b, a] : null;
    else if (a === b || !valid(b, a)) md = valid(a, b) ? [a, b] : null;
    else if (!valid(a, b)) md = [b, a];
    if (md) dates.push(`${year}-${pad(md[0])}-${pad(md[1])}`);
    else unread = true;
  });
  const monthOf = (name: string) => MONTH_KEYS.indexOf(name.slice(0, 3)) + 1;
  const named = (month: string, day: string, year: string | undefined) => {
    if (valid(monthOf(month), Number(day))) {
      dates.push(`${year ?? "XXXX"}-${pad(monthOf(month))}-${pad(Number(day))}`);
    }
  };
  read(
    new RegExp(
      String.raw`(?<![a-z])${MONTH}[-_](\d{1,2})(?:st|nd|rd|th)?(?:[-_](20\d\d))?(?![\d])`,
      "g",
    ),
    (m) => named(m[1]!, m[2]!, m[3]),
  );
  // "oct2", "sept25th": the day written straight after the month, and nothing after it but a
  // separator (so "dec12ab", part of an id, is not a date).
  read(
    new RegExp(
      String.raw`(?<![a-z])${MONTH}(\d{1,2})(?:st|nd|rd|th)?(?:[-_](20\d\d))?(?![\da-z])`,
      "g",
    ),
    (m) => named(m[1]!, m[2]!, m[3]),
  );
  read(
    new RegExp(
      String.raw`(?<![\d])(\d{1,2})(?:st|nd|rd|th)?[-_]${MONTH}(?:[-_](20\d\d))?(?![a-z])`,
      "g",
    ),
    (m) => named(m[2]!, m[1]!, m[3]),
  );
  // "…/salsa-10-02": a month and a day with no year, only when the two numbers stand alone.
  read(/(?<![\p{L}\d.])(\d{1,2})[-_/](\d{1,2})(?![\p{L}\d])/gu, (m) => {
    const md = monthDay(Number(m[1]), Number(m[2]));
    if (md === "unread") unread = true;
    else if (md) dates.push(`XXXX-${pad(md[0])}-${pad(md[1])}`);
  });
  return { dates: [...new Set(dates)], unread };
}

/** True when a date a URL carries (`urlDates`) is this ISO date. */
function isDate(carried: string, isoDate: string): boolean {
  return (
    carried === isoDate || (carried.startsWith("XXXX") && carried.slice(4) === isoDate.slice(4))
  );
}

/** True when the URL carries any date, read or not. */
export function carriesDate(url: string): boolean {
  const { dates, unread } = urlDates(url, null);
  return dates.length > 0 || unread;
}

/**
 * Whether every night of a rule may share this link (D-073): not a link that carries one night's
 * date, and not a ticket seller's or event platform's page, which is one night's. A series page
 * ("/e/flow-fridays/") may be shared; The Ronda's `…-2026-10-02-…` page, an Eventbrite `/e/` page
 * or a Facebook event may not.
 */
export function isSeriesLink(url: string): boolean {
  return !carriesDate(url) && !isHostedEventPage(url);
}

// ---------------------------------------------------------------------------------------------
// A listing's own link on the page it was read from

export interface LinkQuery {
  title: string;
  /** The listing's night, or null for a listing from a rule ("every Tuesday"). */
  date: string | null;
}

export interface FoundLink {
  /** The listing's own page, or a ticket seller's page for it; null when none can be told. */
  url: string | null;
  /** "title-line": the link follows the title on its line; "labelled": a "Read more" in its block. */
  how: "title-line" | "labelled" | null;
  /**
   * "ticketing": a ticket seller's page for the event; "event_page": a page on the page's own site,
   * or an event platform's page for the event (Facebook, Meetup, Partiful), which sells nothing.
   */
  kind: "event_page" | "ticketing" | null;
  /** Why this link, or why none: for tests and the run report, never shown to a dancer. */
  why: string;
}

export interface FindLinksOptions {
  /** The page's language, for the month names a block's dates are read in. */
  lang?: string | null;
  /** The metro's numeric date order, for the dates a URL carries (`dateOrderFor`). */
  dateOrder?: DateOrder | null;
  /**
   * Titles of other items the page lists that get no link here (a listing the checks rejected):
   * each only ends the block of the listing before it, so that listing does not take its link.
   */
  bounds?: readonly string[];
}

interface PageLink {
  url: string;
  /** Index of "[" in the text. */
  at: number;
  /** Index just after "]". */
  end: number;
}

interface Occurrence {
  start: number;
  end: number;
}

/** Labels that name a link as the item's own, in English (v1): one list with D-080's blocks. */
const GENERIC = GENERIC_LINK_LABEL;

/** A whole label that is only a generic one ("Read more", "Tickets »"). */
const GENERIC_ONLY = new RegExp(`^\\s*${GENERIC.source}`, "i");

/** A heading that starts a day's block: "Friday, October 30". */
const DAY_HEADING =
  /\n(?:mon|tues|wednes|thurs|fri|satur|sun)day,?\s+[a-z]+\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?\s*(?=\n)/iy;

/** A word that dates or times a line: a weekday, a month, "tonight". */
const DATE_WORD =
  /(?<![\p{L}])(?:(?:mon|tues?|wed(?:nes)?|thu(?:rs?)?|fri|sat(?:ur)?|sun)(?:day)?s?|jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|today|tonight|tomorrow)\.?(?![\p{L}])/iu;

/** A time of day or a price on a line: "9pm", "21:00", "$15", "free". */
const TIME_OR_PRICE =
  /\d{1,2}(?::\d\d)?\s*(?:[ap]\.?m\.?)(?![\p{L}])|\d{1,2}[:h]\d\d|[$€£¥]|(?<![\p{L}])(?:free|noon|midnight)(?![\p{L}])/iu;

/** Leading bullets and dashes a list line starts with. */
const BULLET = /^[\s\-•·|*–—>]+/;

/**
 * Whether a line reads as another item's heading: one to six words, starting with a capital or a
 * digit, not a generic label, not a date or a time, no price, not a "Label: value" line, and not a
 * sentence. "Milonga" and "Jazz Quartet Concert" are; "Every Friday, 9pm.", "Read more" and
 * "Where: Studio B" are not. Such a line ends the block before it (review #7): a listing whose
 * block runs into another item's heading takes no generic link from past it.
 */
function isHeadingLine(line: string): boolean {
  const text = line.replace(BRACKETED_LINK, " ").replace(BULLET, "").replace(/\s+/g, " ").trim();
  if (text.length < 2 || text.length > 60) return false;
  if (text.split(" ").length > 6) return false;
  if (!/^[\p{Lu}\p{N}]/u.test(text)) return false;
  if (GENERIC_ONLY.test(text)) return false;
  if (/[.!?,;:]$/.test(text)) return false;
  if (/^[\d\s,.:/–-]+$/.test(text)) return false;
  if (DATE_WORD.test(text) || TIME_OR_PRICE.test(text)) return false;
  if (/^[^\s:]+(?:\s[^\s:]+)?:\s/.test(text)) return false;
  return !BLOCK_LINE_LEAD.test(text);
}

/** How a line inside one item's block starts: its DJ, its band, who hosts it ("DJ ANDRIUS"). */
const BLOCK_LINE_LEAD =
  /^(?:djs?|with|w\/|feat\.?|featuring|hosted|presented|taught|led|music|live|plus|and|&|by|doors|dress)(?![\p{L}])/iu;

/** A word matched in either case: "[wW][iI][tT][hH]". */
const anyCase = (word: string) =>
  word.replace(/\p{Ll}/gu, (c) => `[${c}${c.toUpperCase()}]`).replace(/\s+/g, "\\s+");

/**
 * A gap that names who or where the night is by, right before its link: "— hosted by Salsa Club
 * NYC", "@ Club Mango", "(with Maria)", "| Instructor: Maria Lopez". The link after it is that
 * person's, group's or place's page, not the night's (review #11).
 */
const ATTRIBUTION = (() => {
  const by = ["hosted", "presented", "organized", "organised", "taught", "led", "run"];
  const words = ["by", "with", "featuring", "feat", "at"];
  const people = ["instructor", "teacher", "host", "dj", "organizer", "organiser", "presenter"];
  const labels = [...people.map((w) => `${anyCase(w)}[sS]?`), "venue", "location", "where"];
  // A name: a capital, then words, "&" and hyphens, to the end of the gap.
  const name = String.raw`\p{Lu}[\p{L}\p{N}'’&\- ]*[)\]]?\s*$`;
  return new RegExp(
    String.raw`(?:^|[\s\p{P}])(?:(?:${by.map(anyCase).join("|")})\s+${anyCase("by")}|(?:${words.map(anyCase).join("|")})\.?|w/)\s+${name}` +
      String.raw`|@\s*${name}` +
      String.raw`|(?:^|[\s\p{P}])(?:${labels.map((w) => (w.includes("[") ? w : anyCase(w))).join("|")})\s*:\s*${name}`,
    "u",
  );
})();

/**
 * True when the link's path is named for the title: "…/urban-kiz-workshop-2026-10-10" for "Urban
 * Kiz Workshop". Such a link is that title's even past a line that reads as a heading (a venue
 * line) or a subtitle after a separator, as long as the path does not also name that line.
 */
function namedFor(url: string, title: string, other = ""): boolean {
  const parsed = parseHttpUrl(url);
  if (parsed === null) return false;
  let path = parsed.pathname;
  try {
    path = decodeURIComponent(path);
  } catch {
    // kept as written
  }
  const folded = foldAll(path);
  const needle = foldAll(title);
  const line = foldAll(other);
  if (needle.length < 8 || !folded.includes(needle)) return false;
  return line === "" || (!folded.includes(line) && !line.includes(needle));
}

const STARTS_WITH_DATE_WORD = new RegExp(`^${DATE_WORD.source}`, "iu");

/**
 * Whether the gap between a title and the link on its line holds, after an item separator, what
 * reads as another title: "9pm | Jazz Quartet Night", "· Milonga", "— Salsa Club" (review #7). A
 * date, a weekday or a generic label after the separator ("| Oct 1st-5th", "— Tickets") is not a
 * title. A link whose path is named for this title keeps it past a subtitle ("NYC ZOUK FESTIVAL
 * 2026 | Brazilian Zouk in the Heart of Manhattan | Oct 1st-5th, 2026"), unless the part right
 * before the link is title-like or a part holds this title again (another item named after it).
 */
function anotherTitleBefore(gap: string, url: string, title: string): boolean {
  const parts = gap
    .split(/\s*(?:[|·•]|(?:^|\s)[-–—](?=\s))\s*/u)
    .slice(1)
    .map((part) => part.trim());
  const titled = (text: string) =>
    /^\p{Lu}/u.test(text) && !GENERIC_ONLY.test(text) && !STARTS_WITH_DATE_WORD.test(text);
  const titles = parts.filter(titled);
  if (titles.length === 0) return false;
  const needle = foldAll(title);
  const rescued =
    namedFor(url, title) &&
    !titled(parts[parts.length - 1]!) &&
    titles.every((text) => !foldAll(text).includes(needle));
  return !rescued;
}

/** One character folded as titles are compared: letters and digits of any script, no marks. */
function foldChar(char: string): string {
  return char
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
}

function foldAll(text: string): string {
  return [...text].map(foldChar).join("");
}

/** The text, link targets blanked, folded to letters and digits, with a map back to its indices. */
function foldedIndex(text: string, links: PageLink[]): { folded: string; at: number[] } {
  const parts: string[] = [];
  const at: number[] = [];
  let next = 0;
  for (let i = 0; i < text.length;) {
    const link = links[next];
    if (link && i === link.at) {
      i = link.end;
      next++;
      continue;
    }
    const code = text.codePointAt(i)!;
    const char = String.fromCodePoint(code);
    // ASCII letters and digits fold to themselves, lowercased; the rest go through Unicode.
    if ((code >= 48 && code <= 57) || (code >= 97 && code <= 122)) {
      parts.push(char);
      at.push(i);
    } else if (code >= 65 && code <= 90) {
      parts.push(String.fromCodePoint(code + 32));
      at.push(i);
    } else if (code >= 128) {
      for (const c of foldChar(char)) {
        parts.push(c);
        at.push(i);
      }
    }
    i += char.length;
  }
  return { folded: parts.join(""), at };
}

/** True when a title has a letter outside the Latin script: the matcher's words are English. Styled
 * letters (math bold "𝗧", fullwidth "Ｔ") are read as the letters they stand for. */
function hasNonLatinLetter(title: string): boolean {
  for (const char of title.normalize("NFKC")) {
    if (/\p{L}/u.test(char) && !/\p{Script=Latin}/u.test(char)) return true;
  }
  return false;
}

/** A one-argument function that answers each argument once. */
function remember<T>(fn: (key: string) => T): (key: string) => T {
  const answers = new Map<string, T>();
  return (key) => {
    if (answers.has(key)) return answers.get(key)!;
    const answer = fn(key);
    answers.set(key, answer);
    return answer;
  };
}

/** The index of the first item whose key is at least `value` (items sorted by key). */
function lowerBound<T>(items: readonly T[], value: number, key: (item: T) => number): number {
  let lo = 0;
  let hi = items.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (key(items[mid]!) < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Where a title stands on the page, whole: letters and digits alike, with no letter or digit
 * (of any script) just before or after it. For a link, a one-word title under ten letters, or any
 * title under five, is not looked for: "Salsa" names a style or a menu item as often as an event.
 * For bounding its neighbours' blocks ("bound"), such a short title counts where it stands alone
 * on its own line ("Milonga", a heading), so the listing before it does not run on into its block.
 */
function occurrencesOf(
  text: string,
  index: { folded: string; at: number[] },
  title: string,
  mode: "link" | "bound",
): Occurrence[] {
  const needle = foldAll(title);
  if (!needle) return [];
  const words = foldForMatch(title).split(" ").filter(Boolean);
  const long = !(needle.length < 5 || (words.length < 2 && needle.length < 10));
  if (!long && mode === "link") return [];
  const out: Occurrence[] = [];
  for (let k = index.folded.indexOf(needle); k >= 0; k = index.folded.indexOf(needle, k + 1)) {
    const start = index.at[k]!;
    const end = index.at[k + needle.length - 1]! + 1;
    const before = text[start - 1] ?? " ";
    const after = text[end] ?? " ";
    if (/[\p{L}\p{N}]/u.test(before) || /[\p{L}\p{N}]/u.test(after)) continue;
    if (!long) {
      const lineStart = text.lastIndexOf("\n", start - 1) + 1;
      const lineEndAt = text.indexOf("\n", end);
      const lineEnd = lineEndAt < 0 ? text.length : lineEndAt;
      const lead = text.slice(lineStart, start).replace(BULLET, "");
      const rest = text.slice(end, lineEnd).replace(BRACKETED_LINK, " ");
      if (lead.trim() !== "" || !/^[\s:.!]*$/.test(rest)) continue;
    }
    out.push({ start, end });
  }
  return out;
}

/** The site a host belongs to: its registrable domain, a shared host's tenant kept apart. */
function siteOf(hostname: string): string | null {
  // "otherclub.wixsite.com" is not "nycdancedir.wixsite.com" (review #12).
  return getDomain(hostname, { allowPrivateDomains: true });
}

/**
 * Whether a found URL may be a listing's link: a ticket seller's or event platform's page for one
 * event, or a page on the page's own site (off-site pages are someone else's word, and a
 * directory's off-site links count only on a seller or platform, D-073); never the page itself,
 * and only a URL that can be one event's page (`looksLikeEventPage`: not a home page, a list, a
 * venue, tag or author page).
 */
function candidateProblem(url: string, pageUrl: string, site: string | null): string | null {
  const parsed = parseHttpUrl(url);
  if (parsed === null) return "not an http(s) link";
  if (!isHostedEventPage(url) && !(site && siteOf(parsed.hostname) === site)) {
    return "off-site and not a ticket seller's or event platform's page for one event";
  }
  if (sameLink(`${parsed.origin}${parsed.pathname}${parsed.search}`, pageUrl)) {
    return "the page itself";
  }
  if (!looksLikeEventPage(url)) return "not one event's page (a home, list, venue or tag page)";
  return null;
}

/**
 * Each listing's own link on the page it was read from (D-073), from the page text alone: one
 * link or none per listing, in the order of `queries`. Every listing read from the page is passed
 * together, so one listing's block ends where another's title starts; the titles of items that
 * get no link (`options.bounds`) end blocks too.
 *
 * Rule A (title line): the first link after the title on the title's own line, when the title
 * heads its line (after at most a three-word label such as "Class" or "Festival Oct 2") and what
 * lies between is a generic label ("Learn more", "Tickets") or short metadata (a time, a place, a
 * subtitle), never prose, words that continue the title, another title after a separator
 * ("| Jazz Quartet Night") or who or where it is by ("hosted by …", "@ …").
 * Rule B (labelled): a generic-labelled link in the lines after the title, inside its block (up to
 * the next listing's title, the next line that reads as another item's heading, the next day
 * heading, another item's own link, or 1,500 characters), and used nowhere else on the page.
 *
 * Then:
 *   - a link two titles pick is neither's (a shared "Buy tickets"), however it is spelled;
 *   - a rule's listing (no date) gets only a series link: none that carries a date, none on a
 *     ticket seller or event platform (one night's page), and none whose block writes a date;
 *   - a dated listing gets no link whose URL carries another date, unless its block writes the
 *     listing's date and never the URL's own; and none whose block writes a date and not the
 *     listing's (NYC Swings' "Flow Fridays" block says Oct 30, not Oct 2);
 *   - when several links remain, the one whose block writes the listing's date; else none;
 *   - a title with a letter outside the Latin script gets none: the labels and headings read
 *     here are English (v1), and no link beats a wrong one.
 */
export function findEventLinks(
  pageText: string,
  pageUrl: string,
  queries: readonly LinkQuery[],
  options: FindLinksOptions = {},
): FoundLink[] {
  const lang = options.lang ?? null;
  const order = options.dateOrder ?? null;
  const none = (why: string): FoundLink => ({ url: null, how: null, kind: null, why });
  // A page that repeats one item hundreds of times asks the same questions of the same strings:
  // each is answered once (review #15).
  const keyOf = remember((url: string) => linkKey(url) ?? url);
  const datesOf = remember((url: string) => urlDates(url, order));
  const seriesLink = remember(isSeriesLink);
  const anyDateIn = remember((text: string) => statesAnyDate(text, lang));
  const dateIn = remember((key: string) => {
    const [date, text] = [key.slice(0, key.indexOf(" ")), key.slice(key.indexOf(" ") + 1)];
    return statesDate(text, date, lang);
  });
  const spanIn = remember((key: string) => {
    const [date, text] = [key.slice(0, key.indexOf(" ")), key.slice(key.indexOf(" ") + 1)];
    return statesDateInSpan(text, date, lang);
  });

  const links: PageLink[] = [...pageText.matchAll(BRACKETED_LINK)].map((m) => ({
    url: m[1]!,
    at: m.index,
    end: m.index + m[0].length,
  }));
  const usesByKey = new Map<string, number[]>();
  for (const l of links) {
    const key = keyOf(l.url);
    const uses = usesByKey.get(key) ?? [];
    uses.push(l.at);
    usesByKey.set(key, uses);
  }
  const index = foldedIndex(pageText, links);
  const site = (() => {
    const parsed = parseHttpUrl(pageUrl);
    return parsed ? siteOf(parsed.hostname) : null;
  })();
  // A title in another script is still found, so its block bounds its neighbours'; it gets no
  // link of its own (below).
  const occ = queries.map((q) => occurrencesOf(pageText, index, q.title, "link"));
  const queried = new Set(queries.map((q) => foldAll(q.title)));
  const boundTitles = [
    ...queries.map((q) => q.title),
    ...(options.bounds ?? []).filter((title) => !queried.has(foldAll(title))),
  ];
  // Every place a title stands, the queries' (i >= 0) and the bound-only titles' (i < 0), by start.
  const allStarts = boundTitles
    .flatMap((title, k) =>
      occurrencesOf(pageText, index, title, "bound").map((o) => ({
        ...o,
        i: k < queries.length ? k : -1 - k,
      })),
    )
    .sort((a, b) => a.start - b.start);
  const longestTitle = allStarts.reduce((max, p) => Math.max(max, p.end - p.start), 0);
  const nextStart = (from: number): number => {
    const k = lowerBound(allStarts, from, (p) => p.start);
    return k < allStarts.length ? allStarts[k]!.start : pageText.length;
  };

  // Day headings and heading-like lines, found once: a block ends at the first of either.
  const dayHeadings: number[] = [];
  const headingLines: number[] = [];
  for (let at = 0; at <= pageText.length;) {
    const newline = pageText.indexOf("\n", at);
    const end = newline < 0 ? pageText.length : newline;
    if (at > 0) {
      DAY_HEADING.lastIndex = at - 1;
      if (DAY_HEADING.test(pageText)) dayHeadings.push(at - 1);
    }
    if (isHeadingLine(pageText.slice(at, end))) headingLines.push(at);
    if (newline < 0) break;
    at = newline + 1;
  }
  const firstAtOrAfter = (list: readonly number[], from: number): number => {
    const k = lowerBound(list, from, (n) => n);
    return k < list.length ? list[k]! : pageText.length;
  };
  const lineEndOf = (from: number): number => {
    const newline = pageText.indexOf("\n", from);
    return newline < 0 ? pageText.length : newline;
  };
  // A block ends at the next title, the next day heading, or 1,500 characters on; a line that
  // reads as another item's heading ends it too, except for a link named for this title that the
  // heading does not name (a venue line between "Urban Kiz Workshop" and its RSVP).
  const blockEnds = occ.map((list) =>
    list.map((o) =>
      Math.min(nextStart(o.end), o.end + 1500, firstAtOrAfter(dayHeadings, lineEndOf(o.end))),
    ),
  );
  /** Whether a link at `at` is inside block j of query i. */
  const inBlock = (i: number, j: number, at: number, url: string): boolean => {
    const o = occ[i]![j]!;
    if (at < o.start || at > blockEnds[i]![j]!) return false;
    const title = queries[i]!.title;
    for (
      let k = lowerBound(headingLines, lineEndOf(o.end) + 1, (n) => n);
      k < headingLines.length;
      k++
    ) {
      const heading = headingLines[k]!;
      if (heading >= at) break;
      if (!namedFor(url, title, pageText.slice(heading, lineEndOf(heading)))) return false;
    }
    return true;
  };
  const firstLinkFrom = (from: number) => lowerBound(links, from, (l) => l.at);
  /** The last link that ends at or before `at`, or undefined. */
  const linkBefore = (at: number): PageLink | undefined =>
    links[lowerBound(links, at + 1, (l) => l.end) - 1];

  // Whether every use of a link sits in one of this title's blocks, per title and link. Blocks do
  // not overlap and are sorted, so only the last block starting before a use can hold it.
  const ownMemo = new Map<string, boolean>();
  const ownedBy = (i: number, url: string): boolean => {
    const key = keyOf(url);
    const memo = ownMemo.get(`${i} ${key}`);
    if (memo !== undefined) return memo;
    const blocks = occ[i]!;
    const own = (usesByKey.get(key) ?? []).every((at) => {
      const j = lowerBound(blocks, at + 1, (o) => o.start) - 1;
      return j >= 0 && inBlock(i, j, at, url);
    });
    ownMemo.set(`${i} ${key}`, own);
    return own;
  };

  type Candidate = {
    url: string;
    how: "title-line" | "labelled";
    occ: Occurrence;
    context: string;
  };
  const candidates: Candidate[][] = queries.map(() => []);
  const rejected: string[][] = queries.map(() => []);

  queries.forEach((_query, i) => {
    occ[i]!.forEach((o, j) => {
      // A longer title that holds this one at this spot is that listing, not this one.
      const from = lowerBound(allStarts, o.start - longestTitle, (p) => p.start);
      for (let k = from; k < allStarts.length && allStarts[k]!.start <= o.start; k++) {
        const p = allStarts[k]!;
        if (p.i !== i && p.end >= o.end && p.end - p.start > o.end - o.start) return;
      }
      const nextOther = nextStart(o.end);

      // Rule A: the first link after the title on its line.
      const lineEnd = lineEndOf(o.end);
      const stop = Math.min(lineEnd, nextOther);
      const firstIndex = firstLinkFrom(o.end);
      const first = links[firstIndex] && links[firstIndex].at < stop ? links[firstIndex] : null;
      let picked: Candidate | null = null;
      const lineStart = pageText.lastIndexOf("\n", o.start - 1) + 1;
      const before = linkBefore(o.start);
      const previousOnLine = before && before.at >= lineStart ? before : undefined;
      const lead = pageText.slice(previousOnLine ? previousOnLine.end : lineStart, o.start).trim();
      // Our Philly's "time · place · venue" rows: "1pm · Rittenhouse · Rittenhouse Square"
      // Check if lead starts with a time like "1pm" followed by a middle dot
      const timeMatch = /^\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/i.exec(lead);
      const hasTime = timeMatch !== null;
      const hasDot = /[·•]/.test(lead);
      const dotted = hasTime && hasDot;
      let heads: boolean;
      if (dotted) {
        // For dotted rows, count words after the last middle dot as venue name
        const parts = lead.split(/[·•]/);
        const lastPart = parts[parts.length - 1]!.trim();
        const venueWords = lastPart.split(/\s+/).filter(Boolean).length;
        heads = venueWords <= 4;
      } else {
        heads = lead.split(/\s+/).filter(Boolean).length <= 3;
      }
      if (first && !heads) rejected[i]!.push(`title inside a longer line: "${lead.slice(-40)}"`);
      if (first && heads) {
        const gap = pageText.slice(o.end, first.at).trim();
        const sentence = /[.!?]\s+\p{Lu}/u.test(gap);
        const prose = /(?:^|\s)\p{Ll}+\s+\p{Ll}+\s+\p{Ll}+(?:\s|$)/u.test(gap);
        const continues = /^\p{L}/u.test(gap) && !GENERIC.test(gap);
        if (anotherTitleBefore(gap, first.url, queries[i]!.title)) {
          rejected[i]!.push(`another title before the link: "${gap.slice(0, 60)}"`);
        } else if (!GENERIC.test(gap) && ATTRIBUTION.test(gap)) {
          rejected[i]!.push(
            `the link after the title is who or where it is by: "${gap.slice(0, 60)}"`,
          );
        } else if (dotted) {
          // For Our Philly's "time · place · venue" rows: allow a short description after the title
          if (gap.length <= 100 && !sentence && !ATTRIBUTION.test(gap)) {
            picked = { url: first.url, how: "title-line", occ: o, context: "" };
          } else {
            rejected[i]!.push(`the link after the title follows prose: "${gap.slice(0, 60)}"`);
          }
        } else if ((gap.length <= 100 && !sentence && !prose && !continues) || GENERIC.test(gap)) {
          picked = { url: first.url, how: "title-line", occ: o, context: "" };
        } else {
          rejected[i]!.push(`the link after the title follows prose: "${gap.slice(0, 60)}"`);
        }
      }

      // Rule B: a generic-labelled link in the lines that follow, before another item's link.
      if (!picked) {
        const after = lineEnd;
        const blockEnd = blockEnds[i]![j]!;
        let previousEnd = after;
        for (let k = firstLinkFrom(after); k < links.length && links[k]!.at < blockEnd; k++) {
          const l = links[k]!;
          // Past a line that reads as another item's heading: that item's link, not this one's.
          if (!inBlock(i, j, l.at, l.url)) break;
          const labelStart = pageText.lastIndexOf("\n", l.at) + 1;
          const label = pageText.slice(Math.max(labelStart, previousEnd), l.at).trim();
          previousEnd = l.end;
          if (GENERIC.test(label) && label.length <= 40) {
            // One "Buy tickets" for every night is not this listing's: every use of the link
            // (however it is spelled) must sit in one of this title's blocks.
            if (ownedBy(i, l.url)) picked = { url: l.url, how: "labelled", occ: o, context: "" };
            else rejected[i]!.push(`${l.url}: a generic link also used outside this block`);
            break;
          }
          // Another item's own link (a title, or a date that is not a heading): the block ended.
          if (
            label.length > 0 &&
            !/^[\d\s,.:/–-]*$/.test(label) &&
            !/^(?:mon|tue|wed|thu|fri|sat|sun|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d/i.test(
              label,
            )
          ) {
            break;
          }
        }
      }
      if (!picked) return;
      const problem = candidateProblem(picked.url, pageUrl, site);
      if (problem) {
        rejected[i]!.push(`${picked.url}: ${problem}`);
        return;
      }
      // The block that dates the link: from the link before the title (another item's), at most
      // 300 characters back, to the next other link, the next title, or 400 characters on.
      const limit = Math.min(nextOther, o.end + 400);
      let contextEnd = Math.min(pageText.length, limit);
      for (let k = firstLinkFrom(o.end + 1); k < links.length && links[k]!.at < limit; k++) {
        if (links[k]!.url !== picked.url) {
          contextEnd = links[k]!.at;
          break;
        }
      }
      // Stop at the next day's heading (Our Philly)
      const titleLineEnd = lineEndOf(o.end);
      // Start scanning from the line after the title's line
      let pos = titleLineEnd < pageText.length ? titleLineEnd + 1 : pageText.length;
      while (pos < contextEnd) {
        const nextNewline = pageText.indexOf("\n", pos);
        const lineStart = pos;
        const lineEnd = nextNewline < 0 ? pageText.length : nextNewline;
        const line = pageText.slice(lineStart, lineEnd);
        // A date line that links this listing's own page is its date, not the next day's heading
        // (D-376, Marula Café's cards: "2 noviembre [its page]").
        const lineLinks = [...line.matchAll(BRACKETED_LINK)].map((m) => m[1]!);
        const ownDate = lineLinks.length > 0 && lineLinks.every((u) => sameLink(u, picked.url));
        if (!ownDate && isDateHeading(line, lang)) {
          contextEnd = lineStart;
          break;
        }
        if (nextNewline < 0) break;
        pos = nextNewline + 1;
      }
      const previous = linkBefore(o.start);
      picked.context = pageText.slice(
        Math.max(previous ? previous.end : 0, o.start - 300),
        contextEnd,
      );
      candidates[i]!.push(picked);
    });
  });

  // A link two different titles pick is neither's own page, however each spells it.
  const owners = new Map<string, Set<string>>();
  queries.forEach((q, i) => {
    for (const c of candidates[i]!) {
      const set = owners.get(keyOf(c.url)) ?? new Set<string>();
      set.add(foldAll(q.title));
      owners.set(keyOf(c.url), set);
    }
  });

  return queries.map((q, i) => {
    if (hasNonLatinLetter(q.title))
      return none("a title outside the Latin script (v1 reads English)");
    if (occ[i]!.length === 0) return none("title not on the page, or too short to look for");
    let list = candidates[i]!.filter((c) => (owners.get(keyOf(c.url))?.size ?? 0) === 1);
    if (list.length === 0) {
      const shared = candidates[i]!.length > 0;
      return none(
        shared
          ? "link shared with another title"
          : rejected[i]!.join("; ") || "no link beside the title",
      );
    }
    if (q.date === null) {
      // A rule's nights all share one link: a series page, never one night's.
      list = list.filter((c) => seriesLink(c.url) && !anyDateIn(c.context));
      if (list.length === 0) return none("a rule's listing, and every link is one night's");
    } else {
      const date = q.date;
      const said = (c: Candidate) =>
        dateIn(`${date} ${c.context}`) || spanIn(`${date} ${c.context}`);
      const carried = (c: Candidate) => datesOf(c.url);
      const contradicts = (c: Candidate) => {
        const { dates, unread } = carried(c);
        const urlSays = dates.some((d) => isDate(d, date));
        // The URL carries a date, and not this one (or one that cannot be read), and the block
        // does not write this one.
        if ((dates.length > 0 || unread) && !urlSays && !said(c)) return true;
        // The block also writes the URL's own date: the link is that night's, not this one's,
        // unless this night sits inside a span the block writes (review #10). The URL itself is
        // left out, since it would always write its own date.
        const prose = c.context.replace(BRACKETED_LINK, " ");
        const full = (d: string) => (d.startsWith("XXXX") ? `${date.slice(0, 4)}${d.slice(4)}` : d);
        if (
          !urlSays &&
          dates.some((d) => dateIn(`${full(d)} ${prose}`)) &&
          !spanIn(`${date} ${c.context}`)
        ) {
          return true;
        }
        // The block writes a date, and not this one (and the URL does not carry it).
        return !urlSays && !said(c) && anyDateIn(c.context);
      };
      list = list.filter((c) => !contradicts(c));
      if (new Set(list.map((c) => keyOf(c.url))).size > 1) {
        list = list.filter((c) => said(c) || carried(c).dates.some((d) => isDate(d, date)));
      }
      if (list.length === 0) return none("no link for this date");
    }
    const distinct = new Set(list.map((c) => keyOf(c.url)));
    if (distinct.size > 1) return none(`ambiguous: ${distinct.size} links`);
    const best = list.find((c) => c.how === "title-line") ?? list[0]!;
    return {
      url: best.url,
      how: best.how,
      kind: isTicketingEventPage(best.url) ? "ticketing" : "event_page",
      why: "ok",
    };
  });
}
