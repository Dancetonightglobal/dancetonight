import { describe, it, expect } from "vitest";
import { lineOnPage, fixedNightListings } from "@/src/domain/fixed-nights";
import { parseRule } from "@/src/domain/recurrence";

describe("lineOnPage", () => {
  it("matches with different dash styles and whitespace", () => {
    const page = `ASCEND LOUNGE:   Tuesday — Thursday 9-2`;
    const line = `Ascend Lounge: Tuesday - Thursday 9-2`;
    expect(lineOnPage(line, page)).toBe(true);
  });

  it("returns false for empty line", () => {
    expect(lineOnPage("", "anything")).toBe(false);
  });

  it("ignores script and style blocks", () => {
    const page = `<script>var s="Ascend Lounge: Tuesday - Thursday 9-2";</script><p>Hello</p>`;
    const line = `Ascend Lounge: Tuesday - Thursday 9-2`;
    expect(lineOnPage(line, page)).toBe(false);
  });

  it("ignores style blocks", () => {
    const page = `<style>.foo { content: "Ascend Lounge: Tuesday - Thursday 9-2"; }</style><div>text</div>`;
    const line = `Ascend Lounge: Tuesday - Thursday 9-2`;
    expect(lineOnPage(line, page)).toBe(false);
  });
});

describe("fixedNightListings", () => {
  const baseOptions = {
    pageText: "",
    pageUrl: "https://example.com/page",
    fetchedAt: new Date("2026-11-01T12:00:00Z"),
    fromNight: "2026-11-02",
    currency: "USD",
    sourceStyles: ["lindy_hop"] as const,
    venueName: "Test Venue",
    venueAddress: "123 Street",
    zone: "America/New_York",
  };

  it("creates listing when line is present", () => {
    const pageText = `Ascend Lounge: Tuesday - Thursday 9-2  DJ 9pm -2 am`;
    const fixed = [
      {
        title: "Ascend Lounge DJ",
        line: "Ascend Lounge: Tuesday - Thursday 9-2",
        days: [2, 3, 4], // Tuesday, Wednesday, Thursday
        start: "21:00",
        end: "02:00",
        danceCited: "Checked on venue site 2026-10-31",
      },
    ];
    const result = fixedNightListings(fixed, { ...baseOptions, pageText });
    expect(result.listings).toHaveLength(1);
    expect(result.notes.some((note) => note.includes("fixed weekly night"))).toBe(true);
    const listing = result.listings[0];
    expect(listing).toBeDefined();
    expect(listing?.listing.title).toBe("Ascend Lounge DJ");
    expect(listing?.recurrence?.rrule).toBe("FREQ=WEEKLY;BYDAY=TU,WE,TH");
    expect(listing?.recurrence?.dtstartLocal).toBe("2026-11-03T21:00");
    expect(listing?.listing.doors_time).toBe("21:00");
    expect(listing?.listing.end_time).toBe("02:00");
    expect(listing?.provenance.method).toBe("manual");
    expect(listing?.externalId).toBe("https://example.com/page#fixed:Ascend Lounge DJ");
  });

  it("uses venue from entry when provided", () => {
    const pageText = `Line`;
    const fixed = [
      {
        title: "Night",
        line: "Line",
        days: [1],
        start: "21:00",
        danceCited: "x",
        venue: "Hall X",
      },
    ];
    const result = fixedNightListings(fixed, { ...baseOptions, pageText });
    expect(result.listings).toHaveLength(1);
    const listing = result.listings[0];
    expect(listing?.listing.venue.name).toBe("Hall X");
    expect(listing?.listing.venue.address).toBe("123 Street");
  });

  it("falls back to base venueName when entry venue is absent", () => {
    const pageText = `Line`;
    const fixed = [
      {
        title: "Night",
        line: "Line",
        days: [1],
        start: "21:00",
        danceCited: "x",
        // no venue
      },
    ];
    const result = fixedNightListings(fixed, { ...baseOptions, pageText });
    expect(result.listings).toHaveLength(1);
    const listing = result.listings[0];
    expect(listing?.listing.venue.name).toBe("Test Venue");
  });

  it("uses entry venue when base venueName is null", () => {
    const pageText = `Line`;
    const fixed = [
      {
        title: "Night",
        line: "Line",
        days: [1],
        start: "21:00",
        danceCited: "x",
        venue: "Hall X",
      },
    ];
    const result = fixedNightListings(fixed, {
      ...baseOptions,
      pageText,
      venueName: null,
    });
    expect(result.listings).toHaveLength(1);
    const listing = result.listings[0];
    expect(listing?.listing.venue.name).toBe("Hall X");
  });

  it("ignores whitespace-only venue and falls back to base venueName", () => {
    const pageText = `Line`;
    const fixed = [
      {
        title: "Night",
        line: "Line",
        days: [1],
        start: "21:00",
        danceCited: "x",
        venue: "   ",
      },
    ];
    const result = fixedNightListings(fixed, { ...baseOptions, pageText });
    expect(result.listings).toHaveLength(1);
    const listing = result.listings[0];
    expect(listing?.listing.venue.name).toBe("Test Venue");
  });

  it("returns no listings when line is missing", () => {
    const pageText = `Some other content`;
    const fixed = [
      {
        title: "Ascend Lounge DJ",
        line: "Ascend Lounge: Tuesday - Thursday 9-2",
        days: [2, 3, 4],
        start: "21:00",
        end: "02:00",
        danceCited: "x",
      },
    ];
    const result = fixedNightListings(fixed, { ...baseOptions, pageText });
    expect(result.listings).toHaveLength(0);
    expect(result.notes.some((note) => note.includes("the page no longer writes"))).toBe(true);
  });

  it("handles null start (time not listed)", () => {
    const pageText = `Line here`;
    const fixed = [
      {
        title: "Untimed Night",
        line: "Line here",
        days: [1],
        start: null,
        danceCited: "x",
      },
    ];
    const result = fixedNightListings(fixed, { ...baseOptions, pageText });
    expect(result.listings).toHaveLength(1);
    expect(result.listings[0]?.recurrence?.timeListed).toBe(false);
  });

  it("skips entry with empty days", () => {
    const pageText = `Line here`;
    const fixed = [
      {
        title: "Bad",
        line: "Line here",
        days: [],
        start: "21:00",
        danceCited: "x",
      },
    ];
    const result = fixedNightListings(fixed, { ...baseOptions, pageText });
    expect(result.listings).toHaveLength(0);
    expect(result.notes.some((note) => note.includes("bad days or times"))).toBe(true);
  });

  it("skips entry with invalid time format", () => {
    const pageText = `Line here`;
    const fixed = [
      {
        title: "Bad",
        line: "Line here",
        days: [1],
        start: "9pm",
        danceCited: "x",
      },
    ];
    const result = fixedNightListings(fixed, { ...baseOptions, pageText });
    expect(result.listings).toHaveLength(0);
    expect(result.notes.some((note) => note.includes("bad days or times"))).toBe(true);
  });

  it("skips entry with blank danceCited", () => {
    const pageText = `Line here`;
    const fixed = [
      {
        title: "No citation",
        line: "Line here",
        days: [1],
        start: "21:00",
        danceCited: "   ",
      },
    ];
    const result = fixedNightListings(fixed, { ...baseOptions, pageText });
    expect(result.listings).toHaveLength(0);
    expect(result.notes.some((note) => note.includes("no danceCited"))).toBe(true);
  });

  it("produces stable externalId across different fromNight", () => {
    const pageText = `Some page content that includes the line "Line here" exactly.`;
    const fixed = [
      {
        title: "Stable",
        line: "Line here",
        days: [1],
        start: "21:00",
        danceCited: "x",
      },
    ];
    const result1 = fixedNightListings(fixed, {
      ...baseOptions,
      pageText,
      fromNight: "2026-11-02",
    });
    const result2 = fixedNightListings(fixed, {
      ...baseOptions,
      pageText,
      fromNight: "2026-11-09",
    });
    expect(result1.listings).toHaveLength(1);
    expect(result2.listings).toHaveLength(1);
    expect(result1.listings[0]?.externalId).toBe("https://example.com/page#fixed:Stable");
    expect(result2.listings[0]?.externalId).toBe("https://example.com/page#fixed:Stable");
  });

  it("handles DST week correctly", () => {
    // This test is more about the recurrence library, but we can at least verify the recurrence is built
    const pageText = `Some content with the line "Line here" in it.`;
    const fixed = [
      {
        title: "DST Test",
        line: "Line here",
        days: [4, 5, 6], // Thursday, Friday, Saturday
        start: "21:00",
        danceCited: "x",
      },
    ];
    const result = fixedNightListings(fixed, {
      ...baseOptions,
      pageText,
      fromNight: "2026-10-29", // Friday before DST change
    });
    expect(result.listings).toHaveLength(1);
    const recurrence = result.listings[0]!.recurrence;
    expect(recurrence).toBeDefined();
    // The recurrence should have the correct dtstartLocal
    // The first night on or after 2026-10-29 that is Thursday, Friday, or Saturday is 2026-10-29 (Friday)
    expect(recurrence!.dtstartLocal).toBe("2026-10-29T21:00");
    expect(result.listings[0]!.tz).toBe("America/New_York");
    // US DST ends 2026-11-01: every Thu-Sat night across it stays 21:00 wall-clock in New York.
    const parsed = parseRule(recurrence!.rrule, recurrence!.dtstartLocal, "America/New_York");
    const hits = parsed.rule.between(
      new Date("2026-10-29T00:00:00Z"),
      new Date("2026-11-12T00:00:00Z"),
      true,
    );
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    const seen = hits.map((h: { epochMilliseconds: number }) =>
      fmt.format(new Date(h.epochMilliseconds)),
    );
    expect(seen).toHaveLength(6);
    for (const s of seen) {
      expect(s).toMatch(/^(Thu|Fri|Sat) 21:00$/);
    }
  });

  describe("closed date ranges", () => {
    it("adds exdates for closed range", () => {
      const pageText = "Line";
      const fixed = [
        {
          title: "Night",
          line: "Line",
          days: [1, 2, 3, 4, 5, 6, 0], // all 7 days
          start: "21:30",
          end: "01:30",
          danceCited: "x",
          closed: [{ from: "2026-11-30", to: "2026-12-14", cited: "own site" }],
        },
      ];
      const result = fixedNightListings(fixed, {
        ...baseOptions,
        pageText,
        fromNight: "2026-11-16",
      });
      expect(result.listings).toHaveLength(1);
      const recurrence = result.listings[0]!.recurrence;
      expect(recurrence).toBeDefined();
      expect(recurrence!.exdates).toHaveLength(15);
      expect(recurrence!.exdates![0]).toBe("2026-11-30");
      expect(recurrence!.exdates![14]).toBe("2026-12-14");
      expect(
        result.notes.some((note) => note.includes("closed 2026-11-30 to 2026-12-14 (own site)")),
      ).toBe(true);
    });

    it("deduplicates overlapping closed ranges", () => {
      const pageText = "Line";
      const fixed = [
        {
          title: "Night",
          line: "Line",
          days: [1],
          start: "21:00",
          danceCited: "x",
          closed: [
            { from: "2026-12-01", to: "2026-12-10", cited: "a" },
            { from: "2026-12-05", to: "2026-12-15", cited: "b" },
          ],
        },
      ];
      const result = fixedNightListings(fixed, {
        ...baseOptions,
        pageText,
        fromNight: "2026-11-01",
      });
      expect(result.listings).toHaveLength(1);
      const exdates = result.listings[0]!.recurrence!.exdates!;
      // Total unique days: 2026-12-01 to 2026-12-15 inclusive = 15 days
      expect(exdates).toHaveLength(15);
      expect(exdates).toEqual([
        "2026-12-01",
        "2026-12-02",
        "2026-12-03",
        "2026-12-04",
        "2026-12-05",
        "2026-12-06",
        "2026-12-07",
        "2026-12-08",
        "2026-12-09",
        "2026-12-10",
        "2026-12-11",
        "2026-12-12",
        "2026-12-13",
        "2026-12-14",
        "2026-12-15",
      ]);
    });

    it("ignores closed range entirely before fromNight", () => {
      const pageText = "Line";
      const fixed = [
        {
          title: "Night",
          line: "Line",
          days: [1],
          start: "21:00",
          danceCited: "x",
          closed: [{ from: "2026-10-01", to: "2026-10-10", cited: "old" }],
        },
      ];
      const result = fixedNightListings(fixed, {
        ...baseOptions,
        pageText,
        fromNight: "2026-11-01",
      });
      expect(result.listings).toHaveLength(1);
      expect(result.listings[0]!.recurrence!.exdates).toEqual([]);
      expect(result.notes.some((note) => note.includes("closed"))).toBe(false);
    });

    it("clips a closed range that spans the window's start to the in-window nights", () => {
      const fixed = [
        {
          title: "Night",
          line: "Line",
          days: [0, 1, 2, 3, 4, 5, 6],
          start: "21:00",
          danceCited: "x",
          closed: [{ from: "2026-11-10", to: "2026-11-20", cited: "own site" }],
        },
      ];
      const result = fixedNightListings(fixed, {
        ...baseOptions,
        pageText: "Line",
        fromNight: "2026-11-16",
      });
      expect(result.listings[0]?.recurrence?.exdates).toEqual([
        "2026-11-16",
        "2026-11-17",
        "2026-11-18",
        "2026-11-19",
        "2026-11-20",
      ]);
      expect(result.notes).toContain("Night: closed 2026-11-10 to 2026-11-20 (own site)");
    });

    it("rejects entry with invalid closed range", () => {
      const pageText = "Line";
      const fixed = [
        {
          title: "Bad",
          line: "Line",
          days: [1],
          start: "21:00",
          danceCited: "x",
          closed: [{ from: "2026-12-14", to: "2026-11-30", cited: "backwards" }],
        },
      ];
      const result = fixedNightListings(fixed, {
        ...baseOptions,
        pageText,
        fromNight: "2026-11-01",
      });
      expect(result.listings).toHaveLength(0);
      expect(result.notes.some((note) => note.includes("bad closed range in config"))).toBe(true);
    });

    it("rejects entry with blank cited", () => {
      const pageText = "Line";
      const fixed = [
        {
          title: "Bad",
          line: "Line",
          days: [1],
          start: "21:00",
          danceCited: "x",
          closed: [{ from: "2026-12-01", to: "2026-12-10", cited: "   " }],
        },
      ];
      const result = fixedNightListings(fixed, {
        ...baseOptions,
        pageText,
        fromNight: "2026-11-01",
      });
      expect(result.listings).toHaveLength(0);
      expect(result.notes.some((note) => note.includes("bad closed range in config"))).toBe(true);
    });

    it("handles entry without closed", () => {
      const pageText = "Line";
      const fixed = [
        {
          title: "Night",
          line: "Line",
          days: [1],
          start: "21:00",
          danceCited: "x",
          // no closed
        },
      ];
      const result = fixedNightListings(fixed, {
        ...baseOptions,
        pageText,
        fromNight: "2026-11-01",
      });
      expect(result.listings).toHaveLength(1);
      expect(result.listings[0]!.recurrence!.exdates).toEqual([]);
    });
  });
});

