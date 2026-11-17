// Shared by the mock and database repositories: rows to the Listing view model, distance,
// the night selection, filters, counts and sort. Everything here is pure (no I/O beyond one
// console.warn line per dropped or odd row) so both implementations behave identically and
// the mock tests cover the database path's logic.

import { isStyleKey, type FamilyKey, type StyleKey } from "@/config/styles";
import { matchesSearch } from "@/src/domain/search";
import type { EventMusic } from "@/src/db/schema/events";
import type { GeoPoint } from "@/src/db/schema/geography";
import type { Price } from "@/src/db/schema/series";
import type { VenueAddress, VenueHours } from "@/src/db/schema/venues";
import type {
  DayCount,
  ListingFilters,
  ListingCounts,
  ListingSort,
  Point,
} from "@/src/data/repository";
import {
  familiesOf,
  httpUrlSchema,
  isConfirmedByOrganiser,
  listingSchema,
  type Confirmation,
  type Listing,
  type ListingSource,
  type ListingVenue,
  type SourceTier,
} from "@/src/domain/listing";
import type { TrustTier } from "@/src/adapters/types";
import type { ListingType } from "@/src/domain/listing-types";
import { recurrenceText } from "@/src/domain/recurrence";
import { MAX_NIGHT_SPAN_HOURS, formatTime } from "@/src/domain/time";
import {
  currentNightDate,
  isInProgress,
  isOnNight,
  isTonight,
  liveStatus,
  startsAt as startsAtOf,
  type DayOption,
  type NightDate,
  type TimedListing,
} from "@/src/domain/tonight";

/**
 * A stored end equal to a stated start, or more than MAX_NIGHT_SPAN_HOURS after the first one, is
 * shown as not listed: the rule normalize applies on read (#129), for rows stored before it
 * (Willie's "8pm to 8pm" stayed "on now" all the next day, 2026-10-15).
 */
export function trustedEnd(times: {
  doorsAt: Date | null;
  lessonAt: Date | null;
  dancingAt: Date | null;
  endsAt: Date | null;
}): Date | null {
  const end = times.endsAt;
  const stated = [times.doorsAt, times.lessonAt, times.dancingAt].flatMap((d) =>
    d === null ? [] : [d.getTime()],
  );
  if (end === null || stated.length === 0) return end;
  if (stated.includes(end.getTime())) return null;
  return end.getTime() - Math.min(...stated) > MAX_NIGHT_SPAN_HOURS * 3_600_000 ? null : end;
}

// ---------------------------------------------------------------------------------------------
// Row shapes: the columns the mapper reads, satisfied by both Drizzle selects and seed rows.

export interface EventRecord {
  id: string;
  slug: string;
  title: string;
  listingType: ListingType;
  styles: string[];
  doorsAt: Date | null;
  lessonAt: Date | null;
  dancingAt: Date | null;
  endsAt: Date | null;
  nightDate: string;
  tz: string;
  prices: Price[];
  isFree: boolean | null;
  ticketUrl: string | null;
  level: string | null;
  partnerRequired: boolean | null;
  ageMin: number | null;
  dressCode: string | null;
  floor: string | null;
  indoorOutdoor: "indoor" | "outdoor" | "both" | null;
  music: EventMusic | null;
  crowdSizeHint: string | null;
  summary: string | null;
  confirmation: Confirmation;
  confidence: number | null;
  status: "active" | "cancelled" | "merged" | "removed";
  canonicalUrl: string | null;
  venueId: string | null;
  organizerId: string | null;
  seriesId: string | null;
}

export interface VenueRecord {
  id: string;
  name: string;
  location: GeoPoint;
  address: VenueAddress | null;
  neighborhood: string | null;
  kind: ListingVenue["kind"];
  danceFloor: ListingVenue["danceFloor"];
  hours: VenueHours | null;
  googlePlaceId?: string | null;
}

