import { describe, expect, it, vi } from "vitest";

import {
  ACCOUNT_SCOPE,
  DEFAULT_DAILY_NEURON_BUDGET,
  createInMemoryQuotaStore,
  createQuotaLedger,
  defaultBudgetConfig,
  defaultMetroCap,
  metroScope,
  quotaDayEndsAt,
  quotaDayKey,
  readAiBudgetConfig,
  type AiBudgetConfig,
  type LedgerCallOptions,
  type Notifier,
  type QuotaExhaustedEvent,
  type QuotaLedger,
  type ReserveOutcome,
} from "@/src/ai/ledger";
import type { AiJob, AiModel, AiProvider, AiProviderMeta, AiUsage } from "@/src/ai/types";

// --- Fixtures --------------------------------------------------------------------------------

const granite: AiModel = {
  id: "@cf/ibm-granite/granite-4.0-h-micro",
  contextWindow: 131_000,
  neuronsPerMillionInput: 1_542,
  neuronsPerMillionOutput: 10_158,
  supportsJsonSchema: true,
  supportsVision: false,
};

/** Cloudflare as the survey found it: 10,000 neurons a day, resetting at 00:00 UTC. */
const cloudflare: AiProviderMeta = {
  id: "cloudflare",
  label: "Cloudflare Workers AI",
  trainsOnInput: false,
  requiresCard: false,
  quota: {
    unit: "neuron",
    perDay: 10_000,
    resetUtcHour: 0,
    perMinute: 300,
    verification: "live",
  },
  models: { [granite.id]: granite },
};

/** A request-metered provider whose day resets at 08:00 UTC, to prove the key follows the policy. */
const lateReset: AiProviderMeta = {
  ...cloudflare,
  id: "gemini",
  label: "Google AI Studio",
  trainsOnInput: true,
  quota: {
    unit: "request",
    perDay: 40,
    resetUtcHour: 8,
    perMinute: null,
    verification: "unverified",
  },
};

const extract: AiJob = {
  id: "extract",
  sendsUntrustedText: true,
  maxOutputTokens: 10_500,
  estimatedInputTokens: 8_000,
  description: "Extract listings from cleaned page text.",
};

function providerCosting(meta: AiProviderMeta, cost: number): AiProvider {
  return {
    meta,
    isConfigured: () => true,
    estimateCost: () => cost,
    call: () => Promise.reject(new Error("the ledger must never call a provider")),
  };
}

function usage(cost: number): AiUsage {
  return { inputTokens: 8_000, outputTokens: 1_000, cost, unit: "neuron" };
}

const T = (iso: string) => new Date(iso);

/** A config whose metro cap never binds, for tests about the account ceiling alone. */
function accountOnly(overrides: Partial<AiBudgetConfig> = {}): AiBudgetConfig {
  const base = defaultBudgetConfig();
  return { ...base, metroNeuronCap: base.dailyNeuronBudget, ...overrides };
}

/**
 * The whole cycle a real call performs: reserve, then reconcile with what it actually cost.
 * Tests that only reserve would be measuring open reservations, which the sweep may expire.
 */
async function spend(
  ledger: QuotaLedger,
  provider: AiProvider,
  options: LedgerCallOptions,
): Promise<ReserveOutcome> {
  const outcome = await ledger.reserve(provider, extract, granite, options);
  if (outcome.ok) await ledger.reconcile(outcome.reservation, usage(outcome.reservation.estimate));
  return outcome;
}

// --- The day key -----------------------------------------------------------------------------

