import { describe, expect, it } from "vitest";

import { rawExtractionSchema } from "@/src/domain/listing";
import { extractionToHarvested } from "@/src/pipeline/extract";

const NOW = new Date("2026-09-28T14:00:00Z");
const TONIGHT = "2026-09-28";

function reply(listings: Array<Record<string, unknown>>) {
  return rawExtractionSchema.parse({
    page_kind: "list",
    language: "en",
    listings: listings.map((l) => ({
      listing_type: "social",
      styles: [],
      venue: { name: "A studio" },
      organizer: {},
      ...l,
    })),
  });
}

const read = (
  pageUrl: string,
  text: string | null,
  listings: Array<Record<string, unknown>>,
  extra: { directory?: boolean; countryCode?: string } = {},
) =>
  extractionToHarvested(reply(listings), {
    pageUrl,
    fetchedAt: NOW,
    today: TONIGHT,
    pageText: text,
    countryCode: "US",
    ...extra,
  });

describe("title with trailing aside in brackets", () => {
  const pageText = `Wednesday classes
Salsa | Advanced Beginner – Level 102
7:00 PM - 8:00 PM
Every Wednesday
Ladies Styling
Every Thursday`;

  it("keeps 'Salsa Advanced Beginner – Level 102 (Wednesdays)' as 'Salsa Advanced Beginner – Level 102'", () => {
    const result = read("https://example.com/", pageText, [
      {
        title: "Salsa Advanced Beginner – Level 102 (Wednesdays)",
        recurrence_text: "Every Wednesday",
        local_date: "2026-10-07",
      },
    ]);
    expect(result.rejected).toEqual([]);
    expect(result.listings).toHaveLength(1);
    expect(result.listings[0]?.listing.title).toBe("Salsa Advanced Beginner – Level 102");
  });

  it("keeps 'Ladies Styling (Thursdays)' as 'Ladies Styling'", () => {
    const result = read("https://example.com/", pageText, [
      {
        title: "Ladies Styling (Thursdays)",
        recurrence_text: "Every Thursday",
        local_date: "2026-10-08",
      },
    ]);
    expect(result.rejected).toEqual([]);
    expect(result.listings).toHaveLength(1);
    expect(result.listings[0]?.listing.title).toBe("Ladies Styling");
  });

  it("rejects '(Wednesdays)' alone", () => {
    const result = read("https://example.com/", pageText, [
      {
        title: "(Wednesdays)",
        recurrence_text: "Every Wednesday",
        local_date: "2026-10-07",
      },
    ]);
    expect(result.rejected).toEqual([
      { title: "(Wednesdays)", reason: "the page does not write this title; not listed" },
    ]);
    expect(result.notOnPage).toEqual(["(Wednesdays)"]);
  });

  it("rejects 'Bachata Basics (Fridays)' when not on page", () => {
    const result = read("https://example.com/", pageText, [
      {
        title: "Bachata Basics (Fridays)",
        recurrence_text: "Every Friday",
        local_date: "2026-10-09",
      },
    ]);
    expect(result.rejected).toEqual([
      {
        title: "Bachata Basics (Fridays)",
        reason: "the page does not write this title; not listed",
      },
    ]);
    expect(result.notOnPage).toEqual(["Bachata Basics (Fridays)"]);
  });

  it("keeps exact title 'Tango (Milonga) Night' when page writes it", () => {
    const text = `Tango (Milonga) Night
Every Friday`;
    const result = read("https://example.com/", text, [
      {
        title: "Tango (Milonga) Night",
        recurrence_text: "Every Friday",
        local_date: "2026-10-09",
      },
    ]);
    expect(result.rejected).toEqual([]);
    expect(result.listings).toHaveLength(1);
    expect(result.listings[0]?.listing.title).toBe("Tango (Milonga) Night");
  });

  it("does not shorten when pageText is null", () => {
    const result = read("https://example.com/", null, [
      {
        title: "Ladies Styling (Thursdays)",
        recurrence_text: "Every Thursday",
        local_date: "2026-10-08",
      },
    ]);
    // Without page text, the title check is skipped (unchecked: true)
    expect(result.unchecked).toBe(true);
    expect(result.listings).toHaveLength(1);
    expect(result.listings[0]?.listing.title).toBe("Ladies Styling (Thursdays)");
  });
});
