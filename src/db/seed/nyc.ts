// The New York seed, built for a given "now" (D-011): weekly and monthly series materialise
// through src/domain/recurrence.ts for the next 14 nights, one-offs are day offsets from
// tonight, and venue open nights come from venue hours. Ids are deterministic (UUID v5 of the
// slug), so `pnpm db:seed` upserts instead of duplicating; times are UTC instants with the
// metro zone beside them (D-003); night dates come from src/domain/tonight.ts (D-004).
// One-offs are keyed `oneoff:<slug>` without the night, so the same id carries a slug whose
// date part moves with "now": a one-off's slug, and so its detail URL, is not stable from one
// day to the next in mock mode (that is the relative-date design of D-011, not a bug).
// A one-off may give its night and no time (D-060): doors, lesson and dancing stay null, the
// night is stored as given, and no start, default length or start provenance is invented.

import { normalizeForMatch } from "@/config/styles";
import type { NewEvent } from "@/src/db/schema/events";
import type { NewMetro } from "@/src/db/schema/metros";
import type { organizers } from "@/src/db/schema/organizers";
import type { eventSources, fieldProvenance } from "@/src/db/schema/provenance";
import type { NewSeries, Price, SeriesDefaults } from "@/src/db/schema/series";
import type { NewSource } from "@/src/db/schema/sources";
import type { NewVenue } from "@/src/db/schema/venues";
import { seedId } from "@/src/db/seed/ids";
import {
  NYC_METRO,
  NYC_TZ,
  ONE_OFFS,
  ORGANIZERS,
  SERIES,
  SOURCES,
  VENUES,
  type ListingFacts,
  type OneOffDef,
  type SeriesDef,
  type SeriesRule,
  type VenueDef,
} from "@/src/db/seed/nyc-data";
import { MATERIALIZE_DAYS, materialize, parseRule, type Weekday } from "@/src/domain/recurrence";
import { HOUR_MS, MINUTE_MS, addCalendarDays, localInstant } from "@/src/domain/time";
import {
  currentNightDate,
  nightDate as nightDateOf,
  startsAt as startsAtOf,
  type ListingStarts,
  type NightDate,
} from "@/src/domain/tonight";

export { MATERIALIZE_DAYS };

export type NewOrganizer = typeof organizers.$inferInsert;
export type NewEventSource = typeof eventSources.$inferInsert;
export type NewFieldProvenance = typeof fieldProvenance.$inferInsert;

/** Seed rows always carry the columns the mock repository reads, so it need not default them. */
export type SeedVenue = NewVenue &
  Required<
    Pick<
      NewVenue,
      "id" | "kind" | "danceFloor" | "address" | "neighborhood" | "hours" | "websiteUrl"
    >
  >;
export type SeedOrganizer = NewOrganizer &
  Required<
    Pick<
      NewOrganizer,
      "id" | "styles" | "websiteUrl" | "facebookUrl" | "instagramUrl" | "otherUrls"
    >
  >;
export type SeedSource = NewSource & Required<Pick<NewSource, "id">>;
export type SeedSeries = NewSeries & Required<Pick<NewSeries, "id" | "styles">>;
export type SeedEvent = NewEvent &
  Required<
    Pick<
      NewEvent,
      | "id"
      | "styles"
      | "doorsAt"
      | "lessonAt"
      | "dancingAt"
      | "endsAt"
      | "geo"
      | "prices"
      | "isFree"
      | "ticketUrl"
      | "level"
      | "partnerRequired"
      | "ageMin"
      | "dressCode"
      | "floor"
      | "indoorOutdoor"
      | "music"
      | "crowdSizeHint"
      | "venueId"
      | "organizerId"
      | "seriesId"
      | "metroId"
      | "summary"
      | "confidence"
      | "sourceIds"
      | "status"
      | "canonicalUrl"
      | "lastVerifiedAt"
    >
  >;
export type SeedEventSource = NewEventSource & Required<Pick<NewEventSource, "id" | "lastSeenAt">>;
export type SeedProvenance = NewFieldProvenance & Required<Pick<NewFieldProvenance, "id">>;

