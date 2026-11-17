import { describe, expect, it } from "vitest";
import {
  HAND_CHECKED_MAX_AGE_DAYS,
  handCheckedPage,
  type HandCheckedNight,
} from "@/src/domain/hand-checked";

describe("handCheckedPage", () => {
  const baseNight: HandCheckedNight = {
    title: "Test Night",
    line: "Test line",
    checkedOn: "2026-11-01",
    evidenceUrl: "https://instagram.com/p/abc",
  };

  it("age 0 (checkedOn === today) -> fresh; pageText is its line", () => {
    const result = handCheckedPage([baseNight], "2026-11-01");
    expect(result.fresh).toHaveLength(1);
    expect(result.expired).toHaveLength(0);
    expect(result.pageText).toBe("Test line");
    expect(result.notes).toEqual([]);
  });

  it("age 34 -> fresh; age 35 -> expired with the '35 days ago; recheck' note", () => {
    const night34 = { ...baseNight, checkedOn: "2026-10-28" }; // 34 days before 2026-12-01
    const night35 = { ...baseNight, checkedOn: "2026-10-27" }; // 35 days before 2026-12-01
    const today = "2026-12-01";

    const result34 = handCheckedPage([night34], today);
    expect(result34.fresh).toHaveLength(1);
    expect(result34.expired).toHaveLength(0);

    const result35 = handCheckedPage([night35], today);
    expect(result35.fresh).toHaveLength(0);
    expect(result35.expired).toHaveLength(1);
    expect(result35.notes).toEqual([
      "Test Night: hand-checked on 2026-10-27, 35 days ago; recheck the venue's Instagram (D-797); not listed",
    ]);
  });

  it("two fresh nights -> pageText is both lines joined by '\\n', input order", () => {
    const night1 = { ...baseNight, line: "Line 1" };
    const night2 = { ...baseNight, line: "Line 2" };
    const result = handCheckedPage([night1, night2], "2026-11-01");
    expect(result.fresh).toHaveLength(2);
    expect(result.pageText).toBe("Line 1\nLine 2");
  });

  it("all expired -> pageText '' and fresh []", () => {
    const night = { ...baseNight, checkedOn: "2026-11-02" }; // future date
    const result = handCheckedPage([night], "2026-11-01");
    expect(result.fresh).toHaveLength(0);
    expect(result.pageText).toBe("");
    expect(result.expired).toHaveLength(1);
  });

  it("missing checkedOn, '2026-11-8', '2026-02-30' -> the 'no valid checkedOn' note", () => {
    const nightMissing = { ...baseNight, checkedOn: undefined };
    const nightBadFormat = { ...baseNight, checkedOn: "2026-11-8" };
    const nightInvalidDate = { ...baseNight, checkedOn: "2026-02-30" };

    const result1 = handCheckedPage([nightMissing], "2026-11-01");
    expect(result1.notes).toEqual([
      "Test Night: hand-checked night has no valid checkedOn (D-797); not listed",
    ]);

    const result2 = handCheckedPage([nightBadFormat], "2026-11-01");
    expect(result2.notes).toEqual([
      "Test Night: hand-checked night has no valid checkedOn (D-797); not listed",
    ]);

    const result3 = handCheckedPage([nightInvalidDate], "2026-11-01");
    expect(result3.notes).toEqual([
      "Test Night: hand-checked night has no valid checkedOn (D-797); not listed",
    ]);
  });

  it("missing evidenceUrl, '', 'http://instagram.com/p/x' -> the 'no evidenceUrl' note", () => {
    const nightMissing = { ...baseNight, evidenceUrl: undefined };
    const nightEmpty = { ...baseNight, evidenceUrl: "" };
    const nightHttp = { ...baseNight, evidenceUrl: "http://instagram.com/p/x" };

    const result1 = handCheckedPage([nightMissing], "2026-11-01");
    expect(result1.notes).toEqual([
      "Test Night: hand-checked night has no evidenceUrl (D-797); not listed",
    ]);

    const result2 = handCheckedPage([nightEmpty], "2026-11-01");
    expect(result2.notes).toEqual([
      "Test Night: hand-checked night has no evidenceUrl (D-797); not listed",
    ]);

    const result3 = handCheckedPage([nightHttp], "2026-11-01");
    expect(result3.notes).toEqual([
      "Test Night: hand-checked night has no evidenceUrl (D-797); not listed",
    ]);
  });

  it("checkedOn tomorrow -> the 'after today' note", () => {
    const night = { ...baseNight, checkedOn: "2026-11-02" };
    const result = handCheckedPage([night], "2026-11-01");
    expect(result.notes).toEqual([
      "Test Night: hand-checked on 2026-11-02, after today (2026-11-01); not listed",
    ]);
  });

  it("a night with both bad checkedOn and no evidenceUrl gets only the checkedOn note", () => {
    const night = {
      ...baseNight,
      checkedOn: "invalid",
      evidenceUrl: undefined,
    };
    const result = handCheckedPage([night], "2026-11-01");
    expect(result.notes).toEqual([
      "Test Night: hand-checked night has no valid checkedOn (D-797); not listed",
    ]);
    expect(result.notes).toHaveLength(1);
  });

  it("the input array is not mutated, and fresh[0] is the same object as the input night", () => {
    const night = { ...baseNight };
    const input = [night];
    const result = handCheckedPage(input, "2026-11-01");
    expect(result.fresh[0]).toBe(night);
    expect(input).toEqual([night]); // unchanged
  });

  it("HAND_CHECKED_MAX_AGE_DAYS is 35", () => {
    expect(HAND_CHECKED_MAX_AGE_DAYS).toBe(35);
  });
});
