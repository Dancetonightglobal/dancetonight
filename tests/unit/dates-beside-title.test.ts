// Where a page dates a listing (D-080): a dated heading is a night, not a weekly rule; a date
// counts for a listing only beside its own title; a date the page gives the title instead
// contradicts the model's.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { rawExtractionSchema } from "@/src/domain/listing";
import {
  contradictingDate,
  dateBesideTitle,
  datedWeekdays,
  foldPage,
  recurrenceNearTitle,
  statesDate,
} from "@/src/domain/text-facts";
import { cleanPageText } from "@/src/pipeline/clean";
import { extractionToHarvested } from "@/src/pipeline/extract";

const PAGES = join(process.cwd(), "evals/links/pages");
const pageText = (name: string) => readFileSync(join(PAGES, `${name}.txt`), "utf8");

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

const read = (url: string, text: string, listings: Array<Record<string, unknown>>) =>
  extractionToHarvested(reply(listings), {
    pageUrl: url,
    fetchedAt: new Date("2026-09-29T14:00:00Z"),
    today: "2026-09-29",
    pageText: text,
    countryCode: "US",
  });

const RONDA: Array<[string, string, string]> = [
  ["Los Tres Amigos Milonga", "2026-09-29", "Tuesday"],
  ["Tango Cafe", "2026-09-30", "Wednesday"],
  ["Tango la Nacional", "2026-10-01", "Thursday"],
  ["Pasion Milonguera", "2026-10-02", "Friday"],
  ["Esa! Milonga", "2026-10-02", "Friday"],
  ["Victoria's Practica", "2026-10-03", "Saturday"],
];
const RONDA_TITLES = RONDA.map(([t]) => t);

describe("a dated heading is a night, not a weekly rule (The Ronda, run 30)", () => {
  it("lists each milonga on its heading's night and drops the model's weekly rule", () => {
    const result = read(
      "https://www.theronda.us/nyc",
      pageText("theronda-us-nyc"),
      RONDA.map(([title, date, day]) => ({
        title,
        local_date: date,
        recurrence_text: `every ${day}`,
      })),
    );
    expect(
      result.listings.map((h) => [h.listing.title, h.listing.local_date, h.recurrence]),
    ).toEqual(RONDA.map(([title, date]) => [title, date, null]));
    expect(result.recurrenceNotOnPage).toEqual(RONDA_TITLES);
  });
});

describe("datedWeekdays", () => {
  const dated = (text: string, lang = "en") => {
    const page = foldPage(text);
    const flags = datedWeekdays(page, lang);
    return page.words.filter((_, i) => flags[i]);
  };
  it.each([
    ["Fri, Oct 30 • 8:30 PM", ["fri"]],
    ["Tuesday, September 29, 2026", ["tuesday"]],
    ["Friday the 2nd of October", ["friday"]],
    ["October 2 (Friday)", ["friday"]],
    ["Fridays, October 2 - 30", []],
    ["Every Friday, October 2", []],
    ["Friday 9pm", []],
    ["Fri 10/2", []],
  ])("reads the weekday in %s as a date's: %j", (text, expected) => {
    expect(dated(text)).toEqual(expected);
  });
  it("reads a date in the page's language", () => {
    expect(dated("vendredi 2 octobre", "fr")).toEqual(["vendredi"]);
  });
});

