// A model read's times checked against the listing's own words on its page (D-081): how a page's
// times are read, and what a read keeps of its own. Pure; the pages are the saved eval pages.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { rawListingSchema } from "@/src/domain/listing";
import {
  checkListingTimes,
  ownBlockTexts,
  readBlockTimes,
  type StatedTimes,
  type TimeMention,
} from "@/src/domain/stated-times";
import { titleBlocks } from "@/src/domain/title-blocks";

const EVALS = join(__dirname, "../../evals");
const evalPage = (path: string) => readFileSync(join(EVALS, path), "utf8");

/** "21:30 start", "~9:30 start doors", "00:30 end": the time, or ~ and its face when the half is not written. */
const show = (m: TimeMention) =>
  [m.value ?? `~${m.face}`, m.role, m.label].filter(Boolean).join(" ");

/** [doors, lesson, dancing, end] */
type Times = [string | null, string | null, string | null, string | null];
const stated = ([doors_time, lesson_time, dancing_time, end_time]: Times): StatedTimes => ({
  doors_time,
  lesson_time,
  dancing_time,
  end_time,
});

describe("uppercase H (D-493)", () => {
  it("reads uppercase H as a 24-hour time", () => {
    const mentions = readBlockTimes("23H", "pt");
    expect(mentions).toHaveLength(1);
    expect(mentions[0]!.value).toBe("23:00");
  });

  it("reads uppercase H in a multi-line Portuguese text", () => {
    const mentions = readBlockTimes("SEXTA FEIRA\n16 OUT\n23H\nDJ Set", "pt");
    expect(mentions).toHaveLength(1);
    expect(mentions[0]!.value).toBe("23:00");
  });

  it("reads uppercase H with minutes", () => {
    const mentions = readBlockTimes("22H30", "pt");
    expect(mentions).toHaveLength(1);
    expect(mentions[0]!.value).toBe("22:30");
  });

  it("reads uppercase H in a range", () => {
    const upper = readBlockTimes("21H-2H", "pt");
    const lower = readBlockTimes("21h-2h", "pt");
    expect(upper.map((m) => m.value)).toEqual(lower.map((m) => m.value));
  });

  it("reads bare uppercase H the same as lowercase", () => {
    const upper = readBlockTimes("2H", "pt");
    const lower = readBlockTimes("2h", "pt");
    expect(upper.map((m) => m.value)).toEqual(lower.map((m) => m.value));
  });
});
const timesOf = (t: StatedTimes): Times => [
  t.doors_time,
  t.lesson_time,
  t.dancing_time,
  t.end_time,
];

const listing = (title: string, times: Times, extra: Record<string, unknown> = {}) =>
  rawListingSchema.parse({
    title,
    listing_type: "social",
    styles: [],
    organizer: {},
    venue: { name: "A studio" },
    ...stated(times),
    ...extra,
  });

/** One listing of a read checked the way extract.ts checks it, with the read's other titles. */
function check(
  pageText: string,
  title: string,
  others: readonly string[],
  times: Times,
  options: { date?: string | null; extra?: Record<string, unknown> } = {},
) {
  return checkListingTimes(listing(title, times, options.extra), {
    blocks: titleBlocks(pageText, title, others, "en"),
    pageText,
    title,
    date: options.date ?? null,
    lang: "en",
  });
}

describe("reading the times a page writes (D-081)", () => {
  it("reads the forms pages write times in", () => {
    const forms: Array<[string, string[]]> = [
      ["Time: 9:30pm-10:30pm", ["21:30 start", "22:30 end"]],
      ["8:30-9pm FREE intro lesson", ["20:30 start lesson", "21:00 end"]],
      ["10-2am", ["22:00 start", "02:00 end"]],
      ["9pm-12:30", ["21:00 start", "00:30 end"]],
      ["noon-3pm", ["12:00 start", "15:00 end"]],
      ["12-3pm", ["12:00 start", "15:00 end"]],
      ["21h-2h", ["21:00 start", "02:00 end"]],
      ["20.00 Uhr bis 1.00 Uhr", ["20:00 start", "01:00 end"]],
      ["Class: 2:30-3:30p", ["14:30 start lesson", "15:30 end"]],
      [
        "12:00 p.m. – 3:00 p.m. 12:00 – 15:00",
        ["12:00 start", "15:00 end", "12:00 start", "15:00 end"],
      ],
      ["Time: 9:30 door open; classes start at 10pm.", ["~9:30 start doors", "22:00 start lesson"]],
      ["10$ before 10pm", ["22:00 cutoff"]],
      ["$15-20 (one dance)", []],
      ["3 classes every time", []],
      ["entry 9.30", []],
      ["2026-11-05 @ 08:00 PM (GMT-0400)", ["20:00 start"]],
      ["Sept 17/18 5:30-7:30", ["~5:30 start", "~7:30 end"]],
      [
        "Doors at 7:30pm; 9pm-12:30am (Band)",
        ["19:30 start doors", "21:00 start dancing", "00:30 end"],
      ],
      ["from 9 till late", ["~9:00 start"]],
      ["6:00pm – 7:00pm: Dance Lesson", ["18:00 start lesson", "19:00 end"]],
      // A dancing word names the start, as no word does.
      ["Lesson 7pm dancing 8pm", ["19:00 start lesson", "20:00 start dancing"]],
      ["7pm lesson 8pm dancing", ["19:00 start lesson", "20:00 start dancing"]],
      // Neither "beginner" nor "course" names a lesson.
      ["Beginner friendly social 9pm", ["21:00 start dancing"]],
      ["Of course we dance at 9pm", ["21:00 start"]],
    ];
    for (const [text, want] of forms) expect(readBlockTimes(text).map(show), text).toEqual(want);
  });

  it("quotes the clause that writes each time", () => {
    expect(
      readBlockTimes("Time: 9:30 door open; classes start at 10pm.").map((m) => m.quote),
    ).toEqual(["Time: 9:30 door open", "classes start at 10pm"]);
  });
});

