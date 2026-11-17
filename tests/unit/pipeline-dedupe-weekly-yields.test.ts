// Weekly rule night yields to a dated night at the same venue (D-295).
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";

import type { HarvestedListing, Metro, Source } from "@/src/adapters/types";
import type { Db } from "@/src/db/client";
import { events, mergeDecisions, metros } from "@/src/db/schema";
import { rawListingSchema } from "@/src/domain/listing";
import { EMPTY_BLOCKLIST } from "@/src/pipeline/blocklist";
import {
  dedupeMetro,
  formatDedupeReport,
  EMPTY_DEDUPE_REPORT,
  type DedupeReport,
} from "@/src/pipeline/dedupe";
import { normalizeListing } from "@/src/pipeline/normalize";
import {
  loadMetro,
  pipelineId,
  resolveVenue,
  upsertSource,
  writeEvents,
} from "@/src/pipeline/store";
import { closeTestDb, describeDb, requireDbInCi, resetDb, testDb } from "@/tests/unit/db-harness";

requireDbInCi();

const NOW = new Date("2026-10-30T16:00:00Z");
let db: Db;
let metro: Metro;
let firstParty: Source;
let ticketing: Source;

const VENUE_POINT_A = { lat: 29.9468, lng: -90.067 };
const VENUE_POINT_B = { lat: 29.947, lng: -90.0672 };

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
      local_date: "2026-10-31",
      ...fields,
    }),
    externalId: id,
    tz: null,
    venueLocation: venueLocation === undefined ? VENUE_POINT_A : venueLocation,
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

