// The provider registry: what each vendor allows, what it meters, and what it costs.
//
// Everything in this file is transcribed from the free-tier survey of 2026-09-22 (SOURCES.md).
// Nothing here is recalled from training data, because every free tier in it has changed within
// the last few months. Where the survey could not verify a figure, the field says so -- either
// `perDay: null` with `verification: "unverified"`, or `CONTEXT_WINDOW_UNVERIFIED` -- rather than
// carrying a plausible number that a router would then trust.
//
// WHY THE UNTRUSTED-TEXT CHAIN IS NOT THE OWNER'S ORDER. The owner asked for Gemini, then Groq,
// then OpenRouter. That order stands for every job that sends only our own validated facts. It
// cannot stand for `extract`, `escalate` and `submission`, which send other people's page text
// (~1,240 pages per metro-month). Of the four free providers only Cloudflare states, without a
// free-tier carve-out, that it does not train on Customer Content. Gemini's free tier is reported
// to feed Google's products; OpenRouter's free catalogue is unreachable unless the account opts
// into endpoints that may train on and publish prompts; Groq's free-tier data policy could not be
// read at all, and an unread policy is treated as the worse case. So `trainsOnInput` is true for
// those three, `routableFor()` drops them from the untrusted jobs, and deferral is the only
// fallback once Cloudflare's daily neurons are gone. This is a terms constraint the code enforces,
// not a preference we are substituting for the owner's.

import {
  AI_PROVIDER_IDS,
  type AiJobId,
  type AiModel,
  type AiProviderId,
  type AiProviderMeta,
} from "@/src/ai/types";

/**
 * `AiModel.contextWindow` when no context figure survived verification.
 *
 * ZERO MEANS UNKNOWN, NOT "ZERO CAPACITY". It used to be read as the latter, and the cost of that
 * reading was the whole point of the module: every Gemini, OpenRouter and Anthropic model carries
 * this value, so a `tokens <= contextWindow` test silently rejected all of them and the owner's
 * preferred chain could never run at all. `fitsContextWindow()` therefore gates on the window only
 * when it is greater than zero, and logs once per model that the limit is unknown.
 *
 * Fail-safe still applies where it belongs: a model whose specs we could not read is kept out of
 * the DEFAULT_MODEL_IDS table below, which is what actually decides where a job goes.
 */
export const CONTEXT_WINDOW_UNVERIFIED = 0;

// ----------------------------------------------------------------------------------------------
// Cloudflare Workers AI
//
// Free allocation, quoted from cloudflare/cloudflare-docs@production: "Our free allocation allows
// anyone to use a total of 10,000 Neurons per day at no charge." Shared across every model and
// task type, reset at 00:00 UTC, no accumulation. Exhaustion is a hard stop -- error 3036 with
// HTTP 429 -- not a throttle, which is why the pipeline defers rather than retrying.
//
// Data policy, quoted, unconditional, with no free-tier carve-out: "Cloudflare does not use your
// Customer Content to (1) train any AI models made available on Workers AI or (2) improve any
// Cloudflare or third-party services."
//
// REST: POST https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/run/{model}
//       Authorization: Bearer {token}
//
// TWO TRAPS, both verified from the catalogue JSON and the docs:
//  1. "max_tokens":{"type":"integer","default":256}. A call left on that default returns truncated,
//     unparseable JSON on essentially every page. The contract makes `maxOutputTokens` mandatory
//     precisely so no caller can forget; the HTTP client must send it on every request.
//  2. JSON mode is documented as best effort: "Workers AI can't guarantee that the model responds
//     according to the requested JSON Schema." `supportsJsonSchema` below means "the model accepts
//     response_format", never "the reply will validate". Always validate, then retry.

/**
 * Quoted from the docs: "a total of 10,000 Neurons per day at no charge". This is the vendor's
 * figure and the only free allowance anyone verified; our own daily ceiling sits below it
 * (`DEFAULT_DAILY_NEURON_BUDGET` in src/ai/ledger.ts, 9,000) so we stop before the vendor does.
 */
export const CLOUDFLARE_NEURONS_PER_DAY = 10_000;

/** Text generation's own ceiling. Our modelled ~120 calls a day never approaches it. */
export const CLOUDFLARE_REQUESTS_PER_MINUTE = 300;

