// D-065 against dedupe and the rest of the write path: a stored placeholder time (The Ronda's
// "3:00 PM", printed on every event) is withdrawn however dedupe spread it, another source's own
// time is kept or given back, and the withdrawn row gives way to this run's listing of the same
// night and title. Each case is one the review of 2026-09-28 reproduced.

import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";

import type { HarvestedListing, Metro, Source } from "@/src/adapters/types";
import type { Db } from "@/src/db/client";
import { events, fieldProvenance, metros } from "@/src/db/schema";
import { rawListingSchema } from "@/src/domain/listing";
import { EMPTY_BLOCKLIST } from "@/src/pipeline/blocklist";
import { dedupeMetro } from "@/src/pipeline/dedupe";
import { normalizeListing } from "@/src/pipeline/normalize";
import {
  clearPlaceholderTimes,
  loadMetro,
  resolveVenue,
  retireClearedPlaceholders,
  upsertSource,
  writeEvents,
} from "@/src/pipeline/store";
import { closeTestDb, describeDb, requireDbInCi, resetDb, testDb } from "@/tests/unit/db-harness";

requireDbInCi();

const NOW = new Date("2026-09-28T16:00:00Z");
const NIGHT = "2026-09-30";
const NIGHTS = ["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01"];
const PLACEHOLDERS = ["15:00"];
const RIPLEY = { lat: 40.7527, lng: -73.9923 };

let db: Db;
let metro: Metro;
let ronda: Source;
let nyTango: Source;
let studio: Source;

/** One listing of `source`, at Ripley-Grier unless `at` is null. */
function listing(
  source: Source,
  fields: Record<string, unknown>,
  at: typeof RIPLEY | null = RIPLEY,
) {
  const harvested: HarvestedListing = {
    listing: rawListingSchema.parse({
      listing_type: "social",
      styles: ["milonga"],
      local_date: NIGHT,
      venue: at ? { name: "Ripley-Grier Studios" } : {},
      organizer: { name: "Tango Cafe" },
      ...fields,
    }),
    externalId: null,
    tz: null,
    venueLocation: at,
    recurrence: null,
    provenance: { sourceUrl: source.url, fetchedAt: NOW, method: "llm" },
  };
  const outcome = normalizeListing(harvested, { metro, source, now: NOW });
  if (!outcome.ok) throw new Error(outcome.reason);
  return outcome.event;
}

const write = (source: Source, list: ReturnType<typeof listing>[]) =>
  writeEvents(db, {
    metro,
    source,
    events: list,
    blocklist: EMPTY_BLOCKLIST,
    placeVenue: (input) => resolveVenue(db, metro, input),
  });

const clear = () =>
  clearPlaceholderTimes(db, { source: ronda, placeholders: PLACEHOLDERS, nights: NIGHTS });
const retire = (writtenIds: string[]) =>
  retireClearedPlaceholders(db, {
    source: ronda,
    placeholders: PLACEHOLDERS,
    writtenIds,
    nights: NIGHTS,
  });
const row = async (id: string) => (await db.select().from(events).where(eq(events.id, id)))[0]!;
const iso = (d: Date | null | undefined) => d?.toISOString() ?? null;
const currentTimes = async (id: string) =>
  (
    await db
      .select()
      .from(fieldProvenance)
      .where(
        and(
          eq(fieldProvenance.entityId, id),
          eq(fieldProvenance.field, "dancing_at"),
          eq(fieldProvenance.isCurrent, true),
        ),
      )
  ).map((f) => [f.value, f.sourceUrl]);

