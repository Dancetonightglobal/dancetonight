// The database repository against Postgres with PostGIS, for listings whose time is not listed
// (D-060): migration 0002 lets the row in with a NULL start, and the read path lists it on its
// stored night, counts it, sorts it after the timed bill and finds it by slug.

import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";

import { DbListingsRepository, resetEventUrlColumnCheck } from "@/src/data/db-repository";
import type { ListingSort } from "@/src/data/repository";
import type { Db } from "@/src/db/client";
import { eventSources, events, metros, sources, venues } from "@/src/db/schema";
import { dayPicker } from "@/src/domain/tonight";
import { closeTestDb, describeDb, requireDbInCi, resetDb, testDb } from "@/tests/unit/db-harness";
import { expectDistanceOrder, expectStartOrder } from "./listing-order";

requireDbInCi();

const NY = "America/New_York";
/** Sunday 20 September 2026, 7:42pm in New York. */
const NOW = new Date("2026-09-20T23:42:00Z");
const TONIGHT = "2026-09-20";
const WILLIAMSBURG = { lat: 40.7081, lng: -73.9571 };

let db: Db;
let repo: DbListingsRepository;
const venueIds: Record<"near" | "mid" | "far", string> = { near: "", mid: "", far: "" };

type EventInsert = typeof events.$inferInsert;

function row(slug: string, at: keyof typeof venueIds, fields: Partial<EventInsert>): EventInsert {
  return {
    slug,
    title: slug,
    titleNormalized: slug,
    listingType: "social",
    styles: ["salsa"],
    nightDate: TONIGHT,
    tz: NY,
    confirmation: "recurring_unconfirmed",
    venueId: venueIds[at],
    ...fields,
  };
}

const list = (nightDate: string, sort: ListingSort = "start", filters = {}) =>
  repo.listNight({ center: WILLIAMSBURG, radiusKm: 25, nightDate, now: NOW, filters, sort });

