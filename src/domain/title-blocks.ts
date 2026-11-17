// The blocks a model read's times are checked against (D-081): every place the page writes a
// title, and the text from it to the next of the read's titles, a date heading that is not the
// title's own date line, the card's own link ("Learn More"), the next card's date-and-time line,
// or 1,500 characters. Wider than D-080's `dateBesideTitle` on purpose: it only keeps or drops
// times the read already gave, and a time printed a paragraph below its title must not be lost.
import {
  CLOCK,
  dateTimePart,
  datesOrNamesWeekday,
  foldForMatch,
  GENERIC_LINK_LABEL,
  isDateHeading,
  isDatesLabel,
} from "@/src/domain/text-facts";

/** Whether the next two lines with text from `at` are both date headings (D-821's labelled list). */
function datesFollow(pageText: string, at: number, lang: string | null | undefined): boolean {
  const next = pageText
    .slice(at, at + 400)
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 2);
  return next.length === 2 && next.every((l) => isDateHeading(l, lang));
}

export interface TitleBlock {
  start: number;
  titleEnd: number;
  end: number;
  text: string;
  /** The nearest date heading above the title (a line that is only a date), or null. */
  heading: string | null;
  /**
   * The words before the title on its own line, after the last link or card-link label there and
   * another title of the read, at most LEAD_WORDS of them: on a one-line list of cards, what stands
   * before the title is the previous card's.
   */
  lead: string;
  /** A longer title of the read holds the title here (the page writes this title inside another's). */
  held: boolean;
  /**
   * Lines directly above the title's line that hold only dates and times (at most 3), or the date
   * and time a line starts with before a separator and other words ("Thu Oct 1 · 8pm · Club X").
   */
  above: string;
  /**
   * The page prints each card's date and time above its title (`cardLayout`): `above` is this
   * card's own, and the block ends at the next card's. Otherwise a time above the title is the
   * listing's before, and `above` keeps only the dates.
   */
  card: boolean;
}

/** Most words the lead keeps: a category, a date or a time before the title, not a paragraph. */
export const LEAD_WORDS = 12;

const BLOCK_MAX = 1500;
/**
 * For facts (D-106): a part that a date heading or another title ends within this many characters
 * runs to it; a long write-up can print its ticket prices more than BLOCK_MAX below the title.
 */
const FACTS_BLOCK_MAX = 4000;

/** A card's link to buy or book, which a listing's facts may follow (`titleBlocks`' `facts`). */
const TICKET_LINK_LABEL =
  /(?:get tickets|buy tickets|tickets?|register(?: now| here)?|rsvp|book(?: now)?|sign up)\s*[→>»›:.!)]*\s*$/i;

