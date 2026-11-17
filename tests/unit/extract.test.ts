import { describe, expect, it } from "vitest";

import type { AiClient, AiFailure, AiOutcome } from "@/src/ai";
import {
  EVIDENCE_FIELDS,
  EXTRACT_JSON_SCHEMA,
  EXTRACT_LISTINGS_MAX,
  boundExtractionSchema,
} from "@/src/ai/prompts";
import { rawExtractionSchema, type RawExtraction } from "@/src/domain/listing";
import {
  EXTRACT_PROMPT_VERSION,
  textKey,
  extractPage,
  extractPageInChunks,
  splitPageText,
  extractionToHarvested,
  isMostlyNonLatin,
  type CachedExtraction,
  type ExtractionCache,
} from "@/src/pipeline/extract";

function extraction(n: number, confidence = 0.9, kind: RawExtraction["page_kind"] = "list") {
  return rawExtractionSchema.parse({
    page_kind: kind,
    language: "en",
    listings: Array.from({ length: n }, (_, i) => ({
      title: `Salsa social ${i}`,
      listing_type: "social",
      styles: ["salsa"],
      local_date: "2026-10-02",
      doors_time: "20:00",
      venue: { name: "Copacabana" },
      organizer: {},
      evidence: { title: `Salsa social ${i}` },
      confidence: { title: confidence },
    })),
  });
}

type Reply = RawExtraction | AiFailure;

/** A client that answers each job from a queue and records which jobs were asked. */
function fakeClient(replies: Partial<Record<"extract" | "escalate", Reply[]>>) {
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
        usage: { inputTokens: 100, outputTokens: 50, cost: 1.5, unit: "neuron" },
      };
    },
  } as unknown as AiClient;
  return { client, asked };
}

function memoryCache(): ExtractionCache & { rows: Map<string, CachedExtraction> } {
  const rows = new Map<string, CachedExtraction>();
  return {
    rows,
    async get(hash, version) {
      return rows.get(`${hash}/${version}`) ?? null;
    },
    async put(hash, version, value) {
      rows.set(`${hash}/${version}`, value);
    },
  };
}

const input = (pageText = "Salsa every Thursday at Copacabana") => ({
  pageText,
  header: { url: "https://salsa.example/", today: "2026-10-01", tz: "America/New_York" },
  metro: "nyc",
});

describe("model extraction (PLAN 8.2)", () => {
  it("keeps a confident base result, caches it, and serves the next read from the cache", async () => {
    const { client, asked } = fakeClient({ extract: [extraction(2)] });
    const cache = memoryCache();
    const first = await extractPage(input(), client, cache);
    expect(first).toMatchObject({
      status: "ok",
      model: "granite",
      cached: false,
      escalated: false,
    });
    expect(cache.rows.has(`${textKey(input().pageText)}/${EXTRACT_PROMPT_VERSION}`)).toBe(true);
    const again = await extractPage(input(), client, cache);
    expect(again).toMatchObject({ status: "ok", cached: true });
    expect(asked).toEqual(["extract"]);
  });

  it("escalates a list of more than 15 items, low confidence, and a reply that failed twice", async () => {
    for (const base of [extraction(16), extraction(2, 0.4), "schema_mismatch" as const]) {
      const { client, asked } = fakeClient({ extract: [base], escalate: [extraction(3)] });
      const result = await extractPage(input(), client, memoryCache());
      expect(result).toMatchObject({ status: "ok", model: "gemma", escalated: true });
      expect(asked).toEqual(["extract", "escalate"]);
    }
  });

  it("sends a non-Latin page straight to the stronger model", async () => {
    const { client, asked } = fakeClient({ escalate: [extraction(1)] });
    const text = "Танцевальный вечер сальсы каждый четверг";
    expect(isMostlyNonLatin(text)).toBe(true);
    expect(await extractPage(input(text), client, memoryCache())).toMatchObject({ status: "ok" });
    expect(asked).toEqual(["escalate"]);
  });

  it("defers when the day's allowance is spent, and keeps a base result escalation cannot improve", async () => {
    const spent = fakeClient({ extract: ["quota_exhausted"] });
    expect(await extractPage(input(), spent.client, memoryCache())).toMatchObject({
      status: "deferred",
    });
    const kept = fakeClient({ extract: [extraction(16)], escalate: ["quota_exhausted"] });
    const result = await extractPage(input(), kept.client, memoryCache());
    expect(result).toMatchObject({ status: "ok", model: "granite", escalated: false });
    if (result.status === "ok") expect(result.notes[0]).toContain("kept the base result");
    const broken = fakeClient({ extract: ["provider_error"] });
    expect(await extractPage(input(), broken.client, memoryCache())).toMatchObject({
      status: "failed",
    });
  });

  it("turns a stated weekly night into a rule anchored on tonight, and leaves a dated one alone", () => {
    const weekly = rawExtractionSchema.parse({
      page_kind: "venue_home",
      language: "en",
      listings: [
        {
          title: "Thursday salsa",
          listing_type: "social",
          styles: ["salsa"],
          lesson_time: "20:00",
          recurrence_text: "every Thursday",
          venue: {},
          organizer: {},
        },
      ],
    });
    const [row] = extractionToHarvested(weekly, {
      pageUrl: "https://salsa.example/",
      fetchedAt: new Date("2026-10-01T16:00:00Z"),
      today: "2026-10-01",
    }).listings;
    expect(row?.recurrence?.rrule).toContain("BYDAY=TH");
    expect(row?.recurrence?.dtstartLocal).toBe("2026-10-01T20:00");
    expect(row?.provenance.method).toBe("llm");
    const [dated] = extractionToHarvested(extraction(1), {
      pageUrl: "https://salsa.example/",
      fetchedAt: new Date(),
      today: "2026-10-01",
    }).listings;
    expect(dated?.recurrence).toBeNull();
  });
});

