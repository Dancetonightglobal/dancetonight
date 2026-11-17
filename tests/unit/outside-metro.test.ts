import { describe, expect, it } from "vitest";
import { outsideMatch, type OutsideListing } from "@/src/pipeline/outside-metro";

describe("outsideMatch", () => {
  const outside: OutsideListing[] = [
    { title: "FURBALL P'Town Howl @ Spooky Bear Weekend", night: "2026-10-29" },
    { title: "Let's Be Friends", night: "2026-10-30" },
    { title: "Salsa Night Boston", night: "2026-10-31" },
  ];

  it("exact match true", () => {
    const row = {
      id: "1",
      title: "FURBALL P'Town Howl @ Spooky Bear Weekend",
      nightDate: "2026-10-29",
    };
    const listed = new Set<string>();
    expect(outsideMatch(outside, row, listed)).toBe(true);
  });

  it("exact match true even when row id is listed", () => {
    const row = {
      id: "1",
      title: "FURBALL P'Town Howl @ Spooky Bear Weekend",
      nightDate: "2026-10-29",
    };
    const listed = new Set(["1"]);
    // exact match overrides listed check
    expect(outsideMatch(outside, row, listed)).toBe(true);
  });

  it("loose match with similar titles", () => {
    const row = { id: "2", title: "FURBALL P'TOWN Howl", nightDate: "2026-10-29" };
    const listed = new Set<string>();
    // rowNorm = "furbal p town howl", entryNorm = "furbal p town howl @ spooky bear weekend"
    // shorter length >= 8, longer includes shorter
    expect(outsideMatch(outside, row, listed)).toBe(true);
  });

  it("loose match but different night -> false", () => {
    const row = { id: "3", title: "FURBALL P'TOWN Howl", nightDate: "2026-10-28" };
    const listed = new Set<string>();
    expect(outsideMatch(outside, row, listed)).toBe(false);
  });

  it("loose match but row id in listedIds -> false", () => {
    const row = { id: "4", title: "FURBALL P'TOWN Howl", nightDate: "2026-10-29" };
    const listed = new Set(["4"]);
    expect(outsideMatch(outside, row, listed)).toBe(false);
  });

  it("short title (under 8 normalized chars) inside longer -> false", () => {
    const row = { id: "5", title: "Salsa", nightDate: "2026-10-31" };
    const listed = new Set<string>();
    // rowNorm = "salsa" length 5 < 8
    expect(outsideMatch(outside, row, listed)).toBe(false);
  });

  it("unrelated titles same night -> false", () => {
    const row = { id: "6", title: "Tango Night", nightDate: "2026-10-29" };
    const listed = new Set<string>();
    expect(outsideMatch(outside, row, listed)).toBe(false);
  });
});
