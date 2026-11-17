// Normalisation (PLAN 6.2 step 4): a HarvestedListing becomes the facts of one events row.
// Pure: venue resolution and geocoding happen before this, in the pipeline, and pass their
// answer in.
//
// Conventions, all inherited from the extraction schema (src/domain/listing.ts):
// - `local_date` is the night date and times are wall-clock "HH:MM" in the listing's zone; a time
//   before 06:00 belongs to the same night, so it falls on the next calendar day (D-004).
// - An end time before the start is the next morning.
// - A listing with a night and no time is kept, with every time null: it is listed as "Time not
//   listed" on its night (D-060). Its night is the listed date itself; nothing invents a start.
// - Unknown is null. Nothing is filled in that the source did not state, with these stated
//   exceptions: a price row with no currency takes the metro country's currency; a listing that
//   names no style takes its source's style when the source is known for exactly one; a title
//   that names only a family ("Tango Y Te") is stored with the family's own style, and a club
//   night that names no style with the club family's (D-070).
// - Withdrawn, because the words are not what the field means (D-070): a directory listed as the
//   organiser of the nights it gathers, and a door code read as a dress code. A level is stored
//   in sentence case.
// - An end equal to the start states no end (GO Latin Dance feed, 2026-10-15). An end that makes
//   the night longer than MAX_NIGHT_SPAN_HOURS (12 hours) is not trusted and is dropped.

import { getDomain, getDomainWithoutSuffix } from "tldts";

import {
  familyOf,
  familyStyleKey,
  isStyleKey,
  matchStyles,
  normalizeForMatch,
  type StyleKey,
} from "@/config/styles";
import {
  UNTIMED_RULE_ANCHOR,
  type HarvestedListing,
  type Metro,
  type Provenance,
  type Source,
} from "@/src/adapters/types";
import type { EventMusic } from "@/src/db/schema/events";
import type { Price } from "@/src/db/schema/series";
import type { Point, RawListing } from "@/src/domain/listing";
import type { ListingType } from "@/src/domain/listing-types";
import { isPlaceholderLink, looksLikeEventPage } from "@/src/domain/event-links";
import { isSeriesLink, stripTracking } from "@/src/domain/event-link-matcher";
import { currencyForCountry, isFreeFromPrices, normalizePrices } from "@/src/domain/prices";
import { MATERIALIZE_DAYS, materialize, parseRule, RecurrenceError } from "@/src/domain/recurrence";
import {
  bandsForDancersAt,
  screenEvidenceText,
  screenNoDance,
  screenTitle,
  screenTalkOrWorkshop,
  type VenueCalendarFlags,
} from "@/src/domain/listing-screen";
import { listingTypeFromText, mentionsClass } from "@/src/domain/text-facts";
import {
  MAX_NIGHT_SPAN_HOURS,
  addCalendarDays,
  isValidZone,
  localInstant,
} from "@/src/domain/time";
import { nightDate, NIGHT_BOUNDARY_HOUR } from "@/src/domain/tonight";
import { tidyTitle } from "@/src/domain/title-tidy";
import { amPmSlip } from "@/src/domain/am-pm-slip";
import { cancelledByTitle } from "@/src/domain/title-notices";

/** A title that calls the event a night, party or social (D-816: an exact 8am-8pm "Latin Night" is 8pm). */
const NIGHT_TITLE =
  /\b(?:night|nights|party|parties|social|socials|fiesta|noche|nuit|soiree|nacht|milonga|disco)\b|ナイト|パーティ/i;
/** D-883: a weekly title ("Bailando Thursdays"). */
const WEEKLY_TITLE = /\b(?:mon|tues|wednes|thurs|fri|satur|sun)days\b/i;

export type Confirmation =
  "confirmed_today" | "recurring_unconfirmed" | "conflicting" | "cancelled";

