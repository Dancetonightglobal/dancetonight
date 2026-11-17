// The orchestrator: pick a provider, stay inside the free tier, and defer rather than fail.
//
// `run()` walks the configured chain (AI_PROVIDER_ORDER, default
// "gemini,groq,openrouter,cloudflare") and returns the first `ok` outcome. Three filters stand
// between a provider and a job, and the order of the filters is the point of this file:
//
//  1. DATA POLICY (`routableFor`, contract rule 2). `extract`, `escalate` and `submission` send
//     other people's page text. Of the free providers only Cloudflare states, with no free-tier
//     carve-out, that it "does not use your Customer Content to (1) train any AI models ... or
//     (2) improve any Cloudflare or third-party services". So those jobs reach Cloudflare and
//     nowhere else, whatever the configured order says -- the owner's preferred order (Gemini,
//     Groq, OpenRouter) still governs every job that sends only our own structured facts. Each
//     drop is logged with its reason, so a reader discovers from the logs that extraction never
//     reaches OpenRouter.
//  2. CREDENTIALS (`isConfigured`). No key, no chain entry.
//  3. QUOTA (the ledger). Checked by reserving before the call, so two callers cannot both spend
//     the last of the day.
//
// When every eligible provider is out of allowance the answer is
// `{ ok: false, reason: "quota_exhausted" }`. That is the expected daily outcome, not an error:
// the pipeline defers the page and the deterministic adapters carry on. Nothing here throws for
// it, and nothing here throws for a provider that does.
//
// In mock mode (D-011) no provider is touched at all: the reply is a deterministic value built
// from the request's own JSON Schema, so `pnpm dev`, the seeded app and the tests never reach a
// vendor and never need a key.

import { z } from "zod";

import {
  createQuotaLedger,
  readAiBudgetConfig,
  type LedgerCallOptions,
  type QuotaExhaustedEvent,
  type QuotaLedger,
  type Reservation,
} from "@/src/ai/ledger";
import { fitsContextWindow, modelFor, providerMeta } from "@/src/ai/registry";
import {
  AI_PROVIDER_IDS,
  isTimeoutDetail,
  routableFor,
  type AiFailure,
  type AiJob,
  type AiJobId,
  type AiModel,
  type AiOutcome,
  type AiProvider,
  type AiProviderId,
  type AiRequest,
  type AiUsage,
} from "@/src/ai/types";
import { isMockMode, type Env, type EnvProblem } from "@/src/config/env";

// --- The configured order --------------------------------------------------------------------

/**
 * The owner's order: Gemini, then Groq, then OpenRouter, then Cloudflare.
 *
 * Two reasons, and both point the same way. The owner asked for that preference and it governs
 * every job that sends only our own structured facts. Separately it is the better engineering:
 * Cloudflare's 10,000 neurons are the only free allowance anyone verified AND Cloudflare is the
 * only provider permitted to read third-party page text, so spending them on summaries would
 * starve the one job nothing else may do.
 *
 * CLOUDFLARE BEING LAST DOES NOT WEAKEN THE TERMS GUARANTEE. `chainFor()` applies
 * `routableFor()` before the order is consulted, so an untrusted-text job reaches Cloudflare and
 * nowhere else whatever this array says -- including when Cloudflare is last, which
 * `tests/unit/ai-client.test.ts` asserts against this very default.
 */
export const DEFAULT_PROVIDER_ORDER: readonly AiProviderId[] = [
  "gemini",
  "groq",
  "openrouter",
  "cloudflare",
];

export interface ProviderOrderResult {
  readonly order: readonly AiProviderId[];
  readonly problems: EnvProblem[];
}

