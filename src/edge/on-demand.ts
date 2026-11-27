/**
 * On-demand reads (D-899, the owner 2026-11-27): every city but New York is read only when
 * someone opens it. The city page asks /api/refresh, which decides here whether to start that
 * city's read, and tells the page what to say ("Last updated 9 hours ago; updating now").
 *
 * Guards, because the site is public and a read costs money (a full Paris read was $0.63):
 * - a read starts only when the last good one is older than ON_DEMAND_STALE_MS;
 * - never while one is running, or within DISPATCH_GRACE_MS of the last start (the run is queued
 *   on GitHub before it writes its job_runs row);
 * - at most ON_DEMAND_DAILY_CAP starts a day across every city;
 * - only from a POST the page's script sends, so a crawler reading the HTML starts nothing.
 */

import { INGEST_DISPATCH_URL, metroDispatchInputs } from "./ingest-trigger";
import type { SnapshotStore } from "./snapshot-store";

/** A city's listings are fresh enough for this long after its last good read. */
export const ON_DEMAND_STALE_MS = 6 * 60 * 60 * 1000;
/** After a start, the read counts as under way this long even before it shows in job_runs. */
export const DISPATCH_GRACE_MS = 20 * 60 * 1000;
/** A job_runs row still "running" after this is a crashed run, not a live one. */
export const RUNNING_MAX_MS = 150 * 60 * 1000;
/** At most this many on-demand starts a day (UTC), all cities together. */
export const ON_DEMAND_DAILY_CAP = 12;

/** What the page shows. "fresh": the last read is recent. "capped": a read was due, but the day's cap is used. */
export type RefreshState = "updating" | "fresh" | "capped";

export interface RefreshInput {
  now: Date;
  lastSuccessAt: Date | null;
  runningSince: Date | null;
  /** When this city's last on-demand start was sent, from KV. */
  dispatchedAt: Date | null;
  /** On-demand starts already sent today, all cities. */
  startsToday: number;
}

/** "dispatch": start a read now. Pure, so every branch is tested. */
export function decideRefresh(input: RefreshInput): RefreshState | "dispatch" {
  const now = input.now.getTime();
  if (input.runningSince !== null && now - input.runningSince.getTime() < RUNNING_MAX_MS) {
    return "updating";
  }
  const lastSuccess = input.lastSuccessAt?.getTime() ?? null;
  const dispatched = input.dispatchedAt?.getTime() ?? null;
  // Started recently and not finished since: the run is queued or starting.
  if (
    dispatched !== null &&
    now - dispatched < DISPATCH_GRACE_MS &&
    (lastSuccess === null || lastSuccess < dispatched)
  ) {
    return "updating";
  }
  if (lastSuccess !== null && now - lastSuccess < ON_DEMAND_STALE_MS) return "fresh";
  if (input.startsToday >= ON_DEMAND_DAILY_CAP) return "capped";
  return "dispatch";
}

export const dispatchKey = (slug: string): string => `refresh/city/${slug}`;
export const dayKey = (now: Date): string => `refresh/day/${now.toISOString().slice(0, 10)}`;

/** Read this city's last start and today's count from KV. Missing or bad values read as none. */
export async function readCounters(
  store: SnapshotStore,
  slug: string,
  now: Date,
): Promise<{ dispatchedAt: Date | null; startsToday: number }> {
  const [at, day] = await Promise.all([store.get(dispatchKey(slug)), store.get(dayKey(now))]);
  const ms = at === null ? NaN : Date.parse(at);
  const count = day === null ? 0 : Number.parseInt(day, 10);
  return {
    dispatchedAt: Number.isFinite(ms) ? new Date(ms) : null,
    startsToday: Number.isFinite(count) && count > 0 ? count : 0,
  };
}

/** Record a start: this city's time (kept a day) and today's count (kept two days). */
export async function recordDispatch(
  store: SnapshotStore,
  slug: string,
  now: Date,
  startsToday: number,
): Promise<void> {
  await Promise.all([
    store.put(dispatchKey(slug), now.toISOString(), { expirationTtl: 24 * 60 * 60 }),
    store.put(dayKey(now), String(startsToday + 1), { expirationTtl: 2 * 24 * 60 * 60 }),
  ]);
}

/**
 * Start one city's full read through the ingest workflow's dispatch, as the cron does.
 * @throws {Error} When GitHub does not accept the dispatch.
 */
export async function dispatchCityRead(
  slug: string,
  tz: string,
  now: Date,
  token: string,
  fetchFn: typeof fetch = fetch,
): Promise<void> {
  const response = await fetchFn(INGEST_DISPATCH_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "dancetonight-on-demand",
      "content-type": "application/json",
    },
    body: JSON.stringify({ ref: "main", inputs: metroDispatchInputs(slug, tz, now) }),
  });
  if (!response.ok) {
    const text = (await response.text()).slice(0, 200);
    throw new Error(`dispatch for ${slug} failed: ${response.status} ${text}`);
  }
}

/** The Worker's INGEST_DISPATCH_TOKEN secret from the Cloudflare context, else null. Never throws. */
export function dispatchToken(): string | null {
  try {
    const context = (globalThis as Record<symbol, unknown>)[Symbol.for("__cloudflare-context__")];
    const token = (context as { env?: { INGEST_DISPATCH_TOKEN?: unknown } } | undefined)?.env
      ?.INGEST_DISPATCH_TOKEN;
    return typeof token === "string" && token !== "" ? token : null;
  } catch {
    return null;
  }
}
