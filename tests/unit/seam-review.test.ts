// The seam review of PR 1a (2026-09-29): where the date checks (D-080) and the time checks (D-081)
// each decided on their own which line beside a title is the listing's, and disagreed. Each case
// fails without its fix. Pure; the end-to-end cases are in pipeline-seam-review.test.ts.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { rawExtractionSchema } from "@/src/domain/listing";
import { contradictingDate, foldPage } from "@/src/domain/text-facts";
import { cleanPageText } from "@/src/pipeline/clean";
import { extractionToHarvested } from "@/src/pipeline/extract";
import { expandRecurrence } from "@/src/pipeline/normalize";

const reply = (listings: Array<Record<string, unknown>>) =>
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

// Tuesday 2026-09-29.
const read = (url: string, text: string, listings: Array<Record<string, unknown>>) =>
  extractionToHarvested(reply(listings), {
    pageUrl: url,
    fetchedAt: new Date("2026-09-29T14:00:00Z"),
    today: "2026-09-29",
    pageText: text,
    countryCode: "US",
  });

/** "title night dancing", or "title night untimed" for a listing written with no time. */
const written = (result: ReturnType<typeof read>) =>
  result.listings.map(
    (h) =>
      `${h.listing.title} ${h.listing.local_date ?? h.recurrence?.rrule} ${h.listing.dancing_time ?? "untimed"}`,
  );

describe("a heading's last dated item is not the next heading's date (D-080)", () => {
  // CDNY's "Oct 6th - Calling: …", the last dance under ENGLISH - TUESDAYS, stands over "CONTRA -
  // SATURDAYS": taken as the contra's date, it would contradict its October 10.
  it("takes neither a date alone nor the last of a run of dated items for the next heading's (CDNY)", () => {
    // "Oct 6th - Calling: …" is the last dance under ENGLISH - TUESDAYS, not CONTRA - SATURDAYS'
    // date: October 10, which the page writes under it, stays the contra's.
    const saved = readFileSync(join(process.cwd(), "evals/links/pages/cdny-org.txt"), "utf8");
    // And with a time on each dance: a run of dated items is a list's, not a card's date line.
    const timed = saved
      .replace("Sept 29th - Calling", "Sept 29th - 8pm - Calling")
      .replace("Oct 6th - Calling", "Oct 6th - 8pm - Calling");
    expect(timed).not.toBe(saved);
    // And late in the season, one dance left under ENGLISH - TUESDAYS, with its time: it is not a
    // card's date line either, since CONTRA - SATURDAYS writes its own dates under its title.
    const one = timed.replace(/Sept 29th - 8pm - Calling[^\n]*\n+/, "");
    expect(one).not.toBe(timed);
    const titles = ["ENGLISH - TUESDAYS", "CONTRA - SATURDAYS"];
    for (const text of [saved, timed, one]) {
      const page = foldPage(text);
      for (const others of [titles, ["CONTRA - SATURDAYS", "English Country Dance"], []]) {
        expect(
          contradictingDate(page, text, "CONTRA - SATURDAYS", "2026-10-10", "en", others),
        ).toBeNull();
      }
    }
    const result = read("https://cdny.org/", one, [
      { title: "English Country Dance", local_date: "2026-10-06" },
      { title: "CONTRA - SATURDAYS", local_date: "2026-10-10" },
    ]);
    expect(written(result)).toContain("CONTRA - SATURDAYS 2026-10-10 untimed");
    expect(result.contradicted).toEqual([]);
  });

  it("takes a date alone over a title for no card's date line (CDNY with one dance left)", () => {
    // A heading's last item written with no time is never the next title's date line, even where
    // the next title writes no date of its own under it to hold its night.
    const text = [
      "ENGLISH - TUESDAYS",
      "",
      "Oct 6th - Calling: Jane Doe",
      "",
      "CONTRA - SATURDAYS",
      "",
      "Contra dancing with a live band and a caller, all levels welcome",
    ].join("\n");
    expect(
      contradictingDate(foldPage(text), text, "CONTRA - SATURDAYS", "2026-10-10", "en"),
    ).toBeNull();
    const result = read("https://cdny.org/", text, [
      { title: "CONTRA - SATURDAYS", local_date: "2026-10-10" },
    ]);
    expect(written(result)).toEqual(["CONTRA - SATURDAYS 2026-10-10 untimed"]);
  });
});