describe("quotaDayKey", () => {
  it("rolls at the provider's own reset hour, not at a local calendar date", () => {
    // 00:00 UTC reset: the key is the UTC date, whatever the process's zone says the date is.
    expect(quotaDayKey(T("2026-09-22T23:59:59.999Z"), 0)).toBe("2026-09-22");
    expect(quotaDayKey(T("2026-09-23T00:00:00.000Z"), 0)).toBe("2026-09-23");
    // 03:30 UTC is still 22 September in UTC but 21 September in New York. The UTC day wins.
    expect(quotaDayKey(T("2026-09-22T03:30:00.000Z"), 0)).toBe("2026-09-22");
    // 20:00 UTC on the 22nd is still the 22nd in New York; the key does not turn over early.
    expect(quotaDayKey(T("2026-09-22T20:00:00.000Z"), 0)).toBe("2026-09-22");
    // 08:00 UTC reset: the key only turns over once the vendor's own boundary is crossed.
    expect(quotaDayKey(T("2026-09-22T07:59:59.999Z"), 8)).toBe("2026-09-21");
    expect(quotaDayKey(T("2026-09-22T08:00:00.000Z"), 8)).toBe("2026-09-22");
  });

  it("gives the same key in every process timezone, because nothing reads a local clock", () => {
    // The suite runs under TZ=UTC and TZ=America/New_York. These four instants straddle both
    // midnights, so a local-date implementation would disagree with itself between the two runs.
    const instants = [
      "2026-09-22T00:30:00.000Z", // 20:30 on the 21st in New York
      "2026-09-22T04:00:00.000Z", // midnight in New York
      "2026-09-22T12:00:00.000Z",
      "2026-09-22T23:30:00.000Z", // 19:30 on the 22nd in New York
    ] as const;
    expect(instants.map((iso) => quotaDayKey(T(iso), 0))).toEqual([
      "2026-09-22",
      "2026-09-22",
      "2026-09-22",
      "2026-09-22",
    ]);
    // The offset the process happens to be in must not leak into the arithmetic.
    expect(quotaDayEndsAt(T("2026-09-22T00:30:00.000Z"), 0).getTime() % 3_600_000).toBe(0);
  });

  it("reports when the quota day ends, for the deferral copy", () => {
    expect(quotaDayEndsAt(T("2026-09-22T23:59:00.000Z"), 0).toISOString()).toBe(
      "2026-09-23T00:00:00.000Z",
    );
    expect(quotaDayEndsAt(T("2026-09-22T09:00:00.000Z"), 8).toISOString()).toBe(
      "2026-09-23T08:00:00.000Z",
    );
    // Before the 08:00 boundary we are still inside yesterday's quota day, which ends today.
    expect(quotaDayEndsAt(T("2026-09-22T07:00:00.000Z"), 8).toISOString()).toBe(
      "2026-09-22T08:00:00.000Z",
    );
  });
});

describe("the ledger's day key", () => {
  it("gives a provider a fresh allowance across its own midnight and not before", async () => {
    const ledger = createQuotaLedger({
      config: accountOnly(),
      now: () => T("2026-09-22T23:00:00.000Z"),
    });
    const provider = providerCosting(cloudflare, 5_000);

    const first = await spend(ledger, provider, {
      at: T("2026-09-22T23:00:00.000Z"),
      metro: "nyc",
    });
    expect(first.ok).toBe(true);
    const second = await spend(ledger, provider, {
      at: T("2026-09-22T23:30:00.000Z"),
      metro: "nyc",
    });
    expect(second.ok).toBe(false);
    // 23:30 UTC is 19:30 in New York, still the 22nd there too: no zone turns this over early.
    expect(ledger.dayKeyFor(cloudflare, T("2026-09-22T23:30:00.000Z"))).toBe("2026-09-22");

    // One minute later, on the far side of 00:00 UTC, the allowance is whole again.
    const afterMidnight = await spend(ledger, provider, {
      at: T("2026-09-23T00:01:00.000Z"),
      metro: "nyc",
    });
    expect(afterMidnight.ok).toBe(true);
    expect(ledger.dayKeyFor(cloudflare, T("2026-09-23T00:01:00.000Z"))).toBe("2026-09-23");
  });

  it("uses each provider's reset hour, so an 08:00 reset still holds yesterday's spend at 07:00", async () => {
    const ledger = createQuotaLedger();
    // This provider publishes 40 requests a day, so one metro may spend 20 of them.
    const provider = providerCosting(lateReset, 20);
    expect(ledger.ceilingsFor(lateReset)).toEqual({ unit: "request", account: 40, metro: 20 });

    const morning = T("2026-09-22T09:00:00.000Z");
    expect((await spend(ledger, provider, { at: morning, metro: "nyc" })).ok).toBe(true);
    expect((await spend(ledger, provider, { at: morning, metro: "lisbon" })).ok).toBe(true);
    expect(ledger.dayKeyFor(lateReset, morning)).toBe("2026-09-22");

    // Past UTC midnight but before the vendor's 08:00 reset: the same quota day, nothing left.
    const beforeReset = T("2026-09-23T07:00:00.000Z");
    const stillSameQuotaDay = await spend(ledger, provider, { at: beforeReset, metro: "austin" });
    expect(stillSameQuotaDay.ok).toBe(false);
    if (stillSameQuotaDay.ok) throw new Error("unreachable");
    expect(stillSameQuotaDay.scope).toBe("account");
    expect(ledger.dayKeyFor(lateReset, beforeReset)).toBe("2026-09-22");

    const afterReset = T("2026-09-23T08:00:00.000Z");
    expect((await spend(ledger, provider, { at: afterReset, metro: "austin" })).ok).toBe(true);
    expect(ledger.dayKeyFor(lateReset, afterReset)).toBe("2026-09-23");
  });
});

