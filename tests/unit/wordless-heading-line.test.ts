// D-824: a line with no words ("🔥", "—", "★★★", "|") is not a weekday heading. CE LA VI Dubai's
// events page failed every read with "undefined is not iterable" (text-facts.ts weekdayHeading):
// weeklyGridSection folds each line on its own, and a line of only emoji or rules folds to a page
// with no lines, so reading its line 0 threw.

import { describe, expect, it } from "vitest";

import { foldPage, weeklyHeadingDays } from "@/src/domain/text-facts";
import { weeklyGridSection } from "@/src/pipeline/weekly-grid";

describe("a line with no words", () => {
  it.each(["🔥", "—", "★★★", "|", "🔥🔥 · 🔥🔥"])("%s is not a weekly heading", (line) => {
    const page = foldPage(line);
    expect(page.lines).toHaveLength(0);
    expect(weeklyHeadingDays(page, 0, "en")).toBeNull();
  });

  it("a line past the page's last is not a heading either", () => {
    expect(weeklyHeadingDays(foldPage("MONDAYS"), 5, "en")).toBeNull();
  });

  it("a weekday heading still reads", () => {
    expect(weeklyHeadingDays(foldPage("MONDAYS"), 0, "en")).toEqual(["MO"]);
  });

  it("a section with an emoji line reads past it to the next heading", () => {
    const text = ["MONDAYS", "🔥", "Salsa Night 9pm", "—", "TUESDAYS", "Bachata Social 8pm"].join(
      "\n",
    );
    const section = weeklyGridSection(text, "MONDAYS", "en");
    expect(section).not.toBeNull();
    expect(section).toContain("Salsa Night 9pm");
    expect(section).toContain("🔥");
    expect(section).not.toContain("Bachata Social");
  });
});
