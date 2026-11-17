import { describe, expect, it } from "vitest";
import { titleIsPartOf } from "@/src/pipeline/dedupe-review";

describe("titleIsPartOf", () => {
  it("returns true when short is a whole part of long", () => {
    expect(
      titleIsPartOf(
        "Último Embrasa do Ano",
        "BAILE | EMBRASA: DJ SAZE + DJ Lorrany | Último Embrasa do Ano",
      ),
    ).toBe(true);
  });

  it("returns true with accents/case normalization", () => {
    expect(titleIsPartOf("ultimo embrasa do ano", "BAILE | Último Embrasa do Ano")).toBe(true);
  });

  it("returns true for hyphen separator", () => {
    expect(titleIsPartOf("Salsa Night", "Salsa Night - Live Band")).toBe(true);
  });

  it("returns false for too short part", () => {
    expect(titleIsPartOf("TBA", "Loco Carnaval | TBA")).toBe(false);
  });

  it("returns false when part doesn't match exactly", () => {
    expect(titleIsPartOf("Salsa Night", "Salsa Nights at Copa")).toBe(false);
  });

  it("returns false for single part/equal titles", () => {
    expect(titleIsPartOf("Salsa Night", "Salsa Night")).toBe(false);
  });

  it("returns false when part is not whole", () => {
    expect(titleIsPartOf("Embrasa do Ano", "BAILE | Último Embrasa do Ano")).toBe(false);
  });
});
