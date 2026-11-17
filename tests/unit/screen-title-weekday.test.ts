import { describe, expect, it } from "vitest";
import { screenTitleWeekday } from "@/src/domain/listing-screen";

// theronda.us/nyc 11-03: "Tango Mondays" and "Tango Mondays — Tango Class" stored on Tuesday 2026-11-03 (D-589).
describe("screenTitleWeekday: a title naming its weekly day, listed on another night (D-589)", () => {
  it.each([
    ["Tango Mondays", "2026-11-03"],
    ["Tango Mondays — Tango Class", "2026-11-03"],
    ["Mondays Milongueros", "2026-11-04"],
    ["Every Friday: Salsa Social", "2026-11-07"],
    ["SALSA THURSDAYS", "2026-11-06"],
  ])("screens %s on %s", (title, night) => {
    const r = screenTitleWeekday(title, night);
    expect(r).not.toBeNull();
    expect(r!.kind).toBe("wrong_weekday");
    expect(r!.reason).toContain("D-589");
  });

  it.each([
    ["Tango Mondays", "2026-11-02"],
    ["Mondays Milongueros — Tango Class", "2026-11-09"],
    ["Every Friday: Salsa Social", "2026-11-06"],
    ["Salsa Fridays & Saturdays", "2026-11-07"],
    ["Monday Night Swing", "2026-11-03"],
    ["Sunday Tea Dance", "2026-11-07"],
    ["Bachata Social", "2026-11-03"],
    ["Not a date", "garbage"],
  ])("keeps %s on %s", (title, night) => {
    expect(screenTitleWeekday(title, night)).toBeNull();
  });
});
