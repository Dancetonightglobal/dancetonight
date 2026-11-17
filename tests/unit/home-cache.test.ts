import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  isCacheableHome,
  withHomeCache,
  type EdgeCache,
  type Handler,
} from "../../src/edge/home-cache";

describe("isCacheableHome", () => {
  it("returns true for GET /", () => {
    const req = new Request("https://example.com/");
    expect(isCacheableHome(req)).toBe(true);
  });

  it("returns true for GET /?day=2026-10-20", () => {
    const req = new Request("https://example.com/?day=2026-10-20");
    expect(isCacheableHome(req)).toBe(true);
  });

  it("returns false for POST /", () => {
    const req = new Request("https://example.com/", { method: "POST" });
    expect(isCacheableHome(req)).toBe(false);
  });

  it("returns false for GET /e/x", () => {
    const req = new Request("https://example.com/e/x");
    expect(isCacheableHome(req)).toBe(false);
  });

  it("returns false for GET /bot", () => {
    const req = new Request("https://example.com/bot");
    expect(isCacheableHome(req)).toBe(false);
  });

  it("returns false for GET / with rsc header", () => {
    const req = new Request("https://example.com/", {
      headers: { rsc: "1" },
    });
    expect(isCacheableHome(req)).toBe(false);
  });

  it("returns false for GET / with next-router-prefetch header", () => {
    const req = new Request("https://example.com/", {
      headers: { "next-router-prefetch": "1" },
    });
    expect(isCacheableHome(req)).toBe(false);
  });

  it("returns false for GET /?_rsc=abc", () => {
    const req = new Request("https://example.com/?_rsc=abc");
    expect(isCacheableHome(req)).toBe(false);
  });
});

describe("withHomeCache", () => {
  let renderCalls: number;
  let render: Handler;
  let cacheMap: Map<string, Response>;
  let cache: EdgeCache;
  let waitUntilPromises: Promise<unknown>[];

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
        return cacheMap.get(url) ?? undefined;
      },
      put: async (key: Request, response: Response) => {
        const url = new URL(key.url).toString();
        cacheMap.set(url, response);
      },
    };
    waitUntilPromises = [];
  });

  it("first request: miss, render called once, no cache-control on returned response", async () => {
    const req = new Request("https://example.com/");
    const res = await withHomeCache(req, render, cache, (p) => waitUntilPromises.push(p));

    expect(renderCalls).toBe(1);
    expect(res.headers.get("x-dt-cache")).toBe("miss");
    expect(res.headers.get("cache-control")).toBeNull();
    expect(await res.text()).toBe("<html>1</html>");

    // Wait for background store
    await Promise.all(waitUntilPromises);
    const cached = await cache.match(new Request("https://example.com/", { method: "GET" }));
    expect(cached).toBeDefined();
    expect(cached!.headers.get("cache-control")).toBe("public, max-age=60");
    expect(await cached!.text()).toBe("<html>1</html>");
  });

  it("second request same URL: hit, render not called", async () => {
    const url = "https://example.com/";
    // First request
    const req1 = new Request(url);
    const res1 = await withHomeCache(req1, render, cache, (p) => waitUntilPromises.push(p));
    await Promise.all(waitUntilPromises);
    expect(renderCalls).toBe(1);

    // Second request
    const req2 = new Request(url);
    const res2 = await withHomeCache(req2, render, cache, (p) => waitUntilPromises.push(p));
    expect(renderCalls).toBe(1); // still 1
    expect(res2.headers.get("x-dt-cache")).toBe("hit");
    expect(await res2.text()).toBe("<html>1</html>");
  });

  it("different query string: render called again", async () => {
    const req1 = new Request("https://example.com/?a=1");
    await withHomeCache(req1, render, cache, (p) => waitUntilPromises.push(p));
    expect(renderCalls).toBe(1);

    const req2 = new Request("https://example.com/?b=2");
    await withHomeCache(req2, render, cache, (p) => waitUntilPromises.push(p));
    expect(renderCalls).toBe(2);
  });

  it("render returns 500: bypass, not stored", async () => {
    const errorRender: Handler = async () => new Response("error", { status: 500 });
    const req = new Request("https://example.com/");
    const res = await withHomeCache(req, errorRender, cache, (p) => waitUntilPromises.push(p));

    expect(res.headers.get("x-dt-cache")).toBe("bypass");
    expect(res.status).toBe(500);
    await Promise.all(waitUntilPromises);
    const cached = await cache.match(new Request("https://example.com/", { method: "GET" }));
    expect(cached).toBeUndefined();
  });

  it("render returns 200 with set-cookie: bypass, not stored", async () => {
    const cookieRender: Handler = async () =>
      new Response("<html>cookie</html>", {
        status: 200,
        headers: { "set-cookie": "session=abc" },
      });
    const req = new Request("https://example.com/");
    const res = await withHomeCache(req, cookieRender, cache, (p) => waitUntilPromises.push(p));

    expect(res.headers.get("x-dt-cache")).toBe("bypass");
    expect(res.headers.get("set-cookie")).toBe("session=abc");
    await Promise.all(waitUntilPromises);
    const cached = await cache.match(new Request("https://example.com/", { method: "GET" }));
    expect(cached).toBeUndefined();
  });

  it("RSC request (rsc header): render called, no caching, no x-dt-cache header", async () => {
    const req = new Request("https://example.com/", {
      headers: { rsc: "1" },
    });
    const res = await withHomeCache(req, render, cache, (p) => waitUntilPromises.push(p));

    expect(renderCalls).toBe(1);
    expect(res.headers.has("x-dt-cache")).toBe(false);
    await Promise.all(waitUntilPromises);
    const cached = await cache.match(new Request("https://example.com/", { method: "GET" }));
    expect(cached).toBeUndefined();
  });

  it("cache.match throws: page still served (render called, status 200)", async () => {
    const throwingCache: EdgeCache = {
      match: async () => {
        throw new Error("cache failure");
      },
      put: async () => {},
    };
    const req = new Request("https://example.com/");
    const res = await withHomeCache(req, render, throwingCache, (p) => waitUntilPromises.push(p));

    expect(renderCalls).toBe(1);
    expect(res.status).toBe(200);
    // Should be a miss because cache threw
    expect(res.headers.get("x-dt-cache")).toBe("miss");
  });
});
