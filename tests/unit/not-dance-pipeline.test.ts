// PR 2, wrong listings on the site: a venue calendar's concerts, a price line, and a listing whose
// own address is outside the metro. The screens at write time, and the stored rows they now leave
// out.
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { METRO_REGIONS } from "@/config/metro-regions";
import { NYC_SOURCES } from "@/config/sources/nyc";
import { normalizeForMatch } from "@/config/styles";

import type { HarvestedListing, Metro, Source } from "@/src/adapters/types";
import type { Db } from "@/src/db/client";
import { events, metros } from "@/src/db/schema";
import { rawListingSchema } from "@/src/domain/listing";
import { screenNoDance, screenTitle, screenUnlistedUntimed } from "@/src/domain/listing-screen";
import { EMPTY_BLOCKLIST } from "@/src/pipeline/blocklist";
import { geoapifyElsewhere } from "@/src/pipeline/geocode";
import { normalizeListing, untimedKey, type NormalizedEvent } from "@/src/pipeline/normalize";
import * as store from "@/src/pipeline/store";
import { loadMetro, placeUnplaced, upsertSource, writeEvents } from "@/src/pipeline/store";
import { closeTestDb, describeDb, resetDb, testDb } from "@/tests/unit/db-harness";

const NOW = new Date("2026-09-29T16:00:00Z");
const NYC_METRO = {
  id: "m",
  slug: "nyc",
  name: "New York",
  countryCode: "US",
  center: { lat: 40.7128, lng: -74.006 },
  radiusKm: 40,
  tz: "America/New_York",
  languages: ["en"],
} satisfies Metro;
const SOBS = { styles: [], url: "https://sobs.com/calendar", mixedCalendar: true };
const STUDIO = { styles: [], url: "https://steppingoutstudios.com/social-events1" };

function harvested(fields: Record<string, unknown>, extra: Partial<HarvestedListing> = {}) {
  return {
    listing: rawListingSchema.parse({
      listing_type: "other",
      styles: [],
      venue: {},
      organizer: {},
      ...fields,
    }),
    externalId: null,
    tz: null,
    venueLocation: null,
    recurrence: null,
    provenance: { sourceUrl: "https://sobs.com/calendar", fetchedAt: NOW, method: "llm" },
    ...extra,
  } satisfies HarvestedListing;
}

