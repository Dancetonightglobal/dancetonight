import { sql } from "drizzle-orm";
import {
  pgEnum,
  pgTable,
  uuid,
  text,
  real,
  boolean,
  numeric,
  jsonb,
  index,
  unique,
  check,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { instant, timestamps } from "@/src/db/schema/common";
import { sources, rawDocuments } from "@/src/db/schema/sources";
import { provenanceMethodEnum } from "@/src/db/schema/series";
import { events } from "@/src/db/schema/events";

export const eventSourceRoleEnum = pgEnum("event_source_role", ["primary", "secondary"]);

export const provenanceEntityTypeEnum = pgEnum("provenance_entity_type", [
  "event",
  "venue",
  "organizer",
  "series",
  "series_exception",
]);

export const mergeDecisionEnum = pgEnum("merge_decision", [
  "auto_merge",
  "llm_merge",
  "llm_distinct",
  "queued",
  "manual_merge",
  "manual_distinct",
]);

/** Which sources an event was seen at. */
export const eventSources = pgTable(
  "event_sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    /** Restrict: sources are disabled or blocklisted, never deleted, so provenance never vanishes. */
    sourceId: uuid("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "restrict" }),
    sourceUrl: text("source_url").notNull(),
    /**
     * This source's own page for this one event (D-073): the event page a feed or API names, the
     * organiser's page a page read links from the listing's title, or the source URL itself when
     * the source is the event's page (JSON-LD on an event page, Ticketmaster). Null when the
     * source only lists the night among others. Never a home page or a list page.
     */
    eventUrl: text("event_url"),
    rawDocumentId: uuid("raw_document_id").references(() => rawDocuments.id, {
      onDelete: "set null",
    }),
    role: eventSourceRoleEnum("role").notNull().default("secondary"),
    firstSeenAt: instant("first_seen_at").defaultNow().notNull(),
    lastSeenAt: instant("last_seen_at").defaultNow().notNull(),
  },
  (t) => [
    unique("event_sources_event_source_url_key").on(t.eventId, t.sourceId, t.sourceUrl),
    index("event_sources_source_id_idx").on(t.sourceId),
  ],
);

/** Every stored fact has one of these: where it came from and the evidence (CLAUDE.md conventions). */
export const fieldProvenance = pgTable(
  "field_provenance",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityType: provenanceEntityTypeEnum("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    field: text("field").notNull(),
    value: jsonb("value").$type<unknown>().notNull(),
    sourceId: uuid("source_id").references(() => sources.id, { onDelete: "set null" }),
    sourceUrl: text("source_url"),
    fetchedAt: instant("fetched_at").notNull(),
    /** At most 300 characters; never rendered verbatim (D-009). */
    evidence: text("evidence"),
    method: provenanceMethodEnum("method").notNull(),
    model: text("model"),
    confidence: real("confidence"),
    isCurrent: boolean("is_current").notNull().default(true),
    conflictsWith: uuid("conflicts_with").references((): AnyPgColumn => fieldProvenance.id, {
      onDelete: "set null",
    }),
    createdAt: instant("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("field_provenance_entity_field_idx").on(t.entityType, t.entityId, t.field),
    index("field_provenance_source_id_idx").on(t.sourceId),
    // conflicts_with references this table ON DELETE SET NULL: without an index every deleted row scans the whole table,
    // and the archive delete (D-885) timed out on its first live run, 2026-11-23 (D-891).
    index("field_provenance_conflicts_with_idx").on(t.conflictsWith),
    check("field_provenance_evidence_length", sql`char_length(${t.evidence}) <= 300`),
  ],
);

/** The dedupe trail: how each candidate pair was settled (D-006). */
export const mergeDecisions = pgTable(
  "merge_decisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventA: uuid("event_a")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    eventB: uuid("event_b")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    score: real("score").notNull(),
    decision: mergeDecisionEnum("decision").notNull(),
    reasoning: text("reasoning"),
    costUsd: numeric("cost_usd", { precision: 12, scale: 6 }),
    ...timestamps,
  },
  (t) => [
    index("merge_decisions_event_a_idx").on(t.eventA),
    index("merge_decisions_event_b_idx").on(t.eventB),
    index("merge_decisions_decision_idx").on(t.decision),
  ],
);

export type EventSource = typeof eventSources.$inferSelect;
export type FieldProvenance = typeof fieldProvenance.$inferSelect;
export type MergeDecision = typeof mergeDecisions.$inferSelect;
