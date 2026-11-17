// The detail page's awkward parts (DESIGN.md section 7): where the now rule falls in the When
// rail, what the copy says when a fact is not listed, the .ics text, and the seed's one listing
// whose two sources disagree about the end time. The formatting helpers are pure, so these run
// without a DOM; the sources section is rendered to static markup to prove both values reach the
// page, because "the source name is the label" is the whole point of that block.

import { readFileSync } from "node:fs";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { metadata as layoutMetadata } from "@/app/layout";
import { sourceLabel } from "@/src/data/listing-mapper";
import { listingsFromSeed } from "@/src/data/mock-repository";
import { seedNyc } from "@/src/db/seed/nyc";
import type { Listing, ListingSource, PlacedListing } from "@/src/domain/listing";
import {
  addressBesideName,
  backLink,
  calendarPath,
  costRows,
  dateLine,
  detailTypeLabel,
  directionsUrls,
  eventJsonLd,
  expectRows,
  formatDistance,
  icsFilename,
  icsFor,
  nowRuleIndex,
  pageTitle,
  placeQuery,
  placeUrls,
  showsNowRule,
  sourceValueRows,
  sourcesDisagree,
  timesInZoneAt,
  titleTypeWord,
  whenRows,
  zoneLabel,
} from "@/src/ui/detail/format";
import { eventLink, nightOutcome, outboundLinks } from "@/src/ui/links";
import { Actions } from "@/src/ui/detail/actions";
import { BackLink, cameFromHome } from "@/src/ui/detail/back-link";
import { PREVIOUS_PAGE_KEY, navMemoryScript } from "@/src/ui/detail/nav-memory-script";
import { CostSection } from "@/src/ui/detail/cost";
import { ExpectSection } from "@/src/ui/detail/expect";
import { SourcesSection } from "@/src/ui/detail/sources";
import { TitleBlock } from "@/src/ui/detail/title-block";
import { WhenSection } from "@/src/ui/detail/when";
import { WhereSection } from "@/src/ui/detail/where";
import { ShareButton } from "@/src/ui/detail/share-button";
import { t } from "@/src/i18n";
import { CRAWL_INTERVAL_MS } from "@/src/pipeline/http";
import { parseHomeParams } from "@/src/ui/home/params";
import { typeRepeatsFamily } from "@/src/ui/stocks";
import { describeInProcessZones } from "./processZone";

const NY = "America/New_York";
/** Sunday 20 September 2026, 7:42pm in New York: the design's own first paint. */
const NOW = new Date("2026-09-20T23:42:00Z");

/** A Sunday night listing shaped like the wireframe's Midtown Sunday Hop. */
function listing(overrides: Partial<PlacedListing> = {}): PlacedListing {
  const base: PlacedListing = {
    id: "evt-1",
    slug: "midtown-sunday-hop-2026-09-20",
    title: "Midtown Sunday Hop",
    listingType: "social",
    styles: ["lindy_hop"],
    families: ["swing"],
    doorsAt: new Date("2026-09-20T23:30:00Z"),
    lessonAt: new Date("2026-09-21T00:00:00Z"),
    dancingAt: new Date("2026-09-21T01:00:00Z"),
    endsAt: new Date("2026-09-21T04:30:00Z"),
    startsAt: new Date("2026-09-21T01:00:00Z"),
    nightDate: "2026-09-20",
    tz: NY,
    venue: {
      id: "ven-1",
      name: "You Should Be Dancing",
      location: { lat: 40.7505, lng: -73.9934 },
      address: {
        line1: "412 8th Ave",
        line2: "3rd floor",
        locality: "New York",
        region: "NY",
        postcode: "10001",
        countryCode: "US",
        formatted: null,
      },
      neighborhood: "Midtown",
      googlePlaceId: null,
      kind: "studio",
      danceFloor: "yes",
    },
    organizer: { name: "Midtown Hop", websiteUrl: "https://midtownhop.com", socials: {} },
    prices: [
      { label: "Social only", amount: 12, currency: "USD", includes: null },
      { label: "Lesson plus social", amount: 18, currency: "USD", includes: "Beginner lesson" },
    ],
    isFree: false,
    ticketUrl: null,
    level: "All levels",
    partnerRequired: false,
    ageMin: null,
    dressCode: null,
    floor: "Wood",
    indoorOutdoor: "indoor",
    music: { djs: ["DJ Ray"], bands: [], genreMix: "70% lindy, 30% blues", liveMusic: false },
    crowdSizeHint: "About 150 people",
    recurrenceText: "Every Sunday",
    confirmation: "confirmed_today",
    confidence: 0.8,
    summary: "Weekly lindy hop social with a beginner lesson first.",
    sources: [],
    status: "active",
    canonicalUrl: null,
    distanceKm: 3.86,
    liveStatus: null,
  };
  return { ...base, ...overrides };
}

/**
 * The same night with no time listed (D-060): every start-ish time null, the night the only date
 * fact. Shaped like the wireframe's Brooklyn Social.
 */
function untimed(overrides: Partial<PlacedListing> = {}): PlacedListing {
  return listing({
    slug: "brooklyn-social-2026-09-20",
    title: "Brooklyn Social",
    doorsAt: null,
    lessonAt: null,
    dancingAt: null,
    startsAt: null,
    endsAt: null,
    recurrenceText: null,
    confirmation: "recurring_unconfirmed",
    liveStatus: { kind: "time_not_listed", text: "Time not listed", endNotListed: true },
    ...overrides,
  });
}

/** 2am on the morning after the night of 20 September, New York: a listed end past midnight. */
const TWO_AM = new Date("2026-09-21T06:00:00Z");

/** Unfold RFC 5545 continuation lines ("\r\n " joins the next line). */
const unfold = (ics: string): string => ics.replaceAll("\r\n ", "");

