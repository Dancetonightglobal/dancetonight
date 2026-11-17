// Picks the repository for the runtime mode (D-011): the New York seed in mock mode, Drizzle
// over Supabase otherwise. Created lazily so importing this module opens no connection. A
// production deployment whose DATABASE_URL is missing or was rejected gets an error rather
// than the seed, so a typo never silently serves mock data to the public.

import { DbListingsRepository } from "@/src/data/db-repository";
import { MockListingsRepository } from "@/src/data/mock-repository";
import { cloudflareStore } from "@/src/data/shared-cache";
import type { ListingsRepository } from "@/src/data/repository";
import { env, isMockMode, type Env } from "@/src/config/env";
import { getDb, getProxyDb } from "@/src/db/client";

/** Cache listings reads for 2 minutes (D-153): the ingest runs twice a day; two minutes old is invisible. */
export const LISTINGS_CACHE_MS = 120_000;

let instance: ListingsRepository | undefined;

/** Why a production environment has no database, from the recorded env problems. */
function productionWithoutDatabase(e: Env): string {
  const problem = e.problems.find((p) => p.variable === "DATABASE_URL");
  const why = problem
    ? `DATABASE_URL was rejected (${problem.message})`
    : "DATABASE_URL is not set";
  return (
    `DANCETONIGHT_MODE is production but ${why}; refusing to serve the New York seed. ` +
    "Fix DATABASE_URL, or set DANCETONIGHT_MODE to mock or preview to run without a database."
  );
}

/**
 * A fresh repository for an environment; the app uses the cached one from getRepository().
 * Throws when the declared mode is production and the environment still resolves to mock.
 */
export function createRepository(e: Env = env): ListingsRepository {
  if (!isMockMode(e))
    return new DbListingsRepository(getDb, {
      cacheMs: LISTINGS_CACHE_MS,
      sharedStore: cloudflareStore(),
    });
  if (e.DANCETONIGHT_MODE === "production") throw new Error(productionWithoutDatabase(e));
  return new MockListingsRepository();
}

let proxyInstance: ListingsRepository | undefined;

/**
 * The repository `proxy.ts` uses (D-092): the same choice as the app's, over a one-connection
 * client of its own, since the proxy is bundled apart and cannot share the app's pool.
 */
export function getProxyRepository(): ListingsRepository {
  proxyInstance ??= isMockMode(env)
    ? createRepository()
    : new DbListingsRepository(() => getProxyDb(), {
        cacheMs: LISTINGS_CACHE_MS,
        sharedStore: cloudflareStore(),
      });
  return proxyInstance;
}

/** The app's repository, chosen once from the environment. */
export function getRepository(): ListingsRepository {
  instance ??= createRepository();
  return instance;
}

export type {
  DayCount,
  ListNightQuery,
  ListNightResult,
  ListingCounts,
  ListingFilters,
  ListingSort,
  ListingsRepository,
  MetroSummary,
  Point,
} from "@/src/data/repository";