describe("a venue's calendar: a listing that names no dance is a show", () => {
  it("is set on SOB's, and on no dance organiser's page", () => {
    const mixed = NYC_SOURCES.filter((seed) => seed.mixedCalendar).map((seed) => seed.url);
    expect(mixed).toEqual([
      "https://sobs.com/calendar",
      // Lane 5 (D-131): a club whose Eventbrite nights are half concerts.
      "https://www.elsewhere.club/events",
      // Lane 3 (D-115): clubs and a concert hall whose calendars carry shows and bar hours.
      "https://www.lebainnewyork.com/",
      "https://calendar.houseofyes.org/",
      "https://lpr.com/",
      // Venue calendars discovery found, seeded 2026-10-22.
      "https://www.momaps1.org/en/calendar",
      "https://roulette.org/calendar/",
      "https://www.hostoscenter.org/events",
      "https://www.index-space.org/programming",
      // Squarespace events lists of three Brooklyn venues (D-111, added 2026-10-11).
      "https://www.signalnyc.club/events",
      "https://www.starrbar.com/events",
      "https://www.deadletterno9.com/events",
      // Venue sites found by discovery whose listings named no place (2026-10-15).
      "https://club51nyc.com/events",
      "https://www.somewherenowherenyc.com/events",
      "https://www.3dollarbillbk.com/rsvp",
      // Session 2, 2026-10-11: clubs and seasonal outdoor series.
      "https://publicrecords.nyc/",
      "https://www.bohemianhall.com/events",
      "https://events.sulekha.com/new-york-metro-area",
      "https://www.tickeri.com/local/tristate",
      "https://www.viewcy.com/discover?q=dance",
      "https://cityparksfoundation.org/calendar/",
      // Coverage review of 2026-10-17: venue calendars that carry shows and bar nights too.
      "https://www.hartbarnyc.com/shows",
      "https://skinnydennisbrooklyn.com/calendar",
      "https://clubcummingnyc.com/",
      "https://www.cafeerzulie.com/events",
      "https://www.metropolitanbarny.com/events",
      "https://www.moodringnyc.club/events",
      "https://www.fnlbk.com/upcoming",
      "https://www.damballa.nyc/events-builder",
      "https://sunsetstoop.com/events",
      "https://www.eventbrite.com/o/11920997917",
      "https://thestonewallinnnyc.com/",
      "https://nublu.net/",
      // The Monster: piano bar sets and drag shows beside its DJ nights (D-589).
      "https://www.spunknyc.com/monster-reservations",
      "https://www.versnyc.com/events-vers-gay-bar-nyc",
      "https://bryantpark.org/calendar",
      "https://www.silobrooklyn.com/events",
      // Blocked-platform audit (D-758): Shrine's calendar, live bands and late DJ dance parties.
      "https://www.shrinenyc.com/calendar.php",
      // Discovered venues seeded 2026-11-12 to name their non-dance rows.
      "https://dromnyc.com/events/",
      "https://juliadeburgos.org/calendar",
    ]);
  });

  const read = (fields: Record<string, unknown>, source: object = SOBS) =>
    normalizeListing(harvested(fields), { metro: NYC_METRO, source: source as never, now: NOW });

  it("leaves out SOB's 7pm album release show, and keeps the dance nights beside it", () => {
    expect(
      read({
        title: "Chow Lee Album Release Show",
        local_date: "2026-09-29",
        dancing_time: "19:00",
      }),
    ).toMatchObject({ ok: false });
    expect(
      read({ title: "DAY26 & J. Howell", local_date: "2026-10-03", dancing_time: "18:00" }),
    ).toMatchObject({ ok: false });
    // Named dances and kinds stay, whatever the time.
    expect(
      read({
        title: "Salsa Groove: Dance Class & Happy Hour",
        local_date: "2026-10-02",
        lesson_time: "18:00",
        listing_type: "class",
        styles: ["salsa"],
      }),
    ).toMatchObject({ ok: true });
    expect(
      read({
        title: "A Tribute to Fania Salsa Legends",
        local_date: "2026-09-25",
        dancing_time: "18:00",
      }),
    ).toMatchObject({ ok: true });
    expect(
      read({
        title: "Roy Ayers Birthday Tribute: Live Band + DJ Experience",
        local_date: "2026-09-10",
        dancing_time: "19:00",
      }),
    ).toMatchObject({ ok: true });
  });

  it("leaves out a show the model typed as a social: the kind must be in the title", () => {
    const LPR = { styles: [], url: "https://lpr.com/", mixedCalendar: true };
    // Le Poisson Rouge, run of 2026-10-05: the model read a 6:30pm concert as a social.
    expect(
      read(
        {
          title: "Blake Allen’s The Ceiling",
          local_date: "2026-10-05",
          dancing_time: "18:30",
          listing_type: "social",
        },
        LPR,
      ),
    ).toMatchObject({ ok: false, kind: "not_an_event" });
    // A title that names the kind still stands.
    expect(
      read(
        {
          title: "Swing Dance Social",
          local_date: "2026-10-05",
          dancing_time: "19:00",
          listing_type: "social",
        },
        LPR,
      ),
    ).toMatchObject({ ok: true });
  });

  it("keeps a late night and an untimed one that name no dance: nobody said they are shows", () => {
    expect(
      read({ title: "POLENTA", local_date: "2026-10-02", dancing_time: "23:00" }),
    ).toMatchObject({ ok: true });
    expect(
      read({ title: "Sak Pasé: Haitian Fridays", local_date: "2026-10-02", doors_time: "23:00" }),
    ).toMatchObject({ ok: true });
    expect(read({ title: "POLENTA", local_date: "2026-10-02" })).toMatchObject({ ok: true });
  });

  it("keeps the same listing on a dance studio's page, where every night is a dance", () => {
    expect(
      read(
        { title: "Ballroom and Smooth Practice", local_date: "2026-09-29", dancing_time: "21:30" },
        STUDIO,
      ),
    ).toMatchObject({ ok: true });
  });
});