describe("dateBesideTitle", () => {
  const ronda = foldPage(pageText("theronda-us-nyc"));
  const swings = foldPage(pageText("nycswings-net"));
  const ffj = foldPage(pageText("frimframjam-com"));

  it("reads the date heading over a title, past the listing before it", () => {
    expect(dateBesideTitle(ronda, "Esa! Milonga", "2026-10-02", "en", RONDA_TITLES)).toEqual({
      stated: true,
      otherDate: null,
      weekdayBeside: false,
    });
    expect(
      dateBesideTitle(ronda, "Los Tres Amigos Milonga", "2026-10-06", "en", RONDA_TITLES),
    ).toEqual({
      stated: false,
      otherDate: "Tuesday, September 29, 2026",
      weekdayBeside: false,
    });
  });

  it("reads a card on a one-line list up to its own link, not the card before it", () => {
    expect(dateBesideTitle(swings, "Social Dance Flow Fridays", "2026-10-02", "en")).toMatchObject({
      stated: false,
      otherDate: "Fri, Oct 30",
    });
    expect(dateBesideTitle(swings, "Social Dance Flow Fridays", "2026-10-30", "en").stated).toBe(
      true,
    );
    expect(
      dateBesideTitle(swings, "West Coast Swing with Swingiversity", "2026-10-02", "en").stated,
    ).toBe(true);
  });

  it("takes a dated line under a title as its own, and a heading over it as weak (Squarespace)", () => {
    const page = foldPage("Salsa Thursdays\nSunday, October 4\nBachata Night\nMonday, October 5");
    const others = ["Salsa Thursdays", "Bachata Night"];
    expect(dateBesideTitle(page, "Bachata Night", "2026-10-05", "en", others).stated).toBe(true);
    // The line over it may be Salsa Thursdays' own date: it states, never contradicts.
    expect(dateBesideTitle(page, "Bachata Night", "2026-10-04", "en", others).stated).toBe(true);
    expect(dateBesideTitle(page, "Bachata Night", "2026-10-09", "en", others).otherDate).toBe(
      "Monday, October 5",
    );
  });

  it("takes the first date under a block that has none, weakly (Frim Fram Jam, D-079)", () => {
    expect(dateBesideTitle(ffj, "Frim Fram Jam", "2026-10-01", "en").stated).toBe(true);
    expect(dateBesideTitle(ffj, "Frim Fram Jam", "2026-10-08", "en")).toEqual({
      stated: false,
      otherDate: null,
      weekdayBeside: false,
    });
  });

  it("reads a short lead before the title, never the next title's", () => {
    const page = foldPage("Oct 2 - Salsa Social 9pm\nOct 3 - Bachata Night 8pm");
    const others = ["Salsa Social", "Bachata Night"];
    expect(dateBesideTitle(page, "Salsa Social", "2026-10-02", "en", others).stated).toBe(true);
    expect(dateBesideTitle(page, "Salsa Social", "2026-10-03", "en", others)).toEqual({
      stated: false,
      otherDate: null,
      weekdayBeside: false,
    });
  });

  it("gives no other date when the night's weekday stands beside the title as a weekday", () => {
    const page = foldPage(
      "Salsa Social\nEvery Friday, 9pm. Next special: Sat, Oct 3\n\nBachata Night",
    );
    expect(dateBesideTitle(page, "Salsa Social", "2026-10-09", "en", ["Bachata Night"])).toEqual({
      stated: false,
      otherDate: null,
      weekdayBeside: true,
    });
  });

  it("never takes a date in an earlier year for the listing's", () => {
    const page = foldPage("July 19, 2023\nNews: masks are optional\n\n© 2026 Frim Fram Jam, LLC");
    expect(dateBesideTitle(page, "Frim Fram Jam", "2026-10-01", "en").otherDate).toBeNull();
  });
});

