import { describe, expect, it } from "vitest";

import { rawExtractionSchema } from "@/src/domain/listing";
import { extractionToHarvested } from "@/src/pipeline/extract";

const NOW = new Date("2026-10-29T14:00:00Z");
const TONIGHT = "2026-10-29";

function reply(listings: Array<Record<string, unknown>>, language: string = "en") {
  return rawExtractionSchema.parse({
    page_kind: "list",
    language,
    listings: listings.map((l) => ({
      listing_type: "class",
      styles: [],
      venue: { name: "A studio" },
      organizer: {},
      ...l,
    })),
  });
}

const read = (
  pageUrl: string,
  text: string,
  listings: Array<Record<string, unknown>>,
  extra: { weeklyGrid?: boolean; countryCode?: string; language?: string } = {},
) =>
  extractionToHarvested(reply(listings, extra.language ?? "en"), {
    pageUrl,
    fetchedAt: NOW,
    today: TONIGHT,
    pageText: text,
    countryCode: "HK",
    ...extra,
  });

describe("weekly grid slots (D-673)", () => {
  const grid = `Monday

8pm-9pm

Salsa Partner Work

Drop-in

Tuesday

7pm-8pm

Body Isolation & Application

8pm-9pm

Salsa Partner Work

9pm-10pm

Salsa Partner Work

Thursday

7pm-8pm

Salsa Partner Work

9pm-10pm

Salsa Partner Work

Friday

7pm-8pm

Salsa Partner Work

Saturday

4:30pm-5:30pm

Salsa Partner Work`;

  it("Salsa Partner Work at 20:00 -> MO,TU", () => {
    const result = read(
      "https://example.com/",
      grid,
      [
        {
          title: "Salsa Partner Work",
          lesson_time: "20:00",
          evidence: { lesson_time: "8pm-9pm" },
        },
      ],
      { weeklyGrid: true, language: "en" },
    );
    expect(result.rejected).toEqual([]);
    expect(result.listings).toHaveLength(1);
    expect(result.listings[0]?.recurrence?.rrule).toBe("FREQ=WEEKLY;BYDAY=MO,TU");
  });

  it("Salsa Partner Work at 21:00 -> TU,TH", () => {
    const result = read(
      "https://example.com/",
      grid,
      [
        {
          title: "Salsa Partner Work",
          lesson_time: "21:00",
          evidence: { lesson_time: "9pm-10pm" },
        },
      ],
      { weeklyGrid: true, language: "en" },
    );
    expect(result.rejected).toEqual([]);
    expect(result.listings).toHaveLength(1);
    expect(result.listings[0]?.recurrence?.rrule).toBe("FREQ=WEEKLY;BYDAY=TU,TH");
  });

  it("Salsa Partner Work at 19:00 -> TH,FR", () => {
    const result = read(
      "https://example.com/",
      grid,
      [
        {
          title: "Salsa Partner Work",
          lesson_time: "19:00",
          evidence: { lesson_time: "7pm-8pm" },
        },
      ],
      { weeklyGrid: true, language: "en" },
    );
    expect(result.rejected).toEqual([]);
    expect(result.listings).toHaveLength(1);
    expect(result.listings[0]?.recurrence?.rrule).toBe("FREQ=WEEKLY;BYDAY=TH,FR");
  });

  it("Salsa Partner Work at 16:30 -> SA", () => {
    const result = read(
      "https://example.com/",
      grid,
      [
        {
          title: "Salsa Partner Work",
          lesson_time: "16:30",
          evidence: { lesson_time: "4:30pm-5:30pm" },
        },
      ],
      { weeklyGrid: true, language: "en" },
    );
    expect(result.rejected).toEqual([]);
    expect(result.listings).toHaveLength(1);
    expect(result.listings[0]?.recurrence?.rrule).toBe("FREQ=WEEKLY;BYDAY=SA");
  });

  it("Body Isolation & Application at 19:00 -> TU", () => {
    const result = read(
      "https://example.com/",
      grid,
      [
        {
          title: "Body Isolation & Application",
          lesson_time: "19:00",
          evidence: { lesson_time: "7pm-8pm" },
        },
      ],
      { weeklyGrid: true, language: "en" },
    );
    expect(result.rejected).toEqual([]);
    expect(result.listings).toHaveLength(1);
    expect(result.listings[0]?.recurrence?.rrule).toBe("FREQ=WEEKLY;BYDAY=TU");
  });

  it("Salsa Partner Work at 23:00 (no slot matches) -> union MO,TU,TH,FR,SA", () => {
    const result = read(
      "https://example.com/",
      grid,
      [
        {
          title: "Salsa Partner Work",
          lesson_time: "23:00",
          evidence: { lesson_time: "11pm" },
        },
      ],
      { weeklyGrid: true, language: "en" },
    );
    expect(result.rejected).toEqual([]);
    expect(result.listings).toHaveLength(1);
    expect(result.listings[0]?.recurrence?.rrule).toBe("FREQ=WEEKLY;BYDAY=MO,TU,TH,FR,SA");
  });

  it("weeklyGridRule with no startTime gives union", async () => {
    const { weeklyGridRule } = await import("@/src/pipeline/weekly-grid");
    const { foldPage } = await import("@/src/domain/text-facts");
    const page = foldPage(grid);
    const rule = weeklyGridRule(page, grid, "Salsa Partner Work", null, "en");
    expect(rule).not.toBeNull();
    expect(rule!.rrule).toBe("FREQ=WEEKLY;BYDAY=MO,TU,TH,FR,SA");
  });

  const gridWithAddress = `Monday

8pm-9pm

Salsa Partner Work

Drop-in

Tuesday

7pm-8pm

Body Isolation & Application

8pm-9pm

Salsa Partner Work

9pm-10pm

Salsa Partner Work

Thursday

7pm-8pm

Salsa Partner Work

9pm-10pm

Salsa Partner Work

Friday

7pm-8pm

Salsa Partner Work

Saturday

4:30pm-5:30pm

Salsa Partner Work

Sunday

15 Wyndham Street

2026 Season

Salsa Partner Work`;

  it("Salsa Partner Work at 20:00 with address lines -> exactly MO,TU (no SU)", () => {
    const result = read(
      "https://example.com/",
      gridWithAddress,
      [
        {
          title: "Salsa Partner Work",
          lesson_time: "20:00",
          evidence: { lesson_time: "8pm-9pm" },
        },
      ],
      { weeklyGrid: true, language: "en" },
    );
    expect(result.rejected).toEqual([]);
    expect(result.listings).toHaveLength(1);
    expect(result.listings[0]?.recurrence?.rrule).toBe("FREQ=WEEKLY;BYDAY=MO,TU");
  });

  it("Salsa Partner Work at 15:00 (no slot matches) -> union SU,MO,TU,TH,FR,SA", () => {
    const result = read(
      "https://example.com/",
      gridWithAddress,
      [
        {
          title: "Salsa Partner Work",
          lesson_time: "15:00",
          evidence: { lesson_time: "3pm" },
        },
      ],
      { weeklyGrid: true, language: "en" },
    );
    expect(result.rejected).toEqual([]);
    expect(result.listings).toHaveLength(1);
    expect(result.listings[0]?.recurrence?.rrule).toBe("FREQ=WEEKLY;BYDAY=SU,MO,TU,TH,FR,SA");
  });
});
