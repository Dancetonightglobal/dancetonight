// Weekly grid rule extraction (D-402)
// For venue pages that list nights under weekday headings without dates.

import {
  foldWords,
  type FoldedPage,
  weeklyHeadingDays,
  phraseSpans,
  weekdaysNamed,
  foldPage,
} from "@/src/domain/text-facts";
import { parseRecurrenceText } from "@/src/domain/recurrence";

/** Languages a table row's weekday cell is tried in when the reported one names no weekday. */
const ROW_FALLBACK_LANGS = ["tr", "es", "pt", "ca", "fr", "de", "it", "nl"] as const;

const FILLER_WORDS = new Set([
  "y",
  "e",
  "and",
  "a",
  "to",
  "hs",
  "h",
  "hrs",
  "am",
  "pm",
  "de",
  "la",
  "el",
  "los",
  "las",
  "del",
  "al",
  "ve",
]);

/**
 * Returns the set of weekday codes (BYDAY) if the text consists only of weekday words,
 * filler words, and numbers, and every non-filler, non-number word yields exactly one weekday.
 * Returns null otherwise.
 */
function weekdayOnlyDays(text: string, lang: string | null | undefined): Set<string> | null {
  // Remove clock times
  const withoutTime = text.replace(/\d{1,2}([:.]\d{2})?\s*(?:hs|h|hrs|am|pm)?\b/gi, "").trim();
  // Replace non-letter/digit/space characters with space
  const cleaned = withoutTime.replace(/[^\p{L}\p{N}\s]/gu, " ").trim();
  if (!cleaned) return null;
  // Split and filter out filler words and pure numbers
  const words = cleaned.split(/\s+/).filter((word) => {
    const lower = word.toLowerCase();
    return !FILLER_WORDS.has(lower) && !/^\d+$/.test(word);
  });
  if (words.length === 0) return null;
  const days = new Set<string>();
  for (const word of words) {
    // Try with original word and folded word
    let wDays = weekdaysNamed(word, lang);
    if (wDays.size === 0) {
      wDays = weekdaysNamed(foldWords(word), lang);
    }
    if (wDays.size !== 1) {
      return null;
    }
    wDays.forEach((d) => days.add(d));
  }
  return days;
}

/**
 * Extract a weekly recurrence from a table row where the first cell is a weekday.
 * For pages that list nights in a table with columns separated by "|".
 */
export function weeklyGridRowRule(
  pageText: string,
  title: string,
  lang: string | null | undefined,
): WeeklyGridRule | null {
  const foldedTitle = foldWords(title);
  if (!foldedTitle) return null;

  const lines = pageText.split("\n");
  const days = new Set<string>();
  const weekdayCells: string[] = [];

  for (const line of lines) {
    if (!line.includes("|")) continue;

    const cells = line.split("|").map((cell) => cell.trim());
    if (cells.length < 2) continue;

    // Find first non-empty cell
    let weekdayIdx = -1;
    for (let i = 0; i < cells.length; i++) {
      if (cells[i] !== "") {
        weekdayIdx = i;
        break;
      }
    }
    if (weekdayIdx === -1) continue;
    const weekdayCell = cells[weekdayIdx]!;
    if (!weekdayCell) continue;

    // Clean weekday cell: remove non-letter/digit/space characters
    const cleaned = weekdayCell.replace(/[^\p{L}\p{N}\s]/gu, " ").trim();
    if (!cleaned) continue;

    // The model may report the language of the URL (/en/) for a page whose grid is written in another, so a
    // first cell that is no weekday in the reported language is tried in the metros' languages (cells must be
    // weekday words only, so this stays strict).
    let rowDays = weekdayOnlyDays(cleaned, lang);
    for (const other of ROW_FALLBACK_LANGS) {
      if (rowDays !== null) break;
      rowDays = weekdayOnlyDays(cleaned, other);
    }
    if (rowDays === null || rowDays.size === 0) continue;

    // Check if title appears in a cell after the weekday cell
    let titleFound = false;
    for (let i = weekdayIdx + 1; i < cells.length; i++) {
      if (foldWords(cells[i]!).includes(foldedTitle)) {
        titleFound = true;
        break;
      }
    }
    if (!titleFound) continue;

    // Add days and remember weekday cell text
    rowDays.forEach((d) => days.add(d));
    if (!weekdayCells.includes(weekdayCell)) {
      weekdayCells.push(weekdayCell);
    }
  }

  if (days.size === 0) return null;

  return {
    rrule: `FREQ=WEEKLY;BYDAY=${[...days].sort(byDayOrder).join(",")}`,
    written: weekdayCells.join(", "),
  };
}

