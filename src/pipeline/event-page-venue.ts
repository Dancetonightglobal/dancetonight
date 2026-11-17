import { and, eq, isNull, sql } from "drizzle-orm";

import type { Db } from "@/src/db/client";
import { events, eventSources, fieldProvenance, sources } from "@/src/db/schema";
import type { Metro } from "@/src/adapters/types";
import { HttpError, type HttpClient } from "@/src/pipeline/http";
import type { VenueInput, ResolvedVenue } from "@/src/pipeline/store";
import { releaseMergedInto } from "@/src/pipeline/store";
import { eventPagePlace, type EventPagePlace } from "@/src/adapters/feeds/jsonld";
import { feverPagePlace } from "@/src/adapters/feeds/fever";
import { hasPostcode, postcodeWord } from "@/src/domain/postcode";
import { registrableDomain } from "@/src/pipeline/blocklist";
import { titleNamesOutsideTown } from "@/config/metro-regions";
import type { KnownVenue } from "@/config/known-venues";
import { knownVenuePlace } from "@/src/pipeline/source-venue";

// Hosts this step never requests (D-190): RA is skipped everywhere, Facebook and Instagram are Tier D.
const NEVER_FETCHED = new Set(["ra.co", "residentadvisor.net", "facebook.com", "instagram.com"]);

export const EVENT_PAGES_PER_RUN = 60;

/** Of those, at most this many Meetup event pages a run (the owner, D-561). */
export const MEETUP_PAGES_PER_RUN = 25;

export interface EventPagePlacing {
  /** Pages requested this run. */
  asked: number;
  placed: number;
  /** Listings removed because their event page places them outside the metro. */
  removed: number;
  notes: string[];
}

