import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";

import type { HarvestedListing, Metro, Source } from "@/src/adapters/types";
import type { Db } from "@/src/db/client";
import { events, metros } from "@/src/db/schema";
import { rawListingSchema } from "@/src/domain/listing";
import { EMPTY_BLOCKLIST } from "@/src/pipeline/blocklist";
import { normalizeListing, type NormalizedEvent } from "@/src/pipeline/normalize";
import { retirePageTwins } from "@/src/pipeline/page-twins";
import { loadMetro, resolveVenue, upsertSource, writeEvents } from "@/src/pipeline/store";
import { closeTestDb, describeDb, requireDbInCi, resetDb, testDb } from "@/tests/unit/db-harness";

// D-744: Swing Out London's classes list reads "King's Cross (Mixed) | at The Cable Street Rag Band @
// Jamboree with Dis Swing Thing". The reader wrote that line as its own card: no time, no place, a title
// that holds the whole title of this source's own listing that night ("The Cable Street Rag Band @
// Jamboree"). Prod 11-05: the only untimed, venue-less same-source row whose title holds another
// same-night row's title. Rows with a time or a place (theronda "Salmagundi Milonga — Tango Class" beside
// "Salmagundi Milonga") are real class-and-milonga pairs and stay.

requireDbInCi();

const NOW = new Date("2026-11-05T16:00:00Z");
const METRO_ID = "22222222-2222-4222-8222-222222222222";
const SOURCE_URL = "https://swingout.example/";
const NIGHT = "2026-11-05";
const NIGHTS = ["2026-11-05", "2026-11-06"];

const BAND = "The Cable Street Rag Band @ Jamboree";
const RUN_ON = "King's Cross (Mixed) at The Cable Street Rag Band @ Jamboree with Dis Swing Thing";
const JAMBOREE = { name: "Jamboree", address: "566 Cable Street, London E1W 3HB" };

let db: Db;
let metro: Metro;
let source: Source;
let other: Source;

function normalized(
  by: Source,
  fields: Record<string, unknown>,
  venue: { name: string; address: string } | null,
): NormalizedEvent {
  const harvested: HarvestedListing = {
    listing: rawListingSchema.parse({
      listing_type: "social",
      styles: [],
      venue: venue ?? {},
      organizer: {},
      local_date: NIGHT,
      ...fields,
    }),
    externalId: null,
    tz: null,
    venueLocation: venue ? { lat: 51.5105, lng: -0.0568 } : null,
    recurrence: null,
    eventUrl: null,
    provenance: { sourceUrl: by.url, fetchedAt: NOW, method: "feed" },
  };
  const outcome = normalizeListing(harvested, { metro, source: by, now: NOW });
  if (!outcome.ok) throw new Error(outcome.reason);
  return outcome.event;
}

const place = (input: Parameters<typeof resolveVenue>[2]) => resolveVenue(db, metro, input);

async function write(by: Source, event: NormalizedEvent, key: string): Promise<string> {
  const r = await writeEvents(db, {
    metro,
    source: by,
    events: [{ ...event, key }],
    blocklist: EMPTY_BLOCKLIST,
    placeVenue: place,
  });
  expect(r.written).toBe(1);
  return r.eventIds[0]!;
}

async function statuses(): Promise<
  Record<string, { status: string; mergedIntoId: string | null }>
> {
  return Object.fromEntries(
    (await db.select().from(events)).map((r) => [
      r.id,
      { status: r.status, mergedIntoId: r.mergedIntoId },
    ]),
  );
}

