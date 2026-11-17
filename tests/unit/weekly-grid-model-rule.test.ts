import { describe, expect, it } from "vitest";

import { rawExtractionSchema } from "@/src/domain/listing";
import { extractionToHarvested } from "@/src/pipeline/extract";

// D-763 (fixture from weekly-grid-cells, D-598): agozar.com's drop-in grid as the page cleaner writes it (2026-11-05): a blank line between cells and each
// cell's link after its words ("Level 1 [https://www.agozar.com/#]"). Three faults on the live grid (cities-3,
// 2026-11-05): a level the cell writes was not found (blank lines and links), a class the model left untimed got no
// time from its slot line, and a sentence below the grid naming a class ("our Absolute Beginner course") counted as
// one of its cells, so the class was listed on that sentence's weekday too.

const NOW = new Date("2026-11-05T10:00:00Z");
const TODAY = "2026-11-05";

const GRID = `Class Schedule - NOVEMBER 2026

No sign up needed for drop-in classes, just walk in

Tuesday

7pm-8pm

Body Isolation & Application [https://www.agozar.com/info.html#salsa-bodyiso]

Drop-in

Sasha [https://www.agozar.com/about.html#sasha]

All Levels [https://www.agozar.com/#]

8pm-9pm

Salsa Partner Work [https://www.agozar.com/info.html#salsa-partnerwork]

Drop-in

Alexandre [https://www.agozar.com/about.html#alexandre]

Level 2 [https://www.agozar.com/#]

9pm-10pm

Salsa Partner Work [https://www.agozar.com/info.html#salsa-partnerwork]

Drop-in

Alessio [https://www.agozar.com/about.html#alessio]

Level 3 [https://www.agozar.com/#]

Absolute Beginner Course [https://www.agozar.com/courses/1-salsa-absolute-beginners-4-week-course]

Course

Alexandre [https://www.agozar.com/about.html#alexandre]

Click to Register [https://www.agozar.com/courses/1-salsa-absolute-beginners-4-week-course]

Sunday

4:30pm-5:30pm

Spinning & Turn Technique [https://www.agozar.com/info.html#salsa-spinning]

Drop-in

Alexandre [https://www.agozar.com/about.html#alexandre]

All Levels [https://www.agozar.com/#]

5:30pm-6:30pm

Salsa Partner Work [https://www.agozar.com/info.html#salsa-partnerwork]

Drop-in

Sasha [https://www.agozar.com/about.html#sasha]

Level 1 [https://www.agozar.com/#]

Salsa Partner Work [https://www.agozar.com/info.html#salsa-partnerwork]

Drop-in

Alexandre [https://www.agozar.com/about.html#alexandre]

Level 2 [https://www.agozar.com/#]

6:30pm-7:30pm

Salsa Open Work [https://www.agozar.com/info.html#salsa-openwork]

Drop-in

Sasha [https://www.agozar.com/about.html#sasha]

Level 2 [https://www.agozar.com/#]

Timing & Musicality 1 [https://www.agozar.com/info.html#salsa-musicality]

Drop-in

Alexandre [https://www.agozar.com/about.html#alexandre]

All Levels [https://www.agozar.com/#]

>>>>>

SPECIALISED COURSES - SIGN UP NOW

In addition to our walk-in classes above, we also offer specialised courses, some one off workshops or regular cycles such as our Absolute Beginner course, click on one for more details and to register.

>>>>>

Private Lessons`;

function read(listings: Array<Record<string, unknown>>) {
  const raw = rawExtractionSchema.parse({
    page_kind: "list",
    language: "en",
    listings: listings.map((l) => ({
      listing_type: "class",
      styles: ["salsa"],
      venue: { name: "Agozar" },
      organizer: {},
      ...l,
    })),
  });
  return extractionToHarvested(raw, {
    pageUrl: "https://www.agozar.com/",
    fetchedAt: NOW,
    today: TODAY,
    pageText: GRID,
    countryCode: "HK",
    weeklyGrid: true,
  });
}

const startOf = (l: {
  listing: { doors_time: string | null; lesson_time: string | null; dancing_time: string | null };
}) => l.listing.doors_time ?? l.listing.lesson_time ?? l.listing.dancing_time ?? null;

describe("a grid class whose rule the model wrote still takes its slot's start (D-763)", () => {
  it.each(["Every Sunday", "Sundays"])(
    "times Timing & Musicality 1 with the model's %s",
    (recurrence_text) => {
      const h = read([{ title: "Timing & Musicality 1", recurrence_text }]);
      expect(h.listings).toHaveLength(1);
      const l = h.listings[0]!;
      expect(l.recurrence?.rrule).toBe("FREQ=WEEKLY;BYDAY=SU");
      expect(startOf(l)).toBe("18:30");
    },
  );

  it("keeps a start the model gave", () => {
    const h = read([
      { title: "Timing & Musicality 1", recurrence_text: "Every Sunday", lesson_time: "19:00" },
    ]);
    for (const l of h.listings) expect(startOf(l)).not.toBe("18:30");
  });

  it("leaves a class in slots of different times untimed", () => {
    const h = read([{ title: "Salsa Partner Work", recurrence_text: "Sundays and Tuesdays" }]);
    for (const l of h.listings) expect(startOf(l)).toBeNull();
  });
});
