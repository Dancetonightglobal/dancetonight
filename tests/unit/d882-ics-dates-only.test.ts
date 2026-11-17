import { describe, expect, it } from "vitest";

import { icsToListings, parseIcs } from "@/src/adapters/feeds/ics";

// D-882: thespotlight.la's ?ical=1 gives every event DTSTART;TZID=...:T000000 with no DTEND. Those
// are dates, not midnight starts: each is its own DTSTART date with the time not listed, not the
// night before. A feed with other times keeps a midnight start as a real club-night start (D-854).

const NOW = new Date("2026-11-13T18:00:00Z");

function feed(events: string[]): string {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "X-WR-TIMEZONE:America/Los_Angeles",
    ...events,
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}

function vevent(uid: string, title: string, start: string, end?: string): string {
  return [
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `SUMMARY:${title}`,
    `DTSTART;TZID=America/Los_Angeles:${start}`,
    ...(end ? [`DTEND;TZID=America/Los_Angeles:${end}`] : []),
    "DESCRIPTION:",
    "END:VEVENT",
  ].join("\r\n");
}

function read(text: string) {
  return icsToListings(parseIcs(text), {
    sourceUrl: "https://thespotlight.la/eventslist/?ical=1",
    fetchedAt: NOW,
    metroTz: "America/Los_Angeles",
    countryCode: "US",
    fromNight: "2026-11-13",
    days: 14,
  });
}

const nightOf = (l: { listing: unknown }) => {
  const row = l.listing as Record<string, unknown>;
  return [row.title, row.local_date, row.dancing_time ?? null];
};

describe("an ICS feed whose every event starts at local midnight with no end (D-882)", () => {
  it("files each event on its own date with no time", () => {
    const { listings, notes } = read(
      feed([
        vevent("a@spotlight", "Simon Says", "20261114T000000"),
        vevent("b@spotlight", "Groove Motive", "20261115T000000"),
        vevent("c@spotlight", "Bensy", "20261120T000000"),
      ]),
    );
    expect(listings.map(nightOf)).toEqual([
      ["Simon Says", "2026-11-14", null],
      ["Groove Motive", "2026-11-15", null],
      ["Bensy", "2026-11-20", null],
    ]);
    expect(notes.some((n) => n.includes("read as dates"))).toBe(true);
  });

  it("keeps a midnight start as the night before when the feed gives other times", () => {
    const { listings } = read(
      feed([
        vevent("a@club", "Late Party", "20261114T000000"),
        vevent("b@club", "Salsa Social", "20261115T210000"),
      ]),
    );
    const late = listings.map(nightOf).find((r) => r[0] === "Late Party");
    expect(late?.[1]).toBe("2026-11-13");
  });

  it("keeps midnight starts that have an end", () => {
    const { listings } = read(
      feed([
        vevent("a@club", "After Hours", "20261114T000000", "20261114T040000"),
        vevent("b@club", "Night Two", "20261121T000000", "20261121T040000"),
      ]),
    );
    expect(listings.map((l) => nightOf(l)[1])).toEqual(["2026-11-13", "2026-11-20"]);
  });

  it("does not apply to a single event", () => {
    const { listings } = read(feed([vevent("a@club", "One Night", "20261114T000000")]));
    expect(nightOf(listings[0]!)[1]).toBe("2026-11-13");
  });
});
