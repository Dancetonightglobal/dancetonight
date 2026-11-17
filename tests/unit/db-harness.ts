// A real Postgres with PostGIS for the tests that write to a database. They run when
// TEST_DATABASE_URL is set: CI's `check` job provides one as a service container, and locally
// any disposable database works (never point it at one you care about: every table is truncated).

import { readFile } from "node:fs/promises";
import path from "node:path";

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres, { type Sql } from "postgres";
import { describe } from "vitest";

import type { Db } from "@/src/db/client";
import * as schema from "@/src/db/schema";

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL?.trim() || undefined;

/**
 * `describe` when a test database is configured. CI always configures one, so these tests never
 * go unrun there; `requireDbInCi` below turns a missing URL on CI into a failure.
 */
export const describeDb = TEST_DATABASE_URL ? describe : describe.skip;

export function requireDbInCi(): void {
  if (process.env.CI && !TEST_DATABASE_URL) {
    throw new Error(
      "TEST_DATABASE_URL must be set on CI: the database tests may not be skipped there",
    );
  }
}

let client: Sql | undefined;
let migrated = false;

/**
 * Each test file gets its own database, `<base>_<name>`, created on first use: Vitest runs files
 * in parallel, and two files sharing one database truncate each other's rows mid-test. Creating a
 * database needs the CREATEDB right, which CI's service user and a local superuser both have.
 */
async function databaseFor(name: string): Promise<string> {
  const base = new URL(TEST_DATABASE_URL!);
  const dbName = `${base.pathname.replace(/^\//, "")}_${name.replace(/[^a-z0-9_]/gi, "_").toLowerCase()}`;
  const admin = postgres(TEST_DATABASE_URL!, { max: 1, onnotice: () => {} });
  try {
    const exists = await admin`select 1 from pg_database where datname = ${dbName}`;
    if (exists.length === 0) {
      try {
        await admin.unsafe(`create database "${dbName}"`);
      } catch (error) {
        // Another worker created it between the check and here.
        if (!/already exists/i.test(error instanceof Error ? error.message : String(error)))
          throw error;
      }
    }
  } finally {
    await admin.end({ timeout: 5 });
  }
  base.pathname = `/${dbName}`;
  return base.toString();
}

/** A migrated database of this test file's own; `name` must be unique per file. */
export async function testDb(name: string): Promise<Db> {
  if (!TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL is not set");
  client ??= postgres(await databaseFor(name), { max: 1, onnotice: () => {} });
  const db = drizzle(client, { schema });
  if (!migrated) {
    const folder = path.resolve(process.cwd(), "src/db/migrations");
    await client.unsafe(await readFile(path.join(folder, "0000_extensions.sql"), "utf8"));
    await migrate(db, { migrationsFolder: folder });
    migrated = true;
  }
  return db;
}

/** Empties every application table, keeping the schema. */
export async function resetDb(): Promise<void> {
  if (!client) return;
  const tables = await client<{ tablename: string }[]>`
    select tablename from pg_tables
    where schemaname = 'public' and tablename <> 'spatial_ref_sys'`;
  if (tables.length === 0) return;
  await client.unsafe(
    `truncate ${tables.map((t) => `"${t.tablename}"`).join(", ")} restart identity cascade`,
  );
}

export async function closeTestDb(): Promise<void> {
  await client?.end({ timeout: 5 });
  client = undefined;
  migrated = false;
}
