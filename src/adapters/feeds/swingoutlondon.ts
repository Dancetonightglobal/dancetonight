// Swing Out London reader (D-870)

import { decodeEntities, isoToLocal, sha256 } from "@/src/adapters/shared";
import { buildListing, type StructuredEvent } from "@/src/adapters/structured";
import { isStyleKey } from "@/config/styles";
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

export interface SwingOutLondonRow {
  id: string;
  night: string;
  title: string;
  venueName: string;
  area: string | null;
  postcode: string | null;
  url: string | null;
  cancelled: boolean;
}

export function parseSwingOutLondon(html: string, pageUrl: string): SwingOutLondonRow[] {
  const rows: SwingOutLondonRow[] = [];

  // Find all <li> tags in the HTML
  const liRegex = /<li\b[^>]*>([\s\S]*?)<\/li>/gi;
  let liMatch;
  while ((liMatch = liRegex.exec(html)) !== null) {
    const liContent = liMatch[1] ?? "";

    // Check if this li contains a postcode link for socials (href starts with /map/socials/)
    const postcodeHrefMatch = liContent.match(
      /<a\s+[^>]*class\s*=\s*["'][^"']*postcode[^"']*["'][^>]*href\s*=\s*["'](\/map\/socials\/(\d{4}-\d{2}-\d{2})[^"']*)["']/i,
    );
    const night = postcodeHrefMatch?.[2] ?? null;
    if (!night) {
      continue; // not a social row
    }

    // Extract id from details <a>
    const idMatch = liContent.match(/<a\s+[^>]*id\s*=\s*["']([^"']+)["'][^>]*>/i);
    const id = idMatch?.[1] ?? null;
    if (!id) {
      continue;
    }

    // Extract details <a> href
    const detailsHrefMatch = liContent.match(
      /<a\s+[^>]*id\s*=\s*["'][^"']+["'][^>]*href\s*=\s*["']([^"']*)["']/i,
    );
    let url: string | null = null;
    if (detailsHrefMatch?.[1]) {
      try {
        const resolved = new URL(detailsHrefMatch[1], pageUrl).toString();
        if (resolved.startsWith("http://") || resolved.startsWith("https://")) {
          url = resolved;
        }
      } catch {
        // ignore invalid URL
      }
    }

    // Extract the inner text of the details <a> (including possible <span class="social_highlight">)
    const aContentMatch = liContent.match(
      /<a\s+[^>]*id\s*=\s*["'][^"']+["'][^>]*>([\s\S]*?)<\/a>/i,
    );
    if (!aContentMatch) {
      continue;
    }
    let aInner = aContentMatch[1] ?? "";

    // Remove <span class="social_highlight"> tags but keep their content
    aInner = aInner.replace(
      /<span\s+[^>]*class\s*=\s*["'][^"']*social_highlight[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi,
      "$1",
    );

    // Split at <span class="info"> (if present)
    const infoMatch = aInner.match(
      /^(.*?)<span\s+[^>]*class\s*=\s*["'][^"']*info[^"']*["'][^>]*>([\s\S]*?)<\/span>/i,
    );
    let beforeInfo = "";
    let infoText = "";
    if (infoMatch) {
      beforeInfo = infoMatch[1] ?? "";
      infoText = infoMatch[2] ?? "";
    } else {
      // No info span: treat whole aInner as beforeInfo, infoText empty
      beforeInfo = aInner;
      infoText = "";
    }

    // Decode entities and collapse whitespace
    beforeInfo = decodeEntities(beforeInfo).replace(/\s+/g, " ").trim();
    infoText = decodeEntities(infoText).replace(/\s+/g, " ").trim();

    // Remove trailing " -" from beforeInfo
    beforeInfo = beforeInfo.replace(/\s*-\s*$/, "").trim();
    if (!beforeInfo) {
      continue;
    }
    if (!infoText) {
      continue;
    }

    // Split infoText at last " in "
    let venueName = infoText;
    let area: string | null = null;
    const lastIn = infoText.lastIndexOf(" in ");
    if (lastIn !== -1) {
      venueName = infoText.slice(0, lastIn).trim();
      area = infoText.slice(lastIn + 4).trim();
    }

    // Extract postcode from postcode link's title attribute
    // The postcode link's attributes come in any order (the site writes title before class).
    const postcodeTag =
      liContent.match(/<a\s[^>]*class\s*=\s*["'][^"']*postcode[^"']*["'][^>]*>/i)?.[0] ?? "";
    const postcodeTitleMatch = postcodeTag.match(/\btitle\s*=\s*["']([^"']+)["']/i);
    let postcode: string | null = null;
    if (postcodeTitleMatch?.[1]) {
      const title = decodeEntities(postcodeTitleMatch[1]);
      const beforeToBe = title.split(" to be precise")[0]?.trim();
      if (beforeToBe) {
        // Remove any trailing punctuation (.,;)
        const cleaned = beforeToBe.replace(/[.,;]+$/, "").trim();
        if (/^[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2}$/i.test(cleaned)) {
          postcode = cleaned;
        }
      }
    }

    // Determine cancelled: any element with class containing "cancelled"
    const cancelled = /<[^>]*class\s*=\s*["'][^"']*cancelled[^"']*["'][^>]*>/i.test(liContent);

    rows.push({
      id,
      night,
      title: beforeInfo,
      venueName,
      area,
      postcode,
      url,
      cancelled,
    });
  }

  return rows;
}

export const swingOutLondonAdapter: SourceAdapter = {
  id: "swingoutlondon",
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
    const rows = parseSwingOutLondon(page.body, pageUrl);
    if (rows.length === 0) {
      throw new Error("Swing Out London shows no socials");
    }

    const tz = ctx.metro.tz;
    const fromNight = currentNightDate(ctx.now(), tz);
    const lastNight = addCalendarDays(fromNight, MATERIALIZE_DAYS - 1);

    const kept = rows.filter((row) => row.night >= fromNight && row.night <= lastNight);

    const listings: HarvestedListing[] = [];
    for (const row of kept) {
      const start = isoToLocal(row.night, tz);
      if (!start) {
        continue;
      }

      const structured: StructuredEvent = {
        externalId: `swingoutlondon:${row.id}`,
        title: row.title,
        start,
        end: null,
        description: null,
        venue: {
          name: row.venueName,
          address: row.postcode ? `London ${row.postcode}` : null,
          url: null,
          location: null,
        },
        organizer: { name: null, url: null },
        prices: null,
        ticketUrl: null,
        eventUrl: row.url,
        cancelled: row.cancelled,
        styles: source.styles.filter(isStyleKey),
        type: "social",
        bands: [],
        djs: [],
        evidence: {},
        recurrence: null,
      };

      const currency = currencyForCountry(ctx.metro.countryCode);
      const built = buildListing(structured, {
        sourceUrl: url,
        fetchedAt: page.fetchedAt,
        method: "feed",
        currency,
      });

      listings.push(built);
    }

    const notes = [`${kept.length} social night(s) in the window of ${rows.length} listed`];

    const doc = {
      url,
      fetchedAt: page.fetchedAt,
      httpStatus: page.status,
      etag: page.etag,
      lastModified: page.lastModified,
      contentHash: sha256(JSON.stringify(listings.map((l) => [l.externalId, l.listing]))),
      cleanedText: null,
    };

    const result: HarvestResult = {
      listings,
      notes,
      doc,
      whole: true,
    };

    return result;
  },
};
