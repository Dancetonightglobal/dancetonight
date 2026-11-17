import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { HarvestedListing, Metro, Source } from "@/src/adapters/types";
import type { Db } from "@/src/db/client";
import { events, metros } from "@/src/db/schema";
import type { FixedNight } from "@/src/domain/fixed-nights";
import { rawListingSchema } from "@/src/domain/listing";
import { EMPTY_BLOCKLIST } from "@/src/pipeline/blocklist";
import { closedNightsIn, retireClosedNights } from "@/src/pipeline/closed-nights";
import { normalizeListing, type NormalizedEvent } from "@/src/pipeline/normalize";
import { loadMetro, resolveVenue, upsertSource, writeEvents } from "@/src/pipeline/store";
import { closeTestDb, describeDb, requireDbInCi, resetDb, testDb } from "@/tests/unit/db-harness";

const AGUA = "AGUA - soirée salsa bachata du mardi";
const CITED =
  "own site, https://aguapartyparis.fr/: 'ANNULEE – Mardi 10 Novembre' (checked 2026-11-09)";

const fixed = (closed: FixedNight["closed"], days = [2], title = AGUA): FixedNight =>
  ({
    title,
    line: "Tous les mardis sur la Seine",
    days,
    start: "19:00",
    end: "01:00",
    danceCited: CITED,
    closed,
  }) as unknown as FixedNight;

describe("closedNightsIn (D-822)", () => {
  const nights = ["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-17"];

  it("gives a closed night on the fixed night's weekday", () => {
    expect(
      closedNightsIn([fixed([{ from: "2026-11-10", to: "2026-11-10", cited: CITED }])], nights),
    ).toEqual([{ night: "2026-11-10", title: AGUA, cited: CITED }]);
  });

  it("gives nothing for a night in range on another weekday, or outside the range", () => {
    expect(
      closedNightsIn(
        [fixed([{ from: "2026-11-09", to: "2026-11-11", cited: CITED }], [0])],
        nights,
      ),
    ).toEqual([]);
    expect(
      closedNightsIn([fixed([{ from: "2026-11-24", to: "2026-11-24", cited: CITED }])], nights),
    ).toEqual([]);
  });

  it("gives nothing for no closed ranges or a bad range", () => {
    expect(closedNightsIn([fixed(undefined)], nights)).toEqual([]);
    expect(
      closedNightsIn([fixed([{ from: "10 Nov", to: "2026-11-10", cited: CITED }])], nights),
    ).toEqual([]);
  });

  it("orders two fixed nights by night, then title", () => {
    const range = [{ from: "2026-11-09", to: "2026-11-17", cited: CITED }];
    expect(
      closedNightsIn([fixed(range, [2], "Z night"), fixed(range, [2], "A night")], nights).map(
        (c) => `${c.night} ${c.title}`,
      ),
    ).toEqual([
      "2026-11-10 A night",
      "2026-11-10 Z night",
      "2026-11-17 A night",
      "2026-11-17 Z night",
    ]);
  });
});

requireDbInCi();

const NOW = new Date("2026-11-10T08:00:00Z");
const METRO_ID = "22222222-2222-4222-8222-222222222222";
const SPOT = { lat: 48.8635, lng: 2.3186 };
const ELSEWHERE = { lat: 48.85, lng: 2.35 };

let db: Db;
let metro: Metro;
let agua: Source;
let salsaVida: Source;

function normalized(
  source: Source,
  fields: Record<string, unknown>,
  extra: Partial<HarvestedListing> = {},
): NormalizedEvent {
  const outcome = normalizeListing(
    {
      listing: rawListingSchema.parse({
        listing_type: "social",
        styles: ["salsa"],
        venue: {},
        organizer: {},
        ...fields,
      }),
      externalId: null,
      tz: null,
      venueLocation: null,
      recurrence: null,
      provenance: { sourceUrl: source.url, fetchedAt: NOW, method: "llm" },
      ...extra,
    },
    { metro, source, now: NOW },
  );
  if (!outcome.ok) throw new Error(outcome.reason);
  return outcome.event;
}

const place = (input: Parameters<typeof resolveVenue>[2]) => resolveVenue(db, metro, input);

