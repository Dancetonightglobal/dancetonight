// Dedupe and merge (PLAN section 9, D-006): the database half. Candidate pairs come from SQL
// (same metro and night, starts within 90 minutes or either start not listed, venues within 150 m
// or with names at 0.8 trigram similarity, never two listings of one source); src/domain/dedupe.ts
// scores them.
//
// - auto_merge: the less trusted listing is marked `merged` into the survivor, which gains its
//   sources and source links; a start more than 15 minutes apart marks the survivor
//   `conflicting` and copies the other time's provenance onto it, so both values are shown. A
//   survivor that lists no time takes the merged listing's times with their provenance (D-060).
// - queued: recorded for the Phase 3 model check on facts only; nothing changes yet.
// - distinct: recorded only when it came close (score above zero), for tuning.
// Every decision is written to merge_decisions, keyed by the pair, so a re-run updates it, except
// a person's or a model's "distinct", which nothing overwrites and no merge crosses (D-090).
//
// Before the score, the organizer link (D-090) merges pairs one organiser runs, told from
// structure: a shared own site, or a directory's title that is the organiser's name. Every merge
// records what it copied onto the survivor, so `unmergePair` (`pnpm dedupe:unmerge`) can undo it.

import { and, eq, inArray, sql } from "drizzle-orm";

import {
  CANDIDATE_START_MINUTES,
  CANDIDATE_VENUE_METRES,
  CANDIDATE_VENUE_NAME_SIMILARITY,
  CANCELLED_MOVED_MINUTES,
  GENERIC_TITLE_WORDS,
  UNPLACED_SAME_TITLE_MIN_CHARS,
  ONE_PLACE_METRES,
  SAME_ADDRESS_NAMED_METRES,
  SAME_NIGHT_PREFIX_MIN_CHARS,
  SAME_NIGHT_START_MINUTES,
  SAME_NIGHT_TITLE_SIMILARITY,
  TRUST_ORDER,
  UNPLACED_PAIR_MIN_CHARS,
} from "@/config/dedupe";
/** A weekly rule night yields to a dated night at the same venue (D-295) when points are within this distance. */
export const WEEKLY_YIELD_VENUE_METRES = 1000;
import { METRO_SOURCES } from "@/config/sources";
import { normalizeForMatch } from "@/config/styles";
import type { Metro } from "@/src/adapters/types";
import type { Db } from "@/src/db/client";
import { events, fieldProvenance, mergeDecisions } from "@/src/db/schema";
import {
  chooseSurvivor,
  coreTitlePrefix,
  coreTitleWords,
  fillsTime,
  isHubSite,
  oneVenueOneStart,
  firstTimesWithin,
  ownSite,
  pickLinkedPairs,
  sameKindOfNight,
  sameTitleSameEnd,
  containedTitleSameEnd,
  sharedEventPage,
  scorePair,
  startsConflict,
  type DedupeSide,
  type LinkCandidate,
  type LinkSide,
  type OrganizerLink,
  type TrustTier,
} from "@/src/domain/dedupe";
import { listCopyAndOwnPage } from "@/src/domain/list-and-page";
import { sharedTicketSites } from "@/src/domain/shared-ticket-sites";
import { onePageTwice } from "@/src/domain/one-page";
import { NEAR_VENUES_METRES, sameTitleNearVenues } from "@/src/domain/same-title-near-venues";
import { directoryBesideOwn } from "@/src/domain/directory-beside-own";
import { unplacedTitlePrefix } from "@/src/domain/unplaced-title-prefix";
import { placedBesideBareCopy } from "@/src/domain/placed-beside-bare-copy";
import { sameSourceSubsetTwin } from "@/src/domain/same-source-subset";
import {
  CLOSING_TIME_TAIL,
  oneTitleStartsApart,
  TITLE_STARTS_APART_MINUTES,
} from "@/src/domain/title-starts-apart";
import {
  copyTimesFromMerged,
  mergeInto,
  pipelineId,
  refillTimesFromMerges,
  TIME_FIELDS,
  type DbOrTx,
} from "@/src/pipeline/store";

/** One merge this run made, named in the run report (D-090). */
export interface MergedPair {
  night: string;
  survivor: string;
  merged: string;
  /** How the pair was found: the organizer link's kind, the D-006 score, or the model review. */
  by: OrganizerLink | "score" | "model" | "weekly";
  conflicting: boolean;
}

export interface DedupeReport {
  pairs: number;
  /** Pairs of two sources' listings checked for one organiser (the organizer link, D-090). */
  linkPairs: number;
  merged: number;
  /** Of `merged`, those decided by the organizer link rather than the score. */
  linked: number;
  queued: number;
  conflicting: number;
  mergedPairs: MergedPair[];
  /** Merges undone this run because the merged listing's source cancelled it: "night title". */
  released: string[];
  /** Pairs at one venue and one start, not merged, whose titles share a word that is not generic: for review. */
  possible: string[];
  /** Pairs from two sources at one venue and one start, not merged, whose titles share no telling word: queued for model review (owner, 2026-10-17). */
  sameSlot: string[];
}

export const EMPTY_DEDUPE_REPORT: DedupeReport = {
  pairs: 0,
  linkPairs: 0,
  merged: 0,
  linked: 0,
  queued: 0,
  conflicting: 0,
  mergedPairs: [],
  released: [],
  possible: [],
  sameSlot: [],
};

/**
 * The run report's dedupe lines: the counts, then every merge by name, so a wrong one can be
 * found and undone with `pnpm dedupe:unmerge` (D-090).
 */
export function formatDedupeReport(report: DedupeReport): string[] {
  const lines = [
    `Dedupe: ${report.pairs} candidate pairs and ${report.linkPairs} checked for one organiser, ${report.merged} merged (${report.linked} by organiser link, ${report.conflicting} with conflicting times), ${report.queued} queued for Phase 3.`,
  ];
  const how = {
    same_site: "same organiser site",
    named: "titled by the organiser's name",
    score: "score",
    model: "model review",
    weekly: "a weekly rule night yields to a dated night at the venue",
  };
  for (const m of report.mergedPairs) {
    lines.push(
      `Merged: ${m.night} ${m.survivor} <- ${m.merged} (${how[m.by]}${m.conflicting ? ", times conflict" : ""})`,
    );
  }
  for (const r of report.released) {
    lines.push(
      `Unmerged: ${r} (its source cancelled it; both listed, so the sources' disagreement shows)`,
    );
  }
  if (report.possible.length > 0) {
    lines.push(`Possible duplicates left (one venue, one start): ${report.possible.length}`);
    for (const p of report.possible) {
      lines.push(`  ${p}`);
    }
  }
  if (report.sameSlot.length > 0) {
    lines.push(
      `Same venue and start, titles unalike (queued for model review): ${report.sameSlot.length}`,
    );
    for (const p of report.sameSlot) {
      lines.push(`  ${p}`);
    }
  }
  return lines;
}

/** Decisions nothing overwrites and no merge crosses: a person's or a model's "distinct". */
const DISTINCT_DECISIONS = ["manual_distinct", "llm_distinct"] as const;

interface CandidateRow extends Record<string, unknown> {
  a_id: string;
  b_id: string;
  title_sim: number;
  org_sim: number | null;
  title_prefix: boolean;
  shifted_a: boolean;
  shifted_b: boolean;
  same_source: boolean;
  /** The two listings share a source in any role (a merged listing's sources count), D-515. */
  shared_source: boolean;
  rule_a: boolean;
  rule_b: boolean;
  same_place: boolean;
}

