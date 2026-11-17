import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { Metro } from "@/src/adapters/types";
import type { Db } from "@/src/db/client";
import { metros, venues } from "@/src/db/schema";
import type { VenueAddress } from "@/src/db/schema/venues";
import { loadMetro, resolveVenue } from "@/src/pipeline/store";
import {
  SAME_DOOR_ROW_CAP,
  streetNumberKey,
  venueByStreetNumber,
} from "@/src/pipeline/venue-address-match";
import { emptyVenueReport, formatVenueReport } from "@/src/pipeline/venue-checks";
import { closeTestDb, describeDb, resetDb, testDb } from "@/tests/unit/db-harness";

// Rio run 41322915738 (2026-11-01): Busca Dança gives "Rua Ipiranga, 54, Laranjeiras, ..." with no venue name, and
// Forrozinho's "Restaurante Severyna" is stored at "Rua Ipiranga, 54": the same night was listed twice.

describe("streetNumberKey", () => {
  it("keys an address by its normalised street and house number", () => {
    expect(streetNumberKey("Rua Ipiranga, 54, Laranjeiras, Rio de Janeiro, RJ")).toBe(
      "rua ipiranga|54",
    );
    expect(streetNumberKey("Rua Ipiranga, 54")).toBe("rua ipiranga|54");
    expect(streetNumberKey("R. Ipiranga, 54")).toBe("rua ipiranga|54");
    expect(streetNumberKey("Rua Ipiranga 54")).toBe("rua ipiranga|54");
    expect(streetNumberKey("Rua Visconde de Silva, 14 - Botafogo, Rio de Janeiro, RJ")).toBe(
      "rua visconde de silva|14",
    );
    expect(streetNumberKey("Av. Mem de Sá, 92, Lapa")).toBe("avenida mem de sa|92");
    expect(streetNumberKey("Travessa do Comércio, 20B, Centro")).toBe("travessa do comercio|20b");
  });

  it("tells different numbers apart", () => {
    expect(streetNumberKey("Rua do Catete, 95 - Catete, Rio de Janeiro, RJ")).toBe(
      "rua do catete|95",
    );
    expect(streetNumberKey("Rua do Catete, 97")).toBe("rua do catete|97");
  });

  it("gives no key without a house number", () => {
    expect(
      streetNumberKey("Campo de São Cristóvão, s/n, São Cristóvão, Rio de Janeiro, RJ"),
    ).toBeNull();
    expect(streetNumberKey("Praça São Salvador - Laranjeiras, Rio de Janeiro, RJ")).toBeNull();
    expect(streetNumberKey("Rio de Janeiro, RJ")).toBeNull();
    expect(streetNumberKey("54")).toBeNull();
    expect(streetNumberKey("")).toBeNull();
  });
});

describe("the run report's same-door line", () => {
  it("counts the addresses placed at a named venue, with each one, under the venue lines", () => {
    const report = emptyVenueReport();
    report.sameDoor = [
      "Rua Ipiranga, 54, Laranjeiras, Rio de Janeiro, RJ: placed at Restaurante Severyna",
      "Rua Visconde de Silva, 14 - Botafogo, Rio de Janeiro, RJ: placed at TLT Bar",
    ];
    const text = formatVenueReport(report);
    expect(text).toContain(
      "\nSame street and number: 2 addresses with no venue name placed at the named venue there (address_match).",
    );
    expect(text).toContain(
      "\n  - Rua Ipiranga, 54, Laranjeiras, Rio de Janeiro, RJ: placed at Restaurante Severyna",
    );
    expect(text.startsWith("Venues: no listed point far from its address")).toBe(true);

    report.sameDoor = ["Rua Ipiranga, 54: placed at Restaurante Severyna"];
    expect(formatVenueReport(report)).toContain(
      "Same street and number: 1 address with no venue name placed",
    );
  });

  it("lists the addresses that hit the candidate cap, so the cap is never silent", () => {
    const report = emptyVenueReport();
    report.sameDoorCapped = ["Rua Ipiranga, 54, Laranjeiras, Rio de Janeiro, RJ"];
    const text = formatVenueReport(report);
    expect(text).toContain(
      "\naddress_match cap reached: 1 address (more than 200 stored venues share its street word and number), left to the geocoder:",
    );
    expect(text).toContain("\n  - Rua Ipiranga, 54, Laranjeiras, Rio de Janeiro, RJ");
    report.sameDoorCapped.push("Rua Alfa, 1");
    expect(formatVenueReport(report)).toContain("address_match cap reached: 2 addresses (");
  });

  it("puts the same-door lines after the other venue notes", () => {
    const report = emptyVenueReport();
    report.moved = ["Terminal 5: moved"];
    report.sameDoor = ["Rua Ipiranga, 54: placed at Restaurante Severyna"];
    const text = formatVenueReport(report);
    expect(text.indexOf("Terminal 5: moved")).toBeLessThan(text.indexOf("Same street and number"));
  });

  it("says nothing when no address was placed that way", () => {
    expect(formatVenueReport(emptyVenueReport())).not.toContain("Same street and number");
    expect(formatVenueReport(emptyVenueReport())).not.toContain("cap reached");
    expect(formatVenueReport({ ...emptyVenueReport(), sameDoor: [] })).not.toContain(
      "Same street and number",
    );
  });
});

