// Environment (CLAUDE.md conventions: zod at every boundary) and the runtime mode (D-011).
//
// Every variable in .env.example is declared here. Reading never throws: a value that fails
// validation is dropped, the problem is recorded in `env.problems`, and the app carries on in
// whatever mode the remaining values imply. Mock mode is selected when DANCETONIGHT_MODE is
// "mock" or when DATABASE_URL is empty, so `pnpm dev` with no keys at all runs the full UI on
// the New York seed.

import { z } from "zod";

import { AI_PROVIDER_IDS, type AiProviderId } from "@/src/ai/types";

export const MODES = ["mock", "preview", "production"] as const;
export type Mode = (typeof MODES)[number];

export const SERP_PROVIDERS = ["hasdata", "serper", "serpapi"] as const;
export type SerpProvider = (typeof SERP_PROVIDERS)[number];

/** An optional string: unset, empty and whitespace-only all read as undefined. */
const optionalString = z.preprocess(
  (value) => (typeof value === "string" && value.trim() !== "" ? value.trim() : undefined),
  z.string().optional(),
);

const optionalUrl = z.preprocess(
  (value) => (typeof value === "string" && value.trim() !== "" ? value.trim() : undefined),
  z.url({ protocol: /^https?$/ }).optional(),
);

const optionalPostgresUrl = z.preprocess(
  (value) => (typeof value === "string" && value.trim() !== "" ? value.trim() : undefined),
  z.url({ protocol: /^postgres(ql)?$/ }).optional(),
);

const optionalEmailList = z.preprocess((value) => splitList(value), z.array(z.email()));

/**
 * An optional whole number above zero. A value that is not one is handed to the schema unchanged
 * so it fails there, which is how parseEnv learns to drop it and record the problem.
 */
const optionalPositiveInt = z.preprocess((value) => {
  if (typeof value !== "string" || value.trim() === "") return undefined;
  const parsed = Number(value.trim());
  return Number.isInteger(parsed) && parsed > 0 ? parsed : value.trim();
}, z.number().int().positive().optional());

/** An optional positive number (decimals allowed). */
const optionalPositiveNumber = z.preprocess((value) => {
  if (typeof value !== "string" || value.trim() === "") return undefined;
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : value.trim();
}, z.number().positive().optional());

const TRUE_WORDS = ["true", "1", "yes", "on"];
const FALSE_WORDS = ["false", "0", "no", "off"];

/** An optional flag written as true/false, 1/0, yes/no or on/off. Anything else is dropped. */
const optionalBoolean = z.preprocess((value) => {
  if (typeof value !== "string" || value.trim() === "") return undefined;
  const word = value.trim().toLowerCase();
  if (TRUE_WORDS.includes(word)) return true;
  if (FALSE_WORDS.includes(word)) return false;
  return value.trim();
}, z.boolean().optional());

const optionalProviderOrder = z.preprocess(
  (value) => splitProviderOrder(value).valid,
  z.array(z.enum(AI_PROVIDER_IDS)),
);

/** A comma-separated list: unset or empty reads as no entries. */
function splitList(value: unknown): string[] {
  if (typeof value !== "string" || value.trim() === "") return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Splits an email list into the valid addresses and the entries that are not one, so one bad
 * entry in ADMIN_EMAILS drops itself rather than the whole list (which locked every admin out).
 */
export function splitEmailList(value: unknown): { valid: string[]; invalid: string[] } {
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const entry of splitList(value)) {
    if (z.email().safeParse(entry).success) valid.push(entry);
    else invalid.push(entry);
  }
  return { valid, invalid };
}

/**
 * Splits AI_PROVIDER_ORDER into the known provider ids and the entries that are not one, so a
 * typo drops itself rather than the whole chain (the ADMIN_EMAILS rule, applied to the router).
 * Case is ignored and a repeated id collapses to its first appearance.
 */
