import { describe, expect, it } from "vitest";
import { createPoliteHttp, HttpError } from "@/src/pipeline/http";

describe("per-request maxBytes", () => {
  it("uses the client's cap when request.maxBytes is absent", async () => {
    let seenMaxBytes = 0;
    const http = createPoliteHttp({
      userAgent: "test",
      transport: async (req) => {
        seenMaxBytes = req.maxBytes;
        return { url: req.url, status: 200, headers: {}, body: "" };
      },
      maxBytes: 1000,
    });
    await http.request({ url: "https://example.org/", purpose: "api" });
    expect(seenMaxBytes).toBe(1000);
  });

  it("uses request.maxBytes when provided, overriding client cap", async () => {
    let seenMaxBytes = 0;
    const http = createPoliteHttp({
      userAgent: "test",
      transport: async (req) => {
        seenMaxBytes = req.maxBytes;
        return { url: req.url, status: 200, headers: {}, body: "" };
      },
      maxBytes: 1000,
    });
    await http.request({
      url: "https://example.org/",
      purpose: "api",
      maxBytes: 5000,
    });
    expect(seenMaxBytes).toBe(5000);
  });

  it("refuses a body declared larger than client cap when no per-request cap", async () => {
    const http = createPoliteHttp({
      userAgent: "test",
      transport: async (req) => {
        // Simulate the check that fetchTransport does
        const declared = 3000;
        if (declared > req.maxBytes) {
          throw new HttpError("too_large", req.url, `declared ${declared} bytes, over the cap`);
        }
        return {
          url: req.url,
          status: 200,
          headers: { "content-length": "3000" },
          body: "x".repeat(3000),
        };
      },
      maxBytes: 1000,
    });
    await expect(
      http.request({ url: "https://example.org/", purpose: "api" }),
    ).rejects.toMatchObject({ kind: "too_large" });
  });

  it("accepts a body declared larger than client cap when per-request cap allows", async () => {
    const http = createPoliteHttp({
      userAgent: "test",
      transport: async (req) => {
        const declared = 3000;
        if (declared > req.maxBytes) {
          throw new HttpError("too_large", req.url, `declared ${declared} bytes, over the cap`);
        }
        return {
          url: req.url,
          status: 200,
          headers: { "content-length": "3000" },
          body: "x".repeat(3000),
        };
      },
      maxBytes: 1000,
    });
    const response = await http.request({
      url: "https://example.org/",
      purpose: "api",
      maxBytes: 5000,
    });
    expect(response.status).toBe(200);
    expect(response.body.length).toBe(3000);
  });
});
