// D-803: two sources' listings with one exact title and one start at two venue rows
// within 1.5 km are one night (FIRE London "Fuego", House of Yes, Rio TLT Bar; daily report 2026-11-08).

import type { DedupeSide } from "@/src/domain/dedupe";
import { withoutClosingTime } from "@/src/domain/title-starts-apart";
import { GENERIC_TITLE_WORDS } from "@/config/dedupe";
import { isClassLike } from "@/src/domain/class-like";

export const NEAR_VENUES_METRES = 1500;
export const NEAR_VENUES_END_MINUTES = 60;

function distanceMetres(p: { lat: number; lng: number }, q: { lat: number; lng: number }): number {
  const R = 6371000; // Earth's radius in metres
  const lat1 = (p.lat * Math.PI) / 180;
  const lat2 = (q.lat * Math.PI) / 180;
  const dLat = ((q.lat - p.lat) * Math.PI) / 180;
  const dLng = ((q.lng - p.lng) * Math.PI) / 180;

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

export function sameTitleNearVenues(a: DedupeSide, b: DedupeSide, sameSource: boolean): boolean {
  // 1. sameSource must be false
  if (sameSource) {
    return false;
  }

  // 2. Neither side cancelled
  if (a.cancelled === true || b.cancelled === true) {
    return false;
  }

  // 3. Both startsAt are non-null and equal
  if (!(a.startsAt instanceof Date) || !(b.startsAt instanceof Date)) {
    return false;
  }
  if (a.startsAt.getTime() !== b.startsAt.getTime()) {
    return false;
  }

  // 4. Both titleNormalized are non-empty strings and equal without closing time tail
  if (!a.titleNormalized || !b.titleNormalized) {
    return false;
  }
  const titleA = withoutClosingTime(a.titleNormalized);
  const titleB = withoutClosingTime(b.titleNormalized);
  if (titleA !== titleB) {
    return false;
  }

  // 5. Title has at least one word of 4+ chars not in GENERIC_TITLE_WORDS,
  //    and title without spaces is at least 5 chars
  const words = titleA.split(" ");
  const hasValidWord = words.some((w) => w.length >= 4 && !GENERIC_TITLE_WORDS.includes(w));
  const withoutSpaces = titleA.replace(/\s+/g, "");
  if (!hasValidWord || withoutSpaces.length < 5) {
    return false;
  }

  // 6. Both venueId and venuePoint are set, and distance <= NEAR_VENUES_METRES
  if (!a.venueId || !b.venueId) {
    return false;
  }
  if (!a.venuePoint || !b.venuePoint) {
    return false;
  }
  const dist = distanceMetres(a.venuePoint, b.venuePoint);
  if (dist > NEAR_VENUES_METRES) {
    return false;
  }

  // 7. Neither side is class-like
  const aClassLike = isClassLike({
    title: a.title ?? a.titleNormalized,
    listingType: a.listingType ?? null,
  });
  const bClassLike = isClassLike({
    title: b.title ?? b.titleNormalized,
    listingType: b.listingType ?? null,
  });
  if (aClassLike || bClassLike) {
    return false;
  }

  // 8. If both endsAt are Date objects, they differ by at most NEAR_VENUES_END_MINUTES
  if (a.endsAt instanceof Date && b.endsAt instanceof Date) {
    const endDiff = Math.abs(a.endsAt.getTime() - b.endsAt.getTime());
    if (endDiff > NEAR_VENUES_END_MINUTES * 60_000) {
      return false;
    }
  }

  return true;
}