/** Everything the store needs to write one event, its sources and its provenance. */
export interface NormalizedEvent {
  /**
   * Identity within its source: the source's own id, or night + start + title, or
   * night + "untimed" + title when no time is listed (D-060).
   */
  key: string;
  title: string;
  titleNormalized: string;
  listingType: ListingType;
  styles: StyleKey[];
  /** How the styles were decided, for provenance. */
  stylesFrom: "source_listing" | "title" | "source_hint" | "listing_type" | "none";
  doorsAt: Date | null;
  lessonAt: Date | null;
  dancingAt: Date | null;
  endsAt: Date | null;
  /** coalesce(dancing, lesson, doors); null when the source lists the night and no time (D-060). */
  startsAt: Date | null;
  /** The night: from the start when there is one, else the listed date itself. */
  nightDate: string;
  tz: string;
  prices: Price[];
  isFree: boolean | null;
  /** An explicit ticket or offer link only (D-070). */
  ticketUrl: string | null;
  /** The event's own page when the source links one; null: the store uses the source URL. */
  canonicalUrl: string | null;
  /**
   * This source's own page for the one event (event_sources.event_url, D-073): the harvested
   * event page when it can be one event's page (`looksLikeEventPage`), else null. Never a home
   * page, a list of nights, or a venue or tag page.
   */
  eventUrl: string | null;
  level: string | null;
  partnerRequired: boolean | null;
  ageMin: number | null;
  dressCode: string | null;
  floor: string | null;
  indoorOutdoor: "indoor" | "outdoor" | "both" | null;
  music: EventMusic | null;
  crowdSizeHint: string | null;
  cancelled: boolean;
  confirmation: Confirmation;
  /** True when this night came from a rule rather than a dated listing. */
  fromRule: boolean;
  /**
   * The read gave a start time, and none stands against the page (D-081), with the starts and
   * ends the listing's own part of the page writes; null otherwise.
   */
  timesWithdrawn: { pageStarts: readonly string[]; pageEnds: readonly string[] } | null;
  venue: {
    name: string | null;
    address: string | null;
    url: string | null;
    location: Point | null;
  };
  organizer: { name: string | null; url: string | null };
  /**
   * Facts the source gave that normalisation withdrew (D-070), by provenance field name. The store
   * clears them on a row written before, which an absent value alone would not do for the
   * organiser: the store keeps a known organiser when a re-harvest names none.
   */
  withdrawn: WithdrawnField[];
  evidence: Record<string, string>;
  confidence: Record<string, number>;
  provenance: Provenance;
}

/**
 * Whether a string looks like a street address: starts with 1-5 digits, a space and a word character,
 * and contains a comma.
 */
export function looksLikeStreetAddress(text: string): boolean {
  const trimmed = text.trim();
  // Must contain a comma
  if (!trimmed.includes(",")) return false;
  // Check for house number pattern at the start: digits, space, then at least one word character
  // This matches "3608 33rd" where "33rd" starts with a digit
  return /^\d{1,5}\s+\w/.test(trimmed);
}

const EMOJI = String.raw`[\p{Extended_Pictographic}\p{Emoji_Presentation}\u{FE0F}\u{200D}\u{20E3}\u{1F3FB}-\u{1F3FF}\u{2060}\u{FFFC}]`;
const EDGE_EMOJI = new RegExp(String.raw`^(?:\s|${EMOJI})+|(?:\s|${EMOJI})+$`, "gu");

/**
 * Removes emoji and pictographs from the start and end of a venue name, and the word joiner (U+2060) and
 * object replacement character (U+FFFC) a pasted image leaves ("www.Miamibaila.Com\u2060\uFFFC", TangoMango)
 * anywhere in the name. Emoji in the middle are kept. Digits, "#", "*" and letters (including accents) are
 * never removed. Returns null if the cleaned string is empty.
 */
export function cleanVenueName(name: string | null): string | null {
  if (name === null) return null;
  // Remove word joiner (U+2060) and object replacement character (U+FFFC) anywhere in the string
  const withoutControlChars = name.replace(/[\u2060\uFFFC]/gu, "");
  const cleaned = withoutControlChars.replace(EDGE_EMOJI, "").trim();
  return cleaned === "" ? null : cleaned;
}

export type WithdrawnField = "organizer_name" | "dress_code";

/**
 * `untimed` is true when the listing states its night and no time (startsAt is null). A listing
 * that is not written is `rejected` (it lacks a fact every listing needs) or `not_an_event` (its
 * title is only a date, a heading or a closure notice, D-060); the report counts them apart.
 */
export type NormalizeOutcome =
  | { ok: true; event: NormalizedEvent; untimed: boolean }
  | { ok: false; kind: "rejected" | "not_an_event"; reason: string; title: string };

/** The key of a listing with no source id and no listed time: one per source, night and title. */
export function untimedKey(night: string, titleNormalized: string): string {
  return `${night}|untimed|${titleNormalized}`;
}

