// `pnpm dedupe:unmerge --event <slug or id>`: undo one dedupe merge (D-090). Either listing of
// the pair may be named: the merged one's slug from the run report's "Merged:" line, or the
// survivor's, when only one listing was merged into it. The merged listing is listed again, the
// survivor gives back what the merge copied onto it, and the pair is recorded as
// `manual_distinct`, which no later run overwrites or merges across.
//
//   pnpm dedupe:unmerge --event frim-fram-jam-2026-10-08-9e517c
//
// Needs DATABASE_URL (or DIRECT_DATABASE_URL). Only the integrator runs it against production.

import { sql } from "drizzle-orm";

import { closeDb, getDb } from "@/src/db/client";
import { jobRuns } from "@/src/db/schema";
import { unmergePair } from "@/src/pipeline/dedupe";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function main(): Promise<number> {
  const given = arg("event");
  if (!given) {
    console.error("usage: pnpm dedupe:unmerge --event <slug or id>");
    return 2;
  }
  const db = getDb();
  const rows = await db.execute<{ id: string; title: string; status: string }>(
    UUID.test(given)
      ? sql`select id, title, status::text as status from events where id = ${given}`
      : sql`select id, title, status::text as status from events where slug = ${given}`,
  );
  const row = [...rows][0];
  if (!row) {
    console.error(`no listing ${given}`);
    return 1;
  }
  // A survivor named: the one listing merged into it, when there is exactly one.
  let mergedId = row.id;
  if (row.status !== "merged") {
    const into = [
      ...(await db.execute<{ id: string; title: string; slug: string }>(
        sql`select id, title, slug from events where merged_into_id = ${row.id} and status = 'merged'`,
      )),
    ];
    if (into.length !== 1) {
      // List them, so the next run can name one by slug.
      const named = into.map((m) => `${m.slug} (${m.title})`).join(", ");
      console.error(
        `${row.title} is not merged, and ${into.length} listings are merged into it: name the merged one${named ? `: ${named}` : ""}`,
      );
      return 1;
    }
    mergedId = into[0]!.id;
  }
  const result = await unmergePair(db, mergedId);
  if (!result) {
    console.error(`${row.title} is not merged into another listing`);
    return 1;
  }
  // A finished job row: the site's listing cache keys on the newest job_runs stamp (D-578), so an
  // unmerge outside a read shows without waiting for the cache ceiling.
  const now = new Date();
  await db
    .insert(jobRuns)
    .values({ job: "dedupe-unmerge", startedAt: now, finishedAt: now, status: "succeeded" });
  console.log(
    `Unmerged ${result.mergedId} from ${result.survivorId}; put back: ${result.restored.join(", ") || "nothing copied"}. Recorded as manual_distinct.`,
  );
  return 0;
}

main()
  .then(async (code) => {
    await closeDb();
    process.exit(code);
  })
  .catch(async (error: unknown) => {
    console.error("unmerge failed:", error instanceof Error ? error.message : error);
    await closeDb();
    process.exit(1);
  });
