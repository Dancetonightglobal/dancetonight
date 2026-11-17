// A source that keeps failing is said in every run's report, with its streak and what it still
// has on the site, and nothing it listed is retired or hidden (audit of 2026-09-29, TWIS F1/F2:
// the failure counter was written and never read). Synthetic pages throughout.

import { eq } from "drizzle-orm";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { Metro, Source } from "@/src/adapters/types";
import type { AiClient } from "@/src/ai";
import type { Db } from "@/src/db/client";
import { events, metros, sources } from "@/src/db/schema";
import { rawExtractionSchema } from "@/src/domain/listing";
import { postgresExtractionCache } from "@/src/pipeline/ai-stores";
import { failureStreakNote, type FailingSource } from "@/src/pipeline/health";
import { createPoliteHttp, type Transport, type TransportResponse } from "@/src/pipeline/http";
import { formatReport, runIngest } from "@/src/pipeline/ingest";
import { loadMetro, recordHealth, upsertSource } from "@/src/pipeline/store";
import { closeTestDb, describeDb, requireDbInCi, resetDb, testDb } from "@/tests/unit/db-harness";

requireDbInCi();

// Monday 2026-09-28, noon in New York; every run below is on the same night.
const NOON = new Date("2026-09-28T16:00:00Z");
const HOUR = 3_600_000;
const PAGE = "https://swing.example/";
const venue = { name: "The Studio", address: "37 W 26th St, New York, NY" };
const LISTINGS = [
  {
    title: "Midtown Swings",
    listing_type: "social",
    local_date: "2026-09-29",
    dancing_time: "21:00",
  },
  {
    title: "Frim Fram Jam",
    listing_type: "social",
    local_date: "2026-10-01",
    dancing_time: "21:00",
  },
  // Tonight + 13: read and stored, but no page opens it (D-075), so the note never counts it.
  {
    title: "Back Room Speakeasy Sessions",
    listing_type: "social",
    local_date: "2026-10-11",
    dancing_time: "21:00",
  },
];

let db: Db;
let metro: Metro;
let source: Source;

/** The page, or Cloudflare's challenge (a 403) while `blocked` is set. */
function site(): Transport & { blocked: boolean } {
  const body =
    "<!DOCTYPE html><html><body><h2>Tuesday, September 29</h2><h3>Midtown Swings</h3><p>9pm</p><h2>Thursday, October 1</h2><h3>Frim Fram Jam</h3><p>9pm</p><h2>Sunday, October 11</h2><h3>Back Room Speakeasy Sessions</h3><p>9pm</p></body></html>";
  const transport = async (req: Parameters<Transport>[0]): Promise<TransportResponse> => {
    if (req.url.endsWith("/robots.txt")) {
      return { url: req.url, status: 200, headers: {}, body: "User-agent: *\nDisallow:\n" };
    }
    if (transport.blocked) {
      return {
        url: req.url,
        status: 403,
        headers: { "cf-mitigated": "challenge" },
        body: "<title>Just a moment...</title>",
      };
    }
    return { url: req.url, status: 200, headers: {}, body };
  };
  transport.blocked = false;
  return transport;
}

function model(): AiClient {
  return {
    async run() {
      return {
        ok: true,
        provider: "cloudflare",
        model: "granite",
        usage: { inputTokens: 900, outputTokens: 300, cost: 4.4, unit: "neuron" },
        value: rawExtractionSchema.parse({
          page_kind: "list",
          language: "en",
          listings: LISTINGS.map((l) => ({ styles: [], organizer: {}, venue, ...l })),
        }),
      };
    },
  } as unknown as AiClient;
}

/** One run, `hours` after noon. */
function ingestAt(transport: Transport, hours: number) {
  let t = NOON.getTime() + hours * HOUR;
  return runIngest({
    db,
    metro,
    env: {},
    only: [PAGE],
    ai: { client: model(), cache: postgresExtractionCache(db) },
    now: () => new Date(t),
    http: createPoliteHttp({
      transport,
      userAgent: "DanceTonightBot/1.0",
      now: () => t,
      sleep: async (ms) => void (t += ms),
    }),
  });
}

const line = (report: Awaited<ReturnType<typeof runIngest>>) =>
  report.sources.find((s) => s.url === PAGE)!;

