// Barcelona City Council's open-data cultural agenda (Open Data BCN, CC BY 4.0).
// The adapter reads the JSON dataset once per run and returns dance nights as listings.
// Runs only in the Barcelona metro.

import { matchStyles } from "@/config/styles";
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
import {
  BCN_DATASTORE_SQL_URL,
  culturalSqlUrl,
  placesSqlUrl,
  cleanRegisterId,
  datastoreRowToEvent,
} from "./bcn-agenda-datastore";

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v)
    ? v
    : typeof v === "string"
      ? Number.parseFloat(v)
      : null;
const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

export const BCN_AGENDA_URL = BCN_DATASTORE_SQL_URL;

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

function cleanTitle(title: string): string {
  let cleaned = title.replace(/\s+/g, " ").trim();

  // Remove trailing *...* markers (including *Suspès* etc.)
  cleaned = cleaned.replace(/\s*\*[^*\s]*\*?\s*$/, "");

  // Remove specific inline markers
  const markers = [
    "\\*NOU\\*",
    "\\*N\\*",
    "\\*Suspès\\*",
    "\\*CANCEL·LADA TEMPORALMENT",
    '\\*\\*Cancel·lada"',
  ];

  for (const marker of markers) {
    cleaned = cleaned.replace(new RegExp(marker, "gi"), "");
  }

  // Collapse spaces and trim
  return cleaned.replace(/\s+/g, " ").trim();
}

function unwrapFestaTitle(cleanedTitle: string): string {
  const trimmed = cleanedTitle.trim();
  // Case-insensitive "Festa" at start
  const festaPattern = /^festa\s+/i;
  const match = trimmed.match(festaPattern);
  if (!match) {
    return trimmed;
  }
  const afterFesta = trimmed.slice(match[0].length);
  // Check for double quotes
  if (afterFesta.startsWith('"') && afterFesta.endsWith('"') && afterFesta.length > 2) {
    return afterFesta.slice(1, -1).trim();
  }
  // Check for single quotes
  if (afterFesta.startsWith("'") && afterFesta.endsWith("'") && afterFesta.length > 2) {
    return afterFesta.slice(1, -1).trim();
  }
  return trimmed;
}

export function isBcnDanceTitle(name: string): boolean {
  const cleaned = cleanTitle(name);
  if (isCourse(cleaned)) {
    return false;
  }
  if (isNonDanceFirstWord(cleaned)) {
    return isDanceEventWithFirstWordCheck(cleaned);
  }
  return isDanceEvent(cleaned);
}

function isDanceEvent(title: string): boolean {
  // Normalize for accent-insensitive matching
  const normalizedTitle = title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  // Dance words (accent-insensitive)
  const danceWords = [
    "ball",
    "balls",
    "ballada",
    "ballades",
    "ballar",
    "baile",
    "bailar",
    "milonga",
    "sardanes",
    "sardana",
  ];

  // Check for whole-word match of any dance word ONLY on normalizedTitle
  for (const word of danceWords) {
    const pattern = new RegExp(`\\b${word}\\b`, "i");
    if (pattern.test(normalizedTitle)) {
      return true;
    }
  }

  // Check for disco/dj with party word
  // Matched on the accent-stripped title: JS \b treats "ó" as a non-word character.
  const hasDisco = /\bdisco\b/.test(normalizedTitle);
  const hasDj = /\bdj\b/.test(normalizedTitle);
  const hasPartyWord = /\b(festa|nit|sessio|party)\b/.test(normalizedTitle);

  if ((hasDisco || hasDj) && hasPartyWord) {
    return true;
  }

  // Check styles
  const { styles } = matchStyles(title);
  return styles.length > 0;
}

function isCourse(title: string): boolean {
  const trimmed = title.trim();
  return trimmed.startsWith("Taller") || trimmed.startsWith("Curs");
}

function isNonDanceFirstWord(title: string): boolean {
  const normalizedTitle = title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const firstWord = normalizedTitle.split(/\s+/)[0] ?? "";
  return ["exposicio", "exhibicio", "conferencia", "cinema", "concert"].includes(firstWord);
}

function isDanceEventWithFirstWordCheck(title: string): boolean {
  const normalizedTitle = title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const firstWord = normalizedTitle.split(/\s+/)[0] ?? "";
  const isExpoExhibConfCinema = ["exposicio", "exhibicio", "conferencia", "cinema"].includes(
    firstWord,
  );
  const isConcert = firstWord === "concert";

  // If it's expo/exhib/conf/cinema, never a dance night
  if (isExpoExhibConfCinema) {
    return false;
  }

  // If it's concert, only pass if a dance word appears
  if (isConcert) {
    const danceWords = [
      "ball",
      "balls",
      "ballada",
      "ballades",
      "ballar",
      "baile",
      "bailar",
      "milonga",
      "sardanes",
      "sardana",
    ];
    for (const word of danceWords) {
      const pattern = new RegExp(`\\b${word}\\b`, "i");
      if (pattern.test(normalizedTitle)) {
        return true;
      }
    }
    return false;
  }

  // Otherwise, use the regular dance detection
  return isDanceEvent(title);
}

