// Public Google Calendars through the Calendar API v3: the `feed_gcal` adapter (D-033, D-130).
//
// calendar.google.com/robots.txt reads "Allow: /$, Disallow: /", so the public ICS address of a
// calendar may not be fetched; the official API with a key is the only compliant route. The key
// goes in the `x-goog-api-key` header, never in the URL, so it reaches no log, report or fixture:
//   GET https://www.googleapis.com/calendar/v3/calendars/{id}/events
//       ?singleEvents=true&orderBy=startTime&timeMin&timeMax&maxResults=2500[&pageToken]
// `singleEvents` expands each recurring event into its dated instances, so no rule is read here.
// Each instance becomes an iCalendar event and goes through `icsToListings`, the path the ICS
// adapter uses, so both read the same way.
//
// One source can hold many calendars. An embed lists every calendar it merges as a `src`
// parameter (nycwcs.com merges 29), and a page source is re-read on every run so a host who
// joins the embed is read without a data change. The calendar ids come from the source's own URL,
// its `feedUrl` (an embed address, or the ICS address earlier runs stored) and, for a page that is
// not Google's, the page itself.
//
// D-033: facts only (title, start, end, venue, ids, source URL), refreshed on every run; the
// response's Cache-Control header is named in the report for the integrator's check. Event links
// point at calendar.google.com, which robots.txt closes to us, so no event link is stored and a
// listing links to the page that embeds the calendar. Descriptions are third-party text: read only
// through the fixed patterns of src/adapters/structured.ts, never stored beyond an evidence quote.

import { decodeEntities, httpUrl, sha256 } from "@/src/adapters/shared";
import {
  icsToListings,
  type IcsCalendar,
  type IcsDate,
  type IcsEvent,
} from "@/src/adapters/feeds/ics";
import type { HarvestResult, RunCtx, Source, SourceAdapter } from "@/src/adapters/types";
import { MATERIALIZE_DAYS } from "@/src/domain/recurrence";
import { addCalendarDays } from "@/src/domain/time";
import { currentNightDate } from "@/src/domain/tonight";
import { DEFAULT_API_INTERVAL_MS, HttpError } from "@/src/pipeline/http";

export const GOOGLE_CALENDAR_API = "https://www.googleapis.com/calendar/v3";
/** Pages of up to 2,500 instances per calendar; a dance calendar fills a fraction of one. */
export const GOOGLE_CALENDAR_MAX_PAGES = 4;
/** More calendars than this in one source is not a dance host's embed; the rest are named. */
export const GOOGLE_CALENDAR_MAX_PER_SOURCE = 40;
/**
 * Goes into the content hash, so a change to how events become listings is written on the next
 * run even when the calendars have not changed. 1: the first API reader (D-130).
 */