// Keep the outcome type honest for the fake above.
export type _Outcome = AiOutcome<RawExtraction>;

describe("reading a long page in parts (ingest run 17)", () => {
  const block = (label: string, size: number) => `${label}\n${"x".repeat(size - label.length - 1)}`;

  it("cuts at blank lines, keeps every character, and never exceeds the part size", () => {
    const text = [block("A", 400), block("B", 400), block("C", 400)].join("\n\n");
    const parts = splitPageText(text, 900);
    expect(parts).toHaveLength(2);
    expect(parts.every((p) => p.length <= 900)).toBe(true);
    expect(parts.join("\n\n")).toBe(text);
    expect(splitPageText("short", 900)).toEqual(["short"]);
  });

  it("cuts an over-long block at line ends, and an over-long line inside itself", () => {
    const lines = Array.from({ length: 30 }, (_, i) => `line ${i} ${"y".repeat(50)}`).join("\n");
    const parts = splitPageText(lines, 300);
    expect(parts.every((p) => p.length <= 300)).toBe(true);
    expect(parts.join("\n")).toBe(lines);
    const longLine = "z".repeat(1_000);
    expect(splitPageText(longLine, 300).every((p) => p.length <= 300)).toBe(true);
    expect(splitPageText(longLine, 300).join("")).toBe(longLine);
  });

  it("reads each part, joins the listings, and caches the whole page", async () => {
    const { client, asked } = fakeClient({ extract: [extraction(2), extraction(3)] });
    const cache = memoryCache();
    const text = [block("A", 500), block("B", 500)].join("\n\n");
    const result = await extractPageInChunks(input(text), client, cache, { maxChars: 600 });
    expect(asked).toEqual(["extract", "extract"]);
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.extraction.listings).toHaveLength(5);
    expect(result.calls).toHaveLength(2);
    expect(cache.rows.has(`${textKey(text)}/${EXTRACT_PROMPT_VERSION}`)).toBe(true);

    const again = await extractPageInChunks(input(text), client, cache, { maxChars: 600 });
    expect(again).toMatchObject({ status: "ok", cached: true });
    expect(asked).toHaveLength(2);
  });

  it("keeps the parts it read, names the one it could not, and retries only that one", async () => {
    const { client, asked } = fakeClient({ extract: [extraction(2), "provider_error"] });
    const cache = memoryCache();
    const text = [block("A", 500), block("B", 500)].join("\n\n");
    const first = await extractPageInChunks(input(text), client, cache, {
      maxChars: 600,
      concurrency: 1,
    });
    expect(first.status).toBe("ok");
    if (first.status !== "ok") return;
    expect(first.extraction.listings).toHaveLength(2);
    expect(first.notes.join(" ")).toContain("1 of the page's 2 parts could not be read");
    expect(cache.rows.has(`${textKey(text)}/${EXTRACT_PROMPT_VERSION}`)).toBe(false);

    const { client: second, asked: askedAgain } = fakeClient({ extract: [extraction(1)] });
    const retry = await extractPageInChunks(input(text), second, cache, { maxChars: 600 });
    expect(askedAgain).toEqual(["extract"]);
    expect(retry.status === "ok" && retry.extraction.listings).toHaveLength(3);
    expect(asked).toHaveLength(2);
  });

  it("never asks the model about a page with no text, and caches nothing for it", async () => {
    const { client, asked } = fakeClient({ extract: [extraction(0, 0.9, "not_relevant")] });
    const cache = memoryCache();
    for (const text of ["", "  \n\n  "]) {
      expect(await extractPageInChunks(input(text), client, cache)).toEqual({
        status: "failed",
        detail: "the page has no text to read",
        calls: [],
      });
      expect(await extractPage(input(text), client, cache)).toMatchObject({ status: "failed" });
    }
    expect(asked).toEqual([]);
    expect(cache.rows.size).toBe(0);
    // Nothing cached is served for no text either, whatever is cached for the empty text's hash
    // (D-074): runs 22 to 25 sent a 304's page as no text and served what was cached for it.
    await cache.put(textKey(""), EXTRACT_PROMPT_VERSION, {
      extraction: extraction(1),
      model: "granite",
    });
    expect(await extractPageInChunks(input(""), client, cache)).toMatchObject({
      status: "failed",
    });
  });

  it("defers when no part could be read for quota, and fails when none could be read at all", async () => {
    const text = [block("A", 500), block("B", 500)].join("\n\n");
    const deferred = await extractPageInChunks(
      input(text),
      fakeClient({ extract: ["quota_exhausted", "quota_exhausted"] }).client,
      memoryCache(),
      { maxChars: 600 },
    );
    expect(deferred.status).toBe("deferred");
    const failed = await extractPageInChunks(
      input(text),
      fakeClient({ extract: ["provider_error", "provider_error"] }).client,
      memoryCache(),
      { maxChars: 600 },
    );
    expect(failed).toMatchObject({ status: "failed" });
    expect(failed.status !== "ok" && failed.detail).toContain("none of the page's 2 parts");
  });
});

