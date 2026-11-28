// Dedupe review: model settles queued pairs (llm_merge / llm_distinct) (PLAN section 9, D-150).
import { and, eq, inArray, desc } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import type { Metro } from "@/src/adapters/types";
import { jobById, type AiClient } from "@/src/ai";
import {
  DEDUPE_JSON_SCHEMA,
  DEDUPE_PROMPT_VERSION,
  DEDUPE_SYSTEM,
  dedupeReplySchema,
  dedupeUserTurn,
} from "@/src/ai/prompts";
import { normalizeForMatch } from "@/config/styles";
import type { Db } from "@/src/db/client";
import { events, mergeDecisions, venues, organizers, sources } from "@/src/db/schema";
import { eventSources } from "@/src/db/schema/provenance";

/** A due-only run's model dedupe review stops after this long; the rest stay queued (job timeout 20 min). */
export const DEDUPE_REVIEW_DUE_RUN_MS = 120_000;

export interface DedupeReviewReport {
  asked: number;
  merged: number;
  distinct: number;
  unsure: number;
  failed: number;
  lines: string[];
  stoppedForTime: boolean;
}

export const emptyDedupeReviewReport = (): DedupeReviewReport => ({
  asked: 0,
  merged: 0,
  distinct: 0,
  unsure: 0,
  failed: 0,
  lines: [],
  stoppedForTime: false,
});

/** Two reviews of one run added together (D-901: a second review settles the wide pass's queue). */
export function addReviewReports(a: DedupeReviewReport, b: DedupeReviewReport): DedupeReviewReport {
  return {
    asked: a.asked + b.asked,
    merged: a.merged + b.merged,
    distinct: a.distinct + b.distinct,
    unsure: a.unsure + b.unsure,
    failed: a.failed + b.failed,
    lines: [...a.lines, ...b.lines],
    stoppedForTime: a.stoppedForTime || b.stoppedForTime,
  };
}

function formatTime(date: Date | null, tz: string): string | undefined {
  if (!date) return undefined;
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = formatter.formatToParts(date);
  const year = parts.find((p) => p.type === "year")!.value;
  const month = parts.find((p) => p.type === "month")!.value;
  const day = parts.find((p) => p.type === "day")!.value;
  const hour = parts.find((p) => p.type === "hour")!.value;
  const minute = parts.find((p) => p.type === "minute")!.value;
  return `${year}-${month}-${day} ${hour}:${minute}`;
}

function formatAddress(address: unknown): string | undefined {
  if (!address || typeof address !== "object" || address === null) return undefined;
  const a = address as Record<string, unknown>;
  const line1 = a.line1;
  const line2 = a.line2;
  const locality = a.locality;
  const region = a.region;
  const postcode = a.postcode;
  const parts = [line1, line2, locality, region, postcode].filter(
    (p) => p && typeof p === "string" && p.trim() !== "",
  );
  if (parts.length === 0) return undefined;
  return parts.join(", ");
}

function factsOf(detail: {
  title: string;
  nightDate: string;
  startsAt: Date | null;
  endsAt: Date | null;
  tz: string;
  listingType: string;
  styles: string[];
  venueName: string | null;
  venueAddress: unknown;
  organizerName: string | null;
  sourceUrl: string | null;
}): Record<string, unknown> {
  const facts: Record<string, unknown> = {
    title: detail.title,
    night: detail.nightDate,
    starts: detail.startsAt ? formatTime(detail.startsAt, detail.tz) : undefined,
    ends: detail.endsAt ? formatTime(detail.endsAt, detail.tz) : undefined,
    listingType: detail.listingType,
    styles: detail.styles,
    venue: detail.venueName ?? undefined,
    address: formatAddress(detail.venueAddress),
    organizer: detail.organizerName ?? undefined,
    source: detail.sourceUrl ? new URL(detail.sourceUrl).hostname : undefined,
  };
  Object.keys(facts).forEach((key) => facts[key] === undefined && delete facts[key]);
  return facts;
}

