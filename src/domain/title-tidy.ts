import { removePromoTail } from "@/src/domain/promo-tail";

/**
 * Tidy a listing's title: drop a stale trailing date and collapse a doubled "X - X".
 *
 * D-591: Buenos Aires sources printed "Salsa Arriba - 04/10/26" on November nights
 * (October's date) and "Salsa Arriba - Salsa Arriba".
 * D-746: Rio Sympla titles carry Portuguese weekday-and-date tails.
 * D-759: More Portuguese date tails (Rio and Lisbon) including date segments without "de",
 * dash forms with places, short numeric dates, and day-month without weekday.
 * D-747: London sources include English weekday-and-time tails.
 * D-1042: Paris sources carry French weekday-and-date tails.
 * D-825: Card time lines and sales badges ("FROM 8PM 🔥SELLING FAST", Penthouse Dubai).
 * D-837: Nashville titles carry "on Thursdays" / "every Thursday" tails.
 *
 * Steps:
 * 1. Trim the title.
 * 2. Remove promotional tails (time lines and sales badges).
 * 3. If `night` is not null, attempt to remove a stale trailing date.
 * 4. Remove Portuguese weekday-and-date tail (any night, including null).
 * 5. Remove French weekday-and-date tail (any night, including null).
 * 6. Remove English weekday-and-time tail (any night, including null).
 * 6b. Remove an English weekly-recurrence tail ("on Thursdays", "every Thursday").
 * 7. Collapse a doubled part separated by " - ", " – ", " — ", " | ", or ": ".
 * 8. Return the result.
 */
export function tidyTitle(title: string, night: string | null): string {
  let t = title.trim();

  // Step 1b: Remove a leading clock time and its separator (D-883: Mia Mao "23:59 : Protokseed, ..." beside the
  // agenda's "Protokseed, ..."). Only when a letter remains after it.
  const clockLead = /^(?:[01]?\d|2[0-3])[:h][0-5]\d\s*[:|\-–—]\s+/.exec(t);
  if (clockLead && /\p{L}/u.test(t.slice(clockLead[0].length))) t = t.slice(clockLead[0].length);

  // Step 2: Remove promotional tails (D-825)
  t = removePromoTail(t); // D-825: a card's time line and sales badge

  // Step 3: Remove stale trailing date when night is known
  if (night !== null) {
    t = removeStaleTrailingDate(t, night);
  }

  // Step 4: Remove Portuguese weekday-and-date tail
  t = removePortugueseTail(t);
  // A bare "dd.mm" after a word that is the night itself (D-810)
  if (night !== null) t = removeNightDayMonth(t, night);

  // Step 5: Remove French weekday-and-date tail
  t = removeFrenchTail(t);

  // Step 6: Remove English weekday-and-time tail
  t = removeEnglishTail(t);

  // Step 6b: Remove an English weekly-recurrence tail (D-837)
  t = removeRecurrenceTail(t);

  // Step 7: Collapse doubled part
  t = collapseDoubledPart(t);

  return t;
}

/**
 * Remove French weekday-and-date tail from the end of the string.
 * Matches pattern: separator + WEEKDAY + DAY + MONTH (+ YEAR)? (+ HOUR)?
 * Returns the string unchanged if no match or if removing would leave no letters.
 */
function removeFrenchTail(s: string): string {
  // French weekdays
  const weekday = "(?:lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)";
  // Months
  const month =
    "(?:janvier|février|fevrier|mars|avril|mai|juin|juillet|août|aout|septembre|octobre|novembre|décembre|decembre)";
  // Day: "1er" or 1-2 digits
  const day = "(?:1er|\\d{1,2})";
  // Year: optional 4 digits
  const year = "(?:\\s+\\d{4})?";
  // Hour: optional separator, then time pattern
  const hour = "(?:\\s*[\\-–—àa,]?\\s*(?:\\d{1,2}\\s*h(?:\\s*\\d{2})?|\\d{1,2}:\\d{2}))?";

  // Separator: optional spaces, then one of | - – — , then optional spaces
  const separator = "\\s*[\\|\\-–—,]\\s*";

  // Optional "le " before weekday
  const optionalLe = "(?:le\\s+)?";

  // Build pattern
  const pattern = new RegExp(
    separator + optionalLe + weekday + "(?:,)?\\s+" + day + "\\s+" + month + year + hour + "\\s*$",
    "iu",
  );

  const match = s.match(pattern);
  if (match) {
    const index = s.search(pattern);
    if (index !== -1) {
      const result = s.substring(0, index).replace(/[\s\-–—|,]+$/u, "");
      // Ensure there's at least one letter
      if (/\p{L}/u.test(result)) {
        return result;
      }
    }
  }
  return s;
}

