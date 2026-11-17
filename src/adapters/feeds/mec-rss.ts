// WordPress Modern Events Calendar RSS feed (mec_rss) adapter.
// Reads `<category page>/feed/` where each `<item>` has mec:startDate, mec:startHour, etc.
// Fields: title, link, description, mec:startDate, mec:startHour, mec:endDate, mec:endHour,
// mec:location, mec:category.

import { httpUrl, isoToLocal, plainText, sha256, decodeEntities } from "@/src/adapters/shared";
import { extractJsonLd } from "@/src/adapters/feeds/jsonld";
import { buildListing, inWindow } from "@/src/adapters/structured";
import type {
  HarvestedListing,
  HarvestResult,
  RunCtx,
  Source,
  SourceAdapter,
} from "@/src/adapters/types";
import { currencyForCountry } from "@/src/domain/prices";
import { MATERIALIZE_DAYS } from "@/src/domain/recurrence";
import { matchStyles, type StyleKey } from "@/config/styles";
import { addCalendarDays } from "@/src/domain/time";
import { weeklyRuleFromCalendarLink } from "@/src/pipeline/event-page-weekly";
import { currentNightDate } from "@/src/domain/tonight";
import { CRAWL_INTERVAL_MS } from "@/src/pipeline/http";

export interface MecItem {
  title: string | null;
  link: string | null;
  description: string | null;
  startDate: string | null;
  startHour: string | null;
  endDate: string | null;
  endHour: string | null;
  location: string | null;
  categories: string | null;
  guid: string | null;
}

/**
 * Strip a leading area label from a title (D-515).
 * Matches /^[^:]{2,40}:\s+/ at the very start of the title.
 * If matched and the rest (trimmed) is 4 or more characters, returns the rest trimmed.
 * Otherwise returns the title unchanged.
 */
export function stripAreaPrefix(title: string): string {
  const match = title.match(/^([^:]{2,40}):\s+/);
  if (!match) return title;
  const rest = title.slice(match[0].length).trim();
  if (rest.length >= 4) {
    return rest;
  }
  return title;
}

/**
 * Parse an MEC RSS feed XML string into an array of items.
 */
export function parseMecFeed(xml: string): MecItem[] {
  const items: MecItem[] = [];
  // Split on <item>...</item>
  const itemMatches = xml.match(/<item>(.*?)<\/item>/gs);
  if (!itemMatches) return items;

  for (const itemXml of itemMatches) {
    function extract(tag: string): string | null {
      const pattern = new RegExp(`<${tag}[^>]*>(.*?)</${tag}>`, "is");
      const match = itemXml.match(pattern);
      if (!match) return null;
      let text = match[1] ?? "";
      // Strip CDATA wrapper
      if (text.includes("<![CDATA[")) {
        const cdataMatch = text.match(/<!\[CDATA\[(.*?)\]\]>/s);
        if (cdataMatch) text = cdataMatch[1] ?? "";
      }
      // Decode HTML entities
      text = decodeEntities(text);
      // Trim
      const trimmed = text.trim();
      return trimmed || null;
    }

    // Prefer content:encoded over description
    let description = extract("content:encoded");
    if (!description) description = extract("description");
    // If description still contains HTML tags, use plainText to strip them
    if (description) {
      description = plainText(description);
    }

    const title = extract("title");
    const link = extract("link");
    const guid = extract("guid");
    const startDate = extract("mec:startDate");
    const startHour = extract("mec:startHour");
    const endDate = extract("mec:endDate");
    const endHour = extract("mec:endHour");
    const location = extract("mec:location");
    const categories = extract("mec:category");

    items.push({
      title,
      link,
      description,
      startDate,
      startHour,
      endDate,
      endHour,
      location,
      categories,
      guid,
    });
  }
  return items;
}

/**
 * Extract venue name from an event page's JSON-LD.
 */
