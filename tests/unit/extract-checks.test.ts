// A model read checked against its page (D-070): a stated recurrence keeps its rule over a date
// the page does not write, a date its own phrase contradicts is rejected, a directory's own event
// page is not a ticket link, and a category label names the kind of night. The Stepping Out page is
// saved as the model read it in run 26 (evals/extraction), with the rules it states.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { Metro } from "@/src/adapters/types";
import { familiesOf, rawExtractionSchema, type RawListing } from "@/src/domain/listing";
import { categoryAbove, statesDate, weekdaysNamed } from "@/src/domain/text-facts";
import { extractionToHarvested, recurrenceRule } from "@/src/pipeline/extract";
import {
  dropRuleNightsWithDatedTwin,
  expandRecurrence,
  normalizeListing,
  windowNights,
  type NormalizedEvent,
} from "@/src/pipeline/normalize";

const EVALS = join(__dirname, "../../evals/extraction");
const expected = JSON.parse(
  readFileSync(join(EVALS, "expected/steppingoutstudios-social-events1.json"), "utf8"),
) as {
  url: string;
  states_a_date: boolean;
  listings: Array<{ title: string; recurrence_text: string; rrule: string | null }>;
};
const page = readFileSync(join(EVALS, "pages/steppingoutstudios-social-events1.txt"), "utf8");

const NYC: Metro = {
  id: "m",
  slug: "nyc",
  name: "New York",
  countryCode: "US",
  center: { lat: 40.7128, lng: -74.006 },
  radiusKm: 50,
  tz: "America/New_York",
  languages: ["en"],
};
const TONIGHT = "2026-09-28";
const NOW = new Date("2026-09-28T14:00:00Z");

function reply(listings: Array<Record<string, unknown>>) {
  return rawExtractionSchema.parse({
    page_kind: "list",
    language: "en",
    listings: listings.map((l) => ({
      listing_type: "social",
      styles: [],
      venue: { name: "Stepping Out Studios" },
      organizer: {},
      ...l,
    })),
  });
}

/** Harvested listings to the window's events, the way ingest's `store` does it. */
function nightsOf(harvested: ReturnType<typeof extractionToHarvested>["listings"]) {
  const nights = windowNights(TONIGHT);
  const events: NormalizedEvent[] = [];
  for (const h of harvested) {
    for (const one of expandRecurrence(h, TONIGHT, NYC.tz).listings) {
      const outcome = normalizeListing(one, { metro: NYC, source: { styles: [] }, now: NOW });
      if (outcome.ok && nights.includes(outcome.event.nightDate)) events.push(outcome.event);
    }
  }
  return dropRuleNightsWithDatedTwin(events);
}

const byTitle = (events: NormalizedEvent[], title: string) =>
  events.filter((e) => e.title === title).map((e) => e.nightDate);

describe("the Stepping Out page's rules (evals/extraction)", () => {
  it("reads every phrase the page prints to its rule, and the page states no date", () => {
    for (const l of expected.listings) {
      expect(recurrenceRule(l.recurrence_text, "en"), l.title).toBe(l.rrule);
    }
    expect(expected.states_a_date).toBe(false);
    for (const night of windowNights(TONIGHT, 60))
      expect(statesDate(page, night, "en")).toBe(false);
  });

  it("lists run 26's read on the nights the page states, not the dates the model gave", () => {
    // What the model returned in run 26, as the live pages showed it: every one a dated one-off.
    const run26 = reply([
      {
        title: "Robins Argentine Tango Practica",
        listing_type: "practica",
        local_date: "2026-09-30",
        doors_time: "21:30",
        end_time: "23:30",
        recurrence_text: "Every Thursday",
        evidence: { local_date: "Every Thursday" },
      },
      {
        title: "Paciencia Milonga",
        local_date: "2026-09-28",
        dancing_time: "22:00",
        recurrence_text: "Every Tuesday 9:30pm to 1:30am",
      },
      {
        title: "Tango Y Te",
        local_date: "2026-09-29",
        doors_time: "15:00",
        lesson_time: "15:00",
        dancing_time: "15:00",
        recurrence_text: "Every Sunday",
      },
      {
        title: "Friday Night Fever",
        local_date: "2026-10-01",
        doors_time: "20:30",
        recurrence_text: "Every 1st, 3rd Friday of the month",
      },
    ]);
    for (const pageText of [page, null]) {
      const read = extractionToHarvested(run26, {
        pageUrl: expected.url,
        fetchedAt: NOW,
        today: TONIGHT,
        pageText,
      });
      expect(read.rejected).toEqual([]);
      expect(read.listings.every((h) => h.recurrence !== null)).toBe(true);
      expect(read.notes[0]).toMatch(/^4 listing\(s\) came with a date the page does not state/);
      const events = nightsOf(read.listings);
      expect(byTitle(events, "Robins Argentine Tango Practica")).toEqual([
        "2026-10-01",
        "2026-10-08",
      ]);
      expect(byTitle(events, "Paciencia Milonga")).toEqual(["2026-09-29", "2026-10-06"]);
      expect(byTitle(events, "Tango Y Te")).toEqual(["2026-10-04", "2026-10-11"]);
      expect(byTitle(events, "Friday Night Fever")).toEqual(["2026-10-02"]);
      // The rule's nights are the phrase's: their evidence is the phrase, not the invented date.
      const robins = events.find((e) => e.title === "Robins Argentine Tango Practica")!;
      expect(robins.evidence.local_date).toBeUndefined();
      expect(robins.evidence.recurrence_text).toBe("Every Thursday");
      expect(robins.confirmation).toBe("recurring_unconfirmed");
      // And Tango Y Te is a tango night now (L4).
      const tangoYTe = events.find((e) => e.title === "Tango Y Te")!;
      expect(familiesOf(tangoYTe.styles)).toEqual(["tango"]);
    }
  });
});