describe("an address that names a place outside the metro", () => {
  const ANSWERS = (
    JSON.parse(readFileSync(`${__dirname}/fixtures/geoapify/nyc-runs-21-34.json`, "utf8")) as {
      answers: Record<string, unknown>;
    }
  ).answers;
  const body = (text: string) => {
    if (!(text in ANSWERS)) throw new Error(text);
    return ANSWERS[text];
  };
  const REGIONS = METRO_REGIONS.nyc!;
  const parsed = (fields: Record<string, string>) => ({ query: { parsed: fields } });

  it("names Warsaw and Costa Mesa, from the geocoder's own reading of the address", () => {
    expect(geoapifyElsewhere(body("Warsaw, PL"), NYC_METRO, REGIONS)).toBe("warsaw, pl");
    expect(geoapifyElsewhere(body("3050 Bristol St, Costa Mesa, CA"), NYC_METRO, REGIONS)).toBe(
      "costa mesa, ca",
    );
  });

  it("never calls a New York address, or one that names no place, elsewhere", () => {
    for (const text of [
      "37 W 26th St, 2nd floor, NYC",
      "123 Jazz St, New York, NY",
      "385 9th Avenue, Midtown",
      "Back Room 102 Norfolk St",
      "The RSCDS New York",
      "https://cdny.org/",
    ]) {
      expect(geoapifyElsewhere(body(text), NYC_METRO, REGIONS)).toBeNull();
    }
  });

  it("recognises another state or country only for certain: an unknown spelling stays", () => {
    // New York and New Jersey however written, and the US in other languages.
    for (const fields of <Array<Record<string, string>>>[
      { city: "new york", state: "n.y." },
      { state: "new york state" },
      { country: "estados unidos" },
      { country: "ee. uu." },
      { country: "états-unis" },
      { country: "america" },
      { country: "united states of america" },
      { country: "usa" },
      { city: "denver" },
    ]) {
      expect(geoapifyElsewhere(parsed(fields), NYC_METRO, REGIONS)).toBeNull();
    }
    expect(geoapifyElsewhere(parsed({ state: "ct" }), NYC_METRO, REGIONS)).toBe("ct");
    // New York is the five boroughs (D-084): New Jersey is elsewhere, however written.
    expect(geoapifyElsewhere(parsed({ state: "n.j." }), NYC_METRO, REGIONS)).toBe("n.j.");
    expect(
      geoapifyElsewhere(body("15 Sylvan Street, Rutherford, NJ, 07070"), NYC_METRO, REGIONS),
    ).toBe("rutherford, nj");
    expect(geoapifyElsewhere(parsed({ state: "north carolina" }), NYC_METRO, REGIONS)).toBe(
      "north carolina",
    );
    expect(
      geoapifyElsewhere(parsed({ city: "atlanta", country: "georgia" }), NYC_METRO, REGIONS),
    ).toBe("atlanta, georgia");
    expect(geoapifyElsewhere(parsed({ country: "polen" }), NYC_METRO, REGIONS)).toBe("polen");
  });

  it("reads a metro's own country in its own language as home", () => {
    for (const [countryCode, country] of [
      ["ES", "españa"],
      ["DE", "deutschland"],
      ["MX", "méxico"],
      ["BR", "brasil"],
      ["IT", "italia"],
      ["NL", "nederland"],
      ["PL", "polska"],
      ["GB", "england"],
      ["GB", "uk"],
    ] as const) {
      expect(geoapifyElsewhere(parsed({ country }), { countryCode })).toBeNull();
    }
    expect(geoapifyElsewhere(parsed({ country: "france" }), { countryCode: "DE" })).toBe("france");
  });

  it("reads a country slot that names one of the home country's states as that state", () => {
    // Geoapify may put "Georgia" in the country slot; in Atlanta that is home, not Tbilisi.
    const atlanta = parsed({ city: "atlanta", country: "georgia" });
    expect(geoapifyElsewhere(atlanta, NYC_METRO, ["GA"])).toBeNull();
    expect(geoapifyElsewhere(parsed({ country: "españa" }), NYC_METRO, REGIONS)).toBe("españa");
    // Written without its accents, a name is still that country.
    expect(geoapifyElsewhere(parsed({ country: "espana" }), NYC_METRO, REGIONS)).toBe("espana");
  });

  it("checks the country only in a metro with no regions", () => {
    expect(geoapifyElsewhere(parsed({ state: "ca" }), NYC_METRO)).toBeNull();
    expect(geoapifyElsewhere(parsed({ country: "pl" }), NYC_METRO)).toBe("pl");
  });
});

let db: Db;
let metro: Metro;