const CLOUDFLARE_MODELS: Record<string, AiModel> = {
  // Cheapest verified rates in the catalogue. Default for extraction and for the small jobs.
  // It accepts response_format, but under a JSON Schema its constrained decoding runs on to the
  // token ceiling (ai-probe, 2026-09-28: a three-event page filled 3,000 tokens under every schema
  // tried, bounded or open, and answered in 28 s without one). So it is treated as not supporting
  // a schema: the prompt asks for JSON and zod validates the reply (D-056).
  "@cf/ibm-granite/granite-4.0-h-micro": {
    id: "@cf/ibm-granite/granite-4.0-h-micro",
    contextWindow: 131_000,
    neuronsPerMillionInput: 1_542,
    neuronsPerMillionOutput: 10_158,
    supportsJsonSchema: false,
    supportsVision: false,
  },

  // 256k context and vision, which the flyer path needs, and far cheaper than llama-3.3-70b at our
  // token mix. Default for escalation and submissions. response_format is NOT listed for this
  // model (only function_calling is), so `supportsJsonSchema` stays false and the caller asks for
  // JSON in the prompt and validates the reply -- which JSON mode's best-effort wording requires
  // in any case.
  "@cf/google/gemma-4-26b-a4b-it": {
    id: "@cf/google/gemma-4-26b-a4b-it",
    contextWindow: 256_000,
    neuronsPerMillionInput: 9_091,
    neuronsPerMillionOutput: 27_273,
    supportsJsonSchema: false,
    supportsVision: true,
  },

  // *** DO NOT DEFAULT TO THIS MODEL ***
  // Listed for completeness because its rates were quoted twice, but it FAILED RE-VERIFICATION:
  // the catalogue fetch 404s, and both its response_format claim and its advertised 32,000-token
  // context could not be confirmed. The claimed context is recorded here in prose only; the field
  // carries CONTEXT_WINDOW_UNVERIFIED so nothing can route a long page to it.
  "@cf/meta/llama-3.1-8b-instruct-fp8-fast": {
    id: "@cf/meta/llama-3.1-8b-instruct-fp8-fast",
    contextWindow: CONTEXT_WINDOW_UNVERIFIED,
    neuronsPerMillionInput: 4_119,
    neuronsPerMillionOutput: 34_868,
    supportsJsonSchema: false,
    supportsVision: false,
  },

  // Appears on Cloudflare's own JSON-Mode docs page, so response_format is confirmed -- but its
  // 24,000-token context cannot hold an escalation (10,400 in + 13,650 out = 24,050), and its
  // output rate is 204,805 neurons per million. See the escalation comparison under modelFor().
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast": {
    id: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    contextWindow: 24_000,
    neuronsPerMillionInput: 26_668,
    neuronsPerMillionOutput: 204_805,
    supportsJsonSchema: true,
    supportsVision: false,
  },

  // Rates verified; no context window, response_format or vision claim was published for either of
  // the next two, and both are dearer than granite on input and output, so neither is a default.
  "@cf/zai-org/glm-4.7-flash": {
    id: "@cf/zai-org/glm-4.7-flash",
    contextWindow: CONTEXT_WINDOW_UNVERIFIED,
    neuronsPerMillionInput: 5_500,
    neuronsPerMillionOutput: 36_400,
    supportsJsonSchema: false,
    supportsVision: false,
  },
  "@cf/openai/gpt-oss-120b": {
    id: "@cf/openai/gpt-oss-120b",
    contextWindow: CONTEXT_WINDOW_UNVERIFIED,
    neuronsPerMillionInput: 31_818,
    neuronsPerMillionOutput: 68_182,
    supportsJsonSchema: false,
    supportsVision: false,
  },

  // Embedding and reranking draw on the SAME 10,000-neuron allowance as text generation, so their
  // rates belong here even though no job routes to them yet: a future embedding-based dedupe pass
  // has to be priced against the same daily budget. Neither is a chat model; they have one rate
  // (per million input tokens) and no output rate.
  "@cf/baai/bge-m3": {
    id: "@cf/baai/bge-m3",
    contextWindow: CONTEXT_WINDOW_UNVERIFIED,
    neuronsPerMillionInput: 1_075,
    neuronsPerMillionOutput: null,
    supportsJsonSchema: false,
    supportsVision: false,
  },
  "@cf/baai/bge-reranker-base": {
    id: "@cf/baai/bge-reranker-base",
    contextWindow: CONTEXT_WINDOW_UNVERIFIED,
    neuronsPerMillionInput: 283,
    neuronsPerMillionOutput: null,
    supportsJsonSchema: false,
    supportsVision: false,
  },
};

