import {
  pgEnum,
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  numeric,
  jsonb,
  date,
  index,
  unique,
  primaryKey,
} from "drizzle-orm/pg-core";
import { instant, timestamps } from "@/src/db/schema/common";
import { metros } from "@/src/db/schema/metros";
import { sources } from "@/src/db/schema/sources";

export const flagScopeEnum = pgEnum("flag_scope", ["global", "metro"]);

export const jobStatusEnum = pgEnum("job_status", ["running", "succeeded", "failed", "cancelled"]);

export const evalKindEnum = pgEnum("eval_kind", ["extraction", "recall"]);

/** Per-run counters; keys are stable so the digest can chart them. */
export type JobStats = {
  listingsBySource?: Record<string, number>;
  newEvents?: number;
  updatedEvents?: number;
  mergedEvents?: number;
  costUsd?: number;
  errors?: number;
};

/** Metrics of one evaluation run (SPEC section 10). */
export type EvalMetrics = {
  precision?: number;
  recall?: number;
  found?: number;
  missed?: number;
  byField?: Record<string, { precision: number; recall: number }>;
  missesByCause?: Record<string, number>;
};

/** A flag's value: a switch, a number, a string or a small object. */
export type FlagValue = boolean | number | string | Record<string, unknown> | null;

/**
 * One row per model or provider call. The daily rollup view PLAN section 4 names lands with the
 * admin work (Phase 3), not in this migration.
 */
export const costLog = pgTable(
  "cost_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    job: text("job").notNull(),
    runId: uuid("run_id").references(() => jobRuns.id, { onDelete: "set null" }),
    metroId: uuid("metro_id").references(() => metros.id, { onDelete: "set null" }),
    sourceId: uuid("source_id").references(() => sources.id, { onDelete: "set null" }),
    provider: text("provider").notNull(),
    model: text("model"),
    inputTokens: integer("input_tokens").notNull().default(0),
    cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
    cacheWriteTokens: integer("cache_write_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    requests: integer("requests").notNull().default(1),
    usd: numeric("usd", { precision: 12, scale: 6 }).notNull(),
    /** The charge in the provider's own unit (D-039): neurons for Cloudflare, requests elsewhere. */
    cost: numeric("cost", { precision: 14, scale: 4 }),
    unit: text("unit"),
    createdAt: instant("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("cost_log_created_at_idx").on(t.createdAt),
    index("cost_log_metro_id_created_at_idx").on(t.metroId, t.createdAt),
    index("cost_log_run_id_idx").on(t.runId),
  ],
);

export const budgets = pgTable(
  "budgets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scope: flagScopeEnum("scope").notNull(),
    metroId: uuid("metro_id").references(() => metros.id, { onDelete: "cascade" }),
    dailyUsd: numeric("daily_usd", { precision: 10, scale: 2 }).notNull(),
    monthlyUsd: numeric("monthly_usd", { precision: 10, scale: 2 }).notNull(),
    hardStop: boolean("hard_stop").notNull().default(true),
    alertAtPct: integer("alert_at_pct").notNull().default(80),
    ...timestamps,
  },
  (t) => [unique("budgets_scope_metro_id_key").on(t.scope, t.metroId).nullsNotDistinct()],
);

/** One key per adapter (`adapter.ticketmaster`, ...) plus pipeline switches. */
export const featureFlags = pgTable(
  "feature_flags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    key: text("key").notNull(),
    enabled: boolean("enabled").notNull().default(false),
    scope: flagScopeEnum("scope").notNull().default("global"),
    metroId: uuid("metro_id").references(() => metros.id, { onDelete: "cascade" }),
    value: jsonb("value").$type<FlagValue>(),
    ...timestamps,
  },
  (t) => [
    unique("feature_flags_key_scope_metro_id_key").on(t.key, t.scope, t.metroId).nullsNotDistinct(),
  ],
);

export const jobRuns = pgTable(
  "job_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    job: text("job").notNull(),
    /** The job runner's own run id (Inngest, D-012). */
    externalRunId: text("external_run_id"),
    metroId: uuid("metro_id").references(() => metros.id, { onDelete: "set null" }),
    startedAt: instant("started_at").defaultNow().notNull(),
    finishedAt: instant("finished_at"),
    status: jobStatusEnum("status").notNull().default("running"),
    stats: jsonb("stats").$type<JobStats>().notNull().default({}),
    error: text("error"),
    createdAt: instant("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("job_runs_job_started_at_idx").on(t.job, t.startedAt),
    index("job_runs_metro_id_idx").on(t.metroId),
  ],
);

export const evalRuns = pgTable(
  "eval_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: evalKindEnum("kind").notNull(),
    metroId: uuid("metro_id").references(() => metros.id, { onDelete: "set null" }),
    /** The night date evaluated (recall) or the fixture set date (extraction). */
    date: date("date", { mode: "string" }),
    metrics: jsonb("metrics").$type<EvalMetrics>().notNull(),
    reportPath: text("report_path"),
    createdAt: instant("created_at").defaultNow().notNull(),
  },
  (t) => [index("eval_runs_kind_created_at_idx").on(t.kind, t.createdAt)],
);

/**
 * The daily check of each card's own link (D-768, the owner 2026-11-06 "flag, keep card"), one row per
 * URL (without its #fragment). A card whose link is `broken` stays listed and says "Link not
 * working"; nothing here hides a listing. Written by src/jobs/link-check.ts only.
 */
export const linkChecks = pgTable("link_checks", {
  url: text("url").primaryKey(),
  checkedAt: instant("checked_at").notNull(),
  /** True once the link failed: a 404/410 on one check, or no answer on two in a row. */
  broken: boolean("broken").notNull().default(false),
  /** Failed checks in a row (404/410 or unreachable); 0 after an answer that is not a failure. */
  failures: integer("failures").notNull().default(0),
  /** "http 404", "timeout", "network: ENOTFOUND"; null when the last check found the page. */
  reason: text("reason"),
});

export type LinkCheck = typeof linkChecks.$inferSelect;

export type CostLogEntry = typeof costLog.$inferSelect;
export type Budget = typeof budgets.$inferSelect;
export type FeatureFlag = typeof featureFlags.$inferSelect;
export type JobRun = typeof jobRuns.$inferSelect;
export type EvalRun = typeof evalRuns.$inferSelect;

/**
 * The AI quota ledger's counters (D-039, PLAN 8.5), one row per provider, quota day and scope
 * (`account` or `metro:<slug>`). Kept in the database so the morning run and the afternoon
 * re-check draw on the same day's allowance; `amount` is in the provider's own unit.
 */
export const aiQuota = pgTable(
  "ai_quota",
  {
    provider: text("provider").notNull(),
    dayKey: text("day_key").notNull(),
    scope: text("scope").notNull(),
    amount: numeric("amount", { precision: 14, scale: 4, mode: "number" }).notNull().default(0),
    updatedAt: instant("updated_at").defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.provider, t.dayKey, t.scope] })],
);

/**
 * Extraction results by the cleaned page text's hash and the prompt version (PLAN 6.7): an
 * unchanged page is never sent to a model twice. Holds our structured result only, never the
 * page text.
 */
export const extractionCache = pgTable(
  "extraction_cache",
  {
    contentHash: text("content_hash").notNull(),
    promptVersion: text("prompt_version").notNull(),
    model: text("model").notNull(),
    result: jsonb("result").notNull(),
    createdAt: instant("created_at").defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.contentHash, t.promptVersion] })],
);
