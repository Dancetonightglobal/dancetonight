// LCSD (Leisure and Cultural Services Department, Hong Kong): its open-data programme feed
// (https://www.lcsd.gov.hk/datagovhk/event/events.xml + venues.xml; robots.txt allows /datagovhk/). Written permission
// from LCSD (the owner, 2026-11-03, D-583): facts only (name, date, time, venue, price) and a link back to the LCSD page;
// no descriptions or images. Open events only (the owner's choice): dated, priced/free/bookable, participatory.
// A district placeholder venue takes each session's venue from descc's 日期/地點 lines (facts only, D-740).

import { matchStyles, type StyleKey } from "@/config/styles";
import {
  httpUrl,
  sha256,
  isoToLocal,
  decodeEntities,
  type LocalMoment,
} from "@/src/adapters/shared";
import { buildListing } from "@/src/adapters/structured";
import type {
  HarvestedListing,
  HarvestResult,
  Metro,
  NightDate,
  RunCtx,
  SourceAdapter,
} from "@/src/adapters/types";
import type { ListingPrice, Point } from "@/src/domain/listing";

export const LCSD_VENUES_URL = "https://www.lcsd.gov.hk/datagovhk/event/venues.xml";
export const LCSD_EVENTS_URL = "https://www.lcsd.gov.hk/datagovhk/event/events.xml";

export function lcsdDetailUrl(id: string): string {
  return `https://www.lcsd.gov.hk/clpss/en/search/culture/DetailForm.do?id=${id}`;
}

function extractText(xml: string, tag: string): string {
  const pattern = new RegExp(
    `<${tag}>\\s*(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([^<]*))\\s*</${tag}>`,
    "i",
  );
  const match = pattern.exec(xml);
  if (!match) return "";
  const content = match[1] ?? match[2] ?? "";
  return decodeEntities(content.trim().replace(/\s+/g, " "));
}

function extractRaw(xml: string, tag: string): string {
  const pattern = new RegExp(
    `<${tag}>\\s*(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([^<]*))\\s*</${tag}>`,
    "i",
  );
  const match = pattern.exec(xml);
  if (!match) return "";
  const content = match[1] ?? match[2] ?? "";
  // Decode entities, normalize line endings, trim each line, but keep newlines
  return decodeEntities(content)
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join("\n");
}

function extractVenues(
  xml: string,
): Map<string, { name: string | null; lat: number | null; lng: number | null }> {
  const map = new Map();
  const venuePattern = /<venue id="([^"]+)">([\s\S]*?)<\/venue>/g;
  for (const match of xml.matchAll(venuePattern)) {
    const id = match[1];
    const block = match[2];
    if (!id || !block) continue;
    const name = extractText(block, "venuee");
    const latStr = extractText(block, "latitude");
    const lngStr = extractText(block, "longitude");
    const lat = latStr ? Number(latStr) : null;
    const lng = lngStr ? Number(lngStr) : null;
    map.set(id, {
      name: name || null,
      lat: Number.isFinite(lat) && lat !== 0 ? lat : null,
      lng: Number.isFinite(lng) && lng !== 0 ? lng : null,
    });
  }
  return map;
}

function extractEvents(xml: string): Array<{
  id: string;
  titlee: string;
  titlec: string;
  cat2: string;
  predateE: string;
  progtimee: string;
  venueid: string;
  pricee: string;
  tagenturle: string;
  descc: string;
}> {
  const events: Array<{
    id: string;
    titlee: string;
    titlec: string;
    cat2: string;
    predateE: string;
    progtimee: string;
    venueid: string;
    pricee: string;
    tagenturle: string;
    descc: string;
  }> = [];
  const eventPattern = /<event id="([^"]+)">([\s\S]*?)<\/event>/g;
  for (const match of xml.matchAll(eventPattern)) {
    const id = match[1];
    const block = match[2];
    if (!id || !block) continue;
    events.push({
      id,
      titlee: extractText(block, "titlee"),
      titlec: extractText(block, "titlec"),
      cat2: extractText(block, "cat2"),
      predateE: extractRaw(block, "predateE"),
      progtimee: extractText(block, "progtimee"),
      venueid: extractText(block, "venueid"),
      pricee: extractText(block, "pricee"),
      tagenturle: extractText(block, "tagenturle"),
      descc: extractRaw(block, "descc"),
    });
  }
  return events;
}

