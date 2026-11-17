import type { SeedSource } from "@/config/sources/nyc";
import type { HarvestedListing } from "@/src/adapters/types";

/**
 * Check if a raw title matches the danceCard pattern, indicating a club night (D-292).
 * Returns false if card is undefined or card.danceCard is undefined.
 * Safe for regexes with g or y flags: resets lastIndex before testing.
 */
export function isDanceCard(title: string, card: SeedSource["cardTitle"]): boolean {
  if (!card?.danceCard) return false;
  // Reset lastIndex to handle regexes with g or y flags
  card.danceCard.lastIndex = 0;
  return card.danceCard.test(title);
}

/**
 * Find whether a cleaned title corresponds to a club night by looking it up in the page text (D-297).
 * Returns false if card, card.danceCard, or pageText is missing, or if title is too short.
 */
export function isDanceCardInText(
  title: string,
  pageText: string,
  card: SeedSource["cardTitle"],
): boolean {
  // Step 1: Return false if any required parameter is missing
  if (!card?.danceCard) return false;
  if (title.trim().length < 4) return false;
  if (!pageText) return false;

  // Step 2: Find the title in page text case-insensitively, treating runs of whitespace as equal
  const escapedTitle = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Replace spaces in the pattern with \s+ to match any whitespace
  const pattern = new RegExp(escapedTitle.replace(/\s+/g, "\\s+"), "i");
  const match = pattern.exec(pageText);
  if (!match) return false;

  // Step 3: Take window of up to 300 characters before the title start
  const titleStart = match.index;
  const windowStart = Math.max(0, titleStart - 300);
  const windowText = pageText.slice(windowStart, titleStart);

  // Step 4: Find the last match of card.prefix in the window, unanchored
  // Build a new regex from prefix.source without leading ^, with flags minus g/y, plus g
  const prefixSource = card.prefix.source;
  const unanchoredPrefixSource = prefixSource.startsWith("^")
    ? prefixSource.slice(1)
    : prefixSource;
  const prefixFlags = card.prefix.flags.replace(/[gy]/g, "") + "g";
  const unanchoredPrefixRegex = new RegExp(unanchoredPrefixSource, prefixFlags);

  let lastMatch: RegExpExecArray | null = null;
  let matchResult: RegExpExecArray | null;
  unanchoredPrefixRegex.lastIndex = 0;
  while ((matchResult = unanchoredPrefixRegex.exec(windowText)) !== null) {
    lastMatch = matchResult;
    if (matchResult[0] === "") unanchoredPrefixRegex.lastIndex += 1;
  }
  if (!lastMatch) return false;

  // Step 5: Check if danceCard matches from that start position
  const startPos = lastMatch.index;
  const sliceFromStart = windowText.slice(startPos);

  // Build danceCard regex without leading ^, with flags minus g/y
  const danceSource = card.danceCard.source;
  const unanchoredDanceSource = danceSource.startsWith("^") ? danceSource.slice(1) : danceSource;
  const danceFlags = card.danceCard.flags.replace(/[gy]/g, "");
  // Create regex that matches from start of slice
  const anchoredDanceRegex = new RegExp(`^(?:${unanchoredDanceSource})`, danceFlags);

  return anchoredDanceRegex.test(sliceFromStart);
}

/**
 * Clean a title that includes card prefix, rooms, and genre tags (D-224).
 * Returns:
 * - undefined if card is undefined or title doesn't match the prefix pattern
 * - null if after cleaning the result has no letters (i.e., only date/time remains)
 * - string the cleaned title
 */
export function cardTitleName(
  title: string,
  card: SeedSource["cardTitle"],
): string | null | undefined {
  if (!card) return undefined;
  const prefixMatch = card.prefix.exec(title);
  if (!prefixMatch) return undefined;

  // Remove the matched prefix
  let cleaned = title.slice(prefixMatch[0].length).trim();
  if (!cleaned) return null;

  // Remove leading "/ <room>" patterns
  const rooms = card.rooms;
  while (cleaned.startsWith("/")) {
    cleaned = cleaned.slice(1).trim();
    let matchedRoom = false;
    // Find the longest matching room at the start
    let bestMatch = "";
    for (const room of rooms) {
      const roomLower = room.toLowerCase();
      const startLower = cleaned.toLowerCase();
      if (
        startLower.startsWith(roomLower) &&
        room.length > bestMatch.length &&
        (startLower.length === roomLower.length ||
          startLower[roomLower.length] === " " ||
          startLower[roomLower.length] === "/")
      ) {
        bestMatch = room;
      }
    }
    if (bestMatch) {
      // Remove the matched room
      cleaned = cleaned.slice(bestMatch.length).trim();
      matchedRoom = true;
    }
    if (!matchedRoom) {
      break;
    }
  }

  // Remove trailing genre tags
  const tails = card.tails;
  let changed;
  do {
    changed = false;
    let bestTail = "";
    for (const tail of tails) {
      const tailLower = tail.toLowerCase();
      const cleanedLower = cleaned.toLowerCase();
      // Match whole word at the end, preceded by a space
      const pattern = new RegExp(`\\s+${tailLower.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);
      if (pattern.test(cleanedLower)) {
        // Check that removing it leaves at least 4 chars with a letter
        const without = cleaned.slice(0, cleaned.length - tail.length).trim();
        if (without.length >= 4 && /\p{L}/u.test(without)) {
          if (tail.length > bestTail.length) {
            bestTail = tail;
          }
        }
      }
    }
    if (bestTail) {
      cleaned = cleaned.slice(0, cleaned.length - bestTail.length).trim();
      changed = true;
    }
  } while (changed);

  // Check if result has any letters
  if (!/\p{L}/u.test(cleaned)) {
    return null;
  }
  return cleaned;
}

/**
 * Apply card title cleaning to a harvested listing.
 * Returns:
 * - the same listing object if no change (card undefined or prefix not matched)
 * - null if the title becomes empty (not an event)
 * - HarvestedListing with cleaned title otherwise
 */
export function withCardTitle(
  listing: HarvestedListing,
  card: SeedSource["cardTitle"],
): HarvestedListing | null {
  const result = cardTitleName(listing.listing.title, card);
  if (result === undefined) return listing;
  if (result === null) return null;
  return {
    ...listing,
    listing: {
      ...listing.listing,
      title: result,
    },
  };
}
