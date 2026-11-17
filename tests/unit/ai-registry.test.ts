import { describe, expect, it, vi } from "vitest";

import {
  AI_JOBS,
  ALL_AI_JOBS,
  EXTRACT_BUDGETED_LISTINGS,
  EXTRACT_ENVELOPE_TOKENS,
  EXTRACT_PAGE_TEXT_TOKENS,
  EXTRACT_PROMPT_TOKENS,
  EXTRACT_TOKENS_PER_LISTING,
  UNTRUSTED_TEXT_JOBS,
  extractOutputTokensFor,
  jobById,
} from "@/src/ai/jobs";
import {
  AI_PROVIDERS,
  ALL_AI_PROVIDERS,
  CONTEXT_WINDOW_UNVERIFIED,
  defaultModelId,
  fitsContextWindow,
  modelFor,
  neuronCost,
  resetUnknownContextWindowLog,
} from "@/src/ai/registry";
import {
  AI_JOB_IDS,
  AI_PROVIDER_IDS,
  routableFor,
  type AiJobId,
  type AiModel,
  type AiProviderId,
} from "@/src/ai/types";

const CLOUDFLARE_DAILY_NEURONS = 10_000;

function cloudflareModel(id: string): AiModel {
  const model = AI_PROVIDERS.cloudflare.models[id];
  if (model === undefined) throw new Error(`missing Cloudflare model ${id}`);
  return model;
}

const granite = () => cloudflareModel("@cf/ibm-granite/granite-4.0-h-micro");
const gemma = () => cloudflareModel("@cf/google/gemma-4-26b-a4b-it");
const llama70b = () => cloudflareModel("@cf/meta/llama-3.3-70b-instruct-fp8-fast");

// ------------------------------------------------------------------------------------------
// neuronCost, against the verified Workers AI rate table.

describe("neuronCost", () => {
  it("prices the COSTS.md section 1 extraction mix on granite", () => {
    // 6,000 x 1,542 / 1e6 = 9.252 in; 900 x 10,158 / 1e6 = 9.1422 out.
    expect(neuronCost(granite(), 6_000, 900)).toBeCloseTo(18.3942, 6);
  });

  it("prices the same mix on gemma-4", () => {
    // 6,000 x 9,091 / 1e6 = 54.546 in; 900 x 27,273 / 1e6 = 24.5457 out. The brief's figure of
    // 34.1 does not reconcile with the published rates; 79.0917 is what the table gives.
    expect(neuronCost(gemma(), 6_000, 900)).toBeCloseTo(79.0917, 6);
  });

  it("prices the same mix on llama-3.3-70b", () => {
    // 6,000 x 26,668 / 1e6 = 160.008 in; 900 x 204,805 / 1e6 = 184.3245 out.
    expect(neuronCost(llama70b(), 6_000, 900)).toBeCloseTo(344.3325, 6);
  });

  it("splits input and output rather than charging one rate for both", () => {
    const model = granite();
    expect(neuronCost(model, 1_000_000, 0)).toBeCloseTo(1_542, 9);
    expect(neuronCost(model, 0, 1_000_000)).toBeCloseTo(10_158, 9);
    // Output is the dominant term: 10,158 / 1,542 = 6.59x input on the cheapest model.
    expect(10_158 / 1_542).toBeCloseTo(6.588, 3);
  });

  it("charges nothing for a provider that meters whole requests", () => {
    const flashLite = AI_PROVIDERS.gemini.models["gemini-2.5-flash-lite"];
    expect(flashLite).toBeDefined();
    expect(neuronCost(flashLite as AiModel, 100_000, 100_000)).toBe(0);
  });

  it("charges an embedding model on input alone", () => {
    // @cf/baai/bge-m3 has one rate, 1,075 per million input tokens, and no output rate.
    const bge = cloudflareModel("@cf/baai/bge-m3");
    expect(neuronCost(bge, 1_000_000, 500_000)).toBeCloseTo(1_075, 9);
  });

  it("never returns a negative charge", () => {
    expect(neuronCost(granite(), -10_000, -10_000)).toBe(0);
  });
});

// ------------------------------------------------------------------------------------------
// The extraction budget: the number that dominates the daily allowance.

