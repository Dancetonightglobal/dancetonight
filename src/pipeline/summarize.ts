// Summaries (PLAN 8.3, D-109): our own 2 to 3 sentences per listing, written by the owner's provider
// chain from the listing's validated facts only, and stored only when every number and name in
// them is in those facts (`checkSummary`). A listing whose facts have not changed keeps its
// summary; one whose facts match another's (a weekly night) takes that summary without a call. A
// summary that fails the check, or a day with no quota left, leaves the listing with none: the
// detail page then shows no "In short" section, and the listing is still usable.

import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";

import { familyLabel, familyOf, isStyleKey, styleLabel } from "@/config/styles";
import { sha256 } from "@/src/adapters/shared";
import type { Metro } from "@/src/adapters/types";
import { jobById, type AiClient } from "@/src/ai";
import {
  SUMMARY_JSON_SCHEMA,
  SUMMARY_PROMPT_VERSION,
  SUMMARY_SYSTEM,
  summaryReplySchema,
  summaryUserTurn,
} from "@/src/ai/prompts";
import type { Db } from "@/src/db/client";
import { events, fieldProvenance, organizers, venues } from "@/src/db/schema";
import type { EventMusic } from "@/src/db/schema/events";
import type { Price } from "@/src/db/schema/series";
import { checkSummary } from "@/src/domain/summary-check";
import { formatTime } from "@/src/domain/time";

/** Model calls one run may spend on summaries: the window fills over a few nights (PLAN 8.3). */
export const SUMMARIES_PER_RUN = 40;

export interface SummaryReport {
  /** Written by a model call and kept by the check. */
  written: number;
  /** Taken from another listing with the same facts, with no call. */
  reused: number;
  /** A summary whose facts changed, cleared because no new one stood. */
  cleared: number;
  /** Calls whose summary the check refused, with why. */
  refused: string[];
  /** Listings left for a later run: the run's calls, or the day's quota, were spent. */
  left: number;
  calls: number;
}

export const emptySummaryReport = (): SummaryReport => ({
  written: 0,
  reused: 0,
  cleared: 0,
  refused: [],
  left: 0,
  calls: 0,
});

export interface SummaryRow {
  title: string;
  listingType: string;
  styles: readonly string[];
  nightDate: string;
  tz: string;
  doorsAt: Date | null;
  lessonAt: Date | null;
  dancingAt: Date | null;
  endsAt: Date | null;
  prices: readonly Price[];
  isFree: boolean | null;
  level: string | null;
  partnerRequired: boolean | null;
  ageMin: number | null;
  dressCode: string | null;
  floor: string | null;
  indoorOutdoor: string | null;
  music: EventMusic | null;
  crowdSizeHint: string | null;
  venueName: string | null;
  neighborhood: string | null;
  organizerName: string | null;
}

const money = (amount: number, currency: string) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);

/**
 * The facts a summary is written from: the listing's own validated fields, in words a summary can
 * repeat ("9pm", "$15", "Friday"), and nothing it does not have. The night's date is left out, so a
 * weekly night's listings share one summary.
 */
export function summaryFacts(row: SummaryRow): Record<string, unknown> {
  const facts: Record<string, unknown> = { title: row.title };
  facts.kind = row.listingType.replace(/_/g, " ");
  const styles = row.styles.filter(isStyleKey);
  if (styles.length > 0) {
    facts.styles = styles.map(styleLabel);
    facts.style_families = [...new Set(styles.map((s) => familyLabel(familyOf(s))))];
  }
  const [year, month, day] = row.nightDate.split("-").map(Number);
  facts.weekday = new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "UTC" }).format(
    new Date(Date.UTC(year!, month! - 1, day!, 12)),
  );
  const at = (instant: Date | null) => (instant ? formatTime(instant, row.tz) : null);
  const times = {
    doors: at(row.doorsAt),
    lesson: at(row.lessonAt),
    dancing: at(row.dancingAt),
    ends: at(row.endsAt),
  };
  for (const [k, v] of Object.entries(times)) if (v) facts[k] = v;
  if (row.venueName) facts.venue = row.venueName;
  if (row.organizerName) facts.organizer = row.organizerName;
  if (row.prices.length > 0) {
    facts.prices = row.prices.map((p) =>
      p.amount === null
        ? p.label
        : p.amount === 0
          ? `${p.label}: free`
          : `${p.label}: ${money(p.amount, p.currency)}`,
    );
  }
  if (row.isFree !== null) facts.free_entry = row.isFree;
  if (row.level) facts.level = row.level;
  if (row.partnerRequired !== null) {
    facts.partner = row.partnerRequired ? "partner needed" : "no partner needed";
  }
  if (row.ageMin !== null) facts.age = row.ageMin === 0 ? "all ages" : `${row.ageMin}+`;
  if (row.dressCode) facts.dress_code = row.dressCode;
  if (row.floor) facts.floor = row.floor;
  if (row.indoorOutdoor) facts.indoor_outdoor = row.indoorOutdoor;
  if (row.music?.djs.length) facts.djs = row.music.djs;
  if (row.music?.bands.length) facts.bands = row.music.bands;
  if (row.music?.genreMix) facts.music = row.music.genreMix;
  if (row.crowdSizeHint) facts.crowd = row.crowdSizeHint;
  return facts;
}