export async function findCandidates(
  db: Db,
  metroId: string,
  nights: readonly string[],
  shiftedUrls: readonly string[] = [],
): Promise<CandidateRow[]> {
  if (nights.length === 0) return [];
  const shiftedArray = shiftedUrls.length > 0 ? `{${shiftedUrls.join(",")}}` : `{}`;
  const genericArray = `{${GENERIC_TITLE_WORDS.join(",")}}`;
  const rows = await db.execute<CandidateRow>(sql`
    select a.id as a_id, b.id as b_id,
      similarity(a.title_normalized, b.title_normalized)::float8 as title_sim,
      case when oa.id is not null and ob.id is not null
        then similarity(oa.name_normalized, ob.name_normalized)::float8 end as org_sim,
      (least(length(a.title_normalized), length(b.title_normalized)) >= ${SAME_NIGHT_PREFIX_MIN_CHARS}
        and (
          (left(a.title_normalized, length(b.title_normalized)) = b.title_normalized
            and (length(a.title_normalized) = length(b.title_normalized)
              or substr(a.title_normalized, length(b.title_normalized) + 1, 1) !~ '[[:alnum:]]'))
          or
          (left(b.title_normalized, length(a.title_normalized)) = a.title_normalized
            and (length(b.title_normalized) = length(a.title_normalized)
              or substr(b.title_normalized, length(a.title_normalized) + 1, 1) !~ '[[:alnum:]]'))
        )
      ) as title_prefix,
      exists (
        select 1 from event_sources xa join sources sa on sa.id = xa.source_id
        where xa.event_id = a.id and xa.role = 'primary' and sa.url = any(${shiftedArray}::text[])
      ) as shifted_a,
      exists (
        select 1 from event_sources xb join sources sb on sb.id = xb.source_id
        where xb.event_id = b.id and xb.role = 'primary' and sb.url = any(${shiftedArray}::text[])
      ) as shifted_b,
      exists (
        select 1 from event_sources x
        join event_sources y on y.source_id = x.source_id
        where x.event_id = a.id and y.event_id = b.id
          and x.role = 'primary' and y.role = 'primary'
      ) as same_source,
      exists (
        select 1 from event_sources x
        join event_sources y on y.source_id = x.source_id
        where x.event_id = a.id and y.event_id = b.id
      ) as shared_source,
      a.last_verified_at is null as rule_a,
      b.last_verified_at is null as rule_b,
      (
        (a.venue_id is not null and a.venue_id = b.venue_id)
        or (
          va.id is not null and vb.id is not null
          and least(length(va.name_normalized), length(vb.name_normalized)) >= 8
          and (
            strpos(va.name_normalized, vb.name_normalized) > 0
            or strpos(vb.name_normalized, va.name_normalized) > 0
            or similarity(va.name_normalized, vb.name_normalized) >= ${CANDIDATE_VENUE_NAME_SIMILARITY}
          )
          and coalesce(a.geo, va.location) is not null
          and coalesce(b.geo, vb.location) is not null
          and ST_DWithin(coalesce(a.geo, va.location), coalesce(b.geo, vb.location), ${WEEKLY_YIELD_VENUE_METRES})
        )
      ) as same_place
    from events a
    join events b
      on b.metro_id = a.metro_id and b.night_date = a.night_date and a.id < b.id
    left join venues va on va.id = a.venue_id
    left join venues vb on vb.id = b.venue_id
    left join organizers oa on oa.id = a.organizer_id
    left join organizers ob on ob.id = b.organizer_id
    where a.metro_id = ${metroId}
      and a.night_date = any(${`{${nights.join(",")}}`}::date[])
      and a.status in ('active', 'cancelled') and b.status in ('active', 'cancelled')
      and (
        a.starts_at is null 
        or b.starts_at is null
        or abs(extract(epoch from (a.starts_at - b.starts_at))) <= ${CANDIDATE_START_MINUTES * 60}
        -- The evening's first time on both: doors on one source, dancing on the other (Super Mario, 2026-11-05).
        or abs(extract(epoch from (least(a.doors_at, a.lesson_at, a.dancing_at, a.starts_at)
          - least(b.doors_at, b.lesson_at, b.dancing_at, b.starts_at)))) <= ${CANDIDATE_START_MINUTES * 60}
        -- One event page on both: one event whatever the starts (D-592).
        or (a.ticket_url is not null and a.ticket_url = b.ticket_url)
        or (a.canonical_url is not null and a.canonical_url = b.canonical_url)
        or exists (
          select 1 from event_sources x join event_sources y on y.source_id = x.source_id
          where x.event_id = a.id and y.event_id = b.id
        )
        or (exists (
          select 1 from event_sources xa join sources sa on sa.id = xa.source_id
          where xa.event_id = a.id and xa.role = 'primary' and sa.url = any(${shiftedArray}::text[])
        ) or exists (
          select 1 from event_sources xb join sources sb on sb.id = xb.source_id
          where xb.event_id = b.id and xb.role = 'primary' and sb.url = any(${shiftedArray}::text[])
        ))
        -- One title with one end: doors on one source, start on the other (Do-Over, 2026-11-05).
        or (a.ends_at is not null and a.ends_at = b.ends_at and a.title_normalized = b.title_normalized)
        -- D-752: one venue and one end, one title's words inside the other's (Animal, 2026-11-05); titles checked in code.
        or (a.ends_at is not null and a.ends_at = b.ends_at and a.venue_id is not null and a.venue_id = b.venue_id)
        -- D-877: or two venue rows at one street address close together (Animal / Animal NYC, 2026-11-12).
        or (a.ends_at is not null and a.ends_at = b.ends_at and va.id is not null and vb.id is not null
            and lower(va.address->>'formatted') = lower(vb.address->>'formatted')
            and ST_DWithin(va.location, vb.location, ${SAME_ADDRESS_NAMED_METRES}))
        -- D-769: one exact title at one venue, starts up to 3 hours apart (NOTO, 2026-11-12); checked in code.
        -- D-790: a closing-time tail ("club mix till 4am") is the same title.
        or (regexp_replace(a.title_normalized, ${CLOSING_TIME_TAIL}, '')
              = regexp_replace(b.title_normalized, ${CLOSING_TIME_TAIL}, '')
            and a.venue_id is not null and b.venue_id is not null
            and abs(extract(epoch from (a.starts_at - b.starts_at))) <= ${TITLE_STARTS_APART_MINUTES * 60})
      )
      -- Two listings that one source lists as its own are two of its listings, never a pair.
      -- A source that is only a secondary link (its copy was merged in earlier) does not bar a
      -- pair, or its next copy of the same night, timed or not, would stand beside the survivor.
      -- ...unless both are at one venue at one start: one night the page names twice (D-150).
      -- or two venue rows of one place (D-504).
      -- or one source's cancelled session beside its live one at a nearby time, one venue, one title (D-594).
      -- or one event page on both at one venue, one start or either untimed; onePageTwice decides (D-766, D-804).
      -- or both untimed at one venue: a list-page copy beside its own event page; listCopyAndOwnPage decides (D-767).
      and (not exists (
        select 1 from event_sources x
        join event_sources y on y.source_id = x.source_id
        where x.event_id = a.id and y.event_id = b.id
          and x.role = 'primary' and y.role = 'primary'
      -- D-883: one title's words inside the other's, one venue (or both unplaced), one start or one untimed (never
      -- both unplaced and untimed); sameSourceSubsetTwin decides (Club 69 / Club 69 en Niceto Club, MU-003 twice).
      ) or (a.confirmation::text <> 'cancelled' and b.confirmation::text <> 'cancelled'
            and (a.starts_at is null or b.starts_at is null or a.starts_at = b.starts_at)
            and ((a.venue_id is not null and a.venue_id = b.venue_id)
              or (a.venue_id is null and b.venue_id is null and a.geo is null and b.geo is null
                and (a.starts_at is not null or b.starts_at is not null)))
            and (array_remove(regexp_split_to_array(a.title_normalized, '[^[:alnum:]]+'), '')
                  <@ array_remove(regexp_split_to_array(b.title_normalized, '[^[:alnum:]]+'), '')
              or array_remove(regexp_split_to_array(b.title_normalized, '[^[:alnum:]]+'), '')
                  <@ array_remove(regexp_split_to_array(a.title_normalized, '[^[:alnum:]]+'), '')))
        or (a.starts_at is not null and b.starts_at is not null and a.venue_id is not null and b.venue_id is not null
            -- One start; or, for a platform's two pages of one night (not a studio's own sessions, not a class), starts
            -- up to 15 minutes apart, as the code's D-150 check (social-dance.today Funky Mambo 19:00 / 19:15, D-786).
            and (a.starts_at = b.starts_at
              or (abs(extract(epoch from (a.starts_at - b.starts_at))) <= ${SAME_NIGHT_START_MINUTES * 60}
                and a.listing_type::text <> 'class' and b.listing_type::text <> 'class'
                and not exists (
                  select 1 from event_sources x join event_sources y on y.source_id = x.source_id
                  join sources s on s.id = x.source_id
                  where x.event_id = a.id and y.event_id = b.id
                    and x.role = 'primary' and y.role = 'primary' and s.trust_tier = 'first_party')))
            and (a.venue_id = b.venue_id
              or (coalesce(a.geo, va.location) is not null and coalesce(b.geo, vb.location) is not null
                and ST_DWithin(coalesce(a.geo, va.location), coalesce(b.geo, vb.location), ${ONE_PLACE_METRES}))))
        or ((a.confirmation::text = 'cancelled') <> (b.confirmation::text = 'cancelled')
            and a.title_normalized = b.title_normalized
            and a.venue_id is not null and a.venue_id = b.venue_id
            and a.starts_at is not null and b.starts_at is not null
            and abs(extract(epoch from (a.starts_at - b.starts_at))) <= ${CANCELLED_MOVED_MINUTES * 60})
        or (((a.ticket_url is not null and a.ticket_url in (b.ticket_url, b.canonical_url))
              or (a.canonical_url is not null and a.canonical_url in (b.ticket_url, b.canonical_url))
              or (a.starts_at is null and b.starts_at is null))
            -- D-804: one side untimed is admitted too when the two share an event page; onePageTwice decides.
            and (a.starts_at is null or b.starts_at is null or a.starts_at = b.starts_at)
            and ((a.venue_id is not null and b.venue_id is not null
              and (a.venue_id = b.venue_id
                or (coalesce(a.geo, va.location) is not null and coalesce(b.geo, vb.location) is not null
                  and ST_DWithin(coalesce(a.geo, va.location), coalesce(b.geo, vb.location), ${ONE_PLACE_METRES}))))
              -- D-866: one side bare (no place, no start) beside its placed copy, one shared link (Roofchata, NYC
              -- 2026-11-11); onePageTwice decides that the link is a specific event page.
              or (((a.venue_id is null and a.geo is null and a.starts_at is null)
                  <> (b.venue_id is null and b.geo is null and b.starts_at is null))
                and ((a.ticket_url is not null and a.ticket_url in (b.ticket_url, b.canonical_url))
                  or (a.canonical_url is not null and a.canonical_url in (b.ticket_url, b.canonical_url))))
              -- D-884: one side unplaced but timed beside its placed copy, one exact title, one start, one shared
              -- link (itsmenna.com Discostan on two event pages, NYC 2026-11-19); onePageTwice decides.
              or (((a.venue_id is null and coalesce(a.geo, va.location) is null)
                  <> (b.venue_id is null and coalesce(b.geo, vb.location) is null))
                and a.starts_at is not null and a.starts_at = b.starts_at
                and a.title_normalized = b.title_normalized
                and ((a.ticket_url is not null and a.ticket_url in (b.ticket_url, b.canonical_url))
                  or (a.canonical_url is not null and a.canonical_url in (b.ticket_url, b.canonical_url)))))))
      and (
        (coalesce(a.geo, va.location) is not null and coalesce(b.geo, vb.location) is not null
          and ST_DWithin(coalesce(a.geo, va.location), coalesce(b.geo, vb.location), ${CANDIDATE_VENUE_METRES}))
        or (va.id is not null and vb.id is not null
          and similarity(va.name_normalized, vb.name_normalized) >= ${CANDIDATE_VENUE_NAME_SIMILARITY})
        -- D-765: one venue name inside the other a few hundred metres apart (Oslo Hackney / Oslo Hackney London); onePlace decides.
        or (va.id is not null and vb.id is not null
          and coalesce(a.geo, va.location) is not null and coalesce(b.geo, vb.location) is not null
          and ST_DWithin(coalesce(a.geo, va.location), coalesce(b.geo, vb.location), ${SAME_ADDRESS_NAMED_METRES})
          and (strpos(va.name_normalized, vb.name_normalized) > 0 or strpos(vb.name_normalized, va.name_normalized) > 0))
        -- D-817: a directory's copy and a first-party copy at one venue row, any titles; directoryBesideOwn decides
        -- (Salsa Vida's "El Café Latino Roppongi" 19:30 beside the venue's own "Latin Social" 21:00, Tokyo 2026-11-10).
        or (a.venue_id is not null and a.venue_id = b.venue_id
          and exists (select 1 from event_sources x join sources s on s.id = x.source_id
            where x.event_id in (a.id, b.id) and x.role = 'primary' and s.trust_tier = 'directory')
          and exists (select 1 from event_sources x join sources s on s.id = x.source_id
            where x.event_id in (a.id, b.id) and x.role = 'primary' and s.trust_tier = 'first_party'))
        -- D-811: two sources' one exact title at one start at venue rows within 1.5 km; sameTitleNearVenues decides
        -- (D-803: FIRE London Fuego ~170 m, House of Yes ~1.2 km, never candidates under the 150 m gate).
        or (va.id is not null and vb.id is not null
          and a.starts_at is not null and a.starts_at = b.starts_at
          and a.title_normalized = b.title_normalized
          and coalesce(a.geo, va.location) is not null and coalesce(b.geo, vb.location) is not null
          and ST_DWithin(coalesce(a.geo, va.location), coalesce(b.geo, vb.location), ${NEAR_VENUES_METRES})
          and not exists (
            select 1 from event_sources x join event_sources y on y.source_id = x.source_id
            where x.event_id = a.id and y.event_id = b.id))
        -- One ticket or event link is one place even when neither copy could be placed (Capulet Ball, 2026-10-17).
        or (a.ticket_url is not null and a.ticket_url = b.ticket_url)
        or (a.canonical_url is not null and a.canonical_url = b.canonical_url)
        -- D-883: one source's two unplaced copies, one timed (MU-003 on two RA ids); sameSourceSubsetTwin decides.
        or (a.venue_id is null and b.venue_id is null and a.geo is null and b.geo is null
          and (a.starts_at is not null or b.starts_at is not null)
          and (a.starts_at is null or b.starts_at is null or a.starts_at = b.starts_at)
          and exists (select 1 from event_sources x join event_sources y on y.source_id = x.source_id
            where x.event_id = a.id and y.event_id = b.id and x.role = 'primary' and y.role = 'primary'))
        -- theronda.us also misplaces venues ("Ripley Grier Studios - Midtown", 1.3 km
        -- off): for a startTimesShifted source, one venue name containing the other is one place (D-146).
        or ((exists (
          select 1 from event_sources xa join sources sa on sa.id = xa.source_id
          where xa.event_id = a.id and xa.role = 'primary' and sa.url = any(${shiftedArray}::text[])
        ) or exists (
          select 1 from event_sources xb join sources sb on sb.id = xb.source_id
          where xb.event_id = b.id and xb.role = 'primary' and sb.url = any(${shiftedArray}::text[])
        ))
          and va.id is not null and vb.id is not null
          and least(length(va.name_normalized), length(vb.name_normalized)) >= 6
          and (strpos(va.name_normalized, vb.name_normalized) > 0
            or strpos(vb.name_normalized, va.name_normalized) > 0))
        -- Exactly one side has no place at all (no point, no venue): "Location not listed" is not a different
        -- place (Hole 19 on Meetup, 2026-10-29). Only near-identical titles at one start. Two unplaced copies
        -- still need one ticket or event link (above).
        or (
          ((coalesce(a.geo, va.location) is null and a.venue_id is null)
            <> (coalesce(b.geo, vb.location) is null and b.venue_id is null))
          and a.starts_at is not null and b.starts_at is not null
          and abs(extract(epoch from (a.starts_at - b.starts_at))) <= ${SAME_NIGHT_START_MINUTES * 60}
          and least(length(a.title_normalized), length(b.title_normalized)) >= ${UNPLACED_PAIR_MIN_CHARS}
          and similarity(a.title_normalized, b.title_normalized) >= ${SAME_NIGHT_TITLE_SIMILARITY}
        )
        -- D-751: no place on either side, two sources, one title word for word with a telling word
        -- (London Afrocentric, RA vs Shoobs, 2026-11-06). A generic title ("Salsa Social Night") still needs a link.
        or (
          coalesce(a.geo, va.location) is null and a.venue_id is null
          and coalesce(b.geo, vb.location) is null and b.venue_id is null
          and a.title_normalized = b.title_normalized
          and length(replace(a.title_normalized, ' ', '')) >= ${UNPLACED_SAME_TITLE_MIN_CHARS}
          and exists (
            select 1 from regexp_split_to_table(a.title_normalized, '[^[:alnum:]]+') as w(word)
            where length(w.word) >= 4 and not (w.word = any(${genericArray}::text[]))
          )
          and not exists (
            select 1 from event_sources x join event_sources y on y.source_id = x.source_id
            where x.event_id = a.id and y.event_id = b.id
          )
          -- Two pages on one seller are two of its events (Capulet Ball, dice /abc vs /xyz).
          and not (
            a.ticket_url is not null and b.ticket_url is not null and a.ticket_url <> b.ticket_url
            and lower(split_part(split_part(a.ticket_url, '://', 2), '/', 1))
              = lower(split_part(split_part(b.ticket_url, '://', 2), '/', 1))
          )
        )
        -- D-806: no place on one or both sides, one start, one title's words at the head of the other's (or after
        -- one promoter word): Cadence RA/DICE, Tamborzao, Sun City (2026-11-08). unplacedTitlePrefix decides.
        or (
          ((coalesce(a.geo, va.location) is null and a.venue_id is null)
            or (coalesce(b.geo, vb.location) is null and b.venue_id is null))
          and a.starts_at is not null and a.starts_at = b.starts_at
          -- One title word for word is D-751's and the near-identical rule's (above), with their guards.
          and a.title_normalized <> b.title_normalized
          and not (
            a.ticket_url is not null and b.ticket_url is not null and a.ticket_url <> b.ticket_url
            and lower(split_part(split_part(a.ticket_url, '://', 2), '/', 1))
              = lower(split_part(split_part(b.ticket_url, '://', 2), '/', 1))
          )
          and greatest(word_similarity(a.title_normalized, b.title_normalized),
            word_similarity(b.title_normalized, a.title_normalized)) >= 0.6
        )
        -- D-864: one side has no place and no time, the other may have both; one exact title (Barcelona Wave Fest,
        -- DICE 11pm at Sala Bikini vs RA bare, 2026-11-11). placedBesideBareCopy decides.
        or (
          ((coalesce(a.geo, va.location) is null and a.venue_id is null and a.starts_at is null)
            <> (coalesce(b.geo, vb.location) is null and b.venue_id is null and b.starts_at is null))
          and a.title_normalized = b.title_normalized
          and length(replace(a.title_normalized, ' ', '')) >= ${UNPLACED_SAME_TITLE_MIN_CHARS}
          -- The decider's guards here too, so the score rule never joins what it would refuse ("Salsa Social Night").
          and exists (
            select 1 from regexp_split_to_table(a.title_normalized, '[^[:alnum:]]+') as w(word)
            where length(w.word) >= 4 and not (w.word = any(${genericArray}::text[]))
          )
          and not (
            a.ticket_url is not null and b.ticket_url is not null and a.ticket_url <> b.ticket_url
            and lower(split_part(split_part(a.ticket_url, '://', 2), '/', 1))
              = lower(split_part(split_part(b.ticket_url, '://', 2), '/', 1))
          )
        )
        -- A weekly rule night yields to a dated night at the same venue (D-295).
        or (
          (a.last_verified_at is null) <> (b.last_verified_at is null)
          and (
            (a.venue_id is not null and a.venue_id = b.venue_id)
            or (
              va.id is not null and vb.id is not null
              and least(length(va.name_normalized), length(vb.name_normalized)) >= 8
              and (
                strpos(va.name_normalized, vb.name_normalized) > 0
                or strpos(vb.name_normalized, va.name_normalized) > 0
                or similarity(va.name_normalized, vb.name_normalized) >= ${CANDIDATE_VENUE_NAME_SIMILARITY}
              )
              and coalesce(a.geo, va.location) is not null
              and coalesce(b.geo, vb.location) is not null
              and ST_DWithin(coalesce(a.geo, va.location), coalesce(b.geo, vb.location), ${WEEKLY_YIELD_VENUE_METRES})
            )
          )
        )
      )
  `);
  return [...rows];
}

