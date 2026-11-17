// Recurrence (D-005, D-027). Pure: no I/O, no process zone, nothing imported from the time module.
//
//   series.rrule         = "DTSTART;TZID=<zone>:<wall time>\nRRULE:<rule>", so "every Thursday at 8pm"
//                          stays 8pm across DST (rrule-temporal expands the rule in that zone)
//   materialize          = occurrences whose night date (D-004: the local date of the start, or the day
//                          before when the local clock reads earlier than 6am) lies in
//                          [fromNight, fromNight + days), with series_exceptions applied by night date;
//                          every one is `recurring_unconfirmed` until a dated listing confirms it
//   importExdates        = EXDATE -> cancel rows, RDATE -> override rows, so feeds' exceptions live in
//                          series_exceptions rather than in the stored string (D-005)
//   recurrenceText       = "Every Thursday", "Every 2nd and 4th Saturday", "Monthly", "Every weekday"
//   parseRecurrenceText  = deterministic phrases -> RRULE body; null for anything hedged, and never a date
//
// Temporal: rrule-temporal uses the runtime's native Temporal when present (Node 26+) and otherwise its
// own bundled copy of temporal-polyfill, so Node 22 needs no polyfill and nothing here touches Temporal
// directly. Only epochMilliseconds and dayOfWeek are read off the values it returns.

import { TZDate } from "@date-fns/tz";
import { RRuleTemporal } from "rrule-temporal";
import { z } from "zod";

import { MATERIALIZE_DAYS } from "@/src/domain/window";
import { zhSpec } from "@/src/domain/recurrence-zh";
import { stripLeadingFrom } from "@/src/domain/recurrence-from";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
/** Local clock hour before which an instant belongs to the previous night (D-004). */
const NIGHT_BOUNDARY_HOUR = 6;

// The window's length lives in a leaf module so the browser can read it without this library
// (see window.ts); it is re-exported here for the pipeline and the adapters.
export { MATERIALIZE_DAYS };

export class RecurrenceError extends Error {
  override readonly name = "RecurrenceError";
}

function parseWith<T>(schema: z.ZodType<T>, value: unknown, what: string): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const first = result.error.issues[0];
  throw new RecurrenceError(`${what}: ${first ? first.message : "invalid"}`);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ---------------------------------------------------------------------------------------------
// Zones and dates (kept local so this module does not depend on src/domain/time.ts)

const zoneFormatters = new Map<string, Intl.DateTimeFormat>();

function zoneFormatter(zone: string): Intl.DateTimeFormat {
  let formatter = zoneFormatters.get(zone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
    });
    zoneFormatters.set(zone, formatter);
  }
  return formatter;
}

export function isValidZone(zone: string): boolean {
  try {
    zoneFormatter(zone);
    return true;
  } catch {
    return false;
  }
}

export const zoneSchema = z
  .string()
  .min(1)
  .refine(isValidZone, { message: "Unknown IANA time zone" });

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isRealDate(value: string): boolean {
  const ms = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().startsWith(value);
}

/** A night date (D-004), ISO "YYYY-MM-DD". */
export type NightDate = string;

export const nightDateSchema = z
  .string()
  .regex(ISO_DATE, "Expected YYYY-MM-DD")
  .refine(isRealDate, { message: "Not a calendar date" });

/** The local calendar date (ISO "YYYY-MM-DD") and local clock hour (0-23) of an instant in a zone. */
function localDateAndHour(t: Date, zone: string): { date: NightDate; hour: number } {
  const parts = zoneFormatter(zone).formatToParts(t);
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? "";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    hour: Number(get("hour")),
  };
}

/** Local calendar date of an instant in a zone, ISO "YYYY-MM-DD". */
export function localDate(t: Date, zone: string): NightDate {
  return localDateAndHour(t, zone).date;
}

/**
 * Night date (D-004): the local date of the instant, or the day before when the local clock reads
 * earlier than 6am. A 1am Saturday set is Friday's night. Read off the wall clock, not by shifting
 * the instant, so the shifted hour of a DST night lands where dancers (and tonight.ts) put it.
 */
export function nightDate(t: Date, zone: string): NightDate {
  const { date, hour } = localDateAndHour(t, zone);
  return hour < NIGHT_BOUNDARY_HOUR ? addDays(date, -1) : date;
}

export type NightDateFn = (t: Date, zone: string) => NightDate;

