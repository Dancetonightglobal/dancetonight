import { describe, expect, it } from "vitest";
import { tidyTitle } from "@/src/domain/title-tidy";

// D-591: Buenos Aires, 2026-11-04. quehacemos printed "Salsa Arriba - 04/10/26" on its 11-04 and 11-11
// nights (October's date on November nights), and dancetomic "Salsa Arriba - Salsa Arriba". A trailing
// date that is not the night's is dropped; a title that is one part written twice is that part once.

describe("tidyTitle: a stale trailing date", () => {
  it("drops a trailing day/month/year that is not the night", () => {
    expect(tidyTitle("Salsa Arriba - 04/10/26", "2026-11-04")).toBe("Salsa Arriba");
    expect(tidyTitle("Salsa Arriba - 04/10/2026", "2026-11-11")).toBe("Salsa Arriba");
    expect(tidyTitle("Milonga del Sol – 4.10.26", "2026-11-04")).toBe("Milonga del Sol");
    expect(tidyTitle("Milonga del Sol | 2026-10-04", "2026-11-04")).toBe("Milonga del Sol");
    expect(tidyTitle("Milonga del Sol (04/10/26)", "2026-11-04")).toBe("Milonga del Sol");
    expect(tidyTitle("Milonga del Sol 04/10/26", "2026-11-04")).toBe("Milonga del Sol");
    expect(tidyTitle("Carambomba -- 06/10/26", "2026-11-06")).toBe("Carambomba");
    expect(tidyTitle("Salsa04/10/26", "2026-11-04")).toBe("Salsa04/10/26");
  });

  it("keeps a trailing date that is the night, read day-first or month-first", () => {
    expect(tidyTitle("Salsa Arriba - 04/11/26", "2026-11-04")).toBe("Salsa Arriba - 04/11/26");
    expect(tidyTitle("Salsa Night - 11/04/2026", "2026-11-04")).toBe("Salsa Night - 11/04/2026");
    expect(tidyTitle("Salsa Night - 2026-11-04", "2026-11-04")).toBe("Salsa Night - 2026-11-04");
  });

  it("with no night known keeps a trailing date", () => {
    expect(tidyTitle("Salsa Arriba - 04/10/26", null)).toBe("Salsa Arriba - 04/10/26");
  });

  it("leaves a date that is not at the end, or not a full date", () => {
    expect(tidyTitle("04/10/26 Salsa Arriba", "2026-11-04")).toBe("04/10/26 Salsa Arriba");
    expect(tidyTitle("Salsa 3/4", "2026-11-04")).toBe("Salsa 3/4");
    expect(tidyTitle("Club 2026", "2026-11-04")).toBe("Club 2026");
    expect(tidyTitle("Bachata 24/7", "2026-11-04")).toBe("Bachata 24/7");
  });

  it("never leaves an empty or date-only title", () => {
    expect(tidyTitle("04/10/26", "2026-11-04")).toBe("04/10/26");
    expect(tidyTitle(" - 04/10/26", "2026-11-04")).toBe("- 04/10/26");
  });

  it("ignores impossible dates", () => {
    expect(tidyTitle("Salsa Arriba - 45/13/26", "2026-11-04")).toBe("Salsa Arriba - 45/13/26");
  });
});

describe("tidyTitle: one part written twice", () => {
  it("collapses X - X", () => {
    expect(tidyTitle("Salsa Arriba - Salsa Arriba", "2026-11-04")).toBe("Salsa Arriba");
    expect(tidyTitle("Salsa Arriba – salsa arriba", "2026-11-04")).toBe("Salsa Arriba");
    expect(tidyTitle("Salsa Arriba | Salsa Arriba", "2026-11-04")).toBe("Salsa Arriba");
    expect(tidyTitle("Salsa Arriba: Salsa Arriba", null)).toBe("Salsa Arriba");
  });

  it("collapses after dropping a stale date", () => {
    expect(tidyTitle("Salsa Arriba - Salsa Arriba - 04/10/26", "2026-11-04")).toBe("Salsa Arriba");
  });

  it("leaves parts that differ, and three or more parts", () => {
    expect(tidyTitle("Salsa Arriba - Salsa Abajo", "2026-11-04")).toBe(
      "Salsa Arriba - Salsa Abajo",
    );
    expect(tidyTitle("Tango - Tango - Tango", "2026-11-04")).toBe("Tango - Tango - Tango");
    expect(tidyTitle("Salsa-Salsa", "2026-11-04")).toBe("Salsa-Salsa");
  });

  it("leaves ordinary titles alone", () => {
    expect(tidyTitle("Monday Night Swing", "2026-11-04")).toBe("Monday Night Swing");
    expect(tidyTitle("  Monday Night Swing  ", "2026-11-04")).toBe("Monday Night Swing");
  });
});
