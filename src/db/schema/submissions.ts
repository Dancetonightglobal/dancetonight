import { pgEnum, pgTable, uuid, text, boolean, jsonb, index, unique } from "drizzle-orm/pg-core";
import { instant, timestamps } from "@/src/db/schema/common";
import { metros } from "@/src/db/schema/metros";
import { events, type EventMusic } from "@/src/db/schema/events";
import { type Price } from "@/src/db/schema/series";

export const submissionKindEnum = pgEnum("submission_kind", ["url", "text", "image"]);

/**
 * `draft`: extracted, waiting for the submitter to confirm. `queued`: confirmed, in moderation.
 * `approved` produced an event; `rejected` and `spam` did not.
 */
export const submissionStatusEnum = pgEnum("submission_status", [
  "draft",
  "queued",
  "approved",
  "rejected",
  "spam",
]);

export const reportKindEnum = pgEnum("report_kind", [
  "problem",
  "correction",
  "not_dancing",
  "cancelled",
  "duplicate",
  "other",
]);

export const reportStatusEnum = pgEnum("report_status", ["open", "resolved", "dismissed"]);

export const blocklistPatternTypeEnum = pgEnum("blocklist_pattern_type", [
  "domain",
  "url_prefix",
  "organizer",
  "venue",
]);

/** What the submitter gave us (SPEC section 2). Image uploads stay out of the v1 UI (D-035, Q3). */
export type SubmissionInput =
  | { kind: "url"; url: string }
  | { kind: "text"; text: string }
  | { kind: "image"; storagePath: string; contentType: string };

/** An extracted listing before it becomes an event. Instants are ISO strings with the zone in `tz`. */
export type ListingDraft = {
  title?: string | null;
  listingType?: string | null;
  styles?: string[];
  /** The night (YYYY-MM-DD, in `tz`): the only date an untimed listing has. */
  nightDate?: string | null;
  doorsAt?: string | null;
  lessonAt?: string | null;
  dancingAt?: string | null;
  endsAt?: string | null;
  tz?: string | null;
  venueName?: string | null;
  venueAddress?: string | null;
  venueId?: string | null;
  organizerName?: string | null;
  prices?: Price[];
  isFree?: boolean | null;
  ticketUrl?: string | null;
  level?: string | null;
  partnerRequired?: boolean | null;
  ageMin?: number | null;
  dressCode?: string | null;
  floor?: string | null;
  indoorOutdoor?: "indoor" | "outdoor" | "both" | null;
  music?: EventMusic | null;
  recurrenceText?: string | null;
  canonicalUrl?: string | null;
};

export const submissions = pgTable(
  "submissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: submissionKindEnum("kind").notNull(),
    input: jsonb("input").$type<SubmissionInput>().notNull(),
    /** Supabase Storage path for an uploaded flyer. */
    storagePath: text("storage_path"),
    draft: jsonb("draft").$type<ListingDraft>(),
    /** What the submitter approved; the moderation queue reviews this. */
    confirmedDraft: jsonb("confirmed_draft").$type<ListingDraft>(),
    status: submissionStatusEnum("status").notNull().default("draft"),
    rightsConfirmed: boolean("rights_confirmed").notNull().default(false),
    contact: text("contact"),
    ipHash: text("ip_hash"),
    metroId: uuid("metro_id").references(() => metros.id, { onDelete: "set null" }),
    resultingEventId: uuid("resulting_event_id").references(() => events.id, {
      onDelete: "set null",
    }),
    moderatedAt: instant("moderated_at"),
    moderationNote: text("moderation_note"),
    ...timestamps,
  },
  (t) => [
    index("submissions_status_created_at_idx").on(t.status, t.createdAt),
    index("submissions_ip_hash_idx").on(t.ipHash),
    // Deleting an event (the archive, D-885) checks this foreign key (ON DELETE SET NULL): it must lead an index (D-891).
    index("submissions_resulting_event_id_idx").on(t.resultingEventId),
  ],
);

export const reports = pgTable(
  "reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    kind: reportKindEnum("kind").notNull(),
    message: text("message"),
    /** A proposed correction, as a partial listing. */
    proposed: jsonb("proposed").$type<Partial<ListingDraft>>(),
    status: reportStatusEnum("status").notNull().default("open"),
    contact: text("contact"),
    ipHash: text("ip_hash"),
    resolvedAt: instant("resolved_at"),
    ...timestamps,
  },
  (t) => [
    index("reports_event_id_idx").on(t.eventId),
    index("reports_status_created_at_idx").on(t.status, t.createdAt),
  ],
);

/** Every adapter and the list API check it. */
export const blocklist = pgTable(
  "blocklist",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    patternType: blocklistPatternTypeEnum("pattern_type").notNull(),
    value: text("value").notNull(),
    reason: text("reason"),
    requestedBy: text("requested_by"),
    ...timestamps,
  },
  (t) => [unique("blocklist_pattern_type_value_key").on(t.patternType, t.value)],
);

export type Submission = typeof submissions.$inferSelect;
export type Report = typeof reports.$inferSelect;
export type BlocklistEntry = typeof blocklist.$inferSelect;
