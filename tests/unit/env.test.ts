import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  AI_PROVIDER_ORDER_DEFAULT,
  ENV_VARIABLES,
  aiProviderOrder,
  describeMode,
  env,
  isMockMode,
  modeOf,
  parseEnv,
  splitEmailList,
  splitProviderOrder,
} from "@/src/config/env";

describe("parseEnv", () => {
  it("declares every variable in .env.example and treats empty values as unset", () => {
    const parsed = parseEnv({ DATABASE_URL: "   ", ANTHROPIC_API_KEY: "" });
    expect(parsed.DATABASE_URL).toBeUndefined();
    expect(parsed.ANTHROPIC_API_KEY).toBeUndefined();
    expect(parsed.problems).toEqual([]);
    for (const name of [
      "DANCETONIGHT_MODE",
      "DATABASE_URL",
      "DIRECT_DATABASE_URL",
      "ANTHROPIC_API_KEY",
      "SERP_PROVIDER",
      "CLOUDFLARE_ACCOUNT_ID",
      "CLOUDFLARE_AI_TOKEN",
      "GEMINI_API_KEY",
      "GROQ_API_KEY",
      "OPENROUTER_API_KEY",
      "AI_PROVIDER_ORDER",
      "AI_DAILY_NEURON_BUDGET",
      "AI_METRO_NEURON_CAP",
      "AI_DAILY_REQUEST_BUDGET",
      "AI_ENABLE_PAID",
      "TILES_FALLBACK_URL",
      "TURNSTILE_SECRET_KEY",
    ]) {
      expect(ENV_VARIABLES).toContain(name);
    }
  });

  it("never throws: a bad value is dropped and reported", () => {
    const parsed = parseEnv({
      DANCETONIGHT_MODE: "staging",
      DATABASE_URL: "mysql://nope",
      PUBLIC_BASE_URL: "ftp://example.com",
      ADMIN_EMAILS: "owner@example.com, not-an-email",
      SERP_PROVIDER: "serper",
    });
    expect(parsed.DANCETONIGHT_MODE).toBeUndefined();
    expect(parsed.DATABASE_URL).toBeUndefined();
    expect(parsed.PUBLIC_BASE_URL).toBeUndefined();
    expect(parsed.ADMIN_EMAILS).toEqual(["owner@example.com"]);
    expect(parsed.SERP_PROVIDER).toBe("serper");
    expect(parsed.problems.map((p) => p.variable).sort()).toEqual([
      "ADMIN_EMAILS",
      "DANCETONIGHT_MODE",
      "DATABASE_URL",
      "PUBLIC_BASE_URL",
    ]);
  });

  it("keeps the valid ADMIN_EMAILS entries and reports each bad one", () => {
    const parsed = parseEnv({
      ADMIN_EMAILS: "owner@example.com, not-an-email, , second@example.com,also bad",
    });
    expect(parsed.ADMIN_EMAILS).toEqual(["owner@example.com", "second@example.com"]);
    const messages = parsed.problems
      .filter((p) => p.variable === "ADMIN_EMAILS")
      .map((p) => p.message);
    expect(messages).toHaveLength(2);
    expect(messages[0]).toContain("not-an-email");
    expect(messages[1]).toContain("also bad");
    expect(describeMode(parsed).summary).toContain("ADMIN_EMAILS");
    expect(parseEnv({ ADMIN_EMAILS: "nope" }).ADMIN_EMAILS).toEqual([]);
    expect(parseEnv({}).ADMIN_EMAILS).toEqual([]);
    expect(splitEmailList(undefined)).toEqual({ valid: [], invalid: [] });
    expect(splitEmailList("a@example.com,b")).toEqual({ valid: ["a@example.com"], invalid: ["b"] });
  });

  it("types the typed variables", () => {
    const parsed = parseEnv({
      DANCETONIGHT_MODE: "production",
      DATABASE_URL: "postgresql://u:p@aws-0-us-east-1.pooler.supabase.com:6543/postgres",
      ADMIN_EMAILS: "a@example.com,b@example.com",
      PUBLIC_BASE_URL: "https://dancetonight.example",
    });
    expect(parsed.DANCETONIGHT_MODE).toBe("production");
    expect(parsed.ADMIN_EMAILS).toEqual(["a@example.com", "b@example.com"]);
    expect(parsed.PUBLIC_BASE_URL).toBe("https://dancetonight.example");
  });
});

