// D-872: a directory's untimed copy whose whole title is the other copy's title less " @ <venue>" is one night
// (London: Swing Out London's untimed "A-Train" / "C Jam" beside Swingland's 19:00 "A-Train @ The Hammersmith
// Club" / "C Jam @ The Bedford", 2026-11-12). D-522's two-word floor drops the one-letter word and keeps them apart.

import type { DedupeSide } from "@/src/domain/dedupe";
import { GENERIC_TITLE_WORDS } from "@/config/dedupe";
import { isClassLike } from "@/src/domain/class-like";

function normalize(str: string): string {
  return str.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

const GENERIC_SET = new Set<string>(GENERIC_TITLE_WORDS);

function isTelling(title: string): boolean {
  const normalized = normalize(title);
  // split on any sequence of non-letter/non-digit characters (Unicode aware)
  const tokens = normalized.split(/[^\p{L}\p{N}]+/u).filter((t) => t.length > 0);
  for (const token of tokens) {
    // token must contain at least one letter
    if (/\p{L}/u.test(token)) {
      // token must NOT be a generic word
      if (!GENERIC_SET.has(token)) {
        return true;
      }
    }
  }
  return false;
}

export function untimedVenueSuffixTwin(a: DedupeSide, b: DedupeSide, sameSource: boolean): boolean {
  // 1. sameSource must be false
  if (sameSource) {
    return false;
  }

  // 2. Exactly one side untimed
  const aHasTime = a.startsAt instanceof Date;
  const bHasTime = b.startsAt instanceof Date;
  if (aHasTime === bHasTime) {
    return false;
  }
  const untimed = aHasTime ? b : a;
  const timed = aHasTime ? a : b;

  // 3. Both venue IDs non-null and equal
  if (!untimed.venueId || !timed.venueId || untimed.venueId !== timed.venueId) {
    return false;
  }

  // 4. Neither cancelled
  if (untimed.cancelled === true || timed.cancelled === true) {
    return false;
  }

  // 5. Untimed side must be a directory
  if (untimed.trust !== "directory") {
    return false;
  }

  // 6. Same kind (both class or both social) and same class-like status
  const aIsClass = a.listingType === "class";
  const bIsClass = b.listingType === "class";
  if (aIsClass !== bIsClass) {
    return false;
  }
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

  // 7. Title matching with venue suffix
  const u = normalize(untimed.title ?? "");
  const tRaw = timed.title ?? "";
  if (u === "" || tRaw === "") {
    return false;
  }
  // Normalize timed title, with one space either side of "@" (normalize collapses the spaces around "at")
  const t = normalize(tRaw.replace(/\s*@\s*/g, " @ "));

  // Collect candidate venue names from both sides
  const candidateNames: string[] = [];
  for (const venueName of [timed.venueName, untimed.venueName]) {
    if (venueName && venueName.trim() !== "") {
      // take part before first comma
      const beforeComma = venueName.split(",")[0]!.trim();
      const normName = normalize(beforeComma).replace(/^the /, "");
      candidateNames.push(normName);
    }
  }

  let suffixMatch = false;
  for (const name of candidateNames) {
    if (
      t === `${u} @ ${name}` ||
      t === `${u} @ the ${name}` ||
      t === `${u} at ${name}` ||
      t === `${u} at the ${name}`
    ) {
      suffixMatch = true;
      break;
    }
  }
  if (!suffixMatch) {
    return false;
  }

  // 8. Untimed title must be telling
  if (!isTelling(untimed.title ?? "")) {
    return false;
  }

  return true;
}