const TIME_FIELDS = ["doors_time", "lesson_time", "dancing_time", "end_time"] as const;

export { MAX_NIGHT_SPAN_HOURS } from "@/src/domain/time";

/**
 * A listing with every stated time that is one of its source's placeholders set to null (D-063):
 * a site that prints the same clock time on every event has not stated a time. A rule anchored at
 * a placeholder ("every Monday", read at "3:00 PM") becomes a rule whose time is not listed, or
 * its nights would take the placeholder back as their start (D-065). Returns the listing
 * unchanged, and nothing dropped, when the source has no placeholders.
 */
export function withoutPlaceholderTimes(
  harvested: HarvestedListing,
  placeholders: readonly string[],
): { harvested: HarvestedListing; dropped: number } {
  if (placeholders.length === 0) return { harvested, dropped: 0 };
  const listing = { ...harvested.listing };
  let dropped = 0;
  for (const field of TIME_FIELDS) {
    const value = listing[field];
    if (value !== null && placeholders.includes(value)) {
      listing[field] = null;
      dropped += 1;
    }
  }
  let recurrence = harvested.recurrence;
  if (
    recurrence &&
    recurrence.timeListed !== false &&
    placeholders.includes(recurrence.dtstartLocal.slice(11, 16))
  ) {
    recurrence = {
      ...recurrence,
      dtstartLocal: `${recurrence.dtstartLocal.slice(0, 10)}T${UNTIMED_RULE_ANCHOR}`,
      timeListed: false,
    };
    dropped += 1;
  }
  return dropped === 0
    ? { harvested, dropped }
    : { harvested: { ...harvested, listing, recurrence }, dropped };
}

/**
 * A listing whose source prints start clocks wrong, with its doors and dancing times set to null;
 * its lesson and end times are kept. A rule anchored at a time becomes a rule whose time is not
 * listed (D-065), as in `withoutPlaceholderTimes`. Its times are marked withdrawn, so the store
 * replaces a listing it stored before at the shifted time.
 */
export function withoutStartTimes(harvested: HarvestedListing): {
  harvested: HarvestedListing;
  dropped: number;
} {
  const listing = { ...harvested.listing };
  let dropped = 0;

  // Set doors_time and dancing_time to null if they exist
  if (listing.doors_time !== null) {
    listing.doors_time = null;
    dropped += 1;
  }
  if (listing.dancing_time !== null) {
    listing.dancing_time = null;
    dropped += 1;
  }

  let recurrence = harvested.recurrence;
  // If there's a recurrence with a listed time, make it untimed
  if (recurrence && recurrence.timeListed !== false) {
    recurrence = {
      ...recurrence,
      dtstartLocal: `${recurrence.dtstartLocal.slice(0, 10)}T${UNTIMED_RULE_ANCHOR}`,
      timeListed: false,
    };
    dropped += 1;
  }

  // Withdrawn with no page times (D-081): a row stored before at the shifted time is replaced.
  return dropped === 0
    ? { harvested, dropped }
    : {
        harvested: {
          ...harvested,
          listing,
          recurrence,
          timesWithdrawn: { pageStarts: [], pageEnds: [] },
        },
        dropped,
      };
}

/**
 * A listing read as a class whose own title names another kind of night ("Milonga Bienvenida",
 * "Robins Argentine Tango Practica") and no class keeps the title's word: a class before a
 * milonga does not make the milonga a class (D-063). A listing read as `other` takes whatever
 * kind its title names, a class included, because `other` stated nothing (D-070). Only the title
 * is read (its words, and the styles its words name: "Mondays Milongueros" is a milonga), and only
 * a class or an `other` is overridden, so nothing a page does not state is added.
 */
export function typeFromTitle(title: string, stated: ListingType): ListingType {
  if (stated !== "class" && stated !== "other") return stated;
  if (stated === "class" && mentionsClass(title)) return stated;
  const fromTitle = listingTypeFromText(title, null, matchStyles(title).styles).type;
  return fromTitle === "other" ? stated : fromTitle;
}