export interface NycSeed {
  now: Date;
  /** Tonight's night date in the metro zone; the 14-night window starts here. */
  tonight: NightDate;
  metro: NewMetro & { id: string };
  venues: SeedVenue[];
  organizers: SeedOrganizer[];
  sources: SeedSource[];
  series: SeedSeries[];
  events: SeedEvent[];
  eventSources: SeedEventSource[];
  provenance: SeedProvenance[];
}

export const NYC_METRO_ID = seedId("metro", NYC_METRO.slug);

/** Dates in January 2026 for each weekday (2026-01-01 was a Thursday): DTSTART anchors. */
const JAN_2026_FIRST: Record<Weekday, number> = { TH: 1, FR: 2, SA: 3, SU: 4, MO: 5, TU: 6, WE: 7 };

function anchorDate(weekday: Weekday, ordinal: 1 | 2 | 3 | 4 | -1 = 1): string {
  const first = JAN_2026_FIRST[weekday];
  let day: number;
  if (ordinal === -1) {
    day = first;
    while (day + 7 <= 31) day += 7;
  } else day = first + 7 * (ordinal - 1);
  return `2026-01-${String(day).padStart(2, "0")}`;
}

/** The stored "DTSTART;TZID=...\nRRULE:..." string for a seed rule (D-005). */
export function ruleToRrule(rule: SeriesRule, tz: string = NYC_TZ): string {
  switch (rule.kind) {
    case "weekly": {
      const interval = rule.interval && rule.interval > 1 ? `;INTERVAL=${rule.interval}` : "";
      return parseRule(
        `FREQ=WEEKLY;BYDAY=${rule.weekday}${interval}`,
        `${anchorDate(rule.weekday)}T${rule.time}:00`,
        tz,
      ).rruleString;
    }
    case "monthly":
      return parseRule(
        `FREQ=MONTHLY;BYDAY=${rule.ordinal}${rule.weekday}`,
        `${anchorDate(rule.weekday, rule.ordinal)}T${rule.time}:00`,
        tz,
      ).rruleString;
    case "seasonal":
      return parseRule(
        `FREQ=WEEKLY;BYDAY=${rule.weekdays.join(",")};BYMONTH=${rule.months.join(",")}`,
        `${rule.dtstartDate}T${rule.time}:00`,
        tz,
      ).rruleString;
  }
}

function parseHm(time: string): { hours: number; minutes: number } {
  const [h, m] = time.split(":");
  return { hours: Number(h), minutes: Number(m) };
}

/** ISO weekday (1 = Monday ... 7 = Sunday) of a calendar date. */
export function isoWeekday(date: NightDate): 1 | 2 | 3 | 4 | 5 | 6 | 7 {
  const day = new Date(Date.parse(`${date}T00:00:00Z`)).getUTCDay();
  return (day === 0 ? 7 : day) as 1 | 2 | 3 | 4 | 5 | 6 | 7;
}

/** A wall-clock time on a night: times before 06:00 belong to the small hours of that night. */
function nightInstant(night: NightDate, time: string, tz: string): Date {
  const { hours, minutes } = parseHm(time);
  const date = hours < 6 ? addCalendarDays(night, 1) : night;
  return localInstant(date, tz, hours, minutes);
}

function offset(base: Date, minutes: number | null | undefined): Date | null {
  return minutes === null || minutes === undefined
    ? null
    : new Date(base.getTime() + minutes * MINUTE_MS);
}

/**
 * The three start-ish instants for a listing type, from its main start and its offsets. With no
 * main start (the source lists no time, D-060) all three are null: an offset from nothing is
 * nothing.
 */
function timesFor(
  listingType: ListingFacts["listingType"],
  main: Date | null,
  facts: Pick<ListingFacts, "lessonOffsetMin" | "doorsOffsetMin">,
): ListingStarts {
  if (main === null) return { doorsAt: null, lessonAt: null, dancingAt: null };
  if (listingType === "class") {
    return { doorsAt: offset(main, facts.doorsOffsetMin), lessonAt: main, dancingAt: null };
  }
  if (listingType === "venue_open_night") return { doorsAt: main, lessonAt: null, dancingAt: null };
  return {
    doorsAt: offset(main, facts.doorsOffsetMin),
    lessonAt: offset(main, facts.lessonOffsetMin),
    dancingAt: main,
  };
}

