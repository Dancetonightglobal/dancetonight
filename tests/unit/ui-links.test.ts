// The one link out a listing shows (D-073): which page, in which words, on the card, the map's
// card and the event page alike. The rules are a table, so each row is one case.

import { describe, expect, it } from "vitest";

import type { Listing, ListingSource } from "@/src/domain/listing";
import { t } from "@/src/i18n";
import { eventLink, outboundLinks, withTextFragment } from "@/src/ui/links";

const NOW = new Date("2026-09-29T23:00:00Z");

function source(
  url: string,
  tier: ListingSource["tier"],
  eventUrl: string | null = null,
): ListingSource {
  return {
    url,
    label: new URL(url).hostname,
    checkedAt: NOW,
    byOrganiser: tier !== "listing",
    tier,
    eventUrl,
  };
}

const RONDA_LIST = source("https://www.theronda.us/nyc", "listing");
const RONDA_EVENT = "https://www.theronda.us/event/tango-cafe-2026-09-30-74420121";
const STEPPING_OUT = source("https://www.steppingoutstudios.com/social-events1", "organizer");
const TICKETMASTER = "https://www.ticketmaster.com/bolden-tickets/event/3B00630A";

function listing(overrides: Partial<Listing> = {}): Listing {
  return {
    id: "evt-1",
    slug: "paciencia-milonga-2026-09-29",
    title: "Paciencia Milonga",
    listingType: "social",
    styles: ["tango"],
    families: ["tango"],
    doorsAt: null,
    lessonAt: null,
    dancingAt: null,
    endsAt: null,
    startsAt: new Date("2026-09-30T00:00:00Z"),
    nightDate: "2026-09-29",
    tz: "America/New_York",
    venue: {
      id: "ven-1",
      name: "Stepping Out Studios",
      location: { lat: 40.74, lng: -73.99 },
      address: null,
      neighborhood: null,
      googlePlaceId: null,
      kind: "studio",
      danceFloor: "yes",
    },
    organizer: null,
    prices: [],
    isFree: false,
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
    confidence: 0.8,
    summary: null,
    sources: [STEPPING_OUT],
    status: "active",
    canonicalUrl: STEPPING_OUT.url,
    distanceKm: null,
    liveStatus: null,
    ...overrides,
  };
}

describe("eventLink: one link out, in the words that say what it is (D-073)", () => {
  it("names a ticket seller's page as tickets while the night is on", () => {
    const row = listing({
      ticketUrl: TICKETMASTER,
      canonicalUrl: TICKETMASTER,
      sources: [source(TICKETMASTER, "ticketing")],
    });
    expect(eventLink(row)).toEqual({
      kind: "tickets",
      href: TICKETMASTER,
      site: "ticketmaster.com",
      text: t("links.ticketsAt", { site: "ticketmaster.com" }),
    });
  });

  it("calls the ticket page the event page once the night is cancelled or over", () => {
    const base = {
      ticketUrl: TICKETMASTER,
      canonicalUrl: TICKETMASTER,
      sources: [source(TICKETMASTER, "ticketing")],
    };
    const cancelled = listing({ ...base, confirmation: "cancelled" });
    const ended = listing({
      ...base,
      liveStatus: { kind: "ended", text: "Ended", endNotListed: false },
    });
    for (const row of [cancelled, ended]) {
      expect(outboundLinks(row)).toEqual({ tickets: null, eventPage: TICKETMASTER });
      expect(eventLink(row)).toMatchObject({
        kind: "event",
        href: TICKETMASTER,
        text: "Event page at ticketmaster.com",
      });
    }
  });

  it("names a listings site's own page for the event as its event page, never tickets", () => {
    // Stored before D-070 (the event page as the ticket URL) and after (as the canonical URL).
    const old = listing({
      ticketUrl: RONDA_EVENT,
      canonicalUrl: RONDA_LIST.url,
      sources: [RONDA_LIST],
    });
    const fresh = listing({ ticketUrl: null, canonicalUrl: RONDA_EVENT, sources: [RONDA_LIST] });
    for (const row of [old, fresh]) {
      expect(eventLink(row)).toEqual({
        kind: "event",
        href: RONDA_EVENT,
        site: "theronda.us",
        text: "Event page at theronda.us",
      });
    }
  });

  it("puts a real ticket page first when the event also has its own page", () => {
    const tickets = "https://www.eventbrite.com/e/brooklyn-contra-tickets-1234567890";
    const page = "https://brooklyncontra.org/events/october-dance";
    const row = listing({
      ticketUrl: tickets,
      canonicalUrl: page,
      sources: [source("https://brooklyncontra.org/", "organizer")],
    });
    expect(outboundLinks(row)).toEqual({ tickets, eventPage: page });
    expect(eventLink(row)).toMatchObject({
      kind: "tickets",
      href: tickets,
      site: "eventbrite.com",
    });
  });

  it("links an untimed night's own page before its ticket page (D-572)", () => {
    const tickets = "https://ci.ovationtix.com/35689/production/1286561";
    const page = "https://www.flushingtownhall.org/show-details/diwali-festival-the-indian-wedding";
    const row = listing({
      startsAt: null,
      ticketUrl: tickets,
      canonicalUrl: page,
      sources: [source("https://www.flushingtownhall.org/events", "organizer")],
    });
    expect(outboundLinks(row)).toEqual({ tickets, eventPage: page });
    expect(eventLink(row)).toMatchObject({ kind: "event", href: page });
    // With no page of its own, the ticket page is still the link.
    expect(eventLink({ ...row, canonicalUrl: null })).toMatchObject({
      kind: "tickets",
      href: tickets,
    });
  });

  it("never calls the page a night was read from its event page", () => {
    // The store's fallback: no event page known, so the canonical URL is the list page itself.
    const row = listing();
    expect(outboundLinks(row)).toEqual({ tickets: null, eventPage: null });
    expect(eventLink(row)).toEqual({
      kind: "listed",
      href: "https://www.steppingoutstudios.com/social-events1#:~:text=Paciencia%20Milonga",
      site: "steppingoutstudios.com",
      text: "Listed on steppingoutstudios.com",
    });
  });

  it("uses the first source, the primary one, for a listed night", () => {
    const second = source("https://www.thisweekinswingnyc.com/", "listing");
    const row = listing({ canonicalUrl: null, sources: [STEPPING_OUT, second] });
    expect(eventLink(row)?.site).toBe("steppingoutstudios.com");
  });

  it("draws nothing when a listing has no source at all", () => {
    expect(eventLink(listing({ sources: [], canonicalUrl: null }))).toBeNull();
  });
});

