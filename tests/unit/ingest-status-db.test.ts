// ingestStatus (D-899): the on-demand refresh reads a city's last good read and its running one.

import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";

import { DbListingsRepository } from "@/src/data/db-repository";
import { jobRuns, metros } from "@/src/db/schema";
import { closeTestDb, describeDb, requireDbInCi, resetDb, testDb } from "@/tests/unit/db-harness";

requireDbInCi();

let db: Awaited<ReturnType<typeof testDb>>;
let parisId: string;
const at = (iso: string) => new Date(iso);

describeDb("ingestStatus", () => {
  beforeAll(async () => {
    db = await testDb("ingest_status");
  });
  afterAll(closeTestDb);

  beforeEach(async () => {
    await resetDb();
    const [paris] = await db
      .insert(metros)
      .values({
        slug: "paris",
        name: "Paris",
        countryCode: "FR",
        center: { lat: 48.8566, lng: 2.3522 },
        radiusKm: 25,
        tz: "Europe/Paris",
        languages: ["fr"],
        adHoc: false,
      })
      .returning({ id: metros.id });
    parisId = paris!.id;
  });

  const repo = () => new DbListingsRepository(() => db, { snapshotTtlMs: 0 });

  it("is null for an unknown city, and empty for a city never read", async () => {
    expect(await repo().ingestStatus("atlantis")).toBeNull();
    expect(await repo().ingestStatus("paris")).toEqual({ lastSuccessAt: null, runningSince: null });
  });

  it("gives the last succeeded ingest's finish and the running one's start; other jobs do not count", async () => {
    await db.insert(jobRuns).values([
      {
        job: "ingest",
        metroId: parisId,
        status: "succeeded",
        startedAt: at("2026-11-26T05:27:00Z"),
        finishedAt: at("2026-11-26T05:51:00Z"),
      },
      {
        job: "ingest",
        metroId: parisId,
        status: "failed",
        startedAt: at("2026-11-26T09:00:00Z"),
        finishedAt: at("2026-11-26T09:05:00Z"),
      },
      {
        job: "link-check",
        metroId: parisId,
        status: "succeeded",
        startedAt: at("2026-11-26T19:41:00Z"),
        finishedAt: at("2026-11-26T19:45:00Z"),
      },
      { job: "ingest", metroId: parisId, status: "running", startedAt: at("2026-11-27T14:58:00Z") },
    ]);
    expect(await repo().ingestStatus("paris")).toEqual({
      lastSuccessAt: at("2026-11-26T05:51:00Z"),
      runningSince: at("2026-11-27T14:58:00Z"),
    });
  });
});