// --- Reserving and reconciling ---------------------------------------------------------------

describe("reserve", () => {
  it("refuses a call that would take the day past the configured ceiling", async () => {
    const ledger = createQuotaLedger({ config: accountOnly() });
    const provider = providerCosting(cloudflare, 3_000);
    const at = T("2026-09-22T12:00:00.000Z");

    for (let i = 0; i < 3; i++) {
      expect((await spend(ledger, provider, { at, metro: "nyc" })).ok).toBe(true);
    }
    const refused = await spend(ledger, provider, { at, metro: "nyc" });
    expect(refused.ok).toBe(false);
    if (refused.ok) throw new Error("unreachable");
    expect(refused.reason).toBe("quota_exhausted");
    expect(refused.scope).toBe("account");
    // 9,000, not Cloudflare's 10,000: we stop on our own margin, before error 3036 / HTTP 429.
    expect(refused.ceiling).toBe(DEFAULT_DAILY_NEURON_BUDGET);
    expect(refused.used).toBe(9_000);
    expect(refused.unit).toBe("neuron");
  });

  it("holds a provider to the vendor's figure when that is lower than our budget", () => {
    const ledger = createQuotaLedger();
    // Gemini's policy here publishes 40 requests, below the 50-request default budget.
    expect(ledger.ceilingsFor(lateReset).account).toBe(40);
    expect(ledger.ceilingsFor(cloudflare).account).toBe(9_000);
  });

  it("charges the estimate up front and posts only the difference on reconciliation", async () => {
    const store = createInMemoryQuotaStore();
    const ledger = createQuotaLedger({ store });
    const provider = providerCosting(cloudflare, 1_000);
    const at = T("2026-09-22T12:00:00.000Z");

    const reserved = await ledger.reserve(provider, extract, granite, { at, metro: "nyc" });
    expect(reserved.ok).toBe(true);
    if (!reserved.ok) throw new Error("unreachable");
    expect(
      await store.read({ provider: "cloudflare", dayKey: "2026-09-22", scope: ACCOUNT_SCOPE }),
    ).toBe(1_000);

    // The real call came back cheaper than the estimate; the difference goes back to the day.
    await ledger.reconcile(reserved.reservation, usage(620));
    const after = await ledger.remaining(cloudflare, { at, metro: "nyc" });
    expect(after.accountUsed).toBe(620);
    expect(after.metroUsed).toBe(620);
    expect(after.accountRemaining).toBe(8_380);
    expect(ledger.openReservationCount()).toBe(0);

    // Reconciling twice must not charge twice.
    await ledger.reconcile(reserved.reservation, usage(620));
    expect((await ledger.remaining(cloudflare, { at })).accountUsed).toBe(620);
  });

  it("gives the estimate back when the call never happened", async () => {
    const ledger = createQuotaLedger();
    const provider = providerCosting(cloudflare, 4_000);
    const at = T("2026-09-22T12:00:00.000Z");

    const released = await ledger.reserve(provider, extract, granite, { at, metro: "nyc" });
    if (!released.ok) throw new Error("unreachable");
    await ledger.release(released.reservation);
    expect((await ledger.remaining(cloudflare, { at })).accountUsed).toBe(0);
    expect(ledger.openReservationCount()).toBe(0);

    // Releasing twice must not mint allowance.
    await ledger.release(released.reservation);
    expect((await ledger.remaining(cloudflare, { at })).accountUsed).toBe(0);
  });
});