describe("a date beside a rule (D-070)", () => {
  const read = (pageText: string, listing: Record<string, unknown>) =>
    extractionToHarvested(reply([{ title: "Salsa Thursdays", doors_time: "21:00", ...listing }]), {
      pageUrl: "https://salsa.example/",
      fetchedAt: NOW,
      today: TONIGHT,
      pageText,
    });

  it("keeps a date the page writes, beside the rule, and lists that night once", () => {
    const result = read("Salsa Thursdays\nEvery Thursday, 9pm\nNext: Thursday, October 1, 2026", {
      local_date: "2026-10-01",
      recurrence_text: "Every Thursday",
    });
    expect(result.listings.map((h) => [h.listing.local_date, h.recurrence?.rrule ?? null])).toEqual(
      [
        [null, "FREQ=WEEKLY;BYDAY=TH"],
        ["2026-10-01", null],
      ],
    );
    const events = nightsOf(result.listings);
    expect(events.map((e) => [e.nightDate, e.fromRule])).toEqual([
      ["2026-10-08", true],
      ["2026-10-01", false],
    ]);
  });

  it("lists each night once when the page repeats the rule beside every date", () => {
    const listings = ["2026-10-01", "2026-10-08"].map((local_date) => ({
      title: "Salsa Thursdays",
      doors_time: "21:00",
      local_date,
      recurrence_text: "every Thursday",
    }));
    const result = extractionToHarvested(reply(listings), {
      pageUrl: "https://salsa.example/",
      fetchedAt: NOW,
      today: TONIGHT,
      pageText: "Salsa Thursdays, every Thursday: October 1 and October 8",
    });
    expect(nightsOf(result.listings).map((e) => [e.nightDate, e.fromRule])).toEqual([
      ["2026-10-01", false],
      ["2026-10-08", false],
    ]);
  });

  it("rejects a date its own phrase contradicts, and keeps the rule", () => {
    const result = read("Salsa Thursdays\nSunday, October 4\nEvery Tuesday", {
      local_date: "2026-10-04",
      recurrence_text: "Every Tuesday",
    });
    expect(result.rejected).toEqual([
      {
        title: "Salsa Thursdays",
        reason:
          'dated 2026-10-04, a Sunday, but the page says "Every Tuesday"; not listed on that date',
      },
    ]);
    expect(result.listings).toHaveLength(1);
    expect(result.listings[0]?.recurrence?.rrule).toBe("FREQ=WEEKLY;BYDAY=TU");
  });

  it("checks a phrase no rule reads by the weekdays it names", () => {
    // Hedged, so no rule: the weekday it names is still the check.
    const phrase = "Most Sundays, weather permitting";
    const tuesday = read(`Salsa Thursdays. ${phrase}`, {
      local_date: "2026-09-29",
      recurrence_text: phrase,
    });
    expect(tuesday.listings).toEqual([]);
    expect(tuesday.rejected[0]?.reason).toMatch(/^dated 2026-09-29, a Tuesday, but the page says/);
    // On a Sunday it may be right, and no rule says otherwise: it is kept as dated.
    const sunday = read(`Salsa Thursdays. ${phrase}`, {
      local_date: "2026-10-04",
      recurrence_text: phrase,
    });
    expect(sunday.rejected).toEqual([]);
    expect(sunday.listings.map((h) => h.listing.local_date)).toEqual(["2026-10-04"]);
  });

  it("lists Jimmy Anton's Sundays by the rule its page states, not the Tuesday the model gave", () => {
    // Run 27 rejected it: the page's "Every 1st, 3rd, and 5th Sunday (if there is one) of the
    // month" did not read as a rule, and the model's Tuesday contradicted it, so it was not listed.
    const phrase = "Every 1st, 3rd, and 5th Sunday (if there is one) of the month";
    const result = read(`Jimmy Anton Salsa Social\nDate: ${phrase}`, {
      title: "Jimmy Anton Salsa Social",
      local_date: "2026-10-06",
      doors_time: "18:00",
      recurrence_text: phrase,
    });
    expect(result.rejected).toEqual([]);
    // The 1st Sunday of October is inside the window; the 3rd (the 18th) is not.
    expect(byTitle(nightsOf(result.listings), "Jimmy Anton Salsa Social")).toEqual(["2026-10-04"]);
  });

  it("reads no rule from a phrase cut to its first weekday, and keeps the dated night", () => {
    const phrases = [
      "Tuesdays 8pm & Thursdays 9pm",
      "Every Monday 7pm, Wednesday 8pm",
      "Every Wednesday, Studio D; Friday, Studio A",
      "Mondays at 7pm and Wednesdays at 8pm",
    ];
    for (const phrase of phrases) expect(recurrenceRule(phrase, "en"), phrase).toBeNull();
    // A cut that keeps every weekday the phrase names still reads.
    expect(recurrenceRule("Every Tuesday 9:30pm to 1:30am", "en")).toBe("FREQ=WEEKLY;BYDAY=TU");
    expect(recurrenceRule("Every Wednesdays, Studio D", "en")).toBe("FREQ=WEEKLY;BYDAY=WE");

    const result = read("Salsa Thursdays\nTuesdays 8pm & Thursdays 9pm", {
      local_date: "2026-10-01",
      recurrence_text: "Tuesdays 8pm & Thursdays 9pm",
    });
    expect(result.rejected).toEqual([]);
    expect(result.listings.map((h) => [h.listing.local_date, h.recurrence])).toEqual([
      ["2026-10-01", null],
    ]);
    expect(nightsOf(result.listings).map((e) => e.nightDate)).toEqual(["2026-10-01"]);
  });

  it("runs an every-other-week rule in step with the date the page writes", () => {
    const result = read("Salsa Thursdays\nEvery other Thursday, 9pm. Next: Thursday, October 8", {
      local_date: "2026-10-08",
      recurrence_text: "Every other Thursday",
    });
    expect(result.listings.map((h) => h.recurrence?.dtstartLocal ?? null)).toEqual([
      "2026-10-08T21:00",
      null,
    ]);
    // October 1 is the week it is off; October 22 is past the window.
    expect(nightsOf(result.listings).map((e) => [e.nightDate, e.fromRule])).toEqual([
      ["2026-10-08", false],
    ]);
  });

  it("leaves a dated listing with no phrase alone when only its own title names a weekday", () => {
    const result = read("Salsa Thursdays", { local_date: "2026-10-02" });
    expect(result.listings.map((h) => [h.listing.local_date, h.recurrence])).toEqual([
      ["2026-10-02", null],
    ]);
  });
});