describeDb("retirePageTwins: a run-on line naming this source's own listing (D-744)", () => {
  beforeAll(async () => {
    db = await testDb("run-on-twins");
  });
  afterAll(closeTestDb);

  beforeEach(async () => {
    await resetDb();
    await db.insert(metros).values({
      id: METRO_ID,
      slug: "london",
      name: "London",
      countryCode: "GB",
      center: { lat: 51.5074, lng: -0.1278 },
      radiusKm: 40,
      tz: "Europe/London",
      languages: ["en"],
      status: "active",
    });
    metro = (await loadMetro(db, "london"))!;
    source = await upsertSource(db, metro.id, {
      url: SOURCE_URL,
      kind: "html",
      trustTier: "directory",
      discoveredBy: "seed_list",
      styles: [],
    });
    other = await upsertSource(db, metro.id, {
      url: "https://other.example/london",
      kind: "html",
      trustTier: "directory",
      discoveredBy: "seed_list",
      styles: [],
    });
  });

  it("retires the untimed, unplaced line into the listing whose title it holds", async () => {
    const t = await write(source, normalized(source, { title: BAND }, JAMBOREE), "band");
    const u = await write(source, normalized(source, { title: RUN_ON }, null), "runon");
    const { retired, notes } = await retirePageTwins(db, { metro, nights: NIGHTS });
    expect(retired).toBe(1);
    expect(notes).toEqual([
      `${RUN_ON}: a line of this source on ${NIGHT} with no time or place names its listing "${BAND}"; it was retired into that listing`,
    ]);
    const s = await statuses();
    expect(s[u]).toEqual({ status: "removed", mergedIntoId: t });
    expect(s[t]).toEqual({ status: "active", mergedIntoId: null });
    expect((await retirePageTwins(db, { metro, nights: NIGHTS })).retired).toBe(0);
  });

  it("also retires it when the named listing has a time", async () => {
    const t = await write(
      source,
      normalized(source, { title: BAND, dancing_time: "19:30" }, JAMBOREE),
      "band@19:30",
    );
    const u = await write(source, normalized(source, { title: RUN_ON }, null), "runon");
    expect((await retirePageTwins(db, { metro, nights: NIGHTS })).retired).toBe(1);
    expect((await statuses())[u]).toEqual({ status: "removed", mergedIntoId: t });
  });

  it("keeps a line that has a place (a class beside its milonga)", async () => {
    await write(source, normalized(source, { title: "Salmagundi Milonga" }, JAMBOREE), "m");
    await write(
      source,
      normalized(source, { title: "Salmagundi Milonga — Tango Class" }, JAMBOREE),
      "c",
    );
    expect((await retirePageTwins(db, { metro, nights: NIGHTS })).retired).toBe(0);
  });

  it("keeps a line that has a time", async () => {
    await write(source, normalized(source, { title: BAND }, JAMBOREE), "band");
    await write(
      source,
      normalized(source, { title: RUN_ON, lesson_time: "19:00" }, null),
      "runon@19:00",
    );
    expect((await retirePageTwins(db, { metro, nights: NIGHTS })).retired).toBe(0);
  });

  it("needs a title of at least 12 characters and whole words", async () => {
    await write(source, normalized(source, { title: "Swing Den" }, JAMBOREE), "short");
    await write(source, normalized(source, { title: "Swing Den Lindy class" }, null), "a");
    await write(source, normalized(source, { title: "Tango en el Barrio" }, JAMBOREE), "barrio");
    await write(source, normalized(source, { title: "Tango en el Barrios Night" }, null), "b");
    expect((await retirePageTwins(db, { metro, nights: NIGHTS })).retired).toBe(0);
  });

  it("leaves another source's listing, another night, and a line naming two listings", async () => {
    await write(other, normalized(other, { title: BAND }, JAMBOREE), "o-band");
    await write(
      source,
      normalized(source, { title: BAND, local_date: "2026-11-06" }, JAMBOREE),
      "band-06",
    );
    await write(source, normalized(source, { title: RUN_ON }, null), "runon");
    expect((await retirePageTwins(db, { metro, nights: NIGHTS })).retired).toBe(0);

    await write(source, normalized(source, { title: "Cable Street Rag Band" }, JAMBOREE), "b1");
    await write(source, normalized(source, { title: BAND }, JAMBOREE), "b2");
    expect((await retirePageTwins(db, { metro, nights: NIGHTS })).retired).toBe(0);
  });

  it("looks only at the nights it is given", async () => {
    await write(source, normalized(source, { title: BAND }, JAMBOREE), "band");
    await write(source, normalized(source, { title: RUN_ON }, null), "runon");
    expect((await retirePageTwins(db, { metro, nights: ["2026-11-06"] })).retired).toBe(0);
  });
});
