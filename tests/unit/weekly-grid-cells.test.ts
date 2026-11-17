import { describe, expect, it } from "vitest";

import { rawExtractionSchema } from "@/src/domain/listing";
import { extractionToHarvested } from "@/src/pipeline/extract";

// D-598: agozar.com's drop-in grid as the page cleaner writes it (2026-11-05): a blank line between cells and each
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

describe("weekly grid cells (D-598)", () => {
  it("finds a level the cell writes below its title across blank lines and links (D-676)", () => {
    const h = read([
      { title: "Salsa Partner Work Level 1", lesson_time: "17:30" },
      { title: "Salsa Partner Work Level 2", lesson_time: "17:30" },
      { title: "Salsa Partner Work Level 3", lesson_time: "21:00" },
    ]);
    expect(h.notOnPage).toEqual([]);
    const titles = h.listings.map((l) => l.listing.title).sort();
    // D-676: each stands under the page's title.
    expect(titles).toEqual(["Salsa Partner Work", "Salsa Partner Work", "Salsa Partner Work"]);
  });

  it("does not keep a level the cell does not write", () => {
    const h = read([{ title: "Salsa Partner Work Level 5", lesson_time: "17:30" }]);
    expect(h.notOnPage).toEqual(["Salsa Partner Work Level 5"]);
  });

  it("times an untimed class from its slot line, also when it is the slot's second class", () => {
    const h = read([{ title: "Timing & Musicality 1" }]);
    expect(h.listings).toHaveLength(1);
    const l = h.listings[0]!;
    expect(l.recurrence?.rrule).toBe("FREQ=WEEKLY;BYDAY=SU");
    expect(startOf(l)).toBe("18:30");
    expect(l.recurrence?.dtstartLocal.endsWith("T18:30")).toBe(true);
  });

  it("keeps a slot's second class at the start the read gave when the slot line writes it (D-785)", () => {
    // HK read 42334127927 (2026-11-07): the read gave 18:30 to 19:30; the class's own cell writes no time, so the
    // check dropped it and the class was listed untimed, while the slot's first class kept 18:30.
    const h = read([
      { title: "Timing & Musicality 1", lesson_time: "18:30", end_time: "19:30" },
      { title: "Salsa Open Work", lesson_time: "18:30", end_time: "19:30" },
    ]);
    const timing = h.listings.find((l) => l.listing.title === "Timing & Musicality 1")!;
    expect(timing.recurrence?.rrule).toBe("FREQ=WEEKLY;BYDAY=SU");
    expect(startOf(timing)).toBe("18:30");
    const open = h.listings.find((l) => l.listing.title === "Salsa Open Work")!;
    expect(startOf(open)).toBe("18:30");
  });

  it("does not give a second class a start its slot line does not write (D-785)", () => {
    const h = read([{ title: "Timing & Musicality 1", lesson_time: "20:00" }]);
    expect(startOf(h.listings[0]!)).not.toBe("20:00");
  });

  it("lists a class only on the weekdays of its own cells, not of a sentence naming it", () => {
    const h = read([{ title: "Absolute Beginner Course" }]);
    expect(h.listings).toHaveLength(1);
    const l = h.listings[0]!;
    expect(l.recurrence?.rrule).toBe("FREQ=WEEKLY;BYDAY=TU");
    expect(startOf(l)).toBe("21:00");
  });

  it("leaves an untimed class whose cells sit in slots of different times untimed, on all their days", () => {
    const h = read([{ title: "Salsa Partner Work" }]);
    expect(h.listings).toHaveLength(1);
    const l = h.listings[0]!;
    expect(l.recurrence?.rrule).toBe("FREQ=WEEKLY;BYDAY=SU,TU");
    expect(startOf(l)).toBeNull();
  });

  it("keeps a timed class on the days whose slot matches its start", () => {
    const h = read([{ title: "Salsa Partner Work", lesson_time: "21:00" }]);
    expect(h.listings).toHaveLength(1);
    expect(h.listings[0]!.recurrence?.rrule).toBe("FREQ=WEEKLY;BYDAY=TU");
  });
});
