// Two sources' listings of one evening whose stored starts differ because one source gives the
// evening's first time and the other gives dancing (London "Super Mario" at Simmons Bar, 2026-11-05):
// social-dance.today lists doors 18:45 and dancing 22:00 (start 22:00), Salsa Vida doors 18:30.
// The evening's first time (earliest of doors, lesson and dancing) is compared as well as the start.
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { HarvestedListing, Metro, Source } from "@/src/adapters/types";
import type { Db } from "@/src/db/client";
import { events, metros } from "@/src/db/schema";
import {
  firstTimeOfEvening,
  oneVenueOneEvening,
  oneVenueOneStart,
  type DedupeSide,
} from "@/src/domain/dedupe";
import { rawListingSchema } from "@/src/domain/listing";
import { EMPTY_BLOCKLIST } from "@/src/pipeline/blocklist";
import { dedupeMetro } from "@/src/pipeline/dedupe";
import { normalizeListing } from "@/src/pipeline/normalize";
import { loadMetro, resolveVenue, upsertSource, writeEvents } from "@/src/pipeline/store";
import { closeTestDb, describeDb, requireDbInCi, resetDb, testDb } from "@/tests/unit/db-harness";

requireDbInCi();

const at = (iso: string) => new Date(iso);

function side(id: string, fields: Partial<DedupeSide>): DedupeSide {
  return {
    id,
    startsAt: null,
    organizerId: null,
    organizerName: null,
    venueId: "v1",
    ticketUrl: null,
    canonicalUrl: null,
    trust: "directory",
    firstSeenAt: at("2026-10-29T00:00:00Z"),
    venuePoint: { lat: 51.5166132, lng: -0.1203733 },
    venueName: "Simmons Bar",
    ...fields,
  };
}

describe("firstTimeOfEvening", () => {
  it("is the earliest of doors, lesson, dancing and the start", () => {
    const s = side("a", {
      startsAt: at("2026-11-09T22:00:00Z"),
      times: {
        doors: at("2026-11-09T18:45:00Z"),
        lesson: null,
        dancing: at("2026-11-09T22:00:00Z"),
      },
    });
    expect(firstTimeOfEvening(s)?.toISOString()).toBe("2026-11-09T18:45:00.000Z");
  });

  it("is the start when no times are loaded", () => {
    const s = side("a", { startsAt: at("2026-11-09T22:00:00Z") });
    expect(firstTimeOfEvening(s)?.toISOString()).toBe("2026-11-09T22:00:00.000Z");
  });

  it("is null for an untimed listing", () => {
    expect(firstTimeOfEvening(side("a", {}))).toBeNull();
  });
});

describe("oneVenueOneEvening", () => {
  const sdt = side("sdt", {
    title: "Super Mario",
    listingType: "social",
    startsAt: at("2026-11-09T22:00:00Z"),
    times: { doors: at("2026-11-09T18:45:00Z"), lesson: null, dancing: at("2026-11-09T22:00:00Z") },
  });

  it("is true when the first times are within 15 minutes, whatever the starts", () => {
    const sv = side("sv", {
      title: "Salsa 4 Fun with Super Mario – Monday Classes & Social",
      listingType: "social",
      startsAt: at("2026-11-09T18:30:00Z"),
      times: { doors: at("2026-11-09T18:30:00Z"), lesson: null, dancing: null },
    });
    expect(oneVenueOneEvening(sdt, sv)).toBe(true);
    // The start rule itself stays on starts: one source's two listings are matched on those (D-150).
    expect(oneVenueOneStart(sdt, sv)).toBe(false);
  });

  it("is false when neither the starts nor the first times are within 15 minutes", () => {
    const sv = side("sv", {
      title: "Salsa 4 Fun with Super Mario – Monday Classes & Social",
      listingType: "social",
      startsAt: at("2026-11-09T19:30:00Z"),
      times: { doors: at("2026-11-09T19:30:00Z"), lesson: null, dancing: null },
    });
    expect(oneVenueOneEvening(sdt, sv)).toBe(false);
  });
});

