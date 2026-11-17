// The quota ledger: free-tier accounting in each provider's own unit (D-039, contract rule 1).
//
// Five findings from the 2026-09-22 free-tier survey shape this file.
//
//  1. THE UNITS DIFFER. Cloudflare Workers AI meters "neurons" derived from token counts --
//     "a total of 10,000 Neurons per day at no charge", shared across every model and task --
//     while every other free tier meters whole requests. So a bucket is counted in
//     `QuotaPolicy.unit` and nothing here converts between the two.
//     A paid provider (Bedrock, D-142) is metered in microdollars against AI_DAILY_USD_CAP.
//
//  2. EXHAUSTION IS A HARD STOP, NOT A THROTTLE. Cloudflare answers error 3036 / HTTP 429 once
//     the day's neurons are gone. We therefore stop at a configured ceiling that sits BELOW the
//     vendor's figure (AI_DAILY_NEURON_BUDGET, default 9,000 against the vendor's 10,000), so the
//     pipeline defers on our own margin instead of on the vendor's error.
//
//  3. OUTPUT LENGTH IS NOT KNOWN IN ADVANCE. `rawExtractionSchema` returns an ARRAY of listings,
//     so a long list page costs several times what a single-event page costs. A call therefore
//     reserves its estimate first and reconciles with the real usage afterwards.
//
//     A reservation that outlives `reservationTtlMs` STAYS CHARGED at its estimate. It used to be
//     refunded by the sweep, which made a slow call free: the sweep handed the estimate back, the
//     late `reconcile()` then found no open reservation and posted nothing, so a call slower than
//     two minutes cost the ledger zero and the ceiling could be walked past indefinitely. The
//     vendor charged us for that call whether or not we were still waiting for the answer, so an
//     expired reservation is not a refund but a charge we have not yet corrected: it stays on the
//     books until `reconcile()` posts the real figure or `release()` says the call never happened.
//
//  4. ONE COLD START CAN DRAIN THE ACCOUNT. A new metro's cold start was measured at roughly
//     7,150 neurons -- 71% of the whole daily allowance -- so without a per-metro cap the first
//     visitor in a new city takes every other metro down for the rest of the day.
//     AI_METRO_NEURON_CAP is that cap, and naming a metro is mandatory on the spending path:
//     `LedgerCallOptions.metro` is required, so a caller that forgets one does not quietly bypass
//     the cap and drain the account -- it fails to compile.
//
//  5. A CEILING CHECKED IN TWO STEPS IS NOT A CEILING. Reading a counter and then adding to it
//     are two turns of the event loop, and every call in flight between them reads the same stale
//     total, so N concurrent reservations could all pass a check that only one of them should
//     have. Reserving therefore goes through `QuotaStore.addWithinCeiling`, which compares and
//     increments in one indivisible step.
//
// The ledger never sends anything. When a provider's allowance first binds it announces that once
// for that provider and day, to `onExhausted` and to the `Notifier` the client wires up; actually
// telling the owner is the caller's job.

import { z } from "zod";

import type {
  AiJob,
  AiModel,
  AiProvider,
  AiProviderId,
  AiProviderMeta,
  AiUsage,
  QuotaUnit,
} from "@/src/ai/types";
import type { EnvProblem } from "@/src/config/env";

// --- Configuration ---------------------------------------------------------------------------

/**
 * Cloudflare publishes 10,000 neurons per day. We stop at 9,000 so that the margin absorbs the
 * gap between our token estimate and the vendor's own accounting.
 *
 * This file owns the budget defaults. `src/config/env.ts` parses the raw strings and nothing
 * more: it holds no second copy of these numbers to drift away from these ones.
 */
export const DEFAULT_DAILY_NEURON_BUDGET = 9_000;

/**
 * The daily ceiling for a request-metered provider whose figure we could not verify (Gemini and
 * Groq both publish nothing we could read). Rather than invent a number we hold them to the
 * lowest free-tier daily figure the survey DID verify: OpenRouter's
 * FREE_MODEL_NO_CREDITS_RPD = 50. A provider that publishes a smaller figure caps itself.
 */
