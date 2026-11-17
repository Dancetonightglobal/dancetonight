import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { probePage } from "@/src/pipeline/probe";

const PAGE = "https://club.example/events";
const html = (body: string, head = "") =>
  `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;

describe("probing a page", () => {
  it("prefers a declared iCalendar feed", () => {
    const outcome = probePage(
      PAGE,
      html(
        '<a href="/calendar.ics">ics</a>',
        '<link rel="alternate" type="text/calendar" title="Events" href="webcal://club.example/feed.ics">',
      ),
    );
    expect(outcome).toMatchObject({ kind: "feed_ics", feedUrl: "https://club.example/feed.ics" });
  });

  it("reads a Google Calendar embed as every calendar it names, for the Calendar API", () => {
    const outcome = probePage(
      PAGE,
      html(
        '<iframe src="https://calendar.google.com/calendar/embed?src=abc%40group.calendar.google.com&amp;ctz=America%2FNew_York"></iframe>',
      ),
    );
    expect(outcome).toMatchObject({
      kind: "feed_gcal",
      platform: "feed_gcal",
      feedUrl: "https://calendar.google.com/calendar/embed?src=abc%40group.calendar.google.com",
      feedUrls: ["https://calendar.google.com/calendar/embed?src=abc%40group.calendar.google.com"],
    });
  });

  it("finds a linked .ics file, The Events Calendar, Squarespace and Tockify", () => {
    expect(
      probePage(PAGE, html('<a href="/files/socials.ics?v=2">Add to calendar</a>')),
    ).toMatchObject({
      kind: "feed_ics",
      feedUrl: "https://club.example/files/socials.ics?v=2",
    });
    expect(probePage(PAGE, html('<div class="tribe-events-calendar"></div>'))).toMatchObject({
      kind: "wp_tribe",
    });
    // Squarespace with real events list markup
    expect(
      probePage(
        PAGE,
        html(
          '<div class="eventlist eventlist--upcoming"><article class="eventlist-event eventlist-event--upcoming"></article></div>',
          '<script src="https://static1.squarespace.com/x.js"></script>',
        ),
      ),
    ).toMatchObject({ kind: "squarespace" });
    expect(
      probePage(
        PAGE,
        html(
          '<div data-tockify-calendar="nycswing"></div><script src="https://public.tockify.com/browser/embed.js"></script><a href="https://tockify.com/nycswing">cal</a>',
        ),
      ),
    ).toMatchObject({
      kind: "feed_ics",
      platform: "tockify",
      feedUrl: "https://tockify.com/api/feeds/ics/nycswing",
    });
  });

  it("detects Squarespace events list correctly (D-137)", () => {
    // Squarespace home page with manifest string and /events link
    const htmlWithEventsLink = html(
      '<a href="/about">About</a><a href="/events">Events</a>',
      '<script>"squarespace-events-collection"</script><script src="https://static1.squarespace.com/x.js"></script>',
    );
    expect(probePage(PAGE, htmlWithEventsLink)).toMatchObject({
      kind: "squarespace",
      feedUrl: "https://club.example/events",
    });

    // Squarespace home page without events link
    const htmlWithoutEventsLink = html(
      '<a href="/about">About</a><a href="/menu">Menu</a>',
      '<script>"squarespace-events-collection"</script><script src="https://static1.squarespace.com/x.js"></script>',
    );
    const outcome = probePage(PAGE, htmlWithoutEventsLink);
    expect(outcome.kind).not.toBe("squarespace");

    // Squarespace home page linking to other domain's events page
    const htmlOtherDomain = html(
      '<a href="https://other.example/events">Events</a>',
      '<script src="https://static1.squarespace.com/x.js"></script>',
    );
    const outcome2 = probePage(PAGE, htmlOtherDomain);
    expect(outcome2.kind).not.toBe("squarespace");
  });

  it("falls back to the page's own JSON-LD, then to html", () => {
    const jsonld =
      '<script type="application/ld+json">{"@type":"Event","name":"Salsa","startDate":"2026-09-25T21:00"}</script>';
    expect(probePage(PAGE, html("", jsonld))).toMatchObject({
      kind: "jsonld",
      hasJsonLdEvents: true,
    });
    expect(probePage(PAGE, html("<p>Come dance</p>"))).toMatchObject({
      kind: "html",
      hasJsonLdEvents: false,
    });
  });

  it("returns linked Eventbrite organizers, Meetup groups and social profiles as other sources", () => {
    const outcome = probePage(
      PAGE,
      html(
        [
          '<a href="https://www.eventbrite.com/o/ecstatic-dance-nyc-33937979455?aff=x">Tickets</a>',
          '<a href="https://www.meetup.com/blues-dance-new-york/">Meetup</a>',
          '<a href="https://www.meetup.com/find/">Find</a>',
          '<a href="https://www.instagram.com/nycswings.wcs/">IG</a>',
          '<a href="https://www.facebook.com/sharer/sharer.php?u=x">Share</a>',
          '<a href="javascript:void(0)">nope</a>',
        ].join(""),
      ),
    );
    expect(outcome.discovered).toEqual([
      {
        url: "https://www.eventbrite.com/o/ecstatic-dance-nyc-33937979455",
        kind: "ticketing_api",
        platform: "eventbrite",
        trustTier: "ticketing",
        discoveredBy: "probe",
      },
      {
        url: "https://www.meetup.com/blues-dance-new-york/",
        kind: "feed_ics",
        platform: "meetup",
        feedUrl: "https://www.meetup.com/blues-dance-new-york/events/ical/",
        trustTier: "first_party",
        discoveredBy: "probe",
      },
      {
        url: "https://www.instagram.com/nycswings.wcs/",
        kind: "social_link",
        trustTier: "unofficial",
        discoveredBy: "probe",
      },
    ]);
  });
});

describe("WordPress Events Manager (D-122)", () => {
  it("reads Le Pari's page, saved on 2026-10-04, as its /events.ics", () => {
    const html = readFileSync(
      path.join(__dirname, "fixtures/discovery/danceatlepari-home.excerpt.html.txt"),
      "utf8",
    );
    expect(probePage("https://danceatlepari.com/", html)).toMatchObject({
      kind: "feed_ics",
      platform: null,
      feedUrl: "https://danceatlepari.com/events.ics",
      reason: "the site runs Events Manager, whose calendar is /events.ics",
    });
  });

  it("finds the feed of a site in a subdirectory, and keeps to the page's own host", () => {
    const tag = (href: string) =>
      html(
        `<link rel="stylesheet" href="${href}/wp-content/plugins/events-manager/includes/css/events-manager.min.css">`,
      );
    expect(probePage(PAGE, tag("/blog")).feedUrl).toBe("https://club.example/blog/events.ics");
    expect(probePage(PAGE, tag("")).feedUrl).toBe("https://club.example/events.ics");
    expect(probePage(PAGE, tag("https://cdn.example.net")).feedUrl).toBe(
      "https://club.example/events.ics",
    );
  });

  it("lets a declared feed and The Events Calendar come first", () => {
    const em =
      '<script src="/wp-content/plugins/events-manager/includes/js/events-manager.js"></script>';
    expect(
      probePage(PAGE, html(em, '<link rel="alternate" type="text/calendar" href="/declared.ics">'))
        .feedUrl,
    ).toBe("https://club.example/declared.ics");
    expect(probePage(PAGE, html(`${em}<div class="tribe-events-calendar"></div>`)).kind).toBe(
      "wp_tribe",
    );
  });
});
