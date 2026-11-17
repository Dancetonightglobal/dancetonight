import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

import {
  ticketfairyAdapter,
  ticketfairyQueryUrl,
  ticketfairyToListings,
} from "@/src/adapters/apis/ticketfairy";
import type { Metro, RunCtx, Source } from "@/src/adapters/types";
import { createPoliteHttp, fixtureTransport, type Fixture } from "@/src/pipeline/http";

const NOW = new Date("2026-11-07T15:00:00Z");
const TULUM: Metro = {
  id: "tulum",
  slug: "tulum",
  name: "Tulum",
  countryCode: "MX",
  center: { lat: 20.3969, lng: -87.3144 },
  radiusKm: 73,
  tz: "America/Cancun",
  languages: ["es", "en"],
};

const source: Source = {
  id: "s",
  url: "https://www.ticketfairy.com/api/v1/events/listing?country=MX&state=Quintana%20Roo",
  kind: "ticketing_api",
  trustTier: "ticketing",
  platform: "ticketfairy",
  feedUrl: null,
  metroId: "tulum",
  styles: [],
  etag: null,
  lastModified: null,
  contentHash: null,
};

function canonicalUrl(u: string): string {
  const p = new URL(u);
  if (!p.search) return u;
  const params = [...p.searchParams.entries()].sort(([a], [b]) => a.localeCompare(b));
  return `${p.origin}${p.pathname}?${new URLSearchParams(params).toString()}`;
}

function ctx(fixtures: Fixture[]): RunCtx & { requests: string[] } {
  const innerTransport = fixtureTransport(
    fixtures.map((f) => ({
      ...f,
      request: { ...f.request, url: canonicalUrl(f.request.url) },
    })),
  );
  const requests: string[] = [];
  const transport = (req: Parameters<typeof innerTransport>[0]) => {
    requests.push(req.url);
    return innerTransport({ ...req, url: canonicalUrl(req.url) });
  };
  let t = NOW.getTime();
  return {
    metro: TULUM,
    now: () => new Date(t),
    http: createPoliteHttp({
      transport,
      userAgent: "test",
      now: () => t,
      sleep: async (ms) => void (t += ms),
    }),
    env: {},
    log: () => {},
    requests,
  };
}

function robotsFixture(body = "User-agent: *\nAllow: /api/v1/events/listing\n"): Fixture {
  return {
    request: {
      method: "GET",
      url: "https://www.ticketfairy.com/robots.txt",
      body: undefined,
    },
    response: {
      url: "https://www.ticketfairy.com/robots.txt",
      status: 200,
      headers: { "content-type": "text/plain" },
      body,
    },
  };
}

/** A TicketFairy event as the tests change it (the fixture's shape, loosely typed). */
type TfEvent = Record<string, unknown> & {
  displayName: string;
  shortDescription: string;
  url: string;
  venue: Record<string, unknown>;
};