export interface NormalizeContext {
  metro: Metro;
  /** The source's URL and tier, when known, let a directory's own name be withdrawn (D-070). */
  source: Pick<Source, "styles"> &
    Partial<Pick<Source, "url" | "trustTier">> & {
      /** A venue's whole calendar, dances among concerts (`SeedSource.mixedCalendar`). */
      mixedCalendar?: boolean;
      /** A dance-floor venue whose bands play for dancers (`SeedSource.bandsForDancers`, D-341). */
      bandsForDancers?: boolean;
      /** From what local time its bands count (`SeedSource.bandsForDancersFrom`, D-322). */
      bandsForDancersFrom?: string;
      /** Whether the source's venue hosts dance band kinds (D-342). */
      danceBandKinds?: boolean;
      /** Its own dance nights' titles (`SeedSource.danceNights`, D-264). */
      danceNights?: readonly string[];
      /** Titles checked as not dance nights (`SeedSource.notDanceNights`). */
      notDanceNights?: readonly string[];
    };
  now: Date;
}

/**
 * A listing that states a rule becomes one listing per night in the window (D-005): the rule's
 * nights from today for MATERIALIZE_DAYS, EXDATEs removed. A listing without a rule is returned
 * as it is. A rule the engine cannot read is dropped with the reason, never guessed at.
 *
 * Every night of a rule carries the rule's links, so a link to one night is dropped from all of
 * them (D-073): an event page or ticket link that carries a date, or a ticket seller's page (one
 * night's). A series page stays. `linksDropped` names what was dropped, for the run report.
 */
export function expandRecurrence(
  harvested: HarvestedListing,
  fromNight: string,
  metroTz: string,
  days: number = MATERIALIZE_DAYS,
): { listings: HarvestedListing[]; error: string | null; linksDropped: string[] } {
  const rec = harvested.recurrence;
  if (!rec) return { listings: [harvested], error: null, linksDropped: [] };
  const linksDropped: string[] = [];
  if (harvested.eventUrl && !isSeriesLink(harvested.eventUrl)) {
    linksDropped.push(harvested.eventUrl);
    harvested = { ...harvested, eventUrl: null };
  }
  if (harvested.listing.ticket_url && !isSeriesLink(harvested.listing.ticket_url)) {
    linksDropped.push(harvested.listing.ticket_url);
    harvested = { ...harvested, listing: { ...harvested.listing, ticket_url: null } };
  }
  const tz = zoneOf(harvested, metroTz);
  // A rule with no listed time is anchored at noon for date arithmetic only, whatever time the
  // harvester wrote, so each occurrence's night is the day the rule names (D-060).
  const untimed = rec.timeListed === false;
  const dtstartLocal = untimed
    ? `${rec.dtstartLocal.slice(0, 10)}T${UNTIMED_RULE_ANCHOR}`
    : rec.dtstartLocal;
  try {
    const rule = parseRule(rec.rrule, dtstartLocal, tz);
    const exdates = new Set(rec.exdates);
    const occurrences = materialize(
      { rrule: rule.rruleString, tz, durationMinutes: null },
      fromNight,
      days,
      tz,
      { nightDate },
    ).filter((o) => !exdates.has(o.nightDate));
    const startTime = dtstartLocal.slice(11, 16);
    const l = harvested.listing;
    return {
      listings: occurrences.map((o) => ({
        ...harvested,
        externalId: harvested.externalId ? `${harvested.externalId}@${o.nightDate}` : null,
        recurrence: null,
        listing: {
          ...l,
          local_date: o.nightDate,
          // The rule's own start time wins over a listing time only when the listing has none.
          // An untimed rule has no time of its own: only the times the listing itself states stay.
          dancing_time:
            l.dancing_time ?? (untimed || l.doors_time || l.lesson_time ? null : startTime),
        },
        fromRule: true,
      })),
      error: null,
      linksDropped,
    };
  } catch (error) {
    const message = error instanceof RecurrenceError ? error.message : String(error);
    return { listings: [], error: `rule not readable: ${message}`, linksDropped };
  }
}

/** A Halloween title on a night outside October 1 - November 15 (night is "YYYY-MM-DD"). */
export function staleHalloween(title: string, night: string): boolean {
  if (!/\bhalloween\b/i.test(title)) return false;
  const md = night.slice(5, 10);
  return !(md >= "10-01" && md <= "11-15");
}

function zoneOf(harvested: HarvestedListing, metroTz: string): string {
  return harvested.tz && isValidZone(harvested.tz) ? harvested.tz : metroTz;
}

/** "HH:MM" on a night date as an instant; before 06:00 is the next calendar day. */
export function nightTimeToInstant(night: string, time: string, tz: string): Date {
  const [h, m] = time.split(":").map(Number) as [number, number];
  const date = h < NIGHT_BOUNDARY_HOUR ? addCalendarDays(night, 1) : night;
  return localInstant(date, tz, h, m);
}

