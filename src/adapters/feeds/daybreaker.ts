// Daybreaker's list of city cards, each linking to an event page (D-111). The page lists events
// for many cities; we keep only cards whose URL matches the metro's city path and read the venue
// from each event page. A fixed reader replaces the model, which wrote other cities' nights into
// New York and never placed New York's.

import {
  decodeEntities,
  httpUrl,
  isoToLocal,
  sha256,
  type LocalMoment,
} from "@/src/adapters/shared";
import { HttpError } from "@/src/pipeline/http";
import { buildListing, type StructuredEvent } from "@/src/adapters/structured";
import { withSourceStyle } from "@/src/adapters/feeds/event-pages";
import { currencyForCountry } from "@/src/domain/prices";
import { addCalendarDays } from "@/src/domain/time";
import { currentNightDate } from "@/src/domain/tonight";
import { MATERIALIZE_DAYS } from "@/src/domain/recurrence";
import { CRAWL_INTERVAL_MS } from "@/src/pipeline/http";
import type {
  HarvestResult,
  HarvestedListing,
  RunCtx,
  Source,
  SourceAdapter,
  ProvenanceMethod,
} from "@/src/adapters/types";

export interface DaybreakerCard {
  url: string;
  day: string; // YYYY-MM-DD
  start: string | null; // HH:MM
  end: string | null; // HH:MM
  endNextDay: boolean;
  city: string;
  title: string;
}

const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
};