function isCancelled(event: Json): boolean {
  const statusName = str(event.event_status_name)?.toLowerCase();
  const status = str(event.event_status)?.toLowerCase();
  return (
    statusName === "suspès" ||
    statusName === "ajornat" ||
    status === "suspended" ||
    status === "postponed"
  );
}

function parseIcal(
  ical: string,
): Array<{ date: string; time: string | null; endTime: string | null }> {
  const events: Array<{ date: string; time: string | null; endTime: string | null }> = [];

  // Split by line breaks
  const lines = ical.split(/\r?\n/);
  let inEvent = false;
  let dtstart: string | null = null;
  let dtend: string | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "BEGIN:VEVENT") {
      inEvent = true;
      dtstart = null;
      dtend = null;
    } else if (trimmed === "END:VEVENT") {
      if (inEvent && dtstart) {
        // Parse DTSTART
        if (dtstart.length >= 15) {
          const year = dtstart.slice(0, 4);
          const month = dtstart.slice(4, 6);
          const day = dtstart.slice(6, 8);
          const hour = dtstart.slice(9, 11);
          const minute = dtstart.slice(11, 13);

          const date = `${year}-${month}-${day}`;
          const time = `${hour}:${minute}`;
          let endTime: string | null = null;

          if (dtend && dtend.length >= 15) {
            const endHour = dtend.slice(9, 11);
            const endMinute = dtend.slice(11, 13);
            endTime = `${endHour}:${endMinute}`;
          }

          events.push({ date, time, endTime });
        }
      }
      inEvent = false;
    } else if (inEvent) {
      if (trimmed.startsWith("DTSTART:")) {
        dtstart = trimmed.slice(8);
      } else if (trimmed.startsWith("DTEND:")) {
        dtend = trimmed.slice(6);
      }
    }
  }

  return events;
}

function slugify(title: string): string {
  // Convert to lowercase, normalize, remove accents
  let slug = title
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  // Replace l·l with ll
  slug = slug.replace(/l·l/g, "ll");
  // Replace non-alphanumeric with hyphens
  slug = slug.replace(/[^a-z0-9]+/g, "-");
  // Trim hyphens
  slug = slug.replace(/^-+|-+$/g, "");
  return slug;
}

function venueFromAddresses(addresses: Json[]): {
  name: string | null;
  address: string | null;
  location: Point | null;
} {
  if (addresses.length === 0) {
    return { name: null, address: null, location: null };
  }

  let addr: Json | undefined = addresses[0];
  for (const a of addresses) {
    if (a.main_address === true) {
      addr = a;
      break;
    }
  }

  if (!addr) {
    return { name: null, address: null, location: null };
  }

  const name = str(addr.place);
  const hide = addr.hide_address === true;
  if (hide) {
    return { name, address: null, location: null };
  }

  const addressName = str(addr.address_name);
  const streetNumber = str(addr.street_number_1);
  const zip = str(addr.zip_code);
  const town = str(addr.town);

  let address: string | null = null;
  if (addressName) {
    const parts = [addressName];
    if (streetNumber) parts.push(streetNumber);
    if (zip) parts.push(zip);
    if (town) {
      const formattedTown = town.charAt(0).toUpperCase() + town.slice(1).toLowerCase();
      parts.push(formattedTown);
    }
    address = parts.join(", ");
  }

  let location: Point | null = null;
  const loc = addr.location_4326_latlon;
  if (isObject(loc) && loc.type === "GeometryCollection" && Array.isArray(loc.geometries)) {
    for (const geom of loc.geometries) {
      if (isObject(geom) && geom.type === "Point" && Array.isArray(geom.coordinates)) {
        const coords = geom.coordinates;
        if (coords.length >= 2) {
          const lng = coords[0];
          const lat = coords[1];
          // Direct number check to avoid num() issues
          if (
            typeof lat === "number" &&
            typeof lng === "number" &&
            Number.isFinite(lat) &&
            Number.isFinite(lng)
          ) {
            location = { lat, lng };
            break;
          }
        }
      }
    }
  }

  // Ensure location is always included in the return object
  return { name, address, location: location ?? null };
}

function firstUrl(values: Json[]): string | null {
  for (const v of values) {
    const url = str(v.url_value);
    if (url && /^https?:\/\//i.test(url)) {
      return url;
    }
  }
  return null;
}

