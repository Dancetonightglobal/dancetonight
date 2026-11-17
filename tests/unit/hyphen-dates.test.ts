// Hyphenated numeric dates with a weekday (D-666): The Fringe Club writes "Wed 04-11-2026, 8:00 PM - 3 h".
// The weekday decides day-first versus month-first, so a US month-first page cannot regress.
import { describe, expect, it } from "vitest";

import { statesDate } from "@/src/domain/text-facts";

describe("statesDate: hyphenated dates with a weekday (D-666)", () => {
  it("reads day-first when the weekday fits (Hong Kong, UK)", () => {
    // 2026-11-04 is a Wednesday; read month-first, 04-11-2026 would be Sat 11 April.
    expect(statesDate("Wed 04-11-2026, 8:00 PM - 3 h", "2026-11-04", "en")).toBe(true);
    expect(statesDate("Tue 10-11-2026, 7:30 PM - 4 h", "2026-11-10", "en")).toBe(true);
    expect(statesDate("Wednesday 4-11-2026", "2026-11-04", "en")).toBe(true);
  });

  it("reads month-first when the weekday fits (US)", () => {
    // 2026-04-11 is a Saturday.
    expect(statesDate("Sat 04-11-2026 9pm", "2026-04-11", "en")).toBe(true);
    expect(statesDate("Saturday, 04-11-2026", "2026-04-11", "en")).toBe(true);
  });

  it("does not take the other order when the weekday does not fit", () => {
    expect(statesDate("Wed 04-11-2026, 8:00 PM", "2026-04-11", "en")).toBe(false);
    expect(statesDate("Sat 04-11-2026 9pm", "2026-11-04", "en")).toBe(false);
  });

  it("needs a weekday just before the date", () => {
    expect(statesDate("04-11-2026, 8:00 PM", "2026-11-04", "en")).toBe(false);
    expect(statesDate("Wed, doors open. 04-11-2026", "2026-11-04", "en")).toBe(false);
  });

  it("needs the date's own 4-digit year", () => {
    expect(statesDate("Wed 04-11-2025", "2026-11-04", "en")).toBe(false);
    expect(statesDate("Wed 04-11-26", "2026-11-04", "en")).toBe(false);
  });

  it("does not read clock or number ranges as dates", () => {
    expect(statesDate("Wed 10-11pm", "2026-11-10", "en")).toBe(false);
    expect(statesDate("Wed 4-11-20265", "2026-11-04", "en")).toBe(false);
    expect(statesDate("Wed 104-11-2026", "2026-11-04", "en")).toBe(false);
  });

  it("still reads the forms it read before", () => {
    expect(statesDate("Wed 04/11/2026", "2026-11-04", "en")).toBe(true);
    expect(statesDate("Wednesday, November 4", "2026-11-04", "en")).toBe(true);
    expect(statesDate("2026-11-04", "2026-11-04", "en")).toBe(true);
  });
});
