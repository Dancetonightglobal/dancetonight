import { describe, expect, it } from "vitest";

import { AI_PROVIDERS, type AiOutcome, type AiProvider, type AiProviderId } from "@/src/ai";
import { checkJobFor, checkProvider, maskSecrets, pingJob } from "@/src/jobs/ai-check";

function fake(
  id: AiProviderId,
  configured: boolean,
  reply: AiOutcome<unknown> | Error,
  seen: { maxOutputTokens?: number; model?: string } = {},
): AiProvider {
  return {
    meta: AI_PROVIDERS[id],
    isConfigured: () => configured,
    estimateCost: () => 1,
    call: async (request, model) => {
      seen.maxOutputTokens = request.job.maxOutputTokens;
      seen.model = model.id;
      if (reply instanceof Error) throw reply;
      return reply as AiOutcome<never>;
    },
  };
}

describe("pnpm ai:check", () => {
  it("checks Cloudflare on the extraction model and caps the reply at 32 tokens", async () => {
    const seen: { maxOutputTokens?: number; model?: string } = {};
    const line = await checkProvider(
      fake(
        "cloudflare",
        true,
        {
          ok: true,
          value: { ok: true },
          provider: "cloudflare",
          model: "m",
          usage: { inputTokens: 20, outputTokens: 6, cost: 1, unit: "neuron" },
        },
        seen,
      ),
    );
    expect(checkJobFor("cloudflare")).toBe("extract");
    expect(seen.maxOutputTokens).toBe(32);
    expect(line).toMatchObject({ provider: "cloudflare", status: "ok" });
    expect(line.detail).toContain("20 in, 6 out");
  });

  it("reports a missing key as not configured, a failed call as failed, and skips the paid one", async () => {
    expect((await checkProvider(fake("groq", false, new Error("x")))).status).toBe(
      "not_configured",
    );
    const failed = await checkProvider(
      fake("gemini", true, {
        ok: false,
        reason: "provider_error",
        provider: "gemini",
        detail: "HTTP 401",
      }),
    );
    expect(failed).toMatchObject({ status: "failed" });
    expect(failed.detail).toContain("provider_error: HTTP 401");
    expect((await checkProvider(fake("cloudflare", true, new Error("boom")))).detail).toContain(
      "boom",
    );
    expect((await checkProvider(fake("anthropic", true, new Error("never called")))).status).toBe(
      "skipped",
    );
  });

  it("proves a Groq or OpenRouter key by listing models, since neither has one wired yet", async () => {
    const calls: string[] = [];
    const fetchImpl = async (url: string, init: { headers: Record<string, string> }) => {
      calls.push(`${url} ${init.headers.authorization}`);
      return new Response(
        JSON.stringify({ data: [{ id: "a/b:free" }, { id: "c/d" }, { id: "e/f:free" }] }),
      );
    };
    const line = await checkProvider(
      fake("openrouter", true, new Error("model calls are not made")),
      { OPENROUTER_API_KEY: "or-key-123456" },
      fetchImpl,
    );
    expect(calls).toEqual(["https://openrouter.ai/api/v1/models Bearer or-key-123456"]);
    expect(line).toMatchObject({ status: "ok" });
    expect(line.detail).toContain("2 free models: a/b:free, e/f:free");

    const rejected = await checkProvider(
      fake("groq", true, new Error("unused")),
      { GROQ_API_KEY: "gsk-bad-123456" },
      async () => new Response("{}", { status: 401 }),
    );
    expect(rejected).toMatchObject({ status: "failed", detail: "model list answered 401" });
  });

  it("lists Gemini's models when its wired model is gone, and diagnoses a refused Cloudflare token", async () => {
    const seen: string[] = [];
    const gemini = await checkProvider(
      fake("gemini", true, {
        ok: false,
        reason: "provider_error",
        provider: "gemini",
        detail: "HTTP 404 NOT_FOUND: no longer available to new users",
      }),
      { GEMINI_API_KEY: "gem-key-123456" },
      async (url, init) => {
        seen.push(`${url} ${init.headers["x-goog-api-key"]}`);
        return new Response(
          JSON.stringify({
            models: [
              { name: "models/gemini-9-flash", supportedGenerationMethods: ["generateContent"] },
              { name: "models/embed-1", supportedGenerationMethods: ["embedContent"] },
            ],
          }),
        );
      },
    );
    expect(seen[0]).toContain("generativelanguage.googleapis.com/v1beta/models");
    expect(seen[0]).toContain("gem-key-123456");
    expect(gemini.status).toBe("failed");
    expect(gemini.detail).toContain("1 models: gemini-9-flash");

    const cloudflare = await checkProvider(
      fake("cloudflare", true, {
        ok: false,
        reason: "provider_error",
        provider: "cloudflare",
        detail: "HTTP 401, error 10000: Authentication error",
      }),
      { CLOUDFLARE_AI_TOKEN: "cf-token-123456" },
      async () => new Response(JSON.stringify({ success: false, result: null }), { status: 401 }),
    );
    expect(cloudflare.detail).toContain("the token is not valid (401)");

    const wrongAccount = await checkProvider(
      fake("cloudflare", true, {
        ok: false,
        reason: "provider_error",
        provider: "cloudflare",
        detail: "HTTP 401, error 10000: Authentication error",
      }),
      { CLOUDFLARE_AI_TOKEN: "cf-token-123456" },
      async () => new Response(JSON.stringify({ success: true, result: { status: "active" } })),
    );
    expect(wrongAccount.detail).toContain("CLOUDFLARE_ACCOUNT_ID is probably not the account");
  });

  it("never lets a key through into the output", () => {
    expect(maskSecrets("bad key sk-abcdef123456 rejected", ["sk-abcdef123456"])).toBe(
      "bad key *** rejected",
    );
    expect(pingJob("summarise").sendsUntrustedText).toBe(false);
  });
});
