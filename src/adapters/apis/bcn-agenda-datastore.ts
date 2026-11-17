// D-849: bcn_agenda reads the open-data datastore API (the /download route 403s)
// This module converts CKAN datastore rows into the nested event objects that bcnAgendaToListings expects.

import { addCalendarDays } from "@/src/domain/time";
import type { Metro, NightDate } from "@/src/adapters/types";

export const BCN_DATASTORE_SQL_URL =
  "https://opendata-ajuntament.barcelona.cat/data/api/3/action/datastore_search_sql";
export const BCN_CULTURAL_RESOURCE = "3abb2414-1ee0-446e-9c25-380e938adb73";
export const BCN_EXTENDED_RESOURCE = "ffa6d773-7998-4e0f-8e98-c80abce7126f";

export type TimetableSlot = {
  weekdays: number[]; // 0 = Sunday ... 6 = Saturday; [] when none named
  dates: string[]; // explicit "MM-DD" dates; [] when none
  except: string[]; // "MM-DD" dates after "excepte"
  start: string | null; // "HH:MM"
  end: string | null;
};

function normalizeText(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function parseWeekday(word: string): number | null {
  const norm = normalizeText(word);
  // Exact match after removing any non-word characters (spaces, punctuation)
  const clean = norm.replace(/[^a-zç]/g, "");
  if (clean === "diumenge" || norm.includes("diumenge")) return 0;
  if (clean === "dilluns" || norm.includes("dilluns")) return 1;
  if (clean === "dimarts" || norm.includes("dimarts")) return 2;
  if (clean === "dimecres" || norm.includes("dimecres")) return 3;
  if (clean === "dijous" || norm.includes("dijous")) return 4;
  if (clean === "divendres" || norm.includes("divendres")) return 5;
  if (clean === "dissabte" || norm.includes("dissabte")) return 6;
  return null;
}

function monthNumber(month: string): string | null {
  const norm = normalizeText(month);
  const months: Record<string, string> = {
    gener: "01",
    febrer: "02",
    marc: "03",
    abril: "04",
    maig: "05",
    juny: "06",
    juliol: "07",
    agost: "08",
    setembre: "09",
    octubre: "10",
    novembre: "11",
    desembre: "12",
  };
  return months[norm] || null;
}

function parseDatePair(text: string): string[] {
  const results: string[] = [];
  // Match patterns like "9 octubre" or "13 novembre"
  const regex = /(\d{1,2})\s+([a-zç]+)/gi;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const [, dayDigits, monthWord] = match;
    if (!dayDigits || !monthWord) continue;
    const day = dayDigits.padStart(2, "0");
    const month = monthNumber(monthWord);
    if (month) {
      results.push(`${month}-${day}`);
    }
  }
  return results;
}

