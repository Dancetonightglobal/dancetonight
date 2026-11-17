import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";

import type { HarvestedListing, Metro, Source } from "@/src/adapters/types";
import type { Db } from "@/src/db/client";
import { events, metros } from "@/src/db/schema";
import { rawListingSchema } from "@/src/domain/listing";
import { EMPTY_BLOCKLIST } from "@/src/pipeline/blocklist";
import { normalizeListing, type NormalizedEvent } from "@/src/pipeline/normalize";
import {
  loadMetro,
  pipelineId,
  resolveVenue,
  upsertSource,
  writeEvents,
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
      provenance: { sourceUrl: "https://list.example/parties", fetchedAt: NOW, method: "feed" },
      ...extra,
    },
    { metro, source, now: NOW },
  );
  if (!outcome.ok) throw new Error(outcome.reason);
  return outcome.event;
}

describeDb("store untimed event url", () => {
  beforeAll(async () => {
    db = await testDb("store_untimed_url");
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
      url: "https://list.example/parties",
      kind: "jsonld",
      trustTier: "first_party",
      discoveredBy: "seed_list",
    });
  });

  const write = (list: NormalizedEvent[], from: Source = source) =>
    writeEvents(db, {
      metro,
      source: from,
      events: list,
      blocklist: EMPTY_BLOCKLIST,
      placeVenue: (input) => resolveVenue(db, metro, input),
    });

  const PAGE = "https://list.example/e/almost-human/4100030869129809";

  it("retires untimed list row when timed row has same eventUrl", async () => {
    // untimed list row first
    const untimed = normalized(
      { title: "Almost Human", local_date: "2026-09-25" },
      { externalId: "ae-4100", eventUrl: PAGE },
    );
    const result1 = await write([untimed]);
    expect(result1.written).toBe(1);
    const untimedId = pipelineId("event", `${source.id}:ae-4100`);
    const untimedRow = await db.select().from(events).where(eq(events.id, untimedId));
    expect(untimedRow[0]?.status).toBe("active");

    // timed row from same source, same eventUrl
    const timed = normalized(
      { title: "Almost Human", local_date: "2026-09-25", dancing_time: "21:00" },
      { eventUrl: PAGE },
    );
    const result2 = await write([timed]);
    expect(result2.superseded).toBe(1);
    const timedId = result2.eventIds[0]!;
    const mergedRow = await db.select().from(events).where(eq(events.id, untimedId));
    expect(mergedRow[0]?.status).toBe("merged");
    expect(mergedRow[0]?.mergedIntoId).toBe(timedId);
    const timedRow = await db.select().from(events).where(eq(events.id, timedId));
    expect(timedRow[0]?.status).toBe("active");
  });

  it("does not retire untimed row when timed row has different eventUrl", async () => {
    const untimed = normalized(
      { title: "Almost Human", local_date: "2026-09-25" },
      { externalId: "ae-4100", eventUrl: PAGE },
    );
    await write([untimed]);
    const untimedId = pipelineId("event", `${source.id}:ae-4100`);

    const timed = normalized(
      { title: "Almost Human", local_date: "2026-09-25", dancing_time: "21:00" },
      { eventUrl: "https://list.example/e/other" },
    );
    const result = await write([timed]);
    expect(result.superseded).toBe(0);
    const row = await db.select().from(events).where(eq(events.id, untimedId));
    expect(row[0]?.status).toBe("active");
  });

  it("does not retire untimed row when timed row has no eventUrl", async () => {
    const untimed = normalized(
      { title: "Almost Human", local_date: "2026-09-25" },
      { externalId: "ae-4100", eventUrl: PAGE },
    );
    await write([untimed]);
    const untimedId = pipelineId("event", `${source.id}:ae-4100`);

    const timed = normalized(
      { title: "Almost Human", local_date: "2026-09-25", dancing_time: "21:00" },
      { eventUrl: null },
    );
    const result = await write([timed]);
    expect(result.superseded).toBe(0);
    const row = await db.select().from(events).where(eq(events.id, untimedId));
    expect(row[0]?.status).toBe("active");
  });

  it("does not retire untimed row from another source even with same eventUrl", async () => {
    const untimed = normalized(
      { title: "Almost Human", local_date: "2026-09-25" },
      { externalId: "ae-4100", eventUrl: PAGE },
    );
    await write([untimed]);
    const untimedId = pipelineId("event", `${source.id}:ae-4100`);

    const source2 = await upsertSource(db, metro.id, {
      url: "https://list.example/other",
      kind: "jsonld",
      trustTier: "first_party",
      discoveredBy: "seed_list",
    });
    const timed = normalized(
      { title: "Almost Human", local_date: "2026-09-25", dancing_time: "21:00" },
      { eventUrl: PAGE },
    );
    const result = await write([timed], source2);
    expect(result.superseded).toBe(0);
    const row = await db.select().from(events).where(eq(events.id, untimedId));
    expect(row[0]?.status).toBe("active");
  });

  it("does not retire untimed row when timed row is on a different night", async () => {
    const untimed = normalized(
      { title: "Almost Human", local_date: "2026-09-25" },
      { externalId: "ae-4100", eventUrl: PAGE },
    );
    await write([untimed]);
    const untimedId = pipelineId("event", `${source.id}:ae-4100`);

    const timed = normalized(
      { title: "Almost Human", local_date: "2026-09-26", dancing_time: "21:00" },
      { eventUrl: PAGE },
    );
    const result = await write([timed]);
    expect(result.superseded).toBe(0);
    const row = await db.select().from(events).where(eq(events.id, untimedId));
    expect(row[0]?.status).toBe("active");
  });

  it("does not retire a timed row when another timed row is written", async () => {
    // first timed row
    const timed1 = normalized(
      { title: "Almost Human", local_date: "2026-09-25", dancing_time: "19:00" },
      { externalId: "ae-4101", eventUrl: PAGE },
    );
    await write([timed1]);
    const timed1Id = pipelineId("event", `${source.id}:ae-4101`);

    // second timed row, same night, same eventUrl, different time
    const timed2 = normalized(
      { title: "Almost Human", local_date: "2026-09-25", dancing_time: "21:00" },
      { eventUrl: PAGE },
    );
    const result = await write([timed2]);
    expect(result.superseded).toBe(0);
    const row = await db.select().from(events).where(eq(events.id, timed1Id));
    expect(row[0]?.status).toBe("active");
  });
});
