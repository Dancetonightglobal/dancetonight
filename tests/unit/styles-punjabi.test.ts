import { describe, expect, it } from "vitest";
import { LANGS, matchStyles, normalizeForMatch } from "@/config/styles";

describe("Punjabi (Gurmukhi) style words for Delhi (D-1141)", () => {
  it("LANGS contains pa", () => {
    expect(LANGS).toContain("pa");
  });

  it("normalizeForMatch keeps Gurmukhi vowel signs and tippi/addak", () => {
    // Gurmukhi text should remain whole, not split into individual consonants
    expect(normalizeForMatch("ਭੰਗੜਾ ਨਾਈਟ")).toBe("ਭੰਗੜਾ ਨਾਈਟ");
    // Ensure other normalizations still work
    expect(normalizeForMatch("Café Olé")).toBe("cafe ole");
  });

  it("matches bhangra in Punjabi", () => {
    const result = matchStyles("ਸ਼ਨੀਵਾਰ ਭੰਗੜਾ ਨਾਈਟ", ["en", "hi", "pa"]);
    expect(result.styles).toContain("bhangra");
  });

  it("matches bhangra from Punjabi night", () => {
    const result = matchStyles("ਪੰਜਾਬੀ ਨਾਈਟ ਗੁਰੂਗ੍ਰਾਮ", ["pa"]);
    expect(result.styles).toContain("bhangra");
  });

  it("matches bollywood in Punjabi", () => {
    const result = matchStyles("ਬਾਲੀਵੁੱਡ ਪਾਰਟੀ", ["pa"]);
    expect(result.styles).toContain("bollywood");
  });

  it("matches dj_night in Punjabi", () => {
    const result = matchStyles("ਡੀਜੇ ਨਾਈਟ", ["pa"]);
    expect(result.styles).toContain("dj_night");
  });

  it("matches garba in Punjabi", () => {
    const result = matchStyles("ਗਰਬਾ ਤੇ ਡਾਂਡੀਆ", ["pa"]);
    expect(result.styles).toContain("garba");
  });

  it("does not use Punjabi words for a metro without pa", () => {
    const result = matchStyles("ਭੰਗੜਾ ਨਾਈਟ", ["en", "hi"]);
    expect(result.styles).toEqual([]);
  });

  it("false friends stay unmatched for pa", () => {
    // Punjabi food
    expect(matchStyles("ਪੰਜਾਬੀ ਖਾਣਾ", ["pa"]).styles).toEqual([]);
    // Punjabi poetry evening
    expect(matchStyles("ਪੰਜਾਬੀ ਕਵਿਤਾ ਦੀ ਸ਼ਾਮ", ["pa"]).styles).toEqual([]);
  });

  it("Hindi still works alongside pa", () => {
    const result = matchStyles("भांगड़ा नाइट", ["en", "hi", "pa"]);
    expect(result.styles).toContain("bhangra");
  });
});
