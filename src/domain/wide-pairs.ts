// The wide pass (D-901, the owner 2026-11-27): one night listed by two ticket sites that name the
// club differently or give different times. The candidate SQL in src/pipeline/dedupe.ts only
// pairs listings at one venue row within 90 minutes, so DICE's "LAW" at Althea's Hideaway 8pm and
// RA's "LAW" at Althea's Rooftop 10pm, or "Fire Night Club Vauxhall" beside "Fire", were never
// compared. This decides those pairs in one place:
//
// - "merge": certain by rule. One distinctive title word for word, at one place (venues within
//   NEAR_METRES, or their names share a telling word, or one side has no place), starts at most
//   RULE_START_MINUTES apart or untimed. Or one event page on both.
// - "ask": alike but not certain (one title inside the other, venues up to FAR_METRES apart,
//   starts up to WIDE_START_MINUTES apart, or one exact title at one start anywhere in the city).
//   Queued for the model review (D-150), whose "same and sure" verdict the next pass merges.
// - null: not a pair.
//
// Never: a cancelled listing (D-090), a class beside a non-class, two levels ("Level 1" / "Level 2"),
// a title with no telling word ("Live DJ", "Salsa Night"), or one source's two listings unless they
// share an event page or are one exact title at one start (D-150).

import { GENERIC_TITLE_WORDS, VENUE_GENERIC_WORDS } from "@/config/dedupe";

import {
  coreTitleKey,
  coreTitlePrefix,
  coreTitleWords,
  differentLevels,
  sharedEventPage,
  type DedupeSide,
} from "./dedupe";

/** Venues this close are one place for an exact title. */
export const NEAR_METRES = 400;
/** Two venue names sharing a word are one place only this close: further, it may be a chain's other branch. */
export const NAME_SHARE_METRES = 1500;
/** Venues further apart than this are never asked about, unless one exact title starts at one time. */
export const FAR_METRES = 5000;
/** An exact title at one place merges by rule when the starts are at most this far apart (doors vs start). */
export const RULE_START_MINUTES = 120;
/** No pair is considered when the starts are further apart than this. */
export const WIDE_START_MINUTES = 180;
/** Telling characters an exact title needs before the rule merges it without asking. */
export const RULE_TELLING_CHARS = 6;
/** With no place on one side, the rule merges only titles with this many telling characters. */
export const UNPLACED_TELLING_CHARS = 8;
/** One exact title at one start (within this) is asked about anywhere in the city. */
export const ONE_START_MINUTES = 15;

export type WideVerdict = "merge" | "ask" | null;

/**
 * Words that name no particular night on top of the dedupe generic words: "Live DJ", "All Night Long",
 * "House Party", "Saturday Nights" are titles many venues use on one evening (London scan, 2026-11-27).
 */
export const WIDE_GENERIC_WORDS: readonly string[] = [
  "live",
  "music",
  "nights",
  "club",
  "clubbing",
  "disco",
  "house",
  "techno",
  "hiphop",
  "reggaeton",
  "afrobeats",
  "amapiano",
  "bashment",
  "dancehall",
  "soca",
  "funk",
  "soul",
  "jazz",
  "rnb",
  "garage",
  "rooftop",

  "session",
  "sessions",
  "vibes",
  "throwback",
  "throwbacks",
  "long",
  "late",
  "after",
  "afterparty",
  "afters",
  "every",
  "free",
  "entry",
  "presents",
  "special",
  "guest",
  "guests",
  "edition",
  "weekly",
  "monthly",
  "weekend",
  "friday",
  "fridays",
  "saturday",
  "saturdays",
  "sunday",
  "sundays",
  "monday",
  "mondays",
  "tuesday",
  "tuesdays",
  "wednesday",
  "wednesdays",
  "thursday",
  "thursdays",
  "tonight",
  "evening",

  "official",
];

const GENERIC = new Set([...GENERIC_TITLE_WORDS, ...WIDE_GENERIC_WORDS]);
const VENUE_GENERIC = new Set(VENUE_GENERIC_WORDS);

/** The title's telling words: four letters or more, not a dance, a night or a filler word. */
export function tellingWords(title: string): string[] {
  return coreTitleWords(title).filter((w) => w.length >= 4 && !GENERIC.has(w));
}

function venueWords(name: string | undefined): Set<string> {
  if (!name) return new Set();
  return new Set(coreTitleWords(name).filter((w) => w.length >= 4 && !VENUE_GENERIC.has(w)));
}

/** "Fire Night Club Vauxhall" and "Fire"; "The Cornershop Bar" and "The Cornershop". */
export function venueNamesShare(a: string | undefined, b: string | undefined): boolean {
  const wa = venueWords(a);
  for (const w of venueWords(b)) if (wa.has(w)) return true;
  return false;
}

