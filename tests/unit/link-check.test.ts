import { describe, expect, it } from "vitest";
import {
  createPoliteHttp,
  HttpError,
  type TransportRequest,
  type TransportResponse,
} from "@/src/pipeline/http";
import {
  linkKey,
  checkLink,
  nextLinkState,
  LINK_CHECK_MAX_BYTES,
  type LinkVerdict,
  type LinkCheckState,
} from "@/src/pipeline/link-check";

describe("linkKey", () => {
  it("removes fragment from URL", () => {
    expect(linkKey("https://a.org/x#:~:text=Salsa")).toBe("https://a.org/x");
  });

  it("returns unchanged URL when no fragment", () => {
    expect(linkKey("https://a.org/x")).toBe("https://a.org/x");
  });

  it("handles empty string", () => {
    expect(linkKey("")).toBe("");
  });

  it("handles only fragment", () => {
    expect(linkKey("#fragment")).toBe("");
  });
});

describe("checkLink", () => {
  const userAgent = "test";
  const sleep = async () => {};

  function makeTransport(responses: Record<string, () => TransportResponse>) {
    return async (req: TransportRequest): Promise<TransportResponse> => {
      const key = `${req.method} ${req.url}`;
      if (responses[key]) {
        return responses[key]();
      }
      // robots.txt fallback
      if (req.url.endsWith("/robots.txt")) {
        return {
          url: req.url,
          status: 404,
          headers: {},
          body: "",
        };
      }
      throw new Error(`No response for ${key}`);
    };
  }

  it("returns ok for 200", async () => {
    const transport = makeTransport({
      "GET https://example.com/robots.txt": () => ({
        url: "https://example.com/robots.txt",
        status: 404,
        headers: {},
        body: "",
      }),
      "GET https://example.com/page": () => ({
        url: "https://example.com/page",
        status: 200,
        headers: {},
        body: "",
      }),
    });
    const http = createPoliteHttp({ transport, userAgent, sleep });
    const verdict = await checkLink(http, "https://example.com/page");
    expect(verdict).toEqual({ kind: "ok" });
  });

  it("returns missing for 404", async () => {
    const transport = makeTransport({
      "GET https://example.com/robots.txt": () => ({
        url: "https://example.com/robots.txt",
        status: 404,
        headers: {},
        body: "",
      }),
      "GET https://example.com/page": () => ({
        url: "https://example.com/page",
        status: 404,
        headers: {},
        body: "",
      }),
    });
    const http = createPoliteHttp({ transport, userAgent, sleep });
    const verdict = await checkLink(http, "https://example.com/page");
    expect(verdict).toEqual({ kind: "missing", reason: "http 404" });
  });

  it("returns missing for 410", async () => {
    const transport = makeTransport({
      "GET https://example.com/robots.txt": () => ({
        url: "https://example.com/robots.txt",
        status: 404,
        headers: {},
        body: "",
      }),
      "GET https://example.com/page": () => ({
        url: "https://example.com/page",
        status: 410,
        headers: {},
        body: "",
      }),
    });
    const http = createPoliteHttp({ transport, userAgent, sleep });
    const verdict = await checkLink(http, "https://example.com/page");
    expect(verdict).toEqual({ kind: "missing", reason: "http 410" });
  });

  it("returns unknown for 500", async () => {
    const transport = makeTransport({
      "GET https://example.com/robots.txt": () => ({
        url: "https://example.com/robots.txt",
        status: 404,
        headers: {},
        body: "",
      }),
      "GET https://example.com/page": () => ({
        url: "https://example.com/page",
        status: 500,
        headers: {},
        body: "",
      }),
    });
    const http = createPoliteHttp({ transport, userAgent, sleep });
    const verdict = await checkLink(http, "https://example.com/page");
    expect(verdict).toEqual({ kind: "unknown", reason: "http 500" });
  });

  it("returns unknown for 403 (stopped)", async () => {
    const transport = makeTransport({
      "GET https://example.com/robots.txt": () => ({
        url: "https://example.com/robots.txt",
        status: 404,
        headers: {},
        body: "",
      }),
      "GET https://example.com/page": () => ({
        url: "https://example.com/page",
        status: 403,
        headers: {},
        body: "",
      }),
    });
    const http = createPoliteHttp({ transport, userAgent, sleep });
    const verdict = await checkLink(http, "https://example.com/page");
    expect(verdict).toEqual({ kind: "unknown", reason: "stopped" });
  });

  it("returns ok for too_large", async () => {
    const transport = makeTransport({
      "GET https://example.com/robots.txt": () => ({
        url: "https://example.com/robots.txt",
        status: 404,
        headers: {},
        body: "",
      }),
      "GET https://example.com/page": () => {
        throw new HttpError("too_large", "https://example.com/page", "body too large");
      },
    });
    const http = createPoliteHttp({ transport, userAgent, sleep });
    const verdict = await checkLink(http, "https://example.com/page");
    expect(verdict).toEqual({ kind: "ok" });
  });

  it("returns unreachable for timeout", async () => {
    const transport = makeTransport({
      "GET https://example.com/robots.txt": () => ({
        url: "https://example.com/robots.txt",
        status: 404,
        headers: {},
        body: "",
      }),
      "GET https://example.com/page": () => {
        throw new HttpError("timeout", "https://example.com/page", "no answer");
      },
    });
    const http = createPoliteHttp({ transport, userAgent, sleep });
    const verdict = await checkLink(http, "https://example.com/page");
    expect(verdict).toEqual({ kind: "unreachable", reason: "timeout" });
  });

  it("returns unreachable for network error", async () => {
    const transport = makeTransport({
      "GET https://example.com/robots.txt": () => ({
        url: "https://example.com/robots.txt",
        status: 404,
        headers: {},
        body: "",
      }),
      "GET https://example.com/page": () => {
        throw new HttpError("network", "https://example.com/page", "ENOTFOUND");
      },
    });
    const http = createPoliteHttp({ transport, userAgent, sleep });
    const verdict = await checkLink(http, "https://example.com/page");
    expect(verdict).toEqual({ kind: "unreachable", reason: "network: ENOTFOUND" });
  });

  it("returns unknown for robots_disallowed", async () => {
    const transport = makeTransport({
      "GET https://example.com/robots.txt": () => ({
        url: "https://example.com/robots.txt",
        status: 200,
        headers: {},
        body: "User-agent: *\nDisallow: /",
      }),
      "GET https://example.com/page": () => ({
        url: "https://example.com/page",
        status: 200,
        headers: {},
        body: "",
      }),
    });
    const http = createPoliteHttp({ transport, userAgent, sleep });
    const verdict = await checkLink(http, "https://example.com/page");
    expect(verdict).toEqual({ kind: "unknown", reason: "robots_disallowed" });
  });

  it("returns unknown for blocklisted", async () => {
    // We need to simulate blocklist match, which is done inside http.request
    // For simplicity, we'll use a transport that throws HttpError with kind "blocklisted"
    const transport = makeTransport({
      "GET https://example.com/robots.txt": () => ({
        url: "https://example.com/robots.txt",
        status: 404,
        headers: {},
        body: "",
      }),
      "GET https://example.com/page": () => {
        throw new HttpError("blocklisted", "https://example.com/page", "on the blocklist");
      },
    });
    const http = createPoliteHttp({ transport, userAgent, sleep });
    const verdict = await checkLink(http, "https://example.com/page");
    expect(verdict).toEqual({ kind: "unknown", reason: "blocklisted" });
  });

  it("returns unknown for invalid_url", async () => {
    const transport = makeTransport({
      "GET https://example.com/robots.txt": () => ({
        url: "https://example.com/robots.txt",
        status: 404,
        headers: {},
        body: "",
      }),
      "GET https://example.com/page": () => {
        throw new HttpError("invalid_url", "https://example.com/page", "not a URL");
      },
    });
    const http = createPoliteHttp({ transport, userAgent, sleep });
    const verdict = await checkLink(http, "https://example.com/page");
    expect(verdict).toEqual({ kind: "unknown", reason: "invalid_url" });
  });

  it("returns unreachable for non-HttpError (becomes network error)", async () => {
    const transport = makeTransport({
      "GET https://example.com/robots.txt": () => ({
        url: "https://example.com/robots.txt",
        status: 404,
        headers: {},
        body: "",
      }),
      "GET https://example.com/page": () => {
        throw new Error("some random error");
      },
    });
    const http = createPoliteHttp({ transport, userAgent, sleep });
    const verdict = await checkLink(http, "https://example.com/page");
    expect(verdict).toEqual({ kind: "unreachable", reason: "network: some random error" });
  });

  it("uses LINK_CHECK_MAX_BYTES", async () => {
    let seenMaxBytes = 0;
    const transport = makeTransport({
      "GET https://example.com/page": () => ({
        url: "https://example.com/page",
        status: 200,
        headers: {},
        body: "",
      }),
    });
    const http = createPoliteHttp({
      transport: async (req) => {
        if (req.url.endsWith("/page")) seenMaxBytes = req.maxBytes;
        return transport(req);
      },
      userAgent,
      sleep,
    });
    await checkLink(http, "https://example.com/page");
    expect(seenMaxBytes).toBe(LINK_CHECK_MAX_BYTES);
  });
});

