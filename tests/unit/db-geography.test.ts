import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { type GeoPoint, parseEwkbPoint, pointToSql } from "@/src/db/schema/geography";

/** Encodes a point as hex EWKB the way PostGIS does, for both byte orders. */
function encodeEwkbPoint(
  point: GeoPoint,
  options: { littleEndian?: boolean; srid?: number | null; z?: number } = {},
): string {
  const littleEndian = options.littleEndian ?? true;
  const srid = options.srid === undefined ? 4326 : options.srid;
  const hasZ = options.z !== undefined;
  const size = 5 + (srid === null ? 0 : 4) + 16 + (hasZ ? 8 : 0);
  const bytes = new Uint8Array(size);
  const view = new DataView(bytes.buffer);
  bytes[0] = littleEndian ? 1 : 0;
  let type = 1;
  if (srid !== null) type |= 0x20000000;
  if (hasZ) type |= 0x80000000;
  view.setUint32(1, type >>> 0, littleEndian);
  let offset = 5;
  if (srid !== null) {
    view.setUint32(offset, srid, littleEndian);
    offset += 4;
  }
  view.setFloat64(offset, point.lng, littleEndian);
  view.setFloat64(offset + 8, point.lat, littleEndian);
  if (hasZ) view.setFloat64(offset + 16, options.z ?? 0, littleEndian);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

const empireState: GeoPoint = { lng: -73.9857, lat: 40.7484 };

describe("parseEwkbPoint", () => {
  it("reads a little-endian point with SRID 4326, as PostGIS emits it", () => {
    const hex = encodeEwkbPoint(empireState);
    expect(hex.startsWith("0101000020e6100000")).toBe(true);
    expect(parseEwkbPoint(hex)).toEqual(empireState);
  });

  it("accepts upper-case hex", () => {
    expect(parseEwkbPoint(encodeEwkbPoint(empireState).toUpperCase())).toEqual(empireState);
  });

  it("reads a big-endian point", () => {
    const hex = encodeEwkbPoint(empireState, { littleEndian: false });
    expect(hex.startsWith("0020000001000010e6")).toBe(true);
    expect(parseEwkbPoint(hex)).toEqual(empireState);
  });

  it("reads a point without an SRID", () => {
    expect(parseEwkbPoint(encodeEwkbPoint(empireState, { srid: null }))).toEqual(empireState);
  });

  it("ignores a Z coordinate", () => {
    expect(parseEwkbPoint(encodeEwkbPoint(empireState, { z: 12 }))).toEqual(empireState);
  });

  it("keeps the sign and precision of coordinates in every hemisphere", () => {
    for (const point of [
      { lng: 151.2093, lat: -33.8688 },
      { lng: -0.1276, lat: 51.5072 },
      { lng: 0, lat: 0 },
      { lng: -179.999999, lat: 89.999999 },
    ]) {
      expect(parseEwkbPoint(encodeEwkbPoint(point))).toEqual(point);
    }
  });

  it("rejects a linestring", () => {
    const hex = encodeEwkbPoint(empireState).replace(/^0101000020/, "0102000020");
    expect(() => parseEwkbPoint(hex)).toThrow(/Expected a point/);
  });

  it("rejects truncated, odd-length and non-hex input", () => {
    const hex = encodeEwkbPoint(empireState);
    expect(() => parseEwkbPoint(hex.slice(0, 30))).toThrow(/Not a hex EWKB point/);
    expect(() => parseEwkbPoint(hex.slice(0, 41))).toThrow(/Not a hex EWKB point/);
    expect(() => parseEwkbPoint("zz" + hex.slice(2))).toThrow(/Not a hex EWKB point/);
    expect(() => parseEwkbPoint(hex.slice(0, 42))).toThrow(/Truncated/);
  });
});

describe("pointToSql", () => {
  it("writes the point through ST_MakePoint with SRID 4326 as geography, longitude first", () => {
    const query = new PgDialect().sqlToQuery(pointToSql(empireState));
    expect(query.sql).toBe("ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography");
    expect(query.params).toEqual([-73.9857, 40.7484]);
  });
});
