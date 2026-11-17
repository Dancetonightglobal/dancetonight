import { describe, expect, it } from "vitest";
import { weekdayOfNight, weeklyRecurrence, firstNightOn } from "./weekly-rule";

describe("weekdayOfNight", () => {
  it("returns correct weekday", () => {
    expect(weekdayOfNight("2026-11-02")).toBe("MO");
    expect(weekdayOfNight("2026-11-01")).toBe("SU");
    expect(weekdayOfNight("2026-10-31")).toBe("SA");
  });
});

describe("weeklyRecurrence", () => {
  it("builds recurrence with time", () => {
    const r = weeklyRecurrence(["SU", "TH"], "2026-11-05", "19:00");
    expect(r).toEqual({
      rrule: "FREQ=WEEKLY;BYDAY=TH,SU",
      dtstartLocal: "2026-11-05T19:00",
      exdates: [],
    });
    expect("timeListed" in r).toBe(false);
  });

  it("builds recurrence without time (untimed anchor)", () => {
    const r = weeklyRecurrence(["MO"], "2026-11-02", null);
    expect(r).toEqual({
      rrule: "FREQ=WEEKLY;BYDAY=MO",
      dtstartLocal: "2026-11-02T12:00",
      exdates: [],
      timeListed: false,
    });
  });

  it("deduplicates days", () => {
    const r = weeklyRecurrence(["TU", "TU"], "2026-11-03", "20:00");
    expect(r.rrule).toBe("FREQ=WEEKLY;BYDAY=TU");
  });

  it("throws on empty days", () => {
    expect(() => weeklyRecurrence([], "2026-11-01", "20:00")).toThrow("weeklyRecurrence: no days");
  });
});

describe("firstNightOn", () => {
  it("finds first matching day after fromNight", () => {
    expect(firstNightOn(["TH", "SU"], "2026-10-31")).toBe("2026-11-01"); // Sunday
    expect(firstNightOn(["SA"], "2026-10-31")).toBe("2026-10-31"); // same day
    expect(firstNightOn(["FR"], "2026-10-31")).toBe("2026-11-06"); // next Friday
  });

  it("returns null for empty days", () => {
    expect(firstNightOn([], "2026-10-31")).toBeNull();
  });
});
