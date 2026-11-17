/**
 * D-767: Detect when a venue site lists a night twice: once from its events list page and once from the night's own
 * event page, with a title that only adds generic words (Silk City "CARIBBEAN NIGHT" / "dj CARIBBEAN NIGHT").
 */
import { GENERIC_TITLE_WORDS } from "@/config/dedupe";
import { coreTitleWords, onePlace, sameKindOfNight, type DedupeSide } from "@/src/domain/dedupe";
import { looksLikeEventPage } from "@/src/domain/event-links";

export function listCopyAndOwnPage(a: DedupeSide, b: DedupeSide): boolean {
  // 1. Neither side cancelled
  if (a.cancelled === true || b.cancelled === true) {
    return false;
  }

  // 2. Same place
  if (!onePlace(a, b)) {
    return false;
  }

  // 3. Starts: both null or both equal non-null
  const aTime = a.startsAt?.getTime() ?? null;
  const bTime = b.startsAt?.getTime() ?? null;
  if (aTime !== bTime) {
    return false;
  }

  // 4. Same kind of night
  const aType = a.listingType ?? "other";
  const bType = b.listingType ?? "other";
  if (!sameKindOfNight(aType, bType)) {
    return false;
  }

  // 5. Exactly one side has its own page
  const aHasOwnPage = hasOwnPage(a);
  const bHasOwnPage = hasOwnPage(b);
  if (aHasOwnPage === bHasOwnPage) {
    return false; // Both or neither have own page
  }

  // 6. Title checks
  if (!a.title || !b.title) {
    return false;
  }

  const wa = coreTitleWords(a.title).filter((w) => w.length >= 2);
  const wb = coreTitleWords(b.title).filter((w) => w.length >= 2);

  if (wa.length === 0 || wb.length === 0) {
    return false;
  }

  // Determine short and long word lists
  const [shortWords, longWords] = wa.length <= wb.length ? [wa, wb] : [wb, wa];

  // D-844: the list copy's title heads the event page's word for word, with two telling words (one of 4+
  // letters): the page may add anything after it (Escualita "... dimanche soir au Rouge Pigalle, Paris").
  const telling = shortWords.filter((w) => !GENERIC_TITLE_WORDS.includes(w));
  if (
    telling.length >= 2 &&
    telling.some((w) => w.length >= 4) &&
    shortWords.every((w, i) => longWords[i] === w)
  ) {
    return true;
  }

  // Every word of short must be in long
  for (const word of shortWords) {
    if (!longWords.includes(word)) {
      return false;
    }
  }

  // Every word of long that is not in short must be generic
  const shortSet = new Set(shortWords);
  for (const word of longWords) {
    if (!shortSet.has(word) && !GENERIC_TITLE_WORDS.includes(word)) {
      return false;
    }
  }

  // Short must have at least one word of 4+ letters that is not generic
  const hasNonGenericLongWord = shortWords.some(
    (word) => word.length >= 4 && !GENERIC_TITLE_WORDS.includes(word),
  );
  if (!hasNonGenericLongWord) {
    return false;
  }

  return true;
}

function hasOwnPage(side: DedupeSide): boolean {
  const urls = [side.ticketUrl, side.canonicalUrl].filter((url): url is string => url != null);
  return urls.some((url) => looksLikeEventPage(url));
}