describeInProcessZones("detail formatting", () => {
  it("stamps doors, lesson, dancing and ends in time order", () => {
    const rows = whenRows(listing());
    expect(rows.map((r) => r.key)).toEqual(["doors", "lesson", "dancing", "ends"]);
    expect(rows.map((r) => r.time)).toEqual(["7:30pm", "8pm", "9pm", "12:30am"]);
    // "All levels" promises the lesson takes newcomers, so the row says so.
    expect(rows[1]?.label).toBe("Lesson, beginner friendly");
  });

  it("renders every time through formatTime, so a 24-hour locale reads 19:30", () => {
    expect(whenRows(listing(), "de-DE").map((r) => r.time)).toEqual([
      "19:30",
      "20:00",
      "21:00",
      "00:30",
    ]);
  });

  it("says the end is not listed instead of inventing one", () => {
    const rows = whenRows(listing({ endsAt: null }));
    const ends = rows.at(-1);
    expect(ends?.key).toBe("ends");
    expect(ends?.at).toBeNull();
    expect(ends?.time).toBeNull();
    expect(ends?.label).toBe("End not listed");
  });

  it("puts the now rule between the rows it falls between", () => {
    const rows = whenRows(listing());
    // 7:42pm: doors have opened, the lesson has not started.
    expect(nowRuleIndex(rows, NOW)).toBe(1);
    expect(nowRuleIndex(rows, new Date("2026-09-20T23:00:00Z"))).toBe(0);
    expect(nowRuleIndex(rows, new Date("2026-09-21T02:00:00Z"))).toBe(3);
  });

  it("draws no now rule on a night that is not tonight", () => {
    expect(showsNowRule(listing(), NOW)).toBe(true);
    expect(showsNowRule(listing(), new Date("2026-09-19T23:42:00Z"))).toBe(false);
    expect(showsNowRule(listing(), new Date("2026-09-21T05:00:00Z"))).toBe(false);
  });

  it("lists every price tier, and the spec's phrase when none is listed", () => {
    expect(costRows(listing())).toEqual([
      { amount: "$12", label: "Social only", includes: null },
      { amount: "$18", label: "Lesson plus social", includes: "Includes Beginner lesson" },
    ]);
    expect(costRows(listing({ prices: [] }))).toEqual([
      { amount: null, label: "Cover not listed", includes: null },
    ]);
    expect(costRows(listing({ prices: [], isFree: true }))).toEqual([
      { amount: null, label: "Free", includes: null },
    ]);
  });

  it("says Not listed rather than hiding a fact we do not have", () => {
    const rows = expectRows(listing());
    const value = (key: string) => rows.find((r) => r.key === key)?.value;
    expect(value("dress")).toBe("Not listed");
    expect(value("floor")).toBe("Wood, indoor");
    expect(value("music")).toBe("DJ; 70% lindy, 30% blues");
    expect(value("partner")).toBe("Not needed");
    // An unknown age is not "All ages" (D-061): a 21+ night that does not say so is not open to all.
    expect(value("age")).toBe("Not listed");
    expect(value("crowd")).toBe("About 150 people");
    // The ExpectSection will omit rows with value "Not listed" and show a summary line
  });

  it("says All ages only when the page says so, and the minimum when it gives one", () => {
    const age = (ageMin: number | null) =>
      expectRows(listing({ ageMin })).find((r) => r.key === "age")?.value;
    expect(age(null)).toBe("Not listed");
    expect(age(0)).toBe("All ages");
    expect(age(21)).toBe("21+");
  });

  it("uses the detail page's long type wording, not the card's short one", () => {
    expect(detailTypeLabel("social")).toBe("Social dance");
    expect(detailTypeLabel("outdoor_public")).toBe("Outdoor public dance");
  });

  it("names the zone in words rather than an IANA identifier", () => {
    expect(zoneLabel(NY, NOW, "en-US")).toBe("Eastern Daylight Time");
  });

  it("formats distance in the locale's own unit", () => {
    expect(formatDistance(3.86, "en-US")).toBe("2.4 mi");
    expect(formatDistance(3.86, "de-DE")).toBe("3,9 km");
  });
});

describeInProcessZones("detail add to calendar", () => {
  it("writes a VEVENT with CRLF lines, escaped text and no invented end", () => {
    const ics = icsFor(listing(), "https://dancetonight.example/e/midtown-sunday-hop", NOW);
    expect(icsFilename(listing())).toBe("midtown-sunday-hop-2026-09-20.ics");
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics).toContain("DTSTART:20260921T010000Z");
    expect(ics).toContain("DTEND:20260921T043000Z");
    // Commas inside a value are escaped, never left to split the property.
    expect(ics).toContain("LOCATION:You Should Be Dancing\\, 412 8th Ave\\, 3rd floor");
    const encoder = new TextEncoder();
    for (const line of ics.split("\r\n")) {
      expect(encoder.encode(line).length).toBeLessThanOrEqual(75);
    }
    const noEnd = icsFor(listing({ endsAt: null }), "https://dancetonight.example/e/x", NOW);
    expect(noEnd).not.toContain("DTEND");
    // Unfolded (RFC 5545 continuations are "\r\n "), the description says the end is not listed.
    expect(noEnd.replaceAll("\r\n ", "")).toContain("End not listed");
  });

  it("escapes a semicolon in a text value, as RFC 5545 section 3.3.11 requires", () => {
    const ics = unfold(icsFor(listing({ title: "Salsa; bachata" }), "https://x.example/e", NOW));
    expect(ics).toContain("SUMMARY:Salsa\\; bachata\r\n");
  });
});

