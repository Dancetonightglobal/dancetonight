import { describe, expect, it } from "vitest";
import { parseRecurrenceText } from "@/src/domain/recurrence";
import { readBlockTimes } from "@/src/domain/stated-times";

// D-775 (Nashville 11-07, swingdancenashville.com/jump-session/): "When: Every 2nd and 4th Friday Night!
// 730-830 PM Beginner Swing Dance Lesson 830-1100 PM Open Dancing".
describe("Nashville Jump Session (D-775)", () => {
  it("parses an Nth-weekday rule with night after the day", () => {
    expect(parseRecurrenceText("Every 2nd and 4th Friday Night", "en")).toBe(
      "FREQ=MONTHLY;BYDAY=FR;BYSETPOS=2,4",
    );
    expect(parseRecurrenceText("1st and 3rd Saturday nights", "en")).toBe(
      "FREQ=MONTHLY;BYDAY=SA;BYSETPOS=1,3",
    );
    expect(parseRecurrenceText("Every 2nd and 4th Friday", "en")).toBe(
      "FREQ=MONTHLY;BYDAY=FR;BYSETPOS=2,4",
    );
  });

  it("reads colon-less clock ranges before PM", () => {
    const times = readBlockTimes(
      "When: Every 2nd and 4th Friday Night! 730-830 PM Beginner Swing Dance Lesson 830-1100 PM Open Dancing",
      "en",
    );
    expect(times.map((t) => [t.value, t.role])).toEqual([
      ["19:30", "start"],
      ["20:30", "end"],
      ["20:30", "start"],
      ["23:00", "end"],
    ]);
    expect(times[0]?.label).toBe("lesson");
    expect(times[2]?.label).toBe("dancing");
  });

  it("leaves years, prices and 24-hour ranges alone", () => {
    expect(readBlockTimes("Season 2025-2026 pm", "en")).toEqual([]);
    expect(readBlockTimes("Tickets $1500-2000 pm", "en")).toEqual([]);
    expect(readBlockTimes("1330-1530 pm", "en")).toEqual([]);
  });
});