describe("contradictingDate", () => {
  it("names the heading a title is listed under, or the date its card gives", () => {
    const ronda = pageText("theronda-us-nyc");
    expect(
      contradictingDate(
        foldPage(ronda),
        ronda,
        "Los Tres Amigos Milonga",
        "2026-10-06",
        "en",
        RONDA_TITLES,
      ),
    ).toEqual({ kind: "heading", text: "Tuesday, September 29, 2026" });
    const swings = pageText("nycswings-net");
    expect(
      contradictingDate(foldPage(swings), swings, "Social Dance Flow Fridays", "2026-10-02", "en"),
    ).toEqual({ kind: "beside", text: "Fri, Oct 30" });
  });

  it("is null for a night the page gives by a weekday beside the title (Tango Y Te)", () => {
    const so = pageText("steppingoutstudios-com-social-events1");
    expect(contradictingDate(foldPage(so), so, "Tango Y Te", "2026-10-04", "en")).toBeNull();
    expect(contradictingDate(foldPage(so), so, "Tango Y Te", "2026-09-29", "en")).toBeNull();
  });

  it("is null on the weekday a table row gives before the title", () => {
    const text =
      "Day | Event | Time\nMonday | Salsa Mondays | 8pm - midnight\nWednesday | Bachata Wednesdays | 8pm\n\nThis week's flyer: Salsa Mondays, October 5";
    const page = foldPage(text);
    const others = ["Salsa Mondays", "Bachata Wednesdays"];
    expect(contradictingDate(page, text, "Salsa Mondays", "2026-10-12", "en", others)).toBeNull();
    expect(contradictingDate(page, text, "Salsa Mondays", "2026-10-06", "en", others)).toEqual({
      kind: "beside",
      text: "October 5",
    });
  });

  it("is null for a title the page does not write", () => {
    const swings = pageText("nycswings-net");
    expect(
      contradictingDate(foldPage(swings), swings, "Nylon Lindy Hop", "2026-10-02", "en"),
    ).toBeNull();
  });
});

describe("a date written on another card (NYC Swings, run 30)", () => {
  it.each([{ recurrence_text: "first Friday of the month" }, {}])(
    "is not Flow Fridays' date: %j",
    (extra) => {
      const result = read("https://www.nycswings.net/", pageText("nycswings-net"), [
        { title: "Class West Coast Swing with Jes Ann Nail", local_date: "2026-09-30" },
        { title: "Social Dance Flow Fridays", local_date: "2026-10-02", ...extra },
      ]);
      expect(result.listings.map((h) => h.listing.title)).toEqual([
        "Class West Coast Swing with Jes Ann Nail",
      ]);
      expect(result.rejected).toEqual([
        {
          title: "Social Dance Flow Fridays",
          reason:
            'dated 2026-10-02, but the page gives it "Fri, Oct 30" beside its title; not listed on that date',
        },
      ]);
      expect(result.contradicted).toEqual([
        { title: "Social Dance Flow Fridays", night: "2026-10-02" },
      ]);
    },
  );
});

// The review of D-080 (2026-09-29): each case below lost a true night, or kept a false one, before.

describe("a weekday after a recurrence's word is the rule's, not a date's", () => {
  const dated = (text: string, lang = "en") => {
    const page = foldPage(text);
    const flags = datedWeekdays(page, lang);
    return page.words.filter((_, i) => flags[i]);
  };
  it.each([
    ["First Friday, October 2, 8pm", "en"],
    ["Every other Friday: Oct 2, Oct 16, Oct 30", "en"],
    ["Every 2nd Friday, October 9", "en"],
    ["1st & 3rd Friday, Oct 2 & Oct 16", "en"],
    ["Last Friday, October 30", "en"],
    ["cada viernes, 2 de octubre", "es"],
    ["todos los viernes 2 de octubre", "es"],
    ["chaque vendredi 2 octobre", "fr"],
    ["jeden Freitag, 2. Oktober", "de"],
  ])("does not read the weekday in %s (%s) as a date's", (text, lang) => {
    expect(dated(text, lang)).toEqual([]);
  });

  it("accepts the recurrence those pages write", () => {
    const near = (text: string, phrase: string) =>
      recurrenceNearTitle(foldPage(text), text.split("\n")[0]!, phrase, "en", []);
    expect(near("Contra Dance\nFirst Friday, October 2, 8pm", "first Friday of the month")).toBe(
      true,
    );
    expect(near("Contra Dance\nEvery other Friday: Oct 2, Oct 16", "every other Friday")).toBe(
      true,
    );
    expect(near("Contra Dance\n1st & 3rd Friday, Oct 2 & Oct 16", "1st and 3rd Friday")).toBe(true);
  });
});

