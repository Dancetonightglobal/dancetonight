import { describe, it, expect } from "vitest";
import { groupNotes } from "@/src/pipeline/ingest";

describe("groupNotes", () => {
  it("returns empty array for empty input", () => {
    expect(groupNotes([])).toEqual([]);
  });

  it("returns same array for distinct notes", () => {
    expect(groupNotes(["a", "b"])).toEqual(["a", "b"]);
  });

  it("groups repeated notes with counts", () => {
    expect(groupNotes(["a", "b", "a", "a", "c", "b"])).toEqual(["a (x3)", "b (x2)", "c"]);
  });

  it("handles many identical notes followed by a different one", () => {
    const repeatedNote =
      "Salsa Nights at El Rincón de la Salsa: not in Mexico City (the listing gives El Rincón de la Salsa)";
    const notes = Array(8).fill(repeatedNote).concat("Clase de Bachata: a class");
    expect(groupNotes(notes)).toEqual([`${repeatedNote} (x8)`, "Clase de Bachata: a class"]);
  });
});
