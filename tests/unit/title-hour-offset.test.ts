import { describe, expect, it } from "vitest";
import { titleHourOverOffset } from "@/src/domain/stated-times";
import type { RawListing } from "@/src/domain/listing";
import { buildListing, type StructuredEvent } from "@/src/adapters/structured";

const listing = (t: Partial<RawListing>): RawListing =>
  ({
    title: "x",
    doors_time: null,
    lesson_time: null,
    dancing_time: null,
    end_time: null,
    evidence: {},
    confidence: { dancing_time: 0.9 },
    ...t,
  }) as unknown as RawListing;

const BN = "DJ WestBankRed (Balcony Room) • FRI OCT. 30 • @10PM";

describe("titleHourOverOffset (D-268)", () => {
  it("moves dancing_time 22:01 to 22:00 when title writes @10PM", () => {
    const input = listing({
      title: BN,
      dancing_time: "22:01",
      evidence: { dancing_time: "10:01 PM" },
    });
    const result = titleHourOverOffset(input, BN, "en");
    expect(result.listing.dancing_time).toBe("22:00");
    expect(result.fields).toEqual(["dancing_time"]);
    expect(result.listing.evidence.dancing_time).toBe("@10PM");
    expect(result.listing.confidence.dancing_time).toBeUndefined();
    // Original unchanged
    expect(input.dancing_time).toBe("22:01");
  });

  it("moves doors_time 23:01 to 23:00 when title writes @11PM", () => {
    const input = listing({
      title: "Event @11PM",
      doors_time: "23:01",
      evidence: { doors_time: "11:01 PM" },
    });
    const result = titleHourOverOffset(input, "Event @11PM", "en");
    expect(result.listing.doors_time).toBe("23:00");
    expect(result.fields).toEqual(["doors_time"]);
    expect(result.listing.evidence.doors_time).toBe("Event @11PM");
  });

  it("does not change minute 02", () => {
    const input = listing({
      title: BN,
      dancing_time: "22:02",
    });
    const result = titleHourOverOffset(input, BN, "en");
    expect(result.listing.dancing_time).toBe("22:02");
    expect(result.fields).toEqual([]);
  });

  it("does not change different hour", () => {
    const input = listing({
      title: BN,
      dancing_time: "23:01",
    });
    const result = titleHourOverOffset(input, BN, "en");
    expect(result.listing.dancing_time).toBe("23:01");
    expect(result.fields).toEqual([]);
  });

  it("does not change when title has no time", () => {
    const input = listing({
      title: "No time here",
      dancing_time: "22:01",
    });
    const result = titleHourOverOffset(input, "No time here", "en");
    expect(result.listing.dancing_time).toBe("22:01");
    expect(result.fields).toEqual([]);
  });

  it("does not change when title writes half hour", () => {
    const input = listing({
      title: "Event @10:30PM",
      dancing_time: "22:31",
    });
    const result = titleHourOverOffset(input, "Event @10:30PM", "en");
    expect(result.listing.dancing_time).toBe("22:31");
    expect(result.fields).toEqual([]);
  });

  it("does not change when already on the hour", () => {
    const input = listing({
      title: BN,
      dancing_time: "22:00",
    });
    const result = titleHourOverOffset(input, BN, "en");
    expect(result.listing.dancing_time).toBe("22:00");
    expect(result.fields).toEqual([]);
  });

  it("does not touch end_time", () => {
    const input = listing({
      title: BN,
      end_time: "22:01",
    });
    const result = titleHourOverOffset(input, BN, "en");
    expect(result.listing.end_time).toBe("22:01");
    expect(result.fields).toEqual([]);
  });

  it("handles null fields", () => {
    const input = listing({
      title: BN,
      doors_time: null,
      lesson_time: null,
      dancing_time: null,
    });
    const result = titleHourOverOffset(input, BN, "en");
    expect(result.listing.doors_time).toBeNull();
    expect(result.listing.lesson_time).toBeNull();
    expect(result.listing.dancing_time).toBeNull();
    expect(result.fields).toEqual([]);
  });

  it("changes multiple fields", () => {
    const input = listing({
      title: BN,
      doors_time: "22:01",
      lesson_time: "22:01",
      dancing_time: "22:01",
    });
    const result = titleHourOverOffset(input, BN, "en");
    expect(result.listing.doors_time).toBe("22:00");
    expect(result.listing.lesson_time).toBe("22:00");
    expect(result.listing.dancing_time).toBe("22:00");
    expect(result.fields).toHaveLength(3);
    expect(result.fields).toContain("doors_time");
    expect(result.fields).toContain("lesson_time");
    expect(result.fields).toContain("dancing_time");
  });
});

const base: StructuredEvent = {
  externalId: null,
  title: "DJ WestBankRed (Balcony Room) • FRI OCT. 30 • @10PM",
  start: {
    day: "2026-10-30",
    night: "2026-10-30",
    time: "22:01",
    zone: "America/Chicago",
    absolute: false,
  },
  end: null,
  description: null,
  venue: { name: "Blue Nile", address: null, url: null, location: null },
  organizer: { name: null, url: null },
  prices: null,
  ticketUrl: null,
  cancelled: false,
  styles: [],
  type: null,
  bands: [],
  djs: [],
  evidence: {},
  recurrence: null,
};
const opts = {
  sourceUrl: "https://www.bluenilelive.com/calendar-tickets-",
  fetchedAt: new Date(),
  method: "jsonld" as const,
  currency: "USD",
};
const start = (e: StructuredEvent) => {
  const l = buildListing(e, opts).listing;
  return l.doors_time ?? l.dancing_time ?? l.lesson_time;
};

describe("buildListing title hour (D-268)", () => {
  it("moves 22:01 to 22:00 when title writes @10PM", () => {
    expect(start(base)).toBe("22:00");
  });

  it("does not change minute 02", () => {
    const e = { ...base, start: { ...base.start, time: "22:02" } };
    expect(start(e)).toBe("22:02");
  });

  it("does not change when title has no time", () => {
    const e = { ...base, title: "DJ WestBankRed (Balcony Room)" };
    expect(start(e)).toBe("22:01");
  });

  it("does not change when title writes a different hour", () => {
    const e = { ...base, title: "Late show @11PM" };
    expect(start(e)).toBe("22:01");
  });
});
