import { describe, expect, it } from "vitest";
import { tidyTitle } from "@/src/domain/title-tidy";

// D-833 (Rio 11-10, cities-10 sweep): a pipe between the weekday and the day, with no space before it.
describe("Portuguese date tail with a pipe between weekday and day (D-833)", () => {
  it.each([
    ["Planeta Martes |Terça-feira | 10 novembro| TAU", "Planeta Martes"],
    ["Planeta Martes | Terça-feira | 17 novembro | TAU", "Planeta Martes"],
    // The D-759 form without the inner pipe still tidies.
    [
      "Fiesta Latina ¡CHÉVERE! | Segunda-feira 9 novembro | Copacabana | TAU",
      "Fiesta Latina ¡CHÉVERE!",
    ],
  ])("%s", (title, expected) => {
    expect(tidyTitle(title, "2026-11-10")).toBe(expected);
  });

  it("keeps a title whose weekday is its name and has no date", () => {
    expect(tidyTitle("Terça | Samba", "2026-11-10")).toBe("Terça | Samba");
  });
});
