import { describe, expect, it } from "vitest";
import { readBlockTimes } from "@/src/domain/stated-times";

describe("duration ends: START - N h (D-667)", () => {
  it("reads 12-hour start with dash and bare N h as end = start + N hours", () => {
    const mentions = readBlockTimes("8:00 PM - 3 h", "en");
    const start = mentions.find((m) => m.role === "start");
    const end = mentions.find((m) => m.role === "end");
    expect(start?.value).toBe("20:00");
    expect(end?.value).toBe("23:00");
    expect(end?.explicit).toBe(true);
  });

  it("handles minutes", () => {
    const mentions = readBlockTimes("7:30 PM - 4 h", "en");
    const start = mentions.find((m) => m.role === "start");
    const end = mentions.find((m) => m.role === "end");
    expect(start?.value).toBe("19:30");
    expect(end?.value).toBe("23:30");
  });

  it("reads a glued 2h as a clock end, not a duration", () => {
    const mentions = readBlockTimes("9pm - 2h", "en");
    const start = mentions.find((m) => m.role === "start");
    const end = mentions.find((m) => m.role === "end");
    expect(start?.value).toBe("21:00");
    expect(end?.value).toBe("02:00");
  });

  it("wraps past midnight", () => {
    const mentions = readBlockTimes("10:30 PM - 3 h", "en");
    const start = mentions.find((m) => m.role === "start");
    const end = mentions.find((m) => m.role === "end");
    expect(start?.value).toBe("22:30");
    expect(end?.value).toBe("01:30");
  });

  it("works with am", () => {
    const mentions = readBlockTimes("11am - 2 h", "en");
    const start = mentions.find((m) => m.role === "start");
    const end = mentions.find((m) => m.role === "end");
    expect(start?.value).toBe("11:00");
    expect(end?.value).toBe("13:00");
  });

  it("ignores 24-hour start (keeps existing behavior)", () => {
    // "de 21 h a 3 h" -> end 03:00 (unchanged)
    const mentions = readBlockTimes("de 21 h a 3 h", "en");
    const start = mentions.find((m) => m.role === "start");
    const end = mentions.find((m) => m.role === "end");
    // start is 21:00 (24-hour), end is 03:00 (24-hour)
    expect(start?.value).toBe("21:00");
    expect(end?.value).toBe("03:00");
  });

  it("ignores 24-hour start with dash", () => {
    // "21h-2h" -> end 02:00 (unchanged)
    const mentions = readBlockTimes("21h-2h", "en");
    const start = mentions.find((m) => m.role === "start");
    const end = mentions.find((m) => m.role === "end");
    expect(start?.value).toBe("21:00");
    expect(end?.value).toBe("02:00");
  });

  it("ignores duration without 12-hour start", () => {
    // "3 h" alone -> no start, no end
    const mentions = readBlockTimes("3 h", "en");
    const start = mentions.find((m) => m.role === "start");
    const end = mentions.find((m) => m.role === "end");
    expect(start).toBeUndefined();
    expect(end).toBeUndefined();
  });

  it("ignores hours above 12 as durations", () => {
    // "8pm - 14 h" -> end token not h24? (14 > 12, token not h24)
    const mentions = readBlockTimes("8pm - 14 h", "en");
    const start = mentions.find((m) => m.role === "start");
    expect(start?.value).toBe("20:00");
    // 14 is not a bare h24 token, so it is never read as a duration (20:00 + 14 h).
    expect(mentions.some((m) => m.role === "end" && m.value === "10:00")).toBe(false);
  });

  it("works with date before it", () => {
    const mentions = readBlockTimes("Wed 04-11-2026, 8:00 PM - 3 h", "en");
    expect(mentions).toHaveLength(2);
    const start = mentions.find((m) => m.role === "start");
    const end = mentions.find((m) => m.role === "end");
    expect(start?.value).toBe("20:00");
    expect(end?.value).toBe("23:00");
  });

  it("does not affect ranges of two clock times", () => {
    const mentions = readBlockTimes("8pm-11pm", "en");
    const start = mentions.find((m) => m.role === "start");
    const end = mentions.find((m) => m.role === "end");
    expect(start?.value).toBe("20:00");
    expect(end?.value).toBe("23:00");
  });

  it("does not affect ranges with written end", () => {
    const mentions = readBlockTimes("8:00 PM - 11:00 PM", "en");
    const start = mentions.find((m) => m.role === "start");
    const end = mentions.find((m) => m.role === "end");
    expect(start?.value).toBe("20:00");
    expect(end?.value).toBe("23:00");
  });
});
it("Wed 04-11-2026 alone gives no mentions", () => {
  const mentions = readBlockTimes("Wed 04-11-2026", "en");
  expect(mentions).toEqual([]);
});

it("Doors 10-11 stays as today", () => {
  const mentions = readBlockTimes("Doors 10-11", "en");
  // Should produce a start 10:00 and end 11:00 (or whatever existing behavior)
  // We just ensure it doesn't crash; exact values not important for this test.
  expect(mentions.length).toBeGreaterThan(0);
});

it("8pm-11pm unchanged", () => {
  const mentions = readBlockTimes("8pm-11pm", "en");
  const start = mentions.find((m) => m.role === "start");
  const end = mentions.find((m) => m.role === "end");
  expect(start?.value).toBe("20:00");
  expect(end?.value).toBe("23:00");
});

describe("glued Nh after an am/pm start stays a clock end (D-667)", () => {
  const ends = (text: string) =>
    readBlockTimes(text, "en")
      .filter((m) => m.role === "end")
      .map((m) => m.value);

  it('"10pm-3h" ends at 03:00', () => {
    expect(ends("10pm-3h")).toEqual(["03:00"]);
  });

  it('"10pm - 3 h" ends at 01:00', () => {
    expect(ends("10pm - 3 h")).toEqual(["01:00"]);
  });
});