export const DEFAULT_DAILY_REQUEST_BUDGET = 50;

/**
 * Owner's decision D-142 (2026-10-12): $1 per day across the account for the paid Bedrock provider.
 * The ledger counts microdollars (millionths of a dollar) so the cap stays exact.
 */
export const DEFAULT_DAILY_USD_CAP = 1;

/**
 * The most one metro may SPEND in a day: half of the day's allowance, so a second metro can
 * always run. Derived from the daily budget rather than fixed, so raising the budget raises both.
 *
 * The variable behind it used to be called AI_METRO_NEURON_RESERVE, which reads as neurons "held
 * back" from the metro -- close to the opposite of what the code does with it. It is
 * AI_METRO_NEURON_CAP now, in code, environment, `.env.example` and docs.
 */
export function defaultMetroCap(dailyBudget: number): number {
  return Math.floor(dailyBudget / 2);
}

export interface AiBudgetConfig {
  /** Neurons per day we allow ourselves across the whole account (AI_DAILY_NEURON_BUDGET). */
  readonly dailyNeuronBudget: number;
  /** The most neurons one metro may spend in a day (AI_METRO_NEURON_CAP). */
  readonly metroNeuronCap: number;
  /** Requests per day for a request-metered provider (AI_DAILY_REQUEST_BUDGET). */
  readonly dailyRequestBudget: number;
  /**
   * The account is on Workers Paid (CLOUDFLARE_WORKERS_PAID, D-058), so the vendor's free 10,000
   * neurons a day is an allowance, not a limit: past it, neurons are billed rather than refused.
   * Only then may `dailyNeuronBudget` sit above the vendor's figure. Absent means false.
   */
  readonly neuronsPaid?: boolean;
  /** Dollars per day the paid Bedrock provider may spend, account-wide (AI_DAILY_USD_CAP). */
  readonly dailyUsdCap?: number;
  /** The most dollars one metro may spend in a day (AI_METRO_USD_CAP). Undefined means derived. */
  readonly metroUsdCap?: number;
}

export interface AiBudgetConfigResult extends AiBudgetConfig {
  /** Values that failed validation and were ignored, in the shape `src/config/env.ts` uses. */
  readonly problems: EnvProblem[];
}

/** A positive integer, where unset, empty and unparseable all read as undefined. */
const positiveInt = z.preprocess(
  (value) => (typeof value === "string" && value.trim() !== "" ? Number(value.trim()) : undefined),
  z.number().int().positive().optional(),
);

/** A positive number (decimals allowed), where unset, empty and unparseable all read as undefined. */
const positiveNumber = z.preprocess(
  (value) => (typeof value === "string" && value.trim() !== "" ? Number(value.trim()) : undefined),
  z.number().positive().optional(),
);

function readInt(
  source: Record<string, string | undefined>,
  variable: string,
  problems: EnvProblem[],
): number | undefined {
  const raw = source[variable];
  if (raw === undefined || raw.trim() === "") return undefined;
  const parsed = positiveInt.safeParse(raw);
  if (!parsed.success) {
    problems.push({ variable, message: "not a positive whole number" });
    return undefined;
  }
  return parsed.data;
}

function readPositiveNumber(
  source: Record<string, string | undefined>,
  variable: string,
  problems: EnvProblem[],
): number | undefined {
  const raw = source[variable];
  if (raw === undefined || raw.trim() === "") return undefined;
  const parsed = positiveNumber.safeParse(raw);
  if (!parsed.success) {
    problems.push({ variable, message: "not a positive number" });
    return undefined;
  }
  return parsed.data;
}

function readFlag(
  source: Record<string, string | undefined>,
  variable: string,
  problems: EnvProblem[],
): boolean | undefined {
  const raw = source[variable]?.trim().toLowerCase();
  if (raw === undefined || raw === "") return undefined;
  if (["true", "1", "yes", "on"].includes(raw)) return true;
  if (["false", "0", "no", "off"].includes(raw)) return false;
  problems.push({ variable, message: "not true or false" });
  return undefined;
}

/**
 * Reads the budget variables without ever throwing, exactly as `parseEnv` does: a bad value is
 * dropped, the default stands, and the problem is reported for the admin page.
 */