describe("extraction output budget", () => {
  it("scales with the expected listings per page", () => {
    expect(extractOutputTokensFor(1)).toBe(EXTRACT_ENVELOPE_TOKENS + EXTRACT_TOKENS_PER_LISTING);
    expect(extractOutputTokensFor(16)).toBe(EXTRACT_ENVELOPE_TOKENS + 16 * 650);
    // Never below one complete listing, whatever the caller passes.
    expect(extractOutputTokensFor(0)).toBe(extractOutputTokensFor(1));
    expect(extractOutputTokensFor(-5)).toBe(extractOutputTokensFor(1));
    expect(extractOutputTokensFor(Number.NaN)).toBe(extractOutputTokensFor(1));
    expect(extractOutputTokensFor(2.1)).toBe(extractOutputTokensFor(3));
  });

  it("budgets a whole array, not one listing", () => {
    // rawExtractionSchema returns { page_kind, language, listings: [...] }; a cap sized for one
    // listing truncates every list page into unparseable JSON.
    expect(AI_JOBS.extract.maxOutputTokens).toBeGreaterThan(
      10 * EXTRACT_TOKENS_PER_LISTING, // ten rows is already past any single-listing budget
    );
  });

  it("can hold the 16th listing, so PLAN 8.2's >15-item escalation rule is decidable", () => {
    expect(EXTRACT_BUDGETED_LISTINGS).toBe(16);
    expect(AI_JOBS.extract.maxOutputTokens).toBeGreaterThanOrEqual(
      extractOutputTokensFor(EXTRACT_BUDGETED_LISTINGS),
    );
  });

  it("counts the system prompt and JSON schema in the input estimate", () => {
    // The critic's finding: COSTS.md counted only the 6,000 tokens of page text.
    expect(EXTRACT_PROMPT_TOKENS).toBeGreaterThan(0);
    expect(AI_JOBS.extract.estimatedInputTokens).toBe(
      EXTRACT_PAGE_TEXT_TOKENS + EXTRACT_PROMPT_TOKENS,
    );
    expect(AI_JOBS.extract.estimatedInputTokens).toBeGreaterThan(EXTRACT_PAGE_TEXT_TOKENS);
  });

  it("escalates at 1.3x the extract token counts (PLAN 8.2)", () => {
    expect(AI_JOBS.escalate.estimatedInputTokens).toBe(
      Math.round(AI_JOBS.extract.estimatedInputTokens * 1.3),
    );
    expect(AI_JOBS.escalate.maxOutputTokens).toBe(
      Math.round(AI_JOBS.extract.maxOutputTokens * 1.3),
    );
  });

  it("leaves a fully reserved extraction inside one day's neurons", () => {
    const job = AI_JOBS.extract;
    const reserved = neuronCost(granite(), job.estimatedInputTokens, job.maxOutputTokens);
    expect(reserved).toBeCloseTo(118.995, 3);
    expect(reserved).toBeLessThan(CLOUDFLARE_DAILY_NEURONS);
    // Reconciled against the COSTS.md mean of 900 output tokens, a day buys far more than the
    // ~25 extractions per day that 740 per metro-month implies.
    const actual = neuronCost(granite(), job.estimatedInputTokens, 900);
    expect(Math.floor(CLOUDFLARE_DAILY_NEURONS / actual)).toBeGreaterThan(100);
  });
});

// ------------------------------------------------------------------------------------------
// Every job.

