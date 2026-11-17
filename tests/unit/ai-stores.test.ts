import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";

import type { Db } from "@/src/db/client";
import { extractionCache } from "@/src/db/schema";
import { rawExtractionSchema } from "@/src/domain/listing";
import { postgresExtractionCache, postgresQuotaStore } from "@/src/pipeline/ai-stores";
import { closeTestDb, describeDb, requireDbInCi, resetDb, testDb } from "@/tests/unit/db-harness";

requireDbInCi();

let db: Db;
const key = { provider: "cloudflare" as const, dayKey: "2026-09-27", scope: "account" };

describeDb("the AI stores, against Postgres", () => {
  beforeAll(async () => {
    db = await testDb("ai_stores");
  });
  afterAll(closeTestDb);
  beforeEach(async () => {
    await resetDb();
    await db.execute(sql`truncate ai_quota, extraction_cache`);
  });

  it("refuses a first spend of the day that is already over the ceiling, and writes nothing", async () => {
    const store = postgresQuotaStore(db);
    expect(await store.addWithinCeiling(key, 120, 100)).toEqual({ ok: false, used: 0 });
    expect(await store.read(key)).toBe(0);
    expect(await store.addWithinCeiling(key, 60, 100)).toEqual({ ok: true, total: 60 });
    expect(await store.addWithinCeiling(key, 50, 100)).toEqual({ ok: false, used: 60 });
    expect(await store.add(key, -10)).toBe(50);
  });

  it("lets only one of two concurrent spends through when both cannot fit", async () => {
    const store = postgresQuotaStore(db);
    await store.addWithinCeiling(key, 50, 100);
    const results = await Promise.all([
      store.addWithinCeiling(key, 40, 100),
      store.addWithinCeiling(key, 40, 100),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(await store.read(key)).toBe(90);
  });

  it("keeps an extraction by content hash and prompt version, and treats a stale row as a miss", async () => {
    const cache = postgresExtractionCache(db);
    const extraction = rawExtractionSchema.parse({
      page_kind: "not_relevant",
      language: "en",
      listings: [],
    });
    await cache.put("hash", "v1", { extraction, model: "granite" });
    expect(await cache.get("hash", "v1")).toEqual({ extraction, model: "granite" });
    expect(await cache.get("hash", "v2")).toBeNull();
    await db.insert(extractionCache).values({
      contentHash: "old",
      promptVersion: "v1",
      model: "granite",
      result: { not: "an extraction" },
    });
    expect(await cache.get("old", "v1")).toBeNull();
  });
});
