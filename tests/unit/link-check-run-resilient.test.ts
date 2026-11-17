// D-814: the daily link check (D-768) failed on every run since it was added (11-07, 11-08): one link_checks upsert
// threw ("Failed query: insert into link_checks ...", cause not printed), Promise.all rejected, the job exited 1 and
// wrote no job_runs rows, so no card was ever flagged. Now every host's links are checked by a few workers, a failed
// write is counted and the run goes on, and the first error's cause is kept for the log.
import { describe, expect, it, beforeAll, afterAll, beforeEach } from "vitest";

import { linkChecks } from "@/src/db/schema/ops";
import { createPoliteHttp } from "@/src/pipeline/http";
import { LINK_CHECK_HOST_WORKERS, errorText, runLinkChecks } from "@/src/pipeline/link-check-run";
import { requireDbInCi, describeDb, testDb, resetDb, closeTestDb } from "@/tests/unit/db-harness";

requireDbInCi();

describe("errorText", () => {
  it("joins an error's message with its cause's", () => {
    const inner = new Error('relation "link_checks" is locked');
    const outer = new Error("Failed query: insert into link_checks", { cause: inner });
    expect(errorText(outer)).toBe(
      'Failed query: insert into link_checks; cause: relation "link_checks" is locked',
    );
  });
  it("handles a plain error, a non-error and a non-error cause", () => {
    expect(errorText(new Error("boom"))).toBe("boom");
    expect(errorText("text")).toBe("text");
    expect(errorText(new Error("outer", { cause: "inner" }))).toBe("outer; cause: inner");
  });
});

describeDb("runLinkChecks keeps going (D-814)", () => {
  let db: Awaited<ReturnType<typeof testDb>>;

  beforeAll(async () => {
    db = await testDb("link_check_run_resilient");
  });
  beforeEach(async () => {
    await resetDb();
  });
  afterAll(async () => {
    await closeTestDb();
  });

  const ok = async (req: { url: string }) => ({ url: req.url, status: 200, headers: {}, body: "" });

  it("a failed write is counted and the other links are still written", async () => {
    const http = createPoliteHttp({ transport: ok, userAgent: "test", sleep: async () => {} });
    const urls = ["https://a.example/1", "https://b.example/1", "https://c.example/1"];
    const stats = await runLinkChecks({
      db,
      http,
      urls,
      deadline: Date.now() + 10_000,
      write: async (url, state) => {
        if (url === "https://b.example/1") {
          throw new Error("Failed query: insert", { cause: new Error("connection reset") });
        }
        await db.insert(linkChecks).values({ url, ...state });
      },
    });
    expect(stats.writeErrors).toBe(1);
    expect(stats.firstError).toBe("Failed query: insert; cause: connection reset");
    expect(stats.checked).toBe(3);
    const rows = await db.select().from(linkChecks);
    expect(rows.map((r) => r.url).sort()).toEqual(["https://a.example/1", "https://c.example/1"]);
  });

  it("the default writer upserts, with writeErrors 0 and no firstError", async () => {
    const http = createPoliteHttp({ transport: ok, userAgent: "test", sleep: async () => {} });
    const stats = await runLinkChecks({
      db,
      http,
      urls: ["https://a.example/1"],
      deadline: Date.now() + 10_000,
    });
    expect(stats.writeErrors).toBe(0);
    expect(stats.firstError).toBeNull();
    expect(await db.select().from(linkChecks)).toHaveLength(1);
  });

  it(`checks at most ${LINK_CHECK_HOST_WORKERS} hosts at once, and every host's links`, async () => {
    expect(LINK_CHECK_HOST_WORKERS).toBe(8);
    let inFlight = 0;
    let most = 0;
    const transport = async (req: { url: string }) => {
      inFlight++;
      most = Math.max(most, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return { url: req.url, status: 200, headers: {}, body: "" };
    };
    const http = createPoliteHttp({ transport, userAgent: "test", sleep: async () => {} });
    const urls = Array.from({ length: 30 }, (_, i) => `https://host${i}.example/e`);
    const stats = await runLinkChecks({ db, http, urls, deadline: Date.now() + 60_000 });
    expect(stats.checked).toBe(30);
    expect(most).toBeLessThanOrEqual(LINK_CHECK_HOST_WORKERS);
    expect(most).toBeGreaterThan(1);
    expect(await db.select().from(linkChecks)).toHaveLength(30);
  });
});
