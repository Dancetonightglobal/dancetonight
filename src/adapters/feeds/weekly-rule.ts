// Shared helper for building a weekly recurrence from stated days (D-513).
import { UNTIMED_RULE_ANCHOR, type HarvestedRecurrence } from "@/src/adapters/types";
import { WEEKDAYS, type Weekday } from "@/src/domain/recurrence";
import { addCalendarDays } from "@/src/domain/time";

/** Return the weekday of a night (YYYY-MM-DD) as "MO".."SU". */
export function weekdayOfNight(night: string): Weekday {
  const [y, m, d] = night.split("-").map(Number);
  return WEEKDAYS[(new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay() + 6) % 7]!;
}

/** Build a weekly recurrence for the given days, night and optional time. */
export function weeklyRecurrence(
  days: readonly Weekday[],
  night: string,
  time: string | null,
): HarvestedRecurrence {
  if (days.length === 0) throw new Error("weeklyRecurrence: no days");
  const byDay = WEEKDAYS.filter((w) => days.includes(w)).join(",");
  if (time !== null) {
    return {
      rrule: `FREQ=WEEKLY;BYDAY=${byDay}`,
      dtstartLocal: `${night}T${time}`,
      exdates: [],
    };
  }
  return {
    rrule: `FREQ=WEEKLY;BYDAY=${byDay}`,
    dtstartLocal: `${night}T${UNTIMED_RULE_ANCHOR}`,
    exdates: [],
    timeListed: false,
  };
}

/** First date on or after fromNight whose weekday is in days, looking up to 7 days ahead. */
export function firstNightOn(days: readonly Weekday[], fromNight: string): string | null {
  if (days.length === 0) return null;
  for (let offset = 0; offset < 7; offset++) {
    const candidate = addCalendarDays(fromNight, offset);
    if (days.includes(weekdayOfNight(candidate))) return candidate;
  }
  return null;
}
