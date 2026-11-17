// The home page under filters (review of the live site, 2026-09-28). The owner opened Tomorrow,
// chose Classes and ticked Swing, Tango and Folk: the chips read "Tango 2" and no tango showed,
// the header read "7 places to dance" over two cards, and a selected chip was drawn as a chip
// inside a chip. Every number on the page now counts what tapping its control gives.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The header holds the geolocation button, a client component that asks for the router.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined }),
  useSearchParams: () => new URLSearchParams(),
}));

import { countDays, selectNight } from "@/src/data/listing-mapper";
import type { ListingFilters } from "@/src/data/repository";
import type { Listing } from "@/src/domain/listing";
import { localInstant } from "@/src/domain/time";
import { dayPicker } from "@/src/domain/tonight";
import { Filters } from "@/src/ui/home/Filters";
import { Tail } from "@/src/ui/home/Tail";
import {
  parseHomeParams,
  resolvePlace,
  activeFilterCount,
  type RawParams,
} from "@/src/ui/home/params";
import { parsePriceText } from "@/src/domain/prices";
import { FamilyChip, SectionHead } from "@/src/ui/primitives";
import { Card } from "@/src/ui/home/Card";
import { DayPicker } from "@/src/ui/home/DayPicker";
import { Header, headline } from "@/src/ui/home/Header";
import { SearchPlace } from "@/src/ui/home/SearchPlace";
import { meridiemReference, railStamp } from "@/src/ui/home/timeline-rows";
import { cardPrice, lessonLine } from "@/src/ui/home/format";
import { formatTime } from "@/src/domain/time";

const NY = "America/New_York";
/** Monday 28 September 2026, 5:30pm in New York. */
const NOW = localInstant("2026-09-28", NY, 17, 30);
const TOMORROW = "2026-09-29";
const CENTER = { lat: 40.75, lng: -73.99 };

function listing(
  id: string,
  type: Listing["listingType"],
  families: Listing["families"],
  night: string = TOMORROW,
  hour = 21,
): Listing {
  const startsAt = localInstant(night, NY, hour);
  return {
    id,
    slug: id,
    title: id,
    listingType: type,
    styles: [],
    families,
    doorsAt: null,
    lessonAt: type === "class" ? startsAt : null,
    dancingAt: type === "class" ? null : startsAt,
    endsAt: null,
    startsAt,
    nightDate: night,
    tz: NY,
    venue: {
      id: `${id}-venue`,
      name: "A hall",
      location: { lat: 40.751, lng: -73.99 },
      address: null,
      neighborhood: null,
      googlePlaceId: null,
      kind: "dance_hall",
      danceFloor: "yes",
    },
    organizer: null,
    prices: [],
    isFree: null,
    ticketUrl: null,
    level: null,
    partnerRequired: null,
    ageMin: null,
    dressCode: null,
    floor: null,
    indoorOutdoor: null,
    music: null,
    crowdSizeHint: null,
    recurrenceText: null,
    confirmation: "confirmed_today",
    confidence: null,
    summary: null,
    sources: [],
    status: "active",
    canonicalUrl: null,
    distanceKm: null,
    liveStatus: null,
  };
}

/** The owner's Tuesday: two classes (swing, folk), two tango socials and a kizomba social. */
const TUESDAY = [
  listing("midtown-swings", "class", ["swing"]),
  listing("english-tuesdays", "class", ["folk"]),
  listing("paciencia", "social", ["tango"], TOMORROW, 22),
  listing("tres-amigos", "social", ["tango"], TOMORROW, 20),
  listing("zen-zouk", "social", ["kizomba"], TOMORROW, 23),
];

const night = (filters: ListingFilters) =>
  selectNight(TUESDAY, {
    center: CENTER,
    radiusKm: 25,
    nightDate: TOMORROW,
    now: NOW,
    filters,
    sort: "start",
    unplaced: false,
  });

