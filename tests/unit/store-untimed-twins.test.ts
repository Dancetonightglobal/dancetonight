import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";

import type { HarvestedListing, Metro, Source } from "@/src/adapters/types";
import type { Db } from "@/src/db/client";
import { events, metros } from "@/src/db/schema";
import { rawListingSchema } from "@/src/domain/listing";
import { EMPTY_BLOCKLIST } from "@/src/pipeline/blocklist";
import { normalizeListing, type NormalizedEvent } from "@/src/pipeline/normalize";
import {
  loadMetro,
  resolveVenue,
  retireSameSourceTwins,
  upsertSource,
  writeEvents,
} from "@/src/pipeline/store";
import { closeTestDb, describeDb, requireDbInCi, resetDb, testDb } from "@/tests/unit/db-harness";

// D-593: a source's untimed listing stored twice under two keys (an earlier read keyed it under
// another id) stood twice on the site: La Deskomunal "ÚLTIMA VOLTA: ANESTESIA" 11-07 and Salsa
// Vida's "Social Club Academia Weekly Dance Classes" every night (daily check 2026-11-05).
// retireSameSourceTwins only looked at timed rows.

requireDbInCi();

const NOW = new Date("2026-11-05T16:00:00Z");
const METRO_ID = "11111111-1111-4111-8111-111111111111";

let db: Db;
let metro: Metro;
let source: Source;

function normalized(fields: Record<string, unknown>): NormalizedEvent {
  const harvested: HarvestedListing = {
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
  };
  const outcome = normalizeListing(harvested, { metro, source, now: NOW });
  if (!outcome.ok) throw new Error(outcome.reason);
  return outcome.event;
}

const place = (input: Parameters<typeof resolveVenue>[2]) => resolveVenue(db, metro, input);

async function write(event: NormalizedEvent, key: string): Promise<string> {
  const r = await writeEvents(db, {
    metro,
    source,
    events: [{ ...event, key }],
    blocklist: EMPTY_BLOCKLIST,
    placeVenue: place,
  });
  expect(r.written).toBe(1);
  return r.eventIds[0]!;
}

describeDb("retireSameSourceTwins, untimed rows (D-593)", () => {
  beforeAll(async () => {
    db = await testDb("store-untimed-twins");
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
      kind: "html",
      trustTier: "first_party",
      discoveredBy: "seed_list",
      styles: ["salsa"],
    });
  });

  it("retires the older untimed copy of one night and title stored under another key", async () => {
    const e = normalized({ title: "Social Club Weekly Dance Classes", local_date: "2026-11-07" });
    const oldId = await write(e, "old-id@2026-11-07");
    const newId = await write(e, "new-id@2026-11-07");

    const { retired, notes } = await retireSameSourceTwins(db, { source, writtenIds: [newId] });
    expect(retired).toBe(1);
    expect(notes).toEqual([
      "Social Club Weekly Dance Classes: listed twice by this source on 2026-11-07 with no time; the older copy was retired",
    ]);
    const rows = Object.fromEntries((await db.select().from(events)).map((r) => [r.id, r]));
    expect(rows[oldId]).toMatchObject({ status: "removed", mergedIntoId: newId });
    expect(rows[newId]).toMatchObject({ status: "active", mergedIntoId: null });
  });

  it("leaves two untimed rows the same read wrote (two listings in their own right)", async () => {
    const e = normalized({ title: "Social Club Weekly Dance Classes", local_date: "2026-11-07" });
    const a = await write(e, "a@2026-11-07");
    const b = await write(e, "b@2026-11-07");
    const { retired } = await retireSameSourceTwins(db, { source, writtenIds: [a, b] });
    expect(retired).toBe(0);
  });

  it("leaves an untimed row with another title or another night", async () => {
    const keep1 = await write(
      normalized({ title: "Bachata Sundays", local_date: "2026-11-07" }),
      "k1@2026-11-07",
    );
    const keep2 = await write(
      normalized({ title: "Social Club Weekly Dance Classes", local_date: "2026-11-08" }),
      "k2@2026-11-08",
    );
    const newId = await write(
      normalized({ title: "Social Club Weekly Dance Classes", local_date: "2026-11-07" }),
      "new@2026-11-07",
    );
    const { retired } = await retireSameSourceTwins(db, { source, writtenIds: [newId] });
    expect(retired).toBe(0);
    const rows = Object.fromEntries((await db.select().from(events)).map((r) => [r.id, r]));
    expect(rows[keep1]).toMatchObject({ status: "active" });
    expect(rows[keep2]).toMatchObject({ status: "active" });
  });

  it("leaves an untimed row at another venue (a seller's two TBA shows of one title)", async () => {
    const atA = normalized({
      title: "Comedy Salsa Night",
      local_date: "2026-11-07",
      venue: { name: "Club Alpha", address: "1 Alpha St, New York" },
    });
    const atB = normalized({
      title: "Comedy Salsa Night",
      local_date: "2026-11-07",
      venue: { name: "Club Beta", address: "99 Beta Ave, New York" },
    });
    const a = await write(atA, "tm-1@2026-11-07");
    const b = await write(atB, "tm-2@2026-11-07");
    const rowsBefore = Object.fromEntries((await db.select().from(events)).map((r) => [r.id, r]));
    // Only meaningful when the two were placed at two venues (or one placed, one not).
    if (rowsBefore[a]!.venueId === rowsBefore[b]!.venueId) return;
    const { retired } = await retireSameSourceTwins(db, { source, writtenIds: [b] });
    expect(retired).toBe(0);
  });

  it("does not retire an untimed row into a timed one (that is retireUntimedSiblings' job)", async () => {
    const untimedId = await write(
      normalized({ title: "Social Club Weekly Dance Classes", local_date: "2026-11-07" }),
      "u@2026-11-07",
    );
    const timedId = await write(
      normalized({
        title: "Social Club Weekly Dance Classes",
        local_date: "2026-11-07",
        dancing_time: "20:00",
      }),
      "t@2026-11-07",
    );
    await retireSameSourceTwins(db, { source, writtenIds: [timedId] });
    const rows = Object.fromEntries((await db.select().from(events)).map((r) => [r.id, r]));
    // Whatever else may retire it, this function's untimed rule needs both rows untimed.
    expect(rows[untimedId]!.mergedIntoId === timedId && rows[untimedId]!.status === "removed").toBe(
      false,
    );
  });
});
