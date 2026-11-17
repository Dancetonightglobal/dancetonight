// Cloudflare Workers AI.
//
// The only provider in the chain whose terms forbid training on what we send, quoted from
// cloudflare/cloudflare-docs@production on 2026-09-22: "Cloudflare does not use your Customer
// Content to (1) train any AI models made available on Workers AI or (2) improve any Cloudflare
// or third-party services." There is no free-tier carve-out, so extraction and escalation, which
// carry other people's page text, go here and nowhere else (types.ts rule 2, D-039).
//
// Two facts from the same survey shape the code:
//   - The free allocation is "a total of 10,000 Neurons per day at no charge", shared across
//     every model and task type, reset at 00:00 UTC, with no accumulation. Running out is a hard
//     stop (error 3036 / HTTP 429), not a throttle, so 3036 maps to `quota_exhausted` and is
//     never retried.
//   - The catalog JSON carries "max_tokens":{"type":"integer","default":256}. A call left on
//     that default comes back as truncated, unparseable JSON on essentially every page, so
//     `max_tokens` is always written from the job. `tests/unit/ai-providers.test.ts` holds that
//     line for all five adapters.
//
// JSON mode here is documented as best effort ("Workers AI can't guarantee that the model
// responds according to the requested JSON Schema"), which is why every reply goes through the
// caller's zod schema whatever the response_format asked for.

import type {
  AiModel,
  AiOutcome,
  AiProvider,
  AiProviderMeta,
  AiRequest,
  AiJob,
} from "@/src/ai/types";
import {
  CLOUDFLARE_REQUESTS_PER_MINUTE as REGISTRY_CLOUDFLARE_RPM,
  providerMeta,
} from "@/src/ai/registry";
import {
  asArray,
  asRecord,
  credential,
  decodeResult,
  estimateProviderCost,
  fail,
  guardedSystem,
  isTruncationReason,
  neuronUsage,
  readAt,
  readCount,
  readString,
  requestJson,
  resolveProviderOptions,
  sanitizeDetail,
  stripCodeFence,
  estimateTokens,
  untrustedBlock,
  type ProviderOptions,
  type ResolvedProviderOptions,
} from "@/src/ai/providers/index";

// ---------------------------------------------------------------------------------------------
// Facts about this provider come from `src/ai/registry.ts` and from nowhere else.
//
// This file used to carry its own copy of the model table, the neuron rates and the quota, and
// the copies had drifted apart: the registry recorded `supportsJsonSchema: false` for
// @cf/google/gemma-4-26b-a4b-it (response_format is not listed for it; only function_calling is)
// while this file recorded true, so escalation would have asked for a mode the model does not
// document. The registry is the single source of truth and these are re-exports of it, kept
// because callers and tests already use these names.

/** Cloudflare's verified free allocation: 10,000 neurons per account per day, reset 00:00 UTC. */
export { CLOUDFLARE_NEURONS_PER_DAY, CLOUDFLARE_NEURON_RATES } from "@/src/ai/registry";
export type { CloudflareNeuronRate } from "@/src/ai/registry";

/** Text generation's own ceiling. Our modelled ~120 calls a day never approaches it. */
export const CLOUDFLARE_REQUESTS_PER_MINUTE = REGISTRY_CLOUDFLARE_RPM;

/** Cloudflare's own error code for a spent allocation; it arrives with HTTP 429. */
export const CLOUDFLARE_QUOTA_ERROR_CODE = 3036;

export const CLOUDFLARE_META: AiProviderMeta = providerMeta("cloudflare");

/** The model table, from the registry. Wider than the router uses: it prices as well as routes. */
export const CLOUDFLARE_MODELS: Readonly<Record<string, AiModel>> = CLOUDFLARE_META.models;

export function cloudflareEndpoint(accountId: string, modelId: string): string {
  return `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/run/${modelId}`;
}

/**
 * Workers AI calls get two minutes, not the shared 30 s: extraction writes one JSON object per
 * listing with evidence quotes, and a list page's reply takes over a minute under constrained
 * decoding. Ingest run 15 timed out on 15 of 19 pages at 30 s.
 */
export const CLOUDFLARE_TIMEOUT_MS = 120_000;

