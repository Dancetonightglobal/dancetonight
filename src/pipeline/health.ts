// A source's failure streak, said in the run's report (audit of 2026-09-29, TWIS F1: the counter
// was written and never read). Report only: nothing here retires, hides or disables anything.
// Retirement stays a hand edit (D-047) and a stored row goes only after a whole read (D-070), so a
// source that answers 403 keeps its rows listed and is tried again next run; the owner is told.

import type { SourceHealth } from "@/src/db/schema/sources";
import { formatCalendarDate, formatTime, localDateOf } from "@/src/domain/time";

/** The owner reads the report in Eastern Time (CLAUDE.md, "Working with the owner"). */
export const REPORT_TZ = "America/New_York";

export interface FailingSource {
  url: string;
  /** Runs in a row that failed, this one included. */
  failures: number;
  /** When this streak began; null when it began before the field was kept. */
  since: string | null;
  /** The last run that did not fail; null when none has. */
  lastGoodAt: string | null;
  lastError: string | null;
  /** Its listed rows, tonight to the window's end. */
  listed: number;
  /** Of `listed`, the rows no other source lists. */
  alone: number;
  lastNight: string | null;
  /** When it last confirmed any of them. */
  lastSeenAt: string | null;
}

export function failingSource(
  url: string,
  health: SourceHealth,
  stored: { listed: number; alone: number; lastNight: string | null; lastSeenAt: Date | null },
): FailingSource {
  return {
    url,
    failures: health.consecutiveFailures ?? 0,
    since: health.failingSince ?? null,
    lastGoodAt: health.lastSuccessAt ?? null,
    lastError: health.lastError ?? null,
    listed: stored.listed,
    alone: stored.alone,
    lastNight: stored.lastNight,
    lastSeenAt: stored.lastSeenAt?.toISOString() ?? null,
  };
}

/** "Tue, Sep 29, 9:14am ET". */
export function reportInstant(iso: string): string {
  const at = new Date(iso);
  return `${formatCalendarDate(localDateOf(at, REPORT_TZ))}, ${formatTime(at, REPORT_TZ)} ET`;
}

/**
 * "failed 3 runs in a row, since Wed, Sep 30, 7:17am ET; last good run Tue, Sep 29, 9:14am ET.
 * Its 16 listings, tonight to Mon, Oct 12, stay listed (12 from it alone), not re-checked since
 * Tue, Sep 29, 9:14am ET; it adds nothing new until a read succeeds."
 */
export function failureStreakNote(f: FailingSource): string {
  const since = f.since === null ? "" : `, since ${reportInstant(f.since)}`;
  const runs = f.failures <= 1 ? "failed this run" : `failed ${f.failures} runs in a row${since}`;
  const good = f.lastGoodAt === null ? "never" : reportInstant(f.lastGoodAt);
  const head = `${runs}; last good run ${good}.`;
  if (f.listed === 0 || f.lastNight === null)
    return `${head} None of its listings are stored for tonight on.`;
  const checked =
    f.lastSeenAt === null ? "" : `, not re-checked since ${reportInstant(f.lastSeenAt)}`;
  const listings = f.listed === 1 ? "1 listing" : `${f.listed} listings`;
  return `${head} Its ${listings}, tonight to ${formatCalendarDate(f.lastNight)}, stay listed (${f.alone} from it alone)${checked}; it adds nothing new until a read succeeds.`;
}
