// D-827: a fixed night with weeksOfMonth lists as a monthly rule (Egoland Bar Akihabara's "Akihabara Salsa",
// 2nd and 4th Wednesday, hand-checked on its own Instagram 2026-11-10).

import { describe, expect, it } from "vitest";

import { fixedNightListings, type FixedNight } from "@/src/domain/fixed-nights";

const LINE = "We hold a Latin event every 2nd and 4th Wednesday of the month in Akihabara.";
const NIGHT: FixedNight = {
  title: "Akihabara Salsa at Egoland",
  line: LINE,
  days: [3],
  weeksOfMonth: [2, 4],
  start: "19:30",
  end: "23:30",
  danceCited: "own Instagram, test",
};

function read(entry: FixedNight, fromNight = "2026-11-10") {
  return fixedNightListings([entry], {
    pageText: `Egoland ${LINE} Lesson 19:30`,
    pageUrl: "https://www.instagram.com/egoland_latin/",
    fetchedAt: new Date("2026-11-10T03:00:00Z"),
    fromNight,
    currency: "JPY",
    sourceStyles: ["salsa"],
    venueName: "Egoland Bar Akihabara",
    venueAddress: "〒101-0025 東京都千代田区神田佐久間町4-7-3 2F",
    zone: "Asia/Tokyo",
  });
}

describe("a monthly fixed night (D-827)", () => {
  it("lists a FREQ=MONTHLY rule from its first night", () => {
    const result = read(NIGHT);
    expect(result.listings).toHaveLength(1);
    const listing = result.listings[0]!;
    expect(listing.recurrence?.rrule).toBe("FREQ=MONTHLY;BYDAY=2WE,4WE");
    expect(listing.recurrence?.dtstartLocal).toBe("2026-11-11T19:30");
    expect(listing.listing.local_date).toBe("2026-11-11");
  });

  it("past the 4th week, starts in the next month", () => {
    const listing = read(NIGHT, "2026-11-26").listings[0]!;
    expect(listing.recurrence?.dtstartLocal).toBe("2026-12-09T19:30");
  });

  it("a weekly night is unchanged", () => {
    const { weeksOfMonth: _drop, ...weekly } = NIGHT;
    const listing = read(weekly).listings[0]!;
    expect(listing.recurrence?.rrule).toBe("FREQ=WEEKLY;BYDAY=WE");
  });

  it("bad weeks are not listed, with a note", () => {
    const result = read({ ...NIGHT, weeksOfMonth: [0] });
    expect(result.listings).toHaveLength(0);
    expect(result.notes.join(" ")).toContain("bad days or times");
  });

  it("a monthly night starting after midnight is not listed, with a note", () => {
    const result = read({ ...NIGHT, start: "01:00", end: "04:00" });
    expect(result.listings).toHaveLength(0);
    expect(result.notes.join(" ")).toContain("after midnight");
  });
});
