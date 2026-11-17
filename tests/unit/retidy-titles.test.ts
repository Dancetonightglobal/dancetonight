import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";

import { normalizeForMatch } from "@/config/styles";
import type { Metro, Source } from "@/src/adapters/types";
import type { Db } from "@/src/db/client";
import { events, metros } from "@/src/db/schema";
import { rawListingSchema } from "@/src/domain/listing";
import { EMPTY_BLOCKLIST } from "@/src/pipeline/blocklist";
import { normalizeListing, type NormalizedEvent } from "@/src/pipeline/normalize";
import { retidyStoredTitles } from "@/src/pipeline/retidy-titles";
import {
  loadMetro,
  mergeInto,
  resolveVenue,
  upsertSource,
  writeEvents,
} from "@/src/pipeline/store";
import { closeTestDb, describeDb, requireDbInCi, resetDb, testDb } from "@/tests/unit/db-harness";

requireDbInCi();

// D-810: Rio's Sympla rows first stored on 10-30, before the tidy rules, kept "| Segunda-feira 9 novembro |
// Copacabana | TAU" on the site: newer clean-titled copies merged into them and the old row is no longer re-read.

const NOW = new Date("2026-11-09T12:00:00Z");
const METRO_ID = "22222222-2222-4222-8222-222222222222";
const NIGHT = "2026-11-09";
const OTHER_NIGHT = "2026-11-10";
const LONG = "Fiesta Latina ¡CHÉVERE! | Segunda-feira 9 novembro | Copacabana | TAU";

let db: Db;
let metro: Metro;
let source: Source;

function normalized(fields: Record<string, unknown>): NormalizedEvent {
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
      provenance: { sourceUrl: source.url, fetchedAt: NOW, method: "feed" },
    },
    { metro, source, now: NOW },
  );
  if (!outcome.ok) throw new Error(outcome.reason);
  return outcome.event;
}

/** Writes a row, then gives it a stored title as an older read would have saved it. */
async function stored(title: string, night: string, time: string, storedTitle = title) {
  const result = await writeEvents(db, {
    metro,
    source,
    events: [normalized({ title, local_date: night, dancing_time: time })],
    blocklist: EMPTY_BLOCKLIST,
    placeVenue: (input) => resolveVenue(db, metro, input),
  });
  const id = result.eventIds[0];
  if (!id) throw new Error("nothing written");
  if (storedTitle !== title)
    await db.update(events).set({ title: storedTitle }).where(eq(events.id, id));
  return id;
}

const rowOf = async (id: string) => (await db.select().from(events).where(eq(events.id, id)))[0]!;

describeDb("retidyStoredTitles (D-810)", () => {
  beforeAll(async () => {
    db = await testDb("retidy-titles");
  });
  afterAll(closeTestDb);

  beforeEach(async () => {
    await resetDb();
    await db.insert(metros).values({
      id: METRO_ID,
      slug: "rio-de-janeiro",
      name: "Rio de Janeiro",
      countryCode: "BR",
      center: { lat: -22.9068, lng: -43.1729 },
      radiusKm: 50,
      tz: "America/Sao_Paulo",
      languages: ["pt"],
      status: "active",
    });
    metro = (await loadMetro(db, "rio-de-janeiro"))!;
    source = await upsertSource(db, metro.id, {
      url: "https://www.sympla.com.br/eventos/rio-de-janeiro-rj",
      kind: "html",
      trustTier: "ticketing",
      discoveredBy: "seed_list",
    });
  });

  it("re-tidies an active row's stored title and its match key, and keeps its slug and status", async () => {
    const id = await stored("Fiesta Latina Night", NIGHT, "22:00", LONG);
    const before = await rowOf(id);
    const { retitled, notes } = await retidyStoredTitles(db, { metro, nights: [NIGHT] });
    const after = await rowOf(id);
    expect(retitled).toBe(1);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain("re-tidied");
    expect(after.title).toBe("Fiesta Latina ¡CHÉVERE!");
    expect(after.titleNormalized).toBe(normalizeForMatch("Fiesta Latina ¡CHÉVERE!"));
    expect(after.slug).toBe(before.slug);
    expect(after.status).toBe("active");
  });

  it("leaves tidy titles, merged rows and other nights alone", async () => {
    const tidy = await stored("Forró na Lapa", NIGHT, "21:00");
    const keeper = await stored("Samba de Gafieira", NIGHT, "20:00");
    const merged = await stored("Samba Copy", NIGHT, "20:30", LONG);
    await mergeInto(db, keeper, merged);
    const later = await stored("Later Night", OTHER_NIGHT, "22:00", LONG);
    const tidyBefore = await rowOf(tidy);

    const { retitled, notes } = await retidyStoredTitles(db, { metro, nights: [NIGHT] });
    expect(retitled).toBe(0);
    expect(notes).toEqual([]);
    expect((await rowOf(tidy)).updatedAt).toEqual(tidyBefore.updatedAt);
    expect((await rowOf(merged)).title).toBe(LONG);
    expect((await rowOf(later)).title).toBe(LONG);
  });

  it("does nothing for no nights", async () => {
    expect(await retidyStoredTitles(db, { metro, nights: [] })).toEqual({ retitled: 0, notes: [] });
  });
});
