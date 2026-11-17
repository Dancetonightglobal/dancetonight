// Google place IDs for venues (D-014, D-066). A map link that carries the venue's place ID opens
// that place's own Google listing (D-064); without one, Google searches the name and address and
// can show a list or a dropped pin.
//
// Places API (New) Text Search, twice per venue, asking for the place's id alone. The field mask
// `places.id` is the "Text Search Essentials (IDs Only)" SKU, which Google's price list gives as
// free with no cap (read 2026-09-29). Any other field would bill a paid SKU, so the mask is a
// constant and a test pins it. Only the id is stored: the Maps Platform terms allow place IDs to
// be kept, and nothing else from Places is kept (D-014).
//
// The first question is "what is at our point": the venue's name and address, restricted to a
// small box around the venue's own point. The address can outweigh the name: run 26 stored a
// candy shop at 144 Allen Street for "The Factory" (D-071). So an id is stored only when a second
// question gives the same place: the venue's name alone, biased towards a wider rectangle around
// the point but not restricted to it (D-077). Asked inside the same small box (D-071), the second
// question could only name what the box held: the point Ticketmaster gives for The Rooftop at
// Pier 17 is 207 m off, the box held Pier 16 and not Pier 17, and both questions named Pier 16.
// Google's Text Search guide reserves `locationRestriction` for categorical queries; a bias lets
// Google find the named place wherever it is, so a wrong point makes the answers differ, and
// nothing is stored. A venue with no usable address is asked both too: its name restricted, then
// its name biased. A placeholder address ("123 Main St") is never searched.
//
// Every stored id is asked the second question once more when `google_place_name_checked_at` is
// null (migration 0006 set it null for every id, D-077), and cleared when the answer differs. A
// venue Google does not know, or whose answers differ, is asked again after `PLACE_ID_RETRY_DAYS`.
// An id on the hand-kept list in `config/place-id-exclusions.ts` is never stored for that venue.

