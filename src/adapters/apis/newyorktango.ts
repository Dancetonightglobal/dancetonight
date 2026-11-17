// New York Tango's data files: the `newyorktango` adapter (D-133).
//
// newyorktango.com, the city's Argentine tango directory since 1997, draws its calendar in the
// browser from three static CSV files, so a page read sees only "Loading events". The owner has
// their permission to read the files (D-084 question 1), and robots.txt allows them:
//   /data/events-recurring.csv  one row per series: a rule (weekly, biweekly, monthly:N[,M]:day
//                               with N a week number or "last"), start and end dates, times
//   /data/events-manual.csv     one-off adds, updates (which may move a night) and cancellations
//   /data/venues.csv            venue name, address, area and coordinates
// Each series becomes a recurrence that src/domain/recurrence.ts materialises, as an ICS rule
// does; a night an update or a cancellation names is left out of its rule and written on its own
// (a cancellation as a cancelled night), the way an ICS RECURRENCE-ID override is.
//
// Only what the files state is used. A rule this reader does not understand ("monthly:4" with no
// weekday, an empty rule) is left out and named in the report, never guessed. Rows outside the
// five boroughs (the "NJ & Metro" area) are left out and named (D-084). venues.csv also carries
// door codes: those columns are never read.

import { httpUrl, sha256, type LocalMoment } from "@/src/adapters/shared";
import { buildListing, inWindow } from "@/src/adapters/structured";
import type {
  HarvestedListing,
  HarvestedRecurrence,
  HarvestResult,
  RunCtx,
  Source,
  SourceAdapter,
} from "@/src/adapters/types";
import type { Point } from "@/src/domain/listing";
import type { ListingType } from "@/src/domain/listing-types";
import { insideMetro } from "@/src/domain/metro-bounds";
import { currencyForCountry } from "@/src/domain/prices";
import { MATERIALIZE_DAYS } from "@/src/domain/recurrence";
import { addCalendarDays, localInstant } from "@/src/domain/time";
import { currentNightDate } from "@/src/domain/tonight";
import { CRAWL_INTERVAL_MS } from "@/src/pipeline/http";
import type { StyleKey } from "@/config/styles";

export const NEWYORKTANGO_BASE = "https://www.newyorktango.com";
export const NEWYORKTANGO_FILES = {
  recurring: `${NEWYORKTANGO_BASE}/data/events-recurring.csv`,
  manual: `${NEWYORKTANGO_BASE}/data/events-manual.csv`,
  venues: `${NEWYORKTANGO_BASE}/data/venues.csv`,
} as const;
/** Goes into the content hash, so a change to how rows become listings is written next run. */
export const NEWYORKTANGO_MAPPING_VERSION = 1;

// ---------------------------------------------------------------------------------------------
// CSV (RFC 4180: quoted fields may hold commas, doubled quotes and line breaks)

export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const body = text.replace(/^﻿/, "");
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]!;
    if (quoted) {
      if (ch === '"' && body[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && body[i + 1] === "\n") i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  const [header, ...data] = rows;
  if (!header) return [];
  const names = header.map((h) => h.trim());
  return data
    .filter((r) => r.some((cell) => cell.trim() !== ""))
    .map((r) => Object.fromEntries(names.map((name, i) => [name, (r[i] ?? "").trim()])));
}

// ---------------------------------------------------------------------------------------------
// Fields

/** "7:00p" → "19:00", "12:00a" → "00:00", "11:30a" → "11:30". Null when unreadable. */
export function clock(value: string): string | null {
  const m = /^(\d{1,2})(?::(\d{2}))?\s*([ap])m?$/i.exec(value.trim());
  if (!m) return null;
  let hour = Number(m[1]);
  const minute = Number(m[2] ?? 0);
  if (hour < 1 || hour > 12 || minute > 59) return null;
  const pm = m[3]!.toLowerCase() === "p";
  if (hour === 12) hour = pm ? 12 : 0;
  else if (pm) hour += 12;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

const DAYS: Record<string, string> = {
  sunday: "SU",
  monday: "MO",
  tuesday: "TU",
  wednesday: "WE",
  thursday: "TH",
  friday: "FR",
  saturday: "SA",
};
const BYDAY_OF_INDEX = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const;

function weekdayOf(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number) as [number, number, number];
  return BYDAY_OF_INDEX[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]!;
}

const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);

