import { describe, expect, it } from "vitest";
import { withHouseHours } from "@/src/domain/house-hours";
import type { HarvestedListing } from "@/src/adapters/types";
import { rawListingSchema } from "@/src/domain/listing";

function listing(overrides: Record<string, unknown>): HarvestedListing {
  const base = {
    listing: rawListingSchema.parse({
      title: "Test Event",
      listing_type: "social",
      styles: [],
      venue: { name: "Test Venue" },
      organizer: {},
      ...overrides,
    }),
    externalId: null,
    provenance: {
      method: "llm",
      sourceUrl: "https://example.com",
      fetchedAt: new Date("2026-10-30T12:00:00Z"),
    },
  } as HarvestedListing;
  // Allow adding recurrence via overrides
  if (overrides.recurrence !== undefined) {
    (base as { recurrence?: unknown }).recurrence = overrides.recurrence;
  }
  return base;
}

describe("withHouseHours", () => {
  const hours = {
    start: "00:00",
    end: "06:00",
    days: [3, 4, 5, 6], // Wednesday, Thursday, Friday, Saturday
    checked: "test",
  };

  it("untimed listing on matching weekday applies hours", () => {
    const l = listing({ local_date: "2026-11-04" }); // Wednesday
    const result = withHouseHours(l, hours);
    expect(result.applied).toBe(true);
    expect(result.listing.listing.dancing_time).toBe("00:00");
    expect(result.listing.listing.end_time).toBe("06:00");
    // Input not mutated
    expect(l.listing.dancing_time).toBeNull();
    expect(l.listing.end_time).toBeNull();
  });

  it("untimed listing on non-matching weekday unchanged", () => {
    const l = listing({ local_date: "2026-11-02" }); // Monday
    const result = withHouseHours(l, hours);
    expect(result.applied).toBe(false);
    expect(result.listing.listing.dancing_time).toBeNull();
    expect(result.listing.listing.end_time).toBeNull();
  });

  it("listing with dancing_time unchanged", () => {
    const l = listing({
      local_date: "2026-11-04",
      dancing_time: "23:00",
    });
    const result = withHouseHours(l, hours);
    expect(result.applied).toBe(false);
    expect(result.listing.listing.dancing_time).toBe("23:00");
  });

  it("listing with only doors_time unchanged", () => {
    const l = listing({
      local_date: "2026-11-04",
      doors_time: "22:00",
    });
    const result = withHouseHours(l, hours);
    expect(result.applied).toBe(false);
    expect(result.listing.listing.doors_time).toBe("22:00");
  });

  it("untimed listing with existing end_time keeps it", () => {
    const l = listing({
      local_date: "2026-11-06", // Friday
      end_time: "05:00",
    });
    const result = withHouseHours(l, hours);
    expect(result.applied).toBe(true);
    expect(result.listing.listing.dancing_time).toBe("00:00");
    expect(result.listing.listing.end_time).toBe("05:00"); // Keeps original
  });

  it("no local_date unchanged", () => {
    const l = listing({
      local_date: null,
      recurrence_text: "Every Friday",
    });
    const result = withHouseHours(l, hours);
    expect(result.applied).toBe(false);
    expect(result.listing.listing.dancing_time).toBeNull();
  });

  it("hours undefined unchanged", () => {
    const l = listing({ local_date: "2026-11-04" });
    const result = withHouseHours(l, undefined);
    expect(result.applied).toBe(false);
    expect(result.listing.listing.dancing_time).toBeNull();
  });

  it("a start-only entry sets the dancing time and leaves end_time null", () => {
    const hours = {
      start: "22:00",
      days: [5, 6],
      checked: "x",
    };
    const l = listing({ local_date: "2026-10-30" }); // Friday
    const result = withHouseHours(l, hours);
    expect(result.applied).toBe(true);
    expect(result.listing.listing.dancing_time).toBe("22:00");
    expect(result.listing.listing.end_time).toBeNull();
  });

  it("a start-only entry keeps a stated end time", () => {
    const hours = {
      start: "22:00",
      days: [5, 6],
      checked: "x",
    };
    const l = listing({
      local_date: "2026-10-31", // Saturday
      end_time: "03:00",
    });
    const result = withHouseHours(l, hours);
    expect(result.applied).toBe(true);
    expect(result.listing.listing.dancing_time).toBe("22:00");
    expect(result.listing.listing.end_time).toBe("03:00");
  });
});