/** Frim Fram Jam's own page (frimframjam.com, 2026-09-29), as cleanPageText gives it. */
const FRIM_FRAM = readFileSync(join(__dirname, "fixtures/frimframjam-com.txt"), "utf8");

/** "title night doors lesson dancing end", "-" for a time not given, and "withdrawn" when so. */
const times = (result: ReturnType<typeof read>) =>
  result.listings.map((h) =>
    [
      h.listing.title,
      h.listing.local_date,
      h.listing.doors_time ?? "-",
      h.listing.lesson_time ?? "-",
      h.listing.dancing_time ?? "-",
      h.listing.end_time ?? "-",
      ...(h.timesWithdrawn ? ["withdrawn"] : []),
    ].join(" "),
  );

describe("a time under a date heading below a title is not the listing's (D-081)", () => {
  // D-080 dates a title with no date of its own by the first date heading below it; the times under
  // that heading may be another event's, so a read's time there is withdrawn, never kept.
  it("still drops a time that night's section does not write (Frim Fram Jam at 7pm)", () => {
    const result = read("https://frimframjam.com/", FRIM_FRAM, [
      { title: "Frim Fram Jam", local_date: "2026-10-01", dancing_time: "19:00" },
    ]);
    expect(times(result)).toEqual(["Frim Fram Jam 2026-10-01 - - - - withdrawn"]);
  });

  // Other events of the day under the heading: their times are never the listing's.
  it.each([
    [
      "the day's classes, named before their times",
      ["Friday, October 2, 2026", "Morning yoga 9am", "Kids hip hop 4:30pm"],
      "2026-10-02",
      ["21:00", "09:00", "16:30"],
    ],
    [
      "two events, each named over its times",
      [
        "October 2, 2026",
        "Comedy Hour",
        "7pm - 8pm in the back room",
        "Trivia with Sam",
        "10pm - midnight",
      ],
      "2026-10-02",
      ["19:00", "22:00", "23:00"],
    ],
    [
      "two events, each written time first",
      ["October 2, 2026", "7pm - 8pm Comedy Hour", "10pm - midnight Trivia with Sam"],
      "2026-10-02",
      ["19:00", "22:00"],
    ],
    ["one other event", ["October 2, 2026", "Open Mic 7pm"], "2026-10-02", ["19:00"]],
  ])("takes no time from a section that holds %s", (_, section, night, reads) => {
    const page = [
      "Friday Night Social",
      "Our weekly social dance: all levels, all styles, great music.",
      "",
      ...section,
      "",
      "Saturday, October 3, 2026",
      "Studio closed",
    ].join("\n");
    for (const dancing of reads) {
      const result = read("https://club.example/", page, [
        { title: "Friday Night Social", local_date: night, dancing_time: dancing },
      ]);
      expect(times(result), dancing).toEqual([`Friday Night Social ${night} - - - - withdrawn`]);
    }
  });

  it("withdraws a neighbour's time from a card whose own date says its time is not out yet", () => {
    const page = [
      "Salsa Night",
      "Friday, October 2, 2026",
      "9pm - 2am at Club X",
      "",
      "Bachata Social",
      "Saturday, October 3, 2026",
      "Time to be announced",
    ].join("\n");
    const bachata = {
      title: "Bachata Social",
      local_date: "2026-10-03",
      dancing_time: "21:00",
      end_time: "02:00",
    };
    expect(times(read("https://club.example/", page, [bachata]))).toEqual([
      "Bachata Social 2026-10-03 - - - - withdrawn",
    ]);
    expect(
      times(
        read("https://club.example/", page, [
          {
            title: "Salsa Night",
            local_date: "2026-10-02",
            dancing_time: "21:00",
            end_time: "02:00",
          },
          bachata,
        ]),
      ),
    ).toEqual([
      "Salsa Night 2026-10-02 - - 21:00 02:00",
      "Bachata Social 2026-10-03 - - - - withdrawn",
    ]);
  });
});

