import { describe, expect, it } from "vitest";
import { wrongWeekdayScreen } from "@/src/pipeline/wrong-weekday";

// Daily check 2026-11-12 (cities-12): the model read of ruedalibre.co.uk/events wrote "Sambroso Cuban Sundays" on
// weekdays (11-04..11-07, 11-11, 11-12, 11-19). D-589's weekday screen now runs on model reads too (D-878).
describe("a weekly-day title on another night, in a model read or a shifted-clock site (D-589, D-878)", () => {
  it("screens a model read's Sunday night on a Thursday", () => {
    const r = wrongWeekdayScreen("Sambroso Cuban Sundays", "2026-11-19", { method: "llm" });
    expect(r?.kind).toBe("wrong_weekday");
  });

  it("keeps the model read's Sunday copy on the Sunday", () => {
    expect(
      wrongWeekdayScreen("Sambroso Cuban Sundays", "2026-11-15", { method: "llm" }),
    ).toBeNull();
  });

  it("still screens a shifted-clock site whatever the method (theronda.us)", () => {
    const r = wrongWeekdayScreen("Tango Mondays", "2026-11-03", {
      method: "jsonld",
      startTimesShifted: true,
    });
    expect(r?.kind).toBe("wrong_weekday");
  });

  it.each(["feed", "jsonld", "api", "manual", "serp"] as const)(
    "leaves a %s read's own dates alone",
    (method) => {
      expect(wrongWeekdayScreen("Sambroso Cuban Sundays", "2026-11-19", { method })).toBeNull();
    },
  );

  it("keeps a model read's title that names no weekly day, or two", () => {
    expect(wrongWeekdayScreen("Sunday Tea Dance", "2026-11-19", { method: "llm" })).toBeNull();
    expect(
      wrongWeekdayScreen("Salsa Fridays & Saturdays", "2026-11-19", { method: "llm" }),
    ).toBeNull();
  });
});
