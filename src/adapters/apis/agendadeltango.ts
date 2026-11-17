// Agenda del Tango's own list-page data file (robots.txt allows /; checked 2026-10-29).
// The adapter reads the JSON dataset once per run and returns milongas and prácticas as listings.
// Runs only in the Barcelona metro.

import type { StyleKey } from "@/config/styles";
import { decodeEntities, sha256, type LocalMoment } from "@/src/adapters/shared";
import { buildListing } from "@/src/adapters/structured";
import type {
  HarvestedListing,
  HarvestResult,
  Metro,
  NightDate,
  RunCtx,
  SourceAdapter,
} from "@/src/adapters/types";
import { addCalendarDays } from "@/src/domain/time";
import { NIGHT_BOUNDARY_HOUR } from "@/src/domain/tonight";

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

export const AGENDA_DEL_TANGO_URL = "https://agendadeltango.com/barcelona/bcn-data.json";

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

function extractFromHtml(html: string): {
  kind: "milonga" | "practica" | null;
  startTime: string | null;
  endTime: string | null;
  placeText: string | null;
  organizer: string | null;
} {
  const decoded = decodeEntities(html);

  let kind: "milonga" | "practica" | null = null;
  const kindMatch = decoded.match(/class="type-badge\s+([^"\s]+)/);
  if (kindMatch) {
    const badge = (kindMatch[1] ?? "").toLowerCase();
    if (badge === "milonga") kind = "milonga";
    else if (badge === "practica") kind = "practica";
  }

  let startTime: string | null = null;
  let endTime: string | null = null;
  const hoursMatch = decoded.match(/class="hours">([^<]+)</);
  if (hoursMatch) {
    const hours = (hoursMatch[1] ?? "").trim();
    const parts = hours.split(/[–—]/);
    if (parts.length >= 1) {
      startTime = (parts[0] ?? "").trim();
      if (parts.length >= 2) {
        endTime = (parts[1] ?? "").trim();
      }
    }
  }

  let placeText: string | null = null;
  const placeMatch = decoded.match(/<a[^>]*class="maps"[^>]*>([^<]+)<\/a>/);
  if (placeMatch) {
    placeText = (placeMatch[1] ?? "").trim();
  }

  let organizer: string | null = null;
  const orgMatch = decoded.match(/Organiza:\s*<b>([^<]+)<\/b>/);
  if (orgMatch) {
    organizer = (orgMatch[1] ?? "").trim();
  }

  return { kind, startTime, endTime, placeText, organizer };
}

export function parsePlace(placeText: string | null): {
  name: string | null;
  street: string | null;
  town: string | null;
} {
  if (!placeText) return { name: null, street: null, town: null };

  const text = placeText.trim();

  // Extract town in parentheses
  const townMatch = text.match(/\(([^)]+)\)$/);
  let town: string | null = null;
  let rest = text;
  if (townMatch) {
    town = (townMatch[1] ?? "").trim();
    rest = text.slice(0, townMatch.index).trim();
  }

  // If no town in parentheses, try to extract metro town from the text
  if (!town) {
    const extracted = extractTownFromText(rest);
    if (extracted) {
      town = extracted;
      // Remove the town from the rest
      const townPattern = new RegExp(
        `\\s*${town.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`,
        "i",
      );
      rest = rest.replace(townPattern, "").trim();
    }
  }

  // Split by first comma
  const commaIndex = rest.indexOf(",");
  let name: string | null;
  let street: string | null;

  if (commaIndex !== -1) {
    name = rest.slice(0, commaIndex).trim();
    street = rest.slice(commaIndex + 1).trim();
    // Remove trailing comma if present
    street = street.replace(/,$/, "").trim();
  } else {
    name = rest;
    street = null;
  }

  // A place written as a street address only, "C/ Pallars, 74 Barcelona": no venue name (D-269).
  if (name && street) {
    const streetPrefixRegex =
      /^(c\/|c\.\s|calle\s|carrer\s|cl\.?\s|av\.?\s|avda\.?\s|avinguda\s|avenida\s|passeig\s|pg\.?\s|paseo\s|pl\.?\s|plaça\s|plaza\s|rambla\s|ronda\s|travessera\s|via\s|camí\s|camino\s)/i;
    const houseNumberRegex = /^\d+[a-zA-Z]?(\s*[-–]\s*\d+[a-zA-Z]?)?$/;
    if (streetPrefixRegex.test(name) && houseNumberRegex.test(street)) {
      street = `${name}, ${street}`;
      name = null;
    }
  }

  return { name, street, town };
}

