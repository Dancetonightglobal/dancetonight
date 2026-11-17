// D-827: a fixed night can be monthly on given weeks of the month
// Egoland Bar Akihabara's "Akihabara Salsa" is on the 2nd and 4th Wednesday.

import { type Weekday, WEEKDAYS } from "@/src/domain/recurrence";
import { UNTIMED_RULE_ANCHOR, type HarvestedRecurrence } from "@/src/adapters/types";
import { addCalendarDays } from "@/src/domain/time";
import { weekdayOfNight } from "@/src/adapters/feeds/weekly-rule";

/**
 * Determine if a night falls on specified weeks of the month.
 * @param night - ISO date string "YYYY-MM-DD"
 * @param weeks - Array of week numbers (1-5) or -1 for last week
 * @returns True if the night's week number is in weeks, or if weeks includes -1 and it's the last occurrence
 */
export function onWeeksOfMonth(night: string, weeks: readonly number[]): boolean {
  const [, month, day] = night.split("-").map(Number);

  // Calculate week number: Math.ceil(day / 7)
  const weekNumber = Math.ceil(day! / 7);

  // Check if it's the last occurrence: adding 7 days changes the month
  const nextWeek = addCalendarDays(night, 7);
  const [, nextMonth] = nextWeek.split("-").map(Number);
  const isLast = month !== nextMonth;

  // Check if weekNumber is in weeks
  if (weeks.includes(weekNumber)) {
    return true;
  }
  // Check if -1 is in weeks and it's the last occurrence
  if (weeks.includes(-1) && isLast) {
    return true;
  }
  return false;
}

/**
 * Validate weeks array for monthly recurrence.
 * @param weeks - Array of week numbers
 * @returns True if non-empty, all integers in 1..5 or exactly -1, no duplicates
 */
export function validWeeksOfMonth(weeks: readonly number[]): boolean {
  if (weeks.length === 0) return false;

  const seen = new Set<number>();
  for (const week of weeks) {
    // Must be integer
    if (!Number.isInteger(week)) return false;

    // Must be in range 1..5 or exactly -1
    if (week !== -1 && (week < 1 || week > 5)) return false;

    // No duplicates
    if (seen.has(week)) return false;
    seen.add(week);
  }
  return true;
}

/**
 * Find the first night matching days and weeks within 62 days.
 * @param days - Array of weekdays to match
 * @param weeks - Array of week numbers to match
 * @param fromNight - Starting ISO date
 * @returns The first matching night or null if none found within 62 days
 */
export function firstMonthlyNight(
  days: readonly Weekday[],
  weeks: readonly number[],
  fromNight: string,
): string | null {
  if (days.length === 0 || weeks.length === 0) return null;

  for (let offset = 0; offset <= 62; offset++) {
    const candidate = addCalendarDays(fromNight, offset);
    const weekday = weekdayOfNight(candidate);

    if (days.includes(weekday) && onWeeksOfMonth(candidate, weeks)) {
      return candidate;
    }
  }
  return null;
}

/**
 * Generate a monthly recurrence rule.
 * @param days - Array of weekdays
 * @param weeks - Array of week numbers
 * @param night - Anchor night ISO date
 * @param time - Time string or null for untimed
 * @returns HarvestedRecurrence object
 * @throws Error if days or weeks is empty
 */
export function monthlyRecurrence(
  days: readonly Weekday[],
  weeks: readonly number[],
  night: string,
  time: string | null,
): HarvestedRecurrence {
  if (days.length === 0 || weeks.length === 0) {
    throw new Error("monthlyRecurrence: days and weeks must be non-empty");
  }

  // Sort weeks: ascending with -1 last
  const sortedWeeks = [...weeks].sort((a, b) => {
    if (a === -1) return 1;
    if (b === -1) return -1;
    return a - b;
  });

  // Sort days according to WEEKDAYS order
  const sortedDays = [...days].sort((a, b) => WEEKDAYS.indexOf(a) - WEEKDAYS.indexOf(b));

  // Build BYDAY parts
  const byDayParts: string[] = [];
  for (const week of sortedWeeks) {
    for (const day of sortedDays) {
      byDayParts.push(`${week}${day}`);
    }
  }
  const byDay = byDayParts.join(",");

  const rrule = `FREQ=MONTHLY;BYDAY=${byDay}`;

  if (time !== null) {
    return {
      rrule,
      dtstartLocal: `${night}T${time}`,
      exdates: [],
    };
  }

  return {
    rrule,
    dtstartLocal: `${night}T${UNTIMED_RULE_ANCHOR}`,
    exdates: [],
    timeListed: false,
  };
}