export function bcnAgendaToListings(
  events: unknown[],
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

  let totalEvents = 0;
  let danceEvents = 0;

  for (const raw of events) {
    if (!isObject(raw)) continue;
    const event = raw;
    totalEvents++;

    let registerId: string | null = null;
    if (typeof event.register_id === "number" && Number.isFinite(event.register_id)) {
      registerId = String(event.register_id);
    } else if (typeof event.register_id === "string" && event.register_id.trim()) {
      registerId = event.register_id.trim();
    }
    if (!registerId) continue;

    const rawName = str(event.name);
    if (!rawName) continue;
    const cleanedTitle = cleanTitle(rawName);
    const listingTitle = unwrapFestaTitle(cleanedTitle);

    // Skip courses
    if (isCourse(cleanedTitle)) continue;

    const ical = str(event.ical);
    const typeName = str(event.type_name);
    const startDate = str(event.start_date);

    // Parse occurrences
    const occurrences: Array<{ date: string; time: string | null; endTime: string | null }> = [];

    if (ical) {
      const icalEvents = parseIcal(ical);
      for (const ev of icalEvents) {
        let time = ev.time;
        let endTime = ev.endTime;

        // Check for placeholder times
        if (time === "00:00" || time === "03:00") {
          time = null;
        }
        if (endTime === "00:00" || endTime === "03:00") {
          endTime = null;
        }

        occurrences.push({ date: ev.date, time, endTime });
      }
    } else if (typeName === "Puntual" && startDate) {
      const date = startDate.slice(0, 10);
      occurrences.push({ date, time: null, endTime: null });
    }

    // Check if it's a dance event with first-word special handling
    const firstWordScreen = isNonDanceFirstWord(cleanedTitle);
    const isDance = firstWordScreen
      ? isDanceEventWithFirstWordCheck(cleanedTitle)
      : isDanceEvent(cleanedTitle);
    if (!isDance) {
      // An exhibition, talk, film or concert (D-856) may have been written before the screen
      // existed: report its occurrences as screened so the stored rows are retired (D-874).
      if (firstWordScreen) {
        for (const occ of occurrences) {
          if (!occ.date) continue;
          const externalId = `${registerId}:${occ.date}`;
          if (screened.some((s) => s.externalId === externalId)) continue;
          screened.push({ externalId, title: listingTitle, reason: "not a dance night (D-856)" });
        }
      }
      continue;
    }
    danceEvents++;

    const cancelled = isCancelled(event);

    // Venue
    const addresses = arr<Json>(event.addresses);
    const venue = venueFromAddresses(addresses);

    // Links
    const values = arr<Json>(event.values);
    const venueUrl = firstUrl(values);
    const slug = slugify(cleanedTitle);
    const eventUrl = `https://guia.barcelona.cat/ca/detall/${slug}_${registerId}.html`;

    // Description
    const body = str(event.body);
    const description = body ? plainText(body) : null;

    // Styles
    const { styles } = matchStyles(cleanedTitle);

    // Process each occurrence
    for (const occ of occurrences) {
      if (!occ.date) continue;
      const night = occ.time
        ? Number(occ.time.slice(0, 2)) < NIGHT_BOUNDARY_HOUR
          ? addCalendarDays(occ.date, -1)
          : occ.date
        : occ.date;

      if (!options.nights.includes(night)) continue;

      const externalId = `${registerId}:${occ.date}`;
      if (seen.has(externalId)) continue;
      seen.add(externalId);

      const start = localMoment(occ.date, occ.time, options.metro.tz);
      const end = occ.endTime ? localMoment(occ.date, occ.endTime, options.metro.tz) : null;

      // Ensure end is on same night
      let finalEnd: LocalMoment | null = null;
      if (end && end.night === start.night) {
        finalEnd = end;
      }

      listings.push(
        buildListing(
          {
            externalId,
            title: listingTitle,
            start,
            end: finalEnd,
            description,
            venue: {
              name: venue.name,
              address: venue.address,
              url: venueUrl,
              location: venue.location,
            },
            organizer: { name: null, url: null },
            prices: null,
            ticketUrl: null,
            eventUrl,
            cancelled,
            styles,
          },
          {
            sourceUrl: BCN_AGENDA_URL,
            fetchedAt: options.fetchedAt,
            method: "api",
            currency: "EUR",
          },
        ),
      );
    }
  }

  notes.push(
    `bcn_agenda: ${totalEvents} events, ${danceEvents} dance, ${listings.length} listings for the nights`,
  );
  return { listings, notes, screened };
}

