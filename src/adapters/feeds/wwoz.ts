// WWOZ Livewire music calendar (New Orleans' citywide gig list, one HTML page per night).
// Each gig becomes one HarvestedListing with venueFlags from the New Orleans config.
// WWOZ gave permission; robots.txt allows /calendar/ with Crawl-delay 10.

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
import { WWOZ_DANCE_FLOORS, WWOZ_SEATED } from "@/config/sources/new-orleans";
import { MATERIALIZE_DAYS } from "@/src/domain/recurrence";
import { withSourceStyle } from "@/src/adapters/feeds/event-pages";
import { stylesFromText } from "@/src/domain/text-facts";

export interface WwozGig {
  venueSlug: string;
  venueName: string;
  eventId: string;
  eventUrl: string;
  title: string;
  date: string; // YYYY-MM-DD
  startTime: string; // HH:MM 24h
  originalTimeText: string; // e.g., "3:00pm"
  listedDate: string; // e.g., "Thursday, October 29"
  pageUrl: string;
  fetchedAt: Date;
}

/** Parse a WWOZ Livewire night page. */
export function parseWwozNight(
  html: string,
  pageUrl: string,
  night: string,
  fetchedAt: Date = new Date(),
): WwozGig[] {
  const gigs: WwozGig[] = [];
  const seenIds = new Set<string>();

  const panelSections: string[] = [];
  let startIdx = 0;

  while (true) {
    const panelStart = html.indexOf('<div class="panel panel-default"', startIdx);
    if (panelStart === -1) break;

    let depth = 0;
    let pos = panelStart;
    while (pos < html.length) {
      if (html.startsWith("<div", pos)) {
        depth++;
      } else if (html.startsWith("</div", pos)) {
        depth--;
        if (depth === 0) {
          const panelEnd = pos + 6;
          panelSections.push(html.substring(panelStart, panelEnd));
          startIdx = panelEnd;
          break;
        }
      }
      pos++;
    }
    if (pos >= html.length) break;
  }

  for (const panelContent of panelSections) {
    const titleMatch = panelContent.match(
      /<h3\s+class="panel-title">\s*<a\s+href="\/organizations\/([^"]+)">([\s\S]*?)<\/a>/i,
    );
    if (!titleMatch) {
      continue;
    }
    const venueSlug = titleMatch[1]?.trim() ?? "";
    const venueName = decodeEntities(titleMatch[2] ?? "")
      .replace(/\s+/g, " ")
      .trim();

    // Find all rows directly in the panel content
    const rows: Array<{ truncate: string; dateTime: string }> = [];
    let pos = 0;
    while (true) {
      const truncateStart = panelContent.indexOf('<p class="truncate">', pos);
      if (truncateStart === -1) break;
      const truncateEnd = panelContent.indexOf("</p>", truncateStart);
      if (truncateEnd === -1) break;
      const truncateContent = panelContent.substring(truncateStart + 20, truncateEnd);

      const nextP = panelContent.indexOf("<p>", truncateEnd);
      if (nextP === -1) break;
      const nextPEnd = panelContent.indexOf("</p>", nextP);
      if (nextPEnd === -1) break;
      const dateTimeContent = panelContent.substring(nextP + 3, nextPEnd);

      rows.push({
        truncate: truncateContent,
        dateTime: dateTimeContent,
      });

      pos = nextPEnd + 4;
    }

    for (const row of rows) {
      const truncateContent = row.truncate;
      const dateTimeContent = row.dateTime;

      const linkMatch = truncateContent.match(/<a\s+href="\/events\/(\d+)"[^>]*>([\s\S]*?)<\/a>/i);
      if (!linkMatch) continue;
      const eventId = linkMatch[1]?.trim() ?? "";
      const rawTitle = linkMatch[2] ?? "";
      const title = decodeEntities(rawTitle).replace(/\s+/g, " ").trim();

      const dateMatch = dateTimeContent.match(
        /([A-Za-z]+),\s*([A-Za-z]+)\s+(\d{1,2})(?:\s+at\s+([^<]+))?/i,
      );
      if (!dateMatch) continue;
      const weekday = dateMatch[1]?.trim() ?? "";
      const monthName = dateMatch[2]?.trim() ?? "";
      const day = dateMatch[3]?.trim() ?? "";
      const rawTime = dateMatch[4]?.trim() ?? "";

      const monthNames = [
        "January",
        "February",
        "March",
        "April",
        "May",
        "June",
        "July",
        "August",
        "September",
        "October",
        "November",
        "December",
      ];
      const monthIndex = monthNames.findIndex((m) => m.toLowerCase() === monthName.toLowerCase());
      if (monthIndex === -1) continue;
      const monthNum = monthIndex + 1;

      const nightYear = Number(night.slice(0, 4));
      const nightMonth = Number(night.slice(5, 7));
      let year = nightYear;
      if (monthNum === 1 && nightMonth === 12) {
        year = nightYear + 1;
      }
      if (monthNum === 12 && nightMonth === 1) {
        year = nightYear - 1;
      }

      let date = `${year}-${String(monthNum).padStart(2, "0")}-${day.padStart(2, "0")}`;

      let startTime = "";
      if (rawTime) {
        const timeLower = rawTime.toLowerCase().trim();
        if (timeLower === "noon") {
          startTime = "12:00";
        } else if (timeLower === "midnight") {
          startTime = "00:00";
        } else {
          const timeMatch = timeLower.match(/^(\d{1,2}):(\d{2})\s*([ap]m?)?$/);
          if (timeMatch) {
            let hour = parseInt(timeMatch[1] ?? "0", 10);
            const minute = timeMatch[2]?.padStart(2, "0") ?? "00";
            const period = timeMatch[3] ?? "";
            if (period.startsWith("p") && hour < 12) hour += 12;
            if (period.startsWith("a") && hour === 12) hour = 0;
            startTime = `${String(hour).padStart(2, "0")}:${minute}`;
          } else {
            continue;
          }
        }
      } else {
        continue;
      }
      // A gig after midnight written under the page's own date belongs to the next calendar day, so it
      // stays on this night (D-004). WWOZ's saved pages show none; this guards the case.
      if (date === night && startTime < "06:00") date = addCalendarDays(night, 1);

      let eventUrl: string;
      try {
        eventUrl = new URL(`/events/${eventId}`, pageUrl).toString();
      } catch {
        continue;
      }
      if (!eventUrl.startsWith("http")) continue;

      if (seenIds.has(eventId)) continue;
      seenIds.add(eventId);

      gigs.push({
        venueSlug,
        venueName,
        eventId,
        eventUrl,
        title,
        date,
        startTime,
        originalTimeText: rawTime,
        listedDate: `${weekday}, ${monthName} ${day}`,
        pageUrl,
        fetchedAt,
      });
    }
  }

  return gigs;
}

