import { describe, expect, it } from "vitest";
import { tidyTitle } from "@/src/domain/title-tidy";

// D-746: Rio de Janeiro, daily site check 11-05. Sympla titles carry the night written out in
// Portuguese: "Black Cat: BUNDALELÊ | Sexta - 06 de novembro - 23h", "SAMBA DO XOXÓ E CONVIDADOS
// BECO DO RATO 11/11 20H - QUARTA FEIRA". The card already shows the night and the start, so a
// trailing weekday-and-date tail is dropped (the "20H" even disagreed with Sympla's own 18:00 start).

describe("tidyTitle: a Portuguese weekday-and-date tail (D-746)", () => {
  it('drops "| <weekday> - <day> de <month> - <hour>h"', () => {
    expect(tidyTitle("Black Cat: BUNDALELÊ | Sexta - 06 de novembro - 23h", "2026-11-06")).toBe(
      "Black Cat: BUNDALELÊ",
    );
    expect(tidyTitle("Black Cat: EROS EXXXTRA| Sábado, 07 de novembro - 23h", "2026-11-07")).toBe(
      "Black Cat: EROS EXXXTRA",
    );
    expect(tidyTitle("Black Cat: EROS |Domingo, 08 de novembro - 23h", "2026-11-08")).toBe(
      "Black Cat: EROS",
    );
  });
  it("drops a tail with no hour, any case, -feira or not", () => {
    expect(tidyTitle("Pink Flamingo |Noche Latina |Terça 10 de Novembro", "2026-11-10")).toBe(
      "Pink Flamingo |Noche Latina",
    );
    expect(tidyTitle("Forró do Zé | Quinta-feira, 12 de NOVEMBRO", "2026-11-12")).toBe(
      "Forró do Zé",
    );
    expect(tidyTitle("Baile da Gaby | Terca 10 de novembro 22h30", "2026-11-10")).toBe(
      "Baile da Gaby",
    );
  });
  it('drops "<dd/mm> <hour>H - <weekday> FEIRA"', () => {
    expect(
      tidyTitle("SAMBA DO XOXÓ E CONVIDADOS BECO DO RATO 11/11 20H - QUARTA FEIRA", "2026-11-11"),
    ).toBe("SAMBA DO XOXÓ E CONVIDADOS BECO DO RATO");
    expect(tidyTitle("Roda de Samba 14/11 18h30 - Sábado", "2026-11-14")).toBe("Roda de Samba");
  });
  it("drops the tail whatever date it names (the card shows the night)", () => {
    expect(tidyTitle("Black Cat: EROS | Sexta - 30 de outubro - 23h", "2026-11-06")).toBe(
      "Black Cat: EROS",
    );
  });
  it("leaves titles where the weekday or date is the name, or nothing would be left", () => {
    expect(tidyTitle("Sexta Black", "2026-11-06")).toBe("Sexta Black");
    expect(tidyTitle("Forró de Quinta", "2026-11-12")).toBe("Forró de Quinta");
    expect(tidyTitle("Baile 7 de Setembro", "2026-11-07")).toBe("Baile 7 de Setembro");
    expect(tidyTitle("Sexta - 06 de novembro - 23h", "2026-11-06")).toBe(
      "Sexta - 06 de novembro - 23h",
    );
  });
  it("keeps D-591's behaviour", () => {
    expect(tidyTitle("Salsa Arriba - 04/10/26", "2026-11-04")).toBe("Salsa Arriba");
    expect(tidyTitle("Salsa Arriba - Salsa Arriba", "2026-11-04")).toBe("Salsa Arriba");
  });
});
