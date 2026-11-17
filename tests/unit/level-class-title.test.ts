import { describe, expect, it } from "vitest";

import { listingTypeFromText, mentionsClass } from "@/src/domain/text-facts";
import { decideStyles } from "@/src/pipeline/normalize";

describe("level-class-title (D-602)", () => {
  describe("listingTypeFromText for level titles", () => {
    it.each([
      "Level 1 - Newcomer West Coast Swing",
      "Level 2 - Novice West Coast Swing",
      "Level 3 - Intermediate West Coast Swing",
      "Level 2: Novice WCS",
      "Level 3 Intermediate Salsa",
    ])("reads %s as class", (title) => {
      expect(
        listingTypeFromText(title, "Stay for The Swing Space Social Dance at 8:30pm", [
          "west_coast_swing",
        ]).type,
      ).toBe("class");
    });

    it("reads 'Level 3 Rooftop Party' as club_night (not class)", () => {
      expect(listingTypeFromText("Level 3 Rooftop Party").type).toBe("club_night");
      expect(mentionsClass("Level 3 Rooftop Party")).toBe(false);
    });

    it("reads 'Level 2 Salsa' as other (no separator, no skill word)", () => {
      expect(listingTypeFromText("Level 2 Salsa").type).toBe("other");
    });

    it("reads 'Level 2 - Salsa Social' as social (social rule comes first)", () => {
      expect(listingTypeFromText("Level 2 - Salsa Social").type).toBe("social");
    });

    it("mentionsClass returns true for level-with-separator titles", () => {
      expect(mentionsClass("Level 1 - Newcomer West Coast Swing")).toBe(true);
    });
  });

  describe("decideStyles for generic family titles", () => {
    it("uses source hint when title names only generic 'other' family", () => {
      const result = decideStyles(
        { styles: [], title: "The Swing Space Social Dance" },
        ["west_coast_swing"],
        "social",
      );
      expect(result).toEqual({
        styles: ["west_coast_swing"],
        stylesFrom: "source_hint",
      });
    });

    it("falls back to other when source has zero styles", () => {
      const result = decideStyles(
        { styles: [], title: "The Swing Space Social Dance" },
        [],
        "social",
      );
      expect(result.styles).toEqual(["other"]);
      expect(result.stylesFrom).toBe("title");
    });

    it("falls back to other when source has two styles (no single hint)", () => {
      const result = decideStyles(
        { styles: [], title: "The Swing Space Social Dance" },
        ["west_coast_swing", "salsa"],
        "social",
      );
      expect(result.styles).toEqual(["other"]);
      expect(result.stylesFrom).toBe("title");
    });

    it("keeps title's own style when title names a real style", () => {
      const result = decideStyles(
        { styles: [], title: "Salsa Social Dance" },
        ["west_coast_swing"],
        "social",
      );
      expect(result.styles).toContain("salsa");
      expect(result.styles).not.toContain("west_coast_swing");
    });

    it("respects explicitly listed styles over source hint", () => {
      const result = decideStyles(
        { styles: ["blues"], title: "The Swing Space Social Dance" },
        ["west_coast_swing"],
        "social",
      );
      expect(result.styles).toEqual(["blues"]);
      expect(result.stylesFrom).toBe("source_listing");
    });
  });
});
