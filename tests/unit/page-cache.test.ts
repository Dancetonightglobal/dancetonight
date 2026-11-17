import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  isCacheablePage,
  pageCacheKey,
  withPageCache,
  PAGE_FRESH_SECONDS,
  PAGE_STALE_SECONDS,
  type EdgeCache,
  type Handler,
} from "../../src/edge/page-cache";

describe("isCacheablePage", () => {
  it("returns true for GET /", () => {
    const req = new Request("https://example.com/");
    expect(isCacheablePage(req)).toBe(true);
  });

  it("returns true for GET /?day=2026-11-03", () => {
    const req = new Request("https://example.com/?day=2026-11-03");
    expect(isCacheablePage(req)).toBe(true);
  });

  it("returns true for /nyc", () => {
    const req = new Request("https://example.com/nyc");
    expect(isCacheablePage(req)).toBe(true);
  });

  it("returns true for /london/", () => {
    const req = new Request("https://example.com/london/");
    expect(isCacheablePage(req)).toBe(true);
  });

  it("returns true for /nyc?type=salsa", () => {
    const req = new Request("https://example.com/nyc?type=salsa");
    expect(isCacheablePage(req)).toBe(true);
  });

  it("returns true for /e/some-slug", () => {
    const req = new Request("https://example.com/e/some-slug");
    expect(isCacheablePage(req)).toBe(true);
  });

  it("returns true for /e/some-slug/calendar.ics", () => {
    const req = new Request("https://example.com/e/some-slug/calendar.ics");
    expect(isCacheablePage(req)).toBe(true);
  });

  it("returns true for / with rsc header", () => {
    const req = new Request("https://example.com/", {
      headers: { rsc: "1" },
    });
    expect(isCacheablePage(req)).toBe(true);
  });

  it("returns true for /nyc?_rsc=abc", () => {
    const req = new Request("https://example.com/nyc?_rsc=abc");
    expect(isCacheablePage(req)).toBe(true);
  });

  it("returns false for POST /", () => {
    const req = new Request("https://example.com/", { method: "POST" });
    expect(isCacheablePage(req)).toBe(false);
  });

  it("returns false for / with next-action header", () => {
    const req = new Request("https://example.com/", {
      headers: { "next-action": "1" },
    });
    expect(isCacheablePage(req)).toBe(false);
  });

  it("returns false for /bot", () => {
    const req = new Request("https://example.com/bot");
    expect(isCacheablePage(req)).toBe(false);
  });

  it("returns false for /robots.txt", () => {
    const req = new Request("https://example.com/robots.txt");
    expect(isCacheablePage(req)).toBe(false);
  });

  it("returns false for /not-a-city", () => {
    const req = new Request("https://example.com/not-a-city");
    expect(isCacheablePage(req)).toBe(false);
  });

  it("returns false for /e/a/b", () => {
    const req = new Request("https://example.com/e/a/b");
    expect(isCacheablePage(req)).toBe(false);
  });

  it("returns false for /_next/static/x.js", () => {
    const req = new Request("https://example.com/_next/static/x.js");
    expect(isCacheablePage(req)).toBe(false);
  });
});

