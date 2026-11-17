// D-869: two sources' copies of one 7pm night at one address written "St George’s Rd" and "St Georges Road" (two venue
// rows 8.75 m apart, London Wimbledon Salsa & Bachata Club, daily site check 2026-11-11) are one listing; another
// house number keeps them two.
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

const NOW = new Date("2026-11-11T16:00:00Z");
const NIGHT = "2026-11-16";
const SCHOOL = { lat: 51.41973114013672, lng: -0.210295990109444 };
const HALL = { lat: 51.4197302, lng: -0.2104218 };
let db: Db;
let metro: Metro;
let eb: Source;
let sdt: Source;

function event(
  source: Source,
  title: string,
  venue: { name: string; address: string },
  point: { lat: number; lng: number },
  id: string,
) {
  const harvested: HarvestedListing = {
    listing: rawListingSchema.parse({
      title,
      listing_type: "social",
      styles: ["salsa", "bachata"],
      venue,
      organizer: {},
      local_date: NIGHT,
      dancing_time: "19:00",
    }),
    externalId: id,
    eventUrl: `${source.url}e/${id}`,
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

describeDb("dedupe: one street address written with and without an apostrophe (D-869)", () => {
  beforeAll(async () => {
    db = await testDb("dedupe_address_apostrophe");
  });
  afterAll(closeTestDb);

  beforeEach(async () => {
    await resetDb();
    await db.insert(metros).values({
      slug: "london",
      name: "London",
      countryCode: "GB",
      center: { lat: 51.5074, lng: -0.1278 },
      radiusKm: 40,
      tz: "Europe/London",
      languages: ["en"],
    });
    metro = (await loadMetro(db, "london"))!;
    eb = await upsertSource(db, metro.id, {
      url: "https://www.eventbrite.co.uk/o/wimbledon-club/",
      kind: "html",
      trustTier: "ticketing",
      discoveredBy: "seed_list",
    });
    sdt = await upsertSource(db, metro.id, {
      url: "https://social-dance.today/",
      kind: "html",
      trustTier: "directory",
      discoveredBy: "seed_list",
    });
  });

  it("merges the Wimbledon club's two 7pm copies", async () => {
    await write(eb, [
      event(
        eb,
        "💃🕺Wimbledon  Salsa & Bachata Club🕺💃",
        { name: "Wimbledon Salsa & Bachata Club", address: "44 St Georges Road, London, SW19 4ED" },
        SCHOOL,
        "eb",
      ),
    ]);
    await write(sdt, [
      event(
        sdt,
        "Mondays at Wimbledon Salsa & Bachata Club",
        { name: "Drake House Dance Hall", address: "44 St George’s Rd, Wimbledon London SW19 4ED" },
        HALL,
        "sdt",
      ),
    ]);
    expect(await live()).toHaveLength(2);
    const report = await dedupeMetro(db, metro, [NIGHT]);
    expect(report.merged).toBe(1);
    expect(await live()).toHaveLength(1);
  });

  it("keeps two house numbers two listings", async () => {
    await write(eb, [
      event(
        eb,
        "💃🕺Wimbledon  Salsa & Bachata Club🕺💃",
        { name: "Wimbledon Salsa & Bachata Club", address: "44 St Georges Road, London, SW19 4ED" },
        SCHOOL,
        "eb",
      ),
    ]);
    await write(sdt, [
      event(
        sdt,
        "Mondays at Wimbledon Salsa & Bachata Club",
        { name: "Drake House Dance Hall", address: "46 St George’s Rd, Wimbledon London SW19 4ED" },
        HALL,
        "sdt",
      ),
    ]);
    await dedupeMetro(db, metro, [NIGHT]);
    expect(await live()).toHaveLength(2);
  });
});
