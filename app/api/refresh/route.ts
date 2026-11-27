// The on-demand read (D-899): a city page's script POSTs here when it opens, and again every
// minute while that city's read runs. It answers what the page should say and, when the city's
// listings are stale, starts its read. New York is read on its own schedule and is never started
// here. Every guard is in src/edge/on-demand.ts.

import { z } from "zod";

import { getRepository } from "@/src/data";
import { DbListingsRepository } from "@/src/data/db-repository";
import { onDemandMetro } from "@/src/edge/ingest-trigger";
import {
  decideRefresh,
  dispatchKey,
  dispatchCityRead,
  dispatchToken,
  readCounters,
  recordDispatch,
  type RefreshState,
} from "@/src/edge/on-demand";
import { snapshotStore } from "@/src/edge/snapshot-store";

export const dynamic = "force-dynamic";

const citySchema = z.string().regex(/^[a-z0-9-]{1,40}$/);

/** "off": nothing to show (New York, mock mode, an unknown city). */
export type RefreshAnswer = { state: RefreshState | "off"; lastUpdated: string | null };

const builtKey = (slug: string): string => `refresh/built/${slug}`;

function answer(body: RefreshAnswer): Response {
  return Response.json(body, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request): Promise<Response> {
  const parsed = citySchema.safeParse(new URL(request.url).searchParams.get("city"));
  const metro = parsed.success ? onDemandMetro(parsed.data) : null;
  const repo = getRepository();
  if (metro === null || !(repo instanceof DbListingsRepository)) {
    return answer({ state: "off", lastUpdated: null });
  }

  const now = new Date();
  const status = await repo.ingestStatus(metro.slug);
  if (status === null) return answer({ state: "off", lastUpdated: null });
  const lastUpdated = status.lastSuccessAt?.toISOString() ?? null;

  // Without KV there is no cap to count against, so nothing is started.
  const store = snapshotStore();
  if (store === null) return answer({ state: "fresh", lastUpdated });

  const counters = await readCounters(store, metro.slug, now);
  const decision = decideRefresh({ now, ...status, ...counters });

  // A read this page started has finished: rebuild the city's snapshot once, so a reload shows it.
  if (
    decision === "fresh" &&
    counters.dispatchedAt !== null &&
    status.lastSuccessAt !== null &&
    status.lastSuccessAt > counters.dispatchedAt &&
    (await store.get(builtKey(metro.slug))) !== counters.dispatchedAt.toISOString()
  ) {
    await repo.refreshCitySnapshots(now);
    await store.put(builtKey(metro.slug), counters.dispatchedAt.toISOString(), {
      expirationTtl: 24 * 60 * 60,
    });
  }

  if (decision !== "dispatch") return answer({ state: decision, lastUpdated });

  const token = dispatchToken();
  if (token === null) return answer({ state: "fresh", lastUpdated });
  try {
    // Recorded first: two tabs opening at once start one read, not two.
    await recordDispatch(store, metro.slug, now, counters.startsToday);
    await dispatchCityRead(metro.slug, metro.tz, now, token);
    console.log(`on-demand read started: ${metro.slug}`);
    return answer({ state: "updating", lastUpdated });
  } catch (error) {
    console.log(`on-demand read failed: ${metro.slug}: ${String(error)}`);
    await store.delete(dispatchKey(metro.slug));
    return answer({ state: "fresh", lastUpdated });
  }
}
