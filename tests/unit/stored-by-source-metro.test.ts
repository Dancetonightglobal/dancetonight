// D-850: a failing source's report line counts only the run's metro's listings. A platform source
// (ticketmaster.com) is one source row shared by every metro; Pune's line counted NYC's 109 listings.
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";

import type { Db } from "@/src/db/client";
import { events, eventSources, metros } from "@/src/db/schema";
import { loadMetro, storedBySource, upsertSource } from "@/src/pipeline/store";
import { closeTestDb, describeDb, requireDbInCi, resetDb, testDb } from "@/tests/unit/db-harness";

requireDbInCi();

describeDb("storedBySource is per metro (D-850)", () => {
  let db: Db;
  let nycId: string;
  let puneId: string;

  beforeAll(async () => {
    db = await testDb("stored_by_metro");
  });
  afterAll(closeTestDb);

  beforeEach(async () => {
    await resetDb();
    await db.insert(metros).values([
      {
        slug: "nyc",
        name: "New York",
        countryCode: "US",
        center: { lat: 40.7128, lng: -74.006 },
        radiusKm: 50,
        tz: "America/New_York",
        languages: ["en"],
      },
      {
        slug: "pune",
        name: "Pune",
        countryCode: "IN",
        center: { lat: 18.5204, lng: 73.8567 },
        radiusKm: 30,
        tz: "Asia/Kolkata",
        languages: ["en"],
      },
    ]);
    nycId = (await loadMetro(db, "nyc"))!.id;
    puneId = (await loadMetro(db, "pune"))!.id;
  });

  async function addEvent(
    metroId: string,
    sourceId: string,
    sourceUrl: string,
    night: string,
    slug: string,
  ): Promise<void> {
    const [event] = await db
      .insert(events)
      .values({
        slug,
        title: slug,
        titleNormalized: slug,
        listingType: "social",
        nightDate: night,
        tz: "America/New_York",
        status: "active",
        confirmation: "recurring_unconfirmed",
        metroId,
        sourceIds: [sourceId],
        firstSeenAt: new Date(),
      })
      .returning({ id: events.id });
    await db.insert(eventSources).values({
      eventId: event!.id,
      sourceId,
      sourceUrl,
      role: "primary",
      firstSeenAt: new Date("2026-11-09T22:34:00Z"),
      lastSeenAt: new Date("2026-11-09T22:34:00Z"),
    });
  }

  it("counts only the asked metro's rows of a shared source", async () => {
    const tm = await upsertSource(db, nycId, {
      url: "https://www.ticketmaster.com/",
      kind: "ticketing_api",
      trustTier: "ticketing",
      discoveredBy: "seed_list",
    });
    await addEvent(nycId, tm.id, tm.url, "2026-11-12", "nyc-a-2026-11-12");
    await addEvent(nycId, tm.id, tm.url, "2026-11-20", "nyc-b-2026-11-20");

    const pune = await storedBySource(db, tm.id, puneId, "2026-11-11", "2026-11-24");
    expect(pune).toEqual({ listed: 0, alone: 0, lastNight: null, lastSeenAt: null });

    await addEvent(puneId, tm.id, tm.url, "2026-11-14", "pune-a-2026-11-14");
    const pune2 = await storedBySource(db, tm.id, puneId, "2026-11-11", "2026-11-24");
    expect(pune2.listed).toBe(1);
    expect(pune2.alone).toBe(1);
    expect(pune2.lastNight).toBe("2026-11-14");

    const nyc = await storedBySource(db, tm.id, nycId, "2026-11-11", "2026-11-24");
    expect(nyc.listed).toBe(2);
    expect(nyc.lastNight).toBe("2026-11-20");
  });
});
