// iCalendar (RFC 5545) feeds: the `feed_ics` adapter (PLAN 6.5 step 1). Public Google Calendars
// are read through the Calendar API instead (src/adapters/apis/google-calendar.ts, D-130), which
// maps its events through `icsToListings` below.
//
// A hand-written parser for the parts a dance calendar uses: VEVENT with UID, SUMMARY,
// DESCRIPTION, LOCATION, GEO, URL, STATUS, DTSTART, DTEND or DURATION, RRULE, EXDATE and
// RECURRENCE-ID. Recurrence is not expanded here: the rule goes to src/domain/recurrence.ts
// through HarvestedRecurrence, the same engine every other source uses (D-005, D-027).
//
// Time zones: a TZID that is an IANA name is used as is; a vendor-prefixed one
// ("/mozilla.org/20050126_1/America/New_York") is cut to its IANA tail; Windows names
// ("Eastern Standard Time") are mapped; a floating time uses the calendar's X-WR-TIMEZONE, then
// the metro's zone.
//
// DESCRIPTION is third-party text. It is read only through the fixed patterns in
// src/domain/text-facts.ts and never stored beyond a 300-character evidence quote.

import { clockIn, httpUrl, sha256, type LocalMoment } from "@/src/adapters/shared";
import { buildListing, inWindow } from "@/src/adapters/structured";
import {
  UNTIMED_RULE_ANCHOR,
  type HarvestedListing,
  type HarvestedRecurrence,
  type HarvestResult,
  type RunCtx,
  type Source,
  type SourceAdapter,
} from "@/src/adapters/types";
import { linkKey } from "@/src/domain/event-link-matcher";
import { siblingVenues, titleVenueOverOwnName } from "@/src/domain/own-name-venue";
import { currencyForCountry } from "@/src/domain/prices";
import { MATERIALIZE_DAYS } from "@/src/domain/recurrence";
import { addCalendarDays, isValidZone, localDateOf } from "@/src/domain/time";
import { currentNightDate, nightDate } from "@/src/domain/tonight";
import { CRAWL_INTERVAL_MS } from "@/src/pipeline/http";

// ---------------------------------------------------------------------------------------------
// Parsing

export interface IcsProperty {
  name: string;
  params: Record<string, string>;
  value: string;
}

export type IcsDate =
  | { kind: "date"; date: string }
  | { kind: "utc"; instant: Date }
  | { kind: "local"; local: string; tzid: string | null };

export interface IcsEvent {
  uid: string | null;
  summary: string | null;
  description: string | null;
  location: string | null;
  url: string | null;
  geo: { lat: number; lng: number } | null;
  status: string | null;
  categories: string[];
  start: IcsDate | null;
  end: IcsDate | null;
  durationMinutes: number | null;
  rrule: string | null;
  exdates: IcsDate[];
  recurrenceId: IcsDate | null;
}

export interface IcsCalendar {
  name: string | null;
  tzid: string | null;
  events: IcsEvent[];
}

/** RFC 5545 3.1: a line starting with a space or tab continues the previous one. */
export function unfold(text: string): string[] {
  return text
    .replace(/\r\n|\r/g, "\n")
    .replace(/\n[ \t]/g, "")
    .split("\n")
    .filter((line) => line.length > 0);
}

export function parseProperty(line: string): IcsProperty | null {
  // The value starts after the first colon that is not inside a quoted parameter.
  let inQuotes = false;
  let colon = -1;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') inQuotes = !inQuotes;
    else if (ch === ":" && !inQuotes) {
      colon = i;
      break;
    }
  }
  if (colon < 0) return null;
  const head = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const [rawName, ...rawParams] = head.split(";");
  const params: Record<string, string> = {};
  for (const param of rawParams) {
    const eq = param.indexOf("=");
    if (eq > 0)
      params[param.slice(0, eq).toUpperCase()] = param.slice(eq + 1).replace(/^"|"$/g, "");
  }
  return { name: (rawName ?? "").toUpperCase(), params, value };
}

/** RFC 5545 3.3.11 TEXT: backslash escapes. */
export function unescapeText(value: string): string {
  return value.replace(/\\([\\;,nN])/g, (_, ch: string) => (ch === "n" || ch === "N" ? "\n" : ch));
}

const DATE = /^(\d{4})(\d{2})(\d{2})$/;
const DATE_TIME = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/;

