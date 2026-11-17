// "Tonight" semantics (D-004, amended by D-060). Pure: no I/O, no process zone; every function
// takes an IANA zone.
//
//   night_date(t)          = local_date(t), or the day before when the local clock reads < 06:00
//                            (the same as local_date(t - 6 h) except for the one shifted hour on
//                            a DST-transition night, where the wall clock is what the window uses)
//   current_night_date     = night_date(now)            (before 6am: the night that is ending)
//   window(D)              = D 06:00 .. D+1 05:59:59.999 local, DST-correct, so every instant in
//                            window(D) has night_date D and no other instant does
//   listing_night          = the stored night_date; every writer stores night_date(starts_at) when
//                            the start is known, so for a timed listing the two agree, and when no
//                            time is listed it is the listed date itself (D-060)
//
// A listing whose start is known:
//   effective_end          = ends_at, else a default by listing type, flagged endNotListed
//   in_progress            = starts_at < now < effective_end
//   tonight(listing)       = listing_night == current_night_date and not ended, or in progress
//
// A listing whose time is not listed (starts_at null, D-060):
//   effective_end          = the earlier of ends_at (when listed) and the close of
//                            window(listing_night), the D+1 06:00 instant; flagged endNotListed
//                            when ends_at is null. DEFAULT_DURATION_MS never applies: it would
//                            invent a start.
//   in_progress            = never ("On now" cannot be claimed without a start)
//   tonight(listing)       = listing_night == current_night_date and not ended: on for the whole
//                            night window, off at 06:00, or earlier once a listed end passes
//   status                 = "Cancelled tonight" | "Ended" | "Time not listed[, until {end}]"

import { TZDate } from "@date-fns/tz";

import type { ListingType } from "@/src/domain/listing-types";
// From the leaf module, never from recurrence.ts: this file reaches the browser, and recurrence.ts
// would bring the whole recurrence library with it (see window.ts).
import { MATERIALIZE_DAYS } from "@/src/domain/window";

import { t } from "@/src/i18n";

import {
  HOUR_MS,
  MINUTE_MS,
  addCalendarDays,
  formatCalendarDate,
  formatDurationShort,
  formatTime,
  isoDateSchema,
  localInstant,
  toIsoDate,
  zoneSchema,
  type IsoDate,
} from "@/src/domain/time";

/** Night date: the local calendar date the night belongs to (ISO "YYYY-MM-DD"). */
export type NightDate = IsoDate;

export const nightDateSchema = isoDateSchema;

/** The hour (local) at which one night ends and the next day begins. */
export const NIGHT_BOUNDARY_HOUR = 6;

export {
  LISTING_TYPE_KEYS as LISTING_TYPES,
  listingTypeKeySchema as listingTypeSchema,
  type ListingType,
} from "@/src/domain/listing-types";

/**
 * Default duration when the end is not listed (D-004). venue_open_night uses closing time first.
 * Only ever added to a known start: a listing whose time is not listed gets no default (D-060).
 */
export const DEFAULT_DURATION_MS: Record<ListingType, number> = {
  class: 90 * MINUTE_MS,
  social: 4 * HOUR_MS,
  club_night: 6 * HOUR_MS,
  practica: 4 * HOUR_MS,
  live_music_with_dancing: 4 * HOUR_MS,
  festival_session: 4 * HOUR_MS,
  outdoor_public: 4 * HOUR_MS,
  jam: 4 * HOUR_MS,
  venue_open_night: 4 * HOUR_MS,
  other: 4 * HOUR_MS,
};

/** The three start-ish instants a listing may carry; unknown is null. */
export interface ListingStarts {
  doorsAt: Date | null;
  lessonAt: Date | null;
  dancingAt: Date | null;
}

interface TimeFacts {
  endsAt: Date | null;
  listingType: ListingType;
  /** Venue closing time from its hours, for venue_open_night. Unknown is null. */
  closingAt?: Date | null;
  /** True when the occurrence is cancelled (events.status = cancelled or confirmation = cancelled). */
  cancelled?: boolean;
}

