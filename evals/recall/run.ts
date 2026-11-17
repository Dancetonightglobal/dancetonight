// `pnpm eval:recall --metro nyc --date YYYY-MM-DD [--record]`: the owner's list of nights he
// knows are on (`evals/recall/{metro}/{date}.csv`) against what the database lists for that
// night, with every miss classified (SPEC section 8, PLAN 12, D-112). See README.md beside this.
//
// Needs DATABASE_URL (or DIRECT_DATABASE_URL). Read-only unless --record, which adds one
// `eval_runs` row. Exit status: 0 when the report printed, 1 on a missing file or metro, 2 on usage.

import { readFile } from "node:fs/promises";
import path from "node:path";

import { closeDb, getDb } from "@/src/db/client";
import { parseRecallCsv } from "@/src/domain/recall";
import { isoDateSchema } from "@/src/domain/time";
import { evaluateRecall } from "@/src/pipeline/recall";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<number> {
  const metro = arg("metro");
  const date = isoDateSchema.safeParse(arg("date"));
  if (!metro || !/^[a-z0-9-]+$/.test(metro) || !date.success) {
    console.error("usage: pnpm eval:recall --metro <slug> --date YYYY-MM-DD [--record]");
    return 2;
  }
  const relative = path.join("evals", "recall", metro, `${date.data}.csv`);
  let text: string;
  try {
    text = await readFile(path.join(process.cwd(), relative), "utf8");
  } catch {
    console.error(`no list at ${relative}: copy evals/recall/template.csv there and fill it`);
    return 1;
  }
  const { rows, problems } = parseRecallCsv(text);
  try {
    const report = await evaluateRecall(getDb(), metro, date.data, rows, problems, {
      record: process.argv.includes("--record"),
      reportPath: relative,
    });
    console.log(report.lines.join("\n"));
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    return 1;
  }
}

main()
  .then(async (code) => {
    await closeDb();
    process.exit(code);
  })
  .catch(async (error) => {
    console.error(error);
    await closeDb();
    process.exit(1);
  });