function parseTimeRange(text: string): { start: string | null; end: string | null } {
  // Find first occurrence of pattern HH.MM or HH:MM
  const timeRegex = /(\d{1,2})[.:](\d{2})/;
  const match = timeRegex.exec(text);
  if (!match) return { start: null, end: null };

  const hour = match[1]?.padStart(2, "0");
  const minute = match[2];
  if (!hour || !minute) return { start: null, end: null };

  const start = `${hour}:${minute}`;

  // Check if start is valid
  const h = Number(hour);
  const m = Number(minute);
  if (h > 23 || m > 59) return { start: null, end: null };

  // Look for a range pattern: de|d' ... a ...
  const rangeRegex = /(?:de|d')\s*\d{1,2}[.:]\d{2}\s*h\s+a\s*(\d{1,2})[.:](\d{2})\s*h/i;
  const rangeMatch = rangeRegex.exec(text);
  let end: string | null = null;
  if (rangeMatch && rangeMatch[1] && rangeMatch[2]) {
    const endHour = rangeMatch[1].padStart(2, "0");
    const endMinute = rangeMatch[2];
    const endH = Number(endHour);
    const endM = Number(endMinute);
    if (endH <= 23 && endM <= 59) {
      end = `${endHour}:${endMinute}`;
    }
  }

  return { start, end };
}

export function parseTimetable(html: string): TimetableSlot[] {
  if (!html || !html.includes("<table")) return [];

  const slots: TimetableSlot[] = [];
  const rows: Array<{ day: string | null; hour: string }> = [];

  {
    // Regex parsing: the same in every runtime (no DOMParser).
    const tableMatch = html.match(/<table[^>]*>([\s\S]*?)<\/table>/i);
    if (!tableMatch) return [];

    const tableContent = tableMatch[1] ?? "";
    const trMatches = tableContent.match(/<tr[^>]*>([\s\S]*?)<\/tr>/gi);
    if (!trMatches) return [];

    let lastDay: string | null = null;

    for (const tr of trMatches.slice(1)) {
      // Extract day cell
      const dayMatch = tr.match(/<td[^>]*class="timetable-day"[^>]*>([\s\S]*?)<\/td>/i);
      let dayText: string | null = null;
      if (dayMatch) {
        // Remove inner tags to get text
        dayText = (dayMatch[1] ?? "").replace(/<[^>]+>/g, "").trim();
      }

      // Extract hour cell
      const hourMatch = tr.match(/<td[^>]*class="timetable-hour"[^>]*>([\s\S]*?)<\/td>/i);
      if (!hourMatch) continue;

      const hourText = (hourMatch[1] ?? "").replace(/<[^>]+>/g, "").trim();
      const currentDay = dayText !== null ? dayText : lastDay;
      if (currentDay === null) continue;

      rows.push({ day: currentDay, hour: hourText });
      if (dayText !== null) lastDay = dayText;
    }
  }

  for (const { day, hour } of rows) {
    if (!day) continue;

    // Clean cell text
    let dayClean = day.replace(/<br\s*\/?>/gi, " ");
    dayClean = dayClean.replace(/<[^>]+>/g, "");
    dayClean = dayClean.replace(/&nbsp;|&#39;|&amp;/g, " ");
    dayClean = dayClean.replace(/\s+/g, " ").trim();

    let hourClean = hour.replace(/<br\s*\/?>/gi, " ");
    hourClean = hourClean.replace(/<[^>]+>/g, "");
    hourClean = hourClean.replace(/&nbsp;|&#39;|&amp;/g, " ");
    hourClean = hourClean.replace(/\s+/g, " ").trim();

    // Split on "excepte"
    const exceptIndex = normalizeText(dayClean).indexOf("excepte");
    let dayPart = dayClean;
    let exceptPart = "";
    if (exceptIndex >= 0) {
      dayPart = dayClean.slice(0, exceptIndex).trim();
      exceptPart = dayClean.slice(exceptIndex + 7).trim();
    }

    // Parse weekdays
    const weekdays: number[] = [];
    const dates: string[] = [];
    const except: string[] = [];

    // Check for "cada dia" or "tots els dies"
    if (
      normalizeText(dayPart).includes("cada dia") ||
      normalizeText(dayPart).includes("tots els dies")
    ) {
      weekdays.push(...[0, 1, 2, 3, 4, 5, 6]);
    } else {
      // Check for span "De ... a ..."
      const spanMatch = /de\s+([a-zç]+)\s+a\s+([a-zç]+)/i.exec(normalizeText(dayPart));
      if (spanMatch && spanMatch[1] && spanMatch[2]) {
        const start = parseWeekday(spanMatch[1]);
        const end = parseWeekday(spanMatch[2]);
        if (start !== null && end !== null) {
          for (let w = start; w <= end; w++) {
            weekdays.push(w);
          }
        }
      } else {
        // Parse individual weekdays
        // Split by commas, "i", and spaces
        const words =
          normalizeText(dayPart).match(
            /\b(diumenge|dilluns|dimarts|dimecres|dijous|divendres|dissabte)\b/g,
          ) ?? [];
        for (const word of words) {
          const wd = parseWeekday(word);
          if (wd !== null) weekdays.push(wd);
        }
      }

      // Parse explicit dates in dayPart
      dates.push(...parseDatePair(dayPart));
    }

    // Parse except dates
    except.push(...parseDatePair(exceptPart));

    // Parse time
    const { start, end } = parseTimeRange(hourClean);

    slots.push({
      weekdays: [...new Set(weekdays)].sort((a, b) => a - b),
      dates,
      except,
      start,
      end,
    });
  }

  return slots;
}

export function cleanRegisterId(raw: unknown): string | null {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    const s = String(raw);
    return /^\d{1,20}$/.test(s) ? s : null;
  }
  if (typeof raw === "string") {
    const cleaned = raw.replace(/\uFEFF/g, "").trim();
    return /^\d{1,20}$/.test(cleaned) ? cleaned : null;
  }
  return null;
}

export function culturalSqlUrl(nights: NightDate[]): string {
  if (!nights.length) throw new Error("bcn_agenda: bad nights");
  const sorted = [...nights].sort();
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (!first || !last || !/^\d{4}-\d{2}-\d{2}$/.test(first) || !/^\d{4}-\d{2}-\d{2}$/.test(last)) {
    throw new Error("bcn_agenda: bad nights");
  }
  const lastPlus2 = addCalendarDays(last, 2);
  const sql = `SELECT register_id, name, start_date, end_date, timetable, addresses_road_name, addresses_start_street_number, addresses_zip_code, addresses_town, geo_epgs_4326_lat, geo_epgs_4326_lon FROM "${BCN_CULTURAL_RESOURCE}" WHERE end_date >= '${first}' AND start_date < '${lastPlus2}' LIMIT 32000`;
  return `${BCN_DATASTORE_SQL_URL}?sql=${encodeURIComponent(sql)}`;
}

export function placesSqlUrl(ids: string[]): string | null {
  const cleanIds = ids.map(cleanRegisterId).filter((id): id is string => id !== null);
  const unique = [...new Set(cleanIds)].slice(0, 500);
  if (unique.length === 0) return null;
  const quoted = unique.map((id) => `'${id.replace(/'/g, "''")}'`).join(",");
  const sql = `SELECT DISTINCT replace(register_id, chr(65279), '') AS id, addresses_place, values_value FROM "${BCN_EXTENDED_RESOURCE}" WHERE replace(register_id, chr(65279), '') IN (${quoted})`;
  return `${BCN_DATASTORE_SQL_URL}?sql=${encodeURIComponent(sql)}`;
}

function weekdayOf(date: string): number {
  // date is YYYY-MM-DD
  const d = new Date(date + "T12:00:00Z");
  return d.getUTCDay(); // 0 = Sunday, 6 = Saturday
}

export function datastoreRowToEvent(
  row: Record<string, unknown>,
  extra: { place: string | null; url: string | null } | undefined,
  nights: NightDate[],
  metro: Metro,
): Record<string, unknown> | null {
  const id = cleanRegisterId(row.register_id);
  if (!id) return null;

  const name = typeof row.name === "string" ? row.name.trim() : null;
  if (!name) return null;

  const startDate = typeof row.start_date === "string" ? row.start_date : null;
  if (!startDate) return null;
  const endDate = typeof row.end_date === "string" ? row.end_date : startDate;

  const startDay = startDate.slice(0, 10);
  const endDay = endDate.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDay) || !/^\d{4}-\d{2}-\d{2}$/.test(endDay)) {
    return null;
  }

  const single = startDay === endDay;

  // Determine date range to consider
  const sortedNights = [...nights].sort();
  const earliest = sortedNights[0];
  const latest = sortedNights[sortedNights.length - 1];
  if (!earliest || !latest) return null;
  const latestPlus1 = addCalendarDays(latest, 1);

  const candidateDates: string[] = [];
  let current = earliest;
  while (current <= latestPlus1) {
    if (current >= startDay && current <= endDay) {
      candidateDates.push(current);
    }
    current = addCalendarDays(current, 1);
  }

  const timetable = typeof row.timetable === "string" ? row.timetable : "";
  const slots = parseTimetable(timetable);

  const occurrences: Array<{ date: string; start: string | null; end: string | null }> = [];
  const seen = new Set<string>();

  if (slots.length > 0) {
    for (const slot of slots) {
      for (const date of candidateDates) {
        const mmdd = date.slice(5, 10); // MM-DD
        const weekday = weekdayOf(date);
        const matchesWeekday = slot.weekdays.includes(weekday);
        const matchesDate = slot.dates.includes(mmdd);
        const matchesEmpty = slot.weekdays.length === 0 && slot.dates.length === 0 && single;
        const excluded = slot.except.includes(mmdd);

        if ((matchesWeekday || matchesDate || matchesEmpty) && !excluded) {
          const key = `${date}:${slot.start ?? ""}`;
          if (!seen.has(key)) {
            seen.add(key);
            occurrences.push({ date, start: slot.start, end: slot.end });
          }
        }
      }
    }
  } else if (single) {
    occurrences.push({ date: startDay, start: null, end: null });
  }

  if (occurrences.length === 0) return null;

  // Build ical
  const icalBlocks = occurrences.map((occ) => {
    const dtstart = occ.start
      ? `${occ.date.replace(/-/g, "")}T${occ.start.replace(":", "")}00`
      : `${occ.date.replace(/-/g, "")}T000000`;
    const dtend = occ.end
      ? `${occ.date.replace(/-/g, "")}T${occ.end.replace(":", "")}00`
      : undefined;
    return `BEGIN:VEVENT\nDTSTART:${dtstart}${dtend ? `\nDTEND:${dtend}` : ""}\nEND:VEVENT`;
  });
  const ical = icalBlocks.join("\n");

  // Address
  const road = typeof row.addresses_road_name === "string" ? row.addresses_road_name.trim() : null;
  let number: string | null = null;
  const streetNumber = row.addresses_start_street_number;
  if (typeof streetNumber === "number" && Number.isFinite(streetNumber)) {
    const n = Math.trunc(streetNumber);
    if (n !== 0) number = String(n);
  } else if (typeof streetNumber === "string") {
    const digits = streetNumber.replace(/\D/g, "");
    const n = Number.parseInt(digits, 10);
    if (Number.isFinite(n) && n !== 0) {
      number = String(n);
    }
  }
  let zip: string | null = null;
  if (typeof row.addresses_zip_code === "string") {
    const digits = row.addresses_zip_code.replace(/\D/g, "");
    if (digits.length === 4 || digits.length === 5) {
      zip = digits.padStart(5, "0");
    }
  }
  const town = typeof row.addresses_town === "string" ? row.addresses_town.trim() : null;

  // Location
  let location: { lat: number; lng: number } | null = null;
  const latRaw = row.geo_epgs_4326_lat;
  const lngRaw = row.geo_epgs_4326_lon;
  const latNum =
    typeof latRaw === "string"
      ? Number.parseFloat(latRaw)
      : typeof latRaw === "number"
        ? latRaw
        : NaN;
  const lngNum =
    typeof lngRaw === "string"
      ? Number.parseFloat(lngRaw)
      : typeof lngRaw === "number"
        ? lngRaw
        : NaN;
  if (Number.isFinite(latNum) && Number.isFinite(lngNum)) {
    const latDiff = Math.abs(latNum - metro.center.lat);
    const lngDiff = Math.abs(lngNum - metro.center.lng);
    if (latDiff <= 1 && lngDiff <= 1) {
      location = { lat: latNum, lng: lngNum };
    }
  }

  return {
    register_id: id,
    name,
    ical,
    type_name: null,
    start_date: row.start_date,
    body: null,
    addresses: [
      {
        place: extra?.place ?? null,
        address_name: road || null,
        street_number_1: number || null,
        zip_code: zip || null,
        town: town || null,
        main_address: true,
        hide_address: false,
        location_4326_latlon: location
          ? {
              type: "GeometryCollection",
              geometries: [{ type: "Point", coordinates: [location.lng, location.lat] }],
            }
          : null,
      },
    ],
    values: extra?.url ? [{ url_value: extra.url }] : [],
  };
}