const CLOUDFLARE: AiProviderMeta = {
  id: "cloudflare",
  label: "Cloudflare Workers AI",
  trainsOnInput: false, // quoted above, unconditional, no free-tier carve-out
  requiresCard: false,
  quota: {
    unit: "neuron",
    perDay: CLOUDFLARE_NEURONS_PER_DAY,
    resetUtcHour: 0,
    // Text generation also carries 300 requests/minute. Our ~120 requests/day never approaches it,
    // but the limiter honours it so a fan-out burst cannot trip it.
    perMinute: CLOUDFLARE_REQUESTS_PER_MINUTE,
    verification: "live",
  },
  models: CLOUDFLARE_MODELS,
};

// ----------------------------------------------------------------------------------------------
// OpenRouter
//
// Constants verified from OpenRouterTeam/docs@3e3e4fb: FREE_MODEL_RATE_LIMIT_RPM = 20,
// FREE_MODEL_NO_CREDITS_RPD = 50, FREE_MODEL_HAS_CREDITS_RPD = 1000. The 1,000/day figure needs a
// one-time $10 purchase, which is not $0 and is therefore out of scope for this layer; `perDay`
// carries the 50 that a no-credit account actually gets.
//
// INELIGIBLE FOR UNTRUSTED TEXT: the free catalogue 404s unless the account enables endpoints that
// may train on request data and may publish prompts. Using the free tier at all means accepting
// that, so `trainsOnInput` is true and `routableFor()` keeps page text away from it.
//
// OpenAI-compatible: POST https://openrouter.ai/api/v1/chat/completions
//                    Authorization: Bearer, HTTP-Referer, X-Title
//
// No model table: free model ids must be resolved at RUNTIME from
// GET https://openrouter.ai/api/v1/models, because the free catalogue changes weekly and a
// hard-coded ":free" id is a scheduled outage. `modelFor()` therefore returns null here.

const OPENROUTER: AiProviderMeta = {
  id: "openrouter",
  label: "OpenRouter (free tier)",
  trainsOnInput: true,
  requiresCard: false,
  quota: {
    unit: "request",
    perDay: 50,
    // The docs give no reset hour for the daily counter; 00:00 UTC is assumed and the ledger
    // treats the figure as a floor rather than a schedule.
    resetUtcHour: 0,
    perMinute: 20,
    verification: "live",
  },
  models: {},
};

// ----------------------------------------------------------------------------------------------
// Gemini (Google AI Studio)
//
// Model ids are live-verified from Google's own codegen_instructions.md in googleapis/js-genai@main.
// QUOTAS ARE NOT: ai.google.dev is blocked by this environment's egress proxy, and third-party
// mirrors contradict each other by 6x for the same model class (250 vs 1,500 requests/day). One
// mirror claims Google no longer publishes free-tier figures at all and shows them only inside each
// project's AI Studio console. `perDay` is therefore null and `verification` is "unverified": the
// owner must read the real figure from their console before this provider carries load.
//
// Free-tier content is reported to be used to improve Google's products, so `trainsOnInput` is true
// until the owner confirms otherwise from the console. That alone bars it from page text.
//
// Native REST: POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent
//              key via the x-goog-api-key header; structured output via responseMimeType
//              "application/json" plus responseSchema. npm @google/genai 2.24.0.
//
// Context windows are not recorded for any of these: the survey verified the ids, not the specs.

function geminiModel(id: string, supportsVision: boolean): AiModel {
  return {
    id,
    contextWindow: CONTEXT_WINDOW_UNVERIFIED,
    neuronsPerMillionInput: null,
    neuronsPerMillionOutput: null,
    supportsJsonSchema: true, // responseSchema is documented for the generateContent API
    supportsVision,
  };
}

