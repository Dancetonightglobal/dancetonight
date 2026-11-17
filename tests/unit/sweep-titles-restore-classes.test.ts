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

describeDb("sweep titles and restore merged classes", () => {
  beforeAll(async () => {
    db = await testDb("sweep-restore");
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
      url: "https://example.com/calendar",
      kind: "feed_ics",
      trustTier: "first_party",
      discoveredBy: "feed_ics",
    });
  });

  it("retires titles screened as not an event, regardless of source", async () => {
    // Write a normal event first
    // Rows stored before a screen existed: written under plain titles, then renamed.
    const write = async (s: typeof source, title: string, time: string) => {
      const result = await writeEvents(db, {
        metro,
        source: s,
        events: [normalized(s, { title, local_date: NIGHT, dancing_time: time })],
        blocklist: EMPTY_BLOCKLIST,
        placeVenue: place,
      });
      const id = result.eventIds[0];
      if (!id) throw new Error("nothing written");
      return id;
    };
    const rename = (id: string, title: string) =>
      db.update(events).set({ title }).where(eq(events.id, id));
    const statusOf = async (id: string) =>
      (await db.select({ status: events.status }).from(events).where(eq(events.id, id)))[0]?.status;

    const karaoke = await write(source, "Monday Night Thing", "21:00");
    await rename(karaoke, "Karaoke Mondays");
    const salsa = await write(source, "Salsa Monday", "20:00");
    // A copy merged into the karaoke row goes with it, not back to active.
    const copy = await write(source, "Monday Night Copy", "21:30");
    await mergeInto(db, karaoke, copy);
    // Another source's row: the sweep does not depend on who stored it.
    const otherSource = await upsertSource(db, metro.id, {
      url: "https://other.example/",
      kind: "html",
      trustTier: "first_party",
      discoveredBy: "seed_list",
    });
    const other = await write(otherSource, "Late Night Thing", "22:00");
    await rename(other, "Karaoke Night");

    const { retired, notes } = await retireScreenedTitles(db, { metro, nights: [NIGHT] });
    expect(retired).toBe(2);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain("Karaoke Mondays");
    expect(notes[0]).toContain("Karaoke Night");
    expect(await statusOf(karaoke)).toBe("removed");
    expect(await statusOf(other)).toBe("removed");
    expect(await statusOf(copy)).toBe("removed");
    expect(await statusOf(salsa)).toBe("active");
  });

  it("restores class-like listings merged by the old same-times rule", async () => {
    // Create a venue first
    const venue = await place({
      name: "Studio",
      address: null,
      url: null,
      location: { lat: 40.7, lng: -74.0 },
    });
    expect(venue).not.toBeNull();
    const venueId = venue!.venueId;

    // Two class-like events same night, same venue, same start/end
    const level1 = normalized(source, {
      title: "Swingiversity Level 1",
      local_date: NIGHT,
      dancing_time: "19:00",
      end_time: "20:00",
      venue: { name: "Studio" },
    });
    const level2 = normalized(source, {
      title: "Level 2 Choreo Class",
      local_date: NIGHT,
      dancing_time: "19:00",
      end_time: "20:00",
      venue: { name: "Studio" },
    });
    const result1 = await writeEvents(db, {
      metro,
      source,
      events: [level1],
      blocklist: EMPTY_BLOCKLIST,
      placeVenue: place,
    });
    const result2 = await writeEvents(db, {
      metro,
      source,
      events: [level2],
      blocklist: EMPTY_BLOCKLIST,
      placeVenue: place,
    });
    const level1Id = result1.eventIds[0]!;
    const level2Id = result2.eventIds[0]!;
    // Set venue ids (as the sibling test does)
    await db.update(events).set({ venueId }).where(eq(events.id, level1Id));
    await db.update(events).set({ venueId }).where(eq(events.id, level2Id));

    // Simulate the old merge: Level 1 removed into Level 2
    await db
      .update(events)
      .set({ status: "removed", mergedIntoId: level2Id })
      .where(eq(events.id, level1Id));

    const { restored, notes } = await restoreMergedClasses(db, { metro, nights: [NIGHT] });
    expect(restored).toBe(1);
    expect(notes[0]).toContain("Swingiversity Level 1");
    const rows = await db.select().from(events);
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(byId[level1Id]?.status).toBe("active");
    expect(byId[level1Id]?.mergedIntoId).toBeNull();
    expect(byId[level2Id]?.status).toBe("active");
  });

  it("does not restore non-class pairs", async () => {
    const venue = await place({
      name: "Bar",
      address: null,
      url: null,
      location: { lat: 40.7, lng: -74.0 },
    });
    const venueId = venue!.venueId;
    const party1 = normalized(source, {
      title: "Sabado de Parranda",
      local_date: NIGHT,
      dancing_time: "17:00",
      end_time: "04:00",
      venue: { name: "Bar" },
    });
    const party2 = normalized(source, {
      title: "Salsa Sundays Party",
      local_date: NIGHT,
      dancing_time: "17:00",
      end_time: "04:00",
      venue: { name: "Bar" },
    });
    const r1 = await writeEvents(db, {
      metro,
      source,
      events: [party1],
      blocklist: EMPTY_BLOCKLIST,
      placeVenue: place,
    });
    const r2 = await writeEvents(db, {
      metro,
      source,
      events: [party2],
      blocklist: EMPTY_BLOCKLIST,
      placeVenue: place,
    });
    const id1 = r1.eventIds[0]!;
    const id2 = r2.eventIds[0]!;
    await db.update(events).set({ venueId }).where(eq(events.id, id1));
    await db.update(events).set({ venueId }).where(eq(events.id, id2));
    await db.update(events).set({ status: "removed", mergedIntoId: id2 }).where(eq(events.id, id1));

    const { restored } = await restoreMergedClasses(db, { metro, nights: [NIGHT] });
    expect(restored).toBe(0);
    const rows = await db.select().from(events);
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(byId[id1]?.status).toBe("removed");
  });

  it("does not restore same-title time slots (case 2)", async () => {
    const venue = await place({
      name: "Haunted Mansion",
      address: null,
      url: null,
      location: { lat: 40.7, lng: -74.0 },
    });
    const venueId = venue!.venueId;
    const slot1 = normalized(source, {
      title: "Mansion BK - Salsa Night Time Slot",
      local_date: NIGHT,
      dancing_time: "18:00",
      end_time: "19:00",
      venue: { name: "Haunted Mansion" },
    });
    const slot2 = normalized(source, {
      title: "Mansion BK - Salsa Night Time Slot",
      local_date: NIGHT,
      dancing_time: "19:00",
      end_time: "20:00",
      venue: { name: "Haunted Mansion" },
    });
    const r1 = await writeEvents(db, {
      metro,
      source,
      events: [slot1],
      blocklist: EMPTY_BLOCKLIST,
      placeVenue: place,
    });
    const r2 = await writeEvents(db, {
      metro,
      source,
      events: [slot2],
      blocklist: EMPTY_BLOCKLIST,
      placeVenue: place,
    });
    const id1 = r1.eventIds[0]!;
    const id2 = r2.eventIds[0]!;
    await db.update(events).set({ venueId }).where(eq(events.id, id1));
    await db.update(events).set({ venueId }).where(eq(events.id, id2));
    await db.update(events).set({ status: "removed", mergedIntoId: id2 }).where(eq(events.id, id1));

    const { restored } = await restoreMergedClasses(db, { metro, nights: [NIGHT] });
    expect(restored).toBe(0);
    const rows = await db.select().from(events);
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(byId[id1]?.status).toBe("removed");
  });
});
