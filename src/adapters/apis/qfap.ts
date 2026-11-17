// City of Paris's open-data agenda "Que faire a Paris" (Opendatasoft API, ODbL).
// The adapter reads the JSON dataset via paginated API and returns dance nights as listings.
// Runs only in the Paris metro.

import { matchStyles, normalizeForMatch } from "@/config/styles";
import { plainText, sha256, type LocalMoment } from "@/src/adapters/shared";
import { buildListing } from "@/src/adapters/structured";
import type {
  HarvestedListing,
  HarvestResult,
  Metro,
  NightDate,
  RunCtx,
  SourceAdapter,
} from "@/src/adapters/types";
import type { Point } from "@/src/domain/listing";
import { addCalendarDays } from "@/src/domain/time";
import { NIGHT_BOUNDARY_HOUR } from "@/src/domain/tonight";

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

export const QFAP_URL =
  "https://opendata.paris.fr/api/explore/v2.1/catalog/datasets/que-faire-a-paris-/records";

export function qfapQueryUrl(fromNight: string, offset: number): string {
  const params = new URLSearchParams({
    where: `(qfap_tags like "Nuit" or qfap_tags like "Danse") and date_end >= "${fromNight}"`,
    select:
      "id,title,lead_text,occurrences,date_start,date_end,qfap_tags,address_name,address_street,address_zipcode,address_city,lat_lon,url,price_type",
    order_by: "id",
    limit: "100",
    offset: String(offset),
  });
  return `${QFAP_URL}?${params.toString()}`;
}

export function parseQfapOccurrences(
  value: unknown,
): Array<{ date: string; time: string | null; endDate: string | null; endTime: string | null }> {
  const occurrences: Array<{
    date: string;
    time: string | null;
    endDate: string | null;
    endTime: string | null;
  }> = [];

  if (typeof value !== "string" || !value.trim()) {
    return occurrences;
  }

  const parts = value.split(";");
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    const sides = trimmed.split("_");
    if (sides.length !== 2) continue;

    const [startSide = "", endSide = ""] = sides;

    const startMatch = startSide.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
    if (!startMatch) continue;

    const date = startMatch[1];
    const time = startMatch[2] ?? null;
    if (!date) continue;

    let endDate: string | null = null;
    let endTime: string | null = null;

    if (endSide) {
      const endMatch = endSide.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
      if (endMatch) {
        endDate = endMatch[1] ?? null;
        endTime = endMatch[2] ?? null;
      }
    }

    // If end is on same date but time is earlier or equal, move to next day
    if (endDate && endDate === date && endTime && time) {
      const startHour = parseInt(time.slice(0, 2), 10);
      const startMinute = parseInt(time.slice(3, 5), 10);
      const endHour = parseInt(endTime.slice(0, 2), 10);
      const endMinute = parseInt(endTime.slice(3, 5), 10);

      const startTotal = startHour * 60 + startMinute;
      const endTotal = endHour * 60 + endMinute;

      if (endTotal <= startTotal) {
        endDate = addCalendarDays(date, 1);
      }
    }

    occurrences.push({ date, time, endDate, endTime });
  }

  return occurrences;
}

function localMoment(date: string, time: string | null, zone: string): LocalMoment {
  const hour = time ? Number(time.slice(0, 2)) : 12;
  return {
    day: date,
    night: hour < NIGHT_BOUNDARY_HOUR ? addCalendarDays(date, -1) : date,
    time,
    zone,
    absolute: false,
  };
}

const DROP_TAGS = new Set([
  "Expo",
  "Théâtre",
  "Conférence",
  "Enfants",
  "Littérature",
  "Sport",
  "Balade urbaine",
  "Gourmand",
  "Cirque",
]);

const SOCIAL_DANCE_REGEX =
  /\b(soiree dansante|bal|ball|salsa|bachata|kizomba|tango|milonga|swing|lindy|rock|zouk|konpa|kompa|forro|the dansant|danse de salon|dance party|clubbing)\b/i;

function isSocialDance(title: string): boolean {
  const folded = normalizeForMatch(title);
  return SOCIAL_DANCE_REGEX.test(folded);
}

function isCancelled(title: string): boolean {
  const folded = normalizeForMatch(title);
  return /\bannule(e|s|es)?\b/.test(folded);
}

