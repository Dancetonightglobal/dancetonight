// Groq, on its OpenAI-compatible endpoint.
//
// Groq is deliberately the narrowest adapter in the directory, for two reasons found in the
// 2026-09-22 survey:
//
//   1. Its quotas are NOT verified. The reported figures are 30 requests a minute, 1,000
//      requests a day and 8,000 tokens a minute, and nothing authoritative could be read, so
//      `quota.perDay` is null and `quota.verification` is "unverified". Nothing budgets against
//      a reported figure: the ledger holds Groq to the lowest daily allowance anyone did verify.
//   2. Those 8,000 tokens a minute are a structural wall, not a throttle. One ~6,900-token
//      extraction is 86% of a minute's budget, and PLAN 6.5 caps a long list page at roughly
//      12,000 tokens, which exceeds the ceiling outright and can never succeed however often it
//      is retried. Groq is therefore excluded from extraction and escalation and used only for
//      short jobs that send our own structured facts.
//
// `groqFitsPerMinuteCeiling` lets the router skip Groq before spending a call, and `call`
// refuses the same job rather than burning a request on something that cannot return.
//
// No Groq model ID was verified by the survey, so none is hard-coded (CLAUDE.md: never invent a
// fact). `meta.models` is empty and the router supplies the model, optionally from
// `listGroqModels`, exactly as OpenRouter's catalogue is resolved at runtime.

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
  callOpenAiCompatible,
  credential,
  estimateProviderCost,
  fail,
  fetchModelCatalogue,
  readString,
  resolveProviderOptions,
  type ProviderOptions,
  type ResolvedProviderOptions,
} from "@/src/ai/providers/index";

export const GROQ_BASE_URL = "https://api.groq.com/openai/v1";
export const GROQ_CHAT_URL = `${GROQ_BASE_URL}/chat/completions`;

/**
 * How well these figures are known, in the SOURCES.md vocabulary the registry uses. Groq publishes
 * nothing we could read, so every number below is REPORTED, not verified, and the registry says so
 * in the one place that matters: `GROQ_META.quota.perDay` is null and its `verification` is
 * "unverified". Nothing may be budgeted against these.
 */
export const GROQ_QUOTA_VERIFICATION = "unverified" as const;

/**
 * Reported, NOT verified: 30 requests a minute, 1,000 a day, 8,000 tokens a minute.
 *
 * This file used to present the daily figure as settled -- `perDay: 1_000`, `verification:
 * "mirror"` -- while the registry recorded null and "unverified" for the same provider. The
 * registry is right and is now the only quota this adapter reports. These constants stay because
 * the per-minute token ceiling is a routing fact (see `groqFitsPerMinuteCeiling`), but they are
 * named and commented as the hearsay they are.
 */
export const GROQ_REPORTED_REQUESTS_PER_MINUTE = 30;
export const GROQ_REPORTED_REQUESTS_PER_DAY = 1_000;
export const GROQ_TOKENS_PER_MINUTE = 8_000;

/** Input plus the job's output ceiling, against the per-minute token wall. */
export function groqJobTokens(job: AiJob): number {
  return job.estimatedInputTokens + job.maxOutputTokens;
}

/** False when a job can never complete here, whatever the retry budget. */
export function groqFitsPerMinuteCeiling(job: AiJob): boolean {
  return groqJobTokens(job) <= GROQ_TOKENS_PER_MINUTE;
}

/**
 * From the registry: `trainsOnInput` true (an unread data policy is treated as the worse case, so
 * untrusted page text never reaches Groq), `perDay` null and `verification` "unverified".
 */
export const GROQ_META: AiProviderMeta = providerMeta("groq");

export function createGroqProvider(options?: ProviderOptions): AiProvider {
  const resolved = resolveProviderOptions(options);
  return {
    meta: GROQ_META,
    isConfigured(): boolean {
      return credential(resolved.env.GROQ_API_KEY) !== undefined;
    },
    estimateCost(job: AiJob, model: AiModel): number {
      return estimateProviderCost(job, model, "request");
    },
    call<T>(request: AiRequest<T>, model: AiModel): Promise<AiOutcome<T>> {
      return callGroq(request, model, resolved);
    },
  };
}

async function callGroq<T>(
  request: AiRequest<T>,
  model: AiModel,
  options: ResolvedProviderOptions,
): Promise<AiOutcome<T>> {
  const key = credential(options.env.GROQ_API_KEY);
  if (key === undefined) return fail("groq", "disabled", "GROQ_API_KEY is not set");
  if (!groqFitsPerMinuteCeiling(request.job)) {
    return fail(
      "groq",
      "provider_error",
      `job needs ${groqJobTokens(request.job)} tokens, above Groq's ${GROQ_TOKENS_PER_MINUTE}-token minute ceiling`,
    );
  }
  return callOpenAiCompatible(
    request,
    model.id,
    {
      provider: "groq",
      url: GROQ_CHAT_URL,
      headers: { authorization: `Bearer ${key}` },
      secrets: [key],
      quotaDetail: "request or token allowance spent",
    },
    options,
  );
}

/**
 * The account's model list, for a router that needs an ID. The endpoint follows from Groq being
 * OpenAI-compatible; it was not itself verified on 2026-09-22, so a failure here is not fatal.
 */
export async function listGroqModels(
  options?: ProviderOptions,
): Promise<{ ok: true; ids: string[] } | { ok: false; detail: string }> {
  const resolved = resolveProviderOptions(options);
  const key = credential(resolved.env.GROQ_API_KEY);
  if (key === undefined) return { ok: false, detail: "GROQ_API_KEY is not set" };
  const catalogue = await fetchModelCatalogue(
    `${GROQ_BASE_URL}/models`,
    { authorization: `Bearer ${key}` },
    resolved,
  );
  if (!catalogue.ok) return catalogue;
  const ids: string[] = [];
  for (const entry of catalogue.entries) {
    const id = readString(entry.id);
    if (id !== null) ids.push(id);
  }
  return { ok: true, ids };
}

/** The adapter bound to the process environment. */
export const groqProvider: AiProvider = createGroqProvider();
