import { describe, expect, it } from "vitest";

import { buildBlocklist, registrableDomain } from "@/src/pipeline/blocklist";
import {
  buildUserAgent,
  createPoliteHttp,
  fixtureFileName,
  fixtureTransport,
  HttpError,
  retryAfterMs,
  UnrecordedRequestError,
  type Fixture,
  type TransportResponse,
} from "@/src/pipeline/http";
import { parseRobots, policyForStatus } from "@/src/pipeline/robots";
import { harvestSource, mayRun } from "@/src/pipeline/runner";
import type { SourceAdapter } from "@/src/adapters/types";

/** A clock that only moves when something sleeps, so spacing is measured, not waited for. */
function fakeClock(start = Date.parse("2026-09-23T12:00:00Z")) {
  let t = start;
  const sleeps: number[] = [];
  return {
    now: () => t,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      t += ms;
    },
    sleeps,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

function ok(url: string, body = "ok", headers: Record<string, string> = {}): Fixture {
  return { request: { method: "GET", url }, response: { url, status: 200, headers, body } };
}

const ROBOTS_OPEN = ok("https://example.org/robots.txt", "User-agent: *\nDisallow:\n");

describe("robots.txt (RFC 9309)", () => {
  it("prefers the group naming us over the star group", () => {
    const policy = parseRobots(
      ["User-agent: *", "Disallow: /", "", "User-agent: DanceTonightBot", "Allow: /"].join("\n"),
    );
    expect(policy.isAllowed("/events")).toBe(true);
  });

  it("uses the longest matching rule, and allow wins a tie", () => {
    const policy = parseRobots(
      [
        "User-agent: *",
        "Disallow: /calendar",
        "Allow: /calendar/public",
        "Disallow: /x",
        "Allow: /x",
      ].join("\n"),
    );
    expect(policy.isAllowed("/calendar/private")).toBe(false);
    expect(policy.isAllowed("/calendar/public/2026")).toBe(true);
    expect(policy.isAllowed("/x")).toBe(true);
  });

  it("supports * and $ in patterns", () => {
    const policy = parseRobots(
      ["User-agent: *", "Disallow: /*.pdf$", "Disallow: /private*/"].join("\n"),
    );
    expect(policy.isAllowed("/flyer.pdf")).toBe(false);
    expect(policy.isAllowed("/flyer.pdf?x=1")).toBe(true);
    expect(policy.isAllowed("/private-area/page")).toBe(false);
  });

  it("treats an empty Disallow as allow-all and always allows /robots.txt", () => {
    expect(parseRobots("User-agent: *\nDisallow:\n").isAllowed("/anything")).toBe(true);
    expect(parseRobots("User-agent: *\nDisallow: /\n").isAllowed("/robots.txt")).toBe(true);
  });

  it("reads Crawl-delay and the AI input signals", () => {
    const policy = parseRobots(
      ["User-agent: *", "Crawl-delay: 12", "Content-Signal: search=yes, ai-input=no"].join("\n"),
    );
    expect(policy.crawlDelayS).toBe(12);
    expect(policy.aiInputAllowed).toBe(false);
    expect(parseRobots("User-agent: *\nContent-Usage: ai=n\n").aiInputAllowed).toBe(false);
    expect(parseRobots("User-agent: *\nDisallow:\n").aiInputAllowed).toBe(true);
  });

  it("maps a 4xx robots file to allow-all and a 5xx to disallow-all", () => {
    expect(policyForStatus(404, "").isAllowed("/x")).toBe(true);
    expect(policyForStatus(503, "").isAllowed("/x")).toBe(false);
    expect(policyForStatus(503, "").unreadable).toBe("robots.txt answered 503");
    expect(policyForStatus(200, "User-agent: *\n").unreadable).toBeNull();
  });

  it("names the rule that decides a path, as Squarespace's refuses ?format=json", () => {
    const policy = parseRobots(
      ["User-agent: *", "Disallow: /*?format=json", "Disallow: /config"].join("\n"),
    );
    expect(policy.isAllowed("/events")).toBe(true);
    expect(policy.ruleFor("/events")).toBeNull();
    expect(policy.isAllowed("/events?format=json")).toBe(false);
    expect(policy.ruleFor("/events?format=json")).toBe("disallow /*?format=json");
  });
});

describe("blocklist", () => {
  const blocklist = buildBlocklist([
    { patternType: "domain", value: "optout.example" },
    { patternType: "url_prefix", value: "https://big.example/organiser/42" },
  ]);

  it("matches a blocked domain and its subdomains", () => {
    expect(blocklist.matchUrl("https://optout.example/events")?.patternType).toBe("domain");
    expect(blocklist.matchUrl("https://www.optout.example/")?.patternType).toBe("domain");
    expect(blocklist.matchUrl("https://notoptout.example/")).toBeNull();
  });

  it("matches a URL prefix only", () => {
    expect(blocklist.matchUrl("https://big.example/organiser/42/events")).not.toBeNull();
    expect(blocklist.matchUrl("https://big.example/organiser/7")).toBeNull();
  });

  it("takes the registrable domain from the public suffix list", () => {
    expect(registrableDomain("events.club.co.uk")).toBe("club.co.uk");
    expect(registrableDomain("a.github.io")).toBe("a.github.io");
    expect(registrableDomain("www.nyc.gov")).toBe("nyc.gov");
  });
});

describe("the polite client", () => {
  it("names itself as D-021 says", () => {
    expect(buildUserAgent("https://dancetonight.example/", "bot@example.com")).toBe(
      "DanceTonightBot/1.0 (+https://dancetonight.example/bot; bot@example.com)",
    );
  });

  it("spaces crawling requests to one domain at least 5 s apart, and fetches robots first", async () => {
    const clock = fakeClock();
    const transport = fixtureTransport([
      ROBOTS_OPEN,
      ok("https://example.org/a"),
      ok("https://example.org/b"),
    ]);
    const http = createPoliteHttp({
      transport,
      userAgent: "t",
      now: clock.now,
      sleep: clock.sleep,
    });
    await http.request({ url: "https://example.org/a", purpose: "crawl" });
    await http.request({ url: "https://example.org/b", purpose: "crawl" });
    expect(transport.requests).toEqual([
      "GET https://example.org/robots.txt",
      "GET https://example.org/a",
      "GET https://example.org/b",
    ]);
    // robots, then /a waits 5 s after robots, then /b waits 5 s after /a.
    expect(clock.sleeps).toEqual([5_000, 5_000]);
  });

  it("does not start a long Crawl-delay with robots.txt, and reads one page a run past the cap (D-252)", async () => {
    const clock = fakeClock();
    const transport = fixtureTransport([
      {
        request: { method: "GET", url: "https://slow.example/robots.txt" },
        response: {
          url: "https://slow.example/robots.txt",
          status: 200,
          headers: { "content-type": "text/plain" },
          body: "User-agent: *\nCrawl-delay: 3600\n",
        },
      },
      ok("https://slow.example/a"),
      ok("https://slow.example/b"),
    ]);
    const http = createPoliteHttp({
      transport,
      userAgent: "t",
      now: clock.now,
      sleep: clock.sleep,
    });
    await http.request({ url: "https://slow.example/a", purpose: "crawl" });
    // The page waited the base 5 s after robots.txt, not an hour.
    expect(clock.sleeps).toEqual([5_000]);
    await expect(http.request({ url: "https://slow.example/b", purpose: "crawl" })).rejects.toThrow(
      /crawl delay of 3600 s/,
    );
    expect(transport.requests).toEqual([
      "GET https://slow.example/robots.txt",
      "GET https://slow.example/a",
    ]);
  });

  it("serialises concurrent requests to one domain but not across domains", async () => {
    const clock = fakeClock();
    const transport = fixtureTransport([
      ok("https://api.one.example/1"),
      ok("https://api.one.example/2"),
      ok("https://api.two.example/1"),
    ]);
    const http = createPoliteHttp({
      transport,
      userAgent: "t",
      now: clock.now,
      sleep: clock.sleep,
    });
    await Promise.all([
      http.request({ url: "https://api.one.example/1", purpose: "api", intervalMs: 1_000 }),
      http.request({ url: "https://api.one.example/2", purpose: "api", intervalMs: 1_000 }),
      http.request({ url: "https://api.two.example/1", purpose: "api", intervalMs: 1_000 }),
    ]);
    expect(clock.sleeps).toEqual([1_000]);
  });

  it("raises the interval to the site's Crawl-delay", async () => {
    const clock = fakeClock();
    const transport = fixtureTransport([
      ok("https://slow.example/robots.txt", "User-agent: *\nCrawl-delay: 20\n"),
      ok("https://slow.example/a"),
      ok("https://slow.example/b"),
    ]);
    const http = createPoliteHttp({
      transport,
      userAgent: "t",
      now: clock.now,
      sleep: clock.sleep,
    });
    await http.request({ url: "https://slow.example/a", purpose: "crawl" });
    await http.request({ url: "https://slow.example/b", purpose: "crawl" });
    // robots.txt does not start the delay (D-252): /a waits 5 s, /b the site's 20 s after /a.
    expect(clock.sleeps).toEqual([5_000, 20_000]);
  });

  it("refuses a path robots.txt disallows without requesting it", async () => {
    const transport = fixtureTransport([
      ok("https://closed.example/robots.txt", "User-agent: *\nDisallow: /members\n"),
    ]);
    const clock = fakeClock();
    const http = createPoliteHttp({
      transport,
      userAgent: "t",
      now: clock.now,
      sleep: clock.sleep,
    });
    await expect(
      http.request({ url: "https://closed.example/members/list", purpose: "crawl" }),
    ).rejects.toMatchObject({
      kind: "robots_disallowed",
      message: "robots.txt disallows /members/list (rule: disallow /members)",
    });
    expect(transport.requests).toEqual(["GET https://closed.example/robots.txt"]);
  });

  it("says when robots.txt could not be read rather than that it refused", async () => {
    const http = createPoliteHttp({
      userAgent: "t",
      transport: async (req) => ({ url: req.url, status: 500, headers: {}, body: "" }),
      sleep: async () => {},
    });
    await expect(
      http.request({ url: "https://down.example/", purpose: "crawl" }),
    ).rejects.toMatchObject({
      kind: "robots_disallowed",
      message: "robots.txt answered 500, which counts as disallowing the whole site",
    });
  });

  it('names the reason behind Node\'s bare "fetch failed"', async () => {
    const http = createPoliteHttp({
      userAgent: "t",
      transport: async () => {
        throw new TypeError("fetch failed", {
          cause: Object.assign(new Error("getaddrinfo ENOTFOUND gone.example"), {
            code: "ENOTFOUND",
          }),
        });
      },
    });
    await expect(
      http.request({ url: "https://gone.example/x", purpose: "api" }),
    ).rejects.toMatchObject({
      kind: "network",
      message: "fetch failed: ENOTFOUND getaddrinfo ENOTFOUND gone.example",
    });
  });

  it("reports an API's own error text, with the key in its URL masked", async () => {
    const http = createPoliteHttp({
      userAgent: "t",
      transport: async (req) => ({
        url: req.url,
        status: 400,
        headers: {},
        body: '{"error":"ARGUMENTS_ERROR",\n "error_description":"bad key sekret-key-123"}',
      }),
    });
    await expect(
      http.request({ url: "https://api.example/v1?apikey=sekret-key-123&page=1", purpose: "api" }),
    ).rejects.toMatchObject({
      kind: "http_status",
      message:
        'the site answered 400: {"error":"ARGUMENTS_ERROR", "error_description":"bad key ***"}',
    });
    // A crawled page's error body is HTML and stays out of the report.
    const crawl = createPoliteHttp({
      userAgent: "t",
      transport: async (req) =>
        req.url.endsWith("/robots.txt")
          ? { url: req.url, status: 404, headers: {}, body: "" }
          : { url: req.url, status: 400, headers: {}, body: "<html>nope</html>" },
      sleep: async () => {},
    });
    await expect(
      crawl.request({ url: "https://page.example/x", purpose: "crawl" }),
    ).rejects.toMatchObject({ message: "the site answered 400" });
  });

  it("skips robots for official APIs but never skips the blocklist", async () => {
    const transport = fixtureTransport([ok("https://api.example/v1")]);
    const http = createPoliteHttp({
      transport,
      userAgent: "t",
      blocklist: buildBlocklist([{ patternType: "domain", value: "optout.example" }]),
    });
    await http.request({ url: "https://api.example/v1", purpose: "api" });
    await expect(
      http.request({ url: "https://optout.example/feed.ics", purpose: "api" }),
    ).rejects.toMatchObject({ kind: "blocklisted" });
    expect(transport.requests).toEqual(["GET https://api.example/v1"]);
  });

  it("refuses non-http URLs", async () => {
    const http = createPoliteHttp({ transport: fixtureTransport([]), userAgent: "t" });
    await expect(http.request({ url: "file:///etc/passwd", purpose: "api" })).rejects.toMatchObject(
      {
        kind: "invalid_url",
      },
    );
  });

  it("sends conditional headers and reports a 304 as not modified", async () => {
    let seen: Record<string, string> = {};
    const http = createPoliteHttp({
      userAgent: "DanceTonightBot/1.0",
      transport: async (req) => {
        seen = req.headers;
        return { url: req.url, status: 304, headers: { etag: '"v1"' }, body: "" };
      },
    });
    const res = await http.request({
      url: "https://api.example/feed",
      purpose: "api",
      conditional: { etag: '"v1"', lastModified: "Tue, 22 Sep 2026 10:00:00 GMT" },
    });
    expect(seen["if-none-match"]).toBe('"v1"');
    expect(seen["if-modified-since"]).toBe("Tue, 22 Sep 2026 10:00:00 GMT");
    expect(seen["user-agent"]).toBe("DanceTonightBot/1.0");
    expect(res.notModified).toBe(true);
    expect(res.etag).toBe('"v1"');
  });

  it("stops on 402 and 403 (D-021)", async () => {
    const http = createPoliteHttp({
      userAgent: "t",
      transport: async (req) => ({ url: req.url, status: 403, headers: {}, body: "no" }),
    });
    const error = await http
      .request({ url: "https://api.example/x", purpose: "api" })
      .catch((e) => e);
    expect(error).toBeInstanceOf(HttpError);
    expect(error).toMatchObject({ kind: "stopped", status: 403 });
  });

  it("retries a 429 once when Retry-After is short", async () => {
    const clock = fakeClock();
    let calls = 0;
    const http = createPoliteHttp({
      userAgent: "t",
      now: clock.now,
      sleep: clock.sleep,
      transport: async (req): Promise<TransportResponse> => {
        calls += 1;
        return calls === 1
          ? { url: req.url, status: 429, headers: { "retry-after": "3" }, body: "" }
          : { url: req.url, status: 200, headers: {}, body: "fine" };
      },
    });
    const res = await http.request({ url: "https://api.example/x", purpose: "api" });
    expect(res.body).toBe("fine");
    expect(calls).toBe(2);
    expect(clock.sleeps[0]).toBe(3_000);
  });

  // D-818 (Pune read 3, 2026-11-10): Ticketmaster's "Spike arrest violation" 429 carries no Retry-After.
  it("retries an API 429 without Retry-After once after 2 s", async () => {
    const clock = fakeClock();
    let calls = 0;
    const http = createPoliteHttp({
      userAgent: "t",
      now: clock.now,
      sleep: clock.sleep,
      transport: async (req): Promise<TransportResponse> => {
        calls += 1;
        return calls === 1
          ? { url: req.url, status: 429, headers: {}, body: '{"fault":"Spike arrest violation"}' }
          : { url: req.url, status: 200, headers: {}, body: "fine" };
      },
    });
    const res = await http.request({ url: "https://api.example/x", purpose: "api" });
    expect(res.body).toBe("fine");
    expect(calls).toBe(2);
    expect(clock.sleeps).toContain(2_000);
  });

  it("gives up after one retry of an API 429 without Retry-After", async () => {
    const clock = fakeClock();
    let calls = 0;
    const http = createPoliteHttp({
      userAgent: "t",
      now: clock.now,
      sleep: clock.sleep,
      transport: async (req) => {
        calls += 1;
        return { url: req.url, status: 429, headers: {}, body: "" };
      },
    });
    await expect(
      http.request({ url: "https://api.example/x", purpose: "api" }),
    ).rejects.toMatchObject({ kind: "http_status", status: 429 });
    expect(calls).toBe(2);
  });

  it("does not wait out a long Retry-After", async () => {
    const http = createPoliteHttp({
      userAgent: "t",
      transport: async (req) => ({
        url: req.url,
        status: 429,
        headers: { "retry-after": "3600" },
        body: "",
      }),
    });
    await expect(
      http.request({ url: "https://api.example/x", purpose: "api" }),
    ).rejects.toMatchObject({ kind: "http_status", status: 429 });
  });

  it("parses Retry-After as seconds or a date", () => {
    const now = Date.parse("2026-09-23T12:00:00Z");
    expect(retryAfterMs("5", now)).toBe(5_000);
    expect(retryAfterMs("Wed, 23 Sep 2026 12:00:10 GMT", now)).toBe(10_000);
    expect(retryAfterMs("soon", now)).toBeNull();
  });

  it("fails loudly on an unrecorded request", async () => {
    const http = createPoliteHttp({ transport: fixtureTransport([]), userAgent: "t" });
    const error = await http
      .request({ url: "https://api.example/x", purpose: "api" })
      .catch((e) => e);
    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).kind).toBe("network");
    expect((error as HttpError).message).toContain(
      new UnrecordedRequestError("GET https://api.example/x").message,
    );
  });

  it("names fixture files readably and uniquely", () => {
    const a = fixtureFileName(
      "GET",
      "https://app.ticketmaster.com/discovery/v2/events.json?page=0",
    );
    const b = fixtureFileName(
      "GET",
      "https://app.ticketmaster.com/discovery/v2/events.json?page=1",
    );
    expect(a).toMatch(/^app-ticketmaster-com-discovery-v2-events-json-[0-9a-f]{10}\.json$/);
    expect(a).not.toBe(b);
  });
});

