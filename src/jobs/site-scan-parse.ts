import { decodeEntities, plainText } from "@/src/adapters/shared";

export interface ScannedCard {
  city: string; // e.g. "mumbai" (passed in)
  day: string; // "2026-11-08" (passed in)
  id: string; // data-card-id
  detailPath: string; // href of the card's main link, e.g. "/e/weekend-in-house-pool-party-...-947c60"
  time: string | null; // text of the first span.type-stamp inside the card, e.g. "6:30"; null when the card has none
  timeHeading: string; // text of the nearest preceding <span class="type-marker ..."> heading ("6pm", "Time not listed")
  title: string; // text of span.type-card-name, entities decoded
  kinds: string[]; // texts of the spans inside the first p.type-label, skipping " · " separators
  //   e.g. ["Other social dancing", "Social"]
  status: string | null; // text of p.type-status ("Starts at 6:30pm, until 11:45pm"), null if absent
  secondary: string[]; // texts of the spans inside p.type-secondary, skipping " · " separators
  //   e.g. ["AB Nair Road, Juhu", "12 mi", "Free"]
  outLinks: { href: string; label: string }[]; // every <a target="_blank"> in the card (outside links):
  //   href and its text ("Event page at allevents.in")
}

export interface PairHint {
  a: string;
  b: string; // card ids
  city: string;
  day: string;
  why: "same-title" | "similar-title" | "same-link";
}

/**
 * Extract card records from a day page HTML.
 */
export function parseDayPage(html: string, city: string, day: string): ScannedCard[] {
  // Find the main content
  const mainMatch = html.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
  if (!mainMatch) {
    return [];
  }
  const mainContent = mainMatch[1] ?? "";

  const cards: ScannedCard[] = [];
  const seenIds = new Set<string>();

  // Find all card positions
  const cardIdRegex = /data-card-id="([^"]+)"/g;
  let cardMatch: RegExpExecArray | null;

  while ((cardMatch = cardIdRegex.exec(mainContent)) !== null) {
    const id = cardMatch[1] ?? "";
    if (seenIds.has(id)) {
      continue;
    }
    seenIds.add(id);

    const cardStart = cardMatch.index ?? 0;

    // Find the nearest preceding time-marker
    const contentBeforeCard = mainContent.substring(0, cardStart);
    // Look for the last time-marker before this card
    const timeMarkerRegex = /<span\s+class="[^"]*type-marker[^"]*"[^>]*>([^<]+)<\/span>/g;
    let lastTimeHeading = "";
    let timeMatch: RegExpExecArray | null;
    // Reset lastIndex
    timeMarkerRegex.lastIndex = 0;
    while ((timeMatch = timeMarkerRegex.exec(contentBeforeCard)) !== null) {
      const heading = plainText(timeMatch[1] ?? "");
      if (heading) {
        lastTimeHeading = heading;
      }
    }

    // Find card content until next data-card-id or end
    let cardEnd = mainContent.length;
    const remaining = mainContent.substring(cardStart + (cardMatch[0]?.length ?? 0));
    const nextCardMatch = remaining.match(/data-card-id="[^"]+"/);
    if (nextCardMatch && nextCardMatch.index !== undefined) {
      cardEnd = cardStart + (cardMatch[0]?.length ?? 0) + nextCardMatch.index;
    }

    const cardHtml = mainContent.substring(cardStart, cardEnd);
    const card = parseCard(cardHtml, id, city, day, lastTimeHeading);
    if (card) {
      cards.push(card);
    }
  }

  return cards;
}

function parseCard(
  html: string,
  id: string,
  city: string,
  day: string,
  timeHeading: string,
): ScannedCard | null {
  // Extract detailPath: first href starting with "/e/"
  const detailPathMatch = html.match(/<a[^>]*href="(\/e\/[^"]*)"[^>]*>/);
  const detailPath = detailPathMatch ? (detailPathMatch[1] ?? "") : "";

  // Extract time from type-stamp
  const timeMatch = html.match(/<span[^>]*class="[^"]*type-stamp[^"]*"[^>]*>([^<]*)<\/span>/);
  const time = timeMatch ? plainText(timeMatch[1] ?? "") : null;

  // Extract title from type-card-name
  const titleMatch = html.match(
    /<span[^>]*class="[^"]*type-card-name[^"]*"[^>]*>([\s\S]*?)<\/span>/,
  );
  let title = "";
  if (titleMatch && titleMatch[1]) {
    title = decodeEntities(titleMatch[1].replace(/<[^>]*>/g, ""));
    title = title.replace(/\s+/g, " ").trim();
  }

  // Extract kinds from first p.type-label
  const kinds: string[] = [];
  const labelMatch = html.match(/<p[^>]*class="[^"]*type-label[^"]*"[^>]*>([\s\S]*?)<\/p>/);
  if (labelMatch && labelMatch[1]) {
    const labelHtml = labelMatch[1];
    // Strip all tags, decode entities, then split on "·"
    const text = decodeEntities(labelHtml.replace(/<[^>]*>/g, ""));
    const parts = text
      .split(/·/)
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
    kinds.push(...parts);
  }

  // Extract status
  const statusMatch = html.match(/<p[^>]*class="[^"]*type-status[^"]*"[^>]*>([\s\S]*?)<\/p>/);
  const status = statusMatch ? plainText(statusMatch[1] ?? "") : null;

  // Extract secondary items
  const secondary: string[] = [];
  const secondaryMatch = html.match(/<p[^>]*class="[^"]*type-secondary[^"]*"[^>]*>([\s\S]*?)<\/p>/);
  if (secondaryMatch && secondaryMatch[1]) {
    const secondaryHtml = secondaryMatch[1];
    // Strip all tags, decode entities, then split on "·"
    const text = decodeEntities(secondaryHtml.replace(/<[^>]*>/g, ""));
    const parts = text
      .split(/·/)
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
    secondary.push(...parts);
  }

  // Extract outLinks: find all <a> tags, then filter those with target="_blank"
  const outLinks: { href: string; label: string }[] = [];
  const linkRegex = /<a\s+([^>]*)>([\s\S]*?)<\/a>/g;
  let linkMatch: RegExpExecArray | null;
  while ((linkMatch = linkRegex.exec(html)) !== null) {
    const attrs = linkMatch[1] ?? "";
    const inner = linkMatch[2] ?? "";
    // Check if target="_blank" exists in attributes (in any order)
    if (!attrs.includes('target="_blank"')) {
      continue;
    }
    // Extract href from attributes
    const hrefMatch = attrs.match(/href="([^"]*)"/);
    if (!hrefMatch) {
      continue;
    }
    const href = decodeEntities(hrefMatch[1] ?? "");
    const label = plainText(inner) || "";
    if (href && label) {
      outLinks.push({ href, label });
    }
  }

  return {
    city,
    day,
    id,
    detailPath,
    time,
    timeHeading,
    title,
    kinds,
    status,
    secondary,
    outLinks,
  };
}