export async function reviewQueuedPairs(
  db: Db,
  opts: {
    metro: Metro;
    nights: readonly string[];
    client: AiClient;
    limit?: number;
    maxMs?: number;
    clock?: () => number;
  },
): Promise<DedupeReviewReport> {
  const report = emptyDedupeReviewReport();
  const { metro, nights, client, limit = 40, maxMs, clock = Date.now } = opts;

  if (nights.length === 0 || client.mock) return report;

  const startedAt = clock();

  // Use aliases for the two events
  const eventsA = alias(events, "events_a");
  const eventsB = alias(events, "events_b");

  // Load queued decisions where both events are active, belong to the metro, and nightDate in nights
  const queuedRows = await db
    .select({
      id: mergeDecisions.id,
      eventA: mergeDecisions.eventA,
      eventB: mergeDecisions.eventB,
      score: mergeDecisions.score,
      reasoning: mergeDecisions.reasoning,
    })
    .from(mergeDecisions)
    .innerJoin(eventsA, eq(eventsA.id, mergeDecisions.eventA))
    .innerJoin(eventsB, eq(eventsB.id, mergeDecisions.eventB))
    .where(
      and(
        eq(mergeDecisions.decision, "queued"),
        eq(eventsA.metroId, metro.id),
        eq(eventsB.metroId, metro.id),
        eq(eventsA.status, "active"),
        eq(eventsB.status, "active"),
        inArray(eventsA.nightDate, nights),
      ),
    )
    .orderBy(desc(mergeDecisions.score), mergeDecisions.id)
    .limit(limit);

  if (queuedRows.length === 0) return report;

  // Collect event IDs
  const eventIds = new Set<string>();
  for (const row of queuedRows) {
    eventIds.add(row.eventA);
    eventIds.add(row.eventB);
  }

  // Fetch event details with related data
  const eventDetails = await db
    .select({
      id: events.id,
      title: events.title,
      nightDate: events.nightDate,
      startsAt: events.startsAt,
      endsAt: events.endsAt,
      tz: events.tz,
      listingType: events.listingType,
      styles: events.styles,
      venueName: venues.name,
      venueAddress: venues.address,
      organizerName: organizers.name,
      sourceUrl: sources.url,
    })
    .from(events)
    .leftJoin(venues, eq(venues.id, events.venueId))
    .leftJoin(organizers, eq(organizers.id, events.organizerId))
    .leftJoin(eventSources, eq(eventSources.eventId, events.id))
    .leftJoin(sources, eq(sources.id, eventSources.sourceId))
    .where(
      and(
        inArray(events.id, Array.from(eventIds)),
        eq(events.status, "active"),
        eq(eventSources.role, "primary"),
      ),
    );

  // Map event id to its details (take first source if multiple)
  const eventMap = new Map<string, (typeof eventDetails)[0]>();
  for (const detail of eventDetails) {
    if (!eventMap.has(detail.id)) {
      eventMap.set(detail.id, detail);
    }
  }

  // Process each queued pair
  let stopped = false;
  for (let i = 0; i < queuedRows.length; i++) {
    if (stopped) break;
    const row = queuedRows[i]!;

    // Time cap check
    if (maxMs !== undefined && clock() - startedAt >= maxMs) {
      const left = queuedRows.length - i; // this pair and all remaining
      report.lines.push(
        `stopped: the ${Math.round(maxMs / 1000)}-second review cap is spent; ${left} pair(s) stay queued for the next run`,
      );
      report.stoppedForTime = true;
      break;
    }

    const aDetail = eventMap.get(row.eventA);
    const bDetail = eventMap.get(row.eventB);

    // Skip if either event is not active or missing details
    if (!aDetail || !bDetail) continue;

    // A title that is a whole part of the other's, at one venue and one start, is the same night:
    // no model call (Lisbon's "Último Embrasa do Ano" beside "BAILE | EMBRASA: ... | Último Embrasa
    // do Ano", which the model left unsure on every run, 2026-11-02/03).
    if (sameNightByTitlePart(aDetail, bDetail)) {
      report.merged += 1;
      await db
        .update(mergeDecisions)
        .set({
          decision: "llm_merge",
          reasoning: JSON.stringify({
            rule: "title-part",
            reason: "one title is a whole part of the other's, one venue, one start",
          }),
          updatedAt: new Date(),
        })
        .where(eq(mergeDecisions.id, row.id));
      if (report.lines.length < 30) {
        report.lines.push(`same (title part): ${aDetail.title} | ${bDetail.title}`);
      }
      continue;
    }

    const factsA = factsOf(aDetail);
    const factsB = factsOf(bDetail);

    report.asked += 1;
    let outcome;
    try {
      outcome = await client.run(
        {
          job: jobById("dedupe"),
          system: DEDUPE_SYSTEM,
          user: dedupeUserTurn(factsA, factsB),
          schema: dedupeReplySchema,
          jsonSchema: DEDUPE_JSON_SCHEMA,
        },
        { metro: metro.slug },
      );
    } catch {
      // Exception: treat as failure and stop
      report.failed += 1;
      stopped = true;
      continue;
    }

    if (!outcome.ok) {
      report.failed += 1;
      if (outcome.reason === "quota_exhausted" || outcome.reason === "no_eligible_provider") {
        stopped = true;
      }
      continue;
    }

    const reply = outcome.value;
    const verdict =
      reply.same && reply.sure ? "same" : !reply.same && reply.sure ? "distinct" : "unsure";

    if (verdict === "same") {
      report.merged += 1;
      await db
        .update(mergeDecisions)
        .set({
          decision: "llm_merge",
          reasoning: JSON.stringify({
            model: outcome.model,
            prompt: DEDUPE_PROMPT_VERSION,
            reason: reply.reason,
          }),
          updatedAt: new Date(),
        })
        .where(eq(mergeDecisions.id, row.id));
      if (report.lines.length < 30) {
        report.lines.push(`same: ${aDetail.title} | ${bDetail.title} (${reply.reason})`);
      }
    } else if (verdict === "distinct") {
      report.distinct += 1;
      await db
        .update(mergeDecisions)
        .set({
          decision: "llm_distinct",
          reasoning: JSON.stringify({
            model: outcome.model,
            prompt: DEDUPE_PROMPT_VERSION,
            reason: reply.reason,
          }),
          updatedAt: new Date(),
        })
        .where(eq(mergeDecisions.id, row.id));
      if (report.lines.length < 30) {
        report.lines.push(`distinct: ${aDetail.title} | ${bDetail.title} (${reply.reason})`);
      }
    } else {
      report.unsure += 1;
      // Leave as queued; the report says why, so a pair stuck unsure is seen.
      if (report.lines.length < 30) {
        report.lines.push(`unsure: ${aDetail.title} | ${bDetail.title} (${reply.reason})`);
      }
    }
  }

  return report;
}

