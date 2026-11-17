// The bill of times: turning a night's listings into the rows the home screen draws
// (docs/DESIGN.md sections 5 and 6). Pure and free of React, so the four rules a reviewer
// checks are testable as plain functions:
//
//   1. An hour marker for each hour in which a listing starts.
//   2. An hour with nothing starting in it is not drawn (D-147).
//   3. The now rule sits between the last listing that has started and the first that has not.
//   4. Under distance sort the rail, the markers and the now rule are removed and the bill
//      collapses to a plain hairline-separated list, because a timeline that is not in time
//      order would lie. The stamped time stays as each card's first element.
//   5. A listing whose source gives its night and no time (D-060) has no place on the rail and
//      is never given one. Under start sort the timed bill is built from timed listings alone
//      (markers, latest end, meridiem reference, now rule), and a "Time not listed" section head
//      then opens a group of the untimed ones, in the order the repository gives (distance, then
//      slug), numbered on after the timed cards so a card's position is still its pin number.
//      A night of untimed listings only has no hour rows and no now rule, just that group.

import { TZDate } from "@date-fns/tz";

import type { ListingSort } from "@/src/data/repository";
import type { Listing } from "@/src/domain/listing";
import { HOUR_MS, formatTime, localDateOf, localInstant } from "@/src/domain/time";
import { effectiveEnd, type NightDate } from "@/src/domain/tonight";
import { t } from "@/src/i18n";

/** A night cannot need more markers than this; the guard keeps the hour walk finite. */
export const MAX_HOURS = 36;

/** The key of the section row that opens the "Time not listed" group (D-060). */
export const UNTIMED_SECTION_KEY = "time-not-listed";

/**
 * One row of the bill. `at` is the instant a row stands for, and null where there is none: the
 * section head of the untimed group, and a card whose time is not listed (D-060).
 */
export type TimelineRow =
  | { kind: "hour"; at: number; key: string; label: string }
  | { kind: "now"; at: number; key: string; label: string }
  | { kind: "section"; at: null; key: string; label: string }
  | { kind: "card"; at: number | null; key: string; listing: Listing; position: number };

/** A listing with a start time: the only kind the rail, the markers and the now rule read. */
export type StartedListing = Listing & { startsAt: Date };

/** True when the listing's source gave a time (D-060: null means the time is not listed). */
export function hasStart(listing: Listing): listing is StartedListing {
  return listing.startsAt !== null;
}

/** The instant the local hour containing `instant` began. */
export function hourStart(instant: Date, zone: string): Date {
  const local = new TZDate(instant.getTime(), zone);
  return localInstant(localDateOf(instant, zone), zone, local.getHours());
}

/** True when the local clock at `instant` reads noon or later. */
export function isAfternoon(instant: Date, zone: string): boolean {
  return new TZDate(instant.getTime(), zone).getHours() >= 12;
}

/**
 * Every local hour boundary from the one containing `from` to the one containing `to`.
 * Walks by wall clock, so a DST night is 23 or 25 hours long rather than shifting its edges.
 */
export function hourStarts(from: Date, to: Date, zone: string): Date[] {
  const out: Date[] = [];
  let cursor = hourStart(from, zone);
  const last = hourStart(to, zone).getTime();
  for (let i = 0; i < MAX_HOURS && cursor.getTime() <= last; i += 1) {
    out.push(cursor);
    const bumped = new Date(cursor.getTime() + HOUR_MS);
    const next = hourStart(bumped, zone);
    cursor = next.getTime() > cursor.getTime() ? next : bumped;
  }
  return out;
}

const AMPM_CLOCK = /^(\d{1,2})(?::(\d{2}))?(?:am|pm)$/;

/**
 * The time stamped on a card. Every time on this page goes through formatTime, so were a
 * 24-hour locale ever passed (none is in v1 -- see DEFAULT_LOCALE) it would read 19:42
 * throughout rather than in patches. In a 12-hour locale the minutes are always kept, and:
 * - in the rail (start sort) the meridiem is never printed: the hour marker above the card
 *   already says "10PM" or "12AM", and the 58px rail holds "10:00" and "12:30" but not
 *   "12:30am" (review, 2026-09-28, which found "9:00" and "6pm" mixed in one column);
 * - off the rail (distance sort, no markers) it is printed when the time is on the other side
 *   of noon from the reference, as "6:00pm", so the column never mixes "9:00" with "6pm".
 */
export function railStamp(
  instant: Date,
  zone: string,
  locale: string,
  reference: Date | null,
  railed = true,
): string {
  const formatted = formatTime(instant, zone, locale);
  const match = AMPM_CLOCK.exec(formatted);
  if (!match) return formatted;
  const clock = `${match[1]}:${match[2] ?? "00"}`;
  if (railed) return clock;
  if (reference !== null && isAfternoon(instant, zone) === isAfternoon(reference, zone))
    return clock;
  return `${clock}${formatted.slice(-2)}`;
}

/** The hour heading ("6pm", printed 6PM by text-transform; "18:00" in a 24-hour locale). */
export function hourLabel(instant: Date, zone: string, locale: string): string {
  return formatTime(instant, zone, locale);
}

export interface TimelineInput {
  listings: readonly Listing[];
  now: Date;
  zone: string;
  locale: string;
  sort: ListingSort;
  /** False on a future night: there is no now on a night that has not begun. */
  showNow: boolean;
}

export interface Timeline {
  rows: TimelineRow[];
  /** How many cards sit above the now rule; the first-paint scroll only runs when this is > 0. */
  cardsAboveNow: number;
  /** The now rule's label, for the sticky strip. Null when the night has no now. */
  nowLabel: string | null;
}

