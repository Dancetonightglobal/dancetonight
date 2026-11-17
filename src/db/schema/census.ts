import { pgTable, uuid, text, boolean, date, index, unique } from "drizzle-orm/pg-core";
import { instant, timestamps } from "@/src/db/schema/common";
import { metros } from "@/src/db/schema/metros";
import { venues } from "@/src/db/schema/venues";
import { sources } from "@/src/db/schema/sources";

/*
 * The recall-per-source and social-only-share views PLAN section 4 names over the census tables
 * land with the eval work (Phase 4), not in this migration.
 */

/** The manual ground-truth census: one row per event on a census night (D-032; deferred by D-035). */
export const censusEvent = pgTable(
  "census_event",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    metroId: uuid("metro_id")
      .notNull()
      .references(() => metros.id, { onDelete: "cascade" }),
    nightDate: date("night_date", { mode: "string" }).notNull(),
    tz: text("tz").notNull(),
    /** A family key from config/styles.ts. */
    category: text("category").notNull(),
    title: text("title").notNull(),
    venueName: text("venue_name"),
    venueId: uuid("venue_id").references(() => venues.id, { onDelete: "set null" }),
    startsAt: instant("starts_at"),
    endsAt: instant("ends_at"),
    price: text("price"),
    recurrence: text("recurrence"),
    canonicalUrl: text("canonical_url"),
    /** Where the event was announced: `instagram`, `facebook`, `eventbrite`, `own_site`, ... */
    platforms: text("platforms").array().notNull().default([]),
    verificationMethod: text("verification_method"),
    notes: text("notes"),
    ...timestamps,
  },
  (t) => [index("census_event_metro_id_night_date_idx").on(t.metroId, t.nightDate)],
);

/** One row per census event and source: did the source have it, and how. */
export const censusEventSource = pgTable(
  "census_event_source",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    censusEventId: uuid("census_event_id")
      .notNull()
      .references(() => censusEvent.id, { onDelete: "cascade" }),
    /** The source or adapter name, so a source with no `sources` row still counts. */
    sourceLabel: text("source_label").notNull(),
    sourceId: uuid("source_id").references(() => sources.id, { onDelete: "set null" }),
    found: boolean("found").notNull(),
    foundHow: text("found_how"),
    discoveredHereFirst: boolean("discovered_here_first").notNull().default(false),
    createdAt: instant("created_at").defaultNow().notNull(),
  },
  (t) => [
    unique("census_event_source_event_label_key").on(t.censusEventId, t.sourceLabel),
    index("census_event_source_source_id_idx").on(t.sourceId),
  ],
);

export type CensusEvent = typeof censusEvent.$inferSelect;
export type CensusEventSource = typeof censusEventSource.$inferSelect;
