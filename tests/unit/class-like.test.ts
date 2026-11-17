import { describe, expect, it } from "vitest";
import { isClassLike } from "@/src/domain/class-like";

describe("isClassLike", () => {
  it("returns true for listingType class", () => {
    expect(isClassLike({ title: "Anything", listingType: "class" })).toBe(true);
  });

  it("returns true for listingType practica", () => {
    expect(isClassLike({ title: "Anything", listingType: "practica" })).toBe(true);
  });

  it("returns true for title containing class words", () => {
    expect(isClassLike({ title: "Swingiversity Level 1", listingType: null })).toBe(true);
    expect(isClassLike({ title: "Level 2+ Choreo", listingType: null })).toBe(true);
    expect(isClassLike({ title: "Lindy Hop Class", listingType: null })).toBe(true);
    expect(isClassLike({ title: "Guided Practice", listingType: null })).toBe(true);
    expect(isClassLike({ title: "Beginner Bachata Bootcamp", listingType: null })).toBe(true);
    expect(
      isClassLike({
        title: "West Coast Swing Workshop",
        listingType: null,
      }),
    ).toBe(true);
    expect(isClassLike({ title: "Salsa Technique", listingType: null })).toBe(true);
    expect(isClassLike({ title: "Intermediate Drills", listingType: null })).toBe(true);
    expect(isClassLike({ title: "Fundamentals Course", listingType: null })).toBe(true);
  });

  it("returns true for level followed by number", () => {
    expect(isClassLike({ title: "Level 1", listingType: null })).toBe(true);
    expect(isClassLike({ title: "Level 2+", listingType: null })).toBe(true);
    expect(isClassLike({ title: "Level three", listingType: null })).toBe(true);
    expect(isClassLike({ title: "Level IV", listingType: null })).toBe(true);
    expect(isClassLike({ title: "Level ii", listingType: null })).toBe(true);
  });

  it("returns false for non-class titles", () => {
    expect(
      isClassLike({
        title: "Sabado de Parranda",
        listingType: null,
      }),
    ).toBe(false);
    expect(
      isClassLike({
        title: "Salsa Sundays Colombian Latin Dance Party",
        listingType: null,
      }),
    ).toBe(false);
    expect(isClassLike({ title: "Friday Night Swing", listingType: null })).toBe(false);
    expect(isClassLike({ title: "Level Up Latin Night", listingType: null })).toBe(false);
    expect(isClassLike({ title: "Bachata Social", listingType: null })).toBe(false);
    expect(isClassLike({ title: "Salsa Class & Social", listingType: null })).toBe(true); // contains "class"
    expect(isClassLike({ title: "Salsa Night", listingType: null })).toBe(false);
  });

  it("handles mixed case and punctuation", () => {
    expect(isClassLike({ title: "West Coast Swing WORKSHOP!", listingType: null })).toBe(true);
    expect(isClassLike({ title: "Beginner's Bootcamp", listingType: null })).toBe(true);
  });
});
