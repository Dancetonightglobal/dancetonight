import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";

import type { HarvestedListing, Metro, Source } from "@/src/adapters/types";
import type { Db } from "@/src/db/client";
import { events, metros } from "@/src/db/schema";
import { rawListingSchema } from "@/src/domain/listing";
import { EMPTY_BLOCKLIST } from "@/src/pipeline/blocklist";
import { normalizeListing, type NormalizedEvent } from "@/src/pipeline/normalize";
import { retirePageTwins } from "@/src/pipeline/page-twins";
import { loadMetro, resolveVenue, upsertSource, writeEvents } from "@/src/pipeline/store";
import { closeTestDb, describeDb, requireDbInCi, resetDb, testDb } from "@/tests/unit/db-harness";

// D-742: allevents Mumbai "Weekend In House Pool Party" 11-08 stood twice: a timed row (947c60) and an
// untimed one (96bd4e) of one source, one event page, one night, title and venue. The event fell off the
// ranked pages, so no read wrote either row and D-593's twin pass (written rows only) never ran.
// Prod 11-05: it was the only same-source untimed/timed pair sharing an event page that is not the
// source's own URL; 56 pairs sharing the source's own URL (a listing page) were different listings.

requireDbInCi();

const NOW = new Date("2026-11-05T16:00:00Z");
const METRO_ID = "11111111-1111-4111-8111-111111111111";
const SOURCE_URL = "https://allevents.example/mumbai/parties?page=4";
const PAGE = "https://allevents.example/mumbai/weekend-in-house-pool-party";

let db: Db;
let metro: Metro;
let source: Source;
let other: Source;

function normalized(fields: Record<string, unknown>, eventUrl: string | null): NormalizedEvent {
  const harvested: HarvestedListing = {
    listing: rawListingSchema.parse({
      listing_type: "social",
      styles: [],
      venue: { name: "Hotel Sea Breeze", address: "AB Nair Road, Juhu" },
      organizer: {},
      ...fields,
    }),
    externalId: null,
    tz: null,
    venueLocation: { lat: 19.1, lng: 72.83 },
    recurrence: null,
    eventUrl,
    provenance: { sourceUrl: SOURCE_URL, fetchedAt: NOW, method: "feed" },
  };
  const outcome = normalizeListing(harvested, { metro, source, now: NOW });
  if (!outcome.ok) throw new Error(outcome.reason);
  return outcome.event;
}

const place = (input: Parameters<typeof resolveVenue>[2]) => resolveVenue(db, metro, input);

async function write(by: Source, event: NormalizedEvent, key: string): Promise<string> {
  const r = await writeEvents(db, {
    metro,
    source: by,
    events: [{ ...event, key }],
    blocklist: EMPTY_BLOCKLIST,
    placeVenue: place,
  });
  expect(r.written).toBe(1);
  return r.eventIds[0]!;
}

/**
 * Stores an untimed twin as prod holds it: writeEvents gives way to a same-title timed row at write
 * time, so the twin is written under a stand-in title and then given the timed row's title.
 */
async function writeTwin(by: Source, event: NormalizedEvent, key: string): Promise<string> {
  const id = await write(
    by,
    {
      ...event,
      title: `${event.title} stand-in`,
      titleNormalized: `${event.titleNormalized} stand in`,
    },
    key,
  );
  await db
    .update(events)
    .set({ title: event.title, titleNormalized: event.titleNormalized })
    .where(eq(events.id, id));
  return id;
}

const POOL = "Weekend In House Pool Party, Belly Dance";
const timed = (url: string | null = PAGE, title = POOL, night = "2026-11-08") =>
  normalized({ title, local_date: night, dancing_time: "18:30" }, url);
const untimed = (url: string | null = PAGE, title = POOL, night = "2026-11-08") =>
  normalized({ title, local_date: night }, url);

async function statuses(): Promise<
  Record<string, { status: string; mergedIntoId: string | null }>
> {
  return Object.fromEntries(
    (await db.select().from(events)).map((r) => [
      r.id,
      { status: r.status, mergedIntoId: r.mergedIntoId },
    ]),
  );
}

