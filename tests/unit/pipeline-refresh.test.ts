// An hourly run reads only the sources that are due, sets each one's next time as it finishes
// with it, stops at its time box and leaves the rest first for the next run, and a full read
// reads everything (D-088). Synthetic calendars on a metro with no starting list.

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { Metro } from "@/src/adapters/types";
import type { Db } from "@/src/db/client";
import { metros, sources } from "@/src/db/schema";
import { createPoliteHttp } from "@/src/pipeline/http";
import { formatReport, runIngest } from "@/src/pipeline/ingest";
import { loadMetro, loadSources, upsertSource } from "@/src/pipeline/store";
import { closeTestDb, describeDb, requireDbInCi, resetDb, testDb } from "@/tests/unit/db-harness";

requireDbInCi();

const HOUR = 3_600_000;
// Monday 2026-10-05, 12:17pm EDT: the first run below.
const NOON = new Date("2026-10-05T16:17:00Z");
const TONIGHT = "https://tonight.example/events.ics";
const LATER = "https://later.example/events.ics";
const THIRD = "https://third.example/events.ics";

const ics = (date: string, title: string) =>
  [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//test//EN",
    "BEGIN:VEVENT",
    `UID:${title}@test`,
    `DTSTART;TZID=America/New_York:${date}T210000`,
    `DTEND;TZID=America/New_York:${date}T235900`,
    `SUMMARY:${title}`,
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].join("\r\n");

const BODIES: Record<string, string> = {
  [TONIGHT]: ics("20261005", "Salsa Social"),
  [LATER]: ics("20261008", "Swing Dance"),
  [THIRD]: ics("20261009", "Tango Milonga"),
};

let db: Db;
let metro: Metro;
let fetched: string[];
let inFlight = 0;
let maxInFlight = 0;

function http(start: Date) {
  let t = start.getTime();
  return createPoliteHttp({
    userAgent: "DanceTonightBot/1.0",
    now: () => t,
    sleep: async (ms) => void (t += ms),
    transport: async (req) => {
      if (req.url.endsWith("/robots.txt"))
        return {
          url: req.url,
          status: 200,
          headers: {} as Record<string, string>,
          body: "User-agent: *\nDisallow:\n",
        };
      fetched.push(req.url);
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 20));
      inFlight -= 1;
      return {
        url: req.url,
        status: 200,
        headers: { "content-type": "text/calendar" },
        body: BODIES[req.url] ?? "",
      };
    },
  });
}

/** One run `hours` after the first; the wall clock moves `minutesPerRead` with every reading. */
function runAt(
  hours: number,
  opts: {
    full?: boolean;
    timeBoxMs?: number;
    fullTimeBoxMs?: number;
    minutesPerRead?: number;
    concurrency?: number;
  } = {},
) {
  const start = new Date(NOON.getTime() + hours * HOUR);
  fetched = [];
  maxInFlight = 0;
  let wall = 0;
  return runIngest({
    db,
    metro,
    http: http(start),
    now: () => start,
    env: {},
    full: opts.full,
    timeBoxMs: opts.timeBoxMs,
    fullTimeBoxMs: opts.fullTimeBoxMs,
    // Each look at the wall clock is one source started: the time box is checked once per source.
    wallClock: () => (wall += (opts.minutesPerRead ?? 0) * 60_000),
    concurrency: opts.concurrency,
  });
}

const nextOf = async (url: string) =>
  (await db.select({ next: sources.nextHarvestAt }).from(sources).where(eq(sources.url, url)))[0]
    ?.next ?? null;