/** Return venueFlags for a WWOZ venue slug. */
export function wwozVenueFlags(slug: string): {
  bandsForDancers?: boolean;
  bandsForDancersFrom?: string | null;
  danceBandKinds?: boolean;
  lateNightKeep?: boolean;
} {
  const danceFloor = WWOZ_DANCE_FLOORS[slug as keyof typeof WWOZ_DANCE_FLOORS];
  if (danceFloor) {
    return {
      bandsForDancers: true,
      bandsForDancersFrom: danceFloor.from ?? null,
      danceBandKinds: true,
    };
  }
  // A citywide directory: a late gig naming no dance is not a club night here, only at a dance floor.
  if (WWOZ_SEATED.has(slug)) {
    return { danceBandKinds: false, lateNightKeep: false };
  }
  return { danceBandKinds: true, lateNightKeep: false };
}

/** Determine if a WWOZ gig should be skipped, and why. */
export function wwozSkipReason(title: string, slug: string): string | null {
  const lowerTitle = title.toLowerCase();
  // pickers' jam rule
  const hasBluegrass = lowerTitle.includes("bluegrass");
  const hasPickin = /\bpickin/i.test(title);
  const hasJam = /\bjam\b/i.test(title);
  if ((hasBluegrass || hasPickin) && hasJam) {
    return "a pickers' jam, not a dance";
  }
  // seated room rule
  if (WWOZ_SEATED.has(slug)) {
    const danceWord = /\bdanc(e|es|er|ers|ing)\b/i.test(title);
    if (danceWord) {
      return null;
    }
    const styles = stylesFromText(title, null);
    if (styles.length > 0) {
      return null;
    }
    return "a seated room's gig that names no dance";
  }
  return null;
}

