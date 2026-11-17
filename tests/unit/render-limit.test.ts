import { describe, it, expect, vi } from "vitest";
import {
  renderLimitKey,
  renderAllowed,
  rateLimitedResponse,
  RENDER_LIMIT_PER_MINUTE,
  type RateLimiter,
} from "../../src/edge/render-limit";
import fs from "fs";
import path from "path";

describe("renderLimitKey", () => {
  it("returns the header value when present", () => {
    const request = new Request("https://example.com/", {
      headers: { "cf-connecting-ip": "203.0.113.1" },
    });
    expect(renderLimitKey(request)).toBe("203.0.113.1");
  });

  it("returns null when header absent", () => {
    const request = new Request("https://example.com/");
    expect(renderLimitKey(request)).toBeNull();
  });

  it("returns null when header is empty string", () => {
    const request = new Request("https://example.com/", {
      headers: { "cf-connecting-ip": "" },
    });
    expect(renderLimitKey(request)).toBeNull();
  });

  it("returns null when header is whitespace only", () => {
    const request = new Request("https://example.com/", {
      headers: { "cf-connecting-ip": "   " },
    });
    expect(renderLimitKey(request)).toBeNull();
  });
});

describe("renderAllowed", () => {
  it("returns true when limiter is undefined", async () => {
    const request = new Request("https://example.com/");
    expect(await renderAllowed(request, undefined)).toBe(true);
  });

  it("returns true when key is null (limiter not called)", async () => {
    const mockLimiter = { limit: vi.fn() };
    const request = new Request("https://example.com/");
    expect(await renderAllowed(request, mockLimiter as unknown as RateLimiter)).toBe(true);
    expect(mockLimiter.limit).not.toHaveBeenCalled();
  });

  it("returns true when limiter.limit resolves with success: true", async () => {
    const mockLimiter = {
      limit: vi.fn().mockResolvedValue({ success: true }),
    };
    const request = new Request("https://example.com/", {
      headers: { "cf-connecting-ip": "203.0.113.1" },
    });
    expect(await renderAllowed(request, mockLimiter as unknown as RateLimiter)).toBe(true);
    expect(mockLimiter.limit).toHaveBeenCalledWith({ key: "203.0.113.1" });
  });

  it("returns false when limiter.limit resolves with success: false", async () => {
    const mockLimiter = {
      limit: vi.fn().mockResolvedValue({ success: false }),
    };
    const request = new Request("https://example.com/", {
      headers: { "cf-connecting-ip": "203.0.113.1" },
    });
    expect(await renderAllowed(request, mockLimiter as unknown as RateLimiter)).toBe(false);
    expect(mockLimiter.limit).toHaveBeenCalledWith({ key: "203.0.113.1" });
  });

  it("returns true when limiter.limit rejects (fail open)", async () => {
    const mockLimiter = {
      limit: vi.fn().mockRejectedValue(new Error("limiter error")),
    };
    const request = new Request("https://example.com/", {
      headers: { "cf-connecting-ip": "203.0.113.1" },
    });
    expect(await renderAllowed(request, mockLimiter as unknown as RateLimiter)).toBe(true);
    expect(mockLimiter.limit).toHaveBeenCalledWith({ key: "203.0.113.1" });
  });
});

describe("rateLimitedResponse", () => {
  it("returns a 429 response with correct headers and body", () => {
    const res = rateLimitedResponse();
    expect(res.status).toBe(429);
    expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(res.headers.get("retry-after")).toBe("60");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-dt-blocked")).toBe("rate");
    return res.text().then((body) => {
      expect(body).toBe("Too many requests. Please wait a minute and try again.\n");
    });
  });
});

describe("RENDER_LIMIT_PER_MINUTE", () => {
  it("equals 60", () => {
    expect(RENDER_LIMIT_PER_MINUTE).toBe(60);
  });

  it("matches the limit value in wrangler.jsonc", () => {
    const wranglerPath = path.resolve(__dirname, "../../wrangler.jsonc");
    const content = fs.readFileSync(wranglerPath, "utf-8");
    // Find "limit": <number> with a simple regex
    const match = content.match(/"limit"\s*:\s*(\d+)/);
    expect(match).not.toBeNull();
    const limitInFile = Number(match?.[1]);
    expect(limitInFile).toBe(RENDER_LIMIT_PER_MINUTE);
  });
});