const NIGHTS = ["2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08", "2026-11-09"];

describeDb("retirePageTwins (D-742)", () => {
  beforeAll(async () => {
    db = await testDb("page-twins");
  });
  afterAll(closeTestDb);

  beforeEach(async () => {
    await resetDb();
    await db.insert(metros).values({
      id: METRO_ID,
      slug: "mumbai",
      name: "Mumbai",
      countryCode: "IN",
      center: { lat: 19.076, lng: 72.8777 },
      radiusKm: 40,
      tz: "Asia/Kolkata",
      languages: ["en"],
      status: "active",
    });
    metro = (await loadMetro(db, "mumbai"))!;
    source = await upsertSource(db, metro.id, {
      url: SOURCE_URL,
      kind: "html",
      trustTier: "directory",
      discoveredBy: "seed_list",
      styles: [],
    });
    other = await upsertSource(db, metro.id, {
      url: "https://other.example/mumbai",
      kind: "html",
      trustTier: "directory",
      discoveredBy: "seed_list",
      styles: [],
    });
  });

  it("retires a source's untimed row into its timed row of the same event page and night", async () => {
    const t = await write(source, timed(), "pool@2026-11-08T18:30");
    const u = await writeTwin(source, untimed(), "pool@2026-11-08");
    const { retired, notes } = await retirePageTwins(db, { metro, nights: NIGHTS });
    expect(retired).toBe(1);
    expect(notes).toEqual([
      `${POOL}: listed by this source on 2026-11-08 with and without a time on one event page; the untimed copy was retired`,
    ]);
    const s = await statuses();
    expect(s[u]).toEqual({ status: "removed", mergedIntoId: t });
    expect(s[t]).toEqual({ status: "active", mergedIntoId: null });
    // A second pass finds nothing more.
    expect((await retirePageTwins(db, { metro, nights: NIGHTS })).retired).toBe(0);
  });

  it("never pairs rows whose shared URL is the source's own page (a listing page)", async () => {
    await write(source, timed(SOURCE_URL), "a@2026-11-08T18:30");
    await writeTwin(source, untimed(SOURCE_URL), "a@2026-11-08");
    expect((await retirePageTwins(db, { metro, nights: NIGHTS })).retired).toBe(0);
  });

  it("never pairs rows with no event page of their own", async () => {
    // canonical_url falls back to the provenance URL, which is the source's own page.
    await write(source, timed(null), "b@2026-11-08T18:30");
    await writeTwin(source, untimed(null), "b@2026-11-08");
    expect((await retirePageTwins(db, { metro, nights: NIGHTS })).retired).toBe(0);
  });

  it("leaves another title, another night or another source's timed row", async () => {
    await write(source, timed(PAGE, "Belly Dance Brunch"), "c@2026-11-08T18:30");
    await writeTwin(source, untimed(), "pool@2026-11-08");
    await write(source, timed(PAGE, POOL, "2026-11-09"), "pool@2026-11-09T18:30");
    await write(other, timed(), "o@2026-11-08T18:30");
    expect((await retirePageTwins(db, { metro, nights: NIGHTS })).retired).toBe(0);
  });

  it("leaves the untimed row when two timed rows share its page (which one is unknown)", async () => {
    await write(source, timed(), "pool@2026-11-08T18:30");
    await write(
      source,
      normalized({ title: POOL, local_date: "2026-11-08", dancing_time: "21:00" }, PAGE),
      "pool@2026-11-08T21:00",
    );
    await writeTwin(source, untimed(), "pool@2026-11-08");
    expect((await retirePageTwins(db, { metro, nights: NIGHTS })).retired).toBe(0);
  });

  it("looks only at the nights it is given", async () => {
    await write(source, timed(), "pool@2026-11-08T18:30");
    await writeTwin(source, untimed(), "pool@2026-11-08");
    expect((await retirePageTwins(db, { metro, nights: ["2026-11-07"] })).retired).toBe(0);
    expect((await retirePageTwins(db, { metro, nights: [] })).retired).toBe(0);
  });
});