const METRO_ID = randomUUID();
let db: Db;
let metro: Metro;

async function venue(
  name: string,
  address: VenueAddress | null,
  point: { lat: number; lng: number } = { lat: -22.9335, lng: -43.1795 },
  blocklisted = false,
): Promise<string> {
  const id = randomUUID();
  await db.insert(venues).values({
    id,
    metroId: METRO_ID,
    name,
    nameNormalized: name.toLowerCase(),
    address,
    location: sql`ST_SetSRID(ST_MakePoint(${point.lng}, ${point.lat}), 4326)::geography`,
    tz: "America/Sao_Paulo",
    blocklisted,
  });
  return id;
}

const ADDRESS = "Rua Ipiranga, 54, Laranjeiras, Rio de Janeiro, RJ";

describeDb("venueByStreetNumber, against Postgres with PostGIS", () => {
  beforeAll(async () => {
    db = await testDb("venue-address-match");
  });
  afterAll(closeTestDb);

  beforeEach(async () => {
    await resetDb();
    await db.insert(metros).values({
      id: METRO_ID,
      slug: "rio-de-janeiro",
      name: "Rio de Janeiro",
      countryCode: "BR",
      center: { lat: -22.9128, lng: -43.18 },
      radiusKm: 65,
      tz: "America/Sao_Paulo",
      languages: ["pt"],
      status: "active",
    });
    metro = (await loadMetro(db, "rio-de-janeiro"))!;
  });

  it("finds the one named venue stored at the same street and number", async () => {
    const severyna = await venue("Restaurante Severyna", {
      formatted: "Rua Ipiranga, 54, Rio de Janeiro, RJ",
    });
    await venue("Bar Vizinho", { formatted: "Rua Ipiranga, 56, Rio de Janeiro, RJ" });
    const found = await venueByStreetNumber(db, metro, ADDRESS);
    expect(found?.id).toBe(severyna);
    expect(found?.location.lat).toBeCloseTo(-22.9335, 4);
    expect(found?.location.lng).toBeCloseTo(-43.1795, 4);
  });

  it("matches a stored line1 too", async () => {
    const tlt = await venue("TLT Bar", { line1: "R. Visconde de Silva, 14" });
    expect(
      (
        await venueByStreetNumber(
          db,
          metro,
          "Rua Visconde de Silva, 14 - Botafogo, Rio de Janeiro, RJ",
        )
      )?.id,
    ).toBe(tlt);
  });

  it("never matches another house number", async () => {
    await venue("Glorioso Cultural", { formatted: "Rua do Catete, 97, Rio de Janeiro, RJ" });
    expect(
      await venueByStreetNumber(db, metro, "Rua do Catete, 95 - Catete, Rio de Janeiro, RJ"),
    ).toBeNull();
  });

  it("ignores a venue named after its own address (D-082)", async () => {
    await venue(ADDRESS, { formatted: ADDRESS });
    expect(await venueByStreetNumber(db, metro, ADDRESS)).toBeNull();
    const severyna = await venue("Restaurante Severyna", { formatted: "Rua Ipiranga, 54" });
    expect((await venueByStreetNumber(db, metro, ADDRESS))?.id).toBe(severyna);
  });

  it("never takes another number that contains it, or a postcode, for the same door", async () => {
    const severyna = await venue("Restaurante Severyna", { formatted: "Rua Ipiranga, 54" });
    await venue("Bar Cento e Cinquenta", { formatted: "Rua Ipiranga, 154, Rio de Janeiro, RJ" });
    await venue("Loja Quinhentos", { formatted: "Rua Ipiranga, 540" });
    await venue("Casa CEP", {
      formatted: "Rua das Laranjeiras, 12, 22540-054, Rio de Janeiro, RJ",
    });
    await venue("Outra Rua", { formatted: "Rua Pereira da Silva, 54" });
    const found = await venueByStreetNumber(db, metro, ADDRESS);
    expect(found?.id).toBe(severyna);
    expect(found?.name).toBe("Restaurante Severyna");
  });

  it("matches the street's main word whatever its accents", async () => {
    const hops = await venue("Hops Rio", { formatted: "Travessa do Comercio, 20, Centro" });
    expect(
      (await venueByStreetNumber(db, metro, "Travessa do Comércio, 20, Centro, Rio de Janeiro, RJ"))
        ?.id,
    ).toBe(hops);
  });

  it("folds ñ the same way in the stored address (Spanish-speaking metros)", async () => {
    const bar = await venue("Bar Español", { formatted: "Calle España, 54, Centro" });
    expect((await venueByStreetNumber(db, metro, "Calle España, 54"))?.id).toBe(bar);
  });

  it("returns nothing when the candidate rows reach the cap (too many to be sure)", async () => {
    await venue("Restaurante Severyna", { formatted: "Rua Ipiranga, 54" });
    await db.insert(venues).values(
      Array.from({ length: SAME_DOOR_ROW_CAP }, (_, i) => ({
        id: randomUUID(),
        metroId: METRO_ID,
        name: `Loja ${i}`,
        nameNormalized: `loja ${i}`,
        address: { formatted: `Rua Ipiranga, 54${i}` },
        location: sql`ST_SetSRID(ST_MakePoint(${-43.1795}, ${-22.9335}), 4326)::geography`,
        tz: "America/Sao_Paulo",
      })),
    );
    let capped = 0;
    expect(await venueByStreetNumber(db, metro, ADDRESS, () => capped++)).toBeNull();
    expect(capped).toBe(1);
  });

  it("returns nothing when two named venues share the street and number", async () => {
    await venue("Restaurante Severyna", { formatted: "Rua Ipiranga, 54" });
    await venue("Galeria Ipiranga", { formatted: "Rua Ipiranga, 54, loja 2" });
    expect(await venueByStreetNumber(db, metro, ADDRESS)).toBeNull();
  });

  it("skips blocklisted venues and venues outside the metro", async () => {
    await venue("Fechado", { formatted: "Rua Ipiranga, 54" }, undefined, true);
    await venue("Severyna SP", { formatted: "Rua Ipiranga, 54" }, { lat: -23.5505, lng: -46.6333 });
    expect(await venueByStreetNumber(db, metro, ADDRESS)).toBeNull();
  });

  it("returns nothing for an address without a key or a venue without an address", async () => {
    await venue("Sem Endereço", null);
    expect(
      await venueByStreetNumber(db, metro, "Campo de São Cristóvão, s/n, São Cristóvão"),
    ).toBeNull();
    expect(await venueByStreetNumber(db, metro, ADDRESS)).toBeNull();
  });
  it("places an address-only listing at that venue in resolveVenue, without geocoding", async () => {
    const severyna = await venue("Restaurante Severyna", { formatted: "Rua Ipiranga, 54" });
    const report = emptyVenueReport();
    let geocoded = 0;
    const geocode = async () => {
      geocoded++;
      return { lat: -22.934, lng: -43.18 };
    };
    const placed = await resolveVenue(
      db,
      metro,
      { name: null, address: ADDRESS, url: null, location: null },
      geocode,
      { report },
    );
    expect(placed).toMatchObject({ venueId: severyna, created: false, method: "address_match" });
    expect(report.sameDoor).toEqual([`${ADDRESS}: placed at Restaurante Severyna`]);
    expect(geocoded).toBe(0);

    // A named listing, or one with its own point, keeps the old path.
    const named = await resolveVenue(
      db,
      metro,
      { name: "Outro Bar", address: "Rua do Catete, 95", url: null, location: null },
      geocode,
    );
    expect(named?.method).not.toBe("address_match");
    // The venue that listing created is now the one named venue at Rua do Catete, 95.
    const sameDoor = await resolveVenue(
      db,
      metro,
      {
        name: null,
        address: "Rua do Catete, 95 - Catete, Rio de Janeiro, RJ",
        url: null,
        location: null,
      },
      geocode,
    );
    expect(sameDoor).toMatchObject({ venueId: named?.venueId, method: "address_match" });
    // No match: geocoded and created under its address, as before (D-082).
    const other = await resolveVenue(
      db,
      metro,
      {
        name: null,
        address: "Rua do Catete, 99 - Catete, Rio de Janeiro, RJ",
        url: null,
        location: null,
      },
      geocode,
    );
    expect(other?.method).toBe("created");
  });
});
