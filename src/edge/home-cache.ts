/**
 * Cache the home page HTML at Cloudflare's edge for 60 seconds.
 *
 * Why: The home page takes ~2 s to first byte (0.7 s DB + 0.4 s CPU). Caching reduces this to
 * 0.2-0.9 s. Measured 2026-10-17.
 *
 * What is cached: Only GET `/` (any query string), full HTML responses with status 200 and no
 * Set-Cookie header. Cache lifetime is 60 seconds (HOME_CACHE_SECONDS).
 *
 * What is never cached: RSC requests (headers `rsc`, `next-router-state-tree`,
 * `next-router-prefetch`, `next-action` or `_rsc` search param), non-200 responses, responses
 * that set cookies.
 *
 * Consequence: A new listing can appear up to 60 s late, which the minute-refresh already
 * tolerates.
 */

export const HOME_CACHE_SECONDS = 60;

export type Handler = (request: Request) => Promise<Response>;

export interface EdgeCache {
  match(key: Request): Promise<Response | undefined>;
  put(key: Request, response: Response): Promise<void>;
}

/**
 * Determine if a request is a plain GET to `/` without RSC headers or `_rsc` param.
 */
export function isCacheableHome(request: Request): boolean {
  if (request.method !== "GET") {
    return false;
  }
  const url = new URL(request.url);
  if (url.pathname !== "/") {
    return false;
  }
  // Disallow RSC headers
  const rscHeaders = ["rsc", "next-router-state-tree", "next-router-prefetch", "next-action"];
  for (const h of rscHeaders) {
    if (request.headers.has(h)) {
      return false;
    }
  }
  // Disallow _rsc search param
  if (url.searchParams.has("_rsc")) {
    return false;
  }
  return true;
}

/**
 * Serve the home page from edge cache when possible, otherwise render and store.
 *
 * @param request Incoming request
 * @param render Function that produces the actual page
 * @param cache Edge cache implementation (e.g., caches.default)
 * @param waitUntil Function to attach background tasks
 * @returns Response for the visitor
 */
export async function withHomeCache(
  request: Request,
  render: Handler,
  cache: EdgeCache,
  waitUntil: (p: Promise<unknown>) => void,
): Promise<Response> {
  if (!isCacheableHome(request)) {
    // Not cacheable: just render
    return render(request);
  }

  // Build cache key: a GET request to the same URL (including query string)
  const url = new URL(request.url);
  const key = new Request(url.toString(), { method: "GET" });

  // Try to retrieve from cache, swallowing any errors
  let cached: Response | undefined;
  try {
    cached = await cache.match(key);
  } catch {
    // Treat cache failure as a miss
  }

  if (cached) {
    // Cache hit: return cached response with an added header
    const headers = new Headers(cached.headers);
    headers.set("x-dt-cache", "hit");
    return new Response(cached.body, {
      status: cached.status,
      statusText: cached.statusText,
      headers,
    });
  }

  // Cache miss: render the page
  const res = await render(request);

  // Determine if we should store this response
  const shouldStore = res.status === 200 && !res.headers.has("set-cookie") && res.body !== null;

  if (!shouldStore) {
    // Not suitable for caching: add bypass header and return
    const headers = new Headers(res.headers);
    headers.set("x-dt-cache", "bypass");
    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers,
    });
  }

  // Tee the body: one branch for storage, one for immediate response
  const [storeBranch, liveBranch] = res.body.tee();

  // Prepare the stored response with cache-control
  const storedHeaders = new Headers(res.headers);
  storedHeaders.set("Cache-Control", `public, max-age=${HOME_CACHE_SECONDS}`);
  const storedResponse = new Response(storeBranch, {
    status: res.status,
    statusText: res.statusText,
    headers: storedHeaders,
  });

  // Store in cache in the background, ignoring errors
  const putPromise = cache.put(key, storedResponse).catch(() => {});
  waitUntil(putPromise);

  // Return the live response with miss header (no cache-control for browser)
  const liveHeaders = new Headers(res.headers);
  liveHeaders.set("x-dt-cache", "miss");
  return new Response(liveBranch, {
    status: res.status,
    statusText: res.statusText,
    headers: liveHeaders,
  });
}
