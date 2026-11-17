// TokyoTango.jp's milonga sheet (Google Sheets CSV) reader.
// The adapter reads CSV from two tabs once per run and returns milongas and prácticas as listings.
// Runs only in the Tokyo metro.

import type { StyleKey } from "@/config/styles";
import { sha256, type LocalMoment } from "@/src/adapters/shared";
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

export const TOKYOTANGO_SHEET =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vRmDSOP2d00mJTko4w80XJnnvNct-YrpFsFXyM4qaVplajhRJ3Crqmw3chJwPVovULs9C6LTk3kgWaB";
export const TOKYOTANGO_TABS = ["55134061", "2132300173"] as const;
export const TOKYOTANGO_PAGE = "https://sites.google.com/tokyotango.jp/milonga-information/home";

function tabUrl(gid: string): string {
  return `${TOKYOTANGO_SHEET}/pub?gid=${gid}&single=true&output=csv`;
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

/**
 * Parse CSV according to RFC 4180: quoted fields with commas, doubled quotes and newlines inside quotes.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = "";
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const ch = text[i];

    if (!inQuotes) {
      if (ch === '"') {
        inQuotes = true;
        i++;
        continue;
      } else if (ch === ",") {
        currentRow.push(currentField);
        currentField = "";
        i++;
        continue;
      } else if (ch === "\r" && i + 1 < text.length && text[i + 1] === "\n") {
        // CRLF line break
        currentRow.push(currentField);
        rows.push(currentRow);
        currentRow = [];
        currentField = "";
        i += 2;
        continue;
      } else if (ch === "\n") {
        // LF line break
        currentRow.push(currentField);
        rows.push(currentRow);
        currentRow = [];
        currentField = "";
        i++;
        continue;
      } else {
        currentField += ch;
        i++;
        continue;
      }
    } else {
      // Inside quotes
      if (ch === '"') {
        if (i + 1 < text.length && text[i + 1] === '"') {
          // Doubled quote
          currentField += '"';
          i += 2;
          continue;
        } else {
          // Closing quote
          inQuotes = false;
          i++;
          continue;
        }
      } else {
        currentField += ch;
        i++;
        continue;
      }
    }
  }

  // Handle last field
  if (currentField !== "" || inQuotes) {
    currentRow.push(currentField);
  }
  if (currentRow.length > 0) {
    rows.push(currentRow);
  }

  return rows;
}

/**
 * Determine the year for a month/day string relative to a first night.
 * Returns YYYY-MM-DD where the date is between 31 days before and 334 days after firstNight.
 */
export function yearFor(monthDay: string, firstNight: string): string {
  const [firstYear = 0, firstMonth = 1, firstDay = 1] = firstNight.split("-").map(Number);
  const firstDate = new Date(firstYear, firstMonth - 1, firstDay);

  const [monthStr = "", dayStr = ""] = monthDay.split("/");
  const month = parseInt(monthStr, 10);
  const day = parseInt(dayStr, 10);

  // Try current year
  let candidate = new Date(firstYear, month - 1, day);
  const diffDays = Math.floor((candidate.getTime() - firstDate.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays >= -31 && diffDays <= 334) {
    return `${firstYear}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
  }

  // Try previous year
  candidate = new Date(firstYear - 1, month - 1, day);
  const diffDaysPrev = Math.floor(
    (candidate.getTime() - firstDate.getTime()) / (1000 * 60 * 60 * 24),
  );
  if (diffDaysPrev >= -31 && diffDaysPrev <= 334) {
    return `${firstYear - 1}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
  }

  // Try next year
  candidate = new Date(firstYear + 1, month - 1, day);
  const diffDaysNext = Math.floor(
    (candidate.getTime() - firstDate.getTime()) / (1000 * 60 * 60 * 24),
  );
  if (diffDaysNext >= -31 && diffDaysNext <= 334) {
    return `${firstYear + 1}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
  }

  // Fallback to current year (shouldn't happen)
  return `${firstYear}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
}

/**
 * Normalize time to HH:MM format.
 */
function normalizeTime(timeStr: string): string {
  const trimmed = timeStr.trim();
  if (!trimmed) return "";

  // Remove any non-digit characters except colon
  const parts = trimmed.split(":");
  if (parts.length < 2) return trimmed;

  const hour = (parts[0] ?? "").padStart(2, "0");
  const minute = (parts[1] ?? "").padStart(2, "0");
  return `${hour}:${minute}`;
}

/**
 * Extract end time from info text.
 */
function extractEndTime(info: string, startTime: string): string | null {
  // NFKC normalization (converts fullwidth characters to halfwidth)
  const normalized = info.normalize("NFKC");

  // Pattern: HH:MM + optional whitespace (including fullwidth space) + separator + optional whitespace + HH:MM
  // Separators: - ~ ～ 〜 － (including fullwidth variants)
  // Use [\s\u3000]* to match both regular whitespace and fullwidth ideographic space
  const pattern = /(\d{1,2}:\d{2})[\s\u3000]*([-~～〜－])[\s\u3000]*(\d{1,2}:\d{2})/g;
  let match;
  while ((match = pattern.exec(normalized)) !== null) {
    const first = normalizeTime(match[1] ?? "");
    const second = normalizeTime(match[3] ?? "");
    if (first === startTime) {
      return second;
    }
  }
  return null;
}

/**
 * Extract address from info text.
 */
function extractAddress(info: string): string | null {
  const normalized = info.normalize("NFKC");
  const startIndex = normalized.indexOf("東京都");
  if (startIndex === -1) return null;

  let endIndex = normalized.length;
  const delimiters = ["）", ")", "\n", "、"];
  for (const delim of delimiters) {
    const idx = normalized.indexOf(delim, startIndex);
    if (idx !== -1 && idx < endIndex) {
      endIndex = idx;
    }
  }

  const address = normalized.slice(startIndex, endIndex).trim();
  if (address.length === 0) return null;

  // Limit to 80 characters
  return address.length > 80 ? address.slice(0, 80) : address;
}

/**
 * Check if the event is outside Tokyo metro.
 * Skip if:
 * 1. The PLACE contains any of the excluded location words, OR
 * 2. No 東京都 address was extracted AND the info contains an excluded word followed within 20 characters by a digit (address pattern)
 * A 東京都 address in the info always means inside.
 */
const EXCLUDED_LOCATIONS = [
  "神奈川県",
  "埼玉県",
  "千葉県",
  "横浜",
  "川崎市",
  "朝霞市",
  "川口市",
  "浦安市",
  "船橋市",
  "松戸市",
  "市川市",
  "所沢市",
  "さいたま市",
  "相模原市",
];
// Yokohama (Naka-ku) venues; the sheet gives only a map pin (D-1235).
const OUTSIDE_PLACES = ["nrg space", "night fire"];
const OUTSIDE_MAP_LINKS = [
  "https://maps.app.goo.gl/rUr7pgqFB2GHwtmt7",
  "https://maps.app.goo.gl/vkCg9G4qLus7wemGA",
];

function isOutsideMetro(
  place: string,
  info: string,
  hasTokyoAddress: boolean,
  maps: string,
  title: string,
): boolean {
  // 1. EXCLUDED_LOCATIONS place check
  if (EXCLUDED_LOCATIONS.some((loc) => place.includes(loc))) {
    return true;
  }

  // 2. folded place in OUTSIDE_PLACES
  const foldedPlace = place.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
  if (OUTSIDE_PLACES.includes(foldedPlace)) {
    return true;
  }

  // 3. trimmed maps in OUTSIDE_MAP_LINKS
  const trimmedMaps = maps.trim();
  if (OUTSIDE_MAP_LINKS.includes(trimmedMaps)) {
    return true;
  }

  // 4. Tokyo address overrides title and info checks
  if (hasTokyoAddress) {
    return false;
  }

  // 5. folded title includes "yokohama" or "横浜"
  const foldedTitle = title.normalize("NFKC").toLowerCase();
  if (foldedTitle.includes("yokohama") || foldedTitle.includes("横浜")) {
    return true;
  }

  // 6. Check info for address pattern: excluded word followed within 20 chars by a digit
  const normalizedInfo = info.normalize("NFKC");
  for (const loc of EXCLUDED_LOCATIONS) {
    const idx = normalizedInfo.indexOf(loc);
    if (idx !== -1) {
      // Look ahead up to 20 characters for a digit
      const slice = normalizedInfo.slice(idx, idx + 20);
      if (/\d/.test(slice)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Determine event type based on title.
 */
function getEventType(title: string): "social" | "practica" {
  // NFKC first: NFD would split プ into フ + a combining mark, and "プラクティカ" would never match.
  const folded = title.normalize("NFKC");
  const latin = folded
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (folded.includes("プラクティカ") || latin.includes("practica")) {
    return "practica";
  }
  return "social";
}

/**
 * Collapse whitespace including U+3000 (ideographic space).
 */
function collapseWhitespace(text: string): string {
  return text.replace(/[\s\u3000]+/g, " ").trim();
}

export const tokyoTangoAdapter: SourceAdapter = {
  id: "tokyotango" as SourceAdapter["id"],
  tier: "A",
  countries: ["JP"],
  limits: { perDomainIntervalMs: 2000, rps: 1, perDay: 20 },
  async harvestMetro(metro: Metro, nights: NightDate[], ctx: RunCtx): Promise<HarvestResult> {
    if (metro.slug !== "tokyo") {
      return {
        listings: [],
        notes: [],
        screened: [],
      };
    }

    const notes: string[] = [];
    const allRows: Array<{
      title: string;
      date: string;
      time: string;
      place: string;
      maps: string;
      info: string;
    }> = [];
    let failedTabs = 0;
    let firstFetchedAt: Date | null = null;

    for (const gid of TOKYOTANGO_TABS) {
      try {
        const response = await ctx.http.request({
          url: tabUrl(gid),
          purpose: "api",
          intervalMs: 2000,
          maxBytes: 10 * 1024 * 1024,
          headers: { accept: "text/csv" },
        });

        if (response.status < 200 || response.status >= 300) {
          notes.push(`tokyotango: tab ${gid} failed (HTTP ${response.status})`);
          failedTabs++;
          continue;
        }

        // Store the first successful fetchedAt
        if (firstFetchedAt === null) {
          firstFetchedAt = response.fetchedAt;
        }

        const rows = parseCsv(response.body);
        if (rows.length === 0) continue;

        // Find column indices by header
        const headerRow = rows[0] ?? [];
        const titleIdx = headerRow.findIndex((col) => col === "イベント");
        const dateIdx = headerRow.findIndex((col) => col === "日付");
        const timeIdx = headerRow.findIndex((col) => col === "時間");
        const placeIdx = headerRow.findIndex((col) => col === "場所");
        const mapsIdx = headerRow.findIndex((col) => col === "Maps");
        const infoIdx = headerRow.findIndex((col) => col === "情報");

        if (
          titleIdx === -1 ||
          dateIdx === -1 ||
          timeIdx === -1 ||
          placeIdx === -1 ||
          infoIdx === -1
        ) {
          notes.push(`tokyotango: tab ${gid} missing required columns`);
          continue;
        }

        // Process data rows
        for (let i = 1; i < rows.length; i++) {
          const row = rows[i] ?? [];
          const title = row[titleIdx]?.trim() || "";
          const dateRaw = row[dateIdx]?.trim() || "";
          const timeRaw = row[timeIdx]?.trim() || "";
          const place = row[placeIdx]?.trim() || "";
          const maps = mapsIdx >= 0 ? row[mapsIdx]?.trim() || "" : "";
          const info = row[infoIdx]?.trim() || "";

          if (!title && !dateRaw) {
            continue;
          }

          allRows.push({
            title,
            date: dateRaw,
            time: timeRaw,
            place,
            maps,
            info,
          });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        notes.push(`tokyotango: tab ${gid} failed (${message})`);
        failedTabs++;
      }
    }

    if (failedTabs === TOKYOTANGO_TABS.length) {
      throw new Error("tokyotango: download failed");
    }

    // Use the fetchedAt from the first successful response, or current time if none
    const fetchedAt = firstFetchedAt || new Date();

    // Process rows into listings
    const listings: HarvestedListing[] = [];
    const seenKeys = new Set<string>();
    let skippedEmpty = 0;
    let skippedOutside = 0;

    // First night for year resolution
    const firstNight = nights[0];
    if (!firstNight) {
      return {
        listings: [],
        notes: [...notes],
        screened: [],
      };
    }

    for (const row of allRows) {
      // Skip rows with empty title or unreadable date
      if (!row.title.trim()) {
        skippedEmpty++;
        continue;
      }

      // Parse date
      const dateMatch = row.date.match(/^(\d{1,2})\/(\d{1,2})$/);
      if (!dateMatch) {
        skippedEmpty++;
        continue;
      }

      const fullDate = yearFor(row.date, firstNight);

      // Check if in nights
      const startTime = normalizeTime(row.time);
      if (!startTime) {
        skippedEmpty++;
        continue;
      }

      const start = localMoment(fullDate, startTime, metro.tz);
      if (!nights.includes(start.night)) {
        continue;
      }

      // Extract address to check for Tokyo address
      const address = extractAddress(row.info);
      const hasTokyoAddress = address !== null;

      // Check if outside metro
      if (isOutsideMetro(row.place, row.info, hasTokyoAddress, row.maps, row.title)) {
        skippedOutside++;
        continue;
      }

      // Deduplicate by title+date+time+place
      const key = `${row.title}|${fullDate}|${startTime}|${row.place}`;
      if (seenKeys.has(key)) {
        continue;
      }
      seenKeys.add(key);

      // Prepare listing data
      const title = collapseWhitespace(row.title);
      const type = getEventType(title);
      const styles: StyleKey[] = ["tango"];

      const endTime = extractEndTime(row.info, startTime);
      let end: LocalMoment | null = null;
      if (endTime) {
        // Determine if end crosses midnight
        const startHour = parseInt(startTime.split(":")[0] ?? "0", 10);
        const endHour = parseInt(endTime.split(":")[0] ?? "0", 10);
        const endDay =
          endHour < startHour && endHour < 12 ? addCalendarDays(fullDate, 1) : fullDate;
        end = localMoment(endDay, endTime, metro.tz);
        // Only use if same night
        if (end.night !== start.night) {
          end = null;
        }
      }

      const venueName = row.place.trim();
      // address already extracted above
      const description = row.info.trim().slice(0, 1000);

      const externalId = sha256(key);

      listings.push(
        buildListing(
          {
            externalId,
            title,
            start,
            end,
            description,
            venue: {
              name: venueName,
              address,
              url: null,
              location: null,
            },
            organizer: { name: null, url: null },
            prices: null,
            ticketUrl: null,
            eventUrl: TOKYOTANGO_PAGE,
            cancelled: false,
            styles,
            type,
          },
          {
            sourceUrl: tabUrl(TOKYOTANGO_TABS[0]),
            fetchedAt: fetchedAt,
            method: "api",
            currency: "JPY",
          },
        ),
      );
    }

    if (skippedEmpty > 0) {
      notes.push(`tokyotango: ${skippedEmpty} rows skipped (empty title or unreadable date)`);
    }
    if (skippedOutside > 0) {
      notes.push(`tokyotango: ${skippedOutside} rows skipped (outside Tokyo metro)`);
    }

    notes.push(`tokyotango: ${allRows.length} rows, ${listings.length} listings`);

    return {
      listings,
      notes,
      screened: [],
      doc: {
        url: tabUrl(TOKYOTANGO_TABS[0]),
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