/** Parses AI_PROVIDER_ORDER without throwing: unknown or repeated entries drop, the rest stand. */
export function readProviderOrder(
  source: Record<string, string | undefined> = process.env,
): ProviderOrderResult {
  const raw = source.AI_PROVIDER_ORDER;
  const problems: EnvProblem[] = [];
  if (raw === undefined || raw.trim() === "") return { order: DEFAULT_PROVIDER_ORDER, problems };
  const order: AiProviderId[] = [];
  for (const entry of raw.split(",").map((s) => s.trim())) {
    if (entry === "") continue;
    if (!(AI_PROVIDER_IDS as readonly string[]).includes(entry)) {
      problems.push({
        variable: "AI_PROVIDER_ORDER",
        message: `unknown provider ${JSON.stringify(entry)}`,
      });
      continue;
    }
    const id = entry as AiProviderId;
    if (order.includes(id)) {
      problems.push({
        variable: "AI_PROVIDER_ORDER",
        message: `repeated provider ${JSON.stringify(entry)}`,
      });
      continue;
    }
    order.push(id);
  }
  if (order.length === 0) {
    problems.push({
      variable: "AI_PROVIDER_ORDER",
      message: "no known provider named; using the default order",
    });
    return { order: DEFAULT_PROVIDER_ORDER, problems };
  }
  return { order, problems };
}

// --- Logging ---------------------------------------------------------------------------------

/**
 * One structured line per decision. Deliberately narrow: it carries identifiers, counts and the
 * running day total, and never a prompt, a page, a reply or a credential.
 */
export interface AiLogEvent {
  readonly event: "ai_call" | "ai_skip" | "ai_refused" | "ai_mock";
  readonly job: AiJobId;
  readonly provider: AiProviderId | null;
  readonly model: string | null;
  readonly metro: string | null;
  readonly outcome: "ok" | "skipped" | AiFailure;
  /** Why a provider was skipped or a call failed, in words a reader can act on. No page text. */
  readonly reason?: string;
  readonly usage?: AiUsage;
  readonly dayKey?: string;
  /** The provider's running total for the day, in its own unit, after this call. */
  readonly dayTotal?: number;
  readonly dayCeiling?: number;
  readonly durationMs?: number;
}

export interface AiLogger {
  debug(event: AiLogEvent): void;
  info(event: AiLogEvent): void;
}

/** The default logger: one JSON object per line, on console.debug and console.info. */
export const consoleAiLogger: AiLogger = {
  debug(event) {
    console.debug(`ai ${JSON.stringify(event)}`);
  },
  info(event) {
    console.info(`ai ${JSON.stringify(event)}`);
  },
};

export const silentAiLogger: AiLogger = { debug() {}, info() {} };

// --- Telling the owner the day ran out ---------------------------------------------------------

/**
 * Who hears that a provider's daily ceiling has bound.
 *
 * The interface itself lives in `src/ai/ledger.ts` beside the event it carries, and is
 * re-exported here so a caller wiring a client does not need to know that. Two copies of it
 * existed briefly, which is how the subscription below came to be missed on one path.
 */
export type { Notifier } from "@/src/ai/ledger";
export { silentNotifier } from "@/src/ai/ledger";

import type { Notifier } from "@/src/ai/ledger";

/**
 * The notifier we ship: one structured line, at info, naming the provider, the day and the
 * ceiling that bound.
 *
 * EMAIL DELIVERY WAITS ON A SENDING DOMAIN. D-023 chose Resend for transactional email, and
 * D-035's answer to Q2 is that there is no domain yet -- the site runs on Vercel's preview
 * address and "Email sending (D-023) waits for a domain". Until one exists there is nowhere to
 * send from, so this logs, and the swap is one implementation of this interface.
 */
export const consoleNotifier: Notifier = {
  quotaExhausted(event) {
    console.info(
      `ai ${JSON.stringify({
        event: "ai_quota_exhausted",
        provider: event.provider,
        dayKey: event.dayKey,
        unit: event.unit,
        ceiling: event.ceiling,
        used: event.used,
        at: event.at.toISOString(),
        reason:
          "the day's allowance for this provider is spent; untrusted-text jobs defer until reset",
      })}`,
    );
  },
};

// --- Model choice ----------------------------------------------------------------------------