// --- A call that outlives its reservation -----------------------------------------------------

describe("a reservation that outlives its TTL", () => {
  const at = T("2026-09-22T12:00:00.000Z");
  const pastTtl = T("2026-09-22T12:02:00.000Z");

  it("stays charged at its estimate, so a slow call is not free", async () => {
    // The bug this replaces: the sweep refunded the estimate, the late reconcile then found no
    // reservation and posted nothing, so any call slower than the TTL cost the ledger zero and
    // the ceiling could be walked past forever.
    const ledger = createQuotaLedger({
      config: accountOnly(),
      reservationTtlMs: 60_000,
      now: () => at,
    });
    const provider = providerCosting(cloudflare, 4_000);

    const slow = await ledger.reserve(provider, extract, granite, { at, metro: "nyc" });
    if (!slow.ok) throw new Error("unreachable");
    expect(ledger.openReservationCount()).toBe(1);

    // Two minutes later another call sweeps: the slow one expires but keeps its charge.
    const next = await ledger.reserve(provider, extract, granite, { at: pastTtl, metro: "nyc" });
    expect(next.ok).toBe(true);
    expect(ledger.openReservationCount()).toBe(1);
    expect(ledger.expiredReservationCount()).toBe(1);
    const held = await ledger.remaining(cloudflare, { at: pastTtl, metro: "nyc" });
    expect(held.accountUsed).toBe(8_000);
    expect(held.metroUsed).toBe(8_000);

    // The slow call finally answers, over its estimate. A late reconcile still corrects both
    // buckets: 4,000 held for the second call, plus the 5,200 this one really cost.
    await ledger.reconcile(slow.reservation, usage(5_200));
    const settled = await ledger.remaining(cloudflare, { at: pastTtl, metro: "nyc" });
    expect(settled.accountUsed).toBe(9_200);
    expect(settled.metroUsed).toBe(9_200);
    expect(ledger.expiredReservationCount()).toBe(0);

    // And that call is now over the day's ceiling, as it should be: the vendor charged us.
    expect(settled.accountRemaining).toBe(0);
    const refused = await ledger.reserve(provider, extract, granite, { at: pastTtl, metro: "nyc" });
    expect(refused.ok).toBe(false);
  });

  it("can still be released explicitly, for a call we know never happened", async () => {
    const ledger = createQuotaLedger({ config: accountOnly(), reservationTtlMs: 60_000 });
    const provider = providerCosting(cloudflare, 4_000);

    const abandoned = await ledger.reserve(provider, extract, granite, { at, metro: "nyc" });
    if (!abandoned.ok) throw new Error("unreachable");
    await ledger.reserve(provider, extract, granite, { at: pastTtl, metro: "nyc" });
    expect(ledger.expiredReservationCount()).toBe(1);

    await ledger.release(abandoned.reservation);
    expect(ledger.expiredReservationCount()).toBe(0);
    expect((await ledger.remaining(cloudflare, { at: pastTtl })).accountUsed).toBe(4_000);
  });

  it("is eventually forgotten, and its charge stands", async () => {
    // Bounded memory, but the charge is never handed back: a call whose answer we never heard is
    // a call the vendor most likely billed.
    const ledger = createQuotaLedger({
      config: accountOnly(),
      reservationTtlMs: 60_000,
      abandonReservationAfterMs: 600_000,
    });
    const provider = providerCosting(cloudflare, 1_000);
    const forgotten = await ledger.reserve(provider, extract, granite, { at, metro: "nyc" });
    if (!forgotten.ok) throw new Error("unreachable");

    const wayLater = T("2026-09-22T12:30:00.000Z");
    await ledger.reserve(provider, extract, granite, { at: wayLater, metro: "nyc" });
    expect(ledger.openReservationCount()).toBe(1);
    expect(ledger.expiredReservationCount()).toBe(0);
    expect((await ledger.remaining(cloudflare, { at: wayLater })).accountUsed).toBe(2_000);

    // A reconcile that arrives after that is a no-op, not a refund.
    await ledger.reconcile(forgotten.reservation, usage(10));
    expect((await ledger.remaining(cloudflare, { at: wayLater })).accountUsed).toBe(2_000);
  });
});