/**
 * Generate hints about potentially duplicate cards.
 */
export function pairHints(cards: ScannedCard[]): PairHint[] {
  const hints: PairHint[] = [];

  // Group cards by city and day
  const groups: Map<string, ScannedCard[]> = new Map();
  for (const card of cards) {
    const key = `${card.city}|${card.day}`;
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(card);
  }

  for (const groupCards of groups.values()) {
    for (let i = 0; i < groupCards.length; i++) {
      for (let j = i + 1; j < groupCards.length; j++) {
        const a = groupCards[i];
        const b = groupCards[j];
        if (!a || !b) continue;

        // Check same-title
        if (normalizeTitle(a.title) === normalizeTitle(b.title)) {
          hints.push({
            a: a.id,
            b: b.id,
            city: a.city,
            day: a.day,
            why: "same-title",
          });
          continue;
        }

        // Check similar-title
        if (areTitlesSimilar(a.title, b.title)) {
          hints.push({
            a: a.id,
            b: b.id,
            city: a.city,
            day: a.day,
            why: "similar-title",
          });
          continue;
        }

        // Check same-link
        if (haveSameLink(a, b)) {
          hints.push({
            a: a.id,
            b: b.id,
            city: a.city,
            day: a.day,
            why: "same-link",
          });
          continue;
        }
      }
    }
  }

  return hints;
}

export function normalizeTitle(title: string): string {
  // Remove accents: NFD + strip combining marks
  const normalized = title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  // Keep only letters and digits of any script, and spaces
  const cleaned = normalized.replace(/[^\p{L}\p{N}\s]/gu, " ");
  // Collapse spaces
  return cleaned.replace(/\s+/g, " ").trim();
}

function areTitlesSimilar(titleA: string, titleB: string): boolean {
  const normA = normalizeTitle(titleA);
  const normB = normalizeTitle(titleB);

  // If either normalized title is empty, they cannot be similar
  if (!normA || !normB) {
    return false;
  }

  // At least 2 words
  const wordsA = normA.split(/\s+/).filter((w) => w.length > 0);
  const wordsB = normB.split(/\s+/).filter((w) => w.length > 0);

  if (wordsA.length < 2 || wordsB.length < 2) {
    return false;
  }

  // Check if shorter appears inside longer as a contiguous run
  const shorter = wordsA.length <= wordsB.length ? normA : normB;
  const longer = wordsA.length <= wordsB.length ? normB : normA;

  // Check for contiguous substring with word boundaries
  if (
    longer.includes(` ${shorter} `) ||
    longer.startsWith(`${shorter} `) ||
    longer.endsWith(` ${shorter}`)
  ) {
    return true;
  }

  // Jaccard similarity on words with 3+ letters
  const setA = new Set(wordsA.filter((w) => w.length >= 3));
  const setB = new Set(wordsB.filter((w) => w.length >= 3));

  if (setA.size === 0 || setB.size === 0) {
    return false;
  }

  const intersection = new Set([...setA].filter((x) => setB.has(x)));
  const union = new Set([...setA, ...setB]);

  const jaccard = intersection.size / union.size;
  return jaccard >= 0.7;
}

function haveSameLink(a: ScannedCard, b: ScannedCard): boolean {
  const normalizeHref = (href: string): string => {
    // Remove trailing slash and query string
    let normalized = href.replace(/\/$/, "");
    const queryIndex = normalized.indexOf("?");
    if (queryIndex !== -1) {
      normalized = normalized.substring(0, queryIndex);
    }
    return normalized;
  };

  const hrefsA = a.outLinks.map((link) => normalizeHref(link.href));
  const hrefsB = b.outLinks.map((link) => normalizeHref(link.href));

  return hrefsA.some((hrefA) => hrefsB.includes(hrefA));
}
