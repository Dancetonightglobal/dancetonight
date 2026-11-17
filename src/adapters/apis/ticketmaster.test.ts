import { describe, expect, it } from "vitest";

import {
  danceRelevance,
  isTmNotDanceNight,
  TICKETMASTER_QUERIES,
  TICKETMASTER_TRIAL_QUERIES,
  ticketmasterAdapter,
  ticketmasterToListings,
  ticketmasterUrl,
  windowUtc,
} from "@/src/adapters/apis/ticketmaster";
import type { Metro, RunCtx, Source } from "@/src/adapters/types";
import { createPoliteHttp, fixtureTransport, type Fixture } from "@/src/pipeline/http";
import { normalizeListing } from "@/src/pipeline/normalize";

// Events built in the Discovery API v2 response shape (SOURCES 2.1); re-recorded on the first
// live run with the key masked as REDACTED.
const NOW = new Date("2026-09-23T16:00:00Z");
const NIGHTS = ["2026-09-23", "2026-09-24", "2026-09-25"];
const NYC: Metro = {
  id: "m",
  slug: "nyc",
  name: "New York",
  countryCode: "US",
  center: { lat: 40.7128, lng: -74.006 },
  radiusKm: 40,
  tz: "America/New_York",
  languages: ["en"],
};

const venue = {
  name: "Webster Hall",
  address: { line1: "125 E 11th St" },
  city: { name: "New York" },
  state: { stateCode: "NY" },
  postalCode: "10003",
  location: { longitude: "-73.9894", latitude: "40.7318" },
  timezone: "America/New_York",
};

const tmEvent = (
  id: string,
  name: string,
  classification: Record<string, string>,
  extra: Record<string, unknown> = {},
) => ({
  id,
  name,
  url: `https://www.ticketmaster.com/event/${id}`,
  dates: {
    start: { localDate: "2026-09-25", localTime: "22:00:00", dateTime: "2026-09-26T02:00:00Z" },
    timezone: "America/New_York",
    status: { code: "onsale" },
  },
  classifications: [
    {
      segment: { name: classification.segment ?? "Music" },
      genre: { name: classification.genre ?? "Undefined" },
      subGenre: { name: classification.subGenre ?? "Undefined" },
    },
  ],
  _embedded: { venues: [venue] },
  ...extra,
});

const EVENTS = [
  tmEvent(
    "A1",
    "Techno Friday: Warehouse Sessions",
    { genre: "Dance/Electronic", subGenre: "Techno" },
    {
      priceRanges: [{ type: "standard", currency: "USD", min: 25, max: 40 }],
    },
  ),
  tmEvent("A2", "Salsa Social with Live Orquesta", { genre: "Latin" }),
  tmEvent("A3", "Knicks vs Celtics", { segment: "Sports", genre: "Basketball" }),
  tmEvent("A4", "Swan Lake", { segment: "Arts & Theatre", genre: "Dance" }),
  tmEvent("A5", "Silent Disco Dance Party", { segment: "Arts & Theatre", genre: "Dance" }),
  tmEvent(
    "A6",
    "Bachata Night",
    { genre: "Latin" },
    {
      dates: {
        start: { localDate: "2026-09-26", dateTBA: false, timeTBA: true },
        status: { code: "onsale" },
      },
    },
  ),
  tmEvent(
    "A7",
    "Reggaeton Takeover",
    { genre: "Latin" },
    {
      dates: {
        start: { localDate: "2026-09-26", localTime: "23:30:00" },
        timezone: "America/New_York",
        status: { code: "cancelled" },
      },
    },
  ),
];

const TRIAL_ONLY = [
  tmEvent("T1", "Zouk Social Night", { genre: "Latin" }),
  tmEvent("T2", "Hustle (Comedy Show)", { segment: "Arts & Theatre", genre: "Comedy" }),
  tmEvent("T3", "An Evening of Poetry", { segment: "Arts & Theatre", genre: "Spoken Word" }),
];

const page = (events: unknown[]) =>
  JSON.stringify({
    _embedded: events.length ? { events } : undefined,
    page: { size: 200, totalElements: events.length, totalPages: events.length ? 1 : 0, number: 0 },
  });

function ctx(): RunCtx & { requests: string[] } {
  const queries = [...TICKETMASTER_QUERIES, ...TICKETMASTER_TRIAL_QUERIES];
  const fixtures: Fixture[] = queries.map((query, i) => {
    const url = ticketmasterUrl(NYC, NIGHTS, query, "REDACTED", 0);
    // The first query answers with everything; a later one repeats an event, which is kept once,
    // and so does the first trial keyword. The second trial keyword alone finds a zouk social
    // and a comedy show: both are reported, neither is written (D-132).
    const trialAt = i - TICKETMASTER_QUERIES.length;
    const body =
      i === 0
        ? page(EVENTS)
        : i === 1 || trialAt === 0
          ? page([EVENTS[1]])
          : trialAt === 1
            ? page(TRIAL_ONLY)
            : page([]);
    return { request: { method: "GET", url }, response: { url, status: 200, headers: {}, body } };
  });
  const transport = fixtureTransport(fixtures);
  let t = NOW.getTime();
  return {
    metro: NYC,
    now: () => new Date(t),
    http: createPoliteHttp({
      transport,
      userAgent: "t",
      now: () => t,
      sleep: async (ms) => void (t += ms),
    }),
    env: { TICKETMASTER_API_KEY: "REDACTED" },
    log: () => {},
    requests: transport.requests,
  };
}

