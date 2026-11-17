// Sabaki Partner API reader for salsa, bachata and kizomba events.
// Runs in Miami and Barcelona only. Every listing links to its unchanged Sabaki eventUrl.
// D-324

import { matchStyles, type StyleKey } from "@/config/styles";
import { httpUrl, plainText, sha256, isoToLocal } from "@/src/adapters/shared";
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
import { currencyForCountry } from "@/src/domain/prices";

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number.parseFloat(v) : Number.NaN;
  return Number.isFinite(n) ? n : null;
};

export const SABAKI_BASE = "https://partner.sabaki.dance/v1/events";
export const SABAKI_PAGE_SIZE = 500;
export const SABAKI_MAX_PAGES = 5;
export const SABAKI_METROS: readonly string[] = ["miami", "barcelona"];

export function sabakiUrl(metro: Metro, cursor: string | null): string {
  const url = new URL(SABAKI_BASE);
  url.searchParams.set("limit", String(SABAKI_PAGE_SIZE));
  url.searchParams.set("countryCodes", metro.countryCode);
  url.searchParams.set("lat", metro.center.lat.toFixed(6));
  url.searchParams.set("lng", metro.center.lng.toFixed(6));
  url.searchParams.set("radiusKm", String(Math.min(Math.ceil(metro.radiusKm), 200)));
  if (cursor) {
    url.searchParams.set("cursor", cursor);
  }
  return url.toString();
}

export function sabakiToListings(
  events: unknown[],
  options: { metro: Metro; nights: NightDate[]; fetchedAt: Date },
): {
  listings: HarvestedListing[];
  notes: string[];
  screened: Array<{ externalId: string; title: string; reason: string }>;
} {
  const listings: HarvestedListing[] = [];
  const notes: string[] = [];
  const screened: Array<{ externalId: string; title: string; reason: string }> = [];
  const seen = new Set<string>();

  for (const raw of events) {
    if (!isObject(raw)) continue;
    const event = raw;
    const id = str(event.eventId);
    if (!id) continue;
    const externalId = `sabaki:${id}`;
    if (seen.has(externalId)) continue;
    seen.add(externalId);

    const title = plainText(event.title);
    if (!title) continue;

    const eventUrl = str(event.eventUrl);
    if (!eventUrl || !eventUrl.startsWith("https://")) {
      notes.push(`sabaki:${id} has no eventUrl, skipped`);
      continue;
    }

    const start = isoToLocal(str(event.startDateTime), options.metro.tz);
    if (!start) continue;

    const firstNight = options.nights[0];
    const lastNight = options.nights[options.nights.length - 1];
    if (start.night < firstNight! || start.night > lastNight!) {
      // skip silently
      continue;
    }

    const endRaw = str(event.endDateTime);
    const end = endRaw ? isoToLocal(endRaw, options.metro.tz) : null;
    const endToUse = end && end.night === start.night && end.time && start.time ? end : null;

    const eventType = str(event.eventType)?.toLowerCase().trim();
    const classTypes = ["class", "course", "workshop", "lesson"];
    if (eventType && classTypes.includes(eventType)) {
      screened.push({
        externalId,
        title,
        reason: `a class, not a social (Sabaki eventType ${eventType})`,
      });
      continue;
    }

    const danceStyles = Array.isArray(event.danceStyles)
      ? event.danceStyles.map((s) => str(s)).filter(Boolean)
      : [];
    const styleText = [title, ...danceStyles].join(" ");
    const matched = matchStyles(styleText).styles;
    if (matched.length === 0) {
      screened.push({
        externalId,
        title,
        reason: "names no dance",
      });
      continue;
    }
    const styles: StyleKey[] = matched;

    const venueName = str(event.locationName);
    const addressParts = [str(event.locationAddress), str(event.locationCity)].filter(Boolean);
    const venueAddress = addressParts.length > 0 ? addressParts.join(", ") : null;
    const lat = num(event.latitude);
    const lng = num(event.longitude);
    const venueLocation =
      lat !== null && lng !== null && !(lat === 0 && lng === 0) ? { lat, lng } : null;

    const organizerName = str(event.organizerName);

    const evidence: Record<string, string> = {
      title: `"${title}"`,
      start: `startDateTime ${str(event.startDateTime) ?? "null"}`,
    };
    const danceStylesEvidence = danceStyles.length > 0 ? danceStyles.join(", ") : "none";
    evidence.styles = `danceStyles ${danceStylesEvidence}`;

    listings.push(
      buildListing(
        {
          externalId,
          title,
          start,
          end: endToUse,
          description: null,
          venue: {
            name: venueName,
            address: venueAddress,
            url: null,
            location: venueLocation,
          },
          organizer: { name: organizerName, url: null },
          prices: null,
          ticketUrl: httpUrl(str(event.ticketUrl)),
          eventUrl,
          cancelled: false,
          styles,
          evidence,
        },
        {
          sourceUrl: eventUrl,
          fetchedAt: options.fetchedAt,
          method: "api",
          currency: currencyForCountry(options.metro.countryCode),
        },
      ),
    );
  }

  return { listings, notes, screened };
}

export const sabakiAdapter: SourceAdapter = {
  id: "sabaki" as SourceAdapter["id"],
  tier: "A",
  countries: ["US", "ES"],
  requiredEnv: ["SABAKI_API_KEY"],
  limits: { perDomainIntervalMs: 1000, rps: 1, perDay: 2000 },
  async harvestMetro(metro: Metro, nights: NightDate[], ctx: RunCtx): Promise<HarvestResult> {
    const notes: string[] = [];
    if (!SABAKI_METROS.includes(metro.slug)) {
      notes.push(`sabaki: not enabled for ${metro.slug}`);
      return {
        listings: [],
        notes,
        screened: [],
        doc: {
          url: SABAKI_BASE,
          fetchedAt: ctx.now(),
          httpStatus: 200,
          etag: null,
          lastModified: null,
          contentHash: sha256(JSON.stringify([])),
          cleanedText: null,
        },
      };
    }

    const key = ctx.env.SABAKI_API_KEY!;
    const allEvents: unknown[] = [];
    let cursor: string | null = null;
    let fetchedAt = ctx.now();

    for (let page = 0; page < SABAKI_MAX_PAGES; page++) {
      const response = await ctx.http.request({
        url: sabakiUrl(metro, cursor),
        purpose: "api",
        intervalMs: 1000,
        headers: {
          accept: "application/json",
          authorization: `Bearer ${key}`,
        },
      });
      fetchedAt = response.fetchedAt;
      const body = JSON.parse(response.body) as unknown;
      if (!isObject(body) || !Array.isArray(body.items)) {
        throw new Error(`Sabaki API: unexpected response (status ${response.status})`);
      }
      const items = body.items;
      allEvents.push(...items);
      notes.push(`page ${page + 1}: ${items.length} events`);
      const nextCursor = str(body.nextCursor);
      if (!nextCursor) {
        break;
      }
      cursor = nextCursor;
    }

    const {
      listings,
      notes: listingNotes,
      screened,
    } = sabakiToListings(allEvents, {
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
        url: SABAKI_BASE,
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
