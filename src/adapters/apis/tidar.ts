// Tidar (buy.tidar.ma) Morocco's ticket site for electronic music nights.
// The city page https://buy.tidar.ma/city/marrakech is a Next.js page whose
// <script id="__NEXT_DATA__" type="application/json"> holds events at
// props.pageProps.events. One page read per run gives Marrakech's club nights.
// robots.txt: none, terms of sale say nothing about automated reading (checked 2026-11-07).

import { buildListing } from "@/src/adapters/structured";
import type {
  HarvestedListing,
  HarvestResult,
  RunCtx,
  Source,
  SourceAdapter,
} from "@/src/adapters/types";
import { currentNightDate } from "@/src/domain/tonight";
import { CRAWL_INTERVAL_MS } from "@/src/pipeline/http";
import { currencyForCountry } from "@/src/domain/prices";
import { addCalendarDays } from "@/src/domain/time";
import { sha256, isoToLocal, type LocalMoment } from "@/src/adapters/shared";
import { isStyleKey, matchStyles } from "@/config/styles";
import { MATERIALIZE_DAYS } from "@/src/domain/recurrence";
import { hasDanceWord } from "@/src/domain/listing-screen";
import { insideMetro } from "@/src/domain/metro-bounds";

export interface TidarEvent {
  id: number;
  name: string;
  address: string | null;
  city: string | null;
  coordinates: string | null;
  from: string | null;
  to: string | null;
  tags: string | null;
  slug: string | null;
  published: number | null;
  category: {
    slug: string;
  } | null;
}

/**
 * Extract event records from the Next.js page HTML.
 */
export function tidarEvents(html: string): TidarEvent[] {
  const scriptMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([^<]*)<\/script>/);
  if (!scriptMatch) {
    return [];
  }
  const raw = scriptMatch[1];
  if (!raw) {
    return [];
  }
  try {
    const data = JSON.parse(raw);
    const events = data?.props?.pageProps?.events;
    if (!Array.isArray(events)) {
      return [];
    }
    const records: TidarEvent[] = [];
    for (const ev of events) {
      // Ensure required fields exist
      if (ev == null || typeof ev !== "object") {
        continue;
      }
      records.push({
        id: typeof ev.id === "number" ? ev.id : 0,
        name: typeof ev.name === "string" ? ev.name.trim() : "",
        address: typeof ev.address === "string" ? ev.address.trim() : null,
        city: typeof ev.city === "string" ? ev.city.trim() : null,
        coordinates: typeof ev.coordinates === "string" ? ev.coordinates.trim() : null,
        from: typeof ev.from === "string" ? ev.from.trim() : null,
        to: typeof ev.to === "string" ? ev.to.trim() : null,
        tags: typeof ev.tags === "string" ? ev.tags.trim() : null,
        slug: typeof ev.slug === "string" ? ev.slug.trim() : null,
        published: typeof ev.published === "number" ? ev.published : null,
        category:
          ev.category && typeof ev.category === "object" && typeof ev.category.slug === "string"
            ? { slug: ev.category.slug.trim() }
            : null,
      });
    }
    return records;
  } catch {
    return [];
  }
}

/**
 * Normalize text: remove accents, lowercase.
 */
function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * Whether the city is Marrakech (accepts both spellings).
 */
export function isMarrakechCity(city: string | null): boolean {
  if (!city) return false;
  const folded = fold(city);
  return folded === "marrakech" || folded === "marrakesh";
}

/**
 * Dance filter: keep electronique category or has dance word in name.
 */
export function isTidarDance(rec: TidarEvent): boolean {
  // Category slug "electronique"
  if (rec.category?.slug === "electronique") {
    return true;
  }
  // A dance word ("danse", "dance party") or a named style ("Salsa Night") in the name
  if (rec.name && (hasDanceWord(rec.name) || matchStyles(rec.name).styles.length > 0)) {
    return true;
  }
  return false;
}

/**
 * Parse coordinates string "lat,lng" into { lat, lng } or null.
 */
export function parseCoordinates(coords: string | null): { lat: number; lng: number } | null {
  if (!coords) return null;
  const parts = coords.split(",");
  if (parts.length !== 2) return null;
  const latText = parts[0];
  const lngText = parts[1];
  if (latText === undefined || lngText === undefined) return null;
  const lat = parseFloat(latText);
  const lng = parseFloat(lngText);
  if (!isFinite(lat) || !isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return null;
  }
  return { lat, lng };
}

/**
 * Extract venue name from address: part before first comma.
 */
function venueNameFromAddress(address: string | null): string | null {
  if (!address) return null;
  const commaIdx = address.indexOf(",");
  if (commaIdx === -1) return address.trim();
  const name = address.slice(0, commaIdx).trim();
  return name || null;
}

/** Hours from start to end, both wall-clock "YYYY-MM-DD HH:MM:SS"; NaN when either is missing or unparsable. */
function spanHours(start: string | null | undefined, end: string | null | undefined): number {
  if (!start || !end) return Number.NaN;
  const a = new Date(start.replace(" ", "T") + "Z").getTime();
  const b = new Date(end.replace(" ", "T") + "Z").getTime();
  return (b - a) / 3_600_000;
}

/**
 * Determine if end should be null.
 */
