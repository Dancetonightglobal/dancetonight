import { describe, expect, it } from "vitest";

import { rawExtractionSchema } from "@/src/domain/listing";
import { extractionToHarvested } from "@/src/pipeline/extract";

// D-599: a weekly rule whose own line starts with a later date runs from that date. agozar.com, 2026-11-05: "01 Dec
// Tuesdays 9pm-10pm SALSA - ABSOLUTE BEGINNER 4 week cycle - ..." was listed on Tuesday 11-10 and 11-17, weeks before
// the course starts (cities-3, 2026-11-05).

const NOW = new Date("2026-11-05T10:00:00Z");
const TODAY = "2026-11-05";
const TITLE = "SALSA - ABSOLUTE BEGINNER 4 week cycle";

const page = (line: string) => `SPECIALISED COURSES - SIGN UP NOW

In addition to our walk-in classes above, we also offer specialised courses, click on one for more details and to register.

${line}

>>>>>

Private Lessons`;

function read(pageText: string, listing: Record<string, unknown>) {
  const raw = rawExtractionSchema.parse({
    page_kind: "list",
    language: "en",
    listings: [
      {
        listing_type: "class",
        styles: ["salsa"],
        venue: { name: "Agozar" },
        organizer: {},
        title: TITLE,
        ...listing,
      },
    ],
  });
  return extractionToHarvested(raw, {
    pageUrl: "https://www.agozar.com/",
    fetchedAt: NOW,
    today: TODAY,
    pageText,
    countryCode: "HK",
    weeklyGrid: true,
  });
}

const LINE = `01 Dec Tuesdays 9pm-10pm ${TITLE} - Learn the basics of Salsa in our easy to follow progressive course Sign Up [https://www.agozar.com/courses/1-salsa-absolute-beginners-4-week-course]`;

describe("a weekly rule's start date on its own line (D-599)", () => {
  it("runs from the later date its line starts with", () => {
    const h = read(page(LINE), {
      lesson_time: "21:00",
      end_time: "22:00",
      recurrence_text: "Tuesdays",
    });
    const rule = h.listings.find((l) => l.recurrence !== null);
    expect(rule?.recurrence?.rrule).toBe("FREQ=WEEKLY;BYDAY=TU");
    expect(rule?.recurrence?.dtstartLocal).toBe("2026-12-01T21:00");
  });

  it("runs from today when the date on its line is past", () => {
    const h = read(page(LINE.replace("01 Dec", "06 Oct")), {
      lesson_time: "21:00",
      recurrence_text: "Tuesdays",
    });
    const rule = h.listings.find((l) => l.recurrence !== null);
    expect(rule?.recurrence?.dtstartLocal).toBe(`${TODAY}T21:00`);
  });

  it("runs from today when its line writes no date", () => {
    const h = read(page(LINE.replace("01 Dec ", "")), {
      lesson_time: "21:00",
      recurrence_text: "Tuesdays",
    });
    const rule = h.listings.find((l) => l.recurrence !== null);
    expect(rule?.recurrence?.dtstartLocal).toBe(`${TODAY}T21:00`);
  });

  it("ignores a later date that is not on one of the rule's weekdays", () => {
    // 2026-12-02 is a Wednesday.
    const h = read(page(LINE.replace("01 Dec", "02 Dec")), {
      lesson_time: "21:00",
      recurrence_text: "Tuesdays",
    });
    const rule = h.listings.find((l) => l.recurrence !== null);
    expect(rule?.recurrence?.dtstartLocal).toBe(`${TODAY}T21:00`);
  });

  it("ignores a later date written after the title, on another line", () => {
    const text = page(`Tuesdays 9pm-10pm ${TITLE}\n\nNext course: 01 Dec`);
    const h = read(text, { lesson_time: "21:00", recurrence_text: "Tuesdays" });
    const rule = h.listings.find((l) => l.recurrence !== null);
    expect(rule?.recurrence?.dtstartLocal).toBe(`${TODAY}T21:00`);
  });

  it("runs from today when the first dated line of the title is tonight", () => {
    // 2026-11-05 is a Thursday; the page lists tonight and next week.
    const text = page(`Thu 05 Nov Thursdays 9pm ${TITLE}\n\nThu 12 Nov Thursdays 9pm ${TITLE}`);
    const h = read(text, { lesson_time: "21:00", recurrence_text: "Thursdays" });
    const rule = h.listings.find((l) => l.recurrence !== null);
    expect(rule?.recurrence?.rrule).toBe("FREQ=WEEKLY;BYDAY=TH");
    expect(rule?.recurrence?.dtstartLocal).toBe(`${TODAY}T21:00`);
  });
});
