// tango-argentin.fr daily milonga RSS reader and Ile-de-France agenda parser (tango_argentin)
// Reads either https://tango-argentin.fr/daymilongas (RSS feed of today's milongas) or
// https://tango-argentin.fr/ile-de-france (HTML agenda of about 8 weeks of milongas in Ile-de-France).
// Keeps only the Ile-de-France items and turns each into a listing.

import {
  httpUrl,
  isoToLocal,
  plainText,
  sha256,
  decodeEntities,
  type LocalMoment,
} from "@/src/adapters/shared";
import { buildListing, inWindow, type StructuredEvent } from "@/src/adapters/structured";
import type {
  HarvestedListing,
  HarvestResult,
  RunCtx,
  Source,
  SourceAdapter,
} from "@/src/adapters/types";
import { currencyForCountry } from "@/src/domain/prices";
import { MATERIALIZE_DAYS } from "@/src/domain/recurrence";
import { currentNightDate } from "@/src/domain/tonight";
import { CRAWL_INTERVAL_MS } from "@/src/pipeline/http";
import { addCalendarDays } from "@/src/domain/time";

export interface TangoArgentinItem {
  title: string | null;
  link: string | null;
  guid: string | null;
  date: string | null; // YYYY-MM-DD
  time: string | null; // HH:MM
  endTime: string | null; // HH:MM, from agenda page only
  address: string | null;
  info: string | null;
  when: string | null; // Raw Rendez-vous text
}

/**
 * Parse French month name to month number (1-12).
 * Handles both accented and unaccented variants.
 */
function frenchMonthToNumber(month: string): number | null {
  const months: Record<string, number> = {
    janvier: 1,
    fevrier: 2,
    février: 2,
    mars: 3,
    avril: 4,
    mai: 5,
    juin: 6,
    juillet: 7,
    aout: 8,
    août: 8,
    septembre: 9,
    octobre: 10,
    novembre: 11,
    decembre: 12,
    décembre: 12,
  };
  const normalized = month.toLowerCase();
  return months[normalized] ?? null;
}

/**
 * Parse "Rendez-vous : vendredi  6 novembre 2026 20h00" into date and time.
 * Returns { date: "YYYY-MM-DD", time: "HH:MM" } or both null if unparseable.
 */