const GEMINI_MODELS: Record<string, AiModel> = {
  "gemini-3-flash-preview": geminiModel("gemini-3-flash-preview", true),
  "gemini-3-pro-preview": geminiModel("gemini-3-pro-preview", true),
  "gemini-2.5-flash": geminiModel("gemini-2.5-flash", true),
  // Google's own guidance names this the "Low Latency & High Volume Tasks" model, which is exactly
  // the shape of our structured-facts jobs, so it is the default for all four of them.
  "gemini-2.5-flash-lite": geminiModel("gemini-2.5-flash-lite", true),
  // Ingest run 13 (2026-09-27): Google answers 404 "no longer available to new users" for
  // 2.5-flash-lite, and lists gemini-3.5-flash-lite for this account. The newest non-preview
  // flash-lite is the default for the structured-facts jobs now.
  "gemini-3.5-flash-lite": geminiModel("gemini-3.5-flash-lite", true),
  "gemini-2.5-pro": geminiModel("gemini-2.5-pro", true),
  "gemini-2.0-flash": geminiModel("gemini-2.0-flash", true),
  "gemini-2.0-flash-lite": geminiModel("gemini-2.0-flash-lite", true),
};

const GEMINI: AiProviderMeta = {
  id: "gemini",
  label: "Google AI Studio (Gemini free tier)",
  trainsOnInput: true,
  requiresCard: false,
  quota: {
    unit: "request",
    perDay: null, // unreadable; see above
    resetUtcHour: 0,
    perMinute: null,
    verification: "unverified",
  },
  models: GEMINI_MODELS,
};

// ----------------------------------------------------------------------------------------------
// Groq
//
// OpenAI-compatible at https://api.groq.com/openai/v1/chat/completions. Quotas NOT verified;
// reported figures are 30 requests/minute, 1,000 requests/day and 8,000 tokens/minute. `perDay`
// stays null because nothing authoritative could be read; `perMinute` carries the reported 30,
// which errs toward throttling us rather than the vendor.
//
// STRUCTURAL EXCLUSION FROM THE LONG JOBS, independent of the data policy: at 8,000 tokens/minute
// a single extraction (8,000 in + up to 10,500 out) is more than a whole minute's budget, and
// PLAN 6.5 caps cleaned page text at ~12,000 tokens, which exceeds the per-minute ceiling on its
// own and can never succeed. Groq is for short jobs that send our own structured facts, and
// `modelFor()` returns null for extract, escalate and submission whatever else changes.
//
// Its free-tier data policy could not be read. An unread policy is treated as the worse case, so
// `trainsOnInput` is true and `routableFor()` also bars it from untrusted text.
//
// No model table: the survey verified no Groq model id, and guessing one from training data is
// exactly the failure this file exists to prevent. Ids must be read from the live catalogue
// (GET https://api.groq.com/openai/v1/models) before Groq carries any job.

const GROQ: AiProviderMeta = {
  id: "groq",
  label: "Groq (free tier)",
  trainsOnInput: true,
  requiresCard: false,
  quota: {
    unit: "request",
    perDay: null,
    resetUtcHour: 0,
    perMinute: 30, // reported, not verified
    verification: "unverified",
  },
  models: {},
};

// ----------------------------------------------------------------------------------------------
// Amazon Bedrock
//
// AWS Bedrock FAQ: "With Amazon Bedrock, your content is not used to improve the base models and is
// not shared with any model providers." and "Users' inputs and model outputs are not shared with any
// model providers." That is a read policy with no tier carve-out, so `trainsOnInput` is false and
// Bedrock may carry the untrusted-text jobs (extract, escalate, submission).
//
// Price, aws.amazon.com/bedrock/pricing, US East (N. Virginia), Standard tier, DeepSeek v3.2:
// $0.62 per 1M input tokens, $1.85 per 1M output tokens.
//
// Model id `deepseek.v3.2`, region us-east-1 (the id the owner's other tooling already calls).
//
// Context window not read from AWS: `CONTEXT_WINDOW_UNVERIFIED`.
//
// Paid, decided by the owner 2026-10-12 (D-142), capped in dollars per day; the ledger counts it in
// microdollars so the cap is exact.
//
// JSON is requested in the prompt and validated after (no tool forcing): `supportsJsonSchema: false`.

export const BEDROCK_REGION = "us-east-1";
export const DEEPSEEK_V3_2 = "deepseek.v3.2";

function bedrockModel(id: string): AiModel {
  return {
    id,
    contextWindow: CONTEXT_WINDOW_UNVERIFIED,
    neuronsPerMillionInput: null,
    neuronsPerMillionOutput: null,
    usdPerMillionInput: 0.62,
    usdPerMillionOutput: 1.85,
    supportsJsonSchema: false,
    supportsVision: false,
  };
}