describe("a tied layout is settled by the page's own items the read skips (F3)", () => {
  // A summary that writes each title first, with its date and time under it: when the read skips
  // the page's first item, every read title has a time above it and one under it, the page's own
  // lines tie, and the first title's time above made it a card layout.
  const url = "https://studio.example/events";
  const list = (items: Array<[string, string]>, dateFirst = false) =>
    cleanPageText(
      `<html><body><main>${items
        .map(([title, when], i) =>
          dateFirst
            ? `<article><time>${when}</time><h2><a href="https://studio.example/c${i}">${title}</a></h2></article>`
            : `<article><h2><a href="https://studio.example/e${i}">${title}</a></h2><time>${when}</time></article>`,
        )
        .join("")}</main></body></html>`,
      url,
    );
  const summary = list([
    ["Jazz Brunch Concert (seated)", "Sunday, October 4 · 11:00 AM"],
    ["Salsa Night", "Sunday, October 4 · 9:00 PM"],
    ["Bachata Night", "Monday, October 5 · 8:00 PM"],
    ["Kizomba Night", "Tuesday, October 6 · 10:00 PM"],
  ]);
  const at = (title: string, local_date: string, dancing_time: string) => ({
    title,
    local_date,
    dancing_time,
  });

  it("keeps each listing's own time when the read skips the first item", () => {
    const result = read(url, summary, [
      at("Salsa Night", "2026-10-04", "21:00"),
      at("Bachata Night", "2026-10-05", "20:00"),
      at("Kizomba Night", "2026-10-06", "22:00"),
    ]);
    expect(times(result)).toEqual([
      "Salsa Night 2026-10-04 - - 21:00 -",
      "Bachata Night 2026-10-05 - - 20:00 -",
      "Kizomba Night 2026-10-06 - - 22:00 -",
    ]);
  });

  it("drops the previous item's time, the same day's included", () => {
    const result = read(url, summary, [
      at("Salsa Night", "2026-10-04", "11:00"),
      at("Bachata Night", "2026-10-05", "21:00"),
      at("Kizomba Night", "2026-10-06", "20:00"),
    ]);
    expect(times(result)).toEqual([
      "Salsa Night 2026-10-04 - - - - withdrawn",
      "Bachata Night 2026-10-05 - - - - withdrawn",
      "Kizomba Night 2026-10-06 - - - - withdrawn",
    ]);
  });

  it("keeps weekly rules' own times when the read skips the first rule", () => {
    const rules = list([
      ["Open Mic (seated)", "Saturdays · 7:00 PM"],
      ["Salsa Night", "Sundays · 9:00 PM"],
      ["Bachata Night", "Mondays · 8:00 PM"],
    ]);
    const result = read(url, rules, [
      { title: "Salsa Night", recurrence_text: "Sundays", dancing_time: "21:00" },
      { title: "Bachata Night", recurrence_text: "Mondays", dancing_time: "20:00" },
    ]);
    expect(
      result.listings.map((h) => [h.listing.title, h.recurrence?.rrule, h.listing.dancing_time]),
    ).toEqual([
      ["Salsa Night", "FREQ=WEEKLY;BYDAY=SU", "21:00"],
      ["Bachata Night", "FREQ=WEEKLY;BYDAY=MO", "20:00"],
    ]);
  });

  it("withdraws a read shifted by one card, never letting its own nights settle the layout", () => {
    // A card list whose last card the read skips ties the vote; the read's shifted nights would
    // vote for the layout that confirms its shifted times. The skipped card's own line decides.
    const cards = list(
      [
        ["Salsa Night", "Friday, October 2 · 9:00 PM"],
        ["Bachata Night", "Saturday, October 3 · 8:00 PM"],
        ["Rock Concert", "Sunday, October 4 · 10:00 PM"],
      ],
      true,
    );
    expect(
      times(
        read(url, cards, [
          at("Salsa Night", "2026-10-02", "21:00"),
          at("Bachata Night", "2026-10-03", "20:00"),
        ]),
      ),
    ).toEqual(["Salsa Night 2026-10-02 - - 21:00 -", "Bachata Night 2026-10-03 - - 20:00 -"]);
    expect(
      times(
        read(url, cards, [
          at("Salsa Night", "2026-10-03", "20:00"),
          at("Bachata Night", "2026-10-04", "22:00"),
        ]),
      ),
    ).toEqual([
      "Salsa Night 2026-10-03 - - - - withdrawn",
      "Bachata Night 2026-10-04 - - - - withdrawn",
    ]);
  });

  it("still withdraws the next card's time on a card list the read ends early", () => {
    const cards = list(
      [
        ["Salsa Night", "Sunday, October 4 · 7:00 PM"],
        ["Bachata Night", "Sunday, October 4 · 10:00 PM"],
        ["Kizomba Night", "Monday, October 5 · 8:00 PM"],
      ],
      true,
    );
    expect(
      times(
        read(url, cards, [
          at("Salsa Night", "2026-10-04", "19:00"),
          at("Bachata Night", "2026-10-04", "22:00"),
        ]),
      ),
    ).toEqual(["Salsa Night 2026-10-04 - - 19:00 -", "Bachata Night 2026-10-04 - - 22:00 -"]);
    expect(
      times(
        read(url, cards, [
          at("Salsa Night", "2026-10-04", "22:00"),
          at("Bachata Night", "2026-10-04", "20:00"),
        ]),
      ),
    ).toEqual([
      "Salsa Night 2026-10-04 - - - - withdrawn",
      "Bachata Night 2026-10-04 - - - - withdrawn",
    ]);
  });
});

