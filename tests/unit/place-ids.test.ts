// Google place IDs for venues (D-066, D-071, D-077): the request asks for the id and nothing else,
// and the lookup stores what Google answers against the venues this window's listings use.

import { readFileSync } from "node:fs";
import path from "node:path";

import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { Metro } from "@/src/adapters/types";
import type { Db } from "@/src/db/client";
import { events, metros, venues } from "@/src/db/schema";
import { PLACE_ID_EXCLUSIONS } from "@/config/place-id-exclusions";
import {
  createPoliteHttp,
  fixtureKey,
  fixtureTransport,
  type Fixture,
  type TransportRequest,
} from "@/src/pipeline/http";
import {
  PLACE_BOX_METRES,
  PLACE_NAME_BIAS_METRES,
  PLACE_ID_FIELD_MASK,
  PLACE_ID_INTERVAL_MS,
  PLACE_ID_LOOKUPS_PER_RUN,
  PLACE_ID_REQUESTS_PER_RUN,
  PLACES_TEXT_SEARCH,
  isExcludedPlaceId,
  placeCheckBody,
  placeIdFrom,
  placeSearchBody,
  resolvePlaceIds,
} from "@/src/pipeline/place-ids";
import { formatPlaceIds } from "@/src/pipeline/ingest";
import { loadMetro } from "@/src/pipeline/store";
import { closeTestDb, describeDb, requireDbInCi, resetDb, testDb } from "@/tests/unit/db-harness";

requireDbInCi();

const NY = "America/New_York";
const NOW = new Date("2026-09-28T20:00:00Z");
const TONIGHT = "2026-09-28";

/** Pier 16's place ID: run 26 stored it for The Rooftop at Pier 17, and run 27 kept it. */
const PIER_16 = "ChIJEUK6-jxawokR25HbqniSoiY";
/**
 * The Rooftop at Pier 17 as run 26 stored it: Ticketmaster's point (venue KovZpZAatEFA), 207 m
 * from the venue, and its address.
 */
const ROOFTOP = {
  name: "The Rooftop at Pier 17",
  address: { formatted: "89 South Street, New York, NY, 10038" },
  location: { lat: 40.706369, lng: -74.003827 },
};
/** Where the Rooftop is: Overture 2026-09-23.0, "89 South St Pier 17", confidence 1.0. */
const ROOFTOP_OVERTURE = { lat: 40.705498, lng: -74.001656 };

type Rectangle = {
  rectangle: {
    low: { latitude: number; longitude: number };
    high: { latitude: number; longitude: number };
  };
};
const holds = ({ rectangle: { low, high } }: Rectangle, at: { lat: number; lng: number }) =>
  at.lat >= low.latitude &&
  at.lat <= high.latitude &&
  at.lng >= low.longitude &&
  at.lng <= high.longitude;