const BEDROCK_MODELS: Record<string, AiModel> = {
  [DEEPSEEK_V3_2]: bedrockModel(DEEPSEEK_V3_2),
};

const BEDROCK: AiProviderMeta = {
  id: "bedrock",
  label: "Amazon Bedrock, DeepSeek V3.2 (paid, D-142)",
  trainsOnInput: false,
  requiresCard: true,
  quota: {
    unit: "microdollar",
    perDay: null,
    resetUtcHour: 0,
    perMinute: null,
    verification: "live",
  },
  models: BEDROCK_MODELS,
};

// ----------------------------------------------------------------------------------------------
// Anthropic
//
// The paid fallback from D-007, kept in the registry because the contract enumerates it, but
// outside the zero-cost layer: `requiresCard` is true and the chain never reaches it without the
// owner turning on a budget.
//
// `trainsOnInput` IS TRUE, and that is a posture rather than a finding. Anthropic's free-tier and
// commercial data policies were not read during the 2026-09-22 survey, and an unread policy is
// treated as the worse case everywhere else in this file (Groq gets the same treatment). Every
// provider except Cloudflare is therefore `true`, and only Cloudflare -- whose refusal to train on
// Customer Content we have quoted, unconditional, with no free-tier carve-out -- may see page
// text. This is the single flag to revisit, against a read policy, if the owner ever wants a paid
// escalation path for extraction.
//
// Roles are D-007's. Prices are dollars per million tokens, not neurons, so both neuron rates are
// null; the ledger meters this provider in requests and `cost_log` carries the dollars.
// Context windows were not recorded during the survey, so they are marked unverified rather than
// filled in from memory.

function anthropicModel(id: string): AiModel {
  return {
    id,
    contextWindow: CONTEXT_WINDOW_UNVERIFIED,
    neuronsPerMillionInput: null,
    neuronsPerMillionOutput: null,
    supportsJsonSchema: true, // structured outputs via output_config.format (SOURCES.md)
    supportsVision: true,
  };
}

const ANTHROPIC_MODELS: Record<string, AiModel> = {
  "claude-haiku-4-5": anthropicModel("claude-haiku-4-5"),
  "claude-sonnet-5": anthropicModel("claude-sonnet-5"),
  "claude-opus-5": anthropicModel("claude-opus-5"),
};

const ANTHROPIC: AiProviderMeta = {
  id: "anthropic",
  label: "Anthropic (paid, D-007 fallback)",
  trainsOnInput: true, // unread policy, treated as the worse case; see the note above

  requiresCard: true,
  quota: {
    unit: "request",
    perDay: null, // metered in dollars against a budget, not in free requests per day
    resetUtcHour: 0,
    perMinute: null,
    verification: "unverified",
  },
  models: ANTHROPIC_MODELS,
};

// ----------------------------------------------------------------------------------------------
// Providers the survey ruled out entirely, recorded so nobody re-evaluates them from memory:
//
//   Cohere    1,000 calls per MONTH, verified. An evaluation allowance, not a tier. Excluded.
//   Mistral   free mode documented as "intended for evaluation and prototyping". Excluded from
//             defaults; an owner decision if it is ever wanted.
//
// Neither appears in `AI_PROVIDER_IDS`, so neither can be selected.

const REGISTRY: Record<AiProviderId, AiProviderMeta> = {
  cloudflare: CLOUDFLARE,
  gemini: GEMINI,
  groq: GROQ,
  openrouter: OPENROUTER,
  anthropic: ANTHROPIC,
  bedrock: BEDROCK,
};

/** Every provider in the contract, keyed by id. */
export const AI_PROVIDERS: Readonly<Record<AiProviderId, AiProviderMeta>> = Object.freeze(REGISTRY);

/** Metadata for `id`. Total over `AiProviderId`, so it never returns undefined. */
export function providerMeta(id: AiProviderId): AiProviderMeta {
  return AI_PROVIDERS[id];
}

/** Every provider, in the contract's declared order. */
export const ALL_AI_PROVIDERS: readonly AiProviderMeta[] = Object.freeze(
  AI_PROVIDER_IDS.map((id) => AI_PROVIDERS[id]),
);