export interface OrganizerRecord {
  name: string;
  websiteUrl: string | null;
  facebookUrl: string | null;
  instagramUrl: string | null;
  otherUrls: string[];
}

export interface SeriesRecord {
  rrule: string;
}

export interface SourceLink {
  url: string;
  role: "primary" | "secondary";
  lastSeenAt: Date;
  /** The source's trust tier; null when the link has no source row (D-061). */
  trustTier: TrustTier | null;
  /** This source's own page for the event (event_sources.event_url, D-073); null when none. */
  eventUrl: string | null;
}

/**
 * What the card calls each trust tier (D-061, D-072): the organiser's own site or feed, a ticket
 * seller's page, or any other listing. Only the first two confirm a night.
 */
const SOURCE_TIER = {
  first_party: "organizer",
  ticketing: "ticketing",
  serp: "listing",
  directory: "listing",
  unofficial: "listing",
} as const satisfies Record<TrustTier, SourceTier>;

/** A link with no source row is not the organiser's (D-061). */
function sourceTier(trustTier: TrustTier | null): SourceTier {
  return trustTier === null ? "listing" : SOURCE_TIER[trustTier];
}

export interface ProvenanceRecord {
  field: string;
  value: unknown;
  sourceUrl: string | null;
}

export interface ListingRows {
  event: EventRecord;
  venue: VenueRecord | null;
  organizer: OrganizerRecord | null;
  series: SeriesRecord | null;
  sources: SourceLink[];
  /** Only needed when the event's confirmation is `conflicting`. */
  provenance?: ProvenanceRecord[];
}

/**
 * The statuses the site lists. Cancelled rows stay visible until morning, marked "Cancelled
 * tonight" (SPEC section 1, item 3); merged and removed rows never show.
 */
export const LISTED_STATUSES: readonly EventRecord["status"][] = ["active", "cancelled"];

export function isListed(listing: Pick<Listing, "status">): boolean {
  return LISTED_STATUSES.includes(listing.status);
}

// ---------------------------------------------------------------------------------------------
// Distance

const EARTH_RADIUS_KM = 6371.0088;

/** Great-circle distance between two points, in kilometres. */
export function haversineKm(a: Point, b: Point): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Whether a query reaches the listings of its metro that have no location (D-082): the query is
 * in a metro (metroFor found one) and its distance covers that metro's whole radius. A listing
 * with no point cannot be said to be within a smaller distance the dancer chose, as a listing
 * with no price is not under a price ceiling.
 */
export function unplacedInReach(metro: { radiusKm: number } | null, radiusKm: number): boolean {
  return metro !== null && radiusKm >= metro.radiusKm;
}

/** Within reach of a query: a placed listing by great-circle distance, an unplaced one by the metro rule. */
export function inReach(
  listing: Pick<Listing, "venue">,
  center: Point,
  radiusKm: number,
  unplaced: boolean,
): boolean {
  return listing.venue === null
    ? unplaced
    : haversineKm(center, listing.venue.location) <= radiusKm;
}

// ---------------------------------------------------------------------------------------------
// Rows to Listing

const recurrenceTextCache = new Map<string, string | null>();

function recurrenceTextOf(rrule: string): string | null {
  const cached = recurrenceTextCache.get(rrule);
  if (cached !== undefined) return cached;
  let text: string | null;
  try {
    text = recurrenceText(rrule);
  } catch {
    text = null;
  }
  recurrenceTextCache.set(rrule, text);
  return text;
}

function httpOrNull(url: string | null | undefined): string | null {
  if (!url) return null;
  return httpUrlSchema.safeParse(url).success ? url : null;
}

/** The longest source label the detail page prints before it is cut back at a "/". */
const SOURCE_LABEL_MAX = 40;

/** The credit the City of Paris's ODbL licence asks for on every Que faire à Paris row (D-1045). */
export const QFAP_CREDIT = "Que faire à Paris, Ville de Paris (ODbL)";