export const bcnAgendaAdapter: SourceAdapter = {
  id: "bcn_agenda" as SourceAdapter["id"],
  tier: "A",
  countries: ["ES"],
  limits: { perDomainIntervalMs: 5000, rps: 1, perDay: 10 },
  async harvestMetro(metro: Metro, nights: NightDate[], ctx: RunCtx): Promise<HarvestResult> {
    if (metro.slug !== "barcelona") {
      return {
        listings: [],
        notes: [],
        screened: [],
      };
    }

    // Request 1: cultural events
    const culturalUrl = culturalSqlUrl(nights);
    let response1;
    try {
      response1 = await ctx.http.request({
        url: culturalUrl,
        purpose: "api",
        intervalMs: 5000,
        maxBytes: 100 * 1024 * 1024,
        headers: { accept: "application/json" },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`bcn_agenda: download failed (${message})`);
    }

    if (response1.status < 200 || response1.status >= 300) {
      throw new Error(`bcn_agenda: download failed (HTTP ${response1.status})`);
    }

    let body1: unknown;
    try {
      body1 = JSON.parse(response1.body);
    } catch {
      throw new Error("bcn_agenda: unexpected body");
    }

    if (!isObject(body1) || body1.success !== true) {
      throw new Error("bcn_agenda: unexpected body");
    }

    const result = body1.result;
    if (!isObject(result) || !Array.isArray(result.records)) {
      throw new Error("bcn_agenda: unexpected body");
    }

    const records: Array<Record<string, unknown>> = result.records;
    const notes: string[] = [];
    if (records.length >= 32000) {
      notes.push("bcn_agenda: datastore row cap reached");
    }

    // Filter dance events
    const danceRows: Array<Record<string, unknown>> = [];
    const danceIds: string[] = [];
    for (const row of records) {
      const name = typeof row.name === "string" ? row.name.trim() : null;
      if (!name) continue;
      if (!isBcnDanceTitle(name)) continue;
      const id = cleanRegisterId(row.register_id);
      if (!id) continue;
      danceRows.push(row);
      danceIds.push(id);
    }

    // Request 2: places (optional)
    const placesMap = new Map<string, { place: string | null; url: string | null }>();
    if (danceIds.length > 0) {
      const placesUrl = placesSqlUrl(danceIds);
      if (placesUrl) {
        try {
          const response2 = await ctx.http.request({
            url: placesUrl,
            purpose: "api",
            intervalMs: 5000,
            maxBytes: 100 * 1024 * 1024,
            headers: { accept: "application/json" },
          });

          if (response2.status < 200 || response2.status >= 300) {
            throw new Error(`HTTP ${response2.status}`);
          }
          const body2: unknown = JSON.parse(response2.body);
          const result2 = isObject(body2) && body2.success === true ? body2.result : null;
          if (!isObject(result2) || !Array.isArray(result2.records)) {
            throw new Error("unexpected body");
          }
          for (const rec of result2.records as unknown[]) {
            if (!isObject(rec)) continue;
            const id = cleanRegisterId(rec.id);
            if (!id) continue;
            const place = str(rec.addresses_place);
            const urlValue = str(rec.values_value);
            const url = urlValue && /^https?:\/\//i.test(urlValue) ? urlValue : null;
            const seen = placesMap.get(id) ?? { place: null, url: null };
            placesMap.set(id, { place: seen.place ?? place, url: seen.url ?? url });
          }
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          notes.push(`bcn_agenda: places lookup failed (${reason})`);
        }
      }
    }

    // Convert rows to events
    const events: unknown[] = [];
    for (const row of danceRows) {
      const id = cleanRegisterId(row.register_id);
      if (!id) continue;
      const extra = placesMap.get(id);
      const event = datastoreRowToEvent(row, extra, nights, metro);
      if (event) events.push(event);
    }

    const {
      listings,
      notes: listingNotes,
      screened,
    } = bcnAgendaToListings(events, {
      metro,
      nights,
      fetchedAt: response1.fetchedAt,
    });

    notes.push(...listingNotes);

    // One query returns every row of the window, so a read under the row cap is the agenda's whole
    // word: a stored row it no longer lists (dropped, or now filtered out before the D-856 screen,
    // as MNAC's exhibition was) is retired on the later nights (D-882). An empty read is not.
    const whole = records.length > 0 && records.length < 32000 && listings.length > 0;

    return {
      listings,
      notes,
      screened,
      ...(whole ? { whole: true as const } : {}),
      doc: {
        url: BCN_AGENDA_URL,
        fetchedAt: response1.fetchedAt,
        httpStatus: response1.status,
        etag: null,
        lastModified: null,
        contentHash: sha256(JSON.stringify(listings.map((l) => [l.externalId, l.listing]))),
        cleanedText: null,
      },
    };
  },
};