// ----------------------------------------------------------------------------------------------
// Default model per provider per job
//
// Cloudflare, extract and the small jobs -> @cf/ibm-granite/granite-4.0-h-micro. Cheapest verified
// rates in the catalogue, 131,000-token context (extraction needs 18,500), and the only entry where
// response_format and function_calling were both confirmed.
//
// Cloudflare, escalate and submission -> @cf/google/gemma-4-26b-a4b-it. Three reasons:
//   * vision, which the flyer submission path needs and granite does not have;
//   * 256,000-token context, against llama-3.3-70b's 24,000 -- and an escalation is 10,400 in plus
//     13,650 out = 24,050 tokens, so llama-3.3-70b cannot hold one at all;
//   * cost. At the COSTS 1 mix (6,000 in / 900 out) gemma-4 is 79.09 neurons against
//     llama-3.3-70b's 344.33, i.e. 4.4x cheaper; at our escalation cap (10,400 / 13,650) it is
//     466.82 against 3,072.94, i.e. 6.6x cheaper. Both comparisons point the same way.
//
// Gemini -> gemini-3.5-flash-lite (2.5-flash-lite is closed to new users, run 13), the flash-lite line being Google's "Low Latency & High Volume Tasks" models, for the
// four structured-facts jobs only; null for the three untrusted-text jobs, which it may not have.
//
// Groq and OpenRouter -> null everywhere: no verified model id for Groq, and OpenRouter's free ids
// must be resolved at runtime. Groq is additionally excluded from extract, escalate and submission
// by its 8,000 tokens/minute ceiling.
//
// Anthropic -> D-007's role table, for whenever the owner funds it.

const GRANITE = "@cf/ibm-granite/granite-4.0-h-micro";
const GEMMA = "@cf/google/gemma-4-26b-a4b-it";
const FLASH_LITE = "gemini-3.5-flash-lite";

const DEFAULT_MODEL_IDS: Record<AiProviderId, Readonly<Record<AiJobId, string | null>>> = {
  cloudflare: {
    extract: GRANITE,
    escalate: GEMMA,
    submission: GEMMA,
    summarise: GRANITE,
    dedupe: GRANITE,
    classify_venue: GRANITE,
    map_style: GRANITE,
  },
  gemini: {
    extract: null, // trains on input
    escalate: null, // trains on input
    submission: null, // trains on input
    summarise: FLASH_LITE,
    dedupe: FLASH_LITE,
    classify_venue: FLASH_LITE,
    map_style: FLASH_LITE,
  },
  groq: {
    extract: null, // trains on input, and 8,000 tokens/minute cannot fit one extraction
    escalate: null, // same, more so
    submission: null, // trains on input
    summarise: null, // no verified model id
    dedupe: null,
    classify_venue: null,
    map_style: null,
  },
  openrouter: {
    extract: null, // free catalogue requires opting into training and prompt publication
    escalate: null,
    submission: null,
    summarise: null, // ids resolved at runtime from GET /api/v1/models
    dedupe: null,
    classify_venue: null,
    map_style: null,
  },
  anthropic: {
    // D-007's roles for these three were extract/escalate/submission on Haiku and Sonnet. They are
    // null now because `trainsOnInput` is true for Anthropic (see its note above): an unread data
    // policy bars a provider from untrusted text whatever its price, and `routableFor()` would drop
    // it from the chain anyway. Restore them only together with a read policy.
    extract: null,
    escalate: null,
    submission: null,
    summarise: "claude-haiku-4-5",
    dedupe: "claude-haiku-4-5",
    classify_venue: "claude-haiku-4-5",
    map_style: "claude-haiku-4-5",
  },
  bedrock: {
    extract: DEEPSEEK_V3_2,
    escalate: DEEPSEEK_V3_2,
    submission: DEEPSEEK_V3_2,
    summarise: DEEPSEEK_V3_2,
    dedupe: DEEPSEEK_V3_2,
    classify_venue: DEEPSEEK_V3_2,
    map_style: DEEPSEEK_V3_2,
  },
};

/**
 * The default model `provider` should use for `job`, or null when it has none: the provider's
 * terms bar it from the job, its limits cannot fit the job, or no model id was ever verified.
 *
 * A null here is not an error. It means "ask the next provider in the chain", and when every
 * provider returns null for an untrusted-text job the pipeline defers, which is the planned
 * outcome rather than a failure (contract `AiFailure`, D-039).
 */
export function modelFor(provider: AiProviderId, job: AiJobId): AiModel | null {
  const id = DEFAULT_MODEL_IDS[provider][job];
  if (id === null) return null;
  return AI_PROVIDERS[provider].models[id] ?? null;
}