describe("AI_JOBS", () => {
  it("defines exactly the contract's job ids", () => {
    expect(Object.keys(AI_JOBS).sort()).toEqual([...AI_JOB_IDS].sort());
    expect(ALL_AI_JOBS.map((job) => job.id)).toEqual([...AI_JOB_IDS]);
  });

  it("is keyed by each job's own id", () => {
    for (const id of AI_JOB_IDS) {
      expect(jobById(id).id).toBe(id);
    }
  });

  it("gives every job a non-zero maxOutputTokens", () => {
    // Contract rule 3: Workers AI defaults max_tokens to 256 and silently truncates. No job may
    // fall back to that default, so none may carry a zero or missing cap.
    for (const job of ALL_AI_JOBS) {
      expect(job.maxOutputTokens, job.id).toBeGreaterThan(0);
      expect(Number.isInteger(job.maxOutputTokens), job.id).toBe(true);
      expect(job.maxOutputTokens, job.id).toBeGreaterThan(256);
    }
  });

  it("gives every job a non-zero input estimate and a description", () => {
    for (const job of ALL_AI_JOBS) {
      expect(job.estimatedInputTokens, job.id).toBeGreaterThan(0);
      expect(Number.isInteger(job.estimatedInputTokens), job.id).toBe(true);
      expect(job.description.trim().length, job.id).toBeGreaterThan(0);
    }
  });

  it("marks exactly the jobs that carry text we did not write", () => {
    const untrusted = ALL_AI_JOBS.filter((job) => job.sendsUntrustedText).map((job) => job.id);
    expect(untrusted.sort()).toEqual(["escalate", "extract", "submission"]);
    expect(UNTRUSTED_TEXT_JOBS.map((job) => job.id).sort()).toEqual(untrusted.sort());
  });

  it("keeps the structured-facts jobs small", () => {
    // These send only facts we already validated, so they have no page-sized prompt.
    for (const id of ["summarise", "dedupe", "classify_venue", "map_style"] as const) {
      expect(AI_JOBS[id].sendsUntrustedText, id).toBe(false);
      expect(AI_JOBS[id].estimatedInputTokens, id).toBeLessThan(
        AI_JOBS.extract.estimatedInputTokens,
      );
      expect(AI_JOBS[id].maxOutputTokens, id).toBeLessThan(AI_JOBS.extract.maxOutputTokens);
    }
  });

  it("is frozen, so no caller can mutate a shared job definition", () => {
    expect(Object.isFrozen(AI_JOBS)).toBe(true);
  });
});

// ------------------------------------------------------------------------------------------
// Rule 2: untrusted text is routed by data policy, not by preference.

describe("routing untrusted text", () => {
  it("offers no training provider any job that carries untrusted text", () => {
    for (const job of ALL_AI_JOBS) {
      if (!job.sendsUntrustedText) continue;
      const eligible = ALL_AI_PROVIDERS.filter((provider) => routableFor(provider, job));
      expect(
        eligible.filter((provider) => provider.trainsOnInput),
        job.id,
      ).toEqual([]);
    }
  });

  it("allows only providers that do not train on input to read a fetched page", () => {
    const noTraining = ALL_AI_PROVIDERS.filter((provider) => !provider.trainsOnInput);
    for (const job of UNTRUSTED_TEXT_JOBS) {
      const eligible = noTraining.filter((provider) => routableFor(provider, job)).map((p) => p.id);
      expect(eligible, job.id).toEqual(["cloudflare", "bedrock"]);
    }
  });

  it("keeps the owner's preferred order available for structured-facts jobs", () => {
    // Gemini, then Groq, then OpenRouter: the evidence overrides that order only where the prompt
    // carries someone else's text.
    for (const id of ["summarise", "dedupe", "classify_venue", "map_style"] as const) {
      for (const provider of ["gemini", "groq", "openrouter"] as const) {
        expect(routableFor(AI_PROVIDERS[provider], AI_JOBS[id]), `${provider}/${id}`).toBe(true);
      }
    }
  });

  it("treats an unread data policy as the worse case, for every provider", () => {
    // Groq's free-tier policy could not be read, Anthropic's was not covered by the survey at all,
    // Gemini's free tier is reported to feed Google's products, and OpenRouter's free catalogue
    // requires opting into training. Cloudflare's refusal is the only one we have in writing, so
    // it is the only `false` in the table. The adapters agree, which
    // tests/unit/ai-providers.test.ts asserts provider by provider.
    for (const id of ["gemini", "groq", "openrouter", "anthropic"] as const) {
      expect(AI_PROVIDERS[id].trainsOnInput, id).toBe(true);
    }
    expect(AI_PROVIDERS.cloudflare.trainsOnInput).toBe(false);
    expect(AI_PROVIDERS.bedrock.trainsOnInput).toBe(false);
    expect(ALL_AI_PROVIDERS.filter((p) => !p.trainsOnInput).map((p) => p.id)).toEqual([
      "cloudflare",
      "bedrock",
    ]);
  });

  it("never returns a default model for a provider barred from the job", () => {
    for (const providerId of AI_PROVIDER_IDS) {
      const provider = AI_PROVIDERS[providerId];
      for (const jobId of AI_JOB_IDS) {
        if (routableFor(provider, AI_JOBS[jobId])) continue;
        expect(modelFor(providerId, jobId), `${providerId}/${jobId}`).toBeNull();
        expect(defaultModelId(providerId, jobId), `${providerId}/${jobId}`).toBeNull();
      }
    }
  });
});