describe("counts on the home page", () => {
  it("counts each chip within the segment: no Tango chip under Classes when no tango class is on", () => {
    const { counts } = night({ types: ["class"] });
    expect(counts.byFamily).toEqual({ swing: 1, folk: 1 });
  });

  it("gives a chip the same number on or off, and a selected chip its cards in the list", () => {
    const off = night({ types: ["social"] });
    const on = night({ types: ["social"], families: ["tango"] });
    expect(on.counts.byFamily).toEqual(off.counts.byFamily);
    expect(on.counts.byFamily.tango).toBe(2);
    expect(on.listings).toHaveLength(2);
  });

  it("counts what the list shows as the total, and the whole night beside it", () => {
    const { listings, counts } = night({ types: ["class"], families: ["swing", "tango", "folk"] });
    expect(listings.map((l) => l.id).sort()).toEqual(["english-tuesdays", "midtown-swings"]);
    expect(counts.total).toBe(2);
    expect(counts.night).toBe(5);
  });

  it("counts each day under the filters its link carries, On now on tonight only", () => {
    const days = dayPicker(NOW, NY);
    const tonightSocial = listing("tonight-social", "social", ["salsa"], "2026-09-28", 17);
    const all = [...TUESDAY, tonightSocial];
    const classes = countDays(all, days, NOW, { types: ["class"] });
    expect(classes.map((d) => d.count).slice(0, 2)).toEqual([0, 2]);
    // "On now" is dropped from every day but tonight, where the 5pm social is on.
    const onNow = countDays(all, days, NOW, { onNow: true });
    expect(onNow[0]?.count).toBe(1);
    expect(onNow[1]?.count).toBe(5);
  });
});

describe("search text", () => {
  const NOW = new Date("2026-09-28T17:30:00Z");
  const NY = "America/New_York";

  it("trims whitespace", () => {
    const query = parseHomeParams({ place: "  Lindy hop " }, NOW, NY);
    expect(query.filters.text).toBe("Lindy hop");
  });

  it("is undefined when place is empty or whitespace", () => {
    expect(parseHomeParams({}, NOW, NY).filters.text).toBeUndefined();
    expect(parseHomeParams({ place: "   " }, NOW, NY).filters.text).toBeUndefined();
  });

  it("caps length at 100", () => {
    const long = "a".repeat(150);
    const query = parseHomeParams({ place: long }, NOW, NY);
    expect(query.filters.text).toHaveLength(100);
    expect(query.filters.text).toBe(long.slice(0, 100));
  });

  it("remains as text filter when not matching metro", () => {
    const params = resolvePlace({ place: "Brooklyn" }, "New York");
    expect(params).toEqual({ place: "Brooklyn" });
    const query = parseHomeParams(params, NOW, NY);
    expect(query.filters.text).toBe("Brooklyn");
  });

  it("does not count toward activeFilterCount", () => {
    const query = parseHomeParams({ place: "salsa" }, NOW, NY);
    expect(activeFilterCount(query)).toBe(0);
  });
});

describe("the home URL", () => {
  it("keeps On now to tonight", () => {
    expect(parseHomeParams({ now: "1" }, NOW, NY).filters.onNow).toBe(true);
    expect(parseHomeParams({ now: "1", day: TOMORROW }, NOW, NY).filters.onNow).toBeUndefined();
  });

  it("opens tonight for a night that is over, one not yet listed, or a non-date (D-067)", () => {
    // Monday 2026-09-28: last night, tonight + 13 (the ingest's last, maybe not yet written),
    // far on, and things that are not dates.
    for (const day of ["2026-09-27", "2026-10-11", "2026-12-31", "not-a-date", "2026-02-30"]) {
      const query = parseHomeParams({ day }, NOW, NY);
      expect(query.nightDate, day).toBe("2026-09-28");
      expect(query.isTonight).toBe(true);
    }
  });

  it("opens Sunday from a Monday, and a linked night beyond the picker (D-075)", () => {
    // The picker's seventh night is Sunday 2026-10-04; 10-05 is + 7 and 10-10 is + 12.
    for (const day of ["2026-10-03", "2026-10-04", "2026-10-05", "2026-10-10"]) {
      const query = parseHomeParams({ day }, NOW, NY);
      expect(query.nightDate, day).toBe(day);
      expect(query.isTonight).toBe(false);
    }
  });

  it("carries the style keys on the query, so Clear styles can clear them", () => {
    expect(parseHomeParams({ s: "west_coast_swing" }, NOW, NY).styles).toEqual([
      "west_coast_swing",
    ]);
  });
});

