// Google AI Studio (Gemini), on the native REST endpoint.
//
// What the 2026-09-22 survey could and could not establish, and how that shows up below:
//   - Model IDs are live-verified from Google's own codegen_instructions.md in
//     googleapis/js-genai@main, so they are hard-coded here.
//   - Rate limits could NOT be read: ai.google.dev is blocked by this environment's egress proxy
//     and third-party mirrors contradict each other by 6x (250 vs 1,500 requests a day for the
//     same model class), with one claiming Google no longer publishes free-tier figures outside
//     each project's AI Studio console. `quota.perDay` is therefore null and `verification` is
//     "unverified"; the ledger must treat a 429 here as the only real signal.
//   - Free-tier content is reported to be used to improve Google's products, so `trainsOnInput`
//     is true until the owner confirms otherwise from the console. That alone keeps extraction
//     and escalation away from Gemini (types.ts `routableFor`), whatever the configured order
//     says. Gemini stays first for jobs that send only our own structured facts.
//
// Context windows were not part of the survey, so they are recorded as UNVERIFIED_CONTEXT_WINDOW
// rather than guessed; see the note on that constant.

import type {
  AiJob,
  AiModel,
  AiOutcome,
  AiProvider,
  AiProviderMeta,
  AiRequest,
} from "@/src/ai/types";
import { providerMeta } from "@/src/ai/registry";
import {
  asArray,
  asRecord,
  credential,
  decodeResult,
  estimateProviderCost,
  estimateTokens,
  fail,
  guardedSystem,
  isTruncationReason,
  readAt,
  readCount,
  readString,
  requestJson,
  requestUsage,
  resolveProviderOptions,
  sanitizeDetail,
  untrustedBlock,
  type ProviderOptions,
  type ResolvedProviderOptions,
} from "@/src/ai/providers/index";

export const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

/** Live-verified IDs. Google's own guidance names 2.5-flash-lite the high-volume, low-latency one. */
export const GEMINI_MODEL_IDS = [
  "gemini-3-flash-preview",
  "gemini-3-pro-preview",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-3.5-flash-lite",
  "gemini-2.5-pro",
  "gemini-2.0-flash",
  "gemini-2.0-flash-lite",
] as const;

export const GEMINI_HIGH_VOLUME_MODEL_ID = "gemini-3.5-flash-lite";

/**
 * The metadata and the model table come from `src/ai/registry.ts`, which is the single place any
 * provider's facts are written down. This file used to keep a second copy of both.
 */
export const GEMINI_META: AiProviderMeta = providerMeta("gemini");

export const GEMINI_MODELS: Readonly<Record<string, AiModel>> = GEMINI_META.models;

export function geminiEndpoint(modelId: string): string {
  return `${GEMINI_BASE_URL}/models/${encodeURIComponent(modelId)}:generateContent`;
}

/**
 * Gemini's responseSchema takes an OpenAPI subset, so the job's JSON Schema is filtered down to
 * the keywords it accepts. Anything else (`$schema`, `additionalProperties`, `definitions`, ...)
 * is dropped rather than sent, because an unknown keyword is rejected outright.
 */
const GEMINI_SCHEMA_KEYS = new Set([
  "type",
  "format",
  "description",
  "nullable",
  "enum",
  "maxItems",
  "minItems",
  "properties",
  "required",
  "items",
  "propertyOrdering",
  "anyOf",
]);

export function toGeminiSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map((entry) => toGeminiSchema(entry));
  const record = asRecord(schema);
  if (record === null) return schema;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (!GEMINI_SCHEMA_KEYS.has(key)) continue;
    if (key === "properties") {
      const properties = asRecord(value);
      if (properties === null) continue;
      out.properties = Object.fromEntries(
        Object.entries(properties).map(([name, child]) => [name, toGeminiSchema(child)]),
      );
      continue;
    }
    out[key] = key === "items" || key === "anyOf" ? toGeminiSchema(value) : value;
  }
  return out;
}

