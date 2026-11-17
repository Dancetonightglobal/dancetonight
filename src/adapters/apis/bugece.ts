// Bugece (bugece.co), Istanbul's club and concert ticketer, read through its public list API (its openapi.json:
// 'Public read APIs for the BUGECE event catalog'; robots.txt allows /api/list). The owner read its terms and
// approved it (D-685). One to five requests a run; club genres at night count, concerts and daytime events are
// screened.

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

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number.parseFloat(v) : Number.NaN;
  return Number.isFinite(n) ? n : null;
};

export const BUGECE_LIST = "https://bugece.co/api/list";
export const BUGECE_PAGE_SIZE = 100;
export const BUGECE_MAX_PAGES = 5;

export const BUGECE_CITIES: Readonly<Record<string, string>> = {
  istanbul: "istanbul",
};

export const CLUB_GENRES: readonly string[] = [
  "Techno",
  "Hard Techno",
  "House",
  "Tech House",
  "Melodic",
  "Minimal",
  "Afro",
  "Trance",
  "Electronic",
  "EDM",
  "UK Garage",
  "Bounce",
  "Disco | Funk",
  "Indie Electronica",
];

export function bugeceUrl(city: string, page: number): string {
  const url = new URL(BUGECE_LIST);
  url.searchParams.set("indices", "events");
  url.searchParams.set("city", city);
  url.searchParams.set("page", String(page));
  url.searchParams.set("pageSize", String(BUGECE_PAGE_SIZE));
  return url.toString();
}

function isNightTime(time: string | null): boolean {
  if (!time) return false;
  const hour = Number(time.slice(0, 2));
  return hour >= 21 || hour < 6;
}

export function bugeceToListings(
  hits: unknown[],
  options: { metro: Metro; nights: readonly string[]; fetchedAt: Date },
): {
  listings: HarvestedListing[];
  notes: string[];
  screened: Array<{ externalId: string; title: string; reason: string }>;
} {
  const listings: HarvestedListing[] = [];
  const notes: string[] = [];
  const screened: Array<{ externalId: string; title: string; reason: string }> = [];
  const seen = new Set<string>();

  for (const raw of hits) {
    if (!isObject(raw)) continue;
    const hit = raw;
    const id = str(hit._id);
    if (!id) continue;
    const externalId = `bugece:${id}`;
    if (seen.has(externalId)) continue;
    seen.add(externalId);

    const name = plainText(hit.name);
    if (!name) continue;

    // Start time
    const start = isoToLocal(hit.start_time, options.metro.tz);
    if (!start) continue;
    if (!options.nights.includes(start.night)) continue;

    // End time
    let end = isoToLocal(hit.end_time, options.metro.tz);
    if (end) {
      // Check if end is after start and within 12 hours
      const startInstant = new Date(hit.start_time as string).getTime();
      const endInstant = new Date(hit.end_time as string).getTime();
      if (endInstant <= startInstant || endInstant - startInstant > 12 * 60 * 60 * 1000) {
        end = null;
      }
    }

    // Genres
    const genres: string[] = [];
    const musicCategories = hit.music_categories;
    if (Array.isArray(musicCategories)) {
      for (const cat of musicCategories) {
        if (isObject(cat) && typeof cat.name === "string") {
          genres.push(cat.name.trim());
        }
      }
    }

    // Determine if we should keep or screen
    const matchedStyles = matchStyles(name, options.metro.languages).styles;
    let keep = false;
    let styles: StyleKey[] = [];
    let reason = "";

    // Rule 5a: matched styles
    if (matchedStyles.length > 0) {
      keep = true;
      styles = matchedStyles;
    } else {
      // Rule 5b: club genres at night
      const hasClubGenre = genres.some((g) => CLUB_GENRES.includes(g));
      const isNight = isNightTime(start.time);
      if (hasClubGenre && isNight) {
        keep = true;
        // Determine styles from genres
        const hasTechno = genres.some((g) => ["Techno", "Hard Techno", "Trance"].includes(g));
        const hasHouse = genres.some((g) =>
          [
            "House",
            "Tech House",
            "Melodic",
            "Minimal",
            "Afro",
            "Disco | Funk",
            "UK Garage",
          ].includes(g),
        );
        if (hasTechno) styles.push("techno");
        if (hasHouse) styles.push("house");
        if (styles.length === 0) styles.push("dj_night");
      } else {
        // Rule 5c: party title at night
        const partyMatch = /\b(party|parti|partisi|club ?night|all night long|rave)\b/i.test(name);
        if (partyMatch && isNight) {
          keep = true;
          const isHipHop = genres.some((g) => ["Hip-Hop I R&B", "Rap"].includes(g));
          styles = isHipHop ? ["hip_hop_club"] : ["dj_night"];
        } else {
          // Rule 5d: screen
          keep = false;
          reason = `not a dance night (Bugece: ${genres.join(", ") || "no genre"}, starts ${start.time ?? "no time"})`;
        }
      }
    }

    if (!keep) {
      screened.push({ externalId, title: name, reason });
      continue;
    }

    // Prices
    let prices: ListingPrice[] | null = null;
    const showPrice = hit.show_price;
    const startingFrom = num(hit.starting_from);
    if (showPrice === true && startingFrom !== null && startingFrom > 0) {
      prices = [
        {
          label: "Tickets from",
          amount: startingFrom,
          currency: "TRY",
          includes: null,
        },
      ];
    }

    // Venue
    const venue = isObject(hit.venue) ? hit.venue : null;
    const venueName = venue ? (plainText(venue.name) ?? null) : null;
    const geo = isObject(hit._geo) ? hit._geo : null;
    const lat = num(geo?.lat);
    const lng = num(geo?.lng);
    const location: Point | null =
      lat !== null && lng !== null && !(lat === 0 && lng === 0) ? { lat, lng } : null;

    // URLs
    const slug = str(hit.slug);
    if (!slug) continue;
    const baseUrl = `https://bugece.co/tr/event/${slug}`;
    const ticketUrl = httpUrl(baseUrl);
    const eventUrl = ticketUrl;
    const sourceUrl = baseUrl;

    // Evidence
    const evidence: Record<string, string> = {
      title: `"${name}"`,
      start: `start_time ${hit.start_time}`,
    };
    if (genres.length > 0) {
      evidence.genre = genres.join(", ");
    }

    listings.push(
      buildListing(
        {
          externalId,
          title: name,
          start,
          end: end?.time && end.night === start.night ? end : null,
          description: null,
          venue: {
            name: venueName,
            address: null,
            url: null,
            location,
          },
          organizer: { name: null, url: null },
          prices,
          ticketUrl,
          eventUrl,
          cancelled: false,
          styles,
          evidence,
        },
        {
          sourceUrl,
          fetchedAt: options.fetchedAt,
          method: "api",
          currency: "TRY",
        },
      ),
    );
  }

  notes.push(
    `${listings.length} kept, ${screened.length} screened of ${hits.length} in the window`,
  );
  return { listings, notes, screened };
}

