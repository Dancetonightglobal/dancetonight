import { screenTitle } from "@/src/domain/listing-screen";
import { describe, it, expect } from "vitest";

describe("screenTitle language/craft/casting (D-588)", () => {
  it.each([
    "Model Casting",
    "Language • ADULT ITALIAN CLASSES",
    "Hands & Heritage: Italian Crochet Class",
    "Spanish Conversation Group",
    "Corso di italiano",
    "Clases de francés",
    "Knit Night",
    "Open Auditions",
    "English Lesson",
  ])("screens %s", (title) => {
    const result = screenTitle(title);
    expect(result).not.toBeNull();
    expect(result!.kind).toBe("not_dance_scope");
    expect(result!.reason).toContain("D-588");
  });

  it.each([
    "Salsa & Spanish Classes",
    "Bachata Classes",
    "Italian Night with Tarantella Dancing",
    "Castillo Salsa Social",
    "Greek Night: Live Bouzouki and Dancing",
    "Tango Lessons",
    "Swing Dance Class",
  ])("does not screen %s with D-588 reason", (title) => {
    const result = screenTitle(title);
    if (result === null) {
      // passes
    } else {
      expect(result.reason).not.toContain("D-588");
    }
  });
});
