// A listing's own link on the page it was read from (D-073): the matcher, the dates a URL carries,
// the links a page carries, and the matcher's scores on the pages it was tuned on and on pages it
// was not (evals/links).

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { HELD_OUT, HELD_OUT_REAL_PAGES } from "@/evals/links/heldout";
import { looksLikeEventPage } from "@/src/domain/event-links";
import {
  carriesDate,
  dateOrderFor,
  findEventLinks,
  isSeriesLink,
  linkKey,
  pageLinks,
  sameLink,
  stripTracking,
  urlDates,
  type FindLinksOptions,
  type LinkQuery,
} from "@/src/domain/event-link-matcher";
import { cleanPageText } from "@/src/pipeline/clean";

const LINKS = join(__dirname, "../../evals/links");
const pageText = (name: string) => readFileSync(join(LINKS, "pages", `${name}.txt`), "utf8");
const tuned = JSON.parse(readFileSync(join(LINKS, "tuned.json"), "utf8")) as {
  pages: Record<string, string>;
  cases: Array<LinkQuery & { page: string; expect: string | null; alt?: string }>;
};

const US: FindLinksOptions = { lang: "en", dateOrder: "mdy" };
const one = (text: string, url: string, query: LinkQuery, options: FindLinksOptions = US) =>
  findEventLinks(text, url, [query], options)[0]!;

describe("the dates a URL carries (B3)", () => {
  it("reads ISO, compact and slashed dates", () => {
    expect(urlDates("https://www.theronda.us/event/tango-cafe-2026-09-30-74420121", "mdy")).toEqual(
      { dates: ["2026-09-30"], unread: false },
    );
    expect(urlDates("https://frimframjam.com/calendar/20261001", "mdy").dates).toEqual([
      "2026-10-01",
    ]);
    expect(urlDates("https://blog.example/2026/09/21/harlem-review/", null).dates).toEqual([
      "2026-09-21",
    ]);
    expect(urlDates("https://www.nycswings.net/e/flow-fridays/", "mdy")).toEqual({
      dates: [],
      unread: false,
    });
  });

  it("reads n-n-yy and n-n-yyyy in the metro's order, and Ticketmaster's dated path", () => {
    const sobs = "https://sobs.com/events/sounds-of-bollywood-desi-saturdays-10-3-26/";
    expect(urlDates(sobs, "mdy").dates).toEqual(["2026-10-03"]);
    expect(urlDates(sobs, "dmy").dates).toEqual(["2026-03-10"]);
    const tm =
      "https://www.ticketmaster.com/jigitz-brooklyn-new-york-10-02-2026/event/000064BDD0EBAA37";
    expect(urlDates(tm, "mdy").dates).toEqual(["2026-10-02"]);
  });

  it("leaves an ambiguous numeric date unread where the order is not known", () => {
    expect(urlDates("https://x.example/events/salsa-3-10-26", null)).toEqual({
      dates: [],
      unread: true,
    });
    // One reading only: 25 is not a month.
    expect(urlDates("https://x.example/events/salsa-25-10-26", null).dates).toEqual(["2026-10-25"]);
    expect(urlDates("https://x.example/events/salsa-10-10-26", null).dates).toEqual(["2026-10-10"]);
    expect(carriesDate("https://x.example/events/salsa-3-10-26")).toBe(true);
  });

  it("reads month names, with or without a year", () => {
    expect(urlDates("https://x.example/e/party-sept-25-2026", "mdy").dates).toEqual(["2026-09-25"]);
    expect(
      urlDates(
        "https://www.eventbrite.com/e/spooky-jazz-gin-a-speakeasy-soiree-oct-30th-tickets-1996645978871",
        "mdy",
      ).dates,
    ).toEqual(["XXXX-10-30"]);
    // Words that start like a month are not one.
    expect(carriesDate("https://x.example/events/market-12-night")).toBe(false);
    expect(carriesDate("https://x.example/events/mardi-gras-ball")).toBe(false);
  });

  it("reads one-digit ISO parts, a slashed n/n/yyyy, n-n with no year and 'oct2' (review #14)", () => {
    expect(urlDates("https://s.example/events/salsa-social/2026-10-2", "mdy").dates).toEqual([
      "2026-10-02",
    ]);
    expect(urlDates("https://s.example/events/salsa-social/2026/10/2", null).dates).toEqual([
      "2026-10-02",
    ]);
    expect(urlDates("https://s.example/events?date=10/02/2026", "mdy").dates).toEqual([
      "2026-10-02",
    ]);
    expect(urlDates("https://s.example/events?date=10/02/2026", null)).toEqual({
      dates: [],
      unread: true,
    });
    expect(urlDates("https://s.example/events/salsa-10-02", "mdy").dates).toEqual(["XXXX-10-02"]);
    expect(urlDates("https://s.example/events/salsa-10-02", "dmy").dates).toEqual(["XXXX-02-10"]);
    expect(urlDates("https://s.example/e/salsa-oct2", "mdy").dates).toEqual(["XXXX-10-02"]);
    // Not dates: an id after a month's letters, a time after an ISO date, a version.
    expect(urlDates("https://s.example/e/party-dec12ab", "mdy").dates).toEqual([]);
    expect(
      urlDates("https://s.example/event-details/kiz-night-2026-10-03-20-00", "mdy").dates,
    ).toEqual(["2026-10-03"]);
    expect(carriesDate("https://s.example/e/salsa-v1-2")).toBe(false);
  });

  it("takes the order from the metro's country", () => {
    expect(dateOrderFor("US")).toBe("mdy");
    expect(dateOrderFor("GB")).toBe("dmy");
    expect(dateOrderFor("CA")).toBeNull();
    expect(dateOrderFor(null)).toBeNull();
  });
});