function shouldEndBeNull(start: string | null, end: string | null, tz: string): boolean {
  if (!start || !end) return true;
  if (start === end) return true;
  // Check if end is placeholder "00:00:00"
  const endTime = end.includes(" ") ? end.split(" ")[1] : "";
  if (endTime === "00:00:00") return true;

  // Check if more than 12 hours apart using isoToLocal
  try {
    const startLocal = isoToLocal(start, tz);
    const endLocal = isoToLocal(end, tz);
    if (!startLocal || !endLocal) return true;
    // Convert to Date objects for comparison (using UTC parsing)
    const startDate = new Date(start.replace(" ", "T") + "Z");
    const endDate = new Date(end.replace(" ", "T") + "Z");
    const diffHours = (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60);
    if (diffHours > 12) return true;
  } catch {
    // If parsing fails, treat as null
  }
  return false;
}

export const tidarAdapter: SourceAdapter = {
  id: "tidar",
  tier: "A",
  countries: ["MA"],
  limits: { perDomainIntervalMs: CRAWL_INTERVAL_MS },
  async harvest(source: Source, ctx: RunCtx): Promise<HarvestResult> {
    const url = source.feedUrl ?? source.url;
    const page = await ctx.http.request({
      url,
      purpose: "crawl",
      headers: { accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1" },
    });

    const records = tidarEvents(page.body);
    if (records.length === 0) {
      throw new Error("buy.tidar.ma shows no event records");
    }

    const fromNight = currentNightDate(ctx.now(), ctx.metro.tz);
    const lastNight = addCalendarDays(fromNight, MATERIALIZE_DAYS - 1);
    const currency = currencyForCountry(ctx.metro.countryCode);

    const notes: string[] = [];
    const listings: HarvestedListing[] = [];

    let inWindow = 0;
    let otherCity = 0;
    let notDance = 0;
    let outsideMetro = 0;
    let badDate = 0;
    let listed = 0;

    for (const rec of records) {
      // Published filter
      if (rec.published === 0) {
        continue;
      }

      // City filter
      if (!isMarrakechCity(rec.city)) {
        otherCity++;
        continue;
      }

      // Parse start date
      const startLocal = rec.from ? isoToLocal(rec.from, ctx.metro.tz) : null;
      if (!startLocal) {
        badDate++;
        continue;
      }

      // Handle start time placeholder "00:00:00"
      const startTime = rec.from?.includes(" ") ? rec.from.split(" ")[1] : "";
      // D-794: a morning start with a span over 12 h (FRQNCY OBSESSION "06:00" to next day "14:00") is a
      // placeholder clock, not a 6am party: list it untimed on its start day.
      const startHour = /^\d{2}/.test(startTime ?? "") ? Number((startTime ?? "").slice(0, 2)) : -1;
      const morningPlaceholder =
        startHour >= 5 && startHour < 12 && spanHours(rec.from, rec.to) > 12;
      const moment: LocalMoment =
        startTime === "00:00:00" || morningPlaceholder
          ? { ...startLocal, time: null, night: startLocal.day }
          : startLocal;

      // Window filter
      if (moment.night < fromNight || moment.night > lastNight) {
        continue;
      }
      inWindow++;

      // Dance filter
      if (!isTidarDance(rec)) {
        notDance++;
        continue;
      }

      // Outline filter
      const coords = parseCoordinates(rec.coordinates);
      if (coords && !insideMetro(ctx.metro, coords)) {
        outsideMetro++;
        continue;
      }

      // Parse end date
      let end = null;
      if (!shouldEndBeNull(rec.from, rec.to, ctx.metro.tz)) {
        const endLocal = rec.to ? isoToLocal(rec.to, ctx.metro.tz) : null;
        if (endLocal) {
          end = endLocal;
        }
      }

      // Build event URL
      let eventUrl: string | null = null;
      if (rec.slug && /^[a-z0-9-]+$/.test(rec.slug)) {
        eventUrl = `https://buy.tidar.ma/event/${rec.slug}`;
      }

      const built = buildListing(
        {
          externalId: `tidar:${rec.id}`,
          title: rec.name,
          start: moment,
          end,
          description: null,
          venue: {
            name: venueNameFromAddress(rec.address),
            address: rec.address,
            url: null,
            location: coords,
          },
          organizer: { name: null, url: null },
          prices: null,
          ticketUrl: eventUrl,
          eventUrl,
          cancelled: false,
          styles: source.styles.filter(isStyleKey),
          type: "social",
          evidence: {
            start: `from ${rec.from}, Tidar`,
          },
        },
        {
          sourceUrl: url,
          fetchedAt: page.fetchedAt,
          method: "feed",
          currency,
        },
      );
      listings.push(built);
      listed++;
    }

    notes.unshift(
      `${records.length} events on the page; ${inWindow} in the window; ${otherCity} other city; ${notDance} not dance; ${outsideMetro} outside the metro; ${badDate} without a date; ${listed} listed`,
    );

    return {
      listings,
      notes,
      doc: {
        url,
        fetchedAt: page.fetchedAt,
        httpStatus: page.status,
        etag: page.etag,
        lastModified: page.lastModified,
        contentHash: sha256(JSON.stringify(listings.map((l) => [l.externalId, l.listing]))),
        cleanedText: null,
      },
    };
  },
};