describeDb("stored rows a screen now leaves out", () => {
  beforeAll(async () => {
    db = await testDb("not_dance_pipeline");
  });
  afterAll(closeTestDb);
  beforeEach(async () => {
    await resetDb();
    await db.insert(metros).values({
      slug: "nyc",
      name: "New York",
      countryCode: "US",
      center: { lat: 40.7128, lng: -74.006 },
      radiusKm: 40,
      tz: "America/New_York",
      languages: ["en"],
      status: "active",
    });
    metro = (await loadMetro(db, "nyc"))!;
  });

  const write = async (source: Source, list: NormalizedEvent[]) =>
    writeEvents(db, {
      metro,
      source,
      events: list,
      blocklist: EMPTY_BLOCKLIST,
      placeVenue: async () => null,
    });
  const event = (
    fields: Record<string, unknown>,
    extra: Partial<HarvestedListing> = {},
    src: object = { styles: [] },
  ) => {
    const o = normalizeListing(harvested(fields, extra), { metro, source: src as never, now: NOW });
    if (!o.ok) throw new Error(o.reason);
    return o.event;
  };

  it("retires Ticketmaster's stored concert when its search now leaves it out", async () => {
    const tm = await upsertSource(db, metro.id, {
      url: "https://www.ticketmaster.com/",
      kind: "ticketing_api",
      trustTier: "ticketing",
      discoveredBy: "ticketmaster",
    });
    await write(tm, [
      event(
        {
          title: 'Don Omar "The Last King World Tour"',
          local_date: "2026-10-10",
          doors_time: "20:00",
          styles: ["hip_hop", "hip_hop_club", "reggaeton"],
        },
        { externalId: "tm:17GZv0G61DlIaN2" },
      ),
      event(
        {
          title: "SUPERTALL",
          local_date: "2026-10-03",
          doors_time: "23:00",
          listing_type: "club_night",
        },
        { externalId: "tm:rZ7HnEZ1Af19j0" },
      ),
    ]);
    const out = await store.retireScreened(db, {
      source: tm,
      nights: ["2026-10-03", "2026-10-10"],
      keys: ["tm:17GZv0G61DlIaN2", "tm:Z7r9jZ1A7PU4M"],
    });
    expect(out.retired).toBe(1);
    expect(out.notes[0]).toContain('Don Omar "The Last King World Tour" on 2026-10-10');
    const rows = await db
      .select({ title: events.title, status: events.status })
      .from(events)
      .orderBy(events.title);
    expect(rows).toEqual([
      { title: 'Don Omar "The Last King World Tour"', status: "removed" },
      { title: "SUPERTALL", status: "active" },
    ]);
  });

  it("retires SOB's stored show and CDNY's stored price line, tonight included, and keeps the dance nights", async () => {
    const sobs = await upsertSource(db, metro.id, {
      url: SOBS.url,
      kind: "html",
      trustTier: "first_party",
      discoveredBy: "seed_list",
    });
    await write(sobs, [
      event({
        title: "Chow Lee Album Release Show",
        local_date: "2026-09-29",
        dancing_time: "19:00",
      }),
      event({ title: "POLENTA", local_date: "2026-10-02", dancing_time: "23:00" }),
      event({
        title: "Salsa Groove: Dance Class & Happy Hour",
        local_date: "2026-10-02",
        lesson_time: "18:00",
        listing_type: "class",
        styles: ["salsa"],
      }),
    ]);
    const cdny = await upsertSource(db, metro.id, {
      url: "https://cdny.org/",
      kind: "html",
      trustTier: "first_party",
      discoveredBy: "seed_list",
    });
    // Written before the price-line screen: the row as run 33 stored it.
    const line = "Students & Young Adults 16–18 ( Must Show ID) – $10";
    const before = event({
      title: "Students placeholder",
      local_date: "2026-09-29",
      listing_type: "class",
      styles: ["contra"],
    });
    await write(cdny, [
      {
        ...before,
        title: line,
        titleNormalized: normalizeForMatch(line),
        key: untimedKey("2026-09-29", normalizeForMatch(line)),
      },
      event({
        title: "English - Tuesdays",
        local_date: "2026-09-29",
        listing_type: "class",
        styles: ["contra"],
      }),
    ]);
    const nights = ["2026-09-29", "2026-10-02"];
    const reject =
      (mixedCalendar: boolean) => (row: Parameters<typeof screenNoDance>[0] & { title: string }) =>
        screenTitle(row.title)?.reason ?? screenNoDance(row, { mixedCalendar })?.reason ?? null;
    expect(
      (await store.retireScreened(db, { source: sobs, nights, reject: reject(true) })).retired,
    ).toBe(1);
    expect(
      (await store.retireScreened(db, { source: cdny, nights, reject: reject(false) })).retired,
    ).toBe(1);
    const rows = await db
      .select({ title: events.title, status: events.status })
      .from(events)
      .orderBy(events.title);
    expect(
      rows
        .filter((r) => r.status === "removed")
        .map((r) => r.title)
        .sort(),
    ).toEqual([
      "Chow Lee Album Release Show",
      "Students & Young Adults 16–18 ( Must Show ID) – $10",
    ]);
  });

  describe("an untimed row a venue's calendar no longer lists", () => {
    it("screens untimed no-dance row on mixed calendar", () => {
      const listing = {
        title: "Violines Para Ochún",
        styles: [],
        startsAt: null,
        nightDate: "2026-10-25",
        tz: "America/New_York",
      };
      const source = { mixedCalendar: true };
      const result = screenUnlistedUntimed(listing, source);
      expect(result).toEqual({
        kind: "not_a_dance",
        reason:
          "names no dance and no time, and this read of the venue's calendar no longer lists it",
      });
    });

    it("returns null for non-mixed calendar", () => {
      const listing = {
        title: "Violines Para Ochún",
        styles: [],
        startsAt: null,
        nightDate: "2026-10-25",
        tz: "America/New_York",
      };
      const source = { mixedCalendar: false };
      expect(screenUnlistedUntimed(listing, source)).toBeNull();
    });

    it("returns null for timed row", () => {
      const listing = {
        title: "Violines Para Ochún",
        styles: [],
        startsAt: new Date("2026-10-25T19:00:00Z"),
        nightDate: "2026-10-25",
        tz: "America/New_York",
      };
      const source = { mixedCalendar: true };
      expect(screenUnlistedUntimed(listing, source)).toBeNull();
    });

    it("returns null for row with dance style", () => {
      const listing = {
        title: "Salsa Social",
        styles: ["salsa"],
        startsAt: null,
        nightDate: "2026-10-25",
        tz: "America/New_York",
      };
      const source = { mixedCalendar: true };
      expect(screenUnlistedUntimed(listing, source)).toBeNull();
    });

    it("returns null for row with dance kind in title", () => {
      const listing = {
        title: "Halloween Party",
        styles: [],
        startsAt: null,
        nightDate: "2026-10-25",
        tz: "America/New_York",
      };
      const source = { mixedCalendar: true };
      expect(screenUnlistedUntimed(listing, source)).toBeNull();
    });
  });

  it("retires a stored row whose address is in Warsaw, and places or keeps the rest", async () => {
    const zouk = await upsertSource(db, metro.id, {
      url: "https://zoukology.com/",
      kind: "html",
      trustTier: "first_party",
      discoveredBy: "seed_list",
    });
    await write(zouk, [
      event({
        title: "Warsaw Brasil Festival 2026",
        local_date: "2026-10-02",
        listing_type: "festival_session",
        styles: ["brazilian_zouk"],
        venue: { address: "Warsaw, PL" },
      }),
      event({
        title: "NYC ZOUK FESTIVAL 2026",
        local_date: "2026-10-01",
        listing_type: "festival_session",
        styles: ["brazilian_zouk"],
        venue: { address: "New York, US" },
      }),
    ]);
    const elsewhere = async (a: string) => (a === "Warsaw, PL" ? "warsaw, pl" : null);
    const out = await placeUnplaced(db, {
      metro,
      nights: ["2026-10-01", "2026-10-02"],
      placeVenue: async () => null,
      elsewhere,
    });
    expect(out.notes.join(" ")).toContain("Warsaw Brasil Festival 2026 on 2026-10-02 (warsaw, pl)");
    const rows = await db
      .select({ title: events.title, status: events.status })
      .from(events)
      .orderBy(events.title);
    expect(rows).toEqual([
      { title: "NYC ZOUK FESTIVAL 2026", status: "active" },
      { title: "Warsaw Brasil Festival 2026", status: "removed" },
    ]);
    void eq;
  });
});