describe("a 'time · place · venue' row prefix (Our Philly)", () => {
  const text = `Sunday · November 1

1pm · University City · Penn Live Arts Arts of India Festival Community Day [https://www.ourphilly.org/events/arts-of-india-festival-community-day-2026-11-01]

1pm · Rittenhouse · Rittenhouse Square Rittenhop Weekly Social Dance Every Sunday at 1:00 p.m. in Rittenhouse [https://www.ourphilly.org/events/rittenhop-weekly-social-dance]

Saturday · October 31

80’s & 90’s Halloween Dance Party [https://www.ourphilly.org/events/80-s-and-90-s-halloween-dance-party-2026-10-31] 1pm · Point Breeze Broad Street Boogie: Halloween Edition [https://www.ourphilly.org/events/broad-street-boogie-halloween-edition-2026-10-31] 3pm · University City · Penn Live Arts West Philly Swingers [https://www.ourphilly.org/events/pennlivearts-west-philly-swingers-2026-10-31-150000]

9pm · Callowhill · The Rail Park Dance on the Park with Siempre Salsa [https://www.ourphilly.org/events/dance-on-the-park-with-siempre-salsa-2026-10-31]`;

  const queries = [
    { title: "Rittenhop Weekly Social Dance", date: "2026-11-01" },
    { title: "Broad Street Boogie: Halloween Edition", date: "2026-10-31" },
    { title: "Dance on the Park with Siempre Salsa", date: "2026-10-31" },
    { title: "West Philly Swingers", date: "2026-10-31" },
    { title: "80’s & 90’s Halloween Dance Party", date: "2026-10-31" },
  ];

  const results = findEventLinks(text, "https://www.ourphilly.org/tags/dance", queries, US);

  it("gives Broad Street Boogie: Halloween Edition its link", () => {
    expect(results[1]!.url).toBe(
      "https://www.ourphilly.org/events/broad-street-boogie-halloween-edition-2026-10-31",
    );
  });

  it("gives Dance on the Park with Siempre Salsa its link", () => {
    expect(results[2]!.url).toBe(
      "https://www.ourphilly.org/events/dance-on-the-park-with-siempre-salsa-2026-10-31",
    );
  });

  it("gives West Philly Swingers its link", () => {
    expect(results[3]!.url).toBe(
      "https://www.ourphilly.org/events/pennlivearts-west-philly-swingers-2026-10-31-150000",
    );
  });

  it("gives 80’s & 90’s Halloween Dance Party its link", () => {
    expect(results[4]!.url).toBe(
      "https://www.ourphilly.org/events/80-s-and-90-s-halloween-dance-party-2026-10-31",
    );
  });

  it("still rejects a non-dotted long lead", () => {
    const text =
      "Friday\n\nJoin us for a long talk about many things at the hall and then Some Dance Night [https://example.org/events/x]";
    const result = findEventLinks(
      text,
      "https://example.org/list",
      [{ title: "Some Dance Night", date: null }],
      US,
    );
    expect(result[0]!.url).toBeNull();
  });
});

