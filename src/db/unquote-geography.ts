/**
 * drizzle-kit quotes column types it does not recognise, so `pnpm db:generate` writes
 * `"geography(Point, 4326)"`, which Postgres reads as the name of a type that does not exist.
 * This rewrites every migration to the bare type. Run it after every `pnpm db:generate`:
 *
 *   pnpm db:generate --name <name> && pnpm exec tsx src/db/unquote-geography.ts
 *
 * tests/unit/schema.test.ts fails when a migration still carries the quoted form.
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const QUOTED_GEOGRAPHY = /"geography\((\w+), (\d+)\)"/g;

export function unquoteGeography(sqlText: string): string {
  return sqlText.replace(QUOTED_GEOGRAPHY, "geography($1, $2)");
}

async function main(): Promise<void> {
  const folder = path.resolve(process.cwd(), "src/db/migrations");
  const files = (await readdir(folder)).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    const full = path.join(folder, file);
    const before = await readFile(full, "utf8");
    const after = unquoteGeography(before);
    if (after !== before) {
      await writeFile(full, after);
      console.log(`unquoted geography types in ${file}`);
    }
  }
}

const isEntryPoint = process.argv[1] !== undefined && import.meta.url.endsWith(process.argv[1]);
if (isEntryPoint) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