export function placeNameFromEventPage(html: string): string | null {
  try {
    const { blocks } = extractJsonLd(html);
    const walk = (value: unknown): string | null => {
      if (Array.isArray(value)) {
        for (const item of value) {
          const found = walk(item);
          if (found) return found;
        }
        return null;
      }
      if (typeof value === "object" && value !== null) {
        const obj = value as Record<string, unknown>;
        // Check location.name
        const location = obj.location;
        if (location && typeof location === "object" && location !== null) {
          const locObj = location as Record<string, unknown>;
          if (Array.isArray(locObj)) {
            const first = locObj[0];
            if (first && typeof first === "object") {
              const name = (first as Record<string, unknown>).name;
              if (typeof name === "string") {
                const decoded = decodeEntities(name).trim();
                if (decoded) return decoded;
              }
            }
          } else {
            const name = locObj.name;
            if (typeof name === "string") {
              const decoded = decodeEntities(name).trim();
              if (decoded) return decoded;
            }
          }
        }
        // Walk @graph
        const graph = obj["@graph"];
        if (graph) {
          const found = walk(graph);
          if (found) return found;
        }
        // Walk any other object values
        for (const key in obj) {
          if (key !== "location" && key !== "@graph") {
            const found = walk(obj[key]);
            if (found) return found;
          }
        }
      }
      return null;
    };
    return walk(blocks);
  } catch {
    return null;
  }
}

/**
 * Convert 12-hour time like "7:00 pm" to 24-hour "HH:MM".
 * Also accepts 24-hour times "HH:MM" (hours 0-23, minutes required).
 */
export function hour24(text: string | null): string | null {
  if (!text) return null;
  const trimmed = text.trim().toLowerCase();
  // First try 12-hour pattern: (hour)(optional :minutes) (am/pm)
  const match12 = trimmed.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/);
  if (match12) {
    let hour = parseInt(match12[1] ?? "0", 10);
    const minutes = match12[2] ? parseInt(match12[2], 10) : 0;
    const meridiem = match12[3] ?? "";
    if (hour < 1 || hour > 12) return null;
    if (minutes < 0 || minutes > 59) return null;
    // Convert 12-hour to 24-hour
    if (meridiem === "am") {
      if (hour === 12) hour = 0;
    } else {
      // pm
      if (hour !== 12) hour += 12;
    }
    return `${hour.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`;
  }
  // Try 24-hour pattern: H:MM or HH:MM, no am/pm
  const match24 = trimmed.match(/^(\d{1,2}):(\d{2})$/);
  if (match24) {
    const hour = parseInt(match24[1] ?? "0", 10);
    const minutes = parseInt(match24[2] ?? "0", 10);
    if (hour < 0 || hour > 23) return null;
    if (minutes < 0 || minutes > 59) return null;
    return `${hour.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`;
  }
  return null;
}

export interface MecToListingsOptions {
  siteUrl: string;
  fetchedAt: Date;
  metroTz: string;
  countryCode: string;
  fromNight: string;
  days?: number;
  mixedCalendar?: boolean;
  venueNames?: Map<string, string>;
  weeklyRules?: Map<string, string>;
  titleAreaPrefix?: boolean;
}

