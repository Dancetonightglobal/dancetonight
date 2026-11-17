// Duplicate scoring (D-006). Pure: the SQL in src/pipeline/dedupe.ts finds candidate pairs and
// the title similarity (pg_trgm), this decides what to do with them. Thresholds and weights live
// in config/dedupe.ts.

import { getDomain } from "tldts";
import { isClassLike } from "@/src/domain/class-like";
import { isHostedEventPage, looksLikeEventPage } from "@/src/domain/event-links";
import { sameLink } from "@/src/domain/event-link-matcher";
import { sameNameAndPostcode } from "@/src/domain/same-name-address";
import { untimedVenueSuffixTwin } from "@/src/domain/venue-suffix-twin";

import {
  AUTO_MERGE,
  BRAND_GENERIC_WORDS,
  CANDIDATE_START_MINUTES,
  GENERIC_TITLE_WORDS,
  CONFLICT_START_MINUTES,
  HUB_SITES,
  LESSON_THEN_DANCING_MINUTES,
  LINK_TITLE_MARGIN,
  ONE_PLACE_METRES,
  ORGANIZER_NAME_SIMILARITY,
  PLATFORM_SITES,
  REVIEW,
  SAME_ADDRESS_METRES,
  SAME_ADDRESS_NAMED_METRES,
  SAME_NAME_ADDRESS_METRES,
  SAME_NIGHT_START_MINUTES,
  SAME_NIGHT_TITLE_SIMILARITY,
  SAME_SITE_UNTIMED_TITLE,
  SHARED_STEM_IGNORE_WORDS,
  SHARED_STEM_MIN,
  STATUS_TAGS,
  TRUST_ORDER,
  VENUE_GENERIC_WORDS,
  WEIGHTS,
} from "@/config/dedupe";

/** Two listed ends further apart than this are two nights under the prefix start-gap rule (D-515). */
export const PREFIX_GAP_END_MINUTES = 60;

/** Leading genre words a venue's own site puts before a DJ's name ("Bass G JONES", The Ave Live, 2026-10-30). */
const GENRE_PREFIX_WORDS = new Set([
  "house",
  "techno",
  "tech",
  "hard",
  "bass",
  "dubstep",
  "dnb",
  "drum",
  "and",
  "jungle",
  "garage",
  "trance",
  "electronic",
  "edm",
  "disco",
  "hip",
  "hop",
  "rnb",
  "afrobeats",
  "amapiano",
  "reggaeton",
  "latin",
  "trap",
  "melodic",
  "deep",
  "progressive",
  "minimal",
  "breaks",
]);

export type TrustTier = (typeof TRUST_ORDER)[number];

export interface DedupeSide {
  id: string;
  /** Null when the listing gives its night and no time (D-060). */
  startsAt: Date | null;
  organizerId: string | null;
  organizerName: string | null;
  venueId: string | null;
  ticketUrl: string | null;
  canonicalUrl: string | null;
  /** The best trust tier among the listing's sources. */
  trust: TrustTier;
  firstSeenAt: Date;
  /** Each kind of start the listing gives, when loaded: a lesson and dancing are one evening. */
  times?: EveningTimes;
  /** The listing's title as stored, for the one-venue-one-start rule; absent sides skip that rule. */
  title?: string;
  /** Normalized title (title_normalized from database) for exact matching. */
  titleNormalized?: string;
  /** Its source lists it as cancelled; the one-venue-one-start rule never joins it to a live listing (D-090). */
  cancelled?: boolean;
  /** `events.listing_type`, when loaded: a class is never merged with a night that is not one. */
  listingType?: string;
  /** When the listing ends, if known: two listings ending at one moment at one venue are one night. */
  endsAt?: Date | null;
  /** The venue's name as stored, when loaded: a title that only adds it is one night at one venue (D-503). */
  venueName?: string;
  /** The listing's point (its own, else its venue's), when loaded: two venue rows this close may be one place (D-504). */
  venuePoint?: { lat: number; lng: number };
  /** The venue's formatted address, when loaded: two rows this close at one street address are one place (D-591). */
  venueAddress?: string;
  /** Every URL known for the listing: its sources' URLs, any role (merged-in copies included), when loaded (D-592). */
  links?: string[];
}

export interface EveningTimes {
  doors: Date | null;
  lesson: Date | null;
  dancing: Date | null;
}

export interface PairFacts {
  /** pg_trgm similarity of the two normalised titles, 0 to 1. */
  titleSimilarity: number;
  /** pg_trgm similarity of the organizer names, when both have one. */
  organizerSimilarity: number | null;
  /** One normalised title is a whole-word prefix of the other, at least SAME_NIGHT_PREFIX_MIN_CHARS long. */
  titlePrefix?: boolean;
  /** Either side is from a source whose printed times are known wrong (seed `startTimesShifted`): its times say nothing, so the pair is judged by name and place. */
  shiftedSource?: boolean;
  /**
   * Whether the two listings share a source (in any role, a merged listing's sources included), when known. The prefix-title
   * start-gap rule (D-515) applies only when this is explicitly false.
   */
  sameSource?: boolean;
  /**
   * Whether both listings' own (primary) sources are one, when known. A copy merged in earlier lends its source as a
   * secondary only: the directory's untimed "C Jam" beside the card that took its "C Jam - The Bedford in Balham" (D-882).
   */
  samePrimarySource?: boolean;
}

export type Decision = "auto_merge" | "queued" | "distinct";

export interface Scored {
  score: number;
  decision: Decision;
  parts: { title: number; organizer: number; url: number; venue: number };
}

/** The registrable domain and first path segment: "eventbrite.com/o", "salsa.example/events". */
export function urlFamily(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const domain = getDomain(parsed.hostname) ?? parsed.hostname;
    const first = parsed.pathname.split("/").filter(Boolean)[0] ?? "";
    return `${domain}/${first}`.toLowerCase();
  } catch {
    return null;
  }
}

function sameUrl(a: DedupeSide, b: DedupeSide): boolean {
  if (a.ticketUrl && a.ticketUrl === b.ticketUrl) return true;
  if (a.canonicalUrl && a.canonicalUrl === b.canonicalUrl) return true;
  const fa = urlFamily(a.canonicalUrl);
  // A shared domain alone is not enough for aggregators (every Eventbrite listing is eventbrite.com/e).
  return (
    fa !== null &&
    fa === urlFamily(b.canonicalUrl) &&
    !/^(eventbrite|ticketmaster|meetup|dice|facebook)\./.test(fa)
  );
}

