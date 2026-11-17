// D-267: a cached model read that leaves a dated listing untimed while its own part of the page
// writes a start is re-read by the stronger model.
import { describe, expect, it } from "vitest";

import { rawExtractionSchema } from "@/src/domain/listing";
import { extractionToHarvested } from "@/src/pipeline/extract";

const PAGE = [
  "October 2026",
  "",
  "Salsa Night Thursday October 8, 2026 @ 9PM [https://copperblueslive.com/events/salsa-night-53/]",
  "",
  "Sailor Ripley Live Band Friday October 9, 2026 @ 7PM [https://copperblueslive.com/events/sailor-ripley-live-band-3/]",
  "",
  "After Hours Salsa Night Tuesday October 13, 2026 @ 8PM [https://copperblueslive.com/events/after-hours-salsa-night/]",
  "",
  "Bachata Social Wednesday October 14, 2026 [https://copperblueslive.com/events/bachata-social/]",
].join("\n");

function read(listings: Array<Record<string, unknown>>, pageText: string | null = PAGE) {
  const extraction = rawExtractionSchema.parse({
    page_kind: "list",
    language: "en",
    listings: listings.map((l) => ({
      listing_type: "social",
      styles: [],
      organizer: {},
      venue: {},
      ...l,
    })),
  });
  const out = extractionToHarvested(extraction, {
    pageUrl: "https://copperblueslive.com/locations/miami/live-music/",
    fetchedAt: new Date("2026-10-01T12:00:00Z"),
    today: "2026-10-01",
    pageText,
  });
  return out;
}

describe("times missed: dated listing with no start while page writes one", () => {
  it("counts 1 when a dated listing has no times and its part writes a start", () => {
    const out = read([
      {
        title: "Salsa Night",
        local_date: "2026-10-08",
        // no times
      },
    ]);
    expect(out.timesMissed).toBe(1);
  });

  it("counts 0 when the same listing has a dancing time", () => {
    const out = read([
      {
        title: "Salsa Night",
        local_date: "2026-10-08",
        dancing_time: "21:00",
      },
    ]);
    expect(out.timesMissed).toBe(0);
  });

  it("counts 0 when the page writes no start (Bachata Social)", () => {
    const out = read([
      {
        title: "Bachata Social",
        local_date: "2026-10-14",
        // no times
      },
    ]);
    expect(out.timesMissed).toBe(0);
  });

  it("counts 2 when two dated listings miss a start", () => {
    const out = read([
      {
        title: "Salsa Night",
        local_date: "2026-10-08",
      },
      {
        title: "After Hours Salsa Night",
        local_date: "2026-10-13",
      },
    ]);
    expect(out.timesMissed).toBe(2);
  });

  it("counts 0 when pageText is null (unchecked read)", () => {
    const out = read(
      [
        {
          title: "Salsa Night",
          local_date: "2026-10-08",
        },
      ],
      null,
    );
    expect(out.timesMissed).toBe(0);
  });
});