const SO_PAGE = evalPage("extraction/pages/steppingoutstudios-social-events1.txt");
const SO_TITLES = [
  "Friday Night Fever",
  "All Night Milonga",
  "Robins Argentine Tango Practica",
  "Noche De Descarga",
  "Bachata Rosa",
  "Zen Zouk",
  "Paciencia Milonga",
  "La Vieja Guardia Salsa",
  "Tango Y Te",
  "Ballroom and Smooth Practice",
  "Toda La Noche, Salsa Social",
  "Jimmy Anton Salsa Social",
];

describe("a read's times against the listing's own part of the page (D-081)", () => {
  const so = (title: string, times: Times, extra?: Record<string, unknown>) =>
    check(SO_PAGE, title, SO_TITLES, times, { extra });

  it("finds each Stepping Out listing's own part, respaced titles too", () => {
    for (const title of SO_TITLES) {
      const blocks = titleBlocks(SO_PAGE, title, SO_TITLES, "en");
      expect(blocks.length, title).toBeGreaterThan(0);
      expect(blocks.every((b) => !b.held)).toBe(true);
    }
    // "N oche De Descarga" is the title as the page prints it, not the one in its description.
    const [noche] = titleBlocks(SO_PAGE, "Noche De Descarga", SO_TITLES, "en");
    expect(noche?.text).toMatch(/^N oche De Descarga\n/);
    expect(ownBlockTexts([noche!], null)[0]).toContain("Time: 10pm-3am");
  });

  it("grounds Stepping Out's three reported listings", () => {
    // Run 30 read "Time: 9:30pm-10:30pm" as a 9:30pm lesson and dancing at 10:30pm.
    const ballroom = so("Ballroom and Smooth Practice", [null, "21:30", "22:30", null], {
      evidence: { lesson_time: "9:30pm", dancing_time: "10:30pm" },
      confidence: { lesson_time: 0.9, dancing_time: 0.9 },
    });
    expect(timesOf(ballroom.listing)).toEqual([null, null, "21:30", "22:30"]);
    expect(ballroom.changes).toEqual([
      { kind: "moved", field: "lesson_time", to: "dancing_time", time: "21:30" },
      { kind: "end_only", field: "dancing_time", time: "22:30", becameEnd: true },
    ]);
    // A moved or changed time's evidence is the page's clause, never the model's words or none.
    expect(ballroom.listing.evidence).toEqual({
      dancing_time: "Time: 9:30pm-10:30pm",
      end_time: "Time: 9:30pm-10:30pm",
    });
    expect(ballroom.listing.confidence).toEqual({});
    expect(ballroom.withdrawn).toBe(false);

    // "classes start at 10pm", read as a 10am lesson and dancing at 10pm.
    const bachata = so("Bachata Rosa", [null, "10:00", "22:00", "03:00"]);
    expect(timesOf(bachata.listing)).toEqual([null, "22:00", null, "03:00"]);
    expect(bachata.changes).toEqual([
      { kind: "meridiem", field: "lesson_time", given: "10:00", time: "22:00" },
      { kind: "moved", field: "dancing_time", to: "lesson_time", time: "22:00" },
    ]);
    expect(bachata.listing.evidence.lesson_time).toBe("classes start at 10pm");

    // "Time: 10:00pm – 3:00am", read as doors at 10pm and dancing at 11pm, which is nowhere.
    const toda = so("Toda La Noche, Salsa Social", ["22:00", null, "23:00", "03:00"], {
      evidence: { end_time: "3:00am" },
    });
    expect(timesOf(toda.listing)).toEqual([null, null, "22:00", "03:00"]);
    expect(toda.changes).toEqual([
      { kind: "moved", field: "doors_time", to: "dancing_time", time: "22:00" },
      { kind: "not_written", field: "dancing_time", given: "23:00" },
    ]);
    // An end kept as read keeps the model's evidence.
    expect(toda.listing.evidence).toEqual({
      dancing_time: "Time: 10:00pm – 3:00am",
      end_time: "3:00am",
    });

    // "Time : 8:30pm - 11:30am": the page's end is 15 hours after the start, a slip.
    const fever = so("Friday Night Fever", [null, null, "20:30", "23:30"]);
    expect(timesOf(fever.listing)).toEqual([null, null, "20:30", null]);
    expect(fever.changes).toEqual([
      { kind: "end_over_12h", given: "23:30", time: "11:30", hours: 15 },
    ]);
  });

  it("gives every Stepping Out listing the times its part writes", () => {
    // Run 30's read (the live site on 2026-09-29), and what stands of it (design section 9).
    const cases: Array<[string, Times, Times]> = [
      ["Friday Night Fever", [null, null, "20:30", "23:30"], [null, null, "20:30", null]],
      ["All Night Milonga", [null, null, "22:00", "04:00"], [null, null, "22:00", "04:00"]],
      [
        "Robins Argentine Tango Practica",
        [null, null, "21:30", "23:30"],
        [null, null, "21:30", "23:30"],
      ],
      ["Noche De Descarga", ["22:00", null, null, "03:00"], [null, null, "22:00", "03:00"]],
      ["Bachata Rosa", [null, "10:00", "22:00", "03:00"], [null, "22:00", null, "03:00"]],
      ["Zen Zouk", [null, null, "21:30", "01:00"], [null, null, "21:30", "01:00"]],
      ["Paciencia Milonga", [null, null, "21:30", "01:30"], [null, null, "21:30", "01:30"]],
      ["La Vieja Guardia Salsa", [null, null, "18:00", "22:00"], [null, null, "18:00", "22:00"]],
      ["Tango Y Te", [null, "15:00", null, "18:00"], [null, null, "15:00", "18:00"]],
      [
        "Ballroom and Smooth Practice",
        [null, "21:30", "22:30", null],
        [null, null, "21:30", "22:30"],
      ],
      [
        "Toda La Noche, Salsa Social",
        ["22:00", null, "23:00", "03:00"],
        [null, null, "22:00", "03:00"],
      ],
      [
        "Jimmy Anton Salsa Social",
        ["18:00", null, "22:00", "22:00"],
        [null, null, "18:00", "22:00"],
      ],
      // The eval's reading: Bachata Rosa's page gives doors, a class and a party.
      ["Bachata Rosa", ["21:30", "22:00", "23:00", "03:00"], ["21:30", "22:00", "23:00", "03:00"]],
    ];
    for (const [title, read, want] of cases) {
      const checked = so(title, read);
      expect(timesOf(checked.listing), title).toEqual(want);
      if (JSON.stringify(read) === JSON.stringify(want)) {
        expect(checked.changes, title).toEqual([]);
      }
    }
  });

  it("keeps a lesson the page's own category gives", () => {
    // NYC Swings prints "Class" before the title on its line; the time beside it has no word.
    const nycSwings = evalPage("links/pages/nycswings-net.txt");
    const titles = [
      "West Coast Swing with Jes Ann Nail",
      "Class West Coast Swing with Jes Ann Nail",
      "Social Dance Flow Fridays",
    ];
    for (const title of titles.slice(0, 2)) {
      const checked = check(nycSwings, title, titles, [null, "19:00", null, null], {
        date: "2026-09-30",
      });
      expect(timesOf(checked.listing), title).toEqual([null, "19:00", null, null]);
      expect(checked.changes, title).toEqual([]);
    }

    // The category, on the line above or before the title on its line, is what makes it a lesson:
    // the same words under another label give a start.
    for (const [page, want] of [
      ["Class\nSalsa Basics\nWednesday 7pm", "lesson"],
      ["Class Salsa Basics\nWednesday 7pm", "lesson"],
      ["Social\nSalsa Basics\nWednesday 7pm", "start"],
      ["Social Salsa Basics\nWednesday 7pm", "start"],
    ] as const) {
      const checked = check(page, "Salsa Basics", [], [null, "19:00", null, null]);
      expect(timesOf(checked.listing), page).toEqual(
        want === "lesson" ? [null, "19:00", null, null] : [null, null, "19:00", null],
      );
    }

    // Brooklyn Contra's workshop: its title names a class, and noon is its first time.
    const contra = evalPage("links/pages/brooklyncontra-org.txt");
    const workshop = "Contra Connections 2: An Intermediate Contra Dance Workshop";
    const contraTitles = [
      workshop,
      "A Contra Dance for All!",
      "A Barn Dance in Battery Park City!",
      "Five Borough Fling",
    ];
    const checked = check(contra, workshop, contraTitles, [null, "12:00", null, "15:00"], {
      date: "2026-10-04",
    });
    expect(timesOf(checked.listing)).toEqual([null, "12:00", null, "15:00"]);
    expect(checked.changes).toEqual([]);
  });

  it("reads the synthetic layouts", () => {
    // Page, title, the read's other titles, the read's times, and what stands.
    const layouts: Array<{
      why: string;
      page: string;
      title: string;
      others?: string[];
      read: Times;
      want: Times;
    }> = [
      {
        why: "a time before the title on its line",
        page: "Upcoming\n7:00 PM Salsa Night at Club X\n8:00 PM Tango Night",
        title: "Salsa Night",
        others: ["Tango Night"],
        read: [null, null, "19:00", null],
        want: [null, null, "19:00", null],
      },
      {
        why: "a date and time line above the title",
        page: "Sat Oct 3 · 8:00 PM\nSalsa Night\nClub X\n\nSun Oct 4 · 7:00 PM\nTango Night",
        title: "Salsa Night",
        others: ["Tango Night"],
        read: [null, null, "20:00", null],
        want: [null, null, "20:00", null],
      },
      {
        why: "a neighbour's time above is not taken",
        page: "Salsa Night\n9pm-2am\nBachata Night\n10pm-3am",
        title: "Bachata Night",
        others: ["Salsa Night"],
        read: [null, null, "21:00", "02:00"],
        want: [null, null, null, null],
      },
      {
        why: "a 24-hour page",
        page: "Salsa Night 21:00-02:00",
        title: "Salsa Night",
        read: [null, null, "21:00", "02:00"],
        want: [null, null, "21:00", "02:00"],
      },
      {
        why: "doors and a show",
        page: "Salsa Night\nDoors 8pm, show 9pm",
        title: "Salsa Night",
        read: ["20:00", null, "21:00", null],
        want: ["20:00", null, "21:00", null],
      },
      {
        why: "8-11pm",
        page: "Salsa Night\n8-11pm",
        title: "Salsa Night",
        read: [null, null, "20:00", "23:00"],
        want: [null, null, "20:00", "23:00"],
      },
      {
        why: "from 9 till late",
        page: "Salsa Night\nfrom 9 till late",
        title: "Salsa Night",
        read: [null, null, "21:00", null],
        want: [null, null, "21:00", null],
      },
      {
        why: "a lesson and dancing in one clause",
        page: "Salsa Night\nLesson 7pm dancing 8pm",
        title: "Salsa Night",
        read: [null, "19:00", "20:00", null],
        want: [null, "19:00", "20:00", null],
      },
      {
        why: "each time before its word, one clause",
        page: "Salsa Night\n7pm lesson 8pm dancing",
        title: "Salsa Night",
        read: [null, "19:00", "20:00", null],
        want: [null, "19:00", "20:00", null],
      },
      {
        why: "French 21h-2h",
        page: "Soirée salsa\n21h-2h",
        title: "Soirée salsa",
        read: [null, null, "21:00", "02:00"],
        want: [null, null, "21:00", "02:00"],
      },
      {
        why: "German 20.00 Uhr bis 1.00 Uhr",
        page: "Salsa-Party\n20.00 Uhr bis 1.00 Uhr",
        title: "Salsa-Party",
        read: [null, null, "20:00", "01:00"],
        want: [null, null, "20:00", "01:00"],
      },
      {
        why: "a price 9.30 is not a time",
        page: "Salsa Night\n9pm, entry 9.30",
        title: "Salsa Night",
        read: [null, null, "21:30", null],
        want: [null, null, null, null],
      },
      {
        why: "noon-3pm",
        page: "Tea Dance\nnoon-3pm",
        title: "Tea Dance",
        read: [null, null, "12:00", "15:00"],
        want: [null, null, "12:00", "15:00"],
      },
      {
        why: "12-3pm",
        page: "Tea Dance\n12-3pm",
        title: "Tea Dance",
        read: [null, null, "12:00", "15:00"],
        want: [null, null, "12:00", "15:00"],
      },
      {
        why: "11-2am",
        page: "Late Salsa\n11-2am",
        title: "Late Salsa",
        read: [null, null, "23:00", "02:00"],
        want: [null, null, "23:00", "02:00"],
      },
      {
        why: "a bare 9:30-12:30",
        page: "Swing Night\n9:30-12:30",
        title: "Swing Night",
        read: [null, null, "21:30", "00:30"],
        want: [null, null, "21:30", "00:30"],
      },
      {
        why: "10am that the page writes as 10pm",
        page: "Salsa Night\nStarts 10pm",
        title: "Salsa Night",
        read: [null, null, "10:00", null],
        want: [null, null, "22:00", null],
      },
      {
        why: "a morning class stays in the morning",
        page: "Kids Ballet\nSaturdays 10am-11am",
        title: "Kids Ballet",
        read: [null, "10:00", null, "11:00"],
        want: [null, null, "10:00", "11:00"],
      },
      {
        why: "an invented end",
        page: "Salsa Night\n9pm",
        title: "Salsa Night",
        read: [null, null, "21:00", "02:00"],
        want: [null, null, "21:00", null],
      },
      {
        why: "an end written only as 'until 2am'",
        page: "Salsa Night\n9pm until 2am",
        title: "Salsa Night",
        read: [null, null, "21:00", "02:00"],
        want: [null, null, "21:00", "02:00"],
      },
      {
        why: "a price's cut-off time is not a start",
        page: "Salsa Night\n9pm-2am\n$10 before 10pm",
        title: "Salsa Night",
        read: [null, null, "22:00", "02:00"],
        want: [null, null, null, "02:00"],
      },
      {
        why: "a class its title names",
        page: "Beginner Salsa Class\n7-8pm",
        title: "Beginner Salsa Class",
        read: [null, "19:00", null, "20:00"],
        want: [null, "19:00", null, "20:00"],
      },
      {
        why: "a doors word the read left in dancing",
        page: "Salsa Night\nDoors open 9pm",
        title: "Salsa Night",
        read: [null, null, "21:00", null],
        want: ["21:00", null, null, null],
      },
      {
        // Both starts want the start; the read's dancing time keeps it, and 8pm keeps the doors
        // field the read gave it rather than being lost (review of D-081).
        why: "an unlabelled start read as doors, and a later start with a dancing word",
        page: "Milonga\n8pm-1am, dancing from 9pm",
        title: "Milonga",
        read: ["20:00", null, "21:00", "01:00"],
        want: ["20:00", null, "21:00", "01:00"],
      },
      {
        why: "a beginner-friendly social's start is no lesson",
        page: "Salsa Night\nBeginner friendly social from 9pm",
        title: "Salsa Night",
        read: [null, null, "21:00", null],
        want: [null, null, "21:00", null],
      },
    ];
    expect(layouts).toHaveLength(25);
    for (const c of layouts) {
      const checked = check(c.page, c.title, c.others ?? [], c.read);
      expect(timesOf(checked.listing), c.why).toEqual(c.want);
    }

    const changesOf = (why: string) => {
      const c = layouts.find((l) => l.why === why)!;
      return check(c.page, c.title, c.others ?? [], c.read);
    };
    expect(changesOf("a neighbour's time above is not taken")).toMatchObject({
      withdrawn: true,
      changes: [
        { kind: "not_written", field: "dancing_time", given: "21:00" },
        { kind: "not_written", field: "end_time", given: "02:00" },
      ],
    });
    expect(changesOf("a morning class stays in the morning").changes).toEqual([
      { kind: "moved", field: "lesson_time", to: "dancing_time", time: "10:00" },
    ]);
    expect(changesOf("a doors word the read left in dancing").changes).toEqual([
      { kind: "moved", field: "dancing_time", to: "doors_time", time: "21:00" },
    ]);
    expect(
      changesOf("an unlabelled start read as doors, and a later start with a dancing word").changes,
    ).toEqual([]);
    expect(changesOf("a price's cut-off time is not a start").changes).toEqual([
      { kind: "cutoff_only", field: "dancing_time", time: "22:00" },
    ]);
  });

  it("leaves times alone with no blocks", () => {
    const read = listing("Salsa Night", [null, null, "21:00", "02:00"], {
      evidence: { dancing_time: "9pm" },
    });
    const checked = checkListingTimes(read, {
      blocks: [],
      pageText: "Tango Night\n8pm",
      title: "Salsa Night",
      date: null,
      lang: "en",
    });
    expect(checked.listing).toBe(read);
    expect(checked).toMatchObject({ changes: [], withdrawn: false });
    // A read with no time is left as it is too.
    const untimed = listing("Salsa Night", [null, null, null, null]);
    const page = "Salsa Night\n9pm";
    expect(
      checkListingTimes(untimed, {
        blocks: titleBlocks(page, "Salsa Night", [], "en"),
        pageText: page,
        title: "Salsa Night",
        date: null,
      }),
    ).toEqual({ listing: untimed, changes: [], withdrawn: false, pageStarts: [], pageEnds: [] });
  });
});

