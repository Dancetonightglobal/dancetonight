// D-826: a stored venue named by a known venue takes the known venue's checked address when its own
// is only a city ("Berlin, Germany"). Havanna Berlin: Salsa Vida made the venue first with only
// "Berlin, Germany", and every later read matched that venue by name and point, so the club's own
// address (config/known-venues.ts) never reached its six cards (Berlin-6, 2026-11-10).

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";

import type { KnownVenue } from "@/config/known-venues";
import type { Metro } from "@/src/adapters/types";
import type { Db } from "@/src/db/client";
import { metros, venues } from "@/src/db/schema";
import { upgradeKnownVenueAddresses } from "@/src/pipeline/known-venue-address";
import { loadMetro, resolveVenue } from "@/src/pipeline/store";
import { closeTestDb, describeDb, resetDb, testDb } from "@/tests/unit/db-harness";

let db: Db;
let metro: Metro;
const geocode = async () => null;
const AT = { lat: 52.48512, lng: 13.35355 };
const HAVANNA: KnownVenue = {
  names: ["Havanna Berlin", "Havanna", "HAVANNA Berlin"],
  address: "Hauptstraße 30, 10827 Berlin",
  streets: ["Hauptstraße 30"],
  canonical: true,
};

async function venue(name: string, address: string | null, at = AT): Promise<string> {
  const placed = await resolveVenue(
    db,
    metro,
    { name, address, url: null, location: at },
    geocode,
    {
      checkPoint: false,
    },
  );
  if (!placed) throw new Error("not placed");
  return placed.venueId;
}

async function addressOf(id: string): Promise<string | null> {
  const [row] = await db.select({ address: venues.address }).from(venues).where(eq(venues.id, id));
  return row?.address?.formatted ?? null;
}

describeDb("known venue address over a city-only stored address (D-826)", () => {
  beforeAll(async () => {
    db = await testDb("known_venue_address");
  });
  afterAll(closeTestDb);
  beforeEach(async () => {
    await resetDb();
    await db.insert(metros).values({
      slug: "berlin",
      name: "Berlin",
      countryCode: "DE",
      center: { lat: 52.52, lng: 13.405 },
      radiusKm: 40,
      tz: "Europe/Berlin",
      languages: ["de", "en"],
      status: "active",
    });
    metro = (await loadMetro(db, "berlin"))!;
  });

  it("a city-only address takes the known venue's, with a note", async () => {
    const id = await venue("Havanna Berlin", "Berlin, Germany");
    const result = await upgradeKnownVenueAddresses(db, { metro, known: [HAVANNA] });
    expect(result.upgraded).toBe(1);
    expect(await addressOf(id)).toBe("Hauptstraße 30, 10827 Berlin");
    expect(result.notes).toHaveLength(1);
    expect(result.notes[0]).toContain("Havanna Berlin");
    expect(result.notes[0]).toContain("Berlin, Germany");
    expect(result.notes[0]).toContain("Hauptstraße 30, 10827 Berlin");
  });

  it("matches any of its names, in any case and spacing", async () => {
    const a = await venue("  havanna ", "Berlin");
    // Far enough apart that the store keeps two venue rows.
    const b = await venue("HAVANNA BERLIN", "Berlin, Deutschland", { lat: 52.51, lng: 13.4 });
    expect(b).not.toBe(a);
    const result = await upgradeKnownVenueAddresses(db, { metro, known: [HAVANNA] });
    expect(result.upgraded).toBe(2);
    expect(await addressOf(a)).toBe("Hauptstraße 30, 10827 Berlin");
    expect(await addressOf(b)).toBe("Hauptstraße 30, 10827 Berlin");
  });

  it("a known venue with one name works (a one-element list is still a list)", async () => {
    const id = await venue("Havanna Berlin", "Berlin, Germany");
    const one: KnownVenue = { names: ["Havanna Berlin"], address: HAVANNA.address };
    expect((await upgradeKnownVenueAddresses(db, { metro, known: [one] })).upgraded).toBe(1);
    expect(await addressOf(id)).toBe("Hauptstraße 30, 10827 Berlin");
  });

  it("a venue with no address takes it too", async () => {
    const id = await venue("Havanna", null);
    expect((await upgradeKnownVenueAddresses(db, { metro, known: [HAVANNA] })).upgraded).toBe(1);
    expect(await addressOf(id)).toBe("Hauptstraße 30, 10827 Berlin");
  });

  it("a stored street address is kept: it has a number", async () => {
    const id = await venue("Havanna Berlin", "Hauptstr. 30, Berlin");
    expect((await upgradeKnownVenueAddresses(db, { metro, known: [HAVANNA] })).upgraded).toBe(0);
    expect(await addressOf(id)).toBe("Hauptstr. 30, Berlin");
  });

  it("another venue's name is not touched", async () => {
    const id = await venue("Havanna Bar Kreuzberg", "Berlin, Germany");
    expect((await upgradeKnownVenueAddresses(db, { metro, known: [HAVANNA] })).upgraded).toBe(0);
    expect(await addressOf(id)).toBe("Berlin, Germany");
  });

  it("a curated (non-listing) venue is not touched", async () => {
    const id = await venue("Havanna Berlin", "Berlin, Germany");
    await db.update(venues).set({ seedProvider: "osm" }).where(eq(venues.id, id));
    expect((await upgradeKnownVenueAddresses(db, { metro, known: [HAVANNA] })).upgraded).toBe(0);
    expect(await addressOf(id)).toBe("Berlin, Germany");
  });

  it("runs again with nothing to do, and with no known venues", async () => {
    await venue("Havanna Berlin", "Berlin, Germany");
    await upgradeKnownVenueAddresses(db, { metro, known: [HAVANNA] });
    expect(await upgradeKnownVenueAddresses(db, { metro, known: [HAVANNA] })).toEqual({
      upgraded: 0,
      notes: [],
    });
    expect(await upgradeKnownVenueAddresses(db, { metro, known: undefined })).toEqual({
      upgraded: 0,
      notes: [],
    });
    expect(await upgradeKnownVenueAddresses(db, { metro, known: [] })).toEqual({
      upgraded: 0,
      notes: [],
    });
  });
});
