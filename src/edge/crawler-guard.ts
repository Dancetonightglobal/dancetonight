/**
 * Block crawlers that request URLs with query strings, which robots.txt already disallows (`/*?`).
 *
 * Why: robots.txt disallows `/*?` since #182, but crawlers re-read robots.txt only every day or so.
 * ClaudeBot is still requesting ~1 home page with filters per second (178 in 3 minutes,
 * 2026-10-18 03:40 UTC). Each costs ~0.4 s of CPU in the same isolate as real visitors, so even
 * `/bot` slowed to 2 s. Answer those requests in the Worker before Next.js runs.
 *
 * Browsers never carry these user-agent tokens, so only crawlers are affected.
 * `/`, `/e/<slug>`, `/bot` and `/robots.txt` without a query stay open to crawlers.
 */

/** User-agent tokens of crawlers that honour robots.txt (case-insensitive substring match). */
export const CRAWLER_TOKENS: readonly string[] = [
  "claudebot",
  "claude-searchbot",
  "gptbot",
  "oai-searchbot",
  "perplexitybot",
  "googlebot",
  "google-extended",
  "bingbot",
  "applebot",
  "yandexbot",
  "baiduspider",
  "duckduckbot",
  "bytespider",
  "amazonbot",
  "meta-externalagent",
  "ccbot",
  "ahrefsbot",
  "semrushbot",
  "mj12bot",
  "dotbot",
  "petalbot",
];

/**
 * Return true when the lowercased user-agent contains any of the CRAWLER_TOKENS.
 * Returns false for null or empty string.
 */
export function isCrawler(userAgent: string | null): boolean {
  if (!userAgent) return false;
  const lowerUA = userAgent.toLowerCase();
  return CRAWLER_TOKENS.some((token) => lowerUA.includes(token));
}

/**
 * Return true when the request has a query string and its user-agent matches a known crawler.
 * Paths do not matter; only the presence of a query string (even `?`) is considered.
 */
export function blockedForCrawler(request: Request): boolean {
  const url = new URL(request.url);
  if (url.search === "") return false;
  const ua = request.headers.get("user-agent");
  return isCrawler(ua);
}

/**
 * Return a 403 response explaining the request is disallowed by robots.txt.
 * Includes headers for caching and an identifying `x-dt-blocked` header.
 */
export function crawlerBlockedResponse(): Response {
  const body = "Disallowed by robots.txt: /*?\n";
  const headers = new Headers({
    "content-type": "text/plain; charset=utf-8",
    "x-dt-blocked": "robots",
    "cache-control": "public, max-age=3600",
  });
  return new Response(body, { status: 403, headers });
}
