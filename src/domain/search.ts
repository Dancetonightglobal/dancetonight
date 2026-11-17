// Text search filter: match listings by event, venue, style and more.
// Pure code, no I/O.

import type { Listing } from "@/src/domain/listing";
import { familyLabel, styleLabel, listingTypeLabel } from "@/config/styles";

/**
 * Normalize a raw search string: NFKD, remove combining marks, lowercase,
 * replace runs of non-letter/non-digit characters with a single space, trim.
 */
export function normalizeSearchText(raw: string): string {
  // Remove combining marks (diacritics) after NFKD decomposition.
  const decomposed = raw.normalize("NFKD");
  const withoutMarks = decomposed.replace(/\p{M}/gu, "");
  const lower = withoutMarks.toLowerCase();
  // Collapse any sequence of non-letter/non-digit characters to a single space.
  const spaced = lower.replace(/[^\p{L}\p{N}]+/gu, " ");
  return spaced.trim();
}

/**
 * Split a query into normalized words, deduplicated while preserving order.
 */
export function searchWords(query: string): string[] {
  const normalized = normalizeSearchText(query);
  if (normalized === "") return [];
  const words = normalized.split(" ");
  const seen = new Set<string>();
  const result: string[] = [];
  for (const word of words) {
    if (word === "") continue;
    if (!seen.has(word)) {
      seen.add(word);
      result.push(word);
    }
  }
  return result;
}

/**
 * Build a single normalized haystack string from a listing.
 */
export function searchHaystack(listing: Listing): string {
  const pieces: string[] = [];

  // title
  pieces.push(normalizeSearchText(listing.title));

  // venue
  if (listing.venue) {
    pieces.push(normalizeSearchText(listing.venue.name));
    if (listing.venue.neighborhood) {
      pieces.push(normalizeSearchText(listing.venue.neighborhood));
    }
    const addr = listing.venue.address;
    if (addr) {
      if (addr.line1) pieces.push(normalizeSearchText(addr.line1));
      if (addr.locality) pieces.push(normalizeSearchText(addr.locality));
      if (addr.formatted) pieces.push(normalizeSearchText(addr.formatted));
    }
  }

  // organizer
  if (listing.organizer?.name) {
    pieces.push(normalizeSearchText(listing.organizer.name));
  }

  // music
  if (listing.music) {
    for (const dj of listing.music.djs) {
      pieces.push(normalizeSearchText(dj));
    }
    for (const band of listing.music.bands) {
      pieces.push(normalizeSearchText(band));
    }
    if (listing.music.genreMix) {
      pieces.push(normalizeSearchText(listing.music.genreMix));
    }
  }

  // styles: synonyms are left out because they carry generic words
  // ("class", "night", "party") that would match every styled listing.
  for (const styleKey of listing.styles) {
    pieces.push(normalizeSearchText(styleLabel(styleKey)));
  }

  // families: synonyms are left out because they carry generic words
  // ("class", "night", "party") that would match every styled listing.
  for (const familyKey of listing.families) {
    pieces.push(normalizeSearchText(familyLabel(familyKey)));
  }

  // listing type
  pieces.push(normalizeSearchText(listingTypeLabel(listing.listingType)));

  // Join with a single space, skipping empty pieces.
  return pieces.filter((p) => p !== "").join(" ");
}

/**
 * Whether a listing matches a free‑text query.
 * Returns true if query is undefined, empty, or contains no words.
 * Otherwise returns true only when every word from the query is a substring
 * of the listing's haystack.
 */
export function matchesSearch(listing: Listing, query: string | undefined): boolean {
  if (query === undefined) return true;
  const words = searchWords(query);
  if (words.length === 0) return true;
  const haystack = searchHaystack(listing);
  return words.every((word) => haystack.includes(word));
}
