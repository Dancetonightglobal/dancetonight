import { describe, expect, it } from "vitest";
import { tidyTitle } from "@/src/domain/title-tidy";

// D-1042: Paris sources write the night out in French at the end of a title.
// The card already shows the night and start time, so tidyTitle drops that tail.

describe("tidyTitle: a French weekday-and-date tail (D-1042)", () => {
  it('drops "| WEEKDAY DAY MONTH - HOUR"', () => {
    expect(
      tidyTitle("Soirée Salsa au Barrio Latino | Vendredi 6 novembre - 23h", "2026-11-06"),
    ).toBe("Soirée Salsa au Barrio Latino");
    expect(tidyTitle("Bal Swing | samedi 7 novembre 2026 à 20h30", "2026-11-07")).toBe("Bal Swing");
    expect(tidyTitle("Milonga del Angel - Dimanche, 8 novembre, 19h", "2026-11-08")).toBe(
      "Milonga del Angel",
    );
    expect(tidyTitle("Kizomba Night | le jeudi 1er décembre", "2026-12-01")).toBe("Kizomba Night");
    expect(tidyTitle("Techno Club – MERCREDI 11 NOVEMBRE 23:00", "2026-11-11")).toBe("Techno Club");
    expect(tidyTitle("Bachata | Mardi 10 fevrier 21 h", "2027-02-10")).toBe("Bachata");
  });

  it("keeps titles where the weekday or date is the name, or nothing would be left", () => {
    expect(tidyTitle("Bal du 14 juillet", "2027-07-14")).toBe("Bal du 14 juillet");
    expect(tidyTitle("Vendredi 6 novembre - 23h", "2026-11-06")).toBe("Vendredi 6 novembre - 23h");
    expect(tidyTitle("Le Vendredi des Salseros", "2026-11-06")).toBe("Le Vendredi des Salseros");
    expect(tidyTitle("Samedi Soir | Club 7 novembre", "2026-11-07")).toBe(
      "Samedi Soir | Club 7 novembre",
    );
  });

  it("works with null night", () => {
    expect(tidyTitle("Bal Swing | samedi 7 novembre", null)).toBe("Bal Swing");
  });

  it("does not break Portuguese cases", () => {
    expect(tidyTitle("Black Cat: BUNDALELÊ | Sexta - 06 de novembro - 23h", "2026-11-06")).toBe(
      "Black Cat: BUNDALELÊ",
    );
  });
});