export async function placeFromEventPages(
  db: Db,
  args: {
    metro: Metro;
    nights: readonly string[];
    http: HttpClient;
    placeVenue: (input: VenueInput, apiPoint?: boolean) => Promise<ResolvedVenue | null>;
    /** The place an address names outside the metro, or null (`Geocoder.elsewhere`). */
    elsewhere?: (address: string) => Promise<string | null>;
    /** Pages requested at most; EVENT_PAGES_PER_RUN by default. */
    limit?: number;
    /** The metro's hand-checked venues (config/known-venues.ts): an event-page address one names places there (D-266). */
    known?: readonly KnownVenue[];
  },
): Promise<EventPagePlacing> {
  const limit = args.limit ?? EVENT_PAGES_PER_RUN;
  if (args.nights.length === 0) {
    return { asked: 0, placed: 0, removed: 0, notes: [] };
  }

  const rows = await db.execute<{
    id: string;
    title: string;
    night: string;
    ticket_url: string | null;
    canonical_url: string | null;
    source_id: string;
    source_url: string;
    venue_name: string | null;
    venue_address: string | null;
  }>(sql`
    select e.id, e.title, e.night_date::text as night, e.ticket_url, e.canonical_url,
      es.source_id, s.url as source_url,
      (select fp.value #>> '{}' from ${fieldProvenance} fp
        where fp.entity_type = 'event' and fp.entity_id = e.id and fp.field = 'venue_name'
          and fp.is_current and fp.source_id = es.source_id limit 1) as venue_name,
      (select fp.value #>> '{}' from ${fieldProvenance} fp
        where fp.entity_type = 'event' and fp.entity_id = e.id and fp.field = 'venue_address'
          and fp.is_current and fp.source_id = es.source_id limit 1) as venue_address
    from ${events} e
    join ${eventSources} es on es.event_id = e.id and es.role = 'primary'
    join ${sources} s on s.id = es.source_id
    where e.metro_id = ${args.metro.id} and e.venue_id is null
      and e.status in ('active', 'cancelled')
      and e.night_date = any(${`{${args.nights.join(",")}}`}::date[])
    order by e.night_date, e.title, e.id
  `);

  type CacheEntry = {
    place: EventPagePlace | null;
    url: string;
    fetchedAt: Date;
    why: string | null;
  };
  const cache = new Map<string, CacheEntry>();
  let asked = 0;
  let meetupAsked = 0;
  const placed: string[] = [];
  const removed: string[] = [];
  const notes: string[] = [];
  let leftOver = 0;

  for (const row of rows) {
    if (row.venue_address && hasPostcode(row.venue_address, args.metro.countryCode)) {
      continue;
    }

    let sourceNormalized: string | null = null;
    try {
      const sourceUrl = new URL(row.source_url);
      sourceNormalized =
        sourceUrl.origin + sourceUrl.pathname.replace(/\/$/, "") + sourceUrl.search;
    } catch {}

    const candidates: string[] = [];
    for (const link of [row.ticket_url, row.canonical_url]) {
      if (link === null) continue;
      try {
        const url = new URL(link);
        if (url.protocol !== "http:" && url.protocol !== "https:") continue;
        const domain = registrableDomain(url.hostname);
        if (domain && NEVER_FETCHED.has(domain)) continue;
        const normalized = url.origin + url.pathname.replace(/\/$/, "") + url.search;
        if (sourceNormalized !== null && normalized === sourceNormalized) continue;
        candidates.push(link);
      } catch {}
    }
    const uniqueCandidates = [...new Set(candidates)];
    if (uniqueCandidates.length === 0) continue;

    const hitLink = uniqueCandidates.find((c) => cache.has(c));
    const link = hitLink ?? uniqueCandidates[0];
    if (!link) continue;

    let cached: CacheEntry | undefined = hitLink ? cache.get(hitLink) : undefined;
    if (!cached) {
      const isMeetup = registrableDomain(new URL(link).hostname) === "meetup.com";
      if (asked >= limit || (isMeetup && meetupAsked >= MEETUP_PAGES_PER_RUN)) {
        leftOver++;
        continue;
      }
      asked++;
      if (isMeetup) meetupAsked++;
      try {
        const response = await args.http.request({
          url: link,
          purpose: "crawl",
          headers: { accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1" },
        });
        if (response.status < 200 || response.status >= 300 || response.notModified) {
          cached = {
            place: null,
            url: response.url || link,
            fetchedAt: response.fetchedAt,
            why: `status ${response.status}`,
          };
        } else {
          const place = feverPagePlace(
            response.body,
            response.url || link,
            eventPagePlace(response.body),
          );
          cached = {
            place,
            url: response.url || link,
            fetchedAt: response.fetchedAt,
            why: place ? null : "no venue on the page",
          };
        }
      } catch (error) {
        const why = error instanceof HttpError ? error.kind : "error";
        cached = { place: null, url: link, fetchedAt: new Date(), why };
      }
      cache.set(link, cached);
    }

    if (!cached) continue;

    if (!cached.place) {
      notes.push(`${row.title} on ${row.night}: ${cached.url} gave no venue (${cached.why})`);
      continue;
    }

    // An address naming a town or county outside the metro is not here: the row goes (D-225).
    const outsideTown = titleNamesOutsideTown(args.metro.slug, cached.place.address);
    if (outsideTown !== null) {
      // Off the site, as retireOutsideMetro takes rows outside the metro.
      await db
        .update(events)
        .set({ status: "removed", mergedIntoId: null, updatedAt: new Date() })
        .where(and(eq(events.id, row.id), isNull(events.venueId)));
      await releaseMergedInto(db, row.id);
      removed.push(
        `${row.title} on ${row.night} (${cached.url} gives "${cached.place.address}", in ${outsideTown})`,
      );
      continue;
    }

    // Check if the event-page venue matches a known venue (D-266)
    const knownPlace = knownVenuePlace(
      { name: cached.place.name ?? row.venue_name, address: cached.place.address },
      args.known,
      args.metro.countryCode,
    );

    let address: string;
    let name: string | null;
    let location: { lat: number; lng: number } | null;
    let skipPostcodeGate = false;
    let skipElsewhere = false;

    if (knownPlace) {
      // Known venue match: use its address and point, skip postcode and elsewhere checks
      address = knownPlace.address;
      name = knownPlace.name ?? cached.place.name ?? row.venue_name;
      location = knownPlace.point ?? cached.place.location;
      skipPostcodeGate = true;
      skipElsewhere = true;
    } else {
      // No known match: proceed with original event-page data
      address = cached.place.address;
      name = cached.place.name ?? row.venue_name;
      location = cached.place.location;
      skipPostcodeGate = false;
      skipElsewhere = false;
    }

    if (!skipPostcodeGate && !hasPostcode(address, args.metro.countryCode)) {
      const word = postcodeWord(args.metro.countryCode);
      notes.push(
        `${row.title} on ${row.night}: ${cached.url} gives "${address}", with no ${word}; left unplaced`,
      );
      continue;
    }
    if (!skipElsewhere && args.elsewhere) {
      const where = await args.elsewhere(address);
      if (where !== null) {
        // Off the site, as retireOutsideMetro takes rows outside the metro.
        await db
          .update(events)
          .set({ status: "removed", mergedIntoId: null, updatedAt: new Date() })
          .where(and(eq(events.id, row.id), isNull(events.venueId)));
        await releaseMergedInto(db, row.id);
        removed.push(`${row.title} on ${row.night} (${cached.url} puts it in ${where})`);
        continue;
      }
    }
    const venue = await args.placeVenue(
      {
        name,
        address,
        url: null,
        location,
      },
      location !== null,
    );
    if (!venue) {
      const shownAddress = knownPlace ? knownPlace.address : cached.place.address;
      notes.push(
        `${row.title} on ${row.night}: ${cached.url} gives "${shownAddress}", which did not place`,
      );
      continue;
    }
    const updated = await db
      .update(events)
      .set({ venueId: venue.venueId, geo: venue.location, updatedAt: new Date() })
      .where(and(eq(events.id, row.id), isNull(events.venueId)))
      .returning({ id: events.id });
    if (updated.length === 0) continue;

    const fields: Array<["venue_address" | "venue_name", string]> = [["venue_address", address]];
    const nameToWrite = knownPlace ? (name !== row.venue_name ? name : null) : cached.place.name;
    if (nameToWrite !== null) {
      fields.push(["venue_name", nameToWrite]);
    }

    for (const [field, value] of fields) {
      await db
        .update(fieldProvenance)
        .set({ isCurrent: false })
        .where(
          and(
            eq(fieldProvenance.entityType, "event"),
            eq(fieldProvenance.entityId, row.id),
            eq(fieldProvenance.field, field),
            eq(fieldProvenance.sourceId, row.source_id),
            eq(fieldProvenance.isCurrent, true),
          ),
        );

      await db.insert(fieldProvenance).values({
        entityType: "event",
        entityId: row.id,
        field,
        value,
        sourceId: row.source_id,
        sourceUrl: cached.url,
        fetchedAt: cached.fetchedAt,
        evidence: cached.place.evidence,
        method: "jsonld",
        isCurrent: true,
      });
    }

    placed.push(`${row.title} on ${row.night}`);
  }

  const finalNotes: string[] = [];
  if (placed.length > 0) {
    const first12 = placed.slice(0, 12).join("; ");
    const more = placed.length > 12 ? `, and ${placed.length - 12} more` : "";
    finalNotes.push(
      `${placed.length} listing(s) with no venue were placed from their event page's venue: ${first12}${more}`,
    );
  }
  if (removed.length > 0) {
    const first12 = removed.slice(0, 12).join("; ");
    const more = removed.length > 12 ? `, and ${removed.length - 12} more` : "";
    finalNotes.push(
      `${removed.length} listing(s) whose event page puts them outside ${args.metro.name} were taken off the site: ${first12}${more}`,
    );
  }
  if (leftOver > 0) {
    finalNotes.push(
      `${leftOver} listing(s) with an event page were left for a later run (${limit} pages a run)`,
    );
  }
  const maxNotes = 20;
  const rowNotes = notes.slice(0, maxNotes);
  finalNotes.push(...rowNotes);
  if (notes.length > maxNotes) {
    finalNotes.push(`and ${notes.length - maxNotes} more`);
  }

  return { asked, placed: placed.length, removed: removed.length, notes: finalNotes };
}