/** A link target as cleanPageText writes it (`label [https://…]`), or a URL printed as text. */
const LINK = /\[https?:\/\/[^\]\s]*\]|https?:\/\/[^\s[\]<>"'()]+/g;

/** A line consisting only of dashes, underscores, equals signs, etc. (a rule). */
const RULE_LINE = /^[-–—_=*·•~\s]{3,}$/;

/** A line ending with a truncation marker: "[…]", "[...]", "…", or "...". */
const EXCERPT_END = /(?:\[\s*(?:…|\.\.\.)\s*\]|…|\.\.\.)$/;

/** A supporting act billed under a title: "+ Kota Dosa", "with The Hot 8", "feat. X". */
const SUPPORT_LINE = /^(?:\+\s|(?:with|w\/|feat\.?|ft\.?)\s)/i;

/** A bare weekday name (or abbreviation) optionally followed by a comma or period. */
const BARE_WEEKDAY =
  /^(?:mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun|monday|tuesday|wednesday|thursday|friday|saturday|sunday|lun|mie|jue|vie|sab|dom|lunes|martes|miercoles|jueves|viernes|sabado|domingo|seg|ter|qua|qui|sex|segunda|terca|quarta|quinta|sexta|dl|dt|dc|dj|dv|ds|dg)[.,]?$/i;

/** The first non-empty line ending before `at` (a line start), and where it starts. */
function nonEmptyLineAbove(pageText: string, at: number): { line: string; start: number } | null {
  while (at > 0) {
    const start = pageText.lastIndexOf("\n", at - 2) + 1;
    const line = pageText.slice(start, at - 1).trim();
    if (line) return { line, start };
    at = start;
  }
  return null;
}

/** Up to 3 date-and-time lines directly above a line (`dateTimePart`), and where the first starts. */
function linesAbove(
  pageText: string,
  lineStart: number,
  lang: string | null | undefined,
  grid?: boolean,
  otherStarts: ReadonlyArray<[number, number]> = [],
): { parts: string[]; from: number } {
  const parts: string[] = [];
  let from = lineStart;
  let at = lineStart;
  let skippedLabel = false;
  while (at > 0 && parts.length < 3) {
    const prevStart = pageText.lastIndexOf("\n", at - 2) + 1;
    const prevEnd = at - 1;
    const line = pageText.slice(prevStart, prevEnd).trim();
    at = prevStart;
    if (!line) continue;
    const part = dateTimePart(line, lang);
    if (part === null) {
      // In grid mode, we may skip one label line directly above the title's line
      if (grid && !skippedLabel && parts.length === 0) {
        // Check if line looks like a label: 1-3 words, no digits, not a date/time
        const words = line.split(/\s+/).filter(Boolean);
        if (words.length >= 1 && words.length <= 3 && !/\d/.test(line)) {
          // Skip this line and continue upwards
          skippedLabel = true;
          continue;
        }
      }
      // D-370 (Dio Club): a card reading date / time / place / title. Skip one place line when the
      // line above it is a clock line with a date on it, or a date heading ("- Vie, 30 Oct") above it.
      // Never another listing's title: that clock is the other listing's.
      if (
        !grid &&
        !skippedLabel &&
        parts.length === 0 &&
        line.split(/\s+/).length <= 10 &&
        !otherStarts.some(([s, e]) => s < prevEnd && e > prevStart)
      ) {
        const clock = nonEmptyLineAbove(pageText, at);
        const clockPart = clock && dateTimePart(clock.line, lang);
        const date = clock && nonEmptyLineAbove(pageText, clock.start);
        if (
          clockPart &&
          CLOCK.test(clockPart) &&
          (datesOrNamesWeekday(clockPart, lang) || (date && isDateHeading(date.line, lang)))
        ) {
          skippedLabel = true;
          continue;
        }
      }
      break;
    }
    parts.unshift(part);
    from = prevStart;
  }
  return { parts, from };
}

interface CompactIndex {
  /** The page's letters and digits, folded, with no spaces. */
  text: string;
  /** For each character of `text`, its offset in the page. */
  at: number[];
  wordStart: boolean[];
  wordEnd: boolean[];
}

// One read checks every listing against the same page: fold it once, and find each title once.
let lastPage: string | null = null;
let lastIndex: CompactIndex | null = null;
const lastOccurrences = new Map<string, Array<[number, number]>>();
const lastLayouts = new Map<string, boolean>();

/** Occurrences of a title in the page, folded, whole words (approximation of findPhrase). */
function occurrences(pageText: string, title: string): Array<[number, number]> {
  const want = foldForMatch(title);
  if (!want) return [];
  if (pageText !== lastPage || lastIndex === null) {
    lastPage = pageText;
    lastIndex = compactIndex(pageText);
    lastOccurrences.clear();
    lastLayouts.clear();
  }
  const known = lastOccurrences.get(want);
  if (known) return known;
  const { text: c, at: compact, wordStart, wordEnd } = lastIndex;
  const out: Array<[number, number]> = [];
  // Exact or respaced ("N oche De Descarga"), as phraseSpans finds a title: the folded letters
  // run together, starting at the start of a word and ending at the end of one.
  const needle = want.replace(/ /g, "");
  for (let k = c.indexOf(needle); k >= 0; k = c.indexOf(needle, k + 1)) {
    if (!wordStart[k] || !wordEnd[k + needle.length - 1]) continue;
    out.push([compact[k]!, compact[k + needle.length - 1]! + 1]);
  }
  lastOccurrences.set(want, out);
  return out;
}

function compactIndex(pageText: string): CompactIndex {
  // Build a folded copy with an index map back to the original.
  const map: number[] = [];
  let folded = "";
  let lastSpace = true;
  const stripped = pageText.replace(/\[https?:\/\/[^\]\s]*\]/g, (m) => " ".repeat(m.length));
  for (let i = 0; i < stripped.length; i++) {
    const ch = stripped[i]!.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
    if (/^[\p{L}\p{N}]+$/u.test(ch)) {
      for (const c of ch) {
        folded += c;
        map.push(i);
      }
      lastSpace = false;
    } else if (!lastSpace) {
      folded += " ";
      map.push(i);
      lastSpace = true;
    }
  }
  map.push(stripped.length);
  const compact: number[] = [];
  const wordStart: boolean[] = [];
  const wordEnd: boolean[] = [];
  let c = "";
  for (let i = 0; i < folded.length; i++) {
    if (folded[i] === " ") continue;
    c += folded[i];
    compact.push(map[i]!);
    wordStart.push(i === 0 || folded[i - 1] === " ");
    wordEnd.push(i === folded.length - 1 || folded[i + 1] === " ");
  }
  return { text: c, at: compact, wordStart, wordEnd };
}