export const bugeceAdapter: SourceAdapter = {
  id: "bugece" as SourceAdapter["id"],
  tier: "A",
  countries: ["TR"],
  requiredEnv: [],
  limits: { perDomainIntervalMs: 2000, rps: 0.5, perDay: 50 },
  async harvestMetro(metro: Metro, nights: NightDate[], ctx: RunCtx): Promise<HarvestResult> {
    const city = BUGECE_CITIES[metro.slug];
    if (!city) {
      return {
        listings: [],
        notes: [`no Bugece city for ${metro.slug}`],
        screened: [],
        doc: {
          url: "",
          fetchedAt: ctx.now(),
          httpStatus: 200,
          etag: null,
          lastModified: null,
          contentHash: sha256(JSON.stringify([])),
          cleanedText: null,
        },
      };
    }

    const allHits: unknown[] = [];
    const notes: string[] = [];
    let fetchedAt = ctx.now();

    for (let page = 1; page <= BUGECE_MAX_PAGES; page++) {
      const response = await ctx.http.request({
        url: bugeceUrl(city, page),
        purpose: "api",
        intervalMs: 2000,
        headers: { accept: "application/json" },
      });
      fetchedAt = response.fetchedAt;
      const body = JSON.parse(response.body) as unknown;
      if (!isObject(body) || body.success !== true) {
        const messages =
          isObject(body) && Array.isArray(body.messages)
            ? (body.messages as string[]).join(", ")
            : "unknown";
        throw new Error(`Bugece API error: ${messages}`);
      }
      const data = isObject(body.data) ? body.data : null;
      const hits = data && Array.isArray(data.hits) ? data.hits : [];
      allHits.push(...hits);

      if (page === 1) {
        const totalHits = data && typeof data.totalHits === "number" ? data.totalHits : 0;
        notes.push(`${totalHits} events in ${city}`);
      }

      if (hits.length < BUGECE_PAGE_SIZE) break;
      if (data && typeof data.totalHits === "number") {
        if (page * BUGECE_PAGE_SIZE >= data.totalHits) break;
      }
    }

    const {
      listings,
      notes: listingNotes,
      screened,
    } = bugeceToListings(allHits, {
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
        url: bugeceUrl(city, 1),
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
