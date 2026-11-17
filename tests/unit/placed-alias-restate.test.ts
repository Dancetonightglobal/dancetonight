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

describeDb("restate placed alias-named venues (D-761)", () => {
  beforeAll(async () => {
    db = await testDb("placed_alias_restate");
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

  const placeVenue = async (input: VenueInput) =>
    resolveVenue(db, metro, input, geocode, { checkPoint: false });
  const DOME = "Downstairs at The Dome";
  const DOME_ADDRESS = "178 Junction Road, London N19 5QQ";
  const AT = { lat: 51.5573334, lng: -0.1383779 };

  async function placedUnder(venueName: string, title = "Funky Mambo Tuesdays"): Promise<string> {
    const event = normalized(
      {
        title,
        local_date: "2026-10-30",
        doors_time: "20:00",
        venue: { name: venueName },
      },
      { venueLocation: AT },
    );
    await writeEvents(db, {
      metro,
      source,
      events: [event],
      blocklist: EMPTY_BLOCKLIST,
      placeVenue,
    });
    const [stored] = await db.select().from(events).where(eq(events.title, title));
    expect(stored?.venueId).not.toBeNull();
    return stored!.venueId!;
  }

  it("moves a row placed under a venue named exactly by a canonical alias to the canonical name", async () => {
    const oldVenueId = await placedUnder("Funky Mambo");
    const seen: (string | null)[] = [];
    const result = await restatePlacedStreetNamed(db, {
      metro,
      nights: ["2026-10-30"],
      streets: [],
      names: ["Funky Mambo", "Dirty Water Club London, 1996-2009"],
      placeVenue,
      restate: (row) => {
        seen.push(row.name);
        return { name: DOME, address: DOME_ADDRESS };
      },
    });
    expect(seen).toEqual(["Funky Mambo"]);
    expect(result.moved).toBe(1);
    expect(result.notes[0]).toContain("Funky Mambo Tuesdays on 2026-10-30");
    const [updated] = await db.select().from(events);
    expect(updated?.venueId).not.toBe(oldVenueId);
    const [venue] = await db.select().from(venues).where(eq(venues.id, updated!.venueId!));
    expect(venue?.name).toBe(DOME);
    // The stray record is left in place (no deletes); it simply has no rows now.
    const [stray] = await db.select().from(venues).where(eq(venues.id, oldVenueId));
    expect(stray?.name).toBe("Funky Mambo");
  });

  it("matches an alias case-insensitively and with surrounding spaces, and an alias holding a comma", async () => {
    await placedUnder("dirty water club london, 1996-2009 ");
    const result = await restatePlacedStreetNamed(db, {
      metro,
      nights: ["2026-10-30"],
      streets: [],
      names: ["Dirty Water Club London, 1996-2009"],
      placeVenue,
      restate: () => ({ name: DOME, address: DOME_ADDRESS }),
    });
    expect(result.moved).toBe(1);
  });

  it("never selects a venue whose name only contains an alias", async () => {
    await placedUnder("The Funky Mambo Club Annex");
    const seen: (string | null)[] = [];
    const result = await restatePlacedStreetNamed(db, {
      metro,
      nights: ["2026-10-30"],
      streets: [],
      names: ["Funky Mambo"],
      placeVenue,
      restate: (row) => {
        seen.push(row.name);
        return { name: DOME, address: DOME_ADDRESS };
      },
    });
    expect(seen).toEqual([]);
    expect(result.moved).toBe(0);
    expect(result.notes).toEqual([]);
  });

  it("does nothing with no streets and no names", async () => {
    await placedUnder("Funky Mambo");
    const result = await restatePlacedStreetNamed(db, {
      metro,
      nights: ["2026-10-30"],
      streets: [],
      names: [],
      placeVenue,
      restate: () => ({ name: DOME, address: DOME_ADDRESS }),
    });
    expect(result).toEqual({ moved: 0, notes: [] });
  });

  it("still moves street-named rows when names is omitted (D-221 unchanged)", async () => {
    await placedUnder("Between 51 & 53 Croftdown Road NW5 1EL", "Ecstatic Dance");
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
  });
});