export interface WeeklyGridRule {
  rrule: string;
  written: string;
  /** The text of the weekday's section (lines after the heading up to next heading), if the rule came from a heading line. */
  section?: string;
  /** The start of the slot line above every cell the rule came from ("HH:MM"), for a listing read with no start (D-598). */
  slotTime?: string;
  /** The trimmed text of the slot line (e.g., "6:30pm-7:30pm") that gave slotTime. */
  slotLine?: string;
}

/** Helper to strip trailing link marker */
function stripLink(text: string): string {
  return text.replace(/\s*\[https?:\/\/[^\]\s]*\]\s*$/, "").trim();
}

/**
 * Extract a weekly recurrence from lines like "<Day>: <Night name>" or "<Day> - <Night name>".
 * For pages that list weekly nights as one line per night.
 */
export function weeklyGridDayPrefixRule(
  pageText: string,
  title: string,
  lang: string | null | undefined,
): WeeklyGridRule | null {
  const foldedTitle = foldWords(title);
  if (!foldedTitle) return null;

  const lines = pageText.split("\n");
  const days = new Set<string>();
  const prefixes: string[] = [];
  let dailyPrefix: string | null = null;

  for (const line of lines) {
    // Strip trailing link marker
    const stripped = stripLink(line);
    // Remove leading/trailing non-letter/digit characters
    const cleaned = stripped.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "").trim();
    if (!cleaned) continue;

    // First separator: a colon after a letter (not a clock's "11:00"), or a dash with spaces around it
    const sep = cleaned.match(/(?<=\p{L})\s*:\s*|\s+[-\u2013\u2014]\s+/u);
    if (!sep || sep.index === undefined) continue;
    const prefix = cleaned.slice(0, sep.index).trim();
    const rest = cleaned.slice(sep.index + sep[0].length).trim();

    // The rest must contain the title as whole words ("Jam" is not in "Pajama Party")
    if (!(" " + foldWords(rest) + " ").includes(" " + foldedTitle + " ")) continue;

    // Determine days from prefix
    let prefixDays: Set<string> | null = weekdayOnlyDays(prefix, lang);
    if (prefixDays === null) {
      for (const other of ROW_FALLBACK_LANGS) {
        prefixDays = weekdayOnlyDays(prefix, other);
        if (prefixDays !== null) break;
      }
    }

    // Check for daily words
    const foldedPrefix = foldWords(prefix);
    const dailyWords = new Set(["nightly", "every night", "daily", "every day", "everyday"]);
    if (dailyWords.has(foldedPrefix)) {
      dailyPrefix ??= prefix;
      continue;
    }

    if (prefixDays && prefixDays.size > 0) {
      prefixDays.forEach((d) => days.add(d));
      if (!prefixes.includes(prefix)) {
        prefixes.push(prefix);
      }
    }
  }

  // A weekday line is more specific than a daily one: when the page gives both, the weekdays win.
  if (days.size === 0 && dailyPrefix !== null) return { rrule: "FREQ=DAILY", written: dailyPrefix };

  if (days.size === 0) return null;

  return {
    rrule: `FREQ=WEEKLY;BYDAY=${[...days].sort(byDayOrder).join(",")}`,
    written: prefixes.join(", "),
  };
}

