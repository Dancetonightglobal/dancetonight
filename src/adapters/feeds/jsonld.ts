// schema.org Event in JSON-LD (PLAN 6.5 step 2): the `jsonld` adapter. Squarespace, Wix,
// WordPress (The Events Calendar and others), Eventbrite and most ticketing pages publish it,
// so one reader covers a large share of first-party pages with no model at all.
//
// Reads every `<script type="application/ld+json">` block, walks arrays, `@graph` and
// ItemList wrappers, and keeps nodes whose @type is Event or a subtype (DanceEvent, MusicEvent,
// SocialEvent, EducationEvent, Festival, ...). Online-only events are skipped: DanceTonight
// lists places to go.
//
// The page is third-party and hostile: only the JSON is read, through the fields below, and the
// description goes through the fixed patterns in src/domain/text-facts.ts.

import type { StyleKey } from "@/config/styles";
import { httpUrl, isoToLocal, plainText, sha256, type LocalMoment } from "@/src/adapters/shared";
import { isValidZone } from "@/src/domain/time";
import { buildListing, inWindow, type StructuredEvent } from "@/src/adapters/structured";
import type {
  HarvestedListing,
  HarvestResult,
  RunCtx,
  Source,
  SourceAdapter,
  HarvestedRecurrence,
} from "@/src/adapters/types";
import { sameLink } from "@/src/domain/event-link-matcher";
import type { ListingPrice, Point } from "@/src/domain/listing";
import { priceRangeLabel } from "@/src/domain/price-range";
import { currencyForCountry } from "@/src/domain/prices";
import { MATERIALIZE_DAYS, type Weekday } from "@/src/domain/recurrence";
import { currentNightDate } from "@/src/domain/tonight";
import { zoneForPoint } from "@/src/domain/zone";
import { CRAWL_INTERVAL_MS } from "@/src/pipeline/http";
import { titleBlocks } from "@/src/domain/title-blocks";
import { ownPageTimes, readBlockTimes } from "@/src/domain/stated-times";
import { firstNightOn, weeklyRecurrence } from "@/src/adapters/feeds/weekly-rule";
import { cleanPageText } from "@/src/pipeline/clean";
import { microdataEvents } from "@/src/adapters/feeds/microdata";

type Node = Record<string, unknown>;

const SCRIPT =
  /<script\b[^>]*\btype\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi;

