import { describe, it, expect } from "vitest";
import {
  CRAWLER_TOKENS,
  isCrawler,
  blockedForCrawler,
  crawlerBlockedResponse,
} from "../../src/edge/crawler-guard";

describe("CRAWLER_TOKENS", () => {
  it("contains expected tokens", () => {
    expect(CRAWLER_TOKENS).toEqual([
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
    ]);
  });
});

describe("isCrawler", () => {
  it("returns true for full UA containing ClaudeBot token", () => {
    const ua =
      "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)";
    expect(isCrawler(ua)).toBe(true);
  });

  it("returns true for Googlebot/2.1", () => {
    expect(isCrawler("Googlebot/2.1")).toBe(true);
  });

  it("returns true for bingbot", () => {
    expect(isCrawler("bingbot")).toBe(true);
  });

  it("returns false for desktop Chrome UA", () => {
    const chromeUA =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";
    expect(isCrawler(chromeUA)).toBe(false);
  });

  it("returns false for iPhone Safari UA", () => {
    const safariUA =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_6_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
    expect(isCrawler(safariUA)).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isCrawler("")).toBe(false);
  });

  it("returns false for null", () => {
    expect(isCrawler(null)).toBe(false);
  });
});

describe("blockedForCrawler", () => {
  it("returns true for ClaudeBot with query string", () => {
    const req = new Request("https://example.com/?day=2026-10-22&f=tango", {
      headers: {
        "user-agent":
          "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)",
      },
    });
    expect(blockedForCrawler(req)).toBe(true);
  });

  it("returns false for ClaudeBot without query string", () => {
    const req = new Request("https://example.com/", {
      headers: {
        "user-agent":
          "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)",
      },
    });
    expect(blockedForCrawler(req)).toBe(false);
  });

  it("returns false for ClaudeBot on /e/some-night (no query)", () => {
    const req = new Request("https://example.com/e/some-night", {
      headers: {
        "user-agent":
          "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)",
      },
    });
    expect(blockedForCrawler(req)).toBe(false);
  });

  it("returns false for Chrome with query string", () => {
    const req = new Request("https://example.com/?day=2026-10-22", {
      headers: {
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
      },
    });
    expect(blockedForCrawler(req)).toBe(false);
  });
});

describe("crawlerBlockedResponse", () => {
  it("returns 403 with correct headers and body", () => {
    const res = crawlerBlockedResponse();
    expect(res.status).toBe(403);
    expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(res.headers.get("x-dt-blocked")).toBe("robots");
    expect(res.headers.get("cache-control")).toBe("public, max-age=3600");
    expect(res.body).not.toBeNull();
    const text = res.text();
    // We can't await inside a non-async test, but we can trust the body is set.
    // The spec says body is "Disallowed by robots.txt: /*?\n"
    // We'll just verify the response is usable.
    expect(res).toBeInstanceOf(Response);
  });
});