describe("a rule's link (B2)", () => {
  it("is a series page, never one night's", () => {
    expect(isSeriesLink("https://www.nycswings.net/e/flow-fridays/")).toBe(true);
    expect(isSeriesLink("https://www.theronda.us/event/tango-cafe-2026-09-30-74420121")).toBe(
      false,
    );
    // A ticket seller's page sells one night, with or without a date in its path.
    expect(isSeriesLink("https://www.eventbrite.com/e/salsa-night-tickets-123456789")).toBe(false);
    expect(isSeriesLink("https://www.ticketmaster.com/event/Z7r9jZ1AAv8at")).toBe(false);
    // An event platform's page is one night's too (review #18).
    expect(isSeriesLink("https://www.facebook.com/events/123456789012345/")).toBe(false);
  });

  it("is never a URL whose date is written in a less common form (review #14)", () => {
    for (const url of [
      "https://s.example/events/salsa-social/2026-10-2",
      "https://s.example/events/salsa-social/2026/10/2",
      "https://s.example/events/salsa-10-02",
      "https://s.example/events?date=10/02/2026",
      "https://s.example/e/salsa-oct2",
    ]) {
      expect(isSeriesLink(url), url).toBe(false);
    }
  });
});

describe("the links a page carries", () => {
  it("reads the links cleanPageText writes and URLs printed as text", () => {
    const text =
      "Salsa Night [https://salsa.example/events/salsa-night]\nTickets: https://tix.example/salsa.\n(see https://salsa.example/faq)";
    expect(pageLinks(text)).toEqual([
      "https://salsa.example/events/salsa-night",
      "https://tix.example/salsa",
      "https://salsa.example/faq",
    ]);
  });

  it("compares links without scheme, www, trailing slash, fragment or tracking", () => {
    expect(
      sameLink(
        "https://www.eventbrite.com/e/x-tickets-1?aff=oddtdtcreator&utm_source=fb",
        "http://eventbrite.com/e/x-tickets-1/#tickets",
      ),
    ).toBe(true);
    expect(sameLink("https://a.example/e/1", "https://a.example/e/2")).toBe(false);
    expect(linkKey("mailto:x@example.org")).toBeNull();
    // Encoded and decoded spellings of one path are one page (review #6); a malformed escape is
    // kept as written.
    expect(sameLink("https://t.example/e/a-%26-b", "https://t.example/e/a-&-b")).toBe(true);
    expect(sameLink("https://t.example/e/caf%C3%A9", "https://t.example/e/café")).toBe(true);
    expect(sameLink("https://t.example/e/a-%zz-b", "https://t.example/e/a-%zz-b")).toBe(true);
    expect(sameLink("https://t.example/e/a-%26-b", "https://t.example/e/a-%2F-b")).toBe(false);
    expect(stripTracking("https://x.example/e/1?aff=a&fbclid=b&gclid=c&utm_medium=d&id=7")).toBe(
      "https://x.example/e/1?id=7",
    );
  });
});