export function splitProviderOrder(value: unknown): { valid: AiProviderId[]; invalid: string[] } {
  const known: readonly string[] = AI_PROVIDER_IDS;
  const valid: AiProviderId[] = [];
  const invalid: string[] = [];
  for (const entry of splitList(value)) {
    const id = entry.toLowerCase();
    if (!known.includes(id)) invalid.push(entry);
    else if (!valid.includes(id as AiProviderId)) valid.push(id as AiProviderId);
  }
  return { valid, invalid };
}

/**
 * The order the router tries providers in for jobs that send only our own structured facts: the
 * owner's preference, Gemini then Groq then OpenRouter, with Cloudflare last (D-039).
 *
 * Cloudflare is last on purpose and on two grounds. It is the owner's stated preference, and its
 * 10,000 neurons are both the only free allowance anyone verified and the only budget the
 * untrusted-text jobs can draw on at all, so spending them on summaries would starve the one job
 * nothing else may do.
 *
 * Jobs carrying third-party page text ignore this list entirely: `routableFor()` in
 * `src/ai/types.ts` lets only a no-training provider near them, and it is applied before the
 * order is consulted, so the guarantee does not depend on where Cloudflare sits here.
 */
export const AI_PROVIDER_ORDER_DEFAULT: readonly AiProviderId[] = [
  "gemini",
  "groq",
  "openrouter",
  "cloudflare",
];