describe("a card that says Weekly and prints only its next date (NYC Swings)", () => {
  const text = pageText("nycswings-net");
  const MIDTOWN = "Midtown Swings – Weekly Swing Dance Party";
  const HOUSE = "House of West – NYC’s Weekly West Coast Swing Party";

  it.each([
    [MIDTOWN, "2026-09-29", "every Tuesday", "FREQ=WEEKLY;BYDAY=TU"],
    [HOUSE, "2026-09-30", "every Wednesday", "FREQ=WEEKLY;BYDAY=WE"],
  ])("keeps the model's rule for %s", (title, date, phrase, rrule) => {
    const result = read("https://www.nycswings.net/", text, [
      { title, local_date: date, recurrence_text: phrase },
    ]);
    expect(result.listings.map((h) => h.recurrence?.rrule ?? null)).toContain(rrule);
    expect(result.recurrenceNotOnPage).toEqual([]);
  });

  it("gives the weekly night's weekday, not another date, a week on", () => {
    const page = foldPage(text);
    expect(contradictingDate(page, text, MIDTOWN, "2026-10-06", "en")).toBeNull();
    expect(contradictingDate(page, text, HOUSE, "2026-10-07", "en")).toBeNull();
    // The previous card's "Weekly" licenses nothing on the next card: its date stays a date.
    expect(
      recurrenceNearTitle(page, "West Coast Swing with Jes Ann Nail", "every Wednesday", "en", [
        HOUSE,
        "West Coast Swing with Jes Ann Nail",
      ]),
    ).toBe(false);
  });

  it.each([
    ["Salsa Social\nWeekly. Next: Thursday, October 1, 9pm", "every Thursday"],
    ["Salsa Social\nEvery week! Thu Oct 1 & Thu Oct 8, 9pm", "every Thursday"],
  ])("reads %j as %s", (text, phrase) => {
    expect(recurrenceNearTitle(foldPage(text), "Salsa Social", phrase, "en", [])).toBe(true);
  });
});

describe("a number is not a date the page gives a listing", () => {
  it.each([
    "1/2 price drinks until 10pm.",
    "$10/15 members/non-members.",
    "Our studio is open 24/7 for practice.",
    "Social 8pm, ages 18/21+.",
    "All 3/4 time, 8pm.",
  ])("does not contradict a weekly night with %j", (detail) => {
    const text = `Salsa Mondays\nBeginner lesson 8pm, social until midnight. ${detail}`;
    const page = foldPage(text);
    expect(dateBesideTitle(page, "Salsa Mondays", "2026-10-05", "en").otherDate).toBeNull();
    expect(contradictingDate(page, text, "Salsa Mondays", "2026-10-05", "en")).toBeNull();
  });

  it("states a night by number only with its year or its weekday, and never after a currency sign", () => {
    expect(statesDate("$10/15 members", "2026-10-15", "en")).toBe(false);
    const block = (detail: string, night: string) =>
      dateBesideTitle(foldPage(`Salsa Social\n${detail}`), "Salsa Social", night, "en").stated;
    expect(block("1/2 price drinks", "2026-01-02")).toBe(false);
    expect(block("Fri 10/2, 9pm", "2026-10-02")).toBe(true);
    expect(block("10/2/2026, 9pm", "2026-10-02")).toBe(true);
  });
});

describe("a date inside a sentence below the title is not the listing's", () => {
  it("does not take a notice under a menu for a weekly social's date", () => {
    const html =
      '<div><ul><li><a href="https://studio.example/">Home</a></li><li><a href="https://studio.example/salsa">Salsa Mondays</a></li><li><a href="https://studio.example/about">About us</a></li></ul></div>' +
      "<p>Our new sprung floor is in! Renovations finished September 15 - come and see it.</p>" +
      "<h3>Salsa Mondays</h3><p>Beginner lesson at 8pm, then social dancing until midnight.</p>";
    const text = cleanPageText(html, "https://studio.example/");
    const page = foldPage(text);
    expect(contradictingDate(page, text, "Salsa Mondays", "2026-09-28", "en")).toBeNull();
    expect(contradictingDate(page, text, "Salsa Mondays", "2026-10-05", "en")).toBeNull();
  });

  it("does not take a post's own date for the listing's", () => {
    const text =
      "Swing Tuesdays\nPosted September 1, 2026 by admin\nOur weekly social is back at the Loft, 8pm to 11pm.";
    expect(
      contradictingDate(foldPage(text), text, "Swing Tuesdays", "2026-10-06", "en"),
    ).toBeNull();
  });

  it("still takes a line that opens with a date, after a short label", () => {
    const text = "Salsa Social\nA night of salsa at the Loft.\nDoors 8pm.\nDate: Sat, Oct 3";
    expect(dateBesideTitle(foldPage(text), "Salsa Social", "2026-10-10", "en").otherDate).toBe(
      "Sat, Oct 3",
    );
    // …and the same date inside a sentence does not.
    const sentence =
      "Salsa Social\nA night of salsa at the Loft.\nDoors 8pm.\nWe reopen on Sat, Oct 3";
    expect(
      dateBesideTitle(foldPage(sentence), "Salsa Social", "2026-10-10", "en").otherDate,
    ).toBeNull();
  });
});