/**
 * Remove Portuguese weekday-and-date tail from the end of the string.
 * Matches multiple forms:
 * Form A: "| WEEKDAY - day de MONTH (- HOUR)?" (original D-746)
 * Form B: "dd/mm HOUR - WEEKDAY" (original D-746)
 * Form C: "| WEEKDAY day month" (no "de") followed by up to two "| text" segments (D-759)
 * Form D: "<sep> WEEKDAY day de month no|na|em words" (D-759)
 * Form E: "| WEEKDAY dd.mm" or "| WEEKDAY dd/mm" (D-759)
 * Form F: "| day de month" (no weekday) (D-759), or "- day de month de year" (D-776), or "/ day de
 *   month" with one last short segment ("/ Up Turn", "- sábado!") after it (D-799)
 * Returns the string unchanged if no match or if removing would leave no letters.
 */
function removePortugueseTail(s: string): string {
  // Define patterns
  const weekday = "(?:segunda|terça|terca|quarta|quinta|sexta|sábado|sabado|domingo)";
  const month =
    "(?:janeiro|fevereiro|março|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)";
  const hour = "\\d{1,2}\\s*h(?:\\d{2})?";

  // Helper to trim and check for letters
  const trimAndCheck = (str: string, cutIndex: number): string | null => {
    const result = str.substring(0, cutIndex).replace(/[\s\-–—|,]+$/u, "");
    // Ensure there's at least one letter
    if (/\p{L}/u.test(result)) {
      return result;
    }
    return null;
  };

  // Form A (original): "| WEEKDAY - day de MONTH (- HOUR)?"
  const formA = new RegExp(
    `\\s*\\|\\s*${weekday}(?:-feira|\\s+feira)?[\\s,\\-–]*` +
      `(\\d{1,2})\\s+de\\s+${month}` +
      `(?:\\s*[\\-–]?\\s*${hour})?\\s*$`,
    "iu",
  );

  // Form B (original): "dd/mm HOUR - WEEKDAY"
  const formB = new RegExp(
    `\\s+\\d{1,2}/\\d{1,2}\\s+${hour}\\s*[\\-–]?\\s*${weekday}(?:-feira|\\s+feira)?\\s*$`,
    "iu",
  );

  // Form C: "| WEEKDAY day month" (no "de") followed by up to two "| text" segments
  // We need to match from the pipe before weekday to end, but only if there are 0-2 more pipe segments
  const formC = new RegExp(
    // D-833: a pipe may also sit between the weekday and the day ("|Terça-feira | 10 novembro| TAU").
    `(\\s*\\|\\s*${weekday}(?:-feira|\\s+feira)?(?:,?\\s+|\\s*\\|\\s*)\\d{1,2}\\s+(?:de\\s+)?${month}\\s*)(?:\\|\\s*[^|]+\\s*){0,2}$`,
    "iu",
  );

  // Form D: "<sep> WEEKDAY day de month no|na|em words"
  const separator = "[\\-–|]";
  const formD = new RegExp(
    `\\s*${separator}\\s*${weekday}(?:-feira)?\\s+\\d{1,2}\\s+de\\s+${month}\\s+(?:no|na|em)\\s+[\\p{L}\\s]+$`,
    "iu",
  );

  // Form E: "| WEEKDAY dd.mm" or "| WEEKDAY dd/mm"
  const formE = new RegExp(`\\s*\\|\\s*${weekday}(?:-feira)?\\s+\\d{1,2}[./]\\d{1,2}\\s*$`, "iu");

  // Form F: "| day de month" (no weekday); also "- 07 de Novembro de 2026" with a dash and a year (D-776);
  // a slash separator, and one last short segment after the date: "/ 21 de Novembro / Up Turn",
  // "- 21 de novembro - sábado!" (D-799).
  const formF = new RegExp(
    `\\s*[\\-–|/]\\s*\\d{1,2}\\s+de\\s+${month}(?:\\s+de\\s+\\d{4})?` +
      `(?:\\s*[\\-–|/]\\s*(?:${weekday}(?:-feira)?[!.]?|\\p{L}[^|/\\-–]{0,39}))?\\s*$`,
    "iu",
  );

  // Try each form in order
  const forms = [
    { pattern: formA },
    { pattern: formB },
    { pattern: formC },
    { pattern: formD },
    { pattern: formE },
    { pattern: formF },
  ];

  for (const { pattern } of forms) {
    const match = s.match(pattern);
    if (match) {
      // Every form's match starts at its own separator, so the cut is the match's start.
      const cutIndex = match.index ?? -1;
      if (cutIndex === -1) continue;

      const result = trimAndCheck(s, cutIndex);
      if (result !== null) {
        return result;
      }
    }
  }

  return s;
}

/**
 * Remove English weekday-and-time tail from the end of the string.
 * Matches pattern: ", WEEKDAY(s) TIME(, AREA)?"
 * Returns the string unchanged if no match or if removing would leave no letters.
 */
