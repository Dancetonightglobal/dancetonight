import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// D-891: a delete checks every foreign key that points at the deleted rows. When the referencing column leads no index,
// Postgres scans the whole referencing table once per deleted row: the archive's first live run (2026-11-23) timed out
// deleting field_provenance rows (self-reference conflicts_with) this way. Every foreign key on the tables the archive
// deletes from (events, field_provenance, and what references them) must have its column lead an index or key.
const DIR = join(process.cwd(), "src/db/migrations");
const sqlText = readdirSync(DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => readFileSync(join(DIR, f), "utf8"))
  .join("\n");

const fks = [
  ...sqlText.matchAll(
    /ALTER TABLE "(\w+)" ADD CONSTRAINT "\w+" FOREIGN KEY \("(\w+)"\) REFERENCES "public"\."(\w+)"/g,
  ),
].map((m) => ({ table: m[1]!, column: m[2]!, target: m[3]! }));

function leadsAnIndex(table: string, column: string): boolean {
  const index = new RegExp(`CREATE (?:UNIQUE )?INDEX[^;]*ON "${table}"[^(]*\\("${column}"`);
  const constraint = new RegExp(
    `ALTER TABLE "${table}" ADD CONSTRAINT "\\w+" (?:UNIQUE|PRIMARY KEY)(?: NULLS NOT DISTINCT)?\\("${column}"`,
  );
  const inline = new RegExp(`CREATE TABLE "${table}" \\([^;]*"${column}" [^,\\n]*PRIMARY KEY`);
  const tableUnique = new RegExp(
    `CREATE TABLE "${table}" \\([^;]*CONSTRAINT "\\w+" (?:UNIQUE|PRIMARY KEY)\\("${column}"`,
  );
  return (
    index.test(sqlText) ||
    constraint.test(sqlText) ||
    inline.test(sqlText) ||
    tableUnique.test(sqlText)
  );
}

describe("D-891 foreign keys the archive delete checks lead an index", () => {
  const checked = fks.filter((fk) => fk.target === "events" || fk.target === "field_provenance");

  it("finds the foreign keys onto events and field_provenance", () => {
    expect(checked.map((fk) => `${fk.table}.${fk.column}`)).toEqual(
      expect.arrayContaining([
        "field_provenance.conflicts_with",
        "events.merged_into_id",
        "reports.event_id",
      ]),
    );
  });

  it.each(checked.map((fk) => [`${fk.table}.${fk.column}`, fk] as const))(
    "%s leads an index",
    (_, fk) => {
      expect(leadsAnIndex(fk.table, fk.column)).toBe(true);
    },
  );
});