describeDb("a source that keeps failing (TWIS, audit of 2026-09-29)", () => {
  beforeAll(async () => {
    db = await testDb("streak");
  });
  afterAll(closeTestDb);

  beforeEach(async () => {
    await resetDb();
    await db.insert(metros).values({
      slug: "nyc",
      name: "New York",
      countryCode: "US",
      center: { lat: 40.7128, lng: -74.006 },
      radiusKm: 50,
      tz: "America/New_York",
      languages: ["en"],
    });
    metro = (await loadMetro(db, "nyc"))!;
    source = await upsertSource(db, metro.id, {
      url: PAGE,
      kind: "html",
      platform: "probed",
      trustTier: "first_party",
      discoveredBy: "seed_list",
    });
  });

  it("recordHealth returns the streak, keeps when it began, and ends it on a good run", async () => {
    const at = (h: number) => new Date(NOON.getTime() + h * HOUR);
    await recordHealth(db, source.id, "ok", at(0), null, null);
    const first = await recordHealth(db, source.id, "failed", at(1), "403", null);
    const third =
      (await recordHealth(db, source.id, "failed", at(2), "403", null),
      await recordHealth(db, source.id, "failed", at(3), "403", null));
    expect(first).toMatchObject({ consecutiveFailures: 1, failingSince: at(1).toISOString() });
    expect(third).toEqual({
      consecutiveFailures: 3,
      failingSince: at(1).toISOString(),
      lastSuccessAt: at(0).toISOString(),
      lastError: "403",
      errorRate7d: null,
    });
    const [stored] = await db
      .select({ health: sources.health })
      .from(sources)
      .where(eq(sources.id, source.id));
    expect(stored?.health).toEqual(third);
    // A 304, a deferral or a read ends the streak.
    expect(await recordHealth(db, source.id, "unchanged", at(4), null, null)).toMatchObject({
      consecutiveFailures: 0,
      failingSince: null,
      lastError: null,
    });
  });

  it("recordHealth keeps what discovery recorded on the row (D-120)", async () => {
    const discovery = {
      status: "structured",
      reason: "ics feed",
      probedAt: NOON.toISOString(),
      group: "dance or salsa club",
      gate: { pass: true, reason: "dance words" },
    };
    await db.update(sources).set({ health: { discovery } }).where(eq(sources.id, source.id));
    expect(await recordHealth(db, source.id, "ok", NOON, null, null)).toMatchObject({ discovery });
    expect(await recordHealth(db, source.id, "failed", NOON, "403", null)).toMatchObject({
      discovery,
      consecutiveFailures: 1,
    });
  });

  it("says each run how many in a row, since when, and what it still lists; retires nothing", async () => {
    const transport = site();
    const good = await ingestAt(transport, 0);
    expect(line(good)).toMatchObject({ status: "ok", written: 3 });
    expect(good.failing).toEqual([]);
    expect(formatReport(good)).toContain("Failing sources: none this run.");
    const ids = (await db.select({ id: events.id, status: events.status }).from(events)).map(
      (r) => r,
    );
    expect(ids).toHaveLength(3);

    transport.blocked = true;
    const once = await ingestAt(transport, 1);
    expect(line(once).status).toBe("failed");
    expect(line(once).detail).toMatch(/403/);
    expect(line(once).notes[0]).toMatch(
      /^failed this run; last good run Mon, Sep 28, 12(?::0\d)?pm ET\./,
    );

    await ingestAt(transport, 2);
    const third = await ingestAt(transport, 3);
    const note = line(third).notes[0]!;
    expect(note).toMatch(
      /^failed 3 runs in a row, since Mon, Sep 28, 1(?::0\d)?pm ET; last good run Mon, Sep 28, 12(?::0\d)?pm ET\. Its 2 listings, tonight to Thu, Oct 1, stay listed \(2 from it alone\), not re-checked since Mon, Sep 28, 12(?::0\d)?pm ET; it adds nothing new until a read succeeds\.$/,
    );
    expect(third.failing).toHaveLength(1);
    expect(third.failing[0]).toMatchObject({
      url: PAGE,
      failures: 3,
      listed: 2,
      alone: 2,
      lastNight: "2026-10-01",
    });
    const text = formatReport(third);
    // The full address, as two sources can share a host, and the error, which says what to do.
    expect(text).toContain(
      `Failing sources (1):\n  ${PAGE}: ${note} Last error: stopped: the site answered 403`,
    );
    // Include and flag: every row it listed is still listed.
    const after = await db.select({ id: events.id, status: events.status }).from(events);
    expect(after.map((r) => r.status).sort()).toEqual(["active", "active", "active"]);

    transport.blocked = false;
    const back = await ingestAt(transport, 4);
    expect(line(back).status).toBe("ok");
    expect(back.failing).toEqual([]);
    const [health] = await db
      .select({ health: sources.health })
      .from(sources)
      .where(eq(sources.id, source.id));
    expect(health?.health).toMatchObject({ consecutiveFailures: 0, failingSince: null });
  });
});

describe("the streak note", () => {
  const base: FailingSource = {
    url: PAGE,
    failures: 2,
    since: "2026-09-30T11:17:00Z",
    lastGoodAt: "2026-09-29T13:14:00Z",
    lastError: "stopped: the site answered 403",
    listed: 16,
    alone: 12,
    lastNight: "2026-10-12",
    lastSeenAt: "2026-09-29T13:14:00Z",
  };
  it("names times in Eastern Time and nights as the site does", () => {
    expect(failureStreakNote(base)).toBe(
      "failed 2 runs in a row, since Wed, Sep 30, 7:17am ET; last good run Tue, Sep 29, 9:14am ET. Its 16 listings, tonight to Mon, Oct 12, stay listed (12 from it alone), not re-checked since Tue, Sep 29, 9:14am ET; it adds nothing new until a read succeeds.",
    );
  });
  it("says so when it has never had a good run or has nothing stored, and a streak older than its start", () => {
    expect(
      failureStreakNote({
        ...base,
        lastGoodAt: null,
        listed: 0,
        alone: 0,
        lastNight: null,
        lastSeenAt: null,
      }),
    ).toBe(
      "failed 2 runs in a row, since Wed, Sep 30, 7:17am ET; last good run never. None of its listings are stored for tonight on.",
    );
    expect(failureStreakNote({ ...base, since: null })).toMatch(
      /^failed 2 runs in a row; last good run/,
    );
  });
});

describe("every failure path reports its streak", () => {
  it("records a failed harvest only through markFailed", async () => {
    const text = await readFile(path.join(process.cwd(), "src/pipeline/ingest.ts"), "utf8");
    // The one call is markFailed's own; a new failure path that calls recordHealth directly would
    // fail without a streak note (D-114).
    expect(text.match(/recordHealth\(db, source\.id, "failed"/g)).toHaveLength(1);
    expect(text.match(/line\.status = "failed"/g)).toHaveLength(1);
    expect(text.match(/await markFailed\(/g)?.length ?? 0).toBeGreaterThanOrEqual(7);
  });
});
