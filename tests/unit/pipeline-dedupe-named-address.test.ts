// D-765: London 11-07 "B&M Presents: Therapy Sessions London" 11pm on ra.co (venue "Oslo Hackney") and on
// Skiddle (venue "Oslo Hackney London"), both at 1a Amhurst Road but geocoded 171 m apart: two cards. Now one.
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
const NIGHT = "2026-11-07";
let db: Db;
let metro: Metro;
let ra: Source;
let skiddle: Source;

function event(
  source: Source,
  fields: Record<string, unknown>,
  id: string,
  point: { lat: number; lng: number },
) {
  const harvested: HarvestedListing = {
    listing: rawListingSchema.parse({
      listing_type: "social",
      styles: [],
      venue: {},
      organizer: {},
      local_date: NIGHT,
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

const OSLO_RA = { lat: 51.5476, lng: -0.0559 };
const OSLO_SKIDDLE = { lat: 51.54914, lng: -0.0559 }; // about 171 m north

describeDb("dedupe: one street line, one name, geocoded apart (D-765)", () => {
  beforeAll(async () => {
    db = await testDb("dedupe_named_address");
  });
  afterAll(closeTestDb);

  beforeEach(async () => {
    await resetDb();
    await db.insert(metros).values({
      slug: "london",
      name: "London",
      countryCode: "GB",
      center: { lat: 51.5072, lng: -0.1276 },
      radiusKm: 50,
      tz: "Europe/London",
      languages: ["en"],
    });
    metro = (await loadMetro(db, "london"))!;
    ra = await upsertSource(db, metro.id, {
      url: "https://ra.co/",
      kind: "ticketing_api",
      trustTier: "ticketing",
      discoveredBy: "seed_list",
    });
    skiddle = await upsertSource(db, metro.id, {
      url: "https://www.skiddle.com/",
      kind: "ticketing_api",
      trustTier: "ticketing",
      discoveredBy: "seed_list",
    });
  });

  it("merges Oslo Hackney and Oslo Hackney London at 1a Amhurst Road", async () => {
    await write(ra, [
      event(
        ra,
        {
          title: "B&M presents: Therapy Sessions London",
          dancing_time: "23:00",
          venue: { name: "Oslo Hackney", address: "1a Amhurst Road, Hackney, London E8 1LL" },
        },
        "ra1",
        OSLO_RA,
      ),
    ]);
    await write(skiddle, [
      event(
        skiddle,
        {
          title: "B&M Presents: Therapy Sessions London",
          dancing_time: "23:00",
          venue: { name: "Oslo Hackney London", address: "1A Amhurst Road, London, E8 1LL" },
        },
        "sk1",
        OSLO_SKIDDLE,
      ),
    ]);
    const before = await db.select().from(events).where(eq(events.nightDate, NIGHT));
    expect(before).toHaveLength(2);
    expect(new Set(before.map((r) => r.venueId)).size).toBe(2);

    const report = await dedupeMetro(db, metro, [NIGHT]);
    expect(report.merged).toBe(1);
    const live = (await db.select().from(events).where(eq(events.nightDate, NIGHT))).filter(
      (r) => r.status === "active",
    );
    expect(live).toHaveLength(1);
  });

  it("keeps two clubs at one street line apart", async () => {
    await write(ra, [
      event(
        ra,
        {
          title: "Therapy Sessions",
          dancing_time: "23:00",
          venue: { name: "Oslo Hackney", address: "1a Amhurst Road, Hackney, London E8 1LL" },
        },
        "ra2",
        OSLO_RA,
      ),
    ]);
    await write(skiddle, [
      event(
        skiddle,
        {
          title: "Open Decks Night",
          dancing_time: "23:00",
          venue: { name: "Moth Club", address: "1A Amhurst Road, London, E8 1LL" },
        },
        "sk2",
        OSLO_SKIDDLE,
      ),
    ]);
    const report = await dedupeMetro(db, metro, [NIGHT]);
    expect(report.merged).toBe(0);
  });
});