describeInProcessZones("detail, a listing whose time is not listed (D-060)", () => {
  it("opens the When list with a Time not listed row whose rail cell is empty", () => {
    const rows = whenRows(untimed());
    expect(rows).toEqual([{ key: "start", at: null, time: null, label: "Time not listed" }]);
  });

  it("follows it with Ends only when an end is listed, past midnight included", () => {
    const rows = whenRows(untimed({ endsAt: TWO_AM }));
    expect(rows.map((r) => [r.key, r.time, r.label])).toEqual([
      ["start", null, "Time not listed"],
      ["ends", "2am", "Ends"],
    ]);
    expect(whenRows(untimed({ endsAt: TWO_AM }), "de-DE")[1]?.time).toBe("02:00");
  });

  it("draws no now rule, tonight or any night", () => {
    expect(showsNowRule(untimed(), NOW)).toBe(false);
    expect(showsNowRule(untimed({ endsAt: TWO_AM }), NOW)).toBe(false);
    expect(showsNowRule(untimed({ nightDate: "2026-09-21" }), NOW)).toBe(false);
    // The rule index itself ignores the empty row, so nothing could place it there either.
    expect(nowRuleIndex(whenRows(untimed()), NOW)).toBe(0);
  });

  it("names the zone only when a row stamps a time", () => {
    expect(timesInZoneAt(listing(), whenRows(listing()))).toEqual(listing().startsAt);
    const withEnd = untimed({ endsAt: TWO_AM });
    expect(timesInZoneAt(withEnd, whenRows(withEnd))).toEqual(TWO_AM);
    expect(timesInZoneAt(untimed(), whenRows(untimed()))).toBeNull();
  });

  it("renders the When section with an empty rail cell, no rule and no zone line", () => {
    const html = renderToStaticMarkup(createElement(WhenSection, { listing: untimed(), now: NOW }));
    expect(html).toContain("Time not listed");
    expect(html).not.toContain('role="separator"');
    expect(html).not.toContain("Times are in");
    expect(html).not.toContain("End not listed");
    expect(html).not.toContain("type-stamp");
  });

  it("names the zone when the listed end stamps a time", () => {
    const html = renderToStaticMarkup(
      createElement(WhenSection, { listing: untimed({ endsAt: TWO_AM }), now: NOW }),
    );
    expect(html).toContain("Times are in Eastern Daylight Time");
    expect(html).toContain("2am");
    expect(html).not.toContain('role="separator"');
  });

  it("strikes nothing through when cancelled, where a timed listing strikes its times", () => {
    const cancelled = untimed({ confirmation: "cancelled", endsAt: TWO_AM });
    const html = renderToStaticMarkup(createElement(WhenSection, { listing: cancelled, now: NOW }));
    expect(html).not.toContain("line-through");
    const timed = renderToStaticMarkup(
      createElement(WhenSection, { listing: listing({ confirmation: "cancelled" }), now: NOW }),
    );
    expect(timed).toContain("line-through");
  });

  it("keeps the timed When section as it was: zone line and now rule", () => {
    const html = renderToStaticMarkup(createElement(WhenSection, { listing: listing(), now: NOW }));
    expect(html).toContain("Times are in Eastern Daylight Time");
    expect(html).toContain('role="separator"');
  });

  it("prints the domain's status in the title block, cancelled winning", () => {
    const withEnd = untimed({
      liveStatus: {
        kind: "time_not_listed",
        text: "Time not listed, until 2am",
        endNotListed: false,
      },
    });
    const html = renderToStaticMarkup(createElement(TitleBlock, { listing: withEnd, now: NOW }));
    expect(html).toContain("Time not listed, until 2am");
    // StatusLine renders the new kind in ink at regular weight, like every non-urgent status.
    expect(html).toMatch(/<p class="type-status text-ink ">Time not listed, until 2am<\/p>/);
    const cancelled = untimed({
      confirmation: "cancelled",
      liveStatus: { kind: "cancelled", text: "Cancelled tonight", endNotListed: true },
    });
    // Cancelled still wins, now on the date line beside the date it applies to (D-069).
    const cancelledHtml = renderToStaticMarkup(
      createElement(TitleBlock, { listing: cancelled, now: NOW }),
    );
    expect(cancelledHtml).toContain("Tonight · Sun, Sep 20 · Cancelled");
    expect(cancelledHtml).not.toContain("Time not listed");
  });

  it("adds an all-day calendar entry on its night, with no DTEND and no invented hour", () => {
    const ics = icsFor(untimed(), "https://dancetonight.example/e/brooklyn-social", NOW);
    expect(ics).toContain("DTSTART;VALUE=DATE:20260920\r\n");
    expect(ics).not.toContain("DTSTART:");
    expect(ics).not.toContain("DTEND");
    // One start, and it is a date: no line of the entry but DTSTAMP carries a clock time.
    const lines = ics.split("\r\n");
    expect(lines.filter((line) => line.startsWith("DTSTART"))).toEqual([
      "DTSTART;VALUE=DATE:20260920",
    ]);
    expect(lines.filter((line) => /^[A-Z;=-]+:\d{8}T\d{6}Z?$/.test(line))).toEqual([
      "DTSTAMP:20260920T234200Z",
    ]);
    const description = unfold(ics);
    expect(description).toContain("Time not listed");
    // "End not listed" under "Time not listed" would be noise, as on the page.
    expect(description).not.toContain("End not listed");
    const encoder = new TextEncoder();
    for (const line of ics.split("\r\n")) {
      expect(encoder.encode(line).length).toBeLessThanOrEqual(75);
    }
  });

  it("writes a listed end into the description, since a DATE start takes no date-time end", () => {
    const ics = icsFor(untimed({ endsAt: TWO_AM }), "https://dancetonight.example/e/b", NOW);
    expect(ics).toContain("DTSTART;VALUE=DATE:20260920\r\n");
    expect(ics).not.toContain("DTEND");
    expect(unfold(ics)).toContain("Time not listed\\, until 2am");
  });

  it("dates the entry by the stored night, across a DST night too", () => {
    // 31 October 2026 is the fall-back night in New York; the listed end is 1:30am EDT.
    const dst = untimed({
      nightDate: "2026-10-31",
      endsAt: new Date("2026-11-01T05:30:00Z"),
      confirmation: "cancelled",
    });
    const ics = icsFor(dst, "https://dancetonight.example/e/dst", NOW);
    expect(ics).toContain("DTSTART;VALUE=DATE:20261031\r\n");
    expect(unfold(ics)).toContain("Time not listed\\, until 1:30am");
    expect(ics).toContain("STATUS:CANCELLED");
    expect(whenRows(dst).map((r) => r.time)).toEqual([null, "1:30am"]);
  });

  it("gives the JSON-LD a date-only startDate and no endDate", () => {
    const json = eventJsonLd(untimed({ endsAt: TWO_AM }), "https://dancetonight.example/e/b");
    expect(json["startDate"]).toBe("2026-09-20");
    expect(json).not.toHaveProperty("endDate");
    expect(json["eventStatus"]).toBe("https://schema.org/EventScheduled");
    const cancelled = eventJsonLd(untimed({ confirmation: "cancelled" }), "https://x.example");
    expect(cancelled["eventStatus"]).toBe("https://schema.org/EventCancelled");
  });

  it("keeps the timed JSON-LD as it was: full instants for start and end", () => {
    const json = eventJsonLd(listing(), "https://dancetonight.example/e/hop");
    expect(json["startDate"]).toBe("2026-09-21T01:00:00.000Z");
    expect(json["endDate"]).toBe("2026-09-21T04:30:00.000Z");
  });
});

describe("the seed's listing whose sources disagree", () => {
  const conflicting = listingsFromSeed(seedNyc(NOW)).find((l) => l.confirmation === "conflicting");

  it("is in the New York seed", () => {
    expect(conflicting).toBeDefined();
    expect(conflicting?.title).toBe("Milonga Gallo Ciego");
    expect(conflicting?.sources.length).toBeGreaterThanOrEqual(2);
    expect(sourcesDisagree(conflicting as Listing)).toBe(true);
  });

  it("gives each source its own end time, so the source name is the label", () => {
    const sources = (conflicting as Listing).sources;
    const values = sources.map((source) => sourceValueRows(source).map((v) => v.text));
    // Both sources carry a value, and the two values differ: that is the disagreement.
    expect(values.every((rows) => rows.length === 1)).toBe(true);
    expect(new Set(values.flat()).size).toBe(2);
    for (const text of values.flat()) expect(text.startsWith("Ends ")).toBe(true);
  });

  it("renders both values beneath their own source row", () => {
    const listingRow = conflicting as Listing;
    const html = renderToStaticMarkup(
      createElement(SourcesSection, { listing: listingRow, now: NOW }),
    );
    for (const source of listingRow.sources) {
      expect(html).toContain(source.label);
      for (const value of sourceValueRows(source)) expect(html).toContain(value.text);
    }
    expect(html).toContain("Sources disagree; both values are shown");
  });

  it("links only the source's name, so its checked time and values are read out (review)", () => {
    // A link's aria-label is its whole accessible name: anything else inside the <a> is never
    // announced. So each link holds the source name alone, and its name contains that text.
    const listingRow = conflicting as Listing;
    const html = renderToStaticMarkup(
      createElement(SourcesSection, { listing: listingRow, now: NOW }),
    );
    const links = [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)];
    expect(links).toHaveLength(listingRow.sources.length);
    const outside = textOf(html.replace(/<a\b[^>]*>[\s\S]*?<\/a>/g, " "));
    for (const [index, source] of listingRow.sources.entries()) {
      const [, attributes = "", inner = ""] = links[index] ?? [];
      expect(textOf(inner)).toBe(source.label);
      expect(attributes).toContain(`aria-label="Open ${source.label}, opens in a new tab"`);
      for (const value of sourceValueRows(source)) expect(outside).toContain(value.text);
    }
    expect(outside.match(/checked /g)).toHaveLength(listingRow.sources.length);
  });
});