describe("reading a date on a page", () => {
  it("finds the forms a page writes a date in, and not a neighbour", () => {
    const yes = [
      "Thursday, October 1, 2026",
      "Oct 1st at 9pm",
      "Oct. 1",
      "1 October",
      "the 1st of October",
      "10/1",
      "10/01/2026",
      "1/10/2026",
      "01.10.",
      "2026-10-01",
    ];
    for (const text of yes) expect(statesDate(text, "2026-10-01", "en"), text).toBe(true);
    const no = [
      "October 10",
      "Oct 11",
      "11/10",
      "10/12",
      "Every Thursday",
      "Oct 1:30",
      "2026-10-11",
    ];
    for (const text of no) expect(statesDate(text, "2026-10-01", "en"), text).toBe(false);
    expect(statesDate("jeudi 1er octobre", "2026-10-01", "fr")).toBe(true);
    expect(statesDate("1. Oktober", "2026-10-01", "de")).toBe(true);
    expect(statesDate("1 de octubre", "2026-10-01", "es")).toBe(true);
  });

  it("does not take a date stated in another year for this one (D-074)", () => {
    const no = [
      "October 1, 2020",
      "Thursday, October 1st 2020 at 8pm",
      "Posted 10/1/2019",
      "Posted 10/1/19",
      "1 October 2020",
      "01.10.2020",
      "2020-10-01",
    ];
    for (const text of no) expect(statesDate(text, "2026-10-01", "en"), text).toBe(false);
    const yes = [
      "October 1, 2026",
      "10/1/26",
      "1 October 2026",
      // Another date's year does not stand for this one.
      "October 1 and November 5, 2020",
      // A year that is an older post's, with this date written again without one.
      "Posted October 1, 2020. Next social: October 1 at 8pm",
      // A clock time after the date is not a year.
      "Oct 1 1930h",
    ];
    for (const text of yes) expect(statesDate(text, "2026-10-01", "en"), text).toBe(true);
  });

  it("names the weekdays a phrase names, and not a word that only looks like one", () => {
    expect([...weekdaysNamed("Every 1st, 3rd, and 5th Sunday")]).toEqual(["SU"]);
    expect([...weekdaysNamed("Tuesdays and Thursdays")]).toEqual(["TU", "TH"]);
    expect([...weekdaysNamed("Sun and Sat")]).toEqual([]);
    expect([...weekdaysNamed("tous les mardis", "fr")]).toEqual(["TU"]);
  });
});

