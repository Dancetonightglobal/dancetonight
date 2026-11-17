import { describe, expect, it } from "vitest";

import { rawExtractionSchema } from "@/src/domain/listing";
import { extractionToHarvested } from "@/src/pipeline/extract";

const NOW = new Date("2026-10-29T14:00:00Z");
const TONIGHT = "2026-10-29";

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
  text: string,
  listings: Array<Record<string, unknown>>,
  extra: { weeklyGrid?: boolean; countryCode?: string } = {},
) =>
  extractionToHarvested(reply(listings), {
    pageUrl,
    fetchedAt: NOW,
    today: TONIGHT,
    pageText: text,
    countryCode: "US",
    ...extra,
  });

describe("weekly grid monthly headings", () => {
  const tango = `Milongas & Practicas
We hold a weekly milonga on Wednesday nights, and our big monthly milonga on the 4th Saturday of each month.
__Wednesdays__
__9 pm-midnight:__ Palermo Fishtown Milonga, preceded by two classes. Milonga costs $10.

__1st & 3rd Sundays of the month__
__4-6 pm:__ Bailongo de los domingos Practica, a real PRACTICING practica. $10

__4th Saturdays of the month:__
__8:30-9:30 pm:__ Pre-milonga Class
__9:30 pm-2 am:__ Milonga Qilombo with excellent DJs, often with live music
Philadelphia Argentine Tango School 2030 Frankford Ave, Philadelphia, PA 19125`;

  it("Palermo Fishtown Milonga gives weekly WE rule", () => {
    const result = read("https://example.com/", tango, [{ title: "Palermo Fishtown Milonga" }], {
      weeklyGrid: true,
    });
    expect(result.rejected).toEqual([]);
    expect(result.listings).toHaveLength(1);
    expect(result.listings[0]?.recurrence?.rrule).toBe("FREQ=WEEKLY;BYDAY=WE");
  });

  it("Milonga Qilombo gives monthly rule with BYSETPOS=4", () => {
    const result = read("https://example.com/", tango, [{ title: "Milonga Qilombo" }], {
      weeklyGrid: true,
    });
    expect(result.rejected).toEqual([]);
    expect(result.listings).toHaveLength(1);
    const rrule = result.listings[0]?.recurrence?.rrule;
    expect(rrule).toBe("FREQ=MONTHLY;BYDAY=SA;BYSETPOS=4");
  });

  it("Bailongo de los domingos Practica gives monthly rule with BYSETPOS=1,3", () => {
    const result = read(
      "https://example.com/",
      tango,
      [{ title: "Bailongo de los domingos Practica" }],
      {
        weeklyGrid: true,
      },
    );
    expect(result.rejected).toEqual([]);
    expect(result.listings).toHaveLength(1);
    const rrule = result.listings[0]?.recurrence?.rrule;
    expect(rrule).toBe("FREQ=MONTHLY;BYDAY=SU;BYSETPOS=1,3");
  });

  it("without weeklyGrid flag: no rule", () => {
    const result = read("https://example.com/", tango, [{ title: "Milonga Qilombo" }], {
      weeklyGrid: false,
    });
    expect(result.listings.every((l) => !l.recurrence)).toBe(true);
  });

  it("date-heading stop prevents weekly rule", () => {
    const page = `Saturdays
Salsa Night
Friday, November 6
Special Bachata Party`;
    const result = read("https://example.com/", page, [{ title: "Special Bachata Party" }], {
      weeklyGrid: true,
    });
    expect(result.listings).toHaveLength(1);
    const rrule = result.listings[0]?.recurrence?.rrule;
    if (rrule) {
      expect(rrule).not.toContain("BYDAY=SA");
    }
  });

  it("date-heading stop: Salsa Night still gets weekly rule", () => {
    const page = `Saturdays
Salsa Night
Friday, November 6
Special Bachata Party`;
    const result = read("https://example.com/", page, [{ title: "Salsa Night" }], {
      weeklyGrid: true,
    });
    expect(result.listings).toHaveLength(1);
    expect(result.listings[0]?.recurrence?.rrule).toBe("FREQ=WEEKLY;BYDAY=SA");
  });
});
