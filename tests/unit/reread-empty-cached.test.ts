import { describe, it, expect } from "vitest";
import { rawExtractionSchema } from "@/src/domain/listing";
import { emptyReadOfWindowNight } from "@/src/pipeline/extract";
import type { HarvestedListing } from "@/src/adapters/types";

describe("emptyReadOfWindowNight", () => {
  const nights = [
    "2026-11-04",
    "2026-11-05",
    "2026-11-06",
    "2026-11-07",
    "2026-11-08",
    "2026-11-09",
    "2026-11-10",
    "2026-11-11",
    "2026-11-12",
    "2026-11-13",
    "2026-11-14",
    "2026-11-15",
    "2026-11-16",
    "2026-11-17",
  ];

  it("returns true for empty listings with text writing a window night", () => {
    const extraction = rawExtractionSchema.parse({
      page_kind: "list",
      language: "en",
      listings: [],
    });
    const text = `Monday 12 October 2026
Wednesday 11 November 2026
Monday 7 December 2026
Tea Dance Time starts from: 1.30pm - 4.30pm`;
    expect(emptyReadOfWindowNight(extraction, text, nights)).toBe(true);
  });

  it("returns false for empty listings with text writing no window night", () => {
    const extraction = rawExtractionSchema.parse({
      page_kind: "list",
      language: "en",
      listings: [],
    });
    const text = `Monday 12 October 2026
Monday 7 December 2026`;
    expect(emptyReadOfWindowNight(extraction, text, nights)).toBe(false);
  });

  it("returns false for empty listings with text naming a window night in another year", () => {
    const extraction = rawExtractionSchema.parse({
      page_kind: "list",
      language: "en",
      listings: [],
    });
    const text = `Wednesday 11 November 2025`;
    expect(emptyReadOfWindowNight(extraction, text, nights)).toBe(false);
  });

  it("returns false for non-empty listings even if text writes a window night", () => {
    const extraction = rawExtractionSchema.parse({
      page_kind: "list",
      language: "en",
      listings: [
        {
          title: "Tea Dance",
          local_date: "2026-11-11",
          listing_type: "social",
          confidence: { title: 0.9, local_date: 0.9, listing_type: 0.9 },
          evidence: {
            title: "Tea Dance",
            local_date: "Wednesday 11 November 2026",
            listing_type: "social",
          },
        },
      ],
    });
    const text = `Monday 12 October 2026
Wednesday 11 November 2026
Monday 7 December 2026`;
    expect(emptyReadOfWindowNight(extraction, text, nights)).toBe(false);
  });

  it("returns true when every listing is dated outside the window (D-286)", () => {
    const extraction = rawExtractionSchema.parse({
      page_kind: "list",
      language: "en",
      listings: [
        {
          title: "Tea Dance",
          local_date: "2026-03-17",
          listing_type: "social",
          confidence: { title: 0.9, local_date: 0.9, listing_type: 0.9 },
          evidence: {
            title: "Tea Dance",
            local_date: "Date: 17 Mar 2026.",
            listing_type: "social",
          },
        },
      ],
    });
    const text = `Monday 12 October 2026
Wednesday 11 November 2026
Monday 7 December 2026
Tea Dance Time starts from: 1.30pm - 4.30pm
Date: 17 Mar 2026.`;
    expect(emptyReadOfWindowNight(extraction, text, nights)).toBe(true);
  });

  it("returns false when a listing is recurring (D-286)", () => {
    const extraction = rawExtractionSchema.parse({
      page_kind: "list",
      language: "en",
      listings: [
        {
          title: "Tea Dance",
          local_date: "2026-03-17",
          recurrence_text: "every second Wednesday",
          listing_type: "social",
          confidence: {
            title: 0.9,
            local_date: 0.9,
            recurrence_text: 0.8,
            listing_type: 0.9,
          },
          evidence: {
            title: "Tea Dance",
            local_date: "Date: 17 Mar 2026.",
            recurrence_text: "every second Wednesday",
            listing_type: "social",
          },
        },
      ],
    });
    const text = `Monday 12 October 2026
Wednesday 11 November 2026
Monday 7 December 2026
Tea Dance Time starts from: 1.30pm - 4.30pm
Date: 17 Mar 2026.`;
    expect(emptyReadOfWindowNight(extraction, text, nights)).toBe(false);
  });

  it("returns false when a listing has no date (D-286)", () => {
    const extraction = rawExtractionSchema.parse({
      page_kind: "list",
      language: "en",
      listings: [
        {
          title: "Tea Dance",
          local_date: null,
          listing_type: "social",
          confidence: { title: 0.9, listing_type: 0.9 },
          evidence: {
            title: "Tea Dance",
            listing_type: "social",
          },
        },
      ],
    });
    const text = `Monday 12 October 2026
Wednesday 11 November 2026
Monday 7 December 2026
Tea Dance Time starts from: 1.30pm - 4.30pm`;
    expect(emptyReadOfWindowNight(extraction, text, nights)).toBe(false);
  });
});

