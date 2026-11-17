import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { MATERIALIZE_DAYS as RECURRENCE_MATERIALIZE_DAYS } from "@/src/domain/recurrence";
import { HOUR_MS, MINUTE_MS, addCalendarDays } from "@/src/domain/time";
import {
  DAY_PICKER_LENGTH,
  DEFAULT_DURATION_MS,
  MAX_PICKER_NIGHTS,
  OPENABLE_NIGHTS,
  currentNightDate,
  dayPicker,
  effectiveEnd,
  formatDayLabel,
  isInProgress,
  isOnNight,
  isOpenableNight,
  isTonight,
  listingNightDate,
  liveStatus,
  nightDate,
  nightWindow,
  pickerLength,
  startsAt,
  type ListingType,
  type TimedListing,
} from "@/src/domain/tonight";
import { MATERIALIZE_DAYS } from "@/src/domain/window";
import { t } from "@/src/i18n";
import { describeInProcessZones } from "./processZone";

const NY = "America/New_York";
const SYD = "Australia/Sydney";
const KOL = "Asia/Kolkata";
const PHX = "America/Phoenix";

const utc = (iso: string) => new Date(iso);

function social(startsAtIso: string, endsAtIso: string | null = null): TimedListing {
  return {
    startsAt: utc(startsAtIso),
    endsAt: endsAtIso === null ? null : utc(endsAtIso),
    listingType: "social",
  };
}

/** A listing whose source gives its night and no time (D-060). */
function untimed(
  night: string,
  endsAtIso: string | null = null,
  zone: string = NY,
  listingType: ListingType = "social",
): TimedListing {
  return {
    startsAt: null,
    endsAt: endsAtIso === null ? null : utc(endsAtIso),
    listingType,
    nightDate: night,
    tz: zone,
  };
}

describeInProcessZones("nightDate (D-004)", () => {
  it("6am local is the boundary: 5:59 belongs to the night before, 6:00 to the new day", () => {
    // 2026-09-21 is EDT (UTC-4).
    expect(nightDate(utc("2026-09-21T09:59:00Z"), NY)).toBe("2026-09-20"); // 05:59 local
    expect(nightDate(utc("2026-09-21T09:59:59.999Z"), NY)).toBe("2026-09-20");
    expect(nightDate(utc("2026-09-21T10:00:00Z"), NY)).toBe("2026-09-21"); // 06:00 local
  });

  it("a 1am set belongs to the previous night", () => {
    // Sunday 2026-09-20 01:00 EDT is Saturday night.
    expect(nightDate(utc("2026-09-20T05:00:00Z"), NY)).toBe("2026-09-19");
  });

  it("accepts a millisecond timestamp as well as a Date", () => {
    expect(nightDate(Date.parse("2026-09-20T05:00:00Z"), NY)).toBe("2026-09-19");
  });

  it("rejects an unknown zone", () => {
    expect(() => nightDate(utc("2026-09-20T05:00:00Z"), "Mars/Olympus")).toThrow();
  });

  it("Australia/Sydney (southern hemisphere, UTC+10 in September)", () => {
    expect(nightDate(utc("2026-09-25T15:00:00Z"), SYD)).toBe("2026-09-25"); // Sat 01:00 AEST
    expect(nightDate(utc("2026-09-25T19:59:00Z"), SYD)).toBe("2026-09-25"); // Sat 05:59 AEST
    expect(nightDate(utc("2026-09-25T20:00:00Z"), SYD)).toBe("2026-09-26"); // Sat 06:00 AEST
  });

  it("Asia/Kolkata (half-hour zone, UTC+5:30)", () => {
    expect(nightDate(utc("2026-09-22T00:29:00Z"), KOL)).toBe("2026-09-21"); // 05:59 IST
    expect(nightDate(utc("2026-09-22T00:30:00Z"), KOL)).toBe("2026-09-22"); // 06:00 IST
    expect(nightDate(utc("2026-09-21T19:30:00Z"), KOL)).toBe("2026-09-21"); // 01:00 IST Sep 22
  });

  it("America/Phoenix (no DST, UTC-7 all year) on the US spring-forward date", () => {
    expect(nightDate(utc("2026-03-08T09:30:00Z"), PHX)).toBe("2026-03-07"); // 02:30 MST
    expect(nightDate(utc("2026-03-08T13:00:00Z"), PHX)).toBe("2026-03-08"); // 06:00 MST
  });

  it("New York spring forward 2026-03-08: 3:30am EDT (just after the gap) is still Saturday night", () => {
    expect(nightDate(utc("2026-03-08T07:30:00Z"), NY)).toBe("2026-03-07");
    expect(nightDate(utc("2026-03-08T10:00:00Z"), NY)).toBe("2026-03-08"); // 06:00 EDT
    expect(nightDate(utc("2026-03-08T09:59:00Z"), NY)).toBe("2026-03-07"); // 05:59 EDT
  });

  it("New York fall back 2026-11-01: both 1:30ams belong to Saturday night", () => {
    expect(nightDate(utc("2026-11-01T05:30:00Z"), NY)).toBe("2026-10-31"); // 01:30 EDT
    expect(nightDate(utc("2026-11-01T06:30:00Z"), NY)).toBe("2026-10-31"); // 01:30 EST
    expect(nightDate(utc("2026-11-01T10:59:00Z"), NY)).toBe("2026-10-31"); // 05:59 EST
    expect(nightDate(utc("2026-11-01T11:00:00Z"), NY)).toBe("2026-11-01"); // 06:00 EST
  });

  it("goes by the local 6am wall clock on DST nights, not six real hours", () => {
    // Fall back: 05:30 EST is 10:30Z; six real hours earlier is 00:30 EDT on Nov 1, but the
    // clock on the wall still reads before six, so it is Saturday night.
    expect(nightDate(utc("2026-11-01T10:30:00Z"), NY)).toBe("2026-10-31");
    // Spring forward: 06:30 EDT is 10:30Z; six real hours earlier is 23:30 EST on Mar 7, but
    // the clock reads past six, so it is Sunday.
    expect(nightDate(utc("2026-03-08T10:30:00Z"), NY)).toBe("2026-03-08");
  });
});

describeInProcessZones("currentNightDate", () => {
  it("before 6am is the night that is ending", () => {
    expect(currentNightDate(utc("2026-09-21T07:00:00Z"), NY)).toBe("2026-09-20"); // 03:00 EDT
    expect(currentNightDate(utc("2026-09-21T23:00:00Z"), NY)).toBe("2026-09-21"); // 19:00 EDT
  });
});