export function parseLcsdDates(
  text: string,
): Array<{ date: string; time: string | null; line: string; timeText?: string }> {
  const occurrences: Array<{ date: string; time: string | null; line: string; timeText?: string }> =
    [];
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  let currentDate = "";
  let lastDateLine = "";
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    // Try to match date line with optional weekday and optional time
    const dateMatch = line.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s*\([^)]+\))?(?:\s+(.+))?/i);
    if (dateMatch) {
      const day = (dateMatch[1] ?? "").padStart(2, "0");
      const month = (dateMatch[2] ?? "").padStart(2, "0");
      const year = dateMatch[3] ?? "";
      if (!day || !month || !year) continue;
      currentDate = `${year}-${month}-${day}`;
      lastDateLine = line;
      const remainder = dateMatch[4];
      if (remainder) {
        // There may be times in the remainder
        occurrences.push(...parseTimes(currentDate, remainder, lastDateLine));
      } else {
        // No time on this date line: check next line for times
        let hasTimeLine = false;
        for (let j = i + 1; j < lines.length; j++) {
          const nextLine = lines[j];
          if (!nextLine) continue;
          // If next line is another date line, break
          if (nextLine.match(/^\d{1,2}\/\d{1,2}\/\d{4}/)) {
            break;
          }
          // If next line contains times
          if (nextLine.match(/^\d{1,2}(?::\d{2})?(?:am|pm)?/i)) {
            occurrences.push(...parseTimes(currentDate, nextLine, lastDateLine));
            hasTimeLine = true;
            break;
          }
        }
        // If no time line found, create an occurrence with time null
        if (!hasTimeLine) {
          occurrences.push({ date: currentDate, time: null, line: lastDateLine });
        }
      }
    }
  }
  return occurrences;
}

export function parseLcsdDescVenues(descc: string): Map<string, string> {
  const map = new Map<string, string>();
  const lines = descc.split("\n").map((l) => l.trim());
  let pendingDates: string[] = [];
  let hasPendingDates = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    // Check for date line
    const dateMatch = line.match(/^日期[：:]\s*(.+)$/);
    if (dateMatch) {
      const dateText = (dateMatch[1] ?? "").trim();
      // Check for range indicators
      if (/[-–—~至]/.test(dateText)) {
        // Skip this date line, clear pending dates
        pendingDates = [];
        hasPendingDates = false;
        continue;
      }
      // Parse dates
      const dates: string[] = [];

      // Format D.M.YYYY
      const singleMatch = dateText.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/);
      if (singleMatch) {
        const dayStr = singleMatch[1] ?? "";
        const monthStr = singleMatch[2] ?? "";
        const yearStr = singleMatch[3] ?? "";
        const day = Number(dayStr);
        const month = Number(monthStr);
        const year = Number(yearStr);
        if (isValidCalendarDate(day, month, year)) {
          dates.push(`${yearStr}-${monthStr.padStart(2, "0")}-${dayStr.padStart(2, "0")}`);
        }
      }

      // Format D, D, D.M.YYYY (list of days sharing same month/year)
      // Example: "1, 8, 15.12.2026"
      const listMatch = dateText.match(/^(\d{1,2}(?:\s*,\s*\d{1,2})+)\s*\.\s*(\d{1,2})\.(\d{4})/);
      if (listMatch) {
        const daysPart = listMatch[1] ?? "";
        const monthStr = (listMatch[2] ?? "").padStart(2, "0");
        const yearStr = listMatch[3] ?? "";
        const month = Number(monthStr);
        const year = Number(yearStr);
        const days = daysPart.split(",").map((s) => s.trim().replace(/\D/g, ""));
        for (const dayStr of days) {
          if (dayStr) {
            const day = Number(dayStr);
            if (isValidCalendarDate(day, month, year)) {
              dates.push(`${yearStr}-${monthStr}-${dayStr.padStart(2, "0")}`);
            }
          }
        }
      }

      // Format D / M / YYYY
      const slashMatch = dateText.match(/^(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{4})/);
      if (slashMatch) {
        const dayStr = slashMatch[1] ?? "";
        const monthStr = slashMatch[2] ?? "";
        const yearStr = slashMatch[3] ?? "";
        const day = Number(dayStr);
        const month = Number(monthStr);
        const year = Number(yearStr);
        if (isValidCalendarDate(day, month, year)) {
          dates.push(`${yearStr}-${monthStr.padStart(2, "0")}-${dayStr.padStart(2, "0")}`);
        }
      }

      pendingDates = dates;
      hasPendingDates = dates.length > 0;
      continue;
    }

    // Check for venue line
    const venueMatch = line.match(/^地點[：:]\s*(.+)$/);
    if (venueMatch && hasPendingDates) {
      const venueName = (venueMatch[1] ?? "").trim();
      for (const date of pendingDates) {
        if (!map.has(date)) {
          map.set(date, venueName);
        }
      }
      // Consume the pending dates
      pendingDates = [];
      hasPendingDates = false;
      continue;
    }
  }
  return map;
}

