// The public surface of the zero-cost AI layer (D-039).
//
// The pipeline imports from here and nowhere else inside `src/ai`. It gets the contract types, the
// job table, the provider registry, the quota ledger, the adapters and the orchestrating client.
//
// THE EXAMPLE BELOW COMPILES. It named `allAiProviders()` before that function existed, which is
// the kind of wiring note that is worse than none: a reader follows it, it does not resolve, and
// they go looking for the real entry point. `tests/unit/ai-client.test.ts` executes exactly these
// lines in mock mode, so the example cannot drift away from the code again.
//
//   import { allAiProviders, createAiClient, jobById } from "@/src/ai";
//
//   const client = createAiClient({ providers: allAiProviders() });
//   const outcome = await client.run(
//     { job: jobById("summarise"), system, user, schema, jsonSchema },
//     { metro: "nyc" },
//   );
//   if (!outcome.ok && outcome.reason === "quota_exhausted") defer();   // expected, not an error
//
// `createAiClient` builds its own ledger from the environment when none is passed, and runs in
// mock mode (D-011) whenever `isMockMode()` says so, which is what makes the line above safe to
// run with no keys at all. Pass `ledger` when several clients must share one day's accounting.

export {
  AI_JOB_IDS,
  AI_PROVIDER_IDS,
  aiUsageSchema,
  routableFor,
  type AiFailure,
  type AiJob,
  type AiJobId,
  type AiModel,
  type AiOutcome,
  type AiProvider,
  type AiProviderId,
  type AiProviderMeta,
  type AiRequest,
  type AiUsage,
  type QuotaPolicy,
  type QuotaUnit,
} from "@/src/ai/types";

export {
  ACCOUNT_SCOPE,
  DEFAULT_DAILY_NEURON_BUDGET,
  DEFAULT_DAILY_REQUEST_BUDGET,
  DEFAULT_RESERVATION_TTL_MS,
  createInMemoryQuotaStore,
  createQuotaLedger,
  defaultBudgetConfig,
  defaultMetroCap,
  metroScope,
  quotaDayEndsAt,
  quotaDayKey,
  readAiBudgetConfig,
  type AiBudgetConfig,
  type AiBudgetConfigResult,
  type AddWithinCeiling,
  type InMemoryQuotaStore,
  type LedgerCallOptions,
  type QuotaCeilings,
  type QuotaExhaustedEvent,
  type QuotaKey,
  type QuotaLedger,
  type QuotaLedgerOptions,
  type QuotaRemaining,
  type QuotaStore,
  type Reservation,
  type ReserveOutcome,
} from "@/src/ai/ledger";

export {
  DEFAULT_PROVIDER_ORDER,
  MOCK_MODEL_ID,
  consoleAiLogger,
  consoleNotifier,
  createAiClient,
  defaultModelResolver,
  mockValueFromJsonSchema,
  readProviderOrder,
  silentAiLogger,
  silentNotifier,
  type AiChain,
  type AiChainEntry,
  type AiChainSkip,
  type AiClient,
  type AiClientOptions,
  type AiLogEvent,
  type AiLogger,
  type AiRunOptions,
  type ModelResolver,
  type Notifier,
  type ProviderOrderResult,
} from "@/src/ai/client";

export {
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

export {
  AI_PROVIDERS,
  ALL_AI_PROVIDERS,
  CLOUDFLARE_NEURONS_PER_DAY,
  CLOUDFLARE_NEURON_RATES,
  CLOUDFLARE_REQUESTS_PER_MINUTE,
  CONTEXT_WINDOW_UNVERIFIED,
  defaultModelId,
  fitsContextWindow,
  modelFor,
  neuronCost,
  providerMeta,
  type CloudflareNeuronRate,
} from "@/src/ai/registry";

export {
  aiProvider,
  aiProviders,
  allAiProviders,
  createAiProviders,
  defangUntrustedTags,
  guardedSystem,
  untrustedBlock,
  wrapUntrusted,
  type AiEnv,
  type ProviderOptions,
  type UntrustedBlock,
} from "@/src/ai/providers/index";
