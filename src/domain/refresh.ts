// When a source is next read (D-088). Pure: no I/O, no process zone.
//
//   due(source, run)       = next_harvest_at is null, or next_harvest_at <= the run's start
//   slot(run)              = the run's start, down to the hour (the 2:17pm run, started at 2:40
//                            because GitHub was late, is the 2pm slot), so a late start does not
//                            push every source it reads a whole run later
//   next(source, run)      = the earlier of
//                              slot + cadence - grace           (2h for a reader, 6h for the model)
//                              the day-of time, when the source lists a night tonight:
//                                slot + 1h - grace, no earlier than 3pm local on tonight's date,
//                                and only while slot + 1h is before midnight local
//
// "Tonight" is `currentNightDate` (src/domain/tonight.ts), so a run at 1am reads the night that is
// ending, whose 3pm-to-midnight evening is over: such a run sets no day-of time. Local hours go
// through `localInstant`, so a DST night's 3pm and midnight are the wall clock's.
//
// A failed source's next time is null (due next run; D-114's markFailed writes it), and a source
// deferred for want of time keeps the run's start (due, and first, next run). Neither is decided
// here.

import { REFRESH, type RefreshCadence } from "@/config/refresh";
import { HOUR_MS, MINUTE_MS, addCalendarDays, localInstant } from "@/src/domain/time";
import { currentNightDate } from "@/src/domain/tonight";

/** How a source was read this run: by a deterministic reader, or by the model. */
export type ReadBy = "reader" | "model";

/** Due in the run that starts at `runStart`: never read, failed, deferred, or its time has come. */
export function isDue(nextHarvestAt: Date | null, runStart: Date): boolean {
  return nextHarvestAt === null || nextHarvestAt.getTime() <= runStart.getTime();
}

/** Tonight's evening in the metro's zone, 3pm to midnight local by default. */
export function dayOfWindow(
  runStart: Date,
  zone: string,
  cadence: RefreshCadence = REFRESH,
): { night: string; start: Date; end: Date } {
  const night = currentNightDate(runStart, zone);
  const start = localInstant(night, zone, cadence.dayOfFromHour);
  const end =
    cadence.dayOfUntilHour >= 24
      ? localInstant(addCalendarDays(night, 1), zone, cadence.dayOfUntilHour - 24)
      : localInstant(night, zone, cadence.dayOfUntilHour);
  return { night, start, end };
}

/** The next time a source finished with in the run that started at `runStart` is due. */
export function nextHarvestAt(args: {
  runStart: Date;
  readBy: ReadBy;
  /** The source has a listed row on tonight's night (stored, whichever run wrote it). */
  listsTonight: boolean;
  zone: string;
  cadence?: RefreshCadence;
}): Date {
  const cadence = args.cadence ?? REFRESH;
  const start = Math.floor(args.runStart.getTime() / HOUR_MS) * HOUR_MS;
  const grace = cadence.graceMinutes * MINUTE_MS;
  const every = args.readBy === "model" ? cadence.modelEveryMinutes : cadence.readerEveryMinutes;
  let next = start + every * MINUTE_MS - grace;
  if (args.listsTonight) {
    const evening = dayOfWindow(args.runStart, args.zone, cadence);
    const nominal = start + cadence.dayOfEveryMinutes * MINUTE_MS;
    if (nominal < evening.end.getTime()) {
      next = Math.min(next, Math.max(nominal - grace, evening.start.getTime()));
    }
  }
  return new Date(next);
}

/** True once a run that started at `startedMs` has used its time box (wall clock, ms). */
export function timeBoxSpent(startedMs: number, nowMs: number, boxMs: number | null): boolean {
  return boxMs !== null && nowMs - startedMs >= boxMs;
}
