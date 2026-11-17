import { describe, expect, it, beforeEach } from "vitest";
import type { HttpClient, Transport } from "@/src/pipeline/http";
import {
  googleRedirectCount,
  organicLeads,
  resolveSerperBody,
  SERPER_RESOLVE_ENDPOINT,
  SERPER_RESOLVE_MAX_ROUNDS,
  SERPER_RESOLVE_MAX_WAIT_MS,
  runSerpGap,
} from "@/src/pipeline/discovery/serp-gap";
import { createPoliteHttp } from "@/src/pipeline/http";
import type { Metro } from "@/src/adapters/types";

describe("resolveSerperBody", () => {
  const apiKey = "test-key";
  const sleepLog: number[] = [];
  const sleep = (ms: number) => {
    sleepLog.push(ms);
    return Promise.resolve();
  };

  beforeEach(() => {
    sleepLog.length = 0;
  });

  it("no goto links -> requests === 0, no request made, body unchanged", async () => {
    const body = JSON.stringify({
      organic: [{ title: "A", link: "https://a.example/", position: 1 }],
    });
    const http = { request: async () => ({}) } as unknown as HttpClient;
    const result = await resolveSerperBody({ http, apiKey, body, sleep });
    expect(result.requests).toBe(0);
    expect(result.body).toBe(body);
    expect(sleepLog).toEqual([]);
  });

  it("one round: search body with 1 real + 2 goto links; /resolve returns them resolved", async () => {
    const searchBody = JSON.stringify({
      organic: [
        { title: "A", link: "https://a.example/", position: 1 },
        { title: "B", link: "https://www.google.com/goto?url=CAESABC123", position: 2 },
        { title: "C", link: "https://www.google.com/goto?url=CAESDEF456", position: 3 },
      ],
    });
    const resolvedBody = JSON.stringify({
      organic: [
        { title: "A", link: "https://a.example/", position: 1 },
        { title: "B", link: "https://b.example/", position: 2 },
        { title: "C", link: "https://c.example/", position: 3 },
      ],
    });
    const requestLog: Array<{
      url: string;
      method: string;
      headers: Record<string, string>;
      body: string;
    }> = [];
    const http: HttpClient = {
      request: async (req) => {
        requestLog.push({
          url: req.url,
          method: req.method ?? "GET",
          headers: req.headers ?? {},
          body: req.body ?? "",
        });
        return {
          url: req.url,
          status: 200,
          headers: {},
          body: resolvedBody,
          notModified: false,
          etag: null,
          lastModified: null,
          fetchedAt: new Date(),
        };
      },
      robots: async () => ({
        isAllowed: () => true,
        unreadable: null,
        crawlDelayS: null,
        ruleFor: () => null,
        aiInputAllowed: true,
      }),
    };
    const result = await resolveSerperBody({ http, apiKey, body: searchBody, sleep });
    expect(result.requests).toBe(1);
    expect(requestLog).toHaveLength(1);
    expect(requestLog[0]!.url).toBe(SERPER_RESOLVE_ENDPOINT);
    expect(requestLog[0]!.method).toBe("POST");
    expect(requestLog[0]!.headers["x-api-key"]).toBe(apiKey);
    expect(requestLog[0]!.headers["content-type"]).toBe("application/json");
    expect(requestLog[0]!.body).toBe(searchBody);
    expect(googleRedirectCount(result.body)).toBe(0);
    const leads = organicLeads(result.body, { family: "salsa", q: "x", page: 1 });
    expect(leads.map((l) => l.host)).toEqual(["a.example", "b.example", "c.example"]);
    expect(sleepLog).toEqual([]);
  });

  it("partial then done: first returns 1 goto + retryAfter, second returns all resolved", async () => {
    const searchBody = JSON.stringify({
      organic: [
        { title: "A", link: "https://www.google.com/goto?url=CAESABC123", position: 1 },
        { title: "B", link: "https://www.google.com/goto?url=CAESDEF456", position: 2 },
      ],
    });
    const firstResolved = JSON.stringify({
      organic: [
        { title: "A", link: "https://a.example/", position: 1 },
        { title: "B", link: "https://www.google.com/goto?url=CAESDEF456", position: 2 },
      ],
      retryAfter: 5,
    });
    const secondResolved = JSON.stringify({
      organic: [
        { title: "A", link: "https://a.example/", position: 1 },
        { title: "B", link: "https://b.example/", position: 2 },
      ],
    });
    let call = 0;
    const http: HttpClient = {
      request: async (req) => {
        call++;
        const body = call === 1 ? firstResolved : secondResolved;
        return {
          url: req.url,
          status: 200,
          headers: {},
          body,
          notModified: false,
          etag: null,
          lastModified: null,
          fetchedAt: new Date(),
        };
      },
      robots: async () => ({
        isAllowed: () => true,
        unreadable: null,
        crawlDelayS: null,
        ruleFor: () => null,
        aiInputAllowed: true,
      }),
    };
    const result = await resolveSerperBody({ http, apiKey, body: searchBody, sleep });
    expect(result.requests).toBe(2);
    expect(googleRedirectCount(result.body)).toBe(0);
    expect(sleepLog).toEqual([5000]);
  });

  it("capped: always returns 1 goto + retryAfter -> exactly 3 requests, sleeps twice", async () => {
    const searchBody = JSON.stringify({
      organic: [{ title: "X", link: "https://www.google.com/goto?url=CAESABC123", position: 1 }],
    });
    const partialBody = JSON.stringify({
      organic: [{ title: "X", link: "https://www.google.com/goto?url=CAESABC123", position: 1 }],
      retryAfter: 2,
    });
    let calls = 0;
    const http: HttpClient = {
      request: async (req) => {
        calls++;
        return {
          url: req.url,
          status: 200,
          headers: {},
          body: partialBody,
          notModified: false,
          etag: null,
          lastModified: null,
          fetchedAt: new Date(),
        };
      },
      robots: async () => ({
        isAllowed: () => true,
        unreadable: null,
        crawlDelayS: null,
        ruleFor: () => null,
        aiInputAllowed: true,
      }),
    };
    const result = await resolveSerperBody({ http, apiKey, body: searchBody, sleep });
    expect(calls).toBe(SERPER_RESOLVE_MAX_ROUNDS);
    expect(result.requests).toBe(SERPER_RESOLVE_MAX_ROUNDS);
    expect(googleRedirectCount(result.body)).toBe(1);
    expect(sleepLog).toEqual([2000, 2000]);
  });

  it("long wait capped: retryAfter 120 -> 3 calls, 2 sleeps of 30000 each", async () => {
    const searchBody = JSON.stringify({
      organic: [{ title: "X", link: "https://www.google.com/goto?url=CAESABC123", position: 1 }],
    });
    const partialBody = JSON.stringify({
      organic: [{ title: "X", link: "https://www.google.com/goto?url=CAESABC123", position: 1 }],
      retryAfter: 120,
    });
    let calls = 0;
    const http: HttpClient = {
      request: async (req) => {
        calls++;
        return {
          url: req.url,
          status: 200,
          headers: {},
          body: partialBody,
          notModified: false,
          etag: null,
          lastModified: null,
          fetchedAt: new Date(),
        };
      },
      robots: async () => ({
        isAllowed: () => true,
        unreadable: null,
        crawlDelayS: null,
        ruleFor: () => null,
        aiInputAllowed: true,
      }),
    };
    const result = await resolveSerperBody({ http, apiKey, body: searchBody, sleep });
    expect(calls).toBe(SERPER_RESOLVE_MAX_ROUNDS);
    expect(result.requests).toBe(SERPER_RESOLVE_MAX_ROUNDS);
    expect(sleepLog).toEqual([SERPER_RESOLVE_MAX_WAIT_MS, SERPER_RESOLVE_MAX_WAIT_MS]);
  });

  it("/resolve throws -> returns original search body, requests 1", async () => {
    const searchBody = JSON.stringify({
      organic: [{ title: "X", link: "https://www.google.com/goto?url=CAESABC123", position: 1 }],
    });
    const http: HttpClient = {
      request: async () => {
        throw new Error("http_status 500");
      },
      robots: async () => ({
        isAllowed: () => true,
        unreadable: null,
        crawlDelayS: null,
        ruleFor: () => null,
        aiInputAllowed: true,
      }),
    };
    const result = await resolveSerperBody({ http, apiKey, body: searchBody, sleep });
    expect(result.requests).toBe(1);
    expect(result.body).toBe(searchBody);
    expect(sleepLog).toEqual([]);
  });

  it("/resolve returns non-JSON -> returns original search body", async () => {
    const searchBody = JSON.stringify({
      organic: [{ title: "X", link: "https://www.google.com/goto?url=CAESABC123", position: 1 }],
    });
    const http: HttpClient = {
      request: async () => ({
        url: SERPER_RESOLVE_ENDPOINT,
        status: 200,
        headers: {},
        body: "not json",
        notModified: false,
        etag: null,
        lastModified: null,
        fetchedAt: new Date(),
      }),
      robots: async () => ({
        isAllowed: () => true,
        unreadable: null,
        crawlDelayS: null,
        ruleFor: () => null,
        aiInputAllowed: true,
      }),
    };
    const result = await resolveSerperBody({ http, apiKey, body: searchBody, sleep });
    expect(result.requests).toBe(1);
    expect(result.body).toBe(searchBody);
    expect(sleepLog).toEqual([]);
  });
});

