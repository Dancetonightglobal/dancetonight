import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { HarvestedListing, Metro, Source } from "@/src/adapters/types";
import type { Db } from "@/src/db/client";
import { eventSources, events, fieldProvenance, metros, sources, venues } from "@/src/db/schema";
import { rawListingSchema } from "@/src/domain/listing";
import { buildBlocklist, EMPTY_BLOCKLIST } from "@/src/pipeline/blocklist";
import { normalizeListing, type NormalizedEvent } from "@/src/pipeline/normalize";
import {
  clearPlaceholderTimes,
  copyTimesFromMerged,
  droppedBySource,
  loadMetro,
  loadSources,
  pipelineId,
  recordFetch,
  mergeInto,
  recordHealth,
  resolveVenue,
  retireClearedPlaceholders,
  retireInventedMidnights,
  retireSameSourceSiblings,
  retireSameSourceTwins,
  retireMovedCopies,
  upsertSource,
  writeEvents,
} from "@/src/pipeline/store";
import { closeTestDb, describeDb, requireDbInCi, resetDb, testDb } from "@/tests/unit/db-harness";

requireDbInCi();

const NOW = new Date("2026-09-23T16:00:00Z");
const METRO_ID = "11111111-1111-4111-8111-111111111111";

let db: Db;
let metro: Metro;
let source: Source;

function normalized(
  fields: Record<string, unknown>,
  extra: Partial<HarvestedListing> = {},
): NormalizedEvent {
  const outcome = normalizeListing(
    {
      listing: rawListingSchema.parse({
        listing_type: "social",
        styles: [],
        venue: {},
        organizer: {},
        ...fields,
      }),
      externalId: null,
      tz: null,
      venueLocation: null,
      recurrence: null,
      provenance: { sourceUrl: "https://salsa.example/calendar", fetchedAt: NOW, method: "feed" },
      ...extra,
    },
    { metro, source, now: NOW },
  );
  if (!outcome.ok) throw new Error(outcome.reason);
  return outcome.event;
}

const place = (input: Parameters<typeof resolveVenue>[2]) => resolveVenue(db, metro, input);

