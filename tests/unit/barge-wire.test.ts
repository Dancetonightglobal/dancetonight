import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { Metro, Source } from "@/src/adapters/types";
import type { Db } from "@/src/db/client";
import { events, metros } from "@/src/db/schema";
import { rawListingSchema } from "@/src/domain/listing";
import { EMPTY_BLOCKLIST } from "@/src/pipeline/blocklist";
import { normalizeListing, type NormalizedEvent } from "@/src/pipeline/normalize";
import {
  loadMetro,
  mergeInto,
  resolveVenue,
  retireScreenedTitles,
  restoreMergedClasses,
  upsertSource,
  writeEvents,
} from "@/src/pipeline/store";
import { closeTestDb, describeDb, requireDbInCi, resetDb, testDb } from "@/tests/unit/db-harness";

requireDbInCi();

const NOW = new Date("2026-09-23T16:00:00Z");
const METRO_ID = "11111111-1111-4111-8111-111111111111";
const NIGHT = "2026-09-30";

let db: Db;
let metro: Metro;
let source: Source;

function normalized(source: Source, fields: Record<string, unknown>): NormalizedEvent {
  const outcome = normalizeListing(
    {
      listing: rawListingSchema.parse({
        listing_type: "social",
        styles: [],
        venue: {},
        organizer: {},
        ...fields,
      }),
      externalId: null,
      tz: null,
      venueLocation: null,
      recurrence: null,
      provenance: { sourceUrl: source.url, fetchedAt: NOW, method: "feed" },
    },
    { metro, source, now: NOW },
  );
  if (!outcome.ok) throw new Error(outcome.reason);
  return outcome.event;
}

const place = (input: Parameters<typeof resolveVenue>[2]) => resolveVenue(db, metro, input);

