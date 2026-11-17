import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";

import type { HarvestedListing, Metro, Source } from "@/src/adapters/types";
import type { Db } from "@/src/db/client";
import { eventSources, events, fieldProvenance, mergeDecisions, metros } from "@/src/db/schema";
import { rawListingSchema } from "@/src/domain/listing";
import { EMPTY_BLOCKLIST } from "@/src/pipeline/blocklist";
import { dedupeMetro } from "@/src/pipeline/dedupe";
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

const NOW = new Date("2026-09-23T16:00:00Z");
let db: Db;
let metro: Metro;
let organizerFeed: Source;
let ticketing: Source;

const COPA = { lat: 40.7652, lng: -73.9942 };
const W14 = { lat: 40.7398, lng: -74.0012 };

function event(
  source: Source,
  fields: Record<string, unknown>,
  at: typeof COPA,
  id: string | null,
) {
  const harvested: HarvestedListing = {
    listing: rawListingSchema.parse({
      listing_type: "social",
      styles: [],
      venue: {},
      organizer: {},
      local_date: "2026-09-25",
      ...fields,
    }),
    externalId: id,
    tz: null,
    venueLocation: at,
    recurrence: null,
    provenance: { sourceUrl: `${source.url}#${id ?? "page"}`, fetchedAt: NOW, method: "feed" },
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

describeDb("dedupe and merge, against Postgres", () => {
  beforeAll(async () => {
    db = await testDb("dedupe");
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
    organizerFeed = await upsertSource(db, metro.id, {
      url: "https://salsa.example/calendar",
      kind: "feed_ics",
      trustTier: "first_party",
      discoveredBy: "seed_list",
    });
    ticketing = await upsertSource(db, metro.id, {
      url: "https://tickets.example/o/salsa",
      kind: "ticketing_api",
      trustTier: "ticketing",
      discoveredBy: "seed_list",
    });
  });

  it("merges one night listed twice into the first-party listing, keeping both sources and both times", async () => {
    const own = event(
      organizerFeed,
      {
        title: "Salsa Social at Copacabana",
        dancing_time: "21:00",
        venue: { name: "Copacabana" },
        organizer: { name: "Salsa NYC" },
        ticket_url: "https://tickets.example/e/salsa-0925",
      },
      COPA,
      "own-1",
    );
    const tix = event(
      ticketing,
      {
        title: "Salsa Social @ Copacabana",
        dancing_time: "21:30",
        venue: { name: "Copacabana NYC" },
        organizer: { name: "Salsa NYC" },
        ticket_url: "https://tickets.example/e/salsa-0925",
      },
      COPA,
      "tix-1",
    );
    await write(ticketing, [tix]);
    await write(organizerFeed, [own]);

    const report = await dedupeMetro(db, metro, ["2026-09-25"]);
    expect(report).toMatchObject({ pairs: 1, merged: 1, linked: 0, queued: 0, conflicting: 1 });

    const ownId = pipelineId("event", `${organizerFeed.id}:own-1`);
    const tixId = pipelineId("event", `${ticketing.id}:tix-1`);
    const rows = Object.fromEntries((await db.select().from(events)).map((e) => [e.id, e]));
    expect(rows[ownId]).toMatchObject({ status: "active", confirmation: "conflicting" });
    expect(rows[ownId]?.sourceIds.sort()).toEqual([organizerFeed.id, ticketing.id].sort());
    expect(rows[tixId]).toMatchObject({ status: "merged", mergedIntoId: ownId });

    const links = await db.select().from(eventSources).where(eq(eventSources.eventId, ownId));
    expect(links.map((l) => l.role).sort()).toEqual(["primary", "secondary"]);
    // Both start times are on the survivor, so both can be shown.
    const dancing = await db
      .select({ value: fieldProvenance.value })
      .from(fieldProvenance)
      .where(
        sql`${fieldProvenance.entityId} = ${ownId} and ${fieldProvenance.field} = 'dancing_at'`,
      );
    expect(dancing.map((d) => d.value).sort()).toEqual([
      "2026-09-26T01:00:00.000Z",
      "2026-09-26T01:30:00.000Z",
    ]);
    expect(await db.select({ decision: mergeDecisions.decision }).from(mergeDecisions)).toEqual([
      { decision: "auto_merge" },
    ]);

    // A second run changes nothing: the merged listing is re-harvested but stays merged.
    await write(ticketing, [tix]);
    expect(await dedupeMetro(db, metro, ["2026-09-25"])).toMatchObject({
      pairs: 0,
      merged: 0,
      linked: 0,
      queued: 0,
      conflicting: 0,
    });
    expect((await db.select().from(events).where(eq(events.id, tixId)))[0]?.status).toBe("merged");
  });

  it("queues a likely duplicate with no shared link for the Phase 3 check, changing nothing", async () => {
    const own = event(
      organizerFeed,
      {
        title: "Salsa Social at Copacabana",
        dancing_time: "21:00",
        organizer: { name: "Salsa NYC" },
      },
      COPA,
      "own-2",
    );
    const tix = event(
      ticketing,
      {
        title: "Salsa Social @ Copacabana",
        dancing_time: "21:00",
        organizer: { name: "Salsa NYC" },
      },
      COPA,
      "tix-2",
    );
    await write(organizerFeed, [own]);
    await write(ticketing, [tix]);
    expect(await dedupeMetro(db, metro, ["2026-09-25"])).toMatchObject({
      pairs: 1,
      merged: 0,
      queued: 1,
    });
    expect((await db.select().from(events)).every((e) => e.status === "active")).toBe(true);
    expect(await db.select({ decision: mergeDecisions.decision }).from(mergeDecisions)).toEqual([
      { decision: "queued" },
    ]);
  });

  it("pairs a listing with no time with a timed one, keeps the trusted survivor and gives it the times (D-060)", async () => {
    const own = event(
      organizerFeed,
      {
        title: "Salsa Social at Copacabana",
        venue: { name: "Copacabana" },
        organizer: { name: "Salsa NYC" },
        ticket_url: "https://tickets.example/e/salsa-0925",
      },
      COPA,
      "own-untimed",
    );
    const tix = event(
      ticketing,
      {
        title: "Salsa Social @ Copacabana",
        dancing_time: "21:30",
        end_time: "01:30",
        venue: { name: "Copacabana NYC" },
        organizer: { name: "Salsa NYC" },
        ticket_url: "https://tickets.example/e/salsa-0925",
        evidence: { dancing_time: "Doors 9:30pm" },
      },
      COPA,
      "tix-timed",
    );
    expect(own.startsAt).toBeNull();
    await write(organizerFeed, [own]);
    await write(ticketing, [tix]);

    // One source not listing a time is not a second value: merged, never conflicting.
    expect(await dedupeMetro(db, metro, ["2026-09-25"])).toMatchObject({
      pairs: 1,
      merged: 1,
      linked: 0,
      queued: 0,
      conflicting: 0,
    });
    const ownId = pipelineId("event", `${organizerFeed.id}:own-untimed`);
    const tixId = pipelineId("event", `${ticketing.id}:tix-timed`);
    const survivor = async () => (await db.select().from(events).where(eq(events.id, ownId)))[0];
    expect(await survivor()).toMatchObject({ status: "active", confirmation: "confirmed_today" });
    expect((await survivor())?.dancingAt?.toISOString()).toBe("2026-09-26T01:30:00.000Z");
    expect((await survivor())?.startsAt?.toISOString()).toBe("2026-09-26T01:30:00.000Z");
    expect((await survivor())?.endsAt?.toISOString()).toBe("2026-09-26T05:30:00.000Z");
    expect((await db.select().from(events).where(eq(events.id, tixId)))[0]).toMatchObject({
      status: "merged",
      mergedIntoId: ownId,
    });
    // The times carry the ticketing source's provenance.
    const timeFacts = async () =>
      db
        .select()
        .from(fieldProvenance)
        .where(
          sql`${fieldProvenance.entityId} = ${ownId} and ${fieldProvenance.field} in ('dancing_at', 'ends_at')`,
        );
    expect(
      (await timeFacts()).map((f) => [f.field, f.sourceId, f.evidence, f.isCurrent]).sort(),
    ).toEqual([
      ["dancing_at", ticketing.id, "Doors 9:30pm", true],
      ["ends_at", ticketing.id, null, true],
    ]);

    // The organiser's next harvest still lists no time: the survivor keeps the merged times.
    await write(organizerFeed, [own]);
    expect((await survivor())?.dancingAt?.toISOString()).toBe("2026-09-26T01:30:00.000Z");
    expect((await timeFacts()).every((f) => f.isCurrent)).toBe(true);
    expect(await dedupeMetro(db, metro, ["2026-09-25"])).toMatchObject({ pairs: 0, merged: 0 });
  });

  it("keeps a survivor's own listed end when it takes a merged start", async () => {
    const own = event(
      organizerFeed,
      {
        title: "Salsa Social at Copacabana",
        end_time: "02:00",
        organizer: { name: "Salsa NYC" },
        ticket_url: "https://tickets.example/e/salsa-0925",
      },
      COPA,
      "own-end",
    );
    const tix = event(
      ticketing,
      {
        title: "Salsa Social @ Copacabana",
        dancing_time: "21:00",
        end_time: "01:00",
        organizer: { name: "Salsa NYC" },
        ticket_url: "https://tickets.example/e/salsa-0925",
      },
      COPA,
      "tix-end",
    );
    await write(organizerFeed, [own]);
    await write(ticketing, [tix]);
    expect(await dedupeMetro(db, metro, ["2026-09-25"])).toMatchObject({ merged: 1 });
    const ownId = pipelineId("event", `${organizerFeed.id}:own-end`);
    const [row] = await db.select().from(events).where(eq(events.id, ownId));
    expect(row?.dancingAt?.toISOString()).toBe("2026-09-26T01:00:00.000Z");
    expect(row?.endsAt?.toISOString()).toBe("2026-09-26T06:00:00.000Z");
    const ends = await db
      .select({ sourceId: fieldProvenance.sourceId })
      .from(fieldProvenance)
      .where(sql`${fieldProvenance.entityId} = ${ownId} and ${fieldProvenance.field} = 'ends_at'`);
    expect(ends).toEqual([{ sourceId: organizerFeed.id }]);
  });

  it("merges The Ronda's copy of a night by name and place, whatever its time (D-146)", async () => {
    // theronda.us prints every start 4 hours early (seed flag startTimesShifted).
    const ronda = await upsertSource(db, metro.id, {
      url: "https://theronda.us/nyc",
      kind: "html",
      trustTier: "directory",
      discoveredBy: "seed_list",
    });
    const fields = { title: "La Nacional", venue: { name: "La Nacional" } };
    await write(organizerFeed, [
      event(organizerFeed, { ...fields, dancing_time: "21:00" }, W14, "nyt"),
    ]);
    await write(ronda, [event(ronda, { ...fields, lesson_time: "19:00" }, W14, "ronda")]);
    expect(await dedupeMetro(db, metro, ["2026-09-25"])).toMatchObject({ merged: 1 });
    expect(await db.select().from(events).where(eq(events.status, "active"))).toHaveLength(1);
    const active = await db.select().from(events).where(eq(events.status, "active"));
    expect(active[0]?.startsAt?.toISOString()).toBe("2026-09-26T01:00:00.000Z");
    expect(active[0]?.confirmation).not.toBe("conflicting");
    // Check merge decision reasoning
    const decisions = await db.select().from(mergeDecisions);
    expect(decisions).toHaveLength(1);
    const reasoning = JSON.parse(decisions[0]?.reasoning || "{}");
    expect(reasoning.isShifted).toBe(true);
  });

  it("merges The Ronda's copy when venue names contain each other (D-146)", async () => {
    // theronda.us misplaces venues: "Ripley Grier Studios - Midtown" vs "Ripley-Grier Studios"
    const ronda = await upsertSource(db, metro.id, {
      url: "https://theronda.us/nyc",
      kind: "html",
      trustTier: "directory",
      discoveredBy: "seed_list",
    });
    // Different points to ensure they're distinct venues
    const rondaVenue = { name: "Ripley Grier Studios - Midtown" };
    const orgVenue = { name: "Ripley-Grier Studios" };
    // Ronda's point at COPA, organizer's point at W14 (different location)
    await write(organizerFeed, [
      event(
        organizerFeed,
        {
          title: "Victoria's Milonga",
          dancing_time: "19:30",
          venue: orgVenue,
        },
        W14,
        "org",
      ),
    ]);
    await write(ronda, [
      event(
        ronda,
        {
          title: "Victoria's Milonga",
          lesson_time: "15:30",
          venue: rondaVenue,
        },
        COPA,
        "ronda",
      ),
    ]);
    // Should merge because one venue name contains the other and Ronda is shifted
    expect(await dedupeMetro(db, metro, ["2026-09-25"])).toMatchObject({ merged: 1 });
    const active = await db.select().from(events).where(eq(events.status, "active"));
    expect(active).toHaveLength(1);
    // Should keep organizerFeed's start time (19:30 NY = 2026-09-25T23:30:00.000Z)
    expect(active[0]?.startsAt?.toISOString()).toBe("2026-09-25T23:30:00.000Z");
  });

  it("does not merge when venue names contain each other but neither source is shifted", async () => {
    // Both sources are non-shifted: organizerFeed and ticketing
    const orgVenue = { name: "Ripley-Grier Studios" };
    const tixVenue = { name: "Ripley Grier Studios - Midtown" };
    // Use different points to ensure they're distinct venues
    const point1 = { lat: 40.7, lng: -73.95 }; // Different from COPA and W14
    const point2 = { lat: 40.8, lng: -74.0 };
    await write(organizerFeed, [
      event(
        organizerFeed,
        {
          title: "Victoria's Milonga",
          dancing_time: "19:30",
          venue: orgVenue,
        },
        point1,
        "org",
      ),
    ]);
    await write(ticketing, [
      event(
        ticketing,
        {
          title: "Victoria's Milonga",
          dancing_time: "19:30",
          venue: tixVenue,
        },
        point2,
        "tix",
      ),
    ]);
    // Should NOT merge because neither source is shifted
    expect(await dedupeMetro(db, metro, ["2026-09-25"])).toMatchObject({ merged: 0 });
    // Also check that they're not even candidates (pairs may be 0 or 1 but not merged)
    const report = await dedupeMetro(db, metro, ["2026-09-25"]);
    // If they are candidates (due to other venue conditions), they shouldn't merge
    if (report.pairs > 0) {
      expect(report.merged).toBe(0);
    }
  });

  it("finds two listings of one night with no time at one venue as a candidate pair", async () => {
    await write(organizerFeed, [
      event(organizerFeed, { title: "Brooklyn Social", organizer: { name: "BK" } }, W14, "a"),
    ]);
    await write(ticketing, [
      event(ticketing, { title: "Brooklyn Social", organizer: { name: "BK" } }, W14, "b"),
    ]);
    // Same title and organiser, no shared link or placed venue: title similarity 1.0.
    // With the new rule, untimed listings with high title similarity should merge.
    expect(await dedupeMetro(db, metro, ["2026-09-25"])).toMatchObject({
      pairs: 1,
      merged: 1,
      linked: 0,
      queued: 0,
      conflicting: 0,
    });
    expect(await db.select({ decision: mergeDecisions.decision }).from(mergeDecisions)).toEqual([
      { decision: "auto_merge" },
    ]);
  });

  it("never stamps a merged listing's times on a night it has left (review, 2026-09-28)", async () => {
    const fields = {
      title: "Salsa Social at Copacabana",
      venue: { name: "Copacabana" },
      organizer: { name: "Salsa NYC" },
      ticket_url: "https://tickets.example/e/salsa-0925",
    };
    const own = event(organizerFeed, fields, COPA, "own-untimed");
    const tix = (night: string) =>
      event(ticketing, { ...fields, dancing_time: "21:30", local_date: night }, COPA, "tix-moves");
    await write(organizerFeed, [own]);
    await write(ticketing, [tix("2026-09-25")]);
    expect(await dedupeMetro(db, metro, ["2026-09-25"])).toMatchObject({ merged: 1 });

    // The ticket listing keeps its id and moves a week; the organiser still lists no time.
    await write(ticketing, [tix("2026-10-02")]);
    await write(organizerFeed, [own]);
    const ownId = pipelineId("event", `${organizerFeed.id}:own-untimed`);
    const [survivor] = await db.select().from(events).where(eq(events.id, ownId));
    expect(survivor?.nightDate).toBe("2026-09-25");
    expect(survivor?.startsAt).toBeNull();
  });

  it("judges each pair on the times it has now, so one unknown start cannot absorb two sessions", async () => {
    const directory = await upsertSource(db, metro.id, {
      url: "https://listings.example/nyc",
      kind: "html",
      trustTier: "directory",
      discoveredBy: "seed_list",
    });
    const fields = {
      title: "Salsa Social at Copacabana",
      venue: { name: "Copacabana" },
      organizer: { name: "Salsa NYC" },
      ticket_url: "https://tickets.example/e/salsa-0925",
    };
    await write(organizerFeed, [event(organizerFeed, fields, COPA, "own-untimed")]);
    await write(ticketing, [event(ticketing, { ...fields, dancing_time: "19:00" }, COPA, "early")]);
    await write(directory, [event(directory, { ...fields, dancing_time: "22:30" }, COPA, "late")]);

    // The untimed listing pairs with both; once it takes one time, the other is 3.5 hours away.
    const report = await dedupeMetro(db, metro, ["2026-09-25"]);
    expect(report.merged).toBe(1);
    const active = await db.select().from(events).where(eq(events.status, "active"));
    expect(active).toHaveLength(2);
    expect(active.every((e) => e.startsAt !== null)).toBe(true);
  });

  it("merges a source's next copy of a night into the survivor its earlier copy joined", async () => {
    const directory = await upsertSource(db, metro.id, {
      url: "https://listings.example/nyc",
      kind: "html",
      trustTier: "directory",
      discoveredBy: "seed_list",
    });
    const fields = {
      title: "Salsa Social at Copacabana",
      venue: { name: "Copacabana" },
      organizer: { name: "Salsa NYC" },
      ticket_url: "https://tickets.example/e/salsa-0925",
    };
    // Run 1: the directory's copy (read from its page, no id) merges into the organiser's.
    await write(organizerFeed, [
      event(organizerFeed, { ...fields, dancing_time: "21:00" }, COPA, "own"),
    ]);
    await write(directory, [event(directory, { ...fields, dancing_time: "21:00" }, COPA, null)]);
    expect(await dedupeMetro(db, metro, ["2026-09-25"])).toMatchObject({ merged: 1 });

    // Run 2: the directory's page drops the time. Its new copy has a new key, and must not stand
    // beside the organiser's listing as a second card for the same night.
    await write(directory, [event(directory, fields, COPA, null)]);
    expect(await dedupeMetro(db, metro, ["2026-09-25"])).toMatchObject({ merged: 1 });
    const active = await db.select().from(events).where(eq(events.status, "active"));
    expect(active.map((e) => e.id)).toEqual([pipelineId("event", `${organizerFeed.id}:own`)]);
  });

  it("merges when one title is a whole-word prefix of the other (lineup appended)", async () => {
    const short = event(
      organizerFeed,
      {
        title: "Marsolo, Jack Marlow, cutback! + friends",
        dancing_time: "21:00",
        venue: { name: "Elsewhere" },
      },
      COPA,
      "short",
    );
    const long = event(
      ticketing,
      {
        title: "Marsolo, Jack Marlow, cutback! + friends: LILLE, Dylan Rhee",
        dancing_time: "21:00",
        venue: { name: "Elsewhere" },
      },
      COPA,
      "long",
    );
    await write(organizerFeed, [short]);
    await write(ticketing, [long]);
    const report = await dedupeMetro(db, metro, ["2026-09-25"]);
    expect(report).toMatchObject({ merged: 1 });
  });

  it("does not merge prefix shorter than min chars or not at word boundary", async () => {
    const a = event(
      organizerFeed,
      {
        title: "Salsa Social",
        dancing_time: "21:00",
        venue: { name: "Copacabana" },
      },
      COPA,
      "a",
    );
    const b = event(
      ticketing,
      {
        title: "Salsa Socials Night",
        dancing_time: "21:00",
        venue: { name: "Copacabana" },
      },
      COPA,
      "b",
    );
    await write(organizerFeed, [a]);
    await write(ticketing, [b]);
    const report = await dedupeMetro(db, metro, ["2026-09-25"]);
    // The trigram similarity is low, and prefix is not a whole word (or too short).
    expect(report).toMatchObject({ merged: 0 });
  });

  it("keeps two different nights at one address distinct", async () => {
    // Tango La Nacional and Blues Dance New York share 239 W 14th St (SOURCES 8).
    const tango = event(
      organizerFeed,
      {
        title: "Tango La Nacional Milonga",
        dancing_time: "21:00",
        venue: { name: "239 W 14th St" },
      },
      W14,
      "t",
    );
    const blues = event(
      ticketing,
      { title: "Blues Dance New York", dancing_time: "21:00", venue: { name: "239 W 14th St" } },
      W14,
      "b",
    );
    await write(organizerFeed, [tango]);
    await write(ticketing, [blues]);
    const report = await dedupeMetro(db, metro, ["2026-09-25"]);
    expect(report).toMatchObject({ pairs: 1, merged: 0 });
    expect((await db.select().from(events)).every((e) => e.status === "active")).toBe(true);
  });

  it("merges a shifted source's listing despite time difference", async () => {
    // Create a source with startTimesShifted
    const shiftedSource = await upsertSource(db, metro.id, {
      url: "https://theronda.us/nyc",
      kind: "html",
      trustTier: "directory",
      discoveredBy: "seed_list",
    });
    // The METRO_SOURCES config for NYC includes this URL with startTimesShifted: true
    const fields = { title: "Sample Salsa Social", venue: { name: "Test Venue" } };
    await write(organizerFeed, [
      event(organizerFeed, { ...fields, dancing_time: "21:00" }, W14, "org"),
    ]);
    await write(shiftedSource, [
      event(shiftedSource, { ...fields, dancing_time: "19:00" }, W14, "shifted"),
    ]);
    // Should merge despite 2-hour difference because shifted source's times are ignored
    expect(await dedupeMetro(db, metro, ["2026-09-25"])).toMatchObject({ merged: 1 });
    const active = await db.select().from(events).where(eq(events.status, "active"));
    expect(active).toHaveLength(1);
    expect(active[0]?.startsAt?.toISOString()).toBe("2026-09-26T01:00:00.000Z");
  });
});
