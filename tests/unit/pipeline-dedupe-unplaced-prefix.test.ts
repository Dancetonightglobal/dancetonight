// D-806: two sources' copies of one night, one or both with no place, at one start, one title at the head of the
// other (or after one promoter word), are one event. Daily report 2026-11-08: NYC Cadence RA/DICE, Rio Tamborzao.
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
let ra: Source;
let dice: Source;

const VENUE_POINT = { lat: 25.7617, lng: -80.1918 };

function event(
  source: Source,
  fields: Record<string, unknown>,
  id: string,
  venueLocation: { lat: number; lng: number } | null,
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

describeDb("unplaced copies with one title heading the other (D-806)", () => {
  beforeAll(async () => {
    db = await testDb("dedupe_unplaced_prefix");
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
    ra = await upsertSource(db, metro.id, {
      url: "https://ra.co/",
      kind: "ticketing_api",
      trustTier: "ticketing",
      discoveredBy: "seed_list",
    });
    dice = await upsertSource(db, metro.id, {
      url: "https://dice.fm/",
      kind: "ticketing_api",
      trustTier: "ticketing",
      discoveredBy: "seed_list",
    });
  });

  async function pair(
    titleA: string,
    titleB: string,
    opts: { timeB?: string; placedA?: boolean } = {},
  ) {
    const venueA = opts.placedA ? { name: "Club Tamborzao", address: "1 Main St, Miami" } : {};
    await write(ra, [
      event(
        ra,
        { title: titleA, dancing_time: "21:00", venue: venueA },
        "ra",
        opts.placedA ? VENUE_POINT : null,
      ),
    ]);
    await write(dice, [
      event(dice, { title: titleB, dancing_time: opts.timeB ?? "21:00", venue: {} }, "dice", null),
    ]);
    return dedupeMetro(db, metro, ["2026-10-29"]);
  }

  async function active() {
    const rows = await db.select().from(events).where(eq(events.nightDate, "2026-10-29"));
    return rows.filter((r) => r.status === "active");
  }

  it("merges RA's 'Cadence presents:' and DICE's 'Cadence:' copies, both unplaced", async () => {
    const report = await pair(
      "Cadence presents: Seb Wildblood with DELACOUR",
      "Cadence: Seb Wildblood with DELACOUR",
    );
    expect(report.merged).toBe(1);
    expect(await active()).toHaveLength(1);
  });

  it("merges a placed copy with a longer title and an unplaced short one", async () => {
    const report = await pair("Tamborzão NIGHTs - Samba , Forró e Funk", "TAMBORZAO NIGHTS", {
      placedA: true,
    });
    expect(report.merged).toBe(1);
    expect(await active()).toHaveLength(1);
  });

  it("keeps them apart at two starts", async () => {
    const report = await pair(
      "Cadence presents: Seb Wildblood with DELACOUR",
      "Cadence: Seb Wildblood with DELACOUR",
      { timeB: "22:00" },
    );
    expect(report.merged).toBe(0);
  });

  it("keeps titles that only share their first words apart", async () => {
    const report = await pair(
      "Sun City Day Party - Westend Edition",
      "Sun City Day Party | Westend | Sexy & Stylish",
    );
    expect(report.merged).toBe(0);
  });
});
