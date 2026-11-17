// D-806: two sources' copies of one night, one or both with no place, at one
// start, one title at the head of the other (or after one promoter word) are one night (daily report 2026-11-08).

import { GENERIC_TITLE_WORDS, UNPLACED_SAME_TITLE_MIN_CHARS } from "@/config/dedupe";
import { coreTitleWords, type DedupeSide } from "@/src/domain/dedupe";
import { isClassLike } from "@/src/domain/class-like";

export function unplacedTitlePrefix(
  a: DedupeSide,
  b: DedupeSide,
  sameSource: boolean,
  metroName?: string,
): boolean {
  // 1. sameSource must be false
  if (sameSource) {
    return false;
  }

  // 2. Neither side cancelled
  if (a.cancelled === true || b.cancelled === true) {
    return false;
  }

  // 3. At least one side is unplaced
  const aUnplaced = !a.venueId && !a.venuePoint;
  const bUnplaced = !b.venueId && !b.venuePoint;
  if (!aUnplaced && !bUnplaced) {
    return false;
  }

  // 4. Both startsAt are Date objects with equal getTime()
  if (!(a.startsAt instanceof Date) || !(b.startsAt instanceof Date)) {
    return false;
  }
  if (a.startsAt.getTime() !== b.startsAt.getTime()) {
    return false;
  }

  // 5. Both title are non-empty strings
  if (!a.title || !b.title) {
    return false;
  }

  // Two pages on one seller are two of its events (Capulet Ball, dice /abc vs /xyz; as D-751).
  const host = (url: string) => url.split("://")[1]?.split("/")[0]?.toLowerCase() ?? "";
  if (a.ticketUrl && b.ticketUrl && a.ticketUrl !== b.ticketUrl) {
    if (host(a.ticketUrl) === host(b.ticketUrl)) return false;
  }

  // 6. Neither side is class-like
  const aClassLike = isClassLike({
    title: a.title,
    listingType: a.listingType ?? null,
  });
  const bClassLike = isClassLike({
    title: b.title,
    listingType: b.listingType ?? null,
  });
  if (aClassLike || bClassLike) {
    return false;
  }

  // Get core words for each title
  const wa = coreTitleWords(a.title);
  const wb = coreTitleWords(b.title);

  // Normalize words: remove accents for comparison
  const normalizeWord = (w: string): string => {
    return w
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
  };

  // D-842: the metro's own name leading a title ("London Ceilidh Club ...") says nothing; drop it.
  const metroWords = metroName ? coreTitleWords(metroName).map(normalizeWord) : [];
  const withoutMetro = (ws: string[]): string[] =>
    metroWords.length > 0 &&
    ws.length > metroWords.length &&
    metroWords.every((w, i) => ws[i] === w)
      ? ws.slice(metroWords.length)
      : ws;

  const normalizedWa = withoutMetro(wa.map(normalizeWord));
  const normalizedWb = withoutMetro(wb.map(normalizeWord));

  // Determine short and long lists
  let short: string[], long: string[];
  if (normalizedWa.length <= normalizedWb.length) {
    short = normalizedWa;
    long = normalizedWb;
  } else {
    short = normalizedWb;
    long = normalizedWa;
  }

  // 7. short.join("") has at least UNPLACED_SAME_TITLE_MIN_CHARS characters
  if (short.join("").length < UNPLACED_SAME_TITLE_MIN_CHARS) {
    return false;
  }

  // 8. short has a word of length >= 4 not in GENERIC_TITLE_WORDS, and two non-generic words ("Salsa Night" alone
  // never pairs an unplaced copy with a placed one, D-150).
  const telling = short.filter((w) => !GENERIC_TITLE_WORDS.includes(w));
  if (telling.length < 2 || !telling.some((w) => w.length >= 4)) {
    return false;
  }

  // Check prefix conditions
  // 9a. HEAD: long.slice(0, short.length) equals short word for word
  const headMatch = short.every((word, i) => word === long[i]);

  // 9b. PROMOTER: short.length >= 3, long.length === short.length + 1, and long.slice(1) equals short
  const promoterMatch =
    short.length >= 3 &&
    long.length === short.length + 1 &&
    short.every((word, i) => word === long[i + 1]);

  return headMatch || promoterMatch;
}
