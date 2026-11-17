// BAMilonga: the City of Buenos Aires' register of milongas, read from its Mapa Milonguero 2026 PDF (owner's Q1 = A, D-402).
// The 2026 map has 93 rows (70 weekly); this adapter reads them as weekly rules at their venues,
// leaving out monthly and fortnightly ones (the register does not state which week). The PDF is fetched each read
// only to detect a new map; the listings always come from the checked-in register.
// The USIG EPOK map service is not read (its WAF drops non-browser clients and its robots.txt redirects; D-403).
import { buildListing } from "@/src/adapters/structured";
import type {
  HarvestedListing,
  HarvestedRecurrence,
  HarvestResult,
  RunCtx,
  Source,
  SourceAdapter,
} from "@/src/adapters/types";
import { currencyForCountry } from "@/src/domain/prices";
import { addCalendarDays } from "@/src/domain/time";
import { currentNightDate } from "@/src/domain/tonight";
import { CRAWL_INTERVAL_MS } from "@/src/pipeline/http";
import type { StyleKey } from "@/config/styles";
import { sha256 } from "@/src/adapters/shared";
import {
  MAPA_MILONGUERO_URL,
  MAPA_MILONGUERO_ETAG,
  MAPA_MILONGUERO_LAST_MODIFIED,
  MAPA_MILONGUERO_BODY_SHA256,
  MAPA_MILONGUERO_LAST_NIGHT,
  MAPA_MILONGUERO_2026,
  type MapaMilongueroRow,
} from "@/src/adapters/apis/bamilonga-register";

export { MAPA_MILONGUERO_URL } from "@/src/adapters/apis/bamilonga-register";

/**
 * Milongas read from their own site's weekly grid instead (config/sources/buenos-aires.ts, D-402): the venue's own
 * word wins (on 2026-10-29 the city listed La Viruta's Saturday, its own site says Friday), and the night is not
 * listed twice. Venues by `lugar`, milongas by `nombre`, both normalised as `normaliseName` does.
 */
export const OWN_SITE_VENUES: readonly string[] = ["la viruta", "club gricel"];
export const OWN_SITE_MILONGAS: readonly string[] = ["milonga cachirulo"];

const normaliseName = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** True when the milonga is read from its own site instead. */
export function readFromOwnSite(nombre: string, lugar: string): boolean {
  return (
    OWN_SITE_VENUES.includes(normaliseName(lugar)) ||
    OWN_SITE_MILONGAS.includes(normaliseName(nombre))
  );
}