/**
 * The time facts the tonight rule and the live status need. Either the start is known, and the
 * night follows from it, or it is not listed and the night is carried as a fact of its own
 * (D-060): such a listing is on its night for the whole night window, is never "on now", and its
 * status reads "Time not listed". `nightDate` and `tz` are optional on a timed listing so the
 * existing callers keep compiling; when given they must agree with nightDate(startsAt, tz).
 */
export type TimedListing =
  | (TimeFacts & { startsAt: Date; nightDate?: NightDate; tz?: string })
  | (TimeFacts & { startsAt: null; nightDate: NightDate; tz: string });

/** starts_at = coalesce(dancing_at, lesson_at, doors_at); null when nothing is known. */
export function startsAt(times: ListingStarts): Date | null {
  return times.dancingAt ?? times.lessonAt ?? times.doorsAt ?? null;
}

/**
 * Night date of an instant: the local calendar date, or the day before when the local clock
 * reads earlier than 06:00. Equivalent to "the local date of (instant minus 6 hours)" except
 * inside the hour a DST transition shifts, where the wall clock is what dancers (and the
 * night window) go by.
 */
export function nightDate(instant: Date | number, zone: string): NightDate {
  const ms = typeof instant === "number" ? instant : instant.getTime();
  const local = new TZDate(ms, zoneSchema.parse(zone));
  const date = toIsoDate(local.getFullYear(), local.getMonth() + 1, local.getDate());
  return local.getHours() < NIGHT_BOUNDARY_HOUR ? addCalendarDays(date, -1) : date;
}

/** Tonight's night date. Before 6am local this is yesterday's date. */
export function currentNightDate(now: Date | number, zone: string): NightDate {
  return nightDate(now, zone);
}

/**
 * The local calendar date of `now` in `zone` (without the 06:00 shift). This is the date that
 * should be labelled "Tonight" in the early hours (D-518).
 */
export function labelledTonight(now: Date | number, zone: string): NightDate {
  const ms = typeof now === "number" ? now : now.getTime();
  const local = new TZDate(ms, zoneSchema.parse(zone));
  return toIsoDate(local.getFullYear(), local.getMonth() + 1, local.getDate());
}

/**
 * True when the local hour is before NIGHT_BOUNDARY_HOUR (00:00-05:59). Equivalent to
 * `currentNightDate(now, zone) !== labelledTonight(now, zone)`.
 */
export function isEarlyHours(now: Date | number, zone: string): boolean {
  return currentNightDate(now, zone) !== labelledTonight(now, zone);
}

/**
 * The night the home page opens by default in the early hours (D-518).
 * - If not early hours, returns `currentNightDate(now, zone)`.
 * - If early hours and `lastNightOnNow === 0` (nothing from last night still on), returns
 *   `labelledTonight(now, zone)` (the coming night).
 * - Otherwise (early hours with listings still on), returns `currentNightDate(now, zone)`.
 */
export function homeDefaultNight(
  now: Date | number,
  zone: string,
  lastNightOnNow: number,
): NightDate {
  if (!isEarlyHours(now, zone)) return currentNightDate(now, zone);
  if (lastNightOnNow === 0) return labelledTonight(now, zone);
  return currentNightDate(now, zone);
}

/**
 * Flags for a night date based on the calendar labels (D-518).
 * - `isTonight`: `date === labelledTonight(now, zone)`
 * - `isTomorrow`: `date === addCalendarDays(labelledTonight(now, zone), 1)`
 */
export function labelFlags(
  date: NightDate,
  now: Date | number,
  zone: string,
): { isTonight: boolean; isTomorrow: boolean } {
  const tonight = labelledTonight(now, zone);
  const tomorrow = addCalendarDays(tonight, 1);
  return {
    isTonight: date === tonight,
    isTomorrow: date === tomorrow,
  };
}

/**
 * The instants a night date covers: D 06:00:00.000 to D+1 05:59:59.999 local.
 * Computed from the two local 06:00 boundaries, so DST changes inside the night
 * make it 23 or 25 hours long instead of shifting its edges.
 */