/**
 * Derives a weekly recurrence from a page that is a weekly grid (no dates).
 * Tries six strategies in order:
 * 0. The weekday is the first cell of the listing's own table row (TangoDANS, D-402).
 * 1. The weekday is a prefix on the same line as the title ("<Day>: <Night name>").
 * 2. The model's phrase is a heading line.
 * 3. The heading line(s) directly above the title.
 * 4. A sentence after the title that lists weekdays.
 * 5. An "Open:" line, on a venue's own page only (Grupo Mandala clubs).
 * 6. Title contains "nightly" or "every night" as whole words.
 * Returns null if no weekdays can be found.
 *
 * @param startTime The listing's own start time in "HH:MM" format. If provided, only spans
 *                  whose time-slot line matches this time will contribute to the rule.
 * @param venuePage The source is the venue's own page (strategy 5 runs only then).
 */
export function weeklyGridRule(
  page: FoldedPage,
  pageText: string,
  title: string,
  givenPhrase: string | null,
  lang: string | null | undefined,
  startTime?: string | null,
  venuePage = false,
): WeeklyGridRule | null {
  // 0. The weekday is the first cell of the listing's own table row (TangoDANS, D-402)
  const rowRule = weeklyGridRowRule(pageText, title, lang);
  if (rowRule !== null) {
    return rowRule;
  }

  // 1. The weekday is a prefix on the same line as the title
  const prefixRule = weeklyGridDayPrefixRule(pageText, title, lang);
  if (prefixRule !== null) {
    return prefixRule;
  }

  // 2. The model's phrase is a heading line
  if (givenPhrase !== null) {
    const foldedPhrase = foldWords(givenPhrase);
    for (let L = 0; L < page.lines.length; L++) {
      const [first, after] = page.lines[L]!;
      const lineWords = page.words.slice(first, after).join(" ");
      if (lineWords === foldedPhrase) {
        const days = weeklyHeadingDays(page, L, lang);
        if (days && days.length > 0) {
          const section = weeklyGridSection(pageText, givenPhrase, lang);
          return {
            rrule: `FREQ=WEEKLY;BYDAY=${days.join(",")}`,
            written: givenPhrase,
            section: section ?? undefined,
          };
        }
      }
    }
  }

  // 3. Heading above the title
  const spans = phraseSpans(page, title);
  const headingDays = new Set<string>();
  const headingTexts: string[] = [];
  let monthlyRule: WeeklyGridRule | null = null;

  // Helper to parse a time-slot line
  const parseSlotTime = (line: string): string | null => {
    const trimmed = line.trim();
    // Match clock patterns: 8pm-9pm, 8 pm - 9 pm, 3:30pm-4:30pm, 20:00-21:00, 20:00, 8.30pm
    // Also handle 12pm, 12am, etc.
    // A line is a time-slot line ONLY when its first clock has minutes (":" or "." then 2 digits) OR an am/pm marker.
    // The first number is not followed directly by another digit (to exclude "2026").
    const timeMatch = trimmed.match(
      /^(\d{1,2})(?:[:.](\d{2}))?\s*(?:am|pm|a\.m\.|p\.m\.)(?:\s*[-–—]\s*(\d{1,2})(?:[:.](\d{2}))?\s*(?:am|pm|a\.m\.|p\.m\.)?)?/i,
    );
    if (!timeMatch) {
      // Also match 24-hour format with minutes: 20:00, 20.00, 20:30-21:30
      const twentyFourMatch = trimmed.match(
        /^(\d{1,2})(?:[:.](\d{2}))(?:\s*[-–—]\s*(\d{1,2})(?:[:.](\d{2}))?)?$/,
      );
      if (!twentyFourMatch) return null;
      const hours = twentyFourMatch[1];
      const minutes = twentyFourMatch[2] || "00";
      const h = Number(hours);
      const m = Number(minutes);
      if (h > 23 || m > 59) return null;
      return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    }
    const hours = timeMatch[1];
    const minutes = timeMatch[2] || "00";
    const marker = (timeMatch[0].toLowerCase().match(/(am|pm|a\.m\.|p\.m\.)/) || [])[0];
    // Convert to 24-hour
    let h = Number(hours);
    const m = Number(minutes);
    if (marker) {
      const isPm = marker.includes("pm") || marker.includes("p.m.");
      if (isPm && h < 12) h += 12;
      else if (!isPm && h === 12) h = 0;
    }
    if (h > 23 || m > 59) return null;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  };

  // Determine which spans are cells
  const spanIsCell: boolean[] = [];
  for (const [start] of spans) {
    const lineIdx = page.lineOf[start]!;
    const lineText = page.texts[lineIdx]!;
    const stripped = stripLink(lineText);
    const foldedStripped = foldWords(stripped);
    const foldedTitle = foldWords(title);
    spanIsCell.push(foldedStripped === foldedTitle);
  }

  const hasCell = spanIsCell.some(Boolean);
  const filteredSpans = hasCell ? spans.filter((_, idx) => spanIsCell[idx]) : spans;

  // For each span, collect its slot time (if any) and heading days
  const spanData: Array<{
    slotTime: string | null;
    headingDays: string[];
    headingText: string;
    slotLine: string | null;
  }> = [];
  for (const [start] of filteredSpans) {
    const lineIdx = page.lineOf[start]!;
    let slotTime: string | null = null;
    let slotLine: string | null = null;
    let headingDaysForSpan: string[] = [];
    let headingTextForSpan = "";
    // Search up to 40 lines above in page.lines
    for (let up = 1; up <= 40; up++) {
      const candidateIdx = lineIdx - up;
      if (candidateIdx < 0) break;

      // First check for weekly heading
      const days = weeklyHeadingDays(page, candidateIdx, lang);
      if (days) {
        headingDaysForSpan = days;
        const [first, after] = page.lines[candidateIdx]!;
        headingTextForSpan = page.words.slice(first, after).join(" ");
        break; // nearest heading wins for this span
      }

      // Before reaching heading, check if this line is a time-slot line
      if (slotTime === null) {
        const lineText = page.texts[candidateIdx]!.trim();
        const parsed = parseSlotTime(lineText);
        if (parsed !== null) {
          slotTime = parsed;
          slotLine = lineText;
        }
      }

      // Check for other weekday-containing lines
      const [lineFirst, lineAfter] = page.lines[candidateIdx]!;
      const lineText = page.texts[candidateIdx]!.trim();
      // Markdown marks ("__4th Saturdays of the month:__") and punctuation at either end do not parse.
      const cleanText = lineText.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
      if (weekdaysNamed(cleanText, lang).size > 0) {
        const monthly =
          parseRecurrenceText(cleanText, lang ?? undefined) ?? parseRecurrenceText(cleanText);
        if (monthly !== null && monthly.startsWith("FREQ=MONTHLY")) {
          monthlyRule ??= { rrule: monthly, written: lineText };
          break;
        }
        // A heading naming a weekday that is neither weekly nor monthly (e.g. a date heading) ends the walk.
        if (lineAfter - lineFirst <= 8) break;
      }
    }
    spanData.push({
      slotTime,
      headingDays: headingDaysForSpan,
      headingText: headingTextForSpan,
      slotLine,
    });
  }

  // Determine which spans to include based on startTime
  const includeAll = startTime === null || startTime === undefined;
  const matchingSpans = includeAll
    ? spanData
    : spanData.filter((data) => data.slotTime === startTime);
  const hasMatching = matchingSpans.length > 0;
  const finalSpans = hasMatching ? matchingSpans : spanData;

  // Collect slot times and lines for potential slotTime/slotLine
  const slotTimes: string[] = [];
  const slotLines: string[] = [];
  for (const data of finalSpans) {
    data.headingDays.forEach((d) => headingDays.add(d));
    if (data.headingText && !headingTexts.includes(data.headingText)) {
      headingTexts.push(data.headingText);
    }
    if (data.slotTime !== null) {
      slotTimes.push(data.slotTime);
      if (data.slotLine !== null) {
        slotLines.push(data.slotLine);
      }
    }
  }

  if (headingDays.size > 0) {
    const rule: WeeklyGridRule = {
      rrule: `FREQ=WEEKLY;BYDAY=${[...headingDays].sort(byDayOrder).join(",")}`,
      written: headingTexts.join(", "),
    };
    // Set slotTime and slotLine only if startTime is null/undefined (or every span's slot line gives that
    // very start: a slot's second class, whose own cell writes no time, D-785), rule comes from strategy 2,
    // every finalSpan has a non-null slotTime, and they are all the same.
    if (startTime === null || startTime === undefined || hasMatching) {
      // Check if every finalSpan has a slotTime and they are identical
      if (
        slotTimes.length > 0 &&
        slotTimes.length === finalSpans.length &&
        slotTimes.every((st) => st === slotTimes[0])
      ) {
        const firstSlot = slotTimes[0];
        rule.slotTime = firstSlot;
        // Use the first slotLine that corresponds to the slotTime
        const firstSlotLine = slotLines.find((sl) => sl !== null);
        if (firstSlotLine !== undefined) {
          rule.slotLine = firstSlotLine;
        }
      }
    }
    return rule;
  }
  if (monthlyRule) return monthlyRule;

  // 4. One line of weekdays after the title
  const lines = pageText.split("\n");
  const foldedTitle = foldWords(title);
  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    if (!foldWords(lines[lineIdx]!).includes(foldedTitle)) continue;
    // Look at this line and the next 12 lines
    for (let offset = 0; offset < 13 && lineIdx + offset < lines.length; offset++) {
      const currentLine = lines[lineIdx + offset]!;
      const sentences = currentLine.split(/[.;]\s+/);
      for (const sentence of sentences) {
        const trimmed = sentence.trim();
        if (!trimmed) continue;
        const days = weekdayOnlyDays(trimmed, lang);
        if (days && days.size > 0) {
          return {
            rrule: `FREQ=WEEKLY;BYDAY=${[...days].sort(byDayOrder).join(",")}`,
            written: trimmed.replace(/\.$/, ""),
          };
        }
      }
    }
  }

  // 5. "Open:" line (Grupo Mandala clubs): opening hours are the nights only on the venue's own page.
  const openRule = venuePage ? weeklyGridOpenRule(pageText, lang) : null;
  if (openRule !== null) {
    return openRule;
  }

  // Last fallback: title contains "nightly" or "every night" as whole words
  const titleDailyMatch = foldWords(title).match(/(?:^| )(?:nightly|every night)(?: |$)/);
  if (titleDailyMatch) {
    return {
      rrule: "FREQ=DAILY",
      written: title,
    };
  }

  return null;
}