export const wwozAdapter: SourceAdapter = {
  id: "wwoz",
  tier: "A",
  limits: { perDomainIntervalMs: 10_000 },
  async harvest(source: Source, ctx: RunCtx): Promise<HarvestResult> {
    const baseUrl = source.feedUrl ?? source.url;
    const fromNight = currentNightDate(ctx.now(), ctx.metro.tz);
    const lastNight = addCalendarDays(fromNight, MATERIALIZE_DAYS - 1);

    const gigs: WwozGig[] = [];
    const notes: string[] = [];
    let successfulNights = 0;
    let firstSuccessfulPage: {
      url: string;
      fetchedAt: Date;
      status: number;
      etag: string | null;
      lastModified: string | null;
    } | null = null;

    let currentNight = fromNight;
    let nightIndex = 0;
    const totalNights = MATERIALIZE_DAYS;

    while (nightIndex < totalNights) {
      if (ctx.signal?.aborted) {
        break;
      }

      const url = new URL(baseUrl);
      url.searchParams.set("date", currentNight);
      const nightUrl = url.toString();

      try {
        const page = await ctx.http.request({
          url: nightUrl,
          purpose: "crawl",
          headers: { accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1" },
        });

        const parsed = parseWwozNight(
          page.body,
          page.url || nightUrl,
          currentNight,
          page.fetchedAt,
        );

        if (nightIndex === 0 && parsed.length === 0) {
          throw new Error("WWOZ's page shows no gigs");
        }

        gigs.push(...parsed);
        successfulNights++;

        if (firstSuccessfulPage === null) {
          firstSuccessfulPage = {
            url: page.url || nightUrl,
            fetchedAt: page.fetchedAt,
            status: page.status,
            etag: page.etag,
            lastModified: page.lastModified,
          };
        }
      } catch (err) {
        const errMsg = (err as Error).message;
        notes.push(`${currentNight}: ${errMsg}`);
        if (nightIndex === 0 && errMsg === "WWOZ's page shows no gigs") {
          throw err;
        }
      }

      currentNight = addCalendarDays(currentNight, 1);
      nightIndex++;
    }

    if (successfulNights === 0) {
      throw new Error("every WWOZ night request failed");
    }

    const listings: HarvestedListing[] = [];
    const skipReasons: string[] = [];
    for (const gig of gigs) {
      const skip = wwozSkipReason(gig.title, gig.venueSlug);
      if (skip !== null) {
        skipReasons.push(`${gig.title} (${gig.venueName}): ${skip}`);
        continue;
      }
      const start = isoToLocal(`${gig.date}T${gig.startTime}`, ctx.metro.tz);
      if (!start) continue;

      const evidence = { start: `listed ${gig.listedDate} at ${gig.originalTimeText}` };

      const built = buildListing(
        {
          externalId: `wwoz:${gig.eventId}`,
          title: gig.title,
          start,
          end: null,
          description: null,
          venue: {
            name: gig.venueName,
            address: null,
            url: null,
            location: null,
          },
          organizer: { name: null, url: null },
          prices: null,
          ticketUrl: null,
          eventUrl: gig.eventUrl,
          cancelled: false,
          styles: [],
          evidence,
        },
        {
          sourceUrl: gig.pageUrl,
          fetchedAt: gig.fetchedAt,
          method: "jsonld",
          currency: currencyForCountry(ctx.metro.countryCode),
        },
      );

      built.venueFlags = wwozVenueFlags(gig.venueSlug);
      const styled = withSourceStyle(built, source.styles);
      listings.push(styled);
    }

    const contentHash = sha256(JSON.stringify(listings.map((l) => [l.externalId, l.listing])));

    const resultNotes = [
      `${gigs.length} gig(s) on ${successfulNights} night(s) read of ${totalNights}`,
      ...notes,
    ];
    if (skipReasons.length > 0) {
      const n = skipReasons.length;
      const first = skipReasons.slice(0, 12).join("; ");
      const extra = n > 12 ? `, and ${n - 12} more` : "";
      resultNotes.push(`${n} gig(s) skipped as not dances: ${first}${extra}`);
    }

    const result: HarvestResult = {
      listings,
      notes: resultNotes,
      doc: {
        url: firstSuccessfulPage?.url ?? baseUrl,
        fetchedAt: firstSuccessfulPage?.fetchedAt ?? ctx.now(),
        httpStatus: firstSuccessfulPage?.status ?? 0,
        etag: firstSuccessfulPage?.etag ?? null,
        lastModified: firstSuccessfulPage?.lastModified ?? null,
        contentHash,
        cleanedText: null,
      },
    };

    return result;
  },
};