// --- Concurrency ------------------------------------------------------------------------------

describe("concurrent reservations", () => {
  it("never lets a racing fan-out overshoot the account ceiling", async () => {
    // The pipeline fans out over a metro's venues, so concurrent reserves are the normal case.
    // Reading the counter and then adding to it would let all 60 of these pass the same stale
    // check and charge 60,000 neurons against a 9,000 ceiling.
    const ledger = createQuotaLedger({ config: accountOnly() });
    const provider = providerCosting(cloudflare, 1_000);
    const at = T("2026-09-22T12:00:00.000Z");

    const outcomes = await Promise.all(
      Array.from({ length: 60 }, () =>
        ledger.reserve(provider, extract, granite, { at, metro: "nyc" }),
      ),
    );
    const granted = outcomes.filter((outcome) => outcome.ok);
    expect(granted).toHaveLength(9);

    const state = await ledger.remaining(cloudflare, { at, metro: "nyc" });
    expect(state.accountUsed).toBe(9_000);
    expect(state.accountUsed).toBeLessThanOrEqual(state.ceilings.account);
    expect(state.accountRemaining).toBe(0);
  });

  it("never lets a racing fan-out overshoot one metro's cap, and refunds the account when it binds", async () => {
    const config: AiBudgetConfig = { ...defaultBudgetConfig(), metroNeuronCap: 2_000 };
    const ledger = createQuotaLedger({ config });
    const provider = providerCosting(cloudflare, 500);
    const at = T("2026-09-22T12:00:00.000Z");

    const outcomes = await Promise.all(
      Array.from({ length: 40 }, () =>
        ledger.reserve(provider, extract, granite, { at, metro: "lisbon" }),
      ),
    );
    expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(4);

    // Every refused call handed its account charge straight back, so the account shows only the
    // four that were actually granted -- not the forty that briefly touched it.
    const state = await ledger.remaining(cloudflare, { at, metro: "lisbon" });
    expect(state.metroUsed).toBe(2_000);
    expect(state.accountUsed).toBe(2_000);

    // And New York still has the rest of the day, which is the point of the cap.
    const newYork = await ledger.reserve(provider, extract, granite, { at, metro: "nyc" });
    expect(newYork.ok).toBe(true);
  });

  it("keeps two metros racing at once inside both the metro cap and the account ceiling", async () => {
    const config: AiBudgetConfig = {
      ...defaultBudgetConfig(),
      dailyNeuronBudget: 3_000,
      metroNeuronCap: 2_000,
    };
    const ledger = createQuotaLedger({ config });
    const provider = providerCosting(cloudflare, 500);
    const at = T("2026-09-22T12:00:00.000Z");

    const outcomes = await Promise.all(
      Array.from({ length: 30 }, (_, i) =>
        ledger.reserve(provider, extract, granite, { at, metro: i % 2 === 0 ? "nyc" : "lisbon" }),
      ),
    );
    expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(6);

    const nyc = await ledger.remaining(cloudflare, { at, metro: "nyc" });
    const lisbon = await ledger.remaining(cloudflare, { at, metro: "lisbon" });
    expect(nyc.accountUsed).toBe(3_000);
    expect(nyc.metroUsed).toBeLessThanOrEqual(2_000);
    expect(lisbon.metroUsed).toBeLessThanOrEqual(2_000);
    expect((nyc.metroUsed ?? 0) + (lisbon.metroUsed ?? 0)).toBe(3_000);
  });
});

// --- The per-metro cap -------------------------------------------------------------------------