function renderFilters(params: RawParams) {
  const query = parseHomeParams(params, NOW, NY);
  const { counts } = selectNight(TUESDAY, {
    center: CENTER,
    radiusKm: 25,
    nightDate: query.nightDate,
    now: NOW,
    filters: query.filters,
    sort: query.sort,
    unplaced: false,
  });
  return renderToStaticMarkup(createElement(Filters, { query, params, counts }));
}

describe("the filter row", () => {
  it("draws a selected chip as one rectangle with the check on the stock", () => {
    const html = renderToStaticMarkup(
      createElement(FamilyChip, { family: "swing", count: 1, selected: true }),
    );
    expect(html.match(/<span class="[^"]*text-stock-swing[^"]*"/g)).toHaveLength(1);
    expect(html).toContain("border-2");
    expect(html).not.toContain("chip-edge");
    expect(html).toMatch(/Swing 1<span aria-hidden="true">✓<\/span><\/span>$/);
    const plain = renderToStaticMarkup(createElement(FamilyChip, { family: "swing", count: 1 }));
    expect(plain).toContain("chip-edge");
    expect(plain).not.toContain("✓");
  });

  it("keeps a chip that is on in the row with its 0, so it can be tapped off", () => {
    const html = renderFilters({ day: TOMORROW, t: "classes", f: "swing,tango,folk" });
    // Spoken with its unit: "Tango 4" read as a name and a number (review, 2026-09-28).
    expect(html).toContain('aria-label="Tango, 0 places, selected"');
    expect(html).toContain('aria-label="Swing, 1 place, selected"');
    // No chip for a family the segment does not hold and nobody selected.
    expect(html).not.toContain("Kizomba");
  });

  it("offers Clear styles beside the sort, clearing families and style keys", () => {
    const html = renderFilters({ day: TOMORROW, f: "tango", s: "milonga" });
    expect(html).toMatch(/href="\/\?day=2026-09-29"[^>]*>Clear styles</);
    const withStyleOnly = renderFilters({ day: TOMORROW, s: "west_coast_swing" });
    expect(withStyleOnly).toContain("Clear styles");
  });
});

