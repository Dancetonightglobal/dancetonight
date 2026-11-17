// D-786: one platform's two pages of one night at one venue, starts 15 minutes apart, are one listing. social-dance.today
// listed Funky Mambo's Tuesday at Downstairs at The Dome as "Funky Mambo Salsa On2sdays" 19:00 and "Funky Mambo" 19:15
// (London, 2026-11-10); the candidate query paired one source's listings only at one exact start, so they stood apart.
// A studio's own sessions and classes still need one exact start.
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

const NOW = new Date("2026-11-05T16:00:00Z");
const NIGHT = "2026-11-10";
const DOME = { lat: 51.55731, lng: -0.1384 };
let db: Db;
let metro: Metro;
let platform: Source;
let studio: Source;

function listing(source: Source, fields: Record<string, unknown>, id: string) {
  const harvested: HarvestedListing = {
    listing: rawListingSchema.parse({
      listing_type: "social",
      styles: ["salsa"],
      venue: { name: "Downstairs at The Dome" },
      organizer: {},
      local_date: NIGHT,
      ...fields,
    }),
    externalId: id,
    tz: null,
    venueLocation: DOME,
    recurrence: null,
    provenance: { sourceUrl: `${source.url}#${id}`, fetchedAt: NOW, method: "feed" },
  };
  const outcome = normalizeListing(harvested, { metro, source, now: NOW });
  if (!outcome.ok) throw new Error(outcome.reason);
  return outcome.event;
}

async function write(source: Source, list: ReturnType<typeof listing>[]) {
  return writeEvents(db, {
    metro,
    source,
    events: list,
    blocklist: EMPTY_BLOCKLIST,
    placeVenue: (input) => resolveVenue(db, metro, input),
  });
}

async function live() {
  const rows = await db.select().from(events).where(eq(events.nightDate, NIGHT));
  return rows
    .filter((r) => r.mergedIntoId === null)
    .map((r) => r.title)
    .sort();
}

describeDb("one source's two listings of one night, starts 15 minutes apart (D-786)", () => {
  beforeAll(async () => {
    db = await testDb("dedupe_same_source_near_start");
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
    platform = await upsertSource(db, metro.id, {
      url: "https://social-dance.today/",
      kind: "directory",
      trustTier: "directory",
      discoveredBy: "seed_list",
    });
    studio = await upsertSource(db, metro.id, {
      url: "https://studio.example/",
      kind: "html",
      trustTier: "first_party",
      discoveredBy: "seed_list",
    });
  });

  it("merges a platform's two pages of one night, 19:00 and 19:15, one title the other's prefix", async () => {
    await write(platform, [
      listing(platform, { title: "Funky Mambo Salsa On2sdays", dancing_time: "19:00" }, "s71"),
      listing(platform, { title: "Funky Mambo", dancing_time: "19:15" }, "s3c"),
    ]);
    const report = await dedupeMetro(db, metro, [NIGHT]);
    expect(report.merged).toBe(1);
    expect(await live()).toHaveLength(1);
  });

  it("keeps a studio's own two sessions 15 minutes apart", async () => {
    await write(studio, [
      listing(studio, { title: "Salsa", dancing_time: "19:00" }, "a"),
      listing(studio, { title: "Salsa Level 2", dancing_time: "19:15" }, "b"),
    ]);
    await dedupeMetro(db, metro, [NIGHT]);
    expect(await live()).toEqual(["Salsa", "Salsa Level 2"]);
  });

  it("keeps a platform's two classes 15 minutes apart", async () => {
    await write(platform, [
      listing(platform, { title: "Bachata", listing_type: "class", lesson_time: "19:00" }, "c1"),
      listing(
        platform,
        { title: "Bachata Improvers", listing_type: "class", lesson_time: "19:15" },
        "c2",
      ),
    ]);
    await dedupeMetro(db, metro, [NIGHT]);
    expect(await live()).toEqual(["Bachata", "Bachata Improvers"]);
  });

  it("still merges a platform's two pages at one exact start", async () => {
    await write(platform, [
      listing(platform, { title: "Funky Mambo Salsa On2sdays", dancing_time: "19:00" }, "s71"),
      listing(platform, { title: "Funky Mambo", dancing_time: "19:00" }, "s3c"),
    ]);
    await dedupeMetro(db, metro, [NIGHT]);
    expect(await live()).toHaveLength(1);
  });
});
