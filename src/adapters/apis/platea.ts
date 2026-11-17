// Platea PR (plateapr.com), Puerto Rico's culture calendar, read from its public Next.js page
// https://www.plateapr.com/eventos (written permission, the owner 2026-10-30, D-760). The page's data is inside
// <script>self.__next_f.push([1,"..."])</script> chunks; we join and parse them to extract event records.
// Only records with dance titles in the five San Juan metro municipios are kept.
// The page is read once per run; no other pages are fetched.

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
import { httpUrl, sha256, isoToLocal } from "@/src/adapters/shared";
import { isStyleKey } from "@/config/styles";
import { METRO_BOUNDS } from "@/src/domain/metro-bounds";
import { MATERIALIZE_DAYS } from "@/src/domain/recurrence";
import { nextFlightText } from "@/src/adapters/apis/circuitopenero";

export interface PlateaEvent {
  id: string;
  slug: string;
  href: string;
  title: string;
  startDate: string;
  allDay: boolean;
  venueName: string | null;
  placeName: string | null;
  ticketUrl: string | null;
}

/**
 * Extract event records from the Next.js page HTML.
 */
export function plateaEvents(html: string): PlateaEvent[] {
  const text = nextFlightText(html);
  const records: PlateaEvent[] = [];
  const seenIds = new Set<string>();

  const pattern = /\{"id":"[^"]+","slug":"/g;
  let pos = 0;
  while (pos < text.length) {
    const match = pattern.exec(text);
    if (!match) break;
    const start = match.index;
    // Parse balanced braces
    let braceCount = 0;
    let inString = false;
    let escape = false;
    let end = start;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (ch === '"' && !escape) {
        inString = !inString;
        continue;
      }
      if (!inString) {
        if (ch === "{") braceCount++;
        if (ch === "}") {
          braceCount--;
          if (braceCount === 0) {
            end = i + 1;
            break;
          }
        }
      }
    }
    if (end <= start) {
      pattern.lastIndex = start + 1;
      pos = start + 1;
      continue;
    }
    const slice = text.slice(start, end);
    try {
      const obj = JSON.parse(slice);
      if (
        typeof obj.id === "string" &&
        typeof obj.slug === "string" &&
        typeof obj.title === "string" &&
        typeof obj.startDate === "string"
      ) {
        if (seenIds.has(obj.id)) {
          pattern.lastIndex = end;
          pos = end;
          continue;
        }
        seenIds.add(obj.id);

        const title = obj.title.trim().replace(/\s+/g, " ");
        const href = typeof obj.href === "string" ? obj.href : `/eventos/${obj.slug}`;
        const venueName = typeof obj.venueName === "string" ? obj.venueName.trim() : null;
        const placeName = typeof obj.placeName === "string" ? obj.placeName.trim() : null;
        // Only http(s) ticket links survive (no javascript: or data: links).
        const ticketUrl = httpUrl(obj.ticketUrl);

        records.push({
          id: obj.id,
          slug: obj.slug,
          href,
          title,
          startDate: obj.startDate,
          allDay: Boolean(obj.allDay),
          venueName,
          placeName,
          ticketUrl,
        });
        pattern.lastIndex = end;
        pos = end;
        continue;
      }
    } catch {
      // A malformed record: skip it.
    }
    // Not a record: search again just after this match, so records nested inside it are still found.
    pattern.lastIndex = start + 1;
    pos = start + 1;
  }

  return records;
}

/**
 * True when title+slug contains dance words, but not art workshops/talks.
 */
export function isDanceTitle(title: string, slug: string): boolean {
  const combined = `${title} ${slug}`.toLowerCase();
  const danceRegex = /(bomba|plena|salsa|bachata|merengue|bail|danc|danz|tango|swing|kizomba|zouk)/;
  if (!danceRegex.test(combined)) return false;
  const excludeRegex =
    /\b(taller inspirado|exhibici[oó]n|exposici[oó]n|conferencia|charla|pel[ií]cula|documental)\b/i;
  return !excludeRegex.test(title);
}

