// What kind of page a URL is (D-073): the rules the ingest and the card both apply.

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  isCollectionPage,
  isHomePage,
  isHostedEventPage,
  isPlatformEventPage,
  isTicketingEventPage,
  isTicketingHost,
  looksLikeEventPage,
} from "@/src/domain/event-links";

describe("looksLikeEventPage", () => {
  it.each([
    "https://www.theronda.us/event/tango-cafe-2026-09-30-74420121",
    "https://www.nycswings.net/e/flow-fridays/",
    "https://sobs.com/events/desi-saturdays-10-3-26/",
    "https://www.eventbrite.com/e/brooklyn-contra-tickets-1234567890",
    "https://www.ticketmaster.com/bolden-tickets-new-york/event/3B00630A",
    "https://www.ticketweb.com/event/swing-night-tickets/13579",
    "https://midtownhop.com/tickets",
    "https://brooklyncontra.org/events/2026-07-25-contra-dance",
    // An event platform's page for one event: its own page, which sells nothing (review #18, #22).
    "https://www.facebook.com/events/123456789012345/",
    "https://www.meetup.com/nyc-salsa/events/303123456/",
    "https://partiful.com/e/AbCdEf",
    "https://events.humanitix.com/salsa-night-under-the-stars",
    "https://www.latinstudio.example/socials/salsa-mondays",
    "https://salsaclub.example/event/friday-salsa-social/2026-10-02/",
  ])("takes %s as one event's page", (url) => {
    expect(looksLikeEventPage(url)).toBe(true);
  });

  it.each([
    "https://houseofyes.org/",
    "https://www.nowadays.nyc",
    "https://sobs.com/calendar",
    "https://cdny.org/calendar-events",
    "https://www.swingremixnyc.com/events",
    "https://www.eventbrite.com/o/cdny-12345",
    "https://www.ticketmaster.com/sobs-tickets-new-york/venue/12345",
    "https://sobs.com/venue/sobs/",
    "https://www.thisweekinswingnyc.com/author/eileen/",
    "https://zoukology.com/articles/the-bad-cop-of-zouk",
    "https://example.org/events/?month=2026-10",
    "mailto:hello@example.org",
    "not a url",
    // Home pages under another name (review #23), from the saved eval pages and the usual shapes.
    "https://cdny.org/home",
    "https://swingremixnyc.com/home",
    "https://nuevotangoarts.org/home",
    "https://example.org/index.html",
    "https://example.org/index.php",
    "https://example.org/en/",
    "https://example.org/?page_id=12",
    // Lists of nights, wherever the list word sits and however it is suffixed.
    "https://www.rscdsnewyork.org/events-1",
    "https://kizombaembassy.com/events-calendar-kizomba/",
    "https://www.nycwcs.com/social-dances-parties.html",
    "https://nuevotangoarts.org/2026-calendar",
    "https://swingremixnyc.com/lessons",
    "https://example.com/nyc/events",
    "https://example.com/events/list/",
    "https://example.com/events/list/?tribe-bar-date=2026-10-02",
    "https://example.com/events/month/",
    "https://example.com/events/today/",
    "https://example.com/milongas",
    "https://example.com/classes",
    "https://example.com/socials",
    "https://example.com/schedule",
    // Social profiles, link lists, videos, maps and payment pages.
    "http://instagram.com/frimframjam",
    "https://www.instagram.com/nycswings.wcs",
    "https://linktr.ee/salsaclub",
    "https://www.youtube.com/watch?v=abc123",
    "https://www.tiktok.com/@salsaclub",
    "https://x.com/salsaclub/status/1",
    "https://twitter.com/salsaclub",
    "https://www.linkedin.com/company/salsaclub",
    "https://www.facebook.com/salsaclubnyc",
    "https://www.facebook.com/salsaclubnyc/events",
    "https://www.google.com/maps/place/Club+Mango",
    "https://maps.google.com/?q=Club+Mango",
    "https://maps.app.goo.gl/abc",
    "https://www.paypal.com/donate?hosted_button_id=X",
    "https://venmo.com/u/salsaclub",
    // A Meetup group's page is not one event's.
    "https://www.meetup.com/nyc-salsa/",
    // Humanitix's own pages are not an event's.
    "https://humanitix.com/search",
    "https://humanitix.com/au/about",
    // Organiser, group, venue and teacher pages (review #11).
    "https://site.example/groups/salsa-club-nyc",
    "https://site.example/places/club-mango",
    "https://site.example/teachers/maria-lopez",
    "https://site.example/organizations/salsa-club",
    "https://site.example/studios/studio-b",
    "https://site.example/instructors/maria",
    "https://site.example/clubs/salsa",
    "https://site.example/djs/rico",
    "https://site.example/members/maria",
    "https://site.example/users/maria",
    "https://site.example/people/maria",
    "https://site.example/profiles/maria",
  ])("does not take %s as one event's page", (url) => {
    expect(looksLikeEventPage(url)).toBe(false);
  });
});

