// How often each source is read (D-088). The cadence rules in src/domain/refresh.ts read only
// these. The ingest runs hourly (.github/workflows/ingest.yml); each run reads only the sources
// that are due, and sets each source's next time when it finishes with it.

export interface RefreshCadence {
  /** A source read without a model (iCalendar, Google Calendar, JSON-LD, Squarespace, The Events
   * Calendar, ticketing and platform APIs, the New York Tango file): every 2 hours. */
  readerEveryMinutes: number;
  /** A page the model reads: every 6 hours. A conditional GET and the extraction cache make an
   * unchanged page nearly free, so the cadence bounds run time, not neurons. */
  modelEveryMinutes: number;
  /** Day-of freshness: a source with a listing tonight is read this often... */
  dayOfEveryMinutes: number;
  /** ...from this local hour of the night's date (15 = 3pm)... */
  dayOfFromHour: number;
  /** ...until this local hour (24 = midnight that ends the evening), in the metro's zone. */
  dayOfUntilHour: number;
  /**
   * Taken off every next time, counted from the run's hour (src/domain/refresh.ts), so a source
   * due "in an hour" is due in the next hourly run whatever minute GitHub starts it (GitHub starts
   * scheduled runs late, and late by different amounts). Less than an hour, or a source would be
   * read twice in one.
   */
  graceMinutes: number;
  /**
   * Wall-clock time one scheduled run spends reading sources; a source still due when it is spent
   * is deferred to the next run, first in its queue. A forced full read has no time box.
   */
  runTimeBoxMinutes: number;
  /**
   * Wall-clock time a full read spends starting sources; the rest are deferred, first in the next
   * run (D-159).
   */
  fullReadTimeBoxMinutes: number;
  /** Sources read at once in step 3 of a run; requests to one domain still go one at a time, 5 s
   * apart (D-160). */
  harvestConcurrency: number;
}

export const REFRESH: RefreshCadence = {
  readerEveryMinutes: 120,
  modelEveryMinutes: 360,
  dayOfEveryMinutes: 60,
  dayOfFromHour: 15,
  dayOfUntilHour: 24,
  graceMinutes: 20,
  runTimeBoxMinutes: 8,
  fullReadTimeBoxMinutes: 70,
  harvestConcurrency: 4,
};
