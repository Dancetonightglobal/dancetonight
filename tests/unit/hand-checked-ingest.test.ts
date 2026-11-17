// D-797: a hand-checked seed (a venue's own Instagram, D-796) is never fetched. Its nights list while
// their hand check is under 35 days old; an expired check lists nothing and retires the stored rows.
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";

import type { SeedSource } from "@/config/sources/nyc";
import type { Metro, Source } from "@/src/adapters/types";
import type { AiClient } from "@/src/ai";
import type { Db } from "@/src/db/client";
import { events, metros } from "@/src/db/schema";
import { postgresExtractionCache } from "@/src/pipeline/ai-stores";
import { createPoliteHttp, type Transport } from "@/src/pipeline/http";
import { runIngest } from "@/src/pipeline/ingest";
import { loadMetro, upsertSource } from "@/src/pipeline/store";
import { closeTestDb, describeDb, requireDbInCi, resetDb, testDb } from "@/tests/unit/db-harness";

requireDbInCi();

// Monday 2026-11-02, 11am New York.
const NOW = new Date("2026-11-02T16:00:00Z");
const IG = "https://www.instagram.com/examplelounge/";

function seed(checkedOn: string): SeedSource {
  return {
    url: IG,
    kind: "html",
    trustTier: "first_party",
    styles: ["salsa"],
    label: "Example Lounge",
    venuePage: true,
    venueAddress: "339 N 11th St, Philadelphia, PA 19107",
    handChecked: true,
    fixedNights: [
      {
        title: "Example Salsa Thursdays",
        line: "Every Thursday: Salsa Thursdays, DJ from 9pm",
        days: [4],
        start: "21:00",
        styles: ["salsa"],
        danceCited: "Instagram post 2026-10-30: 'salsa social every Thursday, DJ from 9pm'",
        checkedOn,
        evidenceUrl: "https://www.instagram.com/p/EXAMPLE1/",
      },
    ],
  } as SeedSource;
}

const noModel = {
  async run() {
    throw new Error("the model must not be asked about a hand-checked seed");
  },
} as unknown as AiClient;

let db: Db;
let metro: Metro;

async function ingest(source: Source, seeds: SeedSource[]) {
  let t = NOW.getTime();
  const requested: string[] = [];
  const transport: Transport = async (request) => {
    requested.push(request.url);
    throw new Error(`no request may be made for a hand-checked seed: ${request.url}`);
  };
  const report = await runIngest({
    db,
    metro,
    env: {},
    only: [source.url],
    seeds,
    ai: { client: noModel, cache: postgresExtractionCache(db) },
    now: () => new Date(t),
    http: createPoliteHttp({
      transport,
      userAgent: "DanceTonightBot/1.0",
      now: () => t,
      sleep: async (ms) => void (t += ms),
    }),
  });
  return { line: report.sources.find((s) => s.url === source.url)!, requested };
}

describeDb("hand-checked seeds (D-797)", () => {
  beforeAll(async () => {
    db = await testDb("hand_checked_ingest");
  });
  afterAll(closeTestDb);
  beforeEach(async () => {
    await resetDb();
    await db.insert(metros).values({
      slug: "philadelphia",
      name: "Philadelphia",
      countryCode: "US",
      center: { lat: 39.9526, lng: -75.1652 },
      radiusKm: 30,
      tz: "America/New_York",
      languages: ["en"],
    });
    metro = (await loadMetro(db, "philadelphia"))!;
  });

  async function source() {
    return upsertSource(db, metro.id, {
      url: IG,
      kind: "html",
      trustTier: "first_party",
      discoveredBy: "seed_list",
      styles: ["salsa"],
    });
  }

  it("lists a fresh hand-checked night without any request or model call", async () => {
    const { line, requested } = await ingest(await source(), [seed("2026-10-30")]);
    expect(requested).toEqual([]);
    expect(line.status).toBe("ok");
    const rows = await db.select().from(events).where(eq(events.title, "Example Salsa Thursdays"));
    expect(rows.map((r) => r.nightDate).sort()).toEqual(["2026-11-05", "2026-11-12"]);
    // 21:00 New York on 2026-11-05 (EST) is 02:00Z on 11-06.
    expect(rows.find((r) => r.nightDate === "2026-11-05")?.startsAt?.toISOString()).toBe(
      "2026-11-06T02:00:00.000Z",
    );
  });

  it("an expired check lists nothing, says recheck, and retires the stored rows", async () => {
    const src = await source();
    await ingest(src, [seed("2026-10-30")]);
    const before = await db
      .select()
      .from(events)
      .where(eq(events.title, "Example Salsa Thursdays"));
    expect(before.filter((r) => r.status === "active")).toHaveLength(2);

    // 2026-09-28 is 35 days before 2026-11-02.
    const { line, requested } = await ingest(src, [seed("2026-09-28")]);
    expect(requested).toEqual([]);
    expect(line.notes.join(" ")).toContain("recheck the venue's Instagram (D-797)");
    const after = await db.select().from(events).where(eq(events.title, "Example Salsa Thursdays"));
    expect(after.filter((r) => r.status === "active")).toHaveLength(0);
  });
});
