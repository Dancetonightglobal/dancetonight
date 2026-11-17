// The app clock (D-823): mock mode may pin "now" with DANCETONIGHT_MOCK_NOW so the e2e suite reads
// one fixed afternoon in New York, whatever hour CI runs. Every other mode reads the real clock.
// See also D-011 for mock mode.

import { isMockMode } from "@/src/config/env";
import { localDateOf, localInstant } from "@/src/domain/time";

export const MOCK_NOW_VAR = "DANCETONIGHT_MOCK_NOW";

/**
 * Parse the pinned instant when mock mode is active.
 * @param value The value of DANCETONIGHT_MOCK_NOW environment variable
 * @param mock Whether mock mode is active
 * @returns The pinned Date, or null if not set or mock is false
 * @throws Error if the value is invalid
 */
export function pinnedNow(value: string | undefined, mock: boolean): Date | null {
  if (!mock) {
    return null;
  }
  if (value === undefined) {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed === "") {
    return null;
  }

  // Validate format with regex
  const isoRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;
  if (!isoRegex.test(trimmed)) {
    throw new Error(`DANCETONIGHT_MOCK_NOW is not an ISO instant with a zone: "${trimmed}"`);
  }

  // Validate date
  const date = new Date(trimmed);
  if (isNaN(date.getTime())) {
    throw new Error(`DANCETONIGHT_MOCK_NOW is not an ISO instant with a zone: "${trimmed}"`);
  }

  // Validate calendar date (first 10 characters)
  const datePart = trimmed.slice(0, 10);
  const probe = new Date(datePart + "T00:00:00Z");
  const probeDatePart = probe.toISOString().slice(0, 10);
  if (probeDatePart !== datePart) {
    throw new Error(`DANCETONIGHT_MOCK_NOW is not an ISO instant with a zone: "${trimmed}"`);
  }

  return date;
}

/**
 * Get the current time, respecting the mock pin when in mock mode.
 * @param mock Whether mock mode is active (defaults to isMockMode())
 * @returns A fresh Date object
 */
export function appNow(mock?: boolean): Date {
  const isMock = mock ?? isMockMode();
  const value = process.env[MOCK_NOW_VAR];
  const pinned = pinnedNow(value, isMock);
  if (pinned !== null) {
    return new Date(pinned.getTime());
  }
  return new Date();
}

/**
 * Compute the ISO instant pinned for e2e tests: a specific hour on the calendar date of the real instant.
 * @param real The real current time
 * @param zone The time zone (default "America/New_York")
 * @param hour The hour of the day (default 14)
 * @returns ISO string of the pinned instant
 */
export function e2ePinnedInstant(real: Date, zone = "America/New_York", hour = 14): string {
  const date = localDateOf(real, zone);
  const instant = localInstant(date, zone, hour);
  return instant.toISOString();
}