export function readAiBudgetConfig(
  source: Record<string, string | undefined> = process.env,
): AiBudgetConfigResult {
  const problems: EnvProblem[] = [];
  const dailyNeuronBudget =
    readInt(source, "AI_DAILY_NEURON_BUDGET", problems) ?? DEFAULT_DAILY_NEURON_BUDGET;
  const dailyRequestBudget =
    readInt(source, "AI_DAILY_REQUEST_BUDGET", problems) ?? DEFAULT_DAILY_REQUEST_BUDGET;
  const metroRaw = readInt(source, "AI_METRO_NEURON_CAP", problems);
  const metroNeuronCap = metroRaw ?? defaultMetroCap(dailyNeuronBudget);
  const neuronsPaid = readFlag(source, "CLOUDFLARE_WORKERS_PAID", problems) ?? false;
  const dailyUsdCap =
    readPositiveNumber(source, "AI_DAILY_USD_CAP", problems) ?? DEFAULT_DAILY_USD_CAP;
  const metroUsdCap = readPositiveNumber(source, "AI_METRO_USD_CAP", problems);
  return {
    dailyNeuronBudget,
    metroNeuronCap,
    dailyRequestBudget,
    neuronsPaid,
    dailyUsdCap,
    ...(metroUsdCap === undefined ? {} : { metroUsdCap }),
    problems,
  };
}

/** The defaults, for callers that build their own ledger without reading the environment. */
export function defaultBudgetConfig(): AiBudgetConfig {
  return {
    dailyNeuronBudget: DEFAULT_DAILY_NEURON_BUDGET,
    metroNeuronCap: defaultMetroCap(DEFAULT_DAILY_NEURON_BUDGET),
    dailyRequestBudget: DEFAULT_DAILY_REQUEST_BUDGET,
    dailyUsdCap: DEFAULT_DAILY_USD_CAP,
  };
}

// --- The day key -----------------------------------------------------------------------------

export const ACCOUNT_SCOPE = "account";

/** The bucket key for one metro's share of a provider's day. */
export function metroScope(metro: string): string {
  return `metro:${metro}`;
}

const MS_PER_HOUR = 3_600_000;

/**
 * The key of the quota day containing `at`, for a provider whose allowance resets at
 * `resetUtcHour` UTC.
 *
 * Derived from the reset boundary in UTC and never from a local calendar date: the process may
 * run in any zone (the pipeline runs jobs on each metro's local clock), and a local date would
 * roll the counter at the wrong moment and hand back an allowance the vendor has not reset.
 * Every arithmetic step below is UTC-only -- `Date.prototype.toISOString` and `Date.parse` of a
 * `Z`-suffixed string -- so TZ=UTC and TZ=America/New_York produce identical keys.
 */
export function quotaDayKey(at: Date, resetUtcHour: number): string {
  const hour = Number.isFinite(resetUtcHour) ? Math.trunc(resetUtcHour) : 0;
  const shifted = new Date(at.getTime() - hour * MS_PER_HOUR);
  return shifted.toISOString().slice(0, 10);
}

/** The instant the quota day containing `at` ends, for "resets in ..." copy and cache expiry. */
export function quotaDayEndsAt(at: Date, resetUtcHour: number): Date {
  const hour = Number.isFinite(resetUtcHour) ? Math.trunc(resetUtcHour) : 0;
  const key = quotaDayKey(at, hour);
  return new Date(Date.parse(`${key}T00:00:00.000Z`) + (hour + 24) * MS_PER_HOUR);
}

// --- The store -------------------------------------------------------------------------------

/** One counter: a provider's spend in one quota day, for one scope (the account, or a metro). */
export interface QuotaKey {
  readonly provider: AiProviderId;
  /** From `quotaDayKey`: the provider's own reset boundary, not today's local date. */
  readonly dayKey: string;
  /** `ACCOUNT_SCOPE`, or `metroScope(metro)`. */
  readonly scope: string;
}

/** The result of an atomic increment-and-compare. On refusal nothing was written. */
export type AddWithinCeiling =
  { readonly ok: true; readonly total: number } | { readonly ok: false; readonly used: number };

