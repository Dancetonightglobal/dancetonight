import type { HarvestedListing } from "@/src/adapters/types";
import type { HttpClient } from "@/src/pipeline/http";

/**
 * Extract a weekly RRULE from an event page that marks the event "Recurring" and names a weekday.
 * Returns `FREQ=WEEKLY;BYDAY=XX` (XX one of MO,TU,WE,TH,FR,SA,SU) or null.
 */
export function weeklyRuleFromEventPage(
  html: string,
  listingDate: string,
  title: string,
): string | null {
  // 1. Check for "Recurring" in visible page text (case-sensitive whole word)
  const visibleText = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ") // remove script tags
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ") // remove style tags
    .replace(/<!--[\s\S]*?-->/g, " ") // remove comments
    .replace(/<[^>]+>/g, " ") // remove all remaining tags
    .replace(/&[a-z0-9]+;/gi, " ") // decode entities crudely (just collapse)
    .replace(/\s+/g, " ")
    .trim();

  // Must contain "Recurring" as a whole word, and not be negated by "Not " or "No "
  if (!/\bRecurring\b/.test(visibleText) || /\b(Not|No)\s+Recurring\b/.test(visibleText)) {
    return null;
  }

  // 2. Extract description from <meta name="description"> and JSON-LD
  let description = "";
  // meta description
  const metaMatch = html.match(/<meta\s+name="description"\s+content="([^"]*)"/i);
  if (metaMatch) {
    description += " " + metaMatch[1];
  }
  // JSON-LD description
  const jsonLdMatches = html.matchAll(
    /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi,
  );
  for (const match of jsonLdMatches) {
    try {
      const parsed = JSON.parse(match[1] ?? "");
      if (parsed.description && typeof parsed.description === "string") {
        description += " " + parsed.description;
      }
    } catch {
      // ignore invalid JSON
    }
  }

  const fullText = (title + " " + description).toLowerCase();

  // English weekday patterns
  const englishDays: Record<string, string> = {
    monday: "MO",
    tuesday: "TU",
    wednesday: "WE",
    thursday: "TH",
    friday: "FR",
    saturday: "SA",
    sunday: "SU",
  };

  // Spanish weekday patterns (singular/plural)
  const spanishDays: Record<string, string> = {
    lunes: "MO",
    martes: "TU",
    miércoles: "WE",
    miercoles: "WE",
    jueves: "TH",
    viernes: "FR",
    sábado: "SA",
    sabado: "SA",
    sábados: "SA",
    sabados: "SA",
    domingo: "SU",
    domingos: "SU",
  };

  const foundDays = new Set<string>();

  // English: "every <Weekday>", "<Weekday>s", "<Weekday>s weekly"
  for (const [dayName, rruleDay] of Object.entries(englishDays)) {
    const patterns = [`every ${dayName}\\b`, `\\b${dayName}s\\b`, `\\b${dayName}s weekly\\b`];
    if (patterns.some((p) => new RegExp(p, "i").test(fullText))) {
      foundDays.add(rruleDay);
    }
  }

  // Spanish: "todos los <día>", "cada <día>", "los <día>"
  for (const [dayName, rruleDay] of Object.entries(spanishDays)) {
    const patterns = [
      `todos los ${dayName}\\b`,
      `cada ${dayName}\\b`,
      `los ${dayName}[\\s\\p{P}]`, // followed by space or punctuation
    ];
    if (patterns.some((p) => new RegExp(p, "iu").test(fullText))) {
      foundDays.add(rruleDay);
    }
  }

  if (foundDays.size !== 1) {
    return null;
  }

  const rruleDay = [...foundDays][0];

  // 3. Check that the found weekday matches the listing date's weekday
  const dateObj = new Date(listingDate + "T12:00:00");
  const listingWeekday = dateObj.toLocaleDateString("en-US", { weekday: "long" }).toLowerCase();
  const expectedRrule = englishDays[listingWeekday];
  if (expectedRrule !== rruleDay) {
    return null;
  }

  return `FREQ=WEEKLY;BYDAY=${rruleDay}`;
}

/**
 * Extract a weekly RRULE from a Google Calendar link's `recur=` parameter.
 * Returns `FREQ=WEEKLY;BYDAY=XX` or null.
 */
