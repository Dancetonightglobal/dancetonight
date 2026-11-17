// D-817: a directory's copy gives way to the venue's own copy of the night
// El Cafe Latino: Salsa Vida Tokyo guide lists "El Café Latino Roppongi" at 19:30,
// venue's own source lists "Latin Social at El Cafe Latino" at 21:00 on Tue/Thu/Fri.

import type { DedupeSide } from "@/src/domain/dedupe";
import { CANDIDATE_START_MINUTES } from "@/config/dedupe";
import { isClassLike } from "@/src/domain/class-like";

export function directoryBesideOwn(a: DedupeSide, b: DedupeSide, sameSource: boolean): boolean {
  // 1. sameSource must be false
  if (sameSource) {
    return false;
  }

  // 2. Both at same venue
  if (!a.venueId || a.venueId !== b.venueId) {
    return false;
  }

  // 3. One directory, one first_party
  const aIsDir = a.trust === "directory";
  const bIsDir = b.trust === "directory";
  const aIsFirst = a.trust === "first_party";
  const bIsFirst = b.trust === "first_party";
  if (!(aIsDir && bIsFirst) && !(aIsFirst && bIsDir)) {
    return false;
  }

  // 4. Neither side cancelled
  if (a.cancelled === true || b.cancelled === true) {
    return false;
  }

  // 5. Both startsAt non-null and within CANDIDATE_START_MINUTES
  if (!(a.startsAt instanceof Date) || !(b.startsAt instanceof Date)) {
    return false;
  }
  const startDiff = Math.abs(a.startsAt.getTime() - b.startsAt.getTime());
  if (startDiff > CANDIDATE_START_MINUTES * 60_000) {
    return false;
  }

  // 6. Both class-like or neither (directory's class beside venue's social is two listings)
  const aClassLike = isClassLike({
    title: a.title ?? "",
    listingType: a.listingType ?? null,
  });
  const bClassLike = isClassLike({
    title: b.title ?? "",
    listingType: b.listingType ?? null,
  });
  if (aClassLike !== bClassLike) {
    return false;
  }

  return true;
}