export function createGeminiProvider(options?: ProviderOptions): AiProvider {
  const resolved = resolveProviderOptions(options);
  return {
    meta: GEMINI_META,
    isConfigured(): boolean {
      return credential(resolved.env.GEMINI_API_KEY) !== undefined;
    },
    estimateCost(job: AiJob, model: AiModel): number {
      return estimateProviderCost(job, model, "request");
    },
    call<T>(request: AiRequest<T>, model: AiModel): Promise<AiOutcome<T>> {
      return callGemini(request, model, resolved);
    },
  };
}

async function callGemini<T>(
  request: AiRequest<T>,
  model: AiModel,
  options: ResolvedProviderOptions,
): Promise<AiOutcome<T>> {
  const key = credential(options.env.GEMINI_API_KEY);
  if (key === undefined) return fail("gemini", "disabled", "GEMINI_API_KEY is not set");

  // No image branch: the flyer path is out of v1 scope (D-035, answer to Q3) and the client
  // refuses a request carrying images before any provider is chosen.
  const block = untrustedBlock(request.user);

  const body = {
    systemInstruction: { parts: [{ text: guardedSystem(request.system, block) }] },
    contents: [{ role: "user", parts: [{ text: block.text }] }],
    generationConfig: {
      // Gemini's name for the same ceiling. Always from the job, never a vendor default.
      maxOutputTokens: request.job.maxOutputTokens,
      responseMimeType: "application/json",
      responseSchema: toGeminiSchema(request.jsonSchema),
    },
  };

  const outcome = await requestJson(
    geminiEndpoint(model.id),
    {
      method: "POST",
      headers: { "x-goog-api-key": key, "content-type": "application/json" },
      body: JSON.stringify(body),
    },
    options,
  );
  const secrets = [key];

  if (outcome.kind === "transport") {
    return fail("gemini", "provider_error", sanitizeDetail(outcome.detail, secrets));
  }
  if (outcome.status === 429) {
    return fail("gemini", "quota_exhausted", "HTTP 429: free-tier request allowance spent");
  }
  if (outcome.status !== 200) {
    const status = readString(readAt(outcome.body, "error", "status"));
    const message = readString(readAt(outcome.body, "error", "message")) ?? "no message";
    return fail(
      "gemini",
      "provider_error",
      sanitizeDetail(
        `HTTP ${outcome.status}${status === null ? "" : ` ${status}`}: ${message}`,
        secrets,
        request.user,
      ),
    );
  }

  const candidate = asRecord((asArray(readAt(outcome.body, "candidates")) ?? [])[0]);
  const inputTokens =
    readCount(readAt(outcome.body, "usageMetadata", "promptTokenCount")) ??
    request.job.estimatedInputTokens;
  const text = geminiText(candidate);
  const outputTokens =
    readCount(readAt(outcome.body, "usageMetadata", "candidatesTokenCount")) ??
    estimateTokens(text ?? "");
  const usage = requestUsage(inputTokens, outputTokens);

  const finishReason = readString(candidate?.finishReason);
  if (isTruncationReason(finishReason)) {
    return fail(
      "gemini",
      "truncated",
      `finishReason ${finishReason} at ${request.job.maxOutputTokens} output tokens`,
    );
  }
  if (text === null) {
    return fail(
      "gemini",
      "provider_error",
      `reply carried no text part${finishReason === null ? "" : ` (finishReason ${finishReason})`}`,
    );
  }
  return decodeResult("gemini", model.id, text, request.schema, usage);
}

/** `candidates[0].content.parts[*].text`, joined; a candidate may split JSON across parts. */
function geminiText(candidate: Record<string, unknown> | null): string | null {
  const parts = asArray(readAt(candidate, "content", "parts"));
  if (parts === null) return null;
  const chunks: string[] = [];
  for (const part of parts) {
    const text = readString(asRecord(part)?.text);
    if (text !== null) chunks.push(text);
  }
  return chunks.length === 0 ? null : chunks.join("");
}

/** The adapter bound to the process environment. */
export const geminiProvider: AiProvider = createGeminiProvider();