/**
 * Where a day's spend is kept, so that a Postgres table (`provider, day_key, scope, amount`) or
 * an Upstash counter drops in behind this interface without the ledger changing. Persistence
 * belongs to a later phase; the in-memory store below is what tests and mock mode use.
 *
 * CONTRACT FOR ANY FUTURE IMPLEMENTATION -- read this before writing the Postgres or KV one.
 *
 * `addWithinCeiling` MUST compare and increment in ONE indivisible step, and it MUST NOT be built
 * out of `read()` followed by `add()`. Two round trips leave a window in which every request in
 * flight reads the same stale total and every one of them passes a check that only the first
 * should have passed, so N concurrent calls overshoot the day's ceiling by up to N-1 estimates.
 * That is not a theoretical race: the pipeline fans out over a metro's venues, so the concurrent
 * case is the normal case, and the overshoot is exactly the vendor error (Cloudflare 3036 /
 * HTTP 429) the ceiling exists to stay clear of. Being a single process is no protection either:
 * an `await` between the read and the add yields the event loop to every other pending call.
 *
 * In Postgres that is one statement:
 *
 *     INSERT INTO ai_quota (provider, day_key, scope, amount) VALUES ($1, $2, $3, $4)
 *     ON CONFLICT (provider, day_key, scope) DO UPDATE SET amount = ai_quota.amount + $4
 *       WHERE ai_quota.amount + $4 <= $5
 *     RETURNING amount;
 *
 * -- no row returned means refused, and nothing was written. In Redis/Upstash it is one Lua
 * script (or one `EVAL`) doing `GET`, the comparison and `INCRBY` inside the server; it is NOT
 * `INCRBY` followed by a compare-and-`DECRBY`, which lets a concurrent reader observe a total
 * above the ceiling.
 *
 * `read()` and `add()` stay for reconciliation, release and reporting, where no ceiling is being
 * enforced and a stale read cannot overshoot anything.
 */
export interface QuotaStore {
  /** The amount spent against this key so far. An unknown key reads as 0, never as an error. */
  read(key: QuotaKey): Promise<number>;
  /** Adds `amount` (negative when releasing or correcting) and returns the new total. */
  add(key: QuotaKey, amount: number): Promise<number>;
  /**
   * Adds `amount` only if the result would not exceed `ceiling`, atomically. Returns the new
   * total on success, or the unchanged total on refusal. See the contract note above.
   */
  addWithinCeiling(key: QuotaKey, amount: number, ceiling: number): Promise<AddWithinCeiling>;
}

export interface InMemoryQuotaStore extends QuotaStore {
  /** Every non-zero counter, for assertions and the admin page. */
  snapshot(): Record<string, number>;
  clear(): void;
}

function serialiseKey(key: QuotaKey): string {
  return `${key.provider}\u0000${key.dayKey}\u0000${key.scope}`;
}

export function createInMemoryQuotaStore(): InMemoryQuotaStore {
  const counters = new Map<string, number>();
  return {
    read(key) {
      return Promise.resolve(counters.get(serialiseKey(key)) ?? 0);
    },
    add(key, amount) {
      const id = serialiseKey(key);
      // Clamped at zero: a double release must not mint allowance out of a negative counter.
      const next = Math.max(0, (counters.get(id) ?? 0) + amount);
      counters.set(id, next);
      return Promise.resolve(next);
    },
    addWithinCeiling(key, amount, ceiling) {
      const id = serialiseKey(key);
      // Atomic by construction: the read, the comparison and the write happen in one synchronous
      // run of this function, with no `await` in between for the event loop to interleave at.
      // The promise is created only once the counter is already written.
      const used = counters.get(id) ?? 0;
      if (used + amount > ceiling) return Promise.resolve({ ok: false, used });
      const next = Math.max(0, used + amount);
      counters.set(id, next);
      return Promise.resolve({ ok: true, total: next });
    },
    snapshot() {
      const out: Record<string, number> = {};
      for (const [id, value] of counters) {
        if (value !== 0) out[id.split("\u0000").join("/")] = value;
      }
      return out;
    },
    clear() {
      counters.clear();
    },
  };
}

