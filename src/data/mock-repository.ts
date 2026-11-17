// The in-memory repository for mock mode (D-011): the New York seed, rebuilt whenever the night
// date changes so the relative dates never go stale, queried with the same night rule,
// filters and sort the database repository uses.

import {
  countDays,
  haversineKm,
  inReach,
  isListed,
  pickerZone,
  selectNight,
  toListingSafe,
  unplacedInReach,
  withQueryContext,
  type SourceLink,
} from "@/src/data/listing-mapper";
import {
  MERGED_HOPS,
  METRO_MATCH_KM,
  type SlugAnswer,
  type DayCount,
  type ListingFilters,
  type ListNightQuery,
  type ListNightResult,
  type ListingsRepository,
  type MetroSummary,
  type Point,
  type CitySummary,
} from "@/src/data/repository";
import { appNow } from "@/src/config/clock";
import { LONDON_METRO } from "@/src/db/seed/london";
import { seedNyc, type NycSeed } from "@/src/db/seed/nyc";
import type { Listing } from "@/src/domain/listing";
import { currentNightDate, dayPicker } from "@/src/domain/tonight";

type SeedFn = (now: Date) => NycSeed;

interface Snapshot {
  tonight: string;
  seed: NycSeed;
  listings: Listing[];
  bySlug: Map<string, Listing>;
  /** A merged seed row's slug to the slug of the listing it was merged into (D-092). */
  movedTo: Map<string, string>;
}

/** Each merged or retired-into seed row's slug to the slug of the row it leads to (D-092). */
function movedSlugs(seed: NycSeed): Map<string, string> {
  const slugById = new Map(seed.events.map((e) => [e.id, e.slug]));
  const moved = new Map<string, string>();
  for (const e of seed.events) {
    const leads = e.status === "merged" || e.status === "removed";
    const to = leads && e.mergedIntoId ? slugById.get(e.mergedIntoId) : undefined;
    if (to !== undefined) moved.set(e.slug, to);
  }
  return moved;
}

/** Turn a seed into base listings (no query context yet). */
export function listingsFromSeed(seed: NycSeed): Listing[] {
  const venues = new Map(seed.venues.map((v) => [v.id, v]));
  const organizers = new Map(seed.organizers.map((o) => [o.id, o]));
  const series = new Map(seed.series.map((s) => [s.id, s]));
  const tiers = new Map(seed.sources.map((s) => [s.id, s.trustTier]));
  const sourcesByEvent = new Map<string, SourceLink[]>();
  for (const es of seed.eventSources) {
    const list = sourcesByEvent.get(es.eventId) ?? [];
    list.push({
      url: es.sourceUrl,
      role: es.role ?? "secondary",
      lastSeenAt: es.lastSeenAt,
      trustTier: es.sourceId ? (tiers.get(es.sourceId) ?? null) : null,
      eventUrl: es.eventUrl ?? null,
    });
    sourcesByEvent.set(es.eventId, list);
  }
  const provenanceByEvent = new Map<
    string,
    { field: string; value: unknown; sourceUrl: string | null }[]
  >();
  for (const p of seed.provenance) {
    const list = provenanceByEvent.get(p.entityId) ?? [];
    list.push({ field: p.field, value: p.value, sourceUrl: p.sourceUrl ?? null });
    provenanceByEvent.set(p.entityId, list);
  }
  const listings: Listing[] = [];
  for (const event of seed.events) {
    // A listing with no venue is kept and shown as "Location not listed" (D-082); one naming a
    // venue the seed does not have is a seed error, and is dropped as before.
    const venue = event.venueId === null ? null : venues.get(event.venueId);
    if (venue === undefined) continue;
    const listing = toListingSafe({
      event,
      venue,
      organizer: event.organizerId ? (organizers.get(event.organizerId) ?? null) : null,
      series: event.seriesId ? (series.get(event.seriesId) ?? null) : null,
      sources: sourcesByEvent.get(event.id) ?? [],
      provenance: provenanceByEvent.get(event.id) ?? [],
    });
    if (listing) listings.push(listing);
  }
  return listings;
}

export class MockListingsRepository implements ListingsRepository {
  private snapshot: Snapshot | null = null;

  constructor(private readonly seedFn: SeedFn = seedNyc) {}

