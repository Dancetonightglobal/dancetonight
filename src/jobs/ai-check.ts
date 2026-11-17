// `pnpm ai:check`: one tiny live call to each configured AI provider, on the model the pipeline
// will use for it, so a wrong or missing key shows up as a plain sentence in the ingest run
// instead of as a failed extraction later (D-048). Never prints a key: anything in the output
// that matches a configured credential is masked before it is written.
//
// Cloudflare is checked on the extraction model, because extraction is the only job it serves;
// the others on the summary model. Each call sends only the word "ping", asks for `{"ok": true}`
// and caps the reply at 32 tokens, so a check costs a handful of neurons or one request.
//
// Groq and OpenRouter have no model wired yet (their ids were never verified; OpenRouter's free
// catalogue changes weekly), so for them the check lists the provider's models instead: an
// authenticated GET that proves the key and prints the ids we can wire from live data rather than
// from memory. Listing models is not a model call, so it does not go through src/ai.
//
// Exit status is 1 when a configured provider fails, 0 otherwise. A provider with no key is
// reported as not configured, not as a failure.

import { z } from "zod";

import { allAiProviders, modelFor, type AiJob, type AiJobId, type AiProvider } from "@/src/ai";

const pingSchema = z.object({ ok: z.boolean() });
const pingJsonSchema = {
  type: "object",
  properties: { ok: { type: "boolean" } },
  required: ["ok"],
  additionalProperties: false,
};

/** The job each provider is checked with: the one it will actually serve. */
export function checkJobFor(provider: AiProvider["meta"]["id"]): AiJobId {
  return provider === "cloudflare" ? "extract" : "summarise";
}

/** A job that carries nothing but "ping": small enough to cost almost nothing anywhere. */
export function pingJob(id: AiJobId): AiJob {
  return {
    id,
    sendsUntrustedText: false,
    maxOutputTokens: 32,
    estimatedInputTokens: 40,
    description: "live credential check (pnpm ai:check)",
  };
}

/** Replaces every configured secret found in `text` with `***`. */
export function maskSecrets(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const secret of secrets) {
    if (secret.length >= 8) out = out.split(secret).join("***");
  }
  return out;
}

type Fetch = (url: string, init: { headers: Record<string, string> }) => Promise<Response>;

interface ModelListSpec {
  url: string;
  keyEnv: string;
  freeOnly: boolean;
  /** How the key travels: a bearer token, or Google's `x-goog-api-key` header. */
  auth: "bearer" | "goog";
}

/**
 * Where each provider lists its models: for the ones with no model wired yet, and for any whose
 * wired model fails (Gemini retired `gemini-2.5-flash-lite` for new users in run 12), so the
 * replacement is chosen from what the account can actually use.
 */
export const MODEL_LISTS: Partial<Record<string, ModelListSpec>> = {
  groq: {
    url: "https://api.groq.com/openai/v1/models",
    keyEnv: "GROQ_API_KEY",
    freeOnly: false,
    auth: "bearer",
  },
  openrouter: {
    url: "https://openrouter.ai/api/v1/models",
    keyEnv: "OPENROUTER_API_KEY",
    freeOnly: true,
    auth: "bearer",
  },
  gemini: {
    url: "https://generativelanguage.googleapis.com/v1beta/models?pageSize=200",
    keyEnv: "GEMINI_API_KEY",
    freeOnly: false,
    auth: "goog",
  },
};

interface ListedModel {
  id?: unknown;
  name?: unknown;
  supportedGenerationMethods?: unknown;
}