export function createCloudflareProvider(options?: ProviderOptions): AiProvider {
  const resolved = resolveProviderOptions({
    ...options,
    timeoutMs: options?.timeoutMs ?? CLOUDFLARE_TIMEOUT_MS,
  });
  return {
    meta: CLOUDFLARE_META,
    isConfigured(): boolean {
      return (
        credential(resolved.env.CLOUDFLARE_ACCOUNT_ID) !== undefined &&
        credential(resolved.env.CLOUDFLARE_AI_TOKEN) !== undefined
      );
    },
    estimateCost(job: AiJob, model: AiModel): number {
      return estimateProviderCost(job, model, "neuron");
    },
    call<T>(request: AiRequest<T>, model: AiModel): Promise<AiOutcome<T>> {
      return callCloudflare(request, model, resolved);
    },
  };
}

async function callCloudflare<T>(
  request: AiRequest<T>,
  model: AiModel,
  options: ResolvedProviderOptions,
): Promise<AiOutcome<T>> {
  const accountId = credential(options.env.CLOUDFLARE_ACCOUNT_ID);
  const token = credential(options.env.CLOUDFLARE_AI_TOKEN);
  if (accountId === undefined || token === undefined) {
    return fail(
      "cloudflare",
      "disabled",
      "CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_AI_TOKEN are not both set",
    );
  }
  if (request.images !== undefined && request.images.length > 0) {
    // Out of scope for version 1, not unimplemented by oversight. D-035, answer to Q3: "no flyer
    // uploads in version 1 ... The flyer path of /submit (image upload) is out of v1 scope; URL
    // and pasted-text submissions stay." `src/ai/client.ts` refuses such a request before any
    // provider is reached; this is the backstop for a caller that builds an adapter directly.
    return fail(
      "cloudflare",
      "disabled",
      "image input is out of scope for version 1 (D-035): send a URL or pasted text",
    );
  }

  const block = untrustedBlock(request.user);
  const body: Record<string, unknown> = {
    messages: [
      { role: "system", content: guardedSystem(request.system, block) },
      { role: "user", content: block.text },
    ],
    // Never the vendor default of 256: that is the truncation bug this adapter exists to avoid.
    max_tokens: request.job.maxOutputTokens,
  };
  if (model.supportsJsonSchema) {
    body.response_format = {
      type: "json_schema",
      json_schema: grammarSafeSchema(request.jsonSchema),
    };
  }

  const outcome = await requestJson(
    cloudflareEndpoint(accountId, model.id),
    {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    },
    options,
  );
  const secrets = [token, accountId];

  if (outcome.kind === "transport") {
    return fail("cloudflare", "provider_error", sanitizeDetail(outcome.detail, secrets));
  }

  const errorCodes = cloudflareErrorCodes(outcome.body);
  if (outcome.status === 429 || errorCodes.includes(CLOUDFLARE_QUOTA_ERROR_CODE)) {
    return fail(
      "cloudflare",
      "quota_exhausted",
      `daily neuron allocation spent (HTTP ${outcome.status}${errorCodes.length > 0 ? `, error ${errorCodes[0]}` : ""})`,
    );
  }
  if (outcome.status !== 200 || readAt(outcome.body, "success") === false) {
    return fail(
      "cloudflare",
      "provider_error",
      sanitizeDetail(
        `HTTP ${outcome.status}${errorCodes.length > 0 ? `, error ${errorCodes[0]}` : ""}: ${cloudflareErrorMessage(outcome.body) ?? "no message"}`,
        secrets,
        request.user,
      ),
    );
  }

  const result = readAt(outcome.body, "result");
  const inputTokens =
    readCount(readAt(result, "usage", "prompt_tokens")) ?? request.job.estimatedInputTokens;
  const payload = cloudflarePayload(result);
  const outputTokens =
    readCount(readAt(result, "usage", "completion_tokens")) ??
    estimateTokens(typeof payload === "string" ? payload : JSON.stringify(payload ?? ""));
  const usage = neuronUsage(model, inputTokens, outputTokens);

  const finishReason = readString(readAt(result, "finish_reason"));
  if (isTruncationReason(finishReason)) {
    return fail(
      "cloudflare",
      "truncated",
      `finish_reason ${finishReason} at ${request.job.maxOutputTokens} output tokens`,
      usage,
    );
  }
  if (payload === null) {
    return fail(
      "cloudflare",
      "provider_error",
      `reply carried no response field (result keys: ${replyShape(result)})`,
    );
  }

  const decoded = decodeResult("cloudflare", model.id, payload, request.schema, usage);
  if (
    !decoded.ok &&
    decoded.reason === "schema_mismatch" &&
    outputTokens >= request.job.maxOutputTokens
  ) {
    // No finish reason, but the reply filled the ceiling exactly and then failed to parse: that
    // is the 256-token truncation signature, and the caller retries it differently.
    return fail(
      "cloudflare",
      "truncated",
      `reply filled the ${request.job.maxOutputTokens}-token ceiling`,
    );
  }
  return decoded;
}