export const envSchema = z.object({
  // Mode and site
  DANCETONIGHT_MODE: z.preprocess(
    (value) => (typeof value === "string" && value.trim() !== "" ? value.trim() : undefined),
    z.enum(MODES).optional(),
  ),
  PUBLIC_BASE_URL: optionalUrl,
  BOT_CONTACT_EMAIL: z.preprocess(
    (value) => (typeof value === "string" && value.trim() !== "" ? value.trim() : undefined),
    z.email().optional(),
  ),
  ADMIN_EMAILS: optionalEmailList,
  DIGEST_TO: z.preprocess(
    (value) => (typeof value === "string" && value.trim() !== "" ? value.trim() : undefined),
    z.email().optional(),
  ),
  CRON_SECRET: optionalString,

  // Database
  DATABASE_URL: optionalPostgresUrl,
  DIRECT_DATABASE_URL: optionalPostgresUrl,
  /** Tests only: a disposable database the write-path tests create their own databases under. */
  TEST_DATABASE_URL: optionalPostgresUrl,
  SUPABASE_URL: optionalUrl,
  SUPABASE_ANON_KEY: optionalString,
  SUPABASE_SERVICE_ROLE_KEY: optionalString,

  // Jobs, caches, monitoring
  INNGEST_EVENT_KEY: optionalString,
  INNGEST_SIGNING_KEY: optionalString,
  UPSTASH_REDIS_REST_URL: optionalUrl,
  UPSTASH_REDIS_REST_TOKEN: optionalString,
  SENTRY_DSN: optionalString,
  SENTRY_AUTH_TOKEN: optionalString,
  NEXT_PUBLIC_PLAUSIBLE_DOMAIN: optionalString,
  RESEND_API_KEY: optionalString,
  CRAWLER_SIGNING_KEY: optionalString,

  // Tier A sources
  TICKETMASTER_API_KEY: optionalString,
  EVENTBRITE_PRIVATE_TOKEN: optionalString,
  MEETUP_CLIENT_KEY: optionalString,
  MEETUP_CLIENT_SECRET: optionalString,
  MEETUP_MEMBER_ID: optionalString,
  MEETUP_JWT_PRIVATE_KEY: optionalString,
  GOOGLE_MAPS_SERVER_KEY: optionalString,
  GOOGLE_CALENDAR_API_KEY: optionalString,
  GEOAPIFY_API_KEY: optionalString,
  PIKE13_CLIENT_ID: optionalString,
  SOCRATA_APP_TOKEN_NYC: optionalString,
  SOCRATA_APP_TOKEN_AUSTIN: optionalString,
  PARIS_DATA_API_KEY: optionalString,
  TEAMUP_API_KEY: optionalString,
  HELLOASSO_CLIENT_ID: optionalString,
  HELLOASSO_CLIENT_SECRET: optionalString,
  BILLETTO_API_KEY: optionalString,
  TICKSTER_API_KEY: optionalString,
  FIENTA_API_KEY: optionalString,
  MOSHTIX_API_KEY: optionalString,
  AGENDATRAD_RSS_URL: optionalUrl,
  OPENAGENDA_API_KEY: optionalString,
  WEEZEVENT_API_KEY: optionalString,
  FOURSQUARE_OS_TOKEN: optionalString,

  // Tier B sources
  SERP_PROVIDER: z.preprocess(
    (value) => (typeof value === "string" && value.trim() !== "" ? value.trim() : undefined),
    z.enum(SERP_PROVIDERS).optional(),
  ),
  HASDATA_API_KEY: optionalString,
  SERPER_API_KEY: optionalString,
  SERPAPI_API_KEY: optionalString,
  FIRECRAWL_API_KEY: optionalString,
  SEATGEEK_CLIENT_ID: optionalString,
  SKIDDLE_API_KEY: optionalString,
  SABAKI_API_KEY: optionalString,
  PREDICTHQ_TOKEN: optionalString,
  JAMBASE_API_KEY: optionalString,

  // Tier C: AI (D-039). Free providers first; the paid one is off unless AI_ENABLE_PAID is set.
  CLOUDFLARE_ACCOUNT_ID: optionalString,
  CLOUDFLARE_AI_TOKEN: optionalString,
  GEMINI_API_KEY: optionalString,
  GROQ_API_KEY: optionalString,
  OPENROUTER_API_KEY: optionalString,
  AI_PROVIDER_ORDER: optionalProviderOrder,
  // The budget defaults live in src/ai/ledger.ts, which owns them. This file parses the raw
  // strings and does nothing else with them: it used to carry its own defaults as well, and they
  // contradicted the live ones (10,000 against the ledger's 9,000; 500 against floor(daily / 2)).
  AI_DAILY_NEURON_BUDGET: optionalPositiveInt,
  // Named AI_METRO_NEURON_RESERVE until 2026-09-22. "Reserve" read as "neurons held back for this
  // metro", which is close to the opposite of what the code does with it: it is the most one metro
  // may spend in a day, so that one metro's cold start cannot take the day from every other.
  AI_METRO_NEURON_CAP: optionalPositiveInt,
  AI_DAILY_REQUEST_BUDGET: optionalPositiveInt,
  // True once the Cloudflare account is on Workers Paid (D-058): lets the neuron budget above.
  CLOUDFLARE_WORKERS_PAID: optionalBoolean,
  AI_ENABLE_PAID: optionalBoolean,
  ANTHROPIC_API_KEY: optionalString,
  // Amazon Bedrock, DeepSeek V3.2 (D-142): a dedicated IAM user that may only invoke that model.
  BEDROCK_ACCESS_KEY_ID: optionalString,
  BEDROCK_SECRET_ACCESS_KEY: optionalString,
  BEDROCK_SESSION_TOKEN: optionalString,
  // Application inference profile ARN tagged for this project (cost allocation); unset: the bare model id.
  BEDROCK_INFERENCE_PROFILE_ARN: optionalString,
  // Dollars per day; the ledger owns the default ($1) and converts to microdollars.
  AI_DAILY_USD_CAP: optionalPositiveNumber,
  AI_METRO_USD_CAP: optionalPositiveNumber,

  // Tier D and organizer connect
  EDMTRAIN_API_KEY: optionalString,
  DISCORD_CLIENT_ID: optionalString,
  DISCORD_BOT_TOKEN: optionalString,
  TELEGRAM_BOT_TOKEN: optionalString,

  // Abuse guard and map
  TURNSTILE_SITE_KEY: optionalString,
  TURNSTILE_SECRET_KEY: optionalString,
  TILES_FALLBACK_URL: optionalUrl,
});