export function parseIcsDate(prop: IcsProperty): IcsDate | null {
  const value = prop.value.trim();
  const d = DATE.exec(value);
  if (d || prop.params.VALUE === "DATE") {
    if (!d) return null;
    return { kind: "date", date: `${d[1]}-${d[2]}-${d[3]}` };
  }
  const dt = DATE_TIME.exec(value);
  if (!dt) return null;
  if (dt[7] === "Z") {
    return {
      kind: "utc",
      instant: new Date(Date.UTC(+dt[1]!, +dt[2]! - 1, +dt[3]!, +dt[4]!, +dt[5]!, +dt[6]!)),
    };
  }
  return {
    kind: "local",
    local: `${dt[1]}-${dt[2]}-${dt[3]}T${dt[4]}:${dt[5]}`,
    tzid: prop.params.TZID ?? null,
  };
}

/** RFC 5545 3.3.6, the parts a calendar uses: P1D, PT2H30M, P1DT2H. */
export function parseDurationMinutes(value: string): number | null {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(
    value.trim(),
  );
  if (!m) return null;
  const minutes = (+(m[2] ?? 0) * 7 + +(m[3] ?? 0)) * 1440 + +(m[4] ?? 0) * 60 + +(m[5] ?? 0);
  return m[1] === "-" ? -minutes : minutes;
}

export function parseIcs(text: string): IcsCalendar {
  const calendar: IcsCalendar = { name: null, tzid: null, events: [] };
  let current: IcsEvent | null = null;
  let depth = 0; // nested components inside a VEVENT (VALARM) are skipped

  for (const line of unfold(text)) {
    const prop = parseProperty(line);
    if (!prop) continue;
    if (prop.name === "BEGIN") {
      if (prop.value.toUpperCase() === "VEVENT" && !current) {
        current = {
          uid: null,
          summary: null,
          description: null,
          location: null,
          url: null,
          geo: null,
          status: null,
          categories: [],
          start: null,
          end: null,
          durationMinutes: null,
          rrule: null,
          exdates: [],
          recurrenceId: null,
        };
      } else if (current) depth += 1;
      continue;
    }
    if (prop.name === "END") {
      if (current && depth > 0) depth -= 1;
      else if (current && prop.value.toUpperCase() === "VEVENT") {
        calendar.events.push(current);
        current = null;
      }
      continue;
    }
    if (!current) {
      if (prop.name === "X-WR-CALNAME") calendar.name = unescapeText(prop.value);
      if (prop.name === "X-WR-TIMEZONE") calendar.tzid = prop.value.trim();
      continue;
    }
    if (depth > 0) continue;

    switch (prop.name) {
      case "UID":
        current.uid = prop.value.trim();
        break;
      case "SUMMARY":
        current.summary = unescapeText(prop.value).trim();
        break;
      case "DESCRIPTION":
        current.description = unescapeText(prop.value);
        break;
      case "LOCATION":
        current.location = unescapeText(prop.value).trim();
        break;
      case "URL":
        current.url = prop.value.trim();
        break;
      case "STATUS":
        current.status = prop.value.trim().toUpperCase();
        break;
      case "CATEGORIES":
        current.categories.push(
          ...unescapeText(prop.value)
            .split(",")
            .map((c) => c.trim())
            .filter(Boolean),
        );
        break;
      case "GEO": {
        const [lat, lng] = prop.value.split(/[;,]/).map(Number);
        if (
          Number.isFinite(lat) &&
          Number.isFinite(lng) &&
          Math.abs(lat!) <= 90 &&
          Math.abs(lng!) <= 180
        ) {
          current.geo = { lat: lat!, lng: lng! };
        }
        break;
      }
      case "DTSTART":
        current.start = parseIcsDate(prop);
        break;
      case "DTEND":
        current.end = parseIcsDate(prop);
        break;
      case "DURATION":
        current.durationMinutes = parseDurationMinutes(prop.value);
        break;
      case "RRULE":
        current.rrule = prop.value.trim();
        break;
      case "EXDATE":
        for (const part of prop.value.split(",")) {
          const date = parseIcsDate({ ...prop, value: part });
          if (date) current.exdates.push(date);
        }
        break;
      case "RECURRENCE-ID":
        current.recurrenceId = parseIcsDate(prop);
        break;
    }
  }
  return calendar;
}

// ---------------------------------------------------------------------------------------------
// Meetup event URL extraction

/**
 * A Meetup event's own page, from its UID, when the feed's URL is the group's events page (D-561): some group feeds
 * give every event the group's /events URL and the event id only in the UID ("event_316952614@meetup.com"). Any other
 * URL or UID is returned unchanged.
 */