describe("the tail of the list", () => {
  const tail = (
    shown: number,
    nightCount: number,
    isTonight = true,
    unplacedHidden = 0,
    params: RawParams = { t: "classes", f: "tango", day: TOMORROW },
    search: string | null = null,
  ) =>
    renderToStaticMarkup(
      createElement(Tail, {
        place: "New York",
        dayLabel: "Tue, Sep 29",
        isTonight,
        shown,
        night: nightCount,
        unplacedHidden,
        params,
        search,
      }),
    );

  it("says the filters hid the night's places, and offers to clear them", () => {
    const html = tail(0, 7);
    expect(html).toContain("7 places are on, but none with these filters.");
    expect(html).toMatch(/href="\/\?day=2026-09-29"[^>]*>Clear filters</);
    expect(html).not.toContain("Nothing on tonight");
  });

  it("says a night is empty only when it is, on any night", () => {
    expect(tail(0, 0)).toContain("Nothing on tonight near New York.");
    expect(tail(0, 0, false)).toContain("Nothing on Tue, Sep 29 near New York.");
    expect(tail(3, 7)).not.toMatch(/Nothing|none with/);
  });

  it("under a narrowed distance, counts the night's listings with no location, never Nothing on (D-082)", () => {
    const one = tail(0, 0, false, 1, { t: "classes", f: "tango", day: TOMORROW, r: "5" });
    expect(one).toContain("1 more has no location listed.");
    expect(one).not.toContain("Nothing on");
    // The link clears the distance and nothing else: the filters stay as the dancer set them.
    expect(one).toMatch(/href="\/\?day=2026-09-29&amp;f=tango&amp;t=classes"[^>]*>Clear distance</);
    expect(tail(0, 0, true, 2)).toContain("2 more have no location listed.");
    expect(tail(0, 0, true, 2)).not.toContain("Nothing on tonight");
    // Places within the distance, hidden by the filters: that sentence is still true.
    expect(tail(0, 7, true, 1)).toContain("7 places are on, but none with these filters.");
    expect(tail(0, 7, true, 1)).not.toContain("no location listed");
    // A list with cards says nothing at its end.
    expect(tail(3, 3, true, 1)).not.toMatch(/Nothing|no location listed/);
    // A search that hid every place says so and clears only the search.
    const searched = tail(0, 7, true, 0, { place: "zzqx", t: "classes" }, "zzqx");
    expect(searched).toContain("Nothing matches “zzqx”. 7 places are on this night.");
    expect(searched).toContain("Clear search");
    expect(searched).toContain('href="/?t=classes"');
  });

  it("does not invite a submission before the suggest page exists", () => {
    expect(tail(3, 7)).not.toContain("Add it");
  });
});

describe("the Time not listed head on the bill", () => {
  it("takes the caller's spacing, so it adds no gap on top of the last hour", () => {
    const onBill = renderToStaticMarkup(
      SectionHead({ className: "pt-1.5 pb-1", children: "Time not listed" }),
    );
    expect(onBill).not.toContain("mt-8");
    const onDetail = renderToStaticMarkup(SectionHead({ children: "When" }));
    expect(onDetail).toContain("mt-8");
  });
});

describe("the card's lines say each time once", () => {
  const clock = (instant: Date) => formatTime(instant, NY, "en-US");
  const at = (hour: number, minute = 0) => localInstant(TOMORROW, NY, hour, minute);
  const timed = (times: Partial<Pick<Listing, "lessonAt" | "dancingAt" | "doorsAt">>): Listing => {
    const base = listing("x", "social", ["tango"]);
    const lessonAt = times.lessonAt ?? null;
    const dancingAt = times.dancingAt ?? null;
    const doorsAt = times.doorsAt ?? null;
    return { ...base, lessonAt, dancingAt, doorsAt, startsAt: dancingAt ?? lessonAt ?? doorsAt };
  };

  it("prints a lesson at another time than the dancing", () => {
    expect(lessonLine(timed({ lessonAt: at(21), dancingAt: at(22) }), clock)).toBe(
      "Lesson 9pm, dancing 10pm",
    );
  });

  it("prints nothing the stamp already says", () => {
    // "Lesson 3pm, dancing 3pm", "9:00 ... Lesson 9pm" and "7:30 ... Doors 7:30pm" on the live site.
    expect(lessonLine(timed({ lessonAt: at(15), dancingAt: at(15) }), clock)).toBeNull();
    expect(lessonLine(timed({ lessonAt: at(21) }), clock)).toBeNull();
    expect(lessonLine(timed({ doorsAt: at(19, 30) }), clock)).toBeNull();
    expect(lessonLine(timed({ dancingAt: at(22) }), clock)).toBeNull();
  });

  it("prints doors that open before the dancing, rather than the dancing again", () => {
    // Paciencia: doors 9:30pm, dancing 10pm, printed "Dancing 10pm" under a 10:00 stamp.
    expect(lessonLine(timed({ doorsAt: at(21, 30), dancingAt: at(22) }), clock)).toBe(
      "Doors 9:30pm",
    );
    expect(lessonLine(timed({ doorsAt: at(21, 30), lessonAt: at(22) }), clock)).toBe(
      "Doors 9:30pm",
    );
  });
});

