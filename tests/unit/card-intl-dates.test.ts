import { describe, it, expect } from "vitest";
import { dateTimePart, datesOrNamesWeekday } from "@/src/domain/text-facts";

describe("card-intl-dates", () => {
  describe("dateTimePart", () => {
    const cases = [
      { line: "Vie, 30 Oct", lang: "es", expected: "Vie, 30 Oct" },
      { line: "Sáb 1 Nov 22:00", lang: "es", expected: "Sáb 1 Nov 22:00" },
      {
        line: "Jueves 6 de noviembre 23:00",
        lang: "es",
        expected: "Jueves 6 de noviembre 23:00",
      },
      {
        line: "Sexta-feira, 31 out",
        lang: "pt",
        expected: "Sexta-feira",
      },
      {
        line: "Sexta-feira, 31 de outubro, 22h",
        lang: "pt",
        expected: "Sexta-feira, 31 de outubro, 22h",
      },
      {
        line: "Dissabte 1 de novembre · 23:30 · Sala Apolo",
        lang: "ca",
        expected: (result: string | null) =>
          result && result.startsWith("Dissabte 1 de novembre") && !result.includes("Apolo"),
      },
      {
        line: "Sáb 1 Nov 22:00 · Club Uno",
        lang: "es",
        expected: (result: string | null) =>
          result && result.startsWith("Sáb 1 Nov 22:00") && !result.includes("Club"),
      },
      { line: "Salsa Night", lang: "en", expected: null },
      { line: "Noche de Salsa", lang: "es", expected: null },
      { line: "DJ Set", lang: "en", expected: null },
      { line: "Sold out", lang: "en", expected: null },
      {
        line: "Thu, Oct 1, 8:00 PM EDT",
        lang: "en",
        expected: "Thu, Oct 1, 8:00 PM EDT",
      },
    ] as const;

    for (const { line, lang, expected } of cases) {
      it(`"${line}" (${lang})`, () => {
        const result = dateTimePart(line, lang);
        if (typeof expected === "function") {
          expect(expected(result)).toBe(true);
        } else {
          expect(result).toBe(expected);
        }
      });
    }
  });

  describe("datesOrNamesWeekday", () => {
    it("returns true for Spanish weekday", () => {
      expect(datesOrNamesWeekday("Sáb", "es")).toBe(true);
    });
    it("returns false for non-date word", () => {
      expect(datesOrNamesWeekday("Club Uno", "es")).toBe(false);
    });
  });
});