function seriesDefaults(def: SeriesDef): SeriesDefaults {
  return {
    lessonOffsetMinutes: def.lessonOffsetMin ?? null,
    durationMinutes: def.durationMin,
    prices: def.prices,
    isFree: def.isFree,
    level: def.level ?? null,
    partnerRequired: def.partnerRequired ?? null,
    ageMin: def.ageMin ?? null,
    ticketUrl: def.ticketUrl ?? null,
    summary: def.summary,
  };
}

const START_FIELD: Record<string, "doorsAt" | "lessonAt" | "dancingAt"> = {
  class: "lessonAt",
  venue_open_night: "doorsAt",
};

interface Ctx {
  now: Date;
  tonight: NightDate;
  venueById: Map<string, SeedVenue>;
  venueIdBySlug: Map<string, string>;
  organizerIdBySlug: Map<string, string>;
  sourceBySlug: Map<string, SeedSource>;
  events: SeedEvent[];
  eventSources: SeedEventSource[];
  provenance: SeedProvenance[];
  /** "venueSlug:nightDate" for every dated listing, so open nights fill only empty nights. */
  busy: Set<string>;
}

/**
 * Either a main start, whose night follows from it (D-004), or no start and the night as a fact
 * of its own: the source gave a date and no time (D-060).
 */
type EventStart = { main: Date; night?: undefined } | { main: null; night: NightDate };

type EventInput = EventStart & {
  key: string;
  slug: string;
  facts: ListingFacts;
  /** Null for a listing whose source names no place (D-082). */
  venueSlug: string | null;
  endsAt: Date | null;
  seriesId: string | null;
  confirmation: NewEvent["confirmation"];
  /** Per-source end instants when sources disagree (the primary's is the stored one). */
  endBySource?: Record<string, Date | null>;
};

function checkedAt(ctx: Ctx, primary: boolean, confirmedToday: boolean): Date {
  if (primary && confirmedToday) return new Date(ctx.now.getTime() - 2 * HOUR_MS);
  if (primary) return new Date(ctx.now.getTime() - 26 * HOUR_MS);
  return new Date(ctx.now.getTime() - 3 * 24 * HOUR_MS);
}