import { and, eq, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";

import { PLACE_ID_EXCLUSIONS, type PlaceIdExclusion } from "@/config/place-id-exclusions";
import { normalizeForMatch } from "@/config/styles";
import type { Metro } from "@/src/adapters/types";
import type { Db } from "@/src/db/client";
import { events, venues } from "@/src/db/schema";
import type { VenueAddress } from "@/src/db/schema/venues";
import type { Point } from "@/src/domain/listing";
import { isPlaceholderAddress } from "@/src/pipeline/geocode";
import { HttpError, type HttpClient } from "@/src/pipeline/http";

export const PLACES_TEXT_SEARCH = "https://places.googleapis.com/v1/places:searchText";
/** The only field asked for: anything more bills a paid SKU. */
export const PLACE_ID_FIELD_MASK = "places.id";
/** Half the side of the box the first question is restricted to, around the venue's point. */
export const PLACE_BOX_METRES = 100;
/**
 * Half the side of the rectangle the name-alone question is biased towards (D-077). A bias, not a
 * restriction: Google may answer with a place outside it, which is the point.
 */
export const PLACE_NAME_BIAS_METRES = 500;
/** A venue Google did not find is asked again after this many days. */
export const PLACE_ID_RETRY_DAYS = 30;
/** At most this many venues looked up or re-checked in one run, whatever the backlog. */
export const PLACE_ID_LOOKUPS_PER_RUN = 100;
/**
 * At most this many requests in one run: half the daily quota of 300 that ACCOUNTS 3h sets on
 * the key, so a second run on the same day still has room. A lookup takes two, a re-check one.
 */
export const PLACE_ID_REQUESTS_PER_RUN = 150;
/** Spacing between requests: 100 a minute, under the lowest per-minute quota ACCOUNTS 3h allows. */
export const PLACE_ID_INTERVAL_MS = 600;
/** Lookups stop after this many failures in a row: Google is down, and the run must still end. */
export const PLACE_ID_FAILURES_IN_A_ROW = 3;

const METRES_PER_DEGREE_LAT = 111_320;

/** The venue's address as a search would use it: none when it is a placeholder (D-071). */
function searchAddress(address: VenueAddress | null): string | null {
  const text = address?.formatted ?? address?.line1 ?? null;
  return text && !isPlaceholderAddress(text) ? text : null;
}

/** A rectangle of `halfSide` metres each way around a point, as Text Search takes one. */
export function rectangleAround(at: Point, halfSide: number) {
  const dLat = halfSide / METRES_PER_DEGREE_LAT;
  const dLng = halfSide / (METRES_PER_DEGREE_LAT * Math.cos((at.lat * Math.PI) / 180));
  return {
    rectangle: {
      low: { latitude: at.lat - dLat, longitude: at.lng - dLng },
      high: { latitude: at.lat + dLat, longitude: at.lng + dLng },
    },
  };
}

type VenueToSearch = { name: string; address: VenueAddress | null; location: Point };

/**
 * The first question for one venue: its name and address (its name alone when it has no usable
 * address), restricted to a small box around its point, so the answer is a place at that spot.
 */
export function placeSearchBody(venue: VenueToSearch): string {
  const address = searchAddress(venue.address);
  return JSON.stringify({
    textQuery: address ? `${venue.name}, ${address}` : venue.name,
    pageSize: 1,
    locationRestriction: rectangleAround(venue.location, PLACE_BOX_METRES),
  });
}

/**
 * The check question for one venue (D-077): its name alone, biased towards a rectangle around its
 * point and not restricted to it, with no `rankPreference`, which Google's guide says to leave
 * unset for a query that names a place.
 */
export function placeCheckBody(venue: Pick<VenueToSearch, "name" | "location">): string {
  return JSON.stringify({
    textQuery: venue.name,
    pageSize: 1,
    locationBias: rectangleAround(venue.location, PLACE_NAME_BIAS_METRES),
  });
}

/** Whether the hand-kept list says never to store this id for a venue of this name. */
export function isExcludedPlaceId(
  venueName: string,
  placeId: string,
  exclusions: readonly PlaceIdExclusion[] = PLACE_ID_EXCLUSIONS,
): boolean {
  const name = normalizeForMatch(venueName);
  return exclusions.some((e) => e.placeId === placeId && normalizeForMatch(e.venueName) === name);
}

/** The first place's id in a Text Search answer, or null when Google found none. */
export function placeIdFrom(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const places = (body as { places?: unknown }).places;
  if (!Array.isArray(places)) return null;
  const first: unknown = places[0];
  if (typeof first !== "object" || first === null) return null;
  const id = (first as { id?: unknown }).id;
  // Google sets no maximum length (an address with a unit number encodes the address in the id);
  // 2,048 only bounds what is stored.
  return typeof id === "string" && /^[A-Za-z0-9_-]{10,2048}$/.test(id) ? id : null;
}

export interface PlaceIdReport {
  /** Venues on a listing in the window with no place ID, not asked recently. */
  due: number;
  asked: number;
  /** Asked, but the answer did not arrive or could not be read: asked again next run. */
  failed: number;
  found: number;
  notFound: number;
  /** Google gave a place another venue already has: likely the same venue twice in our table. */
  taken: number;
  /** The name alone, searched nearby, gave another place, or none: no id stored (D-077). */
  disagreed: number;
  /** Both answers gave a place the hand-kept list rules out for this venue: no id stored. */
  excluded: number;
  /**
   * Stored ids to re-check at the start of the run: those not yet checked by name (every id once
   * after migration 0006, D-077), and any on the hand-kept list.
   */
  toRecheck: number;
  /** Of those, re-checked this run. */
  rechecked: number;
  /** Of those, cleared: the name alone gave another place, or none, or the id is on the list. */
  cleared: number;
  /** Requests sent to Google this run. */
  requests: number;
  /** Why lookups stopped early (a refused key, a quota, repeated failures), when they did. */
  stopped: string | null;
  notes: string[];
}

export function emptyPlaceIdReport(): PlaceIdReport {
  return {
    due: 0,
    asked: 0,
    failed: 0,
    found: 0,
    notFound: 0,
    taken: 0,
    disagreed: 0,
    excluded: 0,
    toRecheck: 0,
    rechecked: 0,
    cleared: 0,
    requests: 0,
    stopped: null,
    notes: [],
  };
}

/** The words a note uses for the check question's answer. */
const NAME_NEARBY = "the name alone, searched nearby,";
const ON_THE_LIST = "it is on the hand-kept list of wrong places (config/place-id-exclusions.ts)";

/**
 * Checks and looks up place IDs for the metro's venues. First each stored id on the hand-kept
 * list is cleared (asked the check question once, for the report only). Then each stored id not
 * yet checked by name (D-077) is
 * asked the check question once, and cleared when Google's answer differs. Then the venues that
 * listings in `nights` use and that have no id are looked up, most listed first: an id is stored
 * only when the name and address at the venue's point, and the name alone searched nearby, give
 * the same place, and the list does not rule it out. At most `limit` venues and `maxRequests`
 * requests (`PLACE_ID_REQUESTS_PER_RUN`); each answer is stored with the time it was asked, and a
 * venue whose lookup failed on the network waits for the next run.
 */
export async function resolvePlaceIds(
  db: Db,
  args: {
    http: HttpClient;
    apiKey: string;
    metro: Metro;
    nights: readonly string[];
    now: () => Date;
    limit?: number;
    maxRequests?: number;
    /** The hand-kept list; tests replace it. */
    exclusions?: readonly PlaceIdExclusion[];
  },
): Promise<PlaceIdReport> {
  const { http, apiKey, metro, nights, now } = args;
  const exclusions = args.exclusions ?? PLACE_ID_EXCLUSIONS;
  const excluded = (name: string, placeId: string) => isExcludedPlaceId(name, placeId, exclusions);
  const report = emptyPlaceIdReport();
  if (nights.length === 0) return report;
  const retryBefore = new Date(now().getTime() - PLACE_ID_RETRY_DAYS * 86_400_000);
  const excludedIds = [...new Set(exclusions.map((e) => e.placeId))];
  const storedToCheck = await db
    .select({
      id: venues.id,
      name: venues.name,
      address: venues.address,
      location: venues.location,
      placeId: venues.googlePlaceId,
      nameCheckedAt: venues.googlePlaceNameCheckedAt,
    })
    .from(venues)
    .where(
      and(
        eq(venues.metroId, metro.id),
        isNotNull(venues.googlePlaceId),
        excludedIds.length > 0
          ? or(isNull(venues.googlePlaceNameCheckedAt), inArray(venues.googlePlaceId, excludedIds))
          : isNull(venues.googlePlaceNameCheckedAt),
      ),
    )
    .orderBy(venues.name, venues.id);
  // An id on the list is cleared whatever its check says; another venue's id that happens to be
  // listed for a different name is re-checked only if it is due anyway.
  const onList = storedToCheck.filter((v) => excluded(v.name, v.placeId!));
  const toRecheck = storedToCheck.filter(
    (v) => v.nameCheckedAt === null && !excluded(v.name, v.placeId!),
  );
  report.toRecheck = onList.length + toRecheck.length;
  const due = await db
    .select({
      id: venues.id,
      name: venues.name,
      address: venues.address,
      location: venues.location,
      listings: sql<number>`count(${events.id})::int`,
    })
    .from(venues)
    .innerJoin(events, eq(events.venueId, venues.id))
    .where(
      and(
        eq(events.metroId, metro.id),
        inArray(events.nightDate, [...nights]),
        inArray(events.status, ["active", "cancelled"]),
        isNull(venues.googlePlaceId),
        eq(venues.blocklisted, false),
        or(isNull(venues.googlePlaceCheckedAt), lt(venues.googlePlaceCheckedAt, retryBefore)),
      ),
    )
    .groupBy(venues.id)
    .orderBy(sql`count(${events.id}) desc`, venues.name, venues.id);
  report.due = due.length;

  // The report is printed in the Actions log: an error body that echoes the key must not.
  const scrub = (text: string) => (apiKey.length >= 8 ? text.split(apiKey).join("***") : text);
  let failuresInARow = 0;
  /**
   * One Text Search. "stop" ends every lookup for the run (a refused key, a rejected request, an
   * exhausted quota, or repeated faults); "skip" leaves this venue for the next run.
   */
  const ask = async (body: string): Promise<{ id: string | null } | "skip" | "stop"> => {
    report.requests += 1;
    try {
      const response = await http.request({
        url: PLACES_TEXT_SEARCH,
        method: "POST",
        purpose: "api",
        intervalMs: PLACE_ID_INTERVAL_MS,
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": apiKey,
          "x-goog-fieldmask": PLACE_ID_FIELD_MASK,
        },
        body,
      });
      const id = placeIdFrom(JSON.parse(response.body));
      failuresInARow = 0;
      return { id };
    } catch (error) {
      // A refused key, a request Google rejects or an exhausted quota stops the lookups for this
      // run; anything else skips one venue, which the next run asks again.
      if (
        error instanceof HttpError &&
        (error.kind === "stopped" || error.status === 400 || error.status === 429)
      ) {
        report.stopped = scrub(error.message);
        return "stop";
      }
      report.failed += 1;
      failuresInARow += 1;
      if (failuresInARow >= PLACE_ID_FAILURES_IN_A_ROW) {
        report.stopped = scrub(
          `${failuresInARow} lookups in a row failed; the last: ${error instanceof Error ? error.message : String(error)}`,
        );
        return "stop";
      }
      return "skip";
    }
  };
  const limit = args.limit ?? PLACE_ID_LOOKUPS_PER_RUN;
  const maxRequests = args.maxRequests ?? PLACE_ID_REQUESTS_PER_RUN;
  let lookups = 0;
  const roomFor = (requests: number) =>
    lookups < limit && report.requests + requests <= maxRequests;

  const clear = async (venueId: string, checkedAt: Date) => {
    await db
      .update(venues)
      .set({ googlePlaceId: null, googlePlaceCheckedAt: checkedAt, googlePlaceNameCheckedAt: null })
      .where(eq(venues.id, venueId));
  };

  // 1. Stored ids on the hand-kept list: cleared whatever Google says. The check question is still
  // asked once, when there is room, so the report shows whether it alone would have caught the id
  // (the list is the fallback; D-077 wants to know when it is the only thing that works).
  let asking = true;
  for (const venue of onList) {
    let heard = "";
    if (asking && roomFor(1)) {
      lookups += 1;
      const answer = await ask(placeCheckBody(venue));
      if (answer === "stop") asking = false;
      else if (answer !== "skip")
        heard =
          answer.id === venue.placeId
            ? `; ${NAME_NEARBY} still gives it`
            : `; ${NAME_NEARBY} gives ${answer.id ? "another place" : "no place"} too`;
    }
    report.rechecked += 1;
    report.cleared += 1;
    report.notes.push(`${venue.name}: stored place ID cleared; ${ON_THE_LIST}${heard}`);
    await clear(venue.id, now());
  }
  if (report.stopped) return report;

  // 2. Stored ids not yet checked by name: the check question once each.
  for (const venue of toRecheck) {
    if (!roomFor(1)) break;
    lookups += 1;
    const answer = await ask(placeCheckBody(venue));
    if (answer === "stop") return report;
    if (answer === "skip") continue;
    report.rechecked += 1;
    const checkedAt = now();
    if (answer.id === venue.placeId) {
      await db
        .update(venues)
        .set({ googlePlaceNameCheckedAt: checkedAt })
        .where(eq(venues.id, venue.id));
      continue;
    }
    report.cleared += 1;
    report.notes.push(
      `${venue.name}: stored place ID cleared; ${NAME_NEARBY} gives ${answer.id ? "another place" : "no place"}`,
    );
    await clear(venue.id, checkedAt);
  }

  // 3. Venues with no id: the name and address at the point, then the name alone searched
  // nearby, must give the same place. A venue with no address is asked both too: its name inside
  // the box, then its name nearby.
  for (const venue of due) {
    if (!roomFor(2)) break;
    lookups += 1;
    report.asked += 1;
    const first = await ask(placeSearchBody(venue));
    if (first === "stop") break;
    if (first === "skip") continue;

    const checkedAt = now();
    if (first.id === null) {
      report.notFound += 1;
      await db
        .update(venues)
        .set({ googlePlaceCheckedAt: checkedAt })
        .where(eq(venues.id, venue.id));
      continue;
    }
    const second = await ask(placeCheckBody(venue));
    if (second === "stop") break;
    if (second === "skip") continue;
    if (second.id !== first.id) {
      report.disagreed += 1;
      report.notes.push(
        `${venue.name}: no place ID stored; ${NAME_NEARBY} gives ${second.id ? "another place" : "no place"}`,
      );
      await db
        .update(venues)
        .set({ googlePlaceCheckedAt: checkedAt })
        .where(eq(venues.id, venue.id));
      continue;
    }
    const placeId = first.id;
    if (excluded(venue.name, placeId)) {
      report.excluded += 1;
      report.notes.push(`${venue.name}: no place ID stored; ${ON_THE_LIST}`);
      await db
        .update(venues)
        .set({ googlePlaceCheckedAt: checkedAt })
        .where(eq(venues.id, venue.id));
      continue;
    }
    const [holder] = await db
      .select({ id: venues.id, name: venues.name })
      .from(venues)
      .where(eq(venues.googlePlaceId, placeId));
    if (holder && holder.id !== venue.id) {
      report.taken += 1;
      report.notes.push(`${venue.name}: Google gives the same place as ${holder.name}`);
      await db
        .update(venues)
        .set({ googlePlaceCheckedAt: checkedAt })
        .where(eq(venues.id, venue.id));
      continue;
    }
    report.found += 1;
    await db
      .update(venues)
      .set({
        googlePlaceId: placeId,
        googlePlaceCheckedAt: checkedAt,
        googlePlaceNameCheckedAt: checkedAt,
      })
      .where(eq(venues.id, venue.id));
  }
  return report;
}