function parseRendezVous(text: string): { date: string | null; time: string | null } {
  // Trim and normalize spaces
  const trimmed = text.trim();
  // Pattern: optional weekday, day, month, year, time
  // The time can be HHhMM or HHh
  // Use [a-zA-ZéûèàâêîôûçÉÈÀÂÊÎÔÛÇ] for French letters
  const match = trimmed.match(
    /(?:[a-zA-ZéûèàâêîôûçÉÈÀÂÊÎÔÛÇ]+\s+)?(\d{1,2})\s+([a-zA-ZéûèàâêîôûçÉÈÀÂÊÎÔÛÇ]+)\s+(\d{4})\s+(\d{1,2})h(\d{2})?/i,
  );
  if (!match) {
    // Try without minutes: HHh
    const matchNoMinutes = trimmed.match(
      /(?:[a-zA-ZéûèàâêîôûçÉÈÀÂÊÎÔÛÇ]+\s+)?(\d{1,2})\s+([a-zA-ZéûèàâêîôûçÉÈÀÂÊÎÔÛÇ]+)\s+(\d{4})\s+(\d{1,2})h\b/i,
    );
    if (!matchNoMinutes) {
      return { date: null, time: null };
    }
    const day = parseInt(matchNoMinutes[1] ?? "0", 10);
    const monthName = matchNoMinutes[2] ?? "";
    const year = parseInt(matchNoMinutes[3] ?? "0", 10);
    const hour = parseInt(matchNoMinutes[4] ?? "0", 10);
    const month = frenchMonthToNumber(monthName);
    if (month === null || day < 1 || day > 31 || hour < 0 || hour > 23) {
      return { date: null, time: null };
    }
    const date = `${year}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
    const time = `${hour.toString().padStart(2, "0")}:00`;
    return { date, time };
  }
  const day = parseInt(match[1] ?? "0", 10);
  const monthName = match[2] ?? "";
  const year = parseInt(match[3] ?? "0", 10);
  const hour = parseInt(match[4] ?? "0", 10);
  const minutes = match[5] ? parseInt(match[5], 10) : 0;
  const month = frenchMonthToNumber(monthName);
  if (
    month === null ||
    day < 1 ||
    day > 31 ||
    hour < 0 ||
    hour > 23 ||
    minutes < 0 ||
    minutes > 59
  ) {
    return { date: null, time: null };
  }
  const date = `${year}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
  const time = `${hour.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`;
  return { date, time };
}

/**
 * Extract postcode from address string.
 * Returns the 5-digit postcode if found, else null.
 */
function extractPostcode(address: string): string | null {
  const match = address.match(/\b(\d{5})\b/);
  return match?.[1] ?? null;
}

/**
 * Whether a postcode belongs to Ile-de-France (first two digits 75,77,78,91,92,93,94,95).
 */
function isIleDeFrance(postcode: string): boolean {
  const prefix = postcode.slice(0, 2);
  return ["75", "77", "78", "91", "92", "93", "94", "95"].includes(prefix);
}

export function parseTangoArgentinAgenda(html: string): TangoArgentinItem[] {
  const items: TangoArgentinItem[] = [];
  // Split by date headings
  const headingRegex = /<h6\s+class="ta-red[^"]*"[^>]*>([^<]+)<\/h6>/gi;
  const heads = [...html.matchAll(headingRegex)];
  if (heads.length === 0) {
    return items;
  }

  for (let i = 0; i < heads.length; i++) {
    const m = heads[i];
    if (!m) continue;
    const heading = m[1] ?? "";
    const from = (m.index ?? 0) + (m[0]?.length ?? 0);
    const nextHead = heads[i + 1];
    const to = nextHead ? (nextHead.index ?? html.length) : html.length;
    const content = html.slice(from, to);

    // Parse date from heading: "lundi 9 novembre 2026"
    let date: string | null = null;
    if (heading) {
      const dateMatch = heading.match(/(\d{1,2})\s+([a-zA-ZéûèàâêîôûçÉÈÀÂÊÎÔÛÇ]+)\s+(\d{4})/i);
      if (dateMatch) {
        const day = parseInt(dateMatch[1] ?? "", 10);
        const monthName = dateMatch[2] ?? "";
        const year = parseInt(dateMatch[3] ?? "", 10);
        const month = frenchMonthToNumber(monthName);
        if (month !== null && day >= 1 && day <= 31) {
          date = `${year}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
        }
      }
    }

    // Find all onclick spans directly
    const onclickRegex = /<span[^>]*onclick="location\.href='([^']+)'[^>]*>([^<]+)<\/span>/g;
    let match;
    while ((match = onclickRegex.exec(content)) !== null) {
      const fullMatch = match[0] ?? "";
      const rawLink = match[1] ?? "";
      const rawTitle = match[2] ?? "";

      // Remove query parameters
      const path = rawLink.split("?")[0];
      const link = `https://tango-argentin.fr${path}`;

      // Extract title
      const title = decodeEntities(rawTitle).trim();
      if (!title) continue;

      // Find the surrounding <tr>...</tr> block for this span
      const startIndex = match.index ?? 0;
      const endIndex = startIndex + fullMatch.length;

      // Find the start of the row
      const rowStart = content.lastIndexOf("<tr", startIndex);
      if (rowStart === -1) continue;

      // Find the end of the row
      let rowEnd = content.indexOf("</tr>", endIndex);
      if (rowEnd === -1) continue;
      rowEnd += "</tr>".length;

      const row = content.substring(rowStart, rowEnd);

      // Extract time from ta-red span (fallback)
      let time: string | null = null;
      const timeCellMatch = row.match(/<span[^>]*class="ta-red"[^>]*>([^<]+)<\/span>/);
      if (timeCellMatch) {
        const rawTime = (timeCellMatch[1] ?? "").trim();
        const timeMatch = rawTime.match(/(\d{1,2})h(\d{2})?/);
        if (timeMatch) {
          const hour = (timeMatch[1] ?? "").padStart(2, "0");
          const minute = timeMatch[2] ? (timeMatch[2] ?? "").padStart(2, "0") : "00";
          time = `${hour}:${minute}`;
        }
      }

      // Extract address and end time from the text after the title span
      let address: string | null = null;
      let endTime: string | null = null;
      // Find the position just after the title span closes
      const afterTitleIdx = row.indexOf("</span>", startIndex - rowStart);
      if (afterTitleIdx !== -1) {
        const after = row.slice(afterTitleIdx + "</span>".length);
        const addrMatch = after.match(/^\s*<span[^>]*>([\s\S]*?)<i class="fa fa-clock-o/);
        if (addrMatch) {
          address =
            decodeEntities(addrMatch[1] ?? "")
              .replace(/\s+/g, " ")
              .trim() || null;
        }
        // Look for hours pattern in the same after string
        const hoursMatch = after.match(/de\s+(\d{1,2})h(\d{2})?\s+à\s+(\d{1,2})h(\d{2})?/);
        if (hoursMatch) {
          // Prefer start time from hours pattern
          const startHour = (hoursMatch[1] ?? "").padStart(2, "0");
          const startMinute = hoursMatch[2] ? (hoursMatch[2] ?? "").padStart(2, "0") : "00";
          time = `${startHour}:${startMinute}`;
          const endHour = (hoursMatch[3] ?? "").padStart(2, "0");
          const endMinute = hoursMatch[4] ? (hoursMatch[4] ?? "").padStart(2, "0") : "00";
          endTime = `${endHour}:${endMinute}`;
        }
      }

      // Extract info: price and DJ text
      const infoParts: string[] = [];
      // Price after euro icon
      const priceMatch = row.match(/<i class="fa fa-eur[^>]*><\/i>([^<]+)/);
      if (priceMatch) {
        const priceText = decodeEntities(priceMatch[1] ?? "").trim();
        if (priceText) infoParts.push(priceText);
      }
      // DJ text
      const djMatch = row.match(/<i class="fa fa-headphones"><\/i>\s*DJ\s*:\s*([^<]+)/);
      if (djMatch) {
        const djText = decodeEntities(djMatch[1] ?? "").trim();
        if (djText) infoParts.push(`DJ : ${djText}`);
      }
      // Also look for DJ info in badge spans
      const badgeMatch = row.match(
        /<span class="badge[^>]*>.*?<i class="fa fa-headphones"><\/i>\s*DJ\s*:\s*([^<]+)/,
      );
      if (badgeMatch && !infoParts.some((p) => p.includes("DJ"))) {
        const djText = decodeEntities(badgeMatch[1] ?? "").trim();
        if (djText) infoParts.push(`DJ : ${djText}`);
      }
      const info = infoParts.length > 0 ? infoParts.join(" · ") : null;

      // Determine final date: check ?d= parameter
      let finalDate = date;
      const queryMatch = rawLink.match(/\?d=(\d{4}-\d{2}-\d{2})/);
      if (queryMatch) {
        finalDate = queryMatch[1] ?? date;
      }

      // Construct when string
      let when: string | null = null;
      if (heading && time && endTime) {
        when = `${heading} de ${time.replace(":", "h")} à ${endTime.replace(":", "h")}`;
      } else if (heading && time) {
        when = `${heading} ${time.replace(":", "h")}`;
      }

      items.push({
        title,
        link,
        guid: null,
        date: finalDate,
        time,
        endTime,
        address,
        info,
        when,
      });
    }
  }
  return items;
}

export function parseTangoArgentinFeed(xml: string): TangoArgentinItem[] {
  const items: TangoArgentinItem[] = [];
  // Split on <item>...</item>
  const itemMatches = xml.match(/<item>(.*?)<\/item>/gs);
  if (!itemMatches) return items;

  for (const itemXml of itemMatches) {
    function extract(tag: string): string | null {
      const pattern = new RegExp(`<${tag}[^>]*>(.*?)</${tag}>`, "is");
      const match = itemXml.match(pattern);
      if (!match) return null;
      let text = match[1] ?? "";
      // Decode HTML entities
      text = decodeEntities(text);
      // Trim
      const trimmed = text.trim();
      return trimmed || null;
    }

    const title = extract("title");
    let link = extract("link");
    if (link) link = link.trim(); // The fixture has spaces around URLs
    const guid = extract("guid");
    const description = extract("description");

    let date: string | null = null;
    let time: string | null = null;
    let address: string | null = null;
    let info: string | null = null;
    let when: string | null = null;

    if (description) {
      // Extract Rendez-vous - look for pattern up to </li>
      const rendezVousMatch = description.match(/Rendez-vous\s*:\s*(.*?)(?=<\/li>|$)/i);
      if (rendezVousMatch) {
        const rendezVousText = decodeEntities(rendezVousMatch[1] ?? "");
        // Store raw text (collapsed whitespace)
        when = rendezVousText.replace(/\s+/g, " ").trim();
        const parsed = parseRendezVous(rendezVousText);
        date = parsed.date;
        time = parsed.time;
      }

      // Extract Adresse
      const adresseMatch = description.match(/Adresse\s*:\s*(.*?)(?=<\/li>|$)/i);
      if (adresseMatch) {
        const raw = adresseMatch[1];
        address = raw ? decodeEntities(raw).trim() : null;
      }

      // Extract Infos
      const infosMatch = description.match(/Infos\s*:\s*(.*?)(?=<\/li>|$)/i);
      if (infosMatch) {
        const rawInfo = infosMatch[1] ?? "";
        info = (plainText(decodeEntities(rawInfo)) ?? "").trim() || null;
      }
    }

    items.push({
      title,
      link,
      guid,
      date,
      time,
      endTime: null,
      address,
      info,
      when,
    });
  }
  return items;
}

export const tangoArgentinAdapter: SourceAdapter = {
  id: "tango_argentin",
  tier: "A",
  limits: { perDomainIntervalMs: CRAWL_INTERVAL_MS },
  async harvest(source: Source, ctx: RunCtx): Promise<HarvestResult> {
    // Determine feed URL
    const feedUrl = source.feedUrl ?? source.url;
    const fromNight = currentNightDate(ctx.now(), ctx.metro.tz);
    const response = await ctx.http.request({
      url: feedUrl,
      purpose: "crawl",
      headers: { accept: "text/html, application/rss+xml, application/xml, text/xml" },
      conditional: { etag: source.etag, lastModified: source.lastModified },
    });
    if (response.notModified) return { listings: [], unchanged: true };
    const body = response.body;
    let items: TangoArgentinItem[];
    if (body.includes("<rss")) {
      items = parseTangoArgentinFeed(body);
    } else if (body.includes('<h6 class="ta-red')) {
      items = parseTangoArgentinAgenda(body);
    } else {
      throw new Error("not a tango-argentin.fr feed or agenda page");
    }
    const contentHash = sha256(JSON.stringify(items));
    const doc = {
      url: feedUrl,
      fetchedAt: response.fetchedAt,
      httpStatus: response.status,
      etag: response.etag,
      lastModified: response.lastModified,
      contentHash,
      cleanedText: null,
    };
    if (source.contentHash === contentHash) return { listings: [], unchanged: true, doc };

    // If agenda page returns 0 items, treat as a layout change that must not retire stored listings
    if (items.length === 0 && body.includes('<h6 class="ta-red')) {
      throw new Error("tango-argentin.fr agenda page had no rows");
    }

    const fallbackCurrency = currencyForCountry(ctx.metro.countryCode);
    const listings: HarvestedListing[] = [];
    const notes: string[] = [];
    let outsideIleDeFranceCount = 0;
    const seenIds = new Set<string>();
    let duplicateCount = 0;

    for (const item of items) {
      if (!item.title || !item.link) continue;

      // Check date
      if (!item.date) {
        notes.push(`no readable date: ${item.title}`);
        continue;
      }

      // Check postcode
      const postcode = item.address ? extractPostcode(item.address) : null;
      if (!postcode || !isIleDeFrance(postcode)) {
        outsideIleDeFranceCount++;
        continue;
      }

      // Check window
      if (!inWindow(item.date, fromNight, MATERIALIZE_DAYS)) {
        continue;
      }

      // Build start
      const startDateTime = item.time ? `${item.date}T${item.time}` : item.date;
      const start = isoToLocal(startDateTime, ctx.metro.tz);
      if (!start) continue;

      // Build end if endTime exists
      let end: LocalMoment | null = null;
      if (item.endTime && item.time) {
        // "HH:MM" strings compare in time order: an end at or before the start is after midnight.
        const endDate = item.endTime <= item.time ? addCalendarDays(item.date, 1) : item.date;
        const endDateTime = `${endDate}T${item.endTime}`;
        end = isoToLocal(endDateTime, ctx.metro.tz);
      }

      const evidence: Record<string, string> = {};
      if (item.when) {
        evidence.start = item.when.slice(0, 300);
      }
      if (item.address) {
        evidence.venue_address = item.address.slice(0, 300);
      }

      // External id: guid ?? link : date (RSS items have guid, agenda items have guid null)
      const externalId = `${item.guid ?? item.link}:${item.date}`;
      if (seenIds.has(externalId)) {
        duplicateCount++;
        continue;
      }
      seenIds.add(externalId);
      const eventUrl = httpUrl(item.link);

      const structuredEvent: StructuredEvent = {
        externalId,
        title: item.title,
        start,
        end,
        description: item.info,
        venue: {
          name: null,
          address: item.address,
          url: null,
          location: null,
        },
        organizer: { name: null, url: null },
        prices: null,
        ticketUrl: null,
        eventUrl,
        cancelled: false,
        styles: ["tango"],
        evidence,
      };

      listings.push(
        buildListing(structuredEvent, {
          sourceUrl: feedUrl,
          fetchedAt: response.fetchedAt,
          method: "api",
          currency: fallbackCurrency,
        }),
      );
    }

    if (duplicateCount > 0) {
      notes.push(`${duplicateCount} duplicate row(s) skipped`);
    }

    if (outsideIleDeFranceCount > 0) {
      notes.push(`${outsideIleDeFranceCount} item(s) outside Ile-de-France skipped`);
    }

    return { listings, notes, doc };
  },
};