function parseDate(text: string): string | null {
  const m = text.trim().match(/^([a-z]+)\s+(\d{1,2}),\s+(\d{4})$/i);
  if (!m) return null;
  const month = MONTHS[(m[1] ?? "").toLowerCase()];
  if (!month) return null;
  const day = parseInt(m[2] ?? "", 10);
  const year = parseInt(m[3] ?? "", 10);
  if (day < 1 || day > 31) return null;
  return `${year}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
}

function parseTimeRange(text: string): {
  start: string | null;
  end: string | null;
  endNextDay: boolean;
} {
  const trimmed = text.trim();
  // Regex to capture start hour, minute, start period (optional), end hour, minute, end period
  const m = trimmed.match(
    /^(\d{1,2})(?::(\d{2}))?\s*([AP]M)?\s*[-–]\s*(\d{1,2})(?::(\d{2}))?\s*([AP]M)/i,
  );
  if (!m) {
    return { start: null, end: null, endNextDay: false };
  }
  const [, startHourStr, startMinuteStr, startPeriod, endHourStr, endMinuteStr, endPeriod] = m;
  const startHour = startHourStr ? parseInt(startHourStr, 10) : 0;
  const startMinute = startMinuteStr ? parseInt(startMinuteStr, 10) : 0;
  const endHour = endHourStr ? parseInt(endHourStr, 10) : 0;
  const endMinute = endMinuteStr ? parseInt(endMinuteStr, 10) : 0;
  if (startHour < 1 || startHour > 12 || endHour < 1 || endHour > 12) {
    return { start: null, end: null, endNextDay: false };
  }
  // Determine which period to use for start
  const startPeriodUpper = (startPeriod ?? endPeriod ?? "").toUpperCase();
  const endPeriodUpper = (endPeriod ?? "").toUpperCase();
  const start = hour12to24(startHour, startMinute, startPeriodUpper);
  const end = hour12to24(endHour, endMinute, endPeriodUpper);
  if (start === null || end === null) {
    return { start: null, end: null, endNextDay: false };
  }
  // Determine if end is on the next day
  let endNextDay = false;
  if (end <= start) {
    endNextDay = true;
  }
  return { start, end, endNextDay };
}

function hour12to24(hour: number, minute: number, period: string): string | null {
  if (hour < 1 || hour > 12) return null;
  if (minute < 0 || minute > 59) return null;
  let h = hour;
  if (period === "AM") {
    if (h === 12) h = 0;
  } else if (period === "PM") {
    if (h !== 12) h += 12;
  } else {
    return null;
  }
  return `${h.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`;
}

export function daybreakerCards(html: string): DaybreakerCard[] {
  const cards: DaybreakerCard[] = [];
  // Every anchor, its attributes in any order: the page writes `<a href="..." class="list-grid">`.
  const anchors = [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)].map((m) => ({
    attrs: m[1] ?? "",
    inner: m[2] ?? "",
    href: /\bhref\s*=\s*["']([^"']+)["']/i.exec(m[1] ?? "")?.[1]?.trim() ?? "",
    end: (m.index ?? 0) + m[0].length,
  }));
  const hasClass = (attrs: string, name: string) =>
    new RegExp(`\\bclass\\s*=\\s*["'][^"']*\\b${name}\\b[^"']*["']`, "i").test(attrs);
  for (const [i, anchor] of anchors.entries()) {
    if (!hasClass(anchor.attrs, "list-grid")) continue;
    const { href, inner } = anchor;
    if (!href) continue;
    const url = httpUrl(decodeEntities(href), "https://www.daybreaker.com");
    if (!url) continue;
    // Extract date from time-date div
    const dateDivMatch = inner.match(/<div[^>]*>\s*([^<]+?)\s*<\/div>/);
    if (!dateDivMatch) continue;
    const dateText = decodeEntities(dateDivMatch[1] ?? "").trim();
    const day = parseDate(dateText);
    if (!day) continue;
    // Extract time range (second div inside time-date)
    const timeDivs = inner.match(/<div[^>]*>([^<]+)<\/div>/g);
    if (!timeDivs || timeDivs.length < 2) continue;
    const timeText = decodeEntities((timeDivs[1] ?? "").replace(/<\/?[^>]+>/g, "").trim());
    const { start, end, endNextDay } = parseTimeRange(timeText);
    // Extract city from h3
    const cityMatch = inner.match(/<h3[^>]*>([^<]+)<\/h3>/);
    const city = cityMatch ? decodeEntities(cityMatch[1] ?? "").trim() : "";
    // The card's title: the label of the next ticket anchor with the same link.
    const ticket = anchors.slice(i + 1).find((t) => t.href === href && hasClass(t.attrs, "ticket"));
    if (!ticket) continue;
    const ticketInner = ticket.inner;
    const labelMatch =
      ticketInner.match(/<div[^>]*class\s*=\s*["']btn-label["'][^>]*>([^<]+)<\/div>/i) ||
      ticketInner.match(/btn-label[^>]*>([^<]+)</i);
    const title = labelMatch ? decodeEntities(labelMatch[1] ?? "").trim() : "";
    if (!title) continue;
    cards.push({
      url,
      day,
      start,
      end,
      endNextDay,
      city,
      title,
    });
  }
  return cards;
}

export function daybreakerWhere(html: string): string | null {
  // Find element containing the word "Where" (case-insensitive)
  const whereRegex = /<[^>]*>[^<]*\bWhere\b[^<]*<\/[^>]*>/i;
  const match = whereRegex.exec(html);
  if (!match) return null;
  // Look for the next <p> after this element
  const after = html.substring(match.index + match[0].length);
  const pMatch = after.match(/<p[^>]*>([^<]+)<\/p>/i);
  if (!pMatch) return null;
  const text = decodeEntities(pMatch[1] ?? "").trim();
  return text || null;
}

const CITY_PATHS: Record<string, string> = {
  nyc: "/event/new-york-",
};

export const daybreakerAdapter: SourceAdapter = {
  id: "daybreaker",
  tier: "A",
  limits: { perDomainIntervalMs: CRAWL_INTERVAL_MS },
  async harvest(source: Source, ctx: RunCtx): Promise<HarvestResult> {
    const url = source.feedUrl ?? source.url;
    const page = await ctx.http.request({
      url,
      purpose: "crawl",
      headers: { accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1" },
    });
    const pageUrl = page.url || url;
    const cards = daybreakerCards(page.body);
    if (cards.length === 0) {
      return { listings: [], readWithModel: "the page shows no Daybreaker event cards" };
    }
    const metroSlug = ctx.metro.slug;
    const cityPath = CITY_PATHS[metroSlug];
    if (!cityPath) {
      return { listings: [], readWithModel: "Daybreaker has no city page for this metro" };
    }
    const kept = cards.filter((card) => {
      try {
        const url = new URL(card.url);
        return url.pathname.startsWith(cityPath);
      } catch {
        return false;
      }
    });
    const other = cards.length - kept.length;
    const notes: string[] = [];
    if (other > 0) {
      notes.push(`${other} other cities' night(s) left out`);
    }
    const fromNight = currentNightDate(ctx.now(), ctx.metro.tz);
    const lastNight = addCalendarDays(fromNight, MATERIALIZE_DAYS - 1);
    const inWindow = kept.filter((card) => {
      const cardNight = card.day; // day is already YYYY-MM-DD
      return cardNight >= fromNight && cardNight <= lastNight;
    });
    const reading = inWindow.slice(0, 10);
    const listings: HarvestedListing[] = [];
    for (const card of reading) {
      let where: string | null = null;
      let why: string | null = null;
      try {
        const eventPage = await ctx.http.request({
          url: card.url,
          purpose: "crawl",
          headers: { accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1" },
        });
        if (eventPage.status >= 200 && eventPage.status < 300) {
          where = daybreakerWhere(eventPage.body);
        } else {
          why = `status ${eventPage.status}`;
        }
      } catch (error) {
        why = error instanceof HttpError ? error.kind : "error";
      }
      if (why !== null) {
        notes.push(`${card.title} on ${card.day}: its page could not be read (${why})`);
      }
      // Build start LocalMoment
      let startMoment: LocalMoment;
      if (card.start) {
        const iso = `${card.day}T${card.start}`;
        const local = isoToLocal(iso, ctx.metro.tz);
        if (!local) {
          // fallback: date only
          startMoment = isoToLocal(card.day, ctx.metro.tz) ?? {
            day: card.day,
            night: card.day,
            time: null,
            zone: ctx.metro.tz,
            absolute: false,
          };
        } else {
          startMoment = local;
        }
      } else {
        const local = isoToLocal(card.day, ctx.metro.tz);
        startMoment = local ?? {
          day: card.day,
          night: card.day,
          time: null,
          zone: ctx.metro.tz,
          absolute: false,
        };
      }
      // Build end LocalMoment
      let endMoment: LocalMoment | null = null;
      if (card.end) {
        let endDay = card.day;
        if (card.endNextDay) {
          endDay = addCalendarDays(card.day, 1);
        }
        const iso = `${endDay}T${card.end}`;
        const local = isoToLocal(iso, ctx.metro.tz);
        if (local) {
          endMoment = local;
        }
      }
      const structured: StructuredEvent = {
        externalId: card.url,
        title: card.title,
        start: startMoment,
        end: endMoment,
        description: null,
        venue: {
          name: where,
          address: null,
          url: null,
          location: null,
        },
        organizer: { name: "Daybreaker", url: null },
        prices: null,
        ticketUrl: null,
        eventUrl: card.url,
        cancelled: false,
      };
      const currency = currencyForCountry(ctx.metro.countryCode);
      const built = buildListing(structured, {
        sourceUrl: pageUrl,
        fetchedAt: page.fetchedAt,
        method: "feed",
        currency,
      });
      const styled = withSourceStyle(built, source.styles);
      listings.push(styled);
    }
    const whole = inWindow.length <= 10;
    if (!whole) {
      notes.push(`${inWindow.length - 10} night(s) after the first 10 not read`);
    }
    // Titles of other-city cards left out
    const leftOutTitles: string[] = [];
    if (whole) {
      const keptUrls = new Set(kept.map((c) => c.url));
      const otherCards = cards.filter((c) => !keptUrls.has(c.url));
      const seen = new Set<string>();
      for (const card of otherCards) {
        const title = card.title.trim();
        if (title && !seen.has(title)) {
          seen.add(title);
          leftOutTitles.push(title);
        }
      }
    }
    const doc = {
      url: pageUrl,
      fetchedAt: page.fetchedAt,
      httpStatus: page.status,
      etag: page.etag,
      lastModified: page.lastModified,
      contentHash: sha256(JSON.stringify(listings.map((l) => [l.externalId, l.listing]))),
      cleanedText: null,
    };
    return {
      listings,
      notes,
      ...(whole ? { whole: true as const } : {}),
      ...(whole && leftOutTitles.length > 0 ? { leftOutTitles } : {}),
      doc,
    };
  },
};