export function mecToListings(
  items: MecItem[],
  options: MecToListingsOptions,
): { listings: HarvestedListing[]; notes: string[] } {
  const days = options.days ?? MATERIALIZE_DAYS;
  const fallbackCurrency = currencyForCountry(options.countryCode);
  const listings: HarvestedListing[] = [];
  const notes: string[] = [];

  const madeWeeklyTitles: string[] = [];

  for (const item of items) {
    if (!item.title || !item.startDate) continue;
    const rawTitle = item.title;
    const title = options.titleAreaPrefix ? stripAreaPrefix(rawTitle) : rawTitle;
    const startDate = item.startDate;
    const startHour = hour24(item.startHour);
    let start: ReturnType<typeof isoToLocal> | null = null;
    if (startHour) {
      start = isoToLocal(`${startDate} ${startHour}:00`, options.metroTz);
    } else {
      start = isoToLocal(startDate, options.metroTz);
      if (start) {
        notes.push(`no start hour: ${title}`);
      }
    }
    if (!start) continue;

    const rule = item.link ? (options.weeklyRules?.get(item.link) ?? null) : null;

    // If rule exists and startHour exists, skip window filter
    if (rule && startHour) {
      // proceed without window check
    } else {
      if (!inWindow(start.night, options.fromNight, days)) continue;
    }

    let end: ReturnType<typeof isoToLocal> | null = null;
    const endHour = hour24(item.endHour);
    if (endHour) {
      let endDate = item.endDate || startDate;
      // If endDate equals startDate (same calendar day) and end hour is earlier than start hour and before 12:00, adjust to next day
      if (endDate === startDate && start.time) {
        const startHourNum = parseInt((start.time ?? "").split(":")[0] ?? "0", 10);
        const endHourNum = parseInt(endHour.split(":")[0] ?? "0", 10);
        if (endHourNum < startHourNum && endHourNum < 12) {
          // End hour is earlier and before noon, likely crossing midnight
          endDate = addCalendarDays(endDate, 1);
        }
      }
      const endDateTime = `${endDate} ${endHour}:00`;
      end = isoToLocal(endDateTime, options.metroTz);
      // Keep only if end.night === start.night (as wp-tribe does)
      if (end && end.night !== start.night) {
        end = null;
      }
    }

    const styles: StyleKey[] = [];
    if (!options.mixedCalendar) {
      const text = [item.title, item.categories].filter(Boolean).join(" ");
      if (text) {
        const matched = matchStyles(text);
        styles.push(...matched.styles);
      }
    }

    const evidence: Record<string, string> = {};
    evidence.start = `mec:startDate ${startDate} mec:startHour ${item.startHour ?? ""}`.slice(
      0,
      300,
    );
    if (endHour) {
      evidence.end_time = `mec:endHour ${item.endHour}`.slice(0, 300);
    }
    if (styles.length > 0 && item.categories) {
      evidence.styles = item.categories.slice(0, 300);
    }
    if (options.titleAreaPrefix && title !== rawTitle) {
      // The source's own title, label and all; evidence.title quotes the cleaned title (buildListing).
      evidence.raw_title = rawTitle.slice(0, 300);
    }

    // externalId: mec: + p number from guid, else mec: + link, plus startDate
    let externalId = `mec:${startDate}`;
    if (item.guid) {
      const pMatch = item.guid.match(/p=(\d+)/);
      if (pMatch) {
        externalId = `mec:${pMatch[1]}:${startDate}`;
      } else if (item.link) {
        externalId = `mec:${item.link}:${startDate}`;
      }
    } else if (item.link) {
      externalId = `mec:${item.link}:${startDate}`;
    }

    const eventUrl = httpUrl(item.link);
    const baseListing = {
      externalId,
      title,
      start,
      end,
      description: item.description,
      venue: {
        name: item.link ? (options.venueNames?.get(item.link) ?? null) : null,
        address: item.location,
        url: null,
        location: null,
      },
      organizer: { name: null, url: null },
      prices: null,
      ticketUrl: null,
      eventUrl,
      cancelled: false,
      styles,
      evidence,
    };

    // Apply weekly rule if present and startHour exists
    if (rule && startHour) {
      // Adjust externalId: remove trailing :startDate
      let ruleExternalId = externalId;
      if (ruleExternalId.endsWith(`:${startDate}`)) {
        ruleExternalId = ruleExternalId.slice(0, -`:${startDate}`.length);
      }
      // Add recurrence evidence
      const recurrenceEvidence = `Google Calendar link recur=RRULE:${rule}`.slice(0, 300);
      const listing = buildListing(
        {
          ...baseListing,
          externalId: ruleExternalId,
          evidence: { ...evidence, recurrence_text: recurrenceEvidence },
        },
        {
          sourceUrl: eventUrl ?? options.siteUrl,
          fetchedAt: options.fetchedAt,
          method: "api",
          currency: fallbackCurrency,
        },
      );
      // Override with recurrence and null local_date
      listing.listing.local_date = null;
      listing.recurrence = {
        rrule: rule,
        dtstartLocal: `${startDate}T${startHour}`,
        exdates: [],
        timeListed: true,
      };
      madeWeeklyTitles.push(title);
      listings.push(listing);
    } else {
      listings.push(
        buildListing(baseListing, {
          sourceUrl: eventUrl ?? options.siteUrl,
          fetchedAt: options.fetchedAt,
          method: "api",
          currency: fallbackCurrency,
        }),
      );
    }
  }
  if (madeWeeklyTitles.length > 0) {
    notes.push(
      `${madeWeeklyTitles.length} item(s) made weekly from their page's calendar link: ${madeWeeklyTitles.join("; ")}`,
    );
  }
  return { listings, notes };
}

