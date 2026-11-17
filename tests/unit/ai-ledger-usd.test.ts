import { describe, expect, it } from "vitest";

import {
  createInMemoryQuotaStore,
  createQuotaLedger,
  readAiBudgetConfig,
  defaultBudgetConfig,
} from "@/src/ai/ledger";
import { providerMeta } from "@/src/ai/registry";
import type { AiJob, AiProvider } from "@/src/ai/types";

// --- Fixtures --------------------------------------------------------------------------------

const extract: AiJob = {
  id: "extract",
  sendsUntrustedText: true,
  maxOutputTokens: 10_500,
  estimatedInputTokens: 8_000,
  description: "Extract listings from cleaned page text.",
};

function providerCosting(meta: ReturnType<typeof providerMeta>, cost: number): AiProvider {
  return {
    meta,
    isConfigured: () => true,
    estimateCost: () => cost,
    call: () => Promise.reject(new Error("the ledger must never call a provider")),
  };
}

const T = (iso: string) => new Date(iso);

// --- Tests -----------------------------------------------------------------------------------

describe("readAiBudgetConfig for USD", () => {
  it("defaults to $1 per day, no metro cap", () => {
    const config = readAiBudgetConfig({});
    expect(config.dailyUsdCap).toBe(1);
    expect(config.metroUsdCap).toBeUndefined();
    expect(config.problems).toEqual([]);
  });

  it("reads the variables and derives the metro cap from whatever budget is set", () => {
    const config = readAiBudgetConfig({ AI_DAILY_USD_CAP: "2.5", AI_METRO_USD_CAP: "1" });
    expect(config.dailyUsdCap).toBe(2.5);
    expect(config.metroUsdCap).toBe(1);
    expect(config.problems).toEqual([]);
  });

  it("rejects non‑positive, zero, and non‑numeric values, reports them, and falls back", () => {
    const abc = readAiBudgetConfig({ AI_DAILY_USD_CAP: "abc" });
    expect(abc.dailyUsdCap).toBe(1);
    expect(abc.problems.map((p) => p.variable)).toEqual(["AI_DAILY_USD_CAP"]);

    const negative = readAiBudgetConfig({ AI_DAILY_USD_CAP: "-1" });
    expect(negative.dailyUsdCap).toBe(1);
    expect(negative.problems.map((p) => p.variable)).toEqual(["AI_DAILY_USD_CAP"]);

    const zero = readAiBudgetConfig({ AI_DAILY_USD_CAP: "0" });
    expect(zero.dailyUsdCap).toBe(1);
    expect(zero.problems.map((p) => p.variable)).toEqual(["AI_DAILY_USD_CAP"]);
  });
});

describe("Bedrock ceilings", () => {
  const bedrock = providerMeta("bedrock");

  it("defaults to 1,000,000 microdollars account, 500,000 metro", () => {
    const ledger = createQuotaLedger();
    const ceilings = ledger.ceilingsFor(bedrock);
    expect(ceilings.unit).toBe("microdollar");
    expect(ceilings.account).toBe(1_000_000); // $1
    expect(ceilings.metro).toBe(500_000); // half
  });

  it("respects a custom daily cap and clamps the metro cap to it", () => {
    const config = { ...defaultBudgetConfig(), dailyUsdCap: 2, metroUsdCap: 1 };
    const ledger = createQuotaLedger({ config });
    const ceilings = ledger.ceilingsFor(bedrock);
    expect(ceilings.account).toBe(2_000_000); // $2
    expect(ceilings.metro).toBe(1_000_000); // $1
  });

  it("clamps metro cap to account cap when metro cap exceeds it", () => {
    const config = { ...defaultBudgetConfig(), dailyUsdCap: 1, metroUsdCap: 2 };
    const ledger = createQuotaLedger({ config });
    const ceilings = ledger.ceilingsFor(bedrock);
    expect(ceilings.account).toBe(1_000_000);
    expect(ceilings.metro).toBe(1_000_000); // clamped
  });
});

describe("spending with Bedrock", () => {
  const bedrock = providerMeta("bedrock");
  const at = T("2026-09-22T12:00:00.000Z");

  it("reserves within the metro cap and account cap", async () => {
    const ledger = createQuotaLedger();
    const provider = providerCosting(bedrock, 400_000); // $0.40
    const outcome1 = await ledger.reserve(provider, extract, bedrock.models["deepseek.v3.2"]!, {
      at,
      metro: "nyc",
    });
    expect(outcome1.ok).toBe(true);
    const outcome2 = await ledger.reserve(provider, extract, bedrock.models["deepseek.v3.2"]!, {
      at,
      metro: "nyc",
    });
    expect(outcome2.ok).toBe(false);
    if (!outcome2.ok) {
      expect(outcome2.scope).toBe("metro");
      expect(outcome2.ceiling).toBe(500_000);
    }
    // Another metro can still spend
    const outcome3 = await ledger.reserve(provider, extract, bedrock.models["deepseek.v3.2"]!, {
      at,
      metro: "austin",
    });
    expect(outcome3.ok).toBe(true);
    // Account cap now reached (nyc 400k + austin 400k = 800k, remaining 200k)
    const outcome4 = await ledger.reserve(provider, extract, bedrock.models["deepseek.v3.2"]!, {
      at,
      metro: "paris",
    });
    expect(outcome4.ok).toBe(false);
    if (!outcome4.ok) {
      expect(outcome4.scope).toBe("account");
      expect(outcome4.ceiling).toBe(1_000_000);
    }
  });

  it("reconciles correctly", async () => {
    const store = createInMemoryQuotaStore();
    const ledger = createQuotaLedger({ store });
    const provider = providerCosting(bedrock, 300_000);
    const at = T("2026-09-22T12:00:00.000Z");
    const reserve = await ledger.reserve(provider, extract, bedrock.models["deepseek.v3.2"]!, {
      at,
      metro: "nyc",
    });
    expect(reserve.ok).toBe(true);
    if (!reserve.ok) throw new Error("unreachable");
    await ledger.reconcile(reserve.reservation, {
      inputTokens: 8000,
      outputTokens: 1000,
      cost: 250_000,
      unit: "microdollar",
    });
    const remaining = await ledger.remaining(bedrock, { at, metro: "nyc" });
    expect(remaining.accountUsed).toBe(250_000);
    expect(remaining.metroUsed).toBe(250_000);
    expect(remaining.accountRemaining).toBe(750_000);
  });
});
