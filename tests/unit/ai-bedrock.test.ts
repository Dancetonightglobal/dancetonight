import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { createBedrockProvider, bedrockEnabled } from "@/src/ai/providers/bedrock";
import { BEDROCK_REGION, DEEPSEEK_V3_2 } from "@/src/ai/registry";
import type { AiModel, AiJob, AiRequest } from "@/src/ai/types";
import type { AiEnv } from "@/src/ai/providers/index";
import { parseEnv } from "@/src/config/env";

const SECRET = "SECRETTEST";
const ACCESS_KEY = "AKIDTEST";

function envWith(overrides: Partial<AiEnv> = {}): AiEnv {
  return {
    ...parseEnv({ PUBLIC_BASE_URL: "https://dancetonight.example" }),
    BEDROCK_ACCESS_KEY_ID: ACCESS_KEY,
    BEDROCK_SECRET_ACCESS_KEY: SECRET,
    AI_ENABLE_PAID: true,
    ...overrides,
  };
}

const PAGE_TEXT = "Frim Fram Jam, Thursdays at 8pm.";

function makeJob(overrides: Partial<AiJob> = {}): AiJob {
  return {
    id: "extract",
    sendsUntrustedText: true,
    maxOutputTokens: 4_096,
    estimatedInputTokens: 1_200,
    description: "Extract listings from a cleaned page",
    ...overrides,
  };
}

function makeRequest<T>(overrides: Partial<AiRequest<T>> = {}): AiRequest<T> {
  const resultSchema = z.object({
    page_kind: z.string(),
    listings: z.array(z.object({ title: z.string() })),
  });
  return {
    job: makeJob(),
    system: "You extract dance listings.",
    user: PAGE_TEXT,
    schema: resultSchema as unknown as z.ZodType<T>,
    jsonSchema: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      additionalProperties: false,
      properties: { page_kind: { type: "string" }, listings: { type: "array" } },
      required: ["page_kind", "listings"],
    },
    ...overrides,
  } as AiRequest<T>;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

type Stub = ReturnType<typeof vi.fn> & FetchLike;
type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

function stubOnce(response: Response | (() => Response)): Stub {
  return vi.fn(async () =>
    typeof response === "function" ? response() : response.clone(),
  ) as unknown as Stub;
}

function sentBody(stub: Stub, index = 0): Record<string, unknown> {
  const call = stub.mock.calls[index] as [string, RequestInit] | undefined;
  if (call === undefined) throw new Error(`no fetch call at index ${index}`);
  return JSON.parse(String(call[1].body)) as Record<string, unknown>;
}

function sentUrl(stub: Stub, index = 0): string {
  const call = stub.mock.calls[index] as [string, RequestInit] | undefined;
  if (call === undefined) throw new Error(`no fetch call at index ${index}`);
  return call[0];
}

function sentHeaders(stub: Stub, index = 0): Record<string, string> {
  const call = stub.mock.calls[index] as [string, RequestInit] | undefined;
  if (call === undefined) throw new Error(`no fetch call at index ${index}`);
  return call[1].headers as Record<string, string>;
}

const GOOD_RESULT = { page_kind: "list", listings: [{ title: "Frim Fram Jam" }] };
const GOOD_JSON = JSON.stringify(GOOD_RESULT);