// ------------------------------------------------------------------------------------------
// The registry itself.

describe("AI_PROVIDERS", () => {
  it("defines exactly the contract's provider ids", () => {
    expect(Object.keys(AI_PROVIDERS).sort()).toEqual([...AI_PROVIDER_IDS].sort());
    expect(ALL_AI_PROVIDERS.map((p) => p.id)).toEqual([...AI_PROVIDER_IDS]);
  });

  it("is keyed by each provider's own id", () => {
    for (const id of AI_PROVIDER_IDS) {
      expect(AI_PROVIDERS[id].id).toBe(id);
    }
  });

  it("carries Cloudflare's verified allowance", () => {
    const quota = AI_PROVIDERS.cloudflare.quota;
    expect(quota.unit).toBe("neuron");
    expect(quota.perDay).toBe(10_000);
    expect(quota.resetUtcHour).toBe(0);
    expect(quota.perMinute).toBe(300);
    expect(quota.verification).toBe("live");
    expect(AI_PROVIDERS.cloudflare.requiresCard).toBe(false);
  });

  it("carries OpenRouter's no-credit figures, not the ones a $10 purchase unlocks", () => {
    const quota = AI_PROVIDERS.openrouter.quota;
    expect(quota.unit).toBe("request");
    expect(quota.perDay).toBe(50); // FREE_MODEL_NO_CREDITS_RPD
    expect(quota.perDay).not.toBe(1_000); // FREE_MODEL_HAS_CREDITS_RPD needs $10, so not $0
    expect(quota.perMinute).toBe(20); // FREE_MODEL_RATE_LIMIT_RPM
    expect(quota.verification).toBe("live");
  });

  it("records no daily figure for the providers whose quotas could not be read", () => {
    for (const id of ["gemini", "groq"] as const) {
      expect(AI_PROVIDERS[id].quota.perDay, id).toBeNull();
      expect(AI_PROVIDERS[id].quota.verification, id).toBe("unverified");
    }
  });

  it("only claims a perDay figure when the verification says it was read", () => {
    for (const provider of ALL_AI_PROVIDERS) {
      if (provider.quota.verification === "unverified") {
        expect(provider.quota.perDay, provider.id).toBeNull();
      }
    }
  });

  it("holds no model table for the providers whose ids must be resolved at runtime", () => {
    // OpenRouter's free catalogue changes weekly, and no Groq model id was ever verified.
    expect(Object.keys(AI_PROVIDERS.openrouter.models)).toEqual([]);
    expect(Object.keys(AI_PROVIDERS.groq.models)).toEqual([]);
  });

  it("marks only the paid providers as needing a card", () => {
    const needCard = ALL_AI_PROVIDERS.filter((p) => p.requiresCard).map((p) => p.id);
    expect(needCard).toEqual(["anthropic", "bedrock"]);
  });

  it("keys every model table entry by the model's own id", () => {
    for (const provider of ALL_AI_PROVIDERS) {
      for (const [key, model] of Object.entries(provider.models)) {
        expect(model.id, `${provider.id}/${key}`).toBe(key);
      }
    }
  });

  it("carries the verified Workers AI neuron rates", () => {
    const expected: Record<string, readonly [number, number | null]> = {
      "@cf/ibm-granite/granite-4.0-h-micro": [1_542, 10_158],
      "@cf/meta/llama-3.1-8b-instruct-fp8-fast": [4_119, 34_868],
      "@cf/zai-org/glm-4.7-flash": [5_500, 36_400],
      "@cf/google/gemma-4-26b-a4b-it": [9_091, 27_273],
      "@cf/openai/gpt-oss-120b": [31_818, 68_182],
      "@cf/meta/llama-3.3-70b-instruct-fp8-fast": [26_668, 204_805],
      "@cf/baai/bge-m3": [1_075, null],
      "@cf/baai/bge-reranker-base": [283, null],
    };
    expect(Object.keys(AI_PROVIDERS.cloudflare.models).sort()).toEqual(
      Object.keys(expected).sort(),
    );
    for (const [id, [input, output]] of Object.entries(expected)) {
      const model = cloudflareModel(id);
      expect(model.neuronsPerMillionInput, id).toBe(input);
      expect(model.neuronsPerMillionOutput, id).toBe(output);
    }
  });

  it("keeps the model that failed re-verification out of every default", () => {
    // @cf/meta/llama-3.1-8b-instruct-fp8-fast: the catalogue fetch 404s, and both its
    // response_format and its advertised 32,000-token context failed re-verification.
    //
    // What keeps it out is the default-model table, not an arithmetic accident. Its recorded
    // context window is CONTEXT_WINDOW_UNVERIFIED, and that means UNKNOWN: reading it as a
    // capacity is what silently rejected every Gemini, OpenRouter and Anthropic model too.
    const suspect = cloudflareModel("@cf/meta/llama-3.1-8b-instruct-fp8-fast");
    expect(suspect.contextWindow).toBe(CONTEXT_WINDOW_UNVERIFIED);
    expect(suspect.supportsJsonSchema).toBe(false);
    for (const jobId of AI_JOB_IDS) {
      expect(defaultModelId("cloudflare", jobId), jobId).not.toBe(suspect.id);
    }
  });

  it("records no neuron rates for providers that meter whole requests", () => {
    for (const id of ["gemini", "groq", "openrouter", "anthropic"] as const) {
      expect(AI_PROVIDERS[id].quota.unit, id).toBe("request");
      for (const model of Object.values(AI_PROVIDERS[id].models)) {
        expect(model.neuronsPerMillionInput, model.id).toBeNull();
        expect(model.neuronsPerMillionOutput, model.id).toBeNull();
      }
    }
  });
});

