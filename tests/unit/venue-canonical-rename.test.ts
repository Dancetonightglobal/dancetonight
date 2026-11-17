import { eq } from "drizzle-orm";
import { describe, beforeAll, afterAll, beforeEach, test, expect } from "vitest";

import { closeTestDb, describeDb, requireDbInCi, resetDb, testDb } from "@/tests/unit/db-harness";
import type { KnownVenue } from "@/config/known-venues";
import { normalizeForMatch } from "@/config/styles";
import { canonicalEntryFor, renameToCanonical } from "@/src/pipeline/venue-canonical";
import { emptyVenueReport, formatVenueReport } from "@/src/pipeline/venue-checks";
import { metros, venues } from "@/src/db/schema";
import type { Metro } from "@/src/adapters/types";
import { loadMetro, resolveVenue } from "@/src/pipeline/store";

describeDb("venue-canonical-rename", () => {
  requireDbInCi();
  let db: Awaited<ReturnType<typeof testDb>>;
  let metro: Metro;
  let metroId: string;

  beforeAll(async () => {
    db = await testDb("venue_canonical");
  });

  afterAll(closeTestDb);

  beforeEach(async () => {
    await resetDb();
    await db.insert(metros).values({
      slug: "philadelphia",
      name: "Philadelphia",
      countryCode: "US",
      center: { lat: 39.9526, lng: -75.1652 },
      radiusKm: 50,
      tz: "America/New_York",
      languages: ["en"],
    });
    metro = (await loadMetro(db, "philadelphia"))!;
    metroId = metro.id;
  });

  const KNOWN: KnownVenue[] = [
    {
      names: ["Spades Restaurant & Lounge", "Spades Restaurant & Lounge | SpadesPHL", "SpadesPHL"],
      address: "4022 Lancaster Ave, Philadelphia, PA 19104",
      canonical: true,
    },
    {
      names: ["Other Bar", "Other Bar | X"],
      address: "123 Main St, Philadelphia, PA 19107",
      canonical: false,
    },
  ];

  test("canonicalEntryFor returns null for null name", () => {
    expect(canonicalEntryFor(null, KNOWN)).toBeNull();
  });

  test("canonicalEntryFor returns null for undefined known", () => {
    expect(canonicalEntryFor("Spades Restaurant & Lounge", undefined)).toBeNull();
  });

  test("canonicalEntryFor matches case-insensitively", () => {
    const entry = canonicalEntryFor("spades restaurant & lounge", KNOWN);
    expect(entry).toBeTruthy();
    expect(entry?.names[0]).toBe("Spades Restaurant & Lounge");
  });

  test("formatVenueReport unchanged by new field", () => {
    const report = emptyVenueReport();
    expect(formatVenueReport(report)).toBe(
      "Venues: no listed point far from its address, no placeholder addresses.",
    );
  });

  test("stored alias matches and gets renamed", async () => {
    const venueId = "00000000-0000-4000-8000-000000000001";
    const storedName = "Spades Restaurant & Lounge | SpadesPHL";
    await db.insert(venues).values({
      id: venueId,
      name: storedName,
      nameNormalized: normalizeForMatch(storedName),
      location: { lat: 39.9612, lng: -75.2015 },
      address: { formatted: "4022 Lancaster Ave, Philadelphia, PA 19104" },
      tz: "America/New_York",
      seedProvider: "listing",
      metroId: metroId,
    });

    const report = emptyVenueReport();
    const result = await renameToCanonical(
      db,
      venueId,
      "Spades Restaurant & Lounge",
      KNOWN,
      report,
    );
    expect(result).toBe("Spades Restaurant & Lounge");

    const updated = await db
      .select({ name: venues.name, nameNormalized: venues.nameNormalized })
      .from(venues)
      .where(eq(venues.id, venueId));
    const row = updated[0];
    expect(row).toBeDefined();
    expect(row!.name).toBe("Spades Restaurant & Lounge");
    expect(row!.nameNormalized).toBe(normalizeForMatch("Spades Restaurant & Lounge"));

    expect(report.renamed).toEqual([
      "Spades Restaurant & Lounge | SpadesPHL -> Spades Restaurant & Lounge",
    ]);
    expect(formatVenueReport(report)).toContain(
      "Venue renamed to canonical: Spades Restaurant & Lounge | SpadesPHL -> Spades Restaurant & Lounge",
    );
  });

  test("stored name not an alias returns null", async () => {
    const venueId = "00000000-0000-4000-8000-000000000002";
    const storedName = "Spades Annex";
    await db.insert(venues).values({
      id: venueId,
      name: storedName,
      nameNormalized: normalizeForMatch(storedName),
      location: { lat: 39.9612, lng: -75.2015 },
      address: { formatted: "4022 Lancaster Ave, Philadelphia, PA 19104" },
      tz: "America/New_York",
      seedProvider: "listing",
      metroId: metroId,
    });

    const result = await renameToCanonical(db, venueId, "Spades Restaurant & Lounge", KNOWN);
    expect(result).toBeNull();

    const unchanged = await db
      .select({ name: venues.name })
      .from(venues)
      .where(eq(venues.id, venueId));
    const row = unchanged[0];
    expect(row).toBeDefined();
    expect(row!.name).toBe("Spades Annex");
  });

  test("already canonical name returns null", async () => {
    const venueId = "00000000-0000-4000-8000-000000000003";
    const storedName = "Spades Restaurant & Lounge";
    await db.insert(venues).values({
      id: venueId,
      name: storedName,
      nameNormalized: normalizeForMatch(storedName),
      location: { lat: 39.9612, lng: -75.2015 },
      address: { formatted: "4022 Lancaster Ave, Philadelphia, PA 19104" },
      tz: "America/New_York",
      seedProvider: "listing",
      metroId: metroId,
    });

    const result = await renameToCanonical(db, venueId, "Spades Restaurant & Lounge", KNOWN);
    expect(result).toBeNull();
  });

  test("non-canonical entry does not rename", async () => {
    const venueId = "00000000-0000-4000-8000-000000000004";
    const storedName = "Other Bar | X";
    await db.insert(venues).values({
      id: venueId,
      name: storedName,
      nameNormalized: normalizeForMatch(storedName),
      location: { lat: 39.9612, lng: -75.2015 },
      address: { formatted: "123 Main St, Philadelphia, PA 19107" },
      tz: "America/New_York",
      seedProvider: "listing",
      metroId: metroId,
    });

    const result = await renameToCanonical(db, venueId, "Other Bar", KNOWN);
    expect(result).toBeNull();

    const unchanged = await db
      .select({ name: venues.name })
      .from(venues)
      .where(eq(venues.id, venueId));
    const row = unchanged[0];
    expect(row).toBeDefined();
    expect(row!.name).toBe("Other Bar | X");
  });

  test("listing name is alias not names[0] returns null", async () => {
    const venueId = "00000000-0000-4000-8000-000000000005";
    const storedName = "Spades Restaurant & Lounge | SpadesPHL";
    await db.insert(venues).values({
      id: venueId,
      name: storedName,
      nameNormalized: normalizeForMatch(storedName),
      location: { lat: 39.9612, lng: -75.2015 },
      address: { formatted: "4022 Lancaster Ave, Philadelphia, PA 19104" },
      tz: "America/New_York",
      seedProvider: "listing",
      metroId: metroId,
    });

    const result = await renameToCanonical(db, venueId, "SpadesPHL", KNOWN);
    expect(result).toBeNull();
  });

  test("unknown venueId returns null", async () => {
    const result = await renameToCanonical(
      db,
      "00000000-0000-4000-8000-000000000999",
      "Spades Restaurant & Lounge",
      KNOWN,
    );
    expect(result).toBeNull();
  });

  test("resolveVenue renames the alias-named venue a listing matches, by name or near its point", async () => {
    const venueId = "00000000-0000-4000-8000-000000000009";
    const storedName = "Spades Restaurant & Lounge | SpadesPHL";
    await db.insert(venues).values({
      id: venueId,
      name: storedName,
      nameNormalized: normalizeForMatch(storedName),
      location: { lat: 39.9612, lng: -75.2015 },
      address: { formatted: "4022 Lancaster Ave, Philadelphia, PA 19104" },
      tz: "America/New_York",
      seedProvider: "listing",
      metroId: metroId,
    });
    const input = {
      name: "Spades Restaurant & Lounge",
      address: "4022 Lancaster Ave, Philadelphia, PA 19104",
      url: null,
      location: { lat: 39.9612, lng: -75.2015 },
    };
    // Without the known venues nothing is renamed.
    const plain = await resolveVenue(db, metro, input);
    expect(plain?.venueId).toBe(venueId);
    const [before] = await db
      .select({ name: venues.name })
      .from(venues)
      .where(eq(venues.id, venueId));
    expect(before?.name).toBe(storedName);

    const report = emptyVenueReport();
    const near = await resolveVenue(db, metro, input, undefined, { known: KNOWN, report });
    expect(near?.venueId).toBe(venueId);
    expect(near?.method).toBe("near_name");
    const [after] = await db
      .select({ name: venues.name })
      .from(venues)
      .where(eq(venues.id, venueId));
    expect(after?.name).toBe("Spades Restaurant & Lounge");
    expect(report.renamed).toEqual([`${storedName} -> Spades Restaurant & Lounge`]);
  });
});
