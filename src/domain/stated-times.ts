// A model read's times, checked against the listing's own words on its page (D-081). Pure and
// deterministic: no model is called, so a cached read is checked on every run exactly as a fresh
// one is.
//
// - `readBlockTimes` reads every time a piece of page text writes, with its role (a start, the end
//   of a range, or a price's cut-off) and the word beside it (doors, lesson, dancing, or none).
// - `groundTimes` keeps a read's time only when the listing's own text writes it, takes am or pm
//   from the page, never uses a range's end as a start, and files each start under the word the
//   page puts beside it; a start with no word, or a dancing word, is the start, stored as the
//   dancing time.
// - `ownBlockTexts` and `checkListingTimes` do that for one listing of a read, over the blocks
//   `titleBlocks` finds for its title.

import { EVIDENCE_MAX_CHARS, type RawListing } from "@/src/domain/listing";
import {
  categoryAbove,
  mentionsClass,
  statesAnyDate,
  statesDate,
  statesDateInSpan,
} from "@/src/domain/text-facts";
import type { TitleBlock } from "@/src/domain/title-blocks";
import { NIGHT_BOUNDARY_HOUR } from "@/src/domain/tonight";
import { hanTimeTokens } from "@/src/domain/zh-time";

export type TimeRole = "start" | "end" | "cutoff";
/**
 * The word beside a start: a doors word, a lesson word, a dancing word ("dancing", "social", "DJ",
 * "milonga"), or none. A dancing word and none both make the time the start (the dancing time);
 * the card names only doors and a lesson, and only with the page's own word.
 */
export type TimeLabel = "doors" | "lesson" | "dancing" | null;

export interface TimeMention {
  /**
   * 24-hour HH:MM when the page fixes the half of the day: am or pm, a 24-hour time, noon,
   * midnight, or the other side of a range. Null when only the clock face is written ("9:30").
   */
  value: string | null;
  /** The clock face, "h%12:mm": "9:30" for 9:30am, 9:30pm and 21:30. */
  face: string;
  /** True when `value` is known. */
  explicit: boolean;
  role: TimeRole;
  /** The word beside a start (doors, a lesson word, a dancing word, or none); null for an end or a cut-off. */
  label: TimeLabel;
  /** For the end of a range, the range's start (its time and the word beside it); null otherwise. */
  from: { value: string | null; face: string; label: TimeLabel } | null;
  /** The clause writes some time with its half ("9:30-12:30" does not; "9:30am-4pm" does). */
  clauseHasHalf: boolean;
  /** The clause that writes the time, cut to EVIDENCE_MAX_CHARS: the evidence for a moved field. */
  quote: string;
}

