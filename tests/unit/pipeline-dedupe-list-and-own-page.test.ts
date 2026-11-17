// D-767: Philadelphia 11-06, Silk City's own site lists "CARIBBEAN NIGHT" from its events list page and
// "dj CARIBBEAN NIGHT" from the night's own page, both untimed, one venue: two cards. Now one.
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";

import type { HarvestedListing, Metro, Source } from "@/src/adapters/types";
import type { Db } from "@/src/db/client";
import { events, metros } from "@/src/db/schema";
import { rawListingSchema } from "@/src/domain/listing";
import { EMPTY_BLOCKLIST } from "@/src/pipeline/blocklist";
import { dedupeMetro } from "@/src/pipeline/dedupe";
import { normalizeListing } from "@/src/pipeline/normalize";
import { loadMetro, resolveVenue, upsertSource, writeEvents } from "@/src/pipeline/store";
import { closeTestDb, describeDb, requireDbInCi, resetDb, testDb } from "@/tests/unit/db-harness";

requireDbInCi();

const NOW = new Date("2026-11-06T16:00:00Z");
const NIGHT = "2026-11-06";
const M2 = { lat: 25.7907, lng: -80.1301 };
const FAR = { lat: 25.7617, lng: -80.1918 }; // about 7 km away
let db: Db;
let metro: Metro;
let m2: Source;

function event(
  source: Source,
  fields: Record<string, unknown>,
  id: string,
  eventUrl: string,
  point = M2,
) {
  const harvested: HarvestedListing = {
    listing: rawListingSchema.parse({
      listing_type: "club_night",
      styles: [],
      venue: { name: "Club M2 Miami", address: "1235 Washington Ave, Miami Beach, FL 33139" },
      organizer: {},
      local_date: NIGHT,
      ...fields,
    }),
    externalId: id,
    eventUrl,
    tz: null,
    venueLocation: point,
    recurrence: null,
    provenance: { sourceUrl: `${source.url}#${id}`, fetchedAt: NOW, method: "feed" },
  };
  const outcome = normalizeListing(harvested, { metro, source, now: NOW });
  if (!outcome.ok) throw new Error(outcome.reason);
  return outcome.event;
}

async function write(source: Source, list: ReturnType<typeof event>[]) {
  return writeEvents(db, {
    metro,
    source,
    events: list,
    blocklist: EMPTY_BLOCKLIST,
    placeVenue: (input) => resolveVenue(db, metro, input),
  });
}

async function live() {
  return (await db.select().from(events).where(eq(events.nightDate, NIGHT))).filter(
    (r) => r.status === "active",
  );
}

const LIST = "https://silkcityphilly.com/events/#:~:text=CARIBBEAN%20NIGHT";
const OWN = "https://silkcityphilly.com/events/caribbean-night-2/";

describeDb("dedupe: a list-page copy beside its own event page (D-767)", () => {
  beforeAll(async () => {
    db = await testDb("dedupe_list_and_own_page");
  });
  afterAll(closeTestDb);

  beforeEach(async () => {
    await resetDb();
    await db.insert(metros).values({
      slug: "miami",
      name: "Miami",
      countryCode: "US",
      center: { lat: 25.7617, lng: -80.1918 },
      radiusKm: 60,
      tz: "America/New_York",
      languages: ["en"],
    });
    metro = (await loadMetro(db, "miami"))!;
    m2 = await upsertSource(db, metro.id, {
      url: "https://silkcityphilly.com/events/",
      kind: "html",
      trustTier: "first_party",
      discoveredBy: "seed_list",
    });
  });

  it("merges CARIBBEAN NIGHT and dj CARIBBEAN NIGHT", async () => {
    await write(m2, [
      event(m2, { title: "CARIBBEAN NIGHT" }, "s1", LIST),
      event(m2, { title: "dj CARIBBEAN NIGHT" }, "s2", OWN),
    ]);
    expect(await live()).toHaveLength(2);
    const report = await dedupeMetro(db, metro, [NIGHT]);
    expect(report.merged).toBe(1);
    expect(await live()).toHaveLength(1);
  });

  it("keeps a list copy and another night's own page apart", async () => {
    await write(m2, [
      event(m2, { title: "CARIBBEAN NIGHT" }, "s3", LIST),
      event(m2, { title: "AFROBEATS NIGHT" }, "s4", OWN),
    ]);
    const report = await dedupeMetro(db, metro, [NIGHT]);
    expect(report.merged).toBe(0);
    expect(await live()).toHaveLength(2);
  });
});
