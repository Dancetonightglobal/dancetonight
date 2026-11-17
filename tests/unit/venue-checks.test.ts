// Venue checks at ingest (D-071): an API's point is checked against its geocoded street address,
// and a placeholder address never places a venue. Run 26 is the evidence: Ticketmaster's own
// points for Terminal 5 and Brooklyn Steel, and "Tango Arts, 123 Main St, New York, NY" from a
// model read, which the geocoder put in the Bronx.

import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { Metro, Source } from "@/src/adapters/types";
import type { Db } from "@/src/db/client";
import { events, metros, venues } from "@/src/db/schema";
import type { Point } from "@/src/domain/listing";
import { rawListingSchema } from "@/src/domain/listing";
import { haversineKm } from "@/src/data/listing-mapper";
import { EMPTY_BLOCKLIST } from "@/src/pipeline/blocklist";
import { createPoliteHttp, type TransportRequest } from "@/src/pipeline/http";
import { formatReport, runIngest } from "@/src/pipeline/ingest";
import { normalizeListing } from "@/src/pipeline/normalize";
import {
  loadMetro,
  resolveVenue,
  upsertSource,
  writeEvents,
  type VenueInput,
} from "@/src/pipeline/store";
import {
  emptyVenueReport,
  formatVenueReport,
  removePlaceholderVenues,
} from "@/src/pipeline/venue-checks";
import { closeTestDb, describeDb, requireDbInCi, resetDb, testDb } from "@/tests/unit/db-harness";

requireDbInCi();

const NY = "America/New_York";
const NOW = new Date("2026-09-28T16:00:00Z");

// Ticketmaster's venues as run 26 received them (fixtures of 2026-09-28, key masked).
const TM_VENUES = {
  terminal5: {
    name: "Terminal 5",
    address: { line1: "610 W. 56th Street" },
    city: { name: "New York" },
    state: { name: "New York", stateCode: "NY" },
    postalCode: "10019",
    location: { longitude: "-73.985298000", latitude: "40.765202000" },
    timezone: NY,
  },
  brooklynSteel: {
    name: "Brooklyn Steel",
    address: { line1: "319 Frost St" },
    city: { name: "Brooklyn" },
    state: { name: "New York", stateCode: "NY" },
    postalCode: "11222",
    location: { longitude: "-73.945602000", latitude: "40.727200000" },
    timezone: NY,
  },
  websterHall: {
    name: "Webster Hall",
    address: { line1: "125 East 11th Street" },
    city: { name: "New York" },
    state: { name: "New York", stateCode: "NY" },
    postalCode: "10003",
    location: { longitude: "-73.989098000", latitude: "40.731602000" },
    timezone: NY,
  },
};
const T5_ADDRESS = "610 W. 56th Street, New York, NY, 10019";
const T5_TM: Point = { lat: 40.765202, lng: -73.985298 };

// Where the buildings stand (the finding of 2026-09-28, read from the map): the answers a
// building-level geocode gives. Built in Geoapify's documented shape, not recorded.
const BUILDINGS: Record<string, Point> = {
  [T5_ADDRESS]: { lat: 40.7697, lng: -73.9929 },
  "319 Frost St, Brooklyn, NY, 11222": { lat: 40.719, lng: -73.9389 },
  "125 East 11th Street, New York, NY, 10003": { lat: 40.73184, lng: -73.98917 },
};

let db: Db;
let metro: Metro;