function normalizeForCore(title: string): string {
  // NFKD-normalise and drop combining marks; lower-case; turn ’ ‘ ` into nothing
  return title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[’‘`]/g, "");
}

export function coreTitleWords(title: string): string[] {
  let processed = normalizeForCore(title);

  // Remove ONE leading status tag
  for (const tag of STATUS_TAGS) {
    const pattern = new RegExp(`^${tag}[^a-zA-Z]`);
    if (processed.match(pattern)) {
      processed = processed.slice(tag.length).replace(/^[^a-zA-Z]+/, "");
      break;
    }
  }

  // Remove age marks anywhere
  processed = processed
    .replace(/\s*\(?\s*(?:ages?\s*)?(?:21\+|18\+|21\s+and\s+over|18\s+and\s+over)\s*\)?/g, "")
    .replace(/\s*-\s*(?:21\+|18\+)/g, "");

  // Cut everything from first ft., feat., etc.
  const cutPattern = /\s+(?:ft\.|ft\s|feat\.|feat\s|featuring\s)/;
  const cutIndex = processed.search(cutPattern);
  if (cutIndex !== -1) {
    processed = processed.slice(0, cutIndex);
  }

  // Remove leading "promoter presents" prefix (1-4 words, then presents/pres/presenta/etc.)
  const presentsPattern =
    /^(?:[a-z0-9]+[^a-z0-9]+){1,4}?(?:presents?|pres\.?|presenta|presentan|presenten)\s*[:\-–—]?\s+/;
  const presentsMatch = processed.match(presentsPattern);
  if (presentsMatch) {
    const afterPresents = processed.slice(presentsMatch[0].length);
    // Only remove if at least one letter or digit remains
    if (/[a-z0-9]/.test(afterPresents)) {
      processed = afterPresents;
    }
  }

  // 1. Venue suffix: cut everything from the first " @ " or " @" followed by a letter
  // Only if there's at least one letter/digit before it
  const venueSuffixPattern = /^(.*?[a-zA-Z0-9])\s+@\s+[a-zA-Z]/;
  const venueMatch = processed.match(venueSuffixPattern);
  if (venueMatch?.[1]) {
    processed = venueMatch[1];
  }

  // 2. Ampersand: replace every & with and
  processed = processed.replace(/&/g, " and ");

  // Split on non-alphanumeric characters, drop empty pieces
  let words = processed.split(/[^a-zA-Z0-9]+/).filter((word) => word.length > 0);

  // 3. Leading article: if the first word is a, an or the and at least one word follows, drop it
  if (words.length >= 2) {
    const first = words[0];
    if (first === "a" || first === "an" || first === "the") {
      words = words.slice(1);
    }
  }

  return words;
}

export function coreTitleKey(title: string): string {
  return coreTitleWords(title).join("");
}

export function isStatusCopy(title: string): boolean {
  const normalized = normalizeForCore(title);
  const statusTags = ["cancelled", "canceled", "postponed"];
  for (const tag of statusTags) {
    const pattern = new RegExp(`^${tag}[^a-zA-Z]`);
    if (normalized.match(pattern)) {
      return true;
    }
  }
  return false;
}

export function coreTitlePrefix(a: string, b: string): boolean {
  const wa = coreTitleWords(a);
  const wb = coreTitleWords(b);
  if (wa.length === 0 || wb.length === 0) {
    return false;
  }

  // Same key?
  if (coreTitleKey(a) === coreTitleKey(b)) {
    return true;
  }

  // Determine short and long
  const [short, long] = wa.length <= wb.length ? [wa, wb] : [wb, wa];

  // Check if all words in short are generic
  const allGeneric = short.every((word) => GENERIC_TITLE_WORDS.includes(word));
  if (allGeneric) {
    return false;
  }

  // Check if long's first short.length words equal short's words
  const longPrefix = long.slice(0, short.length);
  if (longPrefix.length === short.length) {
    let match = true;
    for (let i = 0; i < short.length; i++) {
      if (longPrefix[i] !== short[i]) {
        match = false;
        break;
      }
    }
    if (match) {
      return true;
    }
  }

  return false;
}

/**
 * D-271: at one venue and one start, when every core word of the shorter title appears among the
 * other title's core words, and the shorter has at least two core words that are not generic,
 * the pair is one night (auto merge).
 *
 * Examples:
 * - "Cherry - House & Disco | XOYO [HALLOWEEN EDITION]" and "Cherry | House & Disco - XOYO"
 * - "Leaf and Cane - Funky Mambo" and "Funky Mambo's Monthly Friday Salsa Night @Leaf & Cane - HALLOWEEN PARTY"
 */
export function titleWordsWithin(a: string, b: string): boolean {
  const wa = coreTitleWords(a).filter((w) => w.length >= 2);
  const wb = coreTitleWords(b).filter((w) => w.length >= 2);
  if (wa.length === 0 || wb.length === 0) return false;

  const [short, long] = wa.length <= wb.length ? [wa, wb] : [wb, wa];

  // Count non-generic words in short
  const nonGenericCount = short.filter((word) => !GENERIC_TITLE_WORDS.includes(word)).length;
  if (nonGenericCount < 2) return false;

  const longSet = new Set(long);
  return short.every((word) => longSet.has(word));
}

/**
 * Whether one title is the other with one or two leading genre words: "Bass G JONES" and "G JONES".
 * Compared on `coreTitleWords`. The shorter title must keep at least one word of 3+ letters that is not generic.
 */
export function genrePrefixedTitle(a: string, b: string): boolean {
  const wa = coreTitleWords(a);
  const wb = coreTitleWords(b);
  if (wa.length === 0 || wb.length === 0) return false;

  const [short, long] = wa.length <= wb.length ? [wa, wb] : [wb, wa];
  if (short.length === long.length) return false;

  const extra = long.length - short.length;
  if (extra !== 1 && extra !== 2) return false;

  // Check that the extra words are all genre prefixes
  const extraWords = long.slice(0, extra);
  if (!extraWords.every((word) => GENRE_PREFIX_WORDS.has(word))) {
    return false;
  }

  // Check that the rest matches
  const rest = long.slice(extra);
  for (let i = 0; i < short.length; i++) {
    if (rest[i] !== short[i]) return false;
  }

  // The shorter must contain at least one word of length >= 3 that is not generic
  const hasValidRemaining = short.some(
    (word) => word.length >= 3 && !GENERIC_TITLE_WORDS.includes(word),
  );
  if (!hasValidRemaining) return false;

  return true;
}

/**
 * Strip venue name from the front or end of a word list.
 * Returns the remaining words, or null if venue not found.
 * If venue is at end, also removes one trailing "the", then one trailing "at"/"in"/"en".
 */
function stripVenue(words: string[], venueWords: string[]): string[] | null {
  // venue at front
  if (words.slice(0, venueWords.length).join(" ") === venueWords.join(" ")) {
    return words.slice(venueWords.length);
  }
  // venue at end
  if (words.slice(-venueWords.length).join(" ") === venueWords.join(" ")) {
    const rest = words.slice(0, words.length - venueWords.length);
    // drop optional "the" before checking for "at"/"in"/"en"
    let trimmed = rest;
    if (trimmed.length > 0 && trimmed[trimmed.length - 1] === "the") {
      trimmed = trimmed.slice(0, trimmed.length - 1);
    }
    if (
      trimmed.length > 0 &&
      (trimmed[trimmed.length - 1] === "at" ||
        trimmed[trimmed.length - 1] === "in" ||
        trimmed[trimmed.length - 1] === "en")
    ) {
      trimmed = trimmed.slice(0, trimmed.length - 1);
    }
    return trimmed;
  }
  return null;
}

/**
 * At one venue and one start, a title that is the other title plus the venue's own name
 * (before it, or after it with an optional "at"/"in"/"en") is one night (D-503).
 * Example: "Underground Arts SUPERNATURAL DANCE PARTY" and "SUPERNATURAL DANCE PARTY".
 */
export function venueNamedTitle(a: string, b: string, venueName: string | undefined): boolean {
  if (!venueName || venueName.trim() === "") return false;
  const v = coreTitleWords(venueName);
  if (v.length === 0) return false;

  // Replace @ with " at " so coreTitleWords will keep the venue part
  const wordsA = coreTitleWords(a.replace(/@/g, " at "));
  const wordsB = coreTitleWords(b.replace(/@/g, " at "));
  if (wordsA.length === 0 || wordsB.length === 0) return false;

  for (const [long, short] of [
    [wordsA, wordsB],
    [wordsB, wordsA],
  ] as const) {
    const rest = stripVenue(long, v);
    if (rest === null) continue;
    if (rest.length === 0) continue; // title is only venue name
    if (rest.length !== short.length) continue;
    let match = true;
    for (let i = 0; i < rest.length; i++) {
      if (rest[i] !== short[i]) {
        match = false;
        break;
      }
    }
    if (!match) continue;
    // short must contain at least one word of length >= 3 that is not generic
    const hasValid = short.some((word) => word.length >= 3 && !GENERIC_TITLE_WORDS.includes(word));
    if (hasValid) return true;
  }
  return false;
}

/**
 * D-522: every core word of one title is among the other's once the venue's own name (and an "at"/"in"/"en"/"the"
 * just before it) is taken off the front or end of each title that has it. The shorter must keep at least two
 * words that are not generic. "Henri Bergmann | Klein Phönix" and "Henri Bergmann + NODUS + Arian & Aryou Sepassi".
 * "and" is not counted ("Chus & Ceballos" and "CHUS + CEBALLOS").
 */
export function titleWordsWithinBesideVenue(
  a: string,
  b: string,
  venueName: string | undefined,
): boolean {
  if (!venueName || venueName.trim() === "") return false;
  const v = coreTitleWords(venueName);
  if (v.length === 0) return false;

  // Replace @ with " at " so coreTitleWords will keep the venue part
  const wordsA = coreTitleWords(a.replace(/@/g, " at "));
  const wordsB = coreTitleWords(b.replace(/@/g, " at "));
  if (wordsA.length === 0 || wordsB.length === 0) return false;

  // Strip venue from each title if present
  const strip = (words: string[]): string[] => {
    const stripped = stripVenue(words, v);
    return stripped !== null ? stripped : words;
  };

  const strippedA = strip(wordsA);
  const strippedB = strip(wordsB);

  // Drop words shorter than 2 letters and also drop the word "and"
  const filteredA = strippedA
    .filter((w) => w.length >= 2 && w !== "and")
    .map((w) => foldWeekdayPlural(w));
  const filteredB = strippedB
    .filter((w) => w.length >= 2 && w !== "and")
    .map((w) => foldWeekdayPlural(w));
  if (filteredA.length === 0 || filteredB.length === 0) return false;

  // Determine short and long
  const [short, long] =
    filteredA.length <= filteredB.length ? [filteredA, filteredB] : [filteredB, filteredA];

  // The short list must have at least 2 words not in GENERIC_TITLE_WORDS
  const nonGenericCount = short.filter((word) => !GENERIC_TITLE_WORDS.includes(word)).length;
  if (nonGenericCount < 2) return false;

  const longSet = new Set(long);
  return short.every((word) => longSet.has(word));
}

/**
 * D-549: count distinctive word stems shared between two titles.
 * Words are lower-case, NFKD normalized, split on non-letter/non-digit.
 * Keep only words of length >= 4 that are not generic, not in SHARED_STEM_IGNORE_WORDS,
 * and not a word of the venue name (if venueName provided).
 * Stem is first 5 characters (or whole word if shorter).
 * Returns number of distinct stems present in both titles.
 */
export function sharedTitleStems(a: string, b: string, venueName: string | undefined): number {
  if (!a || !b) return 0;

  // Reuse normalizeForCore for consistency
  const normalizedA = normalizeForCore(a);
  const normalizedB = normalizeForCore(b);

  // Split on anything that is not a letter or digit (Unicode-aware)
  const splitWords = (text: string): string[] => {
    // Using regex that matches any character that is not a letter or digit in any language
    return text.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 0);
  };

  const wordsA = splitWords(normalizedA);
  const wordsB = splitWords(normalizedB);

  // Get venue words if venueName provided
  const venueWords = venueName ? splitWords(normalizeForCore(venueName)) : [];

  // Helper to get stem of a word
  const getStem = (word: string): string => {
    return word.length >= 5 ? word.slice(0, 5) : word;
  };

  // Collect eligible stems from each title
  const collectStems = (words: string[]): Set<string> => {
    const stems = new Set<string>();
    for (const word of words) {
      if (word.length < 4) continue;
      // Skip generic words
      if (GENERIC_TITLE_WORDS.includes(word)) continue;
      // Skip ignored words
      if (SHARED_STEM_IGNORE_WORDS.includes(word)) continue;
      // Skip venue words
      if (venueWords.includes(word)) continue;
      stems.add(getStem(word));
    }
    return stems;
  };

  const stemsA = collectStems(wordsA);
  const stemsB = collectStems(wordsB);

  // Count intersection
  let count = 0;
  for (const stem of stemsA) {
    if (stemsB.has(stem)) {
      count++;
    }
  }
  return count;
}

/**
 * One title (normalised, equal) with one listed end: starts any distance apart may still be one night (doors vs start, Do-Over 2026-11-05).
 */
export function sameTitleSameEnd(
  a: { titleNormalized?: string | null; endsAt?: Date | null },
  b: { titleNormalized?: string | null; endsAt?: Date | null },
): boolean {
  if (!a.titleNormalized || !b.titleNormalized) return false;
  if (a.titleNormalized !== b.titleNormalized) return false;
  if (!(a.endsAt instanceof Date) || !(b.endsAt instanceof Date)) return false;
  return a.endsAt.getTime() === b.endsAt.getTime();
}

/**
 * D-879: two venue rows with one street-only address ("Hanbury Street, London E1 5JP", no house number, so
 * sameStreetAddress cannot speak) geocoded to one point, and one start: Juju's Bar and Stage and Ely's Yard Social,
 * "Sambroso Cuban Sundays" / "Cuban Sundays", 4pm-11pm every Sunday (daily check 11-12).
 */
function oneStreetPointOneStart(a: DedupeSide, b: DedupeSide): boolean {
  if (a.venueAddress === undefined || b.venueAddress === undefined) return false;
  const addressA = normalizeAddress(a.venueAddress);
  if (addressA === "" || addressA !== normalizeAddress(b.venueAddress)) return false;
  if (!a.venuePoint || !b.venuePoint) return false;
  if (distanceMetres(a.venuePoint, b.venuePoint) > SAME_ADDRESS_METRES) return false;
  return oneStart(a, b);
}

function oneStart(a: DedupeSide, b: DedupeSide): boolean {
  if (a.startsAt === null || b.startsAt === null) return false;
  return Math.abs(a.startsAt.getTime() - b.startsAt.getTime()) <= SAME_NIGHT_START_MINUTES * 60_000;
}

/**
 * D-879: every core word of the shorter title is in the longer, and the shorter keeps one telling word of 4+ letters
 * ("Cuban Sundays" in "Sambroso Cuban Sundays": "sunday" is generic). Only across two venue rows of one place,
 * with one start as well as one end.
 */
function oneTellingWordWithin(a: string, b: string): boolean {
  const words = (t: string) =>
    coreTitleWords(t)
      .filter((w) => w.length >= 2 && w !== "and")
      .map((w) => foldWeekdayPlural(w));
  const [wa, wb] = [words(a), words(b)];
  if (wa.length === 0 || wb.length === 0) return false;
  const [short, long] = wa.length <= wb.length ? [wa, wb] : [wb, wa];
  if (!short.some((w) => w.length >= 4 && !GENERIC_TITLE_WORDS.includes(w))) return false;
  const longSet = new Set(long);
  return short.every((w) => longSet.has(w));
}

/**
 * D-752: one venue, one listed end, and every core word of one title among the other's (D-522 words, venue name
 * taken off): one night whatever the starts. The venue's site read its 4pm doors as the start ("Bears Are
 * Animals"), RA gave doors at 7pm ("ANIMAL Thursday BEARS ARE ANIMALS w/ Sindri, Daiyah"), both ending 4am.
 */
export function containedTitleSameEnd(a: DedupeSide, b: DedupeSide): boolean {
  if (a.title === undefined || b.title === undefined) return false;
  // D-877: two venue rows of one place count ("Animal NYC" and "Animal" at 307 Meeker Avenue, 158 m apart).
  if (a.venueId === null || b.venueId === null) return false;
  if (!onePlace(a, b) && !oneStreetPointOneStart(a, b)) return false;
  if (!(a.endsAt instanceof Date) || !(b.endsAt instanceof Date)) return false;
  if (a.endsAt.getTime() !== b.endsAt.getTime()) return false;
  return (
    titleWordsWithinBesideVenue(a.title, b.title, a.venueName ?? b.venueName) ||
    (b.venueName !== undefined &&
      b.venueName !== a.venueName &&
      titleWordsWithinBesideVenue(a.title, b.title, b.venueName)) ||
    // Two venue rows only: one source's two rows at one venue keep D-522's two-word rule (Westwood).
    (a.venueId !== b.venueId && oneStart(a, b) && oneTellingWordWithin(a.title, b.title))
  );
}

/**
 * Map English plural weekday words to singular.
 * Input word is already lower-case.
 */
export function foldWeekdayPlural(word: string): string {
  const map: Record<string, string> = {
    mondays: "monday",
    tuesdays: "tuesday",
    wednesdays: "wednesday",
    thursdays: "thursday",
    fridays: "friday",
    saturdays: "saturday",
    sundays: "sunday",
  };
  return map[word] ?? word;
}

/**
 * Whether two titles are the same words after stripping any of the given venue names
 * and folding weekday plurals.
 */
export function sameTitleBesideVenue(
  a: string,
  b: string,
  venueNames: readonly (string | undefined)[],
): boolean {
  // Helper to process a title
  const processTitle = (title: string): string[] => {
    const words = coreTitleWords(title.replace(/@/g, " at "));
    // Try stripping each venue name
    for (const venueName of venueNames) {
      if (!venueName || venueName.trim() === "") continue;
      const venueWords = coreTitleWords(venueName);
      if (venueWords.length === 0) continue;
      const stripped = stripVenue(words, venueWords);
      if (stripped !== null) {
        // Apply weekday plural folding, then filter
        return stripped
          .map((w) => foldWeekdayPlural(w))
          .filter((w) => w.length >= 2 && w !== "and");
      }
    }
    // No venue stripped
    return words.map((w) => foldWeekdayPlural(w)).filter((w) => w.length >= 2 && w !== "and");
  };

  const setA = new Set(processTitle(a));
  const setB = new Set(processTitle(b));

  if (setA.size === 0 || setB.size === 0) return false;
  if (setA.size !== setB.size) return false;

  // Check set equality
  for (const word of setA) {
    if (!setB.has(word)) return false;
  }

  // At least 2 words total
  if (setA.size < 2) return false;

  // At least 1 word not generic
  const hasNonGeneric = [...setA].some((word) => !GENERIC_TITLE_WORDS.includes(word));
  if (!hasNonGeneric) return false;

  return true;
}

export function sharedTitleSegment(a: string, b: string): boolean {
  if (!a || !b) return false;

  // Split each title on :, - , – , — , |
  const segmentSeparators = /[:|]|\s+[-–—]\s+/;

  const segmentsA = a.split(segmentSeparators).filter((s) => s.trim().length > 0);
  const segmentsB = b.split(segmentSeparators).filter((s) => s.trim().length > 0);

  for (const segA of segmentsA) {
    const wordsA = coreTitleWords(segA);
    if (wordsA.length < 2) continue;

    // Check if all words are generic
    const allGeneric = wordsA.every((word) => GENERIC_TITLE_WORDS.includes(word));
    if (allGeneric) continue;

    for (const segB of segmentsB) {
      const wordsB = coreTitleWords(segB);
      if (wordsB.length < 2) continue;

      // Compare word lists
      if (wordsA.length === wordsB.length) {
        let match = true;
        for (let i = 0; i < wordsA.length; i++) {
          if (wordsA[i] !== wordsB[i]) {
            match = false;
            break;
          }
        }
        if (match) {
          return true;
        }
      }
    }
  }

  return false;
}

/**
 * A party's name standing alone as one segment of one title ("BAILE | EMBRASA: DJ SAZE ..."), named again as a word of
 * the other ("Ultimo Embrasa do Ano"): one word of 5+ letters, not a generic word in any metro's language and not the
 * venue's own name (D-741).
 */
export function sharedBrandSegment(a: string, b: string, venueName: string | undefined): boolean {
  if (!a || !b) return false;
  const words = (text: string): string[] =>
    normalizeForCore(text)
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length > 0);
  const venueWords = venueName ? words(venueName) : [];
  const brandIn = (title: string, other: string): boolean => {
    const otherWords = words(other);
    return title.split(/[:|]|\s+[-–—]\s+/).some((segment) => {
      const [word, ...rest] = words(segment);
      return (
        word !== undefined &&
        rest.length === 0 &&
        word.length >= 5 &&
        !GENERIC_TITLE_WORDS.includes(word) &&
        !SHARED_STEM_IGNORE_WORDS.includes(word) &&
        !BRAND_GENERIC_WORDS.includes(word) &&
        !venueWords.includes(word) &&
        otherWords.includes(word)
      );
    });
  };
  return brandIn(a, b) || brandIn(b, a);
}

/**
 * Distance in metres between two points (haversine).
 */
function distanceMetres(
  p1: { lat: number; lng: number },
  p2: { lat: number; lng: number },
): number {
  const R = 6_371_000; // Earth radius in metres
  const lat1 = (p1.lat * Math.PI) / 180;
  const lat2 = (p2.lat * Math.PI) / 180;
  const dLat = ((p2.lat - p1.lat) * Math.PI) / 180;
  const dLng = ((p2.lng - p1.lng) * Math.PI) / 180;

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

/**
 * D-592: one seller's or platform's page for one event, on one night, is one event whatever the
 * starts and whichever source carried it.
 * True when some URL `u` of `a` and some URL `v` of `b` satisfy `sameLink(u, v)` and `isHostedEventPage(u)`.
 */
export function sharedEventPage(a: DedupeSide, b: DedupeSide): boolean {
  const urlsA = [...(a.links ?? []), a.ticketUrl, a.canonicalUrl].filter(
    (url): url is string => url != null,
  );
  const urlsB = [...(b.links ?? []), b.ticketUrl, b.canonicalUrl].filter(
    (url): url is string => url != null,
  );

  for (const u of urlsA) {
    if (!isHostedEventPage(u) && !isHubEventPage(u)) continue;
    for (const v of urlsB) {
      if (sameLink(u, v)) {
        return true;
      }
    }
  }
  return false;
}

/** D-749: both titles carry one venue's name (five letters or more), as whole words. */
function bothNameVenue(a: string, b: string, venues: (string | undefined)[]): boolean {
  const words = (t: string) =>
    normalizeForCore(t)
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
  const ta = ` ${words(a)} `;
  const tb = ` ${words(b)} `;
  return venues.some((v) => {
    if (!v) return false;
    const n = words(v);
    return n.replace(/\s/g, "").length >= 5 && ta.includes(` ${n} `) && tb.includes(` ${n} `);
  });
}

/**
 * D-749: a directory's or hub's page for one event (salsavida.com/event/...), not its city guide,
 * a list or a venue page: it names one event as a seller's page does.
 */
function isHubEventPage(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  const site = getDomain(host) ?? host;
  return (
    isHubSite(site) && looksLikeEventPage(url) && !/\/guides?(?:\/|$)/i.test(new URL(url).pathname)
  );
}

/**
 * Normalize a string: NFD + strip combining accents, lowercase, replace non-alnum runs with space, trim.
 */
function normalizeAddress(s: string): string {
  // NFD and strip combining marks
  const decomposed = s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  // Lowercase
  // D-869: "St George’s Rd" is "St Georges Road": an apostrophe joins its word, it does not split it.
  const lower = decomposed.toLowerCase().replace(/['’ʼ]/g, "");
  // Replace every run of characters that are not [a-z0-9] with one space
  const spaced = lower.replace(/[^a-z0-9]+/g, " ");
  // Trim
  return spaced.trim();
}

/** D-841: joining words in Spanish, Catalan and Portuguese street names, left out when two street lines are compared. */
const STREET_CONNECTIVES = new Set(["de", "del", "d", "do", "da", "dos", "das"]);

/**
 * Map street line words according to the abbreviation table.
 */
function normalizeStreetLine(line: string): string {
  // D-841: "Av. de Francesc Ferrer i Guàrdia" is "Av. Francesc Ferrer i Guàrdia"; "Calle del Pez" is "Calle Pez".
  const words = line.split(" ").filter((word) => word.length > 0 && !STREET_CONNECTIVES.has(word));
  const mapped = words.map((word) => {
    // Whole word mapping
    switch (word) {
      case "w":
        return "west";
      case "e":
        return "east";
      case "n":
        return "north";
      case "s":
        return "south";
      case "st":
        return "street";
      case "rd":
        return "road";
      case "ave":
        return "avenue";
      case "av":
        return "avenue";
      case "blvd":
        return "boulevard";
      case "pl":
        return "place";
      case "ln":
        return "lane";
      case "dr":
        return "drive";
      case "sq":
        return "square";
      case "ct":
        return "court";
      case "hwy":
        return "highway";
      case "pkwy":
        return "parkway";
      case "pk": // D-829: "2611 McGavock Pk" is McGavock Pike
      case "pke":
        return "pike";
      default:
        return word;
    }
  });
  return mapped.join(" ");
}

/**
 * Whether two formatted street addresses are the same after normalisation (D-591).
 */
export function sameStreetAddress(a: string | undefined, b: string | undefined): boolean {
  if (a === undefined || b === undefined) return false;

  const normA = normalizeAddress(a);
  const normB = normalizeAddress(b);
  if (normA === "" || normB === "") return false;

  // Split the original (accent-stripped) address on the first comma
  const getFirstPart = (s: string): string => {
    const decomposed = s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const parts = decomposed.split(/[,;]/); // D-790: "49 Ridley Road; London E8 2NP"
    const firstPart = normalizeAddress(parts[0] ?? "");
    // D-841: "Av. Francesc Ferrer i Gu\u00e0rdia, 13": a bare house number after the comma belongs to the street.
    const next = normalizeAddress(parts[1] ?? "");
    if (!/\d/.test(firstPart) && /^\d{1,4}[a-z]?$/.test(next)) return `${firstPart} ${next}`;
    // D-882: a venue name before the street line ("Juju's Bar and Stage, Ely's Yard, 15 Hanbury Street"): the first
    // of the next parts that opens with a house number and a word is the street line. A postcode part never is.
    if (!/\d/.test(firstPart)) {
      for (const part of parts.slice(1, 4)) {
        const line = normalizeAddress(part);
        if (/^\d{1,4}[a-z]? [a-z]/.test(line)) return line;
      }
    }
    return firstPart;
  };

  const firstPartA = getFirstPart(a);
  const firstPartB = getFirstPart(b);

  // Check house number in both first parts
  const houseNumberPattern = /(^| )\d{1,5}[a-z]?( |$)/;
  if (!houseNumberPattern.test(firstPartA) || !houseNumberPattern.test(firstPartB)) {
    return false;
  }

  // First way: whole normalized addresses are equal
  if (normA === normB) {
    return true;
  }

  // Second way: normalized street lines are equal after word mapping
  const streetLineA = normalizeStreetLine(firstPartA);
  const streetLineB = normalizeStreetLine(firstPartB);

  return streetLineA === streetLineB;
}

/**
 * Two venue rows of one place (D-504): same venue id, or within ONE_PLACE_METRES and their names
 * begin with the same telling word (B.Leza example). Also, within SAME_ADDRESS_METRES at one street
 * address (D-591).
 */
export function onePlace(a: DedupeSide, b: DedupeSide): boolean {
  // 1. If either side has no venue id, they are not one place.
  if (a.venueId === null || b.venueId === null) {
    return false;
  }
  // 2. Same venue id is one place.
  if (a.venueId === b.venueId) {
    return true;
  }
  // 3. Both have points and addresses? Check distance and same street address.
  if (a.venuePoint && b.venuePoint) {
    const dist = distanceMetres(a.venuePoint, b.venuePoint);
    if (dist <= SAME_ADDRESS_METRES && sameStreetAddress(a.venueAddress, b.venueAddress)) {
      return true;
    }
  }
  // D-790: a venue row named by the other row's street address ("49 Ridley Rd, London E8 2NP" beside
  // Ridley Road Market Bar at 49 Ridley Road) is that place, a few hundred metres apart.
  if (
    a.venuePoint &&
    b.venuePoint &&
    distanceMetres(a.venuePoint, b.venuePoint) <= SAME_ADDRESS_NAMED_METRES &&
    (sameStreetAddress(a.venueName, b.venueAddress) ||
      sameStreetAddress(b.venueName, a.venueAddress))
  ) {
    return true;
  }
  // 4. Need venue name and point on both sides.
  if (!a.venueName || !b.venueName || !a.venuePoint || !b.venuePoint) {
    return false;
  }
  // 5. Distance check.
  const dist = distanceMetres(a.venuePoint, b.venuePoint);
  // D-765: one street line geocoded twice is one place a few hundred metres apart, names permitting.
  // D-843: one whole venue name, one street line and one postcode is one place up to SAME_NAME_ADDRESS_METRES.
  const limit = sameStreetAddress(a.venueAddress, b.venueAddress)
    ? sameNameAndPostcode(a.venueName, b.venueName, a.venueAddress, b.venueAddress)
      ? SAME_NAME_ADDRESS_METRES
      : SAME_ADDRESS_NAMED_METRES
    : ONE_PLACE_METRES;
  if (dist > limit) {
    return false;
  }
  // 6. Compute name key for each side.
  const key = (name: string): string | null => {
    const words = coreTitleWords(name);
    // Walk from start, take words up to and including first telling word.
    const taken: string[] = [];
    let foundTelling = false;
    for (const w of words) {
      taken.push(w);
      if (w.length >= 3 && !VENUE_GENERIC_WORDS.includes(w)) {
        foundTelling = true;
        break;
      }
    }
    if (!foundTelling) {
      return null;
    }
    return taken.join(" ");
  };
  const keyA = key(a.venueName);
  const keyB = key(b.venueName);
  // 7. Both keys must be non-null and equal.
  return keyA !== null && keyB !== null && keyA === keyB;
}

export function oneVenueOneStart(a: DedupeSide, b: DedupeSide): boolean {
  if (!onePlace(a, b)) {
    return false;
  }
  if (a.startsAt === null || b.startsAt === null) {
    return false;
  }
  const diff = Math.abs(a.startsAt.getTime() - b.startsAt.getTime());
  return diff <= SAME_NIGHT_START_MINUTES * 60_000;
}

/**
 * One place and one start, or one place and one first time of the evening: one source gives doors
 * and dancing, the other the evening's first time (Super Mario, 2026-11-05). Only for two sources'
 * listings: one source's two listings are matched on their starts alone (D-150).
 */
export function oneVenueOneEvening(a: DedupeSide, b: DedupeSide): boolean {
  if (oneVenueOneStart(a, b)) return true;
  return onePlace(a, b) && firstTimesWithin(a, b, SAME_NIGHT_START_MINUTES);
}

/**
 * The evening's first time: the earliest of its doors, lesson, dancing and start. One source may
 * give doors 18:45 and dancing 22:00 (start 22:00) where another gives 18:30 (Super Mario, 2026-11-05).
 */
export function firstTimeOfEvening(side: DedupeSide): Date | null {
  const all = [side.startsAt, side.times?.doors, side.times?.lesson, side.times?.dancing].filter(
    (t): t is Date => t instanceof Date,
  );
  if (all.length === 0) return null;
  return new Date(Math.min(...all.map((t) => t.getTime())));
}

/** Both evenings' first times are listed and at most `minutes` apart. */
export function firstTimesWithin(a: DedupeSide, b: DedupeSide, minutes: number): boolean {
  const fa = firstTimeOfEvening(a);
  const fb = firstTimeOfEvening(b);
  return fa !== null && fb !== null && Math.abs(fa.getTime() - fb.getTime()) <= minutes * 60_000;
}

/**
 * One night listed by two sources (D-146): titles alike (or one the other's plus a lineup) at one place
 * on one night are one night when the starts are at most 15 minutes apart, when one or both
 * give no time (an untimed copy hides no session), or when one side's source prints its times
 * wrong (the owner's decision, 2026-10-14), or when both end at one moment at one venue: one
 * source gives doors, the other the start (Perreo Inferno, 2026-10-20).
 * Also, when titles are prefix-related, from different sources, at the same venue, same kind,
 * and starts are within CANDIDATE_START_MINUTES (90) minutes, and ends are not too far apart (D-515).
 */
export function sameNight(a: DedupeSide, b: DedupeSide, facts: PairFacts): boolean {
  const titleMatch =
    facts.titleSimilarity >= SAME_NIGHT_TITLE_SIMILARITY ||
    facts.titlePrefix === true ||
    containedTitleSameEnd(a, b);
  if (!titleMatch) return false;

  // If either side has no time, it's still the same night (untimed copy hides no session)
  if (a.startsAt === null || b.startsAt === null) return true;

  // If either source has shifted times, ignore time difference
  if (facts.shiftedSource === true) return true;

  // One venue and one end is one night, whatever the starts: one source gives doors, the other the start
  // Also two venue rows at one point (Do-Over, 2026-11-05).
  if (
    a.endsAt instanceof Date &&
    b.endsAt instanceof Date &&
    a.endsAt.getTime() === b.endsAt.getTime()
  ) {
    // Check if they are at the same place
    if (a.venueId !== null && a.venueId === b.venueId) {
      return true;
    }
    // Or two venue rows at one point (within SAME_ADDRESS_METRES)
    if (a.venuePoint && b.venuePoint) {
      const dist = distanceMetres(a.venuePoint, b.venuePoint);
      if (dist <= SAME_ADDRESS_METRES) {
        return true;
      }
    }
    // Or onePlace (which includes same venue id or within ONE_PLACE_METRES with telling word)
    if (onePlace(a, b)) {
      return true;
    }
  }

  // D-515: two sources' listings of one weekly night at one venue, one title a whole-word prefix of the other,
  // starts up to 90 minutes apart (Viajando's "Sábado Bailables" 8pm, Salsa Vida's "Sábado Bailables at Música
  // Bar & Lounge" 9pm). Never a class with a social; two listed ends over an hour apart are two nights.
  const endsFarApart =
    a.endsAt instanceof Date &&
    b.endsAt instanceof Date &&
    Math.abs(a.endsAt.getTime() - b.endsAt.getTime()) > PREFIX_GAP_END_MINUTES * 60_000;
  if (
    facts.titlePrefix === true &&
    facts.sameSource === false &&
    a.venueId !== null &&
    a.venueId === b.venueId &&
    // Stricter than sameKindOfNight: an untyped ("other") row is not a class here.
    (a.listingType === "class") === (b.listingType === "class") &&
    !endsFarApart &&
    Math.abs(a.startsAt.getTime() - b.startsAt.getTime()) <= CANDIDATE_START_MINUTES * 60_000
  ) {
    return true;
  }

  // Otherwise, check if starts are within SAME_NIGHT_START_MINUTES
  const diff = Math.abs(a.startsAt.getTime() - b.startsAt.getTime());
  return diff <= SAME_NIGHT_START_MINUTES * 60_000;
}

/** A title billing performers ("with Diego", "feat. X", "w/ Y"): those nights differ by who plays. */
export function billsPerformer(title: string): boolean {
  const words = normalizeForCore(title).split(/[^\p{L}\p{N}]+/u);
  return words.some(
    (w) => w === "with" || w === "feat" || w === "ft" || w === "featuring" || w === "w",
  );
}

/** Course-level words: two listings naming different levels are different classes. */
const LEVEL_WORDS = new Set([
  "beginner",
  "beginners",
  "improver",
  "improvers",
  "intermediate",
  "intermediates",
  "advanced",
  "fundamentals",
  "foundations",
  "basics",
]);

/** The level a title names ("level 2", "beginners", "nivel 1"), as a set of tags. */
export function levelTags(title: string): Set<string> {
  const words = normalizeForCore(title)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 0);
  const tags = new Set<string>();
  words.forEach((w, i) => {
    if (LEVEL_WORDS.has(w)) tags.add(w.replace(/s$/, ""));
    const next = words[i + 1];
    if (
      (w === "level" || w === "nivel" || w === "niveau") &&
      next !== undefined &&
      /^\d+$/.test(next)
    ) {
      tags.add(`level ${next}`);
    }
    const short = /^l(\d)$/.exec(w);
    if (short) tags.add(`level ${short[1]}`);
  });
  return tags;
}

/** Both titles name a level and the levels differ: a studio's parallel classes, never one night. */
export function differentLevels(a: string, b: string): boolean {
  const ta = levelTags(a);
  const tb = levelTags(b);
  if (ta.size === 0 || tb.size === 0) return false;
  return ta.size !== tb.size || [...ta].some((t) => !tb.has(t));
}

export function scorePair(a: DedupeSide, b: DedupeSide, facts: PairFacts): Scored {
  const organizer =
    (a.organizerId !== null && a.organizerId === b.organizerId) ||
    (facts.organizerSimilarity !== null && facts.organizerSimilarity >= ORGANIZER_NAME_SIMILARITY)
      ? 1
      : 0;
  const parts = {
    title: WEIGHTS.title * Math.max(0, Math.min(1, facts.titleSimilarity)),
    organizer: WEIGHTS.organizer * organizer,
    url: WEIGHTS.url * (sameUrl(a, b) ? 1 : 0),
    venue: WEIGHTS.venue * (a.venueId !== null && a.venueId === b.venueId ? 1 : 0),
  };
  const score = Math.round((parts.title + parts.organizer + parts.url + parts.venue) * 1000) / 1000;

  // New rule: one venue, same start, and core title prefix or shared segment or words within (D-271)
  const oneVenueOneStartRule =
    a.title !== undefined &&
    b.title !== undefined &&
    (facts.sameSource === false ? oneVenueOneEvening(a, b) : oneVenueOneStart(a, b)) &&
    (genrePrefixedTitle(a.title, b.title) ||
      coreTitlePrefix(a.title, b.title) ||
      sharedTitleSegment(a.title, b.title) ||
      // Not across kinds: a class titled by the social it precedes ("Intro to Lindy Hop: Beginner
      // Class at Midtown Swings") is not that social.
      (titleWordsWithin(a.title, b.title) &&
        (a.listingType === undefined ||
          b.listingType === undefined ||
          a.listingType === b.listingType)) ||
      // D-503: a title that adds the venue's own name at one venue and start
      (venueNamedTitle(a.title, b.title, a.venueName ?? b.venueName) &&
        (a.listingType === undefined ||
          b.listingType === undefined ||
          a.listingType === b.listingType))) &&
    a.cancelled !== true &&
    b.cancelled !== true;

  // D-522: two sources' listings at one place, starts up to 90 min apart (or one untimed), titles alike beside the venue's name
  const venueTitleGapRule =
    a.title !== undefined &&
    b.title !== undefined &&
    facts.sameSource === false &&
    onePlace(a, b) &&
    // either side's startsAt is null (untimed copy hides no session) OR both are set and within CANDIDATE_START_MINUTES
    (a.startsAt === null ||
      b.startsAt === null ||
      Math.abs(a.startsAt.getTime() - b.startsAt.getTime()) <= CANDIDATE_START_MINUTES * 60_000) &&
    // Kind guard: same kind, OR neither title reads as a class and titles are same words beside either venue name
    ((a.listingType === "class") === (b.listingType === "class") ||
      (!isClassLike({ title: a.title, listingType: null }) &&
        !isClassLike({ title: b.title, listingType: null }) &&
        sameTitleBesideVenue(a.title, b.title, [a.venueName, b.venueName]))) &&
    !(
      a.endsAt instanceof Date &&
      b.endsAt instanceof Date &&
      Math.abs(a.endsAt.getTime() - b.endsAt.getTime()) > PREFIX_GAP_END_MINUTES * 60_000
    ) &&
    a.cancelled !== true &&
    b.cancelled !== true &&
    (titleWordsWithinBesideVenue(a.title, b.title, a.venueName ?? b.venueName) ||
      titleWordsWithinBesideVenue(a.title, b.title, b.venueName ?? a.venueName) ||
      titleWordsWithin(a.title, b.title) ||
      sameTitleBesideVenue(a.title, b.title, [a.venueName, b.venueName]));

  // D-549: one venue, one start, two sources, titles sharing 2+ distinctive stems (reworded per platform)
  const sharedStemsRule =
    a.title !== undefined &&
    b.title !== undefined &&
    facts.sameSource === false &&
    oneVenueOneStart(a, b) &&
    // Never classes: a studio's parallel levels share a venue, a start and most title words.
    !isClassLike({ title: a.title, listingType: a.listingType ?? null }) &&
    !isClassLike({ title: b.title, listingType: b.listingType ?? null }) &&
    a.cancelled !== true &&
    b.cancelled !== true &&
    // Performer billings ("Gypsy Jazz with Diego" / "with Ana") are left to the model review.
    !billsPerformer(a.title) &&
    !billsPerformer(b.title) &&
    sharedTitleStems(a.title, b.title, a.venueName ?? b.venueName) >= SHARED_STEM_MIN;

  // D-741: two sources, one venue and start, one title's lone segment naming the party the other title names
  const brandSegmentRule =
    a.title !== undefined &&
    b.title !== undefined &&
    facts.sameSource === false &&
    oneVenueOneStart(a, b) &&
    !isClassLike({ title: a.title, listingType: a.listingType ?? null }) &&
    !isClassLike({ title: b.title, listingType: b.listingType ?? null }) &&
    a.cancelled !== true &&
    b.cancelled !== true &&
    sharedBrandSegment(a.title, b.title, a.venueName ?? b.venueName);

  // D-592: one seller's or platform's page for one event, one night
  const oneEventPageRule =
    a.title !== undefined &&
    b.title !== undefined &&
    sharedEventPage(a, b) &&
    a.cancelled !== true &&
    b.cancelled !== true &&
    // same kind
    (a.listingType === "class") === (b.listingType === "class") &&
    // neither title is class-like unless both are
    isClassLike({ title: a.title, listingType: a.listingType ?? null }) ===
      isClassLike({ title: b.title, listingType: b.listingType ?? null }) &&
    // titles agree
    (titleWordsWithin(a.title, b.title) ||
      coreTitlePrefix(a.title, b.title) ||
      sharedTitleSegment(a.title, b.title) ||
      titleWordsWithinBesideVenue(a.title, b.title, a.venueName ?? b.venueName) ||
      titleWordsWithinBesideVenue(a.title, b.title, b.venueName ?? a.venueName) ||
      sameTitleBesideVenue(a.title, b.title, [a.venueName, b.venueName]) ||
      sharedTitleStems(a.title, b.title, a.venueName ?? b.venueName) >= SHARED_STEM_MIN ||
      // D-749: both titles name the venue ("Salsa Night at Mama Rumba", "Mama Rumba: Salsa Nights")
      bothNameVenue(a.title, b.title, [a.venueName, b.venueName]));

  // D-743: one link, one card. An untimed listing at the same place as a timed one, carrying that
  // listing's event page (seller or platform), is the same night whatever its title (a venue's lineup line).
  const onePageUntimedRule =
    (a.startsAt === null) !== (b.startsAt === null) &&
    sharedEventPage(a, b) &&
    onePlace(a, b) &&
    a.cancelled !== true &&
    b.cancelled !== true &&
    (a.listingType === "class") === (b.listingType === "class") &&
    isClassLike({ title: a.title ?? "", listingType: a.listingType ?? null }) ===
      isClassLike({ title: b.title ?? "", listingType: b.listingType ?? null });

  // Different course levels at one place and time are parallel classes: never merged automatically.
  const levelsDiffer =
    a.title !== undefined && b.title !== undefined && differentLevels(a.title, b.title);
  const decision: Decision = levelsDiffer
    ? score >= REVIEW
      ? "queued"
      : "distinct"
    : score >= AUTO_MERGE ||
        sameNight(a, b, facts) ||
        oneVenueOneStartRule ||
        venueTitleGapRule ||
        sharedStemsRule ||
        brandSegmentRule ||
        oneEventPageRule ||
        onePageUntimedRule ||
        // D-872: a directory's untimed "A-Train" beside the timed "A-Train @ The Hammersmith Club"
        untimedVenueSuffixTwin(a, b, (facts.samePrimarySource ?? facts.sameSource) !== false)
      ? "auto_merge"
      : score >= REVIEW
        ? "queued"
        : "distinct";
  return { score, decision, parts };
}

/**
 * Which listing survives a merge: a live one over a cancelled one (D-283),
 * then the more trusted source (D-006 precedence), then the one seen first,
 * then the lower id so the answer never depends on query order.
 */
export function chooseSurvivor(
  a: DedupeSide,
  b: DedupeSide,
): { survivor: DedupeSide; merged: DedupeSide } {
  const cancelled = (s: DedupeSide) => (s.cancelled === true ? 1 : 0);
  const rank = (s: DedupeSide) => TRUST_ORDER.indexOf(s.trust);
  const order =
    cancelled(a) - cancelled(b) ||
    rank(a) - rank(b) ||
    a.firstSeenAt.getTime() - b.firstSeenAt.getTime() ||
    a.id.localeCompare(b.id);
  return order <= 0 ? { survivor: a, merged: b } : { survivor: b, merged: a };
}

/**
 * Merged listings that disagree on the start time are shown as conflicting, with both values. A
 * listing that gives no time does not disagree with one that does: one source not listing a time
 * is not a second value (D-060 point 11). A start is compared as a start, whatever its kind, since
 * a structured source's unlabelled start is stored as doors (`placeStartTime`), with one exception
 * (D-090): when one side gives only a lesson and the other only dancing, starting up to an hour
 * after the lesson, the two describe one evening (This Week in Swing's "8:30pm lesson" and the
 * organiser's "dancing from 9pm").
 */
export function startsConflict(a: DedupeSide, b: DedupeSide): boolean {
  if (a.startsAt === null || b.startsAt === null) return false;
  if (a.times && b.times) {
    for (const [x, y] of [
      [a.times, b.times],
      [b.times, a.times],
    ] as const) {
      if (onlyKind(x, "lesson") && onlyKind(y, "dancing")) {
        const gap = y.dancing!.getTime() - x.lesson!.getTime();
        if (gap >= 0 && gap <= LESSON_THEN_DANCING_MINUTES * 60_000) return false;
      }
    }
  }
  return Math.abs(a.startsAt.getTime() - b.startsAt.getTime()) > CONFLICT_START_MINUTES * 60_000;
}

function onlyKind(t: EveningTimes, kind: keyof EveningTimes): boolean {
  return (["doors", "lesson", "dancing"] as const).every((k) => (k === kind) === (t[k] !== null));
}

/**
 * True when a merge should give the survivor the merged listing's times: the survivor lists none
 * and the merged listing does. D-006's trust order still picks the survivor; this only fills the
 * gap, with the times' own provenance (D-060 point 11).
 */
export function fillsTime(survivor: DedupeSide, merged: DedupeSide): boolean {
  return survivor.startsAt === null && merged.startsAt !== null;
}

// ---------------------------------------------------------------------------------------------
// The organizer link (D-090): two sources' listings of one night that one organiser runs, told
// from structure, where the score above cannot see them (a directory titles a night differently
// from the organiser's own site).

const brandOf = (domain: string) => domain.split(".")[0] ?? domain;
const PLATFORM_BRANDS = new Set(PLATFORM_SITES.map(brandOf));

/**
 * The organiser's own site a URL is on, or null when it is a platform's shared domain (a ticket
 * seller, a social network, a link page) or not a web address. A tenant of a site builder's
 * private suffix (alhc.square.site, someone.github.io) is that tenant's own site; a platform under
 * another country's suffix (eventbrite.ca) is still the platform.
 */
export function ownSite(url: string | null | undefined): string | null {
  if (!url) return null;
  let host: string;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    host = parsed.hostname.toLowerCase();
  } catch {
    return null;
  }
  const site = getDomain(host, { allowPrivateDomains: true }) ?? null;
  const registrable = getDomain(host) ?? null;
  if (!site || !registrable) return null;
  // A platform's own subdomain on a private suffix (checkout.square.site) is still the platform.
  if (PLATFORM_SITES.includes(site)) return null;
  // A tenant (its private-suffix domain is longer than the registrable one) is its own site.
  if (site !== registrable) return site;
  if (PLATFORM_SITES.includes(registrable) || PLATFORM_BRANDS.has(brandOf(registrable)))
    return null;
  return site;
}

/** True for a hub's domain: a site that lists other organisers' nights beside its own. */
export function isHubSite(site: string): boolean {
  return HUB_SITES.includes(site);
}

/** What the organizer link reads about one listing. */
export interface LinkSide {
  id: string;
  /** The source whose primary listing this is. */
  sourceId: string;
  /** That source's trust tier. */
  trust: TrustTier;
  titleNormalized: string;
  /** `events.listing_type`: a class is never linked to a night that is not one. */
  listingType: string;
  /**
   * The organiser's own sites: the organiser's website, and the source's domain when the source
   * is the organiser's own (first_party). Platforms and hubs never count.
   */
  sites: readonly string[];
  /**
   * The names the organiser goes by, normalised: a first-party source's label and the names the
   * source list says other sites give its nights, and a first-party listing's organiser.
   */
  names: readonly string[];
  startsAt: Date | null;
  /** Projected from a weekly rule rather than dated by the source. */
  fromRule: boolean;
  /**
   * Sources whose listing of this night was merged into this one by an earlier run: this
   * listing's partner from that source is taken, so a second listing of that source that night is
   * another event (a workshop beside the dance), not this one.
   */
  mergedSources?: readonly string[];
}

export type OrganizerLink = "same_site" | "named";

/**
 * A class and a night that is not a class are two listings, whoever runs them: a beginner class
 * before a social is its own card (D-090). "other" (a listing whose kind no source stated) is
 * compatible with anything.
 */
export function sameKindOfNight(a: string, b: string): boolean {
  if (a === "other" || b === "other") return true;
  return (a === "class") === (b === "class");
}

/**
 * Whether one organiser runs both listings, from structure only: they share the organiser's own
 * site (Eventbrite's organiser website is the other source's domain), or a listing that is not
 * first-party is titled exactly by a name of the other's first-party source ("Swing Remix" on
 * This Week in Swing for swingremixnyc.com). Never between two listings of one source, and never
 * between a class and a night that is not one, nor with a listing whose partner from this source
 * an earlier run already merged.
 */
export function organizerLink(a: LinkSide, b: LinkSide): OrganizerLink | null {
  if (a.sourceId === b.sourceId) return null;
  if (a.mergedSources?.includes(b.sourceId) || b.mergedSources?.includes(a.sourceId)) return null;
  if (!sameKindOfNight(a.listingType, b.listingType)) return null;
  if (a.sites.some((s) => b.sites.includes(s))) return "same_site";
  const names = (x: LinkSide, y: LinkSide) =>
    x.trust !== "first_party" &&
    y.trust === "first_party" &&
    x.titleNormalized !== "" &&
    y.names.includes(x.titleNormalized);
  if (names(a, b) || names(b, a)) return "named";
  return null;
}

export interface LinkCandidate {
  a: LinkSide;
  b: LinkSide;
  /** Same venue, points within 150 m, or venue names alike; false when either has no place. */
  near: boolean;
  titleSimilarity: number;
}

export type LinkedPair = LinkCandidate & { link: OrganizerLink };

/** How well two listings' times agree: equal within 15 minutes, one or both not listed, or apart. */
function timeTier(a: LinkSide, b: LinkSide): number {
  if (a.startsAt === null || b.startsAt === null) return 2;
  const apart = Math.abs(a.startsAt.getTime() - b.startsAt.getTime());
  if (apart > CANDIDATE_START_MINUTES * 60_000) return 0;
  return apart <= CONFLICT_START_MINUTES * 60_000 ? 3 : 1;
}

function rank(c: LinkCandidate): number[] {
  return [c.near ? 1 : 0, timeTier(c.a, c.b), (c.a.fromRule ? 0 : 1) + (c.b.fromRule ? 0 : 1)];
}

function compareRanks(x: number[], y: number[]): number {
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i]! - y[i]!;
  return 0;
}

/**
 * The linked pairs to merge: each listing's one best partner among the other source's listings
 * of the night, chosen by place, then time, then dated over rule-projected, and only then by
 * title, which must lead the next partner by LINK_TITLE_MARGIN. A tie is no choice: both stay
 * listed, since a duplicate costs less than a hidden night (D-090). A pair is kept only when each
 * side is the other's choice. A shared site needs a shared place; only a listing titled by the
 * other's organiser vouches for a night with no place.
 */
export function pickLinkedPairs(candidates: readonly LinkCandidate[]): LinkedPair[] {
  const linked = candidates
    .map((c) => ({ ...c, link: organizerLink(c.a, c.b) }))
    .filter((c): c is LinkedPair => c.link !== null)
    .filter((c) => c.near || c.link === "named")
    // A shared site and a night with no time: only titles alike say it is not another event.
    .filter(
      (c) =>
        c.link !== "same_site" ||
        (c.a.startsAt !== null && c.b.startsAt !== null) ||
        c.titleSimilarity >= SAME_SITE_UNTIMED_TITLE,
    )
    .filter((c) => timeTier(c.a, c.b) > 0);
  const partners = new Map<string, Array<{ other: LinkSide; c: LinkedPair }>>();
  for (const c of linked) {
    for (const [self, other] of [
      [c.a, c.b],
      [c.b, c.a],
    ] as const) {
      const key = `${self.id}|${other.sourceId}`;
      partners.set(key, [...(partners.get(key) ?? []), { other, c }]);
    }
  }
  const choice = new Map<string, string | null>();
  for (const [key, list] of partners) {
    const sorted = [...list].sort(
      (x, y) => compareRanks(rank(y.c), rank(x.c)) || y.c.titleSimilarity - x.c.titleSimilarity,
    );
    const [best, next] = sorted;
    if (!best) continue;
    const tied =
      next !== undefined &&
      compareRanks(rank(best.c), rank(next.c)) === 0 &&
      best.c.titleSimilarity - next.c.titleSimilarity < LINK_TITLE_MARGIN;
    choice.set(key, tied ? null : best.other.id);
  }
  return linked.filter(
    (c) =>
      choice.get(`${c.a.id}|${c.b.sourceId}`) === c.b.id &&
      choice.get(`${c.b.id}|${c.a.sourceId}`) === c.a.id,
  );
}