describe("the per-metro cap", () => {
  it("stops one metro's cold start from starving every other metro", async () => {
    // The critic measured a cold start at roughly 7,150 neurons: 71% of the account's day.
    const config: AiBudgetConfig = { ...defaultBudgetConfig(), metroNeuronCap: 3_000 };
    const ledger = createQuotaLedger({ config });
    const coldStart = providerCosting(cloudflare, 1_500);
    const at = T("2026-09-22T12:00:00.000Z");

    expect((await spend(ledger, coldStart, { at, metro: "lisbon" })).ok).toBe(true);
    expect((await spend(ledger, coldStart, { at, metro: "lisbon" })).ok).toBe(true);
    const thirdForLisbon = await spend(ledger, coldStart, { at, metro: "lisbon" });
    expect(thirdForLisbon.ok).toBe(false);
    if (thirdForLisbon.ok) throw new Error("unreachable");
    expect(thirdForLisbon.scope).toBe("metro");
    expect(thirdForLisbon.ceiling).toBe(3_000);

    // New York is untouched: the account still has 6,000 neurons and Lisbon cannot have them.
    const newYork = await spend(ledger, coldStart, { at, metro: "nyc" });
    expect(newYork.ok).toBe(true);
    const state = await ledger.remaining(cloudflare, { at, metro: "nyc" });
    expect(state.accountUsed).toBe(4_500);
    expect(state.metroUsed).toBe(1_500);
    expect(state.ceilings.metro).toBe(3_000);
  });

  it("cannot be bypassed by omitting the metro: that is a compile error", () => {
    const ledger = createQuotaLedger();
    const provider = providerCosting(cloudflare, 1_500);
    const at = T("2026-09-22T12:00:00.000Z");

    // The cap used to be opt-in, so a cold start that forgot to name its metro was charged
    // against the account alone and could drain the whole day. These two lines must not compile;
    // `@ts-expect-error` fails the typecheck if the mistake ever becomes legal again.
    // @ts-expect-error -- a spending call must name its metro.
    const withoutMetro = () => ledger.reserve(provider, extract, granite, { at });
    // @ts-expect-error -- and the options object itself is not optional.
    const withoutOptions = () => ledger.reserve(provider, extract, granite);
    expect([withoutMetro, withoutOptions]).toHaveLength(2);

    // Reporting is the one place a metro may be left out: reading the account is not spending.
    expect(ledger.remaining(cloudflare, { at })).toBeInstanceOf(Promise);
  });

  it("defaults a metro to half the day, so a second metro can always run", () => {
    expect(defaultMetroCap(DEFAULT_DAILY_NEURON_BUDGET)).toBe(4_500);
    expect(defaultMetroCap(6_000)).toBe(3_000);
    expect(createQuotaLedger().ceilingsFor(cloudflare).metro).toBe(4_500);
  });

  it("keeps metro counters apart in the store", async () => {
    const store = createInMemoryQuotaStore();
    const ledger = createQuotaLedger({ store });
    const provider = providerCosting(cloudflare, 200);
    const at = T("2026-09-22T12:00:00.000Z");
    const reserved = await ledger.reserve(provider, extract, granite, { at, metro: "nyc" });
    if (!reserved.ok) throw new Error("unreachable");
    await ledger.reconcile(reserved.reservation, usage(200));
    expect(
      await store.read({ provider: "cloudflare", dayKey: "2026-09-22", scope: metroScope("nyc") }),
    ).toBe(200);
    expect(
      await store.read({
        provider: "cloudflare",
        dayKey: "2026-09-22",
        scope: metroScope("austin"),
      }),
    ).toBe(0);
  });
});

// --- The exhaustion notice ---------------------------------------------------------------------

