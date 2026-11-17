import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";

import type { HarvestedListing, Metro, Source } from "@/src/adapters/types";
import type { Db } from "@/src/db/client";
import { events, metros } from "@/src/db/schema";
import { rawListingSchema } from "@/src/domain/listing";
import { EMPTY_BLOCKLIST } from "@/src/pipeline/blocklist";
import { normalizeListing, type NormalizedEvent } from "@/src/pipeline/normalize";
import { loadMetro, resolveVenue, upsertSource, writeEvents } from "@/src/pipeline/store";
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

describeDb("store untimed after timed, same event page (Mumbai pool party 11-08)", () => {
  beforeAll(async () => {
    db = await testDb("store_untimed_after");
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

  const write = (list: NormalizedEvent[]) =>
    writeEvents(db, {
      metro,
      source,
      events: list,
      blocklist: EMPTY_BLOCKLIST,
      placeVenue: (input) => resolveVenue(db, metro, input),
    });
  const PAGE = "https://list.example/e/pool-party/4100030869129810";
  const activeOfNight = async () =>
    (await db.select().from(events).where(eq(events.nightDate, "2026-09-25"))).filter(
      (r) => r.status === "active",
    );

  it("an untimed list row with its own id written after the timed row of the same event page does not stand", async () => {
    const timed = normalized(
      { title: "Pool Party", local_date: "2026-09-25", dancing_time: "21:00" },
      { eventUrl: PAGE },
    );
    const first = await write([timed]);
    const timedId = first.eventIds[0]!;

    const untimed = normalized(
      { title: "Pool Party", local_date: "2026-09-25" },
      { externalId: "ae-4110", eventUrl: PAGE },
    );
    await write([untimed]);

    const active = await activeOfNight();
    expect(active.map((r) => r.id)).toEqual([timedId]);
    expect(active[0]?.startsAt).not.toBeNull();
  });

  it("the same in one read, timed listing first", async () => {
    const timed = normalized(
      { title: "Pool Party", local_date: "2026-09-25", dancing_time: "21:00" },
      { eventUrl: PAGE },
    );
    const untimed = normalized(
      { title: "Pool Party", local_date: "2026-09-25" },
      { externalId: "ae-4110", eventUrl: PAGE },
    );
    await write([timed, untimed]);
    const active = await activeOfNight();
    expect(active).toHaveLength(1);
    expect(active[0]?.startsAt).not.toBeNull();
  });

  it("an untimed row with its own id and a different event page still stands", async () => {
    const timed = normalized(
      { title: "Pool Party", local_date: "2026-09-25", dancing_time: "21:00" },
      { eventUrl: PAGE },
    );
    await write([timed]);
    const untimed = normalized(
      { title: "Pool Party", local_date: "2026-09-25" },
      { externalId: "ae-4111", eventUrl: "https://list.example/e/other-party/1" },
    );
    await write([untimed]);
    expect(await activeOfNight()).toHaveLength(2);
  });
});
