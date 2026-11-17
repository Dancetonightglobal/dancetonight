import { DrizzleQueryError, and, count, eq, inArray, isNull } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { Db } from "@/src/db/client";
import { events, fieldProvenance, metros, venues } from "@/src/db/schema";
import { seedNyc } from "@/src/db/seed/nyc";
import { excludedSet, failureMessage, main, summarize, writeSeed } from "@/src/db/seed/run";
import { SEED_NAMESPACE, seedId, uuidV5 } from "@/src/db/seed/ids";
import { startsAt } from "@/src/domain/tonight";
import { closeTestDb, describeDb, requireDbInCi, resetDb, testDb } from "@/tests/unit/db-harness";

requireDbInCi();

/** Sunday 20 September 2026, 7:42pm in New York. */
const SUNDAY_EVENING = new Date("2026-09-20T23:42:00Z");

describe("seed ids", () => {
  it("implements UUID v5 (RFC 4122 test vector for python.org in the DNS namespace)", () => {
    expect(uuidV5("python.org", "6ba7b810-9dad-11d1-80b4-00c04fd430c8")).toBe(
      "886313e1-3b8a-5372-9b90-0c9aee199e5d",
    );
  });

  it("is stable per kind and key, and distinct across kinds", () => {
    expect(seedId("venue", "sobs")).toBe(seedId("venue", "sobs"));
    expect(seedId("venue", "sobs")).not.toBe(seedId("organizer", "sobs"));
    expect(seedId("event", "a")).not.toBe(seedId("event", "b"));
    expect(SEED_NAMESPACE).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("seed runner", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("summarises what it would write", () => {
    const seed = seedNyc(SUNDAY_EVENING);
    const counts = summarize(seed);
    expect(counts.metros).toBe(1);
    expect(counts.events).toBe(seed.events.length);
    expect(counts.field_provenance).toBe(seed.provenance.length);
  });

  it("builds an upsert SET that covers every column but id and created_at", () => {
    const set = excludedSet(events) as Record<string, unknown>;
    expect(Object.keys(set)).toContain("slug");
    expect(Object.keys(set)).toContain("nightDate");
    expect(Object.keys(set)).not.toContain("id");
    expect(Object.keys(set)).not.toContain("createdAt");
    expect(Object.keys(excludedSet(venues))).toContain("location");
    expect(Object.keys(excludedSet(metros))).toContain("center");
  });

  it("leaves the generated starts_at out of the events SET (Postgres allows only DEFAULT there)", () => {
    expect(events.startsAt.generated).toBeDefined();
    const keys = Object.keys(excludedSet(events));
    expect(keys).not.toContain("startsAt");
    expect(keys).toContain("dancingAt");
    expect(keys).toContain("lessonAt");
    expect(keys).toContain("doorsAt");
  });

  it("reports the database's own message on failure, never the bound parameters", () => {
    const cause = new Error('column "starts_at" can only be updated to DEFAULT');
    const wrapped = new DrizzleQueryError(
      'insert into "events" ("id", "slug") values ($1, $2)',
      ["a-secret-looking-param", "salsa-sundays-2026-09-20"],
      cause,
    );
    expect(failureMessage(wrapped)).toBe(cause.message);
    expect(failureMessage(wrapped)).not.toContain("a-secret-looking-param");
    const bare = new DrizzleQueryError("insert into x values ($1)", ["another-param"]);
    expect(failureMessage(bare)).not.toContain("another-param");
    expect(failureMessage(bare)).not.toContain("insert into");
    expect(failureMessage(new Error("plain"))).toBe("plain");
    expect(failureMessage("not an error")).toBe("not an error");
  });

  it("prints the counts and exits cleanly without a database", async () => {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    });
    await main(["--dry-run"]);
    expect(lines[0]).toMatch(/^Dry run: nothing written/);
    expect(lines.some((l) => /events: \d+/.test(l))).toBe(true);
    expect(lines.some((l) => /mode=/.test(l))).toBe(true);
  });
});

describeDb("the seed, written to Postgres", () => {
  let db: Db;
  const seed = seedNyc(SUNDAY_EVENING);
  const untimed = seed.events.filter((e) => startsAt(e) === null);

  beforeAll(async () => {
    db = await testDb("seed_run");
  });

  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("writes rows with a date and no time, and Postgres keeps their start null (D-060, migration 0002)", async () => {
    expect(untimed.length).toBeGreaterThanOrEqual(3);
    expect(await writeSeed(db, seed)).toEqual(summarize(seed));

    const rows = await db
      .select({
        id: events.id,
        doorsAt: events.doorsAt,
        lessonAt: events.lessonAt,
        dancingAt: events.dancingAt,
        startsAt: events.startsAt,
        endsAt: events.endsAt,
        nightDate: events.nightDate,
        confirmation: events.confirmation,
      })
      .from(events)
      .where(
        inArray(
          events.id,
          untimed.map((e) => e.id),
        ),
      );
    expect(rows).toHaveLength(untimed.length);
    for (const row of rows) {
      const written = untimed.find((e) => e.id === row.id);
      if (!written) throw new Error(`unexpected row ${row.id}`);
      expect(row.doorsAt).toBeNull();
      expect(row.lessonAt).toBeNull();
      expect(row.dancingAt).toBeNull();
      // starts_at is generated by Postgres: coalesce of three nulls is null, and no check rejects it.
      expect(row.startsAt).toBeNull();
      expect(row.nightDate).toBe(written.nightDate);
      expect(row.endsAt?.toISOString() ?? null).toBe(written.endsAt?.toISOString() ?? null);
      expect(row.confirmation).toBe(written.confirmation);
    }
    expect(rows.some((r) => r.endsAt !== null)).toBe(true);
    expect(rows.some((r) => r.confirmation === "cancelled")).toBe(true);

    // Every other row keeps a start, computed by Postgres from the times the seed wrote.
    const [nullStarts] = await db
      .select({ n: count() })
      .from(events)
      .where(isNull(events.startsAt));
    expect(nullStarts?.n).toBe(untimed.length);
    const timed = seed.events.find((e) => startsAt(e) !== null);
    if (!timed) throw new Error("no timed row");
    const [timedRow] = await db
      .select({ startsAt: events.startsAt })
      .from(events)
      .where(eq(events.id, timed.id));
    expect(timedRow?.startsAt?.toISOString()).toBe(startsAt(timed)?.toISOString());

    // A row with no time has its night on record and no start on record.
    const provenance = await db
      .select({ field: fieldProvenance.field })
      .from(fieldProvenance)
      .where(
        and(
          eq(fieldProvenance.entityType, "event"),
          inArray(
            fieldProvenance.entityId,
            untimed.map((e) => e.id),
          ),
        ),
      );
    const fields = provenance.map((p) => p.field);
    expect(fields.filter((f) => f === "nightDate")).toHaveLength(untimed.length);
    for (const field of ["doorsAt", "lessonAt", "dancingAt", "startsAt"]) {
      expect(fields, field).not.toContain(field);
    }
  });

  it("upserts on a second run instead of duplicating", async () => {
    await writeSeed(db, seed);
    await writeSeed(db, seed);
    const [all] = await db.select({ n: count() }).from(events);
    expect(all?.n).toBe(seed.events.length);
    const [nullStarts] = await db
      .select({ n: count() })
      .from(events)
      .where(isNull(events.startsAt));
    expect(nullStarts?.n).toBe(untimed.length);
  });
});