function pushEvent(ctx: Ctx, input: EventInput): SeedEvent {
  const { facts } = input;
  const venue =
    input.venueSlug === null
      ? null
      : ctx.venueById.get(ctx.venueIdBySlug.get(input.venueSlug) ?? "");
  if (venue === undefined)
    throw new Error(`Seed listing ${input.slug} names an unknown venue ${input.venueSlug}`);
  const times = timesFor(facts.listingType, input.main, facts);
  const startsAt = startsAtOf(times);
  if (input.main !== null && !startsAt) throw new Error(`Seed listing ${input.slug} has no start`);
  // A listed start fixes the night (D-004); a listing with no time carries its night as given.
  const night = startsAt ? nightDateOf(startsAt, NYC_TZ) : input.night;
  if (night === undefined) throw new Error(`Seed listing ${input.slug} has no start and no night`);
  const id = seedId("event", input.key);
  const sourceRows = facts.sources.map((slug) => {
    const source = ctx.sourceBySlug.get(slug);
    if (!source) throw new Error(`Seed listing ${input.slug} names an unknown source ${slug}`);
    return source;
  });
  for (const slug of Object.keys(facts.eventUrls ?? {})) {
    if (!facts.sources.includes(slug)) {
      throw new Error(`Seed listing ${input.slug} has an event page for ${slug}, not its source`);
    }
  }
  const primary = sourceRows[0];
  if (!primary) throw new Error(`Seed listing ${input.slug} has no source`);
  const confirmedToday = input.confirmation === "confirmed_today";
  const organizerId = facts.organizer ? (ctx.organizerIdBySlug.get(facts.organizer) ?? null) : null;
  if (facts.organizer && organizerId === null) {
    throw new Error(`Seed listing ${input.slug} names an unknown organizer ${facts.organizer}`);
  }

  const event: SeedEvent = {
    id,
    slug: `${input.slug}-${night}`,
    title: facts.title,
    titleNormalized: normalizeForMatch(facts.title),
    listingType: facts.listingType,
    styles: [...facts.styles],
    doorsAt: times.doorsAt,
    lessonAt: times.lessonAt,
    dancingAt: times.dancingAt,
    endsAt: input.endsAt,
    nightDate: night,
    tz: NYC_TZ,
    geo: venue?.location ?? null,
    prices: facts.prices,
    isFree: facts.isFree,
    ticketUrl: facts.ticketUrl ?? null,
    level: facts.level ?? null,
    partnerRequired: facts.partnerRequired ?? null,
    ageMin: facts.ageMin ?? null,
    dressCode: facts.dressCode ?? null,
    floor: facts.floor ?? null,
    indoorOutdoor: facts.indoorOutdoor ?? null,
    music: facts.music ?? null,
    crowdSizeHint: facts.crowdSizeHint ?? null,
    venueId: venue?.id ?? null,
    organizerId,
    seriesId: input.seriesId,
    metroId: NYC_METRO_ID,
    summary: facts.summary,
    confirmation: input.confirmation,
    confidence: facts.confidence,
    sourceIds: sourceRows.map((s) => s.id),
    firstSeenAt: new Date(ctx.now.getTime() - 30 * 24 * HOUR_MS),
    lastVerifiedAt: checkedAt(ctx, true, confirmedToday),
    status: "active",
    // The page it was read from, as the production store falls back to (store.ts): the event's
    // own page is each source row's eventUrl (D-073), never this.
    canonicalUrl: primary.url,
    image: null,
  };
  ctx.events.push(event);
  if (input.venueSlug !== null) ctx.busy.add(`${input.venueSlug}:${night}`);

  const startField = START_FIELD[facts.listingType] ?? "dancingAt";
  const provenanceFor = (
    source: SeedSource,
    field: string,
    value: unknown,
    fetchedAt: Date,
    conflictsWith: string | null = null,
  ): SeedProvenance => ({
    id: seedId("provenance", `${input.key}:${field}:${source.id}`),
    entityType: "event",
    entityId: id,
    field,
    value,
    sourceId: source.id,
    sourceUrl: source.url,
    fetchedAt,
    evidence: facts.evidence?.[field] ?? `Seed note: ${facts.title}, ${field}`,
    method: "manual",
    model: null,
    confidence: facts.confidence,
    isCurrent: true,
    conflictsWith,
  });

  sourceRows.forEach((source, index) => {
    const isPrimary = index === 0;
    const seenAt = checkedAt(ctx, isPrimary, confirmedToday);
    ctx.eventSources.push({
      id: seedId("event_source", `${input.key}:${source.id}`),
      eventId: id,
      sourceId: source.id,
      sourceUrl: source.url,
      // This source's own page for the event, when it has one; null when it only lists the night.
      eventUrl: facts.eventUrls?.[facts.sources[index] ?? ""] ?? null,
      rawDocumentId: null,
      role: isPrimary ? "primary" : "secondary",
      firstSeenAt: event.firstSeenAt,
      lastSeenAt: seenAt,
    });
    if (isPrimary) {
      ctx.provenance.push(provenanceFor(source, "title", facts.title, seenAt));
      // Every listing's night is a fact with a source (D-060); for one with no time it is the
      // only date fact, and it has no start row because the source gives no start.
      ctx.provenance.push(provenanceFor(source, "nightDate", night, seenAt));
      if (startsAt) {
        ctx.provenance.push(provenanceFor(source, startField, startsAt.toISOString(), seenAt));
      }
      if (facts.prices.length > 0) {
        ctx.provenance.push(provenanceFor(source, "prices", facts.prices, seenAt));
      }
    }
    const ownEnd = input.endBySource ? input.endBySource[source.id] : undefined;
    const end = ownEnd !== undefined ? ownEnd : isPrimary ? input.endsAt : undefined;
    if (end !== undefined && end !== null) {
      const primaryRowId = isPrimary
        ? null
        : seedId("provenance", `${input.key}:endsAt:${primary.id}`);
      ctx.provenance.push(provenanceFor(source, "endsAt", end.toISOString(), seenAt, primaryRowId));
    }
  });

  return event;
}

