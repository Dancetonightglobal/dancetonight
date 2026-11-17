// D-882: German joins a dance word to what the night is ("Walzerfrühstück", "Tangoabend", "Salsakurs"), so the
// dance word is no token of its own. Tails are normalizeForMatch output (no diacritics, lower case).
const TAILS = [
  "fruhstuck",
  "nachmittag",
  "workshop",
  "matinee",
  "brunch",
  "abend",
  "nacht",
  "party",
  "disco",
  "treff",
  "fest",
  "ball",
  "cafe",
  "kurs",
  "tanz",
  "gala",
  "tee",
] as const;

/** The head of a compound ending in one of TAILS, at least 4 letters long; else null. */
export function compoundHead(token: string): string | null {
  for (const tail of TAILS) {
    if (token.length - tail.length >= 4 && token.endsWith(tail))
      return token.slice(0, -tail.length);
  }
  return null;
}