describe("mode derivation (D-011)", () => {
  it("is mock when DANCETONIGHT_MODE is mock, whatever else is set", () => {
    const e = parseEnv({
      DANCETONIGHT_MODE: "mock",
      DATABASE_URL: "postgresql://u:p@localhost:5432/db",
      CLOUDFLARE_ACCOUNT_ID: "acct",
      CLOUDFLARE_AI_TOKEN: "tok",
    });
    expect(isMockMode(e)).toBe(true);
    expect(modeOf(e)).toBe("mock");
    expect(describeMode(e).ai).toBe(false);
  });

  it("is mock when DATABASE_URL is empty, even if the declared mode is preview", () => {
    const e = parseEnv({ DANCETONIGHT_MODE: "preview" });
    expect(isMockMode(e)).toBe(true);
    expect(modeOf(e)).toBe("mock");
    expect(describeMode(e).reason).toContain("falls back to mock");
  });

  it("is the declared mode when a database is configured", () => {
    const e = parseEnv({
      DANCETONIGHT_MODE: "production",
      DATABASE_URL: "postgresql://u:p@localhost:5432/db",
      CLOUDFLARE_ACCOUNT_ID: "acct",
      CLOUDFLARE_AI_TOKEN: "tok",
      HASDATA_API_KEY: "k",
    });
    expect(isMockMode(e)).toBe(false);
    expect(modeOf(e)).toBe("production");
    const description = describeMode(e);
    expect(description.database).toBe(true);
    expect(description.ai).toBe(true);
    expect(description.aiFree).toBe(true);
    expect(description.aiPaid).toBe(false);
    expect(description.serp).toBe("hasdata");
    expect(description.summary).toContain("mode=production");
  });

  it("defaults to preview when only a database is set", () => {
    expect(modeOf(parseEnv({ DATABASE_URL: "postgres://u:p@localhost/db" }))).toBe("preview");
  });

  it("parsed the process environment at import without throwing", () => {
    expect(Array.isArray(env.problems)).toBe(true);
    expect(typeof describeMode().summary).toBe("string");
  });
});