// The review of D-081's first cut (critique of 2026-09-29): layouts it read wrong, each with the
// critique's own case.
describe("the review's layouts (D-081)", () => {
  const one = (page: string, title: string, read: Times, others: string[] = []) =>
    check(page, title, others, read);

  it("does not end the night at the end of a lesson's or the doors' range", () => {
    const lesson = one(
      "Salsa Social\n7-8pm beginner lesson, followed by social dancing",
      "Salsa Social",
      [null, "19:00", "20:00", null],
    );
    expect(timesOf(lesson.listing)).toEqual([null, "19:00", null, null]);
    expect(lesson.changes).toEqual([
      { kind: "end_only", field: "dancing_time", time: "20:00", becameEnd: false },
    ]);
    expect(
      timesOf(
        one("Tango Practica\nClass 7:00pm - 8:00pm; practica to follow", "Tango Practica", [
          null,
          "19:00",
          "20:00",
          null,
        ]).listing,
      ),
    ).toEqual([null, "19:00", null, null]);
    expect(
      timesOf(
        one("Swing Night\nDoors 7-7:30pm then band", "Swing Night", ["19:00", null, "19:30", null])
          .listing,
      ),
    ).toEqual(["19:00", null, null, null]);
    // A time the page writes only after "until" starts no range of the listing's: dropped.
    expect(
      timesOf(
        one("Salsa Night\nDancing until 2am", "Salsa Night", [null, null, "02:00", null]).listing,
      ),
    ).toEqual([null, null, null, null]);
    // The listing's own range still gives its end (Ballroom and Smooth Practice).
    expect(
      timesOf(
        one("Salsa Night\nTime: 9:30pm-10:30pm", "Salsa Night", [null, "21:30", "22:30", null])
          .listing,
      ),
    ).toEqual([null, null, "21:30", "22:30"]);
  });

  it("reads a day of the month joined to its time by a dash as the date", () => {
    for (const [text, want] of [
      ["Oct 3 – 8:00 pm", ["20:00 start"]],
      ["Saturday, October 3 - 9pm", ["21:00 start"]],
      ["Oct. 3 - 9pm to 2am", ["21:00 start", "02:00 end"]],
      ["Saturday 3 October - 9pm", ["21:00 start"]],
      // A weekday is no month: "Sundays 3 - 6pm" is a range.
      ["Sundays 3 - 6pm", ["15:00 start", "18:00 end"]],
    ] as const) {
      expect(readBlockTimes(text, "en").map(show), text).toEqual(want);
    }
    const salsa = one("Salsa Night\nSaturday, October 3 - 9pm\nClub X", "Salsa Night", [
      null,
      null,
      "21:00",
      null,
    ]);
    expect(timesOf(salsa.listing)).toEqual([null, null, "21:00", null]);
    expect(salsa.changes).toEqual([]);
    // The page's language's months too: "3 de octubre - 21h".
    expect(readBlockTimes("sábado 3 de octubre - 9pm", "es").map(show)).toEqual(["21:00 start"]);
  });

  // NYC Swings prints every card on one line: "Category Title Description. Date • Time Venue
  // Learn More [link]". Its whole card list, as a read of every card would give it.
  const NYC_SWINGS = evalPage("links/pages/nycswings-net.txt");
  const NYC_CARDS = [
    "Lindy Hop Guided Practice with Midtown Swings",
    "Lindy Hop – Swing Dance Classes with Gaby Cook & AJ Howard",
    "Intro to Lindy Hop: Beginner Class at Midtown Swings",
    "Midtown Swings – Weekly Swing Dance Party",
    "West Coast Swing with Jes Ann Nail",
    "West Coast Swing Competitor Training with Dimitri Hector",
    "West Coast Swing: Progressive Learning with Jes Ann & Dimitri",
    "Intro to West Coast Swing: Beginner Class at House of West",
    "House of West – NYC’s Weekly West Coast Swing Party",
    "Beginner West Coast Swing with Jes Ann Nail",
    "West Coast Swing with Swingiversity",
    "West Coast Swing Beginner Boot Camp",
    "Soul Sunday: West Coast Swing Social",
    "Lindy Hop Performance Team with Alejandro & Anna",
    "Flow Fridays",
    "Intro to West Coast Swing: Beginner Class at Flow Fridays",
    "New York Flow Festival",
  ];

  it("reads a card on a one-line list from its own words only", () => {
    const card = (title: string, date: string, read: Times, others = NYC_CARDS) =>
      check(NYC_SWINGS, title, others, read, { date });
    // The next card's "Class" no longer names a social's time a lesson.
    const houseOfWest = "House of West – NYC’s Weekly West Coast Swing Party";
    expect(timesOf(card(houseOfWest, "2026-09-30", [null, null, "21:00", null]).listing)).toEqual([
      null,
      null,
      "21:00",
      null,
    ]);
    const soulSunday = "Soul Sunday: West Coast Swing Social";
    expect(timesOf(card(soulSunday, "2026-10-11", [null, null, "17:00", null]).listing)).toEqual([
      null,
      null,
      "17:00",
      null,
    ]);
    // A class's first time is its own card's, not the card before it.
    const intro = "Intro to West Coast Swing: Beginner Class at House of West";
    const introRead = card(intro, "2026-09-30", [null, "20:30", null, null]);
    expect(timesOf(introRead.listing)).toEqual([null, "20:30", null, null]);
    expect(introRead.changes).toEqual([]);
    // Another card's 7:00 PM, which the lead ran back to, is not Midtown Swings' (it says 9:00 PM).
    const midtown = "Midtown Swings – Weekly Swing Dance Party";
    for (const others of [NYC_CARDS, [midtown], [midtown, "West Coast Swing with Jes Ann Nail"]]) {
      const read = card(midtown, "2026-09-29", [null, null, "19:00", null], others);
      expect(timesOf(read.listing), `${others.length} titles`).toEqual([null, null, null, null]);
      expect(read.withdrawn).toBe(true);
    }
    expect(
      timesOf(card(intro, "2026-09-30", [null, "19:00", null, null], [intro]).listing),
    ).toEqual([null, null, null, null]);
    // The card's lead is its category, and the card ends at its own "Learn More".
    const [block] = titleBlocks(NYC_SWINGS, houseOfWest, [intro], "en");
    expect(block?.lead).toBe("Social Dance");
    expect(block?.text).toMatch(/Wed, Sep 30 • 9:00 PM Danznik Studios Learn More $/);
  });

  it("reads a card's date-and-time line above its title as the card's own", () => {
    for (const page of [
      "Thu, Oct 1, 8:00 PM EDT\nSalsa Night\nClub X\n\nFri, Oct 2, 9:00 PM EDT\nTango Night",
      "Thu Oct 1 · 8pm · Club X\nSalsa Night\n\nFri Oct 2 · 9pm · Club Y\nTango Night",
    ]) {
      const salsa = check(page, "Salsa Night", ["Tango Night"], [null, null, "20:00", null]);
      expect(timesOf(salsa.listing), page).toEqual([null, null, "20:00", null]);
      expect(salsa.changes, page).toEqual([]);
      // The next card's time is not Salsa Night's.
      const neighbour = check(page, "Salsa Night", ["Tango Night"], [null, null, "21:00", null]);
      expect(timesOf(neighbour.listing), page).toEqual([null, null, null, null]);
      // Nor is it when the read did not list the next card.
      const alone = check(page, "Salsa Night", [], [null, null, "21:00", null]);
      expect(timesOf(alone.listing), page).toEqual([null, null, null, null]);
      const tango = check(page, "Tango Night", ["Salsa Night"], [null, null, "21:00", null]);
      expect(timesOf(tango.listing), page).toEqual([null, null, "21:00", null]);
    }
    // Where the page writes each title first, a time above a title is the listing's before.
    const titleFirst = "Salsa Night\n8:00 PM - 2:00 AM\nBachata Night\n10:00 PM - 3:00 AM";
    const bachata = check(
      titleFirst,
      "Bachata Night",
      ["Salsa Night"],
      [null, null, "20:00", null],
    );
    expect(timesOf(bachata.listing)).toEqual([null, null, null, null]);
    expect(
      timesOf(
        check(titleFirst, "Bachata Night", ["Salsa Night"], [null, null, "22:00", "03:00"]).listing,
      ),
    ).toEqual([null, null, "22:00", "03:00"]);
  });

  it("loses nothing the page writes as a start", () => {
    // A lesson word in Spanish, a dancing word beside the other time.
    const leccion = one("Noche de Salsa\nLección 8pm, baile 9pm", "Noche de Salsa", [
      null,
      "20:00",
      "21:00",
      null,
    ]);
    expect(timesOf(leccion.listing)).toEqual([null, "20:00", "21:00", null]);
    expect(leccion.changes).toEqual([]);
    // "dancing" is a start's cue for a bare hour.
    const doors = one("Swing Night\nDoors open at 8, dancing 9", "Swing Night", [
      "20:00",
      null,
      "21:00",
      null,
    ]);
    expect(timesOf(doors.listing)).toEqual(["20:00", null, "21:00", null]);
    expect(doors.changes).toEqual([]);
    // The nearest word names a time: the social's 9pm is not the lesson's.
    expect(
      timesOf(
        one(
          "Salsa Social\nBeginner lesson with Maria then social dancing 9pm to 1am",
          "Salsa Social",
          [null, null, "21:00", "01:00"],
        ).listing,
      ),
    ).toEqual([null, null, "21:00", "01:00"]);
    // A start that loses the start to the read's own dancing time keeps the field the read gave
    // it when that is free...
    const twoStarts = one("Salsa Night\n8pm-1am, dancing from 9pm", "Salsa Night", [
      null,
      "20:00",
      "21:00",
      "01:00",
    ]);
    expect(timesOf(twoStarts.listing)).toEqual([null, "20:00", "21:00", "01:00"]);
    expect(twoStarts.changes).toEqual([]);
    // ...else doors, when that is free: here the read's lesson field went to its 7pm.
    const threeStarts = one("Salsa Night\nLesson 7pm, 8pm-1am, dancing from 9pm", "Salsa Night", [
      "19:00",
      "21:00",
      "20:00",
      "01:00",
    ]);
    expect(timesOf(threeStarts.listing)).toEqual(["21:00", "19:00", "20:00", "01:00"]);
    expect(threeStarts.changes).toEqual([
      { kind: "moved", field: "doors_time", to: "lesson_time", time: "19:00" },
      { kind: "moved", field: "lesson_time", to: "doors_time", time: "21:00" },
    ]);
    // More lesson words: "leçon", "lezione", "aula", "Unterricht".
    for (const text of ["Leçon 8pm", "Lezione 8pm", "Aula 8pm", "Unterricht 20:00"]) {
      expect(readBlockTimes(text).map(show), text).toEqual(["20:00 start lesson"]);
    }
  });

  it("names a time only by the words the page means", () => {
    const forms: Array<[string, string[]]> = [
      // Not a lesson: "class" joined by a hyphen, or after a negation.
      ["Salsa Night with world-class DJs 9pm-2am", ["21:00 start dancing", "02:00 end"]],
      ["No class this week: social 9pm-1am", ["21:00 start dancing", "01:00 end"]],
      // Not the doors: a price at the door, a door code (a period before a digit ends a clause).
      ["$20 at the door 9pm-2am", ["21:00 start", "02:00 end"]],
      ["Door code 4410. 9pm-2am", ["21:00 start", "02:00 end"]],
      ["Doors code 4410. 9pm-2am", ["21:00 start", "02:00 end"]],
      // The doors: "doors", "door open", "door:".
      ["Doors 8pm", ["20:00 start doors"]],
      ["Door: 8pm", ["20:00 start doors"]],
      ["The doors open at 8", ["~8:00 start doors"]],
      // No word names a time across a link.
      ["Workshops [https://studio.example/workshops] 9pm", ["21:00 start"]],
    ];
    for (const [text, want] of forms) expect(readBlockTimes(text).map(show), text).toEqual(want);
  });

  it("keeps the read's half where the page leaves the half unwritten", () => {
    // 9:30 with no am or pm beside the social; 9:30am beside the workshops.
    for (const page of [
      "Swing Weekend\nFriday social 9:30-12:30 / Saturday workshops 9:30am-4pm",
      "Swing Weekend\nFriday social 9:30-12:30\nSaturday workshops 9:30am-4pm",
    ]) {
      const read = one(page, "Swing Weekend", [null, null, "21:30", "00:30"]);
      expect(timesOf(read.listing), page).toEqual([null, null, "21:30", "00:30"]);
      expect(read.changes, page).toEqual([]);
    }
    // A half every mention writes is still the page's (Bachata Rosa's "10pm").
    expect(
      timesOf(one("Salsa Night\nStarts 10pm", "Salsa Night", [null, null, "10:00", null]).listing),
    ).toEqual([null, null, "22:00", null]);
    // And a read's half that fits none of its other times gives way to the one the page writes.
    expect(
      timesOf(
        one("Tea Dance\nFrom 5pm-6:15pm\n5:00: arrival and dancing", "Tea Dance", [
          null,
          null,
          "05:00",
          "18:15",
        ]).listing,
      ),
    ).toEqual([null, null, "17:00", "18:15"]);
  });
});