describe("a withdrawal carries the starts the listing's own part writes (F4)", () => {
  it("gives Tango Y Te's 3pm when a wrong time is withdrawn from its rescued rule", () => {
    const page = [
      "Social Events",
      "",
      "Tango Y Te",
      "Date: Every Sunday - Time: 3:00pm",
      "Next: Sunday, October 4 with DJ Ana",
      "",
      "Bachata Rosa",
      "Date: Every Friday - Time: 9pm",
    ].join("\n");
    const result = read("https://www.steppingoutstudios.com/social-events1", page, [
      { title: "Tango Y Te", local_date: "2026-09-29", dancing_time: "21:00" },
      { title: "Bachata Rosa", recurrence_text: "every Friday", dancing_time: "21:00" },
    ]);
    const tango = result.listings.find((h) => h.listing.title === "Tango Y Te")!;
    expect(tango.recurrence?.rrule).toBe("FREQ=WEEKLY;BYDAY=SU");
    expect(tango.timesWithdrawn).toEqual({ pageStarts: ["15:00"], pageEnds: [] });
    // A listing whose times stand carries none.
    const bachata = result.listings.find((h) => h.listing.title === "Bachata Rosa")!;
    expect(bachata.timesWithdrawn).toBeUndefined();
  });
});

describe("a rescued rule that skips weeks runs from the page's date (F6)", () => {
  // A read's date the page contradicts gives way to the rule the page writes after the title
  // (D-078, D-080). Anchored on today, an "every other" rule listed the weeks the event is off.
  const url = "https://club.example/";
  const nights = (result: ReturnType<typeof read>, title: string) =>
    result.listings
      .filter((h) => h.listing.title === title)
      .flatMap((h) => expandRecurrence(h, "2026-09-29", "America/New_York", 30).listings)
      .map((h) => `${h.listing.local_date} ${h.listing.dancing_time}`);
  const bachata = {
    title: "Bachata Night",
    recurrence_text: "Every Saturday",
    dancing_time: "22:00",
  };

  it("lists an every-other-Friday card on the Fridays its next date keeps", () => {
    const page = [
      "Upcoming",
      "",
      "Salsa Fridays",
      "Every other Friday, 9pm",
      "Next: Friday, October 9",
      "",
      "Bachata Night",
      "Every Saturday, 10pm",
    ].join("\n");
    // Dated today, a Tuesday: the page gives Friday, October 9 beside the title.
    const result = read(url, page, [
      { title: "Salsa Fridays", local_date: "2026-09-29", dancing_time: "21:00" },
      bachata,
    ]);
    expect(nights(result, "Salsa Fridays")).toEqual(["2026-10-09 21:00", "2026-10-23 21:00"]);
  });

  it("lists Tango Y Te every other Sunday from the next date its card gives", () => {
    const page = [
      "Social Events",
      "",
      "Tango Y Te",
      "Date: Every other Sunday - Time: 3:00pm",
      "Next: Sunday, October 11 with DJ Ana",
      "",
      "Bachata Rosa",
      "Date: Every Friday - Time: 9pm",
    ].join("\n");
    const result = read("https://www.steppingoutstudios.com/social-events1", page, [
      { title: "Tango Y Te", local_date: "2026-09-29", dancing_time: "15:00" },
    ]);
    expect(nights(result, "Tango Y Te")).toEqual(["2026-10-11 15:00", "2026-10-25 15:00"]);
  });

  it.each([
    ["an ISO date", "Next: 2026-10-09", ["2026-10-09 21:00", "2026-10-23 21:00"]],
    // Written without its year, months back: last March's, a Friday, not next March's.
    [
      "a start months back",
      "Every other Friday since March 13",
      ["2026-10-09 21:00", "2026-10-23 21:00"],
    ],
  ])("keeps an every-other-Friday card's weeks by %s", (_, next, expected) => {
    const page = [
      "Upcoming",
      "",
      "Salsa Fridays",
      "Every other Friday, 9pm",
      next,
      "",
      "Bachata Night",
      "Every Saturday, 10pm",
    ].join("\n");
    const result = read(url, page, [
      { title: "Salsa Fridays", local_date: "2026-09-29", dancing_time: "21:00" },
      bachata,
    ]);
    expect(nights(result, "Salsa Fridays")).toEqual(expected);
  });

  it.each([
    [
      "another item's date, one the read skipped",
      [
        "Open Mic Night [https://club.example/open-mic]",
        "Poetry, comedy and songs.",
        "Next: 2026-10-02",
      ],
    ],
    ["the date a post was written", ["Posted Friday, September 18, 2026 by admin"]],
  ])("does not keep an every-other-Friday card's weeks by %s", (_, after) => {
    const page = [
      "Upcoming",
      "",
      "Salsa Fridays [https://club.example/salsa]",
      "Every other Friday, 9pm",
      "Salsa social with DJ Luis, all levels.",
      ...after,
      "",
      "Bachata Night [https://club.example/bachata]",
      "Every Saturday, 10pm",
    ].join("\n");
    const result = read(url, page, [
      { title: "Salsa Fridays", local_date: "2026-09-29", dancing_time: "21:00" },
      bachata,
    ]);
    expect(nights(result, "Salsa Fridays")).toEqual([]);
  });

  it("does not list an every-other-Friday card whose next date is not a Friday", () => {
    const page = [
      "Upcoming",
      "",
      "Salsa Fridays",
      "Every other Friday, 9pm",
      "Next: Monday, October 12",
      "",
      "Bachata Night",
      "Every Saturday, 10pm",
    ].join("\n");
    const result = read(url, page, [
      { title: "Salsa Fridays", local_date: "2026-09-29", dancing_time: "21:00" },
      bachata,
    ]);
    expect(result.listings.map((h) => h.listing.title)).toEqual(["Bachata Night"]);
    expect(result.notes.some((n) => /skips weeks.*Salsa Fridays/.test(n))).toBe(true);
  });

  it("does not list an every-other-Friday card whose page gives no date to keep its weeks by", () => {
    const page = [
      "Upcoming",
      "",
      "Salsa Fridays",
      "Every other Friday, 9pm",
      "",
      "Bachata Night",
      "Every Saturday, 10pm",
    ].join("\n");
    const result = read(url, page, [
      { title: "Salsa Fridays", local_date: "2026-09-29", dancing_time: "21:00" },
      bachata,
    ]);
    expect(result.listings.map((h) => h.listing.title)).toEqual(["Bachata Night"]);
    expect(result.notes.some((n) => /skips weeks.*Salsa Fridays/.test(n))).toBe(true);
  });
});