/**
 * The file's rule as an RRULE body, or null when it is not one this reader understands. Weekly
 * and biweekly series fall on their start date's weekday; "monthly:1,3:sunday" is the first and
 * third Sunday; "last" is the month's last.
 */
export function rruleOf(
  rule: string,
  startDate: string,
  endDate: string | null,
  zone = "America/New_York",
): string | null {
  const text = rule.trim().toLowerCase();
  let body: string | null = null;
  if (text === "weekly") body = `FREQ=WEEKLY;BYDAY=${weekdayOf(startDate)}`;
  else if (text === "biweekly") body = `FREQ=WEEKLY;INTERVAL=2;BYDAY=${weekdayOf(startDate)}`;
  else {
    const m = /^monthly:([a-z0-9,]+):([a-z]+)$/.exec(text);
    const day = m ? DAYS[m[2]!] : undefined;
    if (m && day) {
      const weeks = m[1]!.split(",").map((w) => (w === "last" ? -1 : Number(w)));
      if (weeks.every((w) => w === -1 || (Number.isInteger(w) && w >= 1 && w <= 5))) {
        body = `FREQ=MONTHLY;BYDAY=${weeks.map((w) => `${w}${day}`).join(",")}`;
      }
    }
  }
  if (!body) return null;
  if (!endDate || !isDate(endDate)) return body;
  // The end date's night runs until 06:00 the next morning (D-004): UNTIL is that instant in UTC,
  // so a series that starts at 9pm keeps its last night.
  const until = new Date(localInstant(addCalendarDays(endDate, 1), zone, 6).getTime() - 1000);
  return `${body};UNTIL=${until
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "")}`;
}

/** The weekdays a rule can fall on, as BYDAY codes. */
function ruleDays(rrule: string): string[] {
  return (
    /BYDAY=([^;]+)/
      .exec(rrule)?.[1]
      ?.split(",")
      .map((d) => d.slice(-2)) ?? []
  );
}

/** The first date on or after `from` that the rule's weekday pattern can fall on (D-005 anchor). */
function firstOnOrAfter(from: string, rrule: string): string {
  const days = ruleDays(rrule);
  let date = from;
  for (let i = 0; i < 7 && days.length > 0 && !days.includes(weekdayOf(date)); i++) {
    date = addCalendarDays(date, 1);
  }
  return date;
}

export const slug = (text: string) =>
  text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

interface Venue {
  name: string | null;
  address: string | null;
  location: Point | null;
  /** "NYC" or "NJ & Metro", as the file says. */
  area: string | null;
}

function venuesOf(rows: Record<string, string>[]): Map<string, Venue> {
  const venues = new Map<string, Venue>();
  for (const row of rows) {
    const id = row.venueId;
    if (!id) continue;
    const lat = Number(row.latitude);
    const lng = Number(row.longitude);
    venues.set(id, {
      name: row.name || null,
      address: row.address || null,
      location:
        row.latitude && row.longitude && Number.isFinite(lat) && Number.isFinite(lng)
          ? { lat, lng }
          : null,
      area: row.venueArea || null,
    });
  }
  return venues;
}

const typeOf = (kind: string): { type: ListingType; styles: StyleKey[] } =>
  /practica/i.test(kind)
    ? { type: "practica", styles: ["practica"] }
    : { type: "social", styles: ["milonga"] };

