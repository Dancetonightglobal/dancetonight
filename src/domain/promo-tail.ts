/**
 * Remove promotional tails from a title: start-time lines and sales badges.
 *
 * D-825: Penthouse Dubai's cards print the title, then "FROM 8PM", then a "🔥SELLING FAST" badge.
 * A read that runs them together stored "SKYLINE THURSDAYS FROM 8PM 🔥SELLING FAST" beside
 * "SKYLINE THURSDAYS" for the same night, and both were listed.
 *
 * Strips such tails when tidying a title.
 *
 * @param title - The raw title string.
 * @returns The title with promotional tails removed, trimmed.
 */
export function removePromoTail(title: string): string {
  let t = title.trim();

  // Helper to check if a string contains at least one Unicode letter.
  const hasLetter = (s: string): boolean => /\p{L}/u.test(s);

  // Keep removing tails until no change.
  while (true) {
    const before = t;

    // 1. Sales badge
    const badgePattern =
      /(?:[\s\-–—|·,]+(?:\(?)(?:🔥*)(?:ALMOST SOLD OUT|SOLD OUT|SELLING FAST|FULLY REDEEMABLE|LAST TICKETS|FEW TICKETS LEFT)(?:🔥*)(?:\)?))$/iu;
    t = t.replace(badgePattern, "");
    t = t.replace(/[\s\-–—|·,]+$/u, "").trim();

    // 2. Start-time line
    const timePattern = /\s+FROM\s+\d{1,2}(?::\d{2})?\s*(?:AM|PM|A\.M\.|P\.M\.)(?:🔥*)$/iu;
    t = t.replace(timePattern, "");
    t = t.replace(/[\s\-–—|·,]+$/u, "").trim();

    // 3. Fire emojis alone at the end
    const firePattern = /\s+🔥+$/u;
    t = t.replace(firePattern, "");
    t = t.replace(/[\s\-–—|·,]+$/u, "").trim();

    // 4. A price after a separator (D-875: Eagle NYC "🎧 DJ X | $10 CASH COVER"). The separator is
    // required, so a title that opens with its price ("$5 Salsa Night") keeps it. After a dash the
    // price needs a cover word: "Students 16–18 – $10" names a ticket, not a tail.
    const price = String.raw`(?:[$£€]\s?\d+(?:[.,]\d{2})?|\d+(?:[.,]\d{2})?\s?[$£€])`;
    const cover = String.raw`(?:CASH\s+COVER|COVER|CASH|ENTRY|AT\s+THE\s+DOOR|ON\s+THE\s+DOOR)`;
    const barPrice = new RegExp(String.raw`\s*[|·]\s*${price}(?:\s+${cover})?\s*$`, "iu");
    const dashPrice = new RegExp(String.raw`\s*[–—-]\s*${price}\s+${cover}\s*$`, "iu");
    t = t.replace(barPrice, "").replace(dashPrice, "");
    t = t.replace(/[\s\-–—|·,]+$/u, "").trim();

    // Ensure we never leave a title with no letters.
    if (!hasLetter(t)) {
      return before;
    }

    // If no change, we're done.
    if (t === before) {
      break;
    }
  }

  return t;
}
