// Anthropic. Implemented in full, switched off by construction.
//
// The owner's instruction for Phase 3 is that paid paths stay in the tree but stay off, so the
// off switch is structural rather than a comment: `isConfigured()` is false unless BOTH
// ANTHROPIC_API_KEY is set AND AI_ENABLE_PAID parses truthy. A key pasted into `.env` by itself
// therefore cannot start spending, and `tests/unit/ai-providers.test.ts` holds that shut.
//
// Structured output uses Anthropic's own mechanism, a single tool whose `input_schema` is the
// job's JSON Schema with `tool_choice` pinned to it, rather than a response_format field.
//
// Only one model ID is recorded. `claude-opus-5` is the ID this repository has seen first hand;
// PLAN section 7 lists Sonnet 5 and Haiku 4.5 prices but not their exact IDs, and CLAUDE.md
// says to read live docs instead of assuming, so the rest must be filled in from the live model
// list at the moment the owner switches the paid path on.

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
  fail,
  guardedSystem,
  parseFlag,
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

export const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
export const ANTHROPIC_VERSION = "2023-06-01";

/** The tool the model is forced to call, so the reply arrives as structured input. */
export const ANTHROPIC_RESULT_TOOL = "emit_result";

/**
 * From the registry, which is the one place a provider's facts are written down. It records
 * `trainsOnInput: true` for Anthropic -- fail-closed, because the data policy was not read -- so
 * untrusted page text stays on the single provider whose refusal to train we have in writing.
 * This file and the registry disagreed about exactly that flag before; they cannot now, and
 * `tests/unit/ai-providers.test.ts` asserts the agreement for all five providers.
 */
export const ANTHROPIC_META: AiProviderMeta = providerMeta("anthropic");

export const ANTHROPIC_MODELS: Readonly<Record<string, AiModel>> = ANTHROPIC_META.models;

/**
 * Both halves of the switch: a key on its own is not enough (D-039, owner's instruction).
 *
 * `enablePaid` is the parsed boolean `src/config/env.ts` produces; `parseFlag` also accepts the
 * raw spellings, for a caller injecting an unparsed environment.
 */
export function anthropicEnabled(
  apiKey: string | undefined,
  enablePaid: string | boolean | undefined,
): boolean {
  return credential(apiKey) !== undefined && parseFlag(enablePaid);
}

export function createAnthropicProvider(options?: ProviderOptions): AiProvider {
  const resolved = resolveProviderOptions(options);
  return {
    meta: ANTHROPIC_META,
    isConfigured(): boolean {
      return anthropicEnabled(resolved.env.ANTHROPIC_API_KEY, resolved.env.AI_ENABLE_PAID);
    },
    estimateCost(job: AiJob, model: AiModel): number {
      return estimateProviderCost(job, model, "request");
    },
    call<T>(request: AiRequest<T>, model: AiModel): Promise<AiOutcome<T>> {
      return callAnthropic(request, model, resolved);
    },
  };
}

async function callAnthropic<T>(
  request: AiRequest<T>,
  model: AiModel,
  options: ResolvedProviderOptions,
): Promise<AiOutcome<T>> {
  const key = credential(options.env.ANTHROPIC_API_KEY);
  if (
    !anthropicEnabled(options.env.ANTHROPIC_API_KEY, options.env.AI_ENABLE_PAID) ||
    key === undefined
  ) {
    return fail(
      "anthropic",
      "disabled",
      "the paid path is off: ANTHROPIC_API_KEY and AI_ENABLE_PAID must both be set",
    );
  }

  // No image branch: the flyer path is out of v1 scope (D-035, answer to Q3) and the client
  // refuses a request carrying images before any provider is chosen.
  const block = untrustedBlock(request.user);
  const content: Record<string, unknown>[] = [{ type: "text", text: block.text }];

  const body = {
    model: model.id,
    // Anthropic requires max_tokens outright; it is still written from the job, like everywhere.
    max_tokens: request.job.maxOutputTokens,
    system: guardedSystem(request.system, block),
    messages: [{ role: "user", content }],
    tools: [
      {
        name: ANTHROPIC_RESULT_TOOL,
        description: request.job.description,
        input_schema: request.jsonSchema,
      },
    ],
    tool_choice: { type: "tool", name: ANTHROPIC_RESULT_TOOL },
  };

  const outcome = await requestJson(
    ANTHROPIC_MESSAGES_URL,
    {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": ANTHROPIC_VERSION,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    },
    options,
  );
  const secrets = [key];

  if (outcome.kind === "transport") {
    return fail("anthropic", "provider_error", sanitizeDetail(outcome.detail, secrets));
  }
  if (outcome.status === 429) {
    return fail("anthropic", "quota_exhausted", "HTTP 429: rate or spend limit reached");
  }
  if (outcome.status !== 200) {
    const type = readString(readAt(outcome.body, "error", "type"));
    const message = readString(readAt(outcome.body, "error", "message")) ?? "no message";
    return fail(
      "anthropic",
      "provider_error",
      sanitizeDetail(
        `HTTP ${outcome.status}${type === null ? "" : ` ${type}`}: ${message}`,
        secrets,
        request.user,
      ),
    );
  }

  const inputTokens =
    readCount(readAt(outcome.body, "usage", "input_tokens")) ?? request.job.estimatedInputTokens;
  const outputTokens = readCount(readAt(outcome.body, "usage", "output_tokens")) ?? 0;
  const usage = requestUsage(inputTokens, outputTokens);

  if (readString(readAt(outcome.body, "stop_reason")) === "max_tokens") {
    return fail(
      "anthropic",
      "truncated",
      `stop_reason max_tokens at ${request.job.maxOutputTokens} output tokens`,
    );
  }

  const payload = anthropicToolInput(outcome.body);
  if (payload === undefined) {
    return fail(
      "anthropic",
      "provider_error",
      `reply carried no ${ANTHROPIC_RESULT_TOOL} tool call`,
    );
  }
  return decodeResult("anthropic", model.id, payload, request.schema, usage);
}

/** The forced tool call's `input`, which is already parsed JSON. */
function anthropicToolInput(body: unknown): unknown {
  for (const block of asArray(readAt(body, "content")) ?? []) {
    const record = asRecord(block);
    if (record?.type === "tool_use" && record.name === ANTHROPIC_RESULT_TOOL) return record.input;
  }
  return undefined;
}

/** The adapter bound to the process environment. */
export const anthropicProvider: AiProvider = createAnthropicProvider();
