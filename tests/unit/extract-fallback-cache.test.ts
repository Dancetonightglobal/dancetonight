// D-142: a page read by the fallback model is not cached, so the next run reads it with the first provider.
import { describe, expect, it } from "vitest";

import type { AiClient, AiFailure } from "@/src/ai";
import { rawExtractionSchema, type RawExtraction } from "@/src/domain/listing";
import {
  EXTRACT_PROMPT_VERSION,
  extractPage,
  extractPageInChunks,
  splitPageText,
  textKey,
  type CachedExtraction,
  type ExtractionCache,
} from "@/src/pipeline/extract";

const read = (title: string, price: number) =>
  rawExtractionSchema.parse({
    page_kind: "list",
    language: "en",
    listings: [
      {
        title,
        listing_type: "social",
        styles: [],
        prices: [{ label: "door", amount: price, currency: "USD" }],
      },
    ],
  });

/** A client that answers each job from a queue and records which jobs were asked. */
function fakeClient(
  replies: Partial<Record<"extract" | "escalate", Array<RawExtraction | AiFailure>>>,
  order?: string[],
) {
  const asked: string[] = [];
  const client = {
    async run(request: { job: { id: string } }) {
      const job = request.job.id as "extract" | "escalate";
      asked.push(job);
      const reply = replies[job]?.shift();
      if (!reply) throw new Error(`no reply queued for ${job}`);
      if (typeof reply === "string") {
        return {
          ok: false,
          reason: reply,
          provider: "cloudflare",
          detail: "test",
        };
      }
      // For tests, we need to control provider per call.
      // We'll use the order to decide: if order[0] is "bedrock" and job is "extract", provider is "bedrock", else "cloudflare".
      // This matches the test scenarios.
      const provider = order?.[0] === "bedrock" && job === "extract" ? "bedrock" : "cloudflare";
      return {
        ok: true,
        value: reply,
        provider,
        model: job === "extract" ? "granite" : "gemma",
        usage: { inputTokens: 100, outputTokens: 50, cost: 79, unit: "neuron" },
      };
    },
    order,
  } as unknown as AiClient;
  return { client, asked };
}

function memoryCache(seed: Record<string, CachedExtraction> = {}) {
  const rows = new Map<string, CachedExtraction>(
    Object.entries(seed).map(([text, value]) => [
      `${textKey(text)}/${EXTRACT_PROMPT_VERSION}`,
      value,
    ]),
  );
  const cache: ExtractionCache = {
    async get(hash, version) {
      return rows.get(`${hash}/${version}`) ?? null;
    },
    async put(hash, version, value) {
      rows.set(`${hash}/${version}`, value);
    },
  };
  return {
    cache,
    rows,
    of: (text: string) => rows.get(`${textKey(text)}/${EXTRACT_PROMPT_VERSION}`),
  };
}

const PAGE = "Tango Y Te\nEvery Sunday\n$15 For Everyone";
const input = (pageText = PAGE) => ({
  pageText,
  header: { url: "https://tango.example/", today: "2026-10-04", tz: "America/New_York" },
  metro: "nyc",
});