describeInProcessZones("nightWindow", () => {
  it("runs from D 06:00 to D+1 05:59:59.999 local", () => {
    const w = nightWindow("2026-09-21", NY);
    expect(w.start.toISOString()).toBe("2026-09-21T10:00:00.000Z");
    expect(w.end.toISOString()).toBe("2026-09-22T09:59:59.999Z");
  });

  it("is 23 hours on the New York spring-forward night (2026-03-07)", () => {
    const w = nightWindow("2026-03-07", NY);
    expect(w.start.toISOString()).toBe("2026-03-07T11:00:00.000Z"); // 06:00 EST
    expect(w.end.toISOString()).toBe("2026-03-08T09:59:59.999Z"); // 05:59:59.999 EDT
    expect(w.end.getTime() - w.start.getTime() + 1).toBe(23 * HOUR_MS);
  });

  it("is 25 hours on the New York fall-back night (2026-10-31)", () => {
    const w = nightWindow("2026-10-31", NY);
    expect(w.start.toISOString()).toBe("2026-10-31T10:00:00.000Z"); // 06:00 EDT
    expect(w.end.toISOString()).toBe("2026-11-01T10:59:59.999Z"); // 05:59:59.999 EST
    expect(w.end.getTime() - w.start.getTime() + 1).toBe(25 * HOUR_MS);
  });

  it("is 24 hours in America/Phoenix on the same dates", () => {
    for (const d of ["2026-03-07", "2026-10-31"]) {
      const w = nightWindow(d, PHX);
      expect(w.end.getTime() - w.start.getTime() + 1).toBe(24 * HOUR_MS);
    }
    expect(nightWindow("2026-03-07", PHX).start.toISOString()).toBe("2026-03-07T13:00:00.000Z");
  });

  it("is 23 hours on the Sydney DST start night (2026-10-03)", () => {
    const w = nightWindow("2026-10-03", SYD);
    expect(w.start.toISOString()).toBe("2026-10-02T20:00:00.000Z"); // 06:00 AEST
    expect(w.end.toISOString()).toBe("2026-10-03T18:59:59.999Z"); // 05:59:59.999 AEDT
    expect(w.end.getTime() - w.start.getTime() + 1).toBe(23 * HOUR_MS);
  });

  it("uses the half-hour offset in Kolkata", () => {
    const w = nightWindow("2026-09-21", KOL);
    expect(w.start.toISOString()).toBe("2026-09-21T00:30:00.000Z");
    expect(w.end.toISOString()).toBe("2026-09-22T00:29:59.999Z");
  });

  it("every instant in the window has that night date, and the neighbours do not", () => {
    for (const [d, zone] of [
      ["2026-03-07", NY],
      ["2026-10-31", NY],
      ["2026-09-21", KOL],
    ] as const) {
      const w = nightWindow(d, zone);
      expect(nightDate(w.start, zone)).toBe(d);
      expect(nightDate(w.end, zone)).toBe(d);
      expect(nightDate(w.start.getTime() - 1, zone)).not.toBe(d);
      expect(nightDate(w.end.getTime() + 1, zone)).not.toBe(d);
    }
  });

  it("rejects a malformed or impossible date", () => {
    expect(() => nightWindow("2026-9-21", NY)).toThrow();
    expect(() => nightWindow("2026-02-30", NY)).toThrow();
  });
});

describe("startsAt", () => {
  const doors = utc("2026-09-21T23:00:00Z");
  const lesson = utc("2026-09-22T00:00:00Z");
  const dancing = utc("2026-09-22T01:00:00Z");

  it("is coalesce(dancing, lesson, doors)", () => {
    expect(startsAt({ doorsAt: doors, lessonAt: lesson, dancingAt: dancing })).toBe(dancing);
    expect(startsAt({ doorsAt: doors, lessonAt: lesson, dancingAt: null })).toBe(lesson);
    expect(startsAt({ doorsAt: doors, lessonAt: null, dancingAt: null })).toBe(doors);
  });

  it("is null when nothing is listed", () => {
    expect(startsAt({ doorsAt: null, lessonAt: null, dancingAt: null })).toBeNull();
  });
});

describe("effectiveEnd", () => {
  const start = utc("2026-09-22T01:00:00Z");

  it("uses the listed end when present", () => {
    const end = utc("2026-09-22T05:00:00Z");
    expect(effectiveEnd({ startsAt: start, endsAt: end, listingType: "class" })).toEqual({
      end,
      endNotListed: false,
    });
  });

  it("a class with no end gets 90 minutes and endNotListed", () => {
    const r = effectiveEnd({ startsAt: start, endsAt: null, listingType: "class" });
    expect(r.endNotListed).toBe(true);
    expect(r.end.getTime() - start.getTime()).toBe(90 * MINUTE_MS);
  });

  it("a social gets 4 hours, a club night 6 hours", () => {
    expect(
      effectiveEnd({ startsAt: start, endsAt: null, listingType: "social" }).end.getTime() -
        start.getTime(),
    ).toBe(4 * HOUR_MS);
    expect(
      effectiveEnd({ startsAt: start, endsAt: null, listingType: "club_night" }).end.getTime() -
        start.getTime(),
    ).toBe(6 * HOUR_MS);
  });

  it("a venue open night ends at closing time when known, else 4 hours", () => {
    const closing = utc("2026-09-22T06:00:00Z");
    expect(
      effectiveEnd({
        startsAt: start,
        endsAt: null,
        listingType: "venue_open_night",
        closingAt: closing,
      }),
    ).toEqual({ end: closing, endNotListed: false });
    const r = effectiveEnd({
      startsAt: start,
      endsAt: null,
      listingType: "venue_open_night",
      closingAt: null,
    });
    expect(r.endNotListed).toBe(true);
    expect(r.end.getTime() - start.getTime()).toBe(4 * HOUR_MS);
  });

  it("a listed end wins over closing time", () => {
    const end = utc("2026-09-22T03:00:00Z");
    const closing = utc("2026-09-22T06:00:00Z");
    expect(
      effectiveEnd({
        startsAt: start,
        endsAt: end,
        listingType: "venue_open_night",
        closingAt: closing,
      }).end,
    ).toBe(end);
  });

  it("has a default for every listing type", () => {
    for (const [type, ms] of Object.entries(DEFAULT_DURATION_MS)) {
      expect(ms).toBeGreaterThan(0);
      const r = effectiveEnd({ startsAt: start, endsAt: null, listingType: type as never });
      expect(r.end.getTime() - start.getTime()).toBe(ms);
    }
  });
});