describe("findEventLinks", () => {
  const nycswings = pageText("nycswings-net");

  it("gives no link whose block writes another date (B1: Flow Fridays)", () => {
    // The line before the link says "Fri, Oct 30"; the live listing is Friday October 2. The URL
    // carries no date, so only the block can tell.
    const flow = { title: "Social Dance Flow Fridays", date: "2026-10-02" };
    expect(one(nycswings, "https://www.nycswings.net/", flow)).toMatchObject({
      url: null,
      why: "no link for this date",
    });
    expect(one(nycswings, "https://www.nycswings.net/", { ...flow, date: "2026-10-30" }).url).toBe(
      "https://www.nycswings.net/e/flow-fridays/",
    );
  });

  it("gives a festival night inside the span its block writes", () => {
    const zouk = { title: "NYC ZOUK FESTIVAL 2026", date: "2026-10-04" };
    const text =
      "Festival NYC ZOUK FESTIVAL 2026 | Oct 1st-5th, 2026 [https://z.example/event/nyc-zouk]";
    expect(one(text, "https://z.example/", zouk).url).toBe("https://z.example/event/nyc-zouk");
    expect(one(text, "https://z.example/", { ...zouk, date: "2026-10-08" }).url).toBeNull();
  });

  it("gives a rule's listing no dated link and no ticket seller's page (B2)", () => {
    const sobs = pageText("sobs-com-calendar");
    const desi = { title: "Sounds of Bollywood: Desi Saturdays", date: null };
    expect(one(sobs, "https://sobs.com/calendar/", desi).url).toBeNull();
    expect(one(sobs, "https://sobs.com/calendar/", { ...desi, date: "2026-10-03" }).url).toBe(
      "https://sobs.com/events/sounds-of-bollywood-desi-saturdays-10-3-26/",
    );
    const eventbrite =
      "Salsa Night: every Friday. Tickets [https://www.eventbrite.com/e/salsa-night-tickets-123456789]";
    expect(
      one(eventbrite, "https://salsa.example/", { title: "Salsa Night", date: null }).url,
    ).toBe(null);
    const series = "Salsa Night [https://salsa.example/events/salsa-night]\nEvery Friday, 9pm";
    expect(one(series, "https://salsa.example/", { title: "Salsa Night", date: null }).url).toBe(
      "https://salsa.example/events/salsa-night",
    );
  });

  it("reads a URL's numeric date in the metro's order (B3)", () => {
    const text = "Zouk Social [https://z.example/events/zouk-social-3-10-26]";
    const q = { title: "Zouk Social", date: "2026-10-03" };
    expect(one(text, "https://z.example/", q, { lang: "en", dateOrder: "dmy" }).url).toBe(
      "https://z.example/events/zouk-social-3-10-26",
    );
    expect(one(text, "https://z.example/", q, { lang: "en", dateOrder: "mdy" }).url).toBeNull();
    // Unknown order: 3-10 could be either, so the URL alone does not date it.
    expect(one(text, "https://z.example/", q, { lang: "en", dateOrder: null }).url).toBeNull();
  });

  it("gives a title in another script no link, never a wrong one (B4)", () => {
    const text = [
      "Милонга Звезда [https://t.example/milongas/milonga-zvezda]",
      "Milonga [https://t.example/milongas/milonga-de-los-lunes]",
      "Milonga 東京 is on the page too, with no link of its own.",
    ].join("\n");
    const found = findEventLinks(
      text,
      "https://t.example/",
      [
        { title: "Милонга Звезда", date: null },
        // Folded to Latin letters only, this title would be "milonga" and take the Monday
        // milonga's link.
        { title: "Milonga 東京", date: null },
      ],
      US,
    );
    expect(found.map((f) => f.url)).toEqual([null, null]);
    // A Latin letter NFKD does not take apart ("ø") is a letter of the title, not nothing.
    const nordic =
      "Lstue Night [https://t.example/e/lstue]\nØlstue Night [https://t.example/e/olstue]";
    const q = [{ title: "Ølstue Night", date: null }];
    expect(findEventLinks(nordic.split("\n")[0]!, "https://t.example/", q, US)[0]!.url).toBeNull();
    expect(findEventLinks(nordic, "https://t.example/", q, US)[0]!.url).toBe(
      "https://t.example/e/olstue",
    );
    // A Latin title does not match inside a longer word of another script.
    expect(
      one("Salsaночь [https://t.example/e/a]", "https://t.example/", {
        title: "Salsa Night",
        date: null,
      }).url,
    ).toBeNull();
  });

  it("takes an off-site link only on a ticket seller, and only a page for one event (B5)", () => {
    const text = [
      "Salsa at the Rooftop 9pm [https://rooftopsalsa.example/events/friday]",
      "Techno Tango 10pm Tickets [https://dice.fm/event/xyz123-techno-tango-tickets]",
      "Hustle Hour 7pm [https://dir.example/venue/the-hustle-room/]",
      "Blues Night 8pm [https://www.eventbrite.com/o/blues-org-123]",
    ].join("\n");
    const found = findEventLinks(
      text,
      "https://dir.example/this-week",
      ["Salsa at the Rooftop", "Techno Tango", "Hustle Hour", "Blues Night"].map((title) => ({
        title,
        date: null as string | null,
      })),
      US,
    );
    expect(found.map((f) => f.url)).toEqual([
      null,
      null, // a rule's listing gets no ticket seller's page
      null,
      null,
    ]);
    const dated = findEventLinks(
      text,
      "https://dir.example/this-week",
      [{ title: "Techno Tango", date: "2026-10-02" }],
      US,
    );
    expect(dated[0]).toMatchObject({
      url: "https://dice.fm/event/xyz123-techno-tango-tickets",
      kind: "ticketing",
    });
  });

  // The prototype's made-up layouts (synthetic.ts), each a trap a real page sets.
  const page = "https://salsa.example/events-list";
  it.each([
    [
      "one Buy tickets link for every night",
      "Friday, October 2\n\nSalsa Night\n9pm\nBuy tickets [https://salsa.example/tickets]\n\nSaturday, October 3\n\nBachata Night\n9pm\nBuy tickets [https://salsa.example/tickets]",
      [
        { title: "Salsa Night", date: "2026-10-02" },
        { title: "Bachata Night", date: "2026-10-03" },
      ],
      [null, null],
    ],
    [
      "a shared ticket link, only one title read",
      "Friday, October 2\n\nSalsa Night\n9pm\nBuy tickets [https://salsa.example/tickets]\n\nSaturday, October 3\n\nJazz Brunch\n9pm\nBuy tickets [https://salsa.example/tickets]",
      [{ title: "Salsa Night", date: "2026-10-02" }],
      [null],
    ],
    [
      "an unlinked title followed by the next item's own link",
      "Salsa Night\nOctober 2, 9pm\n\nBachata Night [https://salsa.example/events/bachata-night]\nOctober 3",
      [{ title: "Salsa Night", date: "2026-10-02" }],
      [null],
    ],
    [
      "the title in a sentence that links elsewhere",
      "Join us after Salsa Night for drinks at Bar Uno [https://salsa.example/bar-uno]",
      [{ title: "Salsa Night", date: null }],
      [null],
    ],
    [
      "the title as the start of a longer event's link",
      "Salsa Night Afterparty [https://salsa.example/events/afterparty]\nOctober 3",
      [{ title: "Salsa Night", date: "2026-10-03" }],
      [null],
    ],
    [
      "an Eventbrite link on an organiser's page",
      "Salsa Night — Oct 2, 9pm — Tickets [https://www.eventbrite.com/e/salsa-night-tickets-123?aff=site]",
      [{ title: "Salsa Night", date: "2026-10-02" }],
      ["https://www.eventbrite.com/e/salsa-night-tickets-123?aff=site"],
    ],
    [
      "a WordPress list row",
      "Salsa Night [https://salsa.example/event/salsa-night/]\nOctober 2 @ 9:00 pm - 1:00 am",
      [{ title: "Salsa Night", date: "2026-10-02" }],
      ["https://salsa.example/event/salsa-night/"],
    ],
    [
      "a rule's listing with a dated link",
      "Salsa Night [https://salsa.example/event/salsa-night-2026-10-02/]\nEvery Friday",
      [{ title: "Salsa Night", date: null }],
      [null],
    ],
    [
      "a link to the page itself, with a fragment",
      "Salsa Night [https://salsa.example/events-list#salsa]",
      [{ title: "Salsa Night", date: null }],
      [null],
    ],
  ] as const)("%s", (_name, text, queries, expected) => {
    expect(findEventLinks(text, page, queries, US).map((r) => r.url)).toEqual(expected);
  });
});

