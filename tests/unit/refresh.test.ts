// When a source is next read (D-088): due selection, the two cadences, the day-of rule across DST
// nights, and the run's time box. Pure; the ingest's use of them is tests/unit/pipeline-refresh.test.ts.

import { describe, expect, it } from "vitest";

import { REFRESH } from "@/config/refresh";
import { dayOfWindow, isDue, nextHarvestAt, timeBoxSpent } from "@/src/domain/refresh";

const NY = "America/New_York";
const at = (iso: string) => new Date(iso);
const next = (runStart: string, readBy: "reader" | "model", listsTonight = false, zone = NY) =>
  nextHarvestAt({ runStart: at(runStart), readBy, listsTonight, zone }).toISOString();

describe("due selection", () => {
  it("is due when never read or failed (null), or when its time is at or before the run's start", () => {
    const run = at("2026-10-05T18:17:00Z");
    expect(isDue(null, run)).toBe(true);
    expect(isDue(at("2026-10-05T18:17:00Z"), run)).toBe(true);
    expect(isDue(at("2026-10-05T17:00:00Z"), run)).toBe(true);
    expect(isDue(at("2026-10-05T18:17:00.001Z"), run)).toBe(false);
  });
});

describe("cadence", () => {
  it("reads a no-model source every 2 hours and a model page every 6, less the grace", () => {
    // 2:17pm EDT, no listing tonight.
    expect(next("2026-10-05T18:17:00Z", "reader")).toBe("2026-10-05T19:40:00.000Z");
    expect(next("2026-10-05T18:17:00Z", "model")).toBe("2026-10-05T23:40:00.000Z");
  });

  it("is due two runs later even when GitHub started this run late", () => {
    const n = nextHarvestAt({
      runStart: at("2026-10-05T18:40:00Z"),
      readBy: "reader",
      listsTonight: false,
      zone: NY,
    });
    // The 2:17pm EDT run started 23 minutes late (18:40Z): read again at 4:17pm (20:17Z), not 5:17pm.
    expect(isDue(n, at("2026-10-05T20:17:00Z"))).toBe(true);
    // And not in the very next hourly run.
    expect(isDue(n, at("2026-10-05T19:17:00Z"))).toBe(false);
  });

  it("keeps the grace below an hour, so an hourly source is not read twice in one hour", () => {
    expect(REFRESH.graceMinutes).toBeLessThan(REFRESH.dayOfEveryMinutes);
  });
});

describe("day-of freshness (a source with a listing tonight)", () => {
  it("is due hourly from 3pm to midnight local", () => {
    // 3:17pm, 6:17pm and 10:17pm EDT: each read makes it due in the next hourly run.
    for (const run of ["2026-10-05T19:17:00Z", "2026-10-05T22:17:00Z", "2026-10-06T02:17:00Z"]) {
      const n = nextHarvestAt({ runStart: at(run), readBy: "model", listsTonight: true, zone: NY });
      const hourLater = new Date(at(run).getTime() + 3_600_000);
      expect(isDue(n, hourLater)).toBe(true);
    }
  });

  it("waits for 3pm when read in the morning, if its cadence is later", () => {
    // 10:17am EDT: the model's 6 hours (3:40pm) are later than 3pm, so 3pm.
    expect(next("2026-10-05T14:17:00Z", "model", true)).toBe("2026-10-05T19:00:00.000Z");
    // A reader's 2 hours (12:17pm, less the grace) come first.
    expect(next("2026-10-05T14:17:00Z", "reader", true)).toBe("2026-10-05T15:40:00.000Z");
  });

  it("ends at midnight: the 11:17pm run is the last that makes it due an hour later", () => {
    // 11:17pm EDT: the next hour (12:17am) is past midnight, so the model's 6 hours apply.
    expect(next("2026-10-06T03:17:00Z", "model", true)).toBe("2026-10-06T08:40:00.000Z");
    // 10:17pm EDT: 11:17pm is inside the evening.
    expect(next("2026-10-06T02:17:00Z", "model", true)).toBe("2026-10-06T02:40:00.000Z");
    // 12:17am and 1:17am: tonight is still the night that is ending, its evening over.
    expect(next("2026-10-06T04:17:00Z", "model", true)).toBe("2026-10-06T09:40:00.000Z");
    expect(next("2026-10-06T05:17:00Z", "model", true)).toBe("2026-10-06T10:40:00.000Z");
  });

  it("uses the wall clock's 3pm and midnight on a DST night, by the zone, not by UTC offsets", () => {
    // Saturday 2026-10-31, the last EDT evening: 3pm is 19:00Z, midnight 04:00Z.
    expect(dayOfWindow(at("2026-10-31T16:00:00Z"), NY)).toEqual({
      night: "2026-10-31",
      start: at("2026-10-31T19:00:00Z"),
      end: at("2026-11-01T04:00:00Z"),
    });
    // Sunday 2026-11-01, the first EST evening: 3pm is 20:00Z, midnight 05:00Z.
    expect(dayOfWindow(at("2026-11-01T17:00:00Z"), NY)).toEqual({
      night: "2026-11-01",
      start: at("2026-11-01T20:00:00Z"),
      end: at("2026-11-02T05:00:00Z"),
    });
    // Saturday 2026-03-07, EST; the clocks go forward at 2am that night.
    expect(dayOfWindow(at("2026-03-07T17:00:00Z"), NY)).toEqual({
      night: "2026-03-07",
      start: at("2026-03-07T20:00:00Z"),
      end: at("2026-03-08T05:00:00Z"),
    });
    // Sunday 2026-03-08, EDT from 2am: 3pm is 19:00Z.
    expect(dayOfWindow(at("2026-03-08T17:00:00Z"), NY).start).toEqual(at("2026-03-08T19:00:00Z"));
  });

  it("on the night the clocks go back, a morning read waits for that day's 3pm in EST", () => {
    // 10:17am EST on 2026-11-01 is 15:17Z; 3pm EST is 20:00Z.
    expect(next("2026-11-01T15:17:00Z", "model", true)).toBe("2026-11-01T20:00:00.000Z");
    // 11:17pm EST is 04:17Z on 11-02: past it, the cadence.
    expect(next("2026-11-02T04:17:00Z", "model", true)).toBe("2026-11-02T09:40:00.000Z");
  });

  it("before 6am, tonight is still the night that is ending (src/domain/tonight.ts)", () => {
    // 5:30am EDT on 10-06: the night of 10-05, whose evening is over.
    expect(dayOfWindow(at("2026-10-06T09:30:00Z"), NY).night).toBe("2026-10-05");
  });

  it("follows the metro's zone", () => {
    // 3pm in Paris on 2026-10-05 (CEST) is 13:00Z.
    expect(next("2026-10-05T08:00:00Z", "model", true, "Europe/Paris")).toBe(
      "2026-10-05T13:00:00.000Z",
    );
  });
});

describe("time box", () => {
  it("is spent once the run has used its minutes, and never without one", () => {
    const box = 8 * 60_000;
    expect(timeBoxSpent(0, box - 1, box)).toBe(false);
    expect(timeBoxSpent(0, box, box)).toBe(true);
    expect(timeBoxSpent(0, 10 * box, null)).toBe(false);
  });
});