describe("a directory's own page for an event is not a ticket link (D-070)", () => {
  const ronda = (ticket: string, directory = true) =>
    extractionToHarvested(
      reply([{ title: "Tango Cafe", local_date: "2026-09-30", ticket_url: ticket }]),
      {
        pageUrl: "https://www.theronda.us/nyc",
        fetchedAt: NOW,
        today: TONIGHT,
        pageText: null,
        directory,
      },
    );

  it("keeps it as the event's page, and a real ticket link as tickets", () => {
    const own = ronda("https://www.theronda.us/event/tango-cafe-2026-09-30-74420121");
    expect(own.listings[0]?.listing.ticket_url).toBeNull();
    expect(own.listings[0]?.eventUrl).toBe(
      "https://www.theronda.us/event/tango-cafe-2026-09-30-74420121",
    );
    expect(own.notes).toEqual([
      "1 listing(s) linked this site's own page for the event: kept as the event page, not as tickets",
      "the page's text is no longer stored, so this read was not checked against it (titles, recurrences, links): kept as read, with the event pages stored before",
    ]);
    const outside = ronda("https://www.eventbrite.com/e/pasion-milonguera-123");
    expect(outside.listings[0]?.listing.ticket_url).toBe(
      "https://www.eventbrite.com/e/pasion-milonguera-123",
    );
    expect(outside.listings[0]?.eventUrl).toBeUndefined();
    // A first-party site's own ticket page may sell tickets: left alone.
    const studio = ronda("https://www.theronda.us/tickets/42", false);
    expect(studio.listings[0]?.listing.ticket_url).toBe("https://www.theronda.us/tickets/42");
    // The page itself is never a ticket link.
    expect(ronda("https://theronda.us/nyc/", false).listings[0]?.listing.ticket_url).toBeNull();
  });
});

describe("a category label over the title (D-070)", () => {
  // The Ronda's layout: the category on its own line, then the title with its link.
  const rondaPage = [
    "Tango Events in New York City",
    "",
    "Wednesday, September 30, 2026",
    "",
    "milonga",
    "",
    "Tango Cafe [https://www.theronda.us/event/tango-cafe-2026-09-30-74420121]",
    "",
    "🕐 3:00 PM",
    "",
    // The page lists each night under its own date (D-074 checks a dated listing against it).
    "Thursday, October 1, 2026",
    "",
    "milonga",
    "",
    "Tango la Nacional [https://www.theronda.us/event/tango-la-nacional-2026-10-01-d7f214bd]",
    "",
    "class",
    "",
    "Beginner Tango [https://www.theronda.us/event/beginner-tango]",
  ].join("\n");

  it("reads only a line that is a category word and nothing else", () => {
    expect(categoryAbove(rondaPage, "Tango Cafe")).toEqual({ type: "social", label: "milonga" });
    expect(categoryAbove(rondaPage, "Beginner Tango")).toEqual({ type: "class", label: "class" });
    expect(categoryAbove(rondaPage, "Not on the page")).toBeNull();
    expect(categoryAbove("Tango Events in New York City\nTango Cafe", "Tango Cafe")).toBeNull();
  });

  it("gives an 'other' or a class the page files as a milonga the page's kind", () => {
    const read = extractionToHarvested(
      reply([
        { title: "Tango Cafe", listing_type: "other", local_date: "2026-09-30" },
        { title: "Tango la Nacional", listing_type: "class", local_date: "2026-10-01" },
        { title: "Beginner Tango", listing_type: "other", local_date: "2026-10-01" },
      ]),
      {
        pageUrl: "https://www.theronda.us/nyc",
        fetchedAt: NOW,
        today: TONIGHT,
        pageText: rondaPage,
      },
    );
    expect(read.listings.map((h) => h.listing.listing_type)).toEqual(["social", "social", "class"]);
    expect(read.listings[0]?.listing.evidence.listing_type).toBe("milonga");
  });

  it("leaves a stated kind other than 'other' or class alone, and a class the title calls one", () => {
    const read = extractionToHarvested(
      reply([
        { title: "Tango Cafe", listing_type: "practica", local_date: "2026-09-30" },
        { title: "Tango Cafe class", listing_type: "class", local_date: "2026-10-01" },
      ]),
      {
        pageUrl: "https://www.theronda.us/nyc",
        fetchedAt: NOW,
        today: TONIGHT,
        pageText: `${rondaPage}\n\nmilonga\n\nTango Cafe class`,
      },
    );
    expect(read.listings.map((h) => h.listing.listing_type)).toEqual(["practica", "class"]);
  });
});