interface LinkCandidateRow extends Record<string, unknown> {
  a_id: string;
  b_id: string;
  title_sim: number;
  near: boolean;
}

/**
 * Pairs for the organizer link (D-090): two sources' listings of one night whose starts are
 * within 90 minutes or not listed, at one place (same venue, points within 150 m, or venue names
 * alike), or where either has no place at all ("Location not listed" is not a different place).
 * Two placed listings far apart are never a pair. Only pairs that could link are returned: one
 * side's source is first-party, or both name an organiser with a website.
 */
export async function findLinkCandidates(
  db: Db,
  metroId: string,
  nights: readonly string[],
): Promise<LinkCandidateRow[]> {
  if (nights.length === 0) return [];
  const rows = await db.execute<LinkCandidateRow>(sql`
    with side as (
      select e.id, e.metro_id, e.night_date, e.starts_at, e.title_normalized, e.venue_id,
        coalesce(e.geo, v.location) as at, v.name_normalized as venue_name,
        o.website_url is not null as has_site,
        exists (select 1 from event_sources es join sources s on s.id = es.source_id
          where es.event_id = e.id and es.role = 'primary' and s.trust_tier = 'first_party')
          as first_party
      from events e
      left join venues v on v.id = e.venue_id
      left join organizers o on o.id = e.organizer_id
      where e.metro_id = ${metroId}
        and e.night_date = any(${`{${nights.join(",")}}`}::date[])
        and e.status in ('active', 'cancelled')
    )
    select a_id, b_id, title_sim, near from (
      select a.id as a_id, b.id as b_id,
        similarity(a.title_normalized, b.title_normalized)::float8 as title_sim,
        coalesce(
          (a.venue_id is not null and a.venue_id = b.venue_id)
          or (a.at is not null and b.at is not null
            and ST_DWithin(a.at, b.at, ${CANDIDATE_VENUE_METRES}))
          or (a.venue_name is not null and b.venue_name is not null
            and similarity(a.venue_name, b.venue_name) >= ${CANDIDATE_VENUE_NAME_SIMILARITY}),
          false) as near,
        a.at is null or b.at is null as unplaced
      from side a
      join side b on b.night_date = a.night_date and a.id < b.id
      where (a.first_party or b.first_party or (a.has_site and b.has_site))
        and (a.starts_at is null or b.starts_at is null
          or abs(extract(epoch from (a.starts_at - b.starts_at))) <= ${CANDIDATE_START_MINUTES * 60})
        and not exists (
          select 1 from event_sources x
          join event_sources y on y.source_id = x.source_id
          where x.event_id = a.id and y.event_id = b.id
            and x.role = 'primary' and y.role = 'primary'
        )
    ) p where near or unplaced
  `);
  return [...rows];
}