const METRO_TOWNS_CANONICAL = [
  "Barcelona",
  "L'Hospitalet de Llobregat",
  "Hospitalet",
  "L'Hospitalet",
  "Badalona",
  "Sant Adrià de Besòs",
  "Santa Coloma de Gramenet",
] as const;

const METRO_TOWNS_NORMALIZED = new Map<string, string>();
for (const town of METRO_TOWNS_CANONICAL) {
  const normalized = town
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/^l'/, "")
    .trim();
  METRO_TOWNS_NORMALIZED.set(normalized, town);
}

function normalizeTown(town: string): string {
  return town
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/^l'/, "")
    .trim();
}

function isMetroTown(town: string | null): boolean {
  if (!town) return false;
  const normalized = normalizeTown(town);
  return METRO_TOWNS_NORMALIZED.has(normalized);
}

export function extractTownFromText(text: string): string | null {
  const normalizedText = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/^l'/, "");

  // Look for a metro town as a whole word at the end of the text
  // Pattern: optional whitespace, then town name, then end of string
  for (const [normalizedTown, canonicalTown] of METRO_TOWNS_NORMALIZED) {
    const pattern = new RegExp(`(?:^|[\\s,])(?:l')?${normalizedTown}\\s*$`);
    if (pattern.test(normalizedText)) {
      return canonicalTown;
    }
  }
  return null;
}

function absoluteUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url, "https://agendadeltango.com/barcelona/").href;
  } catch {
    return null;
  }
}

export function detailFromHtml(html: string): { locality: string | null; street: string | null } {
  const scriptMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  if (!scriptMatch) return { locality: null, street: null };

  try {
    const json = JSON.parse(scriptMatch[1] ?? "");
    if (json["@type"] === "Event" && json.location && json.location.address) {
      const addr = json.location.address;
      return {
        locality: typeof addr.addressLocality === "string" ? addr.addressLocality : null,
        street: typeof addr.streetAddress === "string" ? addr.streetAddress : null,
      };
    }
  } catch {
    // ignore
  }
  return { locality: null, street: null };
}

function eventsOf(data: unknown): Array<{
  key: string;
  titulo: string;
  fecha_iso: string;
  html: string;
  hora_inicio: string;
  url: string | null;
}> {
  if (!isObject(data) || !Array.isArray(data.dias)) return [];

  const events: Array<{
    key: string;
    titulo: string;
    fecha_iso: string;
    html: string;
    hora_inicio: string;
    url: string | null;
  }> = [];
  const seenKeys = new Set<string>();

  for (const dia of arr<Json>(data.dias)) {
    const fechaIso = str(dia.fecha_iso);
    const eventos = arr<Json>(dia.eventos);

    for (const evento of eventos) {
      const key = str(evento.key);
      const titulo = str(evento.titulo);
      const html = str(evento.html);
      const horaInicio = str(evento.hora_inicio);
      const url = str(evento.url);

      if (key && titulo && html && horaInicio !== null && !seenKeys.has(key)) {
        seenKeys.add(key);
        events.push({
          key,
          titulo,
          fecha_iso: fechaIso || key.slice(0, 10),
          html,
          hora_inicio: horaInicio,
          url,
        });
      }
    }

    const diasSemana = arr<Json>(dia.dias_semana);
    for (const semanaDia of diasSemana) {
      const semanaFecha = str(semanaDia.fecha_iso);
      const semanaEventos = arr<Json>(semanaDia.eventos);

      for (const evento of semanaEventos) {
        const key = str(evento.key);
        const titulo = str(evento.titulo);
        const html = str(evento.html);
        const horaInicio = str(evento.hora_inicio);
        const url = str(evento.url);

        if (key && titulo && html && horaInicio !== null && !seenKeys.has(key)) {
          seenKeys.add(key);
          events.push({
            key,
            titulo,
            fecha_iso: semanaFecha || key.slice(0, 10),
            html,
            hora_inicio: horaInicio,
            url,
          });
        }
      }
    }
  }

  return events;
}