function isValidCalendarDate(day: number, month: number, year: number): boolean {
  // JavaScript months are 0-indexed
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

function parseTimes(
  date: string,
  timeText: string,
  line: string,
): Array<{ date: string; time: string | null; line: string }> {
  const results: Array<{ date: string; time: string | null; line: string }> = [];
  // Split by commas to handle multiple times
  const parts = timeText
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  for (const part of parts) {
    // Handle ranges like "2:30pm - 4:30pm" or "14:30-16:30" or "10:00am-12:00nn" or "0930-1130"
    // We take the first time only
    const rangeMatch = part.match(/^([^-]+?)\s*-\s*(.+)$/);
    const timePart = rangeMatch?.[1]?.trim() ?? part;
    const time = normalizeTime(timePart);
    if (time !== null) {
      results.push({ date, time, line });
    } else {
      // If time cannot be parsed, still add occurrence with time null
      results.push({ date, time: null, line });
    }
  }
  return results;
}

function normalizeTime(raw: string): string | null {
  // First, handle "nn" (noon) -> 12:00
  let processed = raw.trim().toLowerCase();
  if (processed === "nn" || processed === "12:00nn") {
    return "12:00";
  }
  // Replace "nn" with "pm" for easier parsing
  processed = processed.replace(/nn$/, "pm");

  // Try patterns:
  // 1. HH:MMam/pm
  let m = processed.match(/^(\d{1,2}):(\d{2})\s*(am|pm)?$/);
  if (m) {
    const hourStr = m[1];
    const minuteStr = m[2];
    const ampm = m[3]?.toLowerCase();
    if (!hourStr) return null;
    let hour = Number(hourStr);
    const minute = minuteStr ? Number(minuteStr) : 0;
    if (ampm === "pm" && hour < 12) hour += 12;
    if (ampm === "am" && hour === 12) hour = 0;
    return `${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`;
  }
  // 2. HHam/pm (no minutes)
  m = processed.match(/^(\d{1,2})\s*(am|pm)?$/);
  if (m) {
    const hourStr = m[1];
    const ampm = m[2]?.toLowerCase();
    if (!hourStr) return null;
    let hour = Number(hourStr);
    const minute = 0;
    if (ampm === "pm" && hour < 12) hour += 12;
    if (ampm === "am" && hour === 12) hour = 0;
    return `${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`;
  }
  // 3. HHMM (4 digits)
  m = processed.match(/^(\d{2})(\d{2})$/);
  if (m) {
    const hour = Number(m[1]);
    const minute = Number(m[2]);
    if (hour <= 23 && minute <= 59) {
      return `${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`;
    }
  }
  return null;
}

function isDanceProgramme(cat2: string, titlee: string, titlec: string): boolean {
  if (cat2 === "inc4sc3") return true;
  if (["inc4sc14", "inc9sc2", "inc9sc3"].includes(cat2)) {
    return /danc/i.test(titlee) || titlec.includes("舞");
  }
  return false;
}

function isTermClass(predateE: string): boolean {
  return /\bevery\s*(mon|tue|wed|thu|fri|sat|sun)/i.test(predateE);
}

function isOpenEntry(pricee: string, tagenturle: string): boolean {
  if (pricee && pricee.trim().length > 0) return true;
  return httpUrl(tagenturle) !== null;
}

function isParticipatory(titlee: string, titlec: string): boolean {
  const english =
    /\b(workshops?|social|party|interactive|practice|practica|jam|class(es)?)\b/i.test(titlee);
  const chinese = /工作坊|舞會|社交|互動|體驗/.test(titlec);
  return english || chinese;
}

function parseEndTime(startTime: string | null, progtimee: string): string | null {
  if (!startTime) return null;
  const m = progtimee.match(/(\d+)\s*hours?/i);
  if (!m) return null;
  const hoursStr = m[1];
  if (!hoursStr) return null;
  const hours = Number(hoursStr);
  if (hours < 1 || hours > 6) return null;
  // Add hours to start time
  const parts = startTime.split(":");
  const h = parts[0] ? Number(parts[0]) : 0;
  const mm = parts[1] ? Number(parts[1]) : 0;
  const totalMinutes = h * 60 + mm + hours * 60;
  const endHour = Math.floor(totalMinutes / 60) % 24;
  const endMinute = totalMinutes % 60;
  return `${endHour.toString().padStart(2, "0")}:${endMinute.toString().padStart(2, "0")}`;
}

function parsePrices(pricee: string): ListingPrice[] | null {
  const lower = pricee.toLowerCase();
  if (lower.includes("free activities") || lower.includes("免費")) {
    return [{ label: "Free", amount: 0, currency: "HKD", includes: null }];
  }
  const dollarMatches = [...pricee.matchAll(/\$(\d{1,3}(?:,\d{3})*)/g)];
  if (dollarMatches.length === 0) return null;
  const prices: ListingPrice[] = [];
  for (const match of dollarMatches) {
    const amount = Number((match[1] ?? "").replace(/,/g, ""));
    if (Number.isFinite(amount) && amount > 0) {
      prices.push({ label: "Tickets", amount, currency: "HKD", includes: null });
    }
  }
  return prices.length > 0 ? prices : null;
}

export function lcsdToListings(
  eventsXml: string,
  venuesXml: string,
  options: { metro: Metro; nights: readonly string[]; fetchedAt: Date },
): {
  listings: HarvestedListing[];
  notes: string[];
  screened: Array<{ externalId: string; title: string; reason: string }>;
} {
  const listings: HarvestedListing[] = [];
  const notes: string[] = [];
  const screened: Array<{ externalId: string; title: string; reason: string }> = [];
  const seen = new Set<string>();

  const venues = extractVenues(venuesXml);
  const events = extractEvents(eventsXml);

  // Note will be added later

  for (const ev of events) {
    // 1. Dance programme?
    if (!isDanceProgramme(ev.cat2, ev.titlee, ev.titlec)) {
      continue; // ignore silently
    }

    // 2. Term class?
    if (isTermClass(ev.predateE)) {
      screened.push({
        externalId: `lcsd:${ev.id}`,
        title: ev.titlee || ev.titlec,
        reason: "a term class (weekly course, enrolment by phone; D-583)",
      });
      continue;
    }

    // 3. Open entry?
    if (!isOpenEntry(ev.pricee, ev.tagenturle)) {
      screened.push({
        externalId: `lcsd:${ev.id}`,
        title: ev.titlee || ev.titlec,
        reason: "no price, free entry or booking listed (D-583)",
      });
      continue;
    }

    // 4. Participatory?
    if (!isParticipatory(ev.titlee, ev.titlec)) {
      screened.push({
        externalId: `lcsd:${ev.id}`,
        title: ev.titlee || ev.titlec,
        reason: "a show, competition, exhibition or screening, not something people join (D-570)",
      });
      continue;
    }

    // 5. Dates
    const occurrences = parseLcsdDates(ev.predateE);
    if (occurrences.length === 0) {
      notes.push(`LCSD ${ev.id}: date text not read: "${ev.predateE.slice(0, 60)}"`);
      continue;
    }
    // Add notes for unreadable times
    for (const occ of occurrences) {
      if (occ.time === null && occ.line && /(\d|am|pm|nn)/i.test(occ.line)) {
        notes.push(`LCSD ${ev.id}: time not read: "${occ.line}"`);
      }
    }

    const venue = venues.get(ev.venueid);
    const venueName = venue?.name ?? null;
    const location: Point | null =
      venue &&
      typeof venue.lat === "number" &&
      typeof venue.lng === "number" &&
      !(venue.lat === 0 && venue.lng === 0)
        ? { lat: venue.lat, lng: venue.lng }
        : null;

    // Check if this is a district placeholder venue
    const isDistrictPlaceholder = venueName && /^Venues in (.+) district$/i.test(venueName);
    let districtName: string | null = null;
    let descVenueMap: Map<string, string> | null = null;
    if (isDistrictPlaceholder) {
      const match = venueName.match(/^Venues in (.+) district$/i);
      districtName = match?.[1] ?? null;
      descVenueMap = parseLcsdDescVenues(ev.descc);
    }

    const prices = parsePrices(ev.pricee);
    const eventUrl = lcsdDetailUrl(ev.id);
    const ticketUrl = httpUrl(ev.tagenturle);
    const title = ev.titlee || ev.titlec;
    const combinedTitle = (ev.titlee + " " + ev.titlec).trim();
    const styles = matchStyles(combinedTitle, options.metro.languages).styles;
    const finalStyles: StyleKey[] = styles.length > 0 ? styles : ["other"];

    let eventListings = 0;
    for (const occ of occurrences) {
      if (!options.nights.includes(occ.date)) continue;

      const time = occ.time;
      let start: LocalMoment;
      if (time) {
        const isoTime = `${occ.date}T${time}:00+08:00`;
        const parsed = isoToLocal(isoTime, options.metro.tz);
        if (!parsed) {
          notes.push(`LCSD ${ev.id}: could not parse start ${isoTime}`);
          continue;
        }
        start = parsed;
      } else {
        // Time null: create LocalMoment directly
        start = {
          day: occ.date,
          night: occ.date,
          time: null,
          zone: options.metro.tz,
          absolute: false,
        };
      }

      const endTime = parseEndTime(time, ev.progtimee);
      const end = endTime ? isoToLocal(`${occ.date}T${endTime}:00+08:00`, options.metro.tz) : null;

      const externalId = `lcsd:${ev.id}:${occ.date}T${time || "notime"}`;
      if (seen.has(externalId)) continue;
      seen.add(externalId);

      const evidence: Record<string, string> = {
        title: `"${title}"`,
        start: `predateE ${occ.line}`,
      };
      if (ev.pricee) {
        evidence.price = ev.pricee;
      }

      // Determine final venue name and address
      let finalVenueName = venueName;
      let finalAddress: string | null = null;
      if (isDistrictPlaceholder && descVenueMap) {
        const mappedVenue = descVenueMap.get(occ.date);
        if (mappedVenue && districtName) {
          finalVenueName = mappedVenue;
          finalAddress = `${mappedVenue}, ${districtName}, Hong Kong`;
        }
      }

      listings.push(
        buildListing(
          {
            externalId,
            title,
            start,
            end: end?.time && end.night === start.night ? end : null,
            description: null,
            venue: {
              name: finalVenueName,
              address: finalAddress,
              url: null,
              location,
            },
            organizer: { name: null, url: null },
            prices,
            ticketUrl,
            eventUrl,
            cancelled: false,
            styles: finalStyles,
            evidence,
          },
          {
            sourceUrl: eventUrl,
            fetchedAt: options.fetchedAt,
            method: "api",
            currency: "HKD",
          },
        ),
      );
      eventListings++;
    }
    if (eventListings === 0 && occurrences.length > 0) {
      notes.push(`LCSD ${ev.id}: no occurrences within nights window`);
    }
  }

  notes.push(`${events.length} events in the LCSD feed, ${listings.length} listed`);
  return { listings, notes, screened };
}

export const lcsdAdapter: SourceAdapter = {
  id: "lcsd" as SourceAdapter["id"],
  tier: "A",
  countries: ["HK"],
  requiredEnv: [],
  limits: { perDomainIntervalMs: 5000, rps: 0.2, perDay: 20 },
  async harvestMetro(metro: Metro, nights: NightDate[], ctx: RunCtx): Promise<HarvestResult> {
    if (metro.slug !== "hong-kong") {
      return {
        listings: [],
        notes: [`no LCSD feed for ${metro.slug}`],
        screened: [],
        doc: {
          url: LCSD_EVENTS_URL,
          fetchedAt: ctx.now(),
          httpStatus: 200,
          etag: null,
          lastModified: null,
          contentHash: sha256(JSON.stringify([])),
          cleanedText: null,
        },
      };
    }

    const notes: string[] = [];
    let fetchedAt = ctx.now();

    const venuesResponse = await ctx.http.request({
      url: LCSD_VENUES_URL,
      purpose: "api",
      intervalMs: 5000,
      headers: { accept: "application/xml" },
    });
    fetchedAt = venuesResponse.fetchedAt;
    const venuesXml = venuesResponse.body;

    const eventsResponse = await ctx.http.request({
      url: LCSD_EVENTS_URL,
      purpose: "api",
      intervalMs: 5000,
      headers: { accept: "application/xml" },
    });
    fetchedAt = eventsResponse.fetchedAt;
    const eventsXml = eventsResponse.body;

    // Empty-feed guard
    if (!venuesXml.includes('<venue id="')) {
      throw new Error("LCSD feed empty: venues.xml had no <venue> blocks");
    }
    if (!eventsXml.includes('<event id="')) {
      throw new Error("LCSD feed empty: events.xml had no <event> blocks");
    }

    const {
      listings,
      notes: listingNotes,
      screened,
    } = lcsdToListings(eventsXml, venuesXml, {
      metro,
      nights,
      fetchedAt,
    });
    notes.push(...listingNotes);

    return {
      listings,
      notes,
      screened,
      doc: {
        url: LCSD_EVENTS_URL,
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