describeDb("weekly rule night yields to dated night (D-295)", () => {
  beforeAll(async () => {
    db = await testDb("dedupe_weekly_yields");
  });
  afterAll(closeTestDb);

  beforeEach(async () => {
    await resetDb();
    await db.insert(metros).values({
      slug: "nola",
      name: "New Orleans",
      countryCode: "US",
      center: { lat: 29.9511, lng: -90.0715 },
      radiusKm: 50,
      tz: "America/Chicago",
      languages: ["en"],
    });
    metro = (await loadMetro(db, "nola"))!;
    firstParty = await upsertSource(db, metro.id, {
      url: "https://ohmlounge.com/",
      kind: "html",
      trustTier: "first_party",
      discoveredBy: "seed_list",
    });
    ticketing = await upsertSource(db, metro.id, {
      url: "https://eventbrite.com/",
      kind: "ticketing_api",
      trustTier: "ticketing",
      discoveredBy: "seed_list",
    });
  });

  it("merges rule row into dated row (Ohm Lounge case)", async () => {
    // Rule row: untimed, venue "Ohm Lounge"
    const ruleOutcome = await write(firstParty, [
      event(
        firstParty,
        {
          title: "Saturdays at OHM Lounge",
          venue: { name: "Ohm Lounge" },
          listing_type: "club_night",
        },
        "rule",
        VENUE_POINT_A,
      ),
    ]);
    const ruleId = ruleOutcome.eventIds[0];
    expect(ruleId).toBeDefined();
    await db.update(events).set({ lastVerifiedAt: null }).where(eq(events.id, ruleId!));

    // Dated row: timed, venue "Ohm Lounge, Tchoupitoulas Street"
    await write(ticketing, [
      event(
        ticketing,
        {
          title: "Saturday Nights @ Ohm Lounge | Open Format • House • Hip-Hop • Techno",
          dancing_time: "22:00",
          venue: { name: "Ohm Lounge, Tchoupitoulas Street" },
          listing_type: "club_night",
        },
        "dated",
        VENUE_POINT_B,
      ),
    ]);

    const report = await dedupeMetro(db, metro, ["2026-10-31"]);
    expect(report.merged).toBe(1);
    expect(report.linked).toBe(0);
    expect(report.mergedPairs[0]!.by).toBe("weekly");
    const rows = await db.select().from(events).where(eq(events.nightDate, "2026-10-31"));
    const ruleRow = rows.find((r) => r.id === ruleId);
    const datedRow = rows.find((r) => r.title.includes("Saturday Nights"));
    expect(ruleRow?.status).toBe("merged");
    expect(datedRow?.status).toBe("active");
  });

  it("merges rule row into dated row (National Mechanics)", async () => {
    const ruleOutcome = await write(firstParty, [
      event(
        firstParty,
        {
          title: "La Diskoteka Fridays & Saturdays",
          venue: { name: "National Mechanics" },
          listing_type: "club_night",
        },
        "rule",
        { lat: 39.9496, lng: -75.1456 },
      ),
    ]);
    const ruleId = ruleOutcome.eventIds[0];
    expect(ruleId).toBeDefined();
    await db.update(events).set({ lastVerifiedAt: null }).where(eq(events.id, ruleId!));

    await write(ticketing, [
      event(
        ticketing,
        {
          title: "1er Aniversario de la Discoteka",
          dancing_time: "21:00",
          venue: { name: "National Mechanics Bar and Restaurant" },
          listing_type: "club_night",
        },
        "dated",
        { lat: 39.951, lng: -75.148 },
      ),
    ]);

    const report = await dedupeMetro(db, metro, ["2026-10-31"]);
    expect(report.merged).toBe(1);
    expect(report.mergedPairs[0]!.by).toBe("weekly");
  });

  it("keeps timed far apart (different start times)", async () => {
    const ruleOutcome = await write(firstParty, [
      event(
        firstParty,
        {
          title: "Salsa Tuesdays",
          dancing_time: "21:00",
          venue: { name: "Studio A" },
          listing_type: "class",
        },
        "rule",
        VENUE_POINT_A,
      ),
    ]);
    const ruleId = ruleOutcome.eventIds[0];
    expect(ruleId).toBeDefined();
    await db.update(events).set({ lastVerifiedAt: null }).where(eq(events.id, ruleId!));

    await write(ticketing, [
      event(
        ticketing,
        {
          title: "Bachata Workshop",
          dancing_time: "18:00",
          venue: { name: "Studio A" },
          listing_type: "class",
        },
        "dated",
        VENUE_POINT_A,
      ),
    ]);

    const report = await dedupeMetro(db, metro, ["2026-10-31"]);
    expect(report.merged).toBe(0);
    const rows = await db.select().from(events).where(eq(events.nightDate, "2026-10-31"));
    expect(rows.filter((r) => r.status === "active")).toHaveLength(2);
  });

  it("keeps other venue nearby (unrelated titles)", async () => {
    const ruleOutcome = await write(firstParty, [
      event(
        firstParty,
        {
          title: "Saturdays at Ohm Lounge",
          venue: { name: "Ohm Lounge" },
          listing_type: "club_night",
        },
        "rule",
        VENUE_POINT_A,
      ),
    ]);
    const ruleId = ruleOutcome.eventIds[0];
    expect(ruleId).toBeDefined();
    await db.update(events).set({ lastVerifiedAt: null }).where(eq(events.id, ruleId!));

    await write(ticketing, [
      event(
        ticketing,
        {
          title: "Republic NOLA Party",
          dancing_time: "22:00",
          venue: { name: "Republic NOLA" },
          listing_type: "club_night",
        },
        "dated",
        { lat: 29.948, lng: -90.068 }, // ~100 m away
      ),
    ]);

    const report = await dedupeMetro(db, metro, ["2026-10-31"]);
    expect(report.merged).toBe(0);
    const rows = await db.select().from(events).where(eq(events.nightDate, "2026-10-31"));
    expect(rows.filter((r) => r.status === "active")).toHaveLength(2);
  });

  it("keeps both dated rows (neither is rule)", async () => {
    await write(firstParty, [
      event(
        firstParty,
        {
          title: "Saturdays at OHM Lounge",
          dancing_time: "20:00",
          venue: { name: "Ohm Lounge" },
          listing_type: "club_night",
        },
        "dated1",
        VENUE_POINT_A,
      ),
    ]);
    await write(ticketing, [
      event(
        ticketing,
        {
          title: "A Nightmare on Ohm St",
          venue: { name: "Ohm Lounge" },
          listing_type: "club_night",
        },
        "dated2",
        VENUE_POINT_A,
      ),
    ]);

    const report = await dedupeMetro(db, metro, ["2026-10-31"]);
    expect(report.merged).toBe(0);
    const rows = await db.select().from(events).where(eq(events.nightDate, "2026-10-31"));
    expect(rows.filter((r) => r.status === "active")).toHaveLength(2);
  });

  it("keeps cancelled dated side", async () => {
    const ruleOutcome = await write(firstParty, [
      event(
        firstParty,
        {
          title: "Saturdays at OHM Lounge",
          venue: { name: "Ohm Lounge" },
          listing_type: "club_night",
        },
        "rule",
        VENUE_POINT_A,
      ),
    ]);
    const ruleId = ruleOutcome.eventIds[0];
    expect(ruleId).toBeDefined();
    await db.update(events).set({ lastVerifiedAt: null }).where(eq(events.id, ruleId!));

    await write(ticketing, [
      event(
        ticketing,
        {
          title: "Saturday Nights @ Ohm Lounge",
          dancing_time: "22:00",
          venue: { name: "Ohm Lounge" },
          cancelled: true,
          listing_type: "club_night",
        },
        "dated",
        VENUE_POINT_A,
      ),
    ]);

    const report = await dedupeMetro(db, metro, ["2026-10-31"]);
    expect(report.merged).toBe(0);
    const rows = await db.select().from(events).where(eq(events.nightDate, "2026-10-31"));
    expect(rows.filter((r) => r.status === "active")).toHaveLength(1);
    expect(rows.find((r) => r.title.includes("Saturday Nights"))?.confirmation).toBe("cancelled");
  });

  it("merges rule row only once with multiple dated rows", async () => {
    const ruleOutcome = await write(firstParty, [
      event(
        firstParty,
        {
          title: "Saturdays at OHM Lounge",
          venue: { name: "Ohm Lounge" },
          listing_type: "club_night",
        },
        "rule",
        VENUE_POINT_A,
      ),
    ]);
    const ruleId = ruleOutcome.eventIds[0];
    expect(ruleId).toBeDefined();
    await db.update(events).set({ lastVerifiedAt: null }).where(eq(events.id, ruleId!));

    await write(ticketing, [
      event(
        ticketing,
        {
          title: "Saturday Nights @ Ohm Lounge",
          dancing_time: "22:00",
          venue: { name: "Ohm Lounge" },
          listing_type: "club_night",
        },
        "dated1",
        VENUE_POINT_A,
      ),
    ]);
    const thirdSource = await upsertSource(db, metro.id, {
      url: "https://example.org/",
      kind: "html",
      trustTier: "unofficial",
      discoveredBy: "seed_list",
    });
    await write(thirdSource, [
      event(
        thirdSource,
        {
          title: "A Nightmare on Ohm St",
          dancing_time: "23:00",
          venue: { name: "Ohm Lounge" },
          listing_type: "club_night",
        },
        "dated2",
        VENUE_POINT_A,
      ),
    ]);

    const report = await dedupeMetro(db, metro, ["2026-10-31"]);
    expect(report.merged).toBe(1);
    const rows = await db.select().from(events).where(eq(events.nightDate, "2026-10-31"));
    const ruleRow = rows.find((r) => r.id === ruleId);
    expect(ruleRow?.status).toBe("merged");
    expect(rows.filter((r) => r.status === "active")).toHaveLength(2);
  });

  it("respects manual_distinct", async () => {
    const ruleOutcome = await write(firstParty, [
      event(
        firstParty,
        {
          title: "Saturdays at OHM Lounge",
          venue: { name: "Ohm Lounge" },
          listing_type: "club_night",
        },
        "rule",
        VENUE_POINT_A,
      ),
    ]);
    const ruleId = ruleOutcome.eventIds[0];
    expect(ruleId).toBeDefined();
    await db.update(events).set({ lastVerifiedAt: null }).where(eq(events.id, ruleId!));

    const datedOutcome = await write(ticketing, [
      event(
        ticketing,
        {
          title: "Saturday Nights @ Ohm Lounge",
          dancing_time: "22:00",
          venue: { name: "Ohm Lounge" },
          listing_type: "club_night",
        },
        "dated",
        VENUE_POINT_A,
      ),
    ]);
    const datedId = datedOutcome.eventIds[0];
    expect(datedId).toBeDefined();

    // Record manual distinct
    await db.insert(mergeDecisions).values({
      id: pipelineId("merge", `${ruleId!}:${datedId!}`),
      eventA: ruleId!,
      eventB: datedId!,
      score: 0,
      decision: "manual_distinct",
      reasoning: "{}",
    });

    const report = await dedupeMetro(db, metro, ["2026-10-31"]);
    expect(report.merged).toBe(0);
  });

  it("keeps different listing types (Maison case)", async () => {
    const ruleOutcome = await write(firstParty, [
      event(
        firstParty,
        {
          title: "Dance Party",
          dancing_time: "23:00",
          venue: { name: "Maison" },
          listing_type: "club_night",
        },
        "rule",
        VENUE_POINT_A,
      ),
    ]);
    const ruleId = ruleOutcome.eventIds[0];
    expect(ruleId).toBeDefined();
    await db.update(events).set({ lastVerifiedAt: null }).where(eq(events.id, ruleId!));

    await write(ticketing, [
      event(
        ticketing,
        {
          title: "Smoking Time Jazz Club",
          dancing_time: "22:00",
          venue: { name: "Maison" },
          listing_type: "live_music_with_dancing",
        },
        "dated",
        VENUE_POINT_A,
      ),
    ]);

    const report = await dedupeMetro(db, metro, ["2026-10-31"]);
    expect(report.merged).toBe(0);
    const rows = await db.select().from(events).where(eq(events.nightDate, "2026-10-31"));
    expect(rows.filter((r) => r.status === "active")).toHaveLength(2);
  });

  it("merges the Maison rule row into a same-type dated row 1 hour earlier (control)", async () => {
    const ruleOutcome = await write(firstParty, [
      event(
        firstParty,
        {
          title: "Dance Party",
          dancing_time: "23:00",
          venue: { name: "Maison" },
          listing_type: "club_night",
        },
        "rule",
        VENUE_POINT_A,
      ),
    ]);
    const ruleId = ruleOutcome.eventIds[0];
    expect(ruleId).toBeDefined();
    await db.update(events).set({ lastVerifiedAt: null }).where(eq(events.id, ruleId!));

    await write(ticketing, [
      event(
        ticketing,
        {
          title: "Halloween Dance Party",
          dancing_time: "22:00",
          venue: { name: "Maison" },
          listing_type: "club_night",
        },
        "dated",
        VENUE_POINT_A,
      ),
    ]);

    const report = await dedupeMetro(db, metro, ["2026-10-31"]);
    expect(report.merged).toBe(1);
    const rows = await db.select().from(events).where(eq(events.nightDate, "2026-10-31"));
    expect(rows.filter((r) => r.status === "active")).toHaveLength(1);
  });

  it("merges rule row into dated row with second venue record (Ohm three rows)", async () => {
    const ruleOutcome = await write(firstParty, [
      event(
        firstParty,
        {
          title: "Saturdays at OHM Lounge",
          venue: { name: "Ohm Lounge" },
          listing_type: "club_night",
        },
        "rule",
        VENUE_POINT_A,
      ),
    ]);
    const ruleId = ruleOutcome.eventIds[0];
    expect(ruleId).toBeDefined();
    await db.update(events).set({ lastVerifiedAt: null }).where(eq(events.id, ruleId!));

    // Dated row on second venue record
    const datedOutcome = await write(ticketing, [
      event(
        ticketing,
        {
          title: "Saturday Nights @ Ohm Lounge | Open Format",
          dancing_time: "22:00",
          venue: { name: "Ohm Lounge, Tchoupitoulas Street" },
          listing_type: "club_night",
        },
        "dated1",
        VENUE_POINT_B,
      ),
    ]);
    const datedId = datedOutcome.eventIds[0];
    expect(datedId).toBeDefined();

    const thirdSource = await upsertSource(db, metro.id, {
      url: "https://example.org/",
      kind: "html",
      trustTier: "unofficial",
      discoveredBy: "seed_list",
    });
    await write(thirdSource, [
      event(
        thirdSource,
        {
          title: "A Nightmare on Ohm St",
          dancing_time: "23:00",
          venue: { name: "Ohm Lounge" },
          listing_type: "club_night",
        },
        "dated2",
        VENUE_POINT_A,
      ),
    ]);

    const report = await dedupeMetro(db, metro, ["2026-10-31"]);
    expect(report.merged).toBe(1);
    const rows = await db.select().from(events).where(eq(events.nightDate, "2026-10-31"));
    const ruleRow = rows.find((r) => r.id === ruleId);
    const datedRow = rows.find((r) => r.id === datedId);
    expect(ruleRow?.status).toBe("merged");
    expect(datedRow?.status).toBe("active");
    expect(ruleRow?.mergedIntoId).toBe(datedId);
    // The other dated row should be active
    expect(rows.filter((r) => r.status === "active")).toHaveLength(2);
  });

  it("formatDedupeReport includes weekly wording", () => {
    const report: DedupeReport = {
      ...EMPTY_DEDUPE_REPORT,
      mergedPairs: [
        {
          night: "2026-10-31",
          survivor: "Saturday Nights",
          merged: "Saturdays at OHM Lounge",
          by: "weekly",
          conflicting: false,
        },
      ],
    };
    const lines = formatDedupeReport(report);
    expect(
      lines.some((l) => l.includes("a weekly rule night yields to a dated night at the venue")),
    ).toBe(true);
  });
});