/**
 * What the organizer link reads about each listing: its primary source and that source's tier,
 * the organiser's own sites (its website; the source's domain when the source is first-party; never
 * a platform or a hub), and, for a first-party listing, the organiser's names (the source's label,
 * its `alsoListedAs`, and the listing's organiser).
 */
export async function loadLinkSides(
  db: Db,
  metro: Metro,
  ids: readonly string[],
): Promise<Map<string, LinkSide>> {
  if (ids.length === 0) return new Map();
  const rows = await db.execute<{
    id: string;
    source_id: string | null;
    source_url: string | null;
    trust: string | null;
    title_normalized: string;
    listing_type: string;
    organizer_name: string | null;
    organizer_site: string | null;
    starts_at: Date | string | null;
    confirmation: string;
    merged_sources: string[] | null;
  }>(sql`
    select e.id, s.id as source_id, s.url as source_url, s.trust_tier::text as trust,
      e.title_normalized, e.listing_type::text as listing_type, o.name as organizer_name,
      o.website_url as organizer_site, e.starts_at, e.confirmation::text as confirmation,
      array(
        select distinct es.source_id from events m
        join event_sources es on es.event_id = m.id and es.role = 'primary'
        where m.merged_into_id = e.id and m.status = 'merged' and m.night_date = e.night_date
      ) as merged_sources
    from events e
    left join lateral (
      select es.source_id from event_sources es
      where es.event_id = e.id and es.role = 'primary'
      order by es.first_seen_at, es.id limit 1
    ) p on true
    left join sources s on s.id = p.source_id
    left join organizers o on o.id = e.organizer_id
    where e.id = any(${`{${ids.join(",")}}`}::uuid[])
  `);
  const seeds = METRO_SOURCES[metro.slug] ?? [];
  const sides = new Map<string, LinkSide>();
  const ticketSites = sharedTicketSites(seeds);
  for (const r of rows) {
    if (!r.source_id || !r.source_url) continue;
    const trust: TrustTier = (TRUST_ORDER as readonly string[]).includes(r.trust ?? "")
      ? (r.trust as TrustTier)
      : "unofficial";
    const firstParty = trust === "first_party";
    const seed = seeds.find((s) => s.url === r.source_url);
    const sourceSite = ownSite(r.source_url);
    const organizerSite = ownSite(r.organizer_site);
    const sites = [
      ...(firstParty && sourceSite ? [sourceSite] : []),
      // A directory named as its own listing's organiser is the directory (D-070), not one.
      ...(organizerSite && (firstParty || organizerSite !== sourceSite) ? [organizerSite] : []),
      // D-830: a ticket site for several venues (mandalatickets.com) is no one organiser's site.
    ].filter((site) => !isHubSite(site) && !ticketSites.has(site));
    // A hub's listing names a third party as its organiser: that name is not the hub's.
    const hub = sourceSite !== null && isHubSite(sourceSite);
    const names = firstParty
      ? [seed?.label, ...(seed?.alsoListedAs ?? []), hub ? null : r.organizer_name]
          .filter((n): n is string => !!n)
          .map((n) => normalizeForMatch(n))
          .filter(Boolean)
      : [];
    sides.set(r.id, {
      id: r.id,
      sourceId: r.source_id,
      trust,
      titleNormalized: r.title_normalized,
      listingType: r.listing_type,
      sites: [...new Set(sites)],
      names: [...new Set(names)],
      startsAt: r.starts_at === null ? null : new Date(r.starts_at),
      fromRule: r.confirmation === "recurring_unconfirmed",
      mergedSources: r.merged_sources ?? [],
    });
  }
  return sides;
}

/** The pairs a person or a model has called distinct, as "a|b" with the lower id first, with decision type. */
async function distinctPairs(
  db: Db,
  ids: readonly string[],
): Promise<Map<string, "manual_distinct" | "llm_distinct">> {
  if (ids.length === 0) return new Map();
  const list = `{${ids.join(",")}}`;
  const rows = await db.execute<{ event_a: string; event_b: string; decision: string }>(sql`
    select event_a, event_b, decision::text as decision from merge_decisions
    where decision::text = any(${`{${DISTINCT_DECISIONS.join(",")}}`}::text[])
      and (event_a = any(${list}::uuid[]) or event_b = any(${list}::uuid[]))
  `);
  const map = new Map<string, "manual_distinct" | "llm_distinct">();
  for (const r of rows) {
    const key = pairKey(r.event_a, r.event_b);
    // manual_distinct wins over llm_distinct for the same pair
    if (!map.has(key) || r.decision === "manual_distinct") {
      map.set(key, r.decision as "manual_distinct" | "llm_distinct");
    }
  }
  return map;
}

/** The pairs the model has called same (llm_merge), as "a|b" with the lower id first. */
async function modelMergePairs(db: Db, ids: readonly string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const list = `{${ids.join(",")}}`;
  const rows = await db.execute<{ event_a: string; event_b: string }>(sql`
    select event_a, event_b from merge_decisions
    where decision::text = 'llm_merge'
      and (event_a = any(${list}::uuid[]) or event_b = any(${list}::uuid[]))
  `);
  return new Set([...rows].map((r) => pairKey(r.event_a, r.event_b)));
}

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** One source's cancelled session and its live one at one venue, starts within CANCELLED_MOVED_MINUTES (D-594). */
function cancelledMoved(a: DedupeSide, b: DedupeSide): boolean {
  return (
    a.venueId !== null &&
    a.venueId === b.venueId &&
    a.startsAt !== null &&
    b.startsAt !== null &&
    Math.abs(a.startsAt.getTime() - b.startsAt.getTime()) <= CANCELLED_MOVED_MINUTES * 60_000
  );
}