const NOW = new Date("2026-11-05T16:00:00Z");
const SIMMONS_A = { lat: 51.5166132, lng: -0.1203733 };
const SIMMONS_B = { lat: 51.5165748596191, lng: -0.120315544307232 };
let db: Db;
let metro: Metro;
let sdtSource: Source;
let salsaVida: Source;

function listing(
  source: Source,
  fields: Record<string, unknown>,
  id: string,
  point: { lat: number; lng: number },
) {
  const harvested: HarvestedListing = {
    listing: rawListingSchema.parse({
      listing_type: "social",
      styles: ["salsa"],
      venue: { name: "Simmons Bar" },
      organizer: {},
      local_date: "2026-11-09",
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

async function write(source: Source, list: ReturnType<typeof listing>[]) {
  return writeEvents(db, {
    metro,
    source,
    events: list,
    blocklist: EMPTY_BLOCKLIST,
    placeVenue: (input) => resolveVenue(db, metro, input),
  });
}

describeDb("dedupe on the evening's first time", () => {
  beforeAll(async () => {
    db = await testDb("dedupe_first_time");
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
    sdtSource = await upsertSource(db, metro.id, {
      url: "https://social-dance.today/",
      kind: "directory",
      trustTier: "directory",
      discoveredBy: "seed_list",
    });
    salsaVida = await upsertSource(db, metro.id, {
      url: "https://www.salsavida.com/",
      kind: "directory",
      trustTier: "directory",
      discoveredBy: "seed_list",
    });
  });

  async function nightRows() {
    return db.select().from(events).where(eq(events.nightDate, "2026-11-09"));
  }

  it("merges doors 18:45 + dancing 22:00 with another source's 18:30 start at one venue", async () => {
    await write(sdtSource, [
      listing(
        sdtSource,
        { title: "Super Mario", doors_time: "18:45", dancing_time: "22:00" },
        "sdt1",
        SIMMONS_A,
      ),
    ]);
    await write(salsaVida, [
      listing(
        salsaVida,
        {
          title: "Salsa 4 Fun with Super Mario – Monday Classes & Social",
          doors_time: "18:30",
          end_time: "00:00",
        },
        "sv1",
        SIMMONS_B,
      ),
    ]);
    const report = await dedupeMetro(db, metro, ["2026-11-09"]);
    expect(report.merged).toBe(1);
    const rows = await nightRows();
    expect(rows.filter((r) => r.status === "merged")).toHaveLength(1);
  });

  it("keeps two unrelated titles apart even with one first time", async () => {
    await write(sdtSource, [
      listing(
        sdtSource,
        { title: "Bachata Sensual Night", doors_time: "18:45", dancing_time: "22:00" },
        "sdt2",
        SIMMONS_A,
      ),
    ]);
    await write(salsaVida, [
      listing(
        salsaVida,
        { title: "Salsa 4 Fun with Super Mario – Monday Classes & Social", doors_time: "18:30" },
        "sv2",
        SIMMONS_B,
      ),
    ]);
    const report = await dedupeMetro(db, metro, ["2026-11-09"]);
    expect(report.merged).toBe(0);
    expect((await nightRows()).filter((r) => r.status === "active")).toHaveLength(2);
  });

  it("keeps them apart when the first times are far apart too", async () => {
    await write(sdtSource, [
      listing(
        sdtSource,
        { title: "Super Mario", doors_time: "21:00", dancing_time: "22:00" },
        "sdt3",
        SIMMONS_A,
      ),
    ]);
    await write(salsaVida, [
      listing(
        salsaVida,
        { title: "Salsa 4 Fun with Super Mario – Monday Classes & Social", doors_time: "18:30" },
        "sv3",
        SIMMONS_B,
      ),
    ]);
    const report = await dedupeMetro(db, metro, ["2026-11-09"]);
    expect(report.merged).toBe(0);
    expect((await nightRows()).filter((r) => r.status === "active")).toHaveLength(2);
  });
});
