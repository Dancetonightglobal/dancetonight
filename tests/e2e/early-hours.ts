// The early-hours rule (D-518): before 06:00 in New York the home page may open last night
// ("Last night near New York"), because the mock seed is rebuilt around the server's clock. Since
// D-823 the run pins that clock to an afternoon, so the skip only fires in a run that is not pinned;
// the rule itself is covered by the unit tests of src/ui/home/home-query.ts and src/domain/tonight.ts.

import { test } from "@playwright/test";

import { isEarlyHours } from "@/src/domain/tonight";

/**
 * The clock the server reads (D-823): playwright.config.ts pins DANCETONIGHT_MOCK_NOW to 14:00 New
 * York for the workers and the web server, so tests compute dates from the same instant.
 */
export function e2eNow(): Date {
  const pinned = process.env.DANCETONIGHT_MOCK_NOW;
  return pinned ? new Date(pinned) : new Date();
}

/** Skips the calling test while the New York seed is in its early hours (never, once pinned). */
export function skipInEarlyHours(): void {
  test.skip(
    isEarlyHours(e2eNow(), "America/New_York"),
    "D-518: before 06:00 New York the home page may open last night",
  );
}