// --- The ledger ------------------------------------------------------------------------------

/** The two ceilings that bind a call: the whole account's day, and one metro's share of it. */
export interface QuotaCeilings {
  readonly unit: QuotaUnit;
  readonly account: number;
  readonly metro: number;
}

export interface QuotaRemaining {
  readonly provider: AiProviderId;
  readonly dayKey: string;
  readonly unit: QuotaUnit;
  readonly ceilings: QuotaCeilings;
  readonly accountUsed: number;
  readonly accountRemaining: number;
  /** Null when no metro was named. Reporting may ask about the account alone; spending may not. */
  readonly metro: string | null;
  readonly metroUsed: number | null;
  readonly metroRemaining: number | null;
}

export interface Reservation {
  readonly id: string;
  readonly provider: AiProviderId;
  readonly dayKey: string;
  readonly unit: QuotaUnit;
  /** Never null: every spending call names its metro (finding 4). */
  readonly metro: string;
  /** What we charged the buckets up front; reconciliation posts the difference. */
  readonly estimate: number;
  /** The account ceiling in force when the reservation was taken, kept for reconciliation. */
  readonly accountCeiling: number;
  readonly createdAt: number;
}

export type ReserveOutcome =
  | { readonly ok: true; readonly reservation: Reservation }
  | {
      readonly ok: false;
      readonly reason: "quota_exhausted";
      /** "account" when the day's allowance is gone, "metro" when this metro has had its share. */
      readonly scope: "account" | "metro";
      readonly provider: AiProviderId;
      readonly dayKey: string;
      readonly unit: QuotaUnit;
      readonly ceiling: number;
      readonly used: number;
      readonly estimate: number;
    };

export interface QuotaExhaustedEvent {
  readonly provider: AiProviderId;
  readonly dayKey: string;
  readonly unit: QuotaUnit;
  readonly ceiling: number;
  readonly used: number;
  readonly at: Date;
}

/**
 * How the ledger tells someone that a day's ceiling has bound. The owner explicitly asked to be
 * told when that happens, so this seam exists to be wired rather than to be optional.
 *
 * The ledger itself sends nothing: it hands the event over and forgets it. The client owns the
 * implementations -- a logging one today, and an emailing one once D-023's Resend sending domain
 * exists (Q2 of the owner's answers: there is no domain yet, so nothing can be delivered).
 */
export interface Notifier {
  quotaExhausted(event: QuotaExhaustedEvent): void;
}

export interface QuotaLedgerOptions {
  readonly store?: QuotaStore;
  readonly config?: AiBudgetConfig;
  readonly now?: () => Date;
  /**
   * Called once per provider per quota day, the first time that provider's account allowance
   * binds. The owner asked to be told when the ceiling binds; the ledger only reports it.
   */
  readonly onExhausted?: (event: QuotaExhaustedEvent) => void;
  /** The same announcement, for callers that would rather pass an object than a closure. */
  readonly notifier?: Notifier;
  /**
   * How long a reservation may stay open before it is treated as expired. An expired reservation
   * stays CHARGED at its estimate (finding 3); it is not refunded.
   */
  readonly reservationTtlMs?: number;
  /**
   * How long an expired reservation is remembered so a late `reconcile()` can still correct it.
   * After that it is forgotten -- and its estimate stays on the day's books, because a call we
   * never heard the end of is a call the vendor most likely charged us for.
   */
  readonly abandonReservationAfterMs?: number;
}

/** Two minutes: longer than any call we make, short enough to notice a call that hung. */
export const DEFAULT_RESERVATION_TTL_MS = 120_000;

/**
 * An hour. Long enough that any answer still in flight can reconcile against its reservation,
 * short enough that a crashed process does not grow the map for a whole quota day.
 */
export const DEFAULT_ABANDON_RESERVATION_AFTER_MS = 3_600_000;

