import { decodeEntities, isoToLocal, sha256 } from "@/src/adapters/shared";
import { buildListing } from "@/src/adapters/structured";
import type {
  HarvestedListing,
  HarvestResult,
  RunCtx,
  Source,
  SourceAdapter,
} from "@/src/adapters/types";
import { currencyForCountry } from "@/src/domain/prices";
import { addCalendarDays } from "@/src/domain/time";
import { currentNightDate } from "@/src/domain/tonight";
import { MATERIALIZE_DAYS } from "@/src/domain/recurrence";
import { withSourceStyle } from "@/src/adapters/feeds/event-pages";

export interface WwozParade {
  eventId: string; // "1379251"
  eventUrl: string; // "https://www.wwoz.org/events/1379251"
  title: string; // og:title, entities decoded, trimmed
  date: string; // "2026-11-01" (the listed calendar date)
  startTime: string | null; // "12:30" 24-hour
  endTime: string | null; // "16:30", null when none
  dateText: string; // the date line as plain text, whitespace collapsed
  venueName: string | null; // where it starts (see rules)
  venueAddress: string | null;
  routeStart: string | null; // the start text as found
  routeEnd: string | null; // the disband text
}

export const wwozStreetsAdapter: SourceAdapter = {
  id: "wwoz_streets",
  tier: "A",
  limits: { perDomainIntervalMs: 10_000 },
  async harvest(source: Source, ctx: RunCtx): Promise<HarvestResult> {
    const baseUrl = source.feedUrl ?? source.url;
    const fromNight = currentNightDate(ctx.now(), ctx.metro.tz);
    const lastNight = addCalendarDays(fromNight, MATERIALIZE_DAYS - 1);

    // Fetch the programme page
    // A failed programme page throws: the run reports the source as failing.
    const programmePage = await ctx.http.request({
      url: baseUrl,
      purpose: "crawl",
      headers: { accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1" },
    });

    const links = wwozStreetsEventLinks(programmePage.body).slice(0, 12);
    const notes: string[] = [];
    const fetchErrors: string[] = [];
    let skipped = 0;

    const paradePages: Array<{ parade: WwozParade; fetchedAt: Date }> = [];
    for (const url of links) {
      try {
        const page = await ctx.http.request({
          url,
          purpose: "crawl",
          headers: { accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1" },
        });
        const parade = parseWwozParade(page.body, page.url || url);
        // Not a parade (a museum opening, a talk) or outside the window.
        if (
          !parade ||
          !isParadeTitle(parade.title) ||
          parade.date < fromNight ||
          parade.date > lastNight
        ) {
          skipped++;
          continue;
        }
        paradePages.push({ parade, fetchedAt: page.fetchedAt });
      } catch (err) {
        const errMsg = (err as Error).message;
        fetchErrors.push(`${url}: ${errMsg}`);
      }
    }

    const listings: HarvestedListing[] = [];
    for (const { parade, fetchedAt } of paradePages) {
      // Build start
      let start;
      if (parade.startTime) {
        start = isoToLocal(`${parade.date}T${parade.startTime}`, ctx.metro.tz);
      } else {
        start = isoToLocal(parade.date, ctx.metro.tz);
      }
      if (!start) continue;

      // Build end
      let end = null;
      if (parade.endTime) {
        end = isoToLocal(`${parade.date}T${parade.endTime}`, ctx.metro.tz);
      }

      // Build description
      let description: string | null = null;
      const routeStart = parade.routeStart ?? parade.venueName;
      if (routeStart) {
        description = `Second line: route starts at ${routeStart}`;
        if (parade.routeEnd) {
          description += `; disbands at ${parade.routeEnd}`;
        }
        description += ".";
      }

      const built = buildListing(
        {
          externalId: `wwoz:${parade.eventId}`,
          title: parade.title,
          start,
          end,
          description,
          venue: {
            name: parade.venueName ? `Route starts at ${parade.venueName}` : null,
            address: parade.venueAddress,
            url: null,
            location: null,
          },
          organizer: { name: null, url: null },
          prices: null,
          ticketUrl: null,
          eventUrl: parade.eventUrl,
          cancelled: false,
          styles: [],
          type: "outdoor_public",
          evidence: { start: `listed ${parade.dateText}` },
        },
        {
          sourceUrl: parade.eventUrl,
          fetchedAt,
          method: "jsonld",
          currency: currencyForCountry(ctx.metro.countryCode),
        },
      );

      const styled = withSourceStyle(built, source.styles);
      listings.push(styled);
    }

    const contentHash = sha256(JSON.stringify(listings.map((l) => [l.externalId, l.listing])));

    const resultNotes = [
      `${paradePages.length} parade(s) of ${links.length} linked page(s)`,
      ...notes,
      ...(skipped > 0 ? [`${skipped} linked page(s) not a parade or outside the window`] : []),
      ...fetchErrors,
    ];

    const result: HarvestResult = {
      listings,
      notes: resultNotes,
      doc: {
        url: programmePage.url || baseUrl,
        fetchedAt: programmePage.fetchedAt,
        httpStatus: programmePage.status,
        etag: programmePage.etag,
        lastModified: programmePage.lastModified,
        contentHash,
        cleanedText: null,
      },
    };

    return result;
  },
};

/** Absolute, de-duplicated https://www.wwoz.org/events/<digits> links in page order. */
export function wwozStreetsEventLinks(html: string): string[] {
  const links: string[] = [];
  const eventRegex = /href="(\/events\/\d+)"/g;
  const baseUrl = "https://www.wwoz.org";

  let match;
  while ((match = eventRegex.exec(html)) !== null) {
    const path = match[1];
    const fullUrl = baseUrl + path;
    if (!links.includes(fullUrl)) {
      links.push(fullUrl);
    }
  }

  return links;
}

/** A second line or parade by its title: /\bsecond[\s-]?line\b|\bparade\b/i. */
export function isParadeTitle(title: string): boolean {
  const pattern = /\bsecond[\s-]?line\b|\bparade\b/i;
  return pattern.test(title);
}

/** Parse one event page; null when it has no og:title or no parsable date line. */
export function parseWwozParade(html: string, pageUrl: string): WwozParade | null {
  // Extract event ID from pageUrl
  const eventIdMatch = pageUrl.match(/\/events\/(\d+)/);
  if (!eventIdMatch?.[1]) return null;
  const eventId = eventIdMatch[1];
  const eventUrl = `https://www.wwoz.org/events/${eventId}`;

  // Extract title from og:title meta tag (handle both single and double quotes)
  const ogTitleMatch = html.match(/<meta\s+property="og:title"\s+content=["']([^"']*)["']/i);
  if (!ogTitleMatch?.[1]) return null;
  const title = decodeEntities(ogTitleMatch[1]).trim();
  if (!title) return null;

  // Extract date line - find date-display-single span and capture up to the closing </div>
  const dateDivMatch = html.match(
    /<span\s+class="[^"]*date-display-single[^"]*"[^>]*>([\s\S]*?)<\/div>/,
  );
  if (!dateDivMatch?.[1]) return null;

  // Remove all tags and decode entities
  const dateHtml = dateDivMatch[1];
  // First decode entities, then remove tags
  const decoded = decodeEntities(dateHtml);
  const stripped = decoded.replace(/<[^>]*>/g, " ");
  const dateText = stripped.replace(/\s+/g, " ").trim();
  if (!dateText) return null;

  // Parse date and times
  // The format is like "Sunday, November 1, 2026 - 12:30pm to 4:30pm"
  // The dash might be an en dash or have spaces
  let monthName: string;
  let day: string;
  let year: string;
  let timePart: string | null = null;

  const dateMatch = dateText.match(
    /^([A-Za-z]+),\s+([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})\s*[-\u2013]\s*(.+)$/,
  );
  if (dateMatch) {
    monthName = dateMatch[2] ?? "";
    day = dateMatch[3] ?? "";
    year = dateMatch[4] ?? "";
    timePart = dateMatch[5] ?? null;
  } else {
    // Try without time part
    const dateOnlyMatch = dateText.match(/^([A-Za-z]+),\s+([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})$/);
    if (!dateOnlyMatch?.[2] || !dateOnlyMatch?.[3] || !dateOnlyMatch?.[4]) return null;
    monthName = dateOnlyMatch[2];
    day = dateOnlyMatch[3];
    year = dateOnlyMatch[4];
    timePart = null;
  }

  // Convert month name to number (case-insensitive)
  const monthNames = [
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
  ];
  const monthIndex = monthNames.indexOf(monthName.toLowerCase());
  if (monthIndex === -1) return null;

  const month = (monthIndex + 1).toString().padStart(2, "0");
  const date = `${year}-${month}-${day.padStart(2, "0")}`;

  // Parse times
  let startTime: string | null = null;
  let endTime: string | null = null;

  if (timePart) {
    // Match times like "12:30pm to 4:30pm" or "2:00pm"
    const timeMatch = timePart.match(
      /(\d{1,2}):(\d{2})(am|pm)(?:\s+to\s+(\d{1,2}):(\d{2})(am|pm))?/i,
    );
    if (timeMatch) {
      const startHour = timeMatch[1] ?? "";
      const startMin = timeMatch[2] ?? "";
      const startAmPm = timeMatch[3] ?? "";
      const endHour = timeMatch[4];
      const endMin = timeMatch[5];
      const endAmPm = timeMatch[6];

      // Convert start time to 24-hour
      let startHourNum = parseInt(startHour);
      if (startAmPm.toLowerCase() === "pm" && startHourNum !== 12) {
        startHourNum += 12;
      } else if (startAmPm.toLowerCase() === "am" && startHourNum === 12) {
        startHourNum = 0;
      }
      startTime = `${startHourNum.toString().padStart(2, "0")}:${startMin}`;

      // Convert end time if present
      if (endHour && endMin && endAmPm) {
        let endHourNum = parseInt(endHour);
        if (endAmPm.toLowerCase() === "pm" && endHourNum !== 12) {
          endHourNum += 12;
        } else if (endAmPm.toLowerCase() === "am" && endHourNum === 12) {
          endHourNum = 0;
        }
        endTime = `${endHourNum.toString().padStart(2, "0")}:${endMin}`;
      }
    }
  }

  // Extract route text
  let routeText = "";

  // Try field-name-body first - match the entire div
  const bodyRegex = /<div\s+class="[^"]*field-name-body[^"]*"[^>]*>([\s\S]*?)<\/div>/i;
  const bodyMatch = html.match(bodyRegex);
  if (bodyMatch?.[1]) {
    routeText = decodeEntities(bodyMatch[1].replace(/<[^>]*>/g, " "))
      .replace(/\s+/g, " ")
      .trim();
  } else {
    // Try field-name-field-body-below-media
    const belowMediaRegex =
      /<div\s+class="[^"]*field-name-field-body-below-media[^"]*"[^>]*>([\s\S]*?)<\/div>/i;
    const belowMediaMatch = html.match(belowMediaRegex);
    if (belowMediaMatch?.[1]) {
      routeText = decodeEntities(belowMediaMatch[1].replace(/<[^>]*>/g, " "))
        .replace(/\s+/g, " ")
        .trim();
    }
  }

  // Extract routeStart
  let routeStart: string | null = null;
  const startMatch = routeText.match(/\bstart\b:?\s*(.*)/i);
  if (startMatch?.[1]) {
    let startText = startMatch[1];
    // Cut at first of: Proceed, Stop:, STOP, or ". "
    const cutMatch = startText.match(/^(.*?)(?=\bProceed\b|\bStop:\b|\bSTOP\b|\.\s|$)/i);
    if (cutMatch) {
      startText = cutMatch[1] ?? startText;
    }
    routeStart = startText.replace(/\.$/, "").trim();
    if (routeStart === "") routeStart = null;
  }

  // Extract routeEnd
  let routeEnd: string | null = null;
  const disbandMatch = routeText.match(/\bdisband\b:?\s*(.*)/i);
  if (disbandMatch?.[1]) {
    routeEnd = disbandMatch[1].trim();
    if (routeEnd.length > 120) {
      routeEnd = routeEnd.substring(0, 120);
    }
    if (routeEnd === "") routeEnd = null;
  }

  // Extract venue information
  let venueName: string | null = null;
  let venueAddress: string | null = null;

  // Check for field-name-field-venue
  const venueIndex = html.search(/<div class="field field-name-field-venue[^"]*"/i);
  if (venueIndex !== -1) {
    // Take a slice from venueIndex to the next field-name-field-phone or up to 4000 chars
    const sliceStart = venueIndex;
    const sliceEnd = html.indexOf("field-name-field-phone", sliceStart);
    const venueSlice = html.slice(sliceStart, sliceEnd !== -1 ? sliceEnd : sliceStart + 4000);

    // Extract organization link text
    const orgLinkMatch = venueSlice.match(/<a href="\/organizations\/[^"]*">([^<]*)<\/a>/);
    if (orgLinkMatch?.[1]) {
      venueName = decodeEntities(orgLinkMatch[1]).trim();
    }

    // Extract address components from the slice
    const thoroughfareMatch = venueSlice.match(/<div class="thoroughfare">([^<]*)<\/div>/);
    const localityMatch = venueSlice.match(/<span class="locality">([^<]*)<\/span>/);
    const stateMatch = venueSlice.match(/<span class="state">([^<]*)<\/span>/);
    const postalMatch = venueSlice.match(/<span class="postal-code">([^<]*)<\/span>/);

    if (thoroughfareMatch?.[1]) {
      const thoroughfare = decodeEntities(thoroughfareMatch[1]).trim();
      const locality = localityMatch?.[1] ? decodeEntities(localityMatch[1]).trim() : "";
      const state = stateMatch?.[1] ? decodeEntities(stateMatch[1]).trim() : "";
      const postal = postalMatch?.[1] ? decodeEntities(postalMatch[1]).trim() : "";

      if (thoroughfare && locality && state && postal) {
        venueAddress = `${thoroughfare}, ${locality}, ${state} ${postal}`;
      }
      // If any component is missing, venueAddress remains null per spec
    }
  } else if (routeStart) {
    // Try to parse venue from routeStart
    const addressMatch = routeStart.match(/^(.*?\D)\s+(\d{2,5}\s+\S.*)$/);
    if (addressMatch?.[1] && addressMatch?.[2]) {
      venueName = addressMatch[1].trim();
      const addressPart = addressMatch[2].trim();
      venueAddress = `${addressPart}, New Orleans, LA`;
    } else {
      venueName = routeStart;
    }
  }

  return {
    eventId,
    eventUrl,
    title,
    date,
    startTime,
    endTime,
    dateText,
    venueName,
    venueAddress,
    routeStart,
    routeEnd,
  };
}
