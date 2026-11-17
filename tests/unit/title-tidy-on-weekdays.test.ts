import { describe, expect, it } from "vitest";
import { tidyTitle } from "@/src/domain/title-tidy";

// D-837: Nashville, daily site check 11-10. One read of nashvillepost82.org gave each Thursday twice:
// "Live Music and Dance Lessons" and "Live music and dance lessons on Thursdays". The card already shows
// the night and the series, so a trailing "on <Weekday>s" or "every <Weekday>" is dropped and the two
// copies share one title.

describe("tidyTitle: an English weekly-recurrence tail (D-837)", () => {
  it('drops "on <Weekday>s"', () => {
    expect(tidyTitle("Live music and dance lessons on Thursdays", "2026-11-12")).toBe(
      "Live music and dance lessons",
    );
    expect(tidyTitle("Salsa Social on Fridays", "2026-11-13")).toBe("Salsa Social");
    expect(tidyTitle("Bachata Night ON SATURDAYS", "2026-11-14")).toBe("Bachata Night");
  });

  it('drops "every <Weekday>" and "every <Weekday>s"', () => {
    expect(tidyTitle("Swing Dance Social every Tuesday", "2026-11-10")).toBe("Swing Dance Social");
    expect(tidyTitle("Line Dancing Every Wednesdays", "2026-11-11")).toBe("Line Dancing");
  });

  it("drops the tail after a comma, a dash or inside parentheses", () => {
    expect(tidyTitle("Tango Practica, every Sunday", "2026-11-15")).toBe("Tango Practica");
    expect(tidyTitle("Tango Practica - every Sunday", "2026-11-15")).toBe("Tango Practica");
    expect(tidyTitle("Tango Practica (every Sunday)", "2026-11-15")).toBe("Tango Practica");
    expect(tidyTitle("Tango Practica (on Sundays)", "2026-11-15")).toBe("Tango Practica");
  });

  it("drops two weekdays joined by and, & or /", () => {
    expect(tidyTitle("Salsa Class on Mondays and Wednesdays", "2026-11-16")).toBe("Salsa Class");
    expect(tidyTitle("Salsa Class every Monday & Wednesday", "2026-11-16")).toBe("Salsa Class");
    expect(tidyTitle("Salsa Class on Mondays/Wednesdays", "2026-11-16")).toBe("Salsa Class");
  });

  it("keeps a title that would be left with fewer than two words", () => {
    expect(tidyTitle("Swing on Thursdays", "2026-11-12")).toBe("Swing on Thursdays");
    expect(tidyTitle("Every Thursday", "2026-11-12")).toBe("Every Thursday");
  });

  it("keeps a weekday that is not a trailing recurrence", () => {
    expect(tidyTitle("Zouk Tuesdays", "2026-11-10")).toBe("Zouk Tuesdays");
    expect(tidyTitle("Thursdays at the Loft", "2026-11-12")).toBe("Thursdays at the Loft");
    expect(tidyTitle("Salsa on Thursday Night Live", "2026-11-12")).toBe(
      "Salsa on Thursday Night Live",
    );
    expect(tidyTitle("Every Thursday Salsa Social", "2026-11-12")).toBe(
      "Every Thursday Salsa Social",
    );
    expect(tidyTitle("Salsa on Thursday", "2026-11-12")).toBe("Salsa on Thursday");
  });

  it("leaves the D-747 tail rule as it was", () => {
    expect(tidyTitle("Tango Beginners Class, Sundays 5pm, Angel", "2026-11-08")).toBe(
      "Tango Beginners Class",
    );
  });
});