export function normalizeListing(
  harvested: HarvestedListing,
  ctx: NormalizeContext,
): NormalizeOutcome {
  const l: RawListing = harvested.listing;
  const title = tidyTitle(l.title, l.local_date ?? null);
  const screened = screenTitle(title, l.venue.name);
  if (screened) return { ok: false, kind: "not_an_event", reason: screened.reason, title };
  const talk = screenTalkOrWorkshop(title, ctx.source.styles ?? []);
  if (talk) return { ok: false, kind: "not_an_event", reason: talk.reason, title };
  if (!l.local_date) return { ok: false, kind: "rejected", reason: "no date listed", title };
  const localDate = l.local_date;
  // D-886 (Belushi's London 2026-11-16): a Halloween title on a night after early November is a stale row.
  if (staleHalloween(title, localDate))
    return {
      ok: false,
      kind: "not_an_event",
      reason: "Halloween title out of season (D-886)",
      title,
    };
  const tz = zoneOf(harvested, ctx.metro.tz);

  const toInstant = (time: string | null) =>
    time ? nightTimeToInstant(localDate, time, tz) : null;
  // D-812: "7:40 am - 8:40 pm" for an evening class is an am/pm slip; read the start as the evening.
  const slip = amPmSlip({
    doors: l.doors_time,
    lesson: l.lesson_time,
    dancing: l.dancing_time,
    end: l.end_time,
    nightTitle: NIGHT_TITLE.test(title),
    // D-883: a night title or a weekly one ("Bailando Thursdays"), never a class, reads a morning-only social as pm.
    eveningTitle:
      l.listing_type !== "class" && (NIGHT_TITLE.test(title) || WEEKLY_TITLE.test(title)),
  });
  const doorsTime = slip ? slip.doors : l.doors_time;
  const lessonTime = slip ? slip.lesson : l.lesson_time;
  const dancingTime = slip ? slip.dancing : l.dancing_time;
  const doorsAt = toInstant(doorsTime);
  const lessonAt = toInstant(lessonTime);
  const dancingAt = toInstant(dancingTime);
  const startsAt = dancingAt ?? lessonAt ?? doorsAt;

  let endsAt = slip?.dropEnd ? null : toInstant(slip?.end !== undefined ? slip.end : l.end_time);
  const stated = [doorsAt, lessonAt, dancingAt].filter((d): d is Date => d !== null);
  // An end equal to a stated start states no end (GO Latin Dance's feed, 2026-10-15: "8pm to
  // 8pm"). An end before the first time of the night is the next morning ("10pm to 2am" is handled
  // by the 06:00 rule; this catches "9pm to 7am"). An end that makes the night longer than
  // MAX_NIGHT_SPAN_HOURS is not trusted ("7:40am to 8:40pm" for a class). With no time listed
  // there is no first time to compare with, and the end stays where the 06:00 rule puts it.
  if (endsAt && stated.length > 0) {
    const end = endsAt.getTime();
    const earliest = Math.min(...stated.map(Number));
    const next = end < earliest ? end + 24 * 3_600_000 : end;
    const sameAsStart = stated.some((d) => d.getTime() === end);
    // D-886 (Tokyo 2026-11-16, "Doors 11am", start 2pm, "until 12:30pm"): an end after the doors
    // but not after the start is no end.
    const beforeStart = startsAt !== null && next <= startsAt.getTime();
    endsAt =
      sameAsStart || beforeStart || next - earliest > MAX_NIGHT_SPAN_HOURS * 3_600_000
        ? null
        : new Date(next);
  }

  const fallbackCurrency = currencyForCountry(ctx.metro.countryCode);
  const prices = normalizePrices(l.prices, fallbackCurrency);
  const isFree = l.is_free ?? isFreeFromPrices(prices);

  // A listed time fixes the night (the two agree: nightTimeToInstant keeps a time on its night);
  // with none, the listed date is the night (D-060).
  const night = startsAt ? nightDate(startsAt, tz) : localDate;
  // Build flags, overriding with per-listing venueFlags (D-342)
  const baseFlags: VenueCalendarFlags = {
    mixedCalendar: ctx.source.mixedCalendar,
    bandsForDancers: ctx.source.bandsForDancers,
    bandsForDancersFrom: ctx.source.bandsForDancersFrom,
    danceBandKinds: ctx.source.danceBandKinds,
    styles: ctx.source.styles,
    danceNights: ctx.source.danceNights,
    notDanceNights: ctx.source.notDanceNights,
  };
  const mergedFlags: VenueCalendarFlags = { ...baseFlags };
  if (harvested.venueFlags) {
    if (harvested.venueFlags.bandsForDancers !== undefined) {
      mergedFlags.bandsForDancers = harvested.venueFlags.bandsForDancers;
    }
    if (harvested.venueFlags.bandsForDancersFrom !== undefined) {
      mergedFlags.bandsForDancersFrom = harvested.venueFlags.bandsForDancersFrom ?? undefined;
    }
    if (harvested.venueFlags.danceBandKinds !== undefined) {
      mergedFlags.danceBandKinds = harvested.venueFlags.danceBandKinds;
    }
    if (harvested.venueFlags.lateNightKeep !== undefined) {
      mergedFlags.lateNightKeep = harvested.venueFlags.lateNightKeep;
    }
  }
  const listingType = typeForSource(title, l.listing_type, mergedFlags, {
    startsAt,
    nightDate: night,
    tz,
  });
  const { styles, stylesFrom } = decideStyles(l, ctx.source.styles, listingType);
  // "CANCELLED - Sunday Tango Classes": the title cancels its own event (D-815).
  const cancelled = l.cancelled === true || cancelledByTitle(title);
  const withdrawn: WithdrawnField[] = [];
  // A directory's own name (D-070) or a neighbouring listing's organiser (D-105) is withdrawn.
  const directorySelf = isDirectorySelf(l.organizer, ctx.source);
  const organizerOut = (directorySelf && l.organizer.name !== null) || harvested.organizerWithdrawn;
  if (organizerOut) withdrawn.push("organizer_name");
  const doorCode = l.dress_code !== null && DOOR_CODE.test(l.dress_code);
  if (doorCode) withdrawn.push("dress_code");
  const fromRule = harvested.fromRule === true;

  const music: EventMusic | null =
    l.music.djs.length || l.music.bands.length || l.music.genre_mix
      ? {
          djs: l.music.djs,
          bands: l.music.bands,
          genreMix: l.music.genre_mix,
          liveMusic: l.music.bands.length > 0 ? true : null,
        }
      : null;

  // A venue's calendar lists concerts beside its dance nights: one that names no dance is a show.
  const evidenceText = screenEvidenceText(l.evidence);
  const noDance = screenNoDance(
    { title, styles, startsAt, endsAt, nightDate: night, tz, evidenceText },
    mergedFlags,
  );
  if (noDance) return { ok: false, kind: "not_an_event", reason: noDance.reason, title };
  const titleNormalized = normalizeForMatch(title);
  return {
    ok: true,
    untimed: startsAt === null,
    event: {
      key:
        harvested.externalId ??
        (startsAt
          ? `${night}|${startsAt.toISOString()}|${titleNormalized}`
          : untimedKey(night, titleNormalized)),
      title,
      titleNormalized,
      listingType,
      styles,
      stylesFrom,
      doorsAt,
      lessonAt,
      dancingAt,
      endsAt,
      startsAt,
      nightDate: night,
      tz,
      prices,
      isFree,
      // A template link the organiser never filled in is no link (D-745).
      // Tracking parameters (utm_*, aff, fbclid, gclid) name who sent the visitor, not the page, so
      // an Instagram "link in bio" copy of an RA link is the same link (D-882).
      ticketUrl:
        l.ticket_url === null || isPlaceholderLink(l.ticket_url)
          ? null
          : stripTracking(l.ticket_url),
      canonicalUrl: harvested.eventUrl ? stripTracking(harvested.eventUrl) : null,
      eventUrl:
        harvested.eventUrl && looksLikeEventPage(harvested.eventUrl) ? harvested.eventUrl : null,
      level: sentenceCase(l.level),
      partnerRequired: l.partner_required,
      ageMin: l.age_min,
      dressCode: doorCode ? null : l.dress_code,
      floor: l.floor,
      indoorOutdoor: l.indoor_outdoor,
      music,
      crowdSizeHint: l.crowd_size_hint,
      cancelled,
      confirmation: cancelled
        ? "cancelled"
        : fromRule
          ? "recurring_unconfirmed"
          : "confirmed_today",
      fromRule,
      timesWithdrawn: harvested.timesWithdrawn ?? null,
      venue: (() => {
        const name = cleanVenueName(l.venue.name);
        const address = l.venue.address;
        // If address is empty and name looks like a street address, swap them
        if ((!address || address.trim() === "") && name && looksLikeStreetAddress(name)) {
          return {
            name: null,
            address: name,
            url: l.venue.url,
            location: harvested.venueLocation,
          };
        }
        return {
          name: name,
          address: l.venue.address,
          url: l.venue.url,
          location: harvested.venueLocation,
        };
      })(),
      organizer:
        directorySelf || organizerOut
          ? { name: null, url: null }
          : { name: l.organizer.name, url: l.organizer.url },
      withdrawn,
      evidence: l.evidence,
      confidence: l.confidence,
      provenance: harvested.provenance,
    },
  };
}

