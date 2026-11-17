import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";

import type { HarvestedListing, Metro, Source } from "@/src/adapters/types";
import type { Db } from "@/src/db/client";
import { events, metros, venues } from "@/src/db/schema";
import { rawListingSchema } from "@/src/domain/listing";
import { EMPTY_BLOCKLIST } from "@/src/pipeline/blocklist";
import { normalizeListing, type NormalizedEvent } from "@/src/pipeline/normalize";
import {
  loadMetro,
  resolveVenue,
  upsertSource,
  writeEvents,
  type VenueInput,
} from "@/src/pipeline/store";
import { restatePlacedStreetNamed } from "@/src/pipeline/restate-placed";
import { closeTestDb, describeDb, resetDb, testDb } from "@/tests/unit/db-harness";

const NOW = new Date("2026-10-28T16:00:00Z");
let db: Db;
let metro: Metro;
let source: Source;
const geocode = async () => null;

function normalized(
  fields: Record<string, unknown>,
  extra: Partial<HarvestedListing> = {},
  from: Source = source,
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
      provenance: { sourceUrl: "https://example.com/", fetchedAt: NOW, method: "llm" },
      ...extra,
    },
    { metro, source: from, now: NOW },
  );
  if (!outcome.ok) throw new Error(outcome.reason);
  return outcome.event;
}

