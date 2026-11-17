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

// D-752 (daily check 11-05, NYC Animal): the venue's own site lists "Bears Are Animals" with dancing at 4pm (it
// read the doors as the start), RA lists "ANIMAL Thursday BEARS ARE ANIMALS w/ Sindri, Daiyah" with doors at 7pm.
// One venue, one listed end (4am), every core word of the short title in the long one: one night, whatever the
// starts. A generic short title ("Salsa Night") or two different ends stay two nights.

const NOW = new Date("2026-11-05T16:00:00Z");
let db: Db;
let metro: Metro;
let ra: Source;
let venueSite: Source;

const ANIMAL = { lat: 40.7187093673469, lng: -73.9471445918367 };

function event(
  source: Source,
  fields: Record<string, unknown>,
  id: string,
  point: { lat: number; lng: number } = ANIMAL,
) {
  const harvested: HarvestedListing = {
    listing: rawListingSchema.parse({
      listing_type: "club_night",
      styles: ["dj_night"],
      venue: { name: "Animal", address: "307 Meeker Avenue, Brooklyn, NY 11222" },
      organizer: {},
      local_date: "2026-11-05",
      ...fields,
    }),
    externalId: id,
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

async function active() {
  const rows = await db.select().from(events).where(eq(events.nightDate, "2026-11-05"));
  return rows.filter((r) => r.status === "active");
}

describeDb("one venue, one end, one title inside the other (D-752)", () => {
  beforeAll(async () => {
    db = await testDb("dedupe_contained_title_same_end");
  });
  afterAll(closeTestDb);

  beforeEach(async () => {
    await resetDb();
    await db.insert(metros).values({
      slug: "nyc",
      name: "New York",
      countryCode: "US",
      center: { lat: 40.7128, lng: -74.006 },
      radiusKm: 50,
      tz: "America/New_York",
      languages: ["en"],
    });
    metro = (await loadMetro(db, "nyc"))!;
    ra = await upsertSource(db, metro.id, {
      url: "https://ra.co/graphql?area=8",
      kind: "ticketing_api",
      trustTier: "ticketing",
      discoveredBy: "seed_list",
    });
    venueSite = await upsertSource(db, metro.id, {
      url: "https://animal.nyc/",
      kind: "jsonld",
      trustTier: "first_party",
      discoveredBy: "seed_list",
    });
  });

  it("merges the venue site's 4pm copy into RA's 7pm doors copy (Animal, 2026-11-05)", async () => {
    await write(venueSite, [
      event(
        venueSite,
        { title: "Bears Are Animals", dancing_time: "16:00", end_time: "04:00" },
        "animal1",
      ),
    ]);
    await write(ra, [
      event(
        ra,
        {
          title: "ANIMAL Thursday BEARS ARE ANIMALS w/ Sindri, Daiyah",
          listing_type: "other",
          doors_time: "19:00",
          end_time: "04:00",
          ticket_url: "https://ra.co/events/2576383",
        },
        "ra1",
      ),
    ]);
    const report = await dedupeMetro(db, metro, ["2026-11-05"]);
    expect(report.merged).toBe(1);
    expect(await active()).toHaveLength(1);
  });

  it("keeps two nights when the ends differ", async () => {
    await write(venueSite, [
      event(
        venueSite,
        { title: "Bears Are Animals", dancing_time: "16:00", end_time: "22:00" },
        "animal2",
      ),
    ]);
    await write(ra, [
      event(
        ra,
        {
          title: "ANIMAL Thursday BEARS ARE ANIMALS w/ Sindri, Daiyah",
          doors_time: "19:00",
          end_time: "04:00",
        },
        "ra2",
      ),
    ]);
    const report = await dedupeMetro(db, metro, ["2026-11-05"]);
    expect(report.merged).toBe(0);
    expect(await active()).toHaveLength(2);
  });

  it("keeps two nights when the short title is generic (Salsa Night inside a longer title)", async () => {
    await write(venueSite, [
      event(
        venueSite,
        { title: "Salsa Night", listing_type: "social", dancing_time: "17:00", end_time: "04:00" },
        "s1",
      ),
    ]);
    await write(ra, [
      event(
        ra,
        {
          title: "Salsa Night with DJ Bembe",
          listing_type: "social",
          doors_time: "21:00",
          end_time: "04:00",
        },
        "s2",
      ),
    ]);
    const report = await dedupeMetro(db, metro, ["2026-11-05"]);
    expect(report.merged).toBe(0);
    expect(await active()).toHaveLength(2);
  });

  it("keeps two nights at two venues far apart", async () => {
    await write(venueSite, [
      event(
        venueSite,
        { title: "Bears Are Animals", dancing_time: "16:00", end_time: "04:00" },
        "animal3",
      ),
    ]);
    await write(ra, [
      event(
        ra,
        {
          title: "ANIMAL Thursday BEARS ARE ANIMALS w/ Sindri, Daiyah",
          doors_time: "19:00",
          end_time: "04:00",
          venue: { name: "Elsewhere", address: "599 Johnson Ave, Brooklyn, NY 11237" },
        },
        "ra3",
        { lat: 40.7095, lng: -73.9235 },
      ),
    ]);
    const report = await dedupeMetro(db, metro, ["2026-11-05"]);
    expect(report.merged).toBe(0);
    expect(await active()).toHaveLength(2);
  });

  // D-877 (daily check 11-12, B): the venue site's rows moved to a second venue row, "Animal NYC", at the same
  // street address 158 m from RA's "Animal" row, so the one-venue-id check no longer paired them.
  const ANIMAL_NYC = { lat: 40.717456285714285, lng: -73.9480255 };
  const ANIMAL_NYC_VENUE = { name: "Animal NYC", address: "307 Meeker Avenue, Brooklyn, NY 11211" };

  it("merges across two venue rows of one place at one street address (D-877)", async () => {
    await write(venueSite, [
      event(
        venueSite,
        {
          title: "Horrorchata b2b Tok.io",
          dancing_time: "16:00",
          end_time: "04:00",
          venue: ANIMAL_NYC_VENUE,
        },
        "animal4",
        ANIMAL_NYC,
      ),
    ]);
    await write(ra, [
      event(
        ra,
        {
          title: "ANIMAL Friday Night w/ Horrorchata b2b Tok.io",
          listing_type: "other",
          doors_time: "22:00",
          end_time: "04:00",
          venue: { name: "Animal", address: "307 Meeker Avenue, Brooklyn, NY 11211" },
        },
        "ra4",
      ),
    ]);
    const venueIds = new Set((await active()).map((r) => r.venueId));
    expect(venueIds.size).toBe(2);
    const report = await dedupeMetro(db, metro, ["2026-11-05"]);
    expect(report.merged).toBe(1);
    expect(await active()).toHaveLength(1);
  });

  it("keeps two nights at a neighbouring venue on another street address (D-877)", async () => {
    await write(venueSite, [
      event(
        venueSite,
        { title: "Horrorchata b2b Tok.io", dancing_time: "16:00", end_time: "04:00" },
        "animal5",
      ),
    ]);
    await write(ra, [
      event(
        ra,
        {
          title: "Friday Night w/ Horrorchata b2b Tok.io",
          listing_type: "other",
          doors_time: "22:00",
          end_time: "04:00",
          venue: { name: "Sunshine Laundromat", address: "860 Manhattan Ave, Brooklyn, NY 11222" },
        },
        "ra5",
        ANIMAL_NYC,
      ),
    ]);
    const report = await dedupeMetro(db, metro, ["2026-11-05"]);
    expect(report.merged).toBe(0);
    expect(await active()).toHaveLength(2);
  });
});
