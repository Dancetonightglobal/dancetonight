// A model read grounded in its page, every run, with no model call (D-073): a title the page does
// not write is rejected, a recurrence it does not write is dropped, a ticket link it does not carry
// is dropped, and each listing gets its own link from the page's links. The three listings the
// critic found invented on the live site ("Nylon Lindy Hop", "Salsa Social", "Social Dancing", all
// "every Thursday", the extraction prompt's own example) are checked against the pages they
// claimed to come from, as saved on 2026-09-28 (evals/links/pages).

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { HarvestedListing } from "@/src/adapters/types";
import { rawExtractionSchema } from "@/src/domain/listing";
import { findPhrase, foldPage } from "@/src/domain/text-facts";
import { extractionToHarvested } from "@/src/pipeline/extract";
import { expandRecurrence } from "@/src/pipeline/normalize";

const LINKS = join(__dirname, "../../evals/links");
const pageText = (name: string) => readFileSync(join(LINKS, "pages", `${name}.txt`), "utf8");
const EVALS = join(__dirname, "../../evals/extraction");
const steppingOut = readFileSync(
  join(EVALS, "pages/steppingoutstudios-social-events1.txt"),
  "utf8",
);
const expected = JSON.parse(
  readFileSync(join(EVALS, "expected/steppingoutstudios-social-events1.json"), "utf8"),
) as { url: string; listings: Array<{ title: string; recurrence_text: string }> };

const NOW = new Date("2026-09-28T14:00:00Z");
const TONIGHT = "2026-09-28";