describe("a rule written after the title outlives a date the page contradicts (D-078)", () => {
  it("lists Tango Y Te by Every Sunday when its card gives a next date", () => {
    const result = read(
      "https://www.steppingoutstudios.com/social-events1",
      "Social Events\n\nTango Y Te\nDate: Every Sunday - Time: 3:00pm\nNext: Sunday, October 4 with DJ Ana\n\nBachata Rosa\nDate: Every Friday - Time: 9pm",
      [
        { title: "Tango Y Te", local_date: "2026-09-29" },
        { title: "Bachata Rosa", recurrence_text: "every Friday" },
      ],
    );
    expect(
      result.listings.map((h) => [h.listing.title, h.listing.local_date, h.recurrence?.rrule]),
    ).toEqual([
      ["Tango Y Te", null, "FREQ=WEEKLY;BYDAY=SU"],
      ["Bachata Rosa", null, "FREQ=WEEKLY;BYDAY=FR"],
    ]);
    expect(result.rejected).toEqual([
      {
        title: "Tango Y Te",
        reason:
          'dated 2026-09-29, but the page gives it "Sunday, October 4" beside its title; not listed on that date',
      },
    ]);
    expect(result.contradicted).toEqual([{ title: "Tango Y Te", night: "2026-09-29" }]);
  });

  it.each([{}, { recurrence_text: "every Monday" }])(
    "lists it by its rule when a dated line stands directly under the title: %j",
    (extra) => {
      const result = read(
        "https://www.steppingoutstudios.com/social-events1",
        "Tango Y Te\nNo practica on October 11 (studio closed).\nDate: Every Sunday - Time: 3:00pm – 6:00 pm",
        [{ title: "Tango Y Te", local_date: "2026-09-29", ...extra }],
      );
      expect(result.listings.map((h) => [h.listing.local_date, h.recurrence?.rrule])).toEqual([
        [null, "FREQ=WEEKLY;BYDAY=SU"],
      ]);
      expect(result.contradicted).toEqual([{ title: "Tango Y Te", night: "2026-09-29" }]);
    },
  );
});

