import { describe, expect, it } from "vitest";
import { timesFromText } from "@/src/domain/text-facts";

// D-839 (coverage daily 2026-11-10, Barcelona Meetup): "it is not a beginner from 0 lesson" read as a lesson at
// "from 0", i.e. 00:00, and the course card showed 12am beside its own "Doors 7:30pm". A bare 0 with no minutes
// and no am/pm is a count ("from 0"), never a clock time.
describe("timesFromText: a bare 0 is not a time (D-839)", () => {
  it("reads no lesson time from 'beginner from 0'", () => {
    const text =
      "8:30 PM Basic Level 2 (for people with some knowledge, at least up Dile Que No, Enchufla, and 70) it ***it is not a beginner from 0 lesson***) -9:30 PM **BEGGINER LEVEL GROUP** **Trial Class Price Is 5€ individual.**";
    expect(timesFromText(text).lesson).toBeNull();
  });

  it("still reads a later real time after a bare 0", () => {
    expect(timesFromText("Beginners from 0 welcome. Class at 8pm").lesson).toBe("20:00");
  });

  it("keeps midnight written as a time", () => {
    expect(timesFromText("Party from 0:00 till late").dancing).toBe("00:00");
    expect(timesFromText("Party from 00:00").dancing).toBe("00:00");
    expect(timesFromText("Party from 12am").dancing).toBe("00:00");
    expect(timesFromText("Party from 0h").dancing).toBe("00:00");
  });

  it("keeps the existing readings", () => {
    expect(timesFromText("lesson at 7pm, social from 8:30")).toMatchObject({
      lesson: "19:00",
      dancing: "20:30",
    });
    expect(timesFromText("Class 9").lesson).toBe("21:00");
  });
});
