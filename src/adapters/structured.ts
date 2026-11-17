// The one place a structured record becomes a HarvestedListing. Every structured harvester
// (ICS, JSON-LD, WordPress Events Calendar, Squarespace, Ticketmaster, Eventbrite, ...) maps
// its own format to `StructuredEvent` and calls `buildListing`, so the rules below exist once:
//
// - The title, type, styles, times and prices a source states in structure win; the words of
//   the title and description (src/domain/text-facts.ts) fill only what the structure leaves out.
// - A structured start time is doors unless the words put it on the lesson or the dancing
//   (`placeStartTime`).
// - Every stated fact carries an evidence quote: the structured value, or the words.

import type { StyleKey } from "@/config/styles";
import type { HarvestedListing, HarvestedRecurrence, ProvenanceMethod } from "@/src/adapters/types";
import type { LocalMoment } from "@/src/adapters/shared";
import { rawListingSchema, type ListingPrice, type Point } from "@/src/domain/listing";
import type { ListingType } from "@/src/domain/listing-types";
import { parsePriceText } from "@/src/domain/prices";
import { addCalendarDays } from "@/src/domain/time";
import {
  listingTypeFromText,
  placeStartTime,
  pricePhrase,
  quoteAround,
  stylesFromText,
  timesFromText,
} from "@/src/domain/text-facts";
import { readBlockTimes } from "@/src/domain/stated-times";
import { statedEveningStart } from "@/src/domain/stated-evening-start";
import { normalizeForMatch } from "@/config/styles";
import {
  DANCE_WORDS_DE_REGEX,
  DANCE_WORDS_REGEX,
  PARTY_KIND_REGEX,
} from "@/src/domain/listing-screen";

export interface StructuredEvent {
  /** The source's own id for this occurrence. */
  externalId: string | null;
  title: string;
  start: LocalMoment;
  end: LocalMoment | null;
  /** Third-party text: read through fixed patterns only, never stored beyond evidence quotes. */
  description: string | null;
  venue: {
    name: string | null;
    address: string | null;
    url: string | null;
    location: Point | null;
  };
  organizer: { name: string | null; url: string | null };
  /** Prices the structure states; null to read them from the description. */
  prices: ListingPrice[] | null;
  /** An explicit ticket or offer link only; the event's own page goes in `eventUrl` (D-070). */
  ticketUrl: string | null;
  /** The event's own page, when the source links one: its canonical URL, never a ticket link. */
  eventUrl?: string | null;
  cancelled: boolean;
  /** Styles the source states outright (a category field); else read from the words. */
  styles?: StyleKey[];
  /** A listing type the source states (a classification); else read from the words. */
  type?: ListingType | null;
  bands?: string[];
  djs?: string[];
  /** Quotes of structured values, keyed by extraction field (start, end_time, prices, ...). */
  evidence?: Record<string, string>;
  recurrence?: HarvestedRecurrence | null;
}

export interface BuildOptions {
  sourceUrl: string;
  fetchedAt: Date;
  method: ProvenanceMethod;
  /** The currency to assume for a price with no symbol (the metro's). */
  currency: string | null;
}

export function buildListing(event: StructuredEvent, options: BuildOptions): HarvestedListing {
  const title = event.title.trim();
  const description = event.description?.trim() || null;
  const words = description ? `${title}\n${description}` : title;

  const styles = event.styles?.length ? event.styles : stylesFromText(title, description);
  const typeFromWords = listingTypeFromText(title, description, styles);
  const type = event.type ?? typeFromWords.type;
  const said = timesFromText(words);
  // A start one minute past the hour the title writes on the hour (D-268): Blue Nile's
  // Squarespace calendar writes Balcony Room shows at 10:01 PM, its titles "@10PM".
  const startTime =
    event.start.time !== null &&
    /^\d{2}:01$/.test(event.start.time) &&
    readBlockTimes(title).some(
      (m) => m.role === "start" && m.value === `${event.start.time!.slice(0, 2)}:00`,
    )
      ? `${event.start.time.slice(0, 2)}:00`
      : event.start.time;
  // A morning start its own description contradicts with a stated evening opening is a
  // placeholder (D-867): the stated opening is the start, and a morning end before it goes too.
  // A rule's nights take its DTSTART, so a rule keeps its start.
  const stated = event.recurrence ? null : statedEveningStart(startTime, description);
  const { doors, lesson, dancing } = placeStartTime(
    type,
    stated ? stated.time : startTime,
    said,
    words,
  );
  const givenEnd = event.end?.time ?? null;
  const endTime =
    stated && givenEnd !== null && givenEnd >= "05:00" && givenEnd < stated.time ? null : givenEnd;

  const evidence: Record<string, string> = { title: quoteAround(title, 0, title.length) };
  if (!event.type && typeFromWords.evidence) evidence.listing_type = typeFromWords.evidence;
  Object.assign(evidence, said.evidence);

  // D-261: add a description evidence quote if it contains dance or party words
  if (description && !evidence.description) {
    const lines = description.split(/\n+/);
    for (const line of lines) {
      const sentences = line.split(/(?<=[.!?])\s+/);
      for (const sentence of sentences) {
        const trimmed = sentence.trim();
        if (trimmed) {
          const normalized = normalizeForMatch(trimmed);
          if (
            DANCE_WORDS_REGEX.test(normalized) ||
            DANCE_WORDS_DE_REGEX.test(normalized) ||
            PARTY_KIND_REGEX.test(normalized)
          ) {
            evidence.description = quoteAround(trimmed, 0, trimmed.length);
            break;
          }
        }
      }
      if (evidence.description) break;
    }
  }

  let prices = event.prices ?? [];
  if (event.prices === null && description) {
    const phrase = pricePhrase(description);
    if (phrase) {
      prices = parsePriceText(phrase.phrase, options.currency);
      if (prices.length > 0) evidence.prices = phrase.evidence;
    }
  }
  const venueText = [event.venue.name, event.venue.address].filter(Boolean).join(", ");
  if (venueText) evidence.venue = quoteAround(venueText, 0, venueText.length);
  if (event.organizer.name) evidence.organizer = event.organizer.name.slice(0, 300);
  Object.assign(evidence, event.evidence ?? {});
  if (stated) evidence.start = stated.quote;
  if (stated && endTime === null) delete evidence.end_time;

  const listing = rawListingSchema.parse({
    title,
    listing_type: type,
    styles,
    local_date: event.recurrence ? null : event.start.night,
    doors_time: doors,
    lesson_time: lesson,
    dancing_time: dancing,
    end_time: endTime,
    venue: event.venue,
    organizer: event.organizer,
    prices,
    ticket_url: event.ticketUrl,
    music: { djs: event.djs ?? [], bands: event.bands ?? [], genre_mix: null },
    cancelled: event.cancelled ? true : null,
    evidence,
  });

  return {
    listing,
    externalId: event.externalId,
    tz: event.start.zone,
    venueLocation: event.venue.location,
    recurrence: event.recurrence ?? null,
    provenance: {
      sourceUrl: options.sourceUrl,
      fetchedAt: options.fetchedAt,
      method: options.method,
    },
    ...(event.eventUrl ? { eventUrl: event.eventUrl } : {}),
  };
}

/** Whether a night falls in the harvest window [fromNight, fromNight + days). */
export function inWindow(night: string, fromNight: string, days: number): boolean {
  return night >= fromNight && night <= addCalendarDays(fromNight, days - 1);
}
