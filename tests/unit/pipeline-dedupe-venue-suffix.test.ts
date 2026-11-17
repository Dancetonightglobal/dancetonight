// D-872: Swing Out London's untimed "A-Train" at The Hammersmith Club beside Swingland's 19:00 "A-Train @ The
// Hammersmith Club" is one night (London 2026-11-12, cov145/twins2.log); a generic "Social" is not.
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

const NOW = new Date("2026-11-12T12:00:00Z");
const NIGHT = "2026-11-16";
let db: Db;
let metro: Metro;
let swingland: Source;
let sol: Source;

const CLUB = { lat: 51.4927, lng: -0.2248 };
const VENUE = { name: "The Hammersmith Club", address: "1 Fulham Palace Road, London W6 9PR" };

function event(
  source: Source,
  fields: Record<string, unknown>,
  id: string,
  venueLocation: { lat: number; lng: number } | null,
) {
  const harvested: HarvestedListing = {
    listing: rawListingSchema.parse({
      listing_type: "social",
      styles: ["lindy_hop"],
      venue: {},
      organizer: {},
      local_date: NIGHT,
      ...fields,
    }),
    externalId: id,
    tz: null,
    venueLocation,
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

describeDb("a directory's untimed copy beside a timed '<title> @ <venue>' copy (D-872)", () => {
  beforeAll(async () => {
    db = await testDb("dedupe_venue_suffix");
  });
  afterAll(closeTestDb);

  beforeEach(async () => {
    await resetDb();
    await db.insert(metros).values({
      slug: "london",
      name: "London",
      countryCode: "GB",
      center: { lat: 51.5072, lng: -0.1276 },
      radiusKm: 40,
      tz: "Europe/London",
      languages: ["en"],
    });
    metro = (await loadMetro(db, "london"))!;
    swingland = await upsertSource(db, metro.id, {
      url: "https://www.swingland.com/events/",
      kind: "html",
      trustTier: "first_party",
      discoveredBy: "seed_list",
    });
    sol = await upsertSource(db, metro.id, {
      url: "https://www.swingoutlondon.co.uk/",
      kind: "html",
      trustTier: "directory",
      discoveredBy: "seed_list",
    });
  });

  async function pair(timedTitle: string, untimedTitle: string) {
    await write(swingland, [
      event(
        swingland,
        { title: timedTitle, dancing_time: "19:00", venue: VENUE },
        "swingland",
        CLUB,
      ),
    ]);
    await write(sol, [event(sol, { title: untimedTitle, venue: VENUE }, "sol", CLUB)]);
    return dedupeMetro(db, metro, [NIGHT]);
  }

  it("merges Swing Out London's untimed A-Train into Swingland's 19:00 copy", async () => {
    const report = await pair("A-Train @ The Hammersmith Club", "A-Train");
    expect(report.merged).toBe(1);
    const rows = await db.select().from(events).where(eq(events.nightDate, NIGHT));
    const active = rows.filter((r) => r.status === "active");
    expect(active).toHaveLength(1);
    expect(active[0]?.startsAt).not.toBeNull();
  });

  it("keeps a generic title apart", async () => {
    const report = await pair("Social @ The Hammersmith Club", "Social");
    expect(report.merged).toBe(0);
  });

  it("keeps a different title apart", async () => {
    const report = await pair("A-Train @ The Hammersmith Club", "B-Train");
    expect(report.merged).toBe(0);
  });
});