describe("the card's price", () => {
  const priced = (...prices: [string, number | null][]): Listing => ({
    ...listing("p", "social", ["swing"]),
    isFree: false,
    prices: prices.map(([label, amount]) => ({ label, amount, currency: "USD", includes: null })),
  });

  it("leads with the general price, not the students' tier", () => {
    expect(cardPrice(priced(["General", 25], ["Members", 20], ["Students", 15]), "en-US")).toBe(
      "$25",
    );
  });

  it("prints one price bare when every tier costs the same", () => {
    expect(cardPrice(priced(["Online", 11], ["At the door", 11]), "en-US")).toBe("$11");
  });

  it("keeps door, advance and From as they were", () => {
    expect(cardPrice(priced(["Door", 15], ["General", 20]), "en-US")).toBe("$15 door");
    expect(cardPrice(priced(["Members", 10], ["Students", 8]), "en-US")).toBe("From $8");
    expect(cardPrice(priced(["Range", null]), "en-US")).toBeNull();
  });
});

describe("the card's type word", () => {
  const html = (type: Listing["listingType"]) =>
    renderToStaticMarkup(
      createElement(Card, {
        listing: listing("t", type, ["folk"]),
        stamp: "9:00",
        formatClock: (instant: Date) => formatTime(instant, NY, "en-US"),
        now: NOW,
        locale: "en-US",
        railed: true,
      }),
    );

  it("does not print Other after the family chip", () => {
    expect(html("other")).not.toMatch(/>Other</);
    expect(html("social")).toMatch(/>Social</);
  });
});

describe("the header says what is true", () => {
  const header = (overrides: Partial<Parameters<typeof Header>[0]> = {}) =>
    renderToStaticMarkup(
      createElement(Header, {
        place: "New York",
        dayLabel: "Wed, Sep 30",
        isTonight: false,
        isTomorrow: false,
        nightDate: "2026-09-30",
        count: 7,
        locale: "en-US",
        params: {},
        unmatchedQuery: null,
        coveredPlace: null,
        unopenedDay: null,
        ...overrides,
      }),
    );

  it("prints the date once: in the headline after tomorrow, on its own line tonight", () => {
    expect(header().split("Wed, Sep 30")).toHaveLength(2);
    const tonight = header({ isTonight: true, dayLabel: "Tonight", nightDate: "2026-09-28" });
    expect(tonight).toContain("Tonight near New York");
    // The header's own date, in US order (D-072).
    expect(tonight).toContain("Mon, Sep 28");
  });

  it("says a search it cannot resolve was not looked up, and where the list is", () => {
    expect(header({ unmatchedQuery: "Brooklyn" })).toContain(
      "We can&#x27;t look up Brooklyn yet. Showing places near New York.",
    );
    expect(header()).not.toContain("look up");
  });

  it("offers a way out of a place with no metro, instead of a city picker that is not there", () => {
    const html = header({ place: null, coveredPlace: "New York" });
    expect(html).toContain("We don&#x27;t list places here yet");
    expect(html).toMatch(/href="\/"[^>]*>Show places near New York</);
    expect(html).not.toContain("Pick a city");
  });

  it("gives the page title the headline", () => {
    expect(
      headline({ place: "New York", dayLabel: "Tomorrow", isTonight: false, isTomorrow: true }),
    ).toBe("Tomorrow near New York");
  });
});

describe("the search box", () => {
  const html = (params: RawParams) => renderToStaticMarkup(createElement(SearchPlace, { params }));

  it("keeps the dancer's centre when it cannot resolve the place, and keeps what was typed", () => {
    const form = html({ lat: "40.7081", lng: "-73.9571", place: "Brooklyn", t: "social" });
    expect(form).toContain('name="lat" value="40.7081"');
    expect(form).toContain('name="lng" value="-73.9571"');
    expect(form).toContain('value="Brooklyn"');
    expect(form).not.toContain("required");
  });

  it("asks only for what it can use, in a colour from the tokens", () => {
    const form = html({});
    expect(form).toContain('placeholder="Event, venue or style"');
    expect(form).toContain("placeholder:text-toner");
  });
});

