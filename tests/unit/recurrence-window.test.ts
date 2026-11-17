// Where a listing's recurrence may stand on its page (D-073, D-074): beside its own title, not in
// the next entry's details and not anywhere on the page. A weekday the model copies from a
// neighbour would otherwise stand, and the listing would gain nights the page never gives it.

import { describe, expect, it } from "vitest";

import { rawExtractionSchema } from "@/src/domain/listing";
import { foldPage, recurrenceNearTitle, weekdaysNearTitle } from "@/src/domain/text-facts";
import { extractionToHarvested } from "@/src/pipeline/extract";

const DENSE = [
  "Social Salsa Night at the Loft Come dance with us Wed, Sep 30 • 8:00 PM The Loft Learn More",
  "Social Bachata Sunday Our weekly bachata Sun, Oct 4 • 7:00 PM Studio B Learn More",
].join("\n");

const DENSE_WEEKLY = [
  "Social Salsa Night at the Loft Come dance with us Wednesdays • 8:00 PM The Loft Learn More",
  "Social Bachata Sunday Our weekly bachata Sundays • 7:00 PM Studio B Learn More",
].join("\n");

const GROUPED = [
  "Weekly classes",
  "MONDAYS",
  "Intro to Salsa 7pm",
  "Intermediate Salsa 8pm",
  "TUESDAYS",
  "Bachata Basics 7pm",
].join("\n");

const DATED = [
  "Wednesday, September 30",
  "Gotham Jazz",
  "7pm at the Rooftop",
  "Thursday, October 1",
  "Frim Fram Jam",
  "8pm",
].join("\n");

describe("recurrenceNearTitle reads beside the title only", () => {
  it("does not take the previous entry's weekday on a dense list", () => {
    const page = foldPage(DENSE_WEEKLY);
    const others = ["Salsa Night at the Loft", "Bachata Sunday"];
    // Salsa's "Wednesdays" stands within 40 words before Bachata's title, on the line above.
    expect(recurrenceNearTitle(page, "Bachata Sunday", "every Wednesday", "en", others)).toBe(
      false,
    );
    expect(recurrenceNearTitle(page, "Bachata Sunday", "every Sunday", "en", others)).toBe(true);
    expect(
      recurrenceNearTitle(page, "Salsa Night at the Loft", "every Wednesday", "en", others),
    ).toBe(true);
  });

  it("does not read a date's weekday as a weekly night (D-080)", () => {
    // "Wed, Sep 30" is one Wednesday, not every Wednesday: NYC Swings' cards print one date each.
    const page = foldPage(DENSE);
    const others = ["Salsa Night at the Loft", "Bachata Sunday"];
    expect(
      recurrenceNearTitle(page, "Salsa Night at the Loft", "every Wednesday", "en", others),
    ).toBe(false);
    // Bachata's own title names Sunday, as CDNY's "ENGLISH - TUESDAYS" does.
    expect(recurrenceNearTitle(page, "Bachata Sunday", "every Sunday", "en", others)).toBe(true);
  });

  it("does not read past the next listing's title", () => {
    const page = foldPage("Salsa Night 9pm Bachata Night every Friday 10pm");
    const others = ["Salsa Night", "Bachata Night"];
    expect(recurrenceNearTitle(page, "Salsa Night", "every Friday", "en", others)).toBe(false);
    expect(recurrenceNearTitle(page, "Bachata Night", "every Friday", "en", others)).toBe(true);
  });

  it("gives every class under a weekday heading that weekday", () => {
    const page = foldPage(GROUPED);
    const others = ["Intro to Salsa", "Intermediate Salsa", "Bachata Basics"];
    expect(recurrenceNearTitle(page, "Intermediate Salsa", "every Monday", "en", others)).toBe(
      true,
    );
    expect(recurrenceNearTitle(page, "Bachata Basics", "every Tuesday", "en", others)).toBe(true);
    expect(recurrenceNearTitle(page, "Bachata Basics", "every Monday", "en", others)).toBe(false);
  });

  it("gives the listings under a dated heading its night, not its weekday every week (D-080)", () => {
    // The Ronda, run 30: "Tuesday, September 29, 2026" over a milonga is not "every Tuesday".
    const page = foldPage(DATED);
    const others = ["Gotham Jazz", "Frim Fram Jam"];
    expect(recurrenceNearTitle(page, "Gotham Jazz", "every Wednesday", "en", others)).toBe(false);
    expect(recurrenceNearTitle(page, "Gotham Jazz", "every Thursday", "en", others)).toBe(false);
    expect(weekdaysNearTitle(page, "Frim Fram Jam", "en", others)).toEqual(new Set());
  });

  it("still gives the listings under an undated weekday heading its weekday (D-080)", () => {
    const page = foldPage("1st & 3rd Fridays of the month\nContra Night\n8pm");
    expect(recurrenceNearTitle(page, "Contra Night", "1st and 3rd Friday", "en", [])).toBe(true);
    expect(weekdaysNearTitle(page, "Contra Night", "en", [])).toEqual(new Set(["FR"]));
  });
});

describe("a dated line under a title", () => {
  it("is the title's own date when no other title follows it (a Squarespace summary)", () => {
    const page = foldPage(
      "Salsa Thursdays\nSunday, October 4\nEvery Tuesday\n\nBachata Night\n9pm",
    );
    const others = ["Salsa Thursdays", "Bachata Night"];
    // Its own title names Thursday, as CDNY's "ENGLISH - TUESDAYS" does; "Every Tuesday" is a
    // weekday beside it; "Sunday, October 4" is one Sunday, a date, not a weekday (D-080).
    expect(weekdaysNearTitle(page, "Salsa Thursdays", "en", others)).toEqual(new Set(["TH", "TU"]));
    // Nor is it a heading over the listings further down.
    expect(weekdaysNearTitle(page, "Bachata Night", "en", others)).toEqual(new Set());
  });

  it("heads the next listing's night when that listing follows it at once", () => {
    const page = foldPage("Gotham Jazz\nThursday, October 1\nFrim Fram Jam\n8pm");
    const others = ["Gotham Jazz", "Frim Fram Jam"];
    expect(recurrenceNearTitle(page, "Gotham Jazz", "every Thursday", "en", others)).toBe(false);
    // It heads Frim Fram Jam's night, and a dated heading gives a night, not a weekly rule (D-080).
    expect(recurrenceNearTitle(page, "Frim Fram Jam", "every Thursday", "en", others)).toBe(false);
  });
});

describe("a recurrence the page writes for another listing is not this one's", () => {
  const reply = (listings: Array<{ title: string; recurrence_text?: string }>) =>
    rawExtractionSchema.parse({
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

  it("drops a weekday copied from a neighbour, and keeps the neighbour's", () => {
    const pageText = "Salsa Social\nEvery Thursday, 9pm\n\nBachata Night\nSaturdays, 10pm";
    const read = extractionToHarvested(
      reply([
        { title: "Salsa Social", recurrence_text: "Every Thursday" },
        { title: "Bachata Night", recurrence_text: "Every Thursday" },
      ]),
      {
        pageUrl: "https://studio.example/socials",
        fetchedAt: new Date("2026-09-28T14:00:00Z"),
        today: "2026-09-28",
        pageText,
        countryCode: "US",
      },
    );
    expect(read.recurrenceNotOnPage).toEqual(["Bachata Night"]);
    expect(read.listings.map((h) => h.listing.title)).toEqual(["Salsa Social"]);
  });
});