const lineStartOf = (pageText: string, at: number) => pageText.lastIndexOf("\n", at - 1) + 1;

/** Whether the page writes [start, end) as a line of its own. */
function wholeLine(pageText: string, start: number, end: number): boolean {
  const lineEnd = pageText.indexOf("\n", end);
  return (
    pageText.slice(lineStartOf(pageText, start), start).trim() === "" &&
    pageText.slice(end, lineEnd < 0 ? pageText.length : lineEnd).trim() === ""
  );
}

/**
 * How the places the page writes the read's titles vote on its layout: a clock time on a
 * date-and-time line directly above a title and none beside or under it is a card's ("Thu, Oct 1,
 * 8:00 PM EDT\nSalsa Night\nClub X"), +1; one beside or under it and none above is the title
 * written first ("Salsa Night\n9pm-2am"), -1. Above zero, the page prints its cards' dates and
 * times above their titles; below zero, under them; zero is a tie (`cardLayout` breaks it).
 */
export function cardLayoutVotes(
  pageText: string,
  titles: readonly string[],
  lang?: string | null,
): number {
  let votes = 0;
  for (const title of titles) {
    for (const [start, titleEnd] of occurrences(pageText, title)) {
      const above = clockAbove(pageText, start, lang);
      const beside =
        CLOCK.test(restOfLine(pageText, titleEnd).replace(LINK, " ")) ||
        CLOCK.test(lineUnder(pageText, titleEnd).replace(LINK, " "));
      if (above && !beside) votes += 1;
      if (beside && !above) votes -= 1;
    }
  }
  return votes;
}

const clockAbove = (pageText: string, start: number, lang: string | null | undefined) =>
  linesAbove(pageText, lineStartOf(pageText, start), lang, undefined).parts.some((p) =>
    CLOCK.test(p),
  );
const restOfLine = (pageText: string, titleEnd: number) => {
  const lineEnd = pageText.indexOf("\n", titleEnd);
  return pageText.slice(titleEnd, lineEnd < 0 ? pageText.length : lineEnd);
};
/** The first line with words under a title's line. */
const lineUnder = (pageText: string, titleEnd: number) => {
  const lineEnd = pageText.indexOf("\n", titleEnd);
  const from = lineEnd < 0 ? pageText.length : lineEnd;
  return /^\s*(.*)/.exec(pageText.slice(from, from + 1000))![1]!;
};

/**
 * Whether the page prints its cards' dates and times above their titles (`cardLayoutVotes`). On a
 * tie (Brooklyn Contra prints the time both above and under; a summary that writes each title
 * first ties when the read skips the page's first item), the page's items the read does not list
 * decide (`skippedItemVotes`), and failing that the first place decides by the time above it: a
 * page that writes the title first has none above its first title. Never the read's own nights: a
 * read shifted by one card would vote for the layout that confirms its shifted times (review of
 * the seam fixes, 2026-09-29).
 */
function cardLayout(pageText: string, titles: readonly string[], lang?: string | null): boolean {
  const key = `${lang ?? ""}\u0000${[...new Set(titles.map(foldForMatch))].sort().join("\u0001")}`;
  const known = lastLayouts.get(key);
  if (known !== undefined) return known;
  const votes = cardLayoutVotes(pageText, titles, lang);
  let card = votes > 0;
  if (votes === 0) {
    const skipped = skippedItemVotes(pageText, titles, lang);
    if (skipped !== 0) card = skipped > 0;
    else {
      let first: number | null = null;
      for (const title of titles)
        for (const [start] of occurrences(pageText, title))
          if (first === null || start < first) first = start;
      card = first !== null && clockAbove(pageText, first, lang);
    }
  }
  lastLayouts.set(key, card);
  return card;
}

