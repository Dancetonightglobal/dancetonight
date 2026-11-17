// Prototype of the D-082 read path tests (design verification only).
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";

import { DbListingsRepository } from "@/src/data/db-repository";
import type { Db } from "@/src/db/client";
import { events, metros, venues } from "@/src/db/schema";
import { closeTestDb, describeDb, resetDb, testDb } from "@/tests/unit/db-harness";

const NY = "America/New_York";
const NOW = new Date("2026-09-20T23:42:00Z");
const TONIGHT = "2026-09-20";
const MIDTOWN = { lat: 40.7128, lng: -74.006 };
const BOSTON = { lat: 42.3601, lng: -71.0589 };

let db: Db;
let repo: DbListingsRepository;

describeDb("listings with no location (D-082)", () => {
  beforeAll(async () => {
    db = await testDb("unplaced_read");
    repo = new DbListingsRepository(() => db);
  });
  afterAll(closeTestDb);
  beforeEach(async () => {
    await resetDb();
    const [nyc] = await db
      .insert(metros)
      .values({
        slug: "nyc",
        name: "New York",
        countryCode: "US",
        center: MIDTOWN,
        radiusKm: 40,
        tz: NY,
        languages: ["en"],
      })
      .returning({ id: metros.id });
    const [other] = await db
      .insert(metros)
      .values({
        slug: "bos",
        name: "Boston",
        countryCode: "US",
        center: BOSTON,
        radiusKm: 40,
        tz: NY,
        languages: ["en"],
      })
      .returning({ id: metros.id });
    const [hall] = await db
      .insert(venues)
      .values({
        name: "Hall",
        nameNormalized: "hall",
        location: { lat: 40.72, lng: -74.0 },
        tz: NY,
        metroId: nyc!.id,
      })
      .returning({ id: venues.id });
    const base = {
      listingType: "social" as const,
      styles: ["salsa"],
      tz: NY,
      confirmation: "recurring_unconfirmed" as const,
    };
    await db.insert(events).values([
      {
        ...base,
        slug: "placed-9pm",
        title: "Placed",
        titleNormalized: "placed",
        nightDate: TONIGHT,
        venueId: hall!.id,
        metroId: nyc!.id,
        dancingAt: new Date("2026-09-21T01:00:00Z"),
      },
      {
        ...base,
        slug: "unplaced-9pm",
        title: "Unplaced",
        titleNormalized: "unplaced",
        nightDate: TONIGHT,
        venueId: null,
        metroId: nyc!.id,
        dancingAt: new Date("2026-09-21T01:00:00Z"),
      },
      {
        ...base,
        slug: "unplaced-with-geo",
        title: "Geo only",
        titleNormalized: "geo only",
        nightDate: TONIGHT,
        venueId: null,
        metroId: nyc!.id,
        geo: { lat: 40.72, lng: -74.0 },
      },
      {
        ...base,
        slug: "unplaced-boston",
        title: "Boston",
        titleNormalized: "boston",
        nightDate: TONIGHT,
        venueId: null,
        metroId: other!.id,
      },
      {
        ...base,
        slug: "unplaced-removed",
        title: "Gone",
        titleNormalized: "gone",
        nightDate: TONIGHT,
        venueId: null,
        metroId: nyc!.id,
        status: "removed",
      },
      {
        ...base,
        slug: "unplaced-tomorrow",
        title: "Tomorrow",
        titleNormalized: "tomorrow",
        nightDate: "2026-09-21",
        venueId: null,
        metroId: nyc!.id,
      },
    ]);
  });

  it("lists the metro's unplaced rows at the metro's own radius, last by distance, none at a smaller one", async () => {
    const wide = await repo.listNight({
      center: MIDTOWN,
      radiusKm: 40,
      nightDate: TONIGHT,
      now: NOW,
      sort: "distance",
    });
    expect(wide.listings.map((l) => l.slug)).toEqual([
      "placed-9pm",
      "unplaced-9pm",
      "unplaced-with-geo",
    ]);
    expect(wide.listings.map((l) => l.venue === null)).toEqual([false, true, true]);
    expect(wide.listings[1]?.distanceKm).toBeNull();
    const start = await repo.listNight({
      center: MIDTOWN,
      radiusKm: 40,
      nightDate: TONIGHT,
      now: NOW,
      sort: "start",
    });
    expect(start.listings.map((l) => l.slug)).toEqual([
      "placed-9pm",
      "unplaced-9pm",
      "unplaced-with-geo",
    ]);
    const near = await repo.listNight({
      center: MIDTOWN,
      radiusKm: 16,
      nightDate: TONIGHT,
      now: NOW,
      sort: "start",
    });
    expect(near.listings.map((l) => l.slug)).toEqual(["placed-9pm"]);
    const days = await repo.dayCounts(MIDTOWN, 40, NOW);
    expect(days[0]?.count).toBe(3);
    expect(days[1]?.count).toBe(1);
    expect((await repo.dayCounts(MIDTOWN, 16, NOW))[0]?.count).toBe(1);
    const found = await repo.getBySlug("unplaced-9pm", NOW);
    expect(found?.venue).toBeNull();
    expect(found?.liveStatus?.kind).toBe("upcoming");
    expect(await repo.getBySlug("unplaced-removed", NOW)).toBeNull();
    const far = await repo.listNight({
      center: { lat: 41.5, lng: -73.0 },
      radiusKm: 40,
      nightDate: TONIGHT,
      now: NOW,
      sort: "start",
    });
    expect(far.listings).toEqual([]);
  });
});