describe("the day picker", () => {
  it("names each day with its count and unit, and brings the chosen one into view", () => {
    const html = renderToStaticMarkup(
      createElement(DayPicker, {
        days: [
          { nightDate: "2026-09-28", label: "Tonight", count: 5 },
          { nightDate: "2026-09-30", label: "Wed, Sep 30", count: 1 },
        ],
        selected: "2026-09-30",
        params: {},
      }),
    );
    expect(html).toContain('aria-label="Tonight, 5 places"');
    // Spoken, so the date's own comma is followed by a comma, a pause (D-072).
    expect(html).toContain('aria-label="Wed, Sep 30, 1 place"');
    const script = html.slice(html.indexOf("<script>"));
    expect(script).toContain('getElementById("day-picker")');
    expect(script).toContain("scrollLeft");
    // A hairline under the day row (D-147).
    expect(html).toContain("border-halftone border-b");
  });
});

describe("the filter row's names", () => {
  it("is not a second region called Filters, and speaks the segments' full labels", () => {
    const html = renderFilters({});
    expect(html).not.toMatch(/<section[^>]*aria-label/);
    expect(html).toContain('id="filters"');
    // The visible short word sits in the pill inside the link the full label names.
    expect(html).toMatch(/aria-label="Clubs and DJ nights"[^>]*><span[^>]*>Clubs</);
    expect(html).not.toContain("lg:inline");
  });
});

describe("stamps off the rail", () => {
  it("read the same on any night whatever the list holds: evening bare, morning marked", () => {
    const reference = meridiemReference("2026-10-03", NY, NOW, false);
    const at = (hour: number) => localInstant("2026-10-03", NY, hour);
    expect(railStamp(at(18), NY, "en-US", reference, false)).toBe("6:00");
    expect(railStamp(at(9), NY, "en-US", reference, false)).toBe("9:00am");
  });
});

describe("review of 2026-09-28: the home fixes, second round", () => {
  it("moves the centre to a metro a search names, and keeps it for any other search", () => {
    const outside = { lat: "41.0589", lng: "-73.6228", t: "social" };
    expect(resolvePlace({ ...outside, place: "new york" }, "New York")).toEqual({
      t: "social",
    });
    expect(resolvePlace({ ...outside, place: "Boston" }, "New York")).toEqual({
      ...outside,
      place: "Boston",
    });
    expect(resolvePlace(outside, "New York")).toEqual(outside);
  });

  it("leads with the pipeline's own untagged price, not the students' tier", () => {
    const priced = (text: string): Listing => ({
      ...listing("p", "social", ["salsa"]),
      isFree: false,
      prices: parsePriceText(text, "USD"),
    });
    expect(cardPrice(priced("$20, $15 students"), "en-US")).toBe("$20");
    expect(cardPrice(priced("$25; $15 with student ID"), "en-US")).toBe("$25");
    // A lone students' price is not what anyone pays at the door.
    expect(cardPrice(priced("Students $12"), "en-US")).toBe("From $12");
  });

  it("answers a search from a point in no metro", () => {
    const html = renderToStaticMarkup(
      createElement(Header, {
        place: null,
        dayLabel: "Tonight",
        isTonight: true,
        isTomorrow: false,
        nightDate: "2026-09-28",
        count: 0,
        locale: "en-US",
        params: {},
        unmatchedQuery: "Boston",
        coveredPlace: "New York",
        unopenedDay: null,
      }),
    );
    expect(html).toContain("We can&#x27;t look up Boston yet.");
    expect(html).not.toContain("Showing places near");
  });
});
