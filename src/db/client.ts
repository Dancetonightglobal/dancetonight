/**
 * Database clients, created lazily so that importing this module never opens a connection:
 * mock mode (D-011) has no database and must not need one.
 *
 * - `getDb()` is the app client. It reads `DATABASE_URL`, the Supabase transaction pooler
 *   (port 6543), where prepared statements are not supported, so `prepare` is off for pooler URLs.
 * - `getDirectSql()` is the migration client. It reads `DIRECT_DATABASE_URL` (port 5432) and
 *   holds one connection.
 */
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import { z } from "zod";
import * as schema from "@/src/db/schema";

export type Db = PostgresJsDatabase<typeof schema>;

const connectionUrl = z.url({ protocol: /^postgres(ql)?$/ });

/** True for Supabase's transaction pooler (port 6543 or a `pooler` host) and PgBouncer URLs. */
export function isPoolerUrl(url: string): boolean {
  const parsed = new URL(url);
  return (
    parsed.port === "6543" ||
    /(^|[.-])pooler([.-]|$)/i.test(parsed.hostname) ||
    /pgbouncer/i.test(parsed.hostname) ||
    parsed.searchParams.get("pgbouncer") === "true"
  );
}

/** Reads and validates one connection URL from the environment; throws a plain message when it is missing. */
export function readConnectionUrl(name: "DATABASE_URL" | "DIRECT_DATABASE_URL"): string {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") {
    throw new Error(
      `${name} is not set. Set it in .env.local, or run in mock mode without a database.`,
    );
  }
  const result = connectionUrl.safeParse(raw.trim());
  if (!result.success) {
    throw new Error(`${name} is not a postgres:// URL.`);
  }
  return result.data;
}

/** Postgres.js prints every server notice as a raw object; keep warnings, drop plain NOTICEs. */
function onnotice(notice: postgres.Notice): void {
  if (notice.severity !== "NOTICE") console.warn(notice.message);
}

let appSql: Sql | undefined;
let appDb: Db | undefined;
let directSql: Sql | undefined;
let proxyDb: Db | undefined;

/**
 * The request a Cloudflare Worker is serving, or undefined under Node (D-144).
 *
 * A Worker's socket belongs to the request that opened it: a pooled client kept in module scope
 * and reused by the next request hangs until the runtime cancels it (measured: every request
 * after the first answered 500). @opennextjs/cloudflare publishes each request's `{ env, ctx }`
 * through this global (an AsyncLocalStorage getter), so `ctx` is a per-request key.
 */
function workerRequest(): object | undefined {
  const store = (globalThis as Record<symbol, unknown>)[Symbol.for("__cloudflare-context__")];
  const ctx = (store as { ctx?: unknown } | undefined)?.ctx;
  return typeof ctx === "object" && ctx !== null ? ctx : undefined;
}

/**
 * The Hyperdrive binding's connection string on Workers (D-145), else `DATABASE_URL`.
 *
 * postgres.js's Node build upgrades to TLS with `tls.connect({ socket, rejectUnauthorized })`,
 * which workerd does not implement: every Supabase query hung. Hyperdrive is a plain local
 * connection inside Cloudflare and holds the TLS link and the pool to Supabase itself.
 */
function workerConnectionUrl(): string {
  const store = (globalThis as Record<symbol, unknown>)[Symbol.for("__cloudflare-context__")];
  const env = (store as { env?: { HYPERDRIVE?: { connectionString?: unknown } } } | undefined)?.env;
  const hyperdrive = env?.HYPERDRIVE?.connectionString;
  return typeof hyperdrive === "string" && hyperdrive
    ? hyperdrive
    : readConnectionUrl("DATABASE_URL");
}

/** One client per Worker request, dropped with the request. */
const perRequest = new WeakMap<object, { app?: Db; proxy?: Db }>();

function workerClient(key: object, kind: "app" | "proxy"): Db {
  const slot = perRequest.get(key) ?? {};
  perRequest.set(key, slot);
  const existing = slot[kind];
  if (existing) return existing;
  const url = workerConnectionUrl();
  const db = drizzle(
    postgres(url, {
      prepare: !isPoolerUrl(url),
      max: 1,
      idle_timeout: 20,
      connect_timeout: 10,
      onnotice,
    }),
    { schema },
  );
  slot[kind] = db;
  return db;
}

/** The app's Drizzle client over the pooler. Created on first call (per request on Workers). */
export function getDb(): Db {
  const request = workerRequest();
  if (request) return workerClient(request, "app");
  if (appDb) return appDb;
  const url = readConnectionUrl("DATABASE_URL");
  appSql = postgres(url, {
    prepare: !isPoolerUrl(url),
    max: 5,
    idle_timeout: 20,
    connect_timeout: 10,
    onnotice,
  });
  appDb = drizzle(appSql, { schema });
  return appDb;
}

/**
 * The proxy's Drizzle client over the pooler, one connection (D-092): `proxy.ts` is bundled
 * apart from the app, so it cannot share `getDb()`'s pool, and one slug lookup a request needs no
 * more. Created on first call.
 */
export function getProxyDb(): Db {
  const request = workerRequest();
  if (request) return workerClient(request, "proxy");
  if (proxyDb) return proxyDb;
  const url = readConnectionUrl("DATABASE_URL");
  proxyDb = drizzle(
    postgres(url, {
      prepare: !isPoolerUrl(url),
      max: 1,
      idle_timeout: 20,
      connect_timeout: 10,
      onnotice,
    }),
    { schema },
  );
  return proxyDb;
}

/** A single direct connection for migrations and one-off scripts. Created on first call. */
export function getDirectSql(): Sql {
  if (directSql) return directSql;
  const url = readConnectionUrl("DIRECT_DATABASE_URL");
  directSql = postgres(url, { max: 1, prepare: false, connect_timeout: 15, onnotice });
  return directSql;
}

/** Drizzle over the direct connection, for the migrator. */
export function getDirectDb(): Db {
  return drizzle(getDirectSql(), { schema });
}

/** Closes whichever clients were opened. Safe to call when none were. */
export async function closeDb(): Promise<void> {
  const open = [appSql, directSql].filter((s): s is Sql => s !== undefined);
  appSql = undefined;
  appDb = undefined;
  directSql = undefined;
  await Promise.all(open.map((s) => s.end({ timeout: 5 })));
}
