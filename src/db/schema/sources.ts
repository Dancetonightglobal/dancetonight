import {
  pgEnum,
  pgTable,
  uuid,
  text,
  real,
  integer,
  boolean,
  numeric,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { instant, timestamps } from "@/src/db/schema/common";
import { metros } from "@/src/db/schema/metros";
import { venues } from "@/src/db/schema/venues";
import { organizers } from "@/src/db/schema/organizers";

export const sourceKindEnum = pgEnum("source_kind", [
  "feed_ics",
  "feed_gcal",
  "jsonld",
  "wp_tribe",
  "squarespace",
  "wix",
  "platform_api",
  "open_data",
  "html",
  "ticketing_api",
  "serp",
  "directory",
  "social_link",
  "connected",
]);

export const trustTierEnum = pgEnum("trust_tier", [
  "first_party",
  "ticketing",
  "serp",
  "directory",
  "unofficial",
]);

export const robotsStatusEnum = pgEnum("robots_status", ["allowed", "disallowed", "unknown"]);

/** Rolling health of a source, maintained by the harvester (D-008). */
export type SourceHealth = {
  lastSuccessAt?: string | null;
  lastError?: string | null;
  errorRate7d?: number | null;
  consecutiveFailures?: number;
  /**
   * What venue-website discovery found when it last probed this row (D-120): its status, in words,
   * and when. Set only on rows discovery wrote.
   */
  discovery?: {
    status: string;
    reason: string;
    probedAt: string;
    /** The place's group ("dance or salsa club", "lounge"...), which decides what switches on. */
    group?: string;
    /** The dance gate's verdict on a page-only events page (D-124); absent before the gate ran. */
    /** `version`: the gate's GATE_VERSION when it judged (absent = 1). */
    gate?: { pass: boolean; reason: string; version?: number };
    /** Set once a row stored under an older probe rule has been re-probed ("D-137"). */
    recheck?: string;
  };
  /**
   * When the current run of failures began (the first failed run's time); null when the source
   * is not failing, or its streak began before this field was kept. Read only by the run's report.
   */
  failingSince?: string | null;
};

/** Anything we harvest: a feed, a page, an API endpoint, a directory (PLAN section 4). */
export const sources = pgTable(
  "sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Canonical URL of the source. */
    url: text("url").notNull().unique(),
    kind: sourceKindEnum("kind").notNull(),
    /** Recognised platform, when any: `libcal`, `tockify`, `teamup`, `helloasso`, ... */
    platform: text("platform"),
    /** Region-scoped adapters run only in metros whose country matches (D-029). Empty means everywhere. */
    countryCodes: text("country_codes").array().notNull().default([]),
    feedUrl: text("feed_url"),
    organizerId: uuid("organizer_id").references(() => organizers.id, { onDelete: "set null" }),
    venueId: uuid("venue_id").references(() => venues.id, { onDelete: "set null" }),
    metroId: uuid("metro_id").references(() => metros.id, { onDelete: "set null" }),
    styles: text("styles").array().notNull().default([]),
    language: text("language"),
    trustTier: trustTierEnum("trust_tier").notNull(),
    robotsStatus: robotsStatusEnum("robots_status").notNull().default("unknown"),
    robotsCheckedAt: instant("robots_checked_at"),
    crawlDelayS: real("crawl_delay_s"),
    enabled: boolean("enabled").notNull().default(true),
    /**
     * A venue's whole calendar: dance nights among concerts, shows and talks (D-083, D-121). Its
     * listings go through `screenNoDance`. Set from a starting address's `mixedCalendar` and on
     * every venue calendar discovery finds.
     */
    mixedCalendar: boolean("mixed_calendar").notNull().default(false),
    health: jsonb("health").$type<SourceHealth>().notNull().default({}),
    /** Which adapter or discovery step found it. */
    discoveredBy: text("discovered_by"),
    nextHarvestAt: instant("next_harvest_at"),
    etag: text("etag"),
    /** The HTTP `Last-Modified` header verbatim, replayed in `If-Modified-Since`. */
    lastModified: text("last_modified"),
    contentHash: text("content_hash"),
    ...timestamps,
  },
  (t) => [
    index("sources_metro_id_idx").on(t.metroId),
    index("sources_organizer_id_idx").on(t.organizerId),
    index("sources_venue_id_idx").on(t.venueId),
    index("sources_next_harvest_at_idx").on(t.nextHarvestAt),
    index("sources_kind_idx").on(t.kind),
  ],
);

/** One row per fetch that produced new content; `cleaned_text` is retained 14 days (D-009). */
export const rawDocuments = pgTable(
  "raw_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    fetchedAt: instant("fetched_at").notNull(),
    httpStatus: integer("http_status"),
    etag: text("etag"),
    contentHash: text("content_hash").notNull(),
    cleanedText: text("cleaned_text"),
    /** `feed`, `jsonld`, `api`, `llm`, ... (matches provenance_method). */
    extractionMethod: text("extraction_method"),
    model: text("model"),
    costUsd: numeric("cost_usd", { precision: 12, scale: 6 }),
    createdAt: instant("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("raw_documents_source_id_fetched_at_idx").on(t.sourceId, t.fetchedAt),
    index("raw_documents_content_hash_idx").on(t.contentHash),
  ],
);

export type Source = typeof sources.$inferSelect;
export type NewSource = typeof sources.$inferInsert;
export type RawDocument = typeof rawDocuments.$inferSelect;