/** Our own lines from the file's columns, read by the fixed price and time patterns only. */
function factsOf(row: Record<string, string>): string | null {
  const lines: string[] = [];
  if (/^true$/i.test(row.hasClass ?? "") && row.classDetail) lines.push(`Class ${row.classDetail}`);
  else if (/^true$/i.test(row.hasClass ?? "")) lines.push("Class before");
  if (row.admission) lines.push(`Admission: ${row.admission}`);
  return lines.length > 0 ? lines.join("\n") : null;
}

function moment(day: string, time: string | null, zone: string): LocalMoment {
  const hour = time ? Number(time.slice(0, 2)) : 12;
  return {
    day,
    night: time && hour < 6 ? addCalendarDays(day, -1) : day,
    time,
    zone,
    absolute: false,
  };
}

export interface TangoReadOptions {
  metro: { slug: string; center: Point; radiusKm: number; tz: string; countryCode: string };
  fetchedAt: Date;
  fromNight: string;
  days?: number;
}

/** The three files as listings, with notes on every row left out and why. */
export function tangoToListings(
  files: { recurring: string; manual: string; venues: string },
  options: TangoReadOptions,
): { listings: HarvestedListing[]; notes: string[] } {
  const days = options.days ?? MATERIALIZE_DAYS;
  const zone = options.metro.tz;
  const currency = currencyForCountry(options.metro.countryCode);
  const venues = venuesOf(parseCsv(files.venues));
  const notes: string[] = [];
  const outside: string[] = [];

  const placeOf = (
    row: Record<string, string>,
  ): { venue: Venue; inside: boolean; name: string | null } => {
    const known = venues.get(row.venueId ?? "");
    const venue: Venue = known ?? {
      name: row.venueName || null,
      address: row.address || null,
      location: null,
      area: null,
    };
    // The point decides when there is one; else the file's own area; else the listing stays
    // and the write path places it by its address (coverage first, D-082).
    const inside = venue.location
      ? insideMetro(options.metro, venue.location)
      : venue.area !== "NJ & Metro";
    return { venue, inside, name: venue.name };
  };

  const build = (
    row: Record<string, string>,
    venue: Venue,
    externalId: string,
    start: LocalMoment,
    end: string | null,
    cancelled: boolean,
    recurrence: HarvestedRecurrence | null,
  ): HarvestedListing => {
    const { type, styles } = typeOf(row.type ?? "");
    const built = buildListing(
      {
        externalId,
        title: row.title!,
        start,
        end: end ? { ...start, time: end } : null,
        description: factsOf(row),
        venue: { name: venue.name, address: venue.address, url: null, location: venue.location },
        organizer: { name: row.host || null, url: null },
        prices: null,
        ticketUrl: null,
        eventUrl: null,
        cancelled,
        styles,
        type,
        evidence: {
          start: recurrence
            ? `${row.recurrenceRule} from ${row.recurrenceStartDate} at ${row.startTime}`
            : `${row.date} at ${row.startTime || "no time"}`,
        },
        recurrence,
      },
      {
        sourceUrl: `${NEWYORKTANGO_BASE}/`,
        fetchedAt: options.fetchedAt,
        method: "feed",
        currency,
      },
    );
    // The file's start time is when the milonga or practica starts; a class before it has its
    // own column ("Class 6-7p"). So the start is the dancing, never doors after a class.
    if (!start.time || built.listing.lesson_time === start.time) return built;
    return {
      ...built,
      listing: {
        ...built.listing,
        doors_time: null,
        dancing_time: start.time,
        evidence: { ...built.listing.evidence, dancing_time: `startTime ${row.startTime}` },
      },
    };
  };

  const seriesRows = parseCsv(files.recurring).filter((r) => r.title);
  const ruleOfRow = (r: Record<string, string>) =>
    isDate(r.recurrenceStartDate ?? "")
      ? rruleOf(r.recurrenceRule ?? "", r.recurrenceStartDate!, r.recurrenceEndDate || null, zone)
      : null;
  const listed = (r: Record<string, string>) =>
    /^true$/i.test(r.isActive ?? "") && ruleOfRow(r) !== null;
  // One title at one venue can be several series ("Tango on Hudson": Monday, Tuesday and
  // Friday), so a series' id carries its rule and its weekday too.
  const seriesId = (r: Record<string, string>) =>
    `nyt:${slug(r.title!)}:${r.venueId ?? ""}:${slug(r.recurrenceRule ?? "")}:${
      isDate(r.recurrenceStartDate ?? "") ? weekdayOf(r.recurrenceStartDate!) : ""
    }`;
  /** The series a manual row edits: same title and venue (else same title), on that weekday. */
  const findSeries = (r: Record<string, string>): Record<string, string> | null => {
    const sameTitle = seriesRows.filter((s) => slug(s.title!) === slug(r.title!));
    const sameVenue = sameTitle.filter((s) => (s.venueId ?? "") === (r.venueId ?? ""));
    const candidates = sameVenue.length > 0 ? sameVenue : sameTitle;
    const day = weekdayOf(r.date!);
    const onDay = candidates.filter((s) => {
      const rule = ruleOfRow(s);
      return rule !== null && ruleDays(rule).includes(day);
    });
    if (onDay.length >= 1) return onDay[0]!;
    return candidates.length === 1 ? candidates[0]! : null;
  };
  /** The night a series' occurrence on a calendar date belongs to (before 06:00: the day before). */
  const nightOf = (date: string, time: string | null) => moment(date, time, zone).night;

  // Manual rows first: the nights they take out of a series.
  const manual = parseCsv(files.manual).filter((r) => r.title && isDate(r.date ?? ""));
  const exdates = new Map<Record<string, string>, string[]>();
  const dated: HarvestedListing[] = [];
  const write = (
    row: Record<string, string>,
    id: string,
    start: LocalMoment,
    cancelled: boolean,
  ) => {
    if (!inWindow(start.night, options.fromNight, days)) return;
    const place = placeOf(row);
    if (!place.inside) {
      outside.push(`${row.title} on ${start.night}`);
      return;
    }
    dated.push(build(row, place.venue, id, start, clock(row.endTime ?? ""), cancelled, null));
  };
  for (const r of manual) {
    const mode = (r.mode ?? "").toLowerCase();
    if (mode !== "add" && mode !== "update" && mode !== "cancel") {
      notes.push(`a manual row with mode "${r.mode}" was left out: ${r.title} on ${r.date}`);
      continue;
    }
    const series = mode === "add" ? null : findSeries(r);
    if (mode === "cancel" && !series) {
      notes.push(`a cancellation names no series it could be matched to: ${r.title} on ${r.date}`);
      continue;
    }
    if (mode === "cancel" && series && !listed(series)) {
      // We never list that series (inactive, or a rule we do not read): nothing to cancel.
      continue;
    }
    // The row's own fields win; a blank one takes the series' value.
    const merged = series
      ? { ...series, ...Object.fromEntries(Object.entries(r).filter(([, v]) => v)) }
      : r;
    const date = isDate(r.newDate ?? "") ? r.newDate! : r.date!;
    const start = moment(date, clock(merged.startTime ?? ""), zone);
    if (!series) {
      write(
        merged,
        `nyt:add:${slug(merged.title!)}:${merged.venueId || slug(merged.venueName ?? "")}:${start.night}`,
        start,
        false,
      );
      continue;
    }
    const sid = seriesId(series);
    const seriesTime = clock(series.startTime ?? "");
    const vacated = nightOf(r.date!, seriesTime);
    // The night the row names leaves its series.
    exdates.set(series, [...(exdates.get(series) ?? []), vacated]);
    if (date !== r.date) {
      // The night it moves to leaves every series of that title at that venue: the row's own
      // night replaces theirs there (Esa! Milonga, moved from 10/9 to 10/16; a Monday "Tango on
      // Hudson" moved onto the Tuesday series' night).
      for (const other of seriesRows) {
        if (slug(other.title!) !== slug(series.title!) || other.venueId !== series.venueId)
          continue;
        exdates.set(other, [
          ...(exdates.get(other) ?? []),
          nightOf(date, clock(other.startTime ?? "")),
        ]);
      }
    }
    write(merged, `${sid}@${start.night}`, start, mode === "cancel");
    if (mode === "update" && date !== r.date && listed(series)) {
      // A moved night is no longer on its old date: a row stored for it says so.
      write(series, `${sid}@${vacated}`, moment(r.date!, seriesTime, zone), true);
    }
  }

  const rules: HarvestedListing[] = [];
  for (const r of seriesRows) {
    if (!/^true$/i.test(r.isActive ?? "")) continue;
    const rrule = ruleOfRow(r);
    if (!rrule) {
      notes.push(
        `a series with a rule this reader does not understand was left out: ${r.title} ("${r.recurrenceRule || "no rule"}")`,
      );
      continue;
    }
    const startDate = r.recurrenceStartDate!;
    const until = r.recurrenceEndDate;
    if (until && isDate(until) && until < options.fromNight) continue;
    const place = placeOf(r);
    if (!place.inside) {
      outside.push(`${r.title} (every night of its series)`);
      continue;
    }
    const time = clock(r.startTime ?? "");
    const first = firstOnOrAfter(startDate, rrule);
    const recurrence: HarvestedRecurrence = time
      ? { rrule, dtstartLocal: `${first}T${time}`, exdates: exdates.get(r) ?? [] }
      : { rrule, dtstartLocal: `${first}T12:00`, exdates: exdates.get(r) ?? [], timeListed: false };
    rules.push(
      build(
        r,
        place.venue,
        seriesId(r),
        moment(first, time, zone),
        clock(r.endTime ?? ""),
        false,
        recurrence,
      ),
    );
  }

  if (outside.length > 0) {
    notes.push(
      `${outside.length} left out as outside New York's five boroughs (D-084): ${outside.slice(0, 8).join("; ")}${outside.length > 8 ? `; and ${outside.length - 8} more` : ""}`,
    );
  }
  // Rules first, then dated nights, so a night an update rewrites wins (as with ICS overrides).
  return { listings: [...rules, ...dated], notes };
}

