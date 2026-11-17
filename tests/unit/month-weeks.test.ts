// D-827: a fixed night can be monthly on given weeks of the month ("2nd and 4th Wednesday", Egoland Bar
// Akihabara's "Akihabara Salsa"). weeksOfMonth: 1..5 is the nth such weekday of the month, -1 the last.

import { describe, expect, it } from "vitest";

import {
  firstMonthlyNight,
  monthlyRecurrence,
  onWeeksOfMonth,
  validWeeksOfMonth,
} from "@/src/domain/month-weeks";

describe("onWeeksOfMonth", () => {
  it("is the nth weekday of its month", () => {
    // November 2026: Wednesdays are 4, 11, 18, 25.
    expect(onWeeksOfMonth("2026-11-04", [2, 4])).toBe(false);
    expect(onWeeksOfMonth("2026-11-11", [2, 4])).toBe(true);
    expect(onWeeksOfMonth("2026-11-18", [2, 4])).toBe(false);
    expect(onWeeksOfMonth("2026-11-25", [2, 4])).toBe(true);
    expect(onWeeksOfMonth("2026-11-04", [1])).toBe(true);
  });

  it("-1 is the last such weekday of the month", () => {
    expect(onWeeksOfMonth("2026-11-25", [-1])).toBe(true); // last Wednesday of November
    expect(onWeeksOfMonth("2026-11-18", [-1])).toBe(false);
    expect(onWeeksOfMonth("2026-12-30", [-1])).toBe(true); // 5th and last Wednesday of December
    expect(onWeeksOfMonth("2026-12-30", [5])).toBe(true);
    expect(onWeeksOfMonth("2026-12-23", [-1])).toBe(false);
  });
});

describe("validWeeksOfMonth", () => {
  it("takes 1..5 and -1, each once, at least one", () => {
    expect(validWeeksOfMonth([2, 4])).toBe(true);
    expect(validWeeksOfMonth([-1])).toBe(true);
    expect(validWeeksOfMonth([1, 2, 3, 4, 5])).toBe(true);
    expect(validWeeksOfMonth([])).toBe(false);
    expect(validWeeksOfMonth([0])).toBe(false);
    expect(validWeeksOfMonth([6])).toBe(false);
    expect(validWeeksOfMonth([-2])).toBe(false);
    expect(validWeeksOfMonth([2, 2])).toBe(false);
    expect(validWeeksOfMonth([1.5])).toBe(false);
  });
});

describe("firstMonthlyNight", () => {
  it("is the first night on or after fromNight on one of the days and weeks", () => {
    expect(firstMonthlyNight(["WE"], [2, 4], "2026-11-10")).toBe("2026-11-11");
    expect(firstMonthlyNight(["WE"], [2, 4], "2026-11-11")).toBe("2026-11-11");
    expect(firstMonthlyNight(["WE"], [2, 4], "2026-11-12")).toBe("2026-11-25");
    // Past the 4th Wednesday: the next month's 2nd (December 2026: 2, 9, 16, 23, 30).
    expect(firstMonthlyNight(["WE"], [2, 4], "2026-11-26")).toBe("2026-12-09");
    expect(firstMonthlyNight(["FR", "SA"], [1], "2026-11-08")).toBe("2026-12-04");
  });

  it("looks up to 62 days ahead, and is null with no days or no weeks", () => {
    // A 5th Monday: January 2027's Mondays are 4-25, February has none, March's 5th is the 29th,
    // 62 days after 2027-01-26 (the longest gap a 5th week can leave).
    expect(firstMonthlyNight(["MO"], [5], "2027-01-26")).toBe("2027-03-29");
    expect(firstMonthlyNight([], [2], "2026-11-10")).toBeNull();
    expect(firstMonthlyNight(["WE"], [], "2026-11-10")).toBeNull();
  });
});

describe("monthlyRecurrence", () => {
  it("writes FREQ=MONTHLY with each week's weekday, weeks ascending and -1 last", () => {
    expect(monthlyRecurrence(["WE"], [4, 2], "2026-11-11", "20:00")).toEqual({
      rrule: "FREQ=MONTHLY;BYDAY=2WE,4WE",
      dtstartLocal: "2026-11-11T20:00",
      exdates: [],
    });
    expect(monthlyRecurrence(["SA", "FR"], [-1, 1], "2026-11-06", "21:30").rrule).toBe(
      "FREQ=MONTHLY;BYDAY=1FR,1SA,-1FR,-1SA",
    );
  });

  it("an untimed night is anchored like a weekly one and says so", () => {
    const rule = monthlyRecurrence(["WE"], [2], "2026-11-11", null);
    expect(rule.rrule).toBe("FREQ=MONTHLY;BYDAY=2WE");
    expect(rule.timeListed).toBe(false);
    expect(rule.dtstartLocal.startsWith("2026-11-11T")).toBe(true);
  });

  it("throws with no days or no weeks", () => {
    expect(() => monthlyRecurrence([], [2], "2026-11-11", "20:00")).toThrow();
    expect(() => monthlyRecurrence(["WE"], [], "2026-11-11", "20:00")).toThrow();
  });
});