describe("nextLinkState", () => {
  const now = new Date("2026-01-01T00:00:00Z");

  it("returns null for unknown verdict", () => {
    const verdict: LinkVerdict = { kind: "unknown", reason: "http 500" };
    const result = nextLinkState(null, verdict, now);
    expect(result).toBeNull();
  });

  it("returns reset state for ok", () => {
    const verdict: LinkVerdict = { kind: "ok" };
    const result = nextLinkState(null, verdict, now);
    expect(result).toEqual({
      checkedAt: now,
      broken: false,
      failures: 0,
      reason: null,
    });
  });

  it("returns broken true for first missing", () => {
    const verdict: LinkVerdict = { kind: "missing", reason: "http 404" };
    const result = nextLinkState(null, verdict, now);
    expect(result).toEqual({
      checkedAt: now,
      broken: true,
      failures: 1,
      reason: "http 404",
    });
  });

  it("increments failures for missing with previous", () => {
    const prev: LinkCheckState = {
      checkedAt: new Date("2025-12-31T00:00:00Z"),
      broken: true,
      failures: 2,
      reason: "http 404",
    };
    const verdict: LinkVerdict = { kind: "missing", reason: "http 404" };
    const result = nextLinkState(prev, verdict, now);
    expect(result).toEqual({
      checkedAt: now,
      broken: true,
      failures: 3,
      reason: "http 404",
    });
  });

  it("unreachable once -> broken false", () => {
    const verdict: LinkVerdict = { kind: "unreachable", reason: "timeout" };
    const result = nextLinkState(null, verdict, now);
    expect(result).toEqual({
      checkedAt: now,
      broken: false,
      failures: 1,
      reason: "timeout",
    });
  });

  it("unreachable twice -> broken true", () => {
    const prev: LinkCheckState = {
      checkedAt: new Date("2025-12-31T00:00:00Z"),
      broken: false,
      failures: 1,
      reason: "timeout",
    };
    const verdict: LinkVerdict = { kind: "unreachable", reason: "timeout" };
    const result = nextLinkState(prev, verdict, now);
    expect(result).toEqual({
      checkedAt: now,
      broken: true,
      failures: 2,
      reason: "timeout",
    });
  });

  it("ok after broken resets", () => {
    const prev: LinkCheckState = {
      checkedAt: new Date("2025-12-31T00:00:00Z"),
      broken: true,
      failures: 3,
      reason: "http 404",
    };
    const verdict: LinkVerdict = { kind: "ok" };
    const result = nextLinkState(prev, verdict, now);
    expect(result).toEqual({
      checkedAt: now,
      broken: false,
      failures: 0,
      reason: null,
    });
  });
});