export interface QuotaLedger {
  readonly config: AiBudgetConfig;
  readonly store: QuotaStore;
  /** The quota day `at` falls in, on this provider's own reset boundary. */
  dayKeyFor(meta: AiProviderMeta, at?: Date): string;
  ceilingsFor(meta: AiProviderMeta): QuotaCeilings;
  remaining(meta: AiProviderMeta, options?: LedgerQueryOptions): Promise<QuotaRemaining>;
  /**
   * Charges `provider.estimateCost(job, model)` up front, or refuses before the call is made.
   * `options.metro` is required: see finding 4.
   */
  reserve(
    provider: AiProvider,
    job: AiJob,
    model: AiModel,
    options: LedgerCallOptions,
  ): Promise<ReserveOutcome>;
  /**
   * Posts the difference between the estimate and what the call really cost. Idempotent, and it
   * still works after the reservation has expired -- that is the whole point of expiry leaving
   * the charge in place.
   */
  reconcile(reservation: Reservation, usage: AiUsage | number): Promise<void>;
  /** Gives the estimate back when a call did not happen. Idempotent. */
  release(reservation: Reservation): Promise<void>;
  /** Records that the vendor itself said the allowance is gone (error 3036 / HTTP 429). */
  markExhausted(meta: AiProviderMeta, options?: LedgerQueryOptions): Promise<void>;
  /** Reservations taken and not yet settled or expired, for the leak assertion and the admin page. */
  openReservationCount(): number;
  /** Reservations past their TTL, still charged, still awaiting a late settlement. */
  expiredReservationCount(): number;
  /**
   * Subscribes to the once-per-provider-per-day exhaustion event. The client calls this whether
   * the ledger is its own or the caller's: wiring the listener only at construction meant that
   * passing a ledger, which is what a real pipeline does, silently discarded the notice.
   * Returns an unsubscribe function. A listener that throws is ignored, never propagated.
   */
  onExhausted(listener: (event: QuotaExhaustedEvent) => void): () => void;
}

/**
 * Options for a call that SPENDS. `metro` is mandatory in the type, not by convention: the
 * per-metro cap used to be opt-in, so a caller that passed no metro was charged against the
 * account alone and one cold start could drain the whole day. Omitting it is now a compile error.
 */
export interface LedgerCallOptions {
  /** The metro this call is for; its share of the day is capped separately. */
  readonly metro: string;
  /** The instant of the call. Defaults to the ledger's clock; tests pass it explicitly. */
  readonly at?: Date;
}

/** Options for a call that only READS or marks the account, where no metro need be named. */
export interface LedgerQueryOptions {
  readonly metro?: string | null;
  readonly at?: Date;
}