describeInProcessZones("isTonight", () => {
  // Sunday 2026-09-20 01:00 EDT, a social with no listed end (ends 05:00 by default).
  const oneAm = social("2026-09-20T05:00:00Z");

  it("a 1am start is tonight on Saturday evening, before it begins", () => {
    expect(isTonight(oneAm, utc("2026-09-20T03:00:00Z"), NY)).toBe(true); // Sat 23:00 EDT
  });

  it("a 1am start is tonight at 3am while it is on", () => {
    expect(isTonight(oneAm, utc("2026-09-20T07:00:00Z"), NY)).toBe(true); // Sun 03:00 EDT
  });

  it("a 1am start is not tonight after 6am once it has ended", () => {
    expect(isTonight(oneAm, utc("2026-09-20T10:30:00Z"), NY)).toBe(false); // Sun 06:30 EDT
  });

  it("a 1am start is not tonight the evening before its night", () => {
    expect(isTonight(oneAm, utc("2026-09-19T03:00:00Z"), NY)).toBe(false); // Fri 23:00 EDT
  });

  it("anything still in progress after 6am stays tonight", () => {
    const late = social("2026-09-20T05:00:00Z", "2026-09-20T09:30:00Z"); // 01:00 to 05:30 EDT
    expect(isTonight(late, utc("2026-09-20T10:15:00Z"), NY)).toBe(false); // 06:15, ended
    const afterHours = social("2026-09-20T05:00:00Z", "2026-09-20T11:00:00Z"); // until 07:00 EDT
    expect(isTonight(afterHours, utc("2026-09-20T10:15:00Z"), NY)).toBe(true); // 06:15, on
    expect(isInProgress(afterHours, utc("2026-09-20T10:15:00Z"))).toBe(true);
  });

  it("an ended listing on the current night date is not tonight", () => {
    const afternoonClass: TimedListing = {
      startsAt: utc("2026-09-21T18:00:00Z"), // 14:00 EDT
      endsAt: null,
      listingType: "class",
    };
    expect(isTonight(afternoonClass, utc("2026-09-21T17:00:00Z"), NY)).toBe(true);
    expect(isTonight(afternoonClass, utc("2026-09-21T19:30:00Z"), NY)).toBe(false); // 90 min later
  });

  it("the end boundary is exclusive and the start boundary counts as tonight", () => {
    const s = social("2026-09-22T01:30:00Z", "2026-09-22T05:00:00Z");
    expect(isTonight(s, utc("2026-09-22T05:00:00Z"), NY)).toBe(false);
    expect(isTonight(s, utc("2026-09-22T04:59:59.999Z"), NY)).toBe(true);
    expect(isTonight(s, utc("2026-09-22T01:30:00Z"), NY)).toBe(true);
  });

  it("the 5:59 / 6:00 boundary decides which night a listing joins", () => {
    const at559 = social("2026-09-21T09:59:00Z", "2026-09-21T12:00:00Z");
    const at600 = social("2026-09-21T10:00:00Z", "2026-09-21T12:00:00Z");
    const eveningBefore = utc("2026-09-21T02:00:00Z"); // Sun 22:00 EDT
    expect(isTonight(at559, eveningBefore, NY)).toBe(true);
    expect(isTonight(at600, eveningBefore, NY)).toBe(false);
  });

  it("a cancelled listing still counts as tonight (it keeps its slot, marked)", () => {
    const s = { ...social("2026-09-22T01:30:00Z", "2026-09-22T05:00:00Z"), cancelled: true };
    expect(isTonight(s, utc("2026-09-21T23:00:00Z"), NY)).toBe(true);
  });

  it("New York spring forward: a social crossing the 2am gap", () => {
    // 01:30 EST to 03:30 EDT on 2026-03-08: one real hour, two on the wall clock.
    const s = social("2026-03-08T06:30:00Z", "2026-03-08T07:30:00Z");
    expect(listingNightDate(s, NY)).toBe("2026-03-07");
    expect(isTonight(s, utc("2026-03-08T02:00:00Z"), NY)).toBe(true); // Sat 21:00 EST
    expect(isTonight(s, utc("2026-03-08T07:00:00Z"), NY)).toBe(true); // 03:00 EDT, on
    expect(isTonight(s, utc("2026-03-08T07:30:00Z"), NY)).toBe(false); // 03:30 EDT, ended
    expect(isTonight(s, utc("2026-03-08T12:00:00Z"), NY)).toBe(false); // Sun 08:00 EDT
  });

  it("New York fall back: a 1:30am start on the repeated hour", () => {
    const firstOneThirty = social("2026-11-01T05:30:00Z"); // 01:30 EDT
    const secondOneThirty = social("2026-11-01T06:30:00Z"); // 01:30 EST
    const saturdayEvening = utc("2026-11-01T01:00:00Z"); // Sat 21:00 EDT
    expect(isTonight(firstOneThirty, saturdayEvening, NY)).toBe(true);
    expect(isTonight(secondOneThirty, saturdayEvening, NY)).toBe(true);
    // 4 h defaults: the first ends 09:30Z (04:30 EST), the second 10:30Z (05:30 EST).
    expect(isTonight(firstOneThirty, utc("2026-11-01T09:00:00Z"), NY)).toBe(true); // 04:00 EST
    expect(isTonight(secondOneThirty, utc("2026-11-01T09:00:00Z"), NY)).toBe(true);
    expect(isTonight(firstOneThirty, utc("2026-11-01T10:00:00Z"), NY)).toBe(false); // 05:00 EST
    expect(isTonight(secondOneThirty, utc("2026-11-01T10:00:00Z"), NY)).toBe(true);
    // At 06:00 EST both have ended and it is a new night.
    expect(isTonight(firstOneThirty, utc("2026-11-01T11:00:00Z"), NY)).toBe(false);
    expect(isTonight(secondOneThirty, utc("2026-11-01T11:00:00Z"), NY)).toBe(false);
    // A listed end past 6am keeps the second one on the list while it is in progress.
    const lateEnd = { ...secondOneThirty, endsAt: utc("2026-11-01T12:00:00Z") }; // 07:00 EST
    expect(isTonight(lateEnd, utc("2026-11-01T11:00:00Z"), NY)).toBe(true);
  });

  it("Sydney and Kolkata follow the same rule in their own zones", () => {
    const sydney = social("2026-09-25T15:00:00Z"); // Sat 01:00 AEST
    expect(isTonight(sydney, utc("2026-09-25T12:00:00Z"), SYD)).toBe(true); // Fri 22:00 AEST
    expect(isTonight(sydney, utc("2026-09-25T22:00:00Z"), SYD)).toBe(false); // Sat 08:00 AEST
    const kolkata = social("2026-09-21T19:30:00Z"); // Tue 01:00 IST
    expect(isTonight(kolkata, utc("2026-09-21T16:30:00Z"), KOL)).toBe(true); // Mon 22:00 IST
    expect(isTonight(kolkata, utc("2026-09-22T00:30:00Z"), KOL)).toBe(false); // Tue 06:00 IST
  });
});