/**
 * Whether `short` is one whole part of `long`'s title: `long` split on " | ", " / ", " – ", " — " or
 * " - " (separator with spaces around it), each part compared with `normalizeForMatch`. The part must
 * have at least 2 words and 8 characters after normalizing, so "TBA" or "Live" never match. Titles
 * that are equal after normalizing do not count (the scorer handles those).
 */
export function titleIsPartOf(short: string, long: string): boolean {
  const normalizedShort = normalizeForMatch(short);
  const normalizedLong = normalizeForMatch(long);

  // If titles are equal after normalization, return false (scorer handles these)
  if (normalizedShort === normalizedLong) return false;

  // Check minimum length and word count
  if (normalizedShort.length < 8) return false;
  const wordCount = normalizedShort.split(/\s+/).filter((w) => w.length > 0).length;
  if (wordCount < 2) return false;

  // Split long title by separators with spaces around them
  const parts = long.split(/\s+(?:\||\/|–|—|-)\s+/);
  // If there's only one part, can't be a part of
  if (parts.length <= 1) return false;

  // Check if any part matches short after normalization
  for (const part of parts) {
    if (normalizeForMatch(part) === normalizedShort) {
      return true;
    }
  }
  return false;
}

function sameNightByTitlePart(
  a: { title: string; venueName: string | null; startsAt: Date | null },
  b: { title: string; venueName: string | null; startsAt: Date | null },
): boolean {
  if (!a.venueName || !b.venueName) return false;
  if (normalizeForMatch(a.venueName) !== normalizeForMatch(b.venueName)) return false;
  if (!a.startsAt || !b.startsAt || a.startsAt.getTime() !== b.startsAt.getTime()) return false;
  return titleIsPartOf(a.title, b.title) || titleIsPartOf(b.title, a.title);
}

export function formatDedupeReview(r: DedupeReviewReport): string[] {
  // A pair settled by rule (title part) asks nothing, but its merge is still reported.
  if (r.asked === 0 && r.merged === 0) return [];
  const lines = [
    `Duplicate review by model: ${r.asked} pairs asked, ${r.merged} same, ${r.distinct} distinct, ${r.unsure} unsure, ${r.failed} failed.`,
  ];
  for (const line of r.lines) {
    lines.push(`  ${line}`);
  }
  return lines;
}