export function createQuotaLedger(options: QuotaLedgerOptions = {}): QuotaLedger {
  const store = options.store ?? createInMemoryQuotaStore();
  const config = options.config ?? defaultBudgetConfig();
  const now = options.now ?? (() => new Date());
  const ttl = options.reservationTtlMs ?? DEFAULT_RESERVATION_TTL_MS;
  const abandonAfter = options.abandonReservationAfterMs ?? DEFAULT_ABANDON_RESERVATION_AFTER_MS;
  /** Taken, charged, within the TTL. */
  const open = new Map<string, Reservation>();
  /** Past the TTL and still charged, kept so a late `reconcile()` can post the real figure. */
  const expired = new Map<string, Reservation>();
  const announced = new Set<string>();
  let counter = 0;

  function ceilingsFor(meta: AiProviderMeta): QuotaCeilings {
    const { unit, perDay } = meta.quota;
    if (unit === "neuron") {
      // On the free plan the vendor's figure caps our own budget, never a licence to exceed it.
      // On Workers Paid it is only the part that costs nothing, so our budget alone decides.
      const vendorCap = config.neuronsPaid ? null : perDay;
      const account = Math.min(config.dailyNeuronBudget, vendorCap ?? config.dailyNeuronBudget);
      return { unit, account, metro: Math.min(config.metroNeuronCap, account) };
    }
    if (unit === "microdollar") {
      // Dollars are the unit the owner set the cap in; the ledger counts millionths so it stays exact.
      const account = Math.round((config.dailyUsdCap ?? DEFAULT_DAILY_USD_CAP) * 1_000_000);
      const metro =
        config.metroUsdCap === undefined
          ? defaultMetroCap(account)
          : Math.round(config.metroUsdCap * 1_000_000);
      return { unit, account, metro: Math.min(metro, account) };
    }
    const account = Math.min(config.dailyRequestBudget, perDay ?? config.dailyRequestBudget);
    return { unit, account, metro: Math.min(defaultMetroCap(account), account) };
  }

  function dayKeyFor(meta: AiProviderMeta, at: Date = now()): string {
    return quotaDayKey(at, meta.quota.resetUtcHour);
  }

  function keyFor(meta: AiProviderMeta, dayKey: string, scope: string): QuotaKey {
    return { provider: meta.id, dayKey, scope };
  }

  function accountKeyOf(reservation: Reservation): QuotaKey {
    return { provider: reservation.provider, dayKey: reservation.dayKey, scope: ACCOUNT_SCOPE };
  }

  function metroKeyOf(reservation: Reservation): QuotaKey {
    return {
      provider: reservation.provider,
      dayKey: reservation.dayKey,
      scope: metroScope(reservation.metro),
    };
  }

  const listeners = new Set<(event: QuotaExhaustedEvent) => void>();

  function announce(event: QuotaExhaustedEvent): void {
    const id = `${event.provider}\u0000${event.dayKey}`;
    if (announced.has(id)) return;
    announced.add(id);
    for (const listener of listeners) {
      // A failing listener must never fail a call: accounting is the ledger's job, not delivery.
      try {
        listener(event);
      } catch {
        /* ignored on purpose */
      }
    }
    // A failing notifier must never fail a call: the ledger's job is accounting, not delivery.
    try {
      options.onExhausted?.(event);
    } catch {
      /* ignored on purpose */
    }
    try {
      options.notifier?.quotaExhausted(event);
    } catch {
      /* ignored on purpose */
    }
  }

  /**
   * Ages the reservation maps. Nothing here posts to the store: an expiring reservation KEEPS its
   * charge (finding 3), and a forgotten one keeps it for good.
   */
  function sweep(at: Date): void {
    const time = at.getTime();
    if (open.size > 0) {
      const expiryCutoff = time - ttl;
      for (const [id, reservation] of open) {
        if (reservation.createdAt <= expiryCutoff) {
          open.delete(id);
          expired.set(id, reservation);
        }
      }
    }
    if (expired.size > 0) {
      const forgetCutoff = time - abandonAfter;
      for (const [id, reservation] of expired) {
        if (reservation.createdAt <= forgetCutoff) expired.delete(id);
      }
    }
  }

  /** Takes a reservation off the books, whether it is open or merely expired. */
  function settle(reservation: Reservation): boolean {
    return open.delete(reservation.id) || expired.delete(reservation.id);
  }

  /** Posts `amount` to both of a reservation's buckets. Never ceiling-checked: see the store note. */
  async function post(reservation: Reservation, amount: number): Promise<void> {
    if (amount === 0) return;
    await store.add(accountKeyOf(reservation), amount);
    await store.add(metroKeyOf(reservation), amount);
  }

  async function release(reservation: Reservation): Promise<void> {
    if (!settle(reservation)) return;
    await post(reservation, -reservation.estimate);
  }

  async function remaining(
    meta: AiProviderMeta,
    callOptions: LedgerQueryOptions = {},
  ): Promise<QuotaRemaining> {
    const at = callOptions.at ?? now();
    const dayKey = dayKeyFor(meta, at);
    const ceilings = ceilingsFor(meta);
    const metro = callOptions.metro ?? null;
    const accountUsed = await store.read(keyFor(meta, dayKey, ACCOUNT_SCOPE));
    const metroUsed =
      metro === null ? null : await store.read(keyFor(meta, dayKey, metroScope(metro)));
    return {
      provider: meta.id,
      dayKey,
      unit: ceilings.unit,
      ceilings,
      accountUsed,
      accountRemaining: Math.max(0, ceilings.account - accountUsed),
      metro,
      metroUsed,
      metroRemaining: metroUsed === null ? null : Math.max(0, ceilings.metro - metroUsed),
    };
  }

  return {
    config,
    store,
    dayKeyFor,
    ceilingsFor,
    remaining,

    async reserve(provider, job, model, callOptions) {
      const at = callOptions.at ?? now();
      sweep(at);
      const meta = provider.meta;
      const metro = callOptions.metro;
      const dayKey = dayKeyFor(meta, at);
      const ceilings = ceilingsFor(meta);
      const raw = provider.estimateCost(job, model);
      // A provider that cannot price a call is charged nothing rather than NaN, which would
      // poison the counter and hide every later overrun.
      const estimate = Number.isFinite(raw) && raw > 0 ? raw : 0;

      const accountKey = keyFor(meta, dayKey, ACCOUNT_SCOPE);
      const metroKey = keyFor(meta, dayKey, metroScope(metro));

      // One atomic step, not a read and then an add: concurrent reservations must not all pass a
      // check on the same stale total (finding 5).
      const charged = await store.addWithinCeiling(accountKey, estimate, ceilings.account);
      if (!charged.ok) {
        announce({
          provider: meta.id,
          dayKey,
          unit: ceilings.unit,
          ceiling: ceilings.account,
          used: charged.used,
          at,
        });
        return {
          ok: false,
          reason: "quota_exhausted",
          scope: "account",
          provider: meta.id,
          dayKey,
          unit: ceilings.unit,
          ceiling: ceilings.account,
          used: charged.used,
          estimate,
        };
      }

      const chargedMetro = await store.addWithinCeiling(metroKey, estimate, ceilings.metro);
      if (!chargedMetro.ok) {
        // The account was charged a moment ago and this call is not happening, so hand it back.
        // Charging the account first and compensating keeps the account ceiling true at every
        // instant; the reverse order would let a metro-capped call sit above the account ceiling.
        await store.add(accountKey, -estimate);
        // Not an account exhaustion: other metros still have allowance, so no announcement.
        return {
          ok: false,
          reason: "quota_exhausted",
          scope: "metro",
          provider: meta.id,
          dayKey,
          unit: ceilings.unit,
          ceiling: ceilings.metro,
          used: chargedMetro.used,
          estimate,
        };
      }

      counter += 1;
      const reservation: Reservation = {
        id: `${meta.id}:${dayKey}:${counter}`,
        provider: meta.id,
        dayKey,
        unit: ceilings.unit,
        metro,
        estimate,
        accountCeiling: ceilings.account,
        createdAt: at.getTime(),
      };
      open.set(reservation.id, reservation);
      return { ok: true, reservation };
    },

    async reconcile(reservation, usage) {
      if (!settle(reservation)) return;
      const raw = typeof usage === "number" ? usage : usage.cost;
      const actual = Number.isFinite(raw) && raw > 0 ? raw : 0;
      await post(reservation, actual - reservation.estimate);
      const accountUsed = await store.read(accountKeyOf(reservation));
      // The day may run out exactly on this call: say so now rather than on the next refusal.
      if (accountUsed >= reservation.accountCeiling) {
        announce({
          provider: reservation.provider,
          dayKey: reservation.dayKey,
          unit: reservation.unit,
          ceiling: reservation.accountCeiling,
          used: accountUsed,
          at: new Date(reservation.createdAt),
        });
      }
    },

    release,

    async markExhausted(meta, callOptions = {}) {
      const at = callOptions.at ?? now();
      const dayKey = dayKeyFor(meta, at);
      const ceilings = ceilingsFor(meta);
      const key = keyFor(meta, dayKey, ACCOUNT_SCOPE);
      const used = await store.read(key);
      if (used < ceilings.account) await store.add(key, ceilings.account - used);
      announce({
        provider: meta.id,
        dayKey,
        unit: ceilings.unit,
        ceiling: ceilings.account,
        used: Math.max(used, ceilings.account),
        at,
      });
    },

    openReservationCount() {
      return open.size;
    },

    expiredReservationCount() {
      return expired.size;
    },

    onExhausted(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** A `Notifier` that does nothing, for tests and for code paths that must not notify. */
export const silentNotifier: Notifier = {
  quotaExhausted() {
    /* nothing: see the Notifier doc comment */
  },
};