/**
 * The listing's styles: the ones it states; else the ones its title names; else its source's style
 * when the source is known for exactly one. A family the title names with none of its styles
 * ("Tango Y Te", "Swing night") is kept as the family's own style, or as the source's style when
 * that is of the same family (a milonga listing site's "Tango Cafe"). A club night that names no
 * style at all is the club family's (D-070). Families are derived from styles, so without these a
 * listing whose title says "tango" would be counted by no tango chip and hidden by every one.
 */
export function decideStyles(
  l: Pick<RawListing, "styles" | "title">,
  sourceStyles: readonly string[],
  listingType: ListingType,
): { styles: StyleKey[]; stylesFrom: NormalizedEvent["stylesFrom"] } {
  if (l.styles.length > 0) return { styles: [...new Set(l.styles)], stylesFrom: "source_listing" };
  const known = sourceStyles.filter(isStyleKey);
  const hint = known.length === 1 ? known[0]! : null;
  const match = matchStyles(l.title);
  // "The Swing Space Social Dance" names only the generic family (D-602): a source known for exactly one style
  // is more specific than "other social dancing", so its style is used.
  if (
    hint &&
    match.styles.length === 0 &&
    match.families.length === 1 &&
    match.families[0] === "other"
  ) {
    return { styles: [hint], stylesFrom: "source_hint" };
  }
  const styles = [...match.styles];
  let hinted = false;
  for (const family of match.families) {
    if (styles.some((s) => familyOf(s) === family)) continue;
    if (hint && familyOf(hint) === family) {
      styles.push(hint);
      hinted = true;
    } else {
      styles.push(familyStyleKey(family));
    }
  }
  if (styles.length > 0) {
    const onlyHint = hinted && styles.length === 1;
    return { styles, stylesFrom: onlyHint ? "source_hint" : "title" };
  }
  if (hint) return { styles: [hint], stylesFrom: "source_hint" };
  if (listingType === "club_night") {
    return { styles: [familyStyleKey("club")], stylesFrom: "listing_type" };
  }
  return { styles: [], stylesFrom: "none" };
}