describeDb("venue checks, against Postgres", () => {
  beforeAll(async () => {
    db = await testDb("venue_checks");
  });
  afterAll(closeTestDb);

  beforeEach(async () => {
    await resetDb();
    await db.insert(metros).values({
      slug: "nyc",
      name: "New York",
      countryCode: "US",
      center: { lat: 40.7128, lng: -74.006 },
      radiusKm: 50,
      tz: NY,
      languages: ["en"],
    });
    metro = (await loadMetro(db, "nyc"))!;
  });

  /** A geocoder that knows the buildings above and records what it is asked. */
  function geocoder() {
    const asked: string[] = [];
    return {
      asked,
      geocode: async (address: string) => {
        asked.push(address);
        return BUILDINGS[address] ?? null;
      },
    };
  }
  const metresBetween = (a: Point, b: Point) => haversineKm(a, b) * 1000;
  const terminal5: VenueInput = {
    name: "Terminal 5",
    address: T5_ADDRESS,
    url: null,
    location: T5_TM,
  };
  const venueRow = async (id: string) => {
    const [row] = await db
      .select({
        name: venues.name,
        address: venues.address,
        lat: sql<number>`ST_Y(${venues.location}::geometry)`,
        lng: sql<number>`ST_X(${venues.location}::geometry)`,
        placeId: venues.googlePlaceId,
        checkedAt: venues.googlePlaceCheckedAt,
      })
      .from(venues)
      .where(eq(venues.id, id));
    return row ? { ...row, at: { lat: Number(row.lat), lng: Number(row.lng) } } : undefined;
  };

  describe("an API's point against its street address", () => {
    it("uses the address's point when they are more than 150 m apart (Terminal 5)", async () => {
      const g = geocoder();
      const report = emptyVenueReport();
      const placed = await resolveVenue(db, metro, terminal5, g.geocode, {
        checkPoint: true,
        building: g.geocode,
        report,
      });
      expect(g.asked).toEqual([T5_ADDRESS]);
      expect(placed?.location).toEqual(BUILDINGS[T5_ADDRESS]);
      expect(metresBetween(T5_TM, BUILDINGS[T5_ADDRESS]!)).toBeGreaterThan(600);
      expect((await venueRow(placed!.venueId))?.at).toEqual(BUILDINGS[T5_ADDRESS]);
      expect(report.moved).toHaveLength(1);
      expect(report.moved[0]).toMatch(
        /^Terminal 5: the listed point is \d{3} m from 610 W\. 56th Street, New York, NY, 10019; the address's point is used$/,
      );
    });

    it("keeps the API's point within 150 m of the address, or when the address finds no building", async () => {
      const g = geocoder();
      const report = emptyVenueReport();
      const tmWebster = { lat: 40.731602, lng: -73.989098 };
      const webster = await resolveVenue(
        db,
        metro,
        {
          name: "Webster Hall",
          address: "125 East 11th Street, New York, NY, 10003",
          url: null,
          location: tmWebster,
        },
        g.geocode,
        { checkPoint: true, building: g.geocode, report },
      );
      expect(webster?.location).toEqual(tmWebster);
      const unknown = await resolveVenue(
        db,
        metro,
        { name: "Somewhere", address: "9 Nowhere Lane", url: null, location: T5_TM },
        g.geocode,
        { checkPoint: true, building: g.geocode, report },
      );
      expect(unknown?.location).toEqual(T5_TM);
      expect(report.moved).toEqual([]);
    });

    it("checks no point unless asked to (a ticketing API's; see the ingest runs below)", async () => {
      const g = geocoder();
      const placed = await resolveVenue(db, metro, terminal5, g.geocode, {});
      expect(g.asked).toEqual([]);
      expect(placed?.location).toEqual(T5_TM);
    });

    it("moves the venue a listing created at the wrong point, clears its place ID, and its listings follow", async () => {
      // The state run 26 left: the venue at Ticketmaster's point, looked up in the wrong box.
      const before = await resolveVenue(db, metro, terminal5);
      expect(before?.created).toBe(true);
      await db
        .update(venues)
        .set({ googlePlaceId: "ChIJwrongbox00000", googlePlaceCheckedAt: NOW })
        .where(eq(venues.id, before!.venueId));
      await db.insert(events).values({
        slug: "dj-shadow",
        title: "DJ Shadow",
        titleNormalized: "dj shadow",
        listingType: "club_night",
        styles: [],
        nightDate: "2026-10-10",
        tz: NY,
        confirmation: "recurring_unconfirmed",
        venueId: before!.venueId,
        geo: T5_TM,
        metroId: metro.id,
      });

      const report = emptyVenueReport();
      const after = await resolveVenue(db, metro, terminal5, geocoder().geocode, {
        checkPoint: true,
        building: geocoder().geocode,
        report,
      });
      // The same venue, now at the building, to be looked up again in the right box.
      expect(after?.venueId).toBe(before!.venueId);
      expect(after?.location).toEqual(BUILDINGS[T5_ADDRESS]);
      expect(await venueRow(before!.venueId)).toMatchObject({
        at: BUILDINGS[T5_ADDRESS],
        placeId: null,
        checkedAt: null,
      });
      const [event] = await db
        .select({
          lat: sql<number>`ST_Y(${events.geo}::geometry)`,
          lng: sql<number>`ST_X(${events.geo}::geometry)`,
        })
        .from(events);
      expect({ lat: Number(event!.lat), lng: Number(event!.lng) }).toEqual(BUILDINGS[T5_ADDRESS]);
      expect(report.moved[0]).toContain("and the stored venue moved there");
      expect(await db.select({ n: sql<number>`count(*)::int` }).from(venues)).toEqual([{ n: 1 }]);

      // The next run finds it at the building: nothing moves, and its new place ID stays.
      await db
        .update(venues)
        .set({ googlePlaceId: "ChIJterminal50000" })
        .where(eq(venues.id, before!.venueId));
      const next = emptyVenueReport();
      const again = await resolveVenue(db, metro, terminal5, geocoder().geocode, {
        checkPoint: true,
        building: geocoder().geocode,
        report: next,
      });
      expect(again?.venueId).toBe(before!.venueId);
      expect((await venueRow(before!.venueId))?.placeId).toBe("ChIJterminal50000");
      expect(next.moved[0]).not.toContain("moved there");
    });

    const venueCount = async () =>
      (await db.select({ n: sql<number>`count(*)::int` }).from(venues))[0]?.n;
    const noAnswer = async () => null;

    it("keeps the venue a check placed when a later run's geocoder gives no answer, and says so", async () => {
      const first = await resolveVenue(db, metro, terminal5, geocoder().geocode, {
        checkPoint: true,
        building: geocoder().geocode,
      });
      expect(first?.location).toEqual(BUILDINGS[T5_ADDRESS]);

      // Geoapify is down: no second Terminal 5 at Ticketmaster's point, and no pin there.
      const report = emptyVenueReport();
      const outage = await resolveVenue(db, metro, terminal5, noAnswer, {
        checkPoint: true,
        building: noAnswer,
        report,
      });
      expect(outage).toMatchObject({ venueId: first!.venueId, location: BUILDINGS[T5_ADDRESS] });
      expect(await venueCount()).toBe(1);
      expect(report.unchecked).toEqual([
        "Terminal 5: no building-level answer for 610 W. 56th Street, New York, NY, 10019; the venue already stored for it is used",
      ]);
      const line = formatVenueReport(report);
      expect(line).not.toContain("no listed point far from its address");
      expect(line).toContain(
        "1 listed point not checked against the address (no geocoder, or no building-level answer).",
      );

      // With no geocoder at all, the same.
      const off = emptyVenueReport();
      expect(
        await resolveVenue(db, metro, terminal5, undefined, { checkPoint: true, report: off }),
      ).toMatchObject({ venueId: first!.venueId, location: BUILDINGS[T5_ADDRESS] });
      expect(off.unchecked[0]).toMatch(/^Terminal 5: no geocoder in this run for 610 W\. 56th/);

      // The geocoder is back: still the one venue.
      const back = await resolveVenue(db, metro, terminal5, geocoder().geocode, {
        checkPoint: true,
        building: geocoder().geocode,
      });
      expect(back?.venueId).toBe(first!.venueId);
      expect(await venueCount()).toBe(1);
    });

    it("gives a listing the point its venue is stored at when the venue it created has moved", async () => {
      // Created at Ticketmaster's point, then moved to the building by a check.
      const before = await resolveVenue(db, metro, terminal5);
      await db
        .update(venues)
        .set({ location: BUILDINGS[T5_ADDRESS] })
        .where(eq(venues.id, before!.venueId));
      const again = await resolveVenue(db, metro, terminal5);
      expect(again).toMatchObject({
        venueId: before!.venueId,
        location: BUILDINGS[T5_ADDRESS],
        created: false,
      });
      expect(await venueCount()).toBe(1);
    });
  });

  describe("a placeholder address", () => {
    const tangoArts: VenueInput = {
      name: "Tango Arts",
      address: "123 Main St, New York, NY",
      url: null,
      location: null,
    };

    it("is never geocoded: the listing is unplaced, and the report says why", async () => {
      const g = geocoder();
      const report = emptyVenueReport();
      expect(await resolveVenue(db, metro, tangoArts, g.geocode, { report })).toBeNull();
      expect(g.asked).toEqual([]);
      expect(report.placeholders).toEqual([
        'Tango Arts: "123 Main St, New York, NY" is a placeholder address; not geocoded',
      ]);
      expect(formatVenueReport(report)).toContain("1 placeholder address refused");
    });

    it("is not stored when the source gives a point of its own", async () => {
      const at = { lat: 40.7, lng: -73.95 };
      const placed = await resolveVenue(
        db,
        metro,
        { ...tangoArts, location: at },
        geocoder().geocode,
        { checkPoint: true, building: geocoder().geocode },
      );
      expect(placed?.location).toEqual(at);
      expect((await venueRow(placed!.venueId))?.address).toBeNull();
    });

    it("unplaces the listings of a venue pinned from one before D-071, and a re-read stays unplaced", async () => {
      const bronx = { lat: 40.82400312244898, lng: -73.8083363877551 };
      // Run 26's row: created from the model's address, geocoded to the Bronx.
      const [invented] = await db
        .insert(venues)
        .values({
          name: "Tango Arts",
          nameNormalized: "tango arts",
          location: bronx,
          address: { formatted: "123 Main St, New York, NY" },
          tz: NY,
          seedProvider: "listing",
          metroId: metro.id,
        })
        .returning({ id: venues.id });
      // A seeded venue's address came from its seed, and a listing's real address is real.
      await db.insert(venues).values([
        {
          name: "Clock Tower",
          nameNormalized: "clock tower",
          location: { lat: 40.7033, lng: -73.9881 },
          address: { formatted: "1 Main St, Brooklyn, NY 11201" },
          tz: NY,
          seedProvider: "overture test",
          metroId: metro.id,
        },
        {
          name: "Stepping Out Studios",
          nameNormalized: "stepping out studios",
          location: { lat: 40.7639, lng: -73.9974 },
          address: { formatted: "617 W 46th St, New York, NY, 10036" },
          tz: NY,
          seedProvider: "listing",
          metroId: metro.id,
        },
      ]);
      await db.insert(events).values({
        slug: "tango-arts",
        title: "Tango Arts Milonga",
        titleNormalized: "tango arts milonga",
        listingType: "social",
        styles: ["milonga"],
        nightDate: "2026-10-02",
        tz: NY,
        confirmation: "recurring_unconfirmed",
        venueId: invented!.id,
        geo: bronx,
        metroId: metro.id,
      });

      const report = emptyVenueReport();
      await removePlaceholderVenues(db, metro, report);
      expect(report.removed).toEqual([
        'Tango Arts ("123 Main St, New York, NY") removed; 1 listing unplaced',
      ]);
      expect(
        (await db.select({ name: venues.name }).from(venues)).map((v) => v.name).sort(),
      ).toEqual(["Clock Tower", "Stepping Out Studios"]);
      const [row] = await db.select({ venueId: events.venueId, geo: events.geo }).from(events);
      expect(row).toEqual({ venueId: null, geo: null });

      // The model reads the page again: the listing is written unplaced, not back in the Bronx.
      const source: Source = await upsertSource(db, metro.id, {
        url: "https://nuevotangoarts.org/",
        kind: "html",
        trustTier: "first_party",
        discoveredBy: "seed_list",
      });
      const outcome = normalizeListing(
        {
          listing: rawListingSchema.parse({
            title: "Tango Arts Milonga",
            listing_type: "social",
            styles: ["milonga"],
            local_date: "2026-10-02",
            dancing_time: "20:00",
            venue: { name: "Tango Arts", address: "123 Main St, New York, NY" },
            organizer: {},
          }),
          externalId: null,
          tz: null,
          venueLocation: null,
          recurrence: null,
          provenance: { sourceUrl: "https://nuevotangoarts.org/", fetchedAt: NOW, method: "llm" },
        },
        { metro, source, now: NOW },
      );
      if (!outcome.ok) throw new Error(outcome.reason);
      const g = geocoder();
      const written = await writeEvents(db, {
        metro,
        source,
        events: [outcome.event],
        blocklist: EMPTY_BLOCKLIST,
        placeVenue: (input) => resolveVenue(db, metro, input, g.geocode),
      });
      expect(written).toMatchObject({ written: 1, unplaced: 1 });
      expect(g.asked).toEqual([]);
      expect(await db.select({ n: sql<number>`count(*)::int` }).from(venues)).toEqual([{ n: 2 }]);
    });
  });

  describe("one ingest run", () => {
    const tmEvent = (
      id: string,
      name: string,
      venue: Record<string, unknown>,
      extra: Record<string, unknown> = {},
    ) => ({
      id,
      name,
      url: `https://www.ticketmaster.com/event/${id}`,
      dates: {
        start: { localDate: "2026-10-10", localTime: "21:00:00" },
        timezone: NY,
        status: { code: "onsale" },
      },
      classifications: [
        { segment: { name: "Music" }, genre: { name: "Dance/Electronic" }, subGenre: {} },
      ],
      _embedded: { venues: [venue] },
      ...extra,
    });
    // Run 26's events at these venues, trimmed to the fields the adapter reads.
    const TM_BODY = {
      _embedded: {
        events: [
          tmEvent("Z7r9jZ1A70o7Z", "DJ Shadow", TM_VENUES.terminal5),
          tmEvent("Z7r9jZ1A7P8Gd", "Mind Enterprises (16 and Over)", TM_VENUES.brooklynSteel),
          tmEvent("W1", "It's A 2000's Party!", TM_VENUES.websterHall, {
            priceRanges: [{ type: "standard", currency: "USD", min: 27.46, max: 70.72 }],
          }),
        ],
      },
      page: { totalPages: 1 },
    };

    /** Geoapify's answer for an address: the buildings above, as buildings. */
    const buildingAnswer = (text: string) => {
      const point = BUILDINGS[text];
      return point
        ? { lat: point.lat, lon: point.lng, result_type: "building", housenumber: "1" }
        : null;
    };

    function transport(
      options: {
        ticketmaster?: unknown;
        geoapify?: (text: string) => Record<string, unknown> | null;
        pages?: Record<string, unknown>;
      } = {},
    ) {
      const seen: TransportRequest[] = [];
      let t = NOW.getTime();
      const http = createPoliteHttp({
        userAgent: "DanceTonightBot/1.0",
        now: () => t,
        sleep: async (ms) => void (t += ms),
        transport: async (req) => {
          seen.push(req);
          const url = new URL(req.url);
          let body: unknown = { results: [] };
          if (url.hostname === "app.ticketmaster.com") body = options.ticketmaster ?? TM_BODY;
          else if (url.hostname === "api.geoapify.com") {
            const answer = (options.geoapify ?? buildingAnswer)(url.searchParams.get("text") ?? "");
            if (answer) body = { results: [{ rank: { confidence: 1 }, ...answer }] };
          } else if (options.pages?.[req.url]) body = options.pages[req.url];
          const text = typeof body === "string" ? body : JSON.stringify(body);
          return { url: req.url, status: 200, headers: {}, body: text };
        },
      });
      return { http, seen, now: () => new Date(t) };
    }
    const venuesAt = async () =>
      Object.fromEntries(
        (
          await db
            .select({
              name: venues.name,
              lat: sql<number>`ST_Y(${venues.location}::geometry)`,
              lng: sql<number>`ST_X(${venues.location}::geometry)`,
            })
            .from(venues)
        ).map((v) => [v.name, { lat: Number(v.lat), lng: Number(v.lng) }]),
      );

    it("places Ticketmaster's venues at their buildings, prices ranges with the currency, and says so", async () => {
      // A venue pinned from a placeholder address by an earlier run.
      await db.insert(venues).values({
        name: "Tango Arts",
        nameNormalized: "tango arts",
        location: { lat: 40.824, lng: -73.808 },
        address: { formatted: "123 Main St, New York, NY" },
        tz: NY,
        seedProvider: "listing",
        metroId: metro.id,
      });
      const { http, seen, now } = transport();
      const report = await runIngest({
        db,
        metro,
        http,
        now,
        env: { TICKETMASTER_API_KEY: "REDACTED", GEOAPIFY_API_KEY: "REDACTED" },
        // No page source is harvested: this run is Ticketmaster's.
        only: ["https://nothing.example/"],
      });
      expect(report.sources.find((s) => s.adapter === "ticketmaster")).toMatchObject({
        status: "ok",
        written: 3,
      });

      const placed = await db
        .select({
          title: events.title,
          venue: venues.name,
          lat: sql<number>`ST_Y(${venues.location}::geometry)`,
          lng: sql<number>`ST_X(${venues.location}::geometry)`,
          prices: events.prices,
        })
        .from(events)
        .innerJoin(venues, eq(events.venueId, venues.id))
        .orderBy(events.title);
      const at = Object.fromEntries(
        placed.map((p) => [p.venue, { lat: Number(p.lat), lng: Number(p.lng) }]),
      );
      expect(at["Terminal 5"]).toEqual(BUILDINGS[T5_ADDRESS]);
      expect(at["Brooklyn Steel"]).toEqual(BUILDINGS["319 Frost St, Brooklyn, NY, 11222"]);
      // Within 150 m of its building: Ticketmaster's own point stands.
      expect(at["Webster Hall"]).toEqual({ lat: 40.731602, lng: -73.989098 });
      expect(placed.find((p) => p.venue === "Webster Hall")?.prices).toEqual([
        { label: "Tickets, $27.46 to $70.72", amount: null, currency: "USD", includes: null },
      ]);
      // Every Ticketmaster address was geocoded once.
      expect(seen.filter((r) => r.url.includes("api.geoapify.com"))).toHaveLength(3);

      const text = formatReport(report);
      expect(text).toContain(
        "Venues: 2 listed points more than 150 m from the geocoded address (the address's point used), 0 placeholder addresses refused, 1 venue pinned from a placeholder removed.",
      );
      expect(text).toMatch(/- Terminal 5: the listed point is \d+ m from 610 W\. 56th Street/);
      expect(text).toMatch(/- Brooklyn Steel: the listed point is \d+ m from 319 Frost St/);
      expect(text).toContain(
        '- Tango Arts ("123 Main St, New York, NY") removed; 0 listings unplaced',
      );
    });

    // An organiser's outdoor social on its own events page, whose schema.org Event gives its own
    // point on the terrace; Geoapify would put the address at the park's centre, 900 m away.
    const TERRACE = { lat: 40.774, lng: -73.9712 };
    const PARK_CENTRE = { lat: 40.7812, lng: -73.9665 };
    const STUDIO_EVENTS = "https://studio.example/events";
    const eventPage = `<html><head><script type="application/ld+json">${JSON.stringify({
      "@context": "https://schema.org",
      "@type": "Event",
      name: "Salsa on the Terrace",
      startDate: "2026-10-01T19:00:00-04:00",
      endDate: "2026-10-01T22:00:00-04:00",
      location: {
        "@type": "Place",
        name: "Bethesda Terrace",
        address: "Central Park, New York, NY 10024",
        geo: { "@type": "GeoCoordinates", latitude: TERRACE.lat, longitude: TERRACE.lng },
      },
    })}</script></head><body></body></html>`;

    it("never checks an organiser's own point on its own events page", async () => {
      await upsertSource(db, metro.id, {
        url: STUDIO_EVENTS,
        kind: "jsonld",
        trustTier: "first_party",
        discoveredBy: "seed_list",
      });
      const { http, seen, now } = transport({
        pages: { [STUDIO_EVENTS]: eventPage },
        geoapify: () => ({ lat: PARK_CENTRE.lat, lon: PARK_CENTRE.lng, result_type: "building" }),
      });
      const report = await runIngest({
        db,
        metro,
        http,
        now,
        env: { GEOAPIFY_API_KEY: "REDACTED" },
        only: [STUDIO_EVENTS],
      });
      expect(report.sources.find((s) => s.url === STUDIO_EVENTS)).toMatchObject({
        status: "ok",
        written: 1,
      });
      expect(seen.filter((r) => r.url.includes("api.geoapify.com"))).toEqual([]);
      expect((await venuesAt())["Bethesda Terrace"]).toEqual(TERRACE);
      const [event] = await db
        .select({
          lat: sql<number>`ST_Y(${events.geo}::geometry)`,
          lng: sql<number>`ST_X(${events.geo}::geometry)`,
        })
        .from(events);
      expect({ lat: Number(event!.lat), lng: Number(event!.lng) }).toEqual(TERRACE);
      expect(formatReport(report)).toContain("Venues: no listed point far from its address");
    });

    it("never moves a Ticketmaster venue to an amenity's point", async () => {
      const { http, now } = transport({
        ticketmaster: {
          _embedded: { events: [tmEvent("Z7r9jZ1A70o7Z", "DJ Shadow", TM_VENUES.terminal5)] },
          page: { totalPages: 1 },
        },
        // The building's point, but answered as an amenity: not a building-level answer.
        geoapify: (text) => {
          const building = buildingAnswer(text);
          return building ? { ...building, result_type: "amenity" } : null;
        },
      });
      const report = await runIngest({
        db,
        metro,
        http,
        now,
        env: { TICKETMASTER_API_KEY: "REDACTED", GEOAPIFY_API_KEY: "REDACTED" },
        only: ["https://nothing.example/"],
      });
      expect(report.sources.find((s) => s.adapter === "ticketmaster")).toMatchObject({
        status: "ok",
        written: 1,
      });
      expect((await venuesAt())["Terminal 5"]).toEqual(T5_TM);
      const text = formatReport(report);
      expect(text).toContain("Venues: 0 listed points more than 150 m from the geocoded address");
      expect(text).toContain(
        "- Terminal 5: no building-level answer for 610 W. 56th Street, New York, NY, 10019; the listed point is used",
      );
    });

    it("says when Geoapify gave no answer, and keeps the venue an earlier run placed", async () => {
      const one = {
        _embedded: { events: [tmEvent("Z7r9jZ1A70o7Z", "DJ Shadow", TM_VENUES.terminal5)] },
        page: { totalPages: 1 },
      };
      const run = (geoapify?: (text: string) => Record<string, unknown> | null) => {
        const { http, now } = transport({ ticketmaster: one, geoapify });
        return runIngest({
          db,
          metro,
          http,
          now,
          env: { TICKETMASTER_API_KEY: "REDACTED", GEOAPIFY_API_KEY: "REDACTED" },
          only: ["https://nothing.example/"],
        });
      };
      await run();
      const outage = await run(() => null);
      const text = formatReport(outage);
      expect(text).not.toContain("no listed point far from its address");
      expect(text).toContain("1 listed point not checked against the address");
      expect(text).toContain(
        "- Terminal 5: no building-level answer for 610 W. 56th Street, New York, NY, 10019; the venue already stored for it is used",
      );
      expect(
        (await db.select({ name: venues.name }).from(venues)).filter(
          (v) => v.name === "Terminal 5",
        ),
      ).toHaveLength(1);
      const [event] = await db
        .select({
          lat: sql<number>`ST_Y(${events.geo}::geometry)`,
          lng: sql<number>`ST_X(${events.geo}::geometry)`,
        })
        .from(events);
      expect({ lat: Number(event!.lat), lng: Number(event!.lng) }).toEqual(BUILDINGS[T5_ADDRESS]);
    });
  });
});
