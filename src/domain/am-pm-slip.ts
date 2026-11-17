// D-812: a morning start whose own end is more than 12 hours later is an am/pm slip.
// Examples: golatindance printed "7:40 am - 8:40 pm" for a Thursday evening class,
// district.in printed "8:00 AM - Sat 14 Nov 1:30 AM" for an 8pm club night.
// This moves such a start to the same clock time in the evening.

const SLIP_EARLIEST_MINUTES = 360; // 06:00
const SLIP_LATEST_MINUTES = 540; // 09:00
const SLIP_MIN_SPAN_MINUTES = 720; // 12 hours
const NOON_MINUTES = 720;
const MORNING_SOCIAL_MIN_SPAN_MINUTES = 240; // D-883: a 3-hour 6-9am day-break party stays in the morning
const DAY_MINUTES = 24 * 60;

export type NightTimes = { doors: string | null; lesson: string | null; dancing: string | null };

/** "HH:MM" as minutes since midnight. */
function toMinutes(time: string): number {
  const [h = 0, m = 0] = time.split(":").map(Number);
  return h * 60 + m;
}

function plusTwelveHours(time: string | null): string | null {
  if (time === null) return null;
  const total = toMinutes(time) + NOON_MINUTES;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * The night's times read as the evening when a 06:00-09:00 start's own end is over 12 hours later; else null.
 * D-816: with `nightTitle` (the title calls it a night, party or social), exactly 12 hours is a slip too
 * (Tokyo "Latin Night at Egoland, Starts at 8am until 8pm"); its end is then dropped (`dropEnd`), since
 * "8pm" was the start.
 */
export function amPmSlip(
  t: NightTimes & { end: string | null; nightTitle?: boolean; eveningTitle?: boolean },
): (NightTimes & { dropEnd?: true; end?: string | null }) | null {
  if (t.end === null) return null;
  const stated = [t.doors, t.lesson, t.dancing].filter((x): x is string => x !== null);
  if (stated.length === 0) return null;

  const minutes = stated.map(toMinutes);
  const earliest = Math.min(...minutes);
  if (earliest < SLIP_EARLIEST_MINUTES || earliest >= SLIP_LATEST_MINUTES) return null;
  // An afternoon time on the night means the morning one is not a slip.
  if (minutes.some((m) => m >= NOON_MINUTES)) return null;

  let end = toMinutes(t.end);
  // D-883: a weekly or night-titled social printed wholly in the morning, 4 hours or more and over by noon, is the
  // evening (londonsalsaevents.uk "Bailando Thursdays" 07:00-11:30 beside social-dance.today's 19:30-23:30).
  if (
    t.eveningTitle === true &&
    end > earliest &&
    end <= NOON_MINUTES &&
    end - earliest >= MORNING_SOCIAL_MIN_SPAN_MINUTES
  ) {
    return {
      doors: plusTwelveHours(t.doors),
      lesson: plusTwelveHours(t.lesson),
      dancing: plusTwelveHours(t.dancing),
      end: plusTwelveHours(t.end),
    };
  }
  if (end < earliest) end += DAY_MINUTES; // the next morning
  const span = end - earliest;
  const exactNight = span === SLIP_MIN_SPAN_MINUTES && t.nightTitle === true;
  if (span <= SLIP_MIN_SPAN_MINUTES && !exactNight) return null;
  if (exactNight) {
    return {
      doors: plusTwelveHours(t.doors),
      lesson: plusTwelveHours(t.lesson),
      dancing: plusTwelveHours(t.dancing),
      dropEnd: true,
    };
  }

  return {
    doors: plusTwelveHours(t.doors),
    lesson: plusTwelveHours(t.lesson),
    dancing: plusTwelveHours(t.dancing),
  };
}
