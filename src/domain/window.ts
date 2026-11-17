// The ingest's window of nights (SPEC section 3), in a module of its own that imports nothing.
//
// It lives here, not in recurrence.ts, because the home page's rule for which nights open
// (isOpenableNight in tonight.ts) needs it, and tonight.ts reaches the browser: the detail page's
// map is a client component whose import graph runs through the home header to tonight.ts.
// recurrence.ts imports rrule-temporal, which does not declare itself free of side effects, so
// importing even a constant from it would put the whole recurrence library (about 48 KB gzip,
// measured) in that client bundle. recurrence.ts re-exports this constant for the pipeline and the
// adapters; tonight.ts imports it from here and never from recurrence.ts. Keep this file free of
// imports.

/** The count of nights a nightly materialization covers: tonight through tonight + 13. */
export const MATERIALIZE_DAYS = 14;
