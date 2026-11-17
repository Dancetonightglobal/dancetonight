import { describe, expect, it } from "vitest";
import { LANGS, matchStyles, normalizeForMatch } from "@/config/styles";

describe("Hindi and Marathi (Devanagari) style words for Mumbai (D-620)", () => {
  it("LANGS contains hi and mr", () => {
    expect(LANGS).toContain("hi");
    expect(LANGS).toContain("mr");
  });

  it("normalizeForMatch keeps Devanagari vowel signs", () => {
    // Devanagari text should remain whole, not split into individual consonants
    expect(normalizeForMatch("बॉलीवुड नाइट")).toBe("बॉलीवुड नाइट");
    // Ensure other normalizations still work
    expect(normalizeForMatch("Café Olé")).toBe("cafe ole");
  });

  it("matches Bollywood in Hindi/Marathi", () => {
    const result = matchStyles("शनिवार बॉलीवुड नाइट @ बांद्रा", ["en", "hi", "mr"]);
    expect(result.styles).toContain("bollywood");
  });

  it("matches Garba in Hindi/Marathi", () => {
    const result = matchStyles("नवरात्रि गरबा और डांडिया रास", ["en", "hi", "mr"]);
    expect(result.styles).toContain("garba");
  });

  it("matches Bhangra in Hindi", () => {
    const result = matchStyles("भांगड़ा नाइट", ["hi"]);
    expect(result.styles).toContain("bhangra");
  });

  it("matches DJ night in Marathi", () => {
    const result = matchStyles("डीजे नाईट", ["mr"]);
    expect(result.styles).toContain("dj_night");
  });

  it("does not use Hindi words for a metro without hi", () => {
    const result = matchStyles("बॉलीवुड नाइट", ["es"]);
    expect(result.styles).toEqual([]);
  });

  it("preserves existing behaviour for other scripts", () => {
    // Japanese Bollywood should still match
    const jaResult = matchStyles("ボリウッドダンス", ["ja"]);
    expect(jaResult.styles).toContain("bollywood");
    // Chinese bachata should still match
    const zhResult = matchStyles("巴恰塔之夜", ["zh"]);
    expect(zhResult.styles).toContain("bachata");
    // English Bollywood should still match
    const enResult = matchStyles("Bollywood Night at Kitty Su", ["en", "hi", "mr"]);
    expect(enResult.styles).toContain("bollywood");
  });
});
