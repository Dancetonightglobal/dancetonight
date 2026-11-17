// Row-level security on every public table (migration 0008): Supabase's Data API serves the public
// schema to the anon key, and RLS with no policies shuts it out. The app connects as the tables' owner,
// which RLS does not apply to, so its reads and writes are unchanged.
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";

import type { Db } from "@/src/db/client";
import { metros } from "@/src/db/schema";
import { closeTestDb, describeDb, requireDbInCi, resetDb, testDb } from "@/tests/unit/db-harness";

requireDbInCi();

let db: Db;

describeDb("row-level security on public tables", () => {
  beforeAll(async () => {
    db = await testDb("rls");
    await resetDb();
  });
  afterAll(closeTestDb);

  it("is on for every public table the app's role owns", async () => {
    const rows = await db.execute<{ relname: string }>(sql`
      select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p')
        and c.relowner = (select oid from pg_roles where rolname = current_user)
        and not c.relrowsecurity
      order by c.relname
    `);
    // A new table needs RLS too: add a migration that enables it.
    expect([...rows].map((r) => r.relname)).toEqual([]);
  });

  it("leaves the owner able to write and read", async () => {
    await db.insert(metros).values({
      slug: "nyc",
      name: "New York",
      countryCode: "US",
      center: { lat: 40.7128, lng: -74.006 },
      radiusKm: 50,
      tz: "America/New_York",
      languages: ["en"],
    });
    const rows = await db.select().from(metros);
    expect(rows.map((r) => r.slug)).toEqual(["nyc"]);
  });
});