function buildVenue(def: VenueDef, now: Date): SeedVenue {
  return {
    id: seedId("venue", def.slug),
    name: def.name,
    nameNormalized: normalizeForMatch(def.name),
    location: { lng: def.lng, lat: def.lat },
    address: {
      line1: def.line1,
      line2: null,
      locality: def.locality,
      region: def.region,
      postcode: def.postcode,
      countryCode: "US",
      formatted: `${def.line1}, ${def.locality}, ${def.region} ${def.postcode}`,
    },
    neighborhood: def.neighborhood,
    tz: NYC_TZ,
    overtureId: null,
    seedProvider: "dancetonight-seed",
    seedLicence: null,
    seedRecordId: def.slug,
    googlePlaceId: null,
    websiteUrl: def.websiteUrl,
    socials: null,
    kind: def.kind,
    danceFloor: def.danceFloor,
    hours: def.hours ?? null,
    hoursFetchedAt: def.hours ? new Date(now.getTime() - 7 * 24 * HOUR_MS) : null,
    photo: null,
    classifiedFromUrl: def.websiteUrl,
    classificationConfidence: def.danceFloor === "unknown" ? 0.4 : 0.9,
    metroId: NYC_METRO_ID,
    blocklisted: false,
  };
}

function buildSeriesRows(ctx: Ctx, def: SeriesDef): SeedSeries {
  const id = seedId("series", def.slug);
  const organizerId = def.organizer ? (ctx.organizerIdBySlug.get(def.organizer) ?? null) : null;
  const venueId = ctx.venueIdBySlug.get(def.venue) ?? null;
  const rrule = ruleToRrule(def.rule);
  const row: SeedSeries = {
    id,
    title: def.title,
    organizerId,
    venueId,
    metroId: NYC_METRO_ID,
    rrule,
    tz: NYC_TZ,
    listingType: def.listingType,
    styles: [...def.styles],
    defaults: seriesDefaults(def),
    active: true,
    lastConfirmedAt: def.confirmsDaily ? new Date(ctx.now.getTime() - 2 * HOUR_MS) : null,
    confidence: def.confidence,
  };

  const occurrences = materialize(
    { rrule, tz: NYC_TZ, durationMinutes: def.durationMin ?? null, venueId },
    ctx.tonight,
    MATERIALIZE_DAYS,
    NYC_TZ,
    { nightDate: (t, zone) => nightDateOf(t, zone) },
  );
  for (const occurrence of occurrences) {
    const isTonight = occurrence.nightDate === ctx.tonight;
    let confirmation: NewEvent["confirmation"] = "recurring_unconfirmed";
    if (def.conflictingEnd) confirmation = "conflicting";
    else if (def.confirmsDaily && isTonight) confirmation = "confirmed_today";

    let endBySource: Record<string, Date | null> | undefined;
    if (def.conflictingEnd) {
      endBySource = {};
      for (const [slug, minutes] of Object.entries(def.conflictingEnd)) {
        const source = ctx.sourceBySlug.get(slug);
        if (!source)
          throw new Error(`Series ${def.slug} conflictingEnd names unknown source ${slug}`);
        endBySource[source.id] = new Date(occurrence.startsAt.getTime() + minutes * MINUTE_MS);
      }
    }
    const primarySlug = def.sources[0];
    const primaryEnd =
      def.conflictingEnd && primarySlug && def.conflictingEnd[primarySlug] !== undefined
        ? new Date(occurrence.startsAt.getTime() + def.conflictingEnd[primarySlug] * MINUTE_MS)
        : occurrence.endsAt;

    pushEvent(ctx, {
      key: `${def.slug}:${occurrence.nightDate}`,
      slug: def.slug,
      facts: def,
      venueSlug: def.venue,
      main: occurrence.startsAt,
      endsAt: primaryEnd,
      seriesId: id,
      confirmation,
      endBySource,
    });
  }
  return row;
}

