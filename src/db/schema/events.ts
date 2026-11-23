import { sql } from "drizzle-orm";
import {
  pgEnum,
  pgTable,
  uuid,
  text,
  real,
  integer,
  boolean,
  jsonb,
  date,
  index,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { geography } from "@/src/db/schema/geography";
import { instant, timestamps } from "@/src/db/schema/common";
import { metros } from "@/src/db/schema/metros";
import { venues } from "@/src/db/schema/venues";
import { organizers } from "@/src/db/schema/organizers";
import { listingTypeEnum, series, type Price } from "@/src/db/schema/series";

export const eventStatusEnum = pgEnum("event_status", ["active", "cancelled", "merged", "removed"]);

export const confirmationEnum = pgEnum("confirmation", [
  "confirmed_today",
  "recurring_unconfirmed",
  "conflicting",
  "cancelled",
]);

export const indoorOutdoorEnum = pgEnum("indoor_outdoor", ["indoor", "outdoor", "both"]);

/** Who is playing; names only, never descriptions. */
export type EventMusic = {
  djs: string[];
  bands: string[];
  /** Free text such as "70% salsa, 30% bachata". */
  genreMix: string | null;
  /**
   * True when a live band, musicians or an orchestra play; false when the music is DJs or
   * recorded; null (or absent, in rows written before the key existed) when the listing does
   * not say. The live music filter reads it, so "Live band and caller" in the text alone is
   * not enough.
   */
  liveMusic?: boolean | null;
};

/** An image reference: a provider id or our own OG render, never a copied flyer. */
export type EventImage = {
  kind: "og_render" | "provider" | "venue_photo";
  ref: string;
  attribution: string | null;
};

/** Dated occurrences: the rows the site lists (SPEC section 3, PLAN section 4). */
export const events = pgTable(
  "events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull().unique(),
    title: text("title").notNull(),
    titleNormalized: text("title_normalized").notNull(),
    listingType: listingTypeEnum("listing_type").notNull(),
    /** Taxonomy keys from config/styles.ts. */
    styles: text("styles").array().notNull().default([]),
    doorsAt: instant("doors_at"),
    lessonAt: instant("lesson_at"),
    dancingAt: instant("dancing_at"),
    endsAt: instant("ends_at"),
    /**
     * `coalesce(dancing_at, lesson_at, doors_at)`, kept by Postgres (D-004). NULL when the source
     * gives a date and no time, shown as "Time not listed" (D-060).
     */
    startsAt: instant("starts_at").generatedAlwaysAs(
      (): ReturnType<typeof sql> => sql`coalesce("dancing_at", "lesson_at", "doors_at")`,
    ),
    /**
     * The local calendar date of starts_at in tz, or the day before when the local clock reads
     * earlier than 06:00; written by src/domain/tonight.ts nightDate(), never by SQL (D-004).
     * When no time is listed it is the listed date itself (D-060).
     */
    nightDate: date("night_date", { mode: "string" }).notNull(),
    tz: text("tz").notNull(),
    /** Denormalized venue point for the list query. */
    geo: geography("geo"),
    prices: jsonb("prices").$type<Price[]>().notNull().default([]),
    isFree: boolean("is_free"),
    ticketUrl: text("ticket_url"),
    level: text("level"),
    partnerRequired: boolean("partner_required"),
    ageMin: integer("age_min"),
    dressCode: text("dress_code"),
    floor: text("floor"),
    indoorOutdoor: indoorOutdoorEnum("indoor_outdoor"),
    music: jsonb("music").$type<EventMusic>(),
    crowdSizeHint: text("crowd_size_hint"),
    venueId: uuid("venue_id").references(() => venues.id, { onDelete: "set null" }),
    organizerId: uuid("organizer_id").references(() => organizers.id, { onDelete: "set null" }),
    seriesId: uuid("series_id").references(() => series.id, { onDelete: "set null" }),
    metroId: uuid("metro_id").references(() => metros.id, { onDelete: "set null" }),
    /** Our own 2 to 3 sentence summary from structured facts; never source text. */
    summary: text("summary"),
    confirmation: confirmationEnum("confirmation").notNull(),
    confidence: real("confidence"),
    /** Denormalized for the list query; rebuilt from event_sources by the pipeline, no FK. */
    sourceIds: uuid("source_ids").array().notNull().default([]),
    firstSeenAt: instant("first_seen_at").defaultNow().notNull(),
    lastVerifiedAt: instant("last_verified_at"),
    status: eventStatusEnum("status").notNull().default("active"),
    mergedIntoId: uuid("merged_into_id").references((): AnyPgColumn => events.id, {
      onDelete: "set null",
    }),
    canonicalUrl: text("canonical_url"),
    image: jsonb("image").$type<EventImage>(),
    ...timestamps,
  },
  (t) => [
    index("events_geo_gist_idx").using("gist", t.geo),
    index("events_night_date_starts_at_idx").on(t.nightDate, t.startsAt),
    index("events_styles_gin_idx").using("gin", t.styles),
    index("events_title_normalized_trgm_idx").using("gin", sql`${t.titleNormalized} gin_trgm_ops`),
    index("events_metro_id_night_date_idx").on(t.metroId, t.nightDate),
    index("events_venue_id_idx").on(t.venueId),
    // Deleting an event checks every row that names it as merged_into_id (ON DELETE SET NULL): without this index each
    // deleted event scans the whole table, and the archive delete (D-885) ran past the statement timeout (D-891).
    index("events_merged_into_id_idx").on(t.mergedIntoId),
    index("events_series_id_night_date_idx").on(t.seriesId, t.nightDate),
    // No start-time check since D-060: a listing may give its night and no time. night_date is
    // NOT NULL, so every row still carries a date.
  ],
);

export type Event = typeof events.$inferSelect;
export type NewEvent = typeof events.$inferInsert;
