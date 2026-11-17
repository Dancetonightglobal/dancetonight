// D-101: a cached read whose check drops facts its page does not write is read once more by the
// stronger model, rather than replayed for ever; each case fails when its rule is broken.
import { describe, expect, it } from "vitest";

import type { AiClient, AiFailure } from "@/src/ai";
import { rawExtractionSchema, type RawExtraction } from "@/src/domain/listing";
import {
  EXTRACT_PROMPT_VERSION,
  REREAD_MARK,
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
) {
  const asked: string[] = [];
  const client = {
    async run(request: { job: { id: string } }) {
      const job = request.job.id as "extract" | "escalate";
      asked.push(job);
      const reply = replies[job]?.shift();
      if (!reply) throw new Error(`no reply queued for ${job}`);
      if (typeof reply === "string") {
        return { ok: false, reason: reply, provider: "cloudflare", detail: "test" };
      }
      return {
        ok: true,
        value: reply,
        provider: "cloudflare",
        model: job === "extract" ? "granite" : "gemma",
        usage: { inputTokens: 100, outputTokens: 50, cost: 79, unit: "neuron" },
      };
    },
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
/** The check's verdict, as ingest gives it: a read whose price is $20 drops a fact here. */
const wants = (x: RawExtraction) => x.listings.some((l) => l.prices.some((p) => p.amount === 20));

describe("a cached read that drops facts is re-read once (D-101)", () => {
  it("re-reads it with the stronger model, marks it, and serves the new answer", async () => {
    const { cache, of } = memoryCache({
      [PAGE]: { extraction: read("Tango Y Te", 20), model: "granite" },
    });
    const { client, asked } = fakeClient({ escalate: [read("Tango Y Te", 15)] });
    const budget = { left: 4 };
    const result = await extractPage(input(), client, cache, { wants, budget });
    expect(asked).toEqual(["escalate"]);
    expect(result).toMatchObject({
      status: "ok",
      cached: false,
      escalated: true,
      model: `gemma${REREAD_MARK}`,
    });
    if (result.status !== "ok") throw new Error("not read");
    expect(result.extraction.listings[0]!.prices[0]!.amount).toBe(15);
    expect(result.notes.join("\n")).toMatch(/re-read by the stronger model/);
    expect(of(PAGE)?.model).toBe(`gemma${REREAD_MARK}`);
    expect(budget.left).toBe(3);
  });

  it("never re-reads an answer twice, even when its check still drops facts", async () => {
    const { cache } = memoryCache({
      [PAGE]: { extraction: read("Tango Y Te", 20), model: `gemma${REREAD_MARK}` },
    });
    const { client, asked } = fakeClient({});
    const result = await extractPage(input(), client, cache, { wants, budget: { left: 4 } });
    expect(asked).toEqual([]);
    expect(result).toMatchObject({ status: "ok", cached: true });
  });

  it("re-reads nothing once the run's re-reads are spent, or when nothing was dropped", async () => {
    const spent = memoryCache({ [PAGE]: { extraction: read("Tango Y Te", 20), model: "granite" } });
    const none = fakeClient({});
    await extractPage(input(), none.client, spent.cache, { wants, budget: { left: 0 } });
    const clean = memoryCache({ [PAGE]: { extraction: read("Tango Y Te", 15), model: "granite" } });
    await extractPage(input(), none.client, clean.cache, { wants, budget: { left: 4 } });
    expect(none.asked).toEqual([]);
  });

  it("keeps the cached answer, unmarked, when the re-read cannot be made", async () => {
    const { cache, of } = memoryCache({
      [PAGE]: { extraction: read("Tango Y Te", 20), model: "granite" },
    });
    const { client } = fakeClient({ escalate: ["quota_exhausted"] });
    const result = await extractPage(input(), client, cache, { wants, budget: { left: 4 } });
    expect(result).toMatchObject({ status: "ok", cached: true, model: "granite" });
    if (result.status !== "ok") throw new Error("not read");
    expect(result.notes.join("\n")).toMatch(
      /re-read was wanted .* not possible \(quota_exhausted\)/,
    );
    expect(of(PAGE)?.model).toBe("granite");
  });

  it("re-reads only the parts of a long page whose own reads drop facts", async () => {
    const part = (title: string) => `${title}\n${"Every Sunday, all levels welcome. ".repeat(4)}`;
    const page = [part("Tango Y Te"), part("Salsa Social"), part("Zen Zouk")].join("\n\n");
    const chunks = splitPageText(page, 160);
    expect(chunks).toHaveLength(3);
    const reads = [read("Tango Y Te", 20), read("Salsa Social", 15), read("Zen Zouk", 11)];
    const seed: Record<string, CachedExtraction> = {
      [page]: {
        extraction: {
          page_kind: "list",
          language: "en",
          listings: reads.flatMap((r) => r.listings),
        },
        model: "granite",
      },
    };
    chunks.forEach((chunk, i) => (seed[chunk] = { extraction: reads[i]!, model: "granite" }));
    const { cache, of } = memoryCache(seed);
    const { client, asked } = fakeClient({ escalate: [read("Tango Y Te", 15)] });
    const result = await extractPageInChunks(input(page), client, cache, {
      maxChars: 160,
      reread: { wants, budget: { left: 4 } },
    });
    expect(asked).toEqual(["escalate"]);
    if (result.status !== "ok") throw new Error("not read");
    expect(result.extraction.listings.map((l) => l.prices[0]!.amount)).toEqual([15, 15, 11]);
    expect(of(page)?.model).toContain(REREAD_MARK);
  });
});