describe("the parts", () => {
  it("tells a ticket seller's event page from its other pages", () => {
    expect(isTicketingHost("https://www.eventbrite.com/o/cdny-12345")).toBe(true);
    expect(isTicketingEventPage("https://www.eventbrite.com/o/cdny-12345")).toBe(false);
    expect(isTicketingEventPage("https://www.eventbrite.com/e/x-tickets-1")).toBe(true);
    expect(isTicketingHost("https://www.theronda.us/event/x")).toBe(false);
  });

  it("takes only a seller's real domains, not a lookalike host (review #8)", () => {
    expect(isTicketingEventPage("https://www.eventbrite.co.uk/e/1")).toBe(true);
    expect(isTicketingEventPage("https://www.eventbrite.com.au/e/1")).toBe(true);
    expect(isTicketingEventPage("https://www.ticketmaster.ca/x/event/1")).toBe(true);
    expect(isTicketingEventPage("https://www.eventbrite.com.evil.example/e/x")).toBe(false);
    expect(isTicketingEventPage("https://www.eventbrite.com.evil.com/e/x")).toBe(false);
    expect(isTicketingEventPage("https://ticketmaster.shop/event/1")).toBe(false);
    expect(isTicketingEventPage("https://seetickets.anything.example/event/1")).toBe(false);
    expect(isTicketingHost("https://www.eventbrite.com.evil.example/e/x")).toBe(false);
  });

  it("calls an event platform's page an event page, never a ticket page (review #18, #22)", () => {
    for (const url of [
      "https://www.facebook.com/events/123456789012345/",
      "https://www.meetup.com/nyc-salsa/events/303123456/",
      "https://partiful.com/e/AbCdEf",
    ]) {
      expect(isTicketingEventPage(url), url).toBe(false);
      expect(isPlatformEventPage(url), url).toBe(true);
      expect(isHostedEventPage(url), url).toBe(true);
    }
    expect(isHostedEventPage("https://www.eventbrite.com/e/x-tickets-1")).toBe(true);
    expect(isHostedEventPage("https://salsa.example/e/x")).toBe(false);
  });

  it("reads home and collection pages from the path alone", () => {
    expect(isHomePage("https://sobs.com")).toBe(true);
    // A query that only picks a page of the site is still the front page (review #23).
    expect(isHomePage("https://sobs.com/?page_id=5")).toBe(true);
    expect(isHomePage("https://sobs.com/home")).toBe(true);
    expect(isHomePage("https://sobs.com/?event=salsa-night")).toBe(false);
    expect(isHomePage("https://sobs.com/events/desi")).toBe(false);
    expect(isCollectionPage("https://sobs.com/events/")).toBe(true);
    expect(isCollectionPage("https://sobs.com/events/desi")).toBe(false);
    expect(isCollectionPage("https://sobs.com/nyc/events")).toBe(true);
    expect(isCollectionPage("https://sobs.com/e/event-night")).toBe(false);
  });
});

describe("the URL rules stay light", () => {
  it("imports nothing, since the map's client card ships it to the browser", () => {
    // src/ui/links.ts imports these rules, and the map's card (a client component) draws the card,
    // so every import here is in the phone's download. The page matcher, with tldts and the text
    // rules, lives in src/domain/event-link-matcher.ts, which only the ingest imports.
    const source = readFileSync("src/domain/event-links.ts", "utf8");
    expect(source.match(/^import .*$/gm) ?? []).toEqual([]);
  });
});

describe("a site's own pages that are never one event's (run 28)", () => {
  it.each([
    "https://www.cdny.org/get-involved",
    "https://example.org/membership",
    "https://example.org/volunteer/",
    "https://example.org/support-us",
    "https://example.org/newsletter",
    "https://example.org/faq",
    "https://example.org/privacy-policy",
    "https://example.org/shop/",
    "https://example.org/gift-cards",
  ])("does not take %s as an event page", (url) => {
    expect(looksLikeEventPage(url)).toBe(false);
  });

  it("still takes an event whose slug merely contains such a word", () => {
    expect(looksLikeEventPage("https://example.org/events/support-the-band-social")).toBe(true);
  });
});