describeInProcessZones("isOnNight", () => {
  it("matches a listing to a picked night date, including a 2am after-hours slot", () => {
    const afterHours = social("2026-09-24T06:00:00Z"); // Thu 02:00 EDT
    expect(isOnNight(afterHours, "2026-09-23", NY)).toBe(true);
    expect(isOnNight(afterHours, "2026-09-24", NY)).toBe(false);
    const afternoon = social("2026-09-23T18:00:00Z"); // Wed 14:00 EDT
    expect(isOnNight(afternoon, "2026-09-23", NY)).toBe(true);
  });

  it("reads a stored night date when the listing carries one (D-060)", () => {
    // Thu 02:00 EDT is Wednesday night in New York, where its night was written; in UTC the same
    // instant (06:00Z) would be Thursday. The stored night decides, whatever zone is passed.
    const stored: TimedListing = {
      ...social("2026-09-24T06:00:00Z"),
      nightDate: "2026-09-23",
      tz: NY,
    };
    expect(isOnNight(stored, "2026-09-23", "UTC")).toBe(true);
    expect(isOnNight(stored, "2026-09-24", "UTC")).toBe(false);
    expect(listingNightDate(stored, "UTC")).toBe("2026-09-23");
    expect(listingNightDate(social("2026-09-24T06:00:00Z"), "UTC")).toBe("2026-09-24");
  });

  it("puts a listing whose time is not listed on its stored night and no other", () => {
    const l = untimed("2026-09-23");
    expect(listingNightDate(l, NY)).toBe("2026-09-23");
    expect(isOnNight(l, "2026-09-23", NY)).toBe(true);
    expect(isOnNight(l, "2026-09-22", NY)).toBe(false);
    expect(isOnNight(l, "2026-09-24", NY)).toBe(false);
    // A Listing (start and stored night on one object) fits the same helpers.
    expect(isOnNight({ startsAt: null, nightDate: "2026-09-23" }, "2026-09-23", KOL)).toBe(true);
  });

  it("rejects a malformed picked night", () => {
    expect(() => isOnNight(untimed("2026-09-23"), "2026-9-23", NY)).toThrow();
  });
});

