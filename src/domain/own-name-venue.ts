// D-813: a school's calendar that writes its own name as the venue is placed from the title.
// Example: Swingland's Google Calendar gives every night the location
// "Swingland Swing Dance Classes & Events, TW7, Isleworth", which is the school itself,
// even for a night at another venue ("A-Train @ The Hammersmith Club", "C Jam @ The Bedford").
// When the location names the source's own label and the title names a venue after "@",
// the listing is placed at that title venue, with no address.
// D-871: "Social dancing at <night>" is placed at that night's venue when the calendar also
// contains "<night> @ <venue>" (and no other venue for that night).

export type Where = { name: string | null; address: string | null };

function fold(s: string | null): string {
  if (s === null) return "";
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Cut trailing bracket, dash, pipe as in steps 3-4 of titleVenueOverOwnName. */
function cutVenue(candidate: string): string {
  let trimmed = candidate.trim();
  if (trimmed === "") return trimmed;
  const bracket = trimmed.indexOf(" (");
  if (bracket !== -1) trimmed = trimmed.slice(0, bracket).trim();
  const dash = trimmed.indexOf(" - ");
  if (dash !== -1) trimmed = trimmed.slice(0, dash).trim();
  const pipe = trimmed.indexOf(" | ");
  if (pipe !== -1) trimmed = trimmed.slice(0, pipe).trim();
  return trimmed;
}

/** Whether a string has at least 3 Unicode letters. */
function hasThreeLetters(s: string): boolean {
  const letterMatch = s.match(/\p{L}/gu);
  return !!(letterMatch && letterMatch.length >= 3);
}

export function siblingVenues(titles: readonly string[]): Map<string, string> {
  const map = new Map<string, string>();
  const ambiguous = new Set<string>();

  for (const title of titles) {
    const lastAt = title.lastIndexOf("@");
    if (lastAt === -1) continue;

    const night = title.slice(0, lastAt).trim();
    const venueCandidate = title.slice(lastAt + 1).trim();
    if (night === "" || venueCandidate === "") continue;

    const cutVenueText = cutVenue(venueCandidate);
    if (!hasThreeLetters(night) || !hasThreeLetters(cutVenueText)) continue;

    const key = fold(night);
    const foldedVenue = fold(cutVenueText);

    if (ambiguous.has(key)) continue;

    const existing = map.get(key);
    if (existing !== undefined) {
      if (fold(existing) !== foldedVenue) {
        ambiguous.add(key);
        map.delete(key);
        continue;
      }
      // same venue, keep first spelling
    } else {
      map.set(key, cutVenueText);
    }
  }

  return map;
}

export function titleVenueOverOwnName(
  title: string,
  where: Where,
  ownLabel: string | null,
  siblings?: ReadonlyMap<string, string>,
): Where {
  // 1. Fold case and accents for comparisons only.
  const foldedOwn = fold(ownLabel);
  if (foldedOwn === "") return where;

  const foldedWhereName = fold(where.name);
  if (foldedWhereName === "") return where;
  if (!foldedWhereName.includes(foldedOwn)) return where;

  // 2. Find the LAST "@" in the title.
  const lastAt = title.lastIndexOf("@");
  if (lastAt !== -1) {
    // Existing "@" title handling (unchanged)
    let candidate = title.slice(lastAt + 1).trim();
    if (candidate === "") return where;

    candidate = cutVenue(candidate);
    if (!hasThreeLetters(candidate)) return where;

    return { name: candidate, address: null };
  }

  // 3. No "@": try " at " when siblings are provided.
  if (siblings) {
    // The text after the last " at " (case-insensitive; the greedy ".*" finds the last one).
    const match = /^.* at (.+)$/isu.exec(title);
    if (match?.[1] !== undefined) {
      const afterAt = match[1].trim();
      if (afterAt !== "") {
        const cutAfter = cutVenue(afterAt);
        if (hasThreeLetters(cutAfter)) {
          const key = fold(cutAfter);
          const venue = siblings.get(key);
          if (venue) {
            return { name: venue, address: null };
          }
        }
      }
    }
  }

  return where;
}