describe("a clock split over lines", () => {
  const nicetoCard = `Club 69 | 31 OCT HALLOWEEN en Niceto Club (+18 años)

31

OCT
2026

23

59
hs

COMPRAR [https://venti.live/evento/club-69-31-oct-en-niceto-club-18-a-os]`;

  it("reads a time split over lines with hs", () => {
    const mentions = readBlockTimes(nicetoCard, "es");
    expect(mentions.map((m) => m.value)).toContain("23:59");
  });

  it("keeps a time the model read when the page writes it split over lines", () => {
    const read = listing("Club 69", [null, null, "23:59", null], {
      evidence: { dancing_time: "23:59" },
    });
    const blocks = titleBlocks(nicetoCard, "Club 69", [], "es");
    const checked = checkListingTimes(read, {
      blocks,
      pageText: nicetoCard,
      title: "Club 69",
      date: "2026-10-31",
      lang: "es",
    });
    expect(checked.withdrawn).toBe(false);
    expect(checked.listing.dancing_time).toBe("23:59");
  });

  it("does not read a day of month as a time", () => {
    const mentions = readBlockTimes("31\n\nOCT\n2026\n\nCOMPRAR", "es");
    expect(mentions).toEqual([]);
  });

  it("does not read a time without the unit word", () => {
    const mentions = readBlockTimes("23\n\n59\nCOMPRAR", "es");
    expect(mentions.map((m) => m.value)).not.toContain("23:59");
  });
});

