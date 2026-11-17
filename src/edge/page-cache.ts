import { cityRewrite } from "@/src/ui/home/city-path";

export const PAGE_FRESH_SECONDS = 60;
export const PAGE_STALE_SECONDS = 300;
export type Handler = (request: Request) => Promise<Response>;
export interface EdgeCache {
  match(key: Request): Promise<Response | undefined>;
  put(key: Request, response: Response): Promise<void>;
}

/**
 * Determine if a request is a cacheable page.
 */
export function isCacheablePage(request: Request): boolean {
  if (request.method !== "GET") {
    return false;
  }
  if (request.headers.has("next-action")) {
    return false;
  }
  const url = new URL(request.url);
  const pathname = url.pathname;

  // Exactly "/"
  if (pathname === "/") {
    return true;
  }

  // City path
  const search = new URLSearchParams(url.search);
  if (cityRewrite(pathname, search) !== null) {
    return true;
  }

  // Event page: /e/<slug> or /e/<slug>/calendar.ics
  const eventPattern = /^\/e\/[^/]+(\/calendar\.ics)?\/?$/;
  if (eventPattern.test(pathname)) {
    return true;
  }

  return false;
}

/**
 * The cache key for the request. `version` is the deployed Worker version (D-579): cached HTML names its build's script files, so a
 * new deployment must never be served a page rendered by the old one.
 */
export async function pageCacheKey(request: Request, version = ""): Promise<Request> {
  const url = new URL(request.url);
  if (version !== "") url.searchParams.set("__dt_v", version);
  const isRsc = request.headers.has("rsc") || url.searchParams.has("_rsc");

  if (!isRsc) {
    // Non-RSC: key is the URL as-is
    return new Request(url.toString(), { method: "GET" });
  }

  // RSC: compute hash of headers
  const headerNames = [
    "rsc",
    "next-router-state-tree",
    "next-router-prefetch",
    "next-router-segment-prefetch",
    "next-url",
  ];
  const headerValues = headerNames.map((name) => request.headers.get(name) ?? "");
  const text = headerValues.join("\n");

  // Compute SHA-256 hash
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");

  // Add __dt_rsc param
  const keyUrl = new URL(url.toString());
  keyUrl.searchParams.set("__dt_rsc", hashHex);
  return new Request(keyUrl.toString(), { method: "GET" });
}

// Module-level set to track ongoing refreshes
const refreshing = new Set<string>();

/**
 * Cache with stale-while-revalidate.
 */
export async function withPageCache(
  request: Request,
  render: Handler,
  cache: EdgeCache,
  waitUntil: (p: Promise<unknown>) => void,
  now: () => number = Date.now,
  version = "",
): Promise<Response> {
  // Not cacheable -> render without cache headers
  if (!isCacheablePage(request)) {
    return render(request);
  }

  const key = await pageCacheKey(request, version);

  // Try to retrieve from cache
  let cached: Response | undefined;
  try {
    cached = await cache.match(key);
  } catch {
    // Treat cache failure as a miss
  }

  if (cached) {
    const storedAtHeader = cached.headers.get("x-dt-stored-at");
    if (storedAtHeader) {
      const storedAt = Number(storedAtHeader);
      if (!isNaN(storedAt)) {
        const age = now() - storedAt;
        const freshMs = PAGE_FRESH_SECONDS * 1000;
        const staleMs = PAGE_STALE_SECONDS * 1000;

        if (age < freshMs) {
          // Fresh: serve from cache
          const headers = new Headers(cached.headers);
          headers.delete("x-dt-stored-at");
          const originCacheControl = headers.get("x-dt-origin-cache-control");
          headers.delete("x-dt-origin-cache-control");
          if (originCacheControl !== null) {
            headers.set("cache-control", originCacheControl);
          } else {
            headers.delete("cache-control");
          }
          headers.set("x-dt-cache", "hit");
          return new Response(cached.body, {
            status: cached.status,
            statusText: cached.statusText,
            headers,
          });
        } else if (age < freshMs + staleMs) {
          // Stale: serve from cache and refresh in background
          const headers = new Headers(cached.headers);
          headers.delete("x-dt-stored-at");
          const originCacheControl = headers.get("x-dt-origin-cache-control");
          headers.delete("x-dt-origin-cache-control");
          if (originCacheControl !== null) {
            headers.set("cache-control", originCacheControl);
          } else {
            headers.delete("cache-control");
          }
          headers.set("x-dt-cache", "stale");

          // Start refresh if not already refreshing
          const keyUrl = key.url;
          if (!refreshing.has(keyUrl)) {
            refreshing.add(keyUrl);
            const refresh = async () => {
              try {
                // Create a new request for rendering
                const refreshRequest = new Request(request.url, {
                  method: "GET",
                  headers: request.headers,
                });
                const res = await render(refreshRequest);
                if (res.status === 200 && !res.headers.has("set-cookie") && res.body !== null) {
                  const storedHeaders = new Headers(res.headers);
                  storedHeaders.set("x-dt-stored-at", String(now()));
                  const originCC = res.headers.get("cache-control");
                  if (originCC) {
                    storedHeaders.set("x-dt-origin-cache-control", originCC);
                  }
                  storedHeaders.set(
                    "cache-control",
                    `public, max-age=${PAGE_FRESH_SECONDS + PAGE_STALE_SECONDS}`,
                  );
                  const storedResponse = new Response(res.body, {
                    status: res.status,
                    statusText: res.statusText,
                    headers: storedHeaders,
                  });
                  await cache.put(key, storedResponse);
                }
              } catch {
                // Ignore errors
              } finally {
                refreshing.delete(keyUrl);
              }
            };
            // Schedule refresh to run after current event loop to avoid synchronous render call
            const refreshPromise = new Promise<void>((resolve) => {
              setTimeout(() => {
                refresh().then(resolve);
              }, 0);
            });
            waitUntil(refreshPromise);
          }

          return new Response(cached.body, {
            status: cached.status,
            statusText: cached.statusText,
            headers,
          });
        }
      }
    }
    // If stored-at header is missing or invalid, treat as miss
  }

  // Cache miss: render and store
  const res = await render(request);
  const shouldStore = res.status === 200 && !res.headers.has("set-cookie") && res.body !== null;
  if (!shouldStore) {
    const headers = new Headers(res.headers);
    headers.set("x-dt-cache", "bypass");
    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers,
    });
  }

  // Tee the body
  const [storeBranch, liveBranch] = res.body.tee();

  // Prepare stored response
  const storedHeaders = new Headers(res.headers);
  storedHeaders.set("x-dt-stored-at", String(now()));
  const originCC = res.headers.get("cache-control");
  if (originCC) {
    storedHeaders.set("x-dt-origin-cache-control", originCC);
  }
  storedHeaders.set("cache-control", `public, max-age=${PAGE_FRESH_SECONDS + PAGE_STALE_SECONDS}`);
  const storedResponse = new Response(storeBranch, {
    status: res.status,
    statusText: res.statusText,
    headers: storedHeaders,
  });

  // Store in background
  const putPromise = cache.put(key, storedResponse).catch(() => {});
  waitUntil(putPromise);

  // Return live response
  const liveHeaders = new Headers(res.headers);
  liveHeaders.set("x-dt-cache", "miss");
  return new Response(liveBranch, {
    status: res.status,
    statusText: res.statusText,
    headers: liveHeaders,
  });
}
