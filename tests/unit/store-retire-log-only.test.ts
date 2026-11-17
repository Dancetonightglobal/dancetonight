import { inArray } from "drizzle-orm";
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
  retireUnlisted,
  resolveVenue,
} from "@/src/pipeline/store";
import { closeTestDb, describeDb, requireDbInCi, resetDb, testDb } from "@/tests/unit/db-harness";

// D-880: a schema.org events page read whole is on trial: the ingest notes the rows it would
// retire (logOnly) and changes none of them.

requireDbInCi();

const NOW = new Date("2026-09-23T16:00:00Z");
const METRO_ID = "11111111-1111-4111-8111-111111111111";

let db: Db;
let metro: Metro;
let source: Source;

function normalized(title: string, night: string): NormalizedEvent {
  const outcome = normalizeListing(
    {
      listing: rawListingSchema.parse({
        listing_type: "social",
        styles: [],
        venue: { name: "Club" },
        organizer: {},
        title,
        local_date: night,
        dancing_time: "21:00",
      }),
      externalId: null,
      tz: null,
      venueLocation: { lat: 40.7, lng: -74.0 },
      recurrence: null,
      provenance: { sourceUrl: "https://club.example/events", fetchedAt: NOW, method: "jsonld" },
    } satisfies HarvestedListing,
    { metro, source, now: NOW },
  );
  if (!outcome.ok) throw new Error(outcome.reason);
  return outcome.event;
}

const place = (input: Parameters<typeof resolveVenue>[2]) => resolveVenue(db, metro, input);

describeDb("store-retire-log-only", () => {
  beforeAll(async () => {
    db = await testDb("store-retire-log-only");
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
      url: "https://club.example/events",
      kind: "jsonld",
      trustTier: "first_party",
      discoveredBy: "jsonld",
      styles: ["salsa"],
    });
  });

  async function write(title: string, night: string): Promise<string> {
    const result = await writeEvents(db, {
      metro,
      source,
      events: [normalized(title, night)],
      blocklist: EMPTY_BLOCKLIST,
      placeVenue: place,
    });
    return result.eventIds[0]!;
  }

  it("notes the unlisted rows it would retire and leaves every row as it was", async () => {
    const listed = await write("Salsa Social", "2026-09-25");
    const gone = await write("Old Bachata Night", "2026-09-26");
    const result = await retireUnlisted(db, {
      source,
      listedIds: [listed],
      nights: ["2026-09-24", "2026-09-25", "2026-09-26"],
      logOnly: true,
    });
    expect(result.retired).toBe(0);
    expect(result.notes).toEqual([
      "log only (D-880): 1 stored listing(s) this page no longer lists would be retired: Old Bachata Night on 2026-09-26",
    ]);
    const rows = await db
      .select({ id: events.id, status: events.status })
      .from(events)
      .where(inArray(events.id, [listed, gone]));
    expect(rows.map((r) => r.status).sort()).toEqual(["active", "active"]);
  });

  it("notes nothing when the read lists every stored row", async () => {
    const listed = await write("Salsa Social", "2026-09-25");
    const result = await retireUnlisted(db, {
      source,
      listedIds: [listed],
      nights: ["2026-09-25"],
      logOnly: true,
    });
    expect(result).toEqual({ retired: 0, notes: [] });
  });

  it("without logOnly the same read retires the unlisted row", async () => {
    const listed = await write("Salsa Social", "2026-09-25");
    const gone = await write("Old Bachata Night", "2026-09-26");
    const result = await retireUnlisted(db, {
      source,
      listedIds: [listed],
      nights: ["2026-09-25", "2026-09-26"],
    });
    expect(result.retired).toBe(1);
    const [row] = await db
      .select({ status: events.status })
      .from(events)
      .where(inArray(events.id, [gone]));
    expect(row!.status).toBe("removed");
  });
});
