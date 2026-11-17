import { describe, expect, it } from "vitest";

import { coreTitleWords, coreTitleKey } from "@/src/domain/dedupe";

describe("coreTitleWords presents removal", () => {
  it("removes INPUT pres LUCIID", () => {
    expect(coreTitleWords("INPUT pres LUCIID")).toEqual(["luciid"]);
  });

  it("removes Input Pres. LUCIID", () => {
    expect(coreTitleWords("Input Pres. LUCIID")).toEqual(["luciid"]);
  });

  it("removes Razzmatazz presents: Bad Gyal", () => {
    expect(coreTitleWords("Razzmatazz presents: Bad Gyal")).toEqual(["bad", "gyal"]);
  });

  it("removes Salsa Caliente presenta Noche de Salsa", () => {
    expect(coreTitleWords("Salsa Caliente presenta Noche de Salsa")).toEqual([
      "noche",
      "de",
      "salsa",
    ]);
  });

  it("does not remove when 5+ promoter words (The Lindy Hop Society Of Barcelona presents Swing)", () => {
    // 5 words before presents, so prefix not removed; then leading article "the" is dropped
    expect(coreTitleWords("The Lindy Hop Society Of Barcelona presents Swing")).toEqual([
      "lindy",
      "hop",
      "society",
      "of",
      "barcelona",
      "presents",
      "swing",
    ]);
  });

  it("does not remove when nothing remains after (Presents alone)", () => {
    expect(coreTitleWords("Presents")).toEqual(["presents"]);
  });

  it("does not remove when nothing remains after (DJ presents)", () => {
    expect(coreTitleWords("DJ presents")).toEqual(["dj", "presents"]);
  });

  it("does not remove when pres is not a whole word (Pressure Point)", () => {
    expect(coreTitleWords("Pressure Point")).toEqual(["pressure", "point"]);
  });

  it("does not remove when pres is not a whole word (Presidents Ball)", () => {
    expect(coreTitleWords("Presidents Ball")).toEqual(["presidents", "ball"]);
  });

  it("does not remove when nothing after (Bachata Presents)", () => {
    expect(coreTitleWords("Bachata Presents")).toEqual(["bachata", "presents"]);
  });

  it("handles presentan (plural)", () => {
    expect(coreTitleWords("Club presentan Artist")).toEqual(["artist"]);
  });

  it("handles presenten", () => {
    expect(coreTitleWords("Grupo presenten Show")).toEqual(["show"]);
  });

  it("handles dash after presents", () => {
    expect(coreTitleWords("Club presents - Artist")).toEqual(["artist"]);
  });

  it("handles em-dash after presents", () => {
    expect(coreTitleWords("Club presents — Artist")).toEqual(["artist"]);
  });
});

describe("coreTitleKey with presents", () => {
  it("INPUT pres LUCIID and LUCIID give the same key", () => {
    expect(coreTitleKey("INPUT pres LUCIID")).toBe(coreTitleKey("LUCIID"));
  });
});