function reply(listings: Array<Record<string, unknown>>) {
  return rawExtractionSchema.parse({
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
}

const read = (
  pageUrl: string,
  text: string | null,
  listings: Array<Record<string, unknown>>,
  extra: { directory?: boolean; countryCode?: string } = {},
) =>
  extractionToHarvested(reply(listings), {
    pageUrl,
    fetchedAt: NOW,
    today: TONIGHT,
    pageText: text,
    countryCode: "US",
    ...extra,
  });

// The three invented listings, as the live site showed them on 2026-09-28.
const INVENTED = [
  {
    page: "nylindy-com",
    url: "https://www.nylindy.com/",
    listing: {
      title: "Nylon Lindy Hop",
      listing_type: "class",
      recurrence_text: "every Thursday",
      ticket_url: "https://www.nylindy.com/events/nylon-lindy-hop",
      venue: { name: "The Factory", address: "144 Allen St" },
    },
  },
  {
    page: "swingremixnyc-com",
    url: "https://swingremixnyc.com/",
    listing: {
      title: "Salsa Social",
      recurrence_text: "every Thursday",
      ticket_url: "https://swingremixnyc.com/events/salsa-social",
      venue: { name: "Swing Remix NYC", address: "1000 6th Ave" },
    },
  },
  {
    page: "salsanewyork-com",
    url: "https://salsanewyork.com/",
    listing: {
      title: "Social Dancing",
      recurrence_text: "every Thursday",
      ticket_url: "https://salsanewyork.com/events/social-dancing",
      venue: { name: "Tango studio", address: "W 47th St" },
    },
  },
];

// Every listing the live site showed read from a page (not an API), by the page it came from, as
// the page wrote it on 2026-09-28. The Ronda's two Monday rows are left out: they are on no copy of
// its page (run 27's or the critic's), left over from earlier runs, and a read would reject them.
const LIVE: Record<string, { url: string; titles: string[] }> = {
  "steppingoutstudios-com-social-events1": {
    url: "https://www.steppingoutstudios.com/social-events1",
    titles: [
      "Bachata Rosa",
      "Ballroom and Smooth Practice",
      "Friday Night Fever",
      "Paciencia Milonga",
      "Robins Argentine Tango Practica",
      "Toda La Noche, Salsa Social",
    ],
  },
  "thisweekinswingnyc-com": {
    url: "https://thisweekinswingnyc.com/",
    titles: ["Back Room Speakeasy Sessions", "Gotham Jazz", "Midtown Swings"],
  },
  "cdny-org": { url: "https://cdny.org/", titles: ["CONTRA - SATURDAYS", "English - Tuesdays"] },
  "theronda-us-nyc": {
    url: "https://www.theronda.us/nyc",
    titles: [
      "Esa! Milonga",
      "Los Tres Amigos Milonga",
      "Pasion Milonguera",
      "Tango Cafe",
      "Tango la Nacional",
      "Victoria's Practica",
    ],
  },
  "nycswings-net": {
    url: "https://www.nycswings.net/",
    titles: ["Social Dance Flow Fridays", "West Coast Swing with Jes Ann Nail"],
  },
};

describe("a title the page does not write (A1)", () => {
  it.each(INVENTED)("rejects $listing.title, invented on $page", ({ page, url, listing }) => {
    const result = read(url, pageText(page), [listing]);
    expect(result.listings).toEqual([]);
    expect(result.rejected).toEqual([
      { title: listing.title, reason: "the page does not write this title; not listed" },
    ]);
    expect(result.notOnPage).toEqual([listing.title]);
    expect(result.unchecked).toBe(false);
  });

  it("keeps every title the live site read from a page that still writes it (21 rows, 19 titles)", () => {
    // A page that lists each night under its date heading has a dated listing checked against it
    // (D-074), so each title is dated as its page dates it where the hand-checked cases say
    // (evals/links/tuned.json); the rest keep October 1.
    const tuned = JSON.parse(readFileSync(join(LINKS, "tuned.json"), "utf8")) as {
      cases: Array<{ page: string; title: string; date: string | null }>;
    };
    // Flow Fridays' tuned case is the live October 2 row D-080 retires: its card says Oct 30.
    const dated = (page: string, title: string) =>
      title === "Social Dance Flow Fridays"
        ? "2026-10-30"
        : (tuned.cases.find((c) => c.page === page && c.title === title && c.date)?.date ??
          "2026-10-01");
    for (const [page, { url, titles }] of Object.entries(LIVE)) {
      const result = read(
        url,
        pageText(page),
        titles.map((title) => ({ title, local_date: dated(page, title) })),
      );
      // The title check (A1) rejects none of them. A placeholder date on a weekday the page
      // contradicts beside the title is refused on its own (D-078), and the listing is written by
      // the rule the page writes after it instead, so every title is still listed.
      expect(
        result.rejected.filter((r) => /does not write this title/.test(r.reason)),
        page,
      ).toEqual([]);
      expect(result.notOnPage, page).toEqual([]);
      expect(new Set(result.listings.map((h) => h.listing.title)), page).toEqual(new Set(titles));
    }
  });

  it("keeps every title and phrase the extraction eval expects from its page", () => {
    const folded = foldPage(steppingOut);
    for (const l of expected.listings) {
      expect(findPhrase(folded, l.title), l.title).not.toBeNull();
      expect(findPhrase(folded, l.recurrence_text), l.recurrence_text).toBe("exact");
    }
    const result = read(
      expected.url,
      steppingOut,
      expected.listings.map((l) => ({ title: l.title, recurrence_text: l.recurrence_text })),
    );
    expect(result.rejected).toEqual([]);
    expect(result.notes.join(" ")).not.toMatch(/recurrence the page does not write/);
  });

  it("keeps every title of the matcher's tuned cases that its page still writes", () => {
    const tuned = JSON.parse(readFileSync(join(LINKS, "tuned.json"), "utf8")) as {
      cases: Array<{ page: string; title: string }>;
    };
    const missing = tuned.cases
      .filter((c) => findPhrase(foldPage(pageText(c.page)), c.title) === null)
      .map((c) => c.title);
    // The Ronda's two Monday rows, which its page no longer lists, and the three invented ones.
    expect(missing).toEqual([
      "Milonga Bienvenida",
      "Mondays Milongueros",
      "Nylon Lindy Hop",
      "Salsa Social",
      "Social Dancing",
    ]);
  });
});

describe("a recurrence the page does not write (A2)", () => {
  const page = "Salsa Thursdays\nDoors 9pm. Next: Thursday, October 1, 2026";

  it("drops the phrase and keeps the date the page writes", () => {
    const result = read("https://salsa.example/", page, [
      { title: "Salsa Thursdays", local_date: "2026-10-01", recurrence_text: "every Tuesday" },
    ]);
    expect(result.rejected).toEqual([]);
    expect(result.listings.map((h) => [h.listing.local_date, h.recurrence])).toEqual([
      ["2026-10-01", null],
    ]);
    expect(result.notes).toContain(
      '1 listing(s) came with a recurrence the page does not write; dropped: Salsa Thursdays ("every Tuesday")',
    );
  });

  it("does not write a listing left with neither a recurrence nor a date the page writes", () => {
    const result = read("https://salsa.example/", "Salsa Thursdays\nDoors 9pm", [
      { title: "Salsa Thursdays", local_date: "2026-10-06", recurrence_text: "every Tuesday" },
    ]);
    expect(result.listings).toEqual([]);
    expect(result.rejected).toEqual([
      {
        title: "Salsa Thursdays",
        reason: 'the page does not write "every Tuesday" and gives no date for it; not listed',
      },
    ]);
    // Its title is the page's: not taken for one the page does not write (review 2026-09-29).
    expect(result.notOnPage).toEqual([]);
    expect(result.recurrenceNotOnPage).toEqual(["Salsa Thursdays"]);
  });

  it("reads a reworded weekly phrase beside the title, and not one far from it", () => {
    // CDNY prints "ENGLISH - TUESDAYS"; the model reads it as "every Tuesday". (Its page also
    // prints "Every Tuesday" word for word further up; this one does not.)
    for (const text of [pageText("cdny-org"), "Dances\nENGLISH - TUESDAYS\nCONTRA - SATURDAYS"]) {
      const cdny = read("https://cdny.org/", text, [
        { title: "English - Tuesdays", recurrence_text: "every Tuesday" },
      ]);
      expect(cdny.rejected).toEqual([]);
      expect(cdny.listings[0]?.recurrence?.rrule).toBe("FREQ=WEEKLY;BYDAY=TU");
    }
    // A Thursday named 60 words away is not this listing's.
    const far = `Salsa Night\n${"word ".repeat(60)}\nJazz on Thursdays`;
    const result = read("https://salsa.example/", far, [
      { title: "Salsa Night", recurrence_text: "every Thursday" },
    ]);
    expect(result.listings).toEqual([]);
    expect(result.rejected[0]?.reason).toMatch(/^the page does not write "every Thursday"/);
  });
});

describe("a ticket link the page does not carry (A3)", () => {
  const page = [
    "Salsa Night [https://salsa.example/events/salsa-night]",
    "Friday, October 2, 9pm",
    "Tickets: https://tix.example/salsa-night-oct-2",
    "Bachata Night — Saturday, October 3 — Tickets [https://www.eventbrite.com/e/bachata-tickets-42?aff=site]",
  ].join("\n");

  it("drops one the page does not carry, and names it", () => {
    const result = read("https://salsa.example/", page, [
      {
        title: "Salsa Night",
        local_date: "2026-10-02",
        ticket_url: "https://salsa.example/events/salsa-night-tickets",
      },
    ]);
    expect(result.listings[0]?.listing.ticket_url).toBeNull();
    expect(result.notes).toContain(
      "1 listing(s) came with a ticket link the page does not carry; dropped: Salsa Night (https://salsa.example/events/salsa-night-tickets)",
    );
  });

  it("keeps one the page carries, as a link or printed, whatever its tracking", () => {
    const result = read("https://salsa.example/", page, [
      {
        title: "Salsa Night",
        local_date: "2026-10-02",
        ticket_url: "https://tix.example/salsa-night-oct-2",
      },
      {
        title: "Bachata Night",
        local_date: "2026-10-03",
        ticket_url: "https://www.eventbrite.com/e/bachata-tickets-42",
      },
    ]);
    expect(result.listings.map((h) => h.listing.ticket_url)).toEqual([
      "https://tix.example/salsa-night-oct-2",
      "https://www.eventbrite.com/e/bachata-tickets-42",
    ]);
    expect(result.notes.join(" ")).not.toMatch(/does not carry/);
  });

  it("drops the invented listings' links with them", () => {
    for (const { page: name, url, listing } of INVENTED) {
      const onPage = read(url, pageText(name), [{ ...listing, title: "x" }]);
      expect(onPage.listings).toEqual([]);
    }
  });
});

describe("a read with no page text to check (A5)", () => {
  it("is kept as read, and says it went unchecked", () => {
    const { listing, url } = INVENTED[0]!;
    const result = read(url, null, [listing]);
    expect(result.unchecked).toBe(true);
    expect(result.rejected).toEqual([]);
    expect(result.listings).toHaveLength(1);
    expect(result.notes.at(-1)).toBe(
      "the page's text is no longer stored, so this read was not checked against it (titles, recurrences, links): kept as read, with the event pages stored before",
    );
  });
});

describe("each listing's own link from the page's links (C)", () => {
  it("takes The Ronda's event page for each night, with no model link", () => {
    const result = read(
      "https://www.theronda.us/nyc",
      pageText("theronda-us-nyc"),
      [
        { title: "Tango Cafe", local_date: "2026-09-30" },
        { title: "Esa! Milonga", local_date: "2026-10-02" },
      ],
      { directory: true },
    );
    expect(result.listings.map((h) => [h.eventUrl, h.listing.ticket_url])).toEqual([
      ["https://www.theronda.us/event/tango-cafe-2026-09-30-74420121", null],
      ["https://www.theronda.us/event/esa-milonga-2026-10-02-40eee78f", null],
    ]);
    expect(result.notes).toContain(
      "2 listing(s) got their own event page from the page's links: Tango Cafe; Esa! Milonga",
    );
  });

  it("takes a ticket seller's page as tickets when the model gave none, without tracking", () => {
    const page =
      "Loft Lindy Night — Sat, Oct 3, 8pm — Get tickets [https://www.eventbrite.com/e/loft-lindy-tickets-8899?aff=ebdsoporgprofile&utm_source=site]";
    const none = read("https://loft.example/", page, [
      { title: "Loft Lindy Night", local_date: "2026-10-03" },
    ]);
    expect(none.listings[0]?.listing.ticket_url).toBe(
      "https://www.eventbrite.com/e/loft-lindy-tickets-8899",
    );
    expect(none.listings[0]?.eventUrl).toBeUndefined();
    // The model's own ticket link, on the page, stands.
    const own = read("https://loft.example/", `${page}\nDoor sales: https://loft.example/door`, [
      {
        title: "Loft Lindy Night",
        local_date: "2026-10-03",
        ticket_url: "https://loft.example/door",
      },
    ]);
    expect(own.listings[0]?.listing.ticket_url).toBe("https://loft.example/door");
  });

  it("moves a same-site 'ticket' link that is the event's own page to the event page", () => {
    const page = "Harlem Hop [https://swing.example/events/harlem-hop]\nFriday, October 2, 8pm";
    const result = read("https://swing.example/events", page, [
      {
        title: "Harlem Hop",
        local_date: "2026-10-02",
        ticket_url: "https://swing.example/events/harlem-hop",
      },
    ]);
    expect(result.listings[0]).toMatchObject({
      eventUrl: "https://swing.example/events/harlem-hop",
      listing: { ticket_url: null },
    });
    expect(result.notes).toContain(
      "1 listing(s) gave as tickets the event's own page on this site: kept as the event page: Harlem Hop",
    );
  });

  it("ends a listing's block at a rejected listing's title (review #7)", () => {
    // Bachata Night Out is on the page, but its "every Thursday" is not, so it is rejected; its
    // title still ends Salsa Social's block, and Salsa Social does not take its Read more.
    const page =
      "Salsa Social\nEvery Friday, 9pm.\n\nBachata Night Out: every Saturday\nRead more [https://salsa.example/events/bachata-night-out]";
    const result = read("https://salsa.example/", page, [
      { title: "Salsa Social", recurrence_text: "Every Friday", doors_time: "21:00" },
      { title: "Bachata Night Out", recurrence_text: "every Thursday", doors_time: "21:00" },
    ]);
    expect(result.rejected.map((r) => r.title)).toEqual(["Bachata Night Out"]);
    expect(result.listings.map((h) => [h.listing.title, h.eventUrl])).toEqual([
      ["Salsa Social", undefined],
    ]);
  });

  it("keeps a directory on a shared host from moving another tenant's link in (review #12)", () => {
    const page =
      "West Coast Swing Night [https://otherclub.wixsite.com/events/wcs-night]\nFriday, October 2, 8pm";
    const result = read(
      "https://nycdancedir.wixsite.com/listings/this-week",
      page,
      [
        {
          title: "West Coast Swing Night",
          local_date: "2026-10-02",
          ticket_url: "https://otherclub.wixsite.com/events/wcs-night",
        },
      ],
      { directory: true },
    );
    expect(result.listings[0]?.eventUrl).toBeUndefined();
  });

  it("gives a rule's listing no link to one night (B2)", () => {
    const sobs = read("https://sobs.com/calendar/", pageText("sobs-com-calendar"), [
      {
        title: "Sounds of Bollywood: Desi Saturdays",
        recurrence_text: "Saturdays",
      },
    ]);
    expect(sobs.listings[0]?.recurrence?.rrule).toBe("FREQ=WEEKLY;BYDAY=SA");
    expect(sobs.listings[0]?.eventUrl).toBeUndefined();
  });
});

describe("a rule's nights share no link to one night (B2, the model's links too)", () => {
  const rule = (eventUrl: string | null, ticket: string | null): HarvestedListing => ({
    listing: reply([{ title: "Salsa Thursdays", ticket_url: ticket, doors_time: "21:00" }])
      .listings[0]!,
    externalId: null,
    tz: null,
    venueLocation: null,
    recurrence: { rrule: "FREQ=WEEKLY;BYDAY=TH", dtstartLocal: "2026-09-28T21:00", exdates: [] },
    provenance: { sourceUrl: "https://salsa.example/", fetchedAt: NOW, method: "llm" },
    eventUrl,
  });

  it("drops a dated event page and a ticket seller's page from every night", () => {
    const { listings, linksDropped } = expandRecurrence(
      rule(
        "https://salsa.example/events/salsa-thursdays-2026-10-01",
        "https://www.eventbrite.com/e/salsa-thursdays-tickets-123",
      ),
      TONIGHT,
      "America/New_York",
    );
    expect(listings.length).toBeGreaterThan(1);
    expect(listings.every((l) => !l.eventUrl && l.listing.ticket_url === null)).toBe(true);
    expect(linksDropped).toEqual([
      "https://salsa.example/events/salsa-thursdays-2026-10-01",
      "https://www.eventbrite.com/e/salsa-thursdays-tickets-123",
    ]);
  });

  it("keeps a series page and a ticket page that is not one night's", () => {
    const { listings, linksDropped } = expandRecurrence(
      rule("https://salsa.example/events/salsa-thursdays", "https://salsa.example/passes"),
      TONIGHT,
      "America/New_York",
    );
    expect(linksDropped).toEqual([]);
    expect(
      listings.every((l) => l.eventUrl === "https://salsa.example/events/salsa-thursdays"),
    ).toBe(true);
    expect(listings.every((l) => l.listing.ticket_url === "https://salsa.example/passes")).toBe(
      true,
    );
  });
});
