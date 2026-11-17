// D-751: two copies with no place at all, from two sources, one night, one telling title, are one event.
// London Afrocentric 2026-11-06 (daily check 11-05): RA 7pm and Shoobs untimed, both "Location not listed".
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

const NOW = new Date("2026-10-29T16:00:00Z");
let db: Db;
let metro: Metro;
let ticketing: Source;
let firstParty: Source;

const VENUE_POINT = { lat: 25.7617, lng: -80.1918 };

function event(
  source: Source,
  fields: Record<string, unknown>,
  id: string,
  venueLocation?: { lat: number; lng: number } | null,
) {
  const harvested: HarvestedListing = {
    listing: rawListingSchema.parse({
      listing_type: "social",
      styles: [],
      venue: {},
      organizer: {},
      local_date: "2026-10-29",
      ...fields,
    }),
    externalId: id,
    tz: null,
    venueLocation: venueLocation === undefined ? VENUE_POINT : venueLocation,
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

describeDb("two unplaced copies with one telling title (D-751)", () => {
  beforeAll(async () => {
    db = await testDb("dedupe_unplaced_title");
  });
  afterAll(closeTestDb);

  beforeEach(async () => {
    await resetDb();
    await db.insert(metros).values({
      slug: "mia",
      name: "Miami",
      countryCode: "US",
      center: { lat: 25.7617, lng: -80.1918 },
      radiusKm: 50,
      tz: "America/New_York",
      languages: ["en"],
    });
    metro = (await loadMetro(db, "mia"))!;
    ticketing = await upsertSource(db, metro.id, {
      url: "https://ra.co/",
      kind: "ticketing_api",
      trustTier: "ticketing",
      discoveredBy: "seed_list",
    });
    firstParty = await upsertSource(db, metro.id, {
      url: "https://shoobs.com/",
      kind: "html",
      trustTier: "directory",
      discoveredBy: "seed_list",
    });
  });

  async function pair(titleA: string, titleB: string, ticketA?: string, ticketB?: string) {
    await write(ticketing, [
      event(
        ticketing,
        { title: titleA, dancing_time: "19:00", venue: {}, ticket_url: ticketA ?? null },
        "ra",
        null,
      ),
    ]);
    await write(firstParty, [
      event(firstParty, { title: titleB, venue: {}, ticket_url: ticketB ?? null }, "shoobs", null),
    ]);
    return dedupeMetro(db, metro, ["2026-10-29"]);
  }

  it("merges RA's timed and Shoobs' untimed Afrocentric", async () => {
    const report = await pair("Afrocentric", "AFROCENTRIC");
    expect(report.merged).toBe(1);
    const rows = await db.select().from(events).where(eq(events.nightDate, "2026-10-29"));
    expect(rows.filter((r) => r.status === "active")).toHaveLength(1);
  });

  it("merges them with each seller's own ticket page (ra.co and shoobs.com)", async () => {
    const report = await pair(
      "Afrocentric",
      "Afrocentric",
      "https://ra.co/events/2576519",
      "https://shoobs.com/events/186042",
    );
    expect(report.merged).toBe(1);
  });

  it("keeps two pages on one seller apart", async () => {
    const report = await pair(
      "Afrocentric",
      "Afrocentric",
      "https://ra.co/events/2576519",
      "https://ra.co/events/2576999",
    );
    expect(report.merged).toBe(0);
  });

  it("keeps two unplaced copies with a generic title apart", async () => {
    const report = await pair("Salsa Social Night", "Salsa Social Night");
    expect(report.merged).toBe(0);
  });

  it("keeps two unplaced copies with different titles apart", async () => {
    const report = await pair("Afrocentric", "Afrocentric Brunch Party");
    expect(report.merged).toBe(0);
  });
});
