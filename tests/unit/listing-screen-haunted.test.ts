import { describe, expect, it } from "vitest";
import { screenTitle } from "@/src/domain/listing-screen";

describe("screenTitle haunted houses (owner 2026-10-18)", () => {
  it("screens titles containing 'haunted' followed by house/mansion/maze/attraction/experience/hayride/trail", () => {
    for (const title of [
      "Haunted Mansion BK - Haunted House Experience",
      "Haunted Mansion BK – Haunted House Experience", // en dash
      "NYC Haunted Hayride",
      "Brooklyn Haunted Maze",
      "Haunted House Attraction",
      "Haunted Mansions Experience",
      "Haunted Hayride Trail",
    ]) {
      expect(screenTitle(title), title).toEqual({
        kind: "not_dance_scope",
        reason: "a haunted house (the owner lists none, 2026-10-18)",
      });
    }
  });

  it("keeps titles with 'haunted' but also a dance word", () => {
    for (const title of [
      "Haunted House Salsa Party",
      "Haunted Mansion Halloween Dance Party",
      "Haunted Halloween Bachata Night",
      "Haunted Ball",
      "Salsa Social at La Casita",
      "Haunted Swing Night",
      "Haunted Tango Class",
      "Haunted Zouk Experience", // contains "zouk" dance word
      "Haunted Kizomba Lesson",
      "Haunted Lindy Hop Party",
    ]) {
      expect(screenTitle(title), title).toBeNull();
    }
  });

  it("does not screen 'haunted' alone without a following pair word", () => {
    expect(screenTitle("Haunted Halloween Party")).toBeNull();
    expect(screenTitle("Haunted Night")).toBeNull();
  });
});