describe("ranges written across a date (D-289)", () => {
  const roles = (text: string) =>
    readBlockTimes(text, "en").map(
      (m) => `${m.value} ${m.role}${m.from ? ` from ${m.from.value}` : ""}`,
    );

  it("reads an overnight range with the end's weekday and date as a range", () => {
    expect(roles("Sat, Oct 31 11:00 pm - Sun, Nov 1, 3:00 am")).toEqual([
      "23:00 start",
      "03:00 end from 23:00",
    ]);
  });

  it("reads a series range ending on a later date as a range", () => {
    expect(roles("Sat, Sep 27, 10:00 pm - Thu, Dec 31, 3:00 am")).toEqual([
      "22:00 start",
      "03:00 end from 22:00",
    ]);
  });

  it("reads a month and day alone after the dash", () => {
    expect(roles("10pm - Nov 1, 2am")).toEqual(["22:00 start", "02:00 end from 22:00"]);
  });

  it("does not pair two times with only a date between them", () => {
    expect(roles("10pm Sun, Nov 1, 2am").every((r) => r.endsWith("start"))).toBe(true);
  });

  it("does not pair two times with other words after the dash", () => {
    expect(roles("10pm - doors close Sun 2am").some((r) => r.includes("from 22:00"))).toBe(false);
  });
});