describe("a date the page's weekday contradicts, with no rule (D-078)", () => {
  // Run 28: Stepping Out writes "Every Sunday" under Tango Y Te; the model gave it today's date
  // and no rule, so it was listed on a Tuesday at 3pm and its Sundays were retired.
  const page = [
    "Paciencia Milonga",
    "",
    "Date: Every Tuesday - Time: 9:30pm – 1:30am",
    "",
    "Tango Y Te",
    "",
    "Date: Every Sunday - Time: 3:00pm – 6:00 pm",
    "",
    "Description: Join host Maria Jose Sosa in a relaxed atmosphere.",
  ].join("\n");
  const read = (listings: Array<Record<string, unknown>>) =>
    extractionToHarvested(reply(listings), {
      pageUrl: "https://www.steppingoutstudios.com/social-events1",
      fetchedAt: NOW,
      today: TONIGHT,
      pageText: page,
    });

  it("drops the date, and lists the night by the rule the page writes after the title", () => {
    const result = read([
      { title: "Paciencia Milonga", recurrence_text: "Every Tuesday", dancing_time: "21:30" },
      { title: "Tango Y Te", local_date: "2026-09-29", dancing_time: "15:00" },
    ]);
    expect(result.rejected).toEqual([
      {
        title: "Tango Y Te",
        reason:
          "dated 2026-09-29, a Tuesday, but the page gives Sunday beside it; not listed on that date",
      },
    ]);
    const tango = result.listings.filter((h) => h.listing.title === "Tango Y Te");
    expect(tango).toHaveLength(1);
    expect(tango[0]?.listing.local_date).toBeNull();
    expect(tango[0]?.recurrence?.rrule).toBe("FREQ=WEEKLY;BYDAY=SU");
    expect(byTitle(nightsOf(result.listings), "Tango Y Te")).toEqual(["2026-10-04", "2026-10-11"]);
    expect(result.notes.join("\n")).toMatch(/listed by the rule the page writes after the title/);
  });

  it("keeps a date the page itself writes, and a date on the weekday it gives", () => {
    const dated = extractionToHarvested(
      reply([{ title: "Tango Y Te", local_date: "2026-09-29", dancing_time: "15:00" }]),
      {
        pageUrl: "https://www.steppingoutstudios.com/social-events1",
        fetchedAt: NOW,
        today: TONIGHT,
        pageText: `${page}\nSpecial edition: Tango Y Te on Tuesday, September 29`,
      },
    );
    expect(dated.rejected).toEqual([]);
    expect(dated.listings[0]?.listing.local_date).toBe("2026-09-29");
    const sunday = read([{ title: "Tango Y Te", local_date: "2026-10-04", dancing_time: "15:00" }]);
    expect(sunday.rejected).toEqual([]);
    expect(sunday.listings[0]?.listing.local_date).toBe("2026-10-04");
  });

  it("leaves a date alone when the page names no weekday beside the title", () => {
    const plain = extractionToHarvested(
      reply([{ title: "Salsa Social", local_date: "2026-09-29", doors_time: "21:00" }]),
      {
        pageUrl: "https://salsa.example/",
        fetchedAt: NOW,
        today: TONIGHT,
        pageText: "Salsa Social\n9pm, $10, all levels",
      },
    );
    expect(plain.rejected).toEqual([]);
    expect(plain.listings[0]?.listing.local_date).toBe("2026-09-29");
  });

  it("does not list the date when the page's weekday has no rule to fall back on", () => {
    const noRule = extractionToHarvested(
      reply([{ title: "Blues Night", local_date: "2026-09-29", doors_time: "21:00" }]),
      {
        pageUrl: "https://blues.example/",
        fetchedAt: NOW,
        today: TONIGHT,
        pageText: "Blues Night\nSundays at the loft, 9pm",
      },
    );
    expect(noRule.listings).toEqual([]);
    expect(noRule.rejected[0]?.reason).toMatch(/a Tuesday, but the page gives Sunday beside it/);
  });
});

describe("a model's word for nothing is unknown (run 28)", () => {
  it("reads recurrence_text 'null', 'None' and 'N/A' as no rule", () => {
    for (const nothing of ["null", "None", " N/A ", "undefined"]) {
      const parsed = reply([{ title: "Salsa Groove", recurrence_text: nothing }]);
      expect(parsed.listings[0]?.recurrence_text).toBeNull();
    }
  });
});