function buildOneOff(ctx: Ctx, def: OneOffDef): void {
  const night = addCalendarDays(ctx.tonight, def.daysFromNow);
  const common = {
    key: `oneoff:${def.slug}`,
    slug: def.slug,
    facts: def,
    venueSlug: def.venue,
    seriesId: null,
    confirmation: def.confirmation,
  };
  if (def.time === null) {
    // A date and no time (D-060): the night is the one-off's own night, and an end is stored only
    // when the source lists one; nothing is measured from an assumed start.
    pushEvent(ctx, {
      ...common,
      main: null,
      night,
      endsAt: def.endTime === null ? null : nightInstant(night, def.endTime, NYC_TZ),
    });
    return;
  }
  const main = nightInstant(night, def.time, NYC_TZ);
  pushEvent(ctx, {
    ...common,
    main,
    endsAt:
      def.durationMin === null ? null : new Date(main.getTime() + def.durationMin * MINUTE_MS),
  });
}

/** venue_open_night rows from hours, for nights with no dated listing at the venue (SPEC section 3). */
function buildOpenNights(ctx: Ctx, def: VenueDef): void {
  if (!def.hours || !def.openNight) return;
  const open = def.openNight;
  for (let i = 0; i < MATERIALIZE_DAYS; i++) {
    const night = addCalendarDays(ctx.tonight, i);
    if (ctx.busy.has(`${def.slug}:${night}`)) continue;
    const intervals = def.hours.weekly[String(isoWeekday(night)) as keyof typeof def.hours.weekly];
    const interval = intervals?.[0];
    if (!interval) continue;
    const opensAt = nightInstant(night, interval.open, NYC_TZ);
    const close = parseHm(interval.close);
    const closeDate =
      close.hours < 6 || interval.close <= interval.open ? addCalendarDays(night, 1) : night;
    const closesAt = localInstant(closeDate, NYC_TZ, close.hours, close.minutes);
    const isTonight = night === ctx.tonight;
    const facts: ListingFacts = {
      title: `Open night at ${def.name}`,
      listingType: "venue_open_night",
      styles: open.styles,
      organizer: null,
      venue: def.slug,
      durationMin: Math.round((closesAt.getTime() - opensAt.getTime()) / MINUTE_MS),
      prices: open.prices,
      isFree: open.isFree,
      ageMin: open.ageMin,
      partnerRequired: false,
      summary: open.summary,
      sources: [open.source],
      confidence: def.danceFloor === "yes" ? 0.7 : 0.4,
      evidence: {
        title: `Open ${interval.open} to ${interval.close} on this weekday per the venue's hours`,
        doorsAt: `Opening time ${interval.open} from the venue's listed hours`,
        endsAt: `Closing time ${interval.close} from the venue's listed hours`,
      },
    };
    pushEvent(ctx, {
      key: `open:${def.slug}:${night}`,
      slug: `${def.slug}-open`,
      facts,
      venueSlug: def.slug,
      main: opensAt,
      endsAt: closesAt,
      seriesId: null,
      confirmation: open.cancelledTonight && isTonight ? "cancelled" : "recurring_unconfirmed",
    });
  }
}

/** Build every seed row for the 14 nights starting at night_date(now). Pure and deterministic. */
/**
 * One night a second source listed too, already merged into the first (D-092): never listed, but
 * its old address must take a dancer to the listing that stands, in mock mode as in production.
 * Its slug is `listed-twice-<tonight>`, beside tonight's first timed listing.
 */
export function mergedDuplicateSlug(tonight: string): string {
  return `listed-twice-${tonight}`;
}

function addMergedDuplicate(ctx: Ctx): void {
  const survivor = ctx.events
    .filter((e) => e.nightDate === ctx.tonight && startsAtOf(e) !== null)
    .sort((a, b) => (startsAtOf(a)?.getTime() ?? 0) - (startsAtOf(b)?.getTime() ?? 0))[0];
  if (!survivor) return;
  const id = seedId("event", "merged:listed-twice");
  ctx.events.push({
    ...survivor,
    id,
    slug: mergedDuplicateSlug(ctx.tonight),
    status: "merged",
    mergedIntoId: survivor.id,
  });
  // Its own source links and facts, as a second source's row has them.
  for (const es of ctx.eventSources.filter((x) => x.eventId === survivor.id)) {
    ctx.eventSources.push({ ...es, id: seedId("event_source", `${id}:${es.id}`), eventId: id });
  }
  for (const p of ctx.provenance.filter((x) => x.entityId === survivor.id)) {
    ctx.provenance.push({ ...p, id: seedId("provenance", `${id}:${p.id}`), entityId: id });
  }
}