export function qfapToListings(
  records: unknown[],
  options: { metro: Metro; nights: NightDate[]; fetchedAt: Date },
): {
  listings: HarvestedListing[];
  notes: string[];
  screened: Array<{ externalId: string; title: string; reason: string }>;
} {
  const listings: HarvestedListing[] = [];
  const notes: string[] = [];
  const screened: Array<{ externalId: string; title: string; reason: string }> = [];
  const seen = new Set<string>();

  let totalRecords = 0;
  let keptRecords = 0;
  let skippedNoOccurrences = 0;

  for (const raw of records) {
    if (!isObject(raw)) continue;
    const record = raw;
    totalRecords++;

    const id = str(record.id);
    const rawTitle = str(record.title);
    if (!id || !rawTitle) continue;

    const title = rawTitle.replace(/\s+/g, " ").trim();

    // Tags
    const rawTags = str(record.qfap_tags);
    const tags = rawTags
      ? rawTags
          .split(";")
          .map((t) => t.trim())
          .filter(Boolean)
      : [];

    // Drop if any tag is in DROP_TAGS
    if (tags.some((tag) => DROP_TAGS.has(tag))) {
      continue;
    }

    // Keep if tags include "Nuit"
    const hasNuit = tags.includes("Nuit");
    const hasDanse = tags.includes("Danse");

    let keep = false;
    if (hasNuit) {
      keep = true;
    } else if (hasDanse) {
      keep = isSocialDance(title);
    }

    if (!keep) {
      continue;
    }
    keptRecords++;

    const cancelled = isCancelled(title);

    // Occurrences
    const occurrences = parseQfapOccurrences(record.occurrences);
    if (occurrences.length === 0) {
      skippedNoOccurrences++;
      continue;
    }

    // Venue
    const addressName = str(record.address_name);
    const street = str(record.address_street);
    const zipcode = str(record.address_zipcode);
    const city = str(record.address_city);

    let address: string | null = null;
    const parts: string[] = [];
    if (street) parts.push(street);
    const town = [zipcode, city].filter(Boolean).join(" ");
    if (town) parts.push(town);
    if (parts.length > 0) {
      address = parts.join(", ");
    }

    let location: Point | null = null;
    const latLon = record.lat_lon;
    if (isObject(latLon)) {
      const lat = latLon.lat;
      const lon = latLon.lon;
      if (
        typeof lat === "number" &&
        typeof lon === "number" &&
        Number.isFinite(lat) &&
        Number.isFinite(lon)
      ) {
        location = { lat, lng: lon };
      }
    }

    // Description
    const leadText = str(record.lead_text);
    const description = leadText ? plainText(leadText) : null;

    // Styles
    const { styles } = matchStyles(title);

    // Event URL
    const eventUrl = str(record.url);

    // Process each occurrence
    for (const occ of occurrences) {
      if (!occ.date) continue;
      const start = localMoment(occ.date, occ.time, options.metro.tz);
      if (!options.nights.includes(start.night)) continue;

      let end: LocalMoment | null = null;
      if (occ.endDate && occ.endTime) {
        const endMoment = localMoment(occ.endDate, occ.endTime, options.metro.tz);
        if (endMoment.night === start.night) {
          end = endMoment;
        }
      }

      const externalId = `${id}:${occ.date}`;
      if (seen.has(externalId)) continue;
      seen.add(externalId);

      listings.push(
        buildListing(
          {
            externalId,
            title,
            start,
            end,
            description,
            venue: {
              name: addressName,
              address,
              url: null,
              location,
            },
            organizer: { name: null, url: null },
            prices: null,
            ticketUrl: null,
            eventUrl,
            cancelled,
            styles,
          },
          {
            sourceUrl: QFAP_URL,
            fetchedAt: options.fetchedAt,
            method: "api",
            currency: "EUR",
          },
        ),
      );
    }
  }

  if (skippedNoOccurrences > 0) {
    notes.push(`qfap: ${skippedNoOccurrences} kept record(s) without dated occurrences skipped`);
  }

  notes.push(
    `qfap: ${totalRecords} records, ${keptRecords} kept, ${listings.length} listings for the nights`,
  );
  return { listings, notes, screened };
}

export const qfapAdapter: SourceAdapter = {
  id: "qfap",
  tier: "A",
  countries: ["FR"],
  limits: { perDomainIntervalMs: 2000, rps: 1, perDay: 10 },
  async harvestMetro(metro: Metro, nights: NightDate[], ctx: RunCtx): Promise<HarvestResult> {
    if (metro.slug !== "paris") {
      return {
        listings: [],
        notes: [],
        screened: [],
      };
    }

    const sortedNights = [...nights].sort();
    const fromNight = sortedNights[0];
    if (!fromNight) {
      return {
        listings: [],
        notes: [],
        screened: [],
      };
    }

    const allResults: unknown[] = [];
    let fetchedAt: Date = new Date();
    let firstUrl: string | null = null;

    for (let offset = 0; offset < 10 * 100; offset += 100) {
      const url = qfapQueryUrl(fromNight, offset);
      if (offset === 0) {
        firstUrl = url;
      }

      let response;
      try {
        response = await ctx.http.request({
          url,
          purpose: "api",
          intervalMs: 2000,
          maxBytes: 5 * 1024 * 1024,
          headers: { accept: "application/json" },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`qfap: download failed (${message})`);
      }

      if (response.status < 200 || response.status >= 300) {
        throw new Error(`qfap: download failed (HTTP ${response.status})`);
      }

      let body: unknown;
      try {
        body = JSON.parse(response.body);
      } catch {
        throw new Error("qfap: unexpected body");
      }

      if (!isObject(body) || !Array.isArray(body.results)) {
        throw new Error("qfap: unexpected body");
      }

      const results = body.results;
      allResults.push(...results);
      fetchedAt = response.fetchedAt;

      if (results.length < 100) {
        break;
      }
    }

    const { listings, notes, screened } = qfapToListings(allResults, {
      metro,
      nights,
      fetchedAt,
    });

    if (allResults.length >= 10 * 100) notes.push("qfap: stopped after 10 pages");

    return {
      listings,
      notes,
      screened,
      doc: {
        url: firstUrl || QFAP_URL,
        fetchedAt,
        httpStatus: 200,
        etag: null,
        lastModified: null,
        contentHash: sha256(JSON.stringify(listings.map((l) => [l.externalId, l.listing]))),
        cleanedText: null,
      },
    };
  },
};