describe("a list that prints each date above its title", () => {
  const tec = (day: string, weekday: string, date: string, title: string) =>
    `<div><div><time><span>${weekday}</span> <span>${day}</span></time></div>` +
    `<article><header><div><time><span>${date} @ 8:00 pm</span> - <span>11:00 pm</span></time></div>` +
    `<h3><a href="https://salsaclub.example/event/${day}/">${title}</a></h3>` +
    `<address><span>Studio 54th</span> <span>250 W 54th St, New York</span></address></header>` +
    `<div><p>Beginner lesson at 8, then social dancing until late.</p></div></article></div>`;
  const PAGES: Array<[string, string, string, Array<[string, string]>]> = [
    [
      "The Events Calendar's list view",
      "https://salsaclub.example/events/list/",
      `<main><h2>Upcoming Events</h2>${tec("2", "Fri", "October 2", "Friday Salsa Social")}${tec("3", "Sat", "October 3", "Bachata Saturday")}${tec("4", "Sun", "October 4", "Kizomba Sunday")}</main>`,
      [
        ["Friday Salsa Social", "2026-10-02"],
        ["Bachata Saturday", "2026-10-03"],
        ["Kizomba Sunday", "2026-10-04"],
      ],
    ],
    [
      "Eventbrite's organizer cards",
      "https://www.eventbrite.com/o/lindy-loft-44556677",
      `<main><div><p>Sat, Oct 3, 8:00 PM</p><h3><a href="https://www.eventbrite.com/e/loft-lindy-night-tickets-1">Loft Lindy Night</a></h3><p>The Loft · New York, NY</p><p>From $15.00</p></div>` +
        `<div><p>Sun, Oct 4, 11:00 AM</p><h3><a href="https://www.eventbrite.com/e/balboa-brunch-tickets-2">Balboa Brunch Social</a></h3><p>The Loft · New York, NY</p><p>Free</p></div>` +
        `<div><p>Thu, Oct 8, 9:00 PM</p><h3><a href="https://www.eventbrite.com/e/blues-tickets-3">Blues Underground</a></h3><p>The Loft · New York, NY</p></div></main>`,
      [
        ["Loft Lindy Night", "2026-10-03"],
        ["Balboa Brunch Social", "2026-10-04"],
        ["Blues Underground", "2026-10-08"],
      ],
    ],
    [
      "Meetup's group events (Sat, Oct 3 · 8:00 PM)",
      "https://www.meetup.com/nyc-salsa/events/",
      `<main><ul><li><time>SAT, OCT 3 · 8:00 PM EDT</time><h3><a href="https://www.meetup.com/nyc-salsa/events/301/">Salsa Social at the Loft</a></h3><p>The Loft • New York, NY</p><p>12 attendees</p></li>` +
        `<li><time>WED, OCT 7 · 7:30 PM EDT</time><h3><a href="https://www.meetup.com/nyc-salsa/events/302/">Bachata Practice Night</a></h3><p>Dance Space • New York, NY</p><p>8 attendees</p></li></ul></main>`,
      [
        ["Salsa Social at the Loft", "2026-10-03"],
        ["Bachata Practice Night", "2026-10-07"],
      ],
    ],
  ];

  it.each(PAGES)("writes every night of %s and contradicts none", (_, url, html, listings) => {
    const text = cleanPageText(html, url);
    const result = read(
      url,
      text,
      listings.map(([title, local_date]) => ({ title, local_date })),
    );
    expect(result.listings.map((h) => [h.listing.title, h.listing.local_date])).toEqual(listings);
    expect(result.rejected).toEqual([]);
    // A partial read knows none of the titles: the page still contradicts no true night.
    const page = foldPage(text);
    for (const [title, date] of listings) {
      expect(contradictingDate(page, text, title, date, "en")).toBeNull();
    }
  });

  it("reads a date-first line, not the next line's date, and keeps a summary's date below its title", () => {
    const lines =
      "Fri, Oct 2 • 9:00 PM - Salsa Social at Studio X\nSat, Oct 3 • 8:00 PM - Jazz Concert (seated)";
    const others = ["Salsa Social", "Bachata Night"];
    const page = foldPage(lines);
    expect(contradictingDate(page, lines, "Salsa Social", "2026-10-02", "en", others)).toBeNull();
    expect(dateBesideTitle(page, "Salsa Social", "2026-10-02", "en", others).stated).toBe(true);
    // A Squarespace summary prints each date and time below its title; with the titles unknown the
    // line above a title is the previous listing's, and the listing's own date still states.
    const summary =
      "Salsa Thursdays\nThursday, October 1 · 8:00 PM\nBachata Night\nMonday, October 5 · 9:00 PM";
    const folded = foldPage(summary);
    expect(dateBesideTitle(folded, "Bachata Night", "2026-10-05", "en").stated).toBe(true);
    expect(dateBesideTitle(folded, "Salsa Thursdays", "2026-10-01", "en").stated).toBe(true);
    expect(contradictingDate(folded, summary, "Bachata Night", "2026-10-05", "en")).toBeNull();
  });
});
