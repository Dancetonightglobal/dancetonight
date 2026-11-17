// Circuito Peñero (circuitopeñero.com), Argentina's peña (folk dance night) calendar, read from its public
// Next.js page https://circuitopeñero.com/eventos (owner, 2026-11-01, D-551). The page's data is inside
// <script>self.__next_f.push([1,"..."])</script> chunks; we join and parse them to extract event records.
// Only records with rubro "ambos" (music and dance) are kept, and only those inside the metro by coordinates.
// The page is read once per run; no other pages are fetched.

import { buildListing } from "@/src/adapters/structured";
import type {
  HarvestedListing,
  HarvestResult,
  RunCtx,
  Source,
  SourceAdapter,
} from "@/src/adapters/types";
import { insideMetro } from "@/src/domain/metro-bounds";
import { currentNightDate } from "@/src/domain/tonight";
import { CRAWL_INTERVAL_MS } from "@/src/pipeline/http";
import { currencyForCountry } from "@/src/domain/prices";
import { addCalendarDays } from "@/src/domain/time";
import { sha256 } from "@/src/adapters/shared";
import type { StyleKey } from "@/config/styles";
import { MATERIALIZE_DAYS } from "@/src/domain/recurrence";

export interface CircuitoEvent {
  id: number;
  title: string;
  day: string; // YYYY-MM-DD
  endDay: string | null;
  time: string | null; // HH:MM or null
  address: string | null;
  rubro: string | null;
  venueName: string | null;
  city: string | null;
  lat: number | null;
  lng: number | null;
}

/**
 * Decode the Next.js flight chunks.
 */
export function nextFlightText(html: string): string {
  const chunks: string[] = [];
  // Each self.__next_f.push([1,"<inner>"]) carries a JavaScript string literal: decode it as a JSON string.
  const regex = /self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g;
  for (const match of html.matchAll(regex)) {
    try {
      chunks.push(JSON.parse(`"${match[1] ?? ""}"`) as string);
    } catch {
      // skip a chunk that fails to decode
    }
  }
  return chunks.length > 0 ? chunks.join("") : html;
}

/**
 * Extract event records from the Next.js page HTML.
 */
export function circuitoPeneroEvents(html: string): CircuitoEvent[] {
  const text = nextFlightText(html);
  const records: CircuitoEvent[] = [];
  const seenIds = new Set<number>();

  // Find each record object by brace matching
  const pattern = /\{"id"\s*:\s*\d+\s*,\s*"titulo"\s*:/g;
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
      pos = start + 1;
      continue;
    }
    const slice = text.slice(start, end);
    try {
      const obj = JSON.parse(slice);
      if (
        typeof obj.id === "number" &&
        typeof obj.titulo === "string" &&
        typeof obj.fecha === "string"
      ) {
        if (seenIds.has(obj.id)) {
          pattern.lastIndex = end;
          continue;
        }
        seenIds.add(obj.id);

        const title = obj.titulo.trim().replace(/\s+/g, " ");
        const day = obj.fecha.trim();
        const endDay = obj.fecha_fin ? obj.fecha_fin.trim() : null;
        let time: string | null = null;
        if (typeof obj.hora === "string") {
          const hm = obj.hora.trim();
          if (/^\d{2}:\d{2}$/.test(hm)) {
            time = hm;
          }
        }
        const addressRaw = obj.direccion || (obj.pena && obj.pena.direccion) || null;
        const address = addressRaw ? addressRaw.trim().replace(/\s+/g, " ") : null;
        const rubro = typeof obj.rubro === "string" ? obj.rubro.trim() : null;
        const venueNameRaw =
          (obj.pena && obj.pena.nombre) || (obj.festival && obj.festival.nombre) || null;
        const venueName = venueNameRaw ? venueNameRaw.trim().replace(/\s+/g, " ") : null;
        const city = (obj.pena && obj.pena.ciudad) || null;
        let lat: number | null = null;
        let lng: number | null = null;
        if (obj.pena && typeof obj.pena.lat === "number" && typeof obj.pena.lng === "number") {
          lat = obj.pena.lat;
          lng = obj.pena.lng;
        } else if (
          obj.festival &&
          typeof obj.festival.lat === "number" &&
          typeof obj.festival.lng === "number"
        ) {
          lat = obj.festival.lat;
          lng = obj.festival.lng;
        }

        records.push({
          id: obj.id,
          title,
          day,
          endDay,
          time,
          address,
          rubro,
          venueName,
          city,
          lat,
          lng,
        });
      }
    } catch {
      // skip invalid JSON
    }
    pattern.lastIndex = end;
    pos = end;
  }

  return records;
}