export function rowsNeedingDetail(
  data: unknown,
  options: { metro: Metro; nights: NightDate[] },
): Array<{ key: string; url: string; title: string }> {
  const events = eventsOf(data);
  const rows: Array<{ key: string; url: string; title: string }> = [];

  for (const ev of events) {
    const date = ev.fecha_iso;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;

    const { kind } = extractFromHtml(ev.html);
    if (!kind) continue;

    const startTime = extractFromHtml(ev.html).startTime || ev.hora_inicio;
    if (!startTime) continue;

    const start = localMoment(date, startTime, options.metro.tz);
    if (!options.nights.includes(start.night)) continue;

    const { placeText } = extractFromHtml(ev.html);
    const { town: parsedTown } = parsePlace(placeText);
    let town = parsedTown;

    if (!town && placeText) {
      town = extractTownFromText(placeText);
    }

    // Only request detail page if there's NO town at all (not just out-of-metro)
    if (!town && ev.url) {
      const absUrl = absoluteUrl(ev.url);
      if (absUrl) {
        rows.push({ key: ev.key, url: absUrl, title: ev.titulo });
      }
    }
  }

  return rows;
}

export function agendaToListings(
  data: unknown,
  options: {
    metro: Metro;
    nights: NightDate[];
    fetchedAt: Date;
    detailLookup?: Map<string, { locality: string | null; street: string | null }>;
    detailFetchCount?: number;
  },
): {
  listings: HarvestedListing[];
  notes: string[];
} {
  const listings: HarvestedListing[] = [];
  const notes: string[] = [];

  if (!isObject(data) || !Array.isArray(data.dias)) {
    throw new Error('agendadeltango: data file no longer has "dias"');
  }

  const events = eventsOf(data);
  let totalEvents = 0;
  let danceEvents = 0;

  for (const ev of events) {
    totalEvents++;

    const { kind, startTime, endTime, placeText, organizer } = extractFromHtml(ev.html);

    let isDanceEvent = false;
    let type: "social" | "practica" | null = null;
    let styles: StyleKey[] = [];

    if (kind === "milonga") {
      const lowerTitle = ev.titulo.toLowerCase();
      if (lowerTitle.startsWith("práctica") || lowerTitle.startsWith("practica")) {
        type = "practica";
        styles = ["practica"];
      } else {
        type = "social";
        styles = ["milonga"];
      }
      isDanceEvent = true;
    } else if (kind === "practica") {
      type = "practica";
      styles = ["practica"];
      isDanceEvent = true;
    }

    if (!isDanceEvent) continue;
    danceEvents++;

    const date = ev.fecha_iso;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;

    const finalStartTime = startTime || ev.hora_inicio;
    if (!finalStartTime) continue;

    const start = localMoment(date, finalStartTime, options.metro.tz);
    if (!options.nights.includes(start.night)) continue;

    let finalEnd: LocalMoment | null = null;
    if (endTime) {
      const endHour = Number(endTime.slice(0, 2));
      const startHour = Number(finalStartTime.slice(0, 2));
      const endDay = endHour < startHour && endHour < 12 ? addCalendarDays(date, 1) : date;
      const end = localMoment(endDay, endTime, options.metro.tz);
      if (end.night === start.night) {
        finalEnd = end;
      }
    }

    const { name: venueName, street, town: parsedTown } = parsePlace(placeText);
    let town: string | null = parsedTown;
    let finalStreet = street;

    if (!town && placeText) {
      town = extractTownFromText(placeText);
    }

    // Only use detail lookup if there's NO town at all (not just out-of-metro)
    if (!town && ev.url && options.detailLookup) {
      const absUrl = absoluteUrl(ev.url);
      if (absUrl) {
        const detail = options.detailLookup.get(absUrl);
        if (detail) {
          town = detail.locality;
          if (!finalStreet && detail.street) {
            finalStreet = detail.street;
          }
        }
      }
    }

    if (!isMetroTown(town)) continue;

    let address: string | null = null;
    if (finalStreet && town) {
      address = `${finalStreet}, ${town}`;
    }

    let listingUrl: string;
    if (ev.url) {
      const absUrl = absoluteUrl(ev.url);
      listingUrl = absUrl || "https://agendadeltango.com/barcelona/";
    } else {
      listingUrl = "https://agendadeltango.com/barcelona/";
    }

    listings.push(
      buildListing(
        {
          externalId: `agendadeltango:${ev.key}`,
          title: ev.titulo,
          start,
          end: finalEnd,
          description: null,
          venue: {
            name: venueName,
            address,
            url: null,
            location: null,
          },
          organizer: { name: organizer, url: null },
          prices: null,
          ticketUrl: null,
          eventUrl: listingUrl,
          cancelled: false,
          styles,
          type,
        },
        {
          sourceUrl: AGENDA_DEL_TANGO_URL,
          fetchedAt: options.fetchedAt,
          method: "api",
          currency: "EUR",
        },
      ),
    );
  }

  const detailPages = options.detailFetchCount ?? 0;
  notes.push(
    `agendadeltango: ${totalEvents} events, ${danceEvents} dance, ${listings.length} listings for the nights, ${detailPages} detail pages`,
  );

  return { listings, notes };
}