export function meetupEventUrl(uid: string | null, url: string | null): string | null {
  if (!uid || !url) return url;
  const trimmedUid = uid.trim();
  const match = /^event_(\d+)@meetup\.com$/i.exec(trimmedUid);
  if (!match) return url;
  const eventId = match[1];
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (!(host === "meetup.com" || host === "www.meetup.com")) return url;
    if (!(parsed.protocol === "https:" || parsed.protocol === "http:")) return url;
    const path = parsed.pathname;
    // Path must be exactly "/<group>/events" or "/<group>/events/"
    const pathMatch = /^\/([^/]+)\/events\/?$/i.exec(path);
    if (!pathMatch) return url;
    const group = pathMatch[1];
    if (!group) return url;
    // Return the event URL
    return `https://www.meetup.com/${group}/events/${eventId}/`;
  } catch {
    // URL parsing failed, return unchanged
    return url;
  }
}

// ---------------------------------------------------------------------------------------------
// Zones and local times

const WINDOWS_ZONES: Record<string, string> = {
  "eastern standard time": "America/New_York",
  "central standard time": "America/Chicago",
  "mountain standard time": "America/Denver",
  "us mountain standard time": "America/Phoenix",
  "pacific standard time": "America/Los_Angeles",
  "alaskan standard time": "America/Anchorage",
  "hawaiian standard time": "Pacific/Honolulu",
  "atlantic standard time": "America/Halifax",
  "gmt standard time": "Europe/London",
  "greenwich standard time": "Atlantic/Reykjavik",
  "w. europe standard time": "Europe/Berlin",
  "romance standard time": "Europe/Paris",
  "central europe standard time": "Europe/Budapest",
  "central european standard time": "Europe/Warsaw",
  "e. europe standard time": "Europe/Chisinau",
  "fle standard time": "Europe/Kiev",
  "gtb standard time": "Europe/Bucharest",
  "aus eastern standard time": "Australia/Sydney",
  "tokyo standard time": "Asia/Tokyo",
  utc: "UTC",
};

/** An IANA zone for a TZID, or null when it cannot be read. */
export function resolveTzid(tzid: string | null): string | null {
  if (!tzid) return null;
  const trimmed = tzid.trim().replace(/^"|"$/g, "");
  if (isValidZone(trimmed)) return trimmed;
  // Vendor prefixes: "/mozilla.org/20050126_1/America/New_York", "/citadel.org/.../Europe/Paris".
  const parts = trimmed.split("/").filter(Boolean);
  for (let i = 0; i < parts.length - 1; i++) {
    const tail = parts.slice(i).join("/");
    if (isValidZone(tail)) return tail;
  }
  return WINDOWS_ZONES[trimmed.toLowerCase()] ?? null;
}

/**
 * The wall-clock parts of an ICS date in `zone`: its calendar day, its night date (before 06:00
 * belongs to the previous night, D-004), "HH:MM", and the zone actually used.
 */
export function localParts(
  date: IcsDate,
  zone: string,
): { day: string; night: string; time: string | null; zone: string } {
  if (date.kind === "date") return { day: date.date, night: date.date, time: null, zone };
  if (date.kind === "local") {
    const tz = resolveTzid(date.tzid) ?? zone;
    const [day, time] = date.local.split("T") as [string, string];
    const hour = Number(time.slice(0, 2));
    return { day, night: hour < 6 ? addCalendarDays(day, -1) : day, time, zone: tz };
  }
  const time = clockIn(date.instant, zone);
  return { day: localDateOf(date.instant, zone), night: nightDate(date.instant, zone), time, zone };
}

// ---------------------------------------------------------------------------------------------
// Harvest

/** Volatile lines removed before hashing, so a feed that only re-stamps itself reads as unchanged. */
export function contentHashOf(text: string): string {
  const stable = unfold(text)
    .filter((line) => !/^(DTSTAMP|LAST-MODIFIED|CREATED|SEQUENCE|X-PUBLISHED-TTL)[;:]/i.test(line))
    .join("\n");
  return sha256(stable);
}

/** "Venue Name, 123 Street, City" gives a name and an address; a leading number is an address only. */
export function splitLocation(location: string | null): {
  name: string | null;
  address: string | null;
} {
  if (!location) return { name: null, address: null };
  const clean = location.replace(/\s+/g, " ").trim();
  if (!clean) return { name: null, address: null };
  if (/^\d/.test(clean)) return { name: null, address: clean };
  const comma = clean.indexOf(",");
  if (comma < 0) return { name: clean, address: null };
  return { name: clean.slice(0, comma).trim(), address: clean };
}