function removeEnglishTail(s: string): string {
  // English weekdays (any case)
  const weekday = "(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)";
  // Time pattern: H, H:MM, H.MM with optional space before am/pm
  // Hour 1-12, minutes optional, am/pm case-insensitive
  const time = "(?:1[0-2]|[1-9])(?::\\d{1,2}|\\.\\d{1,2})?\\s*[ap]m";
  // Area pattern: word characters, apostrophes, hyphens, dots, ampersand
  // We'll check length separately
  const word = "[\\p{L}'’\\-\\.&]+";

  // Build the regex pattern
  const pattern = new RegExp(
    `,\\s*${weekday}s?\\s+${time}(?:,\\s*(${word}(?:\\s+${word}){0,3}))?\\s*$`,
    "iu",
  );

  const match = s.match(pattern);
  if (match) {
    // Check if area exists and is too long
    if (match[1]) {
      const area = match[1];
      // Check if area is more than 30 characters
      if (area.length > 30) {
        return s;
      }
      // Check if area has more than 4 words
      const wordCount = area.trim().split(/\s+/).length;
      if (wordCount > 4) {
        return s;
      }
    }

    const index = s.search(pattern);
    if (index !== -1) {
      // Remove the matched part
      let result = s.substring(0, index);
      // Trim trailing spaces, commas, dashes, and "|"
      result = result.replace(/[\s,\-–—|]+$/u, "");
      // Ensure there's at least one letter
      if (/\p{L}/u.test(result)) {
        return result;
      }
    }
  }
  return s;
}

/**
 * Remove an English weekly-recurrence tail from the end of the string.
 * D-837: Nashville example: "Live music and dance lessons on Thursdays".
 * Matches "on <Weekday>s" (plural required) or "every <Weekday>(s)" at the end,
 * optionally with a second weekday joined by " and ", " & " or "/".
 * Returns the string unchanged if removing would leave fewer than two words
 * or no letters.
 */
function removeRecurrenceTail(s: string): string {
  const weekday = "(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)";

  // Pattern for "on <Weekday>s" (plural required)
  // The keyword must be preceded by whitespace, comma, dash, or opening parenthesis
  const onPattern = new RegExp(
    `(?:\\s|,\\s|[\\-–—]\\s|\\(\\s*)on\\s+${weekday}s(?:\\s+and\\s+${weekday}s|\\s*&\\s*${weekday}s|\\s*/\\s*${weekday}s)?\\s*\\)?\\s*$`,
    "iu",
  );

  // Pattern for "every <Weekday>(s)" (singular or plural)
  const everyPattern = new RegExp(
    `(?:\\s|,\\s|[\\-–—]\\s|\\(\\s*)every\\s+${weekday}s?(?:\\s+and\\s+${weekday}s?|\\s*&\\s*${weekday}s?|\\s*/\\s*${weekday}s?)?\\s*\\)?\\s*$`,
    "iu",
  );

  // Try both patterns
  const patterns = [onPattern, everyPattern];

  for (const pattern of patterns) {
    const matchIndex = s.search(pattern);
    if (matchIndex !== -1) {
      // Get the part before the match
      let result = s.substring(0, matchIndex);

      // Trim trailing whitespace, commas, dashes, and |
      result = result.replace(/[\s,\-–—|]+$/u, "");

      // Check if result has at least one letter
      if (!/\p{L}/u.test(result)) {
        return s;
      }

      // Check if result has at least two words (split on whitespace)
      const words = result.trim().split(/\s+/);
      if (words.length < 2) {
        return s;
      }

      return result;
    }
  }

  return s;
}

/**
 * Remove a stale trailing date from the end of the string.
 * Returns the string unchanged if:
 * - No valid date is found
 * - The date matches the night in either reading
 * - Removing would leave no letters
 */
/**
 * Remove a bare "dd.mm" tail that is the listing's own night (D-810, Rio Scenarium "ENZO BELMONTE NO RIO SCENARIUM
 * 12.11" on 2026-11-12). Another day and month, or a title left with no letters, is kept.
 */
function removeNightDayMonth(s: string, night: string): string {
  const match = s.match(/(?<=\p{L})\s+(\d{1,2})\.(\d{1,2})$/u);
  if (!match || match.index === undefined) return s;
  const [, month, day] = night.split("-").map(Number);
  if (Number(match[1]) !== day || Number(match[2]) !== month) return s;
  const rest = s.slice(0, match.index).replace(/[\s\-–—|,]+$/u, "");
  return /\p{L}/u.test(rest) ? rest : s;
}