async function loadSides(db: Db, ids: string[]): Promise<Map<string, DedupeSide>> {
  if (ids.length === 0) return new Map();
  const rows = await db.execute<{
    id: string;
    starts_at: Date | string | null;
    ends_at: Date | string | null;
    organizer_id: string | null;
    venue_id: string | null;
    ticket_url: string | null;
    canonical_url: string | null;
    first_seen_at: Date | string;
    doors_at: Date | string | null;
    lesson_at: Date | string | null;
    dancing_at: Date | string | null;
    tiers: string[] | null;
    title: string | null;
    title_normalized: string | null;
    confirmation: string | null;
    listing_type: string | null;
    venue_name: string | null;
    venue_address: string | null;
    lat: number | null;
    lng: number | null;
    source_urls: string[] | null;
  }>(sql`
    select e.id, e.starts_at, e.ends_at, e.organizer_id, e.venue_id, e.ticket_url, e.canonical_url, e.first_seen_at,
      e.doors_at, e.lesson_at, e.dancing_at,
      array(select s.trust_tier::text from sources s where s.id = any(e.source_ids)) as tiers,
      e.title, e.title_normalized, e.confirmation::text as confirmation, e.listing_type::text as listing_type,
      v.name as venue_name,
      v.address->>'formatted' as venue_address,
      -- Each copy's own page too (es.source_url), not only its source's list page (D-749).
      array(select s.url from event_sources es join sources s on s.id = es.source_id where es.event_id = e.id
        union select es.source_url from event_sources es where es.event_id = e.id) as source_urls,
      ST_Y(coalesce(e.geo, v.location)::geometry) as lat, ST_X(coalesce(e.geo, v.location)::geometry) as lng
    from events e left join venues v on v.id = e.venue_id where e.id = any(${`{${ids.join(",")}}`}::uuid[])
  `);
  const sides = new Map<string, DedupeSide>();
  for (const r of rows) {
    const tiers = (r.tiers ?? []).filter((t): t is TrustTier =>
      (TRUST_ORDER as readonly string[]).includes(t),
    );
    const trust =
      tiers.sort((x, y) => TRUST_ORDER.indexOf(x) - TRUST_ORDER.indexOf(y))[0] ?? "unofficial";
    sides.set(r.id, {
      id: r.id,
      startsAt: r.starts_at === null ? null : new Date(r.starts_at),
      endsAt: r.ends_at === null ? null : new Date(r.ends_at),
      organizerId: r.organizer_id,
      organizerName: null,
      venueId: r.venue_id,
      ticketUrl: r.ticket_url,
      canonicalUrl: r.canonical_url,
      trust,
      firstSeenAt: new Date(r.first_seen_at),
      times: {
        doors: r.doors_at === null ? null : new Date(r.doors_at),
        lesson: r.lesson_at === null ? null : new Date(r.lesson_at),
        dancing: r.dancing_at === null ? null : new Date(r.dancing_at),
      },
      title: r.title ?? undefined,
      titleNormalized: r.title_normalized ?? undefined,
      cancelled: r.confirmation === "cancelled",
      listingType: r.listing_type ?? undefined,
      venueName: r.venue_name ?? undefined,
      venueAddress: r.venue_address ?? undefined,
      links: r.source_urls ?? [],
      venuePoint:
        r.lat !== null && r.lng !== null ? { lat: Number(r.lat), lng: Number(r.lng) } : undefined,
    });
  }
  return sides;
}

/**
 * What a merge copied onto its survivor, recorded with the decision so `unmergePair` can undo it
 * (D-090). Each field is what the survivor held before, or that nothing was copied.
 */
export interface MergeRecord {
  survivorId: string;
  mergedId: string;
  /** The survivor took the merged listing's times (it listed none). */
  times: boolean;
  /** The survivor's own end, which taking the times kept. */
  priorEndsAt: string | null;
  /** The survivor took the merged listing's venue and point (it had none). */
  venue: boolean;
  /** The survivor's own point before it took the venue's, as EWKT. */
  priorGeo: string | null;
  /** The survivor took the merged listing's ticket link (it had none). */
  ticket: boolean;
  /** Styles the survivor gained from the merged listing. */
  stylesAdded: string[];
  /** The survivor's confirmation before the merge marked it conflicting, when it did. */
  priorConfirmation: string | null;
  /** Listings merged into the merged listing earlier, re-pointed at the survivor. */
  repointed: string[];
}

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

async function merge(
  db: Db,
  survivor: DedupeSide,
  merged: DedupeSide,
  conflict: boolean,
): Promise<MergeRecord> {
  return db.transaction(async (tx) => {
    const [before] = await tx.execute<{
      confirmation: string;
      styles: string[] | null;
      merged_styles: string[] | null;
      ends_at: Date | string | null;
      geo: string | null;
    }>(sql`
      select s.confirmation::text as confirmation, s.styles, m.styles as merged_styles,
        s.ends_at, ST_AsEWKT(s.geo::geometry) as geo
      from events s, events m where s.id = ${survivor.id} and m.id = ${merged.id}
    `);
    const repointed = [
      ...(await tx.execute<{ id: string }>(sql`
        select id from events where merged_into_id = ${merged.id} and status = 'merged'
      `)),
    ].map((r) => r.id);
    await mergeInto(tx, survivor.id, merged.id);
    if (conflict) {
      await tx
        .update(events)
        .set({ confirmation: "conflicting", updatedAt: new Date() })
        .where(eq(events.id, survivor.id));
    }
    // One source not listing a time is no conflict; the survivor takes the other's times.
    const times = fillsTime(survivor, merged)
      ? await copyTimesFromMerged(tx, survivor.id, merged.id)
      : false;
    const venue = await copyVenueFromMerged(tx, survivor.id, merged.id);
    const ticket = await copyTicketFromMerged(tx, survivor.id, merged.id);
    // The merged listing's styles are facts another source states: a swing night that the
    // organiser's own stub tags only as tango stays in the Swing filter (D-090).
    const own = before?.styles ?? [];
    const stylesAdded = (before?.merged_styles ?? []).filter((st) => !own.includes(st));
    if (stylesAdded.length > 0) await addStyles(tx, survivor.id, stylesAdded);

    if (conflict) {
      // Both values are shown (D-006): the other listing's times are copied onto the survivor.
      await copyFacts(tx, survivor.id, merged.id, [...TIME_FIELDS], false);
    }
    return {
      survivorId: survivor.id,
      mergedId: merged.id,
      times,
      priorEndsAt: times && before?.ends_at ? new Date(before.ends_at).toISOString() : null,
      venue,
      priorGeo: venue ? (before?.geo ?? null) : null,
      ticket,
      stylesAdded: [...new Set(stylesAdded)],
      priorConfirmation:
        conflict && before?.confirmation !== "conflicting" ? (before?.confirmation ?? null) : null,
      repointed,
    };
  });
}

/**
 * A survivor with no venue takes the merged listing's venue and point, with that listing's venue
 * provenance, on the same night only (D-090): one source not placing a night is no conflict. The
 * store's upsert keeps a venue through `coalesce`, so it survives the survivor's next harvest.
 */
async function copyVenueFromMerged(tx: Tx, survivorId: string, mergedId: string): Promise<boolean> {
  const moved = await tx.execute<{ id: string }>(sql`
    update events s set venue_id = m.venue_id, geo = coalesce(m.geo, s.geo), updated_at = now()
    from events m
    where s.id = ${survivorId} and m.id = ${mergedId}
      and s.venue_id is null and m.venue_id is not null and m.night_date = s.night_date
    returning s.id
  `);
  if ([...moved].length === 0) return false;
  await copyFacts(tx, survivorId, mergedId, ["venue_name", "venue_address"], true);
  return true;
}

/** A survivor with no ticket link takes the merged listing's, with its provenance (D-090). */
async function copyTicketFromMerged(
  tx: DbOrTx,
  survivorId: string,
  mergedId: string,
): Promise<boolean> {
  const moved = await tx.execute<{ id: string }>(sql`
    update events s set ticket_url = m.ticket_url, updated_at = now()
    from events m
    where s.id = ${survivorId} and m.id = ${mergedId}
      and s.ticket_url is null and m.ticket_url is not null and m.night_date = s.night_date
    returning s.id
  `);
  if ([...moved].length === 0) return false;
  await copyFacts(tx, survivorId, mergedId, ["ticket_url"], true);
  return true;
}

async function addStyles(tx: DbOrTx, survivorId: string, styles: readonly string[]): Promise<void> {
  await tx.execute(sql`
    update events set styles = array(
      select distinct unnest(styles || ${`{${styles.join(",")}}`}::text[]) order by 1
    ), updated_at = now()
    where id = ${survivorId}
  `);
}

async function copyFacts(
  tx: DbOrTx,
  survivorId: string,
  mergedId: string,
  fields: readonly string[],
  currentOnly: boolean,
): Promise<void> {
  const facts = await tx
    .select()
    .from(fieldProvenance)
    .where(
      and(
        eq(fieldProvenance.entityType, "event"),
        eq(fieldProvenance.entityId, mergedId),
        inArray(fieldProvenance.field, [...fields]),
        ...(currentOnly ? [eq(fieldProvenance.isCurrent, true)] : []),
      ),
    );
  if (facts.length === 0) return;
  await tx
    .insert(fieldProvenance)
    .values(
      facts.map((f) => ({
        ...f,
        id: pipelineId(
          "provenance",
          `${survivorId}:${f.field}:${f.sourceId ?? "none"}:from:${mergedId}`,
        ),
        entityId: survivorId,
        createdAt: new Date(),
      })),
    )
    .onConflictDoNothing();
}

/**
 * For survivors just re-written by their own source, whose upsert follows that source (styles
 * and ticket link): adds back the styles of every listing merged into each one on its night, and
 * the ticket link of the most trusted one when the survivor has none (D-090). The merged rows
 * are still facts another source states, re-read each run. Times have their own refill
 * (`refillTimesFromMerges`); the venue is kept by the upsert.
 */
export async function refillMergedFacts(db: Db, survivorIds: readonly string[]): Promise<number> {
  if (survivorIds.length === 0) return 0;
  const pairs = await db.execute<{ survivor_id: string; merged_id: string }>(sql`
    select m.merged_into_id as survivor_id, m.id as merged_id
    from events m
    join events s on s.id = m.merged_into_id
    where s.id = any(${`{${survivorIds.join(",")}}`}::uuid[])
      and s.status in ('active', 'cancelled')
      and m.status = 'merged' and m.night_date = s.night_date
    order by m.merged_into_id,
      (select min(array_position(${`{${TRUST_ORDER.join(",")}}`}::text[], src.trust_tier::text))
        from sources src where src.id = any(m.source_ids)) asc nulls last,
      m.first_seen_at asc, m.id asc
  `);
  let touched = 0;
  for (const pair of pairs) {
    await db.transaction(async (tx) => {
      const [styles] = await tx.execute<{ added: string[] | null }>(sql`
        select array(select unnest(m.styles) except select unnest(s.styles)) as added
        from events s, events m where s.id = ${pair.survivor_id} and m.id = ${pair.merged_id}
      `);
      const added = styles?.added ?? [];
      if (added.length > 0) await addStyles(tx, pair.survivor_id, added);
      const ticket = await copyTicketFromMerged(tx, pair.survivor_id, pair.merged_id);
      if (added.length > 0 || ticket) touched += 1;
    });
  }
  return touched;
}

