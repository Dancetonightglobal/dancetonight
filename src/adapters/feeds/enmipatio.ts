// En Mi Patio PR's culture calendar (D-462): Laravel/Inertia pages with JSON in <script data-page="app">.
// The page's data is plain JSON inside the script body, not an attribute. Parse with regex on the exact
// opening tag up to the next </script>, then JSON.parse. The JSON is {component, props, url, version}.
// robots.txt allows * (blocks AI-training bots). Owner's answer 2026-10-30: add it.

import { isoToLocal, sha256, type LocalMoment } from "@/src/adapters/shared";
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
} from "@/src/adapters/types";

interface EnMiPatioEventRow {
  id: number;
  title: string;
  slug: string;
  date: string; // YYYY-MM-DD
  time: string | null; // HH:MM:SS or null
  venue: string | null;
  city: string | null;
  categories: Array<{ id: number; name: string }>;
}

interface EnMiPatioPaginator {
  current_page: number;
  last_page: number;
  next_page_url: string | null;
  total: number;
  data: EnMiPatioEventRow[];
}

interface EnMiPatioOccurrence {
  id: number;
  starts_at: string; // UTC ISO
  ends_at: string | null;
  all_day: boolean;
  is_cancelled: boolean;
}

interface EnMiPatioEventDetail {
  title: string;
  venue: string | null;
  address: string | null;
  latitude: string | null;
  longitude: string | null;
  city: string | null;
  categories: Array<{ id: number; name: string }>;
  occurrences: EnMiPatioOccurrence[];
}

interface PageData {
  component: string;
  props: {
    events?: EnMiPatioPaginator;
    event?: EnMiPatioEventDetail;
  };
  url: string;
  version: string;
}

function parsePage(html: string): PageData | null {
  const regex = /<script data-page="app" type="application\/json">([\s\S]*?)<\/script>/;
  const match = regex.exec(html);
  if (!match) return null;
  try {
    return JSON.parse((match[1] ?? "").trim()) as PageData;
  } catch {
    return null;
  }
}

function isDanceRow(row: EnMiPatioEventRow): boolean {
  // Keep when any category name is exactly "Música y Baile"
  if ((row.categories ?? []).some((cat) => cat.name === "Música y Baile")) {
    return true;
  }
  // OR match bomba|plena|salsa|bachata|merengue|bail|danc|danz in title + " " + slug
  const text = `${row.title} ${row.slug}`.toLowerCase();
  return /(bomba|plena|salsa|bachata|merengue|bail|danc|danz)/i.test(text);
}