/**
 * Which model a provider should use for a job.
 *
 * THE REGISTRY DECIDES. `modelFor()` in `src/ai/registry.ts` holds the argued default per provider
 * per job, and this resolver asks it rather than re-deriving an answer from the model table. The
 * previous resolver searched for the cheapest model declaring JSON Schema support, and two of its
 * answers were wrong in ways that mattered:
 *
 *   * ESCALATION RESOLVED TO GRANITE, the same cheap model whose failure caused the escalation, so
 *     the escalation pass re-ran the identical call and the whole path was pointless. The registry
 *     names @cf/google/gemma-4-26b-a4b-it, which is what PLAN 8.2 costed and the only Workers AI
 *     model whose 256,000-token context can hold an escalation at all.
 *   * IT REJECTED EVERY GEMINI, OPENROUTER AND ANTHROPIC MODEL, because those carry
 *     `contextWindow: 0` meaning UNKNOWN and the comparison read it as "holds nothing". The
 *     owner's preferred chain could never run.
 *
 * What is left here is the check the registry cannot make, because it depends on the request
 * rather than on the job: vision. And the context window is a gate only when it is a measurement
 * (`fitsContextWindow`, which logs once when the limit is unknown rather than pretending it is 0).
 */
export type ModelResolver = (
  provider: AiProvider,
  job: AiJob,
  needsVision: boolean,
) => AiModel | null;

export const defaultModelResolver: ModelResolver = (provider, job, needsVision) => {
  const model = modelFor(provider.meta.id, job.id);
  if (model === null) return null;
  if (needsVision && !model.supportsVision) return null;
  if (!fitsContextWindow(model, job.estimatedInputTokens, job.maxOutputTokens)) return null;
  return model;
};

// --- Mock mode -------------------------------------------------------------------------------

export const MOCK_MODEL_ID = "mock";

const MAX_MOCK_DEPTH = 12;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * A deterministic value satisfying a JSON Schema: the first enum member, the shortest legal
 * string, the smallest legal number, and the shortest legal array. For the extraction schema
 * that is an empty `listings` array, which is exactly the "this page had nothing" answer the
 * seeded app wants -- no invented listings, per "never invent a fact".
 */
export function mockValueFromJsonSchema(schema: unknown, depth = 0): unknown {
  const node = asRecord(schema);
  if (node === null || depth > MAX_MOCK_DEPTH) return null;
  if ("const" in node) return node.const;
  const enumValues = node.enum;
  if (Array.isArray(enumValues) && enumValues.length > 0) return enumValues[0];
  for (const key of ["anyOf", "oneOf", "allOf"] as const) {
    const branches = node[key];
    if (Array.isArray(branches) && branches.length > 0) {
      // The first branch, always: "deterministic" matters more than "interesting" here.
      return mockValueFromJsonSchema(branches[0], depth + 1);
    }
  }
  const declared = node.type;
  const type = Array.isArray(declared)
    ? (declared.find((entry) => entry !== "null") ?? "null")
    : declared;
  if (type === "object" || (type === undefined && asRecord(node.properties) !== null)) {
    const properties = asRecord(node.properties) ?? {};
    const required = Array.isArray(node.required)
      ? node.required.map(String)
      : Object.keys(properties);
    const out: Record<string, unknown> = {};
    for (const name of required) {
      if (name in properties) out[name] = mockValueFromJsonSchema(properties[name], depth + 1);
    }
    return out;
  }
  if (type === "array") {
    const minItems = typeof node.minItems === "number" ? node.minItems : 0;
    const items = node.items;
    return Array.from({ length: minItems }, () => mockValueFromJsonSchema(items, depth + 1));
  }
  if (type === "string") {
    const minLength = typeof node.minLength === "number" ? node.minLength : 0;
    if (node.format === "uri" || node.format === "url") return "https://example.com/mock";
    if (node.format === "email") return "mock@example.com";
    if (node.format === "date") return "1970-01-01";
    if (node.format === "date-time") return "1970-01-01T00:00:00.000Z";
    return "mock".padEnd(minLength, "x").slice(0, Math.max(4, minLength));
  }
  if (type === "number" || type === "integer") {
    const minimum = typeof node.minimum === "number" ? node.minimum : 0;
    const exclusive = typeof node.exclusiveMinimum === "number" ? node.exclusiveMinimum + 1 : null;
    return Math.max(minimum, exclusive ?? minimum);
  }
  if (type === "boolean") return false;
  return null;
}

// --- The client ------------------------------------------------------------------------------

export type AiRunOptions = LedgerCallOptions;

export interface AiChainEntry {
  readonly provider: AiProvider;
  readonly model: AiModel;
}

export interface AiChainSkip {
  readonly provider: AiProviderId;
  readonly reason: string;
}