describe("TicketFairy adapter", () => {
  const fixturePath = join(__dirname, "__fixtures__/ticketfairy/quintana-roo.json");
  const fixtureData = JSON.parse(readFileSync(fixturePath, "utf-8"));
  const fixtureEvents = fixtureData.data.events as unknown[];

  it("ticketfairyQueryUrl builds correct URL", () => {
    const url = ticketfairyQueryUrl(
      "https://www.ticketfairy.com/api/v1/events/listing?country=MX&state=Quintana%20Roo",
      "2026-11-07",
      "2026-11-20",
      "America/Cancun",
    );
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe(
      "https://www.ticketfairy.com/api/v1/events/listing",
    );
    expect(parsed.searchParams.get("country")).toBe("MX");
    expect(parsed.searchParams.get("state")).toBe("Quintana Roo");
    expect(parsed.searchParams.get("from")).toBe("2026-11-07");
    expect(parsed.searchParams.get("to")).toBe("2026-11-20");
    expect(parsed.searchParams.get("timezone")).toBe("America/Cancun");
    expect(parsed.searchParams.get("size")).toBe("100");
    expect(parsed.searchParams.get("cursor")).toBeNull();
    // Ensure encoding: state param should not contain a raw space
    expect(url).not.toContain("Quintana Roo");
    expect(url).toMatch(/state=Quintana(%20|\+)Roo/);
  });

  it("ticketfairyQueryUrl with cursor", () => {
    const url = ticketfairyQueryUrl(
      "https://www.ticketfairy.com/api/v1/events/listing?country=MX&state=Quintana%20Roo",
      "2026-11-07",
      "2026-11-20",
      "America/Cancun",
      "abc",
    );
    const parsed = new URL(url);
    expect(parsed.searchParams.get("cursor")).toBe("abc");
  });

  it("ticketfairyQueryUrl without state", () => {
    const url = ticketfairyQueryUrl(
      "https://www.ticketfairy.com/api/v1/events/listing?country=MX",
      "2026-11-07",
      "2026-11-20",
      "America/Cancun",
    );
    const parsed = new URL(url);
    expect(parsed.searchParams.get("state")).toBeNull();
    expect(parsed.searchParams.get("country")).toBe("MX");
  });

  it("ticketfairyToListings extracts listings from fixture", () => {
    const runCtx = ctx([]);
    const { listings, notes } = ticketfairyToListings(fixtureEvents, runCtx, {
      fetchedAt: NOW,
      fromNight: "2026-11-07",
      state: "Quintana Roo",
      city: null,
    });
    // Expected kept titles in fixture order (excluding hidden and Cancún)
    const expectedTitles = [
      "GYPSY DISCO SPECIAL EDITION",
      "LAS GITANAS",
      "MERA ROOM X GITANO BEACH",
      "PAPAYA PLAYA PROJECT Presents • STARLIGHT",
      "CEREMONIA GITANO BEACH",
      "GYPSY DISCO",
      "LAS GITANAS",
      "PAPAYA PLAYA PROJECT Presents • THE NEW MOON",
      "LA NOCHE",
      "CEREMONIA GITANO BEACH",
    ];
    expect(listings).toHaveLength(10);
    expect(listings.map((l) => l.listing.title)).toEqual(expectedTitles);
    // No title contains "CANCUN" or "HIDDEN"
    expect(listings.every((l) => !l.listing.title.includes("CANCUN"))).toBe(true);
    expect(listings.every((l) => !l.listing.title.includes("HIDDEN"))).toBe(true);
    // Check LA NOCHE details
    const laNoche = listings.find((l) => l.listing.title.includes("LA NOCHE"));
    expect(laNoche).toBeDefined();
    expect(laNoche?.listing.doors_time).toBe("19:30");
    expect(laNoche?.listing.end_time).toBe("03:30");
    expect(laNoche?.listing.venue?.name).toBe("GITANO");
    expect(laNoche?.venueLocation).toEqual({ lat: 20.1500881, lng: -87.4591118 });
    expect(laNoche?.listing.prices?.[0]?.amount).toBe(440);
    expect(laNoche?.listing.prices?.[0]?.currency).toBe("MXN");
    expect(laNoche?.eventUrl).toBe("https://www.ticketfairy.com/event/la-noche-jungle-7nov2026");
    expect(laNoche?.externalId).toBe("ticketfairy:la-noche-jungle-7nov2026");
    expect(laNoche?.tz).toBe("America/Cancun");
    // Check LAS GITANAS (startingPrice null) has no prices
    const lasGitanas = listings.find(
      (l) => l.listing.title.includes("LAS GITANAS") && l.listing.doors_time === "19:30",
    );
    // prices should be empty array (no price known)
    expect(lasGitanas?.listing.prices).toEqual([]);
    // Check MERA ROOM address
    const meraRoom = listings.find((l) => l.listing.title.includes("MERA ROOM"));
    expect(meraRoom?.listing.venue?.address).toBe(
      "Avenida Boca Paila KM 9.5, Tulum, Quintana Roo, 77780",
    );
    // Check GITANO address
    const gitano = listings.find(
      (l) => l.listing.venue?.name === "GITANO" && l.listing.title.includes("GYPSY DISCO"),
    );
    expect(gitano?.listing.venue?.address).toBe("Tulum, Quintana Roo, 77710");
    // Check Ceremonia end time (the one on 2026-11-07)
    const ceremonia = listings.find(
      (l) =>
        l.listing.title.includes("CEREMONIA GITANO BEACH") && l.listing.local_date === "2026-11-07",
    );
    expect(ceremonia?.listing.end_time).toBe("01:00");
    // Notes
    expect(notes).toContain("ticketfairy: 1 events with hidden dates");
    expect(notes).toContain("ticketfairy: 1 events outside the metro");
  });

  it("harvest sends correct request and returns listings", async () => {
    const run = ctx([
      robotsFixture(),
      {
        request: {
          method: "GET",
          url: "https://www.ticketfairy.com/api/v1/events/listing?country=MX&state=Quintana%20Roo&from=2026-11-07&to=2026-11-20&timezone=America/Cancun&size=100",
          body: undefined,
        },
        response: {
          url: "https://www.ticketfairy.com/api/v1/events/listing",
          status: 200,
          headers: { "content-type": "application/json" },
          body: JSON.stringify(structuredClone(fixtureData)),
        },
      },
    ]);
    const result = await ticketfairyAdapter.harvest!(source, run);
    expect(result.listings.length).toBeGreaterThan(0);
    expect(result.notes?.[0]).toMatch(/ticketfairy: \d+ events read, \d+ listings/);
    expect(result.notes).toContain("robots.txt allows /api/v1/events/listing");
    expect(result.whole).toBe(true);
  });

  it("pages until nextCursor null", async () => {
    const firstPage = structuredClone(fixtureData);
    firstPage.data.pagination = { nextCursor: "cursor123", totalCount: 24 };
    const secondPage = structuredClone(fixtureData);
    secondPage.data.pagination = { nextCursor: null, totalCount: 24 };
    secondPage.data.events = []; // empty second page

    const run = ctx([
      robotsFixture(),
      {
        request: {
          method: "GET",
          url: "https://www.ticketfairy.com/api/v1/events/listing?country=MX&state=Quintana%20Roo&from=2026-11-07&to=2026-11-20&timezone=America/Cancun&size=100",
          body: undefined,
        },
        response: {
          url: "https://www.ticketfairy.com/api/v1/events/listing",
          status: 200,
          headers: { "content-type": "application/json" },
          body: JSON.stringify(firstPage),
        },
      },
      {
        request: {
          method: "GET",
          url: "https://www.ticketfairy.com/api/v1/events/listing?country=MX&state=Quintana%20Roo&from=2026-11-07&to=2026-11-20&timezone=America/Cancun&size=100&cursor=cursor123",
          body: undefined,
        },
        response: {
          url: "https://www.ticketfairy.com/api/v1/events/listing",
          status: 200,
          headers: { "content-type": "application/json" },
          body: JSON.stringify(secondPage),
        },
      },
    ]);
    const result = await ticketfairyAdapter.harvest!(source, run);
    // Should have made 2 requests
    expect(run.requests).toHaveLength(3); // robots.txt + 2 pages
    expect(result.listings).toHaveLength(10); // first page's 10 listings
    expect(result.notes).toContain("robots.txt allows /api/v1/events/listing");
  });

  it("stops after 10 pages with note", async () => {
    const pageFixture = structuredClone(fixtureData);
    pageFixture.data.pagination = { nextCursor: "cursor", totalCount: 1000 };
    const fixtures = [
      robotsFixture(),
      ...Array.from({ length: 10 }, (_, i) => ({
        request: {
          method: "GET" as const,
          url: `https://www.ticketfairy.com/api/v1/events/listing?country=MX&state=Quintana%20Roo&from=2026-11-07&to=2026-11-20&timezone=America/Cancun&size=100${i === 0 ? "" : "&cursor=cursor"}`,
          body: undefined,
        },
        response: {
          url: "https://www.ticketfairy.com/api/v1/events/listing",
          status: 200,
          headers: { "content-type": "application/json" },
          body: JSON.stringify(pageFixture),
        },
      })),
    ];
    const run = ctx(fixtures);
    const result = await ticketfairyAdapter.harvest!(source, run);
    expect(result.notes?.some((n) => n.includes("stopped after 10 pages"))).toBe(true);
  });

  it("throws on source without country", async () => {
    const badSource: Source = {
      ...source,
      url: "https://www.ticketfairy.com/api/v1/events/listing",
    };
    const run = ctx([robotsFixture()]);
    await expect(ticketfairyAdapter.harvest!(badSource, run)).rejects.toThrow(
      "ticketfairy: source has no country",
    );
  });

  it("throws on robots disallow", async () => {
    const run = ctx([
      {
        ...robotsFixture("User-agent: *\nDisallow: /api/v1/events/listing\n"),
      },
    ]);
    await expect(ticketfairyAdapter.harvest!(source, run)).rejects.toThrow(
      "ticketfairy: robots.txt disallows /api/v1/events/listing",
    );
  });

  it("throws on HTTP 403", async () => {
    const run = ctx([
      robotsFixture(),
      {
        request: {
          method: "GET",
          url: "https://www.ticketfairy.com/api/v1/events/listing?country=MX&state=Quintana%20Roo&from=2026-11-07&to=2026-11-20&timezone=America/Cancun&size=100",
          body: undefined,
        },
        response: {
          url: "https://www.ticketfairy.com/api/v1/events/listing",
          status: 403,
          headers: { "content-type": "text/html" },
          body: "Forbidden",
        },
      },
    ]);
    await expect(ticketfairyAdapter.harvest!(source, run)).rejects.toThrow(
      "ticketfairy: download failed (HTTP 403)",
    );
  });

  it("throws on non-JSON response", async () => {
    const run = ctx([
      robotsFixture(),
      {
        request: {
          method: "GET",
          url: "https://www.ticketfairy.com/api/v1/events/listing?country=MX&state=Quintana%20Roo&from=2026-11-07&to=2026-11-20&timezone=America/Cancun&size=100",
          body: undefined,
        },
        response: {
          url: "https://www.ticketfairy.com/api/v1/events/listing",
          status: 200,
          headers: { "content-type": "text/html" },
          body: "<html>not json</html>",
        },
      },
    ]);
    await expect(ticketfairyAdapter.harvest!(source, run)).rejects.toThrow(
      "ticketfairy: unexpected body",
    );
  });
  it("ticketfairyQueryUrl with city param does not send city to API", () => {
    const url = ticketfairyQueryUrl(
      "https://www.ticketfairy.com/api/v1/events/listing?country=IN&city=New%20Delhi",
      "2026-11-07",
      "2026-11-20",
      "Asia/Kolkata",
    );
    const parsed = new URL(url);
    expect(parsed.searchParams.get("country")).toBe("IN");
    expect(parsed.searchParams.get("state")).toBeNull();
    expect(parsed.searchParams.get("city")).toBeNull(); // city should not be sent
  });

  it("state source: events with no point but matching state are kept", () => {
    const runCtx = ctx([]);
    // Create a modified event based on LA NOCHE
    const baseEvent = (fixtureEvents as TfEvent[]).find((e) => e.displayName.includes("LA NOCHE"));
    if (!baseEvent) throw new Error("Test fixture missing LA NOCHE");

    // Event 1: null coords, state Quintana Roo -> kept
    const event1 = structuredClone(baseEvent);
    event1.venue.latitude = null;
    event1.venue.longitude = null;
    event1.venue.state = "Quintana Roo";
    event1.venue.city = "Tulum";

    // Event 2: null coords, state Jalisco -> skipped
    const event2 = structuredClone(baseEvent);
    event2.displayName = "Event in Jalisco";
    event2.url = "https://www.ticketfairy.com/event/jalisco-event";
    event2.venue.latitude = null;
    event2.venue.longitude = null;
    event2.venue.state = "Jalisco";
    event2.venue.city = "Guadalajara";

    // Event 3: hidden venue with coords, state Quintana Roo -> kept with venueLocation null
    const event3 = structuredClone(baseEvent);
    event3.displayName = "Hidden Venue Event";
    event3.url = "https://www.ticketfairy.com/event/hidden-venue";
    event3.venue.hidden = true;
    event3.venue.latitude = "20.1500881";
    event3.venue.longitude = "-87.4591118";
    event3.venue.state = "Quintana Roo";

    const events = [event1, event2, event3];
    const { listings, notes } = ticketfairyToListings(events, runCtx, {
      fetchedAt: NOW,
      fromNight: "2026-11-07",
      state: "Quintana Roo",
      city: null,
    });

    expect(listings).toHaveLength(2); // event1 and event3 kept
    expect(listings.some((l) => l.listing.title === "LA NOCHE")).toBe(true);
    expect(listings.some((l) => l.listing.title === "Hidden Venue Event")).toBe(true);
    expect(notes).toContain("ticketfairy: 1 events with no venue point outside the source's area");
  });

  it("city source: events with no point but matching city are kept", () => {
    const runCtx = ctx([]);
    const baseEvent = (fixtureEvents as TfEvent[]).find((e) => e.displayName.includes("LA NOCHE"));
    if (!baseEvent) throw new Error("Test fixture missing LA NOCHE");

    // Event 1: null coords, city New Delhi -> kept
    const event1 = structuredClone(baseEvent);
    event1.displayName = "Event in New Delhi";
    event1.url = "https://www.ticketfairy.com/event/new-delhi-event";
    event1.venue.latitude = null;
    event1.venue.longitude = null;
    event1.venue.city = "New Delhi";
    event1.venue.state = "Delhi";

    // Event 2: null coords, city Bengaluru -> skipped
    const event2 = structuredClone(baseEvent);
    event2.displayName = "Event in Bengaluru";
    event2.url = "https://www.ticketfairy.com/event/bengaluru-event";
    event2.venue.latitude = null;
    event2.venue.longitude = null;
    event2.venue.city = "Bengaluru";
    event2.venue.state = "Karnataka";

    const events = [event1, event2];
    const { listings, notes } = ticketfairyToListings(events, runCtx, {
      fetchedAt: NOW,
      fromNight: "2026-11-07",
      state: null,
      city: "New Delhi",
    });

    expect(listings).toHaveLength(1);
    expect(listings[0]?.listing.title).toBe("Event in New Delhi");
    expect(notes).toContain("ticketfairy: 1 events with no venue point outside the source's area");
  });

  it("country-only source: events with no point are skipped", () => {
    const runCtx = ctx([]);
    const baseEvent = (fixtureEvents as TfEvent[]).find((e) => e.displayName.includes("LA NOCHE"));
    if (!baseEvent) throw new Error("Test fixture missing LA NOCHE");

    const event1 = structuredClone(baseEvent);
    event1.venue.latitude = null;
    event1.venue.longitude = null;
    event1.venue.city = "Some City";
    event1.venue.state = "Some State";

    const events = [event1];
    const { listings, notes } = ticketfairyToListings(events, runCtx, {
      fetchedAt: NOW,
      fromNight: "2026-11-07",
      state: null,
      city: null,
    });

    expect(listings).toHaveLength(0);
    expect(notes).toContain("ticketfairy: 1 events with no venue point outside the source's area");
  });

  it("non-dance screening: adapter keeps all events, screenNoDance screens them", async () => {
    const runCtx = ctx([]);
    const baseEvent = (fixtureEvents as TfEvent[]).find((e) => e.displayName.includes("LA NOCHE"));
    if (!baseEvent) throw new Error("Test fixture missing LA NOCHE");

    // Create a yoga event
    const yogaEvent = structuredClone(baseEvent);
    yogaEvent.displayName = "Sunrise Yoga Retreat";
    yogaEvent.shortDescription = "A morning of yoga, breathwork and meditation by the sea.";
    yogaEvent.url = "https://www.ticketfairy.com/event/yoga-retreat";

    const events = [yogaEvent];
    const { listings } = ticketfairyToListings(events, runCtx, {
      fetchedAt: NOW,
      fromNight: "2026-11-07",
      state: "Quintana Roo",
      city: null,
    });

    expect(listings).toHaveLength(1);

    // Import screenNoDance and test screening
    const { screenNoDance } = await import("@/src/domain/listing-screen");
    const listing = listings[0];
    if (!listing) throw new Error("No listing");

    const screenResult = screenNoDance(
      {
        title: listing.listing.title,
        styles: [],
        startsAt: new Date("2026-11-08T00:30:00Z"),
        nightDate: "2026-11-07",
        tz: "America/Cancun",
        evidenceText: "A morning of yoga, breathwork and meditation by the sea.",
      },
      { mixedCalendar: true, styles: [] },
    );

    // The screen should identify this as non-dance
    expect(screenResult).not.toBeNull();
  });
});