/**
 * The reference the meridiem rule reads off the rail (distance sort): the now marker tonight, and
 * 8pm on the night otherwise. It used to be the night's first start, which moved with the filter
 * and the sort, so one card read "6pm" in one view and "6:00" in the next and a lone morning
 * event lost its am (review, 2026-09-28). A fixed evening keeps every evening time compact and
 * every morning one marked, whatever the list holds.
 */
export function meridiemReference(
  nightDate: NightDate,
  zone: string,
  now: Date,
  showNow: boolean,
): Date {
  if (showNow) return now;
  return localInstant(nightDate, zone, 20, 0);
}

/**
 * The night's last effective end, so the markers run to the end of the bill and not the last
 * start. Untimed listings are left out: the markers run over the timed bill only (D-060), and an
 * untimed listing's end, listed or not, never stretches the rail.
 */
export function latestEnd(listings: readonly Listing[]): Date | null {
  let latest: Date | null = null;
  for (const listing of listings) {
    if (!hasStart(listing)) continue;
    const { end } = effectiveEnd({
      startsAt: listing.startsAt,
      endsAt: listing.endsAt,
      listingType: listing.listingType,
      cancelled: listing.confirmation === "cancelled",
    });
    if (latest === null || end.getTime() > latest.getTime()) latest = end;
  }
  return latest;
}

/**
 * Where the now rule goes: immediately before the first row later than now.
 *
 * The rule is placed among the timed rows only: the "Time not listed" section head ends the
 * range it may land in, so with everything started the rule sits at the foot of the timed bill,
 * above the heading, and never among cards that have no time to be before or after (D-060).
 */
export function placeNowRule(rows: readonly TimelineRow[], nowMs: number): number {
  const section = rows.findIndex((row) => row.kind === "section");
  const limit = section === -1 ? rows.length : section;
  const index = rows.findIndex((row, i) => i < limit && row.at !== null && row.at > nowMs);
  return index === -1 ? limit : index;
}

export function buildTimeline(input: TimelineInput): Timeline {
  const { listings, now, zone, locale, sort, showNow } = input;

  // Distance sort: no rail, no markers, no now rule, no untimed group. A plain hairline-separated
  // list in the order given; an untimed card sits in its distance place with the phrase in its
  // stamp slot (D-060).
  if (sort === "distance") {
    return {
      rows: listings.map((listing, i) => ({
        kind: "card" as const,
        at: listing.startsAt?.getTime() ?? null,
        key: listing.id,
        listing,
        position: i + 1,
      })),
      cardsAboveNow: 0,
      nowLabel: null,
    };
  }

  const timed = listings.filter(hasStart);
  const untimed = listings.filter((listing) => !hasStart(listing));
  const first = timed[0];
  // The markers run from the first start to the last start (the approved wireframe, DESIGN
  // section 6): hours after the last start hold nothing new to go to, and a run of empty rows
  // there read as a broken page (the owner, 2026-09-28). Empty hours between starts stay.
  const end = timed.reduce<Date | null>(
    (latest, l) => (latest === null || l.startsAt > latest ? l.startsAt : latest),
    null,
  );

  const rows: TimelineRow[] = [];
  let position = 0;
  const card = (listing: Listing): TimelineRow => {
    position += 1;
    return {
      kind: "card",
      at: listing.startsAt?.getTime() ?? null,
      key: listing.id,
      listing,
      position,
    };
  };

  if (first && end) {
    const byHour = new Map<number, StartedListing[]>();
    for (const listing of timed) {
      const key = hourStart(listing.startsAt, zone).getTime();
      const bucket = byHour.get(key);
      if (bucket) bucket.push(listing);
      else byHour.set(key, [listing]);
    }
    const placed = new Set<string>();
    for (const hour of hourStarts(first.startsAt, end, zone)) {
      const at = hour.getTime();
      const bucket = byHour.get(at) ?? [];
      if (bucket.length === 0) {
        // No empty hour row (D-147).
        continue;
      }
      rows.push({ kind: "hour", at, key: `hour-${at}`, label: hourLabel(hour, zone, locale) });
      for (const listing of bucket) {
        placed.add(listing.id);
        rows.push(card(listing));
      }
    }
    // Coverage is the product: a listing beyond the MAX_HOURS walk keeps its card rather than
    // vanishing from the bill (CLAUDE.md: include and flag, never silently drop).
    for (const listing of timed) if (!placed.has(listing.id)) rows.push(card(listing));
  }
  const timedRows = rows.length;

  // The untimed group follows the whole timed bill, under its own heading, numbered on.
  if (untimed.length > 0) {
    rows.push({
      kind: "section",
      at: null,
      key: UNTIMED_SECTION_KEY,
      label: t("home.untimed.heading"),
    });
    for (const listing of untimed) rows.push(card(listing));
  }

  // No now rule on a future night, and none on a night with no timed row to place it among: a
  // rule above a heading of untimed cards would sit between nothing (DESIGN section 5).
  if (!showNow || timedRows === 0) return { rows, cardsAboveNow: 0, nowLabel: null };

  const nowMs = now.getTime();
  const label = formatTime(now, zone, locale);
  const index = placeNowRule(rows, nowMs);
  const above = rows.slice(0, index);
  rows.splice(index, 0, { kind: "now", at: nowMs, key: "now", label });

  return {
    rows,
    cardsAboveNow: above.filter((row) => row.kind === "card").length,
    nowLabel: label,
  };
}