describe("fixed nights on a raw page (D-524 follow-up)", () => {
  const line = "Ascend Lounge: Tuesday - Thursday 9-2";

  it("does not match a line hidden in script JSON, noscript or template blocks", () => {
    for (const block of [
      `<script type="application/json">{"t":"${line}"}</script>`,
      `<noscript>${line}</noscript>`,
      `<template><p>${line}</p></template>`,
    ]) {
      expect(lineOnPage(line, `<html><body>${block}<p>Hello</p></body></html>`)).toBe(false);
    }
  });

  it("reads tags as spaces and decodes entities", () => {
    const raw =
      '<p><span class="wixui-rich-text__text">Ascend Lounge:</span></p><p><span>Tuesday&nbsp;&#8211; Thursday 9-2</span></p>';
    expect(lineOnPage(line, raw)).toBe(true);
    expect(lineOnPage(line, "<p>Ascend Lounge:</p><p>Tuesday &#x2013; Thursday 9-2</p>")).toBe(
      true,
    );
    expect(lineOnPage("Drinks & Dancing", "<b>Drinks &amp; Dancing</b>")).toBe(true);
  });

  it("still matches cleaned page text with no tags", () => {
    expect(lineOnPage(line, "Hours\n\nAscend Lounge: Tuesday - Thursday 9-2\n\nDJ 9pm")).toBe(true);
  });
});

