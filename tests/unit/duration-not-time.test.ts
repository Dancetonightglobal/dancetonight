import { describe, expect, it } from "vitest";

import { timesFromText } from "@/src/domain/text-facts";
import { screenNoDance } from "@/src/domain/listing-screen";

describe("duration not a time (D-193)", () => {
  describe("timesFromText", () => {
    it("ignores durations after workshop/class words", () => {
      expect(timesFromText("-MONTHLY WORKSHOP 2H 45MIN SYSTEM RESET")).toEqual({
        lesson: null,
        dancing: null,
        evidence: {},
      });
      expect(timesFromText("workshop 2 hours")).toEqual({
        lesson: null,
        dancing: null,
        evidence: {},
      });
      expect(timesFromText("class 90 mins")).toEqual({
        lesson: null,
        dancing: null,
        evidence: {},
      });
    });

    it("finds lesson time after a duration", () => {
      const result = timesFromText("Workshop 2H 45MIN. Class at 7pm");
      expect(result.lesson).toBe("19:00");
      expect(result.dancing).toBeNull();
      expect(result.evidence.lesson_time).toContain("Class at 7pm");
    });

    it("keeps normal times unchanged", () => {
      expect(timesFromText("lesson 7pm")).toEqual({
        lesson: "19:00",
        dancing: null,
        evidence: { lesson_time: expect.any(String) },
      });
      expect(timesFromText("class 21h")).toEqual({
        lesson: "21:00",
        dancing: null,
        evidence: { lesson_time: expect.any(String) },
      });
      expect(timesFromText("social from 8:30")).toEqual({
        lesson: null,
        dancing: "20:30",
        evidence: { dancing_time: expect.any(String) },
      });
      expect(timesFromText("lesson at 7pm, social from 8:30")).toEqual({
        lesson: "19:00",
        dancing: "20:30",
        evidence: { lesson_time: expect.any(String), dancing_time: expect.any(String) },
      });
    });
  });

  describe("screenNoDance wellness sessions", () => {
    const baseListing = {
      title: "",
      styles: [] as string[],
      startsAt: new Date("2026-10-29T19:00:00Z"),
      nightDate: "2026-10-29",
      tz: "Europe/London",
    };
    const mixedSource = { mixedCalendar: true, styles: [] as string[] };
    const nonMixedSource = { mixedCalendar: false, styles: [] as string[] };

    it("screens out sound bath etc. on mixed calendar", () => {
      const listing = {
        ...baseListing,
        title: "Aerial Relaxation Pods - Sound Journey Gong Bath Meditation in Hammocks",
        styles: ["electronic"],
      };
      const result = screenNoDance(listing, mixedSource);
      expect(result).toEqual({
        kind: "not_dance_scope",
        reason: "a sound bath or meditation session, not a dance (D-193)",
      });
    });

    it("does not screen when mixedCalendar is false", () => {
      const listing = {
        ...baseListing,
        title: "Gong Bath Experience",
        styles: [],
      };
      const result = screenNoDance(listing, nonMixedSource);
      expect(result).toBeNull();
    });

    it("keeps a title that also says dance", () => {
      const listing = {
        ...baseListing,
        title: "Ecstatic Dance & Sound Bath",
        styles: ["ecstatic_dance"],
      };
      const result = screenNoDance(listing, mixedSource);
      expect(result).toBeNull();
    });

    it("screens breathwork", () => {
      const listing = {
        ...baseListing,
        title: "Breathwork Journey",
        styles: [],
      };
      const result = screenNoDance(listing, mixedSource);
      expect(result).toEqual({
        kind: "not_dance_scope",
        reason: "a sound bath or meditation session, not a dance (D-193)",
      });
    });

    it("screens yoga nidra", () => {
      const listing = {
        ...baseListing,
        title: "Yoga Nidra",
        styles: [],
      };
      const result = screenNoDance(listing, mixedSource);
      expect(result).toEqual({
        kind: "not_dance_scope",
        reason: "a sound bath or meditation session, not a dance (D-193)",
      });
    });
  });
});
