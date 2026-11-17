import { describe, expect, it } from "vitest";
import { tidyTitle } from "@/src/domain/title-tidy";

// D-759: cities sweep 11-06. Portuguese date tails D-746 did not cut: a date with no "de", a date
// segment followed by "| venue | organizer" segments, "- Sexta 06 de Novembro no <place>", a
// "dd.mm" date, and a "| 15 de Novembro" segment with no weekday. The card already shows the night.

describe("tidyTitle: more Portuguese date tails (D-759)", () => {
  it("drops a weekday-and-date segment with no 'de', and the venue/organizer segments after it", () => {
    expect(
      tidyTitle(
        "Fiesta Latina ¡CHÉVERE! | Sexta-feira 6 novembro | Copacabana | TAU",
        "2026-11-06",
      ),
    ).toBe("Fiesta Latina ¡CHÉVERE!");
    expect(
      tidyTitle("Pink Flamingo | Noche Latina | Sexta-feira 6 novembro | Lapa", "2026-11-06"),
    ).toBe("Pink Flamingo | Noche Latina");
    expect(tidyTitle("Baile do Zé | Sábado, 7 de novembro | Lapa", "2026-11-07")).toBe(
      "Baile do Zé",
    );
  });
  it('drops "- <weekday> <day> de <month> no|na|em <place>"', () => {
    expect(tidyTitle("João Martins - Sexta 06 de Novembro no Beco do Rato", "2026-11-06")).toBe(
      "João Martins",
    );
    expect(tidyTitle("Roda de Forró - Quinta 12 de novembro na Lapa", "2026-11-12")).toBe(
      "Roda de Forró",
    );
  });
  it('drops "| <weekday> <dd.mm>" and "| <weekday> <dd/mm>"', () => {
    expect(tidyTitle("2008 - 2018 | Vol.12 | Sábado 14.11", "2026-11-14")).toBe(
      "2008 - 2018 | Vol.12",
    );
    expect(tidyTitle("Noite Latina | Sexta 06/11", "2026-11-06")).toBe("Noite Latina");
  });
  it('drops a "| <day> de <month>" segment with no weekday', () => {
    expect(tidyTitle("Bootcamp KONPA - Connection & Flow | 15 de Novembro", "2026-11-15")).toBe(
      "Bootcamp KONPA - Connection & Flow",
    );
  });
  it("leaves names that are dates, segments with no date, and titles that would be emptied", () => {
    expect(tidyTitle("Baile 7 de Setembro", "2026-11-07")).toBe("Baile 7 de Setembro");
    expect(tidyTitle("Festa Latina | Copacabana | TAU", "2026-11-06")).toBe(
      "Festa Latina | Copacabana | TAU",
    );
    expect(tidyTitle("Forró no Beco - Sexta", "2026-11-06")).toBe("Forró no Beco - Sexta");
    expect(tidyTitle("Sexta-feira 6 novembro", "2026-11-06")).toBe("Sexta-feira 6 novembro");
    expect(tidyTitle("Vol.12 | 14.11", "2026-11-14")).toBe("Vol.12 | 14.11");
  });
});