describeInProcessZones("a listing whose time is not listed (D-060)", () => {
  // Monday night 2026-09-21 in New York: 06:00 EDT (10:00Z) to 05:59:59.999 EDT Tuesday.
  const NIGHT = "2026-09-21";
  const opens = utc("2026-09-21T10:00:00Z");
  const closes = utc("2026-09-22T10:00:00Z");
  const tenPm = utc("2026-09-22T02:00:00Z");

  describe("effectiveEnd", () => {
    it("is the close of its night window when no end is listed, flagged endNotListed", () => {
      expect(effectiveEnd(untimed(NIGHT))).toEqual({ end: closes, endNotListed: true });
      expect(closes.getTime()).toBe(nightWindow(NIGHT, NY).end.getTime() + 1);
    });

    it("never adds a default duration: every listing type gets the window, not start + default", () => {
      for (const type of Object.keys(DEFAULT_DURATION_MS) as ListingType[]) {
        expect(effectiveEnd(untimed(NIGHT, null, NY, type)), type).toEqual({
          end: closes,
          endNotListed: true,
        });
      }
    });

    it("is a listed end past midnight, as listed", () => {
      const twoAm = utc("2026-09-22T06:00:00Z"); // Tue 02:00 EDT
      expect(effectiveEnd(untimed(NIGHT, twoAm.toISOString()))).toEqual({
        end: twoAm,
        endNotListed: false,
      });
    });

    it("is the window's close when a listed end falls after it", () => {
      const sevenAm = "2026-09-22T11:00:00Z"; // Tue 07:00 EDT
      expect(effectiveEnd(untimed(NIGHT, sevenAm))).toEqual({ end: closes, endNotListed: false });
    });

    it("ignores a venue's closing time: only a listed end shortens the night", () => {
      const bar: TimedListing = {
        ...untimed(NIGHT, null, NY, "venue_open_night"),
        closingAt: utc("2026-09-22T06:00:00Z"),
      };
      expect(effectiveEnd(bar)).toEqual({ end: closes, endNotListed: true });
    });

    it("follows the DST-correct window: 23 hours in spring, 25 in autumn, in each zone", () => {
      expect(effectiveEnd(untimed("2026-03-07")).end.toISOString()).toBe(
        "2026-03-08T10:00:00.000Z", // 06:00 EDT
      );
      expect(effectiveEnd(untimed("2026-10-31")).end.toISOString()).toBe(
        "2026-11-01T11:00:00.000Z", // 06:00 EST
      );
      expect(effectiveEnd(untimed("2026-10-03", null, SYD)).end.toISOString()).toBe(
        "2026-10-03T19:00:00.000Z", // 06:00 AEDT
      );
      expect(effectiveEnd(untimed("2026-09-21", null, KOL)).end.toISOString()).toBe(
        "2026-09-22T00:30:00.000Z", // 06:00 IST
      );
    });
  });

  it("is never in progress, at any point of its night", () => {
    const l = untimed(NIGHT);
    for (const at of [opens, tenPm, utc("2026-09-22T09:59:59.999Z")]) {
      expect(isInProgress(l, at)).toBe(false);
      expect(isInProgress(l, at.getTime())).toBe(false);
    }
    expect(isInProgress(untimed(NIGHT, "2026-09-22T06:00:00Z"), tenPm)).toBe(false);
  });

  describe("isTonight", () => {
    it("is tonight for the whole night window, from 06:00 to 05:59:59.999 local", () => {
      const l = untimed(NIGHT);
      expect(isTonight(l, opens, NY)).toBe(true); // Mon 06:00 EDT
      expect(isTonight(l, utc("2026-09-21T16:00:00Z"), NY)).toBe(true); // Mon 12:00 EDT
      expect(isTonight(l, tenPm, NY)).toBe(true);
      expect(isTonight(l, utc("2026-09-22T07:00:00Z"), NY)).toBe(true); // Tue 03:00 EDT
      expect(isTonight(l, utc("2026-09-22T09:59:59.999Z"), NY)).toBe(true); // Tue 05:59:59.999
    });

    it("is gone at 06:00 and was not yet on before its night began", () => {
      const l = untimed(NIGHT);
      expect(isTonight(l, closes, NY)).toBe(false); // Tue 06:00 EDT: Tuesday night now
      expect(isTonight(l, utc("2026-09-22T16:00:00Z"), NY)).toBe(false); // Tue noon
      expect(isTonight(l, utc("2026-09-21T09:59:59.999Z"), NY)).toBe(false); // Mon 05:59
      expect(isTonight(l, utc("2026-09-21T02:00:00Z"), NY)).toBe(false); // Sun 22:00
    });

    it("a row from the night before leaves at 06:00 and is not on the next night", () => {
      const lastNight = untimed("2026-09-20");
      expect(isTonight(lastNight, tenPm, NY)).toBe(false); // Mon 22:00, Monday night
      expect(isTonight(lastNight, opens, NY)).toBe(false); // Mon 06:00 exactly
      // Sunday night's untimed row is on until Monday 06:00, then off.
      expect(isTonight(lastNight, utc("2026-09-21T05:00:00Z"), NY)).toBe(true); // Mon 01:00
    });

    it("drops out once a listed end past midnight has passed", () => {
      const l = untimed(NIGHT, "2026-09-22T06:00:00Z"); // until Tue 02:00 EDT
      expect(isTonight(l, utc("2026-09-22T05:59:59.999Z"), NY)).toBe(true);
      expect(isTonight(l, utc("2026-09-22T06:00:00Z"), NY)).toBe(false);
    });

    it("drops out at the window's close even when the listed end is later", () => {
      const l = untimed(NIGHT, "2026-09-22T11:00:00Z"); // until Tue 07:00 EDT
      expect(isTonight(l, utc("2026-09-22T09:59:59.999Z"), NY)).toBe(true);
      expect(isTonight(l, closes, NY)).toBe(false);
      expect(isTonight(l, utc("2026-09-22T10:30:00Z"), NY)).toBe(false);
    });

    it("a cancelled one keeps its slot tonight, and still leaves at 06:00", () => {
      const c = { ...untimed(NIGHT), cancelled: true };
      expect(isTonight(c, tenPm, NY)).toBe(true);
      expect(isTonight(c, closes, NY)).toBe(false);
    });

    it("New York spring forward (2026-03-07, 23 hours): on until 06:00 EDT", () => {
      const l = untimed("2026-03-07");
      expect(isTonight(l, utc("2026-03-07T11:00:00Z"), NY)).toBe(true); // Sat 06:00 EST
      expect(isTonight(l, utc("2026-03-08T06:30:00Z"), NY)).toBe(true); // 01:30 EST
      expect(isTonight(l, utc("2026-03-08T07:30:00Z"), NY)).toBe(true); // 03:30 EDT
      expect(isTonight(l, utc("2026-03-08T09:59:59.999Z"), NY)).toBe(true); // 05:59:59.999 EDT
      expect(isTonight(l, utc("2026-03-08T10:00:00Z"), NY)).toBe(false); // 06:00 EDT
    });

    it("New York fall back (2026-10-31, 25 hours): on through both 1:30ams until 06:00 EST", () => {
      const l = untimed("2026-10-31");
      expect(isTonight(l, utc("2026-11-01T05:30:00Z"), NY)).toBe(true); // 01:30 EDT
      expect(isTonight(l, utc("2026-11-01T06:30:00Z"), NY)).toBe(true); // 01:30 EST
      expect(isTonight(l, utc("2026-11-01T10:30:00Z"), NY)).toBe(true); // 05:30 EST
      expect(isTonight(l, utc("2026-11-01T11:00:00Z"), NY)).toBe(false); // 06:00 EST
      // A listed 2am end on that night is 2am EST, an hour after the second 1am began.
      const until2 = untimed("2026-10-31", "2026-11-01T07:00:00Z");
      expect(isTonight(until2, utc("2026-11-01T06:30:00Z"), NY)).toBe(true);
      expect(isTonight(until2, utc("2026-11-01T07:00:00Z"), NY)).toBe(false);
    });

    it("every instant of the window is tonight and its neighbours are not, in every zone", () => {
      for (const [night, zone] of [
        ["2026-03-07", NY],
        ["2026-10-31", NY],
        ["2026-09-21", NY],
        ["2026-10-03", SYD],
        ["2026-09-21", KOL],
        ["2026-03-07", PHX],
      ] as const) {
        const l = untimed(night, null, zone);
        const w = nightWindow(night, zone);
        for (let at = w.start.getTime(); at <= w.end.getTime(); at += HOUR_MS) {
          expect(isTonight(l, at, zone), `${night} ${zone} ${new Date(at).toISOString()}`).toBe(
            true,
          );
        }
        expect(isTonight(l, w.end, zone)).toBe(true);
        expect(isTonight(l, w.start.getTime() - 1, zone)).toBe(false);
        expect(isTonight(l, w.end.getTime() + 1, zone)).toBe(false);
      }
    });
  });

  describe("liveStatus", () => {
    it("reads Time not listed, with no end clause and no countdown", () => {
      const l = untimed(NIGHT);
      const expected = { kind: "time_not_listed", text: "Time not listed", endNotListed: true };
      expect(liveStatus(l, opens, NY)).toEqual(expected);
      expect(liveStatus(l, tenPm, NY)).toEqual(expected);
      expect(liveStatus(l, utc("2026-09-22T09:59:59.999Z"), NY)).toEqual(expected);
      // Before its night, on a future night: the same words, never "Starts in".
      expect(liveStatus(l, utc("2026-09-19T23:00:00Z"), NY)).toEqual(expected);
      expect(liveStatus(l, tenPm, NY).text).toBe(t("card.status.timeNotListed"));
    });

    it("reads Time not listed, until 2am when an end past midnight is listed", () => {
      const l = untimed(NIGHT, "2026-09-22T06:00:00Z");
      expect(liveStatus(l, tenPm, NY)).toEqual({
        kind: "time_not_listed",
        text: "Time not listed, until 2am",
        endNotListed: false,
      });
      expect(liveStatus(l, tenPm, NY).text).toBe(
        t("card.status.timeNotListedUntil", { until: "2am" }),
      );
      expect(liveStatus(l, tenPm, NY, "fr-FR").text).toBe("Time not listed, until 02:00");
      // 01:59 is still before the end: no "Ends in" countdown either.
      expect(liveStatus(l, utc("2026-09-22T05:59:00Z"), NY).text).toBe(
        "Time not listed, until 2am",
      );
    });

    it("writes the listed end in the listing's zone", () => {
      const l = untimed("2026-09-21", "2026-09-21T18:30:00Z", KOL); // until 00:00 IST
      expect(liveStatus(l, utc("2026-09-21T14:00:00Z"), KOL).text).toBe(
        "Time not listed, until 12am",
      );
    });

    it("reads Ended once a listed end has passed", () => {
      const l = untimed(NIGHT, "2026-09-22T06:00:00Z");
      expect(liveStatus(l, utc("2026-09-22T06:00:00Z"), NY)).toEqual({
        kind: "ended",
        text: "Ended",
        endNotListed: false,
      });
      const early = untimed(NIGHT, "2026-09-22T03:00:00Z"); // until 11pm Monday
      expect(liveStatus(early, tenPm, NY).text).toBe("Time not listed, until 11pm");
      expect(liveStatus(early, utc("2026-09-22T03:00:00Z"), NY).kind).toBe("ended");
    });

    it("reads Ended once the night window has closed, and for a past night", () => {
      const l = untimed(NIGHT);
      expect(liveStatus(l, closes, NY)).toEqual({
        kind: "ended",
        text: "Ended",
        endNotListed: true,
      });
      expect(liveStatus(l, utc("2026-09-25T00:00:00Z"), NY).kind).toBe("ended");
      // A listed end after the close does not keep it on.
      expect(liveStatus(untimed(NIGHT, "2026-09-22T11:00:00Z"), closes, NY).kind).toBe("ended");
    });

    it("Cancelled tonight wins, whatever the time, and keeps endNotListed honest", () => {
      const c = { ...untimed(NIGHT), cancelled: true };
      for (const at of [opens, tenPm]) {
        expect(liveStatus(c, at, NY)).toEqual({
          kind: "cancelled",
          text: "Cancelled tonight",
          endNotListed: true,
        });
      }
      // At the close the next night has begun, so it is no longer "tonight" (D-063).
      expect(liveStatus(c, closes, NY)).toEqual({
        kind: "cancelled",
        text: "Cancelled",
        endNotListed: true,
      });
      const withEnd = { ...untimed(NIGHT, "2026-09-22T06:00:00Z"), cancelled: true };
      expect(liveStatus(withEnd, tenPm, NY)).toEqual({
        kind: "cancelled",
        text: t("card.status.cancelled"),
        endNotListed: false,
      });
    });

    it("is never upcoming, on now or ending, at any hour of the night", () => {
      const l = untimed(NIGHT, "2026-09-22T09:00:00Z"); // until 5am
      const w = nightWindow(NIGHT, NY);
      for (
        let at = w.start.getTime() - HOUR_MS;
        at <= w.end.getTime() + HOUR_MS;
        at += 15 * MINUTE_MS
      ) {
        expect(["time_not_listed", "ended"]).toContain(liveStatus(l, at, NY).kind);
      }
    });

    it("follows the DST night's close: fall back ends at 06:00 EST", () => {
      const l = untimed("2026-10-31");
      expect(liveStatus(l, utc("2026-11-01T10:59:59.999Z"), NY).kind).toBe("time_not_listed");
      expect(liveStatus(l, utc("2026-11-01T11:00:00Z"), NY).kind).toBe("ended");
    });
  });
});