const hhmm = (h: number, m: number) =>
  `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
const faceOf = (h24: number, m: number) => `${h24 % 12}:${String(m).padStart(2, "0")}`;

/** What may stand between the two sides of a range ("9pm-2am", "20.00 Uhr bis 1.00 Uhr"). */
const CONNECTOR =
  /^\s*(?:uhr\s*)?(?:-|–|—|~|to|until|till|til|'til|thru|through|bis|a|至|到|－|～|〜|から)\s*$/i;
/**
 * The end's date after a range's connector, as an overnight range is written on venue sites
 * ("11:00 pm - Sun, Nov 1, 3:00 am", D-289): a weekday, a month and day, or both. Removed before the
 * clock times are read, so the two sides read as one range.
 */
const WEEKDAY = "(?:mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)(?:day|sday|nesday|rsday|urday)?";
const MONTH =
  "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const DAY_NUM = "(?:[12]\\d|3[01]|0?[1-9])(?:st|nd|rd|th)?";
const DATE_AFTER_CONNECTOR = new RegExp(
  `((?:\\d|[ap]m)\\s*(?:-|–|—|to|until|till|thru|through))\\s+(?:${WEEKDAY}\\.?,?\\s*)?(?:(?:${MONTH}\\.?\\s+${DAY_NUM}|${DAY_NUM}\\s+${MONTH}\\.?),?\\s*)?(?=\\d{1,2}(?::\\d{2})?\\s*[ap]m\\b)`,
  "gi",
);
const END_CUE =
  /(?:\buntil|\bbis|\btill?|'til|\bto|\bends?(?:\s+at)?|\bthrough|\bthru|\bclos(?:e|es|ing)(?:\s+at)?)\s*:?\s*$/i;
const CUTOFF_CUE = /(?:\bbefore|\bafter|\bby)\s*:?\s*$/i;
/** Words a bare hour ("9") is a start after: "at 9", "from 9", "doors 8", "dancing 9", "class 7". */
const START_CUE =
  /(?:\bat|@|\bfrom|\bdoors?|\bopens?|\bstarts?|\bbegins?|\btime|\bdancing|\bsocial|\bparty|\blessons?|\bclass(?:es)?)\s*:?\s*$/i;

/** How many words from a time (or a range) a doors, lesson or dancing word may stand and still name it. */
export const LABEL_WORDS = 8;

// Folded (no accents, lower case). Deliberately not "beginner" ("beginner friendly social") nor
// "course" ("of course").
const LESSON_WORD =
  /^(?:lessons?|class(?:es)?|workshops?|intro|bootcamps?|cours|clases?|kurse?|talleres|taller|instruction|taught|teaching|leccion(?:es)?|lecon|lezion[ei]|aula|unterricht)$/;
const DANCING_WORD =
  /^(?:dancing|socials?|part(?:y|ies)|bands?|djs?|milongas?|practicas?|bailes?|bal)$/;
const NEGATION = /^(?:no|not|without|sin)$/;

interface RawToken {
  at: number;
  end: number;
  h: number;
  m: number;
  /** "am" | "pm" | "24" (a 24-hour time, noon or midnight) | null (not written). */
  mer: "am" | "pm" | "24" | null;
  /** No minutes and no am or pm: counted only in a range or after a cue. */
  bare: boolean;
  /** Written "2h": a 24-hour hour when the other side of its range is 24-hour ("21h-2h"). */
  h24?: boolean;
}

const CANDIDATE =
  /(?<![\d$€£/.:])(?:(noon)|(midnight)|(\d{1,2})(?:([:.])(\d{2})|(h)(\d{2})?(?![\p{L}]))?(?:\s*(am|pm)\b|(a|p)(?![\p{L}])|\s*(noon)\b)?)(?![\d])/giu;

// Whether a word is a month's name, long or short, in English or the page's language: text-facts'
// months, asked through `statesAnyDate` ("Oct 1" writes a date, "Club 1" does not).
const monthWords = new Map<string, boolean>();
function isMonth(word: string, lang: string | null | undefined): boolean {
  const key = `${lang ?? ""}|${word.toLowerCase()}`;
  let known = monthWords.get(key);
  if (known === undefined) {
    known = /^\p{L}{3,}$/u.test(word) && statesAnyDate(`${word} 1`, lang);
    monthWords.set(key, known);
  }
  return known;
}

/**
 * A bare number that is a day of the month: right after a month's name ("October 3 - 9pm", "Oct.
 * 3", "October the 3") or right before one ("3 October", "3 de octubre"). Never a time, and never
 * one side of a range.
 */
function dayOfMonth(clause: string, at: number, end: number, lang: string | null | undefined) {
  const before = /(\p{L}+)\.?,?\s+(?:the\s+)?$/u.exec(clause.slice(Math.max(0, at - 24), at));
  if (before && isMonth(before[1]!, lang)) return true;
  const after = /^\.?\s*(?:de\s+|of\s+)?(\p{L}+)/u.exec(clause.slice(end, end + 24));
  return after !== null && isMonth(after[1]!, lang);
}

function tokensOf(clause: string, lang: string | null | undefined): RawToken[] {
  const out: RawToken[] = [];
  for (const m of clause.matchAll(CANDIDATE)) {
    const at = m.index;
    const end = at + m[0].length;
    if (m[1]) {
      out.push({ at, end, h: 12, m: 0, mer: "24", bare: false });
      continue;
    }
    if (m[2]) {
      out.push({ at, end, h: 0, m: 0, mer: "24", bare: false });
      continue;
    }
    const h = Number(m[3]);
    // An uppercase "23H" (Casa Independente, Lisbon) is the same clock as "23h" (D-493).
    const sep = (m[4] ?? m[6])?.toLowerCase();
    const minText = m[5] ?? m[7];
    const min = minText !== undefined ? Number(minText) : 0;
    const merWord = (m[8] ?? m[9] ?? "").toLowerCase();
    // "12.30noon" (Newham's tea dances): a noon hour written with "noon" after it is 12:30 pm.
    const mer = merWord.startsWith("a")
      ? "am"
      : merWord.startsWith("p") || (m[10] && h === 12)
        ? "pm"
        : null;
    const after = clause.slice(end, end + 4);
    const before = clause.slice(Math.max(0, at - 2), at);
    // A price ("$15", "10$"), an ordinal ("3rd"), or a date ("9/18") is not a time.
    if (/^\s*[$€£%]/.test(after) || /[$€£]\s*$/.test(before)) continue;
    if (/^(?:st|nd|rd|th)\b/i.test(after) || /^\/\d/.test(after)) continue;
    // A hyphenated date ("04-11-2026") is not a time (D-667).
    if (/^-\d{1,2}-\d{4}(?!\d)/.test(clause.slice(end, end + 12))) continue;
    if (
      /\d{1,2}-$/.test(clause.slice(Math.max(0, at - 3), at)) &&
      /^-\d{4}(?!\d)/.test(clause.slice(end, end + 12))
    )
      continue;
    if (min > 59) continue;
    // D-253: Argentina's "hs" (horas) marks a 24-hour clock, on the time itself ("18.30 hs") or
    // on the end of its range ("20 a 01 hs", "21 a 22.15 hs").
    if (
      h <= 23 &&
      min <= 59 &&
      !mer &&
      (/^\s*(?:hs|hrs)\b/i.test(clause.slice(end, end + 5)) ||
        /^\s*(?:-|–|a|bis)\s*\d{1,2}(?:[.:]\d{2})?\s*(?:hs|hrs)\b/i.test(
          clause.slice(end, end + 16),
        ))
    ) {
      out.push({ at, end, h, m: min, mer: "24", bare: false });
      continue;
    }
    // German "Uhr" at end of range: "20 bis 2 Uhr", "20-2 Uhr"
    if (
      h <= 23 &&
      min <= 59 &&
      !mer &&
      /^\s*(?:-|–|a|bis)\s*\d{1,2}(?:[.:]\d{2})?\s*uhr\b/i.test(clause.slice(end, end + 16))
    ) {
      out.push({ at, end, h, m: min, mer: "24", bare: false });
      continue;
    }
    // D-372 (Ocaña): Spanish/Catalan "21 h" (hour, space, "h") as a 24-hour time.
    // Hours 0 or 13-23 are unambiguous; hours 1-12 need written minutes ("8:00 h"), else a
    // duration ("2 h"). The token takes in the " h", so "21 h a 3 h" reads as a range.
    const spacedH = !mer && /^\s+h(?![\p{L}\d])/iu.exec(clause.slice(end, end + 3));
    if (h <= 23 && min <= 59 && spacedH) {
      const hEnd = end + spacedH[0].length;
      if (h === 0 || h >= 13 || minText !== undefined) {
        out.push({ at, end: hEnd, h, m: min, mer: "24", bare: false });
      } else {
        // "3 h" alone may be a duration; beside a 24-hour side ("de 21 h a 3 h") it is 03:00.
        out.push({ at, end: hEnd, h, m: 0, mer: null, bare: true, h24: true });
      }
      continue;
    }
    // "9.30" alone may be a price; "20.00 Uhr", "1.00 Uhr" and "20.00" (hour 0 or 13 to 23) are
    // 24-hour times.
    const uhr = /^\s*uhr\b/i.test(clause.slice(end, end + 5));
    if (sep === "." && !mer && !uhr && !(h === 0 || (h >= 13 && h <= 23))) continue;
    if ((sep === "." || sep === ":") && !mer && (uhr || h === 0 || h >= 13)) {
      if (h <= 23) out.push({ at, end, h, m: min, mer: "24", bare: false });
      continue;
    }
    // German "22 Uhr", "1 Uhr": hour with no minutes followed by "Uhr" (case-insensitive)
    const uhrAfter = clause.slice(end).match(/^\s*uhr\b/i);
    if (!mer && sep === undefined && minText === undefined && uhrAfter && h <= 23) {
      // "22 Uhr" -> 22:00, "1 Uhr" -> 01:00
      out.push({ at, end: end + uhrAfter[0].length, h, m: 0, mer: "24", bare: false });
      continue;
    }
    if (sep === "h" && minText === undefined && h < 13) {
      // "2h" alone may be a duration; beside a 24-hour side ("21h-2h") it is 02:00.
      out.push({ at, end, h, m: 0, mer: null, bare: true, h24: true });
      continue;
    }
    if (mer) {
      if (h < 1 || h > 12) continue;
      out.push({ at, end, h, m: min, mer, bare: false });
      continue;
    }
    if (sep === ":" || sep === "h") {
      if (h > 23) continue;
      if (h === 0 || h >= 13) out.push({ at, end, h, m: min, mer: "24", bare: false });
      else out.push({ at, end, h, m: min, mer: null, bare: false });
      continue;
    }
    // A bare hour: kept below only in a range or after a cue. A day of the month is none.
    if (h < 1 || h > 12) continue;
    if (dayOfMonth(clause, at, end, lang)) continue;
    out.push({ at, end, h, m: 0, mer: null, bare: true });
  }

  // Add Han tokens for Chinese times
  if (/\p{Script=Han}/u.test(clause)) {
    const hanTokens = hanTimeTokens(clause);
    // Remove existing tokens that overlap with Han tokens
    const filteredOut = out.filter((token) => {
      return !hanTokens.some((han) => token.at < han.end && token.end > han.at);
    });
    // Convert Han tokens to RawToken format
    for (const han of hanTokens) {
      // For am/pm tokens, convert h back to 1-12 for compatibility with to24
      const h = han.mer === "am" || han.mer === "pm" ? (han.h % 12 === 0 ? 12 : han.h % 12) : han.h;
      filteredOut.push({
        at: han.at,
        end: han.end,
        h,
        m: han.m,
        mer: han.mer,
        bare: false,
      });
    }
    // Sort by start position
    filteredOut.sort((a, b) => a.at - b.at);
    return filteredOut;
  }

  return out;
}

/** A bare hour written with a space before its "h" ("3 h"), not glued ("3h"). */
const spacedHour = (clause: string, t: RawToken): boolean =>
  /\d\s+h$/i.test(clause.slice(t.at, t.end));

const to24 = (t: RawToken, mer: "am" | "pm"): number => (t.h % 12) + (mer === "pm" ? 12 : 0);
const halfOf = (h24: number): "am" | "pm" => (h24 >= 12 ? "pm" : "am");
const valueOf = (t: RawToken): number | null =>
  t.mer === "24" ? t.h : t.mer === "am" || t.mer === "pm" ? to24(t, t.mer) : null;

/** A URL printed as text ("Tickets: https://…"), as `pageLinks` reads one. */
const BARE_URL = /https?:\/\/[^\s[\]<>"'()]+/g;

/**
 * Clauses: lines, and within a line, the text between ; | • , ! ? " / " and sentence ends (a
 * period before a capital, or at the end, or before a digit unless it closes a month's short name:
 * "Door code 4410. 9pm-2am" is two clauses, "Oct. 3 - 9pm" one). A link closes a clause too, so a
 * word never names a time across a link.
 */
function clausesOf(text: string, lang: string | null | undefined): string[] {
  const flat = text
    .replace(/\[https?:\/\/[^\]\s]*\]/g, "\n")
    .replace(BARE_URL, "\n")
    // A clock split over lines: "23\n\n59\nhs" (Niceto's cards).
    .replace(
      /^(?<!\d)(\d{1,2})\s*\n\s*(\d{2})(?:\s*\n\s*(hs|h|hrs)\b|\s+(hs|h|hrs)\b)/gim,
      (_, h, m, unit1, unit2) => {
        const hh = Number(h);
        const mm = Number(m);
        if (hh > 23 || mm > 59) return _;
        const unit = (unit1 ?? unit2 ?? "").toLowerCase();
        return `${hh}:${m} ${unit}`;
      },
    )
    // ISO dates and zone offsets are not clock times: "2026-11-05 @ 08:00 PM (GMT-0400)".
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, " ")
    .replace(/\((?:GMT|UTC)[^)]*\)/gi, " ")
    .replace(/\b([ap])\.\s?m\.?/gi, "$1m")
    // A colon-less clock range before am/pm, "730-830 PM", "830-1100 PM" (Nashville's Jump Session, D-775).
    .replace(
      /(?<![\d$€£.,:/-])(\d{1,2})([0-5]\d)\s*(-|–|to)\s*(\d{1,2})([0-5]\d)\s*([ap]m)\b/gi,
      (whole, h1: string, m1: string, dash: string, h2: string, m2: string, mer: string) =>
        Number(h1) >= 1 && Number(h1) <= 12 && Number(h2) >= 1 && Number(h2) <= 12
          ? `${h1}:${m1}${dash}${h2}:${m2} ${mer}`
          : whole,
    )
    .replace(DATE_AFTER_CONNECTOR, "$1 ")
    .replace(/[ \t]/g, " ")
    .replace(/(\p{L}*)\.(?=\s+\d)/gu, (whole, word: string) =>
      word && isMonth(word, lang) ? whole : `${word}\n`,
    );
  return flat
    .split(/\n|;|\||•|,|!|\?|\s\/\s|\.(?=\s+\p{Lu})|\.\s*$/u)
    .map((c) => c.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

const fold = (word: string) =>
  word.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/’/g, "'");

interface Word {
  at: number;
  end: number;
  text: string;
}

/**
 * The label a word gives, or null. Whole words only: not joined by a hyphen ("world-class DJs",
 * "Salsa-Party"). Void after a negation within 3 words ("No class this week"). "door" counts only
 * as "doors", "door(s) open" or "door:", never "at the door" or "door code".
 */
function labelOf(words: readonly Word[], i: number, clause: string): TimeLabel {
  const w = words[i]!;
  if (
    /\p{L}-$/u.test(clause.slice(Math.max(0, w.at - 2), w.at)) ||
    /^-\p{L}/u.test(clause.slice(w.end, w.end + 2))
  ) {
    return null;
  }
  let kind: TimeLabel = LESSON_WORD.test(w.text)
    ? "lesson"
    : DANCING_WORD.test(w.text)
      ? "dancing"
      : null;
  if (
    kind === null &&
    (w.text === "door" ||
      w.text === "doors" ||
      w.text === "einlass" ||
      w.text === "öffnung" ||
      w.text === "zutritt")
  ) {
    const next = words[i + 1]?.text;
    const atThe = words[i - 1]?.text === "the" && words[i - 2]?.text === "at";
    const opens = next === "open" || next === "opens" || /^\s*:/.test(clause.slice(w.end));
    if (
      next !== "code" &&
      next !== "codes" &&
      !atThe &&
      (opens ||
        w.text === "doors" ||
        w.text === "einlass" ||
        w.text === "öffnung" ||
        w.text === "zutritt")
    ) {
      kind = "doors";
    }
  }
  if (kind === null) return null;
  for (let k = Math.max(0, i - 3); k < i; k++) {
    const t = words[k]!.text;
    if (NEGATION.test(t) || (t === "pas" && words[k + 1]?.text === "de")) return null;
  }
  return kind;
}

/** Of several words naming one time, the nearest; on a tie, a lesson, then doors, then dancing. */
const LABEL_RANK: Record<Exclude<TimeLabel, null>, number> = { lesson: 0, doors: 1, dancing: 2 };

/**
 * Every time the text writes, with its role and the word beside it.
 *
 * Ranges are two times joined by a dash, "to", "until", "through" or "bis": the first is a start,
 * the second an end, and a side with no am or pm takes the other side's half when that keeps the
 * range in order ("8:30-9pm" is 20:30, "10-2am" is 22:00, "9pm-12:30" ends at 00:30). A lone time
 * is an end after "until" or "closes at", a cut-off after "before", "after" or "by" ("$10 before
 * 10pm"), and a start otherwise. A bare hour ("9") counts only in a range, after a cue ("at 9",
 * "from 9", "dancing 9") or before "o'clock", and never right beside a month's name ("October 3 -
 * 9pm": the 3 is the date); "9.30" counts only as a 24-hour time or with "Uhr".
 *
 * A doors, lesson or dancing word names one time or range in its clause, within LABEL_WORDS words:
 * the next one when the clause's first such word comes before its first time ("Lesson 7pm,
 * dancing 8pm", "classes start at 10pm"), the previous one otherwise ("9:30 door open", "6:00pm -
 * 7:00pm: Dance Lesson"), and the nearest when there is none on its side. A time named by several
 * takes the nearest word's ("Beginner lesson with Maria then social dancing 9pm" is the dancing).
 * A range's word sits on its start.
 */
export function readBlockTimes(text: string, lang?: string | null): TimeMention[] {
  const mentions: TimeMention[] = [];
  for (const clause of clausesOf(text, lang)) {
    const quote = clause.slice(0, EVIDENCE_MAX_CHARS);
    const raw = tokensOf(clause, lang);
    // Ranges: two times joined by a connector.
    const partner = new Map<number, number>();
    for (let i = 0; i + 1 < raw.length; i++) {
      const gap = clause.slice(raw[i]!.end, raw[i + 1]!.at);
      if (CONNECTOR.test(gap)) {
        partner.set(i, i + 1);
        partner.set(i + 1, i);
      }
    }
    // A bare hour outside a range counts only after a cue; "2h" only beside a 24-hour side.
    const keep = raw.map((t, i) => {
      if (t.h24) {
        const o = partner.has(i) ? raw[partner.get(i)!]! : null;
        if (o === null) return false;
        // "8:00 PM - 3 h" (spaced) is a duration after an am/pm start; a glued "10pm-3h" is a clock end (D-667).
        return o.mer === "24" || ((o.mer === "am" || o.mer === "pm") && spacedHour(clause, t));
      }
      if (!t.bare || partner.has(i)) return true;
      const before = clause.slice(Math.max(0, t.at - 12), t.at);
      return (
        START_CUE.test(before) || END_CUE.test(before) || /^\s*o'?clock/i.test(clause.slice(t.end))
      );
    });
    // The half of the day, inherited across a range.
    const mers = raw.map((t) => t.mer);
    raw.forEach((t, i) => {
      if (t.mer !== null) return;
      const j = partner.get(i);
      if (j === undefined) return;
      const o = raw[j]!;
      if (t.h24 && o.mer === "24") {
        mers[i] = "24";
        return;
      }
      const ov = valueOf(o);
      if (ov === null) return;
      const oh = ov % 12;
      const th = t.h % 12;
      const same = i < j ? th <= oh : th >= oh;
      const oHalf = halfOf(ov);
      mers[i] = same ? oHalf : oHalf === "am" ? "pm" : "am";
    });
    const clauseHasHalf = raw.some((t, i) => keep[i] && mers[i] !== null);
    // Words, for the labels.
    const words: Word[] = [...clause.matchAll(/[\p{L}'’]+|\d[\d:.]*\s*(?:am|pm|a|p)?/giu)].map(
      (w) => ({ at: w.index, end: w.index + w[0].length, text: fold(w[0]) }),
    );
    const wordIndexAt = (pos: number) => {
      let k = 0;
      for (let i = 0; i < words.length; i++) if (words[i]!.at <= pos) k = i;
      return k;
    };
    // Units: a range, or one time.
    const units: Array<{ tokens: number[]; from: number; to: number }> = [];
    raw.forEach((t, i) => {
      if (!keep[i]) return;
      const j = partner.get(i);
      if (j !== undefined && j < i) return;
      const members = j !== undefined ? [i, j] : [i];
      units.push({
        tokens: members,
        from: wordIndexAt(t.at),
        to: wordIndexAt(raw[members.at(-1)!]!.at),
      });
    });
    const kinds = words.map((_, wi) => labelOf(words, wi, clause));
    const namedBy = units.map((): Array<{ kind: Exclude<TimeLabel, null>; d: number }> => []);
    const firstWord = kinds.findIndex((k) => k !== null);
    const forward = firstWord >= 0 && units.length > 0 && firstWord < units[0]!.from;
    kinds.forEach((kind, wi) => {
      if (!kind) return;
      const distance = (u: { from: number; to: number }) =>
        wi < u.from ? u.from - wi : wi > u.to ? wi - u.to : 0;
      const side = forward
        ? units.findIndex((u) => u.from >= wi)
        : (units
            .map((u, ui) => (u.to <= wi ? ui : -1))
            .filter((x) => x >= 0)
            .at(-1) ?? -1);
      let best = side;
      let bestD = side >= 0 ? distance(units[side]!) : Infinity;
      if (side < 0) {
        units.forEach((u, ui) => {
          const d = distance(u);
          if (d < bestD) {
            best = ui;
            bestD = d;
          }
        });
      }
      if (best >= 0 && bestD <= LABEL_WORDS) namedBy[best]!.push({ kind, d: bestD });
    });
    // D-667: duration ends: "8:00 PM - 3 h" -> end = start + N hours
    const durationEnds = new Map<number, string>(); // token index -> computed end value
    for (let i = 0; i + 1 < raw.length; i++) {
      const j = partner.get(i);
      if (j !== i + 1) continue; // only adjacent partners
      const startToken = raw[i];
      const endToken = raw[j];
      if (!startToken || !endToken) continue;
      const gap = clause.slice(startToken.end, endToken.at);
      if (!CONNECTOR.test(gap)) continue;
      // start must have am/pm (mers[i] is "am" or "pm")
      const half = mers[i];
      if (half !== "am" && half !== "pm") continue;
      // end token must be a bare h24 token (duration)
      if (!endToken.h24 || !spacedHour(clause, endToken)) continue;
      // compute end = start + N hours
      const startHour = to24(startToken, half);
      const startMin = startToken.m;
      const durationHours = endToken.h;
      let endHour = startHour + durationHours;
      const endMin = startMin;
      // wrap past midnight
      if (endHour >= 24) endHour -= 24;
      const endValue = hhmm(endHour, endMin);
      durationEnds.set(j, endValue);
    }
    units.forEach((u, ui) => {
      const nearest = [...namedBy[ui]!].sort(
        (a, b) => a.d - b.d || LABEL_RANK[a.kind] - LABEL_RANK[b.kind],
      )[0];
      const label: TimeLabel = nearest?.kind ?? null;
      const valueAt = (ti: number) => {
        const t = raw[ti]!;
        const mer = mers[ti];
        const v = mer === "24" ? t.h : mer === "am" || mer === "pm" ? to24(t, mer) : null;
        return v === null ? null : hhmm(v, t.m);
      };
      u.tokens.forEach((ti, k) => {
        const t = raw[ti]!;
        let value = valueAt(ti);
        let explicit = value !== null;
        // D-667: if this token is a duration end, use computed value
        if (durationEnds.has(ti)) {
          value = durationEnds.get(ti)!;
          explicit = true;
        }
        let role: TimeRole = "start";
        if (u.tokens.length === 2) role = k === 0 ? "start" : "end";
        else {
          const before = clause.slice(Math.max(0, t.at - 14), t.at);
          if (END_CUE.test(before)) role = "end";
          else if (CUTOFF_CUE.test(before)) role = "cutoff";
        }
        const first = raw[u.tokens[0]!]!;
        // For duration pairs, the clause has a half (the start's am/pm)
        const hasHalf =
          clauseHasHalf ||
          (durationEnds.has(ti) && (mers[u.tokens[0]!] === "am" || mers[u.tokens[0]!] === "pm"));
        mentions.push({
          value,
          // A duration end's face is its clock's ("8:00 PM - 3 h" ends at 11:00), not the hours' (D-669).
          face: durationEnds.has(ti) ? faceOfTime(value!) : faceOf(t.h, t.m),
          explicit,
          role,
          label: role === "start" ? label : null,
          from:
            u.tokens.length === 2 && k === 1
              ? { value: valueAt(u.tokens[0]!), face: faceOf(first.h, first.m), label }
              : null,
          clauseHasHalf: hasHalf,
          quote,
        });
      });
    });
  }
  return mentions;
}

export interface StatedTimes {
  doors_time: string | null;
  lesson_time: string | null;
  dancing_time: string | null;
  end_time: string | null;
}
export type TimeField = keyof StatedTimes;
type StartField = Exclude<TimeField, "end_time">;

/** What the check did to one of a read's times, for the run report. */
export type TimeChange =
  /** The listing's text does not write this time (or writes its face with both halves): dropped. */
  | { kind: "not_written"; field: TimeField; given: string }
  /** The page writes this clock time with the other am or pm: read as the page writes it. */
  | { kind: "meridiem"; field: TimeField; given: string; time: string }
  /**
   * Written only as the end of a range or after "until". It becomes the listing's end when the read
   * gave none, the range names no lesson or doors, and the range starts at one of the listing's
   * starts (`becameEnd`); otherwise it is dropped.
   */
  | { kind: "end_only"; field: TimeField; time: string; becameEnd: boolean }
  /** Written only as a price's cut-off ("$10 before 10pm"): dropped. */
  | { kind: "cutoff_only"; field: TimeField; time: string }
  /** The word beside it on the page names another field, or it gave way there and kept doors. */
  | { kind: "moved"; field: TimeField; to: TimeField; time: string }
  /** Another time went to the same field and won, and no field was left for it: dropped. */
  | { kind: "superseded"; field: TimeField; time: string; by: string }
  /** An end the page writes with the other am or pm, more than 12 hours after the start: not listed. */
  | { kind: "end_over_12h"; given: string; time: string; hours: number };

export interface GroundedTimes {
  times: StatedTimes;
  /** For each time kept, the clause of the page that writes it. */
  quotes: Partial<Record<TimeField, string>>;
  changes: TimeChange[];
}

const START_FIELDS: readonly StartField[] = ["doors_time", "lesson_time", "dancing_time"];
const TIME_FIELDS: readonly TimeField[] = [...START_FIELDS, "end_time"];
const LABEL_OF: Record<StartField, TimeLabel> = {
  doors_time: "doors",
  lesson_time: "lesson",
  dancing_time: null,
};

const DAY = 24 * 60;
const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
/** Minutes into the night: a time before the night's boundary (6am) counts as after midnight. */
const nightMinutes = (t: string) => {
  const m = minutes(t);
  return m < NIGHT_BOUNDARY_HOUR * 60 ? m + DAY : m;
};
/** Minutes from a start to an end on the same night: an end at or before the start is the next day. */
const spanOf = (start: string, end: string) => {
  const span = minutes(end) - minutes(start);
  return span <= 0 ? span + DAY : span;
};
const faceOfTime = (t: string) => faceOf(Number(t.slice(0, 2)), Number(t.slice(3, 5)));

/**
 * The mentions of a time's clock face, and the time the text writes for it:
 * - it stands when some mention writes it with its half, or when none writes a half;
 * - it stands when `keepBare` holds (it agrees with the listing's other times) and some mention is
 *   a start whose clause writes no half at all ("Friday social 9:30-12:30" beside "Saturday
 *   workshops 9:30am-4pm"): the page leaves the half to the reader there;
 * - otherwise it becomes the one value the written mentions agree on, and is null when they
 *   disagree.
 */
function resolve(
  t: string,
  mentions: readonly TimeMention[],
  keepBare = false,
): { time: string; mentions: TimeMention[] } | null {
  const same = mentions.filter((x) => x.face === faceOfTime(t));
  if (same.length === 0) return null;
  const written = same.filter((x) => x.explicit);
  const bare = same.filter((x) => !x.explicit);
  if (written.length === 0) return { time: t, mentions: same };
  const exact = written.filter((x) => x.value === t);
  if (exact.length > 0) return { time: t, mentions: [...exact, ...bare] };
  if (keepBare && bare.some((x) => x.role === "start" && !x.clauseHasHalf)) {
    return { time: t, mentions: bare };
  }
  const values = [...new Set(written.map((x) => x.value!))];
  if (values.length !== 1) return null;
  return { time: values[0]!, mentions: [...written, ...bare] };
}

const sameTime = (m: { face: string; value: string | null }, t: string) =>
  m.face === faceOfTime(t) && (m.value === null || m.value === t);

interface Want {
  /** The field the page's words give it. */
  field: StartField;
  /** The field the read gave it in. */
  from: StartField;
  time: string;
  /** The clause of the start the field is grounded on, and of any start that writes it. */
  quote: string;
  anyQuote: string;
}

/**
 * A read's four times, checked against the texts the page writes for its listing (D-081):
 * - a time the texts do not write is dropped;
 * - am or pm is the page's whenever it writes one ("10pm" read as 10:00 is 22:00), unless the page
 *   also writes that clock face as a start with no half in its clause and the read's half agrees
 *   with its other times;
 * - a time written only as a range's end or after "until" is not a start. The end of a range that
 *   names no lesson or doors and starts at one of the listing's kept starts becomes its end when
 *   the read gave none; any other is dropped (a lesson's "7-8pm" does not end the night at 8pm);
 *   one written only as a price's cut-off is dropped;
 * - a start goes where the word beside it puts it: doors with a doors word, the lesson with a lesson
 *   word, the start (the dancing time) with a dancing word or none. A listing the page calls a class
 *   (`categoryIsClass`, or its title) keeps its first time as its lesson: the first start in
 *   `firstStartTexts` (its block from the title on), else in `texts`;
 * - one time per field: the read's own field wins, else the earlier in the night. A start that
 *   loses keeps the field the read gave it when that is free, else doors when free; only then is
 *   it dropped. Nothing the page writes as a start is lost to another's field;
 * - an end the page writes with the other am or pm is read as written, unless that puts it more
 *   than 12 hours after the earliest start: then it is a slip on the page, and not listed.
 * Nothing the read did not give is added.
 */
export function groundTimes(
  model: StatedTimes,
  texts: readonly string[],
  options: {
    title: string;
    categoryIsClass: boolean;
    lang?: string | null;
    firstStartTexts?: readonly string[];
  },
): GroundedTimes {
  const mentions = texts.flatMap((text) => readBlockTimes(text, options.lang));
  const byField: Record<TimeField, TimeChange[]> = {
    doors_time: [],
    lesson_time: [],
    dancing_time: [],
    end_time: [],
  };
  const times: StatedTimes = {
    doors_time: null,
    lesson_time: null,
    dancing_time: null,
    end_time: null,
  };
  const quotes: Partial<Record<TimeField, string>> = {};
  const classListing = options.categoryIsClass || mentionsClass(options.title);
  const firstStart = (
    options.firstStartTexts
      ? options.firstStartTexts.flatMap((text) => readBlockTimes(text, options.lang))
      : mentions
  ).find((x) => x.role === "start");

  // Each time the page writes, as a first reading: what the read's other times are checked against.
  const firstPass = new Map<TimeField, string>();
  for (const field of TIME_FIELDS) {
    const given = model[field];
    const r = given ? resolve(given, mentions) : null;
    if (r) firstPass.set(field, r.time);
  }
  /** A start's half agrees with the listing's other times: its end within 12 hours, starts within 6. */
  const agrees = (t: string, field: StartField) =>
    TIME_FIELDS.every((f) => {
      const u = f === field ? undefined : firstPass.get(f);
      if (u === undefined) return true;
      if (f === "end_time") return spanOf(t, u) <= 12 * 60;
      return Math.abs(nightMinutes(t) - nightMinutes(u)) <= 6 * 60;
    });

  const wants: Want[] = [];
  const endOnly: Array<{ field: StartField; time: string; ends: TimeMention[] }> = [];
  for (const field of START_FIELDS) {
    const given = model[field];
    if (!given) continue;
    const r = resolve(given, mentions, agrees(given, field));
    if (!r) {
      byField[field].push({ kind: "not_written", field, given });
      continue;
    }
    if (r.time !== given) byField[field].push({ kind: "meridiem", field, given, time: r.time });
    const starts = r.mentions.filter((x) => x.role === "start");
    if (starts.length === 0) {
      const ends = r.mentions.filter((x) => x.role === "end");
      if (ends.length > 0) endOnly.push({ field, time: r.time, ends });
      else byField[field].push({ kind: "cutoff_only", field, time: r.time });
      continue;
    }
    const has = (label: TimeLabel) => starts.some((x) => x.label === label);
    const starting = has(null) || has("dancing");
    let to: StartField;
    if (field === "doors_time") {
      to = has("doors") ? "doors_time" : has("lesson") ? "lesson_time" : "dancing_time";
    } else if (field === "lesson_time") {
      const firstOfClass =
        classListing &&
        firstStart !== undefined &&
        sameTime(firstStart, r.time) &&
        starts.every((x) => x.label === null || x.label === "lesson");
      to =
        has("lesson") || firstOfClass
          ? "lesson_time"
          : has("doors") && !starting
            ? "doors_time"
            : "dancing_time";
    } else {
      to = starting ? "dancing_time" : has("lesson") ? "lesson_time" : "doors_time";
    }
    const grounding =
      to === "dancing_time"
        ? (starts.find((x) => x.label === null || x.label === "dancing") ?? starts[0]!)
        : (starts.find((x) => x.label === LABEL_OF[to]) ?? starts[0]!);
    wants.push({
      field: to,
      from: field,
      time: r.time,
      quote: grounding.quote,
      anyQuote: starts[0]!.quote,
    });
  }

  // One time per field: the read's own field wins, else the earlier in the night.
  const placed = new Map<StartField, Want & { at: StartField }>();
  const losers: Array<{ want: Want; by: string }> = [];
  for (const field of START_FIELDS) {
    const candidates = wants.filter((w) => w.field === field);
    if (candidates.length === 0) continue;
    const pick =
      candidates.find((c) => c.from === field) ??
      [...candidates].sort((a, b) => nightMinutes(a.time) - nightMinutes(b.time))[0]!;
    placed.set(field, { ...pick, at: field });
    for (const c of candidates) {
      if (c === pick) continue;
      // The same time in two of the read's fields is one start: it is placed once.
      if (c.time === pick.time)
        byField[c.from].push({ kind: "moved", field: c.from, to: field, time: c.time });
      else losers.push({ want: c, by: pick.time });
    }
  }
  // A start that lost keeps the read's field for it when free, else doors when free.
  for (const { want, by } of losers) {
    const at = !placed.has(want.from) ? want.from : !placed.has("doors_time") ? "doors_time" : null;
    if (at === null) {
      byField[want.from].push({ kind: "superseded", field: want.from, time: want.time, by });
      continue;
    }
    placed.set(at, { ...want, quote: want.anyQuote, at });
  }
  for (const field of START_FIELDS) {
    const w = placed.get(field);
    if (!w) continue;
    times[field] = w.time;
    quotes[field] = w.quote;
    if (w.at !== w.from)
      byField[w.from].push({ kind: "moved", field: w.from, to: w.at, time: w.time });
  }

  // A time written only as an end: the listing's end, when its range is the listing's own.
  const kept = START_FIELDS.map((f) => times[f]).filter((x): x is string => x !== null);
  let fromRange: { time: string; quote: string } | null = null;
  for (const { field, time, ends } of endOnly) {
    const range = ends.find(
      (m) =>
        m.from !== null &&
        m.from.label !== "lesson" &&
        m.from.label !== "doors" &&
        kept.some((k) => sameTime(m.from!, k)),
    );
    const becameEnd = !model.end_time && fromRange === null && range !== undefined;
    if (becameEnd) fromRange = { time, quote: range.quote };
    byField[field].push({ kind: "end_only", field, time, becameEnd });
  }

  if (model.end_time) {
    const given = model.end_time;
    const r = resolve(given, mentions);
    if (!r) byField.end_time.push({ kind: "not_written", field: "end_time", given });
    else {
      const earliest = [...kept].sort((a, b) => nightMinutes(a) - nightMinutes(b))[0];
      const span = earliest ? spanOf(earliest, r.time) : 0;
      if (r.time !== given && earliest && span > 12 * 60) {
        byField.end_time.push({
          kind: "end_over_12h",
          given,
          time: r.time,
          hours: Math.round(span / 60),
        });
      } else {
        if (r.time !== given) {
          byField.end_time.push({ kind: "meridiem", field: "end_time", given, time: r.time });
        }
        times.end_time = r.time;
        quotes.end_time = (r.mentions.find((x) => x.role === "end") ?? r.mentions[0]!).quote;
      }
    }
  } else if (fromRange) {
    times.end_time = fromRange.time;
    quotes.end_time = fromRange.quote;
  }
  return { times, quotes, changes: TIME_FIELDS.flatMap((f) => byField[f]) };
}

/**
 * The blocks a listing's times are read from: each block of its title. A block a longer title of
 * the read holds is that listing's, unless every block is held (a read that lists one event under
 * two titles). For a dated listing, the blocks under its own night when the page has any.
 */
function ownBlocks(
  blocks: readonly TitleBlock[],
  date: string | null,
  lang?: string | null,
): readonly TitleBlock[] {
  const free = blocks.filter((b) => !b.held);
  const pool = free.length > 0 ? free : blocks;
  if (!date) return pool;
  const own = blocks.filter(
    (b) =>
      (b.heading !== null &&
        (statesDate(b.heading, date, lang) || statesDateInSpan(b.heading, date, lang))) ||
      statesDate(`${b.above}\n${b.lead} ${b.text.slice(0, 300)}`, date, lang),
  );
  return own.length > 0 ? own : pool;
}

const blockText = (b: TitleBlock) => `${b.above ? `${b.above}\n` : ""}${b.lead} ${b.text}`;

/**
 * The texts a listing's times are read from (`ownBlocks`): each with the date-and-time lines just
 * above its title and the rest of its line before it.
 */
export function ownBlockTexts(
  blocks: readonly TitleBlock[],
  date: string | null,
  lang?: string | null,
  /**
   * Leave out the words before the title on its line (D-100): on a one-line list they can be the
   * previous card's price and age, where a time there is still the listing's own.
   */
  options: { lead?: boolean } = {},
): string[] {
  return ownBlocks(blocks, date, lang).map((b) =>
    options.lead === false ? `${b.above ? `${b.above}\n` : ""}${b.text}` : blockText(b),
  );
}

/** The words CATEGORY_TYPES (text-facts.ts) reads as a class, printed before a title on its line. */
const CLASS_CATEGORY = /^(?:class|classes|lesson|lessons|workshop|workshops)$/i;

/**
 * One listing of a model read, its times checked against its own blocks (D-081). A read with no
 * time, or a title the page does not write, is left as it is. A changed or moved time's evidence is
 * the page's clause, and its confidence is dropped. `withdrawn` is true when the read gave a start
 * and none stands: the listing is then written as "Time not listed". `pageStarts` and `pageEnds`
 * are then the starts and ends its own blocks write (`pageTimes`): a stored row whose every time is
 * among them is the page's, and is kept (seam review, 2026-09-29).
 */
export function checkListingTimes(
  listing: RawListing,
  ctx: {
    blocks: readonly TitleBlock[];
    pageText: string;
    title: string;
    date: string | null;
    lang?: string | null;
  },
): {
  listing: RawListing;
  changes: TimeChange[];
  withdrawn: boolean;
  pageStarts: string[];
  pageEnds: string[];
} {
  const given: StatedTimes = {
    doors_time: listing.doors_time,
    lesson_time: listing.lesson_time,
    dancing_time: listing.dancing_time,
    end_time: listing.end_time,
  };
  const unchanged = { listing, changes: [], withdrawn: false, pageStarts: [], pageEnds: [] };
  if (TIME_FIELDS.every((f) => !given[f]) || ctx.blocks.length === 0) return unchanged;
  const own = ownBlocks(ctx.blocks, ctx.date, ctx.lang);
  const lastWord =
    ctx.blocks[0]!.lead.split(/[^\p{L}]+/u)
      .filter(Boolean)
      .at(-1) ?? "";
  const categoryIsClass =
    categoryAbove(ctx.pageText, ctx.title)?.type === "class" || CLASS_CATEGORY.test(lastWord);
  const r = groundTimes(given, own.map(blockText), {
    title: ctx.title,
    categoryIsClass,
    lang: ctx.lang,
    // A class's first time is its first from the title on (a card's own date-and-time line above
    // it included), never one the lead holds.
    firstStartTexts: own.map((b) => `${b.card && b.above ? `${b.above}\n` : ""}${b.text}`),
  });
  if (r.changes.length === 0) return unchanged;
  const evidence = { ...listing.evidence };
  const confidence = { ...listing.confidence };
  for (const f of TIME_FIELDS) {
    if (r.times[f] === given[f]) continue;
    const quote = r.times[f] !== null ? r.quotes[f] : undefined;
    if (quote) evidence[f] = quote;
    else delete evidence[f];
    delete confidence[f];
  }
  const hadStart = START_FIELDS.some((f) => given[f]);
  const hasStart = START_FIELDS.some((f) => r.times[f]);
  const withdrawn = hadStart && !hasStart;
  const page = withdrawn ? pageTimes(own, ctx.lang) : { starts: [], ends: [] };
  return {
    listing: { ...listing, ...r.times, evidence, confidence },
    changes: r.changes,
    withdrawn,
    pageStarts: page.starts,
    pageEnds: page.ends,
  };
}

/**
 * The starts and ends the blocks write, 24-hour "HH:MM". A clock face written with no half of the
 * day ("Social 9:00 - 11:30") stands for both halves, as `groundTimes` reads it (seam review,
 * 2026-09-29). Cut-offs ("last entry 1am") are neither.
 */
function pageTimes(
  blocks: readonly TitleBlock[],
  lang?: string | null,
): { starts: string[]; ends: string[] } {
  const starts = new Set<string>();
  const ends = new Set<string>();
  for (const m of blocks.flatMap((b) => readBlockTimes(blockText(b), lang))) {
    const into = m.role === "start" ? starts : m.role === "end" ? ends : null;
    if (into === null) continue;
    if (m.value !== null) into.add(m.value);
    else {
      const [h, mm] = m.face.split(":").map(Number);
      into.add(hhmm(h!, mm!));
      into.add(hhmm(h! + 12, mm!));
    }
  }
  return { starts: [...starts], ends: [...ends] };
}

/**
 * The times the listing's own part of the page writes for its night (`ownBlocks`, `pageTimes`):
 * what a stored row's times are checked against when a read does not give them (seam review,
 * 2026-09-29).
 */
export function ownPageTimes(
  blocks: readonly TitleBlock[],
  date: string | null,
  lang?: string | null,
): { starts: string[]; ends: string[] } {
  return pageTimes(ownBlocks(blocks, date, lang), lang);
}

/**
 * (D-268) Blue Nile writes Balcony Room shows at 10:01 PM so they sort after the main room;
 * its titles write "@10PM". A start one minute past the hour gives way to the title's hour.
 */
export function titleHourOverOffset(
  listing: RawListing,
  title: string,
  lang?: string | null,
): { listing: RawListing; fields: StartField[] } {
  const mentions = readBlockTimes(title, lang);
  const titleStarts = new Set<string>();
  for (const m of mentions) {
    if (m.role === "start" && m.value !== null) {
      titleStarts.add(m.value);
    }
  }

  const fields: StartField[] = [];
  const newListing = { ...listing };
  const evidence = { ...listing.evidence };
  const confidence = { ...listing.confidence };

  for (const field of START_FIELDS) {
    const time = newListing[field];
    if (time === null) continue;
    // Check if time is exactly HH:01
    if (!/^\d{2}:01$/.test(time)) continue;
    const hour = time.slice(0, 2);
    const hour00 = `${hour}:00`;
    if (titleStarts.has(hour00)) {
      newListing[field] = hour00;
      // Use the first matching title mention's quote as evidence
      const mention = mentions.find((m) => m.role === "start" && m.value === hour00);
      if (mention) {
        evidence[field] = mention.quote;
      }
      delete confidence[field];
      fields.push(field);
    }
  }

  if (fields.length === 0) {
    // No changes, return original listing
    return { listing, fields: [] };
  }

  newListing.evidence = evidence;
  newListing.confidence = confidence;
  return { listing: newListing, fields };
}

/**
 * Whether the page writes every time a stored row holds (24-hour "HH:MM" in the row's zone): each
 * of its doors, lesson and dancing times among the starts, and its end, if it has one, among the
 * ends. A row with no start is not a timed row, and never passes.
 */
export function pageWritesRowTimes(
  row: {
    doors: string | null;
    lesson: string | null;
    dancing: string | null;
    end: string | null;
  },
  page: { starts: readonly string[]; ends: readonly string[] },
): boolean {
  const starts = [row.doors, row.lesson, row.dancing].filter((t): t is string => t !== null);
  return (
    starts.length > 0 &&
    starts.every((t) => page.starts.includes(t)) &&
    (row.end === null || page.ends.includes(row.end))
  );
}