export type EnvValues = z.infer<typeof envSchema>;

export interface EnvProblem {
  variable: string;
  message: string;
}

export interface Env extends EnvValues {
  /** Variables whose value failed validation and were dropped. Never thrown; surfaced in describeMode(). */
  problems: EnvProblem[];
}

/** The variables .env.example lists, in its order; the seed of every parse. */
export const ENV_VARIABLES = Object.keys(envSchema.shape) as (keyof EnvValues)[];

/**
 * Parse an environment map without ever throwing. A variable that fails validation is removed
 * and parsed again, so one bad value never takes the whole configuration down.
 */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const input: Record<string, string | undefined> = {};
  for (const name of ENV_VARIABLES) input[name] = source[name];
  const problems: EnvProblem[] = [];
  // Lists keep their valid entries: each bad one is a problem of its own, not a reason to drop the list.
  const admins = splitEmailList(input.ADMIN_EMAILS);
  input.ADMIN_EMAILS = admins.valid.join(",");
  for (const entry of admins.invalid) {
    problems.push({
      variable: "ADMIN_EMAILS",
      message: `dropped ${JSON.stringify(entry.slice(0, 40))}: not an email address`,
    });
  }
  // Same rule for the provider chain: one unknown id drops itself, the rest of the order stands.
  const providers = splitProviderOrder(input.AI_PROVIDER_ORDER);
  input.AI_PROVIDER_ORDER = providers.valid.join(",");
  for (const entry of providers.invalid) {
    problems.push({
      variable: "AI_PROVIDER_ORDER",
      message: `dropped ${JSON.stringify(entry.slice(0, 40))}: not one of ${AI_PROVIDER_IDS.join(", ")}`,
    });
  }
  for (let attempt = 0; attempt <= ENV_VARIABLES.length; attempt++) {
    const result = envSchema.safeParse(input);
    if (result.success) return { ...result.data, problems };
    const issue = result.error.issues[0];
    const variable = issue ? String(issue.path[0] ?? "") : "";
    if (!variable || !(variable in input)) break;
    problems.push({ variable, message: issue?.message ?? "invalid" });
    delete input[variable];
  }
  // Unreachable in practice: with every offending variable dropped the schema accepts the rest.
  const fallback = envSchema.safeParse({});
  return { ...(fallback.success ? fallback.data : ({} as EnvValues)), problems };
}

/** The process environment, parsed once at import without throwing. */
export const env: Env = parseEnv(process.env);

/**
 * Mock mode (D-011): DANCETONIGHT_MODE is "mock", or no database is configured. Every external
 * client has a mock implementation behind the same interface; this is the single derivation.
 */
export function isMockMode(e: Env = env): boolean {
  if (e.DANCETONIGHT_MODE === "mock") return true;
  return e.DATABASE_URL === undefined;
}

/** The effective mode: the declared mode, downgraded to mock when nothing else is possible. */
export function modeOf(e: Env = env): Mode {
  if (isMockMode(e)) return "mock";
  return e.DANCETONIGHT_MODE ?? "preview";
}

/** Which optional capabilities the current environment enables. */
export interface ModeDescription {
  mode: Mode;
  declaredMode: Mode | null;
  /** Why the mode is what it is, in one sentence. */
  reason: string;
  database: boolean;
  /** Any AI at all: a configured free provider, or the paid one deliberately switched on. */
  ai: boolean;
  /** Cloudflare Workers AI is configured, so untrusted page text has somewhere to go (D-039). */
  aiFree: boolean;
  /** AI_ENABLE_PAID is set and a paid provider key (Anthropic or Bedrock) is present. Off by default. */
  aiPaid: boolean;
  serp: SerpProvider | null;
  geocoder: boolean;
  jobs: boolean;
  cache: boolean;
  problems: EnvProblem[];
  /** The whole description as one line for logs and the admin page. */
  summary: string;
}

