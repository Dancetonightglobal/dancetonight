// Same-door placement for address-only listings (Rio, 2026-11-01). A source that gives a street
// address but no venue name is placed at the ONE stored, named venue whose stored address has the
// same street and house number, by text only. Distance is never used, so D-082 stands.

import { sql } from "drizzle-orm";

import type { Db } from "@/src/db/client";
import type { Metro } from "@/src/adapters/types";
import type { Point } from "@/src/domain/listing";
import { venues } from "@/src/db/schema";
import { normalizeAddress } from "@/src/pipeline/geocode";

/** More candidate rows than this and the door is ambiguous: no match, and the run reports it. */
export const SAME_DOOR_ROW_CAP = 200;

const LEADING_ABBREVIATIONS: Record<string, string> = {
  r: "rua",
  av: "avenida",
  trav: "travessa",
  tv: "travessa",
  pca: "praca",
  pc: "praca",
};

/**
 * An address's street-and-number key, `"<street>|<number>"`, or null when it has no house number.
 *
 * The number is the leading `\d+[A-Za-z]?` of the part after the first comma ("14 - Botafogo"
 * gives 14), else a trailing number on the first part ("Rua Ipiranga 54"). The street is
 * `normalizeAddress` of the first part, a leading abbreviation expanded (R., Av., Trav., Tv., Pça,
 * Pc), accents removed (NFD, combining marks U+0300-U+036F stripped). A street with no letter
 * gives null.
 */
export function streetNumberKey(address: string): string | null {
  const parts = address.split(",").map((p) => p.trim());
  const first = parts[0] ?? "";
  let street = first;
  let number: string | null = parts[1]?.match(/^(\d+[A-Za-z]?)\b/)?.[1] ?? null;
  if (!number) {
    const trailing = first.match(/^(.*\D)\s+(\d+[A-Za-z]?)$/);
    if (trailing) {
      street = (trailing[1] ?? "").trim();
      number = trailing[2] ?? null;
    }
  }
  if (!number) return null;

  const words = normalizeAddress(street).split(/\s+/).filter(Boolean);
  const expanded = words[0] ? LEADING_ABBREVIATIONS[words[0]] : undefined;
  if (expanded) words[0] = expanded;
  const normalised = words
    .join(" ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  if (!/[a-z]/.test(normalised)) return null;
  return `${normalised}|${number.toLowerCase()}`;
}

/**
 * The one stored, named venue in the metro at the same street and number as `address`, as
 * `{ id, name, location }`, or null.
 *
 * Candidates: not blocklisted, inside the metro radius, and their formatted address or line1
 * holds the street's main word (its longest word over two letters) and the number, compared
 * without accents. More than SAME_DOOR_ROW_CAP candidates: `onCapReached` is called and null is
 * returned. Kept: candidates whose formatted or line1 key equals the address's key and whose name
 * is not that same address (a venue D-082 created under its address does not count). Exactly one
 * venue kept is the match; none or several give null.
 */
export async function venueByStreetNumber(
  db: Db,
  metro: Metro,
  address: string,
  onCapReached?: () => void,
): Promise<{ id: string; name: string; location: Point } | null> {
  const key = streetNumberKey(address);
  if (!key) return null;
  const [street = "", number = ""] = key.split("|");
  const mainWord = street
    .split(/\s+/)
    .filter((w) => w.length > 2)
    .reduce((longest, word) => (word.length > longest.length ? word : longest), "");
  if (!mainWord || !number) return null;

  const centre = sql`ST_SetSRID(ST_MakePoint(${metro.center.lng}, ${metro.center.lat}), 4326)::geography`;
  // Accents folded the way streetNumberKey folds them; both strings are 26 characters long.
  const stored = sql`translate(lower(coalesce(${venues.address}->>'formatted', '') || ' ' || coalesce(${venues.address}->>'line1', '')), 'áàâãäéèêëíìîïóòôõöúùûüçñýÿ', 'aaaaaeeeeiiiiooooouuuucnyy')`;
  const rows = await db
    .select({
      id: venues.id,
      name: venues.name,
      address: venues.address,
      lat: sql<number>`ST_Y(${venues.location}::geometry)`,
      lng: sql<number>`ST_X(${venues.location}::geometry)`,
    })
    .from(venues)
    .where(
      sql`${venues.blocklisted} = false
        AND ST_DWithin(${venues.location}, ${centre}, ${metro.radiusKm * 1000})
        AND ${stored} LIKE ${`%${mainWord}%`}
        AND ${stored} LIKE ${`%${number}%`}`,
    )
    .limit(SAME_DOOR_ROW_CAP + 1);

  if (rows.length > SAME_DOOR_ROW_CAP) {
    onCapReached?.();
    return null;
  }

  const kept = rows.filter((row) => {
    const formatted = row.address?.formatted ? streetNumberKey(row.address.formatted) : null;
    const line1 = row.address?.line1 ? streetNumberKey(row.address.line1) : null;
    return (formatted === key || line1 === key) && streetNumberKey(row.name) !== key;
  });
  if (new Set(kept.map((r) => r.id)).size !== 1) return null;
  const [match] = kept;
  if (!match) return null;
  return {
    id: match.id,
    name: match.name,
    location: { lat: Number(match.lat), lng: Number(match.lng) },
  };
}