/** Writes one row and puts it at `venueId`; returns its id. */
async function row(
  source: Source,
  title: string,
  night: string,
  venueId: string,
  venueName = "Péniche",
): Promise<string> {
  const written = await writeEvents(db, {
    metro,
    source,
    events: [
      normalized(source, {
        title,
        local_date: night,
        dancing_time: "21:00",
        venue: { name: venueName },
      }),
    ],
    blocklist: EMPTY_BLOCKLIST,
    placeVenue: place,
  });
  const id = written.eventIds[0]!;
  await db
    .update(events)
    .set({ venueId, status: "active", mergedIntoId: null })
    .where(eq(events.id, id));
  return id;
}

async function statusOf(ids: string[]): Promise<Record<string, string>> {
  const rows = await db
    .select({ id: events.id, status: events.status })
    .from(events)
    .where(inArray(events.id, ids));
  return Object.fromEntries(rows.map((r) => [r.id, r.status]));
}

describeDb("retireClosedNights (D-822)", () => {
  let venueId: string;
  let otherVenueId: string;

  beforeAll(async () => {
    db = await testDb("closed-nights");
  });
  afterAll(closeTestDb);

  beforeEach(async () => {
    await resetDb();
    await db.insert(metros).values({
      id: METRO_ID,
      slug: "paris",
      name: "Paris",
      countryCode: "FR",
      center: { lat: 48.8566, lng: 2.3522 },
      radiusKm: 40,
      tz: "Europe/Paris",
      languages: ["fr"],
      status: "active",
    });
    metro = (await loadMetro(db, "paris"))!;
    agua = await upsertSource(db, metro.id, {
      url: "https://aguapartyparis.fr/la-soiree/",
      kind: "html",
      trustTier: "first_party",
      discoveredBy: "seed_list",
      styles: ["salsa", "bachata"],
    });
    salsaVida = await upsertSource(db, metro.id, {
      url: "https://www.salsavida.com/guides/france/paris/",
      kind: "html",
      trustTier: "directory",
      discoveredBy: "seed_list",
      styles: ["salsa"],
    });
    venueId = (await place({
      name: "Péniche Concorde Atlantique",
      address: null,
      url: null,
      location: SPOT,
    }))!.venueId;
    otherVenueId = (await place({
      name: "Cuba Libre",
      address: null,
      url: null,
      location: ELSEWHERE,
    }))!.venueId;
  });

  it("takes the closed night's copies off, and keeps everything else", async () => {
    const fixedRow = await row(agua, AGUA, "2026-11-17", venueId); // gives the venue; listed this read
    const stale = await row(agua, "La soirée du mardi", "2026-11-10", venueId);
    const listed = await row(agua, "Atelier salsa", "2026-11-10", venueId);
    const twin = await row(
      salsaVida,
      "Agua Party Salsa Bachata Kizomba Every Tuesday",
      "2026-11-10",
      venueId,
    );
    const other = await row(salsaVida, "Kizomba Lounge", "2026-11-10", venueId);
    const elsewhere = await row(
      salsaVida,
      "Agua Libre Salsa Night",
      "2026-11-10",
      otherVenueId,
      "Cuba Libre",
    );
    const openNight = await row(
      salsaVida,
      "Agua Party Salsa Bachata Kizomba Every Tuesday",
      "2026-11-24",
      venueId,
    );

    // Seven separate rows: none merged into another on writing.
    expect(new Set([fixedRow, stale, listed, twin, other, elsewhere, openNight]).size).toBe(7);
    const result = await retireClosedNights(db, {
      source: agua,
      closed: [{ night: "2026-11-10", title: AGUA, cited: CITED }],
      listedIds: [fixedRow, listed],
    });

    const status = await statusOf([fixedRow, stale, listed, twin, other, elsewhere, openNight]);
    expect(status[stale]).toBe("removed");
    expect(status[twin]).toBe("removed");
    expect(status[fixedRow]).toBe("active");
    expect(status[listed]).toBe("active");
    expect(status[other]).toBe("active");
    expect(status[elsewhere]).toBe("active");
    expect(status[openNight]).toBe("active");
    expect(result.retired).toBe(2);
    expect(result.notes).toHaveLength(1);
    expect(result.notes[0]).toMatch(
      /^2 listing\(s\) on a night the venue's own page says is closed were taken off the site: /,
    );
    expect(result.notes[0]).toContain(
      "La soirée du mardi on 2026-11-10 (own site, https://aguapartyparis.fr/",
    );
  });

  it("does nothing with no closed nights", async () => {
    const stale = await row(agua, "La soirée du mardi", "2026-11-10", venueId);
    expect(await retireClosedNights(db, { source: agua, closed: [], listedIds: [] })).toEqual({
      retired: 0,
      notes: [],
    });
    expect((await statusOf([stale]))[stale]).toBe("active");
  });
});