function removeStaleTrailingDate(s: string, night: string): string {
  // Try different patterns for trailing date
  const patterns = [
    // Pattern with separator: whitespace + separator + whitespace + date (optional parentheses)
    // Separator can be: - – — |
    /\s+([\-–—\|])\s+((?:\(\s*)?(\d{1,2}[\/\.\-]\d{1,2}[\/\.\-](?:\d{2}|\d{4})|\d{4}-\d{2}-\d{2})(?:\s*\))?)$/,
    // Pattern without separator: whitespace + date (optional parentheses)
    /\s+((?:\(\s*)?(\d{1,2}[\/\.\-]\d{1,2}[\/\.\-](?:\d{2}|\d{4})|\d{4}-\d{2}-\d{2})(?:\s*\))?)$/,
  ];

  for (const pattern of patterns) {
    const match = s.match(pattern);
    if (match) {
      const fullMatch = match[0];
      // Extract the date string
      let dateStr = match[3] ?? match[2];
      if (!dateStr) continue;

      // Clean parentheses if present
      dateStr = dateStr.replace(/^\(|\)$/g, "").trim();

      const candidates = parseDateCandidates(dateStr);
      if (candidates.length === 0) {
        continue;
      }

      // Check if any candidate matches the night
      if (candidates.some((c) => c === night)) {
        return s;
      }

      // Remove the matched part
      const index = s.lastIndexOf(fullMatch);
      if (index !== -1) {
        // Drop a separator left behind ("Carambomba -- 06/10/26").
        const result = s.substring(0, index).replace(/[\s\-–—|]+$/u, "");
        // Ensure there's at least one letter
        if (/\p{L}/u.test(result)) {
          return result;
        }
      }
    }
  }

  // D-764: a yearless day/month (slash) after a separator that is the night (either reading) says nothing
  // the card does not ("Latin Night Party - 11/6" on 11-06). One that is not the night stays: it may
  // not be a date ("24/7").
  const yearless = s.match(/\s+[\-–—|]\s+\(?\s*(\d{1,2})\/(\d{1,2})\s*\)?$/u);
  if (yearless) {
    const [, a = "", b = ""] = yearless;
    const [, month = "", day = ""] = night.split("-");
    const isNight = (d: string, m: string) =>
      Number(d) === Number(day) && Number(m) === Number(month);
    if (isNight(a, b) || isNight(b, a)) {
      const result = s.slice(0, yearless.index).replace(/[\s\-–—|]+$/u, "");
      if (/\p{L}/u.test(result)) return result;
    }
  }

  return s;
}

/**
 * Parse a date string into possible calendar dates.
 * Returns an array of "YYYY-MM-DD" strings.
 */
function parseDateCandidates(dateStr: string): string[] {
  const candidates: string[] = [];

  // ISO date
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    candidates.push(dateStr);
    return candidates;
  }

  // d/m/y or m/d/y
  const parts = dateStr.split(/[\/\.\-]/);
  if (parts.length !== 3) return [];

  const [a = "", b = "", yearStr = ""] = parts;
  const year = yearStr.length === 2 ? `20${yearStr}` : yearStr;

  // Try a as day, b as month
  if (isValidDate(parseInt(a, 10), parseInt(b, 10), year)) {
    const day = a.padStart(2, "0");
    const month = b.padStart(2, "0");
    candidates.push(`${year}-${month}-${day}`);
  }

  // Try a as month, b as day
  if (isValidDate(parseInt(b, 10), parseInt(a, 10), year)) {
    const day = b.padStart(2, "0");
    const month = a.padStart(2, "0");
    candidates.push(`${year}-${month}-${day}`);
  }

  return candidates;
}

function isValidDate(day: number, month: number, year: string): boolean {
  if (month < 1 || month > 12) return false;
  const y = parseInt(year, 10);
  // Get days in month using UTC to avoid timezone issues
  const daysInMonth = new Date(Date.UTC(y, month, 0)).getUTCDate();
  return day >= 1 && day <= daysInMonth;
}

/**
 * Collapse doubled parts separated by specific separators.
 */
function collapseDoubledPart(s: string): string {
  const separators = [" - ", " – ", " — ", " | ", ": "];

  for (const sep of separators) {
    const index = s.indexOf(sep);
    if (index !== -1) {
      const first = s.substring(0, index);
      const second = s.substring(index + sep.length);

      // Check if second part contains any other separator
      const hasOtherSep = separators.some((otherSep) => second.includes(otherSep));
      if (hasOtherSep) {
        // Three or more parts: unchanged
        continue;
      }

      const firstTrimmed = first.trim();
      const secondTrimmed = second.trim();

      if (
        firstTrimmed &&
        secondTrimmed &&
        firstTrimmed.toLocaleLowerCase().normalize("NFC") ===
          secondTrimmed.toLocaleLowerCase().normalize("NFC")
      ) {
        return firstTrimmed;
      }
    }
  }

  return s;
}
