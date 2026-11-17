/**
 * Per-visitor rate limit on uncached page renders.
 *
 * Why: On 10-17 a crawler made ~25,000 requests an hour; each uncached render reads ~1.8 MB from the database
 * (D-153). The crawler 403 (`src/edge/crawler-guard.ts`) only catches bots that name themselves. Add a
 * per-IP limit on requests that actually render (edge-cache hits stay free): over 60 renders in 60 seconds
 * from one IP gets a cheap 429 answered in the Worker, before Next.js runs. Uses Cloudflare's Workers
 * Rate Limiting binding (GA, wrangler >= 4.36; installed 4.149).
 *
 * The limit only counts requests that reach the render path; edge-cache hits do not increment the counter.
 * The mechanism fails open: if the limiter is missing (local dev, tests) or throws, the request proceeds.
 */

/** The subset of Cloudflare's RateLimit binding we use. */
export interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

/** Maximum number of uncached renders allowed per IP per minute. */
export const RENDER_LIMIT_PER_MINUTE = 60;

/**
 * Extract the visitor's IP from the `cf-connecting-ip` header.
 * Returns null when the header is absent or empty.
 */
export function renderLimitKey(request: Request): string | null {
  const ip = request.headers.get("cf-connecting-ip");
  if (!ip) return null;
  const trimmed = ip.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Determine whether this render may go ahead according to the rate limiter.
 *
 * - No limiter (local dev, tests, binding missing) -> true.
 * - No key -> true (limiter not called).
 * - limiter.limit throws -> true (fail open: never take the site down over the limiter).
 * - Otherwise returns `(await limiter.limit({ key })).success`.
 */
export async function renderAllowed(
  request: Request,
  limiter: RateLimiter | undefined,
): Promise<boolean> {
  if (!limiter) return true;
  const key = renderLimitKey(request);
  if (!key) return true;
  try {
    const result = await limiter.limit({ key });
    return result.success;
  } catch {
    // Fail open: if the limiter throws, allow the request.
    return true;
  }
}

/**
 * Return a 429 response explaining the rate limit.
 *
 * Headers:
 * - `retry-after: 60`
 * - `cache-control: no-store`
 * - `x-dt-blocked: rate`
 *
 * Body: plain text "Too many requests. Please wait a minute and try again.\n"
 */
export function rateLimitedResponse(): Response {
  const body = "Too many requests. Please wait a minute and try again.\n";
  const headers = new Headers({
    "content-type": "text/plain; charset=utf-8",
    "retry-after": "60",
    "cache-control": "no-store",
    "x-dt-blocked": "rate",
  });
  return new Response(body, { status: 429, headers });
}
