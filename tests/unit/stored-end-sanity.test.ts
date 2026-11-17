// Stored end times a night cannot have are shown as not listed (2026-10-15).
import { describe, expect, it } from "vitest";

import { trustedEnd } from "@/src/data/listing-mapper";

const at = (iso: string) => new Date(iso);
const none = { doorsAt: null, lessonAt: null, dancingAt: null };

describe("trustedEnd", () => {
  it("drops Willie's 8pm to 8pm the next day (24 hours)", () => {
    const doors = at("2026-10-15T00:00:00Z");
    expect(trustedEnd({ ...none, doorsAt: doors, endsAt: at("2026-10-16T00:00:00Z") })).toBeNull();
  });

  it("drops an end equal to a stated start", () => {
    const doors = at("2026-10-15T00:00:00Z");
    expect(trustedEnd({ ...none, doorsAt: doors, endsAt: doors })).toBeNull();
  });

  it("keeps 9pm to 4am, and exactly 12 hours", () => {
    const doors = at("2026-10-15T01:00:00Z");
    const four = at("2026-10-15T08:00:00Z");
    expect(trustedEnd({ ...none, doorsAt: doors, endsAt: four })).toBe(four);
    const twelve = at("2026-10-15T13:00:00Z");
    expect(trustedEnd({ ...none, doorsAt: doors, endsAt: twelve })).toBe(twelve);
  });

  it("keeps an end with no stated start, and no end as none", () => {
    const end = at("2026-10-15T03:00:00Z");
    expect(trustedEnd({ ...none, endsAt: end })).toBe(end);
    expect(trustedEnd({ ...none, doorsAt: end, endsAt: null })).toBeNull();
  });
});
