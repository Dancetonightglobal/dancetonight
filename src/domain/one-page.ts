// D-766: Two listings from one source that point to the same specific event page are one listing,
// as with Canal Zero's two titles and BalletX's two titles.
import { onePlace, sameKindOfNight, type DedupeSide } from "@/src/domain/dedupe";
import { looksLikeEventPage } from "@/src/domain/event-links";
import { sameLink } from "@/src/domain/event-link-matcher";

/** D-766: Two listings from one source that point to the same specific event page are one listing. */
export function onePageTwice(a: DedupeSide, b: DedupeSide): boolean {
  // 1. Neither side is cancelled
  if (a.cancelled === true || b.cancelled === true) {
    return false;
  }

  // 2. Same place, or one side bare (no place, no start) beside a placed copy of the page (D-866: sensualmovementusa
  // "Roofchata Wednesdays" 9pm at 230 5th Ave and its untimed "... at 230 Fifth (Bachata Party)", NYC 2026-11-11).
  const bare = (s: DedupeSide) => !s.venueId && !s.venuePoint && s.startsAt === null;
  const oneBare = bare(a) !== bare(b) && Boolean(a.venueId || b.venueId);
  // D-884: or one side unplaced but timed, one exact title, one start (itsmenna.com "Discostan with Omid Walizadeh,
  // Mansaf Mama" on two of its event pages, one RA ticket link, NYC 2026-11-19).
  const unplaced = (s: DedupeSide) => !s.venueId && !s.venuePoint;
  const sameTitle =
    a.titleNormalized !== undefined &&
    a.titleNormalized !== "" &&
    a.titleNormalized === b.titleNormalized;
  const oneUnplacedTwin =
    unplaced(a) !== unplaced(b) &&
    sameTitle &&
    a.startsAt !== null &&
    b.startsAt !== null &&
    a.startsAt.getTime() === b.startsAt.getTime();
  if (!oneBare && !oneUnplacedTwin && !onePlace(a, b)) {
    return false;
  }

  // 3. One start, or either side untimed: the page's untimed copy beside its timed one (Penthouse Dubai
  // "HOUSE RULES | RICHY AHMED" 10pm and "RICHY AHMED HOUSE RULES", one event page, daily 2026-11-08; D-804).
  if (a.startsAt !== null && b.startsAt !== null && a.startsAt.getTime() !== b.startsAt.getTime()) {
    return false;
  }

  // 4. Same kind of night
  const aType = a.listingType ?? "other";
  const bType = b.listingType ?? "other";
  if (!sameKindOfNight(aType, bType)) {
    return false;
  }

  // 5. Some URL u from [a.ticketUrl, a.canonicalUrl] and some URL v from [b.ticketUrl, b.canonicalUrl]
  // satisfy sameLink(u, v) && looksLikeEventPage(u)
  const aUrls = [a.ticketUrl, a.canonicalUrl].filter((url): url is string => url !== null);
  const bUrls = [b.ticketUrl, b.canonicalUrl].filter((url): url is string => url !== null);

  for (const u of aUrls) {
    for (const v of bUrls) {
      if (sameLink(u, v) && looksLikeEventPage(u)) {
        return true;
      }
    }
  }

  return false;
}
