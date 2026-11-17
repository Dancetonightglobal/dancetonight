// `pnpm seed:venues --metro nyc --file places.ndjson`: load the Overture places that
// scripts/overture_places.py pulled into `venues` (D-028, D-044). `--print-categories` prints the
// Overture categories to pull, so the workflow and this loader read one list (config/venues.ts).
//
// Every row is validated, kept only when it lies inside the metro's radius (the pull is a
// rectangle), and upserted on its Overture id, so the monthly re-seed updates in place. The
// provider datasets and licences are stored per row (D-028).

import { readFile } from "node:fs/promises";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { normalizeForMatch } from "@/config/styles";
import { OVERTURE_MIN_CONFIDENCE, OVERTURE_SEED_CATEGORIES } from "@/config/venues";
import { closeDb, getDb, type Db } from "@/src/db/client";
import { venues } from "@/src/db/schema";
import type { Socials } from "@/src/db/schema/venues";
import { insideMetro } from "@/src/domain/metro-bounds";
import { zoneForPoint } from "@/src/domain/zone";
import { loadMetro, pipelineId } from "@/src/pipeline/store";
import type { Metro } from "@/src/adapters/types";

const placeSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1),
  category: z.string(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  confidence: z.number().nullable(),
  websites: z.array(z.string()).default([]),
  socials: z.array(z.string()).default([]),
  address: z
    .object({
      freeform: z.string().nullable().optional(),
      locality: z.string().nullable().optional(),
      postcode: z.string().nullable().optional(),
      region: z.string().nullable().optional(),
      country: z.string().nullable().optional(),
    })
    .nullable()
    .default(null),
  datasets: z.array(z.string()).default([]),
  licenses: z.array(z.string()).default([]),
  release: z.string(),
});
export type OverturePlace = z.infer<typeof placeSchema>;

const SOCIAL_HOSTS: Array<[RegExp, keyof Omit<Socials, "other">]> = [
  [/(^|\.)facebook\.com$/i, "facebook"],
  [/(^|\.)instagram\.com$/i, "instagram"],
  [/(^|\.)tiktok\.com$/i, "tiktok"],
  [/(^|\.)youtube\.com$/i, "youtube"],
  [/(^|\.)(x|twitter)\.com$/i, "x"],
  [/(^|\.)threads\.net$/i, "threads"],
  [/(^|\.)bsky\.app$/i, "bluesky"],
];

function hostOf(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.hostname : null;
  } catch {
    return null;
  }
}

/** The venue's own website (not a social profile), and its social links by network. */
export function splitLinks(
  websites: string[],
  socials: string[],
): { website: string | null; socials: Socials | null } {
  const out: Socials = {};
  let website: string | null = null;
  for (const url of [...websites, ...socials]) {
    const host = hostOf(url);
    if (!host) continue;
    const network = SOCIAL_HOSTS.find(([re]) => re.test(host))?.[1];
    if (network) out[network] ??= url;
    else if (!website && websites.includes(url)) website = url;
  }
  return { website, socials: Object.keys(out).length > 0 ? out : null };
}

export function toVenueRow(place: OverturePlace, metro: Metro) {
  const category = OVERTURE_SEED_CATEGORIES[place.category];
  if (!category) return null;
  if ((place.confidence ?? 0) < OVERTURE_MIN_CONFIDENCE) return null;
  // The metro's outline when it has one, else its circle (D-755): never a second copy of the test.
  if (!insideMetro(metro, { lat: place.lat, lng: place.lng })) return null;
  const nameNormalized = normalizeForMatch(place.name);
  if (!nameNormalized) return null;
  const a = place.address;
  const formatted =
    [a?.freeform, a?.locality, a?.region, a?.postcode].filter(Boolean).join(", ") || null;
  const links = splitLinks(place.websites, place.socials);
  return {
    id: pipelineId("venue", `overture:${place.id}`),
    name: place.name,
    nameNormalized,
    location: { lat: place.lat, lng: place.lng },
    address: a
      ? {
          line1: a.freeform ?? null,
          locality: a.locality ?? null,
          region: a.region ?? null,
          postcode: a.postcode ?? null,
          countryCode: a.country ?? null,
          formatted,
        }
      : null,
    tz: zoneForPoint(place.lat, place.lng) ?? metro.tz,
    overtureId: place.id,
    seedProvider: `overture ${place.release} (${place.datasets.join(", ") || "unknown"})`,
    seedLicence: place.licenses.join("; ") || "CDLA-Permissive-2.0",
    seedRecordId: place.id,
    websiteUrl: links.website,
    socials: links.socials,
    kind: category.kind,
    danceFloor: category.danceFloor,
    metroId: metro.id,
  };
}

export async function seedVenues(
  db: Db,
  metro: Metro,
  places: OverturePlace[],
): Promise<{ written: number; skipped: number }> {
  const rows = places
    .map((p) => toVenueRow(p, metro))
    .filter((r): r is NonNullable<typeof r> => r !== null);
  for (let i = 0; i < rows.length; i += 500) {
    await db
      .insert(venues)
      .values(rows.slice(i, i + 500))
      .onConflictDoUpdate({
        target: venues.overtureId,
        set: {
          name: sql`excluded.name`,
          nameNormalized: sql`excluded.name_normalized`,
          location: sql`excluded.location`,
          address: sql`excluded.address`,
          seedProvider: sql`excluded.seed_provider`,
          seedLicence: sql`excluded.seed_licence`,
          websiteUrl: sql`coalesce(excluded.website_url, ${venues.websiteUrl})`,
          socials: sql`coalesce(excluded.socials, ${venues.socials})`,
          kind: sql`excluded.kind`,
          // A floor confirmed by a listing is never downgraded by the seed.
          danceFloor: sql`case when ${venues.danceFloor} = 'yes' then ${venues.danceFloor} else excluded.dance_floor end`,
          updatedAt: sql`now()`,
        },
      });
  }
  return { written: rows.length, skipped: places.length - rows.length };
}

export function parsePlaces(ndjson: string): { places: OverturePlace[]; invalid: number } {
  const places: OverturePlace[] = [];
  let invalid = 0;
  for (const line of ndjson.split("\n")) {
    if (!line.trim()) continue;
    try {
      const parsed = placeSchema.safeParse(JSON.parse(line));
      if (parsed.success) places.push(parsed.data);
      else invalid += 1;
    } catch {
      invalid += 1;
    }
  }
  return { places, invalid };
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<number> {
  if (process.argv.includes("--print-categories")) {
    console.log(Object.keys(OVERTURE_SEED_CATEGORIES).join(","));
    return 0;
  }
  const slug = arg("metro");
  const file = arg("file");
  if (!slug || !file) {
    console.error("usage: pnpm seed:venues --metro nyc --file places.ndjson");
    return 2;
  }
  const db = getDb();
  const metro = await loadMetro(db, slug);
  if (!metro) {
    console.error(`no metro "${slug}" in the database; run pnpm db:seed first`);
    return 1;
  }
  const { places, invalid } = parsePlaces(await readFile(file, "utf8"));
  const result = await seedVenues(db, metro, places);
  console.log(
    `venues: ${result.written} upserted for ${metro.name}; ${result.skipped} outside the radius, below confidence or not a seed category; ${invalid} invalid lines`,
  );
  return 0;
}

if (process.argv[1]?.endsWith("seed-venues.ts")) {
  main()
    .then(async (code) => {
      await closeDb();
      process.exit(code);
    })
    .catch(async (error: unknown) => {
      console.error("seed:venues failed:", error instanceof Error ? error.message : error);
      await closeDb();
      process.exit(1);
    });
}
