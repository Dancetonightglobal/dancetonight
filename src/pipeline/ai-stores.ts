// Postgres behind the two stores the AI pipeline needs to survive between runs: the quota
// ledger's counters (so the morning run and the afternoon re-check share one day's allowance,
// PLAN 8.5) and the extraction cache (PLAN 6.7).

import { and, eq, sql } from "drizzle-orm";

import type { AddWithinCeiling, QuotaKey, QuotaStore } from "@/src/ai";
import type { Db } from "@/src/db/client";
import { aiQuota, extractionCache } from "@/src/db/schema";
import { rawExtractionSchema } from "@/src/domain/listing";
import type { CachedExtraction, ExtractionCache } from "@/src/pipeline/extract";

export function postgresQuotaStore(db: Db): QuotaStore {
  const where = (key: QuotaKey) =>
    and(
      eq(aiQuota.provider, key.provider),
      eq(aiQuota.dayKey, key.dayKey),
      eq(aiQuota.scope, key.scope),
    );
  return {
    async read(key) {
      const [row] = await db.select({ amount: aiQuota.amount }).from(aiQuota).where(where(key));
      return row ? Number(row.amount) : 0;
    },
    async add(key, amount) {
      const rows = await db
        .insert(aiQuota)
        .values({ ...key, amount })
        .onConflictDoUpdate({
          target: [aiQuota.provider, aiQuota.dayKey, aiQuota.scope],
          set: { amount: sql`${aiQuota.amount} + ${amount}`, updatedAt: sql`now()` },
        })
        .returning({ amount: aiQuota.amount });
      return Number(rows[0]?.amount ?? 0);
    },
    // One statement, as the ledger's contract requires (src/ai/ledger.ts). The WHERE on the
    // SELECT guards the first spend of the day, which inserts rather than updates and so never
    // reaches the ON CONFLICT clause's own check; without it a first reservation larger than
    // the ceiling would be written.
    async addWithinCeiling(key, amount, ceiling): Promise<AddWithinCeiling> {
      const rows = await db.execute<{ amount: string }>(sql`
        insert into ai_quota (provider, day_key, scope, amount)
        select ${key.provider}, ${key.dayKey}, ${key.scope}, ${amount}::numeric
        where ${amount}::numeric <= ${ceiling}::numeric
        on conflict (provider, day_key, scope) do update
          set amount = ai_quota.amount + excluded.amount, updated_at = now()
          where ai_quota.amount + excluded.amount <= ${ceiling}::numeric
        returning amount`);
      const row = rows[0];
      if (row) return { ok: true, total: Number(row.amount) };
      return { ok: false, used: await this.read(key) };
    },
  };
}

export function postgresExtractionCache(db: Db): ExtractionCache {
  return {
    async get(contentHash, promptVersion) {
      const [row] = await db
        .select({ model: extractionCache.model, result: extractionCache.result })
        .from(extractionCache)
        .where(
          and(
            eq(extractionCache.contentHash, contentHash),
            eq(extractionCache.promptVersion, promptVersion),
          ),
        );
      if (!row) return null;
      // Re-validated on the way out: a row written by an older schema is a miss, not a crash.
      // The schema reads a model's slips leniently (D-057), which would turn a malformed row into
      // an empty page and hide its listings, so a row must first have the envelope it was
      // written with.
      if (!isExtractionShaped(row.result)) return null;
      const parsed = rawExtractionSchema.safeParse(row.result);
      return parsed.success ? { extraction: parsed.data, model: row.model } : null;
    },
    async put(contentHash, promptVersion, value: CachedExtraction) {
      await db
        .insert(extractionCache)
        .values({ contentHash, promptVersion, model: value.model, result: value.extraction })
        .onConflictDoUpdate({
          target: [extractionCache.contentHash, extractionCache.promptVersion],
          set: { model: value.model, result: value.extraction, createdAt: sql`now()` },
        });
    },
  };
}

/** The envelope every stored extraction has: a page kind, a language and a listings array. */
function isExtractionShaped(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.page_kind === "string" &&
    typeof row.language === "string" &&
    Array.isArray(row.listings)
  );
}