/**
 * Returns the text of the section under a weekday heading, up to the next weekday heading or at most 40 lines.
 * Used for weekly grids where a night has no title of its own (La Viruta Tango Club, D-402).
 */
export function weeklyGridSection(
  pageText: string,
  heading: string,
  lang: string | null | undefined,
): string | null {
  const lines = pageText.split("\n");
  const foldedHeading = foldWords(heading);
  let startIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim() === "") continue;
    if (foldWords(line) === foldedHeading) {
      startIdx = i;
      break;
    }
  }
  if (startIdx === -1) return null;

  const sectionLines: string[] = [];
  for (let i = startIdx + 1; i < lines.length && i - startIdx <= 40; i++) {
    const line = lines[i]!;
    if (line.trim() === "") {
      sectionLines.push(line);
      continue;
    }
    // Check if this line is itself a weekday heading
    const page = foldPage(line);
    const days = weeklyHeadingDays(page, 0, lang);
    if (days && days.length > 0) {
      break;
    }
    sectionLines.push(line);
  }
  const section = sectionLines.join("\n").trim();
  return section || null;
}

/**
 * Extract a weekly recurrence from an "Open:" line (Grupo Mandala clubs).
 * Reads lines starting with labels like "open", "abierto", etc., extracts the days part
 * after the colon, and returns a rule if exactly one distinct rule is found.
 */