/**
 * "frimframjam.com" for a URL, with its path when the host is short ("sobs.com/calendar"); the
 * URL itself when it cannot be parsed. A label longer than 40 characters is cut back to the last
 * whole path segment that fits and marked "/…" ("axs.com/events/1566230/…"), or to the host alone
 * when the cut would keep nothing worth reading ("eventbrite.com", not "eventbrite.com/o/…").
 * Never cut mid-word, which read as a typo or a broken link on the live site (D-069).
 */
export function sourceLabel(url: string): string {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, "");
    const path = parsed.pathname.replace(/\/+$/, "");
    if (host === "opendata.paris.fr" && path.includes("/datasets/que-faire-a-paris-/")) {
      return QFAP_CREDIT;
    }
    if (path === "" || host.length >= 20) return host;
    const full = `${host}${path}`;
    if (full.length <= SOURCE_LABEL_MAX) return full;
    let kept = host;
    for (const segment of path.split("/").filter(Boolean)) {
      const next = `${kept}/${segment}`;
      if (`${next}/…`.length > SOURCE_LABEL_MAX) break;
      kept = next;
    }
    return kept.slice(host.length).replace(/\//g, "").length >= 3 ? `${kept}/…` : host;
  } catch {
    return url;
  }
}

const TIME_FIELDS = new Set(["doorsAt", "lessonAt", "dancingAt", "endsAt", "startsAt"]);
/**
 * The fields a dancer is shown per source when sources disagree: the times, which the detail
 * page has words for (src/ui/detail/format.tsx fieldLabel) and formats as clock times. Any other
 * field's disagreement stays in the provenance table rather than printing an internal field name
 * or a raw JSON value on the page (dedupe marks a pair conflicting only on times, D-006).
 */
const SHOWN_WHEN_DISAGREEING = TIME_FIELDS;

/**
 * Provenance field names in the view model's spelling. The pipeline writes snake_case
 * ("dancing_at", src/pipeline/store.ts) and the seed camelCase ("dancingAt"); both read as one.
 */
