/**
 * Applies the SQL migrations to the database at DIRECT_DATABASE_URL (never the pooler).
 *
 * Order: `0000_extensions.sql` (PostGIS and pg_trgm, idempotent) runs first by hand, because
 * the generated migrations use `geography` columns and `gin_trgm_ops`. Then drizzle's migrator
 * applies every entry in `src/db/migrations/meta/_journal.json` that has not run yet.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { closeDb, getDirectDb, getDirectSql } from "@/src/db/client";

export const migrationsFolder = path.resolve(process.cwd(), "src/db/migrations");
export const extensionsFile = path.join(migrationsFolder, "0000_extensions.sql");

export async function runMigrations(): Promise<void> {
  const sql = getDirectSql();
  const extensions = await readFile(extensionsFile, "utf8");
  await sql.unsafe(extensions);
  console.log("extensions ready: postgis, pg_trgm");
  await migrate(getDirectDb(), { migrationsFolder });
  console.log("migrations applied");
}

runMigrations()
  .then(() => closeDb())
  .catch(async (error: unknown) => {
    console.error("migration failed:", error instanceof Error ? error.message : error);
    await closeDb();
    process.exit(1);
  });