// ------------------------------------------------------------------------------------------
// modelFor.

describe("modelFor", () => {
  it("resolves every default model id against that provider's own model table", () => {
    for (const providerId of AI_PROVIDER_IDS) {
      const provider = AI_PROVIDERS[providerId];
      for (const jobId of AI_JOB_IDS) {
        const id = defaultModelId(providerId, jobId);
        if (id === null) {
          expect(modelFor(providerId, jobId), `${providerId}/${jobId}`).toBeNull();
          continue;
        }
        const model = modelFor(providerId, jobId);
        expect(model, `${providerId}/${jobId}`).not.toBeNull();
        expect(model?.id, `${providerId}/${jobId}`).toBe(id);
        expect(Object.keys(provider.models), `${providerId}/${jobId}`).toContain(id);
      }
    }
  });

  it("gives every job a Cloudflare default, because Cloudflare is the only always-eligible one", () => {
    for (const jobId of AI_JOB_IDS) {
      expect(modelFor("cloudflare", jobId), jobId).not.toBeNull();
    }
  });

  it("puts extraction and the small jobs on the cheapest verified model", () => {
    for (const jobId of [
      "extract",
      "summarise",
      "dedupe",
      "classify_venue",
      "map_style",
    ] as const) {
      expect(modelFor("cloudflare", jobId)?.id, jobId).toBe("@cf/ibm-granite/granite-4.0-h-micro");
    }
    // Cheapest on both rates among the Workers AI text-generation models.
    const chat = Object.values(AI_PROVIDERS.cloudflare.models).filter(
      (m) => m.neuronsPerMillionOutput !== null,
    );
    const cheapest = chat.reduce((best, m) =>
      (m.neuronsPerMillionInput ?? 0) < (best.neuronsPerMillionInput ?? 0) ? m : best,
    );
    expect(cheapest.id).toBe("@cf/ibm-granite/granite-4.0-h-micro");
  });

  it("puts escalation and submissions on gemma-4", () => {
    for (const jobId of ["escalate", "submission"] as const) {
      expect(modelFor("cloudflare", jobId)?.id, jobId).toBe("@cf/google/gemma-4-26b-a4b-it");
    }
  });

  it("chooses gemma-4 over llama-3.3-70b for reasons that still hold", () => {
    const escalate = AI_JOBS.escalate;
    const submission = AI_JOBS.submission;

    // 1. The flyer path needs vision, and only gemma-4 has it.
    expect(gemma().supportsVision).toBe(true);
    expect(granite().supportsVision).toBe(false);
    expect(llama70b().supportsVision).toBe(false);
    expect(modelFor("cloudflare", submission.id)?.supportsVision).toBe(true);

    // 2. llama-3.3-70b's 24,000-token context cannot hold an escalation at all.
    expect(llama70b().contextWindow).toBe(24_000);
    expect(escalate.estimatedInputTokens + escalate.maxOutputTokens).toBeGreaterThan(24_000);
    expect(
      fitsContextWindow(llama70b(), escalate.estimatedInputTokens, escalate.maxOutputTokens),
    ).toBe(false);
    expect(
      fitsContextWindow(gemma(), escalate.estimatedInputTokens, escalate.maxOutputTokens),
    ).toBe(true);

    // 3. Cost, at both token mixes.
    const atCosts = neuronCost(llama70b(), 6_000, 900) / neuronCost(gemma(), 6_000, 900);
    expect(atCosts).toBeCloseTo(4.354, 3); // "4.4x cheaper" at the COSTS.md mix
    const atCap =
      neuronCost(llama70b(), escalate.estimatedInputTokens, escalate.maxOutputTokens) /
      neuronCost(gemma(), escalate.estimatedInputTokens, escalate.maxOutputTokens);
    expect(atCap).toBeCloseTo(6.583, 3); // and 6.6x cheaper at our escalation cap
  });

  it("gives every Cloudflare default a verified context window that fits its job", () => {
    for (const jobId of AI_JOB_IDS) {
      const model = modelFor("cloudflare", jobId);
      expect(model, jobId).not.toBeNull();
      const job = AI_JOBS[jobId];
      expect(model?.contextWindow ?? 0, jobId).toBeGreaterThan(CONTEXT_WINDOW_UNVERIFIED);
      expect(
        fitsContextWindow(model as AiModel, job.estimatedInputTokens, job.maxOutputTokens),
        jobId,
      ).toBe(true);
    }
  });

  it("sends Gemini only the structured-facts jobs, on the high-volume model", () => {
    for (const jobId of ["summarise", "dedupe", "classify_venue", "map_style"] as const) {
      expect(modelFor("gemini", jobId)?.id, jobId).toBe("gemini-3.5-flash-lite");
    }
    for (const jobId of ["extract", "escalate", "submission"] as const) {
      expect(modelFor("gemini", jobId), jobId).toBeNull();
    }
  });

  it("excludes Groq from extraction and escalation on its own token ceiling", () => {
    // 8,000 tokens/minute (reported) against an 8,000-token extraction prompt, and PLAN 6.5 caps
    // cleaned page text at ~12,000 tokens, which exceeds the ceiling before any reply is written.
    const GROQ_TOKENS_PER_MINUTE = 8_000;
    const PLAN_6_5_TEXT_CAP = 12_000;
    expect(PLAN_6_5_TEXT_CAP).toBeGreaterThan(GROQ_TOKENS_PER_MINUTE);
    for (const jobId of ["extract", "escalate"] as const) {
      expect(modelFor("groq", jobId), jobId).toBeNull();
      expect(
        AI_JOBS[jobId].estimatedInputTokens + AI_JOBS[jobId].maxOutputTokens,
        jobId,
      ).toBeGreaterThan(GROQ_TOKENS_PER_MINUTE);
    }
    // A submission is small enough to fit the ceiling; it is excluded by the data policy instead,
    // which is why the registry needs both reasons rather than either one alone.
    expect(
      AI_JOBS.submission.estimatedInputTokens + AI_JOBS.submission.maxOutputTokens,
    ).toBeLessThan(GROQ_TOKENS_PER_MINUTE);
    expect(routableFor(AI_PROVIDERS.groq, AI_JOBS.submission)).toBe(false);
    expect(modelFor("groq", "submission")).toBeNull();
  });

  it("returns null for OpenRouter everywhere, since its free ids resolve at runtime", () => {
    for (const jobId of AI_JOB_IDS) {
      expect(modelFor("openrouter", jobId), jobId).toBeNull();
    }
  });

  it("keeps D-007's roles for the paid fallback, minus the jobs its data policy bars", () => {
    // D-007 gave Anthropic extract and escalate too. Those are null now: Anthropic's data policy
    // was never read, the registry records `trainsOnInput: true` for it on that ground, and a
    // provider that may train on input gets no job carrying someone else's page text whatever it
    // costs. Restore the three nulls only together with a read policy.
    const roles: Record<AiJobId, string | null> = {
      extract: null,
      escalate: null,
      submission: null,
      summarise: "claude-haiku-4-5",
      dedupe: "claude-haiku-4-5",
      classify_venue: "claude-haiku-4-5",
      map_style: "claude-haiku-4-5",
    };
    for (const jobId of AI_JOB_IDS) {
      expect(modelFor("anthropic", jobId)?.id ?? null, jobId).toBe(roles[jobId]);
    }
  });

  it("returns null rather than a stale id when a model leaves a table", () => {
    const missing = modelFor("openrouter", "summarise");
    expect(missing).toBeNull();
  });
});

