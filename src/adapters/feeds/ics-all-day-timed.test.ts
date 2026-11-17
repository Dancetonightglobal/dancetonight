import { describe, expect, it } from "vitest";

import { icsToListings, parseIcs } from "@/src/adapters/feeds/ics";

// D-884: thespotlight.la exports its DJ nights as 00:00 to 23:59:59 of one day (an all-day event
// written with times) beside real 22:00 nights from December, so D-882's feed-wide "every event
// starts at 00:00 with no end" never fires. Each such event is its date, time not listed, never
// the night before at midnight.

const LA = "America/Los_Angeles";

function vevent(uid: string, title: string, start: string, end: string): string[] {
  return [
    "BEGIN:VEVENT",
    `DTSTART;TZID=${LA}:${start}`,
    `DTEND;TZID=${LA}:${end}`,
    `UID:${uid}@thespotlight.la`,
    `SUMMARY:${title}`,
    `URL:https://thespotlight.la/event/${uid}/`,
    "END:VEVENT",
  ];
}

function read(events: string[][]) {
  const calendar = parseIcs(
    [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      `X-WR-TIMEZONE:${LA}`,
      ...events.flat(),
      "END:VCALENDAR",
    ].join("\r\n"),
  );
  return icsToListings(calendar, {
    sourceUrl: "https://thespotlight.la/",
    fetchedAt: new Date("2026-11-16T04:00:00Z"),
    metroTz: LA,
    countryCode: "US",
    fromNight: "2026-11-15",
    days: 60,
  });
}

describe("ics: an event from 00:00 to 23:59 of one day is a date (D-884)", () => {
  const { listings, notes } = read([
    vevent("bensy", "Bensy", "20261120T000000", "20261120T235959"),
    vevent("andre-power", "Andre Power", "20261121T000000", "20261121T235900"),
    vevent("moeaike", "Moeaike", "20261204T220000", "20261205T030000"),
    vevent("late", "Midnight Start", "20261212T000000", "20261212T040000"),
  ]);
  const byTitle = (title: string) => listings.find((l) => l.listing.title === title)?.listing;

  it("reads 00:00-23:59:59 as its own date with no time and no end", () => {
    const bensy = byTitle("Bensy");
    expect(bensy?.local_date).toBe("2026-11-20");
    expect(bensy?.doors_time ?? null).toBeNull();
    expect(bensy?.dancing_time ?? null).toBeNull();
    expect(bensy?.end_time ?? null).toBeNull();
  });

  it("reads 00:00-23:59 the same way", () => {
    const andre = byTitle("Andre Power");
    expect(andre?.local_date).toBe("2026-11-21");
    expect(andre?.end_time ?? null).toBeNull();
  });

  it("keeps a real 22:00 night timed", () => {
    const moeaike = byTitle("Moeaike");
    expect(moeaike?.local_date).toBe("2026-12-04");
    expect(moeaike?.end_time).toBe("03:00");
  });

  it("keeps a midnight start that ends at 4am on the night before (D-854)", () => {
    const late = byTitle("Midnight Start");
    expect(late?.local_date).toBe("2026-12-11");
  });

  it("notes each event read as a date", () => {
    expect(notes.filter((n) => n.startsWith("00:00 to 23:59 read as a date"))).toHaveLength(2);
  });
});
