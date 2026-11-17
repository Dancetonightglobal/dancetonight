import { describe, expect, it } from "vitest";

import { inspectUrl } from "@/src/db/check-connection";

const POOLER =
  "postgresql://postgres.tzmjdhaxlshcelfrzdzg:Abc123def456@aws-0-us-east-1.pooler.supabase.com:6543/postgres";

describe("db:check", () => {
  it("passes a well-formed pooler address and never prints the password", () => {
    const f = inspectUrl("DATABASE_URL", POOLER);
    expect(f).toMatchObject({ ok: true, problems: [] });
    expect(f.summary).toBe(
      "DATABASE_URL: transaction pooler aws-0-us-east-1.pooler.supabase.com:6543, user postgres.tzmjdhaxlshcelfrzdzg, database postgres, password 12 characters",
    );
    expect(f.summary).not.toContain("Abc123def456");
  });

  it("names the common mistakes", () => {
    expect(inspectUrl("X", POOLER.replace("Abc123def456", "[YOUR-PASSWORD]")).problems).toContain(
      "the placeholder [YOUR-PASSWORD] is still in it",
    );
    expect(inspectUrl("X", POOLER.replace("Abc123def456", "[Abc123def456]")).problems[0]).toMatch(
      /brackets/,
    );
    expect(
      inspectUrl("X", POOLER.replace("postgres.tzmjdhaxlshcelfrzdzg", "postgres")).problems[0],
    ).toMatch(/needs "postgres.<project id>"/);
    expect(
      inspectUrl(
        "X",
        "postgresql://postgres:Abc123@db.tzmjdhaxlshcelfrzdzg.supabase.co:5432/postgres",
      ).problems[0],
    ).toMatch(/Direct connection address/);
    expect(inspectUrl("X", ` ${POOLER}\n`).problems[0]).toMatch(/space or a line break/);
    expect(inspectUrl("X", undefined)).toMatchObject({ ok: false, summary: "X: not set" });
  });
});