function metresBetween(p: { lat: number; lng: number }, q: { lat: number; lng: number }): number {
  const r = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(q.lat - p.lat);
  const dLng = toRad(q.lng - p.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(p.lat)) * Math.cos(toRad(q.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(h));
}

const unplaced = (s: DedupeSide) => s.venueId === null && s.venuePoint === undefined;

/** Two different pages on one ticket seller (dice.fm/event/abc, dice.fm/event/xyz) are two of its events. */
function twoPagesOneSeller(a: DedupeSide, b: DedupeSide): boolean {
  if (a.ticketUrl === null || b.ticketUrl === null || a.ticketUrl === b.ticketUrl) return false;
  try {
    return new URL(a.ticketUrl).hostname === new URL(b.ticketUrl).hostname;
  } catch {
    return false;
  }
}

const DANCE_WORDS = new Set([
  "salsa",
  "bachata",
  "kizomba",
  "zouk",
  "tango",
  "milonga",
  "practica",
  "swing",
  "lindy",
  "blues",
  "balboa",
  "shag",
  "ballroom",
  "hustle",
  "wcs",
  "contra",
  "country",
  "line",
  "folk",
  "ceilidh",
  "reggaeton",
  "afrobeats",
  "amapiano",
  "techno",
  "house",
  "disco",
  "kpop",
  "forro",
  "samba",
  "cumbia",
  "merengue",
  "timba",
  "rueda",
  "semba",
  "kuduro",
  "dancehall",
  "soca",
  "bhangra",
  "ecstatic",
]);

function danceWords(title: string): Set<string> {
  return new Set(coreTitleWords(title).filter((w) => DANCE_WORDS.has(w)));
}

/** Both titles have the same set of telling words, enough of them to name one night. */
export function sameTellingWords(a: string, b: string): boolean {
  // "Kizomba Night with DJ Alexandre" and "Salsa Night with DJ Alexandre" are two nights: the dances must match too.
  const da = danceWords(a);
  const db = danceWords(b);
  if (da.size !== db.size || [...da].some((w) => !db.has(w))) return false;
  const wa = new Set(tellingWords(a));
  const wb = new Set(tellingWords(b));
  // Two words at least: one shared place name ("Wimbledon") is not one night (D-869's two house numbers).
  if (wa.size < 2 || wa.size !== wb.size) return false;
  for (const w of wa) if (!wb.has(w)) return false;
  return [...wa].join("").length >= RULE_TELLING_CHARS;
}

/** Three quarters of the shorter title's telling words are in the other's. */
function mostWordsShared(a: string, b: string): boolean {
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  const words = tellingWords(short);
  if (words.length === 0) return false;
  const other = new Set(tellingWords(long));
  return words.filter((w) => other.has(w)).length / words.length >= 0.75;
}

/** Two listed ends more than this apart are two sessions, whatever else matches. */
export const ENDS_APART_MINUTES = 60;

export function widePairVerdict(a: DedupeSide, b: DedupeSide, sameSource: boolean): WideVerdict {
  if (a.cancelled || b.cancelled) return null;
  if ((a.listingType === "class") !== (b.listingType === "class")) return null;
  if (!a.title || !b.title) return null;
  if (differentLevels(a.title, b.title)) return null;
  if (twoPagesOneSeller(a, b)) return null;
  if (
    a.endsAt instanceof Date &&
    b.endsAt instanceof Date &&
    Math.abs(a.endsAt.getTime() - b.endsAt.getTime()) > ENDS_APART_MINUTES * 60_000
  ) {
    return null;
  }

  const gap =
    a.startsAt !== null && b.startsAt !== null
      ? Math.abs(a.startsAt.getTime() - b.startsAt.getTime()) / 60_000
      : null;
  if (gap !== null && gap > WIDE_START_MINUTES) return null;

  // A source's list page shared by two rows is not one event: sharedEventPage counts event pages only.
  const link = sharedEventPage(a, b);
  const keyA = coreTitleKey(a.title);
  // One title, or the same telling words in any spelling around them ("Candy w/ Special Guest Ana Julieta" on
  // DICE, "Candy with Special Guest Ana Julieta" on RA, London 2026-11-28).
  const exact =
    (keyA !== "" && keyA === coreTitleKey(b.title)) || sameTellingWords(a.title, b.title);
  const contained = !exact && coreTitlePrefix(a.title, b.title);
  // One link with two unalike titles is a page that lists several nights, not one; with one event page,
  // titles that share most telling words are one night ("Mutate: LUCIID w/ Callush 360º Stage" / "... 360°").
  if (!exact && !contained && !(link && mostWordsShared(a.title, b.title))) return null;

  // The shorter title must say something of its own.
  const shorter = a.title.length <= b.title.length ? a.title : b.title;
  const telling = tellingWords(shorter);
  if (telling.length === 0) return null;

  // One source's two listings: only one event page, or one exact title at one start.
  if (sameSource && !link && !(exact && gap === 0)) return null;

  const dist =
    a.venuePoint !== undefined && b.venuePoint !== undefined
      ? metresBetween(a.venuePoint, b.venuePoint)
      : null;
  const eitherUnplaced = unplaced(a) || unplaced(b);
  const onePlace =
    eitherUnplaced ||
    (a.venueId !== null && a.venueId === b.venueId) ||
    (dist !== null && dist <= NEAR_METRES) ||
    // A shared name across a city is a chain's two branches ("Bubba Oasis Islington" / "Clapham").
    (venueNamesShare(a.venueName, b.venueName) && (dist === null || dist <= NAME_SHARE_METRES));

  if (link && onePlace && (gap === null || gap <= RULE_START_MINUTES)) return "merge";
  const tellingChars = telling.join("").length;
  // No place on one side is weaker evidence: a longer title and one start (or no time) are needed.
  const ruleSure = eitherUnplaced
    ? tellingChars >= UNPLACED_TELLING_CHARS && (gap === null || gap <= ONE_START_MINUTES)
    : tellingChars >= RULE_TELLING_CHARS && (gap === null || gap <= RULE_START_MINUTES);
  if (exact && onePlace && ruleSure) return "merge";

  const inReach = onePlace || (dist !== null && dist <= FAR_METRES);
  const oneStartAnywhere = exact && gap !== null && gap <= ONE_START_MINUTES;
  if (inReach || oneStartAnywhere) return "ask";
  return null;
}
