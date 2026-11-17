import { describe, expect, it } from "vitest";
import { withZuluAsLocal } from "@/src/domain/zulu-local";
import type { HarvestedListing } from "@/src/adapters/types";

function listing(overrides: Record<string, unknown>): HarvestedListing {
  const base = {
    listing: {
      title: "Test Event",
      listing_type: "social",
      styles: [],
      venue: { name: "Test Venue" },
      organizer: {},
      doors_time: null,
      lesson_time: null,
      dancing_time: null,
      end_time: null,
      local_date: null,
      evidence: null,
      ...overrides,
    },
    externalId: null,
    provenance: {
      method: "llm",
      sourceUrl: "https://example.com",
      fetchedAt: new Date("2026-10-30T12:00:00Z"),
    },
    tz: "America/Bogota",
  } as unknown as HarvestedListing;
  return base;
}

describe("withZuluAsLocal", () => {
  const metroTz = "America/Bogota";

  it("on=true, Z suffix in startDate and endDate, shifts times", () => {
    const l = listing({
      evidence: {
        start: "startDate 2026-11-27T20:00:00Z",
        end_time: "endDate 2026-11-27T23:59:00Z",
      },
      dancing_time: "15:00", // old time (20:00 UTC -> 15:00 Bogotá)
      end_time: "18:59", // old end (23:59 UTC -> 18:59 Bogotá)
      local_date: "2026-11-27",
    });
    const result = withZuluAsLocal(l, true, metroTz);
    expect(result.applied).toBe(true);
    expect(result.listing.listing.dancing_time).toBe("20:00");
    expect(result.listing.listing.end_time).toBe("23:59");
    expect(result.listing.listing.local_date).toBe("2026-11-27");
  });

  it("late start crossing midnight, night shifts", () => {
    const l = listing({
      evidence: {
        start: "startDate 2026-11-28T01:00:00Z",
      },
      dancing_time: "20:00", // old time (01:00 UTC -> 20:00 previous day Bogotá)
      local_date: "2026-11-27",
    });
    const result = withZuluAsLocal(l, true, metroTz);
    expect(result.applied).toBe(true);
    expect(result.listing.listing.dancing_time).toBe("01:00");
    // 01:00 local is before the 06:00 night boundary, so it stays on the night of 2026-11-27.
    expect(result.listing.listing.local_date).toBe("2026-11-27");
  });

  it("on=undefined -> unchanged", () => {
    const l = listing({
      evidence: { start: "startDate 2026-11-27T20:00:00Z" },
      dancing_time: "15:00",
    });
    const result = withZuluAsLocal(l, undefined, metroTz);
    expect(result.applied).toBe(false);
    expect(result.listing.listing.dancing_time).toBe("15:00");
  });

  it("on=false -> unchanged", () => {
    const l = listing({
      evidence: { start: "startDate 2026-11-27T20:00:00Z" },
      dancing_time: "15:00",
    });
    const result = withZuluAsLocal(l, false, metroTz);
    expect(result.applied).toBe(false);
    expect(result.listing.listing.dancing_time).toBe("15:00");
  });

  it("evidence.start with offset -05:00 -> unchanged", () => {
    const l = listing({
      evidence: { start: "startDate 2026-11-27T20:00:00-05:00" },
      dancing_time: "20:00",
    });
    const result = withZuluAsLocal(l, true, metroTz);
    expect(result.applied).toBe(false);
    expect(result.listing.listing.dancing_time).toBe("20:00");
  });

  it("lesson_time equal to old start is shifted", () => {
    const l = listing({
      evidence: { start: "startDate 2026-11-27T20:00:00Z" },
      lesson_time: "15:00",
      dancing_time: null,
    });
    const result = withZuluAsLocal(l, true, metroTz);
    expect(result.applied).toBe(true);
    expect(result.listing.listing.lesson_time).toBe("20:00");
  });

  it("doors_time differs from old start, left alone", () => {
    const l = listing({
      evidence: { start: "startDate 2026-11-27T20:00:00Z" },
      doors_time: "14:00",
      dancing_time: "15:00",
    });
    const result = withZuluAsLocal(l, true, metroTz);
    expect(result.applied).toBe(true);
    expect(result.listing.listing.doors_time).toBe("14:00"); // unchanged
    expect(result.listing.listing.dancing_time).toBe("20:00"); // changed
  });

  it("input object not mutated", () => {
    const l = listing({
      evidence: { start: "startDate 2026-11-27T20:00:00Z" },
      dancing_time: "15:00",
    });
    const originalDancing = l.listing.dancing_time;
    const result = withZuluAsLocal(l, true, metroTz);
    expect(result.applied).toBe(true);
    expect(l.listing.dancing_time).toBe(originalDancing); // unchanged
    expect(result.listing.listing.dancing_time).toBe("20:00");
  });
});