export async function recordDecision(
  db: Db,
  a: string,
  b: string,
  score: number,
  decision: "auto_merge" | "queued",
  reasoning: string,
): Promise<void> {
  await db
    .insert(mergeDecisions)
    .values({
      id: pipelineId("merge", `${a}:${b}`),
      eventA: a,
      eventB: b,
      score,
      decision,
      reasoning,
    })
    .onConflictDoUpdate({
      target: mergeDecisions.id,
      set: {
        // A person's or a model's "distinct" stands (D-090): a run never overwrites it.
        // Also, a model's "llm_merge" must not be overwritten by a later "queued".
        score: sql`case when ${mergeDecisions.decision}::text in ('manual_distinct', 'llm_distinct') then ${mergeDecisions.score} when ${mergeDecisions.decision}::text = 'llm_merge' and excluded.decision::text = 'queued' then ${mergeDecisions.score} else excluded.score end`,
        decision: sql`case when ${mergeDecisions.decision}::text in ('manual_distinct', 'llm_distinct') then ${mergeDecisions.decision} when ${mergeDecisions.decision}::text = 'llm_merge' and excluded.decision::text = 'queued' then ${mergeDecisions.decision} else excluded.decision end`,
        reasoning: sql`case when ${mergeDecisions.decision}::text in ('manual_distinct', 'llm_distinct') then ${mergeDecisions.reasoning} when ${mergeDecisions.decision}::text = 'llm_merge' and excluded.decision::text = 'queued' then ${mergeDecisions.reasoning} else excluded.reasoning end`,
        updatedAt: sql`now()`,
      },
    });
}

