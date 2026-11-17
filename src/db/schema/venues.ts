import { sql } from "drizzle-orm";
import {
  pgEnum,
  pgTable,
  uuid,
  text,
  real,
  boolean,
  bigint,
  jsonb,
  index,
  primaryKey,
  foreignKey,
} from "drizzle-orm/pg-core";
import { geography } from "@/src/db/schema/geography";
import { instant, timestamps } from "@/src/db/schema/common";
import { metros } from "@/src/db/schema/metros";

export const venueKindEnum = pgEnum("venue_kind", [
  "night_club",
  "dance_hall",
  "studio",
  "bar",
  "restaurant",
  "community_center",
  "outdoor",
  "other",
]);

export const danceFloorEnum = pgEnum("dance_floor", ["yes", "no", "unknown"]);

export const osmTypeEnum = pgEnum("osm_type", ["node", "way", "relation"]);

/** Structured postal address; every part may be missing ("Not listed"). */
export type VenueAddress = {
  line1?: string | null;
  line2?: string | null;
  locality?: string | null;
  region?: string | null;
  postcode?: string | null;
  countryCode?: string | null;
  /** The address as one line, for display and geocoding. */
  formatted?: string | null;
};

/** Links to the venue's own presence, keyed by network; `other` holds anything unrecognised. */
export type Socials = Partial<
  Record<"facebook" | "instagram" | "tiktok" | "youtube" | "x" | "threads" | "bluesky", string>
> & { other?: string[] };

/** One opening interval in the venue's own zone (`venues.tz`), `HH:MM` wall-clock times. */
export type HoursInterval = { open: string; close: string };

/** Weekly opening hours keyed by ISO weekday (1 = Monday ... 7 = Sunday); a missing day is unknown. */
export type VenueHours = {
  weekly: Partial<Record<"1" | "2" | "3" | "4" | "5" | "6" | "7", HoursInterval[]>>;
  sourceUrl?: string | null;
  note?: string | null;
};

/** A provider photo reference; the image itself is never copied. */
export type VenuePhoto = { provider: string; ref: string; attribution: string | null };

/** Seeded from Overture Maps places with per-row provider and licence (D-028). */
export const venues = pgTable(
  "venues",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    nameNormalized: text("name_normalized").notNull(),
    location: geography("location").notNull(),
    address: jsonb("address").$type<VenueAddress>(),
    neighborhood: text("neighborhood"),
    tz: text("tz").notNull(),
    /** Overture GERS id: the stable key for seeded rows. */
    overtureId: text("overture_id").unique(),
    seedProvider: text("seed_provider"),
    seedLicence: text("seed_licence"),
    seedRecordId: text("seed_record_id"),
    googlePlaceId: text("google_place_id").unique(),
    /**
     * When Google Places was last asked for this venue's place ID, found or not (D-066), so a
     * venue Google does not know is asked again only after `PLACE_ID_RETRY_DAYS`.
     */
    googlePlaceCheckedAt: instant("google_place_checked_at"),
    /**
     * When Google, asked for the venue's name alone searched near its point (a bias, not the
     * small box; D-071, D-077), last gave the stored place ID. An id is stored only when that
     * answer agrees; an id with this null has not passed the current check and is asked about
     * once more (migration 0006 set it null for every stored id).
     */
    googlePlaceNameCheckedAt: instant("google_place_name_checked_at"),
    websiteUrl: text("website_url"),
    socials: jsonb("socials").$type<Socials>(),
    kind: venueKindEnum("kind").notNull().default("other"),
    danceFloor: danceFloorEnum("dance_floor").notNull().default("unknown"),
    hours: jsonb("hours").$type<VenueHours>(),
    hoursFetchedAt: instant("hours_fetched_at"),
    photo: jsonb("photo").$type<VenuePhoto>(),
    classifiedFromUrl: text("classified_from_url"),
    classificationConfidence: real("classification_confidence"),
    metroId: uuid("metro_id").references(() => metros.id, { onDelete: "set null" }),
    blocklisted: boolean("blocklisted").notNull().default(false),
    ...timestamps,
  },
  (t) => [
    index("venues_location_gist_idx").using("gist", t.location),
    index("venues_name_normalized_trgm_idx").using("gin", sql`${t.nameNormalized} gin_trgm_ops`),
    index("venues_metro_id_idx").on(t.metroId),
  ],
);

/** The ODbL slice, kept separable from `venues` (D-028). Nothing here is ever copied into `venues`. */
export const osmPlaces = pgTable(
  "osm_places",
  {
    osmType: osmTypeEnum("osm_type").notNull(),
    osmId: bigint("osm_id", { mode: "number" }).notNull(),
    tags: jsonb("tags").$type<Record<string, string>>().notNull().default({}),
    location: geography("location").notNull(),
    fetchedAt: instant("fetched_at").notNull(),
    licence: text("licence").notNull().default("ODbL-1.0"),
  },
  (t) => [
    primaryKey({ name: "osm_places_pkey", columns: [t.osmType, t.osmId] }),
    index("osm_places_location_gist_idx").using("gist", t.location),
  ],
);

/** Maps OSM places to venues; the only join between the two tables. */
export const venueOsmLinks = pgTable(
  "venue_osm_links",
  {
    venueId: uuid("venue_id")
      .notNull()
      .references(() => venues.id, { onDelete: "cascade" }),
    osmType: osmTypeEnum("osm_type").notNull(),
    osmId: bigint("osm_id", { mode: "number" }).notNull(),
    /** How the link was made: `distance`, `name_match`, `manual`. */
    method: text("method").notNull(),
    linkedAt: instant("linked_at").defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ name: "venue_osm_links_pkey", columns: [t.venueId, t.osmType, t.osmId] }),
    foreignKey({
      name: "venue_osm_links_osm_places_fk",
      columns: [t.osmType, t.osmId],
      foreignColumns: [osmPlaces.osmType, osmPlaces.osmId],
    }).onDelete("cascade"),
    index("venue_osm_links_osm_idx").on(t.osmType, t.osmId),
  ],
);

export type Venue = typeof venues.$inferSelect;
export type NewVenue = typeof venues.$inferInsert;
export type OsmPlace = typeof osmPlaces.$inferSelect;
export type VenueOsmLink = typeof venueOsmLinks.$inferSelect;
