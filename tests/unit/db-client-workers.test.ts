// D-144: on Cloudflare Workers a socket belongs to the request that opened it, so `getDb()` must
// hand each request its own client. Under Node (ingest, tests) it keeps one shared pool.
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { closeDb, getDb, getProxyDb } from "@/src/db/client";

const CONTEXT = Symbol.for("__cloudflare-context__");
const globals = globalThis as Record<symbol, unknown>;

describe("database clients on Workers (D-144)", () => {
  const saved = process.env.DATABASE_URL;

  beforeEach(() => {
    // postgres() connects lazily, so no database is needed to build a client.
    process.env.DATABASE_URL = "postgres://user:pw@127.0.0.1:1/db";
  });

  afterEach(async () => {
    delete globals[CONTEXT];
    process.env.DATABASE_URL = saved;
    await closeDb();
  });

  it("shares one client per request and never across requests", () => {
    const first = { ctx: {} };
    const second = { ctx: {} };
    globals[CONTEXT] = first;
    const a = getDb();
    expect(getDb()).toBe(a);
    const proxy = getProxyDb();
    expect(proxy).not.toBe(a);
    expect(getProxyDb()).toBe(proxy);
    globals[CONTEXT] = second;
    expect(getDb()).not.toBe(a);
    expect(getProxyDb()).not.toBe(proxy);
  });

  it("keeps the shared pool under Node", () => {
    expect(globals[CONTEXT]).toBeUndefined();
    const a = getDb();
    expect(getDb()).toBe(a);
  });
});