describe("withHouseHours on weekly rules", () => {
  const hours = {
    start: "00:00",
    end: "06:00",
    days: [3, 4, 5, 6], // Wednesday, Thursday, Friday, Saturday
    checked: "test",
  };

  it("BYDAY=WE,SA, untimed -> applied true, dancing_time set, recurrence unchanged", () => {
    const l = listing({
      local_date: null,
      recurrence: {
        rrule: "FREQ=WEEKLY;BYDAY=WE,SA",
        dtstartLocal: "2026-11-04T12:00",
        exdates: [],
        timeListed: false,
      },
    });
    const result = withHouseHours(l, hours);
    expect(result.applied).toBe(true);
    expect(result.listing.listing.dancing_time).toBe("00:00");
    expect(result.listing.listing.end_time).toBe("06:00");
    expect(result.listing.recurrence).toEqual(l.recurrence);
    // Input not mutated
    expect(l.listing.dancing_time).toBeNull();
    expect(l.listing.end_time).toBeNull();
  });

  it("BYDAY=WE,MO -> applied false (Monday not in hours)", () => {
    const l = listing({
      local_date: null,
      recurrence: {
        rrule: "FREQ=WEEKLY;BYDAY=WE,MO",
        dtstartLocal: "2026-11-04T12:00",
        exdates: [],
        timeListed: false,
      },
    });
    const result = withHouseHours(l, hours);
    expect(result.applied).toBe(false);
    expect(result.listing.listing.dancing_time).toBeNull();
    expect(result.listing.recurrence).toEqual(l.recurrence);
  });

  it("BYDAY=1FR (prefixed) -> applied true", () => {
    const l = listing({
      local_date: null,
      recurrence: {
        rrule: "FREQ=WEEKLY;BYDAY=1FR",
        dtstartLocal: "2026-11-06T12:00",
        exdates: [],
        timeListed: false,
      },
    });
    const result = withHouseHours(l, hours);
    expect(result.applied).toBe(true);
    expect(result.listing.listing.dancing_time).toBe("00:00");
    expect(result.listing.listing.end_time).toBe("06:00");
  });

  it("No BYDAY, dtstartLocal Friday -> applied true", () => {
    const l = listing({
      local_date: null,
      recurrence: {
        rrule: "FREQ=WEEKLY",
        dtstartLocal: "2026-11-06T12:00",
        exdates: [],
        timeListed: false,
      },
    });
    const result = withHouseHours(l, hours);
    expect(result.applied).toBe(true);
    expect(result.listing.listing.dancing_time).toBe("00:00");
    expect(result.listing.listing.end_time).toBe("06:00");
  });

  it("No BYDAY, dtstartLocal Monday -> applied false", () => {
    const l = listing({
      local_date: null,
      recurrence: {
        rrule: "FREQ=WEEKLY",
        dtstartLocal: "2026-11-02T12:00",
        exdates: [],
        timeListed: false,
      },
    });
    const result = withHouseHours(l, hours);
    expect(result.applied).toBe(false);
    expect(result.listing.listing.dancing_time).toBeNull();
  });

  it("Rule listing with dancing_time already set -> applied false", () => {
    const l = listing({
      local_date: null,
      dancing_time: "23:00",
      recurrence: {
        rrule: "FREQ=WEEKLY;BYDAY=WE",
        dtstartLocal: "2026-11-04T12:00",
        exdates: [],
        timeListed: false,
      },
    });
    const result = withHouseHours(l, hours);
    expect(result.applied).toBe(false);
    expect(result.listing.listing.dancing_time).toBe("23:00");
  });

  it("Rule listing with existing end_time -> applied true, end_time kept", () => {
    const l = listing({
      local_date: null,
      end_time: "05:00",
      recurrence: {
        rrule: "FREQ=WEEKLY;BYDAY=FR",
        dtstartLocal: "2026-11-06T12:00",
        exdates: [],
        timeListed: false,
      },
    });
    const result = withHouseHours(l, hours);
    expect(result.applied).toBe(true);
    expect(result.listing.listing.dancing_time).toBe("00:00");
    expect(result.listing.listing.end_time).toBe("05:00"); // Keeps original
  });

  it("BYDAY=XX (unknown) -> applied false", () => {
    const l = listing({
      local_date: null,
      recurrence: {
        rrule: "FREQ=WEEKLY;BYDAY=XX",
        dtstartLocal: "2026-11-04T12:00",
        exdates: [],
        timeListed: false,
      },
    });
    const result = withHouseHours(l, hours);
    expect(result.applied).toBe(false);
    expect(result.listing.listing.dancing_time).toBeNull();
  });
});
