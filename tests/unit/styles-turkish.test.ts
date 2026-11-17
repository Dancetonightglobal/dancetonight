import { describe, expect, it } from "vitest";
import { LANGS, matchStyles, normalizeForMatch } from "@/config/styles";

describe("Turkish style words for Istanbul (D-682)", () => {
  it("LANGS includes tr", () => {
    expect(LANGS).toContain("tr");
  });

  it("normalizeForMatch folds dotless ı to i", () => {
    // Turkish dotless ı should become i
    expect(normalizeForMatch("TANGO AKŞAMI")).toBe("tango aksami");
    expect(normalizeForMatch("tango akşamı")).toBe("tango aksami");
    // Capital dotted İ already becomes i via NFKD
    expect(normalizeForMatch("İSTANBUL")).toBe("istanbul");
    expect(normalizeForMatch("istanbul")).toBe("istanbul");
  });

  it("keeps Tango dans gecesi as tango only, with no DJ night (D-682 weak words)", () => {
    const result = matchStyles("Tango dans gecesi", ["tr"]);
    expect(result.families).toEqual(["tango"]);
    expect(result.styles).not.toContain("dj_night");
  });

  it("matches Salsa Gecesi to salsa", () => {
    const result = matchStyles("Salsa Gecesi", ["tr"]);
    expect(result.styles).toContain("salsa");
  });

  it("matches Cuma Bachata Partisi to bachata", () => {
    const result = matchStyles("Cuma Bachata Partisi", ["tr"]);
    expect(result.styles).toContain("bachata");
  });

  it("matches Kizomba Dersi ve Parti to kizomba", () => {
    const result = matchStyles("Kizomba Dersi ve Parti", ["tr"]);
    expect(result.styles).toContain("kizomba");
  });

  it("matches TANGO AKŞAMI to milonga", () => {
    const result = matchStyles("TANGO AKŞAMI", ["tr"]);
    expect(result.styles).toContain("milonga");
  });

  it("matches Arjantin Tangosu Milongası to milonga", () => {
    const result = matchStyles("Arjantin Tangosu Milongası", ["tr"]);
    expect(result.styles).toContain("milonga");
  });

  it("matches Swing Dans Gecesi to lindy_hop", () => {
    const result = matchStyles("Swing Dans Gecesi", ["tr"]);
    expect(result.styles).toContain("lindy_hop");
  });

  it("matches Oryantal Dans Gecesi to belly_dance", () => {
    const result = matchStyles("Oryantal Dans Gecesi", ["tr"]);
    expect(result.styles).toContain("belly_dance");
  });

  it("matches Halay Gecesi to turkish_folk", () => {
    const result = matchStyles("Halay Gecesi", ["tr"]);
    expect(result.styles).toContain("turkish_folk");
  });

  it("matches Halk Oyunları to turkish_folk", () => {
    const result = matchStyles("Halk Oyunları", ["tr"]);
    expect(result.styles).toContain("turkish_folk");
  });

  it("matches Roman Havası Gecesi to balkan", () => {
    const result = matchStyles("Roman Havası Gecesi", ["tr"]);
    expect(result.styles).toContain("balkan");
  });

  it("matches Tekno Gecesi: Klein to techno", () => {
    const result = matchStyles("Tekno Gecesi: Klein", ["tr"]);
    expect(result.styles).toContain("techno");
  });

  it("does not match generic Turkish words", () => {
    expect(matchStyles("Türkü Gecesi", ["tr"]).styles).toEqual([]);
    expect(matchStyles("Akşam Yemeği", ["tr"]).styles).toEqual([]);
    expect(matchStyles("Gece Konseri", ["tr"]).styles).toEqual([]);
    expect(matchStyles("Stand-up Gecesi", ["tr"]).styles).toEqual([]);
  });

  it("English title still matches as before", () => {
    const result = matchStyles("Salsa Night", ["tr", "en"]);
    expect(result.styles).toContain("salsa");
  });
});