export function nightWindow(date: NightDate, zone: string): { start: Date; end: Date } {
  const d = nightDateSchema.parse(date);
  const z = zoneSchema.parse(zone);
  const start = localInstant(d, z, NIGHT_BOUNDARY_HOUR);
  const nextStart = localInstant(addCalendarDays(d, 1), z, NIGHT_BOUNDARY_HOUR);
  return { start, end: new Date(nextStart.getTime() - 1) };
}

export interface EffectiveEnd {
  end: Date;
  /** True when the end came from a default rather than a listed time ("End not listed"). */
  endNotListed: boolean;
}

/**
 * The instant a night's window closes: the next day's 06:00 local, one millisecond after
 * nightWindow(date).end. At this instant the night is over and current_night_date moves on.
 */
function nightCloses(date: NightDate, zone: string): Date {
  return new Date(nightWindow(date, zone).end.getTime() + 1);
}

/**
 * When the listing stops being on. With a known start: ends_at, or the closing time for a venue
 * open night, or the default by type. With no time listed (D-060): the earlier of a listed
 * ends_at and the close of its night window, never a default added to an invented start.
 */
export function effectiveEnd(listing: TimedListing): EffectiveEnd {
  if (listing.startsAt === null) {
    const close = nightCloses(listing.nightDate, listing.tz);
    if (listing.endsAt === null) return { end: close, endNotListed: true };
    const end = listing.endsAt.getTime() < close.getTime() ? listing.endsAt : close;
    return { end, endNotListed: false };
  }
  if (listing.endsAt !== null) return { end: listing.endsAt, endNotListed: false };
  if (listing.listingType === "venue_open_night" && listing.closingAt) {
    return { end: listing.closingAt, endNotListed: false };
  }
  const fallback = new Date(listing.startsAt.getTime() + DEFAULT_DURATION_MS[listing.listingType]);
  return { end: fallback, endNotListed: true };
}

/**
 * The facts that place a listing on a night: a known start (the night follows from it when no
 * night date is carried), or a stored night date (the only date fact when no time is listed).
 * A TimedListing and a Listing both fit.
 */
export type NightFacts = { startsAt: Date; nightDate?: NightDate } | CarriesNight;

type CarriesNight = { startsAt: Date | null; nightDate: NightDate };

function carriesNight(listing: NightFacts): listing is CarriesNight {
  return listing.nightDate !== undefined;
}

/**
 * The night date a listing belongs to: the stored night date when it carries one (D-060: every
 * night test reads it), else the night of its start. The two agree for a timed listing because
 * every writer stores nightDate(starts_at, tz).
 */
export function listingNightDate(listing: NightFacts, zone: string): NightDate {
  return carriesNight(listing) ? listing.nightDate : nightDate(listing.startsAt, zone);
}

/**
 * True when the listing is in progress: starts_at < now < effective_end. Never for a listing
 * whose time is not listed: without a start there is no claim that it has begun (D-060).
 */
export function isInProgress(listing: TimedListing, now: Date | number): boolean {
  if (listing.startsAt === null) return false;
  const t = typeof now === "number" ? now : now.getTime();
  return listing.startsAt.getTime() < t && t < effectiveEnd(listing).end.getTime();
}

/**
 * The "tonight" rule (D-004, D-060): the listing's night is current_night_date(now) and it has not
 * ended, or it is in progress. A listing whose time is not listed is never in progress, so it is
 * tonight for its whole night window until 06:00, or until a listed end passes. Cancelled
 * listings still count: they keep their slot, marked.
 */
export function isTonight(listing: TimedListing, now: Date | number, zone: string): boolean {
  const t = typeof now === "number" ? now : now.getTime();
  if (isInProgress(listing, t)) return true;
  const ended = t >= effectiveEnd(listing).end.getTime();
  if (ended) return false;
  return listingNightDate(listing, zone) === currentNightDate(t, zone);
}

/** Day picker for a future day D: listings whose night date is D (the stored one when carried). */
export function isOnNight(listing: NightFacts, date: NightDate, zone: string): boolean {
  return listingNightDate(listing, zone) === nightDateSchema.parse(date);
}

export interface DayOption {
  nightDate: NightDate;
  /** "Tonight", "Tomorrow", then "Wed, Sep 23". In the early hours, "Last night" for the night still in progress (D-518). */
  label: string;
}