/** What a stored summary was written from: the facts and the prompt's version. */
export const summaryHash = (facts: Record<string, unknown>) =>
  sha256(`${SUMMARY_PROMPT_VERSION}\n${JSON.stringify(facts)}`);

/**
 * Write the summaries the window's listed rows lack, or whose facts have changed since theirs was
 * written. English-language metros only for now: the prompt and the check read English.
 */
export async function summarizeListings(
  db: Db,
  args: {
    metro: Metro;
    nights: readonly string[];
    client: AiClient;
    now: () => Date;
    limit?: number;
  },
): Promise<SummaryReport> {
  const report = emptySummaryReport();
  const { metro, nights, client, now } = args;
  if (nights.length === 0 || client.mock || (metro.languages[0] ?? "en") !== "en") return report;
  const rows = await db
    .select({
      id: events.id,
      title: events.title,
      listingType: events.listingType,
      styles: events.styles,
      nightDate: events.nightDate,
      tz: events.tz,
      doorsAt: events.doorsAt,
      lessonAt: events.lessonAt,
      dancingAt: events.dancingAt,
      endsAt: events.endsAt,
      prices: events.prices,
      isFree: events.isFree,
      level: events.level,
      partnerRequired: events.partnerRequired,
      ageMin: events.ageMin,
      dressCode: events.dressCode,
      floor: events.floor,
      indoorOutdoor: events.indoorOutdoor,
      music: events.music,
      crowdSizeHint: events.crowdSizeHint,
      summary: events.summary,
      venueName: venues.name,
      neighborhood: venues.neighborhood,
      organizerName: organizers.name,
    })
    .from(events)
    .leftJoin(venues, eq(venues.id, events.venueId))
    .leftJoin(organizers, eq(organizers.id, events.organizerId))
    .where(
      and(
        eq(events.metroId, metro.id),
        eq(events.status, "active"),
        gte(events.nightDate, nights[0]!),
        lte(events.nightDate, nights.at(-1)!),
      ),
    )
    .orderBy(events.nightDate, events.title, events.id);
  if (rows.length === 0) return report;

  // Each row's current summary provenance: the hash of the facts its summary was written from.
  const written = new Map<string, string>();
  for (const p of await db
    .select({ entityId: fieldProvenance.entityId, value: fieldProvenance.value })
    .from(fieldProvenance)
    .where(
      and(
        eq(fieldProvenance.entityType, "event"),
        eq(fieldProvenance.field, "summary"),
        eq(fieldProvenance.isCurrent, true),
        inArray(
          fieldProvenance.entityId,
          rows.map((r) => r.id),
        ),
      ),
    )) {
    const hash = (p.value as { hash?: unknown } | null)?.hash;
    if (typeof hash === "string") written.set(p.entityId, hash);
  }

  // A summary already written for the same facts, this run or before.
  const byHash = new Map<string, { summary: string; model: string | null }>();
  const findByHash = async (hash: string) => {
    const known = byHash.get(hash);
    if (known) return known;
    const [found] = await db
      .select({ summary: events.summary, model: fieldProvenance.model })
      .from(fieldProvenance)
      .innerJoin(events, eq(events.id, fieldProvenance.entityId))
      .where(
        and(
          eq(fieldProvenance.entityType, "event"),
          eq(fieldProvenance.field, "summary"),
          eq(fieldProvenance.isCurrent, true),
          sql`${fieldProvenance.value}->>'hash' = ${hash}`,
          sql`${events.summary} is not null`,
        ),
      )
      .limit(1);
    if (!found?.summary) return null;
    const hit = { summary: found.summary, model: found.model };
    byHash.set(hash, hit);
    return hit;
  };

  // A refusal is recorded against its facts too (`refused`), so the same facts are not asked again
  // each run: only new facts, or a new prompt version, ask again.
  const store = async (id: string, summary: string | null, hash: string, model: string | null) => {
    await db.update(events).set({ summary }).where(eq(events.id, id));
    await db
      .update(fieldProvenance)
      .set({ isCurrent: false })
      .where(
        and(
          eq(fieldProvenance.entityType, "event"),
          eq(fieldProvenance.entityId, id),
          eq(fieldProvenance.field, "summary"),
          eq(fieldProvenance.isCurrent, true),
        ),
      );
    await db.insert(fieldProvenance).values({
      entityType: "event",
      entityId: id,
      field: "summary",
      value: summary === null ? { hash, refused: true } : { hash },
      sourceId: null,
      sourceUrl: null,
      fetchedAt: now(),
      evidence: null,
      method: "llm",
      model,
    });
  };

  const limit = args.limit ?? SUMMARIES_PER_RUN;
  let stopped = false;
  for (const row of rows) {
    const facts = summaryFacts(row);
    const hash = summaryHash(facts);
    if (written.get(row.id) === hash) continue;
    const known = await findByHash(hash);
    if (known) {
      await store(row.id, known.summary, hash, known.model);
      report.reused += 1;
      continue;
    }
    // A summary of other facts is not this listing's any more: it goes until a new one stands.
    const leave = async () => {
      report.left += 1;
      if (row.summary === null) return;
      await db.update(events).set({ summary: null }).where(eq(events.id, row.id));
      await db
        .update(fieldProvenance)
        .set({ isCurrent: false })
        .where(
          and(
            eq(fieldProvenance.entityType, "event"),
            eq(fieldProvenance.entityId, row.id),
            eq(fieldProvenance.field, "summary"),
            eq(fieldProvenance.isCurrent, true),
          ),
        );
      report.cleared += 1;
    };
    if (stopped || report.calls >= limit) {
      await leave();
      continue;
    }
    report.calls += 1;
    let outcome;
    try {
      outcome = await client.run(
        {
          job: jobById("summarise"),
          system: SUMMARY_SYSTEM,
          user: summaryUserTurn(facts),
          schema: summaryReplySchema,
          jsonSchema: SUMMARY_JSON_SCHEMA,
        },
        { metro: metro.slug },
      );
    } catch {
      // A summary is never worth the run's report: the rest wait for a later run.
      stopped = true;
      await leave();
      continue;
    }
    if (!outcome.ok) {
      // No quota left today, or no provider: the rest wait for a later run.
      if (outcome.reason === "quota_exhausted" || outcome.reason === "no_eligible_provider") {
        stopped = true;
      }
      await leave();
      continue;
    }
    const factsText = JSON.stringify(facts);
    const verdict = checkSummary(outcome.value.summary, factsText);
    if (!verdict.ok) {
      report.refused.push(`${row.title} on ${row.nightDate} (${verdict.reason})`);
      if (row.summary !== null) report.cleared += 1;
      await store(row.id, null, hash, outcome.model);
      continue;
    }
    const summary = outcome.value.summary.trim();
    byHash.set(hash, { summary, model: outcome.model });
    await store(row.id, summary, hash, outcome.model);
    report.written += 1;
  }
  return report;
}

/** The report's lines. */
export function formatSummaryReport(report: SummaryReport): string[] {
  const lines = [
    `Summaries: ${report.written} written, ${report.reused} reused, ${report.cleared} cleared, ${report.refused.length} refused by the check, ${report.left} left for a later run (${report.calls} calls)`,
  ];
  if (report.refused.length > 0) lines.push(`  refused: ${report.refused.join("; ")}`);
  return lines;
}
