// D-883: same-source subset twin predicate integration test
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

const NOW = new Date("2026-11-14T16:00:00Z");
const NIGHT = "2026-11-14";
const NICETO_POINT = { lat: -34.6037, lng: -58.3816 }; // Buenos Aires
const VENUE_NAME = "Niceto Club";
const LIST = "https://example-venue.test/";
let db: Db;
let metro: Metro;
let source: Source;

function event(
  fields: Record<string, unknown>,
  id: string,
  eventUrl: string,
  point: { lat: number; lng: number } | null,
) {
  const harvested: HarvestedListing = {
    listing: rawListingSchema.parse({
      listing_type: "social",
      styles: ["salsa"],
      venue: {},
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

async function write(list: ReturnType<typeof event>[]) {
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

async function merged() {
  return (await db.select().from(events).where(eq(events.nightDate, NIGHT))).filter(
    (r) => r.status === "merged",
  );
}

describeDb("dedupe: same-source subset twin (D-883)", () => {
  beforeAll(async () => {
    db = await testDb("dedupe_same_source_subset");
  });
  afterAll(closeTestDb);

  beforeEach(async () => {
    await resetDb();
    await db.insert(metros).values({
      slug: "bue",
      name: "Buenos Aires",
      countryCode: "AR",
      center: { lat: -34.6037, lng: -58.3816 },
      radiusKm: 60,
      tz: "America/Argentina/Buenos_Aires",
      languages: ["es"],
    });
    metro = (await loadMetro(db, "bue"))!;
    source = await upsertSource(db, metro.id, {
      url: LIST,
      kind: "html",
      trustTier: "first_party",
      discoveredBy: "seed_list",
    });
  });

  it("merges Club 69 untimed pair with same venue", async () => {
    // Both untimed, same venue
    const placed1 = event(
      {
        title: "Club 69 | 14 NOV",
        venue: { name: VENUE_NAME, address: "Niceto Club, Buenos Aires" },
      },
      "club69-short",
      "https://example-venue.test/e/club69-short",
      NICETO_POINT,
    );
    const placed2 = event(
      {
        title: "Club 69 | 14 NOV en Niceto Club (+18 años)",
        venue: { name: VENUE_NAME, address: "Niceto Club, Buenos Aires" },
      },
      "club69-long",
      "https://example-venue.test/e/club69-long",
      NICETO_POINT,
    );
    await write([placed1, placed2]);
    expect(await live()).toHaveLength(2);
    const report = await dedupeMetro(db, metro, [NIGHT]);
    expect(report.merged).toBe(1);
    expect(await live()).toHaveLength(1);
    expect(await merged()).toHaveLength(1);
  });

  it("merges MU-003 timed pair without venue", async () => {
    // Both timed 21:00, no venue
    const bare1 = event(
      {
        title: "MU-003",
        dancing_time: "21:00",
      },
      "mu003-a",
      "https://example-venue.test/e/mu003-a",
      null,
    );
    const bare2 = event(
      {
        title: "MU-003",
        dancing_time: "21:00",
      },
      "mu003-b",
      "https://example-venue.test/e/mu003-b",
      null,
    );
    await write([bare1, bare2]);
    expect(await live()).toHaveLength(2);
    const report = await dedupeMetro(db, metro, [NIGHT]);
    expect(report.merged).toBe(1);
    expect(await live()).toHaveLength(1);
    expect(await merged()).toHaveLength(1);
  });

  it("merges Country Sunday timed pair with same venue", async () => {
    const placed1 = event(
      {
        title: "Country Sunday",
        dancing_time: "21:00",
        venue: { name: "Country Venue", address: "Some address" },
      },
      "country-sunday",
      "https://example-venue.test/e/country-sunday",
      NICETO_POINT,
    );
    const placed2 = event(
      {
        title: "Country Sunday with Chris Scruggs & The Stone Fox Five",
        dancing_time: "21:00",
        venue: { name: "Country Venue", address: "Some address" },
      },
      "country-sunday-long",
      "https://example-venue.test/e/country-sunday-long",
      NICETO_POINT,
    );
    await write([placed1, placed2]);
    expect(await live()).toHaveLength(2);
    const report = await dedupeMetro(db, metro, [NIGHT]);
    expect(report.merged).toBe(1);
    expect(await live()).toHaveLength(1);
    expect(await merged()).toHaveLength(1);
  });

  it("keeps Salsa Night generic pair (one untimed) at same venue", async () => {
    const placed1 = event(
      {
        title: "Salsa Night",
        dancing_time: "21:00",
        venue: { name: "Salsa Club", address: "Some address" },
      },
      "salsa-night",
      "https://example-venue.test/e/salsa-night",
      NICETO_POINT,
    );
    const placed2 = event(
      {
        title: "Salsa Night with DJ Rafa",
        venue: { name: "Salsa Club", address: "Some address" },
      },
      "salsa-night-dj",
      "https://example-venue.test/e/salsa-night-dj",
      NICETO_POINT,
    );
    await write([placed1, placed2]);
    expect(await live()).toHaveLength(2);
    const report = await dedupeMetro(db, metro, [NIGHT]);
    expect(report.merged).toBe(0);
    expect(await live()).toHaveLength(2);
  });

  it("keeps Club 69 vs Club 70 at same venue same time", async () => {
    const placed1 = event(
      {
        title: "Club 69",
        dancing_time: "23:00",
        venue: { name: VENUE_NAME, address: "Niceto Club" },
      },
      "club69",
      "https://example-venue.test/e/club69",
      NICETO_POINT,
    );
    const placed2 = event(
      {
        title: "Club 70",
        dancing_time: "23:00",
        venue: { name: VENUE_NAME, address: "Niceto Club" },
      },
      "club70",
      "https://example-venue.test/e/club70",
      NICETO_POINT,
    );
    await write([placed1, placed2]);
    expect(await live()).toHaveLength(2);
    const report = await dedupeMetro(db, metro, [NIGHT]);
    expect(report.merged).toBe(0);
    expect(await live()).toHaveLength(2);
  });

  it("keeps MU-003 untimed pair without venue (both unplaced and untimed)", async () => {
    const bare1 = event(
      {
        title: "MU-003",
      },
      "mu003-untimed-a",
      "https://example-venue.test/e/mu003-untimed-a",
      null,
    );
    const bare2 = event(
      {
        title: "MU-003",
      },
      "mu003-untimed-b",
      "https://example-venue.test/e/mu003-untimed-b",
      null,
    );
    await write([bare1, bare2]);
    expect(await live()).toHaveLength(2);
    const report = await dedupeMetro(db, metro, [NIGHT]);
    expect(report.merged).toBe(0);
    expect(await live()).toHaveLength(2);
  });
});