/**
 * Keep only events where rubro === "ambos" (music and dance).
 */
export function keepForDancing(e: CircuitoEvent): boolean {
  return e.rubro === "ambos";
}

export const circuitoPeneroAdapter: SourceAdapter = {
  id: "circuitopenero",
  tier: "A",
  countries: ["AR"],
  limits: { perDomainIntervalMs: CRAWL_INTERVAL_MS },
  async harvest(source: Source, ctx: RunCtx): Promise<HarvestResult> {
    const url = source.feedUrl ?? source.url;
    const page = await ctx.http.request({
      url,
      purpose: "crawl",
      headers: { accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1" },
    });

    const records = circuitoPeneroEvents(page.body);
    if (records.length === 0) {
      throw new Error("circuitopeñero.com/eventos shows no event records");
    }

    const fromNight = currentNightDate(ctx.now(), ctx.metro.tz);
    const lastNight = addCalendarDays(fromNight, MATERIALIZE_DAYS - 1);
    const currency = currencyForCountry(ctx.metro.countryCode);

    const notes: string[] = [];
    const listings: HarvestedListing[] = [];

    let inWindow = 0;
    let concerts = 0;
    let outside = 0;
    let noPoint = 0;
    let listed = 0;
    let collapsed = 0;
    // One peña night posted twice (same peña point, day and time) becomes one listing: the title that does not
    // open with a date ("14 de Noviembre Próxima Peña...") wins, then the lowest id.
    const opensWithDate = (title: string) => /^\d/.test(title.trim());
    const ordered = [...records].sort(
      (a, b) => Number(opensWithDate(a.title)) - Number(opensWithDate(b.title)) || a.id - b.id,
    );
    const seenNights = new Set<string>();

    for (const rec of ordered) {
      // Window filter
      const startDay = rec.day;
      const endDay = rec.endDay ?? rec.day;
      if (startDay > lastNight || endDay < fromNight) {
        continue;
      }
      inWindow++;

      // Rubro filter
      if (!keepForDancing(rec)) {
        concerts++;
        continue;
      }

      // Coordinates filter
      if (rec.lat === null || rec.lng === null) {
        noPoint++;
        continue;
      }
      if (!insideMetro(ctx.metro, { lat: rec.lat, lng: rec.lng })) {
        outside++;
        continue;
      }
      const nightKey = `${rec.lat},${rec.lng}|${rec.day}|${rec.time ?? ""}`;
      if (seenNights.has(nightKey)) {
        collapsed++;
        continue;
      }
      seenNights.add(nightKey);

      // Determine night for listing: if startDay is before fromNight, use fromNight for both day and night
      const night = startDay < fromNight ? fromNight : startDay;
      const day = startDay < fromNight ? fromNight : startDay;

      const address = rec.address ? rec.address + (rec.city ? ", " + rec.city : "") : null;

      const built = buildListing(
        {
          externalId: `circuitopenero:${rec.id}`,
          title: rec.title,
          start: {
            day,
            night,
            time: rec.time,
            zone: ctx.metro.tz,
            absolute: false,
          },
          end: null,
          description: null,
          venue: {
            name: rec.venueName,
            address,
            url: null,
            location: { lat: rec.lat, lng: rec.lng },
          },
          organizer: { name: null, url: null },
          prices: null,
          ticketUrl: null,
          eventUrl: new URL(`https://circuitopeñero.com/eventos/${rec.id}`).href,
          cancelled: false,
          styles: source.styles as StyleKey[],
          type: "social",
          evidence: {
            start: `fecha ${startDay} hora ${rec.time ?? "none"}, Circuito Peñero`,
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
      `${records.length} events on the page; ${inWindow} in the window; ${concerts} concert-only (rubro musica) left out; ${outside} outside the metro; ${noPoint} without coordinates; ${collapsed} posted twice, merged; ${listed} listed`,
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