  /** The seed for `now`, rebuilt when the night date moves on. */
  snapshotFor(now: Date): Snapshot {
    const seed = this.snapshot?.seed;
    const tonight = currentNightDate(now, seed?.metro.tz ?? "America/New_York");
    if (this.snapshot && this.snapshot.tonight === tonight) return this.snapshot;
    const fresh = this.seedFn(now);
    const listings = listingsFromSeed(fresh);
    this.snapshot = {
      tonight: fresh.tonight,
      seed: fresh,
      listings,
      bySlug: new Map(listings.map((l) => [l.slug, l])),
      movedTo: movedSlugs(fresh),
    };
    return this.snapshot;
  }

  async listNight(query: ListNightQuery): Promise<ListNightResult> {
    const { listings } = this.snapshotFor(query.now);
    const unplaced = unplacedInReach(await this.metroFor(query.center), query.radiusKm);
    return selectNight(listings, { ...query, unplaced });
  }

  async getBySlug(slug: string, now: Date): Promise<Listing | null> {
    const { bySlug } = this.snapshotFor(now);
    const listing = bySlug.get(slug);
    if (!listing || !isListed(listing)) return null;
    return withQueryContext(listing, null, now);
  }

  async resolveSlug(slug: string): Promise<SlugAnswer> {
    const { bySlug, movedTo } = this.snapshotFor(appNow());
    let current = slug;
    for (let hop = 0; hop <= MERGED_HOPS; hop++) {
      const listing = bySlug.get(current);
      if (listing && isListed(listing))
        return hop === 0 ? { kind: "listed" } : { kind: "moved", slug: current };
      const next = movedTo.get(current);
      if (next === undefined) break;
      current = next;
    }
    return { kind: "gone" };
  }

  async dayCounts(
    center: Point,
    radiusKm: number,
    now: Date,
    filters: ListingFilters = {},
  ): Promise<DayCount[]> {
    const { listings } = this.snapshotFor(now);
    const metro = await this.metroFor(center);
    const tz = pickerZone(metro, center);
    const unplaced = unplacedInReach(metro, radiusKm);
    const near = listings.filter((l) => inReach(l, center, radiusKm, unplaced));
    // The same per-night rule as listNight and the database repository (listing-mapper.ts).
    return countDays(near, dayPicker(now, tz), now, filters);
  }

  async metroFor(center: Point): Promise<MetroSummary | null> {
    // Metro geometry does not depend on the clock; reuse the current snapshot when there is one.
    const { metro } = (this.snapshot ?? this.snapshotFor(appNow())).seed;
    const distanceKm = haversineKm(center, { lat: metro.center.lat, lng: metro.center.lng });
    if (distanceKm > METRO_MATCH_KM) return null;
    return {
      id: metro.id,
      slug: metro.slug,
      name: metro.name,
      countryCode: metro.countryCode,
      center: { lat: metro.center.lat, lng: metro.center.lng },
      radiusKm: metro.radiusKm,
      tz: metro.tz,
      languages: metro.languages ?? [],
      distanceKm,
    };
  }

  async nightWithDays(
    query: ListNightQuery,
  ): Promise<{ night: ListNightResult; days: DayCount[] }> {
    const [night, days] = await Promise.all([
      this.listNight(query),
      this.dayCounts(query.center, query.radiusKm, query.now, query.filters),
    ]);
    return { night, days };
  }

  async listCities(now: Date): Promise<CitySummary[]> {
    // New York from the seed; London has a metro row but no mock data, so it is always empty.
    const { seed, listings } = this.snapshotFor(now);
    const nycTonight = currentNightDate(now, seed.metro.tz);
    const nycHasListings = listings.some((listing) => listing.nightDate >= nycTonight);

    const cities: CitySummary[] = [
      {
        slug: LONDON_METRO.slug,
        name: LONDON_METRO.name,
        center: { lat: LONDON_METRO.center.lat, lng: LONDON_METRO.center.lng },
        hasListings: false,
      },
      {
        slug: seed.metro.slug,
        name: seed.metro.name,
        center: { lat: seed.metro.center.lat, lng: seed.metro.center.lng },
        hasListings: nycHasListings,
      },
    ];

    return cities.sort((a, b) => a.name.localeCompare(b.name));
  }
}
