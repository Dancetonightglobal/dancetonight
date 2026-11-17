import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";

import type { HarvestedListing, Metro, Source } from "@/src/adapters/types";
import type { Db } from "@/src/db/client";
import { events, metros } from "@/src/db/schema";
import { rawListingSchema } from "@/src/domain/listing";
import { EMPTY_BLOCKLIST } from "@/src/pipeline/blocklist";
import { normalizeListing, type NormalizedEvent } from "@/src/pipeline/normalize";
import {
  loadMetro,
  upsertSource,
  writeEvents,
  retireSameSourceSiblings,
  retireUnlisted,
  resolveVenue,
} from "@/src/pipeline/store";
import { closeTestDb, describeDb, requireDbInCi, resetDb, testDb } from "@/tests/unit/db-harness";

requireDbInCi();

const NOW = new Date("2026-09-23T16:00:00Z");
const METRO_ID = "11111111-1111-4111-8111-111111111111";

let db: Db;
let metro: Metro;
let source: Source;

function normalized(
  fields: Record<string, unknown>,
  extra: Partial<HarvestedListing> = {},
): NormalizedEvent {
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
      provenance: { sourceUrl: "https://salsa.example/calendar", fetchedAt: NOW, method: "feed" },
      ...extra,
    },
    { metro, source, now: NOW },
  );
  if (!outcome.ok) throw new Error(outcome.reason);
  return outcome.event;
}

const place = (input: Parameters<typeof resolveVenue>[2]) => resolveVenue(db, metro, input);

