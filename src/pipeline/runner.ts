// Whether an adapter may run, and running one source through it without letting a failure escape
// (D-008). The ingest job calls `mayRun` once per adapter and `harvestSource` once per source;
// the polite client in RunCtx already applies the blocklist, robots.txt and the limiter.

import { eq } from "drizzle-orm";

import { ADAPTER_DEFAULTS } from "@/config/flags";
import {
  flagKey,
  type AdapterId,
  type HarvestResult,
  type Metro,
  type RunCtx,
  type Source,
  type SourceAdapter,
} from "@/src/adapters/types";
import type { Db } from "@/src/db/client";
import { featureFlags } from "@/src/db/schema";
import { HttpError } from "@/src/pipeline/http";

export type Gate =
  | { run: true }
  | { run: false; reason: "flag_off" | "wrong_country" | "not_configured"; detail: string };

/** Flag values from the database: a metro row beats a global row beats the default. */
export async function loadFlags(db: Db, metroId: string): Promise<Map<string, boolean>> {
  const rows = await db.select().from(featureFlags);
  const global = new Map<string, boolean>();
  const metro = new Map<string, boolean>();
  for (const row of rows) {
    if (row.scope === "global") global.set(row.key, row.enabled);
    else if (row.metroId === metroId) metro.set(row.key, row.enabled);
  }
  return new Map([...global, ...metro]);
}

export function mayRun(
  adapter: SourceAdapter,
  metro: Metro,
  env: Readonly<Record<string, string | undefined>>,
  flags: ReadonlyMap<string, boolean> = new Map(),
): Gate {
  const key = flagKey(adapter.id);
  const on = flags.get(key) ?? ADAPTER_DEFAULTS[adapter.id];
  if (!on) return { run: false, reason: "flag_off", detail: `${key} is off` };
  if (adapter.countries && !adapter.countries.includes(metro.countryCode)) {
    return {
      run: false,
      reason: "wrong_country",
      detail: `serves ${adapter.countries.join(", ")} only`,
    };
  }
  const missing = (adapter.requiredEnv ?? []).filter((name) => !env[name]?.trim());
  if (missing.length > 0) {
    return { run: false, reason: "not_configured", detail: `needs ${missing.join(", ")}` };
  }
  return { run: true };
}

export type SourceOutcome =
  | { status: "ok"; result: HarvestResult; durationMs: number }
  | { status: "unchanged"; result: HarvestResult; durationMs: number }
  | { status: "failed"; error: string; errorKind: string; durationMs: number };

/** Runs one source; every error becomes an outcome, so one bad source never stops the run. */
export async function harvestSource(
  adapter: SourceAdapter,
  source: Source,
  ctx: RunCtx,
): Promise<SourceOutcome> {
  const started = ctx.now().getTime();
  const elapsed = () => ctx.now().getTime() - started;
  if (!adapter.harvest) {
    return {
      status: "failed",
      error: `${adapter.id} cannot harvest a source`,
      errorKind: "contract",
      durationMs: 0,
    };
  }
  try {
    const result = await adapter.harvest(source, ctx);
    return { status: result.unchanged ? "unchanged" : "ok", result, durationMs: elapsed() };
  } catch (error) {
    return {
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
      errorKind: error instanceof HttpError ? error.kind : "adapter",
      durationMs: elapsed(),
    };
  }
}

/** Which adapter harvests a source: its platform's adapter when one is registered, else by kind. */
export function adapterFor(
  source: Pick<Source, "kind" | "platform">,
  registry: ReadonlyMap<AdapterId, SourceAdapter>,
): SourceAdapter | null {
  if (source.platform && registry.has(source.platform as AdapterId)) {
    return registry.get(source.platform as AdapterId) ?? null;
  }
  const byKind: Partial<Record<Source["kind"], AdapterId>> = {
    feed_ics: "feed_ics",
    feed_gcal: "feed_gcal",
    jsonld: "jsonld",
    wp_tribe: "wp_tribe",
    squarespace: "squarespace",
    wix: "wix",
    html: "jsonld",
  };
  const id = byKind[source.kind];
  return id ? (registry.get(id) ?? null) : null;
}

/** Turns a flag on or off for everyone, for the admin page and scripts. */
export async function setGlobalFlag(db: Db, id: AdapterId, enabled: boolean): Promise<void> {
  const key = flagKey(id);
  const existing = await db.select().from(featureFlags).where(eq(featureFlags.key, key));
  const global = existing.find((row) => row.scope === "global");
  if (global) await db.update(featureFlags).set({ enabled }).where(eq(featureFlags.id, global.id));
  else await db.insert(featureFlags).values({ key, enabled, scope: "global" });
}