/**
 * A tied layout's votes from the page's own items that the read does not list: each line that is
 * one link's label and nothing else ("Jazz Brunch Concert (seated) [https://…]"), not a read
 * title, not a date and not a card's generic link ("Read more"), votes as a read title's place
 * does in `cardLayoutVotes`.
 */
function skippedItemVotes(
  pageText: string,
  titles: readonly string[],
  lang: string | null | undefined,
): number {
  const read = new Set(titles.map(foldForMatch));
  let votes = 0;
  for (let start = 0; start < pageText.length;) {
    const nl = pageText.indexOf("\n", start);
    const end = nl < 0 ? pageText.length : nl;
    const label = /^\s*(.*?\p{L}.*?)\s*\[https?:\/\/[^\]\s]*\]\s*$/u.exec(
      pageText.slice(start, end),
    )?.[1];
    if (
      label !== undefined &&
      !read.has(foldForMatch(label)) &&
      !GENERIC_LINK_LABEL.test(label) &&
      dateTimePart(label, lang) === null &&
      !isDateHeading(label, lang)
    ) {
      const above = clockAbove(pageText, start, lang);
      const beside = CLOCK.test(lineUnder(pageText, end).replace(LINK, " "));
      if (above && !beside) votes += 1;
      if (beside && !above) votes -= 1;
    }
    start = end + 1;
  }
  return votes;
}

/**
 * The short plain line right under a listing's title in its own block (Tipitina's "2000's Hip-Hop &
 * R&B Dance Party Featuring DJ New Era"), or null (D-344).
 */
export function subtitleLine(
  pageText: string,
  block: TitleBlock,
  otherTitles: readonly string[],
  lang: string | null | undefined,
): string | null {
  // The title's own line after the title must be empty after removing links.
  const titleLineEnd = pageText.indexOf("\n", block.titleEnd);
  const afterTitle = pageText.slice(
    block.titleEnd,
    titleLineEnd < 0 ? pageText.length : titleLineEnd,
  );
  const linkRemoved = afterTitle.replace(LINK, " ").trim();
  if (linkRemoved !== "") return null;

  // Walk lines after the title's line, up to block.end.
  let lineStart = titleLineEnd < 0 ? pageText.length : titleLineEnd + 1;
  while (lineStart < block.end) {
    const lineEnd = pageText.indexOf("\n", lineStart);
    const lineStop = lineEnd < 0 ? pageText.length : lineEnd;
    const line = pageText.slice(lineStart, lineStop).trim();
    lineStart = lineStop + 1;
    if (line === "") continue; // skip blank lines
    // First non-blank line is the candidate.
    // Reject rule lines, clocks, links, date headings, too long, too many words, or matches another title.
    if (RULE_LINE.test(line)) return null;
    if (CLOCK.test(line)) return null;
    if (new RegExp(LINK.source).test(line)) return null;
    if (isDateHeading(line, lang)) return null;
    if (line.length > 120) return null;
    const words = line.split(/\s+/).filter(Boolean);
    if (words.length > 15) return null;
    const foldedLine = foldForMatch(line);
    for (const other of otherTitles) {
      if (foldForMatch(other) === foldedLine) return null;
    }
    // Candidate passes all filters.
    return line;
  }
  return null;
}