export const enmipatioAdapter: SourceAdapter = {
  id: "enmipatio",
  tier: "A",
  limits: { perDomainIntervalMs: CRAWL_INTERVAL_MS },
  async harvest(source: Source, ctx: RunCtx): Promise<HarvestResult> {
    const baseUrl = source.feedUrl ?? source.url;
    const tz = ctx.metro.tz;
    const fromNight = currentNightDate(ctx.now(), tz);
    const lastNight = addCalendarDays(fromNight, MATERIALIZE_DAYS - 1);

    const notes: string[] = [];
    const listings: HarvestedListing[] = [];
    const seenSlugs = new Set<string>();
    const seenExternalIds = new Set<string>();
    let totalListPagesRead = 0;
    let totalListPagesExpected = 0;
    let eventPageFailures = 0;
    let nonDanceRows = 0;
    let allDayOccurrences = 0;
    let eventPageCapped = 0;

    // Fetch list pages sequentially, up to 10 pages
    let currentPage = 1;
    const maxPages = 10;
    let hasMore = true;
    let allListPagesSuccessful = true;
    const maxEventPages = 40;
    let eventPagesRead = 0;
    let firstPage: {
      fetchedAt: Date;
      status: number;
      etag: string | null;
      lastModified: string | null;
    } | null = null;

    while (hasMore && currentPage <= maxPages) {
      const url = new URL(baseUrl);
      url.searchParams.set("page", currentPage.toString());
      const pageUrl = url.toString();

      const listRequest = {
        url: pageUrl,
        purpose: "crawl" as const,
        headers: { accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1" },
      };
      // Page 1 failing fails the read; a later page only stops paging.
      const page =
        currentPage === 1
          ? await ctx.http.request(listRequest)
          : await ctx.http.request(listRequest).catch(() => null);
      if (!page || page.status !== 200) {
        if (currentPage === 1) {
          throw new Error(`En Mi Patio list page 1 answered ${page?.status ?? "nothing"}`);
        }
        notes.push(`list page ${currentPage} failed; read pages 1..${currentPage - 1}`);
        allListPagesSuccessful = false;
        break;
      }

      const data = parsePage(page.body);
      if (!data || !data.props.events) {
        if (currentPage === 1) {
          throw new Error("En Mi Patio's page carries no event list");
        } else {
          notes.push(`list page ${currentPage} unparseable; read pages 1..${currentPage - 1}`);
          allListPagesSuccessful = false;
          break;
        }
      }

      const paginator = data.props.events;
      totalListPagesRead++;
      if (currentPage === 1) {
        totalListPagesExpected = paginator.last_page;
        firstPage = {
          fetchedAt: page.fetchedAt,
          status: page.status,
          etag: page.etag,
          lastModified: page.lastModified,
        };
      }

      // Process rows
      for (const row of paginator.data) {
        if (seenSlugs.has(row.slug)) continue;
        seenSlugs.add(row.slug);

        if (!isDanceRow(row)) {
          nonDanceRows++;
          continue;
        }

        // Fetch event page
        if (eventPagesRead >= maxEventPages) {
          eventPageCapped++;
          continue;
        }
        eventPagesRead++;
        const eventUrl = `https://enmipatiopr.com/event/${encodeURIComponent(row.slug)}`;
        let eventDetail: EnMiPatioEventDetail | null = null;
        let eventPageResponse: { fetchedAt: Date } | null = null;
        try {
          const eventPage = await ctx.http.request({
            url: eventUrl,
            purpose: "crawl",
            headers: { accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1" },
          });
          if (eventPage.status === 200) {
            const eventData = parsePage(eventPage.body);
            if (eventData && eventData.props.event) {
              eventDetail = eventData.props.event;
              eventPageResponse = eventPage;
            } else {
              eventPageFailures++;
            }
          } else {
            eventPageFailures++;
          }
        } catch {
          eventPageFailures++;
        }

        if (!eventDetail) {
          // Skip this event
          continue;
        }

        // Process each occurrence
        for (const occ of eventDetail.occurrences ?? []) {
          if (occ.is_cancelled) continue;
          if (occ.all_day) {
            allDayOccurrences++;
            continue;
          }

          const start = isoToLocal(occ.starts_at, tz);
          if (!start) continue;
          if (start.night < fromNight || start.night > lastNight) continue;

          let end: LocalMoment | null = null;
          if (occ.ends_at) {
            const endInstant = new Date(occ.ends_at);
            const startInstant = new Date(occ.starts_at);
            if (!isNaN(endInstant.getTime()) && !isNaN(startInstant.getTime())) {
              const diffHours = (endInstant.getTime() - startInstant.getTime()) / (1000 * 60 * 60);
              if (diffHours > 0 && diffHours <= 24) {
                end = isoToLocal(occ.ends_at, tz);
              }
            }
          }

          const externalId = `${eventUrl}#${occ.starts_at}`;
          if (seenExternalIds.has(externalId)) continue;
          seenExternalIds.add(externalId);

          let venueLocation = null;
          if (
            eventDetail.latitude &&
            eventDetail.longitude &&
            !isNaN(parseFloat(eventDetail.latitude)) &&
            !isNaN(parseFloat(eventDetail.longitude))
          ) {
            const lat = parseFloat(eventDetail.latitude);
            const lng = parseFloat(eventDetail.longitude);
            if (Number.isFinite(lat) && Number.isFinite(lng)) {
              venueLocation = { lat, lng };
            }
          }

          const structured: StructuredEvent = {
            externalId,
            title: eventDetail.title.trim(),
            start,
            end,
            description: null,
            venue: {
              name: eventDetail.venue?.trim() || null,
              address: eventDetail.address?.trim() || null,
              url: null,
              location: venueLocation,
            },
            organizer: { name: null, url: null },
            prices: null,
            ticketUrl: null,
            eventUrl,
            cancelled: false,
          };

          const currency = currencyForCountry(ctx.metro.countryCode);
          const built = buildListing(structured, {
            sourceUrl: eventUrl,
            fetchedAt: eventPageResponse!.fetchedAt,
            method: "feed",
            currency,
          });
          const styled = withSourceStyle(built, source.styles);
          listings.push(styled);
        }
      }

      // Check for next page
      if (paginator.next_page_url && paginator.data.length > 0) {
        currentPage++;
      } else {
        hasMore = false;
      }
    }

    // Add notes
    if (nonDanceRows > 0) {
      notes.push(`${nonDanceRows} event(s) not dance left out`);
    }
    if (eventPageFailures > 0) {
      notes.push(`${eventPageFailures} event page(s) failed`);
    }
    if (eventPageCapped > 0) {
      notes.push(`${eventPageCapped} dance event(s) past the ${maxEventPages}-page cap left out`);
    }
    if (allDayOccurrences > 0) {
      notes.push(`${allDayOccurrences} all-day occurrence(s) left out`);
    }

    // Determine if whole
    const whole =
      allListPagesSuccessful &&
      totalListPagesRead === totalListPagesExpected &&
      eventPageFailures === 0 &&
      eventPageCapped === 0;

    const firstPageUrl = new URL(baseUrl);
    firstPageUrl.searchParams.set("page", "1");
    const doc = {
      url: firstPageUrl.toString(),
      fetchedAt: firstPage?.fetchedAt ?? ctx.now(),
      httpStatus: firstPage?.status ?? 200,
      etag: firstPage?.etag ?? null,
      lastModified: firstPage?.lastModified ?? null,
      contentHash: sha256(JSON.stringify(listings.map((l) => [l.externalId, l.listing]))),
      cleanedText: null,
    };

    const result: HarvestResult = {
      listings,
      notes,
      doc,
    };
    if (whole) {
      result.whole = true as const;
    }

    return result;
  },
};