describeInProcessZones("pickerLength", () => {
  it("returns 7 for Monday through Friday", () => {
    for (const date of ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16"]) {
      expect(pickerLength(date)).toBe(7);
    }
  });
  it("returns 9 for Saturday", () => {
    expect(pickerLength("2026-10-17")).toBe(9);
  });
  it("returns 8 for Sunday", () => {
    expect(pickerLength("2026-10-18")).toBe(8);
  });
});

describeInProcessZones("dayPicker and formatDayLabel", () => {
  it("gives tonight and the following nights through the next full weekend, with labels (D-075)", () => {
    const now = utc("2026-09-22T00:00:00Z"); // Mon 2026-09-21 20:00 EDT
    expect(dayPicker(now, NY)).toEqual([
      { nightDate: "2026-09-21", label: "Tonight" },
      { nightDate: "2026-09-22", label: "Tomorrow" },
      { nightDate: "2026-09-23", label: "Wed, Sep 23" },
      { nightDate: "2026-09-24", label: "Thu, Sep 24" },
      { nightDate: "2026-09-25", label: "Fri, Sep 25" },
      { nightDate: "2026-09-26", label: "Sat, Sep 26" },
      // On a Monday, Sunday is one tap away.
      { nightDate: "2026-09-27", label: "Sun, Sep 27" },
    ]);
  });

  it("before 6am the picker still starts at last night, labelled by the calendar (D-518)", () => {
    const now = utc("2026-09-22T07:00:00Z"); // Tue 03:00 EDT
    const days = dayPicker(now, NY);
    expect(days[0]).toEqual({ nightDate: "2026-09-21", label: "Last night" });
    expect(days[1]).toEqual({ nightDate: "2026-09-22", label: "Tonight" });
    expect(days[2]).toEqual({ nightDate: "2026-09-23", label: "Tomorrow" });
  });

  it("has seven distinct dates across the spring-forward change", () => {
    const now = utc("2026-03-07T01:00:00Z"); // Fri 2026-03-06 20:00 EST
    const days = dayPicker(now, NY);
    expect(days.map((d) => d.nightDate)).toEqual([
      "2026-03-06",
      "2026-03-07",
      "2026-03-08",
      "2026-03-09",
      "2026-03-10",
      "2026-03-11",
      "2026-03-12",
    ]);
    expect(new Set(days.map((d) => d.nightDate)).size).toBe(7);
    expect(days.map((d) => d.label)).toEqual([
      "Tonight",
      "Tomorrow",
      "Sun, Mar 8",
      "Mon, Mar 9",
      "Tue, Mar 10",
      "Wed, Mar 11",
      "Thu, Mar 12",
    ]);
  });

  it("has seven distinct dates across the fall-back change, from a pre-6am now", () => {
    const now = utc("2026-10-31T08:00:00Z"); // Sat 04:00 EDT, still Friday night
    const days = dayPicker(now, NY);
    expect(days.map((d) => d.nightDate)).toEqual([
      "2026-10-30",
      "2026-10-31",
      "2026-11-01",
      "2026-11-02",
      "2026-11-03",
      "2026-11-04",
      "2026-11-05",
    ]);
    expect(new Set(days.map((d) => d.nightDate)).size).toBe(7);
  });

  it("has seven distinct dates across the Sydney DST start", () => {
    const now = utc("2026-10-02T10:00:00Z"); // Fri 20:00 AEST
    const dates = dayPicker(now, SYD).map((d) => d.nightDate);
    expect(dates[0]).toBe("2026-10-02");
    expect(dates[6]).toBe("2026-10-08");
    expect(new Set(dates).size).toBe(7);
  });

  it("labels in another locale keep Tonight and Tomorrow as UI copy and localise the dates", () => {
    const now = utc("2026-09-22T00:00:00Z");
    const labels = dayPicker(now, NY, "fr-FR").map((d) => d.label);
    expect(labels.slice(0, 2)).toEqual(["Tonight", "Tomorrow"]);
    expect(labels[2]).toBe("mer. 23 sept.");
  });

  it("dayPicker on Saturday 2026-10-17 at 8pm returns 9 nights ending 2026-10-25", () => {
    const now = utc("2026-10-18T00:00:00Z"); // Sat 2026-10-17 20:00 EDT
    const days = dayPicker(now, NY);
    expect(days).toHaveLength(9);
    expect(days[0]?.nightDate).toBe("2026-10-17");
    expect(days[8]?.nightDate).toBe("2026-10-25"); // Next Sunday
  });

  it("dayPicker on Sunday 2026-10-18 at 8pm returns 8 nights ending 2026-10-25", () => {
    const now = utc("2026-10-19T00:00:00Z"); // Sun 2026-10-18 20:00 EDT
    const days = dayPicker(now, NY);
    expect(days).toHaveLength(8);
    expect(days[0]?.nightDate).toBe("2026-10-18");
    expect(days[7]?.nightDate).toBe("2026-10-25"); // Next Sunday
  });

  it("dayPicker on Wednesday 2026-10-14 at 8pm returns 7 nights ending 2026-10-20", () => {
    const now = utc("2026-10-15T00:00:00Z"); // Wed 2026-10-14 20:00 EDT
    const days = dayPicker(now, NY);
    expect(days).toHaveLength(7);
    expect(days[0]?.nightDate).toBe("2026-10-14");
    expect(days[6]?.nightDate).toBe("2026-10-20");
  });

  it("formatDayLabel works for any date, not only the seven shown", () => {
    const now = utc("2026-09-22T00:00:00Z");
    expect(formatDayLabel("2026-09-21", now, NY)).toBe("Tonight");
    expect(formatDayLabel("2026-09-22", now, NY)).toBe("Tomorrow");
    expect(formatDayLabel("2026-10-31", now, NY)).toBe("Sat, Oct 31");
    expect(formatDayLabel("2026-09-20", now, NY)).toBe("Sun, Sep 20"); // last night, no special word
  });
});