export const newYorkTangoAdapter: SourceAdapter = {
  id: "newyorktango",
  tier: "A",
  countries: ["US"],
  limits: { perDomainIntervalMs: CRAWL_INTERVAL_MS },
  async harvest(source: Source, ctx: RunCtx): Promise<HarvestResult> {
    const fetchOne = (url: string) =>
      ctx.http.request({
        url,
        purpose: "crawl",
        headers: { accept: "text/csv, text/plain;q=0.8" },
      });
    const recurring = await fetchOne(NEWYORKTANGO_FILES.recurring);
    const manual = await fetchOne(NEWYORKTANGO_FILES.manual);
    const venues = await fetchOne(NEWYORKTANGO_FILES.venues);
    if (!/recurrenceRule/.test(recurring.body) || !/venueId/.test(venues.body)) {
      throw new Error("New York Tango's files no longer have the columns this reader reads");
    }
    const fromNight = currentNightDate(ctx.now(), ctx.metro.tz);
    const contentHash = sha256(
      JSON.stringify([
        NEWYORKTANGO_MAPPING_VERSION,
        fromNight,
        recurring.body,
        manual.body,
        venues.body,
      ]),
    );
    const doc = {
      url: httpUrl(source.url) ?? `${NEWYORKTANGO_BASE}/`,
      fetchedAt: recurring.fetchedAt,
      httpStatus: 200,
      etag: null,
      lastModified: null,
      contentHash,
      cleanedText: null,
    };
    if (source.contentHash === contentHash) return { listings: [], unchanged: true, doc };
    const { listings, notes } = tangoToListings(
      { recurring: recurring.body, manual: manual.body, venues: venues.body },
      { metro: ctx.metro, fetchedAt: recurring.fetchedAt, fromNight },
    );
    return { listings, doc, notes };
  },
};