export function titleBlocks(
  pageText: string,
  title: string,
  others: readonly string[],
  lang?: string | null,
  /** The layout to read the page by, when the caller checks both (`untimedForUnwrittenTimes`). */
  layout?: boolean,
  /**
   * Blocks for a listing's facts other than its times (D-100): a ticket link ("Tickets", "Get
   * Tickets", "Register", "RSVP") does not end them, since a page often writes its prices after
   * one. A "Learn More" or "Details" link still does.
   */
  options: { facts?: boolean; grid?: boolean } = {},
): TitleBlock[] {
  const mine = occurrences(pageText, title);
  const ownFold = foldForMatch(title);
  const otherStarts = others
    .filter((o) => foldForMatch(o) !== ownFold)
    .flatMap((o) => occurrences(pageText, o))
    .sort((a, b) => a[0] - b[0]);
  const card =
    mine.length > 0 && (layout ?? options.grid ?? cardLayout(pageText, [title, ...others], lang));
  // Whether another title of the read is written somewhere on a line of its own.
  const alone = new Map<number, boolean>();
  const standsAlone = (s: number, e: number) => {
    const key = s * 1e7 + e;
    let found = alone.get(key);
    if (found === undefined) {
      const want = foldForMatch(pageText.slice(s, e));
      found = others.some(
        (o) =>
          foldForMatch(o) === want &&
          occurrences(pageText, o).some(([a, b]) => wholeLine(pageText, a, b)),
      );
      alone.set(key, found);
    }
    return found;
  };
  const blocks: TitleBlock[] = [];
  const held = ([start, titleEnd]: [number, number]) =>
    otherStarts.some(([s, e]) => s <= start && e >= titleEnd && e - s > titleEnd - start);
  // A longer title of the read that holds this one here is that listing, not this one; unless
  // every place the page writes this title is inside a longer one (a read that lists one event
  // twice, "Class West Coast Swing with ..." and "West Coast Swing with ...").
  for (const [start, titleEnd] of mine) {
    const lineStart = lineStartOf(pageText, start);
    const heading = headingAbove(pageText, lineStart, lang);
    const lead = leadOf(pageText, lineStart, start, otherStarts);
    const aboveParts = linesAbove(pageText, lineStart, lang, options.grid, otherStarts).parts;
    // For facts, where the title stands on a line of its own, another title written inside a
    // sentence ("via NYLX Packages") does not end the part, as long as the page also writes that
    // title on a line of its own (D-106).
    const ownLine = options.facts === true && wholeLine(pageText, start, titleEnd);
    const ends = ownLine
      ? otherStarts.filter(([s, e]) => wholeLine(pageText, s, e) || !standsAlone(s, e))
      : otherStarts;
    let end = Math.min(pageText.length, start + (ownLine ? FACTS_BLOCK_MAX : BLOCK_MAX));
    let next: number | null = null;
    for (const [s] of ends) {
      if (s >= titleEnd && s < end) {
        end = s;
        next = s;
        break;
      }
    }
    // Date headings after the title's line end it, except the title's own date line directly under it.
    const lineEnd = pageText.indexOf("\n", titleEnd);
    let at = lineEnd < 0 ? pageText.length : lineEnd + 1;
    let firstLine = true;
    let prevWasDateHeading = false;
    // Plain lines (no clock, date or link) under the title before a rule (Tipitina's subtitle):
    let plainLines = 0;
    let onlyPlain = true;
    let labelRun: boolean = false;
    while (at < end) {
      const nl = pageText.indexOf("\n", at);
      const lineStop = nl < 0 ? pageText.length : nl;
      const line = pageText.slice(at, lineStop).trim();
      if (line) {
        // A rule line neither ends the block nor counts as its first line.
        if (RULE_LINE.test(line)) {
          // Up to two plain subtitle lines directly under the title, then a rule:
          // the date after the rule is the title's own.
          if (onlyPlain && (plainLines === 1 || plainLines === 2)) {
            firstLine = true;
            prevWasDateHeading = false;
          }
          at = lineStop + 1;
          continue;
        }
        // A bare weekday ("Thu" over "Oct 29, 2026") or a supporting act ("+ Kota Dosa") under the
        // title leaves the date line after it the title's own (Tipitina's).
        if (BARE_WEEKDAY.test(foldForMatch(line)) || SUPPORT_LINE.test(line)) {
          at = lineStop + 1;
          continue;
        }
        // A truncation marker ("[…]", "[...]", "…", "...") directly under the title does not count
        // as the first line, so the card's own date line after it is not cut off (London Milongas).
        if (
          firstLine &&
          EXCERPT_END.test(line) &&
          !CLOCK.test(line) &&
          !isDateHeading(line, lang)
        ) {
          at = lineStop + 1;
          continue;
        }
        const isDateHead = isDateHeading(line, lang);
        // A label line over two or more date lines ("DATES" over El Fenn's Sundays) lists the
        // listing's own dates: they do not end the part, so the "TIME" under them is its own (D-821).
        const inRun: boolean = labelRun && isDateHead;
        labelRun = inRun || (isDatesLabel(line) && datesFollow(pageText, lineStop + 1, lang));
        if (isDateHead && !inRun) {
          // "Oct 29, 2026" then "– Oct 30, 2026": the second line ends the first's range, not the
          // part (DanceUS cards, D-276).
          if (!firstLine && !(prevWasDateHeading && /^[\u2013\u2014-]\s*/.test(line))) {
            end = at;
            break;
          }
        }
        // A card layout: the next card's date and time ends this card, whether or not the read
        // lists that card ("Fri, Oct 2, 9:00 PM EDT" over Tango Night).
        const part = card ? dateTimePart(line, lang) : null;
        if (part !== null && CLOCK.test(part) && datesOrNamesWeekday(part, lang)) {
          end = at;
          break;
        }
        // A plain line counts toward a subtitle above a rule.
        const hasClock = CLOCK.test(line);
        const hasLink = line.search(LINK) >= 0;
        const isPlain = !hasClock && !isDateHead && !hasLink;
        if (isPlain) {
          plainLines++;
        } else {
          onlyPlain = false;
        }
        firstLine = false;
        prevWasDateHeading = isDateHead;
      }
      at = lineStop + 1;
    }
    // Nothing ended a long facts part: back to BLOCK_MAX, as for any other part.
    if (ownLine && next === null && end === Math.min(pageText.length, start + FACTS_BLOCK_MAX)) {
      end = Math.min(pageText.length, start + BLOCK_MAX);
    }
    // A card layout: the next title's own date-and-time lines above it are that card's.
    if (card && next !== null && next <= end) {
      const nextLine = lineStartOf(pageText, next);
      if (nextLine > titleEnd) {
        const { from } = linesAbove(pageText, nextLine, lang, options.grid);
        if (from > titleEnd) end = Math.min(end, from);
      }
    }
    // The card's own link ends it: a link labelled "Learn More", "Tickets" and the like, the
    // label read back to the title, the link before it or the start of its line.
    let linkEnd = titleEnd;
    // For facts, a ticket link the part reads past (D-100); it still ends the part when a card's
    // link or a card's date-and-time line follows it, which would be the next card's.
    let ticketAt: number | null = null;
    for (const m of pageText.slice(titleEnd, end).matchAll(LINK)) {
      const i = titleEnd + m.index;
      const label = pageText.slice(Math.max(linkEnd, lineStartOf(pageText, i)), i);
      if (GENERIC_LINK_LABEL.test(label)) {
        if (options.facts && ticketAt === null && TICKET_LINK_LABEL.test(label)) {
          ticketAt = i;
        } else {
          end = ticketAt ?? i;
          ticketAt = null;
          break;
        }
      }
      linkEnd = i + m[0].length;
    }
    if (ticketAt !== null) {
      const rest = pageText.slice(ticketAt, end).split("\n").slice(1);
      const nextCard = rest.some((line) => {
        const part = dateTimePart(line.trim(), lang);
        return part !== null && CLOCK.test(part) && datesOrNamesWeekday(part, lang);
      });
      if (nextCard) end = ticketAt;
    }
    blocks.push({
      // A time above the title is the card's own only in a card layout; where the page writes
      // the title first, it is the listing's before ("Salsa Night\n9pm-2am\nBachata Night").
      above: aboveParts.filter((part) => card || !CLOCK.test(part)).join("\n"),
      start,
      titleEnd,
      end,
      text: pageText.slice(start, end),
      heading,
      lead,
      held: held([start, titleEnd]),
      card,
    });
  }
  return blocks;
}