describeInProcessZones("isOpenableNight (D-075)", () => {
  // Monday 2026-09-28, 5:30pm EDT. The ingest's window is tonight through 2026-10-11 (+13).
  const monday = utc("2026-09-28T21:30:00Z");

  it("opens tonight through twelve nights on, one short of the ingest's last night", () => {
    expect(isOpenableNight("2026-09-28", monday, NY)).toBe(true); // tonight
    expect(isOpenableNight("2026-10-04", monday, NY)).toBe(true); // Sunday, the picker's last
    expect(isOpenableNight("2026-10-05", monday, NY)).toBe(true); // +7, beyond the picker
    expect(isOpenableNight("2026-10-10", monday, NY)).toBe(true); // +12
    expect(isOpenableNight("2026-10-11", monday, NY)).toBe(false); // +13, maybe not yet written
    expect(isOpenableNight("2026-12-31", monday, NY)).toBe(false);
  });

  it("never opens a night that is over, or anything that is not a strict date", () => {
    expect(isOpenableNight("2026-09-27", monday, NY)).toBe(false); // last night
    for (const bad of [
      "next friday",
      "",
      "2026-10-1",
      "2026-02-30",
      "2026-10-05T00:00",
      " 2026-10-05",
    ]) {
      expect(isOpenableNight(bad, monday, NY), JSON.stringify(bad)).toBe(false);
    }
  });

  it("counts from the night that is ending before 6am", () => {
    const early = utc("2026-09-29T09:59:00Z"); // Tue 5:59am EDT, still Monday's night
    expect(isOpenableNight("2026-09-28", early, NY)).toBe(true);
    expect(isOpenableNight("2026-10-10", early, NY)).toBe(true);
    expect(isOpenableNight("2026-10-11", early, NY)).toBe(false);
    const after = utc("2026-09-29T10:01:00Z"); // 6:01am: Monday's night is over
    expect(isOpenableNight("2026-09-28", after, NY)).toBe(false);
    expect(isOpenableNight("2026-10-11", after, NY)).toBe(true);
  });

  it("opens every night the picker offers, and the picker runs through the next full weekend", () => {
    // DAY_PICKER_LENGTH is the minimum number of nights (7)
    expect(DAY_PICKER_LENGTH).toBe(7);
    expect(MAX_PICKER_NIGHTS).toBeLessThanOrEqual(OPENABLE_NIGHTS);
    expect(OPENABLE_NIGHTS).toBe(13);
    const days = dayPicker(monday, NY);
    expect(days).toHaveLength(pickerLength(currentNightDate(monday, NY)));
    for (const day of days)
      expect(isOpenableNight(day.nightDate, monday, NY), day.nightDate).toBe(true);
    // The first night past the rule is exactly OPENABLE_NIGHTS on.
    const tonight = currentNightDate(monday, NY);
    expect(isOpenableNight(addCalendarDays(tonight, OPENABLE_NIGHTS - 1), monday, NY)).toBe(true);
    expect(isOpenableNight(addCalendarDays(tonight, OPENABLE_NIGHTS), monday, NY)).toBe(false);
  });
});

describe("the window's length stays out of the browser's recurrence library", () => {
  it("is read from a leaf module that imports nothing, never from recurrence.ts", () => {
    // tonight.ts reaches a client bundle (the detail page's map, through the home header), and
    // recurrence.ts brings rrule-temporal with it; window.ts holds the constant alone (D-075).
    expect(readFileSync("src/domain/window.ts", "utf8").match(/^import .*$/gm) ?? []).toEqual([]);
    const tonight = readFileSync("src/domain/tonight.ts", "utf8");
    expect(tonight).toMatch(/^import \{ MATERIALIZE_DAYS \} from "@\/src\/domain\/window";$/m);
    expect(tonight).not.toMatch(/from "@\/src\/domain\/recurrence"/);
    expect(MATERIALIZE_DAYS).toBe(RECURRENCE_MATERIALIZE_DAYS);
  });
});

