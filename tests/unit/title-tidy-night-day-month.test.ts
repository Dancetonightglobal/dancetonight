import { describe, expect, it } from "vitest";

import { tidyTitle } from "@/src/domain/title-tidy";

// D-810: Rio Scenarium's Sympla titles end with the night as "dd.mm" ("ENZO BELMONTE NO RIO SCENARIUM  12.11").
describe("a bare dd.mm tail that is the night (D-810)", () => {
  it("is cut when it is the listing's own night", () => {
    expect(tidyTitle("ENZO BELMONTE NO RIO SCENARIUM  12.11", "2026-11-12")).toBe(
      "ENZO BELMONTE NO RIO SCENARIUM",
    );
    expect(tidyTitle("CLARA COSTA NO RIO SCENARIUM 3.12", "2026-12-03")).toBe(
      "CLARA COSTA NO RIO SCENARIUM",
    );
  });

  it("is kept for another night, with no night, or when nothing else is left", () => {
    expect(tidyTitle("ENZO BELMONTE NO RIO SCENARIUM  12.11", "2026-11-13")).toBe(
      "ENZO BELMONTE NO RIO SCENARIUM  12.11",
    );
    expect(tidyTitle("ENZO BELMONTE NO RIO SCENARIUM 12.11", null)).toBe(
      "ENZO BELMONTE NO RIO SCENARIUM 12.11",
    );
    expect(tidyTitle("2008 12.11", "2026-11-12")).toBe("2008 12.11");
  });

  it("leaves a volume number alone", () => {
    expect(tidyTitle("Baile Charme Vol.12", "2026-11-12")).toBe("Baile Charme Vol.12");
  });
});