export const mecRssAdapter: SourceAdapter = {
  id: "mec_rss",
  tier: "A",
  limits: { perDomainIntervalMs: CRAWL_INTERVAL_MS },
  async harvest(source: Source, ctx: RunCtx): Promise<HarvestResult> {
    // Determine feed URL
    let feedUrl = source.feedUrl;
    if (!feedUrl) {
      const base = source.url;
      if (base.includes("/feed/")) {
        feedUrl = base;
      } else {
        feedUrl = base.replace(/\/?$/, "/") + "feed/";
      }
    }
    const fromNight = currentNightDate(ctx.now(), ctx.metro.tz);
    const response = await ctx.http.request({
      url: feedUrl,
      purpose: "crawl",
      headers: { accept: "application/rss+xml, application/xml, text/xml" },
      conditional: { etag: source.etag, lastModified: source.lastModified },
    });
    if (response.notModified) return { listings: [], unchanged: true };
    const body = response.body;
    if (!body.includes("<rss") || !body.includes("xmlns:mec")) {
      throw new Error("not a Modern Events Calendar feed");
    }
    const items = parseMecFeed(body);
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
    // Collect distinct event page links to fetch venue names
    const venueNames = new Map<string, string>();
    const pageNotes: string[] = [];
    const fromNightStr = fromNight; // YYYY-MM-DD
    const weekly = source.eventPageWeekly === true;

    // Filter items: must have title, startDate, link with /events/
    const candidateLinks: Array<{ link: string; datePart: string }> = [];
    for (const item of items) {
      if (!item.title || !item.startDate || !item.link) continue;
      if (!item.link.includes("/events/")) continue;
      const datePart = item.startDate.slice(0, 10);
      if (weekly) {
        // Include items dated up to 7 days before fromNight (D-466)
        const earliestNight = addCalendarDays(fromNightStr, -7);
        if (datePart < earliestNight) continue; // too old
      } else {
        // As before: skip items dated before fromNight
        if (datePart < fromNightStr) continue;
      }
      if (candidateLinks.some((c) => c.link === item.link)) continue; // each page once, as before
      candidateLinks.push({ link: item.link, datePart });
    }

    let links: string[] = [];
    if (weekly) {
      // Sort: future-dated (>= fromNight) first, then older ones, preserving feed order within each group
      const fromNightDate = new Date(fromNightStr + "T12:00:00Z");
      candidateLinks.sort((a, b) => {
        const aDate = new Date(a.datePart + "T12:00:00Z");
        const bDate = new Date(b.datePart + "T12:00:00Z");
        const aInFuture = aDate >= fromNightDate;
        const bInFuture = bDate >= fromNightDate;
        if (aInFuture && !bInFuture) return -1;
        if (!aInFuture && bInFuture) return 1;
        return 0;
      });
      // Take first 30 links
      links = candidateLinks.slice(0, 30).map((c) => c.link);
    } else {
      // No sort, take first 30 links (but candidateLinks already in feed order)
      links = candidateLinks.slice(0, 30).map((c) => c.link);
    }

    // Fetch each link sequentially
    const weeklyRules = new Map<string, string>();
    for (const link of links) {
      try {
        const pageResponse = await ctx.http.request({
          url: link,
          purpose: "crawl",
          headers: { accept: "text/html" },
        });
        const body = pageResponse.body;
        if (weekly) {
          // First, try to get weekly rule from calendar link
          const itemForLink = items.find((it) => it.link === link);
          if (itemForLink?.startDate) {
            const rule = weeklyRuleFromCalendarLink(body, itemForLink.startDate);
            if (rule) {
              weeklyRules.set(link, rule);
            }
          }
        }
        // Then, get venue name
        const name = placeNameFromEventPage(body);
        if (name) {
          // Skip if name equals location (case-insensitive trimmed)
          const itemForLink = items.find((it) => it.link === link);
          if (itemForLink?.location) {
            const locTrimmed = itemForLink.location.trim().toLowerCase();
            const nameTrimmed = name.trim().toLowerCase();
            if (locTrimmed === nameTrimmed) {
              // still continue to next step (venue name not stored)
            } else {
              venueNames.set(link, name);
            }
          } else {
            venueNames.set(link, name);
          }
        }
      } catch {
        pageNotes.push(`event page not read: ${link}`);
      }
    }

    const { listings, notes } = mecToListings(items, {
      siteUrl: source.url,
      fetchedAt: response.fetchedAt,
      metroTz: ctx.metro.tz,
      countryCode: ctx.metro.countryCode,
      fromNight,
      mixedCalendar: source.mixedCalendar === true,
      venueNames,
      weeklyRules: weekly ? weeklyRules : undefined,
      titleAreaPrefix: source.titleAreaPrefix === true,
    });
    return { listings, doc, notes: [...notes, ...pageNotes] };
  },
};