describe("fixed nights after midnight (D-004)", () => {
  const options = {
    pageText: "The line",
    pageUrl: "https://example.com/page",
    fetchedAt: new Date("2026-11-02T12:00:00Z"),
    fromNight: "2026-11-02",
    currency: "USD",
    sourceStyles: ["house"] as const,
    venueName: "Venue",
    venueAddress: "1 Street",
    zone: "America/New_York",
  };
  const entry = (days: number[], start: string, end: string) => ({
    title: "Night",
    line: "The line",
    days,
    start,
    end,
    danceCited: "x",
  });
  const hitsIn = (rrule: string, dtstartLocal: string) => {
    const parsed = parseRule(rrule, dtstartLocal, "America/New_York");
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    return parsed.rule
      .between(new Date("2026-11-02T00:00:00Z"), new Date("2026-11-09T12:00:00Z"), true)
      .map((h: { epochMilliseconds: number }) => fmt.format(new Date(h.epochMilliseconds)));
  };

  it("Wed-Sat 00:00-07:00: the first row is Thursday 00:00-07:00 on Wednesday's night", () => {
    const { listings } = fixedNightListings([entry([3, 4, 5, 6], "00:00", "07:00")], options);
    const l = listings[0]!;
    expect(l.listing.local_date).toBe("2026-11-04");
    expect(l.listing.end_time).toBe("07:00");
    expect(l.recurrence!.rrule).toBe("FREQ=WEEKLY;BYDAY=TH,FR,SA,SU");
    expect(l.recurrence!.dtstartLocal).toBe("2026-11-05T00:00");
    expect(hitsIn(l.recurrence!.rrule, l.recurrence!.dtstartLocal)).toEqual([
      "Thu 00:00",
      "Fri 00:00",
      "Sat 00:00",
      "Sun 00:00",
    ]);
  });

  it("23:00-02:00 stays on the night's own calendar day", () => {
    const { listings } = fixedNightListings([entry([5], "23:00", "02:00")], options);
    const l = listings[0]!;
    expect(l.listing.local_date).toBe("2026-11-06");
    expect(l.recurrence!.rrule).toBe("FREQ=WEEKLY;BYDAY=FR");
    expect(l.recurrence!.dtstartLocal).toBe("2026-11-06T23:00");
    expect(l.listing.end_time).toBe("02:00");
  });

  it("01:00-06:00 Fri-Sat nights start Saturday and Sunday at 01:00", () => {
    const { listings } = fixedNightListings([entry([5, 6], "01:00", "06:00")], options);
    const l = listings[0]!;
    expect(l.listing.local_date).toBe("2026-11-06");
    expect(l.recurrence!.rrule).toBe("FREQ=WEEKLY;BYDAY=SA,SU");
    expect(l.recurrence!.dtstartLocal).toBe("2026-11-07T01:00");
    expect(hitsIn(l.recurrence!.rrule, l.recurrence!.dtstartLocal)).toEqual([
      "Sat 01:00",
      "Sun 01:00",
    ]);
  });
});