// The review of D-073 (2026-09-29): each case a wrong link the matcher gave before, now none.
describe("findEventLinks after the review", () => {
  const P = "https://site.example/events";
  const rule = { title: "Salsa Social", date: null };
  const oct2 = { title: "Salsa Social", date: "2026-10-02" };
  const urls = (text: string, queries: LinkQuery[], pageUrl = P, options = US) =>
    findEventLinks(text, pageUrl, queries, options).map((f) => f.url);

  it("ends a block at the next item's heading, even one no listing asks for (#7)", () => {
    // A short title, too short to get a link of its own, still ends the block before it.
    expect(
      urls(
        "Salsa Social\nEvery Friday, 9pm. $10 at the studio.\n\nMilonga\nEvery Saturday, 8pm.\nRead more [https://site.example/events/milonga-del-sabado]",
        [rule, { title: "Milonga", date: null }],
      ),
    ).toEqual([null, null]);
    // A concert the model rightly skipped: its heading line ends Salsa Social's block.
    expect(
      urls(
        "Friday, October 2\n\nSalsa Social\n9pm, $10.\n\nJazz Quartet Concert\n10pm, $20.\nRead more [https://site.example/events/jazz-quartet]",
        [oct2],
      ),
    ).toEqual([null]);
    // Another title after a separator on the title's line.
    expect(
      urls("Salsa Social 9pm | Jazz Quartet Night [https://site.example/events/jazz-quartet]", [
        rule,
      ]),
    ).toEqual([null]);
    expect(
      urls("Salsa Social 9pm · Milonga [https://site.example/events/milonga]", [
        rule,
        { title: "Milonga", date: null },
      ]),
    ).toEqual([null, null]);
  });

  it("ends a block at a short title standing alone on its line (#7)", () => {
    // "Milonga:" does not read as a heading line; it is the queried title, alone on its line.
    const text =
      "Salsa Social\nEvery Friday, 9pm. $10 at the studio.\n\nMilonga:\nEvery Saturday, 8pm.\nRead more [https://site.example/events/milonga-del-sabado]";
    expect(urls(text, [rule, { title: "Milonga", date: null }])).toEqual([null, null]);
    expect(urls(text, [rule], P, { ...US, bounds: ["Milonga"] })).toEqual([null]);
  });

  it("ends a block at the title of a listing the checks rejected (#7)", () => {
    const text =
      "Salsa Social\n9pm.\n\nBachata Night Out: Saturdays\nRead more [https://site.example/events/bachata]";
    expect(urls(text, [rule], P, { ...US, bounds: ["Bachata Night Out"] })).toEqual([null]);
  });

  it("keeps a link named for the title past a venue line and a subtitle (#7)", () => {
    const wix =
      "Urban Kiz Workshop\n\nOct 10, 2026, 2:00 PM\n\nDance Space NYC\n\nRSVP [https://www.kizzclub.example/event-details/urban-kiz-workshop-2026-10-10-14-00]";
    expect(
      urls(wix, [{ title: "Urban Kiz Workshop", date: "2026-10-10" }], "https://kizzclub.example/"),
    ).toEqual(["https://www.kizzclub.example/event-details/urban-kiz-workshop-2026-10-10-14-00"]);
    // A heading the link is named for is that item's, even when the link also names this title.
    expect(
      urls(
        "Salsa Social\n9pm\n\nAfterparty\nRead more [https://site.example/events/salsa-social-afterparty]",
        [rule],
      ),
    ).toEqual([null]);
    expect(
      urls(
        "Salsa Social 9pm | Salsa Social Afterparty [https://site.example/events/salsa-social-afterparty]",
        [rule],
      ),
    ).toEqual([null]);
  });

  it("gives a dated listing no link to another night the block also writes (#10)", () => {
    const later = "https://site.example/events/salsa-social-2026-10-09";
    const oct9 = { title: "Salsa Social", date: "2026-10-09" };
    expect(
      urls(
        `Friday, October 2\nSalsa Social (sold out)\n\nFriday, October 9\nSalsa Social [${later}]`,
        [oct2, oct9],
      ),
    ).toEqual([null, later]);
    expect(urls(`Oct 2 · Oct 9\nSalsa Social [${later}]`, [oct2])).toEqual([null]);
    expect(urls(`Oct 2 · Oct 9\nSalsa Social [${later}]`, [oct9])).toEqual([later]);
    expect(
      urls(`Upcoming: Friday, October 2 and Friday, October 9\nSalsa Social [${later}]`, [oct2]),
    ).toEqual([null]);
  });

  it("gives no organiser, venue or teacher page after the title (#11)", () => {
    const page = "https://www.dancestudio.com/schedule-this-week";
    const q = [{ title: "Friday Salsa Social", date: null }];
    for (const line of [
      "Friday Salsa Social — hosted by Salsa Club NYC [https://www.dancestudio.com/groups/salsa-club-nyc]",
      "Friday Salsa Social @ Club Mango [https://www.dancestudio.com/places/club-mango]",
      "Friday Salsa Social | Instructor: Maria Lopez [https://www.dancestudio.com/teachers/maria-lopez]",
      "Friday Salsa Social — Salsa Club [https://www.dancestudio.com/organizations/salsa-club]",
      "Friday Salsa Social · Studio B [https://www.dancestudio.com/studios/studio-b]",
      // The same gaps before a path that could be an event's: the gap alone says whose it is.
      "Friday Salsa Social — hosted by Salsa Club NYC [https://www.dancestudio.com/e/salsa-club-nyc]",
      "Friday Salsa Social @ Club Mango [https://www.dancestudio.com/e/club-mango]",
      "Friday Salsa Social (with Maria) [https://www.dancestudio.com/e/maria]",
    ]) {
      expect(urls(line, q, page), line).toEqual([null]);
    }
    expect(
      urls("Friday Salsa Social — 8pm [https://www.dancestudio.com/e/friday-salsa]", q, page),
    ).toEqual(["https://www.dancestudio.com/e/friday-salsa"]);
  });

  it("keeps another tenant of a shared host off-site (#12)", () => {
    const page = "https://nycdancedir.wixsite.com/listings/this-week";
    const q = [{ title: "West Coast Swing Night", date: null }];
    expect(
      urls("West Coast Swing Night [https://otherclub.wixsite.com/events/wcs-night]", q, page),
    ).toEqual([null]);
    expect(
      urls("West Coast Swing Night [https://nycdancedir.wixsite.com/events/wcs-night]", q, page),
    ).toEqual(["https://nycdancedir.wixsite.com/events/wcs-night"]);
  });

  it("gives neither title a link they share, however it is spelled (#13)", () => {
    const two = [oct2, { title: "Bachata Night Out", date: "2026-10-02" }];
    expect(
      urls(
        "Salsa Social\n9pm\nBuy tickets [https://site.example/tickets/fall]\n\nBachata Night Out\n9pm\nBuy tickets [https://site.example/tickets/fall/]",
        two,
      ),
    ).toEqual([null, null]);
    expect(
      urls(
        "Salsa Social [https://site.example/tickets/fall?utm_source=a]\nBachata Night Out [https://site.example/tickets/fall?utm_source=b]",
        two,
      ),
    ).toEqual([null, null]);
    expect(
      urls(
        "Salsa Social [https://www.dance.com/events/fall-social]\nBachata Night Out [https://dance.com/events/fall-social]",
        two,
        "https://dance.com/events",
      ),
    ).toEqual([null, null]);
  });

  it("calls a Facebook, Meetup or Partiful event page an event page, not tickets (#18, #22)", () => {
    for (const link of [
      "https://www.facebook.com/events/123456789012345/",
      "https://www.meetup.com/nyc-salsa/events/303123456/",
      "https://partiful.com/e/AbCdEf",
    ]) {
      const found = findEventLinks(
        `Salsa Sundays\n\nSalsa Night [${link}]\n8pm, Oct 4\n`,
        "https://www.salsasundays.com/calendar",
        [{ title: "Salsa Night", date: "2026-10-04" }],
        US,
      )[0]!;
      expect(found, link).toMatchObject({ url: link, kind: "event_page" });
    }
  });

  it("stays near-linear on a large page that repeats its titles and links (#15)", () => {
    const titles = Array.from({ length: 100 }, (_, n) => `Salsa Social Number ${n + 1}`);
    let text = "";
    for (let k = 0; text.length < 200_000; k++) {
      text += `${titles[k % 100]}\n9pm to 1am, $15.\nRead more [https://site.example/events/salsa-social-${(k % 100) + 1}]\n\n`;
    }
    const started = performance.now();
    const found = findEventLinks(
      text,
      P,
      titles.map((title) => ({ title, date: null })),
      US,
    );
    expect(performance.now() - started).toBeLessThan(2000);
    expect(
      found.every((f, n) => f.url === `https://site.example/events/salsa-social-${n + 1}`),
    ).toBe(true);
  });
});