describe("map links open the venue's own listing, not a dropped pin", () => {
  const params = (url: string) => Object.fromEntries(new URL(url).searchParams);
  const NAMED = "You Should Be Dancing, 412 8th Ave, 3rd floor, New York, NY, 10001";

  it("asks Google for the named venue at its address", () => {
    expect(placeQuery(listing())).toBe(NAMED);
    const { google, apple } = placeUrls(listing());
    expect(google.startsWith("https://www.google.com/maps/search/?")).toBe(true);
    expect(params(google)).toEqual({ api: "1", query: NAMED });
    expect(params(apple)).toEqual({
      q: "You Should Be Dancing",
      ll: "40.7505,-73.9934",
      address: "412 8th Ave, 3rd floor, New York, NY, 10001",
    });
  });

  it("routes directions to the named venue", () => {
    const { google, apple } = directionsUrls(listing());
    expect(google.startsWith("https://www.google.com/maps/dir/?")).toBe(true);
    expect(params(google)).toEqual({ api: "1", destination: NAMED });
    // Apple routes to the named venue too when the address names its city (D-069).
    expect(params(apple)).toEqual({ daddr: NAMED });
  });

  it("routes Apple to the coordinates when the address names no city (D-069)", () => {
    const cityless = listing();
    cityless.venue = {
      ...cityless.venue,
      address: {
        line1: "140 2nd Ave",
        line2: null,
        locality: null,
        region: null,
        postcode: null,
        countryCode: null,
        formatted: null,
      },
    };
    // Google still gets the name beside the street; only Apple could route to another city's.
    expect(params(directionsUrls(cityless).google).destination).toBe(
      "You Should Be Dancing, 140 2nd Ave",
    );
    expect(params(directionsUrls(cityless).apple)).toEqual({ daddr: "40.7505,-73.9934" });
  });

  it("carries Google's place ID when one is known, the documented exact match", () => {
    const withId = listing();
    withId.venue = { ...withId.venue, googlePlaceId: "ChIJexample" };
    expect(params(placeUrls(withId).google)).toEqual({
      api: "1",
      query: NAMED,
      query_place_id: "ChIJexample",
    });
    expect(params(directionsUrls(withId).google)).toMatchObject({
      destination: NAMED,
      destination_place_id: "ChIJexample",
    });
  });

  it("falls back to the coordinates when no address is known, never to a bare name", () => {
    const bare = listing();
    bare.venue = { ...bare.venue, address: null };
    expect(placeQuery(bare)).toBeNull();
    expect(params(placeUrls(bare).google).query).toBe("40.7505,-73.9934");
    expect(params(directionsUrls(bare).google).destination).toBe("40.7505,-73.9934");
    expect(params(directionsUrls(bare).apple).daddr).toBe("40.7505,-73.9934");
  });
});

// ---------------------------------------------------------------------------------------------
// D-069: the fixes to the detail page from the 2026-09-28 audit of the live site. Each block
// names the settled decision it proves (C1 to C14 in the fix contract).

/** A directory's source row, as The Ronda's list page is stored: not the organiser. */
const RONDA_SOURCE: ListingSource = {
  url: "https://www.theronda.us/nyc",
  label: "theronda.us/nyc",
  checkedAt: NOW,
  byOrganiser: false,
  tier: "listing",
  eventUrl: null,
};
const RONDA_EVENT = "https://www.theronda.us/event/tango-cafe-2026-09-30-74420121";

const render = (element: Parameters<typeof renderToStaticMarkup>[0]) =>
  renderToStaticMarkup(element);
/** The markup with tags removed: what a dancer reads, in order. */
const textOf = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

