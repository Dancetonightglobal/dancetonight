import { afterEach, describe, expect, it } from "vitest";
import { closeDb, getDb, getDirectSql, isPoolerUrl, readConnectionUrl } from "@/src/db/client";

const saved = { DATABASE_URL: process.env.DATABASE_URL, DIRECT: process.env.DIRECT_DATABASE_URL };

afterEach(async () => {
  await closeDb();
  process.env.DATABASE_URL = saved.DATABASE_URL;
  process.env.DIRECT_DATABASE_URL = saved.DIRECT;
});

describe("isPoolerUrl", () => {
  it("recognises the Supabase transaction pooler by port and host", () => {
    expect(isPoolerUrl("postgresql://u:p@aws-0-us-east-1.pooler.supabase.com:6543/postgres")).toBe(
      true,
    );
    expect(isPoolerUrl("postgresql://u:p@aws-0-us-east-1.pooler.supabase.com:5432/postgres")).toBe(
      true,
    );
    expect(isPoolerUrl("postgres://u:p@localhost:6543/db")).toBe(true);
    expect(isPoolerUrl("postgres://u:p@db.example.com:5432/db?pgbouncer=true")).toBe(true);
    expect(isPoolerUrl("postgres://u:p@pgbouncer.internal:5432/db")).toBe(true);
  });

  it("treats a direct connection as direct", () => {
    expect(isPoolerUrl("postgresql://u:p@db.abc.supabase.co:5432/postgres")).toBe(false);
    expect(isPoolerUrl("postgres://u:p@localhost:5432/dancetonight")).toBe(false);
    expect(isPoolerUrl("postgres://u:p@localhost/dancetonight")).toBe(false);
  });
});

describe("readConnectionUrl", () => {
  it("fails with a plain message when the variable is missing or blank", () => {
    delete process.env.DATABASE_URL;
    expect(() => readConnectionUrl("DATABASE_URL")).toThrow(/DATABASE_URL is not set/);
    process.env.DATABASE_URL = "   ";
    expect(() => readConnectionUrl("DATABASE_URL")).toThrow(/DATABASE_URL is not set/);
  });

  it("rejects anything that is not a postgres URL", () => {
    process.env.DIRECT_DATABASE_URL = "https://example.com/db";
    expect(() => readConnectionUrl("DIRECT_DATABASE_URL")).toThrow(/not a postgres:\/\/ URL/);
    process.env.DIRECT_DATABASE_URL = "not a url";
    expect(() => readConnectionUrl("DIRECT_DATABASE_URL")).toThrow(/not a postgres:\/\/ URL/);
  });

  it("accepts postgres:// and postgresql:// and trims whitespace", () => {
    process.env.DATABASE_URL = " postgres://u:p@localhost:5432/db ";
    expect(readConnectionUrl("DATABASE_URL")).toBe("postgres://u:p@localhost:5432/db");
    process.env.DATABASE_URL = "postgresql://u:p@localhost:5432/db";
    expect(readConnectionUrl("DATABASE_URL")).toBe("postgresql://u:p@localhost:5432/db");
  });
});

describe("lazy clients", () => {
  it("can be imported and closed without any database configured", async () => {
    delete process.env.DATABASE_URL;
    delete process.env.DIRECT_DATABASE_URL;
    await expect(closeDb()).resolves.toBeUndefined();
    expect(() => getDb()).toThrow(/DATABASE_URL is not set/);
    expect(() => getDirectSql()).toThrow(/DIRECT_DATABASE_URL is not set/);
  });

  it("builds a client for a pooler URL without connecting, and returns the same instance", async () => {
    // postgres.js connects on first query, so constructing a client to an unreachable host is safe.
    process.env.DATABASE_URL = "postgres://u:p@127.0.0.1:6543/db";
    const first = getDb();
    const second = getDb();
    expect(second).toBe(first);
    await closeDb();
    expect(getDb()).not.toBe(first);
  });
});