/** `{ result: { response: ... } }`; JSON mode may hand back an object rather than a string. */
/**
 * Workers AI answers in two shapes: the classic `{ response }`, and the OpenAI-compatible
 * `{ choices: [{ message: { content } }] }` that newer models such as granite-4.0 return
 * (ingest run 13's key check got the second and read it as "no response field").
 */
function cloudflarePayload(result: unknown): unknown {
  const response = readAt(result, "response");
  if (typeof response === "string") return stripCodeFence(response);
  if (response !== undefined && response !== null) return response;
  const choice = asArray(readAt(result, "choices"))?.[0];
  const content = readAt(choice, "message", "content");
  if (typeof content === "string") return stripCodeFence(content);
  if (content !== undefined && content !== null) return content;
  return null;
}

/** The top-level keys of a reply we could not read, for the error message (never values). */
function replyShape(result: unknown): string {
  const record = asRecord(result);
  return record ? Object.keys(record).sort().join(", ") || "none" : typeof result;
}

/**
 * The JSON Schema keywords we send to Workers AI's constrained decoding: an allowlist, because its
 * grammar compiler rejects anything it has not implemented and the rejections arrive one per run.
 * Run 13 failed every extraction on `format: "uri"` (from `z.url()`), run 14 on `propertyNames`
 * (from `z.record()`). Kept: structure (type, properties, required, items, additionalProperties,
 * anyOf and friends, enum, const) and simple bounds. Dropped: everything else, including
 * `format`, `pattern`, `propertyNames`, `default` and `$schema`. Nothing the schema promised is
 * lost, because the reply is validated with zod against the full schema afterwards.
 */
export const GRAMMAR_KEYWORDS: ReadonlySet<string> = new Set([
  "type",
  "properties",
  "required",
  "additionalProperties",
  "items",
  "prefixItems",
  "minItems",
  "maxItems",
  "enum",
  "const",
  "anyOf",
  "oneOf",
  "allOf",
  "$ref",
  "$defs",
  "definitions",
  "minLength",
  "maxLength",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "description",
]);

/** Keywords whose value maps property names to schemas: the names are data, not keywords. */
const NAME_MAPS = new Set(["properties", "$defs", "definitions"]);

export function grammarSafeSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(grammarSafeSchema);
  const record = asRecord(schema);
  if (!record) return schema;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (!GRAMMAR_KEYWORDS.has(key)) continue;
    if (NAME_MAPS.has(key)) {
      const names = asRecord(value);
      if (!names) continue;
      out[key] = Object.fromEntries(
        Object.entries(names).map(([name, sub]) => [name, grammarSafeSchema(sub)]),
      );
    } else {
      out[key] = grammarSafeSchema(value);
    }
  }
  return out;
}

function cloudflareErrorCodes(body: unknown): number[] {
  const errors = asArray(readAt(body, "errors")) ?? [];
  const codes: number[] = [];
  for (const entry of errors) {
    const code = asRecord(entry)?.code;
    if (typeof code === "number") codes.push(code);
  }
  return codes;
}

function cloudflareErrorMessage(body: unknown): string | null {
  const errors = asArray(readAt(body, "errors")) ?? [];
  for (const entry of errors) {
    const message = readString(asRecord(entry)?.message);
    if (message !== null) return message;
  }
  return null;
}

/** The adapter bound to the process environment. */
export const cloudflareProvider: AiProvider = createCloudflareProvider();
