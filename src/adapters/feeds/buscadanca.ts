// Busca Dança's city list of weekly dance nights (D-543).
// The site gave written permission: read once a day, honest user agent, robots.txt honoured,
// facts only, each row links back. Each weekly card for the source's city becomes one weekly
// listing, with the address from the card's own event page.

import { MAX_ITEM_PAGES } from "@/src/adapters/feeds/event-pages";
import { extractJsonLd } from "@/src/adapters/feeds/jsonld";
import { decodeEntities, sha256 } from "@/src/adapters/shared";
import { weeklyRecurrence, firstNightOn } from "@/src/adapters/feeds/weekly-rule";
import type {
  HarvestResult,
  HarvestedListing,
  RunCtx,
  Source,
  SourceAdapter,
} from "@/src/adapters/types";
import { currentNightDate } from "@/src/domain/tonight";
import { CRAWL_INTERVAL_MS } from "@/src/pipeline/http";
import { addCalendarDays } from "@/src/domain/time";
import { buildListing } from "@/src/adapters/structured";
import { currencyForCountry } from "@/src/domain/prices";
import { isStyleKey, type StyleKey } from "@/config/styles";
import type { Weekday } from "@/src/domain/recurrence";

/** The most list pages one read asks for. */
export const MAX_LIST_PAGES = 5;

export interface BuscadancaCard {
  url: string; // the event's own page
  title: string;
  styleSlugs: string[]; // e.g. ["forro"], ["bachata", "danca-de-salao", "salsa", "zouk"], in card order
  citySlug: string | null; // e.g. "rio-de-janeiro"
  frequency: string | null; // e.g. "Evento semanal", "Evento mensal" (trimmed text, as written)
  days: Weekday[]; // "MO".."SU" in card order; [] for "Sem dia definido"
  start: string | null; // "HH:MM"
  end: string | null; // "HH:MM" (from "- 00:00")
}

// STREET_WORD list (case-insensitive, accents as written)
const STREET_WORDS = [
  "Rua",
  "Avenida",
  "Av.",
  "Travessa",
  "Praça",
  "Largo",
  "Estrada",
  "Rodovia",
  "Alameda",
  "Campo",
];

