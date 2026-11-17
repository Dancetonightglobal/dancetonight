import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";

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
  retireRowsOfRetiredSource,
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

async function organizer(id: string): Promise<Source> {
  return upsertSource(db, metro.id, {
    url: `https://www.eventbrite.com/o/${id}`,
    kind: "feed_ics",
    trustTier: "first_party",
    discoveredBy: "seed_list",
  });
}

async function writeOne(source: Source, title: string): Promise<string> {
  const written = await writeEvents(db, {
    metro,
    source,
    events: [normalized(source, { title, local_date: NIGHT, dancing_time: "21:00" })],
    blocklist: EMPTY_BLOCKLIST,
    placeVenue: place,
  });
  const id = written.eventIds[0];
  if (!id) throw new Error("nothing written");
  return id;
}

async function statusOf(id: string) {
  const [row] = await db
    .select({ status: events.status, mergedIntoId: events.mergedIntoId })
    .from(events)
    .where(eq(events.id, id));
  return row;
}

describeDb("retireRowsOfRetiredSource, against Postgres with PostGIS", () => {
  beforeAll(async () => {
    db = await testDb("retire-retired");
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
  });

  it("retires a retired source's merged row, so retiring its survivor later cannot release it", async () => {
    // Ritmos / Boat Parties, 2026-10-18: B's row was merged into A's; both sources retired.
    const a = await organizer("111");
    const b = await organizer("222");
    const rowA = await writeOne(a, "Ritmos: Sabado de Parranda");
    const rowB = await writeOne(b, "Sabado de Parranda at Ritmos");
    await mergeInto(db, rowA, rowB);

    const first = await retireRowsOfRetiredSource(db, { source: b, nights: [NIGHT] });
    // A merged row was never on the site on its own: not counted, not named.
    expect(first).toEqual({ retired: 0, notes: [] });
    expect(await statusOf(rowB)).toEqual({ status: "removed", mergedIntoId: null });

    const second = await retireRowsOfRetiredSource(db, { source: a, nights: [NIGHT] });
    expect(second.retired).toBe(1);
    expect(await statusOf(rowA)).toEqual({ status: "removed", mergedIntoId: null });
    expect((await statusOf(rowB))?.status).toBe("removed");
  });

  it("retires and names a live row of a retired source", async () => {
    const a = await organizer("333");
    const row = await writeOne(a, "Salsa Saturday");
    const { retired, notes } = await retireRowsOfRetiredSource(db, { source: a, nights: [NIGHT] });
    expect(retired).toBe(1);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain(`Salsa Saturday on ${NIGHT}`);
    expect((await statusOf(row))?.status).toBe("removed");
  });
});