function addDays(date: NightDate, days: number): NightDate {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Instant of a wall-clock time in a zone. Times inside a DST gap resolve forward, as TZDate does. */
function wallToInstant(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  zone: string,
): Date {
  const t = new TZDate(year, month - 1, day, hour, minute, second, zone);
  if (Number.isNaN(t.getTime())) throw new RecurrenceError("Invalid wall-clock time");
  return new Date(t.getTime());
}

// ---------------------------------------------------------------------------------------------
// Rules

export const WEEKDAYS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const;
export type Weekday = (typeof WEEKDAYS)[number];
export const weekdaySchema = z.enum(WEEKDAYS);

export const FREQS = [
  "YEARLY",
  "MONTHLY",
  "WEEKLY",
  "DAILY",
  "HOURLY",
  "MINUTELY",
  "SECONDLY",
] as const;
export type Freq = (typeof FREQS)[number];
export const freqSchema = z.enum(FREQS);

const WEEKDAY_SET: ReadonlySet<string> = new Set(WEEKDAYS);
const MON_TO_FRI: readonly Weekday[] = ["MO", "TU", "WE", "TH", "FR"];

export interface ParsedRule {
  /** The two-line string stored in `series.rrule`: DTSTART;TZID=... then RRULE:... (plus any pass-through lines). */
  rruleString: string;
  tz: string;
  /** DTSTART as wall-clock time in `tz`, "YYYY-MM-DDTHH:MM:SS". */
  dtstartLocal: string;
  dtstart: Date;
  freq: Freq;
  interval: number;
  /** BYDAY entries as written: "TH", "2SA", "-1FR". */
  byDay: string[];
  bySetPos: number[];
  byMonthDay: number[];
  count: number | null;
  until: Date | null;
  rule: RRuleTemporal;
}

const LOCAL_DATETIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

/** Wall-clock date-time with no zone or offset, "YYYY-MM-DDTHH:MM" or "YYYY-MM-DDTHH:MM:SS". */
export const localDateTimeSchema = z
  .string()
  .regex(LOCAL_DATETIME, "Expected YYYY-MM-DDTHH:MM[:SS] wall-clock time")
  .refine((value) => isRealDate(value.slice(0, 10)), { message: "Not a calendar date" })
  .refine(
    (value) => {
      const m = LOCAL_DATETIME.exec(value);
      return (
        m !== null &&
        Number(m[4]) < 24 &&
        Number(m[5]) < 60 &&
        (m[6] === undefined || Number(m[6]) < 60)
      );
    },
    { message: "Not a wall-clock time" },
  );

function compactLocal(local: string): string {
  const m = LOCAL_DATETIME.exec(local);
  if (!m) throw new RecurrenceError("Expected YYYY-MM-DDTHH:MM[:SS] wall-clock time");
  return `${m[1]}${m[2]}${m[3]}T${m[4]}${m[5]}${m[6] ?? "00"}`;
}

function expandCompact(compact: string): string {
  return `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}T${compact.slice(9, 11)}:${compact.slice(11, 13)}:${compact.slice(13, 15)}`;
}

const DTSTART_LINE = /^DTSTART;(?:[^:]*;)?TZID=([^:;]+)(?:;[^:]*)?:(\d{8}T\d{6})$/i;

/**
 * Build a rule from an RRULE body ("FREQ=WEEKLY;BYDAY=TH", with or without the "RRULE:" prefix),
 * a wall-clock DTSTART and an IANA zone. The result's `rruleString` carries DTSTART;TZID so the
 * wall time survives DST (D-005). Throws RecurrenceError on anything invalid.
 */
export function parseRule(rruleText: string, dtstartLocal: string, zone: string): ParsedRule {
  const text = parseWith(z.string().trim().min(1), rruleText, "rrule");
  const local = parseWith(localDateTimeSchema, dtstartLocal, "dtstart");
  const tz = parseWith(zoneSchema, zone, "zone");
  const body = text.replace(/^RRULE:/i, "").trim();
  if (/[\r\n]/.test(body) || /^(DTSTART|EXDATE|RDATE)/i.test(body)) {
    throw new RecurrenceError(
      "rrule must be a single RRULE body; pass DTSTART as dtstartLocal and zone, and EXDATE/RDATE through importExdates",
    );
  }
  return parseStoredRule(`DTSTART;TZID=${tz}:${compactLocal(local)}\nRRULE:${body}`);
}

/**
 * Parse the string stored in `series.rrule`. DTSTART must carry TZID and a wall-clock time (D-005);
 * further lines (EXDATE, RDATE) pass through to the engine untouched.
 */
export function parseStoredRule(rruleString: string): ParsedRule {
  const lines = parseWith(z.string().min(1), rruleString, "rrule")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const dtstartLine = lines.find((line) => /^DTSTART/i.test(line));
  if (!dtstartLine) throw new RecurrenceError("Stored rule needs a DTSTART line");
  const m = DTSTART_LINE.exec(dtstartLine);
  if (!m || m[1] === undefined || m[2] === undefined) {
    throw new RecurrenceError(
      "DTSTART must carry TZID and a wall-clock time, e.g. DTSTART;TZID=Europe/Paris:20260101T210000",
    );
  }
  if (!lines.some((line) => /^RRULE:/i.test(line))) {
    throw new RecurrenceError("Stored rule needs an RRULE line");
  }
  const tz = parseWith(zoneSchema, m[1], "zone");
  const dtstartLocal = expandCompact(m[2]);
  parseWith(localDateTimeSchema, dtstartLocal, "dtstart");

  const joined = lines.join("\n");
  let rule: RRuleTemporal;
  try {
    rule = new RRuleTemporal({ rruleString: joined });
  } catch (error) {
    throw new RecurrenceError(`Invalid recurrence rule: ${messageOf(error)}`);
  }
  const options = rule.options();
  return {
    rruleString: joined,
    tz,
    dtstartLocal,
    dtstart: new Date(options.dtstart.epochMilliseconds),
    freq: parseWith(freqSchema, options.freq, "freq"),
    interval: options.interval ?? 1,
    byDay: [...(options.byDay ?? [])],
    bySetPos: [...(options.bySetPos ?? [])],
    byMonthDay: [...(options.byMonthDay ?? [])],
    count: options.count ?? null,
    until: options.until ? new Date(options.until.epochMilliseconds) : null,
    rule,
  };
}

// ---------------------------------------------------------------------------------------------
// Series, exceptions and materialization

export const CONFIRMATION_RECURRING = "recurring_unconfirmed" as const;

export const overrideSchema = z.object({
  startsAt: z.date().optional(),
  /** Explicit end; null means the end is not listed for this night. */
  endsAt: z.date().nullable().optional(),
  venueId: z.string().min(1).nullable().optional(),
});
export type Override = z.infer<typeof overrideSchema>;

export const seriesExceptionSchema = z.discriminatedUnion("action", [
  z.object({ nightDate: nightDateSchema, action: z.literal("cancel") }),
  z.object({ nightDate: nightDateSchema, action: z.literal("override"), override: overrideSchema }),
]);
export type SeriesException = z.infer<typeof seriesExceptionSchema>;

export const seriesSchema = z.object({
  /** As stored: "DTSTART;TZID=...\nRRULE:..." */
  rrule: z.string().min(1),
  tz: zoneSchema,
  /** How long a night runs; null when the end is not listed. */
  durationMinutes: z.number().int().positive().nullable().optional(),
  venueId: z.string().min(1).nullable().optional(),
  exceptions: z.array(seriesExceptionSchema).optional(),
});
export type Series = z.input<typeof seriesSchema>;

export interface Occurrence {
  nightDate: NightDate;
  startsAt: Date;
  /** null when the end is not listed. */
  endsAt: Date | null;
  venueId: string | null;
  confirmation: typeof CONFIRMATION_RECURRING;
  /** True when a series exception changed this night (time or venue) or added it. */
  overridden: boolean;
}

export interface MaterializeOptions {
  /** Night-date function to use instead of the D-004 default (e.g. the one from src/domain/tonight.ts). */
  nightDate?: NightDateFn;
}

const daysSchema = z.number().int().min(1).max(366);

/**
 * Occurrences of a series for `days` nights from `fromNight` (inclusive), with exceptions applied by
 * night date: a cancel drops the night; an override moves the start, end or venue (an override whose
 * night has no rule occurrence but carries a start, e.g. an imported RDATE, adds one). Sorted by start.
 */
export function materialize(
  series: Series,
  fromNight: NightDate,
  days: number = MATERIALIZE_DAYS,
  zone: string = series.tz,
  options: MaterializeOptions = {},
): Occurrence[] {
  const s = parseWith(seriesSchema, series, "series");
  const from = parseWith(nightDateSchema, fromNight, "fromNight");
  const count = parseWith(daysSchema, days, "days");
  const tz = parseWith(zoneSchema, zone, "zone");
  const nightOf = options.nightDate ?? nightDate;
  const lastNight = addDays(from, count - 1);
  const durationMs = s.durationMinutes ? s.durationMinutes * 60_000 : null;
  const seriesVenue = s.venueId ?? null;

  const parsed = parseStoredRule(s.rrule);
  // Over-fetch by a day either side (any zone offset fits) and keep by night date, so the window is
  // exact for whichever night-date function the caller uses.
  const after = new Date(Date.parse(`${from}T00:00:00Z`) - DAY_MS);
  const before = new Date(Date.parse(`${addDays(from, count)}T00:00:00Z`) + 2 * DAY_MS);
  let hits: { epochMilliseconds: number }[];
  try {
    hits = parsed.rule.between(after, before, true);
  } catch (error) {
    throw new RecurrenceError(`Could not expand rule: ${messageOf(error)}`);
  }

  const byNight = new Map<NightDate, { cancel: boolean; override: Override | null }>();
  for (const exception of s.exceptions ?? []) {
    const entry = byNight.get(exception.nightDate) ?? { cancel: false, override: null };
    if (exception.action === "cancel") entry.cancel = true;
    else entry.override = { ...entry.override, ...exception.override };
    byNight.set(exception.nightDate, entry);
  }

  const endFor = (startsAt: Date): Date | null =>
    durationMs === null ? null : new Date(startsAt.getTime() + durationMs);

  const occurrences: Occurrence[] = [];
  const seen = new Set<NightDate>();
  for (const hit of hits) {
    const ruleStart = new Date(hit.epochMilliseconds);
    const night = nightOf(ruleStart, tz);
    if (night < from || night > lastNight) continue;
    seen.add(night);
    const exception = byNight.get(night);
    if (exception?.cancel) continue;
    const override = exception?.override ?? null;
    const startsAt = override?.startsAt ?? ruleStart;
    const endsAt = override && override.endsAt !== undefined ? override.endsAt : endFor(startsAt);
    const venueId = override && override.venueId !== undefined ? override.venueId : seriesVenue;
    occurrences.push({
      nightDate: override?.startsAt ? nightOf(startsAt, tz) : night,
      startsAt,
      endsAt,
      venueId,
      confirmation: CONFIRMATION_RECURRING,
      overridden: override !== null,
    });
  }

  // Nights added by an override (imported RDATE) that the rule itself does not produce.
  for (const [night, exception] of byNight) {
    if (exception.cancel || seen.has(night) || !exception.override?.startsAt) continue;
    if (night < from || night > lastNight) continue;
    const { startsAt } = exception.override;
    occurrences.push({
      nightDate: nightOf(startsAt, tz),
      startsAt,
      endsAt:
        exception.override.endsAt !== undefined ? exception.override.endsAt : endFor(startsAt),
      venueId: exception.override.venueId !== undefined ? exception.override.venueId : seriesVenue,
      confirmation: CONFIRMATION_RECURRING,
      overridden: true,
    });
  }

  return occurrences.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}

// ---------------------------------------------------------------------------------------------
// EXDATE / RDATE import

const EX_LINE = /^(EXDATE|RDATE)((?:;[^:]*)?):(.+)$/i;
const ICS_VALUE = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z?))?$/;

function icsParams(raw: string): Map<string, string> {
  const params = new Map<string, string>();
  for (const part of raw.split(";")) {
    if (!part) continue;
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    params.set(part.slice(0, eq).toUpperCase(), part.slice(eq + 1).replace(/^"|"$/g, ""));
  }
  return params;
}

/** Instant of one EXDATE/RDATE value; DATE values take the rule's DTSTART wall time. */
function icsValueToInstant(value: string, params: Map<string, string>, rule: ParsedRule): Date {
  const m = ICS_VALUE.exec(value.trim());
  if (!m) throw new RecurrenceError(`Unsupported EXDATE/RDATE value: ${value}`);
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const valueType = (
    params.get("VALUE") ?? (m[4] === undefined ? "DATE" : "DATE-TIME")
  ).toUpperCase();
  if (valueType === "PERIOD")
    throw new RecurrenceError(`RDATE periods are not supported: ${value}`);
  if (valueType === "DATE" || m[4] === undefined) {
    const local = LOCAL_DATETIME.exec(rule.dtstartLocal);
    const hour = local ? Number(local[4]) : 0;
    const minute = local ? Number(local[5]) : 0;
    const second = local?.[6] ? Number(local[6]) : 0;
    return wallToInstant(year, month, day, hour, minute, second, rule.tz);
  }
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  const second = Number(m[6]);
  if (m[7] === "Z") return new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  const tzid = params.get("TZID");
  const zone = tzid ? parseWith(zoneSchema, tzid, "TZID") : rule.tz;
  return wallToInstant(year, month, day, hour, minute, second, zone);
}