describe("bedrock", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("bedrockEnabled", () => {
    it("is false with no keys", () => {
      expect(bedrockEnabled(undefined, undefined, true)).toBe(false);
      expect(bedrockEnabled("", "", true)).toBe(false);
    });
    it("is false with keys but AI_ENABLE_PAID false", () => {
      expect(bedrockEnabled(ACCESS_KEY, SECRET, false)).toBe(false);
      expect(bedrockEnabled(ACCESS_KEY, SECRET, "false")).toBe(false);
    });
    it("is true with both keys and AI_ENABLE_PAID true", () => {
      expect(bedrockEnabled(ACCESS_KEY, SECRET, true)).toBe(true);
      expect(bedrockEnabled(ACCESS_KEY, SECRET, "true")).toBe(true);
    });
  });

  describe("createBedrockProvider", () => {
    it("isConfigured returns false when keys missing", () => {
      const provider = createBedrockProvider({
        env: envWith({ BEDROCK_ACCESS_KEY_ID: undefined, BEDROCK_SECRET_ACCESS_KEY: undefined }),
      });
      expect(provider.isConfigured()).toBe(false);
    });
    it("isConfigured returns true when keys and flag present", () => {
      const provider = createBedrockProvider({ env: envWith() });
      expect(provider.isConfigured()).toBe(true);
    });
  });

  describe("call", () => {
    const model: AiModel = {
      id: DEEPSEEK_V3_2,
      contextWindow: 0,
      neuronsPerMillionInput: null,
      neuronsPerMillionOutput: null,
      usdPerMillionInput: 0.62,
      usdPerMillionOutput: 1.85,
      supportsJsonSchema: false,
      supportsVision: false,
    };

    it("returns disabled when not configured", async () => {
      const stub = stubOnce(json({}));
      const provider = createBedrockProvider({
        env: envWith({ BEDROCK_ACCESS_KEY_ID: undefined, BEDROCK_SECRET_ACCESS_KEY: undefined }),
        fetch: stub,
      });
      const outcome = await provider.call(makeRequest(), model);
      expect(outcome.ok).toBe(false);
      if (outcome.ok) return;
      expect(outcome.reason).toBe("disabled");
      expect(stub.mock.calls).toHaveLength(0);
    });

    it("sends a signed request to the correct URL", async () => {
      const stub = stubOnce(
        json({
          output: { message: { role: "assistant", content: [{ text: GOOD_JSON }] } },
          stopReason: "end_turn",
          usage: { inputTokens: 1000, outputTokens: 200 },
        }),
      );
      const provider = createBedrockProvider({ env: envWith(), fetch: stub });
      const outcome = await provider.call(makeRequest(), model);
      expect(sentUrl(stub)).toBe(
        `https://bedrock-runtime.${BEDROCK_REGION}.amazonaws.com/model/${DEEPSEEK_V3_2}/converse`,
      );
      const body = sentBody(stub);
      expect((body.inferenceConfig as { maxTokens: number }).maxTokens).toBe(
        makeRequest().job.maxOutputTokens,
      );
      const headers = sentHeaders(stub);
      expect(headers.authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIDTEST\//);
      expect(headers["x-amz-date"]).toBeDefined();
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      expect(outcome.provider).toBe("bedrock");
      expect(outcome.usage.unit).toBe("microdollar");
      // 1,000 x $0.62/M + 200 x $1.85/M = $0.00099 = 990 microdollars.
      expect(outcome.usage.cost).toBeCloseTo(990, 6);
    });

    it("maps stopReason max_tokens to truncated", async () => {
      const stub = stubOnce(
        json({
          output: { message: { role: "assistant", content: [{ text: "{" }] } },
          stopReason: "max_tokens",
          usage: { inputTokens: 1000, outputTokens: 4096 },
        }),
      );
      const provider = createBedrockProvider({ env: envWith(), fetch: stub });
      const outcome = await provider.call(makeRequest(), model);
      expect(outcome.ok).toBe(false);
      if (outcome.ok) return;
      expect(outcome.reason).toBe("truncated");
    });

    it("maps HTTP 429 to quota_exhausted", async () => {
      const stub = stubOnce(json({ message: "Throttled" }, 429));
      const provider = createBedrockProvider({ env: envWith(), fetch: stub });
      const outcome = await provider.call(makeRequest(), model);
      expect(outcome.ok).toBe(false);
      if (outcome.ok) return;
      expect(outcome.reason).toBe("quota_exhausted");
    });

    it("redacts secrets from error details", async () => {
      const stub = stubOnce(json({ message: `not authorized ${SECRET} key ${ACCESS_KEY}` }, 403));
      const provider = createBedrockProvider({ env: envWith(), fetch: stub });
      const outcome = await provider.call(makeRequest(), model);
      expect(outcome.ok).toBe(false);
      if (outcome.ok) return;
      expect(outcome.detail).not.toContain(SECRET);
      expect(outcome.detail).not.toContain(ACCESS_KEY);
      expect(outcome.detail).toContain("[redacted]");
    });

    it("estimates cost correctly", () => {
      const provider = createBedrockProvider({ env: envWith() });
      const job = makeJob();
      const cost = provider.estimateCost(job, model);
      const expected = job.estimatedInputTokens * 0.62 + job.maxOutputTokens * 1.85;
      expect(cost).toBeCloseTo(expected, 6);
      expect(cost).toBeGreaterThan(1_000); // microdollars, not dollars
    });

    it("uses inference profile ARN when set", async () => {
      const profileArn =
        "arn:aws:bedrock:us-east-1:123456789012:application-inference-profile/abc123";
      const stub = stubOnce(
        json({
          output: { message: { role: "assistant", content: [{ text: GOOD_JSON }] } },
          stopReason: "end_turn",
          usage: { inputTokens: 1000, outputTokens: 200 },
        }),
      );
      const provider = createBedrockProvider({
        env: envWith({ BEDROCK_INFERENCE_PROFILE_ARN: profileArn }),
        fetch: stub,
      });
      const outcome = await provider.call(makeRequest(), model);
      expect(sentUrl(stub)).toBe(
        `https://bedrock-runtime.${BEDROCK_REGION}.amazonaws.com/model/${encodeURIComponent(profileArn)}/converse`,
      );
      const headers = sentHeaders(stub);
      expect(headers.authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=/);
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      expect(outcome.usage.unit).toBe("microdollar");
    });

    it("rejects invalid inference profile ARN", async () => {
      const stub = stubOnce(json({}));
      const provider = createBedrockProvider({
        env: envWith({ BEDROCK_INFERENCE_PROFILE_ARN: "not-an-arn" }),
        fetch: stub,
      });
      const outcome = await provider.call(makeRequest(), model);
      expect(stub.mock.calls).toHaveLength(0);
      expect(outcome.ok).toBe(false);
      if (outcome.ok) return;
      expect(outcome.reason).toBe("provider_error");
      expect(outcome.detail).not.toContain("not-an-arn");
      expect(outcome.detail).toContain("BEDROCK_INFERENCE_PROFILE_ARN");
    });
  });
});