/**
 * The fewest nights the picker shows (a whole week, D-075). The picker always runs through the
 * next full weekend (owner, 2026-10-17): Saturday's picker shows 9 nights, Sunday's 8, others 7.
 */
export const DAY_PICKER_LENGTH = 7;

/**
 * The most nights the picker can show (Saturday's picker: through next Sunday).
 */
export const MAX_PICKER_NIGHTS = 9;

/**
 * How many nights a `?day=` link opens, tonight first: tonight through tonight + 12, one short of
 * the ingest's window (MATERIALIZE_DAYS nights from its own tonight). The ingest runs once each
 * morning and can start hours late (3.5 hours on 2026-09-26), so for part of every morning after
 * 6am the window's last night is not yet written; stopping one night short means "Nothing on
 * {day}" is never said of a night the ingest has not read (D-075). At least MAX_PICKER_NIGHTS, so
 * every night the picker offers opens (a unit test holds it).
 */
export const OPENABLE_NIGHTS = MATERIALIZE_DAYS - 1;

/**
 * The single rule for which nights the home page opens as asked, and so which nights a link may
 * name (the event page's way back): a strict ISO date from tonight through tonight + 12. A night
 * that is over, one not yet listed and anything that is not a date are not openable; the home
 * page opens tonight for them instead (D-067, amended by D-075).
 */
export function isOpenableNight(date: string, now: Date | number, zone: string): boolean {
  if (!isoDateSchema.safeParse(date).success) return false;
  const tonight = currentNightDate(now, zone);
  return date >= tonight && date <= addCalendarDays(tonight, OPENABLE_NIGHTS - 1);
}

/** "Tonight", "Tomorrow" (home.day in en.ts), "Last night" in the early hours, or a short date for any other night. */
export function formatDayLabel(
  date: NightDate,
  now: Date | number,
  zone: string,
  locale = "en-US",
): string {
  const d = nightDateSchema.parse(date);
  const tonight = labelledTonight(now, zone);
  if (d === tonight) return t("home.day.tonight");
  if (d === addCalendarDays(tonight, 1)) return t("home.day.tomorrow");
  if (isEarlyHours(now, zone) && d === currentNightDate(now, zone)) {
    return t("home.day.lastNight");
  }
  return formatCalendarDate(d, locale);
}

/**
 * How many nights the picker shows for a given tonight date (owner, 2026-10-17): always through
 * the Sunday that ends the next full weekend. Saturday: 9 nights, Sunday: 8 nights, else: 7.
 */
export function pickerLength(tonight: NightDate): number {
  const date = new Date(`${tonight}T12:00:00Z`);
  const weekday = date.getUTCDay(); // 0 = Sunday, 6 = Saturday
  if (weekday === 6) return 9; // Saturday
  if (weekday === 0) return 8; // Sunday
  return 7;
}

/**
 * The picker's nights: tonight and the following nights through the next full weekend, each with
 * its label. A night the home page opens beyond these (tonight + pickerLength(tonight) to + 12,
 * from a link) is named by formatDayLabel, not found here.
 */
export function dayPicker(now: Date | number, zone: string, locale = "en-US"): DayOption[] {
  const tonight = currentNightDate(now, zone);
  const length = pickerLength(tonight);
  return Array.from({ length }, (_, i) => {
    const date = addCalendarDays(tonight, i);
    return { nightDate: date, label: formatDayLabel(date, now, zone, locale) };
  });
}

export type LiveStatusKind =
  | "upcoming"
  | "on_now"
  | "ending"
  | "ended"
  | "cancelled"
  /** The night is known and the start is not (D-060). */
  | "time_not_listed";

export interface LiveStatus {
  kind: LiveStatusKind;
  /** The status sentence, e.g. "Starts in 18 min, until 12:30am". */
  text: string;
  /** Whether the end in `text` is a listed fact; when true no end is written into the copy. */
  endNotListed: boolean;
}

/** Beyond this, the copy switches from a countdown to a clock time ("Starts at 9:30pm"). */
export const COUNTDOWN_HORIZON_MS = 6 * HOUR_MS;
/**
 * Within this much of a listed end, once the listing is past its halfway point, the copy
 * switches to "Ends in N min". The halfway condition keeps a 30-minute class reading "On now"
 * for its first half instead of "Ends in 30 min" from its first second.
 */