export function weeklyRuleFromCalendarLink(html: string, startDate: string): string | null {
  // Find all href attributes in the HTML
  const hrefMatches = html.matchAll(/href\s*=\s*["']([^"']+)["']/gi);
  for (const match of hrefMatches) {
    const href = match[1] ?? "";
    // Decode HTML entities: &amp; -> &, &#038; -> &, &#38; -> &
    const decoded = href
      .replace(/&amp;/g, "&")
      .replace(/&#038;/g, "&")
      .replace(/&#38;/g, "&");
    if (!decoded.includes("recur=")) continue;
    try {
      // Make URL absolute if relative
      const base = "https://example.invalid/";
      const url = new URL(decoded, base);
      const recurParam = url.searchParams.get("recur");
      if (!recurParam) continue;
      const trimmed = recurParam.trim();
      if (!trimmed.startsWith("RRULE:")) continue;
      const rruleStr = trimmed.slice(6); // strip "RRULE:"
      // Parse key=value pairs
      const parts = rruleStr.split(";");
      const params: Record<string, string> = {};
      for (const part of parts) {
        const eq = part.indexOf("=");
        if (eq === -1) return null;
        const key = part.slice(0, eq).toUpperCase();
        const value = part.slice(eq + 1);
        params[key] = value;
      }
      if (params.FREQ !== "WEEKLY") return null;
      // Disallowed keys
      const allowedKeys = new Set(["FREQ", "BYDAY", "INTERVAL", "WKST"]);
      for (const key of Object.keys(params)) {
        if (!allowedKeys.has(key)) return null;
      }
      if (params.INTERVAL && params.INTERVAL !== "1") return null;
      // Compute start weekday in UTC
      const dateObj = new Date(startDate + "T12:00:00Z");
      const utcDay = dateObj.getUTCDay(); // 0=Sun, 1=Mon, ..., 6=Sat
      const dayCodes = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
      const startWeekday = dayCodes[utcDay];
      if (!startWeekday) return null;
      if (!params.BYDAY) {
        return `FREQ=WEEKLY;BYDAY=${startWeekday}`;
      }
      // Validate BYDAY list
      const byDayList = params.BYDAY.split(",");
      for (const day of byDayList) {
        if (!dayCodes.includes(day)) return null;
      }
      // Must include startWeekday
      if (!byDayList.includes(startWeekday)) return null;
      // Return in original order (use original BYDAY value)
      return `FREQ=WEEKLY;BYDAY=${params.BYDAY}`;
    } catch {
      // URL parsing or other error
      continue;
    }
  }
  return null;
}

/**
 * Turn eligible listings into weekly rules by reading their own event pages.
 */
export async function weeklyFromEventPages(
  listings: readonly HarvestedListing[],
  ctx: { http: HttpClient; limit?: number },
): Promise<{ listings: HarvestedListing[]; notes: string[] }> {
  const notes: string[] = [];
  const limit = ctx.limit ?? 30;
  const urlCache = new Map<string, string | null>(); // url -> html or null on error
  const urlErrors = new Map<string, string>();

  // Fetch pages up to limit
  let fetched = 0;
  let skipped = 0;
  for (const listing of listings) {
    // Skip conditions
    if (listing.recurrence || !listing.listing.local_date || !listing.eventUrl) {
      continue;
    }

    const url = listing.eventUrl;
    if (urlCache.has(url)) {
      // already attempted
      continue;
    }
    if (fetched >= limit) {
      skipped++;
      continue;
    }

    fetched++;
    try {
      const response = await ctx.http.request({
        url,
        purpose: "crawl",
        headers: { accept: "text/html" },
      });
      urlCache.set(url, response.body);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      urlErrors.set(url, message);
      urlCache.set(url, null);
    }
  }

  if (skipped > 0) notes.push(`${skipped} event page(s) not read: limit ${limit}`);

  // Process each listing
  const madeWeekly: string[] = [];
  const result = listings.map((listing) => {
    if (listing.recurrence || !listing.listing.local_date || !listing.eventUrl) {
      return listing;
    }

    const html = urlCache.get(listing.eventUrl);
    if (html === undefined || html === null) {
      return listing; // not fetched or error
    }

    const rule = weeklyRuleFromEventPage(html, listing.listing.local_date, listing.listing.title);
    if (!rule) {
      return listing;
    }

    // Need a time for dtstartLocal
    const time =
      listing.listing.dancing_time ?? listing.listing.doors_time ?? listing.listing.lesson_time;
    if (!time) {
      return listing; // no rule without a time
    }

    // Build new recurrence object
    const recurrence = {
      rrule: rule,
      dtstartLocal: `${listing.listing.local_date}T${time}`,
      exdates: [],
      timeListed: true,
    };

    // Clean externalId: drop trailing #<startDate> part
    let externalId = listing.externalId;
    if (externalId && /#\d{4}-\d{2}-\d{2}/.test(externalId)) {
      externalId = externalId.replace(/#\d{4}-\d{2}-\d{2}[^#]*$/, "");
    }

    const copy: HarvestedListing = {
      ...listing,
      listing: {
        ...listing.listing,
        local_date: null,
      },
      recurrence,
      externalId,
    };

    madeWeekly.push(listing.listing.title);
    return copy;
  });

  if (madeWeekly.length > 0) {
    notes.push(
      `${madeWeekly.length} listing(s) made weekly from their own page's "Recurring" and weekday: ${madeWeekly.join("; ")}`,
    );
  }

  return { listings: result, notes };
}
