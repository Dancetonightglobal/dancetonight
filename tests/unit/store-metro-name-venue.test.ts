import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";

import type { Metro } from "@/src/adapters/types";
import type { Db } from "@/src/db/client";
import { metros, venues } from "@/src/db/schema";
import { loadMetro, resolveVenue } from "@/src/pipeline/store";
import { closeTestDb, describeDb, requireDbInCi, resetDb, testDb } from "@/tests/unit/db-harness";

// D-595: Ridley Road Market Bar's own Wix pages name the place "London" with the address
// "49 Ridley Rd, London E8 2NP" (daily check 2026-11-05). The name-only match ran before the
// address was geocoded and put every night at a stored venue called "London" in Wimbledon, so
// dice's copies (at the bar) never paired with them. A place named only by the metro's name is
// no venue's name: the listing is placed by its address.

requireDbInCi();

let db: Db;
let metro: Metro;

const CLUB_POINT = { lat: 40.6, lng: -73.95 };
const DOOR_POINT = { lat: 40.6928, lng: -73.9903 };
const geocode = async () => DOOR_POINT;

describeDb("resolveVenue, a place named only by the metro (D-595)", () => {
  beforeAll(async () => {
    db = await testDb("store-metro-name-venue");
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
    // A stored venue whose name is the metro's name (a real business, far from the listing's door).
    await db.insert(venues).values({
      id: "22222222-2222-4222-8222-222222222222",
      name: "New York",
      nameNormalized: "new york",
      location: CLUB_POINT,
      tz: "America/New_York",
      seedProvider: "listing",
      metroId: metro.id,
    });
  });

  it("places a listing named only 'New York' by its address, not at the venue called New York", async () => {
    const r = await resolveVenue(
      db,
      metro,
      { name: "New York", address: "123 Court St, Brooklyn, NY 11201", url: null, location: null },
      geocode,
    );
    expect(r).not.toBeNull();
    expect(r?.method).not.toBe("name_only");
    expect(r?.location.lat).toBeCloseTo(DOOR_POINT.lat, 4);
    expect(r?.location.lng).toBeCloseTo(DOOR_POINT.lng, 4);
  });

  it("ignores case and spacing in the metro's name", async () => {
    const r = await resolveVenue(
      db,
      metro,
      {
        name: "  NEW YORK ",
        address: "123 Court St, Brooklyn, NY 11201",
        url: null,
        location: null,
      },
      geocode,
    );
    expect(r?.method).not.toBe("name_only");
    expect(r?.location.lat).toBeCloseTo(DOOR_POINT.lat, 4);
  });

  it("does not place a listing named only 'New York' with no address and no point", async () => {
    const r = await resolveVenue(db, metro, {
      name: "New York",
      address: null,
      url: null,
      location: null,
    });
    expect(r).toBeNull();
  });

  it("still matches a real venue name with no point by name", async () => {
    const made = await resolveVenue(db, metro, {
      name: "Copacabana",
      address: null,
      url: null,
      location: { lat: 40.7652, lng: -73.9942 },
    });
    const r = await resolveVenue(db, metro, {
      name: "Copacabana",
      address: null,
      url: null,
      location: null,
    });
    expect(r?.venueId).toBe(made?.venueId);
    expect(r?.method).toBe("name_only");
  });

  it("keeps a venue whose name only contains the metro's name ('New York Social Club')", async () => {
    const made = await resolveVenue(db, metro, {
      name: "New York Social Club",
      address: null,
      url: null,
      location: { lat: 40.73, lng: -73.99 },
    });
    const r = await resolveVenue(db, metro, {
      name: "New York Social Club",
      address: null,
      url: null,
      location: null,
    });
    expect(r?.venueId).toBe(made?.venueId);
  });
});