describe("fallback model answers are not cached (D-142)", () => {
  it("caches answer from first provider (bedrock)", async () => {
    const { cache, of } = memoryCache();
    const { client } = fakeClient({ extract: [read("Tango Y Te", 15)] }, ["bedrock", "cloudflare"]);
    const result = await extractPage(input(), client, cache);
    expect(result).toMatchObject({
      status: "ok",
      cached: false,
    });
    // Should not have fallback field
    expect(result).not.toHaveProperty("fallback");
    expect(of(PAGE)?.extraction.listings[0]!.prices[0]!.amount).toBe(15);
  });

  it("does not cache answer from fallback provider (cloudflare when order first is bedrock)", async () => {
    const { cache, of } = memoryCache();
    // Create a client where extract returns provider "cloudflare" (fallback)
    const client = {
      order: ["bedrock", "cloudflare"],
      async run(request: { job: { id: string } }) {
        const job = request.job.id as "extract" | "escalate";
        const reply = read("Tango Y Te", 15);
        return {
          ok: true,
          value: reply,
          provider: "cloudflare",
          model: job === "extract" ? "granite" : "gemma",
          usage: { inputTokens: 100, outputTokens: 50, cost: 79, unit: "neuron" },
        };
      },
    } as unknown as AiClient;
    const result = await extractPage(input(), client, cache);
    expect(result).toMatchObject({
      status: "ok",
      cached: false,
      fallback: 1,
    });
    expect(
      (result.status === "ok" ? result.notes : []).some((n) =>
        n.includes("read by the fallback model"),
      ),
    ).toBe(true);
    expect(of(PAGE)).toBeUndefined();
  });

  it("caches answer when client has no order", async () => {
    const { cache, of } = memoryCache();
    const { client } = fakeClient({ extract: [read("Tango Y Te", 15)] }, undefined);
    // Remove order property
    delete (client as { order?: unknown }).order;
    const result = await extractPage(input(), client, cache);
    expect(result).toMatchObject({
      status: "ok",
      cached: false,
    });
    expect(result).not.toHaveProperty("fallback");
    expect(of(PAGE)?.extraction.listings[0]!.prices[0]!.amount).toBe(15);
  });

  it("caches answer when order first is cloudflare (no fallback)", async () => {
    const { cache, of } = memoryCache();
    const { client } = fakeClient({ extract: [read("Tango Y Te", 15)] }, ["cloudflare"]);
    const result = await extractPage(input(), client, cache);
    expect(result).toMatchObject({
      status: "ok",
      cached: false,
    });
    expect(result).not.toHaveProperty("fallback");
    expect(of(PAGE)?.extraction.listings[0]!.prices[0]!.amount).toBe(15);
  });

  it("re-read with fallback provider does not cache and leaves old cache unchanged", async () => {
    const { cache, of } = memoryCache({
      [PAGE]: { extraction: read("Tango Y Te", 20), model: "granite" },
    });
    const wants = (x: RawExtraction) =>
      x.listings.some((l) => l.prices.some((p) => p.amount === 20));
    // Create a client with order where first is bedrock, but escalate returns cloudflare.
    const client = {
      order: ["bedrock", "cloudflare"],
      async run(request: { job: { id: string } }) {
        void request;
        const reply = read("Tango Y Te", 15);
        return {
          ok: true,
          value: reply,
          provider: "cloudflare",
          model: "gemma",
          usage: { inputTokens: 100, outputTokens: 50, cost: 79, unit: "neuron" },
        };
      },
    } as unknown as AiClient;
    const result = await extractPage(input(), client, cache, { wants, budget: { left: 4 } });
    expect(result).toMatchObject({
      status: "ok",
      cached: false,
      escalated: true,
      fallback: 1,
    });
    expect(
      (result.status === "ok" ? result.notes : []).some((n) =>
        n.includes("re-read by the stronger model"),
      ),
    ).toBe(true);
    expect(
      (result.status === "ok" ? result.notes : []).some((n) =>
        n.includes("read by the fallback model"),
      ),
    ).toBe(true);
    // Cache should still hold the old entry, unchanged.
    expect(of(PAGE)?.extraction.listings[0]!.prices[0]!.amount).toBe(20);
    expect(of(PAGE)?.model).toBe("granite"); // no REREAD_MARK
  });

  it("extractPageInChunks with one fallback part does not cache whole page", async () => {
    const page = "Tango Y Te\nEvery Sunday\n$15 For Everyone\n\nSalsa Social\nEvery Monday\n$10";
    const chunks = splitPageText(page, 40); // force two parts
    expect(chunks).toHaveLength(2);
    const { cache, of } = memoryCache();
    // We'll make the first part answered by bedrock (first provider), second by cloudflare (fallback).
    // We need a client that can return different providers per call.
    let callCount = 0;
    const client = {
      order: ["bedrock", "cloudflare"],
      async run(request: { job: { id: string } }) {
        callCount++;
        void request;
        const reply = read(
          callCount === 1 ? "Tango Y Te" : "Salsa Social",
          callCount === 1 ? 15 : 10,
        );
        return {
          ok: true,
          value: reply,
          provider: callCount === 1 ? "bedrock" : "cloudflare",
          model: "granite",
          usage: { inputTokens: 100, outputTokens: 50, cost: 79, unit: "neuron" },
        };
      },
    } as unknown as AiClient;
    const result = await extractPageInChunks({ ...input(page), pageText: page }, client, cache, {
      maxChars: 40,
    });
    expect(result).toMatchObject({
      status: "ok",
      fallback: 1,
    });
    expect(
      (result.status === "ok" ? result.notes : []).some((n) =>
        n.includes("were read by a fallback model"),
      ),
    ).toBe(true);
    // Whole page should not be cached.
    expect(of(page)).toBeUndefined();
  });
});