describeDb("store-retired-merge-target", () => {
  beforeAll(async () => {
    db = await testDb("store-retired-merge-target");
  });
  afterAll(closeTestDb);

  beforeEach(async () => {
    await resetDb();
    await db.insert(metros).values({
      id: METRO_ID,
      slug: "nyc",
      name: "New York",
      countryCode: "US",
      center: { lat: 40.7128, lng: -74.006 },
      radiusKm: 50,
      tz: "America/New_York",
      languages: ["en"],
      status: "active",
    });
    metro = (await loadMetro(db, "nyc"))!;
    source = await upsertSource(db, metro.id, {
      url: "https://salsa.example/calendar",
      kind: "feed_ics",
      trustTier: "first_party",
      discoveredBy: "feed_ics",
      styles: ["salsa"],
    });
  });

  it("restores a listed row retired into a sibling when that sibling is retired outright", async () => {
    // Create a venue first
    const venue = await place({
      name: "Test Venue",
      address: null,
      url: null,
      location: { lat: 40.7, lng: -74.0 },
    });
    expect(venue).not.toBeNull();
    const venueId = venue!.venueId;

    // Two events same night, same venue, same start/end, different titles
    const a = normalized(
      {
        title: "dance parties featuring all vinyl DJs",
        local_date: "2026-09-30",
        dancing_time: "21:00",
        end_time: "02:00",
        venue: { name: "Test Venue" },
      },
      { venueLocation: { lat: 40.7, lng: -74.0 } },
    );
    const b = normalized(
      {
        title: "Trestle Inn Dance Party",
        local_date: "2026-09-30",
        dancing_time: "21:00",
        end_time: "02:00",
        venue: { name: "Test Venue" },
      },
      { venueLocation: { lat: 40.7, lng: -74.0 } },
    );
    // Write both
    const resultA = await writeEvents(db, {
      metro,
      source,
      events: [a],
      blocklist: EMPTY_BLOCKLIST,
      placeVenue: place,
    });
    const resultB = await writeEvents(db, {
      metro,
      source,
      events: [b],
      blocklist: EMPTY_BLOCKLIST,
      placeVenue: place,
    });
    const writtenIds = [...resultA.eventIds, ...resultB.eventIds];
    // Ensure venueId is set (simulate placement)
    await db.update(events).set({ venueId }).where(inArray(events.id, writtenIds));

    // Run sibling merge: one will be retired into the other
    const { retired } = await retireSameSourceSiblings(db, {
      source,
      writtenIds,
    });
    expect(retired).toBe(1);

    // Determine which row is the keeper and which is the loser
    const rows = await db.select().from(events).where(inArray(events.id, writtenIds));
    const keeper = rows.find((r) => r.status === "active")!;
    const loser = rows.find((r) => r.status === "removed")!;
    expect(keeper).toBeDefined();
    expect(loser).toBeDefined();
    expect(loser.mergedIntoId).toBe(keeper.id);

    // Case 1: retire the keeper via retireUnlisted with loser listed
    await retireUnlisted(db, {
      source,
      listedIds: [loser.id],
      nights: ["2026-09-30"],
    });
    const after = await db.select().from(events).where(inArray(events.id, writtenIds));
    const keeperAfter = after.find((r) => r.id === keeper.id)!;
    const loserAfter = after.find((r) => r.id === loser.id)!;
    // Keeper is removed, mergedIntoId null
    expect(keeperAfter.status).toBe("removed");
    expect(keeperAfter.mergedIntoId).toBeNull();
    // Loser is active, mergedIntoId null
    expect(loserAfter.status).toBe("active");
    expect(loserAfter.mergedIntoId).toBeNull();
  });

  it("keeps a removed row down when its sibling is retired but the loser is not listed", async () => {
    const venue = await place({
      name: "Test Venue",
      address: null,
      url: null,
      location: { lat: 40.7, lng: -74.0 },
    });
    const venueId = venue!.venueId;
    const a = normalized(
      {
        title: "dance parties featuring all vinyl DJs",
        local_date: "2026-09-30",
        dancing_time: "21:00",
        end_time: "02:00",
        venue: { name: "Test Venue" },
      },
      { venueLocation: { lat: 40.7, lng: -74.0 } },
    );
    const b = normalized(
      {
        title: "Trestle Inn Dance Party",
        local_date: "2026-09-30",
        dancing_time: "21:00",
        end_time: "02:00",
        venue: { name: "Test Venue" },
      },
      { venueLocation: { lat: 40.7, lng: -74.0 } },
    );
    const resultA = await writeEvents(db, {
      metro,
      source,
      events: [a],
      blocklist: EMPTY_BLOCKLIST,
      placeVenue: place,
    });
    const resultB = await writeEvents(db, {
      metro,
      source,
      events: [b],
      blocklist: EMPTY_BLOCKLIST,
      placeVenue: place,
    });
    const writtenIds = [...resultA.eventIds, ...resultB.eventIds];
    await db.update(events).set({ venueId }).where(inArray(events.id, writtenIds));

    await retireSameSourceSiblings(db, { source, writtenIds });
    const rows = await db.select().from(events).where(inArray(events.id, writtenIds));
    const keeper = rows.find((r) => r.status === "active")!;
    const loser = rows.find((r) => r.status === "removed")!;

    // Create a third event on another night to have a non-empty listedIds
    const c = normalized(
      {
        title: "Other Event",
        local_date: "2026-10-01",
        dancing_time: "20:00",
        venue: { name: "Test Venue" },
      },
      { venueLocation: { lat: 40.7, lng: -74.0 } },
    );
    const resultC = await writeEvents(db, {
      metro,
      source,
      events: [c],
      blocklist: EMPTY_BLOCKLIST,
      placeVenue: place,
    });
    const otherId = resultC.eventIds[0]!;

    // Retire keeper with listedIds containing only the other event (loser not listed)
    await retireUnlisted(db, {
      source,
      listedIds: [otherId],
      nights: ["2026-09-30"],
    });
    const after = await db.select().from(events).where(inArray(events.id, writtenIds));
    const keeperAfter = after.find((r) => r.id === keeper.id)!;
    const loserAfter = after.find((r) => r.id === loser.id)!;
    // Keeper removed, mergedIntoId null
    expect(keeperAfter.status).toBe("removed");
    expect(keeperAfter.mergedIntoId).toBeNull();
    // Loser stays removed, still pointing at keeper
    expect(loserAfter.status).toBe("removed");
    expect(loserAfter.mergedIntoId).toBe(keeper.id);
  });

  it("repairs a removed row on a later write when its merge target is retired outright", async () => {
    const venue = await place({
      name: "Test Venue",
      address: null,
      url: null,
      location: { lat: 40.7, lng: -74.0 },
    });
    const venueId = venue!.venueId;
    const a = normalized(
      {
        title: "dance parties featuring all vinyl DJs",
        local_date: "2026-09-30",
        dancing_time: "21:00",
        end_time: "02:00",
        venue: { name: "Test Venue" },
      },
      { venueLocation: { lat: 40.7, lng: -74.0 } },
    );
    const b = normalized(
      {
        title: "Trestle Inn Dance Party",
        local_date: "2026-09-30",
        dancing_time: "21:00",
        end_time: "02:00",
        venue: { name: "Test Venue" },
      },
      { venueLocation: { lat: 40.7, lng: -74.0 } },
    );
    const resultA = await writeEvents(db, {
      metro,
      source,
      events: [a],
      blocklist: EMPTY_BLOCKLIST,
      placeVenue: place,
    });
    const resultB = await writeEvents(db, {
      metro,
      source,
      events: [b],
      blocklist: EMPTY_BLOCKLIST,
      placeVenue: place,
    });
    const writtenIds = [...resultA.eventIds, ...resultB.eventIds];
    await db.update(events).set({ venueId }).where(inArray(events.id, writtenIds));

    await retireSameSourceSiblings(db, { source, writtenIds });
    const rows = await db.select().from(events).where(inArray(events.id, writtenIds));
    const keeper = rows.find((r) => r.status === "active")!;
    const loser = rows.find((r) => r.status === "removed")!;

    // Manually set keeper to removed, mergedIntoId null (simulating retireUnlisted)
    await db
      .update(events)
      .set({ status: "removed", mergedIntoId: null })
      .where(eq(events.id, keeper.id));

    // Write the loser's listing again
    const loserEvent = normalized(
      {
        title: "Trestle Inn Dance Party",
        local_date: "2026-09-30",
        dancing_time: "21:00",
        end_time: "02:00",
        venue: { name: "Test Venue" },
      },
      { venueLocation: { lat: 40.7, lng: -74.0 } },
    );
    const rewrite = await writeEvents(db, {
      metro,
      source,
      events: [loserEvent],
      blocklist: EMPTY_BLOCKLIST,
      placeVenue: place,
    });
    expect(rewrite.written).toBe(1);
    const after = await db.select().from(events).where(eq(events.id, loser.id));
    expect(after[0]?.status).toBe("active");
    expect(after[0]?.mergedIntoId).toBeNull();
  });

  it("keeps a removed row pointing at a live keeper on rewrite", async () => {
    const venue = await place({
      name: "Test Venue",
      address: null,
      url: null,
      location: { lat: 40.7, lng: -74.0 },
    });
    const venueId = venue!.venueId;
    const a = normalized(
      {
        title: "dance parties featuring all vinyl DJs",
        local_date: "2026-09-30",
        dancing_time: "21:00",
        end_time: "02:00",
        venue: { name: "Test Venue" },
      },
      { venueLocation: { lat: 40.7, lng: -74.0 } },
    );
    const b = normalized(
      {
        title: "Trestle Inn Dance Party",
        local_date: "2026-09-30",
        dancing_time: "21:00",
        end_time: "02:00",
        venue: { name: "Test Venue" },
      },
      { venueLocation: { lat: 40.7, lng: -74.0 } },
    );
    const resultA = await writeEvents(db, {
      metro,
      source,
      events: [a],
      blocklist: EMPTY_BLOCKLIST,
      placeVenue: place,
    });
    const resultB = await writeEvents(db, {
      metro,
      source,
      events: [b],
      blocklist: EMPTY_BLOCKLIST,
      placeVenue: place,
    });
    const writtenIds = [...resultA.eventIds, ...resultB.eventIds];
    await db.update(events).set({ venueId }).where(inArray(events.id, writtenIds));

    await retireSameSourceSiblings(db, { source, writtenIds });
    const rows = await db.select().from(events).where(inArray(events.id, writtenIds));
    const keeper = rows.find((r) => r.status === "active")!;
    const loser = rows.find((r) => r.status === "removed")!;

    // Write the loser's listing again without touching the keeper
    const loserEvent = normalized(
      {
        title: "Trestle Inn Dance Party",
        local_date: "2026-09-30",
        dancing_time: "21:00",
        end_time: "02:00",
        venue: { name: "Test Venue" },
      },
      { venueLocation: { lat: 40.7, lng: -74.0 } },
    );
    const rewrite = await writeEvents(db, {
      metro,
      source,
      events: [loserEvent],
      blocklist: EMPTY_BLOCKLIST,
      placeVenue: place,
    });
    expect(rewrite.written).toBe(1);
    const after = await db.select().from(events).where(eq(events.id, loser.id));
    // Should stay removed, mergedIntoId = keeper.id
    expect(after[0]?.status).toBe("removed");
    expect(after[0]?.mergedIntoId).toBe(keeper.id);
  });

  it("keeps a removed row pointing at a keeper retired into a replacement", async () => {
    const venue = await place({
      name: "Test Venue",
      address: null,
      url: null,
      location: { lat: 40.7, lng: -74.0 },
    });
    const venueId = venue!.venueId;
    const a = normalized(
      {
        title: "dance parties featuring all vinyl DJs",
        local_date: "2026-09-30",
        dancing_time: "21:00",
        end_time: "02:00",
        venue: { name: "Test Venue" },
      },
      { venueLocation: { lat: 40.7, lng: -74.0 } },
    );
    const b = normalized(
      {
        title: "Trestle Inn Dance Party",
        local_date: "2026-09-30",
        dancing_time: "21:00",
        end_time: "02:00",
        venue: { name: "Test Venue" },
      },
      { venueLocation: { lat: 40.7, lng: -74.0 } },
    );
    const resultA = await writeEvents(db, {
      metro,
      source,
      events: [a],
      blocklist: EMPTY_BLOCKLIST,
      placeVenue: place,
    });
    const resultB = await writeEvents(db, {
      metro,
      source,
      events: [b],
      blocklist: EMPTY_BLOCKLIST,
      placeVenue: place,
    });
    const writtenIds = [...resultA.eventIds, ...resultB.eventIds];
    await db.update(events).set({ venueId }).where(inArray(events.id, writtenIds));

    await retireSameSourceSiblings(db, { source, writtenIds });
    const rows = await db.select().from(events).where(inArray(events.id, writtenIds));
    const keeper = rows.find((r) => r.status === "active")!;
    const loser = rows.find((r) => r.status === "removed")!;

    // Create a third row C (replacement)
    const c = normalized(
      {
        title: "Replacement Event",
        local_date: "2026-10-01",
        dancing_time: "20:00",
        venue: { name: "Test Venue" },
      },
      { venueLocation: { lat: 40.7, lng: -74.0 } },
    );
    const resultC = await writeEvents(db, {
      metro,
      source,
      events: [c],
      blocklist: EMPTY_BLOCKLIST,
      placeVenue: place,
    });
    const replacementId = resultC.eventIds[0]!;

    // Set keeper retired into replacement
    await db
      .update(events)
      .set({ status: "removed", mergedIntoId: replacementId })
      .where(eq(events.id, keeper.id));

    // Write the loser's listing again
    const loserEvent = normalized(
      {
        title: "Trestle Inn Dance Party",
        local_date: "2026-09-30",
        dancing_time: "21:00",
        end_time: "02:00",
        venue: { name: "Test Venue" },
      },
      { venueLocation: { lat: 40.7, lng: -74.0 } },
    );
    const rewrite = await writeEvents(db, {
      metro,
      source,
      events: [loserEvent],
      blocklist: EMPTY_BLOCKLIST,
      placeVenue: place,
    });
    expect(rewrite.written).toBe(1);
    const after = await db.select().from(events).where(eq(events.id, loser.id));
    // Should stay removed, mergedIntoId = keeper.id
    expect(after[0]?.status).toBe("removed");
    expect(after[0]?.mergedIntoId).toBe(keeper.id);
  });

  it("keeps a merged row merged even when its target is retired outright", async () => {
    const venue = await place({
      name: "Test Venue",
      address: null,
      url: null,
      location: { lat: 40.7, lng: -74.0 },
    });
    const venueId = venue!.venueId;
    const a = normalized(
      {
        title: "dance parties featuring all vinyl DJs",
        local_date: "2026-09-30",
        dancing_time: "21:00",
        end_time: "02:00",
        venue: { name: "Test Venue" },
      },
      { venueLocation: { lat: 40.7, lng: -74.0 } },
    );
    const b = normalized(
      {
        title: "Trestle Inn Dance Party",
        local_date: "2026-09-30",
        dancing_time: "21:00",
        end_time: "02:00",
        venue: { name: "Test Venue" },
      },
      { venueLocation: { lat: 40.7, lng: -74.0 } },
    );
    const resultA = await writeEvents(db, {
      metro,
      source,
      events: [a],
      blocklist: EMPTY_BLOCKLIST,
      placeVenue: place,
    });
    const resultB = await writeEvents(db, {
      metro,
      source,
      events: [b],
      blocklist: EMPTY_BLOCKLIST,
      placeVenue: place,
    });
    const writtenIds = [...resultA.eventIds, ...resultB.eventIds];
    await db.update(events).set({ venueId }).where(inArray(events.id, writtenIds));

    // Manually set loser to merged, keeper to active
    const rows = await db.select().from(events).where(inArray(events.id, writtenIds));
    const keeper = rows[0]!;
    const loser = rows[1]!;
    await db
      .update(events)
      .set({ status: "merged", mergedIntoId: keeper.id })
      .where(eq(events.id, loser.id));

    // Set keeper retired outright
    await db
      .update(events)
      .set({ status: "removed", mergedIntoId: null })
      .where(eq(events.id, keeper.id));

    // Write the loser's listing again
    const loserEvent = normalized(
      {
        title: "Trestle Inn Dance Party",
        local_date: "2026-09-30",
        dancing_time: "21:00",
        end_time: "02:00",
        venue: { name: "Test Venue" },
      },
      { venueLocation: { lat: 40.7, lng: -74.0 } },
    );
    const rewrite = await writeEvents(db, {
      metro,
      source,
      events: [loserEvent],
      blocklist: EMPTY_BLOCKLIST,
      placeVenue: place,
    });
    expect(rewrite.written).toBe(1);
    const after = await db.select().from(events).where(eq(events.id, loser.id));
    // Should stay merged
    expect(after[0]?.status).toBe("merged");
    expect(after[0]?.mergedIntoId).toBe(keeper.id);
  });
});
