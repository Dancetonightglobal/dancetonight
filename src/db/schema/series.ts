import {
  pgEnum,
  pgTable,
  uuid,
  text,
  real,
  boolean,
  jsonb,
  date,
  index,
  unique,
} from "drizzle-orm/pg-core";

import { LISTING_TYPE_KEYS } from "@/src/domain/listing-types";
import { instant, timestamps } from "@/src/db/schema/common";
import { metros } from "@/src/db/schema/metros";
import { venues } from "@/src/db/schema/venues";
import { organizers } from "@/src/db/schema/organizers";
import { sources } from "@/src/db/schema/sources";

export const listingTypeEnum = pgEnum("listing_type", LISTING_TYPE_KEYS);

export const seriesExceptionActionEnum = pgEnum("series_exception_action", ["cancel", "override"]);

export const provenanceMethodEnum = pgEnum("provenance_method", [
  "feed",
  "jsonld",
  "api",
  "llm",
  "serp",
  "manual",
]);

/** A price tier as listed, in the listing's currency. `amount` null means free-form ("donation"). */
export type Price = {
  label: string;
  amount: number | null;
  currency: string;
  includes?: string | null;
};

/** Defaults a materialized occurrence inherits from its series (D-005). */
export type SeriesDefaults = {
  /** Minutes from `dancing_at`, negative when the lesson is before the social. */
  lessonOffsetMinutes?: number | null;
  durationMinutes?: number | null;
  prices?: Price[];
  isFree?: boolean | null;
  level?: string | null;
  partnerRequired?: boolean | null;
  ageMin?: number | null;
  ticketUrl?: string | null;
  summary?: string | null;
};

/** What an `override` exception changes for one night date. */
export type SeriesOverride = {
  dancingAt?: string | null;
  lessonAt?: string | null;
  doorsAt?: string | null;
  endsAt?: string | null;
  venueId?: string | null;
  title?: string | null;
  note?: string | null;
};

/** A recurring rule: RRULE with `DTSTART;TZID` in wall-clock local time (D-005, D-027). */
export const series = pgTable(
  "series",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    organizerId: uuid("organizer_id").references(() => organizers.id, { onDelete: "set null" }),
    venueId: uuid("venue_id").references(() => venues.id, { onDelete: "set null" }),
    metroId: uuid("metro_id").references(() => metros.id, { onDelete: "set null" }),
    rrule: text("rrule").notNull(),
    tz: text("tz").notNull(),
    listingType: listingTypeEnum("listing_type").notNull(),
    styles: text("styles").array().notNull().default([]),
    defaults: jsonb("defaults").$type<SeriesDefaults>().notNull().default({}),
    active: boolean("active").notNull().default(true),
    lastConfirmedAt: instant("last_confirmed_at"),
    confidence: real("confidence"),
    ...timestamps,
  },
  (t) => [
    index("series_venue_id_idx").on(t.venueId),
    index("series_organizer_id_idx").on(t.organizerId),
    index("series_metro_id_idx").on(t.metroId),
    index("series_styles_gin_idx").using("gin", t.styles),
  ],
);

/** Cancellations and overrides keyed by night date, each with provenance (D-005). */
export const seriesExceptions = pgTable(
  "series_exceptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    seriesId: uuid("series_id")
      .notNull()
      .references(() => series.id, { onDelete: "cascade" }),
    nightDate: date("night_date", { mode: "string" }).notNull(),
    action: seriesExceptionActionEnum("action").notNull(),
    override: jsonb("override").$type<SeriesOverride>(),
    sourceId: uuid("source_id").references(() => sources.id, { onDelete: "set null" }),
    sourceUrl: text("source_url"),
    fetchedAt: instant("fetched_at"),
    evidence: text("evidence"),
    method: provenanceMethodEnum("method").notNull(),
    ...timestamps,
  },
  (t) => [unique("series_exceptions_series_id_night_date_key").on(t.seriesId, t.nightDate)],
);

export type Series = typeof series.$inferSelect;
export type NewSeries = typeof series.$inferInsert;
export type SeriesException = typeof seriesExceptions.$inferSelect;
