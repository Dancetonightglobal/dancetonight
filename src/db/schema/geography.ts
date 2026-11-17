import { sql, type SQL } from "drizzle-orm";
import { customType } from "drizzle-orm/pg-core";

/** A WGS 84 point. Longitude first, as GeoJSON and PostGIS order it. */
export type GeoPoint = { lng: number; lat: number };

const EWKB_SRID_FLAG = 0x20000000;
const EWKB_Z_FLAG = 0x80000000;
const EWKB_M_FLAG = 0x40000000;
const WKB_POINT = 1;

/**
 * Parses the hex EWKB that PostGIS emits for a `geography(Point, 4326)` value
 * (postgres.js hands it over as a string). Throws on anything that is not a point.
 */
export function parseEwkbPoint(hex: string): GeoPoint {
  if (typeof hex !== "string" || hex.length < 42 || hex.length % 2 !== 0) {
    throw new Error(`Not a hex EWKB point: ${String(hex).slice(0, 40)}`);
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    const byte = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) throw new Error(`Not a hex EWKB point: ${hex.slice(0, 40)}`);
    bytes[i] = byte;
  }
  const view = new DataView(bytes.buffer);
  const littleEndian = bytes[0] === 1;
  const typeWord = view.getUint32(1, littleEndian);
  const geometryType = typeWord & 0xffff;
  if (geometryType !== WKB_POINT) {
    throw new Error(`Expected a point, got WKB geometry type ${geometryType}`);
  }
  let offset = 5;
  if (typeWord & EWKB_SRID_FLAG) offset += 4;
  const coordinateCount = 2 + (typeWord & EWKB_Z_FLAG ? 1 : 0) + (typeWord & EWKB_M_FLAG ? 1 : 0);
  if (bytes.length < offset + coordinateCount * 8) {
    throw new Error("Truncated EWKB point");
  }
  const lng = view.getFloat64(offset, littleEndian);
  const lat = view.getFloat64(offset + 8, littleEndian);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
    throw new Error("EWKB point has non-finite coordinates");
  }
  return { lng, lat };
}

/** The SQL that writes a point as a geography value. */
export function pointToSql(point: GeoPoint): SQL {
  return sql`ST_SetSRID(ST_MakePoint(${point.lng}, ${point.lat}), 4326)::geography`;
}

/**
 * `geography(Point, 4326)`: read back as `{ lng, lat }`, written through ST_MakePoint.
 * Needs the PostGIS extension, created by src/db/migrations/0000_extensions.sql.
 */
export const geography = customType<{ data: GeoPoint; driverData: string }>({
  dataType() {
    return "geography(Point, 4326)";
  },
  toDriver(value) {
    return pointToSql(value);
  },
  fromDriver(value) {
    return parseEwkbPoint(value);
  },
});
