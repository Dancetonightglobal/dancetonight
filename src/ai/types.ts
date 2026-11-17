// The AI provider contract (D-039, superseding D-007's paid model roles).
//
// Three rules shape this file, and each one came from a verified finding:
//
//  1. QUOTA IS COUNTED, NOT PRICED. Every free tier meters something other than money, and the
//     units differ: Cloudflare Workers AI bills "neurons" derived from token counts, everyone
//     else bills whole requests. The ledger therefore reserves in a provider's own unit before
//     a call and reconciles afterwards, because output length is not known in advance.
//
//  2. UNTRUSTED TEXT IS ROUTED BY DATA POLICY, NOT BY PREFERENCE. Extraction sends other
//     people's page text to a model. Only a provider that contractually does not train on input
//     may receive it, whatever the configured order says. `routableFor()` enforces this.
//
//  3. `maxOutputTokens` IS ALWAYS EXPLICIT. Workers AI defaults it to 256, which silently
//     truncates every extraction into unparseable JSON. There is no default here; the type
//     makes omitting it a compile error.

import { z } from "zod";

export const AI_PROVIDER_IDS = [
  "cloudflare",
  "gemini",
  "groq",
  "openrouter",
  "anthropic",
  "bedrock",
] as const;
export type AiProviderId = (typeof AI_PROVIDER_IDS)[number];

/** Every job the pipeline asks a model to do (PLAN.md 6 to 8). */
export const AI_JOB_IDS = [
  "extract",
  "escalate",
  "summarise",
  "dedupe",
  "classify_venue",
  "map_style",
  "submission",
] as const;
export type AiJobId = (typeof AI_JOB_IDS)[number];

export interface AiJob {
  readonly id: AiJobId;
  /**
   * True when the prompt carries text we fetched from someone else's page or a visitor's
   * submission. Such a job may only reach a provider whose terms forbid training on input.
   */
  readonly sendsUntrustedText: boolean;
  /** Never omitted: see rule 3 above. */
  readonly maxOutputTokens: number;
  /** Rough input size used to reserve quota before the call; reconciled after. */
  readonly estimatedInputTokens: number;
  readonly description: string;
}

/** What a provider meters. Cloudflare counts neurons; the rest count whole requests. */
export type QuotaUnit = "neuron" | "request" | "microdollar";

export interface QuotaPolicy {
  readonly unit: QuotaUnit;
  /** Free allowance per day, in `unit`. Null when the vendor publishes no figure we could verify. */
  readonly perDay: number | null;
  /** Hour (UTC) at which the allowance resets. */
  readonly resetUtcHour: number;
  /** Requests per minute, where the vendor enforces one. */
  readonly perMinute: number | null;
  /** How the figure above was established, using the SOURCES.md vocabulary. */
  readonly verification: "live" | "mirror" | "unverified";
}

export interface AiModel {
  readonly id: string;
  readonly contextWindow: number;
  /** Neurons per million input tokens; null for providers that meter whole requests. */
  readonly neuronsPerMillionInput: number | null;
  readonly neuronsPerMillionOutput: number | null;
  /** Dollars per million input tokens; set only for providers metered in microdollars. */
  readonly usdPerMillionInput?: number;
  /** Dollars per million output tokens; set only for providers metered in microdollars. */
  readonly usdPerMillionOutput?: number;
  readonly supportsJsonSchema: boolean;
  readonly supportsVision: boolean;
}

export interface AiProviderMeta {
  readonly id: AiProviderId;
  readonly label: string;
  /**
   * True when the vendor's terms permit training on what we send. A provider marked true is
   * never offered a job with `sendsUntrustedText`, whatever the configured chain says.
   */
  readonly trainsOnInput: boolean;
  /** True when using the provider at all requires a payment method on file. */
  readonly requiresCard: boolean;
  readonly quota: QuotaPolicy;
  readonly models: Readonly<Record<string, AiModel>>;
}

export const aiUsageSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  /** Charge in the provider's own unit, computed from the tokens above. */
  cost: z.number().nonnegative(),
  unit: z.custom<QuotaUnit>(),
});
export type AiUsage = z.infer<typeof aiUsageSchema>;

export interface AiRequest<T> {
  readonly job: AiJob;
  readonly system: string;
  readonly user: string;
  /** JSON Schema the reply must satisfy. The caller validates; providers only ask. */
  readonly schema: z.ZodType<T>;
  readonly jsonSchema: Record<string, unknown>;
  /** Images, for the flyer-submission path only. */
  readonly images?: readonly { mimeType: string; base64: string }[];
}

export type AiOutcome<T> =
  | {
      readonly ok: true;
      readonly value: T;
      readonly provider: AiProviderId;
      readonly model: string;
      readonly usage: AiUsage;
    }
  | {
      readonly ok: false;
      readonly reason: AiFailure;
      readonly provider: AiProviderId | null;
      readonly detail: string;
      /**
       * What the vendor reported the failed call used, when a reply arrived (a reply that failed
       * validation or was truncated). The ledger charges this rather than the reservation's
       * estimate, which is sized for the largest reply (D-057).
       */
      readonly usage?: AiUsage;
    };

/**
 * Why a call did not produce a value. `quota_exhausted` is the expected, planned outcome once a
 * day's allowance is gone; the pipeline defers rather than failing, and the deterministic
 * adapters carry on (owner's choice, recorded in D-039).
 */
export type AiFailure =
  | "quota_exhausted"
  | "no_eligible_provider"
  | "schema_mismatch"
  | "truncated"
  | "provider_error"
  | "disabled";

export interface AiProvider {
  readonly meta: AiProviderMeta;
  /** True when the environment carries the credentials this provider needs. */
  isConfigured(): boolean;
  /** Cost of a call in the provider's unit, for reserving quota before it runs. */
  estimateCost(job: AiJob, model: AiModel): number;
  call<T>(request: AiRequest<T>, model: AiModel): Promise<AiOutcome<T>>;
}

/**
 * Rule 2. A provider is eligible for a job when it is configured, enabled, and either the job
 * carries no untrusted text or the provider's terms forbid training on input.
 */
export function routableFor(provider: AiProviderMeta, job: AiJob): boolean {
  if (job.sendsUntrustedText && provider.trainsOnInput) return false;
  return true;
}

/** True for the failure detail a provider writes when a call hit its timeout ("timed out: ..."). */
export function isTimeoutDetail(detail: string): boolean {
  return detail.startsWith("timed out");
}