describeDb("the write path, against Postgres with PostGIS", () => {
  beforeAll(async () => {
    db = await testDb("store");
  });
  afterAll(closeTestDb);

  beforeEach(async () => {
    await resetDb();
    await db.insert(metros).values({
      id: METRO_ID,
      slug: "nyc",
      name: "New York",
      countryCode: "US",
      center: { lat: 40.7128, lng: -74.006 },
      radiusKm: 50,
      tz: "America/New_York",
      languages: ["en"],
      status: "active",
    });
    metro = (await loadMetro(db, "nyc"))!;
    source = await upsertSource(db, metro.id, {
      url: "https://salsa.example/calendar",
      kind: "feed_ics",
      trustTier: "first_party",
      discoveredBy: "feed_ics",
      styles: ["salsa"],
    });
  });

  it("loads the metro with its centre as a point", () => {
    expect(metro.center.lat).toBeCloseTo(40.7128, 4);
    expect(metro.center.lng).toBeCloseTo(-74.006, 4);
  });

  it("upserts a source by URL and lists it", async () => {
    const again = await upsertSource(db, metro.id, {
      url: "https://salsa.example/calendar",
      kind: "feed_ics",
      trustTier: "first_party",
      discoveredBy: "feed_ics",
      feedUrl: "https://salsa.example/calendar.ics",
    });
    expect(again.id).toBe(source.id);
    expect(again.feedUrl).toBe("https://salsa.example/calendar.ics");
    expect(again.styles).toEqual(["salsa"]);
    expect((await loadSources(db, metro.id)).map((s) => s.url)).toEqual([
      "https://salsa.example/calendar",
    ]);
  });

  it("keeps what probing learned when the seed list upserts the page again", async () => {
    // Ingest run 9: every run re-seeds pages as "html", which reset probed feeds and Squarespace
    // collections, so nothing past the first run was ever harvested.
    const seed = {
      url: "https://swing.example/",
      kind: "html" as const,
      trustTier: "first_party" as const,
      discoveredBy: "seed_list" as const,
    };
    const page = await upsertSource(db, metro.id, seed);
    await db
      .update(sources)
      .set({ kind: "feed_ics", feedUrl: "https://swing.example/cal.ics", platform: null })
      .where(eq(sources.id, page.id));
    const again = await upsertSource(db, metro.id, seed);
    expect(again.kind).toBe("feed_ics");
    expect(again.feedUrl).toBe("https://swing.example/cal.ics");
    // A more specific kind still replaces a plain page.
    const upgraded = await upsertSource(db, metro.id, { ...seed, kind: "jsonld" });
    expect(upgraded.kind).toBe("jsonld");
  });

  it("pins a probed page back to plain HTML when the seed says platform 'probed'", async () => {
    const seed = {
      url: "https://viajando.example/",
      kind: "html" as const,
      trustTier: "first_party" as const,
      discoveredBy: "seed_list" as const,
    };
    const page = await upsertSource(db, metro.id, seed);
    // Simulate a wrong probe: page was probed into feed_ics with a feedUrl.
    await db
      .update(sources)
      .set({ kind: "feed_ics", feedUrl: "https://viajando.example/?ical=1", platform: null })
      .where(eq(sources.id, page.id));
    // Seed with platform "probed" should reset to plain HTML.
    const pinned = await upsertSource(db, metro.id, { ...seed, platform: "probed" });
    expect(pinned.kind).toBe("html");
    expect(pinned.feedUrl).toBeNull();
    expect(pinned.platform).toBe("probed");
  });

  it("writes an event with its source link and a provenance row per stated fact, and re-runs in place", async () => {
    const event = normalized(
      {
        title: "Salsa Social",
        local_date: "2026-09-25",
        dancing_time: "21:00",
        venue: { name: "Copacabana", address: "625 W 51st St" },
        organizer: { name: "Salsa NYC" },
        prices: [{ label: "Door", amount: 20, currency: "USD" }],
        evidence: { dancing_time: "Dancing from 9pm", prices: "$20 at the door" },
      },
      { venueLocation: { lat: 40.7652, lng: -73.9942 } },
    );
    const first = await writeEvents(db, {
      metro,
      source,
      events: [event],
      blocklist: EMPTY_BLOCKLIST,
      placeVenue: place,
    });
    expect(first).toMatchObject({ written: 1, unplaced: 0, blocked: 0 });

    const [row] = await db.select().from(events);
    expect(row).toMatchObject({
      title: "Salsa Social",
      nightDate: "2026-09-25",
      styles: ["salsa"],
      confirmation: "confirmed_today",
      status: "active",
      sourceIds: [source.id],
    });
    expect(row?.startsAt?.toISOString()).toBe("2026-09-26T01:00:00.000Z");
    expect(row?.venueId).not.toBeNull();
    expect(row?.organizerId).not.toBeNull();

    const links = await db.select().from(eventSources);
    expect(links).toHaveLength(1);
    const facts = await db
      .select()
      .from(fieldProvenance)
      .where(eq(fieldProvenance.entityId, row!.id));
    const byField = Object.fromEntries(facts.map((f) => [f.field, f]));
    expect(byField["dancing_at"]?.evidence).toBe("Dancing from 9pm");
    expect(byField["prices"]?.evidence).toBe("$20 at the door");
    expect(byField["styles"]?.evidence).toBe("matched in the title: Salsa Social");
    expect(byField["ticket_url"]).toBeUndefined();

    // A second harvest of the same listing updates the same rows.
    await writeEvents(db, {
      metro,
      source,
      events: [{ ...event, title: "Salsa Social!" }],
      blocklist: EMPTY_BLOCKLIST,
      placeVenue: place,
    });
    expect(await db.select({ n: sql<number>`count(*)::int` }).from(events)).toEqual([{ n: 1 }]);
    expect(await db.select({ n: sql<number>`count(*)::int` }).from(fieldProvenance)).toEqual([
      { n: facts.length },
    ]);
    expect((await db.select().from(events))[0]?.title).toBe("Salsa Social!");
  });

  it("reuses a venue within 150 m whose name matches, and creates one otherwise", async () => {
    const a = await place({
      name: "Copacabana",
      address: null,
      url: null,
      location: { lat: 40.7652, lng: -73.9942 },
    });
    expect(a?.created).toBe(true);
    const b = await place({
      name: "Copacabana NYC",
      address: null,
      url: null,
      location: { lat: 40.7655, lng: -73.9945 },
    });
    expect(b?.venueId).toBe(a?.venueId);
    expect(b?.method).toBe("near_name");
    const c = await place({ name: "Copacabana", address: null, url: null, location: null });
    expect(c?.venueId).toBe(a?.venueId);
    expect(c?.method).toBe("name_only");
    const d = await place({
      name: "Somewhere Else",
      address: null,
      url: null,
      location: { lat: 40.7652, lng: -73.9942 },
    });
    expect(d?.venueId).not.toBe(a?.venueId);
    expect(await db.select({ n: sql<number>`count(*)::int` }).from(venues)).toEqual([{ n: 2 }]);
  });

  it("uses the trigram index for name-only matches, and respects the similarity threshold", async () => {
    // Create a venue with a name that will have high similarity but not enough for VENUE_NAME_ONLY
    const venue = await place({
      name: "the blue room",
      address: null,
      url: null,
      location: { lat: 40.7, lng: -74.0 },
    });
    expect(venue).not.toBeNull();
    const venueId = venue!.venueId;

    // A listing with a name that differs by a small change (similarity between 0.8 and 1)
    // should match by name_only.
    const similar = await place({
      name: "the blue rooms", // plural adds one character, similarity ~0.8125
      address: null,
      url: null,
      location: null,
    });
    expect(similar?.venueId).toBe(venueId);
    expect(similar?.method).toBe("name_only");

    // A listing with a name that differs more (similarity below 0.8) should NOT match by name_only.
    const notSimilar = await place({
      name: "the blue room lounge", // adds a word, similarity ~0.667
      address: null,
      url: null,
      location: null,
    });
    // It should not match the existing venue; it should create a new one or match something else.
    expect(notSimilar?.venueId).not.toBe(venueId);
    // The method could be "created" or "name_only" if there's another venue with that name,
    // but we just need to ensure it's not the same venue.
    expect(notSimilar?.method).not.toBe("name_only");
  });

  it("keeps an event whose venue cannot be placed, and says so", async () => {
    const event = normalized({
      title: "Mystery social",
      local_date: "2026-09-25",
      dancing_time: "21:00",
      venue: { name: "Unknown Hall" },
    });
    const result = await writeEvents(db, {
      metro,
      source,
      events: [event],
      blocklist: EMPTY_BLOCKLIST,
      placeVenue: place,
    });
    expect(result).toMatchObject({ written: 1, unplaced: 1 });
    expect(result.notes[0]).toContain("venue not placed: Mystery social");
    expect((await db.select().from(events))[0]?.venueId).toBeNull();
  });

  it("never writes a blocklisted organizer or URL", async () => {
    const blocklist = buildBlocklist([{ patternType: "organizer", value: "opted out crew" }]);
    const event = normalized({
      title: "Private night",
      local_date: "2026-09-25",
      dancing_time: "21:00",
      organizer: { name: "Opted Out Crew" },
    });
    const result = await writeEvents(db, {
      metro,
      source,
      events: [event],
      blocklist,
      placeVenue: place,
    });
    expect(result).toMatchObject({ written: 0, blocked: 1 });
    expect(await db.select().from(events)).toEqual([]);
  });

  it("keeps a merged event merged when its source lists it again", async () => {
    const event = normalized({ title: "Salsa", local_date: "2026-09-25", dancing_time: "21:00" });
    await writeEvents(db, {
      metro,
      source,
      events: [event],
      blocklist: EMPTY_BLOCKLIST,
      placeVenue: place,
    });
    const id = pipelineId("event", `${source.id}:${event.key}`);
    await db.update(events).set({ status: "merged" }).where(eq(events.id, id));
    await writeEvents(db, {
      metro,
      source,
      events: [event],
      blocklist: EMPTY_BLOCKLIST,
      placeVenue: place,
    });
    expect((await db.select().from(events))[0]?.status).toBe("merged");
  });

  const write = (list: NormalizedEvent[], from: Source = source) =>
    writeEvents(db, {
      metro,
      source: from,
      events: list,
      blocklist: EMPTY_BLOCKLIST,
      placeVenue: place,
    });
  const factsOf = async (id: string) =>
    Object.fromEntries(
      (await db.select().from(fieldProvenance).where(eq(fieldProvenance.entityId, id))).map((f) => [
        f.field,
        f,
      ]),
    );

  it("writes an untimed event: no start, the listed night, no time provenance, a night provenance row (D-060)", async () => {
    const event = normalized(
      {
        title: "Brooklyn Social",
        local_date: "2026-09-25",
        venue: { name: "Brooklyn Commons" },
        evidence: { local_date: "Friday, September 25" },
      },
      { venueLocation: { lat: 40.6795, lng: -73.9632 } },
    );
    const result = await write([event]);
    expect(result).toMatchObject({ written: 1, untimed: 1, untimedPlaced: 1, unplaced: 0 });

    const [row] = await db.select().from(events);
    expect(row).toMatchObject({
      nightDate: "2026-09-25",
      startsAt: null,
      doorsAt: null,
      lessonAt: null,
      dancingAt: null,
      endsAt: null,
      status: "active",
    });
    expect(row?.slug).toMatch(/^brooklyn-social-2026-09-25-/);
    const facts = await factsOf(row!.id);
    for (const field of ["doors_at", "lesson_at", "dancing_at", "ends_at"]) {
      expect(facts[field], field).toBeUndefined();
    }
    expect(facts["night_date"]).toMatchObject({
      value: "2026-09-25",
      evidence: "Friday, September 25",
      isCurrent: true,
      method: "feed",
    });

    // A timed event gets a night row too, quoting the structured start when that is the evidence.
    const timed = normalized({
      title: "Salsa Social",
      local_date: "2026-09-25",
      dancing_time: "21:00",
      evidence: { start: "DTSTART 2026-09-25 21:00" },
    });
    const second = await write([timed]);
    expect(second).toMatchObject({ written: 1, untimed: 0, untimedPlaced: 0 });
    expect((await factsOf(second.eventIds[0]!))["night_date"]).toMatchObject({
      value: "2026-09-25",
      evidence: "DTSTART 2026-09-25 21:00",
    });
  });

  it("counts an untimed event whose venue cannot be placed as written and not placed", async () => {
    const result = await write([
      normalized({ title: "Mystery social", local_date: "2026-09-25", venue: { name: "Nowhere" } }),
    ]);
    expect(result).toMatchObject({ written: 1, untimed: 1, untimedPlaced: 0, unplaced: 1 });
  });

  it("follows a re-harvest that drops the time to null, and retires the earlier time provenance", async () => {
    const timed = normalized(
      {
        title: "Bachata Night",
        local_date: "2026-09-26",
        dancing_time: "22:00",
        end_time: "02:00",
      },
      { externalId: "tm:A6" },
    );
    await write([timed]);
    const id = pipelineId("event", `${source.id}:tm:A6`);
    expect((await factsOf(id))["dancing_at"]?.isCurrent).toBe(true);

    const untimed = normalized(
      { title: "Bachata Night", local_date: "2026-09-26" },
      { externalId: "tm:A6" },
    );
    const result = await write([untimed]);
    expect(result).toMatchObject({ written: 1, untimed: 1 });
    const [row] = await db.select().from(events).where(eq(events.id, id));
    expect(row).toMatchObject({
      startsAt: null,
      dancingAt: null,
      endsAt: null,
      nightDate: "2026-09-26",
    });
    const facts = await factsOf(id);
    expect(facts["dancing_at"]?.isCurrent).toBe(false);
    expect(facts["ends_at"]?.isCurrent).toBe(false);
    expect(facts["night_date"]?.isCurrent).toBe(true);
    expect(facts["title"]?.isCurrent).toBe(true);

    // The time comes back: the same rows are current again.
    await write([timed]);
    expect((await factsOf(id))["dancing_at"]?.isCurrent).toBe(true);
  });

  it("retires this source's untimed row once it lists the same night and title with a time (D-060)", async () => {
    const other = await upsertSource(db, metro.id, {
      url: "https://other.example/",
      kind: "html",
      trustTier: "first_party",
      discoveredBy: "seed_list",
    });
    const untimed = normalized({ title: "Salsa Social", local_date: "2026-09-25" });
    await write([untimed]);
    await write([untimed], other);
    const untimedId = pipelineId("event", `${source.id}:${untimed.key}`);
    const othersId = pipelineId("event", `${other.id}:${untimed.key}`);

    const timed = normalized({
      title: "Salsa Social!",
      local_date: "2026-09-25",
      dancing_time: "21:00",
    });
    const result = await write([timed]);
    const timedId = result.eventIds[0]!;
    expect(result.superseded).toBe(1);
    expect(result.notes).toContain(
      "Salsa Social!: now listed on 2026-09-25 with a time; the listing without one was merged into it",
    );
    const rows = Object.fromEntries((await db.select().from(events)).map((e) => [e.id, e]));
    expect(rows[untimedId]).toMatchObject({ status: "merged", mergedIntoId: timedId });
    expect(rows[timedId]).toMatchObject({ status: "active" });
    // Another source's listing is dedupe's business, not this rule's.
    expect(rows[othersId]).toMatchObject({ status: "active", mergedIntoId: null });

    // The next run lists the night without the time again: the retired row stays retired.
    await write([untimed]);
    expect((await db.select().from(events).where(eq(events.id, untimedId)))[0]?.status).toBe(
      "merged",
    );
  });

  it("does not write an untimed listing beside this source's timed row for the same night and title", async () => {
    await write([
      normalized({ title: "Salsa Social", local_date: "2026-09-25", dancing_time: "21:00" }),
    ]);
    const result = await write([normalized({ title: "Salsa Social", local_date: "2026-09-25" })]);
    expect(result).toMatchObject({ written: 0, untimed: 0 });
    expect(result.notes).toEqual([
      "Salsa Social: listed on 2026-09-25 with no time, and this source already lists that night with one; kept the one with the time",
    ]);
    expect(await db.select({ n: sql<number>`count(*)::int` }).from(events)).toEqual([{ n: 1 }]);
    // A different night is a different listing.
    expect(
      await write([normalized({ title: "Salsa Social", local_date: "2026-09-26" })]),
    ).toMatchObject({ written: 1, untimed: 1 });
  });

  it("never retires a midnight the page states in its own words (review, 2026-09-28)", async () => {
    const llm = (fields: Record<string, unknown>) =>
      normalized(fields, {
        fromRule: true,
        provenance: { sourceUrl: "https://salsa.example/calendar", fetchedAt: NOW, method: "llm" },
      });
    const stated = llm({
      title: "Midnight Social",
      local_date: "2026-09-28",
      dancing_time: "00:00",
      evidence: { dancing_time: "dancing from midnight" },
    });
    const [statedId] = (await write([stated])).eventIds as [string];
    // A later run lists the next night with no time under the same title.
    const later = await write([llm({ title: "Midnight Social", local_date: "2026-09-29" })]);
    const { retired } = await retireInventedMidnights(db, {
      source,
      writtenIds: later.eventIds,
      nights: ["2026-09-28", "2026-09-29"],
    });
    expect(retired).toBe(0);
    expect((await db.select().from(events).where(eq(events.id, statedId)))[0]?.status).toBe(
      "active",
    );
  });

  it("retires a twin row this source stored under another key", async () => {
    const a = normalized({
      title: "Baila Wednesdays",
      local_date: "2026-09-28",
      dancing_time: "20:00",
    });
    // First run with old key
    const first = await writeEvents(db, {
      metro,
      source,
      events: [{ ...a, key: "old-key" }],
      blocklist: EMPTY_BLOCKLIST,
      placeVenue: place,
    });
    expect(first).toMatchObject({ written: 1 });
    const firstId = first.eventIds[0]!;

    // Second run with new key (same listing, different key)
    const second = await writeEvents(db, {
      metro,
      source,
      events: [{ ...a, key: "new-key" }],
      blocklist: EMPTY_BLOCKLIST,
      placeVenue: place,
    });
    expect(second).toMatchObject({ written: 1 });
    const secondId = second.eventIds[0]!;

    // Both rows exist
    const rowsBefore = await db.select().from(events);
    expect(rowsBefore).toHaveLength(2);

    const { retired, notes } = await retireSameSourceTwins(db, {
      source,
      writtenIds: [secondId],
    });
    expect(retired).toBe(1);
    expect(notes).toEqual([
      "Baila Wednesdays: listed twice by this source on 2026-09-28 at the same time; the older copy was retired",
    ]);

    const rowsAfter = await db.select().from(events);
    const byId = Object.fromEntries(rowsAfter.map((r) => [r.id, r]));
    expect(byId[firstId]).toMatchObject({ status: "removed", mergedIntoId: secondId });
    expect(byId[secondId]).toMatchObject({ status: "active", mergedIntoId: null });
  });

  it("does not retire rows with different start times", async () => {
    const a = normalized({
      title: "Baila Wednesdays",
      local_date: "2026-09-28",
      dancing_time: "20:00",
    });
    const b = normalized({
      title: "Baila Wednesdays",
      local_date: "2026-09-28",
      dancing_time: "22:00",
    });
    // Write first event
    await writeEvents(db, {
      metro,
      source,
      events: [{ ...a, key: "old-key" }],
      blocklist: EMPTY_BLOCKLIST,
      placeVenue: place,
    });
    // Write second event with different start time
    const second = await writeEvents(db, {
      metro,
      source,
      events: [{ ...b, key: "new-key" }],
      blocklist: EMPTY_BLOCKLIST,
      placeVenue: place,
    });
    const { retired } = await retireSameSourceTwins(db, {
      source,
      writtenIds: second.eventIds,
    });
    expect(retired).toBe(0);
    // Both rows remain active
    const rows = await db.select().from(events);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.status === "active")).toBe(true);
  });

  describe("retireMovedCopies", () => {
    it("retires an unplaced older copy at another start", async () => {
      const a = normalized({
        title: "Reggae Night",
        local_date: "2026-09-28",
        dancing_time: "22:00",
        venue: {},
      });
      const b = normalized(
        {
          title: "Reggae Night",
          local_date: "2026-09-28",
          dancing_time: "23:00",
          venue: { name: "Blue Nile" },
        },
        { venueLocation: { lat: 40.7, lng: -74.0 } },
      );
      // Write first (old) copy with no venue placed
      const first = await writeEvents(db, {
        metro,
        source,
        events: [{ ...a, key: "old-key" }],
        blocklist: EMPTY_BLOCKLIST,
        placeVenue: async () => null,
      });
      expect(first).toMatchObject({ written: 1 });
      const oldId = first.eventIds[0]!;
      // Write second (new) copy
      const second = await writeEvents(db, {
        metro,
        source,
        events: [{ ...b, key: "new-key" }],
        blocklist: EMPTY_BLOCKLIST,
        placeVenue: place,
      });
      expect(second).toMatchObject({ written: 1 });
      const newId = second.eventIds[0]!;

      const { retired, notes } = await retireMovedCopies(db, {
        source,
        writtenIds: second.eventIds,
        listedIds: second.eventIds,
      });
      expect(retired).toBe(1);
      expect(notes).toEqual([
        "Reggae Night: this source now lists it on 2026-09-28 at another time; the older copy was retired",
      ]);
      const rows = await db.select().from(events);
      const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
      expect(byId[oldId]).toMatchObject({ status: "removed", mergedIntoId: newId });
      expect(byId[newId]).toMatchObject({ status: "active", mergedIntoId: null });
      expect(byId[newId]!.venueId).not.toBeNull();
    });

    it("leaves an older copy placed at another venue", async () => {
      const at = (name: string, time: string, lat: number) =>
        normalized(
          { title: "Reggae Night", local_date: "2026-09-28", dancing_time: time, venue: { name } },
          { venueLocation: { lat, lng: -74.0 } },
        );
      const first = await writeEvents(db, {
        metro,
        source,
        events: [{ ...at("Other Bar", "22:00", 40.75), key: "old-key" }],
        blocklist: EMPTY_BLOCKLIST,
        placeVenue: place,
      });
      const second = await writeEvents(db, {
        metro,
        source,
        events: [{ ...at("Blue Nile", "23:00", 40.7), key: "new-key" }],
        blocklist: EMPTY_BLOCKLIST,
        placeVenue: place,
      });
      const rows0 = await db.select().from(events);
      const venues0 = new Set(rows0.map((r) => r.venueId));
      expect(venues0.size).toBe(2);
      expect(venues0.has(null)).toBe(false);
      const { retired } = await retireMovedCopies(db, {
        source,
        writtenIds: second.eventIds,
        listedIds: second.eventIds,
      });
      expect(retired).toBe(0);
      const rows = await db.select().from(events);
      const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
      expect(byId[first.eventIds[0]!]).toMatchObject({ status: "active" });
    });

    it("leaves the old row when its start is more than 3 hours away", async () => {
      const a = normalized({
        title: "Reggae Night",
        local_date: "2026-09-28",
        dancing_time: "18:00",
        venue: {},
      });
      const b = normalized(
        {
          title: "Reggae Night",
          local_date: "2026-09-28",
          dancing_time: "22:30", // 4.5 hours later
          venue: { name: "Blue Nile" },
        },
        { venueLocation: { lat: 40.7, lng: -74.0 } },
      );
      await writeEvents(db, {
        metro,
        source,
        events: [{ ...a, key: "old-key" }],
        blocklist: EMPTY_BLOCKLIST,
        placeVenue: place,
      });
      const second = await writeEvents(db, {
        metro,
        source,
        events: [{ ...b, key: "new-key" }],
        blocklist: EMPTY_BLOCKLIST,
        placeVenue: place,
      });
      const { retired } = await retireMovedCopies(db, {
        source,
        writtenIds: second.eventIds,
        listedIds: second.eventIds,
      });
      expect(retired).toBe(0);
      const rows = await db.select().from(events);
      expect(rows).toHaveLength(2);
      expect(rows.every((r) => r.status === "active")).toBe(true);
    });

    it("leaves the old row when its title differs", async () => {
      const a = normalized({
        title: "Reggae Night",
        local_date: "2026-09-28",
        dancing_time: "22:00",
        venue: {},
      });
      const b = normalized(
        {
          title: "Soul Night",
          local_date: "2026-09-28",
          dancing_time: "23:00",
          venue: { name: "Blue Nile" },
        },
        { venueLocation: { lat: 40.7, lng: -74.0 } },
      );
      await writeEvents(db, {
        metro,
        source,
        events: [{ ...a, key: "old-key" }],
        blocklist: EMPTY_BLOCKLIST,
        placeVenue: place,
      });
      const second = await writeEvents(db, {
        metro,
        source,
        events: [{ ...b, key: "new-key" }],
        blocklist: EMPTY_BLOCKLIST,
        placeVenue: place,
      });
      const { retired } = await retireMovedCopies(db, {
        source,
        writtenIds: second.eventIds,
        listedIds: second.eventIds,
      });
      expect(retired).toBe(0);
      const rows = await db.select().from(events);
      expect(rows).toHaveLength(2);
      expect(rows.every((r) => r.status === "active")).toBe(true);
    });

    it("leaves the old row when it is in listedIds", async () => {
      const a = normalized({
        title: "Reggae Night",
        local_date: "2026-09-28",
        dancing_time: "22:00",
        venue: {},
      });
      const b = normalized(
        {
          title: "Reggae Night",
          local_date: "2026-09-28",
          dancing_time: "23:00",
          venue: { name: "Blue Nile" },
        },
        { venueLocation: { lat: 40.7, lng: -74.0 } },
      );
      const first = await writeEvents(db, {
        metro,
        source,
        events: [{ ...a, key: "old-key" }],
        blocklist: EMPTY_BLOCKLIST,
        placeVenue: place,
      });
      const oldId = first.eventIds[0]!;
      const second = await writeEvents(db, {
        metro,
        source,
        events: [{ ...b, key: "new-key" }],
        blocklist: EMPTY_BLOCKLIST,
        placeVenue: place,
      });
      const { retired } = await retireMovedCopies(db, {
        source,
        writtenIds: second.eventIds,
        listedIds: [...second.eventIds, oldId],
      });
      expect(retired).toBe(0);
      const rows = await db.select().from(events);
      expect(rows).toHaveLength(2);
      expect(rows.every((r) => r.status === "active")).toBe(true);
    });

    it("same start is not this function's case", async () => {
      const a = normalized({
        title: "Reggae Night",
        local_date: "2026-09-28",
        dancing_time: "22:00",
        venue: {},
      });
      const b = normalized(
        {
          title: "Reggae Night",
          local_date: "2026-09-28",
          dancing_time: "22:00",
          venue: { name: "Blue Nile" },
        },
        { venueLocation: { lat: 40.7, lng: -74.0 } },
      );
      await writeEvents(db, {
        metro,
        source,
        events: [{ ...a, key: "old-key" }],
        blocklist: EMPTY_BLOCKLIST,
        placeVenue: place,
      });
      const second = await writeEvents(db, {
        metro,
        source,
        events: [{ ...b, key: "new-key" }],
        blocklist: EMPTY_BLOCKLIST,
        placeVenue: place,
      });
      const { retired } = await retireMovedCopies(db, {
        source,
        writtenIds: second.eventIds,
        listedIds: second.eventIds,
      });
      expect(retired).toBe(0);
      const rows = await db.select().from(events);
      expect(rows).toHaveLength(2);
      expect(rows.every((r) => r.status === "active")).toBe(true);
    });
  });

  describe("retireSameSourceSiblings", () => {
    it("retires one of two rows with same times, different titles, same venue", async () => {
      // Create a venue first
      const venue = await place({
        name: "Test Venue",
        address: null,
        url: null,
        location: { lat: 40.7, lng: -74.0 },
      });
      expect(venue).not.toBeNull();
      const venueId = venue!.venueId;

      // Two events same night, same venue, same start/end, different titles
      const a = normalized(
        {
          title: "Sabado de Parranda",
          local_date: "2026-09-30",
          dancing_time: "17:00",
          end_time: "04:00",
          venue: { name: "Test Venue" },
        },
        { venueLocation: { lat: 40.7, lng: -74.0 } },
      );
      const b = normalized(
        {
          title: "Salsa Sundays Colombian Latin Dance Party",
          local_date: "2026-09-30",
          dancing_time: "17:00",
          end_time: "04:00",
          venue: { name: "Test Venue" },
        },
        { venueLocation: { lat: 40.7, lng: -74.0 } },
      );
      // Write both
      const resultA = await writeEvents(db, {
        metro,
        source,
        events: [a],
        blocklist: EMPTY_BLOCKLIST,
        placeVenue: place,
      });
      const resultB = await writeEvents(db, {
        metro,
        source,
        events: [b],
        blocklist: EMPTY_BLOCKLIST,
        placeVenue: place,
      });
      const writtenIds = [...resultA.eventIds, ...resultB.eventIds];
      // Ensure venueId is set (simulate placement)
      await db.update(events).set({ venueId }).where(inArray(events.id, writtenIds));

      const { retired, notes } = await retireSameSourceSiblings(db, {
        source,
        writtenIds,
      });
      expect(retired).toBe(1);
      expect(notes).toHaveLength(1);
      expect(notes[0]).toContain(
        'same night, place and times as "Salsa Sundays Colombian Latin Dance Party"',
      );
      // Check statuses
      const rows = await db.select().from(events).where(inArray(events.id, writtenIds));
      const active = rows.filter((r) => r.status === "active");
      const removed = rows.filter((r) => r.status === "removed");
      expect(active).toHaveLength(1);
      expect(removed).toHaveLength(1);
      expect(active[0]?.title).toBe("Salsa Sundays Colombian Latin Dance Party");
    });

    it("does not retire rows with same start but different end", async () => {
      const venue = await place({
        name: "Test Venue",
        address: null,
        url: null,
        location: { lat: 40.7, lng: -74.0 },
      });
      const venueId = venue!.venueId;
      const a = normalized(
        {
          title: "Event A",
          local_date: "2026-09-30",
          dancing_time: "17:00",
          end_time: "04:00",
          venue: { name: "Test Venue" },
        },
        { venueLocation: { lat: 40.7, lng: -74.0 } },
      );
      const b = normalized(
        {
          title: "Event B",
          local_date: "2026-09-30",
          dancing_time: "17:00",
          end_time: "05:00", // different end
          venue: { name: "Test Venue" },
        },
        { venueLocation: { lat: 40.7, lng: -74.0 } },
      );
      const resultA = await writeEvents(db, {
        metro,
        source,
        events: [a],
        blocklist: EMPTY_BLOCKLIST,
        placeVenue: place,
      });
      const resultB = await writeEvents(db, {
        metro,
        source,
        events: [b],
        blocklist: EMPTY_BLOCKLIST,
        placeVenue: place,
      });
      const writtenIds = [...resultA.eventIds, ...resultB.eventIds];
      await db.update(events).set({ venueId }).where(inArray(events.id, writtenIds));

      const { retired } = await retireSameSourceSiblings(db, { source, writtenIds });
      expect(retired).toBe(0);
    });

    it("retires extra time slots of same title", async () => {
      const venue = await place({
        name: "Haunted Mansion",
        address: null,
        url: null,
        location: { lat: 40.7, lng: -74.0 },
      });
      const venueId = venue!.venueId;
      const a = normalized(
        {
          title: "Mansion BK - Salsa Night Time Slot",
          local_date: "2026-09-30",
          dancing_time: "18:00",
          end_time: "19:00",
          venue: { name: "Haunted Mansion" },
        },
        { venueLocation: { lat: 40.7, lng: -74.0 } },
      );
      const b = normalized(
        {
          title: "Mansion BK - Salsa Night Time Slot",
          local_date: "2026-09-30",
          dancing_time: "19:00",
          end_time: "20:00",
          venue: { name: "Haunted Mansion" },
        },
        { venueLocation: { lat: 40.7, lng: -74.0 } },
      );
      const c = normalized(
        {
          title: "Mansion BK - Salsa Night Time Slot",
          local_date: "2026-09-30",
          dancing_time: "20:00",
          end_time: "21:00",
          venue: { name: "Haunted Mansion" },
        },
        { venueLocation: { lat: 40.7, lng: -74.0 } },
      );
      const resultA = await writeEvents(db, {
        metro,
        source,
        events: [a],
        blocklist: EMPTY_BLOCKLIST,
        placeVenue: place,
      });
      const resultB = await writeEvents(db, {
        metro,
        source,
        events: [b],
        blocklist: EMPTY_BLOCKLIST,
        placeVenue: place,
      });
      const resultC = await writeEvents(db, {
        metro,
        source,
        events: [c],
        blocklist: EMPTY_BLOCKLIST,
        placeVenue: place,
      });
      const writtenIds = [...resultA.eventIds, ...resultB.eventIds, ...resultC.eventIds];
      await db.update(events).set({ venueId }).where(inArray(events.id, writtenIds));

      const { retired, notes } = await retireSameSourceSiblings(db, { source, writtenIds });
      expect(retired).toBe(2);
      expect(notes).toHaveLength(2);
      expect(notes[0]).toContain("another time slot of the same listing");
      const rows = await db.select().from(events).where(inArray(events.id, writtenIds));
      const active = rows.filter((r) => r.status === "active");
      const removed = rows.filter((r) => r.status === "removed");
      expect(active).toHaveLength(1);
      expect(removed).toHaveLength(2);
      // 6pm in New York (EDT) is 22:00 UTC: the first slot is kept.
      expect(active[0]?.startsAt?.toISOString()).toBe("2026-09-30T22:00:00.000Z");
    });

    it("keeps two classes of one name at different times on one night (Agozar's grid, D-675)", async () => {
      const venue = await place({
        name: "Agozar",
        address: null,
        url: null,
        location: { lat: 40.7, lng: -74.0 },
      });
      const venueId = venue!.venueId;
      // agozar.com, 2026-11-01: "Tuesday ... 8pm-9pm Salsa Partner Work Drop-in Alexandre Level 2 ... 9pm-10pm
      // Salsa Partner Work Drop-in Alessio Level 3".
      const slot = (start: string, end: string) =>
        normalized(
          {
            title: "Salsa Partner Work",
            listing_type: "class",
            local_date: "2026-09-30",
            lesson_time: start,
            end_time: end,
            venue: { name: "Agozar" },
          },
          { venueLocation: { lat: 40.7, lng: -74.0 } },
        );
      const writtenIds: string[] = [];
      for (const event of [slot("20:00", "21:00"), slot("21:00", "22:00")]) {
        const result = await writeEvents(db, {
          metro,
          source,
          events: [event],
          blocklist: EMPTY_BLOCKLIST,
          placeVenue: place,
        });
        writtenIds.push(...result.eventIds);
      }
      expect(writtenIds).toHaveLength(2);
      await db.update(events).set({ venueId }).where(inArray(events.id, writtenIds));

      const { retired } = await retireSameSourceSiblings(db, { source, writtenIds });
      expect(retired).toBe(0);
      const rows = await db.select().from(events).where(inArray(events.id, writtenIds));
      expect(rows.filter((r) => r.status === "active")).toHaveLength(2);
    });

    it("lists once a class read twice with a drifted start inside its slot (D-675)", async () => {
      const venue = await place({
        name: "Agozar",
        address: null,
        url: null,
        location: { lat: 40.7, lng: -74.0 },
      });
      const venueId = venue!.venueId;
      const slot = (start: string) =>
        normalized(
          {
            title: "Salsa Partner Work",
            listing_type: "class",
            local_date: "2026-09-30",
            lesson_time: start,
            venue: { name: "Agozar" },
          },
          { venueLocation: { lat: 40.7, lng: -74.0 } },
        );
      const writtenIds: string[] = [];
      for (const event of [slot("20:00"), slot("20:15")]) {
        const result = await writeEvents(db, {
          metro,
          source,
          events: [event],
          blocklist: EMPTY_BLOCKLIST,
          placeVenue: place,
        });
        writtenIds.push(...result.eventIds);
      }
      expect(writtenIds).toHaveLength(2);
      await db.update(events).set({ venueId }).where(inArray(events.id, writtenIds));

      const { retired } = await retireSameSourceSiblings(db, { source, writtenIds });
      expect(retired).toBe(1);
      const rows = await db.select().from(events).where(inArray(events.id, writtenIds));
      const active = rows.filter((r) => r.status === "active");
      expect(active).toHaveLength(1);
      // 8pm in New York (EDT) is 00:00 UTC the next day: the first start is kept.
      expect(active[0]?.startsAt?.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    });

    it("ignores rows without start time or venue", async () => {
      const untimed = normalized({
        title: "No Time Event",
        local_date: "2026-09-30",
        venue: { name: "Somewhere" },
      });
      const result = await writeEvents(db, {
        metro,
        source,
        events: [untimed],
        blocklist: EMPTY_BLOCKLIST,
        placeVenue: place,
      });
      const { retired } = await retireSameSourceSiblings(db, {
        source,
        writtenIds: result.eventIds,
      });
      expect(retired).toBe(0);
    });
  });

  it("retires a row written at an invented midnight once the untimed listing that replaces it is written", async () => {
    const llm = (fields: Record<string, unknown>) =>
      normalized(fields, {
        fromRule: true,
        provenance: { sourceUrl: "https://salsa.example/calendar", fetchedAt: NOW, method: "llm" },
      });
    // Before D-060: "every Tuesday" with no time became dancing at 00:00 on Tuesday, which is the
    // Monday night (2026-09-28).
    const invented = llm({
      title: "English - Tuesdays",
      local_date: "2026-09-28",
      dancing_time: "00:00",
    });
    expect(invented.nightDate).toBe("2026-09-28");
    // A rule that really starts at midnight, and a dated listing at midnight: both left alone.
    const genuine = llm({
      title: "Midnight Milonga",
      local_date: "2026-09-28",
      dancing_time: "00:00",
    });
    const dated = normalized(
      { title: "Late Salsa", local_date: "2026-09-28", dancing_time: "00:00" },
      {
        provenance: { sourceUrl: "https://salsa.example/calendar", fetchedAt: NOW, method: "llm" },
      },
    );
    const old = await write([invented, genuine, dated]);
    const [inventedId, genuineId, datedId] = old.eventIds as [string, string, string];
    // Another source's duplicate that dedupe had merged into the invented row.
    const other = await upsertSource(db, metro.id, {
      url: "https://tickets.example/",
      kind: "ticketing_api",
      trustTier: "ticketing",
      discoveredBy: "seed_list",
    });
    const dupe = (await write([invented], other)).eventIds[0]!;
    await db
      .update(events)
      .set({ status: "merged", mergedIntoId: inventedId })
      .where(eq(events.id, dupe));

    // This run: the rule's nights with no time, the genuine midnight rule again, and (to prove the
    // other guards) untimed listings on the next night under the other two titles.
    const replacement = llm({ title: "English - Tuesdays", local_date: "2026-09-29" });
    const now = await write([
      replacement,
      genuine,
      llm({ title: "Midnight Milonga", local_date: "2026-09-29" }),
      llm({ title: "Late Salsa", local_date: "2026-09-29" }),
    ]);
    expect(now.written).toBe(4);
    const nights = ["2026-09-28", "2026-09-29", "2026-09-30"];
    const { retired, notes } = await retireInventedMidnights(db, {
      source,
      writtenIds: now.eventIds,
      nights,
    });
    expect(retired).toBe(1);
    expect(notes).toEqual([
      "English - Tuesdays: the listing stored at midnight on 2026-09-28 was an invented time; replaced by the listing on 2026-09-29 with no time",
    ]);
    const rows = Object.fromEntries((await db.select().from(events)).map((e) => [e.id, e]));
    expect(rows[inventedId]).toMatchObject({ status: "removed", mergedIntoId: now.eventIds[0] });
    expect(rows[now.eventIds[0]!]).toMatchObject({
      status: "active",
      startsAt: null,
      nightDate: "2026-09-29",
    });
    expect(rows[genuineId]).toMatchObject({ status: "active" });
    expect(rows[datedId]).toMatchObject({ status: "active" });
    // The duplicate no longer hides behind a retired row.
    expect(rows[dupe]).toMatchObject({ status: "active", mergedIntoId: null });

    // A rule on two days in a row ("Mondays and Tuesdays"): the Tuesday night's invented midnight
    // sits on the Monday night, beside the Monday night's own untimed listing. The invented time is
    // not a listed one, so the Monday listing is still written, and the invented row retired.
    const pair = llm({ title: "Salsa Mon & Tue", local_date: "2026-09-28", dancing_time: "00:00" });
    const pairId = (await write([pair])).eventIds[0]!;
    const next = await write([
      llm({ title: "Salsa Mon & Tue", local_date: "2026-09-28" }),
      llm({ title: "Salsa Mon & Tue", local_date: "2026-09-29" }),
    ]);
    expect(next).toMatchObject({ written: 2, untimed: 2 });
    expect(
      (await retireInventedMidnights(db, { source, writtenIds: next.eventIds, nights })).retired,
    ).toBe(1);
    expect((await db.select().from(events).where(eq(events.id, pairId)))[0]).toMatchObject({
      status: "removed",
      mergedIntoId: next.eventIds[1],
    });

    // Idempotent, and nothing to do when the replacement was not written this run.
    expect(
      (await retireInventedMidnights(db, { source, writtenIds: now.eventIds, nights })).retired,
    ).toBe(0);
  });

  it("withdraws a stored placeholder time, and the row gives way to the untimed listing that replaces it (D-065)", async () => {
    // Before D-063 The Ronda's "3:00 PM", printed on every event, was stored as the time; the next
    // run read it as not listed, and the stored 3pm stopped the untimed listing being written.
    const PLACEHOLDERS = ["15:00"];
    const nights = ["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01"];
    const llm = (fields: Record<string, unknown>) =>
      normalized(fields, {
        provenance: { sourceUrl: "https://salsa.example/calendar", fetchedAt: NOW, method: "llm" },
      });
    const old = await write([
      llm({ title: "Milonga Bienvenida", local_date: "2026-09-28", doors_time: "15:00" }),
      llm({
        title: "Tango la Nacional",
        local_date: "2026-10-01",
        doors_time: "15:00",
        end_time: "23:00",
      }),
      llm({ title: "Tea Dance", local_date: "2026-09-29", dancing_time: "16:00" }),
      llm({ title: "Esa! Milonga", local_date: "2026-09-30", doors_time: "15:00" }),
    ]);
    const [bienvenida, nacional, tea, esa] = old.eventIds as [string, string, string, string];
    // Another source's own 3pm is its own time.
    const other = await upsertSource(db, metro.id, {
      url: "https://tango.example/",
      kind: "html",
      trustTier: "first_party",
      discoveredBy: "seed_list",
    });
    const own = (
      await write(
        [normalized({ title: "Tango y Te", local_date: "2026-09-29", dancing_time: "15:00" })],
        other,
      )
    ).eventIds[0]!;
    // Another source's untimed listing that dedupe filled with this source's 3pm (D-060 point 11).
    const survivor = (
      await write([normalized({ title: "Esa! Milonga", local_date: "2026-09-30" })], other)
    ).eventIds[0]!;
    await mergeInto(db, survivor, esa);
    expect(await copyTimesFromMerged(db, survivor, esa)).toBe(true);

    await expect(
      write([llm({ title: "Tango la Nacional", local_date: "2026-10-01", end_time: "23:00" })]),
    ).resolves.toMatchObject({ written: 0 });

    const { cleared, notes } = await clearPlaceholderTimes(db, {
      source,
      placeholders: PLACEHOLDERS,
      nights,
    });
    expect(cleared).toBe(4);
    expect(notes).toEqual([
      "4 stored listing(s) showed 15:00, which this site prints on every event: that time is withdrawn",
    ]);
    const rows = async () =>
      Object.fromEntries((await db.select().from(events)).map((e) => [e.id, e]));
    let now = await rows();
    expect(now[bienvenida]).toMatchObject({ status: "active", startsAt: null, doorsAt: null });
    // The end is the site's own and stays: "Time not listed, until 11pm".
    expect(now[nacional]).toMatchObject({ startsAt: null });
    expect(now[nacional]?.endsAt?.toISOString()).toBe("2026-10-02T03:00:00.000Z");
    expect(now[tea]?.startsAt?.toISOString()).toBe("2026-09-29T20:00:00.000Z");
    expect(now[own]?.startsAt?.toISOString()).toBe("2026-09-29T19:00:00.000Z");
    expect(now[esa]).toMatchObject({ status: "merged", startsAt: null });
    expect(now[survivor]).toMatchObject({ status: "active", startsAt: null });
    expect((await factsOf(bienvenida)).doors_at).toMatchObject({ isCurrent: false });
    expect((await factsOf(survivor)).doors_at).toMatchObject({ isCurrent: false });

    // This run lists Tango la Nacional again with no time, and not Milonga Bienvenida.
    const run = await write([
      llm({ title: "Tango la Nacional", local_date: "2026-10-01", end_time: "23:00" }),
    ]);
    expect(run).toMatchObject({ written: 1, untimed: 1 });
    const replaced = await retireClearedPlaceholders(db, {
      source,
      placeholders: PLACEHOLDERS,
      writtenIds: run.eventIds,
      nights,
    });
    expect(replaced).toEqual({
      retired: 1,
      notes: [
        "Tango la Nacional: the listing stored on 2026-10-01 with this site's placeholder time was replaced by the listing with no time",
      ],
    });
    now = await rows();
    expect(now[nacional]).toMatchObject({ status: "removed", mergedIntoId: run.eventIds[0] });
    expect(now[run.eventIds[0]!]).toMatchObject({ status: "active", startsAt: null });
    expect(now[bienvenida]).toMatchObject({ status: "active", startsAt: null });

    // A later run lists Milonga Bienvenida: the row withdrawn earlier gives way then.
    const later = await write([llm({ title: "Milonga Bienvenida", local_date: "2026-09-28" })]);
    expect(later.written).toBe(1);
    expect(
      (
        await retireClearedPlaceholders(db, {
          source,
          placeholders: PLACEHOLDERS,
          writtenIds: later.eventIds,
          nights,
        })
      ).retired,
    ).toBe(1);
    expect((await rows())[bienvenida]).toMatchObject({
      status: "removed",
      mergedIntoId: later.eventIds[0],
    });

    // Nothing left to do, and a source with no placeholders is never touched.
    expect(
      (await clearPlaceholderTimes(db, { source, placeholders: PLACEHOLDERS, nights })).cleared,
    ).toBe(0);
    expect(
      (await clearPlaceholderTimes(db, { source: other, placeholders: [], nights })).cleared,
    ).toBe(0);
    expect((await rows())[own]?.startsAt?.toISOString()).toBe("2026-09-29T19:00:00.000Z");
  });

  it("stores validators and health, and reports events a source stopped listing", async () => {
    await recordFetch(db, source.id, {
      etag: '"abc"',
      lastModified: "Tue, 22 Sep 2026 10:00:00 GMT",
      contentHash: "h1",
      doc: {
        url: source.url,
        fetchedAt: NOW,
        httpStatus: 200,
        cleanedText: "text",
        method: "feed",
      },
    });
    await recordHealth(db, source.id, "failed", NOW, "the site answered 500", null);
    await recordHealth(db, source.id, "failed", NOW, "the site answered 500", null);
    const [reloaded] = await loadSources(db, metro.id);
    expect(reloaded).toMatchObject({ etag: '"abc"', contentHash: "h1" });

    const a = normalized({ title: "A", local_date: "2026-09-25", dancing_time: "21:00" });
    const b = normalized({ title: "B", local_date: "2026-09-26", dancing_time: "21:00" });
    const written = await writeEvents(db, {
      metro,
      source,
      events: [a, b],
      blocklist: EMPTY_BLOCKLIST,
      placeVenue: place,
    });
    const dropped = await droppedBySource(
      db,
      source.id,
      [written.eventIds[0]!],
      ["2026-09-25", "2026-09-26"],
    );
    expect(dropped).toEqual([written.eventIds[1]]);
  });
});
