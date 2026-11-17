import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";

import { DbListingsRepository } from "@/src/data/db-repository";
import { events, metros } from "@/src/db/schema";
import { closeTestDb, describeDb, requireDbInCi, resetDb, testDb } from "@/tests/unit/db-harness";

requireDbInCi();

const NY = "America/New_York";
const LONDON_TZ = "Europe/London";

describeDb("DbListingsRepository listCities", () => {
  let db: Awaited<ReturnType<typeof testDb>>;
  let repo: DbListingsRepository;

  beforeAll(async () => {
    db = await testDb("city_list");
    repo = new DbListingsRepository(() => db);
  });
  afterAll(closeTestDb);

  beforeEach(async () => {
    await resetDb();
    // Insert metros: New York, London, and an ad-hoc metro
    await db.insert(metros).values([
      {
        slug: "nyc",
        name: "New York",
        countryCode: "US",
        center: { lat: 40.7128, lng: -74.006 },
        radiusKm: 50,
        tz: NY,
        languages: ["en"],
        adHoc: false,
      },
      {
        slug: "london",
        name: "London",
        countryCode: "GB",
        center: { lat: 51.5074, lng: -0.1278 },
        radiusKm: 35,
        tz: LONDON_TZ,
        languages: ["en"],
        adHoc: false,
      },
      {
        slug: "adhoc",
        name: "Ad Hoc",
        countryCode: "US",
        center: { lat: 34.0522, lng: -118.2437 },
        radiusKm: 30,
        tz: "America/Los_Angeles",
        languages: ["en"],
        adHoc: true,
      },
    ]);
  });

  it("returns two metros sorted by name, ad-hoc absent", async () => {
    const cities = await repo.listCities(new Date("2026-09-20T12:00:00Z"));
    expect(cities).toHaveLength(2);
    expect(cities.map((c) => c.name)).toEqual(["London", "New York"]);
    expect(cities.find((c) => c.slug === "adhoc")).toBeUndefined();
  });

  it("New York with one active event on tonight's night: true; London with none: false", async () => {
    const now = new Date("2026-09-20T23:42:00Z"); // 7:42pm NY, night 2026-09-20
    // Get metro ids
    const [nycRow] = await db.select().from(metros).where(eq(metros.slug, "nyc"));
    const [londonRow] = await db.select().from(metros).where(eq(metros.slug, "london"));

    // Insert an active event for NY tonight
    await db.insert(events).values({
      slug: "test-nyc",
      title: "Test NYC",
      titleNormalized: "test nyc",
      listingType: "social",
      styles: ["salsa"],
      nightDate: "2026-09-20",
      tz: NY,
      confirmation: "recurring_unconfirmed",
      metroId: nycRow!.id,
      status: "active",
      mergedIntoId: null,
    });

    const cities = await repo.listCities(now);
    const nyc = cities.find((c) => c.slug === "nyc");
    const london = cities.find((c) => c.slug === "london");
    expect(nyc?.hasListings).toBe(true);
    expect(london?.hasListings).toBe(false);
  });

  it("an event that is cancelled, or has merged_into_id set, alone: false", async () => {
    const now = new Date("2026-09-20T23:42:00Z");
    const [nycRow] = await db.select().from(metros).where(eq(metros.slug, "nyc"));

    // A cancelled event, and an active one merged into it: neither is listed.
    const [cancelled] = await db
      .insert(events)
      .values({
        slug: "cancelled",
        title: "Cancelled",
        titleNormalized: "cancelled",
        listingType: "social",
        styles: ["salsa"],
        nightDate: "2026-09-20",
        tz: NY,
        confirmation: "cancelled",
        metroId: nycRow!.id,
        status: "cancelled",
      })
      .returning({ id: events.id });
    await db.insert(events).values({
      slug: "merged",
      title: "Merged",
      titleNormalized: "merged",
      listingType: "social",
      styles: ["salsa"],
      nightDate: "2026-09-20",
      tz: NY,
      confirmation: "recurring_unconfirmed",
      metroId: nycRow!.id,
      status: "active",
      mergedIntoId: cancelled!.id,
    });

    const cities = await repo.listCities(now);
    const nyc = cities.find((c) => c.slug === "nyc");
    expect(nyc?.hasListings).toBe(false);
  });

  it("night boundary: a NY event on night 2026-09-19 with now = 2026-09-20 03:00 NY time is true; with now = 2026-09-20 07:00 NY time it is false", async () => {
    const [nycRow] = await db.select().from(metros).where(eq(metros.slug, "nyc"));

    // Insert event for night 2026-09-19
    await db.insert(events).values({
      slug: "past-night",
      title: "Past Night",
      titleNormalized: "past night",
      listingType: "social",
      styles: ["salsa"],
      nightDate: "2026-09-19",
      tz: NY,
      confirmation: "recurring_unconfirmed",
      metroId: nycRow!.id,
      status: "active",
      mergedIntoId: null,
    });

    // Test at 3am NY time (still within night boundary)
    const earlyNow = new Date("2026-09-20T07:00:00Z"); // 3am NY (NY is UTC-4)
    let cities = await repo.listCities(earlyNow);
    let nyc = cities.find((c) => c.slug === "nyc");
    expect(nyc?.hasListings).toBe(true);

    // Test at 7am NY time (past night boundary)
    const lateNow = new Date("2026-09-20T11:00:00Z"); // 7am NY
    cities = await repo.listCities(lateNow);
    nyc = cities.find((c) => c.slug === "nyc");
    expect(nyc?.hasListings).toBe(false);
  });
});