describe("the Text Search request", () => {
  it("asks for the place id and nothing else, the free IDs Only SKU", () => {
    // Any other field in the mask bills a paid SKU (Text Search Pro or Enterprise).
    expect(PLACE_ID_FIELD_MASK).toBe("places.id");
    expect(PLACE_ID_LOOKUPS_PER_RUN).toBe(100);
    expect(PLACES_TEXT_SEARCH).toBe("https://places.googleapis.com/v1/places:searchText");
  });

  it("searches the venue's name and address inside a small box around its own point", () => {
    const body = JSON.parse(
      placeSearchBody({
        name: "Stepping Out Studios",
        address: { formatted: "37 W 26th St" },
        location: { lat: 40.7441, lng: -73.9897 },
      }),
    );
    expect(body.textQuery).toBe("Stepping Out Studios, 37 W 26th St");
    expect(body.pageSize).toBe(1);
    const { low, high } = body.locationRestriction.rectangle;
    const metresNorth = (high.latitude - low.latitude) * 111_320;
    const metresEast =
      (high.longitude - low.longitude) * 111_320 * Math.cos((40.7441 * Math.PI) / 180);
    // 200 m across: a place of that name elsewhere in the city is outside it.
    expect(PLACE_BOX_METRES).toBe(100);
    expect(metresNorth).toBeCloseTo(200, 3);
    expect(metresEast).toBeCloseTo(200, 3);
    expect((low.latitude + high.latitude) / 2).toBeCloseTo(40.7441, 9);
    expect((low.longitude + high.longitude) / 2).toBeCloseTo(-73.9897, 9);
  });

  it("uses the first address line, or the name alone, when that is all there is", () => {
    const at = { lat: 40.7, lng: -74 };
    expect(
      JSON.parse(
        placeSearchBody({ name: "Back Room", address: { line1: "102 Norfolk St" }, location: at }),
      ).textQuery,
    ).toBe("Back Room, 102 Norfolk St");
    expect(
      JSON.parse(placeSearchBody({ name: "Back Room", address: null, location: at })).textQuery,
    ).toBe("Back Room");
  });

  it("asks the check question by name alone, biased towards ±500 m and not restricted (D-077)", () => {
    const venue = {
      name: "The Factory",
      address: { formatted: "144 Allen Street, New York, NY 10012" },
      location: { lat: 40.72035, lng: -73.99006 },
    };
    const both = JSON.parse(placeSearchBody(venue));
    const check = JSON.parse(placeCheckBody(venue));
    expect(both.textQuery).toBe("The Factory, 144 Allen Street, New York, NY 10012");
    // Exactly these keys: no restriction, and no rankPreference, which Google's guide says to
    // leave unset for a query that names a place.
    expect(check).toEqual({
      textQuery: "The Factory",
      pageSize: 1,
      locationBias: expect.any(Object),
    });
    expect(Object.keys(check.locationBias)).toEqual(["rectangle"]);
    const { low, high } = check.locationBias.rectangle;
    expect(PLACE_NAME_BIAS_METRES).toBe(500);
    expect((high.latitude - low.latitude) * 111_320).toBeCloseTo(1000, 3);
    expect(
      (high.longitude - low.longitude) * 111_320 * Math.cos((40.72035 * Math.PI) / 180),
    ).toBeCloseTo(1000, 3);
    expect((low.latitude + high.latitude) / 2).toBeCloseTo(40.72035, 9);
    expect((low.longitude + high.longitude) / 2).toBeCloseTo(-73.99006, 9);
    // The first question keeps its small restricted box.
    expect(both.locationRestriction).toBeDefined();
    expect(both.locationBias).toBeUndefined();
  });

  it("reaches the Rooftop's own point from Ticketmaster's, which the small box does not (D-077)", () => {
    const box = JSON.parse(placeSearchBody(ROOFTOP)).locationRestriction as Rectangle;
    const bias = JSON.parse(placeCheckBody(ROOFTOP)).locationBias as Rectangle;
    // The small box around Ticketmaster's point holds its own centre but not the Rooftop: both of
    // D-071's questions could only name a place inside it, and Pier 16 was.
    expect(holds(box, ROOFTOP.location)).toBe(true);
    expect(holds(box, ROOFTOP_OVERTURE)).toBe(false);
    expect(holds(bias, ROOFTOP_OVERTURE)).toBe(true);
  });

  it("keeps a hand-kept list of wrong place IDs, starting with Pier 16 for the Rooftop", () => {
    expect(PLACE_ID_EXCLUSIONS).toContainEqual(
      expect.objectContaining({ venueName: "The Rooftop at Pier 17", placeId: PIER_16 }),
    );
    for (const e of PLACE_ID_EXCLUSIONS) expect(e.audited.length).toBeGreaterThan(40);
    expect(isExcludedPlaceId("The Rooftop at Pier 17", PIER_16)).toBe(true);
    // The name matches ignoring case and punctuation; another venue may still have the id.
    expect(isExcludedPlaceId("the rooftop at pier-17", PIER_16)).toBe(true);
    expect(isExcludedPlaceId("Pier 16", PIER_16)).toBe(false);
    expect(isExcludedPlaceId("The Rooftop at Pier 17", "ChIJsomewhereElse00")).toBe(false);
    expect(isExcludedPlaceId("The Rooftop at Pier 17", PIER_16, [])).toBe(false);
  });

  it("never searches a placeholder address (D-071)", () => {
    const at = { lat: 40.824, lng: -73.808 };
    expect(
      JSON.parse(
        placeSearchBody({
          name: "Tango Arts",
          address: { formatted: "123 Main St, New York, NY" },
          location: at,
        }),
      ).textQuery,
    ).toBe("Tango Arts");
  });

  it("stays inside the quota ACCOUNTS 3h sets: 120 a minute, 300 a day", () => {
    expect(60_000 / PLACE_ID_INTERVAL_MS).toBeLessThanOrEqual(120);
    // Two runs on one day fit.
    expect(PLACE_ID_REQUESTS_PER_RUN * 2).toBeLessThanOrEqual(300);
  });

  it("reads the first place's id, and nothing from an empty or odd answer", () => {
    expect(
      placeIdFrom({ places: [{ id: "ChIJaXQRs6lZwokRY6EFpJnhNNE" }, { id: "ChIJother00" }] }),
    ).toBe("ChIJaXQRs6lZwokRY6EFpJnhNNE");
    expect(placeIdFrom({})).toBeNull();
    expect(placeIdFrom({ places: [] })).toBeNull();
    expect(placeIdFrom({ places: [{ id: "has spaces and <b>" }] })).toBeNull();
    expect(placeIdFrom({ places: [{ id: 42 }] })).toBeNull();
    // Google sets no maximum length: a place with a unit number carries its address in the id.
    const long = `Ep${"A".repeat(677)}`;
    expect(placeIdFrom({ places: [{ id: long }] })).toBe(long);
    expect(placeIdFrom(null)).toBeNull();
  });
});

let db: Db;
let metro: Metro;

type VenueName = "studio" | "ballroom" | "twin" | "busy" | "later" | "recent" | "stale";