export const ENDING_SOON_MS = 60 * MINUTE_MS;

/**
 * The status line for a card or detail row (DESIGN.md 4 and 9), composed from card.status in
 * en.ts. Forms:
 *   "Starts in 40 min, until 1am"   "Starts in 2h 18m, until 4am"   "Starts at 9:30pm, until 1am"
 *   "On now until 1am"   "Ends in 20 min"   "Ended"   "Cancelled tonight"
 * "Ends in" needs a listed end, at most ENDING_SOON_MS away, with the listing past its halfway
 * point; a short class stays "On now" for its first half. When the end is not listed the end
 * clause is left out rather than invented.
 *
 * A listing whose time is not listed (D-060) reads "Time not listed", or "Time not listed, until
 * 2am" when an end is listed, never a countdown; "Cancelled tonight" still wins, and "Ended" once
 * a listed end has passed or its night window has closed.
 */
export function liveStatus(
  listing: TimedListing,
  now: Date | number,
  zone: string,
  locale = "en-US",
): LiveStatus {
  const at = typeof now === "number" ? now : now.getTime();
  const z = zoneSchema.parse(zone);
  if (listing.startsAt === null) return untimedStatus(listing, at, z, locale);
  const { end, endNotListed } = effectiveEnd(listing);
  const start = listing.startsAt.getTime();

  if (listing.cancelled) return cancelledStatus(listing, at, z, endNotListed);
  if (at >= end.getTime()) return { kind: "ended", text: t("card.status.ended"), endNotListed };

  const until = formatTime(end, z, locale);

  if (at >= start) {
    const left = end.getTime() - at;
    const pastHalfway = left <= (end.getTime() - start) / 2;
    if (!endNotListed && left <= ENDING_SOON_MS && pastHalfway) {
      const duration = formatDurationShort(left);
      return { kind: "ending", text: t("card.status.endsIn", { duration }), endNotListed };
    }
    const text = endNotListed
      ? t("card.status.onNowEndNotListed")
      : t("card.status.onNow", { until });
    return { kind: "on_now", text, endNotListed };
  }

  const wait = start - at;
  let text: string;
  if (wait > COUNTDOWN_HORIZON_MS) {
    const time = formatTime(listing.startsAt, z, locale);
    text = endNotListed
      ? t("card.status.startsAt", { time })
      : t("card.status.startsAtUntil", { time, until });
  } else {
    const duration = formatDurationShort(wait);
    text = endNotListed
      ? t("card.status.startsInEndNotListed", { duration })
      : t("card.status.startsIn", { duration, until });
  }
  return { kind: "upcoming", text, endNotListed };
}

/**
 * "Cancelled tonight" on tonight's night and plain "Cancelled" on any other: a cancelled Thursday
 * seen on Monday was reading "Cancelled tonight" on the live site.
 */
function cancelledStatus(
  listing: TimedListing,
  at: number,
  zone: string,
  endNotListed: boolean,
): LiveStatus {
  const tonight = listingNightDate(listing, zone) === currentNightDate(at, zone);
  const text = t(tonight ? "card.status.cancelled" : "card.status.cancelledOtherNight");
  return { kind: "cancelled", text, endNotListed };
}

/** liveStatus for a listing whose time is not listed (D-060): no start, so no countdown. */
function untimedStatus(
  listing: Extract<TimedListing, { startsAt: null }>,
  at: number,
  zone: string,
  locale: string,
): LiveStatus {
  const endNotListed = listing.endsAt === null;
  if (listing.cancelled) return cancelledStatus(listing, at, zone, endNotListed);
  if (at >= effectiveEnd(listing).end.getTime()) {
    return { kind: "ended", text: t("card.status.ended"), endNotListed };
  }
  const text =
    listing.endsAt === null
      ? t("card.status.timeNotListed")
      : t("card.status.timeNotListedUntil", { until: formatTime(listing.endsAt, zone, locale) });
  return { kind: "time_not_listed", text, endNotListed };
}
