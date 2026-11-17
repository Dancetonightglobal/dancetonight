import { describe, expect, it } from "vitest";
import { tidyTitle } from "@/src/domain/title-tidy";

// D-764: Philadelphia, daily site check 2026-11-06. societyhilldance.com listed "Latin Night Party - 11/6"
// on 11-06 beside "Latin Night Party". A yearless day/month after a separator that is the night (either
// reading) says nothing the card does not, so it is dropped.

describe("tidyTitle: a yearless date tail that is the night", () => {
  it("drops it after a separator, read month-first or day-first", () => {
    expect(tidyTitle("Latin Night Party - 11/6", "2026-11-06")).toBe("Latin Night Party");
    expect(tidyTitle("Latin Night Party - 6/11", "2026-11-06")).toBe("Latin Night Party");
    expect(tidyTitle("Salsa Social – 11/06", "2026-11-06")).toBe("Salsa Social");
    // "dd.mm" stays: D-759 keeps "Vol.12 | 14.11".
    expect(tidyTitle("Salsa Social – 11.06", "2026-11-06")).toBe("Salsa Social – 11.06");
    expect(tidyTitle("Salsa Social | (11/6)", "2026-11-06")).toBe("Salsa Social");
    expect(tidyTitle("Bachata Night — 06/11", "2026-11-06")).toBe("Bachata Night");
  });

  it("keeps a yearless date that is not the night", () => {
    expect(tidyTitle("Latin Night Party - 10/9", "2026-11-06")).toBe("Latin Night Party - 10/9");
    expect(tidyTitle("Open Floor - 24/7", "2026-11-06")).toBe("Open Floor - 24/7");
  });

  it("keeps it with no separator, with no night, or when nothing would be left", () => {
    expect(tidyTitle("Salsa 11/6", "2026-11-06")).toBe("Salsa 11/6");
    expect(tidyTitle("Latin Night Party - 11/6", null)).toBe("Latin Night Party - 11/6");
    expect(tidyTitle("- 11/6", "2026-11-06")).toBe("- 11/6");
  });

  it("leaves a full date that is the night as before (D-591)", () => {
    expect(tidyTitle("Salsa Night - 11/06/2026", "2026-11-06")).toBe("Salsa Night - 11/06/2026");
  });
});