// Helper: normalize a string to lowercased, accent-stripped form
function normalizeWord(word: string): string {
  return word
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

// Helper: check if a word (first whitespace-separated token) is a street word
function isStreetWord(text: string): boolean {
  const firstWord = text.trim().split(/\s+/)[0] || "";
  const normalized = normalizeWord(firstWord);
  return STREET_WORDS.some((sw) => normalizeWord(sw) === normalized);
}

// Helper: check if text starts with a street word (first word matches)
function startsWithStreetWord(text: string): boolean {
  return isStreetWord(text);
}

// Helper: check if text contains a digit
function hasDigit(text: string): boolean {
  return /\d/.test(text);
}

// Helper: check if text contains a comma
function hasComma(text: string): boolean {
  return text.includes(",");
}

/** Clean a Busca Dança address: split venue name and drop landmark segment. */
export function cleanBuscadancaAddress(street: string): { name: string | null; address: string } {
  const trimmed = street.trim();
  if (trimmed === "") {
    return { name: null, address: "" };
  }

  // Rule 1: Name prefix
  let name: string | null = null;
  let currentAddress = trimmed;

  const dashIndex = currentAddress.indexOf(" - ");
  if (dashIndex !== -1) {
    const beforeDash = currentAddress.slice(0, dashIndex).trim();
    const afterDash = currentAddress.slice(dashIndex + 3).trim();

    // Check conditions
    if (!hasDigit(beforeDash) && !hasComma(beforeDash) && !startsWithStreetWord(beforeDash)) {
      // Find the first STREET_WORD in afterDash before the first comma
      const firstCommaIndex = afterDash.indexOf(",");
      const beforeFirstComma =
        firstCommaIndex !== -1 ? afterDash.slice(0, firstCommaIndex) : afterDash;

      // Split into words and find a STREET_WORD
      const words = beforeFirstComma.split(/\s+/);
      let streetWordIndex = -1;
      for (let i = 0; i < words.length; i++) {
        if (isStreetWord(words[i] ?? "")) {
          streetWordIndex = i;
          break;
        }
      }

      if (streetWordIndex !== -1) {
        // Found a STREET_WORD before the first comma
        name = beforeDash;
        // Drop everything before the STREET_WORD (including neighbourhood words)
        const fromStreetWord = afterDash.split(/\s+/).slice(streetWordIndex).join(" ");
        currentAddress = fromStreetWord;
      }
    }
  }

  // Rule 2: Landmark segment
  const parts = currentAddress.split(",").map((p) => p.trim());
  if (parts.length >= 6) {
    const [part0 = "", part1 = "", part2 = ""] = parts;

    // Check if part0 is a street word
    if (isStreetWord(part0)) {
      // Check if part1 is a house number
      const houseNumberRegex = /^\d+[A-Za-z]?$|^s\/n$/i;
      if (houseNumberRegex.test(part1)) {
        // Check if part2's first word equals "praca" or "largo" (accent‑stripped)
        const firstWord = part2.trim().split(/\s+/)[0] || "";
        const normalizedFirstWord = normalizeWord(firstWord);
        if (
          (normalizedFirstWord === "praca" || normalizedFirstWord === "largo") &&
          !hasDigit(part2)
        ) {
          // Drop part2
          const newParts = [...parts.slice(0, 2), ...parts.slice(3)];
          currentAddress = newParts.join(", ");
        }
      }
    }
  }

  // Always return the processed address (currentAddress)
  return { name, address: currentAddress };
}

/** Find the streetAddress from JSON-LD blocks for a given card URL. */
type JsonNode = Record<string, unknown>;
const isNode = (v: unknown): v is JsonNode =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function localBusinessAddress(blocks: unknown[], cardUrl: string): string | null {
  const compareUrl = (u: string) => u.replace(/\/$/, "").replace(/^https?:\/\/(www\.)?/, "");

  for (const block of blocks) {
    if (Array.isArray(block)) {
      const found = localBusinessAddress(block, cardUrl);
      if (found) return found;
    } else if (isNode(block)) {
      // Check if this block is a graph array
      if (Array.isArray(block["@graph"])) {
        const found = localBusinessAddress(block["@graph"], cardUrl);
        if (found) return found;
      }
      // Check if this block is a LocalBusiness with matching URL
      const types = Array.isArray(block["@type"]) ? block["@type"] : [block["@type"]];
      if (types.includes("LocalBusiness")) {
        const nodeUrl = block["url"];
        if (nodeUrl && compareUrl(String(nodeUrl)) === compareUrl(cardUrl)) {
          const addr = block["address"];
          if (isNode(addr)) {
            const street = addr["streetAddress"];
            if (typeof street === "string") {
              return street.trim();
            }
          }
        }
      }
    }
  }
  return null;
}

/** Extract event cards from Busca Dança's city list page HTML. */
export function buscadancaCards(html: string, pageUrl: string): BuscadancaCard[] {
  const cards: BuscadancaCard[] = [];
  const seenUrls = new Set<string>();

  // Find each card by looking for '<div class="jet-listing-grid__item' (case-insensitive, handles single or double quotes)
  const cardRegex = /<div\s+class\s*=\s*["']jet-listing-grid__item\s/gi;
  const cardStarts: number[] = [];
  let match;
  while ((match = cardRegex.exec(html)) !== null) {
    cardStarts.push(match.index);
  }

  for (let i = 0; i < cardStarts.length; i++) {
    const cardStart = cardStarts[i];
    const cardEnd = i + 1 < cardStarts.length ? cardStarts[i + 1] : html.length;
    const cardContent = html.slice(cardStart, cardEnd);

    // Extract URL from data-url attribute
    const dataUrlMatch = cardContent.match(/data-url\s*=\s*["']([^"']*)["']/i);
    let url = "";
    if (dataUrlMatch) {
      const rawUrl = dataUrlMatch[1] ?? "";
      if (rawUrl) {
        try {
          url = new URL(rawUrl, pageUrl).toString();
        } catch {}
      }
    }
    // Validate URL: must be buscadanca.com.br with /eventos-de-danca/ in path
    if (
      !url ||
      !/^https?:\/\/(?:www\.)?buscadanca\.com\.br\/eventos-de-danca\/[^/?#]+\/?$/i.test(url)
    ) {
      continue;
    }
    // Skip duplicates
    if (seenUrls.has(url)) {
      continue;
    }
    seenUrls.add(url);

    // Title: first element (any tag) whose class contains elementor-heading-title
    const titleMatch = cardContent.match(
      /<(\w+)\s+class\s*=\s*["'][^"']*elementor-heading-title[^"']*["'][^>]*>([\s\S]*?)<\/\1>/i,
    );
    let title = "";
    if (titleMatch) {
      const inner = titleMatch[2] ?? "";
      title = decodeEntities(inner.replace(/<[^>]*>/g, ""))
        .replace(/\s+/g, " ")
        .trim();
    }
    if (!title) {
      continue;
    }

    // Style slugs: href=".../estilo-evento/<slug>/"
    const styleSlugs: string[] = [];
    const styleRegex = /href\s*=\s*["'][^"']*\/estilo-evento\/([^/"']+)\/[^"']*["']/gi;
    let styleMatch;
    while ((styleMatch = styleRegex.exec(cardContent)) !== null) {
      const slug = styleMatch[1] ?? "";
      if (slug && !styleSlugs.includes(slug)) {
        styleSlugs.push(slug);
      }
    }

    // City slug: first href=".../cidade-evento/<slug>/"
    let citySlug: string | null = null;
    const cityMatch = cardContent.match(/href\s*=\s*["'][^"']*\/cidade-evento\/([^/"'?#]+)/i);
    if (cityMatch) {
      citySlug = cityMatch[1] ?? null;
    }

    // Frequency: first <span class="elementor-icon-list-text">
    let frequency: string | null = null;
    const freqMatch = cardContent.match(
      /<span\s+class\s*=\s*["'][^"']*elementor-icon-list-text[^"']*["'][^>]*>([^<]*)<\/span>/i,
    );
    if (freqMatch) {
      frequency = (freqMatch[1] ?? "").trim();
    }

    // Days: each <span class="jet-listing-dynamic-terms__link">TEXT</span> (span, not anchor)
    const days: Weekday[] = [];
    const daySpanRegex =
      /<span\s+class\s*=\s*["'][^"']*jet-listing-dynamic-terms__link[^"']*["'][^>]*>([^<]*)<\/span>/g;
    let dayMatch;
    while ((dayMatch = daySpanRegex.exec(cardContent)) !== null) {
      const spanHtml = dayMatch[0];
      // Skip if it's an anchor (has href)
      if (spanHtml.includes("href=")) {
        continue;
      }
      const text = (dayMatch[1] ?? "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
      const WEEKDAY_WORDS: Record<string, Weekday> = {
        segunda: "MO",
        terca: "TU",
        quarta: "WE",
        quinta: "TH",
        sexta: "FR",
        sabado: "SA",
        domingo: "SU",
      };
      const day: Weekday | null = WEEKDAY_WORDS[text.trim().replace(/-feira$/, "")] ?? null;
      if (day && !days.includes(day)) {
        days.push(day);
      }
    }

    // Start and end times: <div class="jet-listing-dynamic-field__content" >TEXT</div>
    let start: string | null = null;
    let end: string | null = null;
    const timeDivRegex =
      /<div\s+class\s*=\s*["'][^"']*jet-listing-dynamic-field__content[^"']*["'][^>]*>([^<]*)<\/div>/gi;
    let timeMatch;
    while ((timeMatch = timeDivRegex.exec(cardContent)) !== null) {
      const text = (timeMatch[1] ?? "").trim();
      // Start: HH:MM
      const startMatch = text.match(/^(\d{1,2}):(\d{2})$/);
      if (startMatch && !start) {
        const hours = startMatch[1]!.padStart(2, "0");
        const minutes = startMatch[2];
        const time = `${hours}:${minutes}`;
        if (time >= "00:00" && time <= "23:59") {
          start = time;
        }
      }
      // End: - HH:MM
      const endMatch = text.match(/^-\s*(\d{1,2}):(\d{2})$/);
      if (endMatch && !end) {
        const hours = endMatch[1]!.padStart(2, "0");
        const minutes = endMatch[2];
        const time = `${hours}:${minutes}`;
        if (time >= "00:00" && time <= "23:59") {
          end = time;
        }
      }
    }

    cards.push({
      url,
      title,
      styleSlugs,
      citySlug,
      frequency,
      days,
      start,
      end,
    });
  }

  return cards;
}

export const buscadancaAdapter: SourceAdapter = {
  id: "buscadanca",
  tier: "A",
  limits: { perDomainIntervalMs: CRAWL_INTERVAL_MS },
  async harvest(source: Source, ctx: RunCtx): Promise<HarvestResult> {
    const base = (source.feedUrl ?? source.url).replace(/\/?$/, "/");
    const citySlugMatch = base.match(/\/cidade-evento\/([^/]+)/);
    const citySlug = citySlugMatch?.[1] ?? null;
    if (!citySlug) {
      throw new Error("Busca Dança source URL must contain /cidade-evento/<city>/");
    }

    // Read pages 1-5, stop when a page adds no new card URLs
    const allCards: BuscadancaCard[] = [];
    const seenCardUrls = new Set<string>();
    let pageNum = 1;
    let whole = true;
    const notes: string[] = [];
    let firstPageFetchedAt: Date | null = null;
    let firstPageStatus: number | null = null;
    let firstPageEtag: string | null = null;
    let firstPageLastModified: string | null = null;

    while (pageNum <= MAX_LIST_PAGES) {
      const pageUrl = pageNum === 1 ? base : `${base}page/${pageNum}/`;
      let page;
      try {
        page = await ctx.http.request({
          url: pageUrl,
          purpose: "crawl",
          headers: { accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1" },
        });
      } catch (err) {
        if (pageNum === 1) {
          throw err;
        }
        notes.push(`page ${pageNum} failed: ${err instanceof Error ? err.message : String(err)}`);
        whole = false;
        break;
      }

      if (pageNum === 1) {
        firstPageFetchedAt = page.fetchedAt;
        firstPageStatus = page.status;
        firstPageEtag = page.etag;
        firstPageLastModified = page.lastModified;
      }

      const cards = buscadancaCards(page.body, page.url || pageUrl);
      const newCards = cards.filter((c) => !seenCardUrls.has(c.url));
      newCards.forEach((c) => seenCardUrls.add(c.url));
      allCards.push(...newCards);

      // Stop paging if no new card for this city
      const newForCity = newCards.filter((c) => c.citySlug === citySlug);
      if (newForCity.length === 0) {
        break;
      }
      if (pageNum === MAX_LIST_PAGES) {
        // Page 5 still had new cards: later pages are unread, so the read retires nothing.
        notes.push(`stopped at page ${MAX_LIST_PAGES}`);
        whole = false;
      }
      pageNum++;
    }

    // Keep only weekly cards for this city
    const kept = allCards.filter((card) => {
      return (
        card.citySlug === citySlug &&
        card.frequency?.toLowerCase() === "evento semanal" &&
        card.days.length > 0
      );
    });

    const otherCities = allCards.filter((c) => c.citySlug !== citySlug).length;
    const nonWeekly = allCards.filter(
      (c) => c.frequency?.toLowerCase() !== "evento semanal" || c.days.length === 0,
    ).length;

    if (kept.length === 0) {
      throw new Error(`Busca Dança's page shows no weekly cards for ${citySlug}`);
    }

    // Read item pages for at most MAX_ITEM_PAGES cards
    const toRead = kept.slice(0, MAX_ITEM_PAGES);
    if (kept.length > MAX_ITEM_PAGES) {
      notes.push(
        `${kept.length - MAX_ITEM_PAGES} weekly card(s) over the cap of ${MAX_ITEM_PAGES} left unread`,
      );
      whole = false;
    }
    const listings: HarvestedListing[] = [];
    const fromNight = currentNightDate(ctx.now(), ctx.metro.tz);
    const currency = currencyForCountry(ctx.metro.countryCode);

    for (const card of toRead) {
      let itemPage;
      try {
        itemPage = await ctx.http.request({
          url: card.url,
          purpose: "crawl",
          headers: { accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1" },
        });
      } catch (err) {
        notes.push(`card ${card.url} failed: ${err instanceof Error ? err.message : String(err)}`);
        whole = false;
        continue;
      }

      // Extract JSON-LD
      const blocks = extractJsonLd(itemPage.body).blocks;
      const rawAddress = localBusinessAddress(blocks, card.url);

      if (!rawAddress) {
        notes.push(`card ${card.url}: no LocalBusiness address found`);
        whole = false;
        continue;
      }

      // Clean the address
      const { name, address } = cleanBuscadancaAddress(rawAddress);

      // Check if address has no street
      const lowerAddr = address
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
      const hasStreetWord = /\b(rua|avenida|av\.|praca|praça|travessa|largo|estrada|campo)\b/.test(
        lowerAddr,
      );
      const hasDigit = /\d/.test(address);
      const parts = address
        .split(/[,\-–]/)
        .map((p) => p.trim())
        .filter(Boolean);
      const isOnlyCityState =
        lowerAddr.includes("rio de janeiro") &&
        lowerAddr.includes("rj") &&
        parts.length < 3 &&
        !hasDigit &&
        !hasStreetWord;
      if (isOnlyCityState) {
        notes.push(`card ${card.url}: no street address`);
        continue; // skip but keep whole
      }

      // Determine first night
      const night = firstNightOn(card.days, fromNight);
      if (!night) {
        notes.push(`card ${card.url}: no night found in window`);
        continue;
      }

      // Build styles
      const styleMap: Record<string, string> = {
        forro: "forro",
        "forro-pe-de-serra": "forro",
        tango: "milonga",
        zouk: "brazilian_zouk",
        salsa: "salsa",
        bachata: "bachata",
        "samba-de-gafieira": "samba_de_gafieira",
        "danca-de-salao": "ballroom",
      };
      const styleKeys = card.styleSlugs
        .map((slug) => styleMap[slug])
        .filter((key): key is StyleKey => key !== undefined && isStyleKey(key));
      const uniqueStyles = Array.from(new Set(styleKeys));

      // Determine end day
      let endDay = night;
      if (card.end && card.start) {
        const startTime = card.start;
        const endTime = card.end;
        if (endTime <= startTime) {
          endDay = addCalendarDays(night, 1);
        }
      }

      // Build evidence
      const dayWords = card.days
        .map((d) => {
          const map: Record<Weekday, string> = {
            MO: "Segunda-Feira",
            TU: "Terça-Feira",
            WE: "Quarta-Feira",
            TH: "Quinta-Feira",
            FR: "Sexta-Feira",
            SA: "Sábado",
            SU: "Domingo",
          };
          return map[d];
        })
        .join(" · ");
      const evidence: Record<string, string> = {};
      if (card.start) {
        evidence.start = `card "${dayWords} ${card.start}" · Evento semanal`.trim().slice(0, 300);
      }
      if (card.end) {
        evidence.end_time = `card "${dayWords} ${card.end}" · Evento semanal`.trim().slice(0, 300);
      }

      const event = {
        externalId: card.url + "#weekly",
        title: card.title,
        start: {
          day: night,
          night,
          time: card.start,
          zone: ctx.metro.tz,
          absolute: false,
        },
        end: card.end
          ? {
              day: endDay,
              night,
              time: card.end,
              zone: ctx.metro.tz,
              absolute: false,
            }
          : null,
        description: null,
        venue: {
          name,
          address,
          url: null,
          location: null,
        },
        organizer: { name: null, url: null },
        prices: null,
        ticketUrl: null,
        eventUrl: card.url,
        cancelled: false,
        type: "social" as const,
        styles: uniqueStyles.length > 0 ? uniqueStyles : undefined,
        bands: [],
        djs: [],
        evidence,
        recurrence: weeklyRecurrence(card.days, night, card.start),
      };

      const built = buildListing(event, {
        sourceUrl: card.url,
        fetchedAt: itemPage.fetchedAt,
        method: "feed",
        currency,
      });

      // Set local_date to the first night
      built.listing.local_date = night;
      listings.push(built);
    }

    notes.unshift(
      `${kept.length} weekly card(s) for ${citySlug} of ${allCards.length} read; ${nonWeekly} monthly or undated, ${otherCities} other cities`,
    );

    const result: HarvestResult = {
      listings,
      notes,
      doc: {
        url: base,
        fetchedAt: firstPageFetchedAt!,
        httpStatus: firstPageStatus!,
        etag: firstPageEtag,
        lastModified: firstPageLastModified,
        contentHash: sha256(JSON.stringify(listings.map((l) => [l.externalId, l.listing]))),
        cleanedText: null,
      },
    };

    if (whole) {
      result.whole = true;
    }

    return result;
  },
};
