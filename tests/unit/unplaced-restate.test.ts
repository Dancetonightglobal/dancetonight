// Unplaced rows get the same source and known-venue fixes as a fresh write.
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";

import type { HarvestedListing, Metro, Source } from "@/src/adapters/types";
import type { Db } from "@/src/db/client";
import { events, metros } from "@/src/db/schema";
import { rawListingSchema } from "@/src/domain/listing";
import { EMPTY_BLOCKLIST } from "@/src/pipeline/blocklist";
import { normalizeListing, type NormalizedEvent } from "@/src/pipeline/normalize";
import {
  loadMetro,
  placeUnplaced,
  resolveVenue,
  upsertSource,
  writeEvents,
  type VenueInput,
} from "@/src/pipeline/store";
import { closeTestDb, describeDb, resetDb, testDb } from "@/tests/unit/db-harness";

const NOW = new Date("2026-09-29T16:00:00Z");
const ADDRESS = "37 W 26th St, 2nd floor, NYC";
const BUILDING = { lat: 40.744505, lng: -73.9904434 };
let db: Db;
let metro: Metro;
let source: Source;
let asked: string[] = [];
const geocode = async (address: string) => {
  asked.push(address);
  return address === ADDRESS ? BUILDING : null;
};
const place = (input: VenueInput, apiPoint = false) =>
  resolveVenue(db, metro, input, geocode, { checkPoint: apiPoint });

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

describeDb("unplaced rows get restated venue fixes", () => {
  beforeAll(async () => {
    db = await testDb("unplaced_restate");
  });
  afterAll(closeTestDb);
  beforeEach(async () => {
    await resetDb();
    asked = [];
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
    source = await upsertSource(db, metro.id, {
      url: "https://example.com/",
      kind: "html",
      trustTier: "first_party",
      discoveredBy: "seed_list",
    });
  });

  it("places a stored unplaced row when restate provides a valid address", async () => {
    // Write an event with a venue name only, no address, and placeVenue returns null -> unplaced
    const event = normalized({
      title: "Test Event",
      local_date: "2026-10-01",
      doors_time: "20:00",
      venue: { name: "Main Space" },
    });
    await writeEvents(db, {
      metro,
      source,
      events: [event],
      blocklist: EMPTY_BLOCKLIST,
      placeVenue: async () => null,
    });
    const [stored] = await db.select().from(events);
    expect(stored?.venueId).toBeNull();

    // Now placeUnplaced with a restate that gives a valid address
    const healed = await placeUnplaced(db, {
      metro,
      nights: ["2026-10-01"],
      placeVenue: place,
      restate: () => ({ name: "Studio", address: ADDRESS }),
    });
    expect(healed.placed).toBe(1);
    const [updated] = await db.select().from(events);
    expect(updated?.venueId).not.toBeNull();
    expect(updated?.geo).toEqual(BUILDING);
  });

  it("leaves row unplaced without restate (no address)", async () => {
    const event = normalized({
      title: "Test Event",
      local_date: "2026-10-01",
      doors_time: "20:00",
      venue: { name: "Main Space" },
    });
    await writeEvents(db, {
      metro,
      source,
      events: [event],
      blocklist: EMPTY_BLOCKLIST,
      placeVenue: async () => null,
    });
    const healed = await placeUnplaced(db, {
      metro,
      nights: ["2026-10-01"],
      placeVenue: place,
      // no restate
    });
    expect(healed.placed).toBe(0);
    const [stored] = await db.select().from(events);
    expect(stored?.venueId).toBeNull();
  });
});