describe("the grammar leaves the reply no room to run on (ingest run 18)", () => {
  type Node = Record<string, unknown>;
  const walk = (node: unknown, visit: (n: Node, key?: string) => void, key?: string): void => {
    if (Array.isArray(node)) return node.forEach((n) => walk(n, visit));
    if (!node || typeof node !== "object") return;
    const n = node as Node;
    visit(n, key);
    if (n.properties) {
      for (const [name, sub] of Object.entries(n.properties as Node)) walk(sub, visit, name);
    }
    for (const k of ["items", "anyOf", "oneOf", "allOf"]) if (n[k]) walk(n[k], visit);
  };

  it("bounds every string and every list, and closes every map", () => {
    walk(EXTRACT_JSON_SCHEMA, (n, key) => {
      const types = Array.isArray(n.type) ? n.type : [n.type];
      if (types.includes("string") && !n.enum) expect(n.maxLength, key).toBeTypeOf("number");
      if (types.includes("array")) expect(n.maxItems, key).toBeTypeOf("number");
      if (n.type === "object") expect(n.additionalProperties, key).not.toBeTypeOf("object");
      if (n.type === "object") expect(n.propertyNames, key).toBeUndefined();
    });
    const listings = (EXTRACT_JSON_SCHEMA.properties as Node).listings as Node;
    expect(listings.maxItems).toBe(EXTRACT_LISTINGS_MAX);
  });

  it("gives evidence and confidence exactly the evidence fields", () => {
    const listing = ((EXTRACT_JSON_SCHEMA.properties as Node).listings as Node).items as Node;
    const props = listing.properties as Node;
    for (const map of ["evidence", "confidence"]) {
      expect(Object.keys((props[map] as Node).properties as Node)).toEqual([...EVIDENCE_FIELDS]);
    }
  });

  it("leaves an existing bound alone", () => {
    expect(boundExtractionSchema({ type: "string", maxLength: 5 })).toEqual({
      type: "string",
      maxLength: 5,
    });
  });
});

describe("the extraction probe (D-055)", () => {
  it("offers the four formats, and only 'bounded' carries lengths", async () => {
    const { probeFormats } = await import("@/src/jobs/ai-probe");
    const formats = probeFormats();
    expect(formats.map((f) => f.name)).toEqual(["bounded", "closed", "open", "none"]);
    const text = (name: string) => JSON.stringify(formats.find((f) => f.name === name)?.schema);
    expect(text("bounded")).toContain("maxLength");
    expect(text("closed")).not.toContain('"maxLength":300');
    expect(text("closed")).not.toContain("propertyNames");
    expect(text("open")).toContain("propertyNames");
    expect(formats.find((f) => f.name === "none")?.schema).toBeNull();
  });
});
