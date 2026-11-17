import { describe, expect, it } from "vitest";
import { LANGS, matchStyles, normalizeForMatch } from "@/config/styles";

describe("Arabic style words for Dubai and Beirut (D-1062)", () => {
  it("LANGS includes ar", () => {
    expect(LANGS).toContain("ar");
  });

  it("normalizeForMatch folds Arabic marks and letters", () => {
    // Arabic diacritics removed
    expect(normalizeForMatch("أمسية")).toBe(normalizeForMatch("امسية"));
    expect(normalizeForMatch("رَقْصٌ شَرْقِيّ")).toBe(normalizeForMatch("رقص شرقي"));
    // Alef maqsura and ta marbuta folding
    expect(normalizeForMatch("ليلى")).toBe(normalizeForMatch("ليلي"));
    expect(normalizeForMatch("سهرة")).toBe(normalizeForMatch("سهره"));
    // Turkish dotless ı still works
    expect(normalizeForMatch("TANGO AKŞAMI")).toBe("tango aksami");
  });

  it("matches salsa with Arabic prefix", () => {
    const result = matchStyles("سهرة سالسا كل خميس", ["ar"]);
    expect(result.styles).toContain("salsa");
  });

  it("matches bachata with attached prefix", () => {
    const result = matchStyles("والباتشاتا", ["ar"]);
    expect(result.styles).toContain("bachata");
  });

  it("matches belly dance with definite article", () => {
    const result = matchStyles("ليلة الرقص الشرقي", ["ar"]);
    expect(result.styles).toContain("belly_dance");
  });

  it("matches dabke with Arabic spelling variations", () => {
    const result = matchStyles("دبكة لبنانية", ["ar"]);
    expect(result.styles).toContain("dabke");
  });

  it("matches khaleeji only with dance context", () => {
    const result = matchStyles("رقص خليجي", ["ar"]);
    expect(result.styles).toContain("khaleeji");
    const noMatch = matchStyles("مطعم خليجي", ["ar"]);
    expect(noMatch.styles).toEqual([]);
  });

  it("does not match everyday Arabic words", () => {
    expect(matchStyles("حفلة", ["ar"]).styles).toEqual([]);
    expect(matchStyles("رقص", ["ar"]).styles).toEqual([]);
    expect(matchStyles("حفلة", ["ar"]).families).toEqual([]);
    expect(matchStyles("رقص", ["ar"]).families).toEqual([]);
  });

  it("weak Arabic generic words only count when nothing stronger", () => {
    const weakOnly = matchStyles("سهرة رقص", ["ar"]);
    expect(weakOnly.families).toContain("other");
    expect(weakOnly.styles).toEqual([]);

    const strongAndWeak = matchStyles("سهرة رقص سالسا", ["ar"]);
    expect(strongAndWeak.styles).toEqual(["salsa"]);
  });

  it("English title still matches when Arabic is enabled", () => {
    const result = matchStyles("Salsa night", ["ar"]);
    expect(result.styles).toContain("salsa");
  });

  it("CJK matching still works (regression test)", () => {
    // Example from existing tests: Japanese phrase
    const result = matchStyles("サルサ パーティー", ["ja"]);
    expect(result.styles).toContain("salsa");
  });

  it("keeps Arabic-Indic digits and folds alef variants in phrases (coverage review)", () => {
    expect(normalizeForMatch("سهرة ٩ مساءً")).toContain("٩");
    expect(matchStyles("أمسية تانغو", ["ar"]).styles).toEqual(
      matchStyles("امسية تانغو", ["ar"]).styles,
    );
    expect(matchStyles("أمسية تانغو", ["ar"]).styles.length).toBeGreaterThan(0);
  });

  it("does not read the sauce word as salsa", () => {
    expect(matchStyles("مطعم صلصة طماطم", ["ar"]).styles).toEqual([]);
  });
});