export function provenanceFieldName(field: string): string {
  return field.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

function formatProvenanceValue(field: string, value: unknown, tz: string): string {
  if (TIME_FIELDS.has(field) && typeof value === "string") {
    const instant = new Date(value);
    if (!Number.isNaN(instant.getTime())) return formatTime(instant, tz);
  }
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

/**
 * Each source's own value for the fields the sources disagree on, keyed by source URL:
 * `{ "https://a": { endsAt: "1am" }, "https://b": { endsAt: "2am" } }`.
 */
export function conflictValues(
  provenance: readonly ProvenanceRecord[],
  tz: string,
): Map<string, Record<string, string>> {
  const byField = new Map<string, Map<string, string>>();
  for (const row of provenance) {
    if (!row.sourceUrl) continue;
    const field = provenanceFieldName(row.field);
    if (!SHOWN_WHEN_DISAGREEING.has(field)) continue;
    const values = byField.get(field) ?? new Map<string, string>();
    values.set(row.sourceUrl, formatProvenanceValue(field, row.value, tz));
    byField.set(field, values);
  }
  const result = new Map<string, Record<string, string>>();
  for (const [field, values] of byField) {
    if (new Set(values.values()).size < 2) continue;
    for (const [url, text] of values) {
      const entry = result.get(url) ?? {};
      entry[field] = text;
      result.set(url, entry);
    }
  }
  return result;
}

/** The venue as the view model reads it; a listing with no venue has none (D-082). */
function venueOf(venue: VenueRecord): ListingVenue {
  return {
    id: venue.id,
    name: venue.name,
    location: { lat: venue.location.lat, lng: venue.location.lng },
    address: venue.address
      ? {
          line1: venue.address.line1 ?? null,
          line2: venue.address.line2 ?? null,
          locality: venue.address.locality ?? null,
          region: venue.address.region ?? null,
          postcode: venue.address.postcode ?? null,
          countryCode: venue.address.countryCode ?? null,
          formatted: venue.address.formatted ?? null,
        }
      : null,
    googlePlaceId: venue.googlePlaceId ?? null,
    // Stored at ingest (D-499); the outlines stay out of the Worker (D-585).
    neighborhood: venue.neighborhood ?? null,
    kind: venue.kind,
    danceFloor: venue.danceFloor,
  };
}

/**
 * The view model before validation. A row whose source gives its night and no time keeps a null
 * start and its stored night date (D-060): it is shown as "Time not listed", never dropped and
 * never given an invented start.
 */
function buildListing(rows: ListingRows): Listing {
  const { event, venue, organizer, series } = rows;
  const styles = event.styles.filter(isStyleKey);
  if (styles.length < event.styles.length) {
    const unknown = event.styles.filter((s) => !isStyleKey(s));
    console.warn(`Listing ${event.slug}: unknown style keys ignored: ${unknown.join(", ")}`);
  }
  const conflicts =
    event.confirmation === "conflicting" && rows.provenance
      ? conflictValues(rows.provenance, event.tz)
      : null;
  const sources: ListingSource[] = [...rows.sources]
    .sort((a, b) => (a.role === b.role ? 0 : a.role === "primary" ? -1 : 1))
    .map((s) => {
      const values = conflicts?.get(s.url);
      const tier = sourceTier(s.trustTier);
      return {
        url: s.url,
        label: sourceLabel(s.url),
        checkedAt: s.lastSeenAt,
        byOrganiser: tier !== "listing",
        tier,
        eventUrl: httpOrNull(s.eventUrl),
        ...(values ? { values } : {}),
      };
    });
  const socials: Record<string, string> = {};
  if (organizer) {
    const facebook = httpOrNull(organizer.facebookUrl);
    const instagram = httpOrNull(organizer.instagramUrl);
    if (facebook) socials.facebook = facebook;
    if (instagram) socials.instagram = instagram;
  }
  const listing: Listing = {
    id: event.id,
    slug: event.slug,
    title: event.title,
    listingType: event.listingType,
    styles,
    families: familiesOf(styles),
    doorsAt: event.doorsAt,
    lessonAt: event.lessonAt,
    dancingAt: event.dancingAt,
    endsAt: trustedEnd(event),
    startsAt: startsAtOf(event),
    nightDate: event.nightDate,
    tz: event.tz,
    venue: venue === null ? null : venueOf(venue),
    organizer: organizer
      ? { name: organizer.name, websiteUrl: httpOrNull(organizer.websiteUrl), socials }
      : null,
    prices: event.prices.map((p) => ({
      label: p.label,
      amount: p.amount,
      currency: p.currency,
      includes: p.includes ?? null,
    })),
    isFree: event.isFree,
    ticketUrl: httpOrNull(event.ticketUrl),
    level: event.level,
    partnerRequired: event.partnerRequired,
    ageMin: event.ageMin,
    dressCode: event.dressCode,
    floor: event.floor,
    indoorOutdoor: event.indoorOutdoor,
    music: event.music
      ? {
          djs: event.music.djs,
          bands: event.music.bands,
          genreMix: event.music.genreMix,
          liveMusic: event.music.liveMusic ?? null,
        }
      : null,
    crowdSizeHint: event.crowdSizeHint,
    recurrenceText: series ? recurrenceTextOf(series.rrule) : null,
    confirmation: event.confirmation,
    confidence: event.confidence,
    summary: event.summary,
    sources,
    status: event.status,
    canonicalUrl: httpOrNull(event.canonicalUrl),
    distanceKm: null,
    liveStatus: null,
  };
  return listing;
}

/**
 * Build the view model from rows, strictly: throws on a row the Listing schema rejects. A row
 * with no start time is not malformed (D-060). Query-dependent fields (distance, live status)
 * start null.
 */
export function toListing(rows: ListingRows): Listing {
  return listingSchema.parse(buildListing(rows));
}

/**
 * The repositories' variant: a malformed row (a bad zone, a mailto: source URL) is dropped with
 * one warn line naming the slug and the first failing path, so it never takes the whole night
 * down with it. A row with no start time is kept (D-060).
 */
export function toListingSafe(rows: ListingRows): Listing | null {
  let reason: string;
  try {
    const result = listingSchema.safeParse(buildListing(rows));
    if (result.success) return result.data;
    const issue = result.error.issues[0];
    reason = issue ? `${issue.path.join(".") || "listing"}: ${issue.message}` : "invalid";
  } catch (error) {
    reason = error instanceof Error ? error.message : String(error);
  }
  console.warn(`Dropped listing ${rows.event.slug} (${reason})`);
  return null;
}

// ---------------------------------------------------------------------------------------------
// Query context: night selection, live status, distance

/**
 * The time facts the tonight rule needs, from a listing. The stored night date and zone always go
 * with them: every night test reads the stored night, and a listing whose time is not listed has
 * no other date fact (D-060). The untimed rules themselves live in src/domain/tonight.ts.
 */
export function timedOf(listing: Listing): TimedListing {
  const facts = {
    endsAt: listing.endsAt,
    listingType: listing.listingType,
    cancelled: listing.confirmation === "cancelled" || listing.status === "cancelled",
    nightDate: listing.nightDate,
    tz: listing.tz,
  };
  return listing.startsAt === null
    ? { ...facts, startsAt: null }
    : { ...facts, startsAt: listing.startsAt };
}

/**
 * Tonight uses the tonight rule (in progress counts, ended drops out); any other night its stored
 * night date. "Tonight" is decided in the listing's own zone. A listing whose time is not listed
 * is on its night for the whole night window and never in progress, so one from the night before
 * is not on tonight's list (D-060).
 */
export function isOnRequestedNight(listing: Listing, nightDate: NightDate, now: Date): boolean {
  const tonight = currentNightDate(now, listing.tz);
  if (nightDate === tonight) return isTonight(timedOf(listing), now, listing.tz);
  return isOnNight(listing, nightDate, listing.tz);
}

/**
 * The one per-night predicate both listNight and the day picker's counts use, in both
 * repositories: a listed row (active or cancelled) on the picked night by isOnRequestedNight.
 * Sharing it is what makes a day's count equal the length of that night's unfiltered list,
 * listings whose time is not listed included.
 */
export function isOnPickedNight(listing: Listing, nightDate: NightDate, now: Date): boolean {
  return isListed(listing) && isOnRequestedNight(listing, nightDate, now);
}

/**
 * The day picker's counts over listings already narrowed to the radius: each night counted by
 * isOnPickedNight. The picker's own zone chooses the picker's night dates and their labels;
 * whether a listing is on one of them is decided exactly as listNight decides it.
 */
export function countDays(
  listings: readonly Listing[],
  days: readonly DayOption[],
  now: Date,
  filters: ListingFilters = {},
): DayCount[] {
  return days.map((day, i) => {
    // A day's link carries the filters with it, except "On now", which only tonight (the first
    // day) can have; so its count is its list under those same filters (review, 2026-09-28).
    const dayFilters = i === 0 ? filters : { ...filters, onNow: undefined };
    return {
      nightDate: day.nightDate,
      label: day.label,
      count: listings.filter(
        (l) =>
          isOnPickedNight(l, day.nightDate, now) &&
          matchesFacts(l, dayFilters, now) &&
          matchesTaxonomy(l, dayFilters),
      ).length,
    };
  });
}

/**
 * A copy with the query's distance and live status filled in. The status comes from
 * src/domain/tonight.ts liveStatus, which reads "Time not listed" (kind time_not_listed) for a
 * listing whose time is not listed (D-060).
 */
export function withQueryContext(listing: Listing, center: Point | null, now: Date): Listing {
  return {
    ...listing,
    distanceKm: center && listing.venue ? haversineKm(center, listing.venue.location) : null,
    liveStatus: liveStatus(timedOf(listing), now, listing.tz),
  };
}

/**
 * The zone the day picker is built in, the same in both repositories: the metro's when the
 * point is within reach of one, else a whole-hour zone from the point's longitude. Without
 * this a viewer far from any metro got the UTC "Tonight" between 02:00 and 06:00 local.
 *
 * Not geo-tz (D-143): its polygon data is ~74 MB, and importing it here copied it into every
 * web function of every deployment, which filled Vercel Hobby's storage. Far from every metro
 * there are no listings, so a boundary up to an hour off (DST, half-hour zones) costs nothing.
 */
export function pickerZone(metro: { tz: string } | null, center: Point): string {
  return metro?.tz ?? longitudeZone(center.lng);
}

/** "Etc/GMT+5" for 75°W: the Etc names carry the inverted sign POSIX uses. */
export function longitudeZone(lng: number): string {
  if (!Number.isFinite(lng)) return "UTC";
  const hours = Math.max(-12, Math.min(12, Math.round(lng / 15)));
  if (hours === 0) return "Etc/GMT";
  return hours > 0 ? `Etc/GMT-${hours}` : `Etc/GMT+${-hours}`;
}

// ---------------------------------------------------------------------------------------------
// Filters

const BEGINNER = /\b(beginner|all levels|open level|newcomer|no experience|drop-in)\b/i;

/** The cheapest listed amount; 0 when marked free; null when no amount is listed. */
export function cheapestAmount(listing: Pick<Listing, "prices" | "isFree">): number | null {
  const amounts = listing.prices.map((p) => p.amount).filter((a): a is number => a !== null);
  if (amounts.length > 0) return Math.min(...amounts);
  return listing.isFree === true ? 0 : null;
}

function hasLiveMusic(listing: Listing): boolean {
  return (
    listing.listingType === "live_music_with_dancing" ||
    listing.music?.liveMusic === true ||
    (listing.music !== null && listing.music.bands.length > 0)
  );
}

/** The taxonomy filters (families, styles, types), applied separately so counts can exclude them. */
export function matchesTaxonomy(listing: Listing, filters: ListingFilters): boolean {
  if (filters.families && filters.families.length > 0) {
    if (!listing.families.some((f) => filters.families?.includes(f))) return false;
  }
  if (filters.styles && filters.styles.length > 0) {
    if (!listing.styles.some((s) => filters.styles?.includes(s))) return false;
  }
  if (filters.types && filters.types.length > 0) {
    if (!filters.types.includes(listing.listingType)) return false;
  }
  return true;
}

/** Every filter except the taxonomy ones. */
export function matchesFacts(listing: Listing, filters: ListingFilters, now: Date): boolean {
  if (filters.free && listing.isFree !== true) return false;
  if (filters.maxPrice !== undefined) {
    const cheapest = cheapestAmount(listing);
    if (cheapest === null || cheapest > filters.maxPrice) return false;
  }
  if (filters.beginnerFriendly && !(listing.level !== null && BEGINNER.test(listing.level))) {
    return false;
  }
  if (filters.lessonIncluded && listing.lessonAt === null) return false;
  if (filters.noPartnerNeeded && listing.partnerRequired !== false) return false;
  if (filters.age !== undefined) {
    if (filters.age === "all") {
      if (listing.ageMin !== null && listing.ageMin > 0) return false;
    } else if (listing.ageMin !== null && listing.ageMin > filters.age) return false;
  }
  if (filters.liveMusic && !hasLiveMusic(listing)) return false;
  // On now needs a start. A listing whose time is not listed is never in progress, so this filter
  // leaves it out rather than claim it has begun (D-060); it stays on the unfiltered list.
  if (filters.onNow && !isInProgress(timedOf(listing), now)) return false;
  if (filters.confirmedOnly && !isConfirmedByOrganiser(listing)) return false;
  if (!matchesSearch(listing, filters.text)) return false;
  return true;
}

export function applyFilters(listings: Listing[], filters: ListingFilters, now: Date): Listing[] {
  return listings.filter((l) => matchesFacts(l, filters, now) && matchesTaxonomy(l, filters));
}

// ---------------------------------------------------------------------------------------------
// Counts and sort

/**
 * The counts for `listings` (already on the night and within reach) under `filters`: each
 * dimension is counted with every filter applied except its own (see ListingCounts).
 */
export function countListings(
  listings: readonly Listing[],
  filters: ListingFilters = {},
  now: Date = new Date(),
): ListingCounts {
  const byFamily: Partial<Record<FamilyKey, number>> = {};
  const byType: Partial<Record<ListingType, number>> = {};
  const byStyle: Partial<Record<StyleKey, number>> = {};
  const withoutFamilies = { ...filters, families: undefined };
  const withoutTypes = { ...filters, types: undefined };
  const withoutStyles = { ...filters, styles: undefined };
  let total = 0;
  for (const listing of listings) {
    if (!matchesFacts(listing, filters, now)) continue;
    if (matchesTaxonomy(listing, withoutTypes))
      byType[listing.listingType] = (byType[listing.listingType] ?? 0) + 1;
    if (matchesTaxonomy(listing, withoutFamilies))
      for (const family of listing.families) byFamily[family] = (byFamily[family] ?? 0) + 1;
    if (matchesTaxonomy(listing, withoutStyles))
      for (const style of listing.styles) byStyle[style] = (byStyle[style] ?? 0) + 1;
    if (matchesTaxonomy(listing, filters)) total += 1;
  }
  return { byFamily, byType, byStyle, total, night: listings.length };
}

/** Ascending, with null after every known value; 0 when both are null so the next key decides. */
function nullsLast(a: number | null, b: number | null): number {
  if (a === null || b === null) return (a === null ? 1 : 0) - (b === null ? 1 : 0);
  return a - b;
}

/**
 * Start time or distance (D-060):
 * - "start": timed listings by start (ties by distance, then slug), then every listing whose time
 *   is not listed, by distance, then slug. They follow the night's whole timed bill, and map pin
 *   numbers, which are list positions, continue after the timed cards.
 * - "distance": by distance (ties by start with no time last, then slug).
 * An unknown distance sorts after every known one.
 */
export function sortListings(listings: Listing[], sort: ListingSort): Listing[] {
  const byStart = (a: Listing, b: Listing) =>
    nullsLast(a.startsAt?.getTime() ?? null, b.startsAt?.getTime() ?? null);
  const byDistance = (a: Listing, b: Listing) => nullsLast(a.distanceKm, b.distanceKm);
  const bySlug = (a: Listing, b: Listing) => a.slug.localeCompare(b.slug);
  return [...listings].sort((a, b) =>
    sort === "distance"
      ? byDistance(a, b) || byStart(a, b) || bySlug(a, b)
      : byStart(a, b) || byDistance(a, b) || bySlug(a, b),
  );
}

/** The whole listNight pipeline after the candidate rows are in memory. */
export function selectNight(
  candidates: readonly Listing[],
  query: {
    center: Point;
    radiusKm: number;
    nightDate: NightDate;
    now: Date;
    filters?: ListingFilters;
    sort: ListingSort;
    /**
     * Whether listings with no location are in reach (`unplacedInReach`, D-082). Required, so no
     * caller drops them by leaving it out.
     */
    unplaced: boolean;
  },
): { listings: Listing[]; counts: ListingCounts } {
  const filters = query.filters ?? {};
  const reachable = candidates
    .filter((l) => isOnPickedNight(l, query.nightDate, query.now))
    .map((l) => withQueryContext(l, query.center, query.now))
    .filter((l) =>
      l.venue === null ? query.unplaced : (l.distanceKm ?? Infinity) <= query.radiusKm,
    );
  const listings = sortListings(
    reachable.filter((l) => matchesFacts(l, filters, query.now) && matchesTaxonomy(l, filters)),
    query.sort,
  );
  return { listings, counts: countListings(reachable, filters, query.now) };
}