export const GOOGLE_CALENDAR_MAPPING_VERSION = 1;

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** A calendar id: `name@group.calendar.google.com`, an address, or `…@import.calendar.google.com`. */
const CALENDAR_ID = /^[^\s@/?#&"'<>]+@[a-z0-9.-]+\.[a-z]{2,}$/i;

function fromBase64Url(value: string): string {
  if (!/^[A-Za-z0-9_-]+={0,2}$/.test(value)) return "";
  try {
    return Buffer.from(value, "base64url").toString("utf8");
  } catch {
    return "";
  }
}

const isGoogleHost = (host: string) => /(^|\.)google\.com$/i.test(host);

/**
 * Every calendar id a Google Calendar address names, in order: each `src` (and `cid`) of an
 * embed, or the id in an `/calendar/ical/{id}/…` address. Empty for any other URL.
 */
export function googleCalendarIds(value: string): string[] {
  const trimmed = value.trim();
  if (CALENDAR_ID.test(trimmed)) return [trimmed];
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return [];
  }
  if (!isGoogleHost(url.hostname) || !/\/calendar\//i.test(url.pathname)) return [];
  const ids = [
    // An embed's `src` may also be base64url of the id (Swingland, 2026-10-27).
    ...url.searchParams.getAll("src").flatMap((src) => [src, fromBase64Url(src)]),
    // A subscribe link's `cid` is the id itself or, in Google's current form, base64url of it.
    ...url.searchParams.getAll("cid").flatMap((cid) => [cid, fromBase64Url(cid)]),
  ];
  const ical = /\/calendar\/ical\/([^/]+)\//i.exec(url.pathname)?.[1];
  if (ical) ids.push(decodeURIComponent(ical));
  return [...new Set(ids.map((id) => id.trim()).filter((id) => CALENDAR_ID.test(id)))];
}

/**
 * Every calendar id embedded in a page. Matched over the whole text, not only `src` attributes,
 * because Google Sites carries its embed inside an escaped data blob (cdny.org/calendar-events).
 */
export function googleCalendarIdsInHtml(html: string): string[] {
  // A data payload is not an embed (D-365): somsardana.cat's Next.js data names one cobla's own
  // calendar. JSON scripts, __NEXT_DATA__ and Next.js `self.__next_f.push` payloads are dropped
  // before the scan; plain scripts stay, since a site may wire its calendar up in JavaScript.
  const withoutScripts = html.replace(
    /<script\b([^>]*)>([\s\S]*?)(?:<\/script\s*>|$)/gi,
    (whole, attrs: string, body: string) =>
      /\btype\s*=\s*["']?[^"'\s>]*json/i.test(attrs) ||
      /\bid\s*=\s*["']?__NEXT_DATA__/i.test(attrs) ||
      /^\s*\(?\s*self\.__next_f\b/.test(body)
        ? ""
        : whole,
  );

  const ids: string[] = [];
  const text = decodeEntities(withoutScripts.replace(/\\u0026/gi, "&").replace(/\\\//g, "/"));
  // An attribute value may break across lines (nycwcs.com's iframe puts each `&src=` on its own
  // line); a browser drops those line breaks, and so does this, but only where the next line goes
  // on with a parameter, so the words after an address are never glued onto its last id.
  for (const m of text.matchAll(
    /(?:https?:)?\/\/(?:www\.|calendar\.)?google\.com\/calendar\/(?:[^\s"'<>\\]|[ \t]*\r?\n[ \t]*(?=[&?]|[a-z_]+=))+/gi,
  )) {
    const joined = m[0].replace(/\s+/g, "");
    const raw = joined.startsWith("//") ? `https:${joined}` : joined;
    ids.push(...googleCalendarIds(decodeEntities(raw)));
  }
  return [...new Set(ids)];
}

/** One embed address holding every calendar, the form a source's `feedUrl` stores. */
export function googleCalendarEmbedUrl(ids: readonly string[]): string {
  const url = new URL("https://calendar.google.com/calendar/embed");
  for (const id of ids) url.searchParams.append("src", id);
  return url.toString();
}

export function calendarEventsUrl(
  calendarId: string,
  window: { timeMin: string; timeMax: string },
  pageToken?: string,
): string {
  const url = new URL(`${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events`);
  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("orderBy", "startTime");
  url.searchParams.set("timeMin", window.timeMin);
  url.searchParams.set("timeMax", window.timeMax);
  url.searchParams.set("maxResults", "2500");
  // Cancelled nights of a weekly event are left out unless asked for; they must reach the site.
  url.searchParams.set("showDeleted", "true");
  if (pageToken) url.searchParams.set("pageToken", pageToken);
  return url.toString();
}

/**
 * The instants the API is asked for. Generous on both sides (a day before the first night, two
 * after the last), because `icsToListings` keeps exactly the window's nights.
 */
export function calendarWindow(
  fromNight: string,
  days: number,
): { timeMin: string; timeMax: string } {
  return {
    timeMin: `${addCalendarDays(fromNight, -1)}T00:00:00Z`,
    timeMax: `${addCalendarDays(fromNight, days + 2)}T00:00:00Z`,
  };
}

/** An API date: `{date}` is all day, `{dateTime}` carries its offset and is an instant. */
function apiDate(value: unknown): IcsDate | null {
  if (!isObject(value)) return null;
  const date = str(value.date);
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) return { kind: "date", date };
  const dateTime = str(value.dateTime);
  if (!dateTime) return null;
  const instant = new Date(dateTime);
  return Number.isNaN(instant.getTime()) ? null : { kind: "utc", instant };
}

/** A description arrives as HTML or plain text; line breaks are kept for the fixed patterns. */
export function descriptionText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = decodeEntities(
    value.replace(/<br\s*\/?>|<\/(p|div|li|h\d)>/gi, "\n").replace(/<[^>]*>/g, " "),
  )
    .replace(/[ \t ]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text || null;
}

/**
 * Extract a time range from a line that starts with "Time:" (case-insensitive).
 * Returns `{ start: "HH:MM", end: "HH:MM" | null }` or null if no valid range is found.
 *
 * Recognizes patterns like "20h30-23:00", "21h30-02h00", "16h00~19h00", "20h-00h", "15h-19h",
 * "16h00-19:00", "21:30".  The hour must be 0-23, minutes 00-59 if present.
 */
export function descriptionClock(
  text: string | null,
): { start: string; end: string | null } | null {
  if (!text) return null;
  const lines = text.split("\n");
  const timeLine = lines.find((line) => line.trim().toLowerCase().startsWith("time:"));
  if (!timeLine) return null;
  const afterColon = timeLine.slice(timeLine.indexOf(":") + 1).trim();
  const match = afterColon.match(
    /^\s*(\d{1,2})(?=[h:\s\-~–—]|$)(?:[h:](\d{2})?)?\s*(?:[-~–—]\s*(\d{1,2})(?:[h:](\d{2})?)?)?/,
  );
  if (!match) return null;
  const hour1 = parseInt(match[1] ?? "", 10);
  if (hour1 < 0 || hour1 > 23) return null;
  const minute1 = match[2] ? parseInt(match[2], 10) : 0;
  if (minute1 < 0 || minute1 > 59) return null;
  const start = `${hour1.toString().padStart(2, "0")}:${minute1.toString().padStart(2, "0")}`;

  let end: string | null = null;
  if (match[3] !== undefined) {
    const hour2 = parseInt(match[3] ?? "", 10);
    if (hour2 < 0 || hour2 > 23) return null;
    const minute2 = match[4] ? parseInt(match[4], 10) : 0;
    if (minute2 < 0 || minute2 > 59) return null;
    end = `${hour2.toString().padStart(2, "0")}:${minute2.toString().padStart(2, "0")}`;
  }
  return { start, end };
}

/**
 * Extract the location from a line that starts with "Where:" (case-insensitive).
 * Returns the rest of that line, trimmed, with runs of whitespace collapsed to a single space,
 * or null if no such line or the line is empty after trimming.
 */
export function descriptionWhere(text: string | null): string | null {
  if (!text) return null;
  const lines = text.split("\n");
  const whereLine = lines.find((line) => line.trim().toLowerCase().startsWith("where:"));
  if (!whereLine) return null;
  const afterColon = whereLine.slice(whereLine.indexOf(":") + 1).trim();
  if (!afterColon) return null;
  // collapse multiple spaces/newlines/tabs into a single space
  return afterColon.replace(/\s+/g, " ");
}

/**
 * API event resources as iCalendar events; instances one calendar shares with another once.
 * Asked with `showDeleted=true`, a cancelled night of a weekly event comes back as its id, its
 * `originalStartTime` and often nothing else: it keeps the id its night was stored under, takes
 * its series' title from the other instances, and is written as cancelled.
 */
export function apiItemsToIcs(items: readonly unknown[], seen = new Set<string>()): IcsEvent[] {
  const objects = items.filter(isObject);
  const seriesTitle = new Map<string, string>();
  for (const item of objects) {
    const series = str(item.recurringEventId);
    const title = str(item.summary);
    if (series && title && !seriesTitle.has(series)) seriesTitle.set(series, title);
  }
  const events: IcsEvent[] = [];
  for (const item of objects) {
    const id = str(item.id);
    const cancelled = str(item.status)?.toLowerCase() === "cancelled";
    const start = apiDate(item.start) ?? (cancelled ? apiDate(item.originalStartTime) : null);
    if (!id || !start) continue;
    const series = str(item.recurringEventId);
    const summary =
      str(item.summary) ?? (cancelled && series ? (seriesTitle.get(series) ?? null) : null);
    // One event on two merged calendars has one iCalUID and one start: it is one night.
    const shared = `${str(item.iCalUID) ?? id}|${JSON.stringify(start)}`;
    if (seen.has(shared)) continue;
    seen.add(shared);

    const text = descriptionText(item.description);
    const clock = start.kind === "date" ? descriptionClock(text) : null;
    let finalStart = start;
    let finalEnd: IcsDate | null = apiDate(item.end);
    if (clock && start.kind === "date") {
      const day = start.date;
      finalStart = { kind: "local", local: `${day}T${clock.start}`, tzid: null };
      if (clock.end) {
        let endDay = day;
        if (clock.end <= clock.start) {
          // end is on the next calendar day
          endDay = addCalendarDays(day, 1);
        }
        finalEnd = { kind: "local", local: `${endDay}T${clock.end}`, tzid: null };
      } else {
        finalEnd = null;
      }
    }

    events.push({
      uid: id,
      summary,
      description: text,
      location: str(item.location) ?? descriptionWhere(text),
      // htmlLink is on calendar.google.com, which robots.txt closes to us (see the header).
      url: null,
      geo: null,
      status: cancelled ? "CANCELLED" : (str(item.status)?.toUpperCase() ?? null),
      categories: [],
      start: finalStart,
      end: finalEnd,
      durationMinutes: null,
      rrule: null,
      exdates: [],
      recurrenceId: null,
    });
  }
  return events;
}

/** The embedding site's own name ("www.swingland.com" -> "swingland"): a location naming it is the school (D-813). */
export function ownSiteName(url: string): string | null {
  const page = httpUrl(url);
  if (!page) return null;
  const host = new URL(page).hostname.replace(/^www\./i, "");
  if (isGoogleHost(host)) return null;
  const name = host.split(".")[0] ?? "";
  return name.length >= 4 ? name : null;
}

function shortId(id: string): string {
  return id.replace(/@group\.calendar\.google\.com$/i, "");
}

export const googleCalendarAdapter: SourceAdapter = {
  // The id earlier runs stored as these sources' platform, so they reach this reader unchanged.
  id: "feed_gcal",
  tier: "A",
  limits: { perDomainIntervalMs: DEFAULT_API_INTERVAL_MS, perDay: 1_000_000 },
  requiredEnv: ["GOOGLE_CALENDAR_API_KEY"],
  async harvest(source: Source, ctx: RunCtx): Promise<HarvestResult> {
    const key = ctx.env.GOOGLE_CALENDAR_API_KEY?.trim();
    if (!key) throw new Error("GOOGLE_CALENDAR_API_KEY is not set");
    const notes: string[] = [];

    const ids = [...googleCalendarIds(source.url), ...googleCalendarIds(source.feedUrl ?? "")];
    const page = httpUrl(source.url);
    if (page && !isGoogleHost(new URL(page).hostname)) {
      // The page that embeds the calendars, read for the embed's current list.
      try {
        const response = await ctx.http.request({
          url: page,
          purpose: "crawl",
          headers: { accept: "text/html" },
        });
        const found = googleCalendarIdsInHtml(response.body);
        if (found.length === 0) notes.push("the page embeds no Google Calendar now");
        ids.push(...found);
      } catch (error) {
        if (ids.length === 0) throw error;
        notes.push(
          `the page could not be read (${error instanceof Error ? error.message : String(error)}); read the stored calendars`,
        );
      }
    }
    const unique = [...new Set(ids)];
    if (unique.length === 0) throw new Error("no Google Calendar id in the source or its page");
    const calendars = unique.slice(0, GOOGLE_CALENDAR_MAX_PER_SOURCE);
    if (unique.length > calendars.length) {
      notes.push(
        `${unique.length - calendars.length} calendars over the limit of ${GOOGLE_CALENDAR_MAX_PER_SOURCE} were not read`,
      );
    }

    const fromNight = currentNightDate(ctx.now(), ctx.metro.tz);
    const window = calendarWindow(fromNight, MATERIALIZE_DAYS);
    const seen = new Set<string>();
    const events: IcsEvent[] = [];
    const bodies: string[] = [];
    let fetchedAt = ctx.now();
    let cacheControl: string | null | undefined;
    let read = 0;
    // Track whether the read is whole (no limit cut, no 404, no page cap).
    let whole = unique.length <= GOOGLE_CALENDAR_MAX_PER_SOURCE;

    for (const calendarId of calendars) {
      let pageToken: string | undefined;
      let count = 0;
      try {
        for (let n = 0; n < GOOGLE_CALENDAR_MAX_PAGES; n++) {
          const response = await ctx.http.request({
            url: calendarEventsUrl(calendarId, window, pageToken),
            purpose: "api",
            headers: { accept: "application/json", "x-goog-api-key": key },
          });
          fetchedAt = response.fetchedAt;
          if (cacheControl === undefined) cacheControl = response.headers["cache-control"] ?? null;
          bodies.push(response.body);
          const body: unknown = JSON.parse(response.body);
          if (!isObject(body))
            throw new Error("the Calendar API answered something other than an object");
          const items = Array.isArray(body.items) ? body.items : [];
          const mapped = apiItemsToIcs(items, seen);
          count += mapped.length;
          events.push(...mapped);
          pageToken = str(body.nextPageToken) ?? undefined;
          if (!pageToken) break;
          if (n === GOOGLE_CALENDAR_MAX_PAGES - 1) {
            notes.push(
              `calendar ${shortId(calendarId)}: more than ${GOOGLE_CALENDAR_MAX_PAGES} pages, the rest not read`,
            );
            whole = false;
          }
        }
        read += 1;
        notes.push(`calendar ${shortId(calendarId)}: ${count} events in the window`);
      } catch (error) {
        // A calendar its owner made private or deleted answers 404; the others are still read.
        // Anything else (a refused key, the quota) stops the source and is reported.
        if (error instanceof HttpError && error.status === 404) {
          notes.push(`calendar ${shortId(calendarId)} is not public or no longer exists`);
          whole = false;
          continue;
        }
        throw error;
      }
    }
    if (read === 0) throw new Error("none of the source's Google Calendars could be read");
    // D-033: the first keyed runs show what the API allows us to keep, for the integrator's check.
    notes.push(`Calendar API Cache-Control: ${cacheControl ?? "not sent"}`);

    const contentHash = sha256(
      JSON.stringify([GOOGLE_CALENDAR_MAPPING_VERSION, fromNight, calendars, bodies]),
    );
    const doc = {
      url: source.url,
      fetchedAt,
      httpStatus: 200,
      etag: null,
      lastModified: null,
      contentHash,
      cleanedText: null,
    };
    if (source.contentHash === contentHash) return { listings: [], unchanged: true, doc, notes };

    // Every start is an instant or an all-day date, so it is placed in the metro's zone; merged
    // calendars may each state another (a host's calendar left on UTC).
    const calendar: IcsCalendar = { name: null, tzid: ctx.metro.tz, events };
    const result = icsToListings(calendar, {
      sourceUrl: source.url,
      fetchedAt,
      metroTz: ctx.metro.tz,
      countryCode: ctx.metro.countryCode,
      fromNight,
      ownLabel: ownSiteName(source.url),
    });
    return {
      listings: result.listings,
      doc,
      notes: [...notes, ...result.notes],
      ...(whole ? { whole: true as const } : {}),
    };
  },
};