describe("the runner's gate", () => {
  const metro = {
    id: "m",
    slug: "nyc",
    name: "New York",
    countryCode: "US",
    center: { lat: 40.7, lng: -74 },
    radiusKm: 50,
    tz: "America/New_York",
    languages: ["en"],
  };
  const adapter = (over: Partial<SourceAdapter>): SourceAdapter => ({
    id: "ticketmaster",
    tier: "A",
    limits: { perDomainIntervalMs: 250 },
    ...over,
  });

  it("follows the default, then a flag row", () => {
    expect(mayRun(adapter({}), metro, { TICKETMASTER_API_KEY: "k" })).toEqual({ run: true });
    expect(mayRun(adapter({ id: "predicthq" }), metro, {})).toMatchObject({
      run: false,
      reason: "flag_off",
    });
    expect(
      mayRun(adapter({}), metro, {}, new Map([["adapter.ticketmaster", false]])),
    ).toMatchObject({ run: false, reason: "flag_off" });
  });

  it("keeps a region-scoped adapter to its countries (D-029)", () => {
    expect(mayRun(adapter({ id: "moshtix", countries: ["AU", "NZ"] }), metro, {})).toMatchObject({
      run: false,
      reason: "wrong_country",
    });
  });

  it("reports a missing key as not configured", () => {
    expect(
      mayRun(adapter({ requiredEnv: ["TICKETMASTER_API_KEY"] }), metro, {
        TICKETMASTER_API_KEY: " ",
      }),
    ).toEqual({ run: false, reason: "not_configured", detail: "needs TICKETMASTER_API_KEY" });
  });

  it("turns an adapter's error into a failed outcome instead of throwing", async () => {
    const failing = adapter({
      harvest: async () => {
        throw new HttpError("stopped", "https://x.example", "the site answered 403", 403);
      },
    });
    const outcome = await harvestSource(
      failing,
      {
        id: "s",
        url: "https://x.example",
        kind: "feed_ics",
        trustTier: "first_party",
        platform: null,
        feedUrl: null,
        metroId: "m",
        styles: [],
        etag: null,
        lastModified: null,
        contentHash: null,
      },
      {
        metro,
        now: () => new Date(),
        http: createPoliteHttp({ transport: fixtureTransport([]), userAgent: "t" }),
        env: {},
        log: () => {},
      },
    );
    expect(outcome).toMatchObject({ status: "failed", errorKind: "stopped" });
  });
});