export interface AiChain {
  readonly eligible: readonly AiChainEntry[];
  readonly skipped: readonly AiChainSkip[];
}

export interface AiClientOptions {
  /** The provider implementations, in any order; the chain order comes from the configuration. */
  readonly providers: readonly AiProvider[];
  readonly ledger?: QuotaLedger;
  readonly order?: readonly AiProviderId[];
  readonly logger?: AiLogger;
  /**
   * Who hears that a day's allowance has bound. Wired to the ledger's `onExhausted` when the
   * client builds its own ledger; a caller passing a ready-made ledger wires its own.
   */
  readonly notifier?: Notifier;
  readonly modelResolver?: ModelResolver;
  /** Overrides the derivation from the environment; tests and the seeded app set it. */
  readonly mock?: boolean;
  readonly env?: Env;
  readonly now?: () => Date;
}

export interface AiClient {
  readonly ledger: QuotaLedger;
  readonly order: readonly AiProviderId[];
  readonly mock: boolean;
  /** Which providers may serve this job, and why the others may not. */
  chainFor(job: AiJob, needsVision?: boolean): AiChain;
  run<T>(request: AiRequest<T>, options: AiRunOptions): Promise<AiOutcome<T>>;
}

function failure<T>(
  reason: AiFailure,
  provider: AiProviderId | null,
  detail: string,
): AiOutcome<T> & { ok: false } {
  return { ok: false, reason, provider, detail };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createAiClient(options: AiClientOptions): AiClient {
  const logger = options.logger ?? consoleAiLogger;
  const modelResolver = options.modelResolver ?? defaultModelResolver;
  const now = options.now ?? (() => new Date());
  const notifier = options.notifier ?? consoleNotifier;
  // The notifier is subscribed whether the ledger is ours or the caller's. It used to be wired
  // only inside the fallback below, so passing a ledger -- which is what a real pipeline does --
  // silently discarded the owner's "tell me when the ceiling binds".
  const announce = (event: QuotaExhaustedEvent) => {
    notifier.quotaExhausted(event);
  };
  const ledger = options.ledger ?? createQuotaLedger({ config: readAiBudgetConfig(), now });
  ledger.onExhausted(announce);
  const order = options.order ?? readProviderOrder().order;
  const mock = options.mock ?? isMockMode(options.env);
  const byId = new Map(options.providers.map((provider) => [provider.meta.id, provider]));

  function chainFor(job: AiJob, needsVision = false): AiChain {
    const eligible: AiChainEntry[] = [];
    const skipped: AiChainSkip[] = [];
    for (const id of order) {
      const provider = byId.get(id);
      if (provider === undefined) {
        skipped.push({ provider: id, reason: "not registered in this build" });
        continue;
      }
      if (!routableFor(provider.meta, job)) {
        skipped.push({
          provider: id,
          reason: `data policy: ${provider.meta.label} may train on what we send, and ${job.id} sends untrusted page text`,
        });
        continue;
      }
      if (!provider.isConfigured()) {
        skipped.push({ provider: id, reason: "no credentials in this environment" });
        continue;
      }
      const model = modelResolver(provider, job, needsVision);
      if (model === null) {
        skipped.push({
          provider: id,
          reason: needsVision
            ? "no model with a verified context window, JSON Schema support and vision"
            : "no model with a verified context window and JSON Schema support for this job",
        });
        continue;
      }
      eligible.push({ provider, model });
    }
    return { eligible, skipped };
  }

  function logSkips(job: AiJob, metro: string | null, skips: readonly AiChainSkip[]): void {
    for (const skip of skips) {
      logger.debug({
        event: "ai_skip",
        job: job.id,
        provider: skip.provider,
        model: null,
        metro,
        outcome: "skipped",
        reason: skip.reason,
      });
    }
  }

  async function runMock<T>(request: AiRequest<T>, metro: string): Promise<AiOutcome<T>> {
    const job = request.job;
    // The first provider the job's data policy allows, so the canned reply names a provider the
    // real chain could have used. No provider object is touched and no request is made.
    // Routability is judged from the REGISTRY, not from what happens to be registered: mock mode
    // is first class (D-011) and the seeded app registers no providers at all, so asking `byId`
    // would leave it with nothing to name. Asking the registry still tells the truth, because the
    // data policy is a property of the provider and not of our wiring. The old code fell back to
    // `order[0]`, which could label an untrusted-text reply with a training provider.
    const provider = order.find((id) => routableFor(providerMeta(id), job));
    if (provider === undefined) {
      return failure<T>(
        "no_eligible_provider",
        null,
        `no provider in the configured order may receive ${job.id}`,
      );
    }
    const usage: AiUsage = {
      inputTokens: job.estimatedInputTokens,
      outputTokens: 0,
      cost: 0,
      unit: "request",
    };
    const candidate = mockValueFromJsonSchema(request.jsonSchema);
    const parsed = request.schema.safeParse(candidate);
    if (!parsed.success) {
      logger.info({
        event: "ai_mock",
        job: job.id,
        provider,
        model: MOCK_MODEL_ID,
        metro,
        outcome: "schema_mismatch",
        reason: "the canned value built from jsonSchema did not satisfy the request schema",
      });
      return failure<T>(
        "schema_mismatch",
        provider,
        `mock mode could not build a value satisfying the schema: ${z.prettifyError(parsed.error)}`,
      );
    }
    logger.info({
      event: "ai_mock",
      job: job.id,
      provider,
      model: MOCK_MODEL_ID,
      metro,
      outcome: "ok",
      usage,
      reason: "mock mode (D-011): no network call",
    });
    return { ok: true, value: parsed.data, provider, model: MOCK_MODEL_ID, usage };
  }

  /**
   * The failures a second attempt at the same provider and model can fix.
   *
   * D-039 says every reply is validated and retried once before escalating, and COSTS.md reserves
   * 15% of the day's budget for exactly that. Neither was implemented. These two are the retryable
   * ones and the reason is the same for both: Workers AI documents JSON mode as best effort ("Workers
   * AI can't guarantee that the model responds according to the requested JSON Schema"), so a reply
   * that failed the schema or stopped short is often a sampling accident rather than a property of
   * the model. `provider_error` and `quota_exhausted` are not retried: those are the vendor telling
   * us something, and repeating the call would spend the day arguing with it.
   */
  function isRetryable(reason: AiFailure): boolean {
    return reason === "schema_mismatch" || reason === "truncated";
  }

  async function callProvider<T>(
    provider: AiProvider,
    request: AiRequest<T>,
    model: AiModel,
    reservation: Reservation,
    context: { metro: string; at: Date },
  ): Promise<AiOutcome<T>> {
    const started = Date.now();
    let outcome: AiOutcome<T>;
    try {
      outcome = await provider.call(request, model);
    } catch (error) {
      // A provider that throws is a provider error, never an exception out of run().
      outcome = failure<T>("provider_error", provider.meta.id, messageOf(error));
    }
    // Always settles the reservation, on every path, so a failed call cannot leak the day away.
    //
    // A reply that arrived and failed validation COST THE VENDOR TOKENS, so it stays charged at
    // its estimate rather than being refunded: refunding it made the ledger under-report real
    // spend by one call per retry, and the whole zero-cost claim rests on that number being
    // honest. Only a call that never reached the vendor is released.
    // A call that timed out is charged too: the vendor keeps generating after we stop waiting.
    // A failed reply that arrived carries the vendor's own count; that is what it cost (D-057).
    if (outcome.ok) await ledger.reconcile(reservation, outcome.usage);
    else if (outcome.usage) await ledger.reconcile(reservation, outcome.usage);
    else if (
      outcome.reason === "schema_mismatch" ||
      outcome.reason === "truncated" ||
      (outcome.reason === "provider_error" && isTimeoutDetail(outcome.detail))
    )
      await ledger.reconcile(reservation, reservation.estimate);
    else await ledger.release(reservation);

    const state = await ledger.remaining(provider.meta, context);
    logger.info({
      event: "ai_call",
      job: request.job.id,
      provider: provider.meta.id,
      model: model.id,
      metro: context.metro,
      outcome: outcome.ok ? "ok" : outcome.reason,
      reason: outcome.ok ? undefined : outcome.detail,
      usage: outcome.ok ? outcome.usage : undefined,
      dayKey: state.dayKey,
      dayTotal: state.accountUsed,
      dayCeiling: state.ceilings.account,
      durationMs: Date.now() - started,
    });
    return outcome;
  }

  return {
    ledger,
    order,
    mock,
    chainFor,

    async run<T>(request: AiRequest<T>, runOptions: AiRunOptions): Promise<AiOutcome<T>> {
      const job = request.job;
      const metro = runOptions.metro;

      // FLYER AND IMAGE SUBMISSIONS ARE OUT OF SCOPE FOR VERSION 1.
      //
      // `AiRequest.images` stays on the contract for a later version, but nothing may act on it
      // now. D-035, answer to Q3: "no flyer uploads in version 1 ... The flyer path of /submit
      // (image upload) is out of v1 scope; URL and pasted-text submissions stay." So the
      // submission job handles a URL or pasted text, and a request carrying images is refused
      // here, once, with a reason a caller can show a visitor -- rather than failing four
      // providers down the chain because none of them was given an image path.
      if ((request.images?.length ?? 0) > 0) {
        logger.info({
          event: "ai_refused",
          job: job.id,
          provider: null,
          model: null,
          metro,
          outcome: "disabled",
          reason: "image input is out of scope for version 1 (D-035)",
        });
        return failure<T>(
          "disabled",
          null,
          "flyer and image submissions are out of scope for version 1 (D-035): " +
            "send the event's URL or paste its text instead",
        );
      }

      if (mock) return runMock(request, metro);

      // Never vision: the only job that would have wanted it is the flyer path, refused above.
      // `chainFor` keeps the parameter so the version that restores flyers has somewhere to put it.
      const chain = chainFor(job, false);
      logSkips(job, metro, chain.skipped);
      if (chain.eligible.length === 0) {
        return failure<T>(
          "no_eligible_provider",
          null,
          `no provider is eligible for ${job.id}: ${chain.skipped
            .map((skip) => `${skip.provider} (${skip.reason})`)
            .join("; ")}`,
        );
      }

      const at = runOptions.at ?? now();
      let lastFailure: (AiOutcome<T> & { ok: false }) | null = null;
      let refusals = 0;

      for (const { provider, model } of chain.eligible) {
        const meta = provider.meta;
        const reserved = await ledger.reserve(provider, job, model, { metro, at });
        if (!reserved.ok) {
          refusals += 1;
          logger.info({
            event: "ai_refused",
            job: job.id,
            provider: meta.id,
            model: model.id,
            metro,
            outcome: "quota_exhausted",
            reason: `${reserved.scope} allowance would be exceeded: ${reserved.used} + ${reserved.estimate} > ${reserved.ceiling} ${reserved.unit}s`,
            dayKey: reserved.dayKey,
            dayTotal: reserved.used,
            dayCeiling: reserved.ceiling,
          });
          continue;
        }

        let outcome = await callProvider(provider, request, model, reserved.reservation, {
          metro,
          at,
        });

        // One retry, on the same provider and the same model, before moving down the chain
        // (D-039). It reserves and reconciles like any other call, so the day's budget sees it:
        // COSTS.md already holds 15% of the day back for these.
        if (!outcome.ok && isRetryable(outcome.reason)) {
          const retryReserved = await ledger.reserve(provider, job, model, { metro, at });
          if (retryReserved.ok) {
            logger.debug({
              event: "ai_call",
              job: job.id,
              provider: meta.id,
              model: model.id,
              metro,
              outcome: outcome.reason,
              reason: `retrying once on ${meta.id} before the next provider (D-039)`,
            });
            const retried = await callProvider(
              provider,
              request,
              model,
              retryReserved.reservation,
              { metro, at },
            );
            if (retried.ok) return retried;
            outcome = retried;
          }
        }

        if (outcome.ok) return outcome;
        lastFailure = outcome;
        if (outcome.reason === "quota_exhausted") {
          // The vendor said the allowance is gone before our ceiling did: believe the vendor.
          refusals += 1;
          await ledger.markExhausted(meta, { metro, at });
        }
      }

      if (lastFailure !== null && lastFailure.reason !== "quota_exhausted") return lastFailure;
      return failure<T>(
        "quota_exhausted",
        null,
        `every eligible provider for ${job.id} is out of allowance today (${refusals} of ${chain.eligible.length} refused)`,
      );
    },
  };
}