/** Title-case a string that appears to be all-caps. */
function titleCaseIfAllCaps(s: string | null): string | null {
  if (!s) return null;
  // If it contains any lowercase letter, leave as is
  if (/[a-z]/.test(s)) return s;
  // Otherwise title-case each word
  return s
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

/** First date on or after `fromNight` whose weekday is in `days`. */
function firstOnOrAfter(fromNight: string, days: string[]): string {
  const order = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
  const dayIndex = (date: string) => new Date(date + "T00:00:00Z").getUTCDay(); // 0=Sun
  for (let i = 0; i < 7; i++) {
    const current = addCalendarDays(fromNight, i);
    const weekday = order[dayIndex(current)];
    if (weekday && days.includes(weekday)) {
      return current;
    }
  }
  // fallback (should not happen)
  return fromNight;
}

/** Map Spanish weekday to RRULE day code (MO..SU). Returns null if not a weekday. */
export function diaCode(dia: string | null): string | null {
  if (!dia) return null;
  const normalised = dia
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
  const map: Record<string, string> = {
    lunes: "MO",
    martes: "TU",
    miercoles: "WE",
    miércoles: "WE",
    jueves: "TH",
    viernes: "FR",
    sabado: "SA",
    sábado: "SA",
    domingo: "SU",
  };
  return map[normalised] ?? null;
}

/** Extract leading HH:MM or H:MM from hora text. Returns null if invalid. */
export function horaInicio(hora: string): string | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(hora.trim());
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export const bamilongaAdapter: SourceAdapter = {
  id: "bamilonga",
  tier: "A",
  countries: ["AR"],
  limits: { perDomainIntervalMs: CRAWL_INTERVAL_MS },
  async harvest(source: Source, ctx: RunCtx): Promise<HarvestResult> {
    const url = source.feedUrl ?? MAPA_MILONGUERO_URL;
    const notes: string[] = [];
    const listings: HarvestedListing[] = [];
    const fromNight = currentNightDate(ctx.now(), ctx.metro.tz);
    const currency = currencyForCountry(ctx.metro.countryCode);

    // 1. Change check
    let pdfFetchedAt: Date = ctx.now();
    let pdfStatus = 0;
    let pdfEtag: string | null = null;
    let pdfLastModified: string | null = null;
    try {
      const resp = await ctx.http.request({
        url,
        purpose: "crawl",
        conditional: { etag: MAPA_MILONGUERO_ETAG, lastModified: MAPA_MILONGUERO_LAST_MODIFIED },
      });
      pdfFetchedAt = resp.fetchedAt;
      pdfStatus = resp.status;
      pdfEtag = resp.etag;
      pdfLastModified = resp.lastModified;
      const unchanged =
        resp.notModified ||
        resp.etag === MAPA_MILONGUERO_ETAG ||
        sha256(resp.body) === MAPA_MILONGUERO_BODY_SHA256;
      if (!unchanged) {
        notes.push(
          `the city's Mapa Milonguero PDF has changed since it was transcribed (etag ${resp.etag ?? "none"}); refresh src/adapters/apis/bamilonga-register.ts`,
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      notes.push(
        `the Mapa Milonguero PDF could not be fetched (${message}); listed from the 2026 register as transcribed`,
      );
    }

    // 2. Year check
    if (fromNight > MAPA_MILONGUERO_LAST_NIGHT) {
      notes.unshift(
        `the 2026 Mapa Milonguero is out of date after ${MAPA_MILONGUERO_LAST_NIGHT}; transcribe the new map`,
      );
      return { listings, notes };
    }

    // 3. Process rows
    const total = MAPA_MILONGUERO_2026.length;
    let weekly = 0;
    let listed = 0;
    let monthly = 0;
    let fortnightly = 0;
    let ownSite = 0;
    let unclear = 0;
    const notUnderstood: string[] = [];

    for (const row of MAPA_MILONGUERO_2026) {
      if (row.periodicidad === "MENSUAL") {
        monthly++;
        continue;
      }
      if (row.periodicidad === "QUINCENAL") {
        fortnightly++;
        continue;
      }
      // SEMANAL
      weekly++;

      if (readFromOwnSite(row.nombre, row.lugar)) {
        ownSite++;
        continue;
      }

      const dayCode = diaCode(row.dia);
      const time = horaInicio(row.hora);
      if (!dayCode || !time) {
        unclear++;
        notUnderstood.push(`${row.nombre} (${row.dia} ${row.hora})`);
        continue;
      }

      const title = titleCaseIfAllCaps(row.nombre) || row.nombre;
      const venueName = titleCaseIfAllCaps(row.lugar) || row.lugar;
      const direccionTitle = titleCaseIfAllCaps(row.direccion) || row.direccion;
      const barrioTitle = titleCaseIfAllCaps(row.barrio) || row.barrio;
      const addressParts = [direccionTitle, barrioTitle, "CABA"].filter(Boolean);
      const address = addressParts.join(", ");

      const firstDate = firstOnOrAfter(fromNight, [dayCode]);
      const recurrence: HarvestedRecurrence = {
        rrule: `FREQ=WEEKLY;BYDAY=${dayCode}`,
        dtstartLocal: `${firstDate}T${time}`,
        exdates: [],
        timeListed: true,
      };

      const slug = (s: string) => normaliseName(s).replace(/\s+/g, "-");
      const externalId = `bamilonga:${slug(row.nombre)}:${slug(row.lugar)}:${dayCode}:${time.replace(":", "")}`;

      const built = buildListing(
        {
          externalId,
          title,
          start: { day: firstDate, night: firstDate, time, zone: ctx.metro.tz, absolute: false },
          end: null,
          description: null,
          venue: {
            name: venueName,
            address,
            url: null,
            location: null,
          },
          organizer: { name: null, url: null },
          prices: null,
          ticketUrl: null,
          eventUrl: null,
          cancelled: false,
          styles: source.styles as StyleKey[],
          type: "social",
          evidence: {
            start: `${row.dia} ${row.hora}, ${row.periodicidad}, Mapa Milonguero 2026`,
            dancing_time: `hora ${row.hora}`,
          },
          recurrence,
        },
        {
          sourceUrl: MAPA_MILONGUERO_URL,
          fetchedAt: pdfFetchedAt,
          method: "feed",
          currency,
        },
      );
      // Set dancing_time to the start time, doors_time to null (as newyorktango does)
      const dancing = time;
      const updatedListing = {
        ...built,
        listing: {
          ...built.listing,
          doors_time: null,
          dancing_time: dancing,
          evidence: {
            ...built.listing.evidence,
            dancing_time: `hora ${row.hora}`,
          },
        },
      };
      listings.push(updatedListing);
      listed++;
    }

    // 4. Notes
    notes.unshift(
      `${total} rows on the 2026 Mapa Milonguero; ${weekly} weekly; ${listed} listed; ${monthly} monthly and ${fortnightly} fortnightly left out (week not stated); ${ownSite} read from their own site instead; ${unclear} not understood`,
    );
    if (notUnderstood.length > 0) {
      const shown = notUnderstood.slice(0, 10);
      const extra = notUnderstood.length > 10 ? `; and ${notUnderstood.length - 10} more` : "";
      notes.push(`not understood: ${shown.join("; ")}${extra}`);
    }

    // 5. doc
    let doc = undefined;
    if (pdfStatus > 0) {
      doc = {
        url: url,
        fetchedAt: pdfFetchedAt,
        httpStatus: pdfStatus,
        etag: pdfEtag,
        lastModified: pdfLastModified,
        contentHash: sha256(JSON.stringify(listings.map((l) => [l.externalId, l.listing]))),
        cleanedText: null,
      };
    }

    return {
      listings,
      notes,
      doc,
    };
  },
};
