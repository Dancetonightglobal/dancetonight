// `pnpm eval:refresh`: replays a day of hourly ingest runs (D-088) over the sources and per-source
// times measured in ingest run 50, through the cadence rules themselves (src/domain/refresh.ts,
// config/refresh.ts), and prints each run's due count and estimated minutes, then the month.
//
// Measured inputs (evals/refresh/run50-sources.json): each source's seconds in run 50, whether the
// model read it from the cache, and whether it listed a night tonight. Assumptions, each named:
//   - A reader's every read costs its run-50 seconds (conservative: a 304 is faster).
//   - A model page's first read of the day costs its run-50 seconds; later reads that day are an
//     unchanged page, a conditional GET and the extraction cache: MODEL_UNCHANGED_SECONDS
//     (run 50's seven cached pages took 1 to 25 s, median 6).
//   - Each run pays FIXED_SECONDS outside the sources: job setup and checks (28 s before the ingest
//     step and 2 s after it in run 50),
//     seeding and retired sources (8 s), and the steps after (dedupe, placing, place IDs, pruning:
//     16 s in run 50) plus summaries of changed listings (run 50 wrote 41 cold, 88 s; an hourly run
//     rewrites few). GitHub bills each job in whole minutes, rounded up.
//
// Usage: pnpm eval:refresh [--day 2026-10-06] [--reader <minutes>] [--model <minutes>] [--fixed <s>]
//   --reader and --model replace config/refresh.ts's cadences, --fixed the per-run seconds, to size
//   an alternative.

import { readFileSync } from "node:fs";
import path from "node:path";

import { REFRESH, type RefreshCadence } from "@/config/refresh";
import { isDue, nextHarvestAt, timeBoxSpent, type ReadBy } from "@/src/domain/refresh";

const ZONE = "America/New_York";
const MODEL_UNCHANGED_SECONDS = 10;
const FIXED_SECONDS = 30 + 8 + 16 + 30;
/** The UTC hours of .github/workflows/ingest.yml's cron, minute 17. */
const CRON_HOURS = [14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 0, 1, 2, 3, 4, 5, 6];

interface Measured {
  url: string;
  readBy: ReadBy;
  seconds: number;
  cachedInRun50: boolean;
  listsTonight: boolean;
}

export interface RunEstimate {
  start: Date;
  due: number;
  read: number;
  deferred: number;
  seconds: number;
  billedMinutes: number;
}

/** The day's runs (UTC dates of the 17 cron times from `day`'s 14:17 UTC), state carried in `next`. */
export function replayDay(
  sources: readonly Measured[],
  day: string,
  next: Map<string, Date | null>,
  readToday: Set<string>,
  cadence: RefreshCadence = REFRESH,
  fixedSeconds = FIXED_SECONDS,
): RunEstimate[] {
  const out: RunEstimate[] = [];
  for (const hour of CRON_HOURS) {
    const date = new Date(`${day}T00:00:00Z`);
    if (hour < 14) date.setUTCDate(date.getUTCDate() + 1);
    date.setUTCHours(hour, 17);
    const due = sources
      .filter((s) => isDue(next.get(s.url) ?? null, date))
      .sort(
        (a, b) =>
          (next.get(a.url)?.getTime() ?? date.getTime()) -
          (next.get(b.url)?.getTime() ?? date.getTime()),
      );
    let elapsed = 0;
    let read = 0;
    let deferred = 0;
    for (const s of due) {
      if (timeBoxSpent(0, elapsed * 1000, cadence.runTimeBoxMinutes * 60_000)) {
        next.set(s.url, date);
        deferred += 1;
        continue;
      }
      const cold = s.readBy === "reader" || !readToday.has(s.url);
      elapsed += cold ? s.seconds : Math.min(s.seconds, MODEL_UNCHANGED_SECONDS);
      readToday.add(s.url);
      read += 1;
      next.set(
        s.url,
        nextHarvestAt({
          runStart: date,
          readBy: s.readBy,
          listsTonight: s.listsTonight,
          zone: ZONE,
          cadence,
        }),
      );
    }
    const seconds = elapsed + fixedSeconds;
    out.push({
      start: date,
      due: due.length,
      read,
      deferred,
      seconds,
      billedMinutes: Math.ceil(seconds / 60),
    });
  }
  return out;
}

function main() {
  const file = path.join(process.cwd(), "evals/refresh/run50-sources.json");
  const { sources } = JSON.parse(readFileSync(file, "utf8")) as { sources: Measured[] };
  const dayArg = process.argv.indexOf("--day");
  const day = dayArg > 0 ? process.argv[dayArg + 1]! : "2026-10-06";
  const minutes = (flag: string, fallback: number) => {
    const i = process.argv.indexOf(flag);
    return i > 0 ? Number(process.argv[i + 1]) : fallback;
  };
  const cadence: RefreshCadence = {
    ...REFRESH,
    readerEveryMinutes: minutes("--reader", REFRESH.readerEveryMinutes),
    modelEveryMinutes: minutes("--model", REFRESH.modelEveryMinutes),
  };
  // A first day from nothing read, then the day reported: its state is the steady one.
  const before = new Date(`${day}T00:00:00Z`);
  before.setUTCDate(before.getUTCDate() - 1);
  const next = new Map<string, Date | null>();
  replayDay(
    sources,
    before.toISOString().slice(0, 10),
    next,
    new Set(),
    cadence,
    minutes("--fixed", FIXED_SECONDS),
  );
  const runs = replayDay(sources, day, next, new Set(), cadence, minutes("--fixed", FIXED_SECONDS));
  const fmt = (d: Date) =>
    d.toLocaleTimeString("en-US", { timeZone: ZONE, hour: "numeric", minute: "2-digit" });
  console.log(
    `Replay of ${day}: ${sources.length} sources (run 50), ${runs.length} runs; readers every ${cadence.readerEveryMinutes} min, model pages every ${cadence.modelEveryMinutes} min, day-of every ${cadence.dayOfEveryMinutes} min.`,
  );
  console.log("ET        due  read  deferred  seconds  billed min");
  for (const r of runs) {
    console.log(
      `${fmt(r.start).padEnd(9)} ${String(r.due).padStart(4)} ${String(r.read).padStart(5)} ${String(r.deferred).padStart(9)} ${String(Math.round(r.seconds)).padStart(8)} ${String(r.billedMinutes).padStart(11)}`,
    );
  }
  const billed = runs.reduce((n, r) => n + r.billedMinutes, 0);
  const reads = runs.reduce((n, r) => n + r.read, 0);
  const sorted = runs.map((r) => r.read).sort((a, b) => a - b);
  console.log(
    `Day: ${reads} source reads, median ${sorted[Math.floor(sorted.length / 2)]} a run; ${billed} billed minutes. Month (x30): ${billed * 30}.`,
  );
}

if (process.argv[1]?.endsWith("replay.ts")) main();