describeInProcessZones("detail: the night the page is about (D-069 C1, C2, C4, C10)", () => {
  it("dates the page: tonight, tomorrow, then the plain date", () => {
    expect(dateLine(listing(), NOW)).toBe("Tonight · Sun, Sep 20");
    expect(dateLine(listing({ nightDate: "2026-09-21" }), NOW)).toBe("Tomorrow · Mon, Sep 21");
    expect(dateLine(listing({ nightDate: "2026-10-03" }), NOW)).toBe("Sat, Oct 3");
  });

  it("reads the date in US order and joins it to a word with a middle dot, never a second comma (D-072)", () => {
    const lines = [
      dateLine(listing(), NOW),
      dateLine(listing({ nightDate: "2026-09-21" }), NOW),
      dateLine(listing({ nightDate: "2026-10-01", confirmation: "cancelled" }), NOW),
      dateLine(
        listing({
          nightDate: "2026-09-19",
          liveStatus: { kind: "ended", text: "Ended", endNotListed: false },
        }),
        NOW,
      ),
      pageTitle(listing()),
    ];
    for (const line of lines) expect(line.split(",")).toHaveLength(2);
    expect(lines.every((line) => /\b(Sep|Oct) \d{1,2}\b/.test(line))).toBe(true);
  });

  it("still calls the night tonight after midnight, by the listing's own zone", () => {
    // 1:30am EDT on Monday 21 September is still Sunday's night (src/domain/tonight.ts).
    expect(dateLine(listing(), new Date("2026-09-21T05:30:00Z"))).toBe("Tonight · Sun, Sep 20");
  });

  it("puts cancelled and ended on the date line, beside the date they apply to", () => {
    const cancelled = listing({
      nightDate: "2026-10-01",
      confirmation: "cancelled",
      liveStatus: { kind: "cancelled", text: "Cancelled", endNotListed: false },
    });
    expect(nightOutcome(cancelled)).toBe("cancelled");
    expect(dateLine(cancelled, NOW)).toBe("Thu, Oct 1 · Cancelled");
    const ended = listing({
      nightDate: "2026-09-19",
      liveStatus: { kind: "ended", text: "Ended", endNotListed: false },
    });
    expect(dateLine(ended, NOW)).toBe("Sat, Sep 19 · Ended");
    // The status line would only repeat the word without the date, so it is not printed.
    const text = textOf(render(createElement(TitleBlock, { listing: cancelled, now: NOW })));
    // Now includes venue line and dot separator
    expect(text).toContain("Thu, Oct 1 · Cancelled");
    expect(text).toContain("You Should Be Dancing, Midtown");
  });

  it("prints the date line under the title and keeps the live status after it", () => {
    const live = listing({
      liveStatus: { kind: "upcoming", text: "Starts in 18 min", endNotListed: false },
    });
    const text = textOf(render(createElement(TitleBlock, { listing: live, now: NOW })));
    expect(text).toBe(
      "Swing · Social dance Midtown Sunday Hop Tonight · Sun, Sep 20 You Should Be Dancing, Midtown Every Sunday Starts in 18 min",
    );
  });

  it("shows a recurrence only when a source states one, never 'One night only'", () => {
    const oneNight = listing({ recurrenceText: null });
    const html = render(createElement(TitleBlock, { listing: oneNight, now: NOW }));
    expect(html).not.toContain("One night only");
    expect(textOf(html)).toBe(
      "Swing · Social dance Midtown Sunday Hop Tonight · Sun, Sep 20 You Should Be Dancing, Midtown",
    );
  });

  it("goes back to the listing's own night, named as the day picker names it", () => {
    expect(backLink(listing(), NOW)).toEqual({
      href: "/?day=2026-09-20",
      label: "Back to tonight",
    });
    expect(backLink(listing({ nightDate: "2026-09-21" }), NOW)).toEqual({
      href: "/?day=2026-09-21",
      label: "Back to tomorrow",
    });
    // The picker's last night, tonight + 6 (D-075).
    expect(backLink(listing({ nightDate: "2026-09-26" }), NOW)).toEqual({
      href: "/?day=2026-09-26",
      label: "Back to Sat, Sep 26",
    });
  });

  it("goes back to a night beyond the picker that the home page opens, named by its date", () => {
    // Tonight + 7 and tonight + 12, the first and last nights a link opens beyond the picker.
    expect(backLink(listing({ nightDate: "2026-09-27" }), NOW)).toEqual({
      href: "/?day=2026-09-27",
      label: "Back to Sun, Sep 27",
    });
    expect(backLink(listing({ nightDate: "2026-10-02" }), NOW)).toEqual({
      href: "/?day=2026-10-02",
      label: "Back to Fri, Oct 2",
    });
  });

  it("goes back to tonight from a night the home page does not open (review, 2026-09-28)", () => {
    const tonight = { href: "/", label: "Back to tonight" };
    // Yesterday's night, and tonight + 13, the ingest's last night, which may not be written yet:
    // the home page would open tonight for either.
    expect(backLink(listing({ nightDate: "2026-09-19" }), NOW)).toEqual(tonight);
    expect(backLink(listing({ nightDate: "2026-10-03" }), NOW)).toEqual(tonight);
    expect(backLink(listing({ nightDate: "2026-12-31" }), NOW)).toEqual(tonight);
    // 5:59am EDT on Monday is still Sunday's night; at 6:01am Sunday's night is over.
    expect(backLink(listing(), new Date("2026-09-21T09:59:00Z"))).toEqual({
      href: "/?day=2026-09-20",
      label: "Back to tonight",
    });
    expect(backLink(listing(), new Date("2026-09-21T10:01:00Z"))).toEqual(tonight);
    // Each href opens the night its label names, by the home page's own reading of `day`.
    for (const nightDate of [
      "2026-09-19",
      "2026-09-20",
      "2026-09-26",
      "2026-09-27",
      "2026-10-02",
      "2026-10-03",
    ]) {
      const back = backLink(listing({ nightDate }), NOW);
      const day = new URL(back.href, "https://dancetonight.example").searchParams.get("day");
      const opened = parseHomeParams(day === null ? {} : { day }, NOW, NY).nightDate;
      expect(opened).toBe(day ?? "2026-09-20");
    }
    // The back link's arrow is drawn by CSS, so its text and name stay the label alone (D-147).
    const backHtml = render(createElement(BackLink, { href: "/", label: "Back to tonight" }));
    expect(backHtml).toContain("no-underline");
    expect(backHtml).toContain("before:content-");
    expect(backHtml).toMatch(/>Back to tonight<\/a>$/);
  });

  it("templates every page title with the site name, and a page with none as the name alone", () => {
    expect(layoutMetadata.title).toEqual({
      default: "DanceTonight",
      template: "%s · DanceTonight",
    });
  });

  it("dates the tab and share title with the plain date, never 'Tonight'", () => {
    expect(pageTitle(listing())).toBe("Midtown Sunday Hop · Sun, Sep 20");
    expect(pageTitle(listing({ nightDate: "2026-10-03" }))).toBe("Midtown Sunday Hop · Sat, Oct 3");
  });
});

describe("detail: the back link steps back only onto our home page (D-069 C4)", () => {
  const ORIGIN = "https://dancetonight.example";

  /**
   * A browser tab: its session history (each entry a URL, its state and the referrer its document
   * was loaded with, which a reload or a back/forward load keeps), where it stands in it, and how
   * the current document was loaded. Enough of a browser to run the layout's inline script and
   * cameFromHome() as a phone would.
   */
  class FakeTab {
    entries: { url: string; state: unknown; referrer: string }[] = [];
    index = -1;
    type: "navigate" | "reload" | "back_forward" = "navigate";

    /** Run the inline script, as a document load does before hydration. */
    load(): void {
      const entry = this.entries[this.index];
      if (entry === undefined) throw new Error("no entry");
      const entries = this.entries;
      const history = {
        get length() {
          return entries.length;
        },
        get state() {
          return entry.state;
        },
        replaceState(state: unknown) {
          entry.state = structuredClone(state);
        },
      };
      const performance = { getEntriesByType: () => [{ type: this.type }] };
      new Function("performance", "history", "document", "location", navMemoryScript)(
        performance,
        history,
        { referrer: entry.referrer },
        new URL(entry.url),
      );
    }

    /** Follow a link to `url` from `from`: a new entry after this one, forward entries pruned. */
    follow(url: string, from: string = this.entries[this.index]?.url ?? ""): void {
      // Cross-origin, a browser sends only the origin (strict-origin-when-cross-origin).
      const source = from === "" ? null : new URL(from);
      const referrer =
        source === null ? "" : source.origin === ORIGIN ? source.href : `${source.origin}/`;
      this.entries = this.entries.slice(0, this.index + 1);
      this.entries.push({ url: new URL(url, ORIGIN).href, state: null, referrer });
      this.index = this.entries.length - 1;
      this.type = "navigate";
      if (new URL(url, ORIGIN).origin === ORIGIN) this.load();
    }

    /** Type an address, or open a shared link: no referrer. */
    open(url: string): void {
      this.follow(url, "");
    }

    /** The browser's back or forward button, a document load from history. */
    go(delta: number): void {
      this.index += delta;
      this.type = "back_forward";
      const entry = this.entries[this.index];
      if (entry !== undefined && new URL(entry.url).origin === ORIGIN) this.load();
    }

    reload(): void {
      this.type = "reload";
      this.load();
    }

    /** What the back link decides on the current entry. */
    cameFromHome(): boolean {
      const entry = this.entries[this.index];
      const globals = globalThis as Record<string, unknown>;
      globals.window = {
        history: { state: entry?.state ?? null, length: this.entries.length },
        location: { origin: ORIGIN },
      };
      try {
        return cameFromHome();
      } finally {
        delete globals.window;
      }
    }
  }
  const fakeTab = () => new FakeTab();

  const HOME = "/?day=2026-10-03&t=social";
  const EVENT = "/e/salsa-2026-10-03";

  it("steps back from a card tapped on the home page, and still does after a reload", () => {
    const tab = fakeTab();
    tab.open(HOME);
    tab.follow(EVENT);
    expect(tab.entries[1]?.state).toEqual({ [PREVIOUS_PAGE_KEY]: HOME });
    expect(tab.cameFromHome()).toBe(true);
    tab.reload();
    expect(tab.cameFromHome()).toBe(true);
    // Back to the list, then forward to the page again: the entry keeps what is behind it.
    tab.go(-1);
    tab.go(1);
    expect(tab.cameFromHome()).toBe(true);
  });

  it("keeps the router's own keys on the entry", () => {
    const tab = fakeTab();
    tab.open(HOME);
    tab.follow(EVENT);
    const entry = tab.entries[1];
    if (entry === undefined) throw new Error("no entry");
    entry.state = { __NA: true, tree: ["e"] };
    tab.type = "navigate";
    tab.load();
    expect(entry.state).toEqual({ __NA: true, tree: ["e"], [PREVIOUS_PAGE_KEY]: HOME });
  });

  it("follows the href in a tab opened on the page, even after coming back to it", () => {
    // A shared link, or a card opened in a new tab from our own home page: nothing is behind.
    const tab = fakeTab();
    tab.entries = [{ url: `${ORIGIN}${EVENT}`, state: null, referrer: `${ORIGIN}${HOME}` }];
    tab.index = 0;
    tab.load();
    expect(tab.cameFromHome()).toBe(false);
    // Its href to the list, then the browser's back: the list is ahead now, not behind, though
    // the page's own referrer is still our home page and the tab now has two entries.
    tab.follow("/?day=2026-10-03");
    tab.go(-1);
    expect(tab.cameFromHome()).toBe(false);
    tab.reload();
    expect(tab.cameFromHome()).toBe(false);
  });

  it("follows the href when the page behind is another site, even one reached from our list", () => {
    const tab = fakeTab();
    tab.open(HOME);
    // A search result on another site: its referrer is that site's origin, whose path is "/".
    tab.follow("https://www.google.com/search?q=salsa");
    tab.follow(`${ORIGIN}${EVENT}`);
    expect(tab.entries[2]?.referrer).toBe("https://www.google.com/");
    expect(tab.cameFromHome()).toBe(false);
  });

  it("follows the href from another page of ours, from a typed address, and on a reload", () => {
    const fromBot = fakeTab();
    fromBot.open("/bot");
    fromBot.follow(EVENT);
    expect(fromBot.cameFromHome()).toBe(false);
    const typed = fakeTab();
    typed.open(HOME);
    typed.open(EVENT);
    expect(typed.cameFromHome()).toBe(false);
    typed.reload();
    expect(typed.cameFromHome()).toBe(false);
  });
});