describeDb("DbListingsRepository with listings whose time is not listed", () => {
  beforeAll(async () => {
    db = await testDb("listings_read");
    repo = new DbListingsRepository(() => db);
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
    const inserted = await db
      .insert(venues)
      .values(
        (
          [
            ["near", 40.7081],
            ["mid", 40.72],
            ["far", 40.75],
          ] as const
        ).map(([name, lat]) => ({
          name,
          nameNormalized: name,
          location: { lat, lng: -73.9571 },
          tz: NY,
        })),
      )
      .returning({ id: venues.id, name: venues.name });
    for (const v of inserted) venueIds[v.name as keyof typeof venueIds] = v.id;

    await db
      .insert(events)
      .values([
        row("timed-8pm-far", "far", { dancingAt: new Date("2026-09-21T00:00:00Z") }),
        row("timed-10pm-near", "near", { dancingAt: new Date("2026-09-21T02:00:00Z") }),
        row("untimed-far", "far", {}),
        row("untimed-near", "near", {}),
        row("untimed-mid-until-2am", "mid", { endsAt: new Date("2026-09-21T06:00:00Z") }),
        row("untimed-cancelled", "mid", { status: "cancelled", confirmation: "cancelled" }),
        row("untimed-merged", "near", { status: "merged" }),
        row("untimed-last-night", "near", { nightDate: "2026-09-19" }),
        row("untimed-tomorrow", "near", { nightDate: "2026-09-21" }),
      ]);
  });

  it("tells an organiser's own page from a ticket page and a directory, per source (D-061, D-072)", async () => {
    const [own, tickets, directory] = await db
      .insert(sources)
      .values([
        { url: "https://organiser.example/", kind: "html", trustTier: "first_party" },
        { url: "https://www.ticketweb.com/venue/x", kind: "html", trustTier: "ticketing" },
        { url: "https://theronda.us/nyc", kind: "html", trustTier: "directory" },
      ])
      .returning({ id: sources.id, url: sources.url });
    const [timed] = await db.select().from(events).where(eq(events.slug, "timed-10pm-near"));
    await db.insert(eventSources).values([
      { eventId: timed!.id, sourceId: own!.id, sourceUrl: own!.url, role: "primary" },
      { eventId: timed!.id, sourceId: tickets!.id, sourceUrl: tickets!.url },
      { eventId: timed!.id, sourceId: directory!.id, sourceUrl: directory!.url },
    ]);
    const listing = await repo.getBySlug("timed-10pm-near", NOW);
    const byUrl = new Map(listing?.sources.map((s) => [s.url, [s.byOrganiser, s.tier]]));
    expect(byUrl.get("https://organiser.example/")).toEqual([true, "organizer"]);
    expect(byUrl.get("https://www.ticketweb.com/venue/x")).toEqual([true, "ticketing"]);
    expect(byUrl.get("https://theronda.us/nyc")).toEqual([false, "listing"]);
  });

  it("keeps serving pages before migration 0005 adds event_sources.event_url (D-073)", async () => {
    // The site deploys on merge; the column arrives with the next ingest run's migration. Until
    // then every listing query would fail if it named the column.
    const [own] = await db
      .insert(sources)
      .values({ url: "https://organiser.example/", kind: "html", trustTier: "first_party" })
      .returning({ id: sources.id, url: sources.url });
    const [timed] = await db.select().from(events).where(eq(events.slug, "timed-10pm-near"));
    const page = "https://organiser.example/events/friday-social";
    await db.insert(eventSources).values({
      eventId: timed!.id,
      sourceId: own!.id,
      sourceUrl: own!.url,
      role: "primary",
      eventUrl: page,
    });
    try {
      await db.execute(sql`alter table event_sources drop column event_url`);
      resetEventUrlColumnCheck();
      const before = await repo.getBySlug("timed-10pm-near", NOW);
      expect(before?.sources.map((s) => s.eventUrl)).toEqual([null]);
      expect((await list(TONIGHT)).listings.length).toBeGreaterThan(0);
    } finally {
      await db.execute(sql`alter table event_sources add column if not exists event_url text`);
      resetEventUrlColumnCheck();
    }
    await db
      .update(eventSources)
      .set({ eventUrl: page })
      .where(eq(eventSources.eventId, timed!.id));
    const after = await repo.getBySlug("timed-10pm-near", NOW);
    expect(after?.sources.map((s) => s.eventUrl)).toEqual([page]);
  });

  it("carries the venue's Google place ID to the listing, for its map links (D-066)", async () => {
    await db
      .update(venues)
      .set({ googlePlaceId: "ChIJnearvenue0000" })
      .where(eq(venues.id, venueIds.near));
    const listing = await repo.getBySlug("timed-10pm-near", NOW);
    expect(listing?.venue?.googlePlaceId).toBe("ChIJnearvenue0000");
    const { listings } = await list(TONIGHT);
    const bySlug = new Map(listings.map((l) => [l.slug, l.venue?.googlePlaceId]));
    expect(bySlug.get("untimed-near")).toBe("ChIJnearvenue0000");
    expect(bySlug.get("untimed-far")).toBeNull();
  });

  it("stores a row with no time: starts_at is NULL and night_date is the listed date", async () => {
    const [stored] = await db.select().from(events).where(eq(events.slug, "untimed-near"));
    expect(stored?.startsAt).toBeNull();
    expect(stored?.nightDate).toBe(TONIGHT);
    const [timed] = await db.select().from(events).where(eq(events.slug, "timed-10pm-near"));
    expect(timed?.startsAt?.toISOString()).toBe("2026-09-21T02:00:00.000Z");
  });

  it("lists tonight's untimed rows after the timed bill, and not last night's or merged ones", async () => {
    const { listings, counts } = await list(TONIGHT);
    expect(listings.map((l) => l.slug)).toEqual([
      "timed-8pm-far",
      "timed-10pm-near",
      "untimed-near",
      "untimed-cancelled",
      "untimed-mid-until-2am",
      "untimed-far",
    ]);
    expectStartOrder(listings);
    expect(counts.total).toBe(6);
    const bySlug = new Map(listings.map((l) => [l.slug, l]));
    expect(bySlug.get("untimed-near")?.liveStatus?.text).toBe("Time not listed");
    expect(bySlug.get("untimed-mid-until-2am")?.liveStatus?.text).toBe(
      "Time not listed, until 2am",
    );
    expect(bySlug.get("untimed-cancelled")?.liveStatus?.text).toBe("Cancelled tonight");
  });

  it("sorts them among the rest by distance under distance sort", async () => {
    const { listings } = await list(TONIGHT, "distance");
    expectDistanceOrder(listings);
    expect(listings.map((l) => l.slug)).toEqual([
      "timed-10pm-near",
      "untimed-near",
      "untimed-cancelled",
      "untimed-mid-until-2am",
      "timed-8pm-far",
      "untimed-far",
    ]);
  });

  it("leaves them out of the On now filter", async () => {
    const { listings } = await repo.listNight({
      center: WILLIAMSBURG,
      radiusKm: 25,
      nightDate: TONIGHT,
      now: new Date("2026-09-21T02:30:00Z"), // 10:30pm: both timed socials are on
      filters: { onNow: true },
      sort: "start",
    });
    expect(listings.map((l) => l.slug)).toEqual(["timed-8pm-far", "timed-10pm-near"]);
  });

  it("lists tomorrow's on tomorrow's night", async () => {
    const { listings } = await list("2026-09-21");
    expect(listings.map((l) => l.slug)).toEqual(["untimed-tomorrow"]);
    expect(listings[0]?.liveStatus?.kind).toBe("time_not_listed");
  });

  it("counts a venue at the radius edge the way the list does (review, 2026-09-28)", async () => {
    // 0.225 degrees north of Williamsburg: 25.02 km on the sphere the list measures, 24.99 km on
    // the spheroid PostGIS measures. The list leaves it out, so the day's count must too.
    const [edge] = await db
      .insert(venues)
      .values({
        name: "edge",
        nameNormalized: "edge",
        location: { lat: WILLIAMSBURG.lat + 0.225, lng: WILLIAMSBURG.lng },
        tz: NY,
      })
      .returning({ id: venues.id });
    await db.insert(events).values({ ...row("edge-night", "near", {}), venueId: edge!.id });
    const { listings } = await list(TONIGHT);
    expect(listings.map((l) => l.slug)).not.toContain("edge-night");
    const days = await repo.dayCounts(WILLIAMSBURG, 25, NOW);
    expect(days[0]?.count).toBe(listings.length);
  });

  it("counts them in the day picker on their stored nights, equal to each night's list", async () => {
    const days = await repo.dayCounts(WILLIAMSBURG, 25, NOW);
    expect(days.map((d) => d.nightDate)).toEqual(dayPicker(NOW, NY).map((d) => d.nightDate));
    expect(days.map((d) => d.count)).toEqual([6, 1, 0, 0, 0, 0, 0, 0]);
    for (const day of days) {
      expect(day.count, day.nightDate).toBe((await list(day.nightDate)).listings.length);
    }
  });

  it("finds one by slug with its status; last night's reads Ended; a merged one is not found", async () => {
    const found = await repo.getBySlug("untimed-mid-until-2am", NOW);
    expect(found?.startsAt).toBeNull();
    expect(found?.nightDate).toBe(TONIGHT);
    expect(found?.distanceKm).toBeNull();
    expect(found?.liveStatus).toEqual({
      kind: "time_not_listed",
      text: "Time not listed, until 2am",
      endNotListed: false,
    });
    expect((await repo.getBySlug("untimed-last-night", NOW))?.liveStatus?.kind).toBe("ended");
    expect(await repo.getBySlug("untimed-merged", NOW)).toBeNull();
  });

  it("answers the page's list and day picker from one read, equal to listNight and dayCounts", async () => {
    for (const nightDate of [TONIGHT, "2026-09-21"] as const) {
      for (const sort of ["start", "distance"] as const) {
        const result = await repo.nightWithDays({
          center: WILLIAMSBURG,
          radiusKm: 25,
          nightDate,
          now: NOW,
          filters: {},
          sort,
        });
        expect(result.night).toEqual(await list(nightDate, sort));
        expect(result.days).toEqual(await repo.dayCounts(WILLIAMSBURG, 25, NOW));
      }
    }
  });

  it("reads a picked night outside the picker too", async () => {
    const nightDate = "2026-10-20";
    const result = await repo.nightWithDays({
      center: WILLIAMSBURG,
      radiusKm: 25,
      nightDate,
      now: NOW,
      filters: {},
      sort: "start",
    });
    expect(result.night).toEqual(await list(nightDate));
    expect(result.days).toEqual(await repo.dayCounts(WILLIAMSBURG, 25, NOW));
  });

  it("runs one listings query for both", async () => {
    const fresh = new DbListingsRepository(() => db);
    const spy = vi.spyOn(
      fresh as unknown as { loadListings: (...a: unknown[]) => unknown },
      "loadListings",
    );
    await fresh.nightWithDays({
      center: WILLIAMSBURG,
      radiusKm: 25,
      nightDate: TONIGHT,
      now: NOW,
      filters: {},
      sort: "start",
    });
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