export function seedNyc(now: Date): NycSeed {
  const tonight = currentNightDate(now, NYC_TZ);

  const metro: NycSeed["metro"] = {
    id: NYC_METRO_ID,
    slug: NYC_METRO.slug,
    name: NYC_METRO.name,
    countryCode: NYC_METRO.countryCode,
    center: { lng: NYC_METRO.center.lng, lat: NYC_METRO.center.lat },
    radiusKm: NYC_METRO.radiusKm,
    tz: NYC_METRO.tz,
    languages: [...NYC_METRO.languages],
    geonamesId: 5128581,
    population: 8804190,
    status: "active",
    adHoc: false,
  };

  const venues = VENUES.map((v) => buildVenue(v, now));
  const venueById = new Map(venues.map((v) => [v.id, v]));
  const venueIdBySlug = new Map(VENUES.map((v) => [v.slug, seedId("venue", v.slug)]));

  const organizers: SeedOrganizer[] = ORGANIZERS.map((o) => ({
    id: seedId("organizer", o.slug),
    name: o.name,
    nameNormalized: normalizeForMatch(o.name),
    websiteUrl: o.websiteUrl,
    facebookUrl: o.facebookUrl ?? null,
    instagramUrl: o.instagramUrl ?? null,
    otherUrls: [],
    styles: [...o.styles],
    metroId: NYC_METRO_ID,
  }));
  const organizerIdBySlug = new Map(organizers.map((o, i) => [ORGANIZERS[i]?.slug ?? "", o.id]));

  const sources: SeedSource[] = SOURCES.map((s) => ({
    id: seedId("source", s.slug),
    url: s.url,
    kind: s.kind,
    platform: s.platform ?? null,
    countryCodes: [],
    feedUrl: null,
    organizerId: s.organizer ? (organizerIdBySlug.get(s.organizer) ?? null) : null,
    venueId: s.venue ? (venueIdBySlug.get(s.venue) ?? null) : null,
    metroId: NYC_METRO_ID,
    styles: s.styles ? [...s.styles] : [],
    language: "en",
    trustTier: s.trustTier,
    robotsStatus: "unknown",
    enabled: true,
    health: { lastSuccessAt: new Date(now.getTime() - 2 * HOUR_MS).toISOString() },
    discoveredBy: "seed",
  }));
  const sourceBySlug = new Map(sources.map((s, i) => [SOURCES[i]?.slug ?? "", s]));

  const ctx: Ctx = {
    now,
    tonight,
    venueById,
    venueIdBySlug,
    organizerIdBySlug,
    sourceBySlug,
    events: [],
    eventSources: [],
    provenance: [],
    busy: new Set(),
  };

  const series = SERIES.map((def) => buildSeriesRows(ctx, def));
  for (const def of ONE_OFFS) buildOneOff(ctx, def);
  for (const def of VENUES) buildOpenNights(ctx, def);
  addMergedDuplicate(ctx);

  // By night, then start; a listing with no time follows the night's timed ones (D-060). For
  // timed rows this is start order, since a later start never has an earlier night.
  ctx.events.sort((a, b) => {
    if (a.nightDate !== b.nightDate) return a.nightDate < b.nightDate ? -1 : 1;
    const sa = startsAtOf(a)?.getTime() ?? null;
    const sb = startsAtOf(b)?.getTime() ?? null;
    if (sa !== sb) {
      if (sa === null) return 1;
      if (sb === null) return -1;
      return sa - sb;
    }
    return a.slug.localeCompare(b.slug);
  });

  return {
    now,
    tonight,
    metro,
    venues,
    organizers,
    sources,
    series,
    events: ctx.events,
    eventSources: ctx.eventSources,
    provenance: ctx.provenance,
  };
}

/** The price shape re-exported for callers that build listings from seed rows. */
export type { Price };