describeDb("withdrawing a stored placeholder time, with dedupe (D-065)", () => {
  beforeAll(async () => {
    db = await testDb("placeholders");
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
    const directory = {
      kind: "html" as const,
      trustTier: "directory" as const,
      discoveredBy: "seed_list" as const,
    };
    ronda = await upsertSource(db, metro.id, { url: "https://theronda.example/nyc", ...directory });
    nyTango = await upsertSource(db, metro.id, { url: "https://nytango.example/", ...directory });
    studio = await upsertSource(db, metro.id, {
      url: "https://tangocafe.example/",
      kind: "html",
      trustTier: "first_party",
      discoveredBy: "seed_list",
    });
  });

  it("clears the placeholder beside another source's different time, and the row takes that time", async () => {
    // The Ronda first, so its row survives a tie between two directories; 60 minutes apart is a
    // conflict, so dedupe copies New York Tango's 4pm onto it beside the 3pm.
    const [r] = (
      await write(ronda, [listing(ronda, { title: "Tango Cafe", dancing_time: "15:00" })])
    ).eventIds;
    const [m] = (
      await write(nyTango, [listing(nyTango, { title: "Tango Cafe", dancing_time: "16:00" })])
    ).eventIds;
    expect(await dedupeMetro(db, metro, NIGHTS)).toMatchObject({ merged: 1, conflicting: 1 });
    expect(await row(r!)).toMatchObject({ status: "active", confirmation: "conflicting" });

    expect((await clear()).cleared).toBe(1);
    const after = await row(r!);
    // 4pm, which New York Tango states, not The Ronda's 3pm; and nothing left to disagree.
    expect(iso(after.startsAt)).toBe("2026-09-30T20:00:00.000Z");
    expect(after.confirmation).toBe("recurring_unconfirmed");
    expect(await currentTimes(r!)).toEqual([
      ["2026-09-30T20:00:00.000Z", "https://nytango.example/"],
    ]);
    expect(await row(m!)).toMatchObject({ status: "merged", mergedIntoId: r });

    // The Ronda lists the night again with no time: it is the same night as the 4pm one.
    const again = await write(ronda, [listing(ronda, { title: "Tango Cafe" })]);
    expect(again.written).toBe(0);
    expect((await retire(again.eventIds)).retired).toBe(0);
    expect(iso((await row(r!)).startsAt)).toBe("2026-09-30T20:00:00.000Z");
  });

  it("gives the row back another source's time that sat on a merged duplicate", async () => {
    // 15:00 and 15:10: no conflict, so dedupe copies nothing and New York Tango's time stays on its
    // merged row.
    const [r] = (
      await write(ronda, [listing(ronda, { title: "Tango Cafe", dancing_time: "15:00" })])
    ).eventIds;
    await write(nyTango, [listing(nyTango, { title: "Tango Cafe", dancing_time: "15:10" })]);
    expect(await dedupeMetro(db, metro, NIGHTS)).toMatchObject({ merged: 1, conflicting: 0 });

    await clear();
    expect(iso((await row(r!)).startsAt)).toBe("2026-09-30T19:10:00.000Z");
    expect(await currentTimes(r!)).toEqual([
      ["2026-09-30T19:10:00.000Z", "https://nytango.example/"],
    ]);
  });

  it("no longer flags a survivor conflicting once the placeholder beside its own time is withdrawn", async () => {
    const [s] = (
      await write(studio, [listing(studio, { title: "Tango Cafe", dancing_time: "16:00" })])
    ).eventIds;
    const [r] = (
      await write(ronda, [listing(ronda, { title: "Tango Cafe", dancing_time: "15:00" })])
    ).eventIds;
    expect(await dedupeMetro(db, metro, NIGHTS)).toMatchObject({ merged: 1, conflicting: 1 });
    expect(await row(s!)).toMatchObject({ status: "active", confirmation: "conflicting" });

    await clear();
    const after = await row(s!);
    expect(iso(after.startsAt)).toBe("2026-09-30T20:00:00.000Z");
    expect(after.confirmation).toBe("recurring_unconfirmed");
    expect(await currentTimes(s!)).toEqual([
      ["2026-09-30T20:00:00.000Z", "https://tangocafe.example/"],
    ]);
    expect((await row(r!)).startsAt).toBeNull();

    // The studio's next harvest sets its own confirmation again.
    await write(studio, [listing(studio, { title: "Tango Cafe", dancing_time: "16:00" })]);
    expect((await row(s!)).confirmation).toBe("confirmed_today");
  });

  it("gives way to the timed listing when the source now states a time", async () => {
    const [r] = (
      await write(ronda, [listing(ronda, { title: "Victoria's Practica", doors_time: "15:00" })])
    ).eventIds;
    await clear();
    expect((await row(r!)).startsAt).toBeNull();

    // This run reads the class time from the note: a timed listing under another key.
    const run = await write(ronda, [
      listing(ronda, { title: "Victoria's Practica", lesson_time: "14:30" }),
    ]);
    expect(run.written).toBe(1);
    expect(await retire(run.eventIds)).toEqual({
      retired: 1,
      notes: [
        "Victoria's Practica: the listing stored on 2026-09-30 with this site's placeholder time was replaced by this run's listing",
      ],
    });
    expect(await row(r!)).toMatchObject({ status: "removed", mergedIntoId: run.eventIds[0] });
  });

  it("gives way to the listing at the time it kept, when the placeholder sat beside a real one", async () => {
    // Stored before D-063 with its class at 2:30 and the site's 3pm as the dancing time.
    const [r] = (
      await write(ronda, [
        listing(ronda, {
          title: "Victoria's Practica",
          lesson_time: "14:30",
          dancing_time: "15:00",
        }),
      ])
    ).eventIds;
    await clear();
    expect(iso((await row(r!)).startsAt)).toBe("2026-09-30T18:30:00.000Z");

    const run = await write(ronda, [
      listing(ronda, { title: "Victoria's Practica", lesson_time: "14:30" }),
    ]);
    expect(run.eventIds[0]).not.toBe(r);
    expect((await retire(run.eventIds)).retired).toBe(1);
    expect(await row(r!)).toMatchObject({ status: "removed", mergedIntoId: run.eventIds[0] });
  });

  it("keeps the night on the list when the replacement's venue could not be placed", async () => {
    const [r] = (await write(ronda, [listing(ronda, { title: "Tango Cafe", doors_time: "15:00" })]))
      .eventIds;
    const placed = await row(r!);
    expect(placed.venueId).not.toBeNull();
    await clear();

    // This run's read names no venue, so the replacement is written unplaced.
    const run = await write(ronda, [listing(ronda, { title: "Tango Cafe" }, null)]);
    expect(run.unplaced).toBe(1);
    expect((await retire(run.eventIds)).retired).toBe(1);
    const replacement = await row(run.eventIds[0]!);
    expect(replacement).toMatchObject({
      status: "active",
      startsAt: null,
      venueId: placed.venueId,
    });
    expect(replacement.geo).toEqual(placed.geo);
  });

  it("finishes the job when a run stopped after withdrawing the facts", async () => {
    const [r] = (await write(ronda, [listing(ronda, { title: "Tango Cafe", doors_time: "15:00" })]))
      .eventIds;
    // The facts were withdrawn and the column never cleared (an interrupted run before the
    // withdrawal and the clear shared a transaction).
    await db
      .update(fieldProvenance)
      .set({ isCurrent: false })
      .where(eq(fieldProvenance.entityId, r!));
    expect((await clear()).cleared).toBe(1);
    expect((await row(r!)).startsAt).toBeNull();
    expect((await clear()).cleared).toBe(0);
  });
});