describeDb("looking up place IDs, against Postgres", () => {
  const ids = {} as Record<VenueName, string>;

  beforeAll(async () => {
    db = await testDb("place_ids");
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
    const names: VenueName[] = ["studio", "ballroom", "twin", "busy", "later", "recent", "stale"];
    const rows = await db
      .insert(venues)
      .values(
        names.map((name, i) => ({
          name,
          nameNormalized: name,
          location: { lat: 40.72 + i / 1000, lng: -73.99 },
          address: { formatted: `${i + 1} Test St` },
          tz: NY,
          metroId: metro.id,
          googlePlaceCheckedAt:
            name === "recent"
              ? new Date("2026-09-20T00:00:00Z")
              : name === "stale"
                ? new Date("2026-08-01T00:00:00Z")
                : null,
        })),
      )
      .returning({ id: venues.id, name: venues.name });
    for (const r of rows) ids[r.name as VenueName] = r.id;

    const listing = (slug: string, venue: VenueName, nightDate = TONIGHT) => ({
      slug,
      title: slug,
      titleNormalized: slug,
      listingType: "social" as const,
      styles: ["salsa"],
      nightDate,
      tz: NY,
      confirmation: "recurring_unconfirmed" as const,
      venueId: ids[venue],
      metroId: metro.id,
    });
    await db.insert(events).values([
      listing("a", "studio"),
      listing("b", "ballroom"),
      listing("c", "twin"),
      listing("d1", "busy"),
      listing("d2", "busy", "2026-09-29"),
      listing("d3", "busy", "2026-09-30"),
      // Outside the window: not asked.
      listing("e", "later", "2026-11-01"),
      listing("f", "recent"),
      listing("g", "stale"),
    ]);
  });

  /**
   * A transport that answers Places by the whole query or by the venue's name, and records every
   * request.
   */
  function google(answers: Record<string, { status: number; body: unknown }>) {
    const seen: TransportRequest[] = [];
    const http = createPoliteHttp({
      userAgent: "test",
      now: () => NOW.getTime(),
      sleep: async () => {},
      transport: async (req) => {
        seen.push(req);
        // The whole query first ("studio, 1 Test St"), then the venue's name alone.
        const query = String(JSON.parse(req.body ?? "{}").textQuery);
        const answer = answers[query] ?? answers[query.split(",")[0]!] ?? { status: 200, body: {} };
        return {
          url: req.url,
          status: answer.status,
          headers: {},
          body: JSON.stringify(answer.body),
        };
      },
    });
    return { http, seen };
  }

  const nights = ["2026-09-28", "2026-09-29", "2026-09-30"];
  const stored = async () =>
    Object.fromEntries(
      (await db.select().from(venues)).map((v) => [
        v.name,
        { id: v.googlePlaceId, at: v.googlePlaceCheckedAt },
      ]),
    );

  it("stores what Google finds, most-listed venue first, and remembers what it does not", async () => {
    const { http, seen } = google({
      studio: { status: 200, body: { places: [{ id: "ChIJstudio000000" }] } },
      busy: { status: 200, body: { places: [{ id: "ChIJbusy00000000" }] } },
      // The same place as the studio: most likely the studio twice in the venue table.
      twin: { status: 200, body: { places: [{ id: "ChIJstudio000000" }] } },
      stale: { status: 200, body: { places: [{ id: "ChIJstale0000000" }] } },
    });
    const report = await resolvePlaceIds(db, {
      http,
      apiKey: "test-key",
      metro,
      nights,
      now: () => NOW,
    });
    expect(report).toEqual({
      due: 5,
      asked: 5,
      failed: 0,
      found: 3,
      notFound: 1,
      taken: 1,
      disagreed: 0,
      excluded: 0,
      toRecheck: 0,
      rechecked: 0,
      cleared: 0,
      // Two questions for each venue Google finds (name and address in the box, then the name
      // alone nearby).
      requests: 9,
      stopped: null,
      notes: ["twin: Google gives the same place as studio"],
    });

    // Every request: a POST to Text Search with the key and the id-only mask in headers.
    expect(seen).toHaveLength(9);
    for (const req of seen) {
      expect(req.method).toBe("POST");
      expect(req.url).toBe(PLACES_TEXT_SEARCH);
      expect(req.headers["x-goog-fieldmask"]).toBe("places.id");
      expect(req.headers["x-goog-api-key"]).toBe("test-key");
      expect(req.url).not.toContain("test-key");
    }
    // The venue on three nights first, by name and address and then by name alone; then by name
    // among venues on one.
    expect(seen.slice(0, 2).map((r) => JSON.parse(r.body!).textQuery)).toEqual([
      "busy, 4 Test St",
      "busy",
    ]);

    const after = await stored();
    expect(after.studio).toEqual({ id: "ChIJstudio000000", at: NOW });
    expect(after.busy).toEqual({ id: "ChIJbusy00000000", at: NOW });
    expect(after.stale).toEqual({ id: "ChIJstale0000000", at: NOW });
    expect(after.twin).toEqual({ id: null, at: NOW });
    expect(after.ballroom).toEqual({ id: null, at: NOW });
    // Not in the window, or asked eight days ago: left alone.
    expect(after.later).toEqual({ id: null, at: null });
    expect(after.recent?.at).toEqual(new Date("2026-09-20T00:00:00Z"));

    // The next run asks nobody: every due venue was answered.
    const again = google({});
    const next = await resolvePlaceIds(db, {
      http: again.http,
      apiKey: "test-key",
      metro,
      nights,
      now: () => new Date(NOW.getTime() + 86_400_000),
    });
    expect(next).toMatchObject({ due: 0, asked: 0 });
    expect(again.seen).toHaveLength(0);
  });

  it("asks at most the run's limit, and the rest wait for the next run", async () => {
    const { http, seen } = google({});
    const report = await resolvePlaceIds(db, {
      http,
      apiKey: "test-key",
      metro,
      nights,
      now: () => NOW,
      limit: 2,
    });
    expect(report).toMatchObject({ due: 5, asked: 2, notFound: 2 });
    expect(seen).toHaveLength(2);
  });

  it("stops at a refused key and leaves the venues it did not ask for the next run", async () => {
    const KEY = "AIzaTESTKEY0123456789";
    const { http, seen } = google({
      busy: {
        status: 403,
        body: {
          error: {
            status: "PERMISSION_DENIED",
            message: `Requests to this API are blocked for key ${KEY}.`,
            details: [{ reason: "API_KEY_SERVICE_BLOCKED" }],
          },
        },
      },
    });
    const report = await resolvePlaceIds(db, { http, apiKey: KEY, metro, nights, now: () => NOW });
    expect(report).toMatchObject({ due: 5, asked: 1, found: 0 });
    // The report says which setting refused it, and never repeats the key.
    expect(report.stopped).toContain("the site answered 403");
    expect(report.stopped).toContain("API_KEY_SERVICE_BLOCKED");
    expect(report.stopped).not.toContain(KEY);
    expect(seen).toHaveLength(1);
    const after = await stored();
    for (const name of ["busy", "studio", "ballroom", "twin"])
      expect(after[name]?.at, name).toBeNull();
    // All five wait for the next run, the refused one included.
    expect(formatPlaceIds(report)).toContain(
      "5 venues due, 1 asked, 0 found, 0 not found. 5 wait for the next run. 1 request. Stopped: the site answered 403: ",
    );
  });

  it("stops at a request Google rejects, and after three failures in a row", async () => {
    const rejected = google({
      busy: {
        status: 400,
        body: { error: { status: "INVALID_ARGUMENT", message: "API key not valid." } },
      },
    });
    expect(
      await resolvePlaceIds(db, {
        http: rejected.http,
        apiKey: "k",
        metro,
        nights,
        now: () => NOW,
      }),
    ).toMatchObject({ asked: 1, stopped: expect.stringContaining("API key not valid") });
    expect(rejected.seen).toHaveLength(1);

    const down = google({
      busy: { status: 500, body: {} },
      ballroom: { status: 502, body: {} },
      stale: { status: 500, body: {} },
    });
    const report = await resolvePlaceIds(db, {
      http: down.http,
      apiKey: "k",
      metro,
      nights,
      now: () => NOW,
    });
    expect(report).toMatchObject({
      asked: 3,
      failed: 3,
      stopped: expect.stringContaining("3 lookups in a row failed"),
    });
    expect(down.seen).toHaveLength(3);
    expect(formatPlaceIds(report)).toContain("5 wait for the next run.");
  });

  it("asks only about venues on this metro's listed nights that are not blocklisted", async () => {
    const [other] = await db
      .insert(metros)
      .values({
        slug: "lon",
        name: "London",
        countryCode: "GB",
        center: { lat: 51.5, lng: -0.12 },
        radiusKm: 50,
        tz: "Europe/London",
        languages: ["en"],
      })
      .returning({ id: metros.id });
    const extra = await db
      .insert(venues)
      .values(
        (["banned", "merged-only", "elsewhere"] as const).map((name, i) => ({
          name,
          nameNormalized: name,
          location: { lat: 40.73 + i / 1000, lng: -73.98 },
          tz: NY,
          metroId: metro.id,
          blocklisted: name === "banned",
        })),
      )
      .returning({ id: venues.id, name: venues.name });
    const byName = Object.fromEntries(extra.map((v) => [v.name, v.id]));
    const listing = (
      slug: string,
      venueId: string,
      fields: Partial<typeof events.$inferInsert> = {},
    ) => ({
      slug,
      title: slug,
      titleNormalized: slug,
      listingType: "social" as const,
      styles: ["salsa"],
      nightDate: TONIGHT,
      tz: NY,
      confirmation: "recurring_unconfirmed" as const,
      venueId,
      metroId: metro.id,
      ...fields,
    });
    await db
      .insert(events)
      .values([
        listing("x1", byName.banned!),
        listing("x2", byName["merged-only"]!, { status: "merged" }),
        listing("x3", byName.elsewhere!, { metroId: other!.id }),
      ]);
    const { http, seen } = google({});
    const report = await resolvePlaceIds(db, { http, apiKey: "k", metro, nights, now: () => NOW });
    expect(report.due).toBe(5);
    const asked = seen.map((r) => String(JSON.parse(r.body!).textQuery).split(",")[0]);
    expect(asked.sort()).toEqual(["ballroom", "busy", "stale", "studio", "twin"]);
  });

  it("stops at an exhausted quota too, but skips one venue on a passing server fault", async () => {
    const quota = google({
      busy: { status: 429, body: { error: { status: "RESOURCE_EXHAUSTED" } } },
    });
    expect(
      await resolvePlaceIds(db, { http: quota.http, apiKey: "k", metro, nights, now: () => NOW }),
    ).toMatchObject({ asked: 1, stopped: expect.stringContaining("429") });

    const fault = google({
      busy: { status: 500, body: {} },
      studio: { status: 200, body: { places: [{ id: "ChIJstudio000000" }] } },
    });
    const report = await resolvePlaceIds(db, {
      http: fault.http,
      apiKey: "k",
      metro,
      nights,
      now: () => NOW,
    });
    expect(report).toMatchObject({
      due: 5,
      asked: 5,
      failed: 1,
      found: 1,
      notFound: 3,
      stopped: null,
    });
    const [busy] = await db.select().from(venues).where(eq(venues.id, ids.busy));
    expect(busy?.googlePlaceCheckedAt).toBeNull();
  });

  const place = (id: string) => ({ status: 200, body: { places: [{ id }] } });

  it("stores an id only when the venue's name alone gives the same place (D-071)", async () => {
    const { http, seen } = google({
      // Run 26: the address outweighed the name. "The Factory, 144 Allen St" gave a candy shop.
      "studio, 1 Test St": place("ChIJcandyshop0000"),
      studio: place("ChIJstudio000000"),
      // The name and address gave one place; the name alone, searched nearby, gave none.
      "ballroom, 2 Test St": place("ChIJpier16000000"),
      busy: place("ChIJbusy00000000"),
    });
    const report = await resolvePlaceIds(db, {
      http,
      apiKey: "test-key",
      metro,
      nights,
      now: () => NOW,
    });
    expect(report).toMatchObject({
      due: 5,
      asked: 5,
      found: 1,
      notFound: 2,
      disagreed: 2,
      taken: 0,
      requests: 8,
    });
    expect(report.notes).toEqual([
      "ballroom: no place ID stored; the name alone, searched nearby, gives no place",
      "studio: no place ID stored; the name alone, searched nearby, gives another place",
    ]);
    const after = await stored();
    expect(after.busy).toEqual({ id: "ChIJbusy00000000", at: NOW });
    // Asked, answered, and left without an id until the retry: never the candy shop.
    expect(after.studio).toEqual({ id: null, at: NOW });
    expect(after.ballroom).toEqual({ id: null, at: NOW });
    const [busy] = await db.select().from(venues).where(eq(venues.id, ids.busy));
    expect(busy?.googlePlaceNameCheckedAt).toEqual(NOW);
    // Nothing found by name and address: no second question.
    expect(seen.map((r) => JSON.parse(r.body!).textQuery)).not.toContain("twin");
    expect(formatPlaceIds(report)).toContain(
      "5 venues due, 5 asked, 1 found, 2 not found, 2 not stored (the name alone, searched nearby, gives another place). 8 requests.",
    );
  });

  it("asks twice when a venue has no address: its name in the box, then its name nearby (D-077)", async () => {
    await db.update(venues).set({ address: null }).where(eq(venues.id, ids.busy));
    const { http, seen } = google({ busy: place("ChIJbusy00000000") });
    const report = await resolvePlaceIds(db, { http, apiKey: "k", metro, nights, now: () => NOW });
    // busy two, the four others Google does not find one each.
    expect(report).toMatchObject({ found: 1, disagreed: 0, requests: 6 });
    const asked = seen.map((r) => JSON.parse(r.body!)).filter((b) => b.textQuery === "busy");
    expect(asked.map((b) => Object.keys(b).at(-1))).toEqual([
      "locationRestriction",
      "locationBias",
    ]);
    expect((await stored()).busy?.id).toBe("ChIJbusy00000000");
  });

  it("stores nothing when the name alone nearby names another place, even with no address", async () => {
    await db.update(venues).set({ address: null }).where(eq(venues.id, ids.busy));
    const byBody = createPoliteHttp({
      userAgent: "test",
      now: () => NOW.getTime(),
      sleep: async () => {},
      transport: async (req) => {
        const body = JSON.parse(req.body ?? "{}");
        const id =
          body.textQuery !== "busy"
            ? null
            : body.locationBias
              ? "ChIJbusyNearby000"
              : "ChIJbusy00000000";
        return {
          url: req.url,
          status: 200,
          headers: {},
          body: JSON.stringify(id ? { places: [{ id }] } : {}),
        };
      },
    });
    const report = await resolvePlaceIds(db, {
      http: byBody,
      apiKey: "k",
      metro,
      nights,
      now: () => NOW,
    });
    expect(report).toMatchObject({ found: 0, disagreed: 1, requests: 6 });
    expect((await stored()).busy?.id).toBeNull();
  });

  it("re-checks each id not yet checked by name once, and clears one the name alone does not give (D-071, D-077)", async () => {
    const earlier = new Date("2026-09-28T01:00:00Z");
    // Stored by run 26, before the check: studio's id is the candy shop next door.
    await db
      .update(venues)
      .set({ googlePlaceId: "ChIJcandyshop0000", googlePlaceCheckedAt: earlier })
      .where(eq(venues.id, ids.studio));
    await db
      .update(venues)
      .set({ googlePlaceId: "ChIJbusy00000000", googlePlaceCheckedAt: earlier })
      .where(eq(venues.id, ids.busy));
    // Outside the window, but stored before the check all the same.
    await db
      .update(venues)
      .set({ googlePlaceId: "ChIJlater0000000", googlePlaceCheckedAt: earlier })
      .where(eq(venues.id, ids.later));
    const { http, seen } = google({
      studio: place("ChIJstudio000000"),
      busy: place("ChIJbusy00000000"),
      later: place("ChIJlater0000000"),
    });
    const report = await resolvePlaceIds(db, { http, apiKey: "k", metro, nights, now: () => NOW });
    expect(report).toMatchObject({ toRecheck: 3, rechecked: 3, cleared: 1 });
    // The re-checks ask the check question, the name alone searched nearby, before any new
    // lookup.
    expect(seen.slice(0, 3).map((r) => JSON.parse(r.body!).textQuery)).toEqual([
      "busy",
      "later",
      "studio",
    ]);
    for (const r of seen.slice(0, 3)) {
      expect(JSON.parse(r.body!).locationBias).toBeDefined();
      expect(JSON.parse(r.body!).locationRestriction).toBeUndefined();
    }
    expect(report.notes).toContain(
      "studio: stored place ID cleared; the name alone, searched nearby, gives another place",
    );
    const rows = Object.fromEntries(
      (await db.select().from(venues)).map((v) => [
        v.name,
        [v.googlePlaceId, v.googlePlaceCheckedAt, v.googlePlaceNameCheckedAt],
      ]),
    );
    expect(rows.busy).toEqual(["ChIJbusy00000000", earlier, NOW]);
    expect(rows.later).toEqual(["ChIJlater0000000", earlier, NOW]);
    // Cleared, and asked again after the retry period like any venue Google did not find.
    expect(rows.studio).toEqual([null, NOW, null]);
    expect(formatPlaceIds(report)).toContain(
      "Re-checked by name: 3, 3 re-checked, 2 kept, 1 cleared.",
    );

    // Once each: the next run re-checks nothing.
    const again = google({});
    const next = await resolvePlaceIds(db, {
      http: again.http,
      apiKey: "k",
      metro,
      nights,
      now: () => new Date(NOW.getTime() + 86_400_000),
    });
    expect(next).toMatchObject({ toRecheck: 0, rechecked: 0 });
    expect(again.seen.map((r) => JSON.parse(r.body!).textQuery)).not.toContain("busy");
  });

  it("keeps within the run's request budget; the rest wait for the next run", async () => {
    const { http, seen } = google({ busy: place("ChIJbusy00000000") });
    const report = await resolvePlaceIds(db, {
      http,
      apiKey: "k",
      metro,
      nights,
      now: () => NOW,
      maxRequests: 3,
    });
    // busy took two; the next venue could need two more, so it waits.
    expect(report).toMatchObject({ due: 5, asked: 1, found: 1, requests: 2 });
    expect(seen).toHaveLength(2);
    expect(formatPlaceIds(report)).toContain("4 wait for the next run.");
  });

  // The Rooftop at Pier 17 (D-077). Run 26 stored Pier 16's id; run 27's name check asked in the
  // same small box around Ticketmaster's point, which holds Pier 16 and not Pier 17, and kept it.
  const FIXTURES = path.resolve(__dirname, "fixtures/places/pier17");
  const fixture = (hash: string): Fixture =>
    JSON.parse(
      readFileSync(
        path.join(FIXTURES, `places-googleapis-com-v1-places-searchText-${hash}.json`),
        "utf8",
      ),
    ) as Fixture;
  /** Run 26: the name and address in the box gave Pier 16. Recorded 2026-09-28. */
  const RUN_26_FIRST = fixture("d9895f827c");
  /** Run 27: the name alone in the same box gave Pier 16 again. Recorded 2026-09-29. */
  const RUN_27_SAME_BOX = fixture("d4a0acb56f");
  /** The check question, biased: built by hand, since Google's answer is not recorded. */
  const BIASED_BY_HAND = fixture("6b22b395c3");
  const answeringNothing = (f: Fixture): Fixture => ({
    ...f,
    response: { ...f.response, body: "{}" },
  });

  /** Only the Rooftop, at the point and address run 26 stored, with one listing tonight. */
  async function onlyTheRooftop(fields: Partial<typeof venues.$inferInsert> = {}) {
    await db.delete(events);
    await db.delete(venues);
    const [row] = await db
      .insert(venues)
      .values({
        name: ROOFTOP.name,
        nameNormalized: "the rooftop at pier 17",
        location: ROOFTOP.location,
        address: ROOFTOP.address,
        tz: NY,
        metroId: metro.id,
        ...fields,
      })
      .returning({ id: venues.id });
    await db.insert(events).values({
      slug: "rooftop",
      title: "Rooftop night",
      titleNormalized: "rooftop night",
      listingType: "social" as const,
      styles: ["salsa"],
      nightDate: TONIGHT,
      tz: NY,
      confirmation: "recurring_unconfirmed" as const,
      venueId: row!.id,
      metroId: metro.id,
    });
    return row!.id;
  }
  const replay = (fixtures: readonly Fixture[]) => {
    const transport = fixtureTransport(fixtures);
    const http = createPoliteHttp({
      userAgent: "test",
      now: () => NOW.getTime(),
      sleep: async () => {},
      transport,
    });
    return { http, transport };
  };
  const rooftopRow = async (id: string) =>
    (await db.select().from(venues).where(eq(venues.id, id)))[0]!;

  for (const [answer, check] of [
    ["another place", BIASED_BY_HAND],
    ["no place", answeringNothing(BIASED_BY_HAND)],
  ] as const) {
    it(`stores nothing for the Rooftop when the name alone nearby gives ${answer} (recorded run 26, D-077)`, async () => {
      const venueId = await onlyTheRooftop();
      // Run 27's same-box answer is in the set too: a check sent in the small box replays it
      // and stores Pier 16, which is what claude/event-links did.
      const { http, transport } = replay([RUN_26_FIRST, RUN_27_SAME_BOX, check]);
      const report = await resolvePlaceIds(db, {
        http,
        apiKey: "k",
        metro,
        nights,
        now: () => NOW,
        // The check alone must catch it, without the hand-kept list.
        exclusions: [],
      });
      expect(report).toMatchObject({
        due: 1,
        asked: 1,
        found: 0,
        disagreed: 1,
        excluded: 0,
        requests: 2,
      });
      expect(report.notes).toEqual([
        `The Rooftop at Pier 17: no place ID stored; the name alone, searched nearby, gives ${answer}`,
      ]);
      // The first question is run 26's, byte for byte; the second is the biased one.
      expect(transport.requests).toEqual(
        [RUN_26_FIRST, check].map((f) => fixtureKey("POST", PLACES_TEXT_SEARCH, f.request.body)),
      );
      const row = await rooftopRow(venueId);
      expect(row.googlePlaceId).toBeNull();
      expect(row.googlePlaceCheckedAt).toEqual(NOW);
      expect(formatPlaceIds(report)).toContain(
        "1 venues due, 1 asked, 0 found, 0 not found, 1 not stored (the name alone, searched nearby, gives another place). 2 requests.\n  - The Rooftop at Pier 17: no place ID stored; the name alone, searched nearby, gives",
      );
    });
  }

  it("never stores an id the hand-kept list rules out for that venue, even when both answers agree", async () => {
    const venueId = await onlyTheRooftop();
    // Say Google, asked nearby, still names Pier 16 first: the risk D-077 leaves open.
    const { http } = replay([RUN_26_FIRST, { ...BIASED_BY_HAND, response: RUN_26_FIRST.response }]);
    const report = await resolvePlaceIds(db, { http, apiKey: "k", metro, nights, now: () => NOW });
    expect(report).toMatchObject({ found: 0, disagreed: 0, excluded: 1, requests: 2 });
    expect(report.notes).toEqual([
      "The Rooftop at Pier 17: no place ID stored; it is on the hand-kept list of wrong places (config/place-id-exclusions.ts)",
    ]);
    expect((await rooftopRow(venueId)).googlePlaceId).toBeNull();
    expect(formatPlaceIds(report)).toContain(
      "1 not stored (on the hand-kept list of wrong places). 2 requests.",
    );
  });

  for (const [heard, check] of [
    ["gives another place too", BIASED_BY_HAND],
    ["still gives it", { ...BIASED_BY_HAND, response: RUN_26_FIRST.response }],
  ] as const) {
    it(`clears a stored id on the hand-kept list however it was checked, when the check ${heard}`, async () => {
      const run27 = new Date("2026-09-29T00:45:16Z");
      // Checked by name already (run 27's same-box check): only the list reaches it.
      const venueId = await onlyTheRooftop({
        googlePlaceId: PIER_16,
        googlePlaceCheckedAt: run27,
        googlePlaceNameCheckedAt: run27,
      });
      const { http, transport } = replay([check]);
      const report = await resolvePlaceIds(db, {
        http,
        apiKey: "k",
        metro,
        nights,
        now: () => NOW,
      });
      expect(report).toMatchObject({ toRecheck: 1, rechecked: 1, cleared: 1, requests: 1 });
      // One question, the biased one, and the report says what it heard.
      expect(transport.requests).toEqual([
        fixtureKey("POST", PLACES_TEXT_SEARCH, BIASED_BY_HAND.request.body),
      ]);
      expect(report.notes).toEqual([
        `The Rooftop at Pier 17: stored place ID cleared; it is on the hand-kept list of wrong places (config/place-id-exclusions.ts); the name alone, searched nearby, ${heard}`,
      ]);
      const row = await rooftopRow(venueId);
      expect([row.googlePlaceId, row.googlePlaceCheckedAt, row.googlePlaceNameCheckedAt]).toEqual([
        null,
        NOW,
        null,
      ]);
      expect(formatPlaceIds(report)).toContain(
        "Re-checked by name: 1, 1 re-checked, 0 kept, 1 cleared. 1 request.",
      );
    });
  }

  it("clears a listed id even when Google cannot be asked", async () => {
    const venueId = await onlyTheRooftop({ googlePlaceId: PIER_16 });
    const { http, transport } = replay([]);
    const report = await resolvePlaceIds(db, {
      http,
      apiKey: "k",
      metro,
      nights,
      now: () => NOW,
      maxRequests: 0,
    });
    expect(report).toMatchObject({ rechecked: 1, cleared: 1, requests: 0 });
    expect(transport.requests).toHaveLength(0);
    expect((await rooftopRow(venueId)).googlePlaceId).toBeNull();
  });

  it("re-checks every stored id once after migration 0006, and clears Pier 16 for the Rooftop (D-077)", async () => {
    const run27 = new Date("2026-09-29T00:45:16Z");
    // As production holds it after run 27: Pier 16's id, passed by D-071's same-box check.
    const venueId = await onlyTheRooftop({
      googlePlaceId: PIER_16,
      googlePlaceCheckedAt: new Date("2026-09-28T21:22:57Z"),
      googlePlaceNameCheckedAt: run27,
    });
    // A venue without an id keeps its null, and one checked by name keeps nothing it should not.
    await db.insert(venues).values({
      name: "No id",
      nameNormalized: "no id",
      location: { lat: 40.73, lng: -73.99 },
      tz: NY,
      metroId: metro.id,
      googlePlaceCheckedAt: run27,
    });
    // The harness migrates an empty database, so the data migration is run here, after seeding,
    // exactly as the migrator runs it against production.
    await db.execute(
      sql.raw(
        readFileSync(
          path.resolve(__dirname, "../../src/db/migrations/0006_recheck_place_ids.sql"),
          "utf8",
        ),
      ),
    );
    expect((await rooftopRow(venueId)).googlePlaceNameCheckedAt).toBeNull();

    const { http } = replay([RUN_27_SAME_BOX, BIASED_BY_HAND]);
    const report = await resolvePlaceIds(db, {
      http,
      apiKey: "k",
      metro,
      nights,
      now: () => NOW,
      exclusions: [],
    });
    expect(report).toMatchObject({ toRecheck: 1, rechecked: 1, cleared: 1, requests: 1 });
    expect(report.notes).toEqual([
      "The Rooftop at Pier 17: stored place ID cleared; the name alone, searched nearby, gives another place",
    ]);
    const row = await rooftopRow(venueId);
    expect([row.googlePlaceId, row.googlePlaceCheckedAt]).toEqual([null, NOW]);
    expect(formatPlaceIds(report)).toContain(
      "Re-checked by name: 1, 1 re-checked, 0 kept, 1 cleared. 1 request.",
    );
    const [other] = await db.select().from(venues).where(eq(venues.name, "No id"));
    expect([other?.googlePlaceId, other?.googlePlaceCheckedAt]).toEqual([null, run27]);
  });

  it("runs migration 0006 after 0005, and the migrator has applied both", async () => {
    const journal = JSON.parse(
      readFileSync(path.resolve(__dirname, "../../src/db/migrations/meta/_journal.json"), "utf8"),
    ) as { entries: { idx: number; tag: string; when: number }[] };
    const at = (tag: string) => journal.entries.findIndex((e) => e.tag === tag);
    expect(at("0005_event_page_per_source")).toBeGreaterThanOrEqual(0);
    expect(at("0006_recheck_place_ids")).toBe(at("0005_event_page_per_source") + 1);
    const [e5, e6] = [
      journal.entries[at("0005_event_page_per_source")]!,
      journal.entries[at("0006_recheck_place_ids")]!,
    ];
    expect(e6.idx).toBe(e5.idx + 1);
    expect(e6.when).toBeGreaterThan(e5.when);
    const applied = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from drizzle.__drizzle_migrations`,
    );
    expect(Number([...applied][0]!.n)).toBe(journal.entries.length);
  });
});
