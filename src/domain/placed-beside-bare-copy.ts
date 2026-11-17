// D-864: a copy with no place and no time beside another source's placed, timed copy with one exact telling title is
// one night (Barcelona "Wave Fest x Bad Decisions": DICE 11pm at Sala Bikini, RA untimed "Location not listed",
// daily report 2026-11-11).

import { GENERIC_TITLE_WORDS, UNPLACED_SAME_TITLE_MIN_CHARS } from "@/config/dedupe";
import { type DedupeSide } from "@/src/domain/dedupe";
import { isClassLike } from "@/src/domain/class-like";

export function placedBesideBareCopy(a: DedupeSide, b: DedupeSide, sameSource: boolean): boolean {
  // 1. sameSource must be false
  if (sameSource) {
    return false;
  }

  // 2. Neither side cancelled
  if (a.cancelled === true || b.cancelled === true) {
    return false;
  }

  // 3. Determine which side is bare and which is placed
  const aBare = !a.venueId && !a.venuePoint && a.startsAt === null;
  const bBare = !b.venueId && !b.venuePoint && b.startsAt === null;
  const aPlaced = a.startsAt instanceof Date && !!a.venueId;
  const bPlaced = b.startsAt instanceof Date && !!b.venueId;

  // Exactly one side bare and the other side placed
  if (!((aBare && bPlaced) || (bBare && aPlaced))) {
    return false;
  }

  // 4. Both titleNormalized non-empty and equal
  const normA = a.titleNormalized ?? "";
  const normB = b.titleNormalized ?? "";
  if (!normA || !normB || normA !== normB) {
    return false;
  }

  // 5. Title without spaces has at least UNPLACED_SAME_TITLE_MIN_CHARS characters
  const lettersOnly = normA.replace(/\s/g, "");
  if (lettersOnly.length < UNPLACED_SAME_TITLE_MIN_CHARS) {
    return false;
  }

  // 6. At least two non-generic words, one of length >= 4
  const words = normA.split(" ").filter((w) => w.length > 0);
  const nonGeneric = words.filter((w) => !GENERIC_TITLE_WORDS.includes(w));
  if (nonGeneric.length < 2 || !nonGeneric.some((w) => w.length >= 4)) {
    return false;
  }

  // 7. Two pages on one seller are two events
  const host = (url: string): string => {
    const afterProto = url.split("://")[1] ?? "";
    return afterProto.split("/")[0]?.toLowerCase() ?? "";
  };
  if (a.ticketUrl && b.ticketUrl && a.ticketUrl !== b.ticketUrl) {
    if (host(a.ticketUrl) === host(b.ticketUrl)) {
      return false;
    }
  }

  // 8. Neither side is class-like
  const aClassLike = isClassLike({
    title: a.title ?? a.titleNormalized ?? "",
    listingType: a.listingType ?? null,
  });
  const bClassLike = isClassLike({
    title: b.title ?? b.titleNormalized ?? "",
    listingType: b.listingType ?? null,
  });
  if (aClassLike || bClassLike) {
    return false;
  }

  return true;
}