export function weeklyGridOpenRule(
  pageText: string,
  lang: string | null | undefined,
): WeeklyGridRule | null {
  // Longest first: "open" must not take "opening hours".
  const labels = ["opening hours", "opening days", "abierto", "abrimos", "horario", "open"];
  const lines = pageText.split("\n");
  const candidates: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i]!.trim();
    // Strip leading non-letter characters
    const cleaned = trimmed.replace(/^[^\p{L}]+/u, "").trim();
    if (!cleaned) continue;
    const lower = cleaned.toLowerCase();
    let matchedLabel: string | null = null;
    for (const label of labels) {
      if (lower.startsWith(label)) {
        matchedLabel = label;
        break;
      }
    }
    if (matchedLabel === null) continue;
    // Must have a colon after the label (with optional spaces)
    const afterLabel = cleaned.slice(matchedLabel.length).trim();
    if (!afterLabel.startsWith(":")) continue;
    let rest = afterLabel.slice(1).trim();
    if (!rest) {
      // Look at the next non-empty line, unless it's another label
      for (let j = i + 1; j < lines.length; j++) {
        const nextTrimmed = lines[j]!.trim();
        if (nextTrimmed === "") continue;
        // Check if the next line ends with ":" (another label)
        if (nextTrimmed.endsWith(":")) break;
        rest = nextTrimmed;
        break;
      }
    }
    if (!rest) continue;
    candidates.push(rest);
  }

  if (candidates.length === 0) return null;

  const rangeWords = new Set(["to", "through", "thru", "till", "until", "a", "al", "-", "–", "—"]);

  const rules = new Map<string, string>(); // rrule -> rest (first occurrence)
  for (const rest of candidates) {
    // Find days part: cut at first digit, "starting", "at", "from" (not first word), "desde", a "beach/night club"
    // label (Vagalume, D-800), "|", "("
    const cutMatch = rest.match(
      /^(.*?)(?=\d|\bstarting\b|\bat\b|(?<!^)\bfrom\b|\bdesde\b|\b(?:beach|night) club\b|\||\(|$)/i,
    );
    let daysPart = (cutMatch?.[1] ?? rest).trim();
    // Drop leading "from " or "de " (whole word)
    daysPart = daysPart.replace(/^(from|de)\s+/i, "").trim();
    // Drop trailing "nights", "night", "noches", "noche" (whole word)
    daysPart = daysPart.replace(/\s+(nights|night|noches|noche)\b$/i, "").trim();
    // Trim trailing punctuation
    daysPart = daysPart.replace(/[,;.\-–—]+$/g, "").trim();
    if (!daysPart) continue;

    // 3a. Try parseRecurrenceText
    let rrule: string | null =
      parseRecurrenceText(daysPart, lang ?? undefined) ?? parseRecurrenceText(daysPart);
    if (rrule !== null && (rrule.startsWith("FREQ=WEEKLY") || rrule === "FREQ=DAILY")) {
      // Accept
    } else {
      // 3b. If no range word, try weekdayOnlyDays
      const hasRange =
        rangeWords.has(daysPart.toLowerCase()) ||
        daysPart.split(/\s+/).some((word) => rangeWords.has(word.toLowerCase())) ||
        /[-–—]/.test(daysPart);
      if (!hasRange) {
        let days = weekdayOnlyDays(daysPart, lang);
        if (days === null) {
          for (const other of ROW_FALLBACK_LANGS) {
            days = weekdayOnlyDays(daysPart, other);
            if (days !== null) break;
          }
        }
        if (days !== null && days.size > 0) {
          rrule = `FREQ=WEEKLY;BYDAY=${[...days].sort(byDayOrder).join(",")}`;
        } else {
          rrule = null;
        }
      } else {
        rrule = null;
      }
    }

    if (rrule !== null && !rules.has(rrule)) {
      rules.set(rrule, rest);
    }
  }

  // Must have exactly one distinct rule
  if (rules.size !== 1) return null;
  const first = Array.from(rules.entries())[0];
  if (!first) return null;
  const [rrule, rest] = first;
  return { rrule, written: rest, section: rest };
}

/** Order BYDAY codes as SU,MO,TU,WE,TH,FR,SA */
function byDayOrder(a: string, b: string): number {
  const order = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
  return order.indexOf(a) - order.indexOf(b);
}
