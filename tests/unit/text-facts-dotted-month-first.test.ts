import { describe, expect, it } from "vitest";
import { statesDate, foldPage, dateBesideTitle, contradictingDate } from "@/src/domain/text-facts";
import { rawExtractionSchema } from "@/src/domain/listing";
import { extractionToHarvested } from "@/src/pipeline/extract";

describe("text-facts: dotted month-first date with a year", () => {
  describe("statesDate", () => {
    it("accepts month-first dotted date with 2-digit year", () => {
      expect(statesDate("11.14.26", "2026-11-14", "en")).toBe(true);
      expect(statesDate("11.14.2026", "2026-11-14", "en-US")).toBe(true);
      expect(statesDate("12.4.26", "2026-12-04", "en")).toBe(true);
    });

    it("accepts month-first dotted date with weekday before", () => {
      expect(statesDate("Saturday 11.14.26", "2026-11-14", "en")).toBe(true);
    });

    it("rejects month-first dotted date with wrong year", () => {
      expect(statesDate("11.14.25", "2026-11-14", "en")).toBe(false);
    });

    it("rejects month-first dotted date with wrong day", () => {
      expect(statesDate("11.14.26", "2026-11-13", "en")).toBe(false);
    });

    it("still accepts day-first dotted date", () => {
      expect(statesDate("14.11.2026", "2026-11-14", "en")).toBe(true);
    });

    it("rejects month-first dotted number without year", () => {
      expect(statesDate("Doors 5.30", "2026-05-30", "en")).toBe(false);
    });

    it("rejects month-first dotted number with extra digits", () => {
      expect(statesDate("11.14.263", "2026-11-14", "en")).toBe(false);
    });
  });

  describe("Somewhere Nowhere NYC card layout", () => {
    const pageText = `DAYLIFE
NIGHTLIFE
Gotham Jazz
THE HOT TODDIES JAZZ BAND
5:00 pm
Wednesday
11.11.26
RESERVATIONS
DAYLIFE
NIGHTLIFE
Suave Saturdays
Somewhere Nowhere NYC presents Suave Saturdays, a Latin-Inspired Sunset Party.
5:00 pm
Saturday
11.14.26
RESERVATIONS
DAYLIFE
NIGHTLIFE
ANNA (with Ardeshir, Solína) | Haus of Joon
Haus of Joon returns with ANNA.
10:00 pm
Friday
11.20.26
RESERVATIONS`;

    const others = [
      "Gotham Jazz",
      "Suave Saturdays",
      "ANNA (with Ardeshir, Solína) | Haus of Joon",
    ];

    const page = foldPage(pageText);
    const lang = "en";

    it("reads the dotted month-first date beside the title", () => {
      const result = dateBesideTitle(page, "Suave Saturdays", "2026-11-14", lang, others);
      expect(result.stated).toBe(true);
    });

    it("does not contradict when the page gives the same date", () => {
      const result = contradictingDate(
        page,
        pageText,
        "Suave Saturdays",
        "2026-11-14",
        lang,
        others,
      );
      expect(result).toBeNull();
    });

    it("does not contradict for ANNA", () => {
      const result = contradictingDate(
        page,
        pageText,
        "ANNA (with Ardeshir, Solína) | Haus of Joon",
        "2026-11-20",
        lang,
        others,
      );
      expect(result).toBeNull();
    });

    it("does not contradict for Gotham Jazz", () => {
      const result = contradictingDate(page, pageText, "Gotham Jazz", "2026-11-11", lang, others);
      expect(result).toBeNull();
    });

    it("still catches a date the page does not give", () => {
      const result = contradictingDate(
        page,
        pageText,
        "ANNA (with Ardeshir, Solína) | Haus of Joon",
        "2026-11-21",
        lang,
        others,
      );
      expect(result).not.toBeNull();
    });
  });
});

describe("extract: a card dated below its title keeps its night (Somewhere Nowhere, 2026-11-03)", () => {
  const text = `DAYLIFE
NIGHTLIFE
TBA
Presented by Somewhere Nowhere NYC
11:00 pm
Friday
11.13.26
RESERVATIONS
DAYLIFE
NIGHTLIFE
Haus of Joon Presents
Presented by Somewhere Nowhere NYC
‍
‍
11:00 pm
Saturday
11.14.26
RESERVATIONS
DAYLIFE
NIGHTLIFE
Loco Carnaval: TBA
Music by Loco Carnaval Sundays
11:00 pm
Sunday
11.15.26
RESERVATIONS`;
  const read = (listings: Array<{ title: string; local_date: string }>) =>
    extractionToHarvested(
      rawExtractionSchema.parse({
        page_kind: "list",
        language: "en-US",
        listings: listings.map((l) => ({
          listing_type: "club_night",
          styles: [],
          venue: { name: "Somewhere Nowhere NYC" },
          organizer: {},
          ...l,
        })),
      }),
      {
        pageUrl: "https://www.somewherenowherenyc.com/events",
        fetchedAt: new Date("2026-11-03T15:05:00Z"),
        today: "2026-11-03",
        pageText: text,
        countryCode: "US",
      },
    );

  it("keeps each card on the date printed below its title", () => {
    const result = read([
      { title: "TBA", local_date: "2026-11-13" },
      { title: "Haus of Joon Presents", local_date: "2026-11-14" },
      { title: "Loco Carnaval: TBA", local_date: "2026-11-15" },
    ]);
    expect(result.rejected).toEqual([]);
    expect(result.listings.map((h) => h.listing.local_date)).toEqual([
      "2026-11-13",
      "2026-11-14",
      "2026-11-15",
    ]);
  });

  it("still rejects a night the card does not print", () => {
    const result = read([
      { title: "TBA", local_date: "2026-11-13" },
      { title: "Haus of Joon Presents", local_date: "2026-11-21" },
    ]);
    expect(result.rejected.map((r) => r.title)).toContain("Haus of Joon Presents");
  });
});