/** Normalize address for comparison: lower-case, every run of non-alphanumeric characters as one space, trimmed. */
function addressKey(addr: string): string {
  return addr
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Every JSON-LD block on a page, parsed. A block that is not valid JSON is counted, not guessed at. */
export function extractJsonLd(html: string): { blocks: unknown[]; invalid: number } {
  const blocks: unknown[] = [];
  let invalid = 0;
  for (const match of html.matchAll(SCRIPT)) {
    const raw = (match[1] ?? "")
      .replace(/^\s*<!--/, "")
      .replace(/-->\s*$/, "")
      .replace(/^\s*\/\/\s*<!\[CDATA\[/, "")
      .replace(/\/\/\s*\]\]>\s*$/, "")
      .trim();
    if (!raw) continue;
    try {
      blocks.push(JSON.parse(raw));
    } catch {
      try {
        // Raw control characters inside strings are the commonest way CMSs break it; WordPress MEC
        // also escapes an apostrophe as \' , which JSON does not allow.
        blocks.push(
          JSON.parse(
            raw.replace(/[\u0000-\u001f]+/g, " ").replace(/(?<!\\)((?:\\\\)*)\\'/g, "$1'"),
          ),
        );
      } catch {
        invalid += 1;
      }
    }
  }
  return { blocks, invalid };
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
}

function isNode(value: unknown): value is Node {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function types(node: Node): string[] {
  return asArray(node["@type"]).filter((t): t is string => typeof t === "string");
}

const EVENT_TYPES = /^(Event|\w+Event|Festival|EventSeries)$/;

export function isEventNode(node: Node): boolean {
  return types(node).some((t) =>
    EVENT_TYPES.test(t.replace(/^schema:|^https?:\/\/schema\.org\//, "")),
  );
}

/** Event nodes anywhere in the blocks: arrays, @graph, ItemList elements, subEvent, and a place's event list. */
export function findEvents(blocks: unknown[]): Node[] {
  const found: Node[] = [];
  const seen = new Set<Node>();
  const visit = (value: unknown, depth: number) => {
    if (depth > 6) return;
    for (const item of asArray(value)) {
      if (Array.isArray(item)) {
        visit(item, depth + 1);
        continue;
      }
      if (!isNode(item) || seen.has(item)) continue;
      seen.add(item);
      if (isEventNode(item)) found.push(item);
      visit(item["@graph"], depth + 1);
      visit(item.itemListElement, depth + 1);
      visit(item.item, depth + 1);
      visit(item.subEvent, depth + 1);
      visit(item.subEvents, depth + 1);
      // A Place or Organization lists its events under `event` (schema.org Place.event), as Qué Hacemos'
      // venue pages do (2026-10-30).
      visit(item.event, depth + 1);
      visit(item.events, depth + 1);
    }
  };
  visit(blocks, 0);
  return found;
}

/**
 * Whether any schema.org event on the page states when it happens: a non-empty string `startDate`, an
 * `eventSchedule`, or a `subEvent` that itself has a non-empty string `startDate`. A page whose events state no
 * date at all (an undated EventSeries) is read by the model instead (Paris, salsaparisnight.com).
 */
export function hasDatedEvent(events: readonly Node[]): boolean {
  const hasDate = (node: Node): boolean => {
    // Check startDate
    const startDate = node.startDate;
    if (typeof startDate === "string" && startDate.trim() !== "") {
      return true;
    }
    // Check eventSchedule
    const schedule = node.eventSchedule;
    if (schedule !== undefined && schedule !== null) {
      return true;
    }
    // Check subEvent
    const subEvents = asArray(node.subEvent);
    for (const sub of subEvents) {
      if (isNode(sub) && hasDate(sub)) {
        return true;
      }
    }
    return false;
  };

  for (const event of events) {
    if (hasDate(event)) {
      return true;
    }
  }
  return false;
}

function text(value: unknown): string | null {
  if (typeof value === "string") return plainText(value);
  if (isNode(value) && typeof value["@value"] === "string") return plainText(value["@value"]);
  return null;
}

function nameOf(value: unknown): string | null {
  if (typeof value === "string") return plainText(value);
  if (isNode(value)) return text(value.name);
  return null;
}

function addressOf(value: unknown): string | null {
  if (typeof value === "string") return plainText(value);
  if (!isNode(value)) return null;
  const parts = [value.streetAddress, value.addressLocality, value.addressRegion, value.postalCode]
    .map(text)
    // A part written with its own separator ("Lohegaon," on Salsa Vida, Pune) would join as ",,"
    // (D-784).
    .map((p) => (p ? p.replace(/^[\s,]+|[\s,]+$/g, "") : p))
    .filter((p): p is string => !!p);
  const country = nameOf(value.addressCountry);
  if (country && parts.length > 0) parts.push(country);
  return parts.length > 0 ? parts.join(", ") : null;
}

function number(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value.trim())))
    return Number(value.trim());
  return null;
}

function geoOf(place: Node): Point | null {
  const geo = isNode(place.geo) ? place.geo : null;
  if (!geo) return null;
  const lat = number(geo.latitude);
  const lng = number(geo.longitude);
  if (
    lat === null ||
    lng === null ||
    Math.abs(lat) > 90 ||
    Math.abs(lng) > 180 ||
    (lat === 0 && lng === 0)
  ) {
    return null;
  }
  return { lat, lng };
}

/** The physical place of an event, or null when it is online only. */
function placeOf(node: Node): {
  name: string | null;
  address: string | null;
  url: string | null;
  location: Point | null;
} | null {
  const places = asArray(node.location).filter(isNode);
  const physical = places.find((p) => !types(p).includes("VirtualLocation")) ?? null;
  const onlineOnly = String(node.eventAttendanceMode ?? "").includes("OnlineEventAttendanceMode");
  if (!physical) {
    const loose = asArray(node.location).find((p) => typeof p === "string") as string | undefined;
    if (loose && !onlineOnly)
      return { name: null, address: plainText(loose), url: null, location: null };
    return null;
  }
  return {
    name: text(physical.name),
    address: addressOf(physical.address),
    url: httpUrl(physical.url) ?? httpUrl(physical.sameAs),
    location: geoOf(physical),
  };
}

export interface EventPagePlace {
  name: string | null;
  address: string;
  location: Point | null;
  /** "location <name>, <address>", at most 300 characters. */
  evidence: string;
}

/**
 * Extract embedded Venue point from Meetup-style page data.
 * Searches for `"__typename":"Venue"` objects in the HTML (using a regex that avoids nested braces),
 * returns the point of the first whose address matches the given address (normalized).
 * If none matches by address but exactly one distinct point appears across all Venue objects,
 * returns that point. Otherwise returns null.
 */
export function embeddedVenuePoint(html: string, address: string): Point | null {
  // Regex to find Venue objects without nested braces (simplistic but works for this data)
  const venueRegex = /\{"__typename"\s*:\s*"Venue"[^{}]*\}/g;
  const matches = html.match(venueRegex) ?? [];
  const points: Point[] = [];
  const keyAddr = addressKey(address);
  for (const match of matches) {
    try {
      const obj = JSON.parse(match) as Record<string, unknown>;
      const lat = typeof obj.lat === "number" && Number.isFinite(obj.lat) ? obj.lat : null;
      const lng = typeof obj.lng === "number" && Number.isFinite(obj.lng) ? obj.lng : null;
      if (lat === null || lng === null || (lat === 0 && lng === 0)) continue;
      const point = { lat, lng };
      const objAddress = typeof obj.address === "string" ? obj.address.trim() : null;
      if (objAddress) {
        const objKey = addressKey(objAddress);
        if (objKey === keyAddr) {
          // Exact match, return immediately
          return point;
        }
      }
      points.push(point);
    } catch {
      // ignore invalid JSON
    }
  }
  // No exact address match: if exactly one distinct point across all Venue objects, return it
  const distinctPoints = Array.from(new Map(points.map((p) => [`${p.lat},${p.lng}`, p])).values());
  if (distinctPoints.length === 1) {
    return distinctPoints[0]!;
  }
  return null;
}

/**
 * The one physical place an event page's JSON-LD gives (D-164), or null. A page whose events
 * give two or more different addresses is a list page, not one event's page, and gives null.
 */
export function eventPagePlace(html: string): EventPagePlace | null {
  const { blocks } = extractJsonLd(html);
  const nodes = findEvents(blocks);
  const kept: Array<{
    name: string | null;
    address: string;
    location: Point | null;
  }> = [];
  for (const node of nodes) {
    const place = placeOf(node);
    if (!place || !place.address) continue;
    const trimmed = place.address.trim();
    if (trimmed === "") continue;
    kept.push({
      name: place.name,
      address: trimmed,
      location: place.location,
    });
  }
  const [first, ...rest] = kept;
  if (!first) return null;
  const firstKey = addressKey(first.address);
  // Two or more different addresses: a list page, not one event's page.
  if (rest.some((other) => addressKey(other.address) !== firstKey)) return null;
  const { name, address } = first;
  // No JSON-LD geo: Meetup embeds its Venue's lat/lng in the page data.
  const location = first.location ?? embeddedVenuePoint(html, address);
  const evidence = `location ${name ? `${name}, ` : ""}${address}`.slice(0, 300);
  return { name, address, location, evidence };
}

/** Offers as price rows: each Offer is a row; an AggregateOffer range is one row with no single amount. */
export function offersToPrices(
  value: unknown,
  fallbackCurrency: string | null,
): { prices: ListingPrice[] | null; url: string | null } {
  const offers = asArray(value).filter(isNode);
  if (offers.length === 0) return { prices: null, url: null };
  const prices: ListingPrice[] = [];
  let url: string | null = null;
  for (const offer of offers) {
    url ??= httpUrl(offer.url);
    const currency = (text(offer.priceCurrency) ?? fallbackCurrency ?? "").toUpperCase();
    if (currency.length !== 3) continue;
    const low = number(offer.lowPrice);
    const high = number(offer.highPrice);
    if (types(offer).includes("AggregateOffer") && low !== null && high !== null && high > low) {
      // "Tickets, $10 to $20", as the ticketing APIs write a range (D-071): both ends with their
      // currency, not two bare numbers.
      const label = priceRangeLabel(text(offer.name) ?? "Tickets", low, high, currency);
      prices.push({ label, amount: null, currency, includes: null });
      continue;
    }
    const amount = number(offer.price) ?? low;
    const label = text(offer.name) ?? (amount === 0 ? "Free" : "Entry");
    if (amount === null) {
      if (typeof offer.price === "string" && /free/i.test(offer.price)) {
        prices.push({ label: "Free", amount: 0, currency, includes: null });
      }
      continue;
    }
    if (amount < 0) continue;
    prices.push({ label, amount, currency, includes: null });
  }
  return { prices: prices.length > 0 ? prices : null, url };
}

const MONTH_NAMES: Record<string, number> = {
  january: 1,
  jan: 1,
  february: 2,
  feb: 2,
  march: 3,
  mar: 3,
  april: 4,
  apr: 4,
  may: 5,
  june: 6,
  jun: 6,
  july: 7,
  jul: 7,
  august: 8,
  aug: 8,
  september: 9,
  sept: 9,
  sep: 9,
  october: 10,
  oct: 10,
  november: 11,
  nov: 11,
  december: 12,
  dec: 12,
};

const NOT_WEEKLY = [
  /\bd[oa]\s+m[eê]s\b/i,
  /\b(?:mensal|quinzenal|mensalmente|quinzenalmente)\b/i,
  /\ba\s+cada\s+(?:\d+|quinze|duas|tr[eê]s)\s+(?:dias|semanas)\b/i,
  /\d\s*[ºª°]/,
  /\b(?:primeir|segund|terceir|quart|quint|[uú]ltim)[oa]\s+(?:segunda|ter[cç]a|quarta|quinta|sexta|s[aá]bado|domingo)(?:-feira)?\s+d[oe]\b/i,
];

/** Parse a written-out date like "Oct 29, 2026" or "29 October 2026" to a date-only LocalMoment. */
export function writtenDateOnly(value: unknown, zone: string): LocalMoment | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  // Optional weekday prefix like "Thu, " or "Thursday "
  const withoutWeekday = trimmed.replace(/^(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*,?\s*/i, "");
  // Two patterns: Month D, YYYY  or  D Month YYYY
  // Month D, YYYY: Oct 29, 2026 or October 29 2026 (comma optional)
  const monthFirst = /^([a-z]+)\s+(\d{1,2}),?\s+(\d{4})$/i.exec(withoutWeekday);
  // D Month YYYY: 29 October 2026 or 29 Oct 2026
  const dayFirst = /^(\d{1,2})\s+([a-z]+)\s+(\d{4})$/i.exec(withoutWeekday);
  const match = monthFirst || dayFirst;
  if (!match) return null;
  const monthStr = monthFirst ? match[1]! : match[2]!;
  const dayStr = monthFirst ? match[2]! : match[1]!;
  const yearStr = match[3]!;
  const month = MONTH_NAMES[monthStr.toLowerCase()];
  if (!month) return null;
  const day = parseInt(dayStr, 10);
  const year = parseInt(yearStr, 10);
  // Validate it's a real calendar date
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }
  const dayFormatted = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const tz = isValidZone(zone) ? zone : "UTC";
  return { day: dayFormatted, night: dayFormatted, time: null, zone: tz, absolute: false };
}

/** A salsavida.com page (D-778). */
export function isSalsaVidaPage(pageUrl: string): boolean {
  try {
    return /(?:^|\.)salsavida\.com$/i.test(new URL(pageUrl).hostname);
  } catch {
    return false;
  }
}

/** "2026-11-08T20:00:00-06:00" -> "2026-11-08T20:00:00" (also drops "Z", "+0530", "+05:30"); other values unchanged. */
export function dropUtcOffset(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  // Matches date-time with trailing offset/Z
  const pattern = /^(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)(Z|[+-]\d{2}:?\d{2})$/i;
  const match = pattern.exec(trimmed);
  if (!match) return value;
  return match[1]!;
}

function statusOf(node: Node): "scheduled" | "cancelled" | "postponed" | "moved_online" {
  const status = String(node.eventStatus ?? "");
  if (/EventCancelled/i.test(status)) return "cancelled";
  if (/EventPostponed/i.test(status)) return "postponed";
  if (/EventMovedOnline/i.test(status)) return "moved_online";
  return "scheduled";
}

const SCHEDULE_DAYS: Record<string, Weekday> = {
  mon: "MO",
  tue: "TU",
  wed: "WE",
  thu: "TH",
  fri: "FR",
  sat: "SA",
  sun: "SU",
};

/**
 * A schema.org weekly eventSchedule (no startDate) on the page's own event: its days, first night and stated time
 * (D-513). A string is a skip note; null means no weekly schedule.
 * A schedule with byDay and no repeatFrequency (and none of repeatCount, startDate, endDate, byMonth, byMonthDay,
 * byMonthWeek) counts as weekly (Papa Dubai, 2026-11-07).
 */
function weeklySchedule(
  node: Node,
  options: JsonLdOptions,
  title: string,
): { days: Weekday[]; night: string; time: string | null; quote: string } | string | null {
  const schedules = asArray(node.eventSchedule).filter(isNode);
  const schedule = schedules[0];
  if (!schedule) return null;

  const freq = String(schedule.repeatFrequency ?? "")
    .trim()
    .toUpperCase();
  // Weekly if explicitly P1W/P7D, or if no repeatFrequency and none of the other fields that make it non-weekly.
  if (freq !== "P1W" && freq !== "P7D") {
    if (freq !== "") return null;
    // No repeatFrequency: check for other fields that would make this not a plain weekly night.
    if (
      schedule.repeatCount !== undefined ||
      schedule.startDate !== undefined ||
      schedule.endDate !== undefined ||
      schedule.byMonth !== undefined ||
      schedule.byMonthDay !== undefined ||
      schedule.byMonthWeek !== undefined
    ) {
      return null;
    }
    // It's a plain weekly schedule (byDay only).
  }

  const rawDays = asArray(schedule.byDay).filter((d): d is string => typeof d === "string");
  const days: Weekday[] = [];
  for (const raw of rawDays) {
    const lastPart = raw.split(/[/:]/).pop()?.toLowerCase();
    if (!lastPart) continue;
    const day = SCHEDULE_DAYS[lastPart.slice(0, 3)];
    if (day) days.push(day);
  }
  if (days.length === 0) return null;

  const eventUrl = httpUrl(node.url, options.pageUrl);
  if (!sameLink(eventUrl ?? "", options.pageUrl)) {
    return `weekly schedule for another page, skipped: ${title}`;
  }

  const description = text(node.description) ?? "";
  for (const pattern of NOT_WEEKLY) {
    if (pattern.test(description)) {
      return `monthly night written as weekly, skipped: ${title}`;
    }
  }

  const night = firstNightOn(days, options.fromNight);
  if (!night) return null;

  let time: string | null = null;
  let quote = "";
  const startTime = String(schedule.startTime ?? "").trim();
  const timeMatch = startTime.match(/^(\d{1,2}):(\d{2})/);
  if (timeMatch) {
    const hours = timeMatch[1]!.padStart(2, "0");
    const minutes = timeMatch[2]!;
    time = `${hours}:${minutes}`;
    quote = `startTime ${startTime}`;
  } else {
    const lang = typeof node.inLanguage === "string" ? node.inLanguage : undefined;
    const mentions = readBlockTimes(description, lang);
    const explicitStarts = mentions.filter(
      (m) => m.explicit === true && m.value !== null && m.role !== "end",
    );
    const distinctTimes = [...new Set(explicitStarts.map((m) => m.value!))];
    if (distinctTimes.length === 1 && distinctTimes[0]! >= "06:00") {
      time = distinctTimes[0]!;
      quote = explicitStarts.find((m) => m.value === time)?.quote ?? "";
    }
  }

  return { days, night, time, quote };
}

function performers(node: Node): { bands: string[]; djs: string[] } {
  const bands: string[] = [];
  const djs: string[] = [];
  for (const p of asArray(node.performer).filter(isNode)) {
    const name = text(p.name);
    if (!name) continue;
    if (types(p).includes("MusicGroup")) bands.push(name);
    else if (/^dj\b/i.test(name)) djs.push(name);
  }
  return { bands, djs };
}

export interface JsonLdOptions {
  pageUrl: string;
  fetchedAt: Date;
  metroTz: string;
  countryCode: string;
  fromNight: string;
  days?: number;
  /**
   * The name a list gives this page's event, used in place of the page's own on a one-event page:
   * Squarespace names an item "Brooklyn Social — RSCDS New York", the site's name appended (D-111).
   */
  title?: string;
  /**
   * The page's cleaned text, used to find times written on the page for date-only JSON-LD events (D-276).
   */
  pageText?: string;
  /**
   * Drop the UTC offset on startDate/endDate and read the clock as local time (D-1083).
   */
  wallClock?: boolean;
}

export function jsonLdToListings(
  blocks: unknown[],
  options: JsonLdOptions,
): { listings: HarvestedListing[]; notes: string[] } {
  const days = options.days ?? MATERIALIZE_DAYS;
  const currency = currencyForCountry(options.countryCode);
  const notes: string[] = [];
  const listings: HarvestedListing[] = [];
  const seen = new Set<string>();

  const nodes = findEvents(blocks);
  // A page whose events all share one name is that event's page (its dates); a page of several
  // events is a list, and an event whose url is that list is not its own page (D-073).
  const onePage = new Set(nodes.map((n) => text(n.name))).size <= 1;
  // Collect all titles for titleBlocks (D-276)
  const allTitles = [...new Set(nodes.map((n) => text(n.name)).filter((t): t is string => !!t))];

  // D-854: a local-midnight start (often "the date, no time") gives way to a same-title node that starts later on
  // that calendar day; otherwise it would be filed on the night before (D-004) as a second card.
  const startOf = (node: Node) => {
    const place = placeOf(node);
    if (!place) return null;
    const zone =
      (place.location && zoneForPoint(place.location.lat, place.location.lng)) || options.metroTz;
    const wallClock = options.wallClock === true || isSalsaVidaPage(options.pageUrl);
    const raw = wallClock ? dropUtcOffset(node.startDate) : node.startDate;
    return isoToLocal(raw, zone);
  };
  const titleKey = (node: Node) =>
    (text(node.name) ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  const starts = nodes.map((n) => ({ key: titleKey(n), start: startOf(n) }));
  const dropIndex = new Set<number>();
  starts.forEach(({ key, start }, i) => {
    if (!key || !start?.absolute || start.time !== "00:00") return;
    const twin = starts.some(
      (o, j) =>
        j !== i &&
        o.key === key &&
        o.start?.day === start.day &&
        !!o.start.time &&
        o.start.time > "00:00",
    );
    if (twin) dropIndex.add(i);
  });
  if (dropIndex.size > 0) {
    notes.push(`${dropIndex.size} midnight start(s) dropped for a same-day timed twin`);
  }

  for (let i = 0; i < nodes.length; i++) {
    if (dropIndex.has(i)) continue;
    const node = nodes[i]!;
    const title = (onePage && options.title) || text(node.name);
    if (!title) {
      notes.push("an event with no name was skipped");
      continue;
    }
    const place = placeOf(node);
    const status = statusOf(node);
    if (!place || status === "moved_online") {
      notes.push(`online only, skipped: ${title}`);
      continue;
    }
    const zone =
      (place.location && zoneForPoint(place.location.lat, place.location.lng)) || options.metroTz;
    // D-778: Salsa Vida's JSON-LD clock is always the time its page shows, but its offset is sometimes another
    // zone's (Beirut -08:00, Tulum -06:00): its pages are read on the wall clock everywhere.
    const wallClock = options.wallClock === true || isSalsaVidaPage(options.pageUrl);
    const rawStart = wallClock ? dropUtcOffset(node.startDate) : node.startDate;
    const rawEnd = wallClock ? dropUtcOffset(node.endDate) : node.endDate;
    let start = isoToLocal(rawStart, zone) ?? writtenDateOnly(rawStart, zone);
    let scheduleResult: ReturnType<typeof weeklySchedule> = null;
    let recurrence: HarvestedRecurrence | null = null;
    if (!start) {
      scheduleResult = weeklySchedule(node, options, title);
      if (typeof scheduleResult === "string") {
        notes.push(scheduleResult);
        continue;
      }
      if (scheduleResult) {
        const { days, night, time } = scheduleResult;
        start = { day: night, night, time, zone, absolute: false };
        recurrence = weeklyRecurrence(days, night, time);
      } else {
        notes.push(`no readable start: ${title}`);
        continue;
      }
    }
    if (!inWindow(start.night, options.fromNight, days)) continue;
    // D-276: date-only JSON-LD events take the time from their own card on the page
    let d276EvidenceStart: string | null = null;
    if (start.time === null && options.pageText && !recurrence) {
      const blocks = titleBlocks(options.pageText, title, allTitles, undefined);
      const starts = [...new Set(ownPageTimes(blocks, start.night, undefined).starts)];
      if (starts.length === 1 && starts[0]! >= "06:00") {
        start = { ...start, time: starts[0]! };
        d276EvidenceStart =
          `startDate ${String(node.startDate)}; time from its own card on the page`.slice(0, 300);
      }
    }
    const end = isoToLocal(rawEnd, zone);

    const { prices, url: offerUrl } = offersToPrices(node.offers, currency);
    const { bands, djs } = performers(node);
    const eventUrl = httpUrl(node.url, options.pageUrl);
    const ownPage = eventUrl && (onePage || !sameLink(eventUrl, options.pageUrl)) ? eventUrl : null;
    const organizer = asArray(node.organizer).find(isNode) ?? null;
    const externalId =
      scheduleResult && typeof scheduleResult !== "string"
        ? (typeof node["@id"] === "string" && node["@id"]) ||
          (eventUrl ? `${eventUrl}#weekly` : null)
        : (typeof node["@id"] === "string" && node["@id"]) ||
          (eventUrl ? `${eventUrl}#${String(node.startDate)}` : null);
    const dedupeKey =
      scheduleResult && typeof scheduleResult !== "string"
        ? `${title}|weekly`
        : `${title}|${String(node.startDate)}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const evidence: Record<string, string> = {};
    if (scheduleResult && typeof scheduleResult !== "string") {
      const schedule = asArray(node.eventSchedule).filter(isNode)[0];
      let ev = `eventSchedule ${JSON.stringify(schedule)}`.slice(0, 300);
      if (scheduleResult.quote) {
        const withQuote = `eventSchedule ${JSON.stringify(schedule)}; time "${scheduleResult.quote}"`;
        ev = withQuote.slice(0, 300);
      }
      evidence.start = ev;
    } else if (typeof node.startDate === "string") {
      evidence.start = d276EvidenceStart ?? `startDate ${node.startDate}`.slice(0, 300);
    }
    if (typeof node.endDate === "string" && end?.time)
      evidence.end_time = `endDate ${node.endDate}`.slice(0, 300);
    if (prices) evidence.prices = `offers ${JSON.stringify(node.offers)}`.slice(0, 300);
    if (status !== "scheduled")
      evidence.cancelled = `eventStatus ${String(node.eventStatus)}`.slice(0, 300);

    const structured: StructuredEvent = {
      externalId,
      title,
      start,
      // An end on a later calendar day than the night after is a multi-day span, not an end time.
      end: end && end.time && end.night === start.night ? end : null,
      description: text(node.description),
      venue: place,
      organizer: organizer
        ? { name: text(organizer.name), url: httpUrl(organizer.url) }
        : { name: nameOf(node.organizer), url: null },
      prices,
      // Only an offer's own link sells tickets; the event's page is its canonical URL (D-070).
      ticketUrl: offerUrl,
      eventUrl: ownPage,
      cancelled: status === "cancelled" || status === "postponed",
      styles: [] as StyleKey[],
      bands,
      djs,
      evidence,
    };
    const listing = buildListing(structured, {
      sourceUrl: eventUrl ?? options.pageUrl,
      fetchedAt: options.fetchedAt,
      method: "jsonld",
      currency,
    });
    if (recurrence) {
      listing.recurrence = recurrence;
    }
    listings.push(listing);
  }
  return { listings, notes };
}

export const jsonLdAdapter: SourceAdapter = {
  id: "jsonld",
  tier: "A",
  limits: { perDomainIntervalMs: CRAWL_INTERVAL_MS },
  async harvest(source: Source, ctx: RunCtx): Promise<HarvestResult> {
    const url = source.feedUrl ?? source.url;
    const response = await ctx.http.request({
      url,
      purpose: "crawl",
      headers: { accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1" },
      conditional: { etag: source.etag, lastModified: source.lastModified },
    });
    if (response.notModified) return { listings: [], unchanged: true };
    const extracted = extractJsonLd(response.body);
    const invalid = extracted.invalid;
    // A page with no JSON-LD Event may carry its events as schema.org microdata (Ball & Chain's
    // Webflow /events page, D-858): read those as the same Event nodes.
    const blocks =
      findEvents(extracted.blocks).length > 0
        ? extracted.blocks
        : [...extracted.blocks, ...microdataEvents(response.body, response.url || url)];
    const events = findEvents(blocks);
    // Events that state no date (an undated EventSeries): the page's nights are its text, read by the model.
    if (events.length > 0 && !hasDatedEvent(events)) {
      return {
        listings: [],
        readWithModel: "schema.org events on the page state no date",
        notes: ["schema.org events on the page state no date: read by the model"],
      };
    }
    // Compute cleaned page text for D-276 (card times)
    const pageText = cleanPageText(response.body, url);
    const { listings, notes } = jsonLdToListings(blocks, {
      pageUrl: response.url || url,
      fetchedAt: response.fetchedAt,
      metroTz: ctx.metro.tz,
      countryCode: ctx.metro.countryCode,
      fromNight: currentNightDate(ctx.now(), ctx.metro.tz),
      pageText,
      wallClock: source.wallClockTimes === true,
    });
    // The hash covers the events and the listings made from them (the card times, D-276),
    // not the rest of the page.
    const contentHash = sha256(JSON.stringify([events, listings.map((l) => l.listing)]));
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
    if (invalid > 0) notes.push(`${invalid} JSON-LD block(s) on the page were not valid JSON`);
    if (events.length === 0) notes.push("no schema.org events on the page");
    // Whole through its last dated night, logged only for now (D-880): every block was valid JSON
    // and the url is not one page of several (?page=N, ?p=N, /page/N rotate their events).
    const fromNight = currentNightDate(ctx.now(), ctx.metro.tz);
    let through: string | null = null;
    for (const l of listings) {
      const night = l.listing.local_date;
      if (night && night >= fromNight && (through === null || night > through)) through = night;
    }
    const paged = /[?&](page|p)=\d|\/page\/\d/i.test(response.url || url);
    if (through && invalid === 0 && !paged)
      return { listings, doc, notes, wholeThroughLogOnly: through };
    return { listings, doc, notes };
  },
};