const fold = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

/** The metro's towns: the names of its outline's parts (San Juan: the five municipios in config/metro-bounds). */
export function metroTowns(metroSlug: string): string[] {
  return (METRO_BOUNDS[metroSlug]?.boroughs ?? []).map((b) => b.name);
}

/**
 * Whether Platea's town is one of the metro's towns, compared accent- and case-insensitively.
 */
export function inPlateaMetro(placeName: string | null, towns: readonly string[]): boolean {
  if (!placeName) return false;
  const town = fold(placeName);
  return towns.some((t) => fold(t) === town);
}

/** The event's page on plateapr.com; an href that is absolute or off the site falls back to /eventos/<slug>. */
export function plateaEventUrl(href: string, slug: string): string {
  const fallback = `https://www.plateapr.com/eventos/${encodeURIComponent(slug)}`;
  const url = httpUrl(href, "https://www.plateapr.com");
  if (!url) return fallback;
  const host = new URL(url).hostname;
  return host === "plateapr.com" || host === "www.plateapr.com" ? url : fallback;
}

export const plateaAdapter: SourceAdapter = {
  id: "platea",
  tier: "A",
  // San Juan's metro row is countryCode "US" (D-460); "PR" kept for a metro stored under its own code (D-807).
  countries: ["US", "PR"],
  limits: { perDomainIntervalMs: CRAWL_INTERVAL_MS },
  async harvest(source: Source, ctx: RunCtx): Promise<HarvestResult> {
    const url = source.feedUrl ?? source.url;
    const page = await ctx.http.request({
      url,
      purpose: "crawl",
      headers: { accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1" },
    });

    const records = plateaEvents(page.body);
    if (records.length === 0) {
      throw new Error("plateapr.com/eventos shows no event records");
    }

    const fromNight = currentNightDate(ctx.now(), ctx.metro.tz);
    const lastNight = addCalendarDays(fromNight, MATERIALIZE_DAYS - 1);
    const currency = currencyForCountry(ctx.metro.countryCode);
    const towns = metroTowns(ctx.metro.slug);

    const notes: string[] = [];
    const listings: HarvestedListing[] = [];

    let inWindow = 0;
    let notDance = 0;
    let outside = 0;
    let badDate = 0;
    let listed = 0;

    for (const rec of records) {
      // Parse start date
      const local = isoToLocal(rec.startDate, ctx.metro.tz);
      if (!local) {
        badDate++;
        continue;
      }

      // Handle all-day
      const moment = rec.allDay ? { ...local, time: null, night: local.day } : local;

      // Window filter
      if (moment.night < fromNight || moment.night > lastNight) {
        continue;
      }
      inWindow++;

      // Dance filter
      if (!isDanceTitle(rec.title, rec.slug)) {
        notDance++;
        continue;
      }

      // Metro filter
      if (!inPlateaMetro(rec.placeName, towns)) {
        outside++;
        continue;
      }

      const type = /\bclases?\b/i.test(rec.title) ? "class" : "social";

      const built = buildListing(
        {
          externalId: `platea:${rec.id}`,
          title: rec.title,
          start: moment,
          end: null,
          description: null,
          venue: {
            name: rec.venueName,
            // Platea gives only the town, whose centre is no building: the venue's name (and known venues) place
            // the row, and a row without a venue name stays unplaced.
            address: null,
            url: null,
            location: null,
          },
          organizer: { name: null, url: null },
          prices: null,
          ticketUrl: rec.ticketUrl,
          eventUrl: plateaEventUrl(rec.href, rec.slug),
          cancelled: false,
          styles: source.styles.filter(isStyleKey),
          type,
          evidence: {
            start: `startDate ${rec.startDate}${rec.allDay ? " (all day)" : ""}, Platea PR`,
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
      `${records.length} events on the page; ${inWindow} in the window; ${notDance} not dance; ${outside} outside the metro; ${badDate} without a date; ${listed} listed`,
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
