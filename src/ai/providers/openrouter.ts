// OpenRouter, on its OpenAI-compatible endpoint.
//
// Verified constants from OpenRouterTeam/docs@3e3e4fb, committed 2026-09-22:
// FREE_MODEL_RATE_LIMIT_RPM = 20, FREE_MODEL_NO_CREDITS_RPD = 50,
// FREE_MODEL_HAS_CREDITS_RPD = 1000. The 1,000 needs a one-time $10 purchase, which is not $0
// and is therefore out of scope, so the recorded daily allowance is 50.
//
// Two things follow from the same survey and are enforced here rather than left to a comment:
//   - The free catalogue 404s unless the account enables endpoints that may train on request
//     data and may publish prompts. `trainsOnInput` is true, which makes OpenRouter ineligible
//     for any job carrying third-party page text (types.ts `routableFor`, D-039).
//   - The catalogue changes weekly, so no ":free" ID is hard-coded. Free IDs are resolved at
//     runtime from GET /api/v1/models and cached in memory for the life of the process.

import type {
  AiJob,
  AiModel,
  AiOutcome,
  AiProvider,
  AiProviderMeta,
  AiRequest,
} from "@/src/ai/types";
import { CONTEXT_WINDOW_UNVERIFIED, providerMeta } from "@/src/ai/registry";
import {
  asRecord,
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

export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
export const OPENROUTER_CHAT_URL = `${OPENROUTER_BASE_URL}/chat/completions`;
export const OPENROUTER_MODELS_URL = `${OPENROUTER_BASE_URL}/models`;

/** Verified constants; the names are OpenRouter's own. */
export const FREE_MODEL_RATE_LIMIT_RPM = 20;
export const FREE_MODEL_NO_CREDITS_RPD = 50;
export const FREE_MODEL_HAS_CREDITS_RPD = 1_000;

/**
 * Ask `call` to pick a free model from the live catalogue instead of naming one. The router
 * passes this when it has no verified ID of its own, which is the normal case here.
 */
export const OPENROUTER_AUTO_FREE = "auto:free";

export const OPENROUTER_AUTO_FREE_MODEL: AiModel = {
  id: OPENROUTER_AUTO_FREE,
  contextWindow: CONTEXT_WINDOW_UNVERIFIED,
  neuronsPerMillionInput: null,
  neuronsPerMillionOutput: null,
  supportsJsonSchema: true,
  supportsVision: false,
};

/**
 * From the registry: `trainsOnInput` true (the free catalogue is only reachable with training and
 * prompt publication enabled), 50 requests a day, 20 a minute, and no model table -- free ids are
 * resolved at runtime by `resolveFreeModelIds`.
 */
export const OPENROUTER_META: AiProviderMeta = providerMeta("openrouter");

/** Process-lifetime cache, as required: the catalogue changes weekly, not per call. */
let freeModelCache: string[] | null = null;

/** Test seam and a way for the owner to force a re-read after a catalogue change. */
export function clearOpenRouterCatalogueCache(): void {
  freeModelCache = null;
}

/** A catalogue row is free when both its prompt and completion prices are zero. */
export function isFreeCatalogueEntry(entry: Record<string, unknown>): boolean {
  const pricing = asRecord(entry.pricing);
  if (pricing === null) return false;
  const zero = (value: unknown): boolean => {
    const asNumber = typeof value === "string" ? Number(value) : value;
    return typeof asNumber === "number" && Number.isFinite(asNumber) && asNumber === 0;
  };
  return zero(pricing.prompt) && zero(pricing.completion);
}

export async function resolveFreeModelIds(
  options: ResolvedProviderOptions,
): Promise<{ ok: true; ids: string[] } | { ok: false; detail: string }> {
  if (freeModelCache !== null) return { ok: true, ids: freeModelCache };
  const key = credential(options.env.OPENROUTER_API_KEY);
  const catalogue = await fetchModelCatalogue(
    OPENROUTER_MODELS_URL,
    key === undefined ? {} : { authorization: `Bearer ${key}` },
    options,
  );
  if (!catalogue.ok) return catalogue;
  const ids: string[] = [];
  for (const entry of catalogue.entries) {
    const id = readString(entry.id);
    if (id !== null && isFreeCatalogueEntry(entry)) ids.push(id);
  }
  if (ids.length === 0) {
    return {
      ok: false,
      detail:
        "catalogue listed no zero-price model (the account may not have free endpoints enabled)",
    };
  }
  freeModelCache = ids;
  return { ok: true, ids };
}

export function openRouterHeaders(
  key: string,
  baseUrl: string | undefined,
): Record<string, string> {
  const headers: Record<string, string> = {
    authorization: `Bearer ${key}`,
    "x-title": "DanceTonight",
  };
  // OpenRouter attributes calls to the app behind them; PUBLIC_BASE_URL is the one we publish.
  if (baseUrl !== undefined) headers["http-referer"] = baseUrl;
  return headers;
}

export function createOpenRouterProvider(options?: ProviderOptions): AiProvider {
  const resolved = resolveProviderOptions(options);
  return {
    meta: OPENROUTER_META,
    isConfigured(): boolean {
      return credential(resolved.env.OPENROUTER_API_KEY) !== undefined;
    },
    estimateCost(job: AiJob, model: AiModel): number {
      return estimateProviderCost(job, model, "request");
    },
    call<T>(request: AiRequest<T>, model: AiModel): Promise<AiOutcome<T>> {
      return callOpenRouter(request, model, resolved);
    },
  };
}

async function callOpenRouter<T>(
  request: AiRequest<T>,
  model: AiModel,
  options: ResolvedProviderOptions,
): Promise<AiOutcome<T>> {
  const key = credential(options.env.OPENROUTER_API_KEY);
  if (key === undefined) return fail("openrouter", "disabled", "OPENROUTER_API_KEY is not set");

  let modelId = model.id;
  if (modelId === OPENROUTER_AUTO_FREE || modelId === "") {
    const resolvedIds = await resolveFreeModelIds(options);
    if (!resolvedIds.ok) {
      return fail(
        "openrouter",
        "provider_error",
        `could not resolve a free model: ${resolvedIds.detail}`,
      );
    }
    const first = resolvedIds.ids[0];
    if (first === undefined) {
      return fail("openrouter", "provider_error", "catalogue listed no free model");
    }
    modelId = first;
  }

  return callOpenAiCompatible(
    request,
    modelId,
    {
      provider: "openrouter",
      url: OPENROUTER_CHAT_URL,
      headers: openRouterHeaders(key, options.env.PUBLIC_BASE_URL),
      secrets: [key],
      quotaDetail: `free-model allowance spent (${FREE_MODEL_NO_CREDITS_RPD} a day, ${FREE_MODEL_RATE_LIMIT_RPM} a minute)`,
    },
    options,
  );
}

/** The adapter bound to the process environment. */
export const openRouterProvider: AiProvider = createOpenRouterProvider();