/**
 * Turn ICS EXDATE and RDATE lines (unfolded; one or more, as a string or an array) into
 * series_exceptions rows keyed by night date: EXDATE cancels, RDATE overrides with the given start.
 * Values may be DATE, floating DATE-TIME (read in the rule's zone), TZID DATE-TIME or UTC ("Z").
 * Throws RecurrenceError on a value it cannot read, so the adapter can flag the source.
 */
export function importExdates(
  lines: string | readonly string[],
  rule: ParsedRule,
  options: { nightDate?: NightDateFn } = {},
): SeriesException[] {
  const nightOf = options.nightDate ?? nightDate;
  const input = typeof lines === "string" ? lines.split(/\r?\n/) : [...lines];
  const rows: SeriesException[] = [];
  const keys = new Set<string>();
  for (const raw of input) {
    const line = raw.trim();
    if (!line) continue;
    const m = EX_LINE.exec(line);
    if (!m || m[1] === undefined || m[3] === undefined) {
      throw new RecurrenceError(`Expected an EXDATE or RDATE line, got: ${line.slice(0, 40)}`);
    }
    const kind = m[1].toUpperCase();
    const params = icsParams(m[2] ?? "");
    for (const value of m[3].split(",")) {
      if (!value.trim()) continue;
      const instant = icsValueToInstant(value, params, rule);
      const night = nightOf(instant, rule.tz);
      const key = `${kind}:${night}:${instant.getTime()}`;
      if (keys.has(key)) continue;
      keys.add(key);
      rows.push(
        kind === "EXDATE"
          ? { nightDate: night, action: "cancel" }
          : { nightDate: night, action: "override", override: { startsAt: instant } },
      );
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------------------------
// Recurrence text

export type TextLang = "en" | "fr";

const BYDAY_ENTRY = /^([+-]?\d+)?(MO|TU|WE|TH|FR|SA|SU)$/;

interface ByDayEntry {
  ordinal: number | null;
  day: Weekday;
}

function parseByDay(entries: readonly string[]): ByDayEntry[] | null {
  const out: ByDayEntry[] = [];
  for (const entry of entries) {
    const m = BYDAY_ENTRY.exec(entry.toUpperCase());
    if (!m || m[2] === undefined) return null;
    out.push({ ordinal: m[1] ? Number(m[1]) : null, day: m[2] as Weekday });
  }
  return out;
}

function textLang(locale: string): TextLang {
  const lang = locale.toLowerCase().split(/[-_]/)[0];
  return lang === "fr" ? "fr" : "en";
}

const dayNameCache = new Map<string, string[]>();

/** Long weekday names in a locale, indexed like WEEKDAYS (Monday first). */
function dayNames(lang: TextLang): string[] {
  let names = dayNameCache.get(lang);
  if (!names) {
    const formatter = new Intl.DateTimeFormat(lang, { weekday: "long", timeZone: "UTC" });
    // 2024-01-01 is a Monday.
    names = WEEKDAYS.map((_, i) => formatter.format(new Date(Date.UTC(2024, 0, 1 + i))));
    dayNameCache.set(lang, names);
  }
  return names;
}

function dayName(lang: TextLang, day: Weekday, plural = false): string {
  const name = dayNames(lang)[WEEKDAYS.indexOf(day)] ?? day;
  return lang === "fr" && plural ? `${name}s` : name;
}

function joinList(lang: TextLang, items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  const and = lang === "fr" ? " et " : " and ";
  return `${items.slice(0, -1).join(", ")}${and}${items[items.length - 1]}`;
}

const enOrdinalRules = new Intl.PluralRules("en", { type: "ordinal" });

function ordinalWord(lang: TextLang, n: number, plural = false): string | null {
  if (lang === "fr") {
    if (n === -1) return plural ? "derniers" : "dernier";
    if (n === -2) return plural ? "avant-derniers" : "avant-dernier";
    if (n < 0) return null;
    return n === 1 ? "1er" : `${n}e`;
  }
  if (n === -1) return "last";
  if (n < 0) return `${ordinalWord(lang, -n)} last`;
  const category = enOrdinalRules.select(n);
  const suffix =
    category === "one" ? "st" : category === "two" ? "nd" : category === "few" ? "rd" : "th";
  return `${n}${suffix}`;
}

function sameDays(a: readonly Weekday[], b: readonly Weekday[]): boolean {
  return a.length === b.length && a.every((day) => b.includes(day));
}

function sortDays(days: Iterable<Weekday>): Weekday[] {
  return [...new Set(days)].sort((a, b) => WEEKDAYS.indexOf(a) - WEEKDAYS.indexOf(b));
}

function weeklyText(lang: TextLang, interval: number, days: readonly Weekday[]): string | null {
  const plural = joinList(
    lang,
    days.map((day) => dayName(lang, day, true)),
  );
  const singular = joinList(
    lang,
    days.map((day) => dayName(lang, day)),
  );
  if (interval === 1) {
    if (sameDays(days, MON_TO_FRI)) return lang === "fr" ? "Du lundi au vendredi" : "Every weekday";
    return lang === "fr" ? `Tous les ${plural}` : `Every ${singular}`;
  }
  if (interval === 2) {
    if (lang === "fr")
      return days.length === 1 ? `Un ${singular} sur deux` : `Une semaine sur deux, le ${singular}`;
    return `Every other ${singular}`;
  }
  return lang === "fr"
    ? `Toutes les ${interval} semaines, le ${singular}`
    : `Every ${interval} weeks on ${singular}`;
}

function monthlyOrdinalText(
  lang: TextLang,
  groups: readonly { day: Weekday; ordinals: number[] }[],
): string | null {
  const parts: string[] = [];
  for (const group of groups) {
    const many = group.ordinals.length > 1;
    const words: string[] = [];
    for (const ordinal of group.ordinals) {
      const word = ordinalWord(lang, ordinal, many);
      if (word === null) return null;
      words.push(word);
    }
    parts.push(`${joinList(lang, words)} ${dayName(lang, group.day, many)}`);
  }
  if (lang === "fr") {
    const article =
      groups.length === 1 && groups[0] && groups[0].ordinals.length > 1 ? "Les" : "Le";
    return `${article} ${joinList(lang, parts)} du mois`;
  }
  const only = groups[0];
  if (groups.length === 1 && only && only.ordinals.length === 1 && only.ordinals[0] === -1) {
    return `Last ${dayName(lang, only.day)} of the month`;
  }
  return `Every ${joinList(lang, parts)}`;
}

function frequencyWord(lang: TextLang, freq: Freq, interval: number): string | null {
  const fr = lang === "fr";
  switch (freq) {
    case "DAILY":
      return interval === 1
        ? fr
          ? "Tous les jours"
          : "Every day"
        : fr
          ? `Tous les ${interval} jours`
          : `Every ${interval} days`;
    case "WEEKLY":
      return interval === 1
        ? fr
          ? "Chaque semaine"
          : "Weekly"
        : fr
          ? `Toutes les ${interval} semaines`
          : `Every ${interval} weeks`;
    case "MONTHLY":
      return interval === 1
        ? fr
          ? "Tous les mois"
          : "Monthly"
        : fr
          ? `Tous les ${interval} mois`
          : `Every ${interval} months`;
    case "YEARLY":
      return interval === 1
        ? fr
          ? "Tous les ans"
          : "Yearly"
        : fr
          ? `Tous les ${interval} ans`
          : `Every ${interval} years`;
    default:
      return null;
  }
}

/**
 * Plain recurrence copy for a rule, in en or fr (other locales fall back to en): "Every Thursday",
 * "Every 2nd and 4th Saturday", "Last Friday of the month", "Monthly", "Every weekday". Returns null
 * for rules with no plain description (sub-daily frequencies).
 */
export function recurrenceText(rule: ParsedRule | string, locale = "en"): string | null {
  const parsed = typeof rule === "string" ? parseStoredRule(rule) : rule;
  const lang = textLang(locale);
  const interval = parsed.interval > 0 ? parsed.interval : 1;
  const byDay = parseByDay(parsed.byDay);
  if (byDay === null) return frequencyWord(lang, parsed.freq, interval);
  const plainDays = sortDays(byDay.map((entry) => entry.day));

  switch (parsed.freq) {
    case "DAILY": {
      if (interval === 1 && plainDays.length > 0 && sameDays(plainDays, MON_TO_FRI)) {
        return lang === "fr" ? "Du lundi au vendredi" : "Every weekday";
      }
      if (interval === 1 && plainDays.length > 0) return weeklyText(lang, 1, plainDays);
      return frequencyWord(lang, "DAILY", interval);
    }
    case "WEEKLY": {
      const days =
        plainDays.length > 0
          ? plainDays
          : [WEEKDAYS[parsed.rule.options().dtstart.dayOfWeek - 1] ?? "MO"];
      return weeklyText(lang, interval, days);
    }
    case "MONTHLY": {
      if (interval !== 1 || byDay.length === 0 || parsed.byMonthDay.length > 0) {
        return frequencyWord(lang, "MONTHLY", interval);
      }
      const ordinalEntries = byDay.filter((entry) => entry.ordinal !== null);
      if (ordinalEntries.length === 0 && parsed.bySetPos.length === 0) {
        // BYDAY without a position inside MONTHLY is every such weekday: read it as weekly.
        return weeklyText(lang, 1, plainDays);
      }
      if (ordinalEntries.length !== 0 && ordinalEntries.length !== byDay.length) {
        return frequencyWord(lang, "MONTHLY", 1);
      }
      const groups: { day: Weekday; ordinals: number[] }[] = [];
      const push = (day: Weekday, ordinal: number) => {
        const group = groups.find((g) => g.day === day);
        if (group) {
          if (!group.ordinals.includes(ordinal)) group.ordinals.push(ordinal);
        } else groups.push({ day, ordinals: [ordinal] });
      };
      if (ordinalEntries.length > 0) {
        for (const entry of ordinalEntries) push(entry.day, entry.ordinal as number);
      } else {
        for (const day of plainDays) for (const pos of parsed.bySetPos) push(day, pos);
      }
      for (const group of groups) {
        group.ordinals.sort((a, b) => (a < 0 && b < 0 ? b - a : a < 0 ? 1 : b < 0 ? -1 : a - b));
      }
      return monthlyOrdinalText(lang, groups) ?? frequencyWord(lang, "MONTHLY", 1);
    }
    case "YEARLY":
      return frequencyWord(lang, "YEARLY", interval);
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------------------------
// Recurrence text parsing: deterministic phrases only

export const PARSE_LANGS = ["en", "fr", "es", "de", "pt", "ca", "tr", "ar", "ja", "zh"] as const;
export type ParseLang = (typeof PARSE_LANGS)[number];
export const parseLangSchema = z.enum(PARSE_LANGS);

export interface Pattern {
  /** Template using {DL} (day list), {D} (one day), {OL} (ordinal list) and named groups. */
  template: string;
  freq: "WEEKLY" | "MONTHLY" | "DAILY" | "YEARLY";
  interval?: number;
  /** Days must all be in their plural (habitual) form for a bare list such as "Thursdays". */
  requirePlural?: boolean;
  /** The pattern names a position in the month (groups: ords, day, every, ofmonth). */
  ordinal?: boolean;
  /** The pattern is a weekday range (groups: from, to). */
  range?: boolean;
  /** Monday to Friday. */
  weekdays?: boolean;
}

export interface LangSpec {
  days: Record<string, Weekday>;
  /** The habitual forms ("thursdays", "freitags", "jeudis") accepted in a bare list. */
  pluralDays: readonly string[];
  ordinals: Record<string, number>;
  numbers: Record<string, number>;
  /** Words that join list items besides "," and "&". */
  and: readonly string[];
  /** Language treats "every second X" as ambiguous between "every other X" and "2nd X of the month". */
  everyTwoIsAmbiguous: boolean;
  patterns: readonly Pattern[];
}

function dayForms(
  base: Record<Weekday, readonly string[]>,
  suffixes: readonly string[],
): { days: Record<string, Weekday>; plural: string[] } {
  const days: Record<string, Weekday> = {};
  const plural: string[] = [];
  for (const day of WEEKDAYS) {
    for (const form of base[day]) {
      days[form] = day;
      for (const suffix of suffixes) {
        days[`${form}${suffix}`] = day;
        plural.push(`${form}${suffix}`);
      }
    }
  }
  return { days, plural };
}

const en = dayForms(
  {
    MO: ["monday", "mon"],
    TU: ["tuesday", "tues", "tue"],
    WE: ["wednesday", "weds", "wed"],
    TH: ["thursday", "thurs", "thur", "thu"],
    FR: ["friday", "fri"],
    SA: ["saturday", "sat"],
    SU: ["sunday", "sun"],
  },
  ["s"],
);

const fr = dayForms(
  {
    MO: ["lundi"],
    TU: ["mardi"],
    WE: ["mercredi"],
    TH: ["jeudi"],
    FR: ["vendredi"],
    SA: ["samedi"],
    SU: ["dimanche"],
  },
  ["s"],
);

const es = (() => {
  const forms = dayForms(
    {
      MO: ["lunes"],
      TU: ["martes"],
      WE: ["miercoles"],
      TH: ["jueves"],
      FR: ["viernes"],
      SA: ["sabado"],
      SU: ["domingo"],
    },
    [],
  );
  forms.days.sabados = "SA";
  forms.days.domingos = "SU";
  forms.plural = ["lunes", "martes", "miercoles", "jueves", "viernes", "sabados", "domingos"];
  return forms;
})();

const de = dayForms(
  {
    MO: ["montag"],
    TU: ["dienstag"],
    WE: ["mittwoch"],
    TH: ["donnerstag"],
    FR: ["freitag"],
    SA: ["samstag", "sonnabend"],
    SU: ["sonntag"],
  },
  ["s", "en"],
);

const LANGS: Record<ParseLang, LangSpec> = {
  en: {
    days: en.days,
    pluralDays: en.plural,
    ordinals: {
      first: 1,
      "1st": 1,
      second: 2,
      "2nd": 2,
      third: 3,
      "3rd": 3,
      fourth: 4,
      "4th": 4,
      fifth: 5,
      "5th": 5,
      last: -1,
      final: -1,
    },
    numbers: { two: 2, three: 3, four: 4, five: 5, six: 6 },
    and: ["and"],
    everyTwoIsAmbiguous: true,
    patterns: [
      {
        template: "(?:every|each)\\s+{DL}(?:\\s+(?:night|nights|evening|evenings))?",
        freq: "WEEKLY",
      },
      { template: "{DL}(?:\\s+(?:nights|evenings))?", freq: "WEEKLY", requirePlural: true },
      { template: "(?:weekly|every\\s+week|each\\s+week)(?:\\s+on)?\\s+{DL}", freq: "WEEKLY" },
      { template: "(?:weekly|every\\s+week|each\\s+week|once\\s+a\\s+week)", freq: "WEEKLY" },
      { template: "every\\s+other\\s+{DL}", freq: "WEEKLY", interval: 2 },
      { template: "alternate\\s+{DL}", freq: "WEEKLY", interval: 2, requirePlural: true },
      {
        template:
          "(?:fortnightly|every\\s+fortnight|every\\s+other\\s+week|every\\s+(?:two|2)\\s+weeks)(?:\\s+on)?(?:\\s+{DL})?",
        freq: "WEEKLY",
        interval: 2,
      },
      {
        template: "every\\s+(?<n>\\d+|three|four|five|six)\\s+weeks(?:\\s+on)?(?:\\s+{DL})?",
        freq: "WEEKLY",
      },
      {
        template:
          "(?<every>(?:every|each)\\s+)?(?:the\\s+)?{OL}\\s+{D}(?:\\s+(?:night|nights|evening|evenings))?(?<ofmonth>\\s+(?:of|in)\\s+(?:the|each|every)\\s+month)?",
        freq: "MONTHLY",
        ordinal: true,
      },
      {
        template:
          "(?:every\\s+|each\\s+|on\\s+)?(?:weekday|weekdays|weeknights|week\\s+days|week\\s+nights)",
        freq: "WEEKLY",
        weekdays: true,
      },
      {
        template: "(?:every\\s+)?{D}\\s+(?:to|through|thru|until|till|-)\\s+{D}",
        freq: "WEEKLY",
        range: true,
      },
      {
        template: "(?:daily|every\\s+day|each\\s+day|every\\s+night|nightly|every\\s+evening)",
        freq: "DAILY",
      },
      { template: "(?:monthly|every\\s+month|each\\s+month|once\\s+a\\s+month)", freq: "MONTHLY" },
      {
        template: "(?:yearly|annually|annual|every\\s+year|each\\s+year|once\\s+a\\s+year)",
        freq: "YEARLY",
      },
    ],
  },
  fr: {
    days: fr.days,
    pluralDays: fr.plural,
    ordinals: {
      premier: 1,
      premiers: 1,
      premiere: 1,
      "1er": 1,
      "1re": 1,
      deuxieme: 2,
      deuxiemes: 2,
      second: 2,
      seconds: 2,
      seconde: 2,
      "2e": 2,
      "2eme": 2,
      "2nd": 2,
      troisieme: 3,
      troisiemes: 3,
      "3e": 3,
      "3eme": 3,
      quatrieme: 4,
      quatriemes: 4,
      "4e": 4,
      "4eme": 4,
      cinquieme: 5,
      cinquiemes: 5,
      "5e": 5,
      "5eme": 5,
      dernier: -1,
      derniers: -1,
      derniere: -1,
    },
    numbers: { deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6 },
    and: ["et"],
    everyTwoIsAmbiguous: false,
    patterns: [
      { template: "(?:tous\\s+les|chaque|les|le)\\s+{DL}(?:\\s+(?:soir|soirs))?", freq: "WEEKLY" },
      { template: "un\\s+{D}\\s+sur\\s+deux", freq: "WEEKLY", interval: 2 },
      { template: "tous\\s+les\\s+deux\\s+{DL}", freq: "WEEKLY", interval: 2 },
      {
        template:
          "(?:toutes\\s+les\\s+(?:deux|2)\\s+semaines|tous\\s+les\\s+(?:quinze|15)\\s+jours|une\\s+semaine\\s+sur\\s+deux)(?:\\s+(?:le|les)\\s+{DL})?",
        freq: "WEEKLY",
        interval: 2,
      },
      {
        template:
          "toutes\\s+les\\s+(?<n>\\d+|trois|quatre|cinq|six)\\s+semaines(?:\\s+(?:le|les)\\s+{DL})?",
        freq: "WEEKLY",
      },
      {
        template:
          "(?<every>(?:le|les|chaque|tous\\s+les)\\s+)?{OL}\\s+{D}(?<ofmonth>\\s+(?:du|de\\s+chaque|de\\s+tous\\s+les)\\s+mois)?",
        freq: "MONTHLY",
        ordinal: true,
      },
      {
        template:
          "(?:en\\s+semaine|la\\s+semaine|tous\\s+les\\s+jours\\s+de\\s+(?:la\\s+)?semaine)",
        freq: "WEEKLY",
        weekdays: true,
      },
      { template: "du\\s+{D}\\s+au\\s+{D}", freq: "WEEKLY", range: true },
      {
        template:
          "(?:tous\\s+les\\s+jours|chaque\\s+jour|tous\\s+les\\s+soirs|chaque\\s+soir|quotidien|quotidienne)",
        freq: "DAILY",
      },
      {
        template:
          "(?:toutes\\s+les\\s+semaines|chaque\\s+semaine|hebdomadaire|hebdo|une\\s+fois\\s+par\\s+semaine)",
        freq: "WEEKLY",
      },
      {
        template:
          "(?:tous\\s+les\\s+mois|chaque\\s+mois|mensuel|mensuelle|une\\s+fois\\s+par\\s+mois)",
        freq: "MONTHLY",
      },
      {
        template: "(?:tous\\s+les\\s+ans|chaque\\s+annee|annuel|annuelle|une\\s+fois\\s+par\\s+an)",
        freq: "YEARLY",
      },
    ],
  },
  es: {
    days: es.days,
    pluralDays: es.plural,
    ordinals: {
      primer: 1,
      primero: 1,
      primeros: 1,
      primera: 1,
      "1er": 1,
      "1o": 1,
      "1ro": 1,
      segundo: 2,
      segundos: 2,
      segunda: 2,
      "2o": 2,
      "2do": 2,
      tercer: 3,
      tercero: 3,
      terceros: 3,
      tercera: 3,
      "3er": 3,
      "3o": 3,
      "3ro": 3,
      cuarto: 4,
      cuartos: 4,
      cuarta: 4,
      "4o": 4,
      "4to": 4,
      quinto: 5,
      quintos: 5,
      quinta: 5,
      "5o": 5,
      "5to": 5,
      ultimo: -1,
      ultimos: -1,
      ultima: -1,
    },
    numbers: { dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6 },
    and: ["y", "e"],
    everyTwoIsAmbiguous: true,
    patterns: [
      { template: "(?:todos\\s+los|cada|los)\\s+{DL}(?:\\s+por\\s+la\\s+noche)?", freq: "WEEKLY" },
      { template: "cada\\s+dos\\s+{DL}", freq: "WEEKLY", interval: 2 },
      { template: "{DL}\\s+alternos", freq: "WEEKLY", interval: 2 },
      {
        template:
          "(?:cada\\s+(?:dos|2)\\s+semanas|cada\\s+(?:quince|15)\\s+dias|quincenal|quincenalmente)(?:\\s+(?:los|el)\\s+{DL})?",
        freq: "WEEKLY",
        interval: 2,
      },
      {
        template: "cada\\s+(?<n>\\d+|tres|cuatro|cinco|seis)\\s+semanas(?:\\s+(?:los|el)\\s+{DL})?",
        freq: "WEEKLY",
      },
      {
        template:
          "(?<every>(?:el|los|cada|todos\\s+los)\\s+)?{OL}\\s+{D}(?<ofmonth>\\s+(?:del|de\\s+cada)\\s+mes)?",
        freq: "MONTHLY",
        ordinal: true,
      },
      {
        template: "(?:entre\\s+semana|dias\\s+de\\s+semana|de\\s+lunes\\s+a\\s+viernes)",
        freq: "WEEKLY",
        weekdays: true,
      },
      { template: "de\\s+{D}\\s+a\\s+{D}", freq: "WEEKLY", range: true },
      {
        template:
          "(?:todos\\s+los\\s+dias|cada\\s+dia|a\\s+diario|diario|diariamente|todas\\s+las\\s+noches|cada\\s+noche)",
        freq: "DAILY",
      },
      {
        template:
          "(?:semanal|semanalmente|cada\\s+semana|todas\\s+las\\s+semanas|una\\s+vez\\s+a\\s+la\\s+semana|una\\s+vez\\s+por\\s+semana)",
        freq: "WEEKLY",
      },
      {
        template:
          "(?:mensual|mensualmente|cada\\s+mes|todos\\s+los\\s+meses|una\\s+vez\\s+al\\s+mes)",
        freq: "MONTHLY",
      },
      {
        template: "(?:anual|anualmente|cada\\s+ano|todos\\s+los\\s+anos|una\\s+vez\\s+al\\s+ano)",
        freq: "YEARLY",
      },
    ],
  },
  de: {
    days: de.days,
    pluralDays: de.plural,
    ordinals: {
      erste: 1,
      ersten: 1,
      erster: 1,
      "1.": 1,
      zweite: 2,
      zweiten: 2,
      zweiter: 2,
      "2.": 2,
      dritte: 3,
      dritten: 3,
      dritter: 3,
      "3.": 3,
      vierte: 4,
      vierten: 4,
      vierter: 4,
      "4.": 4,
      funfte: 5,
      funften: 5,
      funfter: 5,
      "5.": 5,
      letzte: -1,
      letzten: -1,
      letzter: -1,
    },
    numbers: { zwei: 2, drei: 3, vier: 4, funf: 5, sechs: 6 },
    and: ["und"],
    everyTwoIsAmbiguous: true,
    patterns: [
      {
        template: "(?:jeden|immer|an\\s+allen|immer\\s+am|am)\\s+{DL}(?:\\s+abend)?",
        freq: "WEEKLY",
      },
      { template: "{DL}(?:\\s+abends)?", freq: "WEEKLY", requirePlural: true },
      {
        template:
          "(?:alle\\s+(?:zwei|2)\\s+wochen|alle\\s+(?:vierzehn|14)\\s+tage|jede\\s+zweite\\s+woche|zweiwochentlich|vierzehntagig)(?:\\s+(?:am\\s+)?{DL})?",
        freq: "WEEKLY",
        interval: 2,
      },
      {
        template: "alle\\s+(?<n>\\d+|drei|vier|funf|sechs)\\s+wochen(?:\\s+(?:am\\s+)?{DL})?",
        freq: "WEEKLY",
      },
      {
        template:
          "(?<every>(?:jeden|jedem|an\\s+jedem|immer\\s+am|am|der)\\s+)?{OL}\\s+{D}(?<ofmonth>\\s+(?:im|des|eines|jeden|in\\s+jedem)\\s+monats?)?",
        freq: "MONTHLY",
        ordinal: true,
      },
      {
        template: "(?:wochentags|werktags|unter\\s+der\\s+woche|an\\s+wochentagen)",
        freq: "WEEKLY",
        weekdays: true,
      },
      { template: "(?:von\\s+)?{D}\\s+bis\\s+{D}", freq: "WEEKLY", range: true },
      { template: "(?:taglich|jeden\\s+tag|jeden\\s+abend|allabendlich)", freq: "DAILY" },
      {
        template: "(?:wochentlich|jede\\s+woche|einmal\\s+pro\\s+woche|einmal\\s+die\\s+woche)",
        freq: "WEEKLY",
      },
      {
        template: "(?:monatlich|jeden\\s+monat|einmal\\s+im\\s+monat|einmal\\s+pro\\s+monat)",
        freq: "MONTHLY",
      },
      { template: "(?:jahrlich|jedes\\s+jahr|einmal\\s+im\\s+jahr)", freq: "YEARLY" },
    ],
  },
  pt: (() => {
    // "quinta-feira" reaches the patterns as "quinta - feira" (normalizeText spaces hyphens); the
    // habitual plural is "quintas-feiras". Each short day also stands alone ("toda quinta").
    const forms: { days: Record<string, Weekday>; plural: string[] } = { days: {}, plural: [] };
    const short: Record<Weekday, string> = {
      MO: "segunda",
      TU: "terca",
      WE: "quarta",
      TH: "quinta",
      FR: "sexta",
      SA: "sabado",
      SU: "domingo",
    };
    for (const day of WEEKDAYS) {
      const name = short[day];
      const longForms = day === "SA" || day === "SU" ? [] : [" - feira", " feira"];
      for (const tail of ["", ...longForms]) {
        forms.days[`${name}${tail}`] = day;
        const plural = `${name}s${tail.replace("feira", "feiras")}`;
        forms.days[plural] = day;
        forms.plural.push(plural);
      }
    }
    return {
      days: forms.days,
      pluralDays: forms.plural,
      ordinals: {
        primeiro: 1,
        primeira: 1,
        "1o": 1,
        "1a": 1,
        segundo: 2,
        segunda: 2,
        "2o": 2,
        "2a": 2,
        terceiro: 3,
        terceira: 3,
        "3o": 3,
        "3a": 3,
        quarto: 4,
        quarta: 4,
        "4o": 4,
        "4a": 4,
        quinto: 5,
        quinta: 5,
        "5o": 5,
        "5a": 5,
        ultimo: -1,
        ultima: -1,
      },
      numbers: { duas: 2, dois: 2, tres: 3, quatro: 4 },
      and: ["e"],
      everyTwoIsAmbiguous: true,
      patterns: [
        {
          template:
            "(?:todas\\s+as|todos\\s+os|toda|todo|cada|a\\s+cada)\\s+{DL}(?:\\s+a\\s+noite|\\s+a\\s+tarde)?",
          freq: "WEEKLY",
        },
        {
          template: "(?:as|aos|nas|nos)\\s+{DL}",
          freq: "WEEKLY",
          requirePlural: true,
        },
        {
          template: "a\\s+cada\\s+(?:duas|2)\\s+semanas(?:\\s+(?:as|aos|nas|nos|na|no)\\s+{DL})?",
          freq: "WEEKLY",
          interval: 2,
        },
        {
          template: "quinzenal(?:mente)?",
          freq: "WEEKLY",
          interval: 2,
        },
        {
          template: "de\\s+15\\s+em\\s+15\\s+dias",
          freq: "WEEKLY",
          interval: 2,
        },
        {
          template:
            "de\\s+segunda\\s+a\\s+sexta(?:\\s+-?\\s*feira)?|dias\\s+uteis|durante\\s+a\\s+semana",
          freq: "WEEKLY",
          weekdays: true,
        },
        {
          template: "de\\s+{D}\\s+a\\s+{D}",
          freq: "WEEKLY",
          range: true,
        },
        {
          template:
            "todos\\s+os\\s+dias|todas\\s+as\\s+noites|diariamente|todo\\s+dia|toda\\s+noite",
          freq: "DAILY",
        },
        {
          template:
            "semanal(?:mente)?|toda\\s+semana|todas\\s+as\\s+semanas|uma\\s+vez\\s+por\\s+semana",
          freq: "WEEKLY",
        },
        {
          template: "mensal(?:mente)?|todo\\s+mes|todos\\s+os\\s+meses|uma\\s+vez\\s+por\\s+mes",
          freq: "MONTHLY",
        },
        {
          template: "anual(?:mente)?|todo\\s+ano|todos\\s+os\\s+anos|uma\\s+vez\\s+por\\s+ano",
          freq: "YEARLY",
        },
        {
          template:
            "(?:(?:todo|toda|todos|todas|o|a|os|as|no|na|cada)\\s+)?{OL}\\s+{D}\\s+(?:do|de\\s+cada)\\s+mes",
          freq: "MONTHLY",
          ordinal: true,
        },
      ],
    };
  })(),
  ca: (() => {
    const forms = dayForms(
      {
        MO: ["dilluns"],
        TU: ["dimarts"],
        WE: ["dimecres"],
        TH: ["dijous"],
        FR: ["divendres"],
        SA: ["dissabte"],
        SU: ["diumenge"],
      },
      ["s"],
    );
    // Catalan plurals: dilluns..divendres are invariant, plus dissabtes/diumenges
    forms.plural = [
      "dilluns",
      "dimarts",
      "dimecres",
      "dijous",
      "divendres",
      "dissabtes",
      "diumenges",
    ];
    return {
      days: forms.days,
      pluralDays: forms.plural,
      ordinals: {
        primer: 1,
        primera: 1,
        "1r": 1,
        "1a": 1,
        segon: 2,
        segona: 2,
        "2n": 2,
        "2a": 2,
        tercer: 3,
        tercera: 3,
        "3r": 3,
        "3a": 3,
        quart: 4,
        quarta: 4,
        "4t": 4,
        "4a": 4,
        cinque: 5,
        cinquena: 5,
        "5e": 5,
        "5a": 5,
        ultim: -1,
        ultima: -1,
        darrer: -1,
        darrera: -1,
      },
      numbers: { dues: 2, dos: 2, tres: 3, quatre: 4 },
      and: ["i"],
      everyTwoIsAmbiguous: true,
      patterns: [
        {
          template:
            "(?:tots\\s+els|totes\\s+les|cada|els)\\s+{DL}(?:\\s+a\\s+la\\s+nit|\\s+al\\s+vespre)?",
          freq: "WEEKLY",
        },
        {
          template: "cada\\s+(?:dues|2)\\s+setmanes(?:\\s+(?:els|el)\\s+{DL})?",
          freq: "WEEKLY",
          interval: 2,
        },
        {
          template: "cada\\s+(?:quinze|15)\\s+dies",
          freq: "WEEKLY",
          interval: 2,
        },
        {
          template: "quinzenal(?:ment)?",
          freq: "WEEKLY",
          interval: 2,
        },
        {
          template:
            "(?<every>(?:el|els|cada|tots\\s+els)\\s+)?{OL}\\s+{D}(?<ofmonth>\\s+(?:del|de\\s+cada|de)\\s+mes)?",
          freq: "MONTHLY",
          ordinal: true,
        },
        {
          template: "entre\\s+setmana|de\\s+dilluns\\s+a\\s+divendres|dies\\s+feiners",
          freq: "WEEKLY",
          weekdays: true,
        },
        {
          template: "de\\s+{D}\\s+a\\s+{D}",
          freq: "WEEKLY",
          range: true,
        },
        {
          template: "cada\\s+dia|tots\\s+els\\s+dies|diariament|cada\\s+nit|totes\\s+les\\s+nits",
          freq: "DAILY",
        },
        {
          template:
            "setmanal(?:ment)?|cada\\s+setmana|totes\\s+les\\s+setmanes|un\\s+cop\\s+a\\s+la\\s+setmana",
          freq: "WEEKLY",
        },
        {
          template: "mensual(?:ment)?|cada\\s+mes|tots\\s+els\\s+mesos|un\\s+cop\\s+al\\s+mes",
          freq: "MONTHLY",
        },
        {
          template: "anual(?:ment)?|cada\\s+any|tots\\s+els\\s+anys|un\\s+cop\\s+l\\s+any",
          freq: "YEARLY",
        },
      ],
    };
  })(),
  tr: (() => {
    // Base day names (ASCII after normalization)
    const base: Record<Weekday, string> = {
      MO: "pazartesi",
      TU: "sali",
      WE: "carsamba",
      TH: "persembe",
      FR: "cuma",
      SA: "cumartesi",
      SU: "pazar",
    };
    // Plural forms (-lari/-leri)
    const plural: Record<Weekday, string> = {
      MO: "pazartesileri",
      TU: "salilari",
      WE: "carsambalari",
      TH: "persembeleri",
      FR: "cumalari",
      SA: "cumartesileri",
      SU: "pazarlari",
    };
    // Possessive forms (-si/-i)
    const possessive: Record<Weekday, string> = {
      MO: "pazartesisi",
      TU: "salisi",
      WE: "carsambasi",
      TH: "persembesi",
      FR: "cumasi",
      SA: "cumartesisi",
      SU: "pazari",
    };
    const days: Record<string, Weekday> = {};
    const pluralDays: string[] = [];
    const entries = [
      { day: "MO", base: base.MO, plural: plural.MO, possessive: possessive.MO },
      { day: "TU", base: base.TU, plural: plural.TU, possessive: possessive.TU },
      { day: "WE", base: base.WE, plural: plural.WE, possessive: possessive.WE },
      { day: "TH", base: base.TH, plural: plural.TH, possessive: possessive.TH },
      { day: "FR", base: base.FR, plural: plural.FR, possessive: possessive.FR },
      { day: "SA", base: base.SA, plural: plural.SA, possessive: possessive.SA },
      { day: "SU", base: base.SU, plural: plural.SU, possessive: possessive.SU },
    ] as const;
    for (const entry of entries) {
      const day = entry.day as Weekday;
      days[entry.base] = day;
      days[entry.plural] = day;
      days[entry.possessive] = day;
      pluralDays.push(entry.plural);
    }
    return {
      days,
      pluralDays,
      ordinals: {
        ilk: 1,
        birinci: 1,
        ikinci: 2,
        ucuncu: 3,
        dorduncu: 4,
        besinci: 5,
        son: -1,
      },
      numbers: { iki: 2, uc: 3, dort: 4 },
      and: ["ve", "ile"],
      everyTwoIsAmbiguous: false,
      patterns: [
        {
          template: "(?:her\\s+hafta\\s+)?her\\s+{DL}(?:\\s+(?:gunu|aksami|gecesi))?",
          freq: "WEEKLY",
        },
        {
          template: "her\\s+hafta\\s+{DL}(?:\\s+(?:gunu|aksami|gecesi))?",
          freq: "WEEKLY",
        },
        {
          template: "{DL}\\s+(?:gunleri|aksamlari|geceleri)",
          freq: "WEEKLY",
        },
        {
          template: "{DL}(?:\\s+(?:aksamlari|geceleri))?",
          freq: "WEEKLY",
          requirePlural: true,
        },
        {
          template: "(?:iki|2)\\s+haftada\\s+bir(?:\\s+{DL})?",
          freq: "WEEKLY",
          interval: 2,
        },
        {
          template: "(?:her\\s+)?ayin\\s+{OL}\\s+{D}(?<ofmonth>)",
          freq: "MONTHLY",
          ordinal: true,
        },
        {
          template: "hafta\\s+ici(?:\\s+her\\s+gun)?|pazartesiden\\s+cumaya",
          freq: "WEEKLY",
          weekdays: true,
        },
        {
          template: "her\\s+gun|her\\s+gece|her\\s+aksam|hergun|gunluk",
          freq: "DAILY",
        },
        {
          template: "her\\s+hafta|haftalik|haftada\\s+bir",
          freq: "WEEKLY",
        },
        {
          template: "her\\s+ay|aylik|ayda\\s+bir",
          freq: "MONTHLY",
        },
        {
          template: "her\\s+yil|yillik|yilda\\s+bir",
          freq: "YEARLY",
        },
      ],
    };
  })(),
  ar: (() => {
    // Base day names (folded form)
    const base: Record<Weekday, string[]> = {
      MO: ["اثنين", "الاثنين"],
      TU: ["ثلاثاء", "الثلاثاء"],
      WE: ["اربعاء", "الاربعاء"],
      TH: ["خميس", "الخميس"],
      FR: ["جمعه", "الجمعه"],
      SA: ["سبت", "السبت"],
      SU: ["احد", "الاحد"],
    };
    const days: Record<string, Weekday> = {};
    for (const [day, forms] of Object.entries(base)) {
      for (const form of forms) {
        days[form] = day as Weekday;
      }
    }
    return {
      days,
      pluralDays: [], // a bare day name is never weekly
      ordinals: {
        اول: 1,
        الاول: 1,
        اولي: 1,
        الاولي: 1,
        ثاني: 2,
        الثاني: 2,
        ثانيه: 2,
        الثانيه: 2,
        ثالث: 3,
        الثالث: 3,
        ثالثه: 3,
        الثالثه: 3,
        رابع: 4,
        الرابع: 4,
        رابعه: 4,
        الرابعه: 4,
        خامس: 5,
        الخامس: 5,
        خامسه: 5,
        الخامسه: 5,
        اخر: -1,
        الاخير: -1,
        اخير: -1,
        الاخيره: -1,
        اخيره: -1,
      },
      numbers: {}, // "اثنين" is both "two" and Monday
      and: ["و"],
      everyTwoIsAmbiguous: false,
      patterns: [
        {
          template: "(?:(?:مساء|ليله)\\s+)?كل\\s+(?:يوم\\s+)?{DL}(?:\\s+(?:مساء|ليلا))?",
          freq: "WEEKLY",
        },
        {
          template: "(?:كل\\s+اسبوع|اسبوعيا)\\s+(?:يوم\\s+)?{DL}",
          freq: "WEEKLY",
        },
        {
          template: "(?:(?:يوم|ليله|مساء)\\s+)?{DL}\\s+من\\s+كل\\s+اسبوع",
          freq: "WEEKLY",
        },
        {
          template: "(?:ايام|ليالي|امسيات)\\s+{DL}",
          freq: "WEEKLY",
        },
        {
          template: "كل\\s+اسبوعين(?:\\s+(?:يوم\\s+)?{DL})?",
          freq: "WEEKLY",
          interval: 2,
        },
        {
          template: "(?:يوم\\s+)?{OL}\\s+{D}\\s+(?:من|في)\\s+(?:كل\\s+شهر|الشهر)(?<ofmonth>)",
          freq: "MONTHLY",
          ordinal: true,
        },
        {
          template: "(?:يوم\\s+)?{D}\\s+{OL}\\s+(?:من|في)\\s+(?:كل\\s+شهر|الشهر)(?<ofmonth>)",
          freq: "MONTHLY",
          ordinal: true,
        },
        {
          template: "من\\s+(?:يوم\\s+)?الاثنين\\s+(?:الي|حتي)\\s+(?:يوم\\s+)?الجمعه",
          freq: "WEEKLY",
          weekdays: true,
        },
        {
          template: "كل\\s+يوم|كل\\s+ليله|كل\\s+مساء|يوميا",
          freq: "DAILY",
        },
        {
          template: "كل\\s+اسبوع|اسبوعيا|اسبوعي|اسبوعيه",
          freq: "WEEKLY",
        },
        {
          template: "كل\\s+شهر|شهريا|شهري|شهريه",
          freq: "MONTHLY",
        },
        {
          template: "كل\\s+سنه|كل\\s+عام|سنويا|سنوي",
          freq: "YEARLY",
        },
      ],
    };
  })(),
  ja: (() => {
    // Base day names: X曜日, X曜, bare X
    const base: Record<Weekday, string[]> = {
      MO: ["月曜日", "月曜", "月"],
      TU: ["火曜日", "火曜", "火"],
      WE: ["水曜日", "水曜", "水"],
      TH: ["木曜日", "木曜", "木"],
      FR: ["金曜日", "金曜", "金"],
      SA: ["土曜日", "土曜", "土"],
      SU: ["日曜日", "日曜", "日"],
    };
    const days: Record<string, Weekday> = {};
    for (const [day, forms] of Object.entries(base)) {
      for (const form of forms) {
        days[form] = day as Weekday;
      }
    }
    return {
      days,
      pluralDays: [],
      ordinals: {
        // 第1..第5, 第一..第五
        第1: 1,
        第2: 2,
        第3: 3,
        第4: 4,
        第5: 5,
        第一: 1,
        第二: 2,
        第三: 3,
        第四: 4,
        第五: 5,
        // bare digits and kanji
        "1": 1,
        "2": 2,
        "3": 3,
        "4": 4,
        "5": 5,
        一: 1,
        二: 2,
        三: 3,
        四: 4,
        五: 5,
        // last
        最終: -1,
        最後の: -1,
      },
      numbers: {},
      and: ["及び"],
      everyTwoIsAmbiguous: false,
      patterns: [
        {
          template: "毎週\\s*(?:の\\s*)?{DL}(?:\\s*(?:の夜|夜|開催|定期開催|に開催))?",
          freq: "WEEKLY",
        },
        {
          template: "隔週\\s*(?:の\\s*)?{DL}(?:\\s*(?:の夜|夜|開催|定期開催|に開催))?",
          freq: "WEEKLY",
          interval: 2,
        },
        {
          template:
            "毎月\\s*(?:の\\s*)?{OL}\\s*{D}(?<ofmonth>)(?:\\s*(?:の夜|夜|開催|定期開催|に開催))?",
          freq: "MONTHLY",
          ordinal: true,
        },
        {
          template: "(?=第|最){OL}\\s*{D}(?<ofmonth>)(?:\\s*(?:の夜|夜|開催|定期開催|に開催))?",
          freq: "MONTHLY",
          ordinal: true,
        },
        {
          template: "(?:毎週\\s*)?平日(?:\\s*毎日)?",
          freq: "WEEKLY",
          weekdays: true,
        },
        {
          template: "(?:毎週\\s*)?{D}\\s*(?:-|から)\\s*{D}(?:\\s*まで)?",
          freq: "WEEKLY",
          range: true,
        },
        {
          template: "毎日|毎晩|毎夜",
          freq: "DAILY",
        },
        {
          template: "毎週",
          freq: "WEEKLY",
        },
        {
          template: "毎月",
          freq: "MONTHLY",
        },
        {
          template: "毎年",
          freq: "YEARLY",
        },
      ],
    };
  })(),
  zh: zhSpec,
};

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function alternation(words: readonly string[]): string {
  return `(?:${[...words]
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp)
    .join("|")})`;
}

interface CompiledLang {
  spec: LangSpec;
  splitter: RegExp;
  patterns: { pattern: Pattern; re: RegExp }[];
}

const compiledCache = new Map<ParseLang, CompiledLang>();

function compile(lang: ParseLang): CompiledLang {
  const cached = compiledCache.get(lang);
  if (cached) return cached;
  const spec = LANGS[lang];
  const day = alternation(Object.keys(spec.days));
  const ord = alternation(Object.keys(spec.ordinals));
  // A list's separator: a comma, "&", "and", or a comma before the last item's "and" ("1st, 3rd,
  // and 5th"), which read as extra words and dropped the listing (Stepping Out, 2026-09-28).
  const sep = `(?:\\s*,\\s*(?:(?:&|${alternation(spec.and)})\\s+)?|\\s*&\\s*|\\s+${alternation(spec.and)}\\s+)`;
  const dayList = `(?<days>${day}(?:${sep}${day})*)`;
  const ordList = `(?<ords>${ord}(?:${sep}${ord})*)`;
  let dayGroup = 0;
  const patterns = spec.patterns.map((pattern) => {
    dayGroup = 0;
    const source = pattern.template
      .replace(/\{DL\}/g, dayList)
      .replace(/\{OL\}/g, ordList)
      .replace(/\{D\}/g, () => {
        dayGroup += 1;
        return `(?<${dayGroup === 1 ? "day" : "day2"}>${day})`;
      });
    return { pattern, re: new RegExp(`^${source}$`) };
  });
  const compiled: CompiledLang = { spec, splitter: new RegExp(sep), patterns };
  compiledCache.set(lang, compiled);
  return compiled;
}

/**
 * Asides that change nothing about the schedule, dropped before parsing: "the 5th Sunday (if there
 * is one)" says what BYSETPOS=5 already means. Only these: any other parenthesis may be a hedge
 * ("(except holidays)") and still reads as extra words, so the phrase stays unread.
 */
const HARMLESS_ASIDES = /\(\s*(?:if|when)\s+there(?:\s+is|['’]s)\s+one\s*\)|\(\s*if\s+any\s*\)/gi;

function normalizeText(text: string): string {
  // Arabic comma and semicolon read as their Latin forms (D-1064).
  let processed = text.replace(/،/g, ",").replace(/؛/g, ";");
  // Japanese full-width digits -> ASCII
  processed = processed.replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
  // Japanese punctuation -> Latin
  processed = processed.replace(/[・、／]/g, ",");
  processed = processed.replace(/[〜～]/g, "-");
  // Japanese "と" between day words -> ","
  processed = processed.replace(/(曜日|曜|[月火水木金土日])と(?=[月火水木金土日])/g, "$1,");
  // Chinese "及/和/與/与/同" between day or ordinal words -> "," (D-773)
  processed = processed.replace(
    /(?<=[一二三四五六日天0-9個个])(?:及|和|與|与|同)(?=星期|週|周|禮拜|礼拜|第|最)/g,
    ",",
  );
  processed = processed
    .replace(HARMLESS_ASIDES, " ")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670\u0640]/g, "") // Arabic marks and tatweel; NFD split أ إ آ, so they fold to ا (D-1064)
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ı/g, "i") // Turkish dotless ı reads as i ("SALI" and "Salı" alike, D-683).
    .replace(/ß/g, "ss")
    .replace(/[º°]/g, "o")
    .replace(/ª/g, "a")
    .replace(/[’'`]/g, " ")
    .replace(/[&+]/g, " & ")
    .replace(/(?<!\d)\.|[!?;:()[\]"«»]/g, " ")
    .replace(/,/g, " , ")
    .replace(/\s*-\s*/g, " - ")
    .replace(/\s+/g, " ")
    .trim()
    .normalize("NFC"); // recompose kana split by NFD (で, ば), so Japanese templates match (D-1225)
  // Split Arabic "و" before day words
  // Pattern: (^|\s)و(?=(?:يوم\s*)?(?:ال)?(?:اثنين|ثلاثاء|اربعاء|خميس|جمعه|سبت|احد)(?:\s|$|,))
  const dayPattern = "(?:يوم\\s*)?(?:ال)?(?:اثنين|ثلاثاء|اربعاء|خميس|جمعه|سبت|احد)";
  const re = new RegExp(`(^|\\s)و(?=${dayPattern}(?:\\s|$|,))`, "g");
  processed = processed.replace(re, "$1و ");
  return processed;
}

function parseNumber(spec: LangSpec, raw: string | undefined): number | null {
  if (raw === undefined) return null;
  if (/^\d+$/.test(raw)) return Number(raw);
  return spec.numbers[raw] ?? null;
}

function expandRange(from: Weekday, to: Weekday): Weekday[] {
  const start = WEEKDAYS.indexOf(from);
  const end = WEEKDAYS.indexOf(to);
  const days: Weekday[] = [];
  for (let i = start; ; i = (i + 1) % 7) {
    days.push(WEEKDAYS[i] as Weekday);
    if (i === end) break;
  }
  return days;
}

function resolve(
  compiled: CompiledLang,
  pattern: Pattern,
  groups: Record<string, string | undefined>,
): string | null {
  const { spec } = compiled;
  const tokens = groups.days ? groups.days.split(compiled.splitter).map((t) => t.trim()) : [];
  if (pattern.requirePlural && !tokens.every((token) => spec.pluralDays.includes(token)))
    return null;
  let days: Weekday[] = tokens
    .map((token) => spec.days[token])
    .filter((d): d is Weekday => d !== undefined);
  if (days.length !== tokens.length) return null;
  if (days.length === 0 && !pattern.range && !pattern.ordinal && groups.day) {
    const single = spec.days[groups.day];
    if (single) days = [single];
  }

  if (pattern.weekdays) days = [...MON_TO_FRI];
  if (pattern.range) {
    const from = groups.day ? spec.days[groups.day] : undefined;
    const to = groups.day2 ? spec.days[groups.day2] : undefined;
    if (!from || !to || from === to) return null;
    days = expandRange(from, to);
  }

  if (pattern.ordinal) {
    const day = groups.day ? spec.days[groups.day] : undefined;
    const ordTokens = groups.ords ? groups.ords.split(compiled.splitter).map((t) => t.trim()) : [];
    const ordinals = [...new Set(ordTokens.map((token) => spec.ordinals[token]))];
    if (!day || ordinals.length === 0 || ordinals.some((o) => o === undefined)) return null;
    const positions = ordinals as number[];
    const singularDay = groups.day !== undefined && !spec.pluralDays.includes(groups.day);
    if (
      spec.everyTwoIsAmbiguous &&
      groups.every &&
      !groups.ofmonth &&
      singularDay &&
      positions.length === 1 &&
      positions[0] === 2
    ) {
      return null; // "every second Saturday": every other, or the 2nd of the month? Not ours to guess.
    }
    positions.sort((a, b) => (a < 0 && b < 0 ? b - a : a < 0 ? 1 : b < 0 ? -1 : a - b));
    return `FREQ=MONTHLY;BYDAY=${day};BYSETPOS=${positions.join(",")}`;
  }

  let interval = pattern.interval ?? 1;
  if (groups.n !== undefined) {
    const n = parseNumber(spec, groups.n);
    if (n === null || n < 1) return null;
    interval = n;
  }
  const parts = [`FREQ=${pattern.freq}`];
  if (interval > 1) parts.push(`INTERVAL=${interval}`);
  if (days.length > 0) parts.push(`BYDAY=${sortDays(days).join(",")}`);
  return parts.join(";");
}

function parseIn(lang: ParseLang, text: string): string | null {
  const compiled = compile(lang);
  for (const { pattern, re } of compiled.patterns) {
    const m = re.exec(text);
    if (!m) continue;
    const result = resolve(compiled, pattern, m.groups ?? {});
    if (result !== null) return result;
  }
  return null;
}

/** The day words one language's phrases use, in normalized form (D-514: the dance gate's weekly check). */
export function recurrenceDayTokens(lang: ParseLang): readonly string[] {
  return Object.keys(LANGS[lang].days);
}

/** The text as the recurrence parser sees it (D-514). */
export function normalizeRecurrenceText(text: string): string {
  return normalizeText(text);
}

/**
 * RRULE body for a recurrence phrase, or null. Only deterministic phrases parse ("every Thursday",
 * "Thursdays", "1st and 3rd Saturdays", "last Friday of the month", "every other Sunday", "tous les
 * mardis", "todos los viernes", "jeden Freitag"); hedged ones ("most weeks", "usually Fridays") and
 * anything with extra words return null. Text never yields a date: DTSTART comes from a dated
 * listing. Without `lang`, every supported language is tried.
 */
export function parseRecurrenceText(text: string, lang?: ParseLang | string): string | null {
  if (typeof text !== "string") return null;
  const normalized = normalizeText(text);
  if (normalized.length === 0 || normalized.length > 120) return null;
  // "From Thursday to Sunday" reads as "Thursday to Sunday" (Grupo Mandala's Open lines).
  const fromless = stripLeadingFrom(normalized);
  if (fromless !== null) {
    const rule = parseRecurrenceText(fromless, lang);
    if (rule !== null) return rule;
  }
  if (lang !== undefined) {
    const parsedLang = parseLangSchema.safeParse(lang.toLowerCase().split(/[-_]/)[0]);
    return parsedLang.success ? parseIn(parsedLang.data, normalized) : null;
  }
  for (const candidate of PARSE_LANGS) {
    const result = parseIn(candidate, normalized);
    if (result !== null) return result;
  }
  return null;
}

/** True when a BYDAY token is a plain weekday code. */
export function isWeekday(value: string): value is Weekday {
  return WEEKDAY_SET.has(value);
}
