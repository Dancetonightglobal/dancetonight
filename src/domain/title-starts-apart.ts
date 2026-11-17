// D-769: Two sources' listings at one venue with one exact title and starts up to 3 hours apart are one night
// (NOTO "PTO Thursdays: Mha Iri", 8pm on the venue's page, 10pm on DICE, Philadelphia 2026-11-12).
import { GENERIC_TITLE_WORDS } from "@/config/dedupe";
import { coreTitleWords, onePlace, sameKindOfNight, type DedupeSide } from "@/src/domain/dedupe";

export const TITLE_STARTS_APART_MINUTES = 180;
export const TITLE_STARTS_APART_END_MINUTES = 60;

/** D-790: a closing-time tail on a normalised title ("club mix till 4am"); the same pattern runs in the SQL. */
export const CLOSING_TIME_TAIL =
  " (till|until|til) ([0-9]{1,2}( [0-9]{2})? ?(am|pm|h)?|late|close|dawn|midnight|sunrise)$";

/** The normalised title without its closing-time tail; a title that is only the tail stays as it is. */
export function withoutClosingTime(titleNormalized: string): string {
  const cut = titleNormalized.replace(new RegExp(CLOSING_TIME_TAIL), "");
  return cut === "" ? titleNormalized : cut;
}

export function oneTitleStartsApart(a: DedupeSide, b: DedupeSide): boolean {
  // 1. Neither side is cancelled
  if (a.cancelled === true || b.cancelled === true) {
    return false;
  }

  // 2. Same place
  if (!onePlace(a, b)) {
    return false;
  }

  // 3. Both titleNormalized are non-empty strings and equal without a closing-time tail (D-790)
  if (!a.titleNormalized || !b.titleNormalized) {
    return false;
  }
  const titleA = withoutClosingTime(a.titleNormalized);
  if (titleA !== withoutClosingTime(b.titleNormalized)) {
    return false;
  }

  // 4. a.title is non-empty and has at least 2 distinct non-generic words
  if (!a.title) {
    return false;
  }
  const words = coreTitleWords(a.title);
  const distinctNonGeneric = new Set(words.filter((w) => !GENERIC_TITLE_WORDS.includes(w)));
  if (distinctNonGeneric.size < 2) {
    return false;
  }
  const shared = new Set(coreTitleWords(titleA).filter((w) => !GENERIC_TITLE_WORDS.includes(w)));
  if (shared.size < 2) {
    return false;
  }

  // 5. Both startsAt are Dates and within TITLE_STARTS_APART_MINUTES
  if (!(a.startsAt instanceof Date) || !(b.startsAt instanceof Date)) {
    return false;
  }
  const startDiff = Math.abs(a.startsAt.getTime() - b.startsAt.getTime());
  if (startDiff > TITLE_STARTS_APART_MINUTES * 60_000) {
    return false;
  }

  // 6. If both endsAt are Dates, they must be within TITLE_STARTS_APART_END_MINUTES
  if (a.endsAt instanceof Date && b.endsAt instanceof Date) {
    const endDiff = Math.abs(a.endsAt.getTime() - b.endsAt.getTime());
    if (endDiff > TITLE_STARTS_APART_END_MINUTES * 60_000) {
      return false;
    }
  }

  // 7. Same kind of night and neither is "class"
  const ta = a.listingType ?? "other";
  const tb = b.listingType ?? "other";
  if (!sameKindOfNight(ta, tb)) {
    return false;
  }
  if (ta === "class" || tb === "class") {
    return false;
  }

  return true;
}