describe("the exhaustion notice", () => {
  it("fires exactly once per provider per day, and again the next day", async () => {
    const events: QuotaExhaustedEvent[] = [];
    const ledger = createQuotaLedger({
      config: accountOnly(),
      onExhausted: (event) => events.push(event),
    });
    const provider = providerCosting(cloudflare, 9_000);
    const day = T("2026-09-22T12:00:00.000Z");

    expect((await spend(ledger, provider, { at: day, metro: "nyc" })).ok).toBe(true);
    for (let i = 0; i < 3; i++) {
      expect((await spend(ledger, provider, { at: day, metro: "nyc" })).ok).toBe(false);
    }
    expect(events).toHaveLength(1);
    expect(events[0]?.provider).toBe("cloudflare");
    expect(events[0]?.dayKey).toBe("2026-09-22");
    expect(events[0]?.ceiling).toBe(9_000);
    expect(events[0]?.unit).toBe("neuron");

    const nextDay = T("2026-09-23T12:00:00.000Z");
    expect((await spend(ledger, provider, { at: nextDay, metro: "nyc" })).ok).toBe(true);
    expect((await spend(ledger, provider, { at: nextDay, metro: "nyc" })).ok).toBe(false);
    expect(events).toHaveLength(2);
    expect(events[1]?.dayKey).toBe("2026-09-23");
  });

  it("reaches a Notifier as well as the callback, which is the seam the client wires", async () => {
    // The owner asked to be told when the ceiling binds. The ledger still sends nothing itself:
    // it hands the event to whatever the client passed in.
    const seen: QuotaExhaustedEvent[] = [];
    const notifier: Notifier = {
      quotaExhausted: (event) => {
        seen.push(event);
      },
    };
    const ledger = createQuotaLedger({ config: accountOnly(), notifier });
    const provider = providerCosting(cloudflare, 9_000);
    const at = T("2026-09-22T12:00:00.000Z");

    expect((await spend(ledger, provider, { at, metro: "nyc" })).ok).toBe(true);
    expect((await spend(ledger, provider, { at, metro: "nyc" })).ok).toBe(false);
    expect((await spend(ledger, provider, { at, metro: "nyc" })).ok).toBe(false);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.ceiling).toBe(9_000);
  });

  it("does not fire when one metro's share binds: other metros still have allowance", async () => {
    const onExhausted = vi.fn();
    const config: AiBudgetConfig = { ...defaultBudgetConfig(), metroNeuronCap: 1_000 };
    const ledger = createQuotaLedger({ config, onExhausted });
    const provider = providerCosting(cloudflare, 900);
    const at = T("2026-09-22T12:00:00.000Z");
    expect((await spend(ledger, provider, { at, metro: "nyc" })).ok).toBe(true);
    expect((await spend(ledger, provider, { at, metro: "nyc" })).ok).toBe(false);
    expect(onExhausted).not.toHaveBeenCalled();
  });

  it("fires when the vendor itself says the day is gone, and the ledger sends nothing", async () => {
    const events: QuotaExhaustedEvent[] = [];
    const ledger = createQuotaLedger({ onExhausted: (event) => events.push(event) });
    const at = T("2026-09-22T12:00:00.000Z");
    await ledger.markExhausted(cloudflare, { at });
    await ledger.markExhausted(cloudflare, { at });
    expect(events).toHaveLength(1);
    expect(events[0]?.used).toBe(9_000);
    const provider = providerCosting(cloudflare, 1);
    expect((await ledger.reserve(provider, extract, granite, { at, metro: "nyc" })).ok).toBe(false);
  });

  it("survives a notifier that throws, because accounting is not delivery", async () => {
    const ledger = createQuotaLedger({
      config: accountOnly(),
      onExhausted: () => {
        throw new Error("the mailer is down");
      },
      notifier: {
        quotaExhausted: () => {
          throw new Error("the logger is down too");
        },
      },
    });
    const provider = providerCosting(cloudflare, 9_001);
    const at = T("2026-09-22T12:00:00.000Z");
    await expect(
      ledger.reserve(provider, extract, granite, { at, metro: "nyc" }),
    ).resolves.toMatchObject({ ok: false });
  });
});

// --- Configuration ---------------------------------------------------------------------------

describe("readAiBudgetConfig", () => {
  it("defaults to a margin below Cloudflare's published 10,000 neurons", () => {
    const config = readAiBudgetConfig({});
    expect(config.dailyNeuronBudget).toBe(9_000);
    expect(config.metroNeuronCap).toBe(4_500);
    expect(config.dailyRequestBudget).toBe(50);
    expect(config.problems).toEqual([]);
  });

  it("reads the variables and derives the metro cap from whatever budget is set", () => {
    const config = readAiBudgetConfig({ AI_DAILY_NEURON_BUDGET: "6000" });
    expect(config.dailyNeuronBudget).toBe(6_000);
    expect(config.metroNeuronCap).toBe(3_000);
    const explicit = readAiBudgetConfig({
      AI_DAILY_NEURON_BUDGET: "8000",
      AI_METRO_NEURON_CAP: "2000",
      AI_DAILY_REQUEST_BUDGET: "25",
    });
    expect(explicit.metroNeuronCap).toBe(2_000);
    expect(explicit.dailyRequestBudget).toBe(25);
  });

  it("ignores the old AI_METRO_NEURON_RESERVE name, which meant the opposite", () => {
    // The rename is not cosmetic: "reserve" read as neurons held BACK from a metro, while the
    // number is the most a metro may SPEND. A stale value must not quietly take effect.
    const config = readAiBudgetConfig({ AI_METRO_NEURON_RESERVE: "500" });
    expect(config.metroNeuronCap).toBe(4_500);
    expect(config.problems).toEqual([]);
  });

  it("never throws: a bad value is dropped, reported, and the default stands", () => {
    const config = readAiBudgetConfig({
      AI_DAILY_NEURON_BUDGET: "lots",
      AI_METRO_NEURON_CAP: "-5",
      AI_DAILY_REQUEST_BUDGET: "   ",
    });
    expect(config.dailyNeuronBudget).toBe(9_000);
    expect(config.metroNeuronCap).toBe(4_500);
    expect(config.dailyRequestBudget).toBe(50);
    expect(config.problems.map((p) => p.variable)).toEqual([
      "AI_DAILY_NEURON_BUDGET",
      "AI_METRO_NEURON_CAP",
    ]);
  });
});