describe("runSerpGap with /resolve", () => {
  it("end to end with maxQueries: 1, fake http, includes resolved count in log", async () => {
    const NOW = new Date("2026-10-05T14:00:00Z");
    const METRO = {
      id: "m",
      slug: "nyc",
      name: "New York",
      countryCode: "US",
      center: { lat: 40.7128, lng: -74.006 },
      radiusKm: 40,
      tz: "America/New_York",
      languages: ["en"],
    } as unknown as Metro;
    const HELD = {
      sources: new Set(["swingplanit.example"]),
      venueSites: new Set(["nebulanewyork.com"]),
    };

    const seen: Array<{ url: string; key?: string }> = [];
    const page = (url: string, body: string) => ({
      url,
      status: 200,
      headers: { "content-type": "text/html" },
      body,
    });
    const transport: Transport = async (req) => {
      seen.push({ url: req.url, key: req.headers["x-api-key"] });
      if (req.url === "https://google.serper.dev/search") {
        return {
          url: req.url,
          status: 200,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            organic: [
              { title: "Nebula", link: "https://www.nebulanewyork.com/events", position: 1 },
              { title: "Club X", link: "https://www.google.com/goto?url=CAESABC123", position: 2 },
              { title: "Club Z", link: "https://www.google.com/goto?url=CAESDEF456", position: 3 },
            ],
          }),
        };
      }
      if (req.url === "https://google.serper.dev/resolve") {
        return {
          url: req.url,
          status: 200,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            organic: [
              { title: "Nebula", link: "https://www.nebulanewyork.com/events", position: 1 },
              { title: "Club X", link: "https://clubx.example/", position: 2 },
              { title: "Club Z", link: "https://clubz.example/", position: 3 },
            ],
          }),
        };
      }
      if (req.url.endsWith("/robots.txt")) return page(req.url, "User-agent: *\nDisallow:\n");
      if (req.url === "https://clubx.example/")
        return page(req.url, '<h1>Club X</h1><a href="/events">Events</a>');
      if (req.url === "https://clubx.example/events")
        return page(req.url, "<p>October 9, 2026 Salsa</p><p>October 10, 2026 Bachata</p>");
      if (req.url === "https://clubz.example/")
        return page(req.url, '<h1>Club Z</h1><a href="/events">Events</a>');
      if (req.url === "https://clubz.example/events")
        return page(req.url, "<p>October 11, 2026 Salsa</p>");
      throw new Error(`unexpected ${req.url}`);
    };
    let t = NOW.getTime();
    const http = createPoliteHttp({
      transport,
      userAgent: "DanceTonightBot/1.0 (+https://dancetonight.vercel.app/bot)",
      now: () => t,
      sleep: async (ms) => void (t += ms),
    });
    const logLines: string[] = [];
    const report = await runSerpGap({
      metro: METRO,
      http,
      apiKey: "test-key",
      held: HELD,
      now: () => NOW,
      maxQueries: 1,
      probeLimit: 2,
      log: (line) => logLines.push(line),
      sleep: () => Promise.resolve(),
    });
    expect(report.results).toBe(3);
    expect(report.hosts.map((h) => h.host)).toContain("clubz.example");
    expect(
      seen.filter((s) => s.key).every((s) => s.url.startsWith("https://google.serper.dev/")),
    ).toBe(true);
    expect(logLines.some((l) => l.includes("2 google.com/goto links resolved"))).toBe(true);
  });
});