describe("pageCacheKey", () => {
  it("plain /nyc has no __dt_rsc param", async () => {
    const req = new Request("https://example.com/nyc");
    const key = await pageCacheKey(req);
    const url = new URL(key.url);
    expect(url.searchParams.has("__dt_rsc")).toBe(false);
  });

  it("/nyc with rsc header has __dt_rsc param", async () => {
    const req = new Request("https://example.com/nyc", {
      headers: { rsc: "1" },
    });
    const key = await pageCacheKey(req);
    const url = new URL(key.url);
    expect(url.searchParams.has("__dt_rsc")).toBe(true);
    expect(url.searchParams.get("__dt_rsc")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("two RSC requests with same headers get same key", async () => {
    const req1 = new Request("https://example.com/", {
      headers: { rsc: "1", "next-router-state-tree": "abc" },
    });
    const req2 = new Request("https://example.com/", {
      headers: { rsc: "1", "next-router-state-tree": "abc" },
    });
    const key1 = await pageCacheKey(req1);
    const key2 = await pageCacheKey(req2);
    expect(key1.url).toBe(key2.url);
  });

  it("two RSC requests with different next-router-state-tree get different keys", async () => {
    const req1 = new Request("https://example.com/", {
      headers: { rsc: "1", "next-router-state-tree": "abc" },
    });
    const req2 = new Request("https://example.com/", {
      headers: { rsc: "1", "next-router-state-tree": "def" },
    });
    const key1 = await pageCacheKey(req1);
    const key2 = await pageCacheKey(req2);
    expect(key1.url).not.toBe(key2.url);
  });
});

describe("withPageCache", () => {
  let renderCalls: number;
  let render: Handler;
  let cacheMap: Map<
    string,
    { status: number; statusText: string; headers: [string, string][]; body: string }
  >;
  let cache: EdgeCache;
  let waitUntilPromises: Promise<unknown>[];
  let now: number;

  beforeEach(() => {
    renderCalls = 0;
    render = async (req: Request) => {
      renderCalls++;
      return new Response(`<html>${renderCalls}</html>`, {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    };
    cacheMap = new Map();
    cache = {
      match: async (key: Request) => {
        const url = new URL(key.url).toString();
        const entry = cacheMap.get(url);
        if (!entry) return undefined;
        const { status, statusText, headers, body } = entry;
        const response = new Response(body, { status, statusText, headers: new Headers(headers) });
        return response;
      },
      put: async (key: Request, response: Response) => {
        const url = new URL(key.url).toString();
        const body = await response.text();
        const headers: [string, string][] = [];
        response.headers.forEach((value, key) => {
          headers.push([key, value]);
        });
        cacheMap.set(url, {
          status: response.status,
          statusText: response.statusText,
          headers,
          body,
        });
      },
    };
    waitUntilPromises = [];
    now = 1000000;
  });

  it("miss then hit: first miss, second within fresh period hit", async () => {
    const req = new Request("https://example.com/");
    // First request
    const res1 = await withPageCache(
      req,
      render,
      cache,
      (p) => waitUntilPromises.push(p),
      () => now,
    );
    await Promise.all(waitUntilPromises);
    expect(renderCalls).toBe(1);
    expect(res1.headers.get("x-dt-cache")).toBe("miss");

    // Second request 30 seconds later (still fresh)
    now += 30_000;
    const res2 = await withPageCache(
      req,
      render,
      cache,
      (p) => waitUntilPromises.push(p),
      () => now,
    );
    expect(renderCalls).toBe(1);
    expect(res2.headers.get("x-dt-cache")).toBe("hit");
    expect(await res2.text()).toBe("<html>1</html>");
  });

  it("stale: serve old body, refresh in background", async () => {
    const req = new Request("https://example.com/");
    // First request
    const res1 = await withPageCache(
      req,
      render,
      cache,
      (p) => waitUntilPromises.push(p),
      () => now,
    );
    await Promise.all(waitUntilPromises);
    expect(renderCalls).toBe(1);

    // Second request 61 seconds later (stale)
    now += (PAGE_FRESH_SECONDS + 1) * 1000;
    const res2 = await withPageCache(
      req,
      render,
      cache,
      (p) => waitUntilPromises.push(p),
      () => now,
    );
    expect(renderCalls).toBe(1); // still 1 because stale
    expect(res2.headers.get("x-dt-cache")).toBe("stale");
    expect(await res2.text()).toBe("<html>1</html>");

    // Wait for background refresh
    await Promise.all(waitUntilPromises);
    expect(renderCalls).toBe(2); // refresh rendered

    // Third request should be hit with new body
    const res3 = await withPageCache(
      req,
      render,
      cache,
      (p) => waitUntilPromises.push(p),
      () => now,
    );
    expect(res3.headers.get("x-dt-cache")).toBe("hit");
    expect(await res3.text()).toBe("<html>2</html>");
  });

  it("two stale requests at once for one key: only one background render", async () => {
    const req = new Request("https://example.com/");
    // First request
    await withPageCache(
      req,
      render,
      cache,
      (p) => waitUntilPromises.push(p),
      () => now,
    );
    await Promise.all(waitUntilPromises);
    expect(renderCalls).toBe(1);

    // Two concurrent stale requests
    now += (PAGE_FRESH_SECONDS + 1) * 1000;
    const promises = [
      withPageCache(
        req,
        render,
        cache,
        (p) => waitUntilPromises.push(p),
        () => now,
      ),
      withPageCache(
        req,
        render,
        cache,
        (p) => waitUntilPromises.push(p),
        () => now,
      ),
    ];
    const results = await Promise.all(promises);
    expect(results[0]!.headers.get("x-dt-cache")).toBe("stale");
    expect(results[1]!.headers.get("x-dt-cache")).toBe("stale");
    expect(renderCalls).toBe(1); // still 1, refresh hasn't completed yet

    // Wait for refresh
    await Promise.all(waitUntilPromises);
    expect(renderCalls).toBe(2); // only one additional render
  });

  it("older than 360 s: miss, render called in foreground", async () => {
    const req = new Request("https://example.com/");
    // First request
    await withPageCache(
      req,
      render,
      cache,
      (p) => waitUntilPromises.push(p),
      () => now,
    );
    await Promise.all(waitUntilPromises);
    expect(renderCalls).toBe(1);

    // Second request after cache expiry
    now += (PAGE_FRESH_SECONDS + PAGE_STALE_SECONDS + 1) * 1000;
    const res = await withPageCache(
      req,
      render,
      cache,
      (p) => waitUntilPromises.push(p),
      () => now,
    );
    expect(renderCalls).toBe(2);
    expect(res.headers.get("x-dt-cache")).toBe("miss");
  });

  it("status 500: bypass, nothing stored", async () => {
    const errorRender: Handler = async () => new Response("error", { status: 500 });
    const req = new Request("https://example.com/");
    const res = await withPageCache(
      req,
      errorRender,
      cache,
      (p) => waitUntilPromises.push(p),
      () => now,
    );
    expect(res.headers.get("x-dt-cache")).toBe("bypass");
    expect(res.status).toBe(500);
    await Promise.all(waitUntilPromises);
    const key = new Request("https://example.com/", { method: "GET" });
    const cached = await cache.match(key);
    expect(cached).toBeUndefined();
  });

  it("HTML and RSC of same URL: rendering one does not serve the other", async () => {
    const htmlReq = new Request("https://example.com/");
    const rscReq = new Request("https://example.com/", {
      headers: { rsc: "1" },
    });

    // Render HTML
    const htmlRes = await withPageCache(
      htmlReq,
      render,
      cache,
      (p) => waitUntilPromises.push(p),
      () => now,
    );
    await Promise.all(waitUntilPromises);
    expect(renderCalls).toBe(1);
    expect(htmlRes.headers.get("x-dt-cache")).toBe("miss");

    // Render RSC (should be a miss)
    const rscRes = await withPageCache(
      rscReq,
      render,
      cache,
      (p) => waitUntilPromises.push(p),
      () => now,
    );
    await Promise.all(waitUntilPromises);
    expect(renderCalls).toBe(2);
    expect(rscRes.headers.get("x-dt-cache")).toBe("miss");
  });

  it("browser headers: render returns cache-control private, hit carries that", async () => {
    const customRender: Handler = async () =>
      new Response("<html>ok</html>", {
        status: 200,
        headers: { "cache-control": "private, no-store" },
      });
    const req = new Request("https://example.com/");
    // First request
    const res1 = await withPageCache(
      req,
      customRender,
      cache,
      (p) => waitUntilPromises.push(p),
      () => now,
    );
    await Promise.all(waitUntilPromises);
    expect(res1.headers.get("x-dt-cache")).toBe("miss");

    // Second request (hit)
    const res2 = await withPageCache(
      req,
      customRender,
      cache,
      (p) => waitUntilPromises.push(p),
      () => now,
    );
    expect(res2.headers.get("x-dt-cache")).toBe("hit");
    expect(res2.headers.get("cache-control")).toBe("private, no-store");
    expect(res2.headers.has("x-dt-stored-at")).toBe(false);
    expect(res2.headers.has("x-dt-origin-cache-control")).toBe(false);
  });

  it("cache.match throws: page still served (200)", async () => {
    const throwingCache: EdgeCache = {
      match: async () => {
        throw new Error("cache failure");
      },
      put: async () => {},
    };
    const req = new Request("https://example.com/");
    const res = await withPageCache(
      req,
      render,
      throwingCache,
      (p) => waitUntilPromises.push(p),
      () => now,
    );
    expect(renderCalls).toBe(1);
    expect(res.status).toBe(200);
    expect(res.headers.get("x-dt-cache")).toBe("miss");
  });

  it("not cacheable (/bot): render called, no x-dt-cache header", async () => {
    const req = new Request("https://example.com/bot");
    const res = await withPageCache(
      req,
      render,
      cache,
      (p) => waitUntilPromises.push(p),
      () => now,
    );
    expect(renderCalls).toBe(1);
    expect(res.headers.has("x-dt-cache")).toBe(false);
  });

  it("a new Worker version never gets the old version's page (D-579)", async () => {
    const wait = (p: Promise<unknown>) => waitUntilPromises.push(p);
    const first = await withPageCache(
      new Request("https://example.com/nyc"),
      render,
      cache,
      wait,
      () => now,
      "v1",
    );
    expect(first.headers.get("x-dt-cache")).toBe("miss");
    await Promise.all(waitUntilPromises);
    const same = await withPageCache(
      new Request("https://example.com/nyc"),
      render,
      cache,
      wait,
      () => now,
      "v1",
    );
    expect(same.headers.get("x-dt-cache")).toBe("hit");
    const next = await withPageCache(
      new Request("https://example.com/nyc"),
      render,
      cache,
      wait,
      () => now,
      "v2",
    );
    expect(next.headers.get("x-dt-cache")).toBe("miss");
    expect(await next.text()).toBe("<html>2</html>");
  });
});

describe("pageCacheKey version", () => {
  it("adds __dt_v only when a version is given", async () => {
    const plain = await pageCacheKey(new Request("https://example.com/nyc"));
    expect(new URL(plain.url).searchParams.has("__dt_v")).toBe(false);
    const versioned = await pageCacheKey(new Request("https://example.com/nyc"), "abc");
    expect(new URL(versioned.url).searchParams.get("__dt_v")).toBe("abc");
  });
});
