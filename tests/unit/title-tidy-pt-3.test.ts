import { describe, expect, it } from "vitest";
import { tidyTitle } from "@/src/domain/title-tidy";

// D-776 (Rio 11-07, cities-6 sweep): a dash and a year after "day de month".
describe("Portuguese date tail with a dash and a year (D-776)", () => {
  it.each([
    ["Rota do Samba: Roda de Samba - 07 de Novembro de 2026", "Rota do Samba: Roda de Samba"],
    ["Baile Charme – 14 de novembro", "Baile Charme"],
    ["Forró da Lua | 21 de Novembro de 2026", "Forró da Lua"],
  ])("cuts %s", (title, expected) => {
    expect(tidyTitle(title, "2026-11-07")).toBe(expected);
  });

  it.each(["Samba de Novembro", "- 7 de Setembro"])("keeps %s", (title) => {
    expect(tidyTitle(title, "2026-11-07")).toBe(title);
  });
});
