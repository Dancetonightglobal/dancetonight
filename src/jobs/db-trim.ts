// Database trim for the Supabase free plan (D-894): `pnpm db:trim` measures, `DB_TRIM_APPLY=1 pnpm db:trim` trims.
// The free plan's 500 MB is an organisation-wide average of daily database size, so the size must come down before a
// downgrade, and deleting rows alone does not lower it: Postgres only reuses the space until VACUUM FULL returns it.
//
// The dry run (the default) only reads: the biggest tables, field_provenance by entity type and currency, and how
// many rows each trim would delete. Apply deletes, in batches, only what nothing reads again:
//   1. provenance whose event or venue no longer exists (field_provenance has no foreign key);
//   2. superseded provenance (is_current = false) older than 14 days for events whose night has passed: a past night
//      is never re-read, re-merged or re-retired, and its current facts stay;
// then VACUUM FULL field_provenance (a lock of a minute or two; the ingest retries) and prints the sizes again.
// Started by hand: .github/workflows/db-trim.yml.
import postgres from "postgres";

const BATCH = 20_000;

type Sql = postgres.Sql;

async function sizes(sql: Sql, label: string): Promise<void> {
  const [db] = await sql`select pg_size_pretty(pg_database_size(current_database())) as size`;
  console.log(`${label}: database ${db?.size}`);
  const rows = await sql`
    select relname, pg_size_pretty(pg_total_relation_size(relid)) as size, n_live_tup, n_dead_tup
    from pg_stat_user_tables order by pg_total_relation_size(relid) desc limit 12`;
  for (const r of rows)
    console.log(`  ${r.relname} ${r.size} live=${r.n_live_tup} dead=${r.n_dead_tup}`);
}

const ORPHANS = `
  (fp.entity_type = 'event' and not exists (select 1 from events e where e.id = fp.entity_id))
  or (fp.entity_type = 'venue' and not exists (select 1 from venues v where v.id = fp.entity_id))`;

const PAST_SUPERSEDED = `
  fp.entity_type = 'event' and not fp.is_current and fp.created_at < now() - interval '14 days'
  and exists (select 1 from events e where e.id = fp.entity_id and e.night_date < current_date)`;

async function measure(sql: Sql): Promise<void> {
  const byType = await sql`
    select entity_type::text as t, is_current, count(*)::int as n,
           pg_size_pretty(sum(pg_column_size(fp.*))::bigint) as bytes
    from field_provenance fp group by 1, 2 order by 1, 2`;
  console.log("field_provenance by entity type and currency (row bytes, before indexes):");
  for (const r of byType) console.log(`  ${r.t} current=${r.is_current}: ${r.n} rows, ${r.bytes}`);
  const [orphans] = await sql.unsafe(
    `select count(*)::int as n from field_provenance fp where ${ORPHANS}`,
  );
  console.log(`trim 1, provenance of events or venues that no longer exist: ${orphans?.n} rows`);
  const [past] = await sql.unsafe(
    `select count(*)::int as n from field_provenance fp where ${PAST_SUPERSEDED}`,
  );
  console.log(`trim 2, superseded provenance older than 14 days of past nights: ${past?.n} rows`);
  const [all] = await sql`
    select count(*)::int as n from field_provenance fp
    where not fp.is_current and fp.created_at < now() - interval '14 days'`;
  console.log(`(not trimmed) all superseded provenance older than 14 days: ${all?.n} rows`);
  const ev =
    await sql`select status::text as s, count(*)::int as n from events group by 1 order by 2 desc`;
  console.log(`events by status: ${ev.map((r) => `${r.s}=${r.n}`).join(", ")}`);
}

async function trim(sql: Sql, label: string, where: string): Promise<number> {
  let total = 0;
  for (;;) {
    const rows = await sql.unsafe(
      `delete from field_provenance where id in (select fp.id from field_provenance fp where ${where} limit ${BATCH}) returning 1`,
    );
    total += rows.length;
    if (rows.length > 0) console.log(`  ${label}: ${total} deleted`);
    if (rows.length < BATCH) break;
  }
  return total;
}

async function main(): Promise<number> {
  const url = (process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL)?.trim();
  if (!url) {
    console.log("DATABASE_URL is not set");
    return 2;
  }
  const apply = process.env.DB_TRIM_APPLY?.trim() === "1";
  const sql = postgres(url, { max: 1, prepare: false, idle_timeout: 10, onnotice: () => {} });
  try {
    await sql`set statement_timeout = 0`;
    await sizes(sql, "before");
    await measure(sql);
    if (!apply) {
      console.log("dry run: nothing deleted (start the workflow with apply to trim)");
      return 0;
    }
    const a = await trim(sql, "trim 1", ORPHANS);
    const b = await trim(sql, "trim 2", PAST_SUPERSEDED);
    console.log(`deleted ${a + b} rows; VACUUM FULL field_provenance ...`);
    await sql.unsafe("vacuum full analyze field_provenance");
    await sizes(sql, "after");
    return 0;
  } finally {
    await sql.end({ timeout: 10 });
  }
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    // Never print the connection string: postgres errors carry a message and a code only.
    console.error("db-trim failed:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  },
);