describe("times checked against the listing's own words (D-081)", () => {
  // Tuesday 2026-09-29, noon in New York: run 30 read Stepping Out from the extraction cache.
  const RUN30_TODAY = "2026-09-29";
  const RUN30_NOW = new Date("2026-09-29T16:00:00Z");
  const LINK_PAGES = join(__dirname, "../../evals/links/pages");
  const linkPage = (name: string) => readFileSync(join(LINK_PAGES, `${name}.txt`), "utf8");

  /** [doors, lesson, dancing, end] */
  type Times = [string | null, string | null, string | null, string | null];
  const timesOf = ({ listing }: { listing: RawListing }): Times => [
    listing.doors_time,
    listing.lesson_time,
    listing.dancing_time,
    listing.end_time,
  ];
  const withTimes = ([doors_time, lesson_time, dancing_time, end_time]: Times) => ({
    doors_time,
    lesson_time,
    dancing_time,
    end_time,
  });

  // Run 30's read, as the live site showed it on 2026-09-29.
  const RUN30 = [
    {
      title: "Friday Night Fever",
      recurrence_text: "Every 1st, 3rd Friday of the month",
      dancing_time: "20:30",
      end_time: "23:30",
    },
    {
      title: "All Night Milonga",
      recurrence_text: "Every 2nd & last Saturday",
      dancing_time: "22:00",
      end_time: "04:00",
    },
    {
      title: "Robins Argentine Tango Practica",
      listing_type: "practica",
      recurrence_text: "Every Thursday",
      dancing_time: "21:30",
      end_time: "23:30",
    },
    {
      title: "Noche De Descarga",
      recurrence_text: "Every 3rd Saturday of the month",
      dancing_time: "22:00",
      end_time: "03:00",
    },
    {
      title: "Bachata Rosa",
      recurrence_text: "Every Friday night",
      lesson_time: "10:00",
      dancing_time: "22:00",
      end_time: "03:00",
    },
    {
      title: "Zen Zouk",
      recurrence_text: "Every Wednesdays, Studio D",
      dancing_time: "21:30",
      end_time: "01:00",
    },
    {
      title: "Paciencia Milonga",
      recurrence_text: "Every Tuesday 9:30pm to 1:30am",
      dancing_time: "21:30",
      end_time: "01:30",
    },
    {
      title: "La Vieja Guardia Salsa",
      recurrence_text: "Every 2nd & 4th Sunday of the month",
      dancing_time: "18:00",
      end_time: "22:00",
    },
    {
      title: "Tango Y Te",
      listing_type: "class",
      local_date: "2026-09-29",
      lesson_time: "15:00",
      end_time: "18:00",
    },
    {
      title: "Ballroom and Smooth Practice",
      listing_type: "class",
      recurrence_text: "Every Tuesday",
      lesson_time: "21:30",
      dancing_time: "22:30",
    },
    {
      title: "Toda La Noche, Salsa Social",
      recurrence_text: "Every 1st Saturday of the Month",
      doors_time: "22:00",
      dancing_time: "23:00",
      end_time: "03:00",
    },
    {
      title: "Jimmy Anton Salsa Social",
      recurrence_text: "Every 1st, 3rd, and 5th Sunday (if there is one) of the month",
      doors_time: "18:00",
      dancing_time: "22:00",
      end_time: "22:00",
    },
  ];

  it("reads run 30's Stepping Out times as the page gives them", () => {
    const read = extractionToHarvested(reply(RUN30), {
      pageUrl: expected.url,
      fetchedAt: RUN30_NOW,
      today: RUN30_TODAY,
      pageText: page,
    });
    // Tango Y Te's date is D-078's to reject; its Sundays are listed by the page's rule.
    expect(read.rejected.map((r) => r.title)).toEqual(["Tango Y Te"]);
    const got = Object.fromEntries(
      read.listings.map((h) => [
        h.listing.title,
        [...timesOf(h), h.recurrence?.dtstartLocal ?? null],
      ]),
    );
    expect(got).toEqual({
      "Friday Night Fever": [null, null, "20:30", null, "2026-09-29T20:30"],
      "All Night Milonga": [null, null, "22:00", "04:00", "2026-09-29T22:00"],
      "Robins Argentine Tango Practica": [null, null, "21:30", "23:30", "2026-09-29T21:30"],
      "Noche De Descarga": [null, null, "22:00", "03:00", "2026-09-29T22:00"],
      "Bachata Rosa": [null, "22:00", null, "03:00", "2026-09-29T22:00"],
      "Zen Zouk": [null, null, "21:30", "01:00", "2026-09-29T21:30"],
      "Paciencia Milonga": [null, null, "21:30", "01:30", "2026-09-29T21:30"],
      "La Vieja Guardia Salsa": [null, null, "18:00", "22:00", "2026-09-29T18:00"],
      "Tango Y Te": [null, null, "15:00", "18:00", "2026-09-29T15:00"],
      "Ballroom and Smooth Practice": [null, null, "21:30", "22:30", "2026-09-29T21:30"],
      "Toda La Noche, Salsa Social": [null, null, "22:00", "03:00", "2026-09-29T22:00"],
      "Jimmy Anton Salsa Social": [null, null, "18:00", "22:00", "2026-09-29T18:00"],
    });
    // The date note stays first; the time notes follow, one line per kind of change.
    expect(read.notes).toEqual([
      '1 listing(s) came dated on a weekday the page contradicts, and no rule: listed by the rule the page writes after the title: Tango Y Te ("Every Sunday")',
      "1 listing(s) came with a time their part of the page does not write; dropped: Toda La Noche, Salsa Social (dancing 23:00)",
      "1 listing(s) came with the end of a range as a start; read as the end: Ballroom and Smooth Practice (22:30)",
      // Its end was read as 22:00 already: the start's 22:00 goes.
      '1 listing(s) came with the end of a range, or a time after "until", as a start; dropped: Jimmy Anton Salsa Social (22:00)',
      "1 listing(s) came with am or pm the page does not write; read as the page writes it: Bachata Rosa (lesson 10:00 is 22:00)",
      "5 listing(s) came with a time the page's words beside it give another name; moved: Bachata Rosa (dancing 22:00 to the lesson); Tango Y Te (lesson 15:00 to the start); Ballroom and Smooth Practice (lesson 21:30 to the start); Toda La Noche, Salsa Social (doors 22:00 to the start); Jimmy Anton Salsa Social (doors 18:00 to the start)",
      "1 listing(s) came with an end the page writes more than 12 hours after the start; end not listed: Friday Night Fever (11:30)",
    ]);
    // A moved time's evidence is the page's own clause.
    const ballroom = read.listings.find((h) => h.listing.title === "Ballroom and Smooth Practice");
    expect(ballroom?.listing.evidence.dancing_time).toBe("Time: 9:30pm-10:30pm");
    expect(read.listings.some((h) => h.timesWithdrawn)).toBe(false);
  });

  // This Week in Swing's titles, as a read of the saved page gives them.
  const TWIS_TITLES = [
    "Back Room Speakeasy Sessions",
    "Midtown Swings",
    "White Heat",
    "Josh Lee and the Extended Family",
    "Gotham Jazz",
    "Frim Fram Jam",
    "Big Band Swing Concert",
    "Swing Remix",
    "Glenn Crytzer Quintet at Jaywalker",
    "Central Park Swings",
    "Sock Hop Sundays",
    "Positively Swingin",
    "NYLX",
    "New York Lindy Exchange",
    "Lindyland Dance Party",
    "Swing Night at Pangea",
    "Street Dance! FREE Lesson and Dance Social",
    "Terra Blues Meet-up",
    "Swing ance / Practice Session",
    "Dancing at Young Ethels",
  ];
  const TITLES: Record<string, readonly string[]> = {
    "thisweekinswingnyc-com": TWIS_TITLES,
    "theronda-us-nyc": [
      "Los Tres Amigos Milonga",
      "Tango Cafe",
      "Tango la Nacional",
      "Pasion Milonguera",
      "Esa! Milonga",
      "Victoria's Practica",
    ],
    "nycswings-net": [
      "West Coast Swing with Jes Ann Nail",
      "Class West Coast Swing with Jes Ann Nail",
      "Social Dance Flow Fridays",
      "Midtown Swings – Weekly Swing Dance Party",
      "House of West – NYC’s Weekly West Coast Swing Party",
      "Soul Sunday: West Coast Swing Social",
      "Intro to West Coast Swing: Beginner Class at House of West",
      "Lindy Hop Guided Practice with Midtown Swings",
    ],
    "frimframjam-com": [
      "Oct 1 - DJs Tomo Tanaka & Heather Flock",
      "NYLX Warmup w/ DJs TJ Savino & Claire Lorman",
      "Third Thursdays w/ Eyal Vilner",
      "DJs Molly Meng & Ryan Swift",
      "Frim Fram Jam",
    ],
    "brooklyncontra-org": [
      "Contra Connections 2: An Intermediate Contra Dance Workshop",
      "A Contra Dance for All!",
      "A Barn Dance in Battery Park City!",
      "Five Borough Fling",
    ],
    "sobs-com-calendar": [
      "Salsa Groove: Dance Class & Happy Hour",
      "Sounds of Bollywood: Desi Saturdays",
      "POLENTA",
      "DAY26 & J. Howell",
      "The Art of Muzic",
      "Chow Lee Album Release Show",
    ],
  };

  /** A read of a saved page: these dated listings, and the page's other titles with nothing more. */
  function readOf(name: string, dated: Array<[string, string, Times]>) {
    const listed = new Set(dated.map(([title]) => title));
    return extractionToHarvested(
      reply([
        ...dated.map(([title, local_date, times]) => ({ title, local_date, ...withTimes(times) })),
        ...TITLES[name]!.filter((title) => !listed.has(title)).map((title) => ({ title })),
      ]),
      {
        pageUrl: `https://${name}.example/`,
        fetchedAt: NOW,
        today: TONIGHT,
        pageText: linkPage(name),
      },
    );
  }
  const timesOn = (read: ReturnType<typeof readOf>, title: string, date: string) =>
    read.listings
      .filter((h) => h.listing.title === title && h.listing.local_date === date)
      .map(timesOf);

  it("drops a time only a neighbour's part writes", () => {
    const read = readOf("thisweekinswingnyc-com", [
      // The Back Room's "9pm-12:30am" and another night's end, not Midtown Swings'.
      ["Midtown Swings", "2026-09-29", [null, "21:00", null, "00:30"]],
      ["Midtown Swings", "2026-10-06", [null, "21:00", null, "23:00"]],
      // "6:00pm – 7:00pm: Dance Lesson / 7:00pm – 8:00pm: Concert".
      ["Big Band Swing Concert", "2026-10-02", ["18:00", "19:00", null, "20:00"]],
    ]);
    expect(timesOn(read, "Midtown Swings", "2026-09-29")).toEqual([[null, "21:00", null, null]]);
    expect(timesOn(read, "Midtown Swings", "2026-10-06")).toEqual([[null, "21:00", null, null]]);
    expect(timesOn(read, "Big Band Swing Concert", "2026-10-02")).toEqual([
      [null, "18:00", "19:00", "20:00"],
    ]);
    expect(read.notes).toContain(
      "2 listing(s) came with a time their part of the page does not write; dropped: Midtown Swings (end 00:30); Midtown Swings (end 23:00)",
    );
  });

  it("keeps every time a correct reading of the saved pages gives", () => {
    // Hand readings of every timed entry the saved pages write in the window, and the live rows
    // that were right. Each is read with its page's other titles, so each part ends at the next.
    const readings: Record<string, Array<[string, string, Times]>> = {
      "thisweekinswingnyc-com": [
        ["Back Room Speakeasy Sessions", "2026-09-28", ["19:30", null, "21:00", "00:30"]],
        ["Midtown Swings", "2026-09-29", [null, "21:00", "21:00", "00:00"]],
        ["White Heat", "2026-09-29", [null, null, "21:00", "23:30"]],
        ["Josh Lee and the Extended Family", "2026-09-30", [null, "17:20", "17:00", "18:15"]],
        ["Gotham Jazz", "2026-09-30", [null, null, "17:00", "23:00"]],
        ["Frim Fram Jam", "2026-10-01", [null, "20:30", "21:00", "00:00"]],
        ["Big Band Swing Concert", "2026-10-02", [null, "18:00", "19:00", "20:00"]],
        ["Swing Remix", "2026-10-03", ["19:45", "20:00", "20:30", "23:30"]],
        ["Glenn Crytzer Quintet at Jaywalker", "2026-10-04", [null, null, "18:00", "21:00"]],
        ["Central Park Swings", "2026-10-04", [null, null, "16:00", "18:30"]],
        ["Sock Hop Sundays", "2026-10-04", ["17:30", null, "18:00", "22:00"]],
        ["Positively Swingin", "2026-10-07", [null, "19:30", "20:00", "22:00"]],
        ["Frim Fram Jam", "2026-10-08", [null, "20:30", "21:00", "00:00"]],
        ["New York Lindy Exchange", "2026-10-10", [null, null, "20:00", "01:00"]],
        ["New York Lindy Exchange", "2026-10-11", [null, null, "19:00", "00:30"]],
        ["Swing Night at Pangea", "2026-10-13", [null, "19:00", "20:00", "22:00"]],
      ],
      "theronda-us-nyc": [
        ["Victoria's Practica", "2026-10-03", [null, "14:30", null, null]],
        ["Tango Cafe", "2026-09-30", ["15:00", null, null, null]],
      ],
      "nycswings-net": [
        ["West Coast Swing with Jes Ann Nail", "2026-09-30", [null, "19:00", null, null]],
        ["Class West Coast Swing with Jes Ann Nail", "2026-09-30", [null, "19:00", null, null]],
        ["Social Dance Flow Fridays", "2026-10-30", [null, null, "20:30", null]],
      ],
      "frimframjam-com": [
        ["NYLX Warmup w/ DJs TJ Savino & Claire Lorman", "2026-10-08", [null, null, "21:00", null]],
        [
          "NYLX Warmup w/ DJs TJ Savino & Claire Lorman",
          "2026-10-08",
          [null, "20:30", "21:00", null],
        ],
        ["Oct 1 - DJs Tomo Tanaka & Heather Flock", "2026-10-01", [null, "20:30", "21:00", null]],
      ],
      "brooklyncontra-org": [
        ["A Contra Dance for All!", "2026-10-04", [null, "16:30", "17:00", "20:00"]],
        ["A Contra Dance for All!", "2026-10-18", [null, "16:30", "17:00", "20:30"]],
        [
          "Contra Connections 2: An Intermediate Contra Dance Workshop",
          "2026-10-04",
          [null, "12:00", null, "15:00"],
        ],
      ],
      "sobs-com-calendar": [
        ["Salsa Groove: Dance Class & Happy Hour", "2026-10-02", [null, "18:00", null, null]],
        ["Sounds of Bollywood: Desi Saturdays", "2026-10-03", [null, null, "23:00", null]],
      ],
    };
    for (const [name, dated] of Object.entries(readings)) {
      for (const [title, date, times] of dated) {
        const read = readOf(name, [[title, date, times]]);
        // The Ronda's "🕐 3:00 PM" has no doors word beside it: the start, not the doors.
        const want: Times = title === "Tango Cafe" ? [null, null, "15:00", null] : times;
        expect(timesOn(read, title, date), `${name}: ${title} on ${date}`).toEqual([want]);
      }
    }
  });

  it("keeps the eval's expected Stepping Out times as they are", () => {
    // evals/extraction/expected names a start with no word beside it as the dancing time.
    // Its `rrule` is the parser's, not the model's: the reply's schema leaves it out.
    const listings: Array<Record<string, unknown>> = expected.listings;
    const read = extractionToHarvested(reply(listings), {
      pageUrl: expected.url,
      fetchedAt: RUN30_NOW,
      today: RUN30_TODAY,
      pageText: page,
    });
    expect(read.listings.map(timesOf)).toEqual(
      listings.map((l) => timesOf({ listing: reply([l]).listings[0]! })),
    );
    expect(read.notes.join("\n")).not.toMatch(/listing\(s\) came with/);
  });

  it("leaves the times as read when the page's text is not in hand", () => {
    const read = extractionToHarvested(reply([RUN30[9]!]), {
      pageUrl: expected.url,
      fetchedAt: RUN30_NOW,
      today: RUN30_TODAY,
      pageText: null,
    });
    expect(read.listings.map(timesOf)).toEqual([[null, "21:30", "22:30", null]]);
    expect(read.notes.join("\n")).not.toMatch(/listing\(s\) came with/);
  });
});