/**
 * A door, gate or buzzer code printed where a dress code would go ("Door code: 9035#", "Passcode
 * 4471", "Buzz #4471"). It says nothing about what to wear, and it is not ours to publish.
 */
const DOOR_CODE =
  /\b(?:door|gate|entry|entrance|building|buzzer|access|lock)\s*(?:code|#)|\b(?:pass)?code\s*[:#]?\s*\d{3,}|\bbuzz(?:er)?\s*[:#]?\s*\d{2,}/i;

/**
 * True when a directory source names itself as the organiser (D-070): the organiser's link is on
 * the directory's own site ("thisweekinswingnyc.com/author/eileen"), or the organiser's name is the
 * directory's ("Theronda" on theronda.us). A directory gathers other people's nights (D-061) and
 * runs none of them, so the organiser is withdrawn whole.
 */
export function isDirectorySelf(
  organizer: { name: string | null; url: string | null },
  source: Partial<Pick<Source, "url" | "trustTier">>,
): boolean {
  if (source.trustTier !== "directory" || !source.url) return false;
  const site = getDomain(source.url);
  if (organizer.url && site && getDomain(organizer.url) === site) return true;
  const core = getDomainWithoutSuffix(source.url);
  if (!organizer.name || !core) return false;
  const name = normalizeForMatch(organizer.name).replace(/ /g, "");
  return (
    name === core ||
    `the${name}` === core ||
    name === `the${core}` ||
    (name.length >= 8 && core.startsWith(name))
  );
}

/**
 * A level as the listing states it, in sentence case (D-070): "beginner" and "BEGINNER" become
 * "Beginner"; a value with capitals of its own ("Int/Adv") keeps them and gains only a first one.
 */
export function sentenceCase(value: string | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const letters = trimmed.replace(/[^\p{L}]/gu, "");
  const flat =
    letters === letters.toLowerCase() || letters === letters.toUpperCase()
      ? trimmed.toLowerCase()
      : trimmed;
  return flat.charAt(0).toUpperCase() + flat.slice(1);
}

/**
 * One source's run: an untimed listing that has a timed sibling (same night, same normalised
 * title) is the same night listed twice, once without its time, so the timed one is kept and the
 * untimed one dropped with a note (D-060 point 7). Order is kept.
 */
/**
 * An untimed listing known only by its night and title: a page read, with no id of the source's
 * own. Only such a listing is superseded by a timed one of the same night and title (D-060 point
 * 7). A listing with its own id (a Ticketmaster "time TBA" event, say) is a listing in its own
 * right, however many others in the metro share its title (review, 2026-09-28).
 */
export function isUnkeyedUntimed(event: NormalizedEvent): boolean {
  return (
    event.startsAt === null && event.key === untimedKey(event.nightDate, event.titleNormalized)
  );
}

export function dropUntimedWithTimedSibling(events: readonly NormalizedEvent[]): {
  kept: NormalizedEvent[];
  notes: string[];
} {
  const timed = new Set(
    events.filter((e) => e.startsAt !== null).map((e) => `${e.nightDate}|${e.titleNormalized}`),
  );
  const kept: NormalizedEvent[] = [];
  const notes: string[] = [];
  for (const event of events) {
    if (isUnkeyedUntimed(event) && timed.has(`${event.nightDate}|${event.titleNormalized}`)) {
      notes.push(
        `${event.title}: listed on ${event.nightDate} with no time and again with one; kept the one with the time`,
      );
      continue;
    }
    kept.push(event);
  }
  return { kept, notes };
}

/**
 * One source's run: a night its rule produced that the source also lists as a dated listing (same
 * night, same normalised title) is that dated listing, which says more (it was seen, it may have
 * its own time), so the rule's copy is dropped (D-070: a model read keeps both a stated rule and a
 * date the page writes). A rule night already produced by another copy of the same rule (a page
 * that repeats the rule beside each date it lists) is dropped too. Order is kept.
 */
export function dropRuleNightsWithDatedTwin(events: readonly NormalizedEvent[]): NormalizedEvent[] {
  const dated = new Set(
    events.filter((e) => !e.fromRule).map((e) => `${e.nightDate}|${e.titleNormalized}`),
  );
  const seen = new Set<string>();
  return events.filter((e) => {
    if (!e.fromRule) return true;
    if (dated.has(`${e.nightDate}|${e.titleNormalized}`) || seen.has(e.key)) return false;
    seen.add(e.key);
    return true;
  });
}

/** Night dates from `today` for the materialisation window, for callers that filter by it. */
export function windowNights(today: string, days: number = MATERIALIZE_DAYS): string[] {
  return Array.from({ length: days }, (_, i) => addCalendarDays(today, i));
}
/**
 * The listing's type from its title (typeFromTitle), except on a dance-floor venue's whole calendar
 * (`mixedCalendar` and `bandsForDancers`, D-341): a billing that names no kind there is a band playing
 * for dancers, so `other` becomes `live_music_with_dancing`. A kind the title or page names is kept.
 * With `bandsForDancersFrom`, only a listing starting at or after that time on its night (D-322).
 */
export function typeForSource(
  title: string,
  stated: ListingType,
  source: {
    mixedCalendar?: boolean;
    bandsForDancers?: boolean;
    bandsForDancersFrom?: string;
    danceBandKinds?: boolean;
  },
  at?: { startsAt: Date | null; nightDate: string; tz: string },
): ListingType {
  const type = typeFromTitle(title, stated);
  if (type !== "other" || source.mixedCalendar !== true || source.bandsForDancers !== true) {
    return type;
  }
  if (source.bandsForDancersFrom === undefined) return "live_music_with_dancing";
  return at && bandsForDancersAt(source, at) ? "live_music_with_dancing" : type;
}