describeInProcessZones("liveStatus", () => {
  // Monday 2026-09-21: social 21:30 to 01:00 EDT.
  const s = social("2026-09-22T01:30:00Z", "2026-09-22T05:00:00Z");

  it("Starts in 40 min, with the end", () => {
    const r = liveStatus(s, utc("2026-09-22T00:50:00Z"), NY);
    expect(r).toEqual({
      kind: "upcoming",
      text: "Starts in 40 min, until 1am",
      endNotListed: false,
    });
  });

  it("Starts in 2h 18m", () => {
    expect(liveStatus(s, utc("2026-09-21T23:12:00Z"), NY).text).toBe("Starts in 2h 18m, until 1am");
  });

  it("Starts at 9:30pm when more than 6 hours away", () => {
    expect(liveStatus(s, utc("2026-09-21T18:30:00Z"), NY)).toEqual({
      kind: "upcoming",
      text: "Starts at 9:30pm, until 1am",
      endNotListed: false,
    });
  });

  it("switches from countdown to clock time just past 6 hours", () => {
    expect(liveStatus(s, utc("2026-09-21T19:30:00Z"), NY).text).toBe("Starts in 6h, until 1am");
    expect(liveStatus(s, utc("2026-09-21T19:29:59.999Z"), NY).text).toBe(
      "Starts at 9:30pm, until 1am",
    );
  });

  it("On now until 1am", () => {
    expect(liveStatus(s, utc("2026-09-22T03:00:00Z"), NY)).toEqual({
      kind: "on_now",
      text: "On now until 1am",
      endNotListed: false,
    });
    expect(liveStatus(s, utc("2026-09-22T01:30:00Z"), NY).kind).toBe("on_now"); // at the start
  });

  it("Ends in 20 min", () => {
    expect(liveStatus(s, utc("2026-09-22T04:40:00Z"), NY)).toEqual({
      kind: "ending",
      text: "Ends in 20 min",
      endNotListed: false,
    });
  });

  it("Ends in 1h at exactly an hour before the end of a long social", () => {
    // 21:30 to 01:00: an hour left is well past halfway, so the countdown starts here.
    expect(liveStatus(s, utc("2026-09-22T04:00:00Z"), NY)).toEqual({
      kind: "ending",
      text: "Ends in 1h",
      endNotListed: false,
    });
    expect(liveStatus(s, utc("2026-09-22T03:59:59Z"), NY).kind).toBe("on_now");
  });

  it("a short class reads On now for its first half, then Ends in", () => {
    const klass: TimedListing = {
      startsAt: utc("2026-09-22T01:30:00Z"), // 21:30 EDT
      endsAt: utc("2026-09-22T02:00:00Z"), // 22:00 EDT
      listingType: "class",
    };
    expect(liveStatus(klass, utc("2026-09-22T01:30:00Z"), NY)).toEqual({
      kind: "on_now",
      text: "On now until 10pm",
      endNotListed: false,
    });
    expect(liveStatus(klass, utc("2026-09-22T01:44:00Z"), NY).kind).toBe("on_now"); // 16 min left
    expect(liveStatus(klass, utc("2026-09-22T01:45:00Z"), NY).kind).toBe("ending"); // halfway
    expect(liveStatus(klass, utc("2026-09-22T01:46:00Z"), NY)).toEqual({
      kind: "ending",
      text: "Ends in 14 min",
      endNotListed: false,
    });
  });

  it("composes its copy from card.status and home.day in en.ts", () => {
    expect(liveStatus(s, utc("2026-09-22T03:00:00Z"), NY).text).toBe(
      t("card.status.onNow", { until: "1am" }),
    );
    expect(liveStatus(s, utc("2026-09-22T00:50:00Z"), NY).text).toBe(
      t("card.status.startsIn", { duration: "40 min", until: "1am" }),
    );
    expect(liveStatus({ ...s, cancelled: true }, utc("2026-09-22T00:50:00Z"), NY).text).toBe(
      t("card.status.cancelled"),
    );
    expect(formatDayLabel("2026-09-21", utc("2026-09-22T00:00:00Z"), NY)).toBe(
      t("home.day.tonight"),
    );
  });

  it("Ended, from the end instant onwards", () => {
    expect(liveStatus(s, utc("2026-09-22T05:00:00Z"), NY)).toEqual({
      kind: "ended",
      text: "Ended",
      endNotListed: false,
    });
    expect(liveStatus(s, utc("2026-09-23T05:00:00Z"), NY).kind).toBe("ended");
  });

  it("Cancelled tonight, whatever the time", () => {
    const c = { ...s, cancelled: true };
    expect(liveStatus(c, utc("2026-09-21T18:30:00Z"), NY)).toEqual({
      kind: "cancelled",
      text: "Cancelled tonight",
      endNotListed: false,
    });
    expect(liveStatus(c, utc("2026-09-22T03:00:00Z"), NY).kind).toBe("cancelled");
  });

  it("says Cancelled, not Cancelled tonight, when the night is another night", () => {
    const c = { ...s, cancelled: true };
    // Two days before its night (the live site said "Cancelled tonight" for a Thursday on Monday).
    expect(liveStatus(c, utc("2026-09-19T18:30:00Z"), NY)).toEqual({
      kind: "cancelled",
      text: "Cancelled",
      endNotListed: false,
    });
    // At 5:59am the night is still that night; at 6am the next night has begun.
    expect(liveStatus(c, utc("2026-09-22T09:59:00Z"), NY).text).toBe("Cancelled tonight");
    expect(liveStatus(c, utc("2026-09-22T10:00:00Z"), NY).text).toBe("Cancelled");
    const untimed: TimedListing = {
      startsAt: null,
      nightDate: "2026-09-21",
      tz: NY,
      endsAt: null,
      listingType: "social",
      cancelled: true,
    };
    expect(liveStatus(untimed, utc("2026-09-21T18:30:00Z"), NY).text).toBe("Cancelled tonight");
    expect(liveStatus(untimed, utc("2026-09-19T18:30:00Z"), NY).text).toBe("Cancelled");
  });

  it("counts up to the next whole minute, never 0 while time remains", () => {
    expect(liveStatus(s, utc("2026-09-22T00:50:30Z"), NY).text).toBe("Starts in 40 min, until 1am");
    expect(liveStatus(s, utc("2026-09-22T01:29:59Z"), NY).text).toBe("Starts in 1 min, until 1am");
    expect(liveStatus(s, utc("2026-09-22T04:59:59Z"), NY).text).toBe("Ends in 1 min");
  });

  it("never writes an end it does not know: class with no listed end", () => {
    const klass: TimedListing = {
      startsAt: utc("2026-09-22T00:00:00Z"), // 20:00 EDT, default end 21:30
      endsAt: null,
      listingType: "class",
    };
    expect(liveStatus(klass, utc("2026-09-21T23:20:00Z"), NY)).toEqual({
      kind: "upcoming",
      text: "Starts in 40 min",
      endNotListed: true,
    });
    expect(liveStatus(klass, utc("2026-09-22T00:30:00Z"), NY)).toEqual({
      kind: "on_now",
      text: "On now",
      endNotListed: true,
    });
    // 10 minutes before the default end: still "On now", never "Ends in".
    expect(liveStatus(klass, utc("2026-09-22T01:20:00Z"), NY).text).toBe("On now");
    expect(liveStatus(klass, utc("2026-09-22T01:30:00Z"), NY).kind).toBe("ended");
  });

  it("a venue open night uses its closing time as a listed end", () => {
    const bar: TimedListing = {
      startsAt: utc("2026-09-22T00:00:00Z"),
      endsAt: null,
      listingType: "venue_open_night",
      closingAt: utc("2026-09-22T06:00:00Z"), // 02:00 EDT
    };
    expect(liveStatus(bar, utc("2026-09-22T03:00:00Z"), NY).text).toBe("On now until 2am");
  });

  it("formats times in the locale: fr-FR is 24-hour", () => {
    expect(liveStatus(s, utc("2026-09-22T00:50:00Z"), NY, "fr-FR").text).toBe(
      "Starts in 40 min, until 01:00",
    );
    expect(liveStatus(s, utc("2026-09-21T18:30:00Z"), NY, "fr-FR").text).toBe(
      "Starts at 21:30, until 01:00",
    );
    expect(liveStatus(s, utc("2026-09-22T03:00:00Z"), NY, "fr-FR").text).toBe("On now until 01:00");
  });

  it("formats times in the event's zone, not the process zone", () => {
    const kolkata = social("2026-09-21T15:30:00Z", "2026-09-21T18:30:00Z"); // 21:00 to 00:00 IST
    expect(liveStatus(kolkata, utc("2026-09-21T14:50:00Z"), KOL).text).toBe(
      "Starts in 40 min, until 12am",
    );
    expect(liveStatus(kolkata, utc("2026-09-21T08:00:00Z"), KOL).text).toBe(
      "Starts at 9pm, until 12am",
    );
  });

  it("shows the second 1:30am correctly on the fall-back night", () => {
    const club: TimedListing = {
      startsAt: utc("2026-11-01T02:00:00Z"), // Sat 22:00 EDT
      endsAt: null,
      listingType: "club_night", // 6 h default: 08:00Z = 03:00 EST
    };
    expect(liveStatus(club, utc("2026-11-01T06:30:00Z"), NY).text).toBe("On now"); // end not listed
    const withEnd = { ...club, endsAt: utc("2026-11-01T08:00:00Z") };
    expect(liveStatus(withEnd, utc("2026-11-01T06:30:00Z"), NY).text).toBe("On now until 3am");
    expect(liveStatus(withEnd, utc("2026-11-01T01:00:00Z"), NY).text).toBe(
      "Starts in 1h, until 3am",
    );
  });
});