/** The provider chain in force for jobs that send only our own facts: configured, or the default. */
export function aiProviderOrder(e: Env = env): readonly AiProviderId[] {
  return e.AI_PROVIDER_ORDER.length > 0 ? e.AI_PROVIDER_ORDER : AI_PROVIDER_ORDER_DEFAULT;
}

// aiDailyNeuronBudget() and aiMetroNeuronReserve() used to live here, each returning this file's
// own default. Both were dead -- nothing imported either -- and both contradicted the values the
// ledger actually enforces. `readAiBudgetConfig()` in src/ai/ledger.ts is the one reader of these
// variables and the one owner of their defaults.

/** Explain the mode and what is switched on, for `pnpm dev` output and /admin. */
export function describeMode(e: Env = env): ModeDescription {
  const mode = modeOf(e);
  const declaredMode = e.DANCETONIGHT_MODE ?? null;
  let reason: string;
  if (declaredMode === "mock") reason = "DANCETONIGHT_MODE is mock";
  else if (e.DATABASE_URL === undefined) {
    reason =
      declaredMode === null
        ? "no DANCETONIGHT_MODE and no DATABASE_URL, so the New York seed is the data"
        : `DATABASE_URL is empty, so ${declaredMode} falls back to mock`;
  } else reason = declaredMode ? `DANCETONIGHT_MODE is ${declaredMode}` : "DATABASE_URL is set";

  const serp = e.SERP_PROVIDER ?? (e.HASDATA_API_KEY ? "hasdata" : null);
  const serpKey =
    serp === "hasdata"
      ? e.HASDATA_API_KEY
      : serp === "serper"
        ? e.SERPER_API_KEY
        : serp === "serpapi"
          ? e.SERPAPI_API_KEY
          : undefined;
  // D-039: the free chain is the default and the paid provider needs an explicit switch, so a
  // stray ANTHROPIC_API_KEY on its own no longer turns AI on.
  const live = mode !== "mock";
  const aiFree =
    live && e.CLOUDFLARE_ACCOUNT_ID !== undefined && e.CLOUDFLARE_AI_TOKEN !== undefined;
  const aiPaid =
    live &&
    e.AI_ENABLE_PAID === true &&
    (e.ANTHROPIC_API_KEY !== undefined ||
      (e.BEDROCK_ACCESS_KEY_ID !== undefined && e.BEDROCK_SECRET_ACCESS_KEY !== undefined));
  const description: Omit<ModeDescription, "summary"> = {
    mode,
    declaredMode,
    reason,
    database: mode !== "mock" && e.DATABASE_URL !== undefined,
    ai: aiFree || aiPaid,
    aiFree,
    aiPaid,
    serp: mode !== "mock" && serp !== null && serpKey !== undefined ? serp : null,
    geocoder: mode !== "mock" && e.GEOAPIFY_API_KEY !== undefined,
    jobs: mode !== "mock" && e.INNGEST_EVENT_KEY !== undefined,
    cache: mode !== "mock" && e.UPSTASH_REDIS_REST_URL !== undefined,
    problems: e.problems,
  };
  const on = (flag: boolean) => (flag ? "on" : "off");
  const summary =
    `mode=${mode} (${reason}); database ${on(description.database)}, ` +
    `ai ${on(description.ai)} (free ${on(aiFree)}, paid ${on(aiPaid)}), ` +
    `serp ${description.serp ?? "off"}, geocoder ${on(description.geocoder)}, jobs ${on(description.jobs)}, ` +
    `cache ${on(description.cache)}` +
    (e.problems.length > 0
      ? `; ignored: ${e.problems.map((p) => `${p.variable} (${p.message})`).join(", ")}`
      : "");
  return { ...description, summary };
}