describeDb("restate placed street-named venues", () => {
  beforeAll(async () => {
    db = await testDb("placed_street_restate");
  });
  afterAll(closeTestDb);
  beforeEach(async () => {
    await resetDb();
    await db.insert(metros).values({
      slug: "london",
      name: "London",
      countryCode: "GB",
      center: { lat: 51.5072, lng: -0.1276 },
      radiusKm: 40,
      tz: "Europe/London",
      languages: ["en"],
      status: "active",
    });
    metro = (await loadMetro(db, "london"))!;
    source = await upsertSource(db, metro.id, {
      url: "https://example.com/feed.ics",
      kind: "feed_ics",
      trustTier: "first_party",
      discoveredBy: "seed_list",
    });
  });

  it("moves a placed listing whose venue name contains a known street phrase", async () => {
    const placeVenue = async (input: VenueInput) =>
      resolveVenue(db, metro, input, geocode, { checkPoint: false });
    // Write an event with a venue name that includes "Croftdown Road"
    const event = normalized(
      {
        title: "Ecstatic Dance",
        local_date: "2026-10-30",
        doors_time: "19:00",
        venue: {
          name: "13 Minutes from Gospel Oak Station, Between 51 & 53 Croftdown Road NW5 1EL",
        },
      },
      { venueLocation: { lat: 51.5607, lng: -0.1449 } },
    );
    await writeEvents(db, {
      metro,
      source,
      events: [event],
      blocklist: EMPTY_BLOCKLIST,
      placeVenue,
    });
    const [stored] = await db.select().from(events);
    expect(stored?.venueId).not.toBeNull();
    const oldVenueId = stored!.venueId!;
    const [oldVenue] = await db.select().from(venues).where(eq(venues.id, oldVenueId));
    expect(oldVenue?.name).toBe(
      "13 Minutes from Gospel Oak Station, Between 51 & 53 Croftdown Road NW5 1EL",
    );

    const result = await restatePlacedStreetNamed(db, {
      metro,
      nights: ["2026-10-30"],
      streets: ["Croftdown Road"],
      placeVenue,
      restate: () => ({
        name: "Ecstatic Dance London, Croftdown Road",
        address: "53 Croftdown Road, London NW5 1HE",
      }),
    });
    expect(result.moved).toBe(1);
    expect(result.notes).toHaveLength(1);
    expect(result.notes[0]).toContain("Ecstatic Dance on 2026-10-30");

    const [updated] = await db.select().from(events);
    expect(updated?.venueId).not.toBeNull();
    expect(updated?.venueId).not.toBe(oldVenueId);
    const [newVenue] = await db.select().from(venues).where(eq(venues.id, updated!.venueId!));
    expect(newVenue?.name).toBe("Ecstatic Dance London, Croftdown Road");
    // Old venue still exists
    const [stillOld] = await db.select().from(venues).where(eq(venues.id, oldVenueId));
    expect(stillOld).toBeDefined();
  });

  it("leaves it when restate changes nothing", async () => {
    const placeVenue = async (input: VenueInput) =>
      resolveVenue(db, metro, input, geocode, { checkPoint: false });
    const event = normalized(
      {
        title: "Ecstatic Dance",
        local_date: "2026-10-30",
        doors_time: "19:00",
        venue: {
          name: "13 Minutes from Gospel Oak Station, Between 51 & 53 Croftdown Road NW5 1EL",
        },
      },
      { venueLocation: { lat: 51.5607, lng: -0.1449 } },
    );
    await writeEvents(db, {
      metro,
      source,
      events: [event],
      blocklist: EMPTY_BLOCKLIST,
      placeVenue,
    });
    const [stored] = await db.select().from(events);
    const oldVenueId = stored!.venueId!;

    const result = await restatePlacedStreetNamed(db, {
      metro,
      nights: ["2026-10-30"],
      streets: ["Croftdown Road"],
      placeVenue,
      restate: (row) => ({
        name: row.name,
        address: row.address,
      }),
    });
    expect(result.moved).toBe(0);
    expect(result.notes).toHaveLength(0);
    const [unchanged] = await db.select().from(events);
    expect(unchanged?.venueId).toBe(oldVenueId);
  });

  it("does no query work when streets is empty", async () => {
    const placeVenue = async (input: VenueInput) =>
      resolveVenue(db, metro, input, geocode, { checkPoint: false });
    const event = normalized(
      {
        title: "Ecstatic Dance",
        local_date: "2026-10-30",
        doors_time: "19:00",
        venue: {
          name: "13 Minutes from Gospel Oak Station, Between 51 & 53 Croftdown Road NW5 1EL",
        },
      },
      { venueLocation: { lat: 51.5607, lng: -0.1449 } },
    );
    await writeEvents(db, {
      metro,
      source,
      events: [event],
      blocklist: EMPTY_BLOCKLIST,
      placeVenue,
    });
    const [stored] = await db.select().from(events);
    const oldVenueId = stored!.venueId!;

    const result = await restatePlacedStreetNamed(db, {
      metro,
      nights: ["2026-10-30"],
      streets: [],
      placeVenue,
      restate: () => ({
        name: "Ecstatic Dance London, Croftdown Road",
        address: "53 Croftdown Road, London NW5 1HE",
      }),
    });
    expect(result.moved).toBe(0);
    expect(result.notes).toHaveLength(0);
    const [unchanged] = await db.select().from(events);
    expect(unchanged?.venueId).toBe(oldVenueId);
  });

  it("leaves a venue whose name has no street phrase", async () => {
    const placeVenue = async (input: VenueInput) =>
      resolveVenue(db, metro, input, geocode, { checkPoint: false });
    // First event with street phrase
    const event1 = normalized(
      {
        title: "Ecstatic Dance",
        local_date: "2026-10-30",
        doors_time: "19:00",
        venue: {
          name: "13 Minutes from Gospel Oak Station, Between 51 & 53 Croftdown Road NW5 1EL",
        },
      },
      { venueLocation: { lat: 51.5607, lng: -0.1449 } },
    );
    // Second event without street phrase
    const event2 = normalized(
      {
        title: "Other night",
        local_date: "2026-10-30",
        doors_time: "20:00",
        venue: { name: "Village Hall" },
      },
      { venueLocation: { lat: 51.5, lng: -0.1 } },
    );
    await writeEvents(db, {
      metro,
      source,
      events: [event1, event2],
      blocklist: EMPTY_BLOCKLIST,
      placeVenue,
    });
    const storedRows = await db.select().from(events).orderBy(events.title);
    const oldIds = storedRows.map((r) => r.venueId!);
    expect(oldIds[0]).not.toBe(oldIds[1]);

    const result = await restatePlacedStreetNamed(db, {
      metro,
      nights: ["2026-10-30"],
      streets: ["Croftdown Road"],
      placeVenue,
      restate: (row) => {
        // For any row, return the known venue (simulating a restate that would apply to all)
        if (row.name?.includes("Croftdown")) {
          return {
            name: "Ecstatic Dance London, Croftdown Road",
            address: "53 Croftdown Road, London NW5 1HE",
          };
        }
        return { name: row.name, address: row.address };
      },
    });
    expect(result.moved).toBe(1);
    const updatedRows = await db.select().from(events).orderBy(events.title);
    // First event moved
    expect(updatedRows[0]?.venueId).not.toBe(oldIds[0]);
    // Second event unchanged
    expect(updatedRows[1]?.venueId).toBe(oldIds[1]);
  });

  it("leaves a night not in nights", async () => {
    const placeVenue = async (input: VenueInput) =>
      resolveVenue(db, metro, input, geocode, { checkPoint: false });
    const event = normalized(
      {
        title: "Ecstatic Dance",
        local_date: "2026-10-30",
        doors_time: "19:00",
        venue: {
          name: "13 Minutes from Gospel Oak Station, Between 51 & 53 Croftdown Road NW5 1EL",
        },
      },
      { venueLocation: { lat: 51.5607, lng: -0.1449 } },
    );
    await writeEvents(db, {
      metro,
      source,
      events: [event],
      blocklist: EMPTY_BLOCKLIST,
      placeVenue,
    });
    const [stored] = await db.select().from(events);
    const oldVenueId = stored!.venueId!;

    const result = await restatePlacedStreetNamed(db, {
      metro,
      nights: ["2026-10-31"], // different night
      streets: ["Croftdown Road"],
      placeVenue,
      restate: () => ({
        name: "Ecstatic Dance London, Croftdown Road",
        address: "53 Croftdown Road, London NW5 1HE",
      }),
    });
    expect(result.moved).toBe(0);
    expect(result.notes).toHaveLength(0);
    const [unchanged] = await db.select().from(events);
    expect(unchanged?.venueId).toBe(oldVenueId);
  });
});