describe("emptyReadOfWindowNight with checked listings (D-287)", () => {
  const nights = [
    "2026-11-04",
    "2026-11-05",
    "2026-11-06",
    "2026-11-07",
    "2026-11-08",
    "2026-11-09",
    "2026-11-10",
    "2026-11-11",
    "2026-11-12",
    "2026-11-13",
    "2026-11-14",
    "2026-11-15",
    "2026-11-16",
    "2026-11-17",
  ];

  const text = `Monday 12 October 2026
Wednesday 11 November 2026
Monday 7 December 2026
Tea Dance Time starts from: 1.30pm - 4.30pm`;

  it("returns true for empty harvested listings with text writing a window night", () => {
    const extraction = rawExtractionSchema.parse({
      page_kind: "list",
      language: "en",
      listings: [],
    });
    const harvested: readonly HarvestedListing[] = [];
    expect(emptyReadOfWindowNight(extraction, text, nights, harvested)).toBe(true);
  });

  it("returns false for harvested listings dated on a window night", () => {
    const extraction = rawExtractionSchema.parse({
      page_kind: "list",
      language: "en",
      listings: [],
    });
    const harvested: readonly HarvestedListing[] = [
      {
        listing: { local_date: "2026-11-11" },
        recurrence: null,
      } as unknown as HarvestedListing,
    ];
    expect(emptyReadOfWindowNight(extraction, text, nights, harvested)).toBe(false);
  });

  it("returns false for harvested listings with a recurrence", () => {
    const extraction = rawExtractionSchema.parse({
      page_kind: "list",
      language: "en",
      listings: [],
    });
    const harvested: readonly HarvestedListing[] = [
      {
        listing: { local_date: null },
        recurrence: {
          rrule: "FREQ=WEEKLY;BYDAY=WE",
          dtstartLocal: "2026-11-11T12:00",
          exdates: [],
        },
      } as unknown as HarvestedListing,
    ];
    expect(emptyReadOfWindowNight(extraction, text, nights, harvested)).toBe(false);
  });

  it("returns true when raw read had undated recurrence_text but harvested is empty (recurrence dropped)", () => {
    const extraction = rawExtractionSchema.parse({
      page_kind: "list",
      language: "en",
      listings: [
        {
          title: "Tea Dance",
          local_date: null,
          recurrence_text: "every Wednesday",
          listing_type: "social",
          confidence: { title: 0.9, recurrence_text: 0.8, listing_type: 0.9 },
          evidence: {
            title: "Tea Dance",
            recurrence_text: "every Wednesday",
            listing_type: "social",
          },
        },
      ],
    });
    const harvested: readonly HarvestedListing[] = [];
    expect(emptyReadOfWindowNight(extraction, text, nights, harvested)).toBe(true);
  });

  it("returns false when harvested empty but text writes no window night", () => {
    const extraction = rawExtractionSchema.parse({
      page_kind: "list",
      language: "en",
      listings: [],
    });
    const noWindowText = `Monday 12 October 2026
Monday 7 December 2026`;
    const harvested: readonly HarvestedListing[] = [];
    expect(emptyReadOfWindowNight(extraction, noWindowText, nights, harvested)).toBe(false);
  });

  it("returns true when harvested contains only listings dated outside the window (D-286)", () => {
    const extraction = rawExtractionSchema.parse({
      page_kind: "list",
      language: "en",
      listings: [],
    });
    const harvested: readonly HarvestedListing[] = [
      {
        listing: { local_date: "2026-03-17" },
        recurrence: null,
      } as unknown as HarvestedListing,
    ];
    expect(emptyReadOfWindowNight(extraction, text, nights, harvested)).toBe(true);
  });
});