// ------------------------------------------------------------------------------------------

describe("fitsContextWindow", () => {
  it("accepts a job that fits a verified window and rejects one that does not", () => {
    expect(fitsContextWindow(granite(), 8_000, 10_500)).toBe(true);
    expect(fitsContextWindow(granite(), 131_000, 1)).toBe(false);
    expect(fitsContextWindow(granite(), 131_000, 0)).toBe(true);
  });

  it("allows an unknown window rather than reading zero as zero capacity", () => {
    // CONTEXT_WINDOW_UNVERIFIED is 0 and means UNKNOWN. It used to mean "holds nothing", and the
    // cost of that reading was the whole module: every Gemini, OpenRouter and Anthropic model
    // carries it, so the resolver rejected all of them and the owner's preferred chain could
    // never run. The gate applies only to a window we actually measured.
    const unknown: AiProviderId[] = ["gemini", "anthropic"];
    for (const id of unknown) {
      for (const model of Object.values(AI_PROVIDERS[id].models)) {
        expect(model.contextWindow, model.id).toBe(CONTEXT_WINDOW_UNVERIFIED);
        expect(fitsContextWindow(model, 1, 1), model.id).toBe(true);
        expect(fitsContextWindow(model, 900_000, 900_000), model.id).toBe(true);
      }
    }
  });

  it("says once per model that a limit is unknown, rather than once per call", () => {
    resetUnknownContextWindowLog();
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      const model = AI_PROVIDERS.gemini.models["gemini-2.5-flash-lite"];
      expect(model).toBeDefined();
      for (let i = 0; i < 5; i += 1) fitsContextWindow(model as AiModel, 1, 1);
      const lines = info.mock.calls.filter((call) =>
        String(call[0]).includes("ai_context_window_unknown"),
      );
      expect(lines).toHaveLength(1);
      expect(String(lines[0]?.[0])).toContain("gemini-2.5-flash-lite");
    } finally {
      info.mockRestore();
    }
  });

  it("gives the escalation a model that is not the one that just failed (D-039)", () => {
    // An escalation that re-runs the identical cheap model is not an escalation. granite is the
    // extract default; gemma-4 is the escalate default, and the only Workers AI model whose
    // context can hold one (10,400 in + 13,650 out = 24,050, against llama-3.3-70b's 24,000).
    expect(defaultModelId("cloudflare", "extract")).toBe("@cf/ibm-granite/granite-4.0-h-micro");
    expect(defaultModelId("cloudflare", "escalate")).toBe("@cf/google/gemma-4-26b-a4b-it");
    expect(defaultModelId("cloudflare", "escalate")).not.toBe(
      defaultModelId("cloudflare", "extract"),
    );
    const escalate = AI_JOBS.escalate;
    const model = modelFor("cloudflare", "escalate");
    expect(model).not.toBeNull();
    expect(
      fitsContextWindow(model as AiModel, escalate.estimatedInputTokens, escalate.maxOutputTokens),
    ).toBe(true);
  });
});