describeDb("hourly runs read only what is due (D-088)", () => {
  beforeAll(async () => {
    db = await testDb("refresh");
  });
  afterAll(closeTestDb);

  beforeEach(async () => {
    await resetDb();
    // Not "nyc": this metro has no starting list, so only the sources below exist.
    await db.insert(metros).values({
      slug: "refreshtown",
      name: "Refreshtown",
      countryCode: "US",
      center: { lat: 40.7128, lng: -74.006 },
      radiusKm: 40,
      tz: "America/New_York",
      languages: ["en"],
    });
    metro = (await loadMetro(db, "refreshtown"))!;
    for (const url of [TONIGHT, LATER]) {
      await upsertSource(db, metro.id, {
        url,
        kind: "feed_ics",
        feedUrl: url,
        trustTier: "first_party",
        discoveredBy: "seed_list",
      });
    }
  });

  it("reads each source when it is due, hourly in the evening for one with a listing tonight", async () => {
    // 12:17pm: both were never read, so both are due.
    const first = await runAt(0);
    expect(first.refresh).toMatchObject({ full: false, due: 2, read: 2, skipped: 0, deferred: 0 });
    expect(fetched.sort()).toEqual([LATER, TONIGHT]);
    // Both are readers: due again in 2 hours from the 12pm slot, less the grace (1:40pm).
    expect(await nextOf(TONIGHT)).toEqual(new Date("2026-10-05T17:40:00Z"));
    expect(await nextOf(LATER)).toEqual(new Date("2026-10-05T17:40:00Z"));
    // Due at 1:17pm: none.
    expect(first.refresh.nextRunDue).toBe(0);

    // 1:17pm: nothing is due, and nothing is fetched; both are due at 2:17pm.
    const second = await runAt(1);
    expect(second.refresh).toMatchObject({ due: 0, read: 0, skipped: 2 });
    expect(fetched).toEqual([]);
    expect(second.refresh.nextRunDue).toBe(2);

    // 2:17pm: both. Tonight's calendar is now due at 3pm, before its 2 hours; the other at 3:40pm.
    expect((await runAt(2)).refresh).toMatchObject({ due: 2, read: 2, skipped: 0 });
    expect(await nextOf(TONIGHT)).toEqual(new Date("2026-10-05T19:00:00Z"));
    expect(await nextOf(LATER)).toEqual(new Date("2026-10-05T19:40:00Z"));

    // From 3pm, tonight's calendar every hour; the other every two.
    expect((await runAt(3)).refresh).toMatchObject({ read: 1, skipped: 1 });
    expect(fetched).toEqual([TONIGHT]);
    expect((await runAt(4)).refresh).toMatchObject({ read: 2 });
    expect(fetched.sort()).toEqual([LATER, TONIGHT]);
    expect((await runAt(5)).refresh).toMatchObject({ read: 1 });
    expect(fetched).toEqual([TONIGHT]);
  });

  it("opens the report with due, read and skipped counts, the run's minutes and the next run's due count", async () => {
    await runAt(0);
    const text = formatReport(await runAt(1));
    expect(text.split("\n")[0]).toBe(
      "Due 0: read 0, deferred 0 (time box none). Not due, skipped: 2. Run 0 min. Due at the next hourly run: 2.",
    );
  });

  it("stops at its time box and reads the rest first in the next run", async () => {
    await upsertSource(db, metro.id, {
      url: THIRD,
      kind: "feed_ics",
      feedUrl: THIRD,
      trustTier: "first_party",
      discoveredBy: "seed_list",
    });
    // 8 minutes; the clock reads 5 at the first source, 10 at the second.
    const boxed = await runAt(0, { timeBoxMs: 8 * 60_000, minutesPerRead: 5 });
    expect(boxed.refresh).toMatchObject({ due: 3, read: 1, deferred: 2, timeBoxMinutes: 8 });
    const deferred = boxed.sources.filter((s) => s.status === "deferred");
    expect(deferred).toHaveLength(2);
    expect(deferred[0]!.detail).toBe(
      "deferred to the next run: this run's 8-minute time box is spent",
    );
    // Stamped with the run's start: due next run, and ahead of anything else due then.
    for (const line of deferred) expect(await nextOf(line.url)).toEqual(NOON);
    expect(boxed.refresh.nextRunDue).toBe(2);
    const order = (await loadSources(db, metro.id, new Date(NOON.getTime() + HOUR))).map(
      (s) => s.url,
    );
    expect(order.slice(0, 2).sort()).toEqual(deferred.map((l) => l.url).sort());

    const next = await runAt(1, { timeBoxMs: 8 * 60_000 });
    expect(next.refresh).toMatchObject({ due: 2, read: 2, deferred: 0 });
  });

  it("reads every source on a full read, due or not, with no time box", async () => {
    await runAt(0);
    const full = await runAt(1, { full: true, timeBoxMs: 60_000, minutesPerRead: 5 });
    expect(full.refresh).toMatchObject({
      full: true,
      due: 2,
      read: 2,
      skipped: 0,
      deferred: 0,
      timeBoxMinutes: null,
    });
    expect(fetched.sort()).toEqual([LATER, TONIGHT]);
    expect(formatReport(full).split("\n")[0]).toMatch(/^Full read: every source, due or not\./);
  });

  it("reads a page the model reads every 6 hours", async () => {
    const PAGE = "https://page.example/";
    await upsertSource(db, metro.id, {
      url: PAGE,
      kind: "html",
      platform: "probed",
      trustTier: "first_party",
      discoveredBy: "seed_list",
    });
    // No model in this run: the page waits, on the model's cadence (6 hours from 12pm, 5:40pm).
    await runAt(0);
    expect(await nextOf(PAGE)).toEqual(new Date("2026-10-05T21:40:00Z"));
  });

  it("retries a failed source in the next run (markFailed leaves it unstamped)", async () => {
    BODIES[LATER] = "not a calendar";
    try {
      await runAt(0);
    } finally {
      BODIES[LATER] = ics("20261008", "Swing Dance");
    }
    expect(await nextOf(LATER)).toBeNull();
    expect((await runAt(1)).refresh).toMatchObject({ read: 1 });
    expect(fetched).toEqual([LATER]);
  });

  it("a full read stops at its own time box and the rest go first next run (D-159)", async () => {
    await upsertSource(db, metro.id, {
      url: THIRD,
      kind: "feed_ics",
      feedUrl: THIRD,
      trustTier: "first_party",
      discoveredBy: "seed_list",
    });
    // 8 minutes; the clock reads 5 at the first source, 10 at the second.
    const boxed = await runAt(0, { full: true, fullTimeBoxMs: 8 * 60_000, minutesPerRead: 5 });
    expect(boxed.refresh).toMatchObject({ full: true, read: 1, deferred: 2, timeBoxMinutes: 8 });
    const deferred = boxed.sources.filter((s) => s.status === "deferred");
    expect(deferred).toHaveLength(2);
    expect(deferred[0]!.detail).toBe(
      "deferred to the next run: this run's 8-minute time box is spent",
    );
    // Stamped with the run's start: due next run, and ahead of anything else due then.
    for (const line of deferred) expect(await nextOf(line.url)).toEqual(NOON);
    expect(boxed.refresh.nextRunDue).toBe(2);
    const order = (await loadSources(db, metro.id, new Date(NOON.getTime() + HOUR))).map(
      (s) => s.url,
    );
    expect(order.slice(0, 2).sort()).toEqual(deferred.map((l) => l.url).sort());

    const next = await runAt(1, { full: true, fullTimeBoxMs: 8 * 60_000, minutesPerRead: 5 });
    expect(next.refresh).toMatchObject({ full: true, read: 1, deferred: 2 });
    expect(deferred.map((l) => l.url)).toContain(fetched[0]);
    expect(formatReport(boxed).split("\n")[0]).toMatch(
      /^Full read: every source, due or not\. Read 1, deferred 2 \(time box 8 min\)\. /,
    );
  });

  it("reads sources a few at a time when asked (D-160)", async () => {
    await upsertSource(db, metro.id, {
      url: THIRD,
      kind: "feed_ics",
      feedUrl: THIRD,
      trustTier: "first_party",
      discoveredBy: "seed_list",
    });
    const one = await runAt(0, { full: true });
    expect(one.refresh.read).toBe(3);
    expect(maxInFlight).toBe(1);
    const many = await runAt(1, { full: true, concurrency: 3 });
    expect(many.refresh).toMatchObject({ read: 3, deferred: 0 });
    expect(fetched.sort()).toEqual([LATER, THIRD, TONIGHT]);
    expect(maxInFlight).toBeGreaterThan(1);
    for (const line of many.sources) {
      expect(line.status).toMatch(/^(ok|unchanged)$/);
    }
  });
});

describe("the schedule (D-089)", () => {
  it("refreshes twice a day, a full read at 9:27am and 2:27pm New York time", async () => {
    const { readFile } = await import("node:fs/promises");
    const yml = await readFile(".github/workflows/ingest.yml", "utf8");
    const schedule = yml.slice(yml.indexOf("  schedule:"), yml.indexOf("  workflow_dispatch:"));
    expect(schedule.match(/cron:/g)).toHaveLength(2);
    expect(schedule).toContain('- cron: "27 9 * * *"\n      timezone: "America/New_York"');
    expect(schedule).toContain('- cron: "27 14 * * *"\n      timezone: "America/New_York"');
    // Every scheduled run reads every source, with the hour to do it in.
    expect(yml).toContain("(github.event_name == 'schedule' || inputs.full_read) && '--full'");
    expect(yml).toContain("(github.event_name == 'schedule' || inputs.full_read) && 120 || 20");
    // Discovery runs first in the morning job only; discover.yml schedules nothing of its own.
    expect(yml).toContain("if: ${{ github.event.schedule == '27 9 * * *' || inputs.discover }}");
    const discover = await readFile(".github/workflows/discover.yml", "utf8");
    expect(discover).not.toMatch(/^\s*schedule:/m);
  });
});