describe("eventLink: each source's own page for the event (event_sources.event_url, D-073)", () => {
  it("takes a source that is the event's own page as the event page, even as its source row", () => {
    // JSON-LD on an event's own page: the page read is the event page.
    const page = "https://frimframjam.com/events/fall-jam";
    const row = listing({
      canonicalUrl: page,
      sources: [source(page, "organizer", page)],
    });
    expect(eventLink(row)).toMatchObject({ kind: "event", href: page, site: "frimframjam.com" });
  });

  it("keeps a merged listing's ticket page from its ticket seller's source row", () => {
    const eventbrite = "https://www.eventbrite.com/e/english-country-dancing-tickets-1234567890";
    const row = listing({
      sources: [STEPPING_OUT, source(eventbrite, "ticketing", eventbrite)],
    });
    expect(eventLink(row)).toMatchObject({ kind: "tickets", href: eventbrite });
  });

  it("puts the primary source's page ahead of a later one", () => {
    const first = "https://www.nycswings.net/e/midtown-swings-social/";
    const second = "https://www.thisweekinswingnyc.com/events/midtown-swings";
    const row = listing({
      sources: [
        source("https://www.nycswings.net/", "listing", first),
        source("https://www.thisweekinswingnyc.com/", "listing", second),
      ],
    });
    expect(eventLink(row)?.href).toBe(first);
  });
});

describe("eventLink: a home page or a list is never Tickets or an event page (D-073)", () => {
  it.each([
    ["a site's home page", "https://houseofyes.org/"],
    ["a list of nights", "https://sobs.com/calendar"],
    ["a ticket seller's organiser page", "https://www.eventbrite.com/o/cdny-12345"],
    ["a venue page", "https://sobs.com/venue/sobs/"],
    // Review #23: home pages, lists and profiles under other names.
    ["a home page at /home", "https://cdny.org/home"],
    ["a list at /events-1", "https://www.rscdsnewyork.org/events-1"],
    ["an Instagram profile", "https://www.instagram.com/nycswings.wcs"],
  ])("does not call %s Tickets", (_, url) => {
    const row = listing({ ticketUrl: url });
    expect(outboundLinks(row).tickets).toBeNull();
    expect(eventLink(row)?.kind).toBe("listed");
  });

  it.each([
    ["facebook.com", "https://www.facebook.com/events/123456789012345/"],
    ["meetup.com", "https://www.meetup.com/nyc-salsa/events/303123456/"],
    ["partiful.com", "https://partiful.com/e/AbCdEf"],
  ])("calls a %s event its event page, never Tickets (review #22)", (site, url) => {
    const row = listing({ ticketUrl: url });
    expect(outboundLinks(row)).toEqual({ tickets: null, eventPage: url });
    expect(eventLink(row)).toEqual({
      kind: "event",
      href: url,
      site,
      text: t("links.eventPageAt", { site }),
    });
    // The organiser's own page for the event comes first; the platform's is not "Tickets" either.
    const own = "https://www.steppingoutstudios.com/events/paciencia-milonga";
    const withOwn = listing({
      ticketUrl: url,
      sources: [source(STEPPING_OUT.url, "organizer", own)],
    });
    expect(outboundLinks(withOwn)).toEqual({ tickets: null, eventPage: own });
  });

  it("does not take a list page named as a source's event page", () => {
    const row = listing({
      sources: [source(STEPPING_OUT.url, "organizer", "https://www.steppingoutstudios.com/events")],
    });
    expect(eventLink(row)?.kind).toBe("listed");
  });
});

describe("withTextFragment: the list page, scrolled to the night's title", () => {
  it("encodes the syntax's own characters", () => {
    expect(withTextFragment("https://cdny.org/", "English – Tuesdays, Hi-Fi & more")).toBe(
      "https://cdny.org/#:~:text=English%20%E2%80%93%20Tuesdays%2C%20Hi%2DFi%20%26%20more",
    );
  });

  it("leaves a URL that already has a fragment, and a title too short to find, alone", () => {
    expect(withTextFragment("https://x.example/#calendar", "Paciencia Milonga")).toBe(
      "https://x.example/#calendar",
    );
    expect(withTextFragment("https://x.example/", "Zou")).toBe("https://x.example/");
  });

  it("collapses runs of space the page would not have", () => {
    expect(withTextFragment("https://x.example/", "  Tango   Cafe ")).toBe(
      "https://x.example/#:~:text=Tango%20Cafe",
    );
  });
});