describe("detail: the action row once the night is over (D-069 C5, C12)", () => {
  const organiser: ListingSource = {
    url: "https://midtownhop.com",
    label: "midtownhop.com",
    checkedAt: NOW,
    byOrganiser: true,
    tier: "organizer",
    eventUrl: null,
  };
  const selling = listing({ ticketUrl: "https://midtownhop.com/tickets", sources: [organiser] });
  const summaryOf = (html: string) => /<summary class="([^"]*)"/.exec(html)?.[1] ?? "";

  it("leads with spot directions and tickets while the night is ahead", () => {
    const html = render(createElement(Actions, { listing: selling }));
    expect(html).toContain("Get tickets");
    expect(summaryOf(html)).toContain("bg-ink");
  });

  it("sells nothing on a cancelled or ended night, and steps directions down to secondary", () => {
    for (const liveStatus of [
      { kind: "cancelled" as const, text: "Cancelled tonight", endNotListed: false },
      { kind: "ended" as const, text: "Ended", endNotListed: false },
    ]) {
      const over = { ...selling, liveStatus };
      const html = render(createElement(Actions, { listing: over }));
      expect(html).not.toContain("Get tickets");
      expect(summaryOf(html)).not.toContain("bg-spot");
      // Now uses chip-edge instead of border-ink
      expect(summaryOf(html)).toContain("chip-edge");
      expect(render(createElement(CostSection, { listing: over }))).not.toContain("Tickets at");
    }
    // A cancellation the source states, with no live status, counts too.
    const stated = { ...selling, confirmation: "cancelled" as const, liveStatus: null };
    expect(render(createElement(Actions, { listing: stated }))).not.toContain("Get tickets");
  });

  it("adds to the calendar with a plain link to the .ics route, not a blob download", () => {
    expect(calendarPath(listing())).toBe("/e/midtown-sunday-hop-2026-09-20/calendar.ics");
    const html = render(createElement(Actions, { listing: selling }));
    expect(html).toMatch(
      /<a class="[^"]*" href="\/e\/midtown-sunday-hop-2026-09-20\/calendar.ics" type="text\/calendar">Add to calendar<\/a>/,
    );
    expect(html).not.toContain("download");
    // The calendar link is now in the same flex row as other buttons
    expect(html).toContain("grow basis-40");
  });
});

describeInProcessZones("detail: When rows at the same instant (D-069 C6)", () => {
  const three = new Date("2026-09-20T19:00:00Z"); // 3pm EDT

  it("drops doors that open with the lesson", () => {
    const rows = whenRows(listing({ doorsAt: new Date("2026-09-21T00:00:00Z") }));
    expect(rows.map((r) => r.key)).toEqual(["lesson", "dancing", "ends"]);
  });

  it("keeps the lesson alone when doors, lesson and dancing all read 3pm (Tango Y Te)", () => {
    const rows = whenRows(
      listing({ doorsAt: three, lessonAt: three, dancingAt: three, startsAt: three }),
    );
    expect(rows.map((r) => [r.key, r.time])).toEqual([
      ["lesson", "3pm"],
      ["ends", "12:30am"],
    ]);
  });

  it("drops doors that open with the dancing when there is no lesson", () => {
    const rows = whenRows(listing({ doorsAt: three, lessonAt: null, dancingAt: three }));
    expect(rows.map((r) => r.key)).toEqual(["dancing", "ends"]);
  });

  it("sets the rail from the detail rail token, wide enough for 12:30am", () => {
    const when = render(createElement(WhenSection, { listing: listing(), now: NOW }));
    expect(when).toContain("grid-cols-rail-detail");
    expect(when).not.toContain("5ch");
    const css = readFileSync("app/globals.css", "utf8");
    expect(css).toMatch(/--grid-template-columns-rail-detail:\s*4\.75rem minmax\(0, 1fr\);/);
  });
});