describe("Workers Paid (ingest run 21, D-058)", () => {
  it("holds the budget to the free 10,000 until the account is marked paid", () => {
    const free = readAiBudgetConfig({
      AI_DAILY_NEURON_BUDGET: "50000",
      AI_METRO_NEURON_CAP: "25000",
    });
    expect(free.neuronsPaid).toBe(false);
    expect(createQuotaLedger({ config: free }).ceilingsFor(cloudflare)).toMatchObject({
      account: 10_000,
      metro: 10_000,
    });

    const paid = readAiBudgetConfig({
      AI_DAILY_NEURON_BUDGET: "50000",
      AI_METRO_NEURON_CAP: "25000",
      CLOUDFLARE_WORKERS_PAID: "true",
    });
    expect(createQuotaLedger({ config: paid }).ceilingsFor(cloudflare)).toMatchObject({
      account: 50_000,
      metro: 25_000,
    });
  });

  it("reads anything but a yes or no word as unset, and says so", () => {
    const config = readAiBudgetConfig({ CLOUDFLARE_WORKERS_PAID: "paid" });
    expect(config.neuronsPaid).toBe(false);
    expect(config.problems.map((p) => p.variable)).toEqual(["CLOUDFLARE_WORKERS_PAID"]);
  });
});

describe("the in-memory store", () => {
  it("reads an unknown key as zero and never falls below zero", async () => {
    const store = createInMemoryQuotaStore();
    const key = { provider: "cloudflare", dayKey: "2026-09-22", scope: ACCOUNT_SCOPE } as const;
    expect(await store.read(key)).toBe(0);
    expect(await store.add(key, 120)).toBe(120);
    expect(await store.add(key, -500)).toBe(0);
    expect(store.snapshot()).toEqual({});
    await store.add(key, 7);
    expect(store.snapshot()).toEqual({ "cloudflare/2026-09-22/account": 7 });
    store.clear();
    expect(store.snapshot()).toEqual({});
  });

  it("compares and increments in one step, and writes nothing when it refuses", async () => {
    const store = createInMemoryQuotaStore();
    const key = { provider: "cloudflare", dayKey: "2026-09-22", scope: ACCOUNT_SCOPE } as const;

    expect(await store.addWithinCeiling(key, 80, 100)).toEqual({ ok: true, total: 80 });
    expect(await store.addWithinCeiling(key, 30, 100)).toEqual({ ok: false, used: 80 });
    // Refused means untouched, not partially applied.
    expect(await store.read(key)).toBe(80);
    expect(await store.addWithinCeiling(key, 20, 100)).toEqual({ ok: true, total: 100 });
    expect(await store.addWithinCeiling(key, 0, 100)).toEqual({ ok: true, total: 100 });

    // Nothing between the read and the write yields the event loop, so racing callers queue up.
    const store2 = createInMemoryQuotaStore();
    const results = await Promise.all(
      Array.from({ length: 25 }, () => store2.addWithinCeiling(key, 10, 100)),
    );
    expect(results.filter((result) => result.ok)).toHaveLength(10);
    expect(await store2.read(key)).toBe(100);
  });
});
