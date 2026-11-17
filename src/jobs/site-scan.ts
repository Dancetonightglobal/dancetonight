// Daily site check: fetch every city's next 7 days and check each card's links.
//
// `npx tsx src/jobs/site-scan.ts --out /path/scan.json`: fetches the public site's day pages,
// parses cards, probes their detail pages and outside links, and writes a compact JSON file for
// the daily Claude review. Reads only the public site and the pages the cards link to; writes
// nothing but the output file. No database, no API keys.
//
//   --out <file>           required
//   --base <url>          default https://dancetonight.isaacsuncle.workers.dev
//   --from <YYYY-MM-DD>   default today in UTC
//   --days <n>            default 7 (1..31)
//   --cities a,b          default all cities from METRO_SOURCES, sorted
//
// Exit code 0 even when some pages or links fail; exit 1 only on bad flags or when every day
// page failed.

import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { METRO_SOURCES } from "@/config/sources";
import { parseDayPage, pairHints, type ScannedCard } from "@/src/jobs/site-scan-parse";
import { decodeEntities } from "@/src/adapters/shared";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function whole(name: string, fallback: number): number | null {
  const raw = arg(name);
  if (raw === undefined) return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

interface PageResult {
  city: string;
  day: string;
  status: number;
  bytes: number;
  cardCount: number;
}

interface LinkResult {
  href: string;
  status: number;
  finalUrl: string;
  error?: string;
  pageTitle?: string;
  cards: Array<{ cardId: string; titleWordShare: number }>;
}

interface Output {
  generatedAt: string;
  base: string;
  from: string;
  days: number;
  pages: PageResult[];
  cards: Array<ScannedCard & { detailStatus: number }>;
  links: LinkResult[];
  hints: ReturnType<typeof pairHints>;
}

/** Share (0..1) of the title's distinct words of 3+ letters that the page text contains as whole words, after
 * lowercasing and removing accents (NFD, strip combining marks) on both; words are runs of letters/digits.
 * A title with no such words gives 1. Page text = HTML with <script>/<style> blocks removed, tags replaced by spaces,
 * entities decoded (decodeEntities from @/src/adapters/shared). */
export function titleWordShare(title: string, html: string): number {
  // Normalize title: NFD, strip combining marks, lowercase
  const normalizedTitle = title.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  // Split into words (Unicode letters)
  const titleWords = normalizedTitle.match(/\p{L}+/gu) || [];
  const longTitleWords = [...new Set(titleWords.filter((w) => w.length >= 3))];

  if (longTitleWords.length === 0) {
    return 1;
  }

  // Process HTML: remove script/style, decode entities, replace tags with spaces
  let cleaned = html.replace(/<script[\s\S]*?<\/script>/gi, "");
  cleaned = cleaned.replace(/<style[\s\S]*?<\/style>/gi, "");
  cleaned = decodeEntities(cleaned.replace(/<[^>]*>/g, " "));
  const normalizedPage = cleaned.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

  // Split page text into words
  const pageWords = new Set(normalizedPage.match(/\p{L}+/gu) || []);

  // Count matches
  let matches = 0;
  for (const word of longTitleWords) {
    if (pageWords.has(word)) {
      matches++;
    }
  }

  return Math.round((matches / longTitleWords.length) * 100) / 100;
}

async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** D-834: a 429 waits its Retry-After (at most 60 s), else 2, 4, 8 then 16 s; four tries after the first. */
export function rateLimitWaitMs(retryAfter: string | null, retry: number): number {
  const seconds =
    retryAfter !== null && /^\d+$/.test(retryAfter.trim()) ? Number(retryAfter) : null;
  return seconds !== null ? Math.min(seconds, 60) * 1000 : 2000 * 2 ** retry;
}

/**
 * A day page: one retry after 3 s on a 5xx or a network error, and up to four on a 429, which the
 * site's per-IP render limit (D-153, 60 a minute) answers to a burst (daily check 11-10: 63 of 196).
 */
export async function fetchWithRetry(
  url: string,
  timeoutMs: number,
  deps: {
    fetch?: typeof fetch;
    sleep?: (ms: number) => Promise<void>;
  } = {},
): Promise<Response> {
  const get = deps.fetch ?? fetch;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let failures = 0;
  let limited = 0;
  for (;;) {
    try {
      const response = await get(url, {
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh) dancetonight-site-check",
          Accept: "text/html,*/*",
        },
      });
      if (response.status === 429 && limited < 4) {
        void response.body?.cancel();
        await sleep(rateLimitWaitMs(response.headers.get("retry-after"), limited));
        limited += 1;
        continue;
      }
      if (response.status >= 500 && failures === 0) {
        failures += 1;
        await sleep(3000);
        continue;
      }
      return response;
    } catch (error) {
      if (failures === 0) {
        failures += 1;
        await sleep(3000);
        continue;
      }
      throw error;
    }
  }
}