describe("detail: cost rows in the page's own words (D-069 C7)", () => {
  const tier = (label: string, amount: number | null, includes: string | null = null) => ({
    label,
    amount,
    currency: "USD",
    includes,
  });
  const rows = (...prices: ReturnType<typeof tier>[]) => costRows(listing({ prices }));

  it("drops a label that only repeats the amount", () => {
    expect(rows(tier("$11", 11), tier("11.00", 11), tier("USD 20", 20))).toEqual([
      { amount: "$11", label: null, includes: null },
      { amount: "$11", label: null, includes: null },
      { amount: "$20", label: null, includes: null },
    ]);
    expect(rows(tier("Free", 0))).toEqual([{ amount: "Free", label: null, includes: null }]);
    // A label that says more than the amount stays.
    expect(rows(tier("$11 at the door", 11))[0]?.label).toBe("$11 at the door");
  });

  it("maps door and advance to the page's copy and starts every other label with a capital", () => {
    expect(rows(tier("door", 15), tier("advance", 10), tier("complementary", 0))).toEqual([
      { amount: "$15", label: "Door", includes: null },
      { amount: "$10", label: "Advance", includes: null },
      { amount: "Free", label: "Complementary", includes: null },
    ]);
  });

  it("keeps Includes for what the price covers, and moves an audience to the tier's name", () => {
    expect(rows(tier("door", 15, "General Public"), tier("$10", 10, "Students"))).toEqual([
      { amount: "$15", label: "Door, general public", includes: null },
      { amount: "$10", label: "Students", includes: null },
    ]);
    // "$11  $11  Includes general admission" on the live site becomes one line.
    expect(rows(tier("$11", 11, "general admission"))).toEqual([
      { amount: "$11", label: "Includes general admission", includes: null },
    ]);
    expect(rows(tier("Lesson plus social", 18, "Beginner lesson"))).toEqual([
      { amount: "$18", label: "Lesson plus social", includes: "Includes Beginner lesson" },
    ]);
  });

  it("sets each label on its amount's baseline, in Cost and in What to expect", () => {
    const cost = render(createElement(CostSection, { listing: listing() }));
    expect(cost).toContain("grid-cols-rail-detail grid items-baseline");
    const expectations = render(createElement(ExpectSection, { listing: listing() }));
    expect(expectations).toContain("grid-cols-subgrid items-baseline");
  });
});

describe("detail: the type word beside the chip (D-069 C8)", () => {
  it("hides a type the chip already says, the card's own rule", () => {
    expect(typeRepeatsFamily("club_night", "club")).toBe(true);
    expect(typeRepeatsFamily("club_night", "salsa")).toBe(false);
    expect(typeRepeatsFamily("club_night", undefined)).toBe(false);
    const club = listing({ listingType: "club_night", styles: [], families: ["club"] });
    expect(titleTypeWord(club)).toBeNull();
    const salsa = listing({ listingType: "club_night", styles: ["salsa"], families: ["salsa"] });
    expect(titleTypeWord(salsa)).toBe("Club or DJ night");
  });

  it("hides 'Other', which tells a dancer nothing", () => {
    const other = listing({ listingType: "other", styles: [], families: ["tango"] });
    expect(titleTypeWord(other)).toBeNull();
    const text = textOf(render(createElement(TitleBlock, { listing: other, now: NOW })));
    expect(text.startsWith("Tango Midtown Sunday Hop")).toBe(true);
    expect(titleTypeWord(listing())).toBe("Social dance");
  });
});

describe("detail: source labels are never cut mid-word (D-069 C9)", () => {
  const cases: [string, string][] = [
    [
      "https://www.ticketmaster.com/bolden-who-you-really-are-tour-2026-new-york-new-york-10-01-2026/event/3B00630CE2",
      "ticketmaster.com",
    ],
    ["https://www.axs.com/events/1566230/beats-vibes-and-rose-tickets", "axs.com/events/1566230/…"],
    ["https://www.eventbrite.com/o/ecstatic-dance-nyc-33937979455", "eventbrite.com"],
    ["https://sobs.com/calendar", "sobs.com/calendar"],
    ["https://sobs.com/calendar/", "sobs.com/calendar"],
    ["https://frimframjam.com/", "frimframjam.com"],
    ["https://steppingoutstudios.com/social-events1", "steppingoutstudios.com"],
  ];

  it.each(cases)("%s reads %s", (url, label) => {
    expect(sourceLabel(url)).toBe(label);
  });

  it("keeps every cut on a / and within 40 characters", () => {
    for (const [url] of cases) {
      const label = sourceLabel(url);
      const parsed = new URL(url);
      const full = `${parsed.hostname.replace(/^www\./, "")}${parsed.pathname}`;
      expect(label.length).toBeLessThanOrEqual(40);
      if (label.endsWith("/…")) expect(full.startsWith(label.slice(0, -1))).toBe(true);
      else expect(full.replace(/\/$/, "").startsWith(label)).toBe(true);
    }
  });
});

describe("detail: an event page is never 'Get tickets' (D-069 C13)", () => {
  it("shows a listings site's event page as the event page, on rows stored either way", () => {
    // Stored before D-070: the event page in ticketUrl, the list page as canonical.
    const old = listing({
      ticketUrl: RONDA_EVENT,
      canonicalUrl: RONDA_SOURCE.url,
      sources: [RONDA_SOURCE],
    });
    expect(outboundLinks(old)).toEqual({ tickets: null, eventPage: RONDA_EVENT });
    // Stored after D-070: no ticket URL, the event page as canonical.
    const fresh = listing({ ticketUrl: null, canonicalUrl: RONDA_EVENT, sources: [RONDA_SOURCE] });
    expect(outboundLinks(fresh)).toEqual({ tickets: null, eventPage: RONDA_EVENT });

    for (const row of [old, fresh]) {
      const actions = render(createElement(Actions, { listing: row }));
      expect(actions).not.toContain("Get tickets");
      expect(textOf(actions)).toContain("Event page at theronda.us");
      expect(render(createElement(CostSection, { listing: row }))).not.toContain("Tickets at");
      const offers = eventJsonLd(row, "https://x.example")["offers"] as Record<string, unknown>[];
      for (const offer of offers) expect(offer).not.toHaveProperty("url");
    }
  });

  it("keeps a real ticket page, and does not repeat a source row or the ticket page", () => {
    const organiser: ListingSource = {
      url: "https://midtownhop.com",
      label: "midtownhop.com",
      checkedAt: NOW,
      byOrganiser: true,
      tier: "organizer",
      eventUrl: null,
    };
    const tickets = "https://midtownhop.com/tickets";
    const withSource = listing({
      ticketUrl: tickets,
      canonicalUrl: organiser.url,
      sources: [organiser],
    });
    expect(outboundLinks(withSource)).toEqual({ tickets, eventPage: null });
    const same = listing({ ticketUrl: tickets, canonicalUrl: tickets, sources: [organiser] });
    expect(outboundLinks(same)).toEqual({ tickets, eventPage: null });
    const html = render(createElement(Actions, { listing: same }));
    expect(html).toContain("Get tickets");
    expect(html).not.toContain("Event page at");
  });

  it("keeps the event page and drops the tickets once the night is cancelled", () => {
    const cancelled = listing({
      ticketUrl: "https://midtownhop.com/tickets",
      canonicalUrl: "https://midtownhop.com/events/sunday-hop",
      confirmation: "cancelled",
      sources: [RONDA_SOURCE],
    });
    expect(outboundLinks(cancelled)).toEqual({
      tickets: null,
      eventPage: "https://midtownhop.com/events/sunday-hop",
    });
  });
});

