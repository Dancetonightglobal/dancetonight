// `pnpm db:seed`: write the New York seed (D-011) through Drizzle. With DATABASE_URL set, every
// row is upserted in dependency order inside one transaction, keyed by its deterministic id,
// so re-running updates rather than duplicates. Without DATABASE_URL it reports what it would
// write and exits 0, which is what mock mode needs. Never fakes a success: any database error
// propagates and exits 1.

import { DrizzleQueryError, getTableColumns, sql, type SQL } from "drizzle-orm";
import type { PgColumn, PgTable, PgUpdateSetSource } from "drizzle-orm/pg-core";

import { describeMode, env } from "@/src/config/env";
import { closeDb, getDb, type Db } from "@/src/db/client";
import {
  eventSources,
  events,
  fieldProvenance,
  metros,
  organizers,
  series,
  sources,
  venues,
} from "@/src/db/schema";
import { seedNyc, type NycSeed } from "@/src/db/seed/nyc";
import { ROW_ONLY_METROS } from "@/src/db/seed/metros";

const CHUNK = 200;

/**
 * `set` for ON CONFLICT DO UPDATE: every column except the id, created_at and the generated
 * columns takes the excluded value. Postgres lets a GENERATED ALWAYS column (events.starts_at)
 * be set only to DEFAULT, so those are left out and Postgres recomputes them from the new values.
 */
export function excludedSet<T extends PgTable>(table: T): PgUpdateSetSource<T> {
  const set: Record<string, SQL> = {};
  for (const [key, column] of Object.entries(getTableColumns(table))) {
    if (key === "id" || key === "createdAt") continue;
    if (column.generated !== undefined) continue;
    set[key] = sql.raw(`excluded."${column.name}"`);
  }
  return set as PgUpdateSetSource<T>;
}

/**
 * The one line to print when the seed fails. Drizzle wraps a database error in a
 * DrizzleQueryError whose own message repeats the whole statement and every bound parameter
 * (hundreds of kilobytes for a seed chunk), so the cause's message is what gets printed, and a
 * wrapped query without a cause is named but never echoed.
 */
export function failureMessage(error: unknown): string {
  if (error instanceof Error && error.cause instanceof Error) return error.cause.message;
  if (error instanceof DrizzleQueryError) return "database query failed (no cause reported)";
  return error instanceof Error ? error.message : String(error);
}

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

async function upsert<T extends PgTable & { id: PgColumn }>(
  tx: Tx,
  table: T,
  rows: T["$inferInsert"][],
): Promise<number> {
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    await tx
      .insert(table)
      .values(chunk)
      .onConflictDoUpdate({ target: table.id, set: excludedSet(table) });
  }
  return rows.length;
}

export function summarize(seed: NycSeed): Record<string, number> {
  return {
    metros: 1,
    venues: seed.venues.length,
    organizers: seed.organizers.length,
    sources: seed.sources.length,
    series: seed.series.length,
    events: seed.events.length,
    event_sources: seed.eventSources.length,
    field_provenance: seed.provenance.length,
  };
}

/** Write the seed in dependency order inside one transaction. Returns row counts per table. */
export async function writeSeed(db: Db, seed: NycSeed): Promise<Record<string, number>> {
  return db.transaction(async (tx) => ({
    metros: await upsert(tx, metros, [seed.metro]),
    venues: await upsert(tx, venues, seed.venues),
    organizers: await upsert(tx, organizers, seed.organizers),
    sources: await upsert(tx, sources, seed.sources),
    series: await upsert(tx, series, seed.series),
    events: await upsert(tx, events, seed.events),
    event_sources: await upsert(tx, eventSources, seed.eventSources),
    field_provenance: await upsert(tx, fieldProvenance, seed.provenance),
  }));
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  const now = new Date();
  const mode = describeMode();
  const dryRun = argv.includes("--dry-run");

  // `--metro <slug>`: New York unless named. Row-only metros have no demo seed.
  const metroIndex = argv.indexOf("--metro");
  const metroSlug = metroIndex >= 0 ? (argv[metroIndex + 1] ?? "") : "nyc";
  const knownSlugs = ["nyc", ...Object.keys(ROW_ONLY_METROS)];
  if (!knownSlugs.includes(metroSlug)) {
    throw new Error(`Unknown metro "${metroSlug}": ${knownSlugs.join(", ")}`);
  }

  // Handle row-only metros (london, philadelphia, etc.)
  if (metroSlug in ROW_ONLY_METROS) {
    const metroOnly = argv.includes("--metro-only");
    if (!metroOnly && !dryRun && env.DATABASE_URL) {
      throw new Error(`${ROW_ONLY_METROS[metroSlug]!().name} has no demo seed: use --metro-only`);
    }

    const row = ROW_ONLY_METROS[metroSlug]!();
    if (!env.DATABASE_URL || dryRun) {
      console.log(
        `${dryRun ? "Dry run" : "No DATABASE_URL"}: nothing written. The ${row.name} metro row would write:`,
      );
      console.log(`  metros: 1`);
      console.log(mode.summary);
      return;
    }

    console.log(`Seeding ${row.name} metro row into the database (${mode.summary})`);
    try {
      const written = await getDb().transaction(async (tx) => upsert(tx, metros, [row]));
      console.log(`metros: ${written} upserted (${row.name} only; no demo venues or listings)`);
    } finally {
      await closeDb();
    }
    return;
  }

  const seed = seedNyc(now);
  const counts = summarize(seed);
  const metroOnly = argv.includes("--metro-only");

  if (!env.DATABASE_URL || dryRun) {
    console.log(
      `${dryRun ? "Dry run" : "No DATABASE_URL"}: nothing written. The New York seed for ${seed.tonight} (${seed.metro.tz}) would write:`,
    );
    for (const [table, count] of Object.entries(counts)) console.log(`  ${table}: ${count}`);
    console.log(mode.summary);
    return;
  }

  // A real database takes the metro row only: the seed's venues and listings are invented for
  // mock mode and must never sit beside harvested ones, where they would read as real.
  if (metroOnly) {
    try {
      const written = await getDb().transaction(async (tx) => upsert(tx, metros, [seed.metro]));
      console.log(`metros: ${written} upserted (New York only; no demo venues or listings)`);
    } finally {
      await closeDb();
    }
    return;
  }

  console.log(`Seeding New York for ${seed.tonight} into the database (${mode.summary})`);
  try {
    const written = await writeSeed(getDb(), seed);
    for (const [table, count] of Object.entries(written))
      console.log(`  ${table}: ${count} upserted`);
  } finally {
    await closeDb();
  }
}

const isEntryPoint =
  typeof process.argv[1] === "string" &&
  /[\\/]seed[\\/]run\.(ts|js|mjs|cjs)$/.test(process.argv[1]);

if (isEntryPoint) {
  main().catch((error: unknown) => {
    console.error("seed failed:", failureMessage(error));
    process.exitCode = 1;
  });
}