export async function dedupeMetro(
  db: Db,
  metro: Metro,
  nights: readonly string[],
): Promise<DedupeReport> {
  const released = await releaseCancelledMerges(db, metro.id, nights);
  const shiftedUrls = (METRO_SOURCES[metro.slug] ?? [])
    .filter((s) => s.startTimesShifted)
    .map((s) => s.url);
  const candidates = await findCandidates(db, metro.id, nights, shiftedUrls);
  const linkRows = await findLinkCandidates(db, metro.id, nights);
  const ids = [...new Set([...candidates, ...linkRows].flatMap((c) => [c.a_id, c.b_id]))];
  const sides = await loadSides(db, ids);
  const distinct = await distinctPairs(db, ids);
  const modelMerge = await modelMergePairs(db, ids);
  const report: DedupeReport = {
    ...EMPTY_DEDUPE_REPORT,
    pairs: candidates.length,
    linkPairs: linkRows.length,
    mergedPairs: [],
    released,
  };
  const gone = new Set<string>();
  const titles = await titlesOf(db, ids);

  const apply = async (
    loadedA: DedupeSide,
    loadedB: DedupeSide,
    score: number,
    by: MergedPair["by"],
    reasoning: Record<string, unknown>,
    shiftedId: string | null = null,
  ): Promise<boolean> => {
    if (gone.has(loadedA.id) || gone.has(loadedB.id)) return false;
    // Each side as it stands now: an earlier merge in this run may have given one of them a
    // time (D-060 point 11), and a pair admitted because one start was unknown is judged on
    // the starts they have now.
    const a = sides.get(loadedA.id) ?? loadedA;
    const b = sides.get(loadedB.id) ?? loadedB;
    // A source that prints its times wrong (startTimesShifted, D-146) never wins and never makes a conflict: its times say nothing.
    const isShifted = shiftedId !== null && (shiftedId === a.id || shiftedId === b.id);
    if (!isShifted) {
      if (
        a.startsAt !== null &&
        b.startsAt !== null &&
        Math.abs(a.startsAt.getTime() - b.startsAt.getTime()) > CANDIDATE_START_MINUTES * 60_000
      ) {
        // One title with one listed end: doors vs start (Do-Over, 2026-11-05)
        // or one event page (D-592)
        // or the evening's first times (Super Mario, 2026-11-05)
        if (
          !sameTitleSameEnd(a, b) &&
          !containedTitleSameEnd(a, b) &&
          !sharedEventPage(a, b) &&
          !firstTimesWithin(a, b, CANDIDATE_START_MINUTES) &&
          !oneTitleStartsApart(a, b)
        ) {
          return false;
        }
      }
    }
    let survivor: DedupeSide;
    let merged: DedupeSide;
    if (isShifted) {
      // The shifted side is known wrong, so it should be merged into the other side
      survivor = shiftedId === a.id ? b : a;
      merged = shiftedId === a.id ? a : b;
    } else {
      ({ survivor, merged } = chooseSurvivor(a, b));
    }
    const conflict = isShifted ? false : startsConflict(a, b);
    const record = await merge(db, survivor, merged, conflict);
    if (record.times)
      sides.set(survivor.id, { ...survivor, startsAt: merged.startsAt, times: merged.times });
    gone.add(merged.id);
    report.merged += 1;
    if (by !== "score" && by !== "weekly") report.linked += 1;
    if (conflict) report.conflicting += 1;
    const info = titles.get(survivor.id);
    report.mergedPairs.push({
      night: info?.night ?? "",
      survivor: info?.title ?? survivor.id,
      merged: titles.get(merged.id)?.title ?? merged.id,
      by,
      conflicting: conflict,
    });
    await recordDecision(
      db,
      a.id,
      b.id,
      score,
      "auto_merge",
      JSON.stringify({ ...reasoning, by, merge: record, isShifted }),
    );
    return true;
  };

  // The organizer link first: structure, not wording, pairs these, and the score cannot.
  const linkSides = await loadLinkSides(db, metro, [
    ...new Set(linkRows.flatMap((c) => [c.a_id, c.b_id])),
  ]);
  const linkCandidates: LinkCandidate[] = linkRows.flatMap((c) => {
    const a = linkSides.get(c.a_id);
    const b = linkSides.get(c.b_id);
    return a && b ? [{ a, b, near: Boolean(c.near), titleSimilarity: Number(c.title_sim) }] : [];
  });
  // A pair already called distinct takes no part in the choice, so it cannot make a tie either.
  const open = linkCandidates.filter((c) => !distinct.has(pairKey(c.a.id, c.b.id)));
  for (const pair of pickLinkedPairs(open)) {
    const a = sides.get(pair.a.id);
    const b = sides.get(pair.b.id);
    if (!a || !b) continue;
    // A cancelled listing and another source's live one are both listed (D-090, D-283).
    if ((a.cancelled === true) !== (b.cancelled === true)) continue;
    // The D-006 score is kept beside the link, for tuning.
    const scored = scorePair(a, b, {
      titleSimilarity: pair.titleSimilarity,
      organizerSimilarity: null,
      titlePrefix: false,
    });
    await apply(a, b, scored.score, pair.link, {
      near: pair.near,
      title: pair.titleSimilarity,
      parts: scored.parts,
    });
  }

  // Weekly rule night yields to a dated night at the same venue (D-295) (Ohm Lounge case).
  const ruleToPartners = new Map<string, typeof candidates>();
  for (const c of candidates) {
    if (!c.same_place) continue;
    if (Boolean(c.rule_a) === Boolean(c.rule_b)) continue; // exactly one rule side
    const ruleId = c.rule_a ? c.a_id : c.b_id;
    const a = sides.get(c.a_id);
    const b = sides.get(c.b_id);
    if (!a || !b) continue;
    if (gone.has(a.id) || gone.has(b.id)) continue;
    const key = pairKey(a.id, b.id);
    if (distinct.get(key) === "manual_distinct") continue;
    if (a.cancelled === true || b.cancelled === true) continue;
    // Same listing type required (e.g., dj_night vs live_music_with_dancing must stay separate)
    if (a.listingType !== b.listingType) continue;
    // Check start times if both have them
    if (a.startsAt !== null && b.startsAt !== null) {
      const diffMs = Math.abs(a.startsAt.getTime() - b.startsAt.getTime());
      if (diffMs > CANDIDATE_START_MINUTES * 60_000) continue;
    }
    const list = ruleToPartners.get(ruleId) || [];
    list.push(c);
    ruleToPartners.set(ruleId, list);
  }
  // Process each rule side once, picking the best partner
  for (const partners of ruleToPartners.values()) {
    // Sort partners by: higher title_sim first, then same venue_id, then smaller start difference,
    // then lower dated id.
    partners.sort((ca, cb) => {
      const aSideA = sides.get(ca.a_id);
      const aSideB = sides.get(ca.b_id);
      const bSideA = sides.get(cb.a_id);
      const bSideB = sides.get(cb.b_id);
      if (!aSideA || !aSideB || !bSideA || !bSideB) return 0;
      const aSameVenue = aSideA.venueId !== null && aSideA.venueId === aSideB.venueId;
      const bSameVenue = bSideA.venueId !== null && bSideA.venueId === bSideB.venueId;
      // title_sim descending
      if (ca.title_sim !== cb.title_sim) return cb.title_sim - ca.title_sim;
      // same venue_id first
      if (aSameVenue && !bSameVenue) return -1;
      if (!aSameVenue && bSameVenue) return 1;
      // start difference (if both have starts)
      const datedA = ca.rule_a ? aSideB : aSideA;
      const datedB = cb.rule_a ? bSideB : bSideA;
      const ruleA = ca.rule_a ? aSideA : aSideB;
      const ruleB = cb.rule_a ? bSideA : bSideB;
      const diffA =
        ruleA.startsAt !== null && datedA.startsAt !== null
          ? Math.abs(ruleA.startsAt.getTime() - datedA.startsAt.getTime())
          : Infinity;
      const diffB =
        ruleB.startsAt !== null && datedB.startsAt !== null
          ? Math.abs(ruleB.startsAt.getTime() - datedB.startsAt.getTime())
          : Infinity;
      if (diffA !== diffB) return diffA - diffB;
      // lower dated id
      const datedIdA = ca.rule_a ? ca.b_id : ca.a_id;
      const datedIdB = cb.rule_a ? cb.b_id : cb.a_id;
      return datedIdA.localeCompare(datedIdB);
    });
    const best = partners[0];
    if (!best) continue;
    const a = sides.get(best.a_id);
    const b = sides.get(best.b_id);
    if (!a || !b) continue;
    if (gone.has(a.id) || gone.has(b.id)) continue;
    const rule = best.rule_a ? a : b;
    // Merge rule into dated (dated is survivor)
    await apply(a, b, best.title_sim, "weekly", { weeklyYields: true }, rule.id);
  }

  const scored = candidates
    .map((c) => {
      const a = sides.get(c.a_id);
      const b = sides.get(c.b_id);
      if (!a || !b) return null;
      const shiftedId = c.shifted_a ? a.id : c.shifted_b ? b.id : null;
      return {
        a,
        b,
        shiftedId,
        sameSource: Boolean(c.same_source),
        result: scorePair(a, b, {
          titleSimilarity: Number(c.title_sim),
          organizerSimilarity: c.org_sim === null ? null : Number(c.org_sim),
          titlePrefix: Boolean(c.title_prefix),
          shiftedSource: Boolean(c.shifted_a) || Boolean(c.shifted_b),
          // D-515's prefix start-gap rule needs two sources with nothing in common, merged sources included.
          sameSource: Boolean(c.same_source) || Boolean(c.shared_source),
          samePrimarySource: Boolean(c.same_source),
        }),
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((x, y) => y.result.score - x.result.score);

  for (const { a, b, result, shiftedId, sameSource } of scored) {
    // A pair a merge already joined this run is not decided again.
    if (gone.has(a.id) || gone.has(b.id)) continue;
    const key = pairKey(a.id, b.id);
    const distinctDecision = distinct.get(key);
    // manual_distinct always blocks; llm_distinct blocks unless rules merge outright (auto_merge, or one exact title
    // at one place up to 3 hours apart, D-769: a verdict the model gave before that rule, NOTO 11-12, D-788) and not
    // sameSource.
    if (distinctDecision === "manual_distinct") continue;
    if (
      distinctDecision === "llm_distinct" &&
      !((result.decision === "auto_merge" || oneTitleStartsApart(a, b)) && !sameSource)
    ) {
      continue;
    }
    // One source's two listings merge only as one night it names twice (D-150); otherwise they
    // are two of its listings, neither merged nor queued.
    if (sameSource) {
      // One source's cancelled page beside its live relisting of the night (Skiddle's "Cherry |
      // House & Disco - XOYO", cancelled and listed again as its Halloween edition): the cancelled
      // one is merged into the live one (D-282).
      const relisted =
        a.title &&
        b.title &&
        (oneVenueOneStart(a, b) || cancelledMoved(a, b)) &&
        coreTitlePrefix(a.title, b.title) &&
        (a.cancelled === true) !== (b.cancelled === true);
      if (relisted) {
        const cancelledId = a.cancelled === true ? a.id : b.id;
        await apply(
          a,
          b,
          result.score,
          "score",
          { parts: result.parts, relisted: true },
          cancelledId,
        );
        continue;
      }
      // ...or two titles on one specific event page, one start or both untimed (D-766), or a list-page
      // copy beside the night's own page whose title only adds generic words (D-767).
      // Starts apart (up to 15 minutes) only for a platform's two pages, never a studio's sessions or a class (D-786).
      const nearStartOk =
        a.startsAt?.getTime() === b.startsAt?.getTime() ||
        (a.trust !== "first_party" &&
          b.trust !== "first_party" &&
          a.listingType !== "class" &&
          b.listingType !== "class");
      const namedTwice =
        (a.title &&
          b.title &&
          oneVenueOneStart(a, b) &&
          nearStartOk &&
          coreTitlePrefix(a.title, b.title) &&
          a.cancelled !== true &&
          b.cancelled !== true) ||
        onePageTwice(a, b) ||
        listCopyAndOwnPage(a, b) ||
        sameSourceSubsetTwin(a, b);
      const mergedTwice = namedTwice
        ? await apply(a, b, result.score, "score", { parts: result.parts }, shiftedId)
        : false;
      // A platform's two pages for one night the model called same merge; a first-party source
      // listing two titles is two of its listings, so its model verdicts never act (D-150).
      if (
        !mergedTwice &&
        modelMerge.has(key) &&
        a.trust !== "first_party" &&
        b.trust !== "first_party" &&
        sameKindOfNight(a.listingType ?? "other", b.listingType ?? "other")
      ) {
        await apply(a, b, result.score, "model", { parts: result.parts, model: true }, shiftedId);
      }
      continue;
    }
    // Across sources, a cancelled listing never merges with a live one, by score or by model:
    // both are listed, so the sources' disagreement shows (D-090, D-283).
    if ((a.cancelled === true) !== (b.cancelled === true)) continue;
    if (result.decision === "auto_merge") {
      await apply(a, b, result.score, "score", { parts: result.parts }, shiftedId);
    } else if (oneTitleStartsApart(a, b)) {
      // Two sources' one exact title at one venue, starts up to 3 hours apart: one night (D-769).
      await apply(
        a,
        b,
        result.score,
        "score",
        { parts: result.parts, titleStartsApart: true },
        shiftedId,
      );
    } else if (sameTitleNearVenues(a, b, sameSource)) {
      // Two sources' one exact title at one start at two venue rows within 1.5 km: one night (D-803).
      await apply(
        a,
        b,
        result.score,
        "score",
        { parts: result.parts, nearVenues: true },
        shiftedId,
      );
    } else if (directoryBesideOwn(a, b, sameSource)) {
      // A directory's copy beside the venue's own copy, one venue, starts within 90 minutes: one night (D-817).
      await apply(a, b, result.score, "score", { parts: result.parts }, shiftedId);
    } else if (unplacedTitlePrefix(a, b, sameSource, metro.name)) {
      // Two sources' copies of one night, one or both unplaced, one start, one title heading the other (D-806).
      await apply(
        a,
        b,
        result.score,
        "score",
        { parts: result.parts, unplacedPrefix: true },
        shiftedId,
      );
    } else if (placedBesideBareCopy(a, b, sameSource)) {
      // A copy with no place and no time beside another source's placed, timed copy, one exact title (D-864).
      await apply(a, b, result.score, "score", { parts: result.parts, bareCopy: true }, shiftedId);
    } else if (
      modelMerge.has(key) &&
      sameKindOfNight(a.listingType ?? "other", b.listingType ?? "other")
    ) {
      // The model already said they are the same: merge them now (never a class with a non-class).
      await apply(a, b, result.score, "model", { parts: result.parts, model: true }, shiftedId);
    } else if (result.decision === "queued") {
      report.queued += 1;
      await recordDecision(db, a.id, b.id, result.score, "queued", JSON.stringify(result.parts));
    }
  }

  // Pairs at one venue and one start left standing whose titles share a telling word: the run
  // report names them, so a new kind of duplicate is seen after the run that shows it (D-150).
  // Also, pairs from two sources at one venue and one start with unlike titles are flagged for
  // model review (owner, 2026-10-17).
  const possibleSet = new Set<string>();
  const sameSlotSet = new Set<string>();
  const queuedPossibleKeys = new Set<string>();
  for (const { a, b, sameSource } of scored) {
    if (gone.has(a.id) || gone.has(b.id)) continue;
    const key = pairKey(a.id, b.id);
    if (distinct.has(key)) continue; // any distinct (manual or model) skips possible duplicates
    // A verdict that could never act is not queued: a first-party source's two titles, or a class
    // beside a night that is not one.
    if (sameSource && (a.trust === "first_party" || b.trust === "first_party")) continue;
    if (!sameKindOfNight(a.listingType ?? "other", b.listingType ?? "other")) continue;
    if (!oneVenueOneStart(a, b)) continue;
    if (!a.title || !b.title) continue;
    const wordsA = coreTitleWords(a.title);
    const wordsB = coreTitleWords(b.title);
    const hasNonGeneric = wordsA.some(
      (w) => !GENERIC_TITLE_WORDS.includes(w) && wordsB.includes(w),
    );
    if (hasNonGeneric) {
      const entry = `${a.title} | ${b.title}`;
      possibleSet.add(entry);
      if (!queuedPossibleKeys.has(key)) {
        queuedPossibleKeys.add(key);
        // Record as queued for the model review, even beyond the 25-line cap.
        await recordDecision(db, a.id, b.id, 0.5, "queued", JSON.stringify({ possible: true }));
      }
    } else if (!sameSource && a.cancelled !== true && b.cancelled !== true) {
      // Two different sources, same venue and start, titles share no non-generic word
      const entry = `${a.title} | ${b.title}`;
      sameSlotSet.add(entry);
      if (!queuedPossibleKeys.has(key)) {
        queuedPossibleKeys.add(key);
        await recordDecision(db, a.id, b.id, 0.5, "queued", JSON.stringify({ sameSlot: true }));
      }
    }
  }
  report.possible = Array.from(possibleSet).sort().slice(0, 25);
  report.sameSlot = Array.from(sameSlotSet).sort().slice(0, 25);
  // The report names merges by night, then title: the link pairs come back in whatever order the
  // database returns their rows, which differs between runs (a test caught it on 2026-10-05).
  report.mergedPairs.sort(
    (x, y) =>
      x.night.localeCompare(y.night) ||
      x.survivor.localeCompare(y.survivor) ||
      x.merged.localeCompare(y.merged),
  );
  return report;
}

/**
 * A merged listing its own source now cancels, merged into one that is not cancelled: the merge is
 * undone, so the cancellation shows beside the other source's listing rather than behind it
 * (D-090). The pair is then recorded as distinct, like any undone merge.
 * Not when both are one source's (D-282): its cancelled page beside its own relisting is one night.
 * So is a live listing merged into another source's cancelled one (D-283).
 */
async function releaseCancelledMerges(
  db: Db,
  metroId: string,
  nights: readonly string[],
): Promise<string[]> {
  if (nights.length === 0) return [];
  const rows = await db.execute<{ id: string; title: string; night: string }>(sql`
    select m.id, m.title, m.night_date::text as night from events m
    join events s on s.id = m.merged_into_id
    where m.metro_id = ${metroId} and m.status = 'merged'
      and (
        (m.confirmation = 'cancelled' and s.status = 'active' and s.confirmation <> 'cancelled')
        or (m.confirmation <> 'cancelled' and s.status in ('active', 'cancelled')
          and s.confirmation = 'cancelled')
      )
      and m.night_date = any(${`{${nights.join(",")}}`}::date[])
      and not exists (
        select 1 from event_sources x
        join event_sources y on y.source_id = x.source_id
        where x.event_id = m.id and y.event_id = s.id
          and x.role = 'primary' and y.role = 'primary'
      )
    order by m.night_date, m.title, m.id
  `);
  const released: string[] = [];
  for (const row of rows) {
    if (await unmergePair(db, row.id)) released.push(`${row.night} ${row.title}`);
  }
  return released;
}

async function titlesOf(
  db: Db,
  ids: readonly string[],
): Promise<Map<string, { title: string; night: string }>> {
  if (ids.length === 0) return new Map();
  const rows = await db.execute<{ id: string; title: string; night: string }>(sql`
    select id, title, night_date::text as night from events
    where id = any(${`{${ids.join(",")}}`}::uuid[])
  `);
  return new Map([...rows].map((r) => [r.id, { title: r.title, night: r.night }]));
}

// ---------------------------------------------------------------------------------------------
// Undo (D-090): every merge is reversible.

export interface UnmergeResult {
  survivorId: string;
  mergedId: string;
  /** What was put back, in words, for the person running it. */
  restored: string[];
}

/**
 * Undoes one merge: the merged listing is listed again (cancelled if its source cancelled it),
 * listings re-pointed through it point at it again, and the survivor gives back what came from it:
 * its source links and the provenance copied from it, and each fact only its merged listings gave
 * (times, venue, ticket link, styles, the conflicting mark), which is then filled again from the
 * listings still merged into the survivor. A fact the survivor's own source states stays. The pair
 * is recorded as `manual_distinct`, which no later run overwrites or merges across. Takes the
 * merged listing's id; returns null when that listing is not merged into another.
 */
export async function unmergePair(db: Db, mergedId: string): Promise<UnmergeResult | null> {
  const result = await db.transaction(async (tx) => {
    const [row] = await tx.execute<{ merged_into_id: string }>(sql`
      select merged_into_id from events where id = ${mergedId} and status = 'merged'
        and merged_into_id is not null
    `);
    if (!row) return null;
    const survivorId = row.merged_into_id;
    const [decision] = await tx.execute<{ id: string; reasoning: string | null }>(sql`
      select id, reasoning from merge_decisions
      where decision = 'auto_merge'
        and ((event_a = ${mergedId} and event_b = ${survivorId})
          or (event_a = ${survivorId} and event_b = ${mergedId}))
      limit 1
    `);
    let record: Partial<MergeRecord> = {};
    try {
      record = (JSON.parse(decision?.reasoning ?? "{}") as { merge?: MergeRecord }).merge ?? {};
    } catch {
      record = {};
    }
    const restored: string[] = [];
    const leaving = [mergedId, ...(record.repointed ?? [])];
    const leavingList = `{${leaving.join(",")}}`;

    // 1. The merged listing (and those re-pointed through it) leave the survivor.
    await tx.execute(sql`
      update events set status = case when confirmation = 'cancelled' then 'cancelled'::event_status
        else 'active'::event_status end, merged_into_id = null, updated_at = now()
      where id = ${mergedId}
    `);
    if (record.repointed && record.repointed.length > 0) {
      await tx.execute(sql`
        update events set merged_into_id = ${mergedId}
        where id = any(${`{${record.repointed.join(",")}}`}::uuid[])
          and status = 'merged' and merged_into_id = ${survivorId}
      `);
    }

    // 2. Their source links and the provenance copied from them, row by row: another listing of
    // the same source still merged into the survivor keeps its own.
    const links = await tx.execute(sql`
      delete from event_sources s
      using event_sources m
      where s.event_id = ${survivorId} and s.role = 'secondary'
        and m.event_id = any(${leavingList}::uuid[])
        and s.source_id = m.source_id and s.source_url = m.source_url
        and not exists (
          select 1 from event_sources k join events r on r.id = k.event_id
          where r.merged_into_id = ${survivorId} and r.status = 'merged'
            and k.source_id = s.source_id and k.source_url = s.source_url
        )
      returning s.id
    `);
    if ([...links].length > 0) restored.push("sources");
    await tx.execute(sql`
      update events s set source_ids = array(
        select distinct x from unnest(s.source_ids) x
        where exists (select 1 from event_sources k where k.event_id = s.id and k.source_id = x)
      ) where s.id = ${survivorId}
    `);
    const copied = await tx
      .select({
        field: fieldProvenance.field,
        sourceId: fieldProvenance.sourceId,
        entityId: fieldProvenance.entityId,
      })
      .from(fieldProvenance)
      .where(
        and(eq(fieldProvenance.entityType, "event"), inArray(fieldProvenance.entityId, leaving)),
      );
    const copiedIds = copied.map((f) =>
      pipelineId(
        "provenance",
        `${survivorId}:${f.field}:${f.sourceId ?? "none"}:from:${f.entityId}`,
      ),
    );
    if (copiedIds.length > 0) {
      await tx.delete(fieldProvenance).where(inArray(fieldProvenance.id, copiedIds));
    }

    // 3. Each fact the survivor shows only because a merged listing gave it goes back.
    const own = new Set(
      [
        ...(await tx.execute<{ field: string }>(sql`
          select distinct p.field from field_provenance p
          where p.entity_type = 'event' and p.entity_id = ${survivorId} and p.is_current
            and p.source_id in (select source_id from event_sources
              where event_id = ${survivorId} and role = 'primary')
        `)),
      ].map((r) => r.field),
    );
    if (!["doors_at", "lesson_at", "dancing_at"].some((f) => own.has(f))) {
      await tx.execute(sql`
        update events set doors_at = null, lesson_at = null, dancing_at = null,
          ends_at = ${own.has("ends_at") ? sql`ends_at` : sql`${record.priorEndsAt ?? null}::timestamptz`}
        where id = ${survivorId} and (doors_at is not null or lesson_at is not null or dancing_at is not null)
      `);
      if (record.times) restored.push("times");
    }
    if (record.venue && !own.has("venue_name") && !own.has("venue_address")) {
      await tx.execute(sql`
        update events set venue_id = null,
          geo = ${record.priorGeo ?? null}::geometry::geography
        where id = ${survivorId}
      `);
      restored.push("venue");
    }
    if (!own.has("ticket_url")) {
      await tx.execute(sql`update events set ticket_url = null where id = ${survivorId}`);
      if (record.ticket) restored.push("ticket link");
    }
    if (record.stylesAdded && record.stylesAdded.length > 0) {
      const [stated] = await tx.execute<{ styles: string[] | null }>(sql`
        select array(select distinct jsonb_array_elements_text(p.value) from field_provenance p
          where p.entity_type = 'event' and p.entity_id = ${survivorId} and p.is_current
            and p.field = 'styles' and jsonb_typeof(p.value) = 'array'
            and p.source_id in (select source_id from event_sources
              where event_id = ${survivorId} and role = 'primary')) as styles
      `);
      const keep = new Set(stated?.styles ?? []);
      const drop = record.stylesAdded.filter((st) => !keep.has(st));
      if (drop.length > 0) {
        await tx.execute(sql`
          update events set styles = array(
            select unnest(styles) except select unnest(${`{${drop.join(",")}}`}::text[]) order by 1
          ) where id = ${survivorId}
        `);
        restored.push(`styles (${drop.join(", ")})`);
      }
    }
    if (record.priorConfirmation) {
      await tx.execute(sql`
        update events set confirmation = ${record.priorConfirmation}::confirmation
        where id = ${survivorId} and confirmation = 'conflicting'
          and not exists (select 1 from events r where r.merged_into_id = ${survivorId}
            and r.status = 'merged')
      `);
      restored.push("confirmation");
    }
    await tx
      .insert(mergeDecisions)
      .values({
        id: decision?.id ?? pipelineId("merge", `${survivorId}:${mergedId}`),
        eventA: survivorId,
        eventB: mergedId,
        score: 0,
        decision: "manual_distinct",
        reasoning: JSON.stringify({ unmerged: record }),
      })
      .onConflictDoUpdate({
        target: mergeDecisions.id,
        set: {
          decision: sql`excluded.decision`,
          reasoning: sql`excluded.reasoning`,
          updatedAt: sql`now()`,
        },
      });
    return { survivorId, mergedId, restored };
  });
  if (result) {
    // What the listings still merged into the survivor give, it takes again.
    await refillTimesFromMerges(db, [result.survivorId]);
    await refillMergedFacts(db, [result.survivorId]);
  }
  return result;
}