/** Precision on a labelled set: a found link is right when it is the expected one (or `alt`). */
function score(
  rows: Array<{ got: string | null; expect: string | null; alt?: string }>,
): Record<"tp" | "fp" | "fn" | "tn", number> {
  const n = { tp: 0, fp: 0, fn: 0, tn: 0 };
  for (const r of rows) {
    if (r.got && (r.got === r.expect || r.got === r.alt)) n.tp += 1;
    else if (r.got) n.fp += 1;
    else if (r.expect) n.fn += 1;
    else n.tn += 1;
  }
  return n;
}

describe("the matcher's scores (evals/links)", () => {
  it("makes no wrong link on the 14 pages it was tuned on, all titles at once", () => {
    const rows = Object.entries(tuned.pages).flatMap(([name, url]) => {
      const cases = tuned.cases.filter((c) => c.page === name);
      const found = findEventLinks(pageText(name), url, cases, US);
      return cases.map((c, i) => ({ ...c, got: found[i]!.url }));
    });
    // 112 hand-checked cases; the one miss is This Week in Swing's Halloween Stomp, whose
    // Eventbrite link sits 2,413 characters below its title.
    expect(score(rows)).toEqual({ tp: 30, fp: 0, fn: 1, tn: 81 });
  });

  it("makes no wrong link on the tuned pages with each title asked alone", () => {
    const rows = tuned.cases.map((c) => ({
      ...c,
      got: findEventLinks(pageText(c.page), tuned.pages[c.page]!, [c], US)[0]!.url,
    }));
    expect(score(rows).fp).toBe(0);
  });

  it("makes no wrong link on the held-out layouts it was not tuned on (B6)", () => {
    const rows = HELD_OUT.flatMap((page) => {
      const text = cleanPageText(page.html, page.url);
      const found = findEventLinks(text, page.url, page.cases, {
        lang: "en",
        dateOrder: page.dateOrder,
      });
      return page.cases.map((c, i) => ({ ...c, got: found[i]!.url, page: page.name }));
    });
    expect(rows).toHaveLength(34);
    expect(score(rows)).toEqual({ tp: 17, fp: 0, fn: 0, tn: 17 });
  });

  it("links a heading on a held-out real page only to the link on its own line", () => {
    // Every heading-like line of three real pages that were not tuned on, asked for as a title.
    for (const [name, url] of Object.entries(HELD_OUT_REAL_PAGES)) {
      const text = pageText(name);
      const titles = new Set<string>();
      for (const line of text.split("\n")) {
        for (const part of line.replace(/\[(https?:\/\/[^\]\s]+)\]/g, "\u0000").split("\u0000")) {
          const title = part.replace(/^[-•|\s]+/, "").trim();
          if (title.length >= 6 && title.length <= 80 && /\p{L}{3}/u.test(title)) titles.add(title);
        }
      }
      const queries = [...titles].map((title) => ({ title, date: null }));
      const found = findEventLinks(text, url, queries, US);
      found.forEach((f, i) => {
        if (!f.url) return;
        expect(looksLikeEventPage(f.url), f.url).toBe(true);
        // The link is the one printed right after this very heading.
        const title = queries[i]!.title;
        const lines = text.split("\n").filter((l) => l.includes(title));
        expect(
          lines.some((l) => l.includes(`${title} [${f.url}]`)),
          `${name}: ${title} -> ${f.url}`,
        ).toBe(true);
      });
    }
  });

  it("gives only URLs that can be one event's page", () => {
    for (const [name, url] of Object.entries(tuned.pages)) {
      const cases = tuned.cases.filter((c) => c.page === name);
      for (const f of findEventLinks(pageText(name), url, cases, US)) {
        if (f.url) expect(looksLikeEventPage(f.url), f.url).toBe(true);
      }
    }
  });
});