describe("AI provider variables (D-039)", () => {
  it("reads the free-provider credentials and the raw budget numbers", () => {
    const parsed = parseEnv({
      CLOUDFLARE_ACCOUNT_ID: " acct-123 ",
      CLOUDFLARE_AI_TOKEN: "cf-token",
      GEMINI_API_KEY: "g-key",
      GROQ_API_KEY: "gq-key",
      OPENROUTER_API_KEY: "or-key",
      AI_DAILY_NEURON_BUDGET: "9000",
      AI_METRO_NEURON_CAP: "4500",
      AI_DAILY_REQUEST_BUDGET: "50",
      AI_ENABLE_PAID: "true",
    });
    expect(parsed.CLOUDFLARE_ACCOUNT_ID).toBe("acct-123");
    expect(parsed.CLOUDFLARE_AI_TOKEN).toBe("cf-token");
    expect(parsed.GEMINI_API_KEY).toBe("g-key");
    expect(parsed.GROQ_API_KEY).toBe("gq-key");
    expect(parsed.OPENROUTER_API_KEY).toBe("or-key");
    expect(parsed.AI_DAILY_NEURON_BUDGET).toBe(9000);
    expect(parsed.AI_METRO_NEURON_CAP).toBe(4500);
    expect(parsed.AI_DAILY_REQUEST_BUDGET).toBe(50);
    expect(parsed.AI_ENABLE_PAID).toBe(true);
    expect(parsed.problems).toEqual([]);
  });

  it("parses the budget strings and owns no defaults for them", async () => {
    // The defaults live in src/ai/ledger.ts, which is the only reader of these variables. This
    // file carried its own AI_DAILY_NEURON_BUDGET_DEFAULT (10,000) and
    // AI_METRO_NEURON_RESERVE_DEFAULT (500) next to accessors nothing imported, and both
    // contradicted the values the ledger enforces (9,000 and floor(daily / 2) = 4,500).
    const parsed = parseEnv({});
    expect(parsed.AI_DAILY_NEURON_BUDGET).toBeUndefined();
    expect(parsed.AI_METRO_NEURON_CAP).toBeUndefined();
    expect(parsed.AI_DAILY_REQUEST_BUDGET).toBeUndefined();
    const exported = Object.keys(await import("@/src/config/env"));
    expect(exported).not.toContain("aiDailyNeuronBudget");
    expect(exported).not.toContain("aiMetroNeuronReserve");
    expect(exported).not.toContain("AI_DAILY_NEURON_BUDGET_DEFAULT");
    expect(exported).not.toContain("AI_METRO_NEURON_RESERVE_DEFAULT");
  });

  it("ships the settled defaults in .env.example, not the ones they replaced", async () => {
    const example = await readFile(new URL("../../.env.example", import.meta.url), "utf8");
    const value = (name: string): string | undefined =>
      example.match(new RegExp(`^${name}=([^\\s#]*)`, "m"))?.[1];

    // 9,000 is OUR ceiling and sits below Cloudflare's verified 10,000 on purpose, so the
    // pipeline stops on its own margin rather than on the vendor's HTTP 429.
    expect(value("AI_DAILY_NEURON_BUDGET")).toBe("9000");
    expect(example).not.toContain("AI_DAILY_NEURON_BUDGET=10000");

    // Renamed from AI_METRO_NEURON_RESERVE, whose name said "held back" while the code means
    // "the most one metro may spend in a day". Default floor(9000 / 2).
    expect(value("AI_METRO_NEURON_CAP")).toBe("4500");
    expect(example).not.toContain("AI_METRO_NEURON_RESERVE");

    expect(value("AI_PROVIDER_ORDER")).toBe(AI_PROVIDER_ORDER_DEFAULT.join(","));

    // Every variable the parser declares is documented, which is the CLAUDE.md rule.
    for (const name of ENV_VARIABLES) {
      expect(example, name).toMatch(new RegExp(`^${name}=`, "m"));
    }
  });

  it("puts the owner's order first and Cloudflare last, by default", () => {
    // The owner asked for Gemini, then Groq, then OpenRouter. Cloudflare is last because its
    // 10,000 neurons are the only budget the untrusted-text jobs can draw on at all, so spending
    // them on summaries would starve extraction. The terms guarantee does not depend on this:
    // tests/unit/ai-client.test.ts proves page text still reaches Cloudflare and nowhere else
    // with Cloudflare listed last.
    expect(AI_PROVIDER_ORDER_DEFAULT).toEqual(["gemini", "groq", "openrouter", "cloudflare"]);
    expect(aiProviderOrder(parseEnv({}))).toEqual(AI_PROVIDER_ORDER_DEFAULT);
  });

  it("keeps the good AI_PROVIDER_ORDER entries and drops a bad one rather than throwing", () => {
    const parsed = parseEnv({ AI_PROVIDER_ORDER: "cloudflare, mistral, groq" });
    expect(parsed.AI_PROVIDER_ORDER).toEqual(["cloudflare", "groq"]);
    expect(aiProviderOrder(parsed)).toEqual(["cloudflare", "groq"]);
    const problems = parsed.problems.filter((p) => p.variable === "AI_PROVIDER_ORDER");
    expect(problems).toHaveLength(1);
    expect(problems[0]?.message).toContain("mistral");
    expect(describeMode(parsed).summary).toContain("AI_PROVIDER_ORDER");
  });

  it("ignores case, collapses repeats and reads an all-bad order as unset", () => {
    expect(
      parseEnv({ AI_PROVIDER_ORDER: "CloudFlare,cloudflare,GEMINI" }).AI_PROVIDER_ORDER,
    ).toEqual(["cloudflare", "gemini"]);
    const allBad = parseEnv({ AI_PROVIDER_ORDER: "openai,ollama" });
    expect(allBad.AI_PROVIDER_ORDER).toEqual([]);
    expect(allBad.problems).toHaveLength(2);
    expect(aiProviderOrder(allBad)).toEqual(AI_PROVIDER_ORDER_DEFAULT);
    expect(splitProviderOrder(undefined)).toEqual({ valid: [], invalid: [] });
    expect(splitProviderOrder("groq,nope")).toEqual({ valid: ["groq"], invalid: ["nope"] });
  });

  it("drops a budget or flag that is not a whole number or a boolean, and reports it", () => {
    const parsed = parseEnv({
      AI_DAILY_NEURON_BUDGET: "ten thousand",
      AI_METRO_NEURON_CAP: "-5",
      AI_ENABLE_PAID: "maybe",
    });
    expect(parsed.AI_DAILY_NEURON_BUDGET).toBeUndefined();
    expect(parsed.AI_METRO_NEURON_CAP).toBeUndefined();
    expect(parsed.AI_ENABLE_PAID).toBeUndefined();
    expect(parsed.problems.map((p) => p.variable).sort()).toEqual([
      "AI_DAILY_NEURON_BUDGET",
      "AI_ENABLE_PAID",
      "AI_METRO_NEURON_CAP",
    ]);
  });

  it("accepts the flag spellings the .env.example comment implies", () => {
    for (const word of ["true", "1", "yes", "on", "ON"]) {
      expect(parseEnv({ AI_ENABLE_PAID: word }).AI_ENABLE_PAID).toBe(true);
    }
    for (const word of ["false", "0", "no", "off"]) {
      expect(parseEnv({ AI_ENABLE_PAID: word }).AI_ENABLE_PAID).toBe(false);
    }
    expect(parseEnv({ AI_ENABLE_PAID: "  " }).AI_ENABLE_PAID).toBeUndefined();
  });

  it("leaves the paid provider off until AI_ENABLE_PAID says otherwise (D-039)", () => {
    const base = {
      DANCETONIGHT_MODE: "production",
      DATABASE_URL: "postgresql://u:p@localhost:5432/db",
      ANTHROPIC_API_KEY: "sk-ant-test",
    };
    const keyOnly = describeMode(parseEnv(base));
    expect(keyOnly.ai).toBe(false);
    expect(keyOnly.aiPaid).toBe(false);
    expect(keyOnly.summary).toContain("paid off");

    const switchedOn = describeMode(parseEnv({ ...base, AI_ENABLE_PAID: "true" }));
    expect(switchedOn.aiPaid).toBe(true);
    expect(switchedOn.ai).toBe(true);

    // The flag on its own buys nothing: the key still has to be there.
    const flagOnly = describeMode(
      parseEnv({
        DANCETONIGHT_MODE: "production",
        DATABASE_URL: "postgresql://u:p@localhost:5432/db",
        AI_ENABLE_PAID: "true",
      }),
    );
    expect(flagOnly.aiPaid).toBe(false);
  });

  it("needs both halves of the Cloudflare credential before the free path counts as on", () => {
    const half = describeMode(
      parseEnv({
        DANCETONIGHT_MODE: "production",
        DATABASE_URL: "postgresql://u:p@localhost:5432/db",
        CLOUDFLARE_ACCOUNT_ID: "acct",
      }),
    );
    expect(half.aiFree).toBe(false);
    expect(half.ai).toBe(false);
  });

  it("reports no AI in mock mode even with every free key present", () => {
    const e = parseEnv({
      CLOUDFLARE_ACCOUNT_ID: "acct",
      CLOUDFLARE_AI_TOKEN: "tok",
      GEMINI_API_KEY: "g",
    });
    expect(modeOf(e)).toBe("mock");
    expect(describeMode(e).aiFree).toBe(false);
    expect(describeMode(e).ai).toBe(false);
  });
});