describe("detail: the page's links out are the card's, in the card's words (D-073)", () => {
  const organiser: ListingSource = {
    url: "https://steppingoutstudios.com/social-events1",
    label: "steppingoutstudios.com/social-events1",
    checkedAt: NOW,
    byOrganiser: true,
    tier: "organizer",
    eventUrl: null,
  };
  const ronda: ListingSource = { ...RONDA_SOURCE, eventUrl: RONDA_EVENT };
  /** The first row of the action row: directions, then tickets, then the event page. */
  const firstRow = (html: string) =>
    /<div class="flex[^"]*">.*?<\/details>(.*?)<\/div><div/.exec(html)?.[1] ?? "";
  const hrefOf = (html: string, text: string) =>
    new RegExp(`<a[^>]*href="([^"]*)"[^>]*>${text}</a>`).exec(html)?.[1] ?? null;

  it("sells from the card's ticket page, and COST names it in the card's words", () => {
    const row = listing({
      ticketUrl: "https://www.eventbrite.com/e/midtown-sunday-hop-tickets-123",
      sources: [organiser],
    });
    const link = eventLink(row);
    expect(link?.kind).toBe("tickets");
    const actions = render(createElement(Actions, { listing: row }));
    expect(hrefOf(actions, "Get tickets")).toBe(link?.href);
    expect(textOf(render(createElement(CostSection, { listing: row })))).toContain(link?.text);
    expect(textOf(actions)).not.toContain("Listed on");
  });

  it("puts the event's own page in the first row as a secondary button, before the calendar", () => {
    const row = listing({ sources: [ronda] });
    const link = eventLink(row);
    expect(link?.kind).toBe("event");
    const actions = render(createElement(Actions, { listing: row }));
    // The event page button is now in the same flex row
    expect(actions).toContain("Event page at theronda.us");
    // Check that it's a secondary button with chip-edge
    expect(actions).toContain("chip-edge");
    expect(actions).not.toContain("bg-spot");
    expect(actions.indexOf("Event page at")).toBeLessThan(actions.indexOf("Add to calendar"));
    expect(textOf(actions)).not.toContain("Listed on");
  });

  it("names a page that only lists the night for what it is, scrolled to the title", () => {
    const row = listing({ sources: [organiser] });
    const link = eventLink(row);
    expect(link?.kind).toBe("listed");
    const actions = render(createElement(Actions, { listing: row }));
    expect(actions).not.toContain("Event page at");
    expect(firstRow(actions)).not.toContain("<a");
    const line = /<p class="mt-2">(.*?)<\/p>/.exec(actions)?.[1] ?? "";
    expect(textOf(line)).toBe("Listed on steppingoutstudios.com");
    expect(line).toContain(`href="${link?.href ?? "missing"}"`);
    expect(line).toContain("#:~:text=");
    expect(line).toContain("type-secondary text-toner");
    expect(line).not.toContain("text-spot");
    expect(line).toContain("min-h-11");
  });

  it("keeps a cancelled night's ticket page as its event page, and sells nothing", () => {
    const row = listing({
      ticketUrl: "https://www.eventbrite.com/e/midtown-sunday-hop-tickets-123",
      confirmation: "cancelled",
      sources: [organiser],
    });
    expect(eventLink(row)?.text).toBe("Event page at eventbrite.com");
    const actions = render(createElement(Actions, { listing: row }));
    expect(actions).not.toContain("Get tickets");
    expect(actions).toContain("Event page at eventbrite.com");
  });

  it("retires the page's own copies of the words, so they cannot drift from the card's", () => {
    const en = readFileSync("src/i18n/en.ts", "utf8");
    expect(en.match(/"Event page at \{site\}"/g)).toHaveLength(1);
    expect(en.match(/"Tickets at \{site\}"/g)).toHaveLength(1);
  });
});

describe("/bot says what the crawler does, in words t() pluralises (review, 2026-09-28)", () => {
  it("states the interval through a plural leaf, counted from CRAWL_INTERVAL_MS", () => {
    expect(t("bot.how", { count: CRAWL_INTERVAL_MS / 1000 })).toContain(
      "at most one request every 5 seconds to each site",
    );
    // Never "every 1 seconds": the one form is its own sentence.
    expect(t("bot.how", { count: 1 })).toContain("at most one request a second to each site");
  });

  it("promises conditional requests only with a validator, never that unchanged pages are skipped", () => {
    // src/pipeline/http.ts sends If-None-Match and If-Modified-Since only when the caller has a
    // stored ETag or Last-Modified; a first read, and a probe, send neither.
    for (const count of [1, CRAWL_INTERVAL_MS / 1000]) {
      const how = t("bot.how", { count });
      expect(how).not.toMatch(/only asks for pages that have changed/);
      expect(how).toContain("When an earlier visit gave it a page's ETag or Last-Modified date");
    }
  });
});

describe("a venue named by its own address prints it once (brief F17)", () => {
  const formatted = "37 W 26th St, 2nd floor, NYC";
  const byAddress = (name: string) =>
    listing({
      venue: {
        ...listing().venue,
        name,
        neighborhood: null,
        address: { ...listing().venue.address!, formatted },
      },
    });
  it("prints no address under a name that is the address", () => {
    expect(addressBesideName(byAddress("37 W 26th St, 2nd Floor, NYC"))).toBeNull();
    expect(addressBesideName(byAddress("YSBD"))).toBe(formatted);
    const html = renderToStaticMarkup(
      createElement(WhereSection, { listing: byAddress(formatted), fallbackStyles: null }),
    );
    expect(html.split("37 W 26th St").length - 1).toBe(1);
    expect(html).not.toContain(t("common.notListed"));
  });
  it("names it once in the calendar file", () => {
    const ics = icsFor(byAddress(formatted), "https://dancetonight.example/e/x", NOW);
    expect(ics).toContain("LOCATION:37 W 26th St\\, 2nd floor\\, NYC\r\n");
  });
});
it("renders one dt/dd pair when only level is known and a line for the rest", () => {
  const onlyLevel = listing({
    level: "All levels",
    partnerRequired: null,
    ageMin: null,
    floor: null,
    indoorOutdoor: null,
    music: null,
    dressCode: null,
    crowdSizeHint: null,
  });
  const html = render(createElement(ExpectSection, { listing: onlyLevel }));
  // Should contain "Level" and "All levels"
  expect(html).toContain("Level");
  expect(html).toContain("All levels");
  // Should contain the summary line with the other fields
  expect(html).toContain("Not listed: partner, age, floor, music, dress code, crowd.");
});

it("renders no dl when all rows are unknown", () => {
  const allUnknown = listing({
    level: null,
    partnerRequired: null,
    ageMin: null,
    floor: null,
    indoorOutdoor: null,
    music: null,
    dressCode: null,
    crowdSizeHint: null,
  });
  const html = render(createElement(ExpectSection, { listing: allUnknown }));
  expect(html).not.toContain("<dl");
  expect(html).toContain("Not listed: level, partner, age, floor, music, dress code, crowd.");
});

it("title block contains border-stock-family and venue line", () => {
  const html = render(createElement(TitleBlock, { listing: listing(), now: NOW }));
  expect(html).toContain("border-stock-swing");
  expect(html).toContain("You Should Be Dancing, Midtown");
});
it("share button uses type-body text-toner", () => {
  const html = render(createElement(ShareButton, { url: "https://example.com", title: "Test" }));
  expect(html).toContain("type-body text-toner");
  expect(html).not.toContain("type-label text-spot");
});