describeDb("barge wire (D-1046)", () => {
  beforeAll(async () => {
    db = await testDb("barge-wire");
  });
  afterAll(closeTestDb);

  beforeEach(async () => {
    await resetDb();
    await db.insert(metros).values({
      id: METRO_ID,
      slug: "paris",
      name: "Paris",
      countryCode: "FR",
      center: { lat: 48.8566, lng: 2.3522 },
      radiusKm: 50,
      tz: "Europe/Paris",
      languages: ["fr", "en"],
      status: "active",
    });
    metro = (await loadMetro(db, "paris"))!;
    source = await upsertSource(db, metro.id, {
      url: "https://example.com/calendar",
      kind: "feed_ics",
      trustTier: "first_party",
      discoveredBy: "feed_ics",
    });
  });

  it("normalizeListing passes venue name to screenTitle", () => {
    // With barge venue name: passes
    const outcome1 = normalizeListing(
      {
        listing: rawListingSchema.parse({
          title: "Rock That Boat",
          local_date: NIGHT,
          dancing_time: "20:00",
          styles: ["rock_n_roll"],
          listing_type: "social",
          venue: { name: "Péniche Concorde Atlantique" },
          organizer: {},
        }),
        externalId: null,
        tz: null,
        venueLocation: null,
        recurrence: null,
        provenance: { sourceUrl: source.url, fetchedAt: NOW, method: "feed" },
      },
      { metro, source, now: NOW },
    );
    expect(outcome1.ok).toBe(true);

    // Without venue name: screened out
    const outcome2 = normalizeListing(
      {
        listing: rawListingSchema.parse({
          title: "Rock That Boat",
          local_date: NIGHT,
          dancing_time: "20:00",
          styles: ["rock_n_roll"],
          listing_type: "social",
          venue: {},
          organizer: {},
        }),
        externalId: null,
        tz: null,
        venueLocation: null,
        recurrence: null,
        provenance: { sourceUrl: source.url, fetchedAt: NOW, method: "feed" },
      },
      { metro, source, now: NOW },
    );
    expect(outcome2.ok).toBe(false);
    if (!outcome2.ok) {
      expect(outcome2.kind).toBe("not_an_event");
    }
  });

  it("retireScreenedTitles keeps a barge row", async () => {
    // Create a barge venue
    const venue = await place({
      name: "Péniche Concorde Atlantique",
      address: null,
      url: null,
      location: { lat: 48.8656, lng: 2.3212 },
    });
    expect(venue).not.toBeNull();
    const venueId = venue!.venueId;

    // Write an event at that venue
    const event = normalized(source, {
      title: "Rock That Boat",
      local_date: NIGHT,
      dancing_time: "20:00",
      styles: ["rock_n_roll"],
      venue: { name: "Péniche Concorde Atlantique" },
    });
    const result = await writeEvents(db, {
      metro,
      source,
      events: [event],
      blocklist: EMPTY_BLOCKLIST,
      placeVenue: place,
    });
    const eventId = result.eventIds[0];
    expect(eventId).toBeDefined();

    // Set venue id (writeEvents may not place without location)
    await db.update(events).set({ venueId }).where(eq(events.id, eventId!));

    // Run retireScreenedTitles
    const { retired } = await retireScreenedTitles(db, { metro, nights: [NIGHT] });
    expect(retired).toBe(0);

    // Verify row still active
    const row = await db
      .select({ status: events.status })
      .from(events)
      .where(eq(events.id, eventId!));
    expect(row[0]?.status).toBe("active");
  });

  it("retireScreenedTitles still retires a cruise at the barge", async () => {
    // Create barge venue
    const venue = await place({
      name: "Péniche Concorde Atlantique",
      address: null,
      url: null,
      location: { lat: 48.8656, lng: 2.3212 },
    });
    expect(venue).not.toBeNull();
    const venueId = venue!.venueId;

    // Write an event with generic title
    const event = normalized(source, {
      title: "Monday Night Thing",
      local_date: NIGHT,
      dancing_time: "20:00",
      styles: ["rock_n_roll"],
      venue: { name: "Péniche Concorde Atlantique" },
    });
    const result = await writeEvents(db, {
      metro,
      source,
      events: [event],
      blocklist: EMPTY_BLOCKLIST,
      placeVenue: place,
    });
    const eventId = result.eventIds[0];
    expect(eventId).toBeDefined();

    // Set venue id
    await db.update(events).set({ venueId }).where(eq(events.id, eventId!));

    // Rename to a cruise title
    await db
      .update(events)
      .set({ title: "Thames Boat Party Cruise" })
      .where(eq(events.id, eventId!));

    // Run retireScreenedTitles
    const { retired } = await retireScreenedTitles(db, { metro, nights: [NIGHT] });
    expect(retired).toBe(1);

    // Verify row removed
    const row = await db
      .select({ status: events.status })
      .from(events)
      .where(eq(events.id, eventId!));
    expect(row[0]?.status).toBe("removed");
  });

  it("retireScreenedTitles retires Rock That Boat with no venue", async () => {
    // Written under a plain title with no venue, then renamed (as stored before the screen existed)
    const event = normalized(source, {
      title: "Monday Night Thing",
      local_date: NIGHT,
      dancing_time: "20:00",
      styles: ["rock_n_roll"],
      venue: {},
    });
    const result = await writeEvents(db, {
      metro,
      source,
      events: [event],
      blocklist: EMPTY_BLOCKLIST,
      placeVenue: place,
    });
    const eventId = result.eventIds[0];
    expect(eventId).toBeDefined();
    await db.update(events).set({ title: "Rock That Boat" }).where(eq(events.id, eventId!));

    // Run retireScreenedTitles
    const { retired } = await retireScreenedTitles(db, { metro, nights: [NIGHT] });
    expect(retired).toBe(1);

    // Verify row removed
    const row = await db
      .select({ status: events.status })
      .from(events)
      .where(eq(events.id, eventId!));
    expect(row[0]?.status).toBe("removed");
  });
});