async function main(): Promise<number> {
  const outFile = arg("out");
  if (!outFile) {
    console.error(
      "usage: npx tsx src/jobs/site-scan.ts --out <file> [--base <url>] [--from <date>] [--days <n>] [--cities a,b]",
    );
    return 1;
  }

  const base = arg("base") || "https://dancetonight.isaacsuncle.workers.dev";
  const fromStr = arg("from") || new Date().toISOString().slice(0, 10);
  const daysRaw = whole("days", 7);
  if (daysRaw === null || daysRaw < 1 || daysRaw > 31) {
    console.error("--days must be between 1 and 31");
    return 1;
  }
  const days = daysRaw;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromStr)) {
    console.error(`invalid --from ${fromStr}, must be YYYY-MM-DD`);
    return 1;
  }
  const citiesArg = arg("cities");
  const cities = citiesArg ? citiesArg.split(",") : Object.keys(METRO_SOURCES).sort();

  // Generate days in UTC
  const fromDate = new Date(fromStr + "T00:00:00Z");
  if (isNaN(fromDate.getTime())) {
    console.error(`invalid --from ${fromStr}`);
    return 1;
  }
  const daysList: string[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(fromDate);
    d.setUTCDate(d.getUTCDate() + i);
    daysList.push(d.toISOString().slice(0, 10));
  }

  const allPages: PageResult[] = [];
  const allCards: Array<ScannedCard & { detailStatus: number }> = [];
  const hrefToLink = new Map<string, LinkResult>();
  const hrefToCards = new Map<string, Array<{ cardId: string; title: string }>>();

  // Step 1: Fetch day pages
  const dayPairs: { city: string; day: string }[] = [];
  for (const city of cities) {
    for (const day of daysList) {
      dayPairs.push({ city, day });
    }
  }

  await mapLimit(dayPairs, 6, async ({ city, day }) => {
    const url = `${base}/${city}?day=${day}`;
    let status = 0;
    let bytes = 0;
    let html = "";
    try {
      const response = await fetchWithRetry(url, 40000);
      status = response.status;
      const text = await response.text();
      html = text;
      bytes = text.length;
    } catch {
      status = 0;
      bytes = 0;
    }

    const cards = parseDayPage(html, city, day);
    allPages.push({ city, day, status, bytes, cardCount: cards.length });

    for (const card of cards) {
      const cardWithStatus = { ...card, detailStatus: -1 };
      allCards.push(cardWithStatus);
      for (const link of card.outLinks) {
        const href = link.href;
        if (!hrefToCards.has(href)) {
          hrefToCards.set(href, []);
        }
        hrefToCards.get(href)!.push({ cardId: card.id, title: card.title });
      }
    }

    return { city, day, status, cards };
  });

  // Check if any day pages succeeded
  if (allPages.every((p) => p.status !== 200)) {
    console.error("All day pages failed");
    return 1;
  }

  // Step 2: Fetch detail pages (HEAD-light: status only). The site rate-limits bursts (429), so 2 at once
  // and up to 3 retries on 429 after 2, 4 and 8 s.
  await mapLimit(allCards, 2, async (card) => {
    const url = `${base}${card.detailPath}`;
    let status = 0;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
        status = response.status;
        void response.body?.cancel();
      } catch {
        status = 0;
      }
      if (status !== 429) break;
      await new Promise((resolve) => setTimeout(resolve, 2000 * 2 ** attempt));
    }
    card.detailStatus = status;
  });

  // Step 3: Outside links
  const hrefArray = Array.from(hrefToCards.keys());
  const hostCount = new Map<string, number>();

  const processLink = async (href: string): Promise<void> => {
    let host = "";
    try {
      const url = new URL(href);
      host = url.hostname;
    } catch {
      return;
    }

    // Per-host limit
    while ((hostCount.get(host) ?? 0) >= 2) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    hostCount.set(host, (hostCount.get(host) ?? 0) + 1);

    try {
      const response = await fetch(href, {
        signal: AbortSignal.timeout(20000),
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh) dancetonight-site-check",
          Accept: "text/html,*/*",
        },
      });
      const status = response.status;
      const finalUrl = response.url;
      const contentType = response.headers.get("content-type") || "";
      const isHtml = contentType.includes("html");

      let pageTitle: string | undefined;
      let body = "";
      if (isHtml) {
        const decoder = new TextDecoder();
        const reader = response.body?.getReader();
        if (reader) {
          let totalBytes = 0;
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              totalBytes += value.length;
              if (totalBytes > 2 * 1024 * 1024) {
                void reader.cancel();
                break;
              }
              body += decoder.decode(value, { stream: true });
            }
            body += decoder.decode(); // flush
          } catch {
            // ignore
          }
        }

        const titleMatch = body.match(/<title>([\s\S]*?)<\/title>/i);
        if (titleMatch) {
          pageTitle = decodeEntities(titleMatch[1] ?? "")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 150);
        }
      } else {
        void response.body?.cancel();
      }

      const linkResult: LinkResult = {
        href,
        status,
        finalUrl,
        pageTitle,
        cards: [],
      };

      const cards = hrefToCards.get(href) || [];
      for (const { cardId, title } of cards) {
        const share = isHtml ? titleWordShare(title, body) : 1;
        linkResult.cards.push({ cardId, titleWordShare: share });
      }

      hrefToLink.set(href, linkResult);
    } catch (error) {
      const linkResult: LinkResult = {
        href,
        status: 0,
        finalUrl: href,
        error: (error instanceof Error ? error.message : String(error)).slice(0, 120),
        cards: (hrefToCards.get(href) || []).map(({ cardId }) => ({ cardId, titleWordShare: 0 })),
      };
      hrefToLink.set(href, linkResult);
    } finally {
      hostCount.set(host, (hostCount.get(host) ?? 0) - 1);
    }
  };

  await mapLimit(hrefArray, 8, processLink);

  // Step 4: Generate hints
  const hints = pairHints(allCards);

  // Step 5: Write output
  const output: Output = {
    generatedAt: new Date().toISOString(),
    base,
    from: fromStr,
    days,
    pages: allPages,
    cards: allCards,
    links: Array.from(hrefToLink.values()),
    hints,
  };

  await mkdir(dirname(outFile), { recursive: true });
  await writeFile(outFile, JSON.stringify(output));

  const failedPages = allPages.filter((p) => p.status !== 200).length;
  const badLinks = Array.from(hrefToLink.values()).filter(
    (l) => l.status < 200 || l.status >= 300,
  ).length;
  console.log(
    `site-scan: ${cities.length} cities, ${allPages.length} pages (${failedPages} failed), ${allCards.length} cards, ${hrefToLink.size} links (${badLinks} not 2xx), ${hints.length} pair hints -> ${outFile}`,
  );

  return 0;
}

if (process.argv[1]?.endsWith("site-scan.ts")) {
  main()
    .then((code) => process.exit(code))
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    });
}