describe("Ticketmaster", () => {
  it("asks for the night window as UTC instants from 06:00 to 06:00", () => {
    expect(windowUtc(NIGHTS, "America/New_York")).toEqual({
      start: "2026-09-23T10:00:00Z",
      end: "2026-09-26T10:00:00Z",
    });
    const url = new URL(ticketmasterUrl(NYC, NIGHTS, { keyword: "salsa" }, "k"));
    expect(url.searchParams.get("latlong")).toBe("40.7128,-74.0060");
    expect(url.searchParams.get("radius")).toBe("40");
    expect(url.searchParams.get("keyword")).toBe("salsa");
  });

  it("keeps dance events and leaves out sports, stage dance and the rest", () => {
    expect(
      danceRelevance("Knicks vs Celtics", {
        segment: "Sports",
        genre: "Basketball",
        subGenre: null,
      }).keep,
    ).toBe(false);
    expect(
      danceRelevance("Swan Lake", { segment: "Arts & Theatre", genre: "Dance", subGenre: null }),
    ).toMatchObject({
      keep: false,
      reason: "stage dance",
    });
    expect(
      danceRelevance("Techno Friday", {
        segment: "Music",
        genre: "Dance/Electronic",
        subGenre: "Techno",
      }),
    ).toMatchObject({
      keep: true,
      type: "club_night",
    });
    expect(
      danceRelevance("Taylor Swift", { segment: "Music", genre: "Pop", subGenre: null }).keep,
    ).toBe(false);
  });

  it("searches the metro and returns tonight's dance events once each", async () => {
    const run = ctx();
    const result = await ticketmasterAdapter.harvestMetro!(NYC, NIGHTS, run);
    expect(run.requests).toHaveLength(
      TICKETMASTER_QUERIES.length + TICKETMASTER_TRIAL_QUERIES.length,
    );
    // "Time TBA" is listed with its night and no time (D-060), not skipped. Each trial keyword
    // says what it brought (D-132): the first found one event, kept, that a standing query had.
    const trial = result.notes!.filter((n) => n.startsWith("trial keyword"));
    expect(result.notes!.filter((n) => !n.startsWith("trial keyword"))).toEqual([]);
    expect(trial).toHaveLength(TICKETMASTER_TRIAL_QUERIES.length);
    expect(trial[0]).toBe(
      'trial keyword "hustle": 1 events, 0 no standing query found, 0 would be listed (not written)',
    );
    // A trial keyword's own finds go through the rules and are reported, never written: the
    // comedy show shows why (its name names a dance).
    expect(trial[1]).toBe(
      'trial keyword "zouk": 3 events, 3 no standing query found, 2 would be listed (not written): ' +
        "Zouk Social Night (2026-09-25); Hustle (Comedy Show) (2026-09-25)",
    );
    expect(result.listings.some((l) => /^tm:T/.test(l.externalId ?? ""))).toBe(false);
    expect(result.screened?.some((s) => /^tm:T/.test(s.externalId))).toBe(false);

    const source = { styles: [] } as unknown as Source;
    const events = result.listings.map((l) => {
      const o = normalizeListing(l, { metro: NYC, source, now: NOW });
      if (!o.ok) throw new Error(o.reason);
      return o.event;
    });
    expect(events.map((e) => e.title)).toEqual([
      "Techno Friday: Warehouse Sessions",
      "Salsa Social with Live Orquesta",
      "Silent Disco Dance Party",
      "Bachata Night",
      "Reggaeton Takeover",
    ]);
    const [techno, salsa, silent, bachata, reggaeton] = events;
    expect(bachata).toMatchObject({
      key: "tm:A6",
      nightDate: "2026-09-26",
      startsAt: null,
      doorsAt: null,
      evidence: expect.objectContaining({
        start: "dates.start 2026-09-26 timeTBA America/New_York",
      }),
    });
    expect(techno).toMatchObject({
      key: "tm:A1",
      listingType: "club_night",
      styles: ["techno"],
      nightDate: "2026-09-25",
      ticketUrl: "https://www.ticketmaster.com/event/A1",
      prices: [{ label: "Tickets, $25 to $40", amount: null, currency: "USD", includes: null }],
      venue: {
        name: "Webster Hall",
        address: "125 E 11th St, New York, NY, 10003",
        location: { lat: 40.7318, lng: -73.9894 },
      },
    });
    expect(techno?.doorsAt?.toISOString()).toBe("2026-09-26T02:00:00.000Z");
    expect(salsa).toMatchObject({ listingType: "social", styles: ["salsa"] });
    expect(silent).toMatchObject({ styles: ["silent_disco"] });
    expect(reggaeton).toMatchObject({
      cancelled: true,
      confirmation: "cancelled",
      nightDate: "2026-09-26",
    });
  });

  it("lists a night with no specific time as untimed, ignoring a placeholder time, and skips a date TBA", () => {
    const { listings, notes } = ticketmasterToListings(
      [
        tmEvent(
          "B1",
          "Salsa Night",
          { genre: "Latin" },
          {
            dates: {
              start: { localDate: "2026-09-25", localTime: "00:00:00", noSpecificTime: true },
              timezone: "America/New_York",
              status: { code: "onsale" },
            },
          },
        ),
        tmEvent(
          "B2",
          "Bachata Weekender",
          { genre: "Latin" },
          { dates: { start: { localDate: "2026-09-25", dateTBA: true, timeTBA: true } } },
        ),
      ],
      { metro: NYC, fetchedAt: NOW },
    );
    expect(notes).toEqual(["date not announced yet: Bachata Weekender"]);
    expect(listings).toHaveLength(1);
    expect(listings[0]?.listing).toMatchObject({
      local_date: "2026-09-25",
      doors_time: null,
      lesson_time: null,
      dancing_time: null,
    });
    const o = normalizeListing(listings[0]!, {
      metro: NYC,
      source: { styles: [] } as unknown as Source,
      now: NOW,
    });
    // No invented midnight: the night is the listed date and the start is not listed.
    expect(o).toMatchObject({ ok: true, untimed: true, event: { nightDate: "2026-09-25" } });
  });

  it("labels a price range with its currency on both ends (D-071)", () => {
    // Run 26's "It's A 2000's Party!" stored "Tickets, 27.46 to 70.72": two numbers, no currency.
    const { listings } = ticketmasterToListings(
      [
        tmEvent(
          "C1",
          "Techno Friday",
          { genre: "Dance/Electronic" },
          {
            priceRanges: [
              { type: "standard", currency: "USD", min: 27.46, max: 70.72 },
              { type: "standard including fees", currency: "USD", min: 30, max: 75.5 },
              { type: "standard", currency: "EUR", min: 12, max: 12 },
            ],
          },
        ),
      ],
      { metro: NYC, fetchedAt: NOW },
    );
    expect(listings[0]?.listing.prices).toEqual([
      { label: "Tickets, $27.46 to $70.72", amount: null, currency: "USD", includes: null },
      { label: "Including fees, $30 to $75.50", amount: null, currency: "USD", includes: null },
      // One amount is an amount, printed beside the label by the detail page.
      { label: "Tickets", amount: 12, currency: "EUR", includes: null },
    ]);
    // The event's Ticketmaster page sells it and is its own page (D-073).
    expect(listings[0]).toMatchObject({
      eventUrl: "https://www.ticketmaster.com/event/C1",
      listing: { ticket_url: "https://www.ticketmaster.com/event/C1" },
    });
  });

  it("is not configured without a key", () => {
    expect(ticketmasterAdapter.requiredEnv).toEqual(["TICKETMASTER_API_KEY"]);
  });

  it("screens titles listed in TM_NOT_DANCE_NIGHTS per metro", () => {
    // First, verify that the event would be kept normally.
    const event = tmEvent(
      "AB1",
      "Alter Bridge w/ Big Wreck",
      { genre: "Dance/Electronic" },
      {
        dates: {
          start: { localDate: "2026-11-05", localTime: "20:00:00" },
          timezone: "America/New_York",
          status: { code: "onsale" },
        },
      },
    );
    const { listings, screened } = ticketmasterToListings([event], {
      metro: NYC,
      fetchedAt: NOW,
    });
    expect(listings).toHaveLength(1);
    expect(screened.find((s) => s.externalId === "tm:AB1")).toBeUndefined();

    // With Philadelphia metro slug, it should be screened.
    const phillyMetro = { ...NYC, slug: "philadelphia" as const };
    const { listings: phillyListings, screened: phillyScreened } = ticketmasterToListings([event], {
      metro: phillyMetro,
      fetchedAt: NOW,
    });
    expect(phillyListings).toHaveLength(0);
    expect(phillyScreened).toContainEqual({
      externalId: "tm:AB1",
      title: "Alter Bridge w/ Big Wreck",
      reason: "a title the metro lead checked as not a dance night (notDanceNights)",
    });

    // Case/punctuation insensitivity.
    expect(isTmNotDanceNight("ALTER BRIDGE w/ BIG WRECK", "philadelphia")).toBe(true);
    expect(isTmNotDanceNight("Alter Bridge w/ Big Wreck", "nyc")).toBe(false);
  });
});
