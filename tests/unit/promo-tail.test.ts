// D-825: a card's start-time line and sales badge are not part of its title. Penthouse Dubai's cards print
// the title, then "FROM 8PM", then a "🔥SELLING FAST" badge (hidden or not); a read that runs them together
// stored "X FROM 8PM 🔥SELLING FAST" beside "X" for the same night, and both were listed.

import { describe, expect, it } from "vitest";

import { removePromoTail } from "@/src/domain/promo-tail";
import { tidyTitle } from "@/src/domain/title-tidy";

describe("removePromoTail", () => {
  it.each([
    ["SKYLINE THURSDAYS FROM 8PM 🔥SELLING FAST", "SKYLINE THURSDAYS"],
    ["SKYLINE THURSDAYS FROM 8PM", "SKYLINE THURSDAYS"],
    ["ToyRoom | Mash-Up Fridays FROM 10PM 🔥", "ToyRoom | Mash-Up Fridays"],
    ["Ladies Night from 9:30 pm", "Ladies Night"],
    ["Afro Night 🔥SELLING FAST", "Afro Night"],
    ["Afro Night - SOLD OUT", "Afro Night"],
    ["Afro Night (Almost Sold Out)", "Afro Night"],
    ["Brunch Beats FULLY REDEEMABLE", "Brunch Beats"],
    ["Salsa Night | Selling Fast 🔥", "Salsa Night"],
    ["Salsa Night 🔥🔥", "Salsa Night"],
    ["Latin Night FROM 10PM 🔥 SOLD OUT", "Latin Night"],
    // D-875: Eagle NYC prints the cover after the DJs.
    ["🎧 DJ CUNNINGHAM | $10 CASH COVER", "🎧 DJ CUNNINGHAM"],
    ["🎧 DJ ALEX RAMOS + 🎧 DJ MARK CICERO | $25", "🎧 DJ ALEX RAMOS + 🎧 DJ MARK CICERO"],
    ["JOCKSTRAP WEDNESDAY 🎧 IPOK | $20 CASH COVER", "JOCKSTRAP WEDNESDAY 🎧 IPOK"],
    ["Salsa Social - £8 entry", "Salsa Social"],
    ["Milonga · 12€ at the door", "Milonga"],
    ["Bachata Night | $15 cover", "Bachata Night"],
    // No separator, a price in the middle, or nothing left but the price: unchanged.
    ["$5 Salsa Night", "$5 Salsa Night"],
    // After a dash a bare price names a ticket (run 33 replay), so it stays.
    [
      "Students & Young Adults 16–18 ( Must Show ID) – $10",
      "Students & Young Adults 16–18 ( Must Show ID) – $10",
    ],
    ["Swing | $10 lesson + social", "Swing | $10 lesson + social"],
    ["Salsa $10", "Salsa $10"],
    ["$10 | $5", "$10 | $5"],
  ])("%s -> %s", (input, expected) => {
    expect(removePromoTail(input)).toBe(expected);
  });

  it.each([
    "SKYLINE THURSDAYS",
    "From Dusk Till Dawn",
    "Salsa From Scratch",
    "Bachata from the Heart",
    "Sold Out Salsa Social", // the words lead the title: they are its name
    "Fire 🔥 Salsa Night", // an emoji inside the title stays
    "Live From 8 Mile",
  ])("leaves %s alone", (title) => {
    expect(removePromoTail(title)).toBe(title);
  });

  it("never empties a title: a title that is only a badge stays", () => {
    expect(removePromoTail("SOLD OUT")).toBe("SOLD OUT");
    expect(removePromoTail("🔥SELLING FAST")).toBe("🔥SELLING FAST");
    expect(removePromoTail("FROM 8PM")).toBe("FROM 8PM");
  });

  it("trims what it leaves", () => {
    expect(removePromoTail("  Afro Night   🔥SELLING FAST  ")).toBe("Afro Night");
  });
});

describe("tidyTitle", () => {
  it("drops a card's time line and badge", () => {
    expect(tidyTitle("SKYLINE THURSDAYS FROM 8PM 🔥SELLING FAST", "2026-11-12")).toBe(
      "SKYLINE THURSDAYS",
    );
    expect(tidyTitle("ToyRoom | Mash-Up Fridays FROM 10PM 🔥", null)).toBe(
      "ToyRoom | Mash-Up Fridays",
    );
  });
});