/** The default model id for `provider` and `job`, without resolving it against the model table. */
export function defaultModelId(provider: AiProviderId, job: AiJobId): string | null {
  return DEFAULT_MODEL_IDS[provider][job];
}

// ----------------------------------------------------------------------------------------------

/**
 * Neurons a call costs on `model`, from its per-million rates.
 *
 * Providers that meter whole requests have null rates, and their neuron cost is 0 because neurons
 * are not their unit: the ledger reserves one request for them instead. A model with an input rate
 * but no output rate (the bge embedding and reranker entries) is charged on input alone.
 *
 * The result is not rounded. Cloudflare's allowance is 10,000 neurons per day and one extraction
 * is ~119 of them, so rounding each call to a whole neuron would drift by a meaningful fraction of
 * a day's budget over the ~120 calls we make.
 */
export function neuronCost(model: AiModel, inTokens: number, outTokens: number): number {
  const input = ((model.neuronsPerMillionInput ?? 0) * Math.max(0, inTokens)) / 1_000_000;
  const output = ((model.neuronsPerMillionOutput ?? 0) * Math.max(0, outTokens)) / 1_000_000;
  return input + output;
}

/** Microdollars a call costs on `model`: dollars per million tokens equals microdollars per token. Not rounded. */
export function microdollarCost(model: AiModel, inTokens: number, outTokens: number): number {
  const input = (model.usdPerMillionInput ?? 0) * Math.max(0, inTokens);
  const output = (model.usdPerMillionOutput ?? 0) * Math.max(0, outTokens);
  return input + output;
}

/**
 * Whether `model` can hold `inTokens` of prompt and `outTokens` of reply.
 *
 * The window is a gate only when we know it. `CONTEXT_WINDOW_UNVERIFIED` (zero) means UNKNOWN, not
 * "holds nothing": reading it as a capacity rejected every Gemini, OpenRouter and Anthropic model
 * and left the owner's preferred chain unreachable. An unknown window therefore returns true and
 * logs once, so the fact stays visible without being enforced as if it were a measurement.
 */
export function fitsContextWindow(model: AiModel, inTokens: number, outTokens: number): boolean {
  if (model.contextWindow <= CONTEXT_WINDOW_UNVERIFIED) {
    noteUnknownContextWindow(model);
    return true;
  }
  return inTokens + outTokens <= model.contextWindow;
}

/** Model ids already reported, so one unknown window is one line in the log, not one per call. */
const reportedUnknownWindows = new Set<string>();

/** Test seam: forget which models have been reported, so a test can assert the once-only rule. */
export function resetUnknownContextWindowLog(): void {
  reportedUnknownWindows.clear();
}

function noteUnknownContextWindow(model: AiModel): void {
  if (reportedUnknownWindows.has(model.id)) return;
  reportedUnknownWindows.add(model.id);
  console.info(
    `ai ${JSON.stringify({
      event: "ai_context_window_unknown",
      model: model.id,
      reason:
        "no context window survived verification for this model; the limit is unknown, not zero, " +
        "so the call is allowed and the vendor decides",
    })}`,
  );
}

// ----------------------------------------------------------------------------------------------

/** One model's neuron rates, for a caller that prices a call without resolving the whole row. */
export interface CloudflareNeuronRate {
  readonly perMillionInput: number;
  /** Null for embeddings and rerankers, which are billed on input alone. */
  readonly perMillionOutput: number | null;
}

/**
 * Neurons per million tokens for every Workers AI model whose rate was verified.
 *
 * DERIVED, never transcribed. `CLOUDFLARE_MODELS` above is the one place these figures are
 * written down; `src/ai/providers/cloudflare.ts` used to carry a second copy that disagreed with
 * it about `supportsJsonSchema`, and `tests/unit/ai-providers.test.ts` now asserts that exactly
 * one file in `src/` defines them.
 */
export const CLOUDFLARE_NEURON_RATES: Readonly<Record<string, CloudflareNeuronRate>> =
  Object.freeze(
    Object.fromEntries(
      Object.entries(CLOUDFLARE_MODELS).map(([id, model]) => [
        id,
        Object.freeze({
          perMillionInput: model.neuronsPerMillionInput ?? 0,
          perMillionOutput: model.neuronsPerMillionOutput,
        }),
      ]),
    ),
  );