/** The nearest date heading within 40 lines above a line, or null. */
function headingAbove(
  pageText: string,
  lineStart: number,
  lang: string | null | undefined,
): string | null {
  const above = pageText.slice(0, lineStart).split("\n");
  for (let i = above.length - 1, n = 0; i >= 0 && n < 40; i--) {
    const l = above[i]!.trim();
    if (!l) continue;
    n++;
    if (isDateHeading(l, lang)) return l;
  }
  return null;
}

/**
 * The rest of the title's line before it: back to another title of the read on that line, the
 * last link, or the last card-link label ("Learn More" whose link was lost), and at most
 * LEAD_WORDS words. On NYC Swings' one-line list that is the card's category ("Social Dance"), not
 * the cards before it.
 */
function leadOf(
  pageText: string,
  lineStart: number,
  start: number,
  otherStarts: ReadonlyArray<[number, number]>,
): string {
  let from = lineStart;
  for (const [, e] of otherStarts) if (e <= start && e > from) from = e;
  let lead = pageText.slice(from, start);
  let cut = 0;
  for (const m of lead.matchAll(LINK)) cut = m.index + m[0].length;
  const words = lead.slice(cut).split(/\s+/).filter(Boolean).slice(-LEAD_WORDS);
  lead = words.join(" ");
  let label = 0;
  for (const m of lead.matchAll(/\S+/g)) {
    const after = m.index + m[0].length;
    if (GENERIC_LINK_LABEL.test(lead.slice(0, after))) label = after;
  }
  return lead.slice(label).trim();
}
