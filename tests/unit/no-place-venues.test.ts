import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { Db } from "@/src/db/client";
import { events, metros, sources, venues } from "@/src/db/schema";
import { clearNoPlaceVenues } from "@/src/pipeline/no-place-venues";
import { upsertSource } from "@/src/pipeline/store";
import { closeTestDb, describeDb, resetDb, testDb } from "@/tests/unit/db-harness";

const NOW = new Date("2026-10-05T16:00:00Z");
const NYC_METRO_ID = "00000000-0000-4000-8000-000000000001";
const MEX_METRO_ID = "00000000-0000-4000-8000-000000000002";

describeDb("clearNoPlaceVenues", () => {
  let db: Db;

  beforeAll(async () => {
    db = await testDb("no_place_venues");
  });
  afterAll(closeTestDb);

  beforeEach(async () => {
    await resetDb();
  });

  describe("metro with a no-place venue", () => {
    beforeEach(async () => {
      // Create NYC metro
      await db.insert(metros).values({
        id: NYC_METRO_ID,
        slug: "nyc",
        name: "New York",
        countryCode: "US",
        center: { lat: 40.7128, lng: -74.006 },
        radiusKm: 40,
        tz: "America/New_York",
        languages: ["en"],
      });
      // Create Mexico City metro
      await db.insert(metros).values({
        id: MEX_METRO_ID,
        slug: "mex",
        name: "Mexico City",
        countryCode: "MX",
        center: { lat: 19.4326, lng: -99.1332 },
        radiusKm: 50,
        tz: "America/Mexico_City",
        languages: ["es"],
      });
    });

    it("clears events, series, and sources for no-place venue by name", async () => {
      // Create venues
      const noPlaceVenueId = "00000000-0000-4000-8000-0000000000a1";
      const normalVenueId = "00000000-0000-4000-8000-0000000000a2";

      await db.insert(venues).values([
        {
          id: noPlaceVenueId,
          name: "Various venues in Mexico City",
          nameNormalized: "various venues in mexico city",
          location: { lat: 19.4326, lng: -99.1332 },
          tz: "America/Mexico_City",
          kind: "other",
          danceFloor: "unknown",
          metroId: MEX_METRO_ID,
        },
        {
          id: normalVenueId,
          name: "Kartharsis Studio",
          nameNormalized: "kartharsis studio",
          location: { lat: 19.4327, lng: -99.1333 },
          tz: "America/Mexico_City",
          kind: "studio",
          danceFloor: "yes",
          metroId: MEX_METRO_ID,
        },
      ]);

      // Create events
      await db.insert(events).values([
        {
          slug: "event-no-place",
          title: "Event at no place",
          titleNormalized: "event at no place",
          listingType: "social",
          styles: ["salsa"],
          nightDate: "2026-10-09",
          tz: "America/Mexico_City",
          confirmation: "recurring_unconfirmed",
          venueId: noPlaceVenueId,
          geo: { lat: 19.4326, lng: -99.1332 },
        },
        {
          slug: "event-normal",
          title: "Event at normal",
          titleNormalized: "event at normal",
          listingType: "social",
          styles: ["salsa"],
          nightDate: "2026-10-09",
          tz: "America/Mexico_City",
          confirmation: "recurring_unconfirmed",
          venueId: normalVenueId,
          geo: { lat: 19.4327, lng: -99.1333 },
        },
      ]);

      // Create source
      const source = await upsertSource(db, MEX_METRO_ID, {
        url: "https://example.com/feed",
        kind: "feed_ics",
        trustTier: "first_party",
        discoveredBy: "seed_list",
      });
      await db.update(sources).set({ venueId: noPlaceVenueId }).where(eq(sources.id, source.id));

      // Run clearNoPlaceVenues
      const lines = await clearNoPlaceVenues(db, MEX_METRO_ID, NOW);

      // Verify results
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatch(
        /^"Various venues in Mexico City" is no place \(D-280\): its venue taken off 1 listings, 0 series and 1 sources$/,
      );

      // Check events
      const eventRows = await db
        .select({ slug: events.slug, venueId: events.venueId, geo: events.geo })
        .from(events)
        .orderBy(events.slug);
      expect(eventRows).toEqual([
        { slug: "event-no-place", venueId: null, geo: null },
        { slug: "event-normal", venueId: normalVenueId, geo: { lat: 19.4327, lng: -99.1333 } },
      ]);

      // Check source
      const sourceRow = await db
        .select({ venueId: sources.venueId })
        .from(sources)
        .where(eq(sources.id, source.id));
      expect(sourceRow[0]?.venueId).toBeNull();
    });

    it("second call returns empty array", async () => {
      const noPlaceVenueId = "00000000-0000-4000-8000-0000000000b1";
      await db.insert(venues).values({
        id: noPlaceVenueId,
        name: "Various venues in Mexico City",
        nameNormalized: "various venues in mexico city",
        location: { lat: 19.4326, lng: -99.1332 },
        tz: "America/Mexico_City",
        kind: "other",
        danceFloor: "unknown",
        metroId: MEX_METRO_ID,
      });
      const source = await upsertSource(db, MEX_METRO_ID, {
        url: "https://example.com/again",
        kind: "feed_ics",
        trustTier: "first_party",
        discoveredBy: "seed_list",
      });
      await db.update(sources).set({ venueId: noPlaceVenueId }).where(eq(sources.id, source.id));

      // First call should clear
      const lines1 = await clearNoPlaceVenues(db, MEX_METRO_ID, NOW);
      expect(lines1).toHaveLength(1);

      // Second call should return []
      const lines2 = await clearNoPlaceVenues(db, MEX_METRO_ID, NOW);
      expect(lines2).toEqual([]);
    });

    it("clears venue by address (not name)", async () => {
      const noPlaceVenueId = "00000000-0000-4000-8000-0000000000c1";
      await db.insert(venues).values({
        id: noPlaceVenueId,
        name: "Some Venue",
        nameNormalized: "some venue",
        address: {
          formatted: "Multiple neighborhoods, Mexico City, CDMX, Mexico",
        },
        location: { lat: 19.4326, lng: -99.1332 },
        tz: "America/Mexico_City",
        kind: "other",
        danceFloor: "unknown",
        metroId: MEX_METRO_ID,
      });

      await db.insert(events).values({
        slug: "event-address",
        title: "Event",
        titleNormalized: "event",
        listingType: "social",
        styles: ["salsa"],
        nightDate: "2026-10-09",
        tz: "America/Mexico_City",
        confirmation: "recurring_unconfirmed",
        venueId: noPlaceVenueId,
        geo: { lat: 19.4326, lng: -99.1332 },
      });

      const lines = await clearNoPlaceVenues(db, MEX_METRO_ID, NOW);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatch(/^"Some Venue" is no place \(D-280\)/);

      const eventRow = await db
        .select({ venueId: events.venueId, geo: events.geo })
        .from(events)
        .where(eq(events.slug, "event-address"));
      expect(eventRow[0]?.venueId).toBeNull();
      expect(eventRow[0]?.geo).toBeNull();
    });

    it("leaves no-place venue in another metro untouched", async () => {
      const noPlaceVenueId = "00000000-0000-4000-8000-0000000000d1";
      await db.insert(venues).values({
        id: noPlaceVenueId,
        name: "Various venues in Mexico City",
        nameNormalized: "various venues in mexico city",
        location: { lat: 19.4326, lng: -99.1332 },
        tz: "America/Mexico_City",
        kind: "other",
        danceFloor: "unknown",
        metroId: MEX_METRO_ID, // Mexico City metro
      });

      await db.insert(events).values({
        slug: "event-mex",
        title: "Event",
        titleNormalized: "event",
        listingType: "social",
        styles: ["salsa"],
        nightDate: "2026-10-09",
        tz: "America/Mexico_City",
        confirmation: "recurring_unconfirmed",
        venueId: noPlaceVenueId,
        geo: { lat: 19.4326, lng: -99.1332 },
      });

      // Clear for NYC metro (different metro)
      const lines = await clearNoPlaceVenues(db, NYC_METRO_ID, NOW);
      expect(lines).toEqual([]);

      // Event should still have venueId
      const eventRow = await db
        .select({ venueId: events.venueId })
        .from(events)
        .where(eq(events.slug, "event-mex"));
      expect(eventRow[0]?.venueId).toBe(noPlaceVenueId);
    });
  });
});