describe("math-bold titles (bcnswing.org)", () => {
  const url = "https://www.bcnswing.org/mogudes/";
  const link =
    "https://www.bcnswing.org/moguda/%f0%9d%97%a7%f0%9d%97%9b%f0%9d%97%a8%f0%9d%97%a5%f0%9d%97%a6%f0%9d%97%97%f0%9d%97%94%f0%9d%97%ac-%f0%9d%97%a6%f0%9d%97%aa%f0%9d%97%9c%f0%9d%97%a1%f0%9d%97%9a-%f0%9d%97%a6%f0%9d%97%a2%f0%9d%97%96-3-2/2026-10-29/";
  const text = [
    "oct.",
    "",
    "29",
    "",
    "21:00",
    "",
    `𝗧𝗛𝗨𝗥𝗦𝗗𝗔𝗬 𝗦𝗪𝗜𝗡𝗚 𝗦𝗢𝗖𝗜𝗔𝗟 [${link}]`,
    "",
    "3€ - 5€",
    "",
    "oct.",
    "",
    "30",
    "",
    "18:30",
    "",
    "BALLADA DE SWING CASTANYERA A POBLENOU [https://www.bcnswing.org/moguda/ballada-de-swing-castanyera-a-poblenou/]",
  ].join("\n");
  it("gives the title's own link", () => {
    const found = findEventLinks(
      text,
      url,
      [{ title: "𝗧𝗛𝗨𝗥𝗦𝗗𝗔𝗬 𝗦𝗪𝗜𝗡𝗚 𝗦𝗢𝗖𝗜𝗔𝗟", date: "2026-10-29" }],
      {
        lang: "ca",
      },
    )[0]!;
    expect(found.why ?? "").not.toContain("Latin script");
    expect(found.url, `why: ${found.why}`).toBe(link);
  });
  it("still refuses a Cyrillic title", () => {
    const found = findEventLinks(text, url, [{ title: "Танго вечер", date: "2026-10-29" }])[0]!;
    expect(found.url).toBeNull();
  });
});
