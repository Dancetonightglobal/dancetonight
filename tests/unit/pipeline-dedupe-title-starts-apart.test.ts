// D-769: Philadelphia 11-12, NOTO's own events page lists "PTO Thursdays: Mha Iri" at 8pm and DICE lists it at 10pm
// (ends 2am), one venue: two cards. Now one. An early and a late show with their own ends stay two.
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
const NIGHT = "2026-11-12";
const NOTO = { lat: 39.9584, lng: -75.1574 };
const ADDRESS = "1209 Vine St, Philadelphia, PA 19107";
let db: Db;
let metro: Metro;
let site: Source;
let dice: Source;

function event(source: Source, fields: Record<string, unknown>, id: string, venueName: string) {
  const harvested: HarvestedListing = {
    listing: rawListingSchema.parse({
      listing_type: "club_night",
      styles: [],
      venue: { name: venueName, address: ADDRESS },
      organizer: {},
      local_date: NIGHT,
      ...fields,
    }),
    externalId: id,
    eventUrl: `${source.url}${id}`,
    tz: null,
    venueLocation: NOTO,
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

describeDb("dedupe: two sources, one venue, one title, starts 2h apart (D-769)", () => {
  beforeAll(async () => {
    db = await testDb("dedupe_title_starts_apart");
  });
  afterAll(closeTestDb);

  beforeEach(async () => {
    await resetDb();
    await db.insert(metros).values({
      slug: "philadelphia",
      name: "Philadelphia",
      countryCode: "US",
      center: { lat: 39.9526, lng: -75.1652 },
      radiusKm: 60,
      tz: "America/New_York",
      languages: ["en"],
    });
    metro = (await loadMetro(db, "philadelphia"))!;
    site = await upsertSource(db, metro.id, {
      url: "https://www.notophl.com/events/",
      kind: "html",
      trustTier: "first_party",
      discoveredBy: "seed_list",
    });
    dice = await upsertSource(db, metro.id, {
      url: "https://dice.fm/event/",
      kind: "html",
      trustTier: "ticketing",
      discoveredBy: "seed_list",
    });
  });

  it("merges the venue page's 8pm and DICE's 10pm PTO Thursdays", async () => {
    await write(site, [
      event(
        site,
        { title: "PTO Thursdays: Mha Iri", dancing_time: "20:00" },
        "pto",
        "NOTO Philadelphia",
      ),
    ]);
    await write(dice, [
      event(
        dice,
        { title: "PTO Thursdays: Mha Iri", dancing_time: "22:00", end_time: "02:00" },
        "6ad14ca23cdbd500016dd7e6",
        "NOTO Nightclub",
      ),
    ]);
    expect(await live()).toHaveLength(2);
    const report = await dedupeMetro(db, metro, [NIGHT]);
    expect(report.merged).toBe(1);
    expect(await live()).toHaveLength(1);
  });

  it("keeps an early and a late show with their own ends apart", async () => {
    await write(site, [
      event(
        site,
        { title: "PTO Thursdays: Mha Iri", dancing_time: "19:00", end_time: "21:00" },
        "early",
        "NOTO Philadelphia",
      ),
    ]);
    await write(dice, [
      event(
        dice,
        { title: "PTO Thursdays: Mha Iri", dancing_time: "21:30", end_time: "23:30" },
        "late",
        "NOTO Nightclub",
      ),
    ]);
    const report = await dedupeMetro(db, metro, [NIGHT]);
    expect(report.merged).toBe(0);
    expect(await live()).toHaveLength(2);
  });
});
