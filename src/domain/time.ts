// Pure time helpers: calendar dates in a named zone, and Intl-based formatting.
// No I/O. Never reads the process zone: every function takes an IANA zone.

import { TZDate } from "@date-fns/tz";
import { z } from "zod";

import { t } from "@/src/i18n";

export const MINUTE_MS = 60_000;
export const HOUR_MS = 60 * MINUTE_MS;

/** A calendar date as ISO "YYYY-MM-DD". */
export type IsoDate = string;

export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "expected an ISO calendar date (YYYY-MM-DD)")
  .refine(
    (value) => {
      const { year, month, day } = splitIsoDate(value);
      const probe = new Date(Date.UTC(year, month - 1, day));
      return (
        probe.getUTCFullYear() === year &&
        probe.getUTCMonth() === month - 1 &&
        probe.getUTCDate() === day
      );
    },
    { message: "not a real calendar date" },
  );

/** Zone names are validated by Intl; an unknown zone throws a RangeError there. */
export const zoneSchema = z.string().min(1).refine(isValidZone, { message: "unknown IANA zone" });

const zoneCache = new Map<string, boolean>();

export function isValidZone(zone: string): boolean {
  const cached = zoneCache.get(zone);
  if (cached !== undefined) return cached;
  let ok = false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    ok = true;
  } catch {
    ok = false;
  }
  zoneCache.set(zone, ok);
  return ok;
}

function splitIsoDate(iso: IsoDate): { year: number; month: number; day: number } {
  return {
    year: Number(iso.slice(0, 4)),
    month: Number(iso.slice(5, 7)),
    day: Number(iso.slice(8, 10)),
  };
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function toIsoDate(year: number, month: number, day: number): IsoDate {
  return `${String(year).padStart(4, "0")}-${pad2(month)}-${pad2(day)}`;
}

/** The local calendar date of an instant in the given zone. */
export function localDateOf(instant: Date | number, zone: string): IsoDate {
  const ms = typeof instant === "number" ? instant : instant.getTime();
  const local = new TZDate(ms, zone);
  return toIsoDate(local.getFullYear(), local.getMonth() + 1, local.getDate());
}

/** Calendar arithmetic on ISO dates. Zone-free by construction (done in UTC). */
export function addCalendarDays(iso: IsoDate, days: number): IsoDate {
  const { year, month, day } = splitIsoDate(isoDateSchema.parse(iso));
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return toIsoDate(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate());
}

/** Whole days from `from` to `to` as calendar dates (negative when `to` is earlier). */
export function calendarDaysBetween(from: IsoDate, to: IsoDate): number {
  const a = splitIsoDate(isoDateSchema.parse(from));
  const b = splitIsoDate(isoDateSchema.parse(to));
  const diff = Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day);
  return Math.round(diff / (24 * HOUR_MS));
}

/**
 * The instant at a local wall-clock time on a calendar date in the zone.
 * A time inside a DST gap resolves forward; an ambiguous time takes the first
 * occurrence (both are @date-fns/tz behaviour).
 */
export function localInstant(
  iso: IsoDate,
  zone: string,
  hours = 0,
  minutes = 0,
  seconds = 0,
  millis = 0,
): Date {
  const { year, month, day } = splitIsoDate(isoDateSchema.parse(iso));
  const local = new TZDate(year, month - 1, day, hours, minutes, seconds, millis, zone);
  return new Date(local.getTime());
}

/** A day period that is a Latin am/pm marker: "AM", "pm", "a.m.", "P.M." */
const AM_PM = /^[ap]\.?m\.?$/i;

/**
 * A clock time in the event's zone for the viewer's locale. Figures are always Latin
 * (numberingSystem "latn"): the time rail is set in tabular Latin figures, and it keeps a
 * locale's own digits from meeting the ASCII zero pad (fa-IR, ne-NP, my-MM).
 * am/pm locales: "7:42pm", "1am" (lowercase, no space, minutes dropped on the hour).
 * 24-hour locales: "19:42", "01:00".
 * Other 12-hour locales (zh-TW "下午7:42", el-GR "7:42 μ.μ.") keep Intl's own form, with
 * narrow and no-break spaces replaced by a plain space.
 */
export function formatTime(instant: Date, zone: string, locale = "en-US"): string {
  const format = new Intl.DateTimeFormat(locale, {
    hour: "numeric",
    minute: "2-digit",
    numberingSystem: "latn",
    timeZone: zone,
  });
  const parts = format.formatToParts(instant);
  const hour = parts.find((p) => p.type === "hour")?.value ?? "";
  const minute = parts.find((p) => p.type === "minute")?.value ?? "00";
  const period = parts.find((p) => p.type === "dayPeriod")?.value;
  if (period === undefined) return `${hour.padStart(2, "0")}:${minute}`;
  if (!AM_PM.test(period)) return format.format(instant).replace(/[\u202F\u00A0]/g, " ");
  const suffix = period.replace(/\./g, "").toLowerCase();
  return minute === "00" ? `${hour}${suffix}` : `${hour}:${minute}${suffix}`;
}

/** "7:30pm to 1am"; with no end, "7:30pm, end not listed" (copy from detail.when in en.ts). */
export function formatTimeRange(
  start: Date,
  end: Date | null,
  zone: string,
  locale = "en-US",
): string {
  const from = formatTime(start, zone, locale);
  if (end === null) return t("detail.when.rangeEndNotListed", { from });
  return t("detail.when.range", { from, to: formatTime(end, zone, locale) });
}

/**
 * A short calendar-day label in the locale's own order, words and punctuation: "Tue, Sep 29" in
 * en-US, the app's one locale (D-072: US date order), "Tue 29 Sep" in en-GB. Where the label meets
 * another word on one line, the joint is a middle dot, never a second comma ("Tonight · Tue, Sep
 * 29", in en.ts). No-break and narrow spaces become plain spaces.
 */
export function formatCalendarDate(iso: IsoDate, locale = "en-US"): string {
  const { year, month, day } = splitIsoDate(isoDateSchema.parse(iso));
  return new Intl.DateTimeFormat(locale, {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  })
    .format(new Date(Date.UTC(year, month - 1, day, 12)))
    .replace(/[\u202F\u00A0]/g, " ");
}

/**
 * `formatCalendarDate`, with the year when it is not the reference night's year: a link to a night
 * a year away would otherwise read as this year's ("Sun, Oct 5, 2025", audit F16 review).
 */
export function formatCalendarDateFrom(iso: IsoDate, reference: IsoDate, locale = "en-US"): string {
  const { year, month, day } = splitIsoDate(isoDateSchema.parse(iso));
  if (year === splitIsoDate(isoDateSchema.parse(reference)).year)
    return formatCalendarDate(iso, locale);
  return new Intl.DateTimeFormat(locale, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  })
    .format(new Date(Date.UTC(year, month - 1, day, 12)))
    .replace(/[\u202F\u00A0]/g, " ");
}

/**
 * Short duration copy for countdowns: "40 min", "2h 18m", "2h".
 * Rounds up to the next whole minute so a countdown never reads 0 while time remains.
 */
export function formatDurationShort(ms: number): string {
  const totalMinutes = Math.max(0, Math.ceil(ms / MINUTE_MS));
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}

/** No night of dancing runs longer than this as one listing; a longer stated end is not trusted. */
export const MAX_NIGHT_SPAN_HOURS = 12;