/** Model ids from an OpenAI-style `{data: [{id}]}` or Google's `{models: [{name}]}` listing. */
export function modelIds(body: { data?: ListedModel[]; models?: ListedModel[] }): string[] {
  const rows = body.data ?? body.models ?? [];
  return rows
    .filter(
      (m) =>
        !Array.isArray(m.supportedGenerationMethods) ||
        m.supportedGenerationMethods.includes("generateContent"),
    )
    .map((m) => (typeof m.id === "string" ? m.id : typeof m.name === "string" ? m.name : null))
    .filter((id): id is string => id !== null)
    .map((id) => id.replace(/^models\//, ""))
    .sort();
}

/** Lists a provider's model ids with its key; the ids are public, the key is never echoed. */
export async function listModels(
  provider: string,
  env: Readonly<Record<string, string | undefined>>,
  fetchImpl: Fetch = fetch,
): Promise<CheckLine> {
  const spec = MODEL_LISTS[provider];
  const key = spec ? env[spec.keyEnv]?.trim() : undefined;
  if (!spec || !key) return { provider, status: "failed", detail: "no model list to check" };
  try {
    const headers: Record<string, string> =
      spec.auth === "goog" ? { "x-goog-api-key": key } : { authorization: `Bearer ${key}` };
    const response = await fetchImpl(spec.url, { headers });
    if (!response.ok) {
      return { provider, status: "failed", detail: `model list answered ${response.status}` };
    }
    const body = (await response.json()) as { data?: ListedModel[]; models?: ListedModel[] };
    const ids = modelIds(body).filter((id) => !spec.freeOnly || id.endsWith(":free"));
    return {
      provider,
      status: "ok",
      detail: `key accepted; no model wired yet; ${ids.length}${spec.freeOnly ? " free" : ""} models: ${ids.slice(0, 40).join(", ")}`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { provider, status: "failed", detail: `model list: ${message}` };
  }
}

/**
 * Tells a bad Cloudflare token from a wrong account id: Cloudflare's own token check answers for
 * the token alone. The account id is not needed for it and is never printed.
 */
export async function verifyCloudflareToken(
  env: Readonly<Record<string, string | undefined>>,
  fetchImpl: Fetch = fetch,
): Promise<string> {
  const token = env.CLOUDFLARE_AI_TOKEN?.trim();
  if (!token) return "no token to verify";
  try {
    const response = await fetchImpl("https://api.cloudflare.com/client/v4/user/tokens/verify", {
      headers: { authorization: `Bearer ${token}` },
    });
    const body = (await response.json().catch(() => ({}))) as {
      success?: boolean;
      result?: { status?: string };
    };
    if (response.ok && body.success && body.result?.status === "active") {
      return "the token itself is valid and active, so CLOUDFLARE_ACCOUNT_ID is probably not the account the token was made for, or the token lacks the Workers AI permission";
    }
    return `Cloudflare says the token is not valid (${response.status}${body.result?.status ? `, ${body.result.status}` : ""}): make a new one from the Workers AI template`;
  } catch (error) {
    return `could not verify the token: ${error instanceof Error ? error.message : String(error)}`;
  }
}

export interface CheckLine {
  provider: string;
  status: "ok" | "failed" | "not_configured" | "skipped";
  detail: string;
}

export async function checkProvider(
  provider: AiProvider,
  env: Readonly<Record<string, string | undefined>> = process.env,
  fetchImpl?: Fetch,
): Promise<CheckLine> {
  const id = provider.meta.id;
  if (id === "anthropic") {
    return { provider: id, status: "skipped", detail: "the paid provider stays off (D-039)" };
  }
  if (!provider.isConfigured()) {
    return { provider: id, status: "not_configured", detail: "no key in the environment" };
  }
  const jobId = checkJobFor(id);
  const model = modelFor(id, jobId);
  if (!model) {
    if (MODEL_LISTS[id]) return listModels(id, env, fetchImpl);
    return { provider: id, status: "failed", detail: `no model registered for ${jobId}` };
  }
  try {
    const outcome = await provider.call(
      {
        job: pingJob(jobId),
        system: 'Reply with the JSON object {"ok": true} and nothing else.',
        user: "ping",
        schema: pingSchema,
        jsonSchema: pingJsonSchema,
      },
      model,
    );
    if (outcome.ok) {
      return {
        provider: id,
        status: "ok",
        detail: `${model.id} answered (${outcome.usage.inputTokens} in, ${outcome.usage.outputTokens} out)`,
      };
    }
    let detail = `${model.id}: ${outcome.reason}: ${outcome.detail}`;
    if (id === "cloudflare" && /\b401\b|error 10000/.test(outcome.detail)) {
      detail += `; ${await verifyCloudflareToken(env, fetchImpl)}`;
    } else if (MODEL_LISTS[id]) {
      const listed = await listModels(id, env, fetchImpl);
      detail += `; ${listed.detail.replace("no model wired yet; ", "")}`;
    }
    return { provider: id, status: "failed", detail };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { provider: id, status: "failed", detail: `${model.id}: ${message}` };
  }
}

async function main(): Promise<number> {
  const secrets = [
    "CLOUDFLARE_AI_TOKEN",
    "CLOUDFLARE_ACCOUNT_ID",
    "GEMINI_API_KEY",
    "GROQ_API_KEY",
    "OPENROUTER_API_KEY",
    "ANTHROPIC_API_KEY",
    "BEDROCK_ACCESS_KEY_ID",
    "BEDROCK_SECRET_ACCESS_KEY",
    "BEDROCK_SESSION_TOKEN",
  ]
    .map((name) => process.env[name]?.trim())
    .filter((v): v is string => !!v);
  let failed = false;
  for (const provider of allAiProviders()) {
    const line = await checkProvider(provider);
    if (line.status === "failed") failed = true;
    console.log(maskSecrets(`${line.provider}: ${line.status}; ${line.detail}`, secrets));
  }
  return failed ? 1 : 0;
}

if (process.argv[1]?.endsWith("ai-check.ts")) {
  main().then((code) => process.exit(code));
}