export const agendaDelTangoAdapter: SourceAdapter = {
  id: "agendadeltango" as SourceAdapter["id"],
  tier: "A",
  countries: ["ES"],
  limits: { perDomainIntervalMs: 5000, rps: 1, perDay: 60 },
  async harvestMetro(metro: Metro, nights: NightDate[], ctx: RunCtx): Promise<HarvestResult> {
    if (metro.slug !== "barcelona") {
      return {
        listings: [],
        notes: [],
        screened: [],
      };
    }

    let response;
    try {
      response = await ctx.http.request({
        url: AGENDA_DEL_TANGO_URL,
        purpose: "api",
        intervalMs: 5000,
        maxBytes: 10 * 1024 * 1024,
        headers: { accept: "application/json" },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`agendadeltango: download failed (${message})`);
    }

    if (response.status < 200 || response.status >= 300) {
      throw new Error(`agendadeltango: download failed (HTTP ${response.status})`);
    }

    let body: unknown;
    try {
      body = JSON.parse(response.body);
    } catch {
      throw new Error("agendadeltango: unexpected body");
    }

    const detailLookup = new Map<string, { locality: string | null; street: string | null }>();
    const detailNotes: string[] = [];
    const rows = rowsNeedingDetail(body, { metro, nights });
    const cap = 20;
    const toFetch = rows.slice(0, cap);
    const skipped = rows.slice(cap);

    for (const row of toFetch) {
      try {
        const detailResp = await ctx.http.request({
          url: row.url,
          purpose: "crawl",
          intervalMs: 5000,
          headers: { accept: "text/html" },
        });
        if (detailResp.status >= 200 && detailResp.status < 300) {
          const detail = detailFromHtml(detailResp.body);
          if (detail.locality || detail.street) {
            detailLookup.set(row.url, detail);
          }
        } else {
          detailNotes.push(
            `agendadeltango: detail page failed ${row.url} (HTTP ${detailResp.status})`,
          );
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        detailNotes.push(`agendadeltango: detail page failed ${row.url} (${message})`);
      }
    }

    if (skipped.length > 0) {
      detailNotes.push(`agendadeltango: detail cap ${cap} reached, ${skipped.length} rows skipped`);
    }

    const { listings, notes } = agendaToListings(body, {
      metro,
      nights,
      fetchedAt: response.fetchedAt,
      detailLookup,
      detailFetchCount: toFetch.length,
    });

    return {
      listings,
      notes: [...notes, ...detailNotes],
      screened: [],
      doc: {
        url: AGENDA_DEL_TANGO_URL,
        fetchedAt: response.fetchedAt,
        httpStatus: response.status,
        etag: null,
        lastModified: null,
        contentHash: sha256(JSON.stringify(listings.map((l) => [l.externalId, l.listing]))),
        cleanedText: null,
      },
    };
  },
};
