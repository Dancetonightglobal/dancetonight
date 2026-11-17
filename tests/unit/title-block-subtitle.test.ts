import { describe, expect, it } from "vitest";

import { titleBlocks } from "@/src/domain/title-blocks";

describe("title-blocks subtitle before rule line", () => {
  // Edge case 1: Tipitina's card with subtitle, rule, bare weekday, date, times
  it("includes times after rule line with subtitle (Tipitina's layout)", () => {
    const pageText = `Tipitina's Presents
Love In The Club
2000's Hip-Hop & R&B Dance Party Featuring DJ New Era
------------------------------------------------------------------
Fri
Nov 27, 2026
Doors:
8:00 pm
/
Show:
9:00 pm
Ages 18 and Up

Tipitina's Presents
The Dirty Dozen Brass Band
------------------------------------------------------------------
Sat
Nov 28, 2026
Doors:
7:00 pm
/
Show:
8:00 pm
Ages 18 and Up`;

    const titles = ["Love In The Club", "The Dirty Dozen Brass Band"];
    const blocks = titleBlocks(pageText, "Love In The Club", titles, "en");
    const block = blocks[0]!;
    const text = pageText.slice(block.start, block.end);
    expect(text).toContain("8:00 pm");
    expect(text).toContain("9:00 pm");
    expect(text).toContain("Ages 18 and Up");
    expect(text).not.toContain("Dirty Dozen");
  });

  // Edge case 2: subtitle, no rule, date line ends block
  it("does NOT include time after subtitle without rule", () => {
    const pageText = `Swing Night

A night of lindy

Oct 29, 2026

9:00 pm`;
    const blocks = titleBlocks(pageText, "Swing Night", [], "en");
    const block = blocks[0]!;
    const text = pageText.slice(block.start, block.end);
    expect(text).not.toContain("9:00 pm");
  });

  // Edge case 3: three plain lines then rule -> date after rule ends block
  it("does NOT include time after rule with three plain lines before", () => {
    const pageText = `Swing Night

One

Two

Three

-----

Fri
Oct 30, 2026

8:00 pm`;
    const blocks = titleBlocks(pageText, "Swing Night", [], "en");
    const block = blocks[0]!;
    const text = pageText.slice(block.start, block.end);
    expect(text).not.toContain("8:00 pm");
  });

  // Edge case 4: line before rule has a clock, not plain -> rule does not reset
  it("does NOT include time after rule when line before rule has a clock", () => {
    const pageText = `Swing Night

9:00 pm

-----

Fri
Oct 30, 2026

10:00 pm`;
    const blocks = titleBlocks(pageText, "Swing Night", [], "en");
    const block = blocks[0]!;
    const text = pageText.slice(block.start, block.end);
    expect(text).not.toContain("10:00 pm");
  });
});
