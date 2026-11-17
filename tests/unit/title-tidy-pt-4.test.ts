import { describe, expect, it } from "vitest";
import { tidyTitle } from "@/src/domain/title-tidy";

// D-799 (Rio 11-08, cities-8 sweep): a slash before "day de month", and one short segment after it.
describe("Portuguese date tail after a slash, with one segment after it (D-799)", () => {
  it.each([
    ["After da Ari /  Especial Positions / 20 de Novembro", "After da Ari /  Especial Positions"],
    [
      "Festa Repeat: Especial SUMMER ELETROHITS / 21 de Novembro / Up Turn",
      "Festa Repeat: Especial SUMMER ELETROHITS",
    ],
    [
      "Casuarina 25 Anos no Quintal da Clementina - 21 de novembro  - sábado!",
      "Casuarina 25 Anos no Quintal da Clementina",
    ],
    ["Rota do Samba: Roda de Samba - 07 de Novembro de 2026", "Rota do Samba: Roda de Samba"],
    [
      "Fiesta Latina ¡CHÉVERE! | Segunda-feira 9 novembro | Copacabana | TAU",
      "Fiesta Latina ¡CHÉVERE!",
    ],
  ])("cuts %s", (title, expected) => {
    expect(tidyTitle(title, "2026-11-08")).toBe(expected);
  });

  it.each([
    "Samba de Novembro",
    "- 7 de Setembro",
    "Baile 15 de Novembro",
    "/ 20 de Novembro / Up Turn",
  ])("keeps %s", (title) => {
    expect(tidyTitle(title, "2026-11-08")).toBe(title);
  });
});