function minutesToTime(time: string, add: number): string {
  const [h, m] = time.split(":").map(Number) as [number, number];
  const total = (((h * 60 + m + add) % 1440) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export interface IcsToListingsOptions {
  sourceUrl: string;
  fetchedAt: Date;
  metroTz: string;
  countryCode: string;
  /** First night to keep; dated events before it are skipped. */
  fromNight: string;
  days?: number;
  /** The source's own name: a location naming it is the organiser, not the venue (D-813) */
  ownLabel?: string | null;
}

/**
 * VEVENTs to HarvestedListings. A dated event outside the window is skipped; a rule is passed on
 * whole with its EXDATEs and the nights its RECURRENCE-ID overrides replace, so the override
 * (written after the rule's nights) wins for that night.
 */
export function icsToListings(
  calendar: IcsCalendar,
  options: IcsToListingsOptions,
): { listings: HarvestedListing[]; notes: string[]; lastNight: string | null } {
  const days = options.days ?? MATERIALIZE_DAYS;
  const calendarZone = resolveTzid(calendar.tzid) ?? options.metroTz;
  const notes: string[] = [];
  const currency = currencyForCountry(options.countryCode);

  // Nights each recurring UID's overrides replace.
  const overridden = new Map<string, string[]>();
  for (const event of calendar.events) {
    if (event.uid && event.recurrenceId) {
      const night = localParts(event.recurrenceId, calendarZone).night;
      overridden.set(event.uid, [...(overridden.get(event.uid) ?? []), night]);
    }
  }

  // The titles each URL is given: a URL several differently named events share is a list of
  // them, not one event's page (review #19, as the JSON-LD adapter does). A rule and its
  // RECURRENCE-ID overrides share title and URL, so they keep it.
  const titlesByUrl = new Map<string, Set<string>>();
  for (const event of calendar.events) {
    const url = httpUrl(meetupEventUrl(event.uid, event.url));
    const title = event.summary?.trim().toLowerCase();
    if (!url || !title) continue;
    const key = linkKey(url) ?? url;
    titlesByUrl.set(key, (titlesByUrl.get(key) ?? new Set<string>()).add(title));
  }
  const ownPage = (url: string | null): string | null =>
    url !== null && (titlesByUrl.get(linkKey(url) ?? url)?.size ?? 0) <= 1 ? url : null;

  // Build map of night -> venue from titles containing "@" (D-871)
  const siblings = siblingVenues(
    calendar.events.map((e) => e.summary?.trim() ?? "").filter((t) => t !== ""),
  );

  // A feed whose every timed event starts at local 00:00 with no DTEND or DURATION states dates,
  // not times (thespotlight.la): each is its DTSTART date with the time not listed, not the night
  // before (D-882). One midnight start among other times is a real club-night start (D-854).
  const timed = calendar.events.flatMap((e) => (e.start && e.start.kind !== "date" ? [e] : []));
  const datesOnly =
    timed.length >= 2 &&
    timed.every(
      (e) =>
        e.start !== null &&
        e.end === null &&
        e.durationMinutes === null &&
        localParts(e.start, calendarZone).time === "00:00",
    );
  if (datesOnly)
    notes.push("every event starts at 00:00 with no end: read as dates, time not listed");

  const rules: HarvestedListing[] = [];
  const dated: HarvestedListing[] = [];
  let lastNight: string | null = null;
  for (const event of calendar.events) {
    const title = event.summary?.trim();
    if (!title) {
      notes.push("an event with no title was skipped");
      continue;
    }
    if (!event.start) {
      notes.push(`no start: ${title}`);
      continue;
    }
    const parts = localParts(event.start, calendarZone);
    // An event from local 00:00 to 23:59 of that same day is an all-day export with times, not a
    // midnight start: its DTSTART date, time not listed (thespotlight.la beside its 22:00 nights, D-884).
    const endParts =
      event.end && event.end.kind !== "date" ? localParts(event.end, parts.zone) : null;
    const allDayTimed =
      parts.time === "00:00" && endParts?.day === parts.day && endParts.time === "23:59";
    if (allDayTimed) notes.push(`00:00 to 23:59 read as a date, time not listed: ${title}`);
    const start =
      (datesOnly && parts.time === "00:00") || allDayTimed
        ? { ...parts, night: parts.day, time: null }
        : parts;
    const zone = start.zone;

    let end: LocalMoment | null = null;
    if (allDayTimed) end = null;
    else if (event.end && event.end.kind !== "date")
      end = { ...localParts(event.end, zone), absolute: false };
    else if (event.durationMinutes !== null && start.time) {
      end = { ...start, time: minutesToTime(start.time, event.durationMinutes), absolute: false };
    }

    const evidence: Record<string, string> = {};
    evidence.start = start.time
      ? `DTSTART ${start.night} ${start.time}`
      : `DTSTART;VALUE=DATE ${start.day}`;
    if (end?.time) evidence.end_time = `DTEND ${end.time}`;

    let recurrence: HarvestedRecurrence | null = null;
    if (event.rrule && !event.recurrenceId) {
      const exdates = [
        ...event.exdates.map((d) => localParts(d, zone).night),
        ...(event.uid ? (overridden.get(event.uid) ?? []) : []),
      ];
      // An all-day rule states its days and no time: its nights are listed as "Time not listed",
      // anchored at noon for date arithmetic only (D-060).
      recurrence = start.time
        ? { rrule: event.rrule, dtstartLocal: `${start.day}T${start.time}`, exdates }
        : {
            rrule: event.rrule,
            dtstartLocal: `${start.day}T${UNTIMED_RULE_ANCHOR}`,
            exdates,
            timeListed: false,
          };
    } else {
      // The feed is the source's word through its latest dated night, inside the window or not (D-859).
      if (lastNight === null || start.night > lastNight) lastNight = start.night;
      if (!inWindow(start.night, options.fromNight, days)) continue;
    }

    // A dated event, all-day or not, is one listing on its first night: a multi-day all-day span
    // (a festival weekend) is not repeated on its later nights, and an all-day date is a night
    // whose time is not listed (D-060).
    const where = titleVenueOverOwnName(
      title,
      splitLocation(event.location),
      options.ownLabel ?? null,
      siblings,
    );
    const listing = buildListing(
      {
        externalId: event.uid
          ? event.recurrenceId
            ? `${event.uid}@${localParts(event.recurrenceId, calendarZone).night}`
            : event.uid
          : null,
        title,
        start: { ...start, absolute: event.start.kind === "utc" },
        end,
        description: event.description,
        venue: { name: where.name, address: where.address, url: null, location: event.geo },
        organizer: { name: null, url: null },
        prices: null,
        // An iCalendar URL is the event's page, not a ticket link (D-070): it is the canonical URL.
        ticketUrl: null,
        eventUrl: ownPage(httpUrl(meetupEventUrl(event.uid, event.url))),
        cancelled: event.status === "CANCELLED",
        evidence,
        recurrence,
      },
      { sourceUrl: options.sourceUrl, fetchedAt: options.fetchedAt, method: "feed", currency },
    );
    (recurrence ? rules : dated).push(listing);
  }

  // Rules first, then dated events, so an override written later wins its night.
  return { listings: [...rules, ...dated], notes, lastNight };
}

export const icsAdapter: SourceAdapter = {
  id: "feed_ics",
  tier: "A",
  limits: { perDomainIntervalMs: CRAWL_INTERVAL_MS },
  async harvest(source: Source, ctx: RunCtx): Promise<HarvestResult> {
    const url = source.feedUrl ?? source.url;
    const response = await ctx.http.request({
      url,
      purpose: "crawl",
      headers: { accept: "text/calendar, text/plain;q=0.8, */*;q=0.1" },
      conditional: { etag: source.etag, lastModified: source.lastModified },
    });
    if (response.notModified) return { listings: [], unchanged: true };
    if (!/BEGIN:VCALENDAR/i.test(response.body)) {
      throw new Error("the feed is not an iCalendar file");
    }
    const contentHash = contentHashOf(response.body);
    const doc = {
      url,
      fetchedAt: response.fetchedAt,
      httpStatus: response.status,
      etag: response.etag,
      lastModified: response.lastModified,
      contentHash,
      cleanedText: null,
    };
    if (source.contentHash === contentHash) return { listings: [], unchanged: true, doc };
    const calendar = parseIcs(response.body);
    const fromNight = currentNightDate(ctx.now(), ctx.metro.tz);
    const { listings, notes, lastNight } = icsToListings(calendar, {
      sourceUrl: source.url,
      fetchedAt: response.fetchedAt,
      metroTz: ctx.metro.tz,
      countryCode: ctx.metro.countryCode,
      fromNight,
    });
    // Whole through the latest dated night, when it is tonight or later (D-859).
    const through = lastNight && lastNight >= fromNight ? lastNight : null;
    return {
      listings,
      doc,
      notes,
      ...(through ? { wholeThrough: through } : {}),
    };
  },
};
