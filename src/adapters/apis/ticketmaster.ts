// Ticketmaster Discovery API v2 (SOURCES 2.1): the `ticketmaster` adapter. A metro-wide search,
// so it implements `harvestMetro` rather than `harvest`.
//
// Ticketmaster lists everything (sports, theatre, concerts), so the adapter asks focused
// questions and keeps an event only when its classification or its words name a dance
// (`danceRelevance`):
// - one query for the Dance/Electronic genre (club nights), and one per dance keyword;
// - an event is kept when its genre is Dance/Electronic, when a style matches in its name, or when
//   its name says it is a dance or a party;
// - a concert whose genre alone names a dance music (Latin/Salsa, World/Kompa, Reggae/Soca) is
//   live music with dancing at a club, and left out at an arena or a stadium (the owner, PR 2);
// - stage dance (the Arts & Theatre segment's Dance genre: ballet, companies, recitals) is left
//   out unless its name says it is participatory: DanceTonight lists places to dance, not to watch.
// Every event left out that a genre named a dance for is named in the run report.
//
// Every request carries the key in the query string, so recorded fixtures mask it (the tests run
// with the key "REDACTED"). Spacing is 250 ms, under the documented 5 requests a second
// (unverified; SOURCES 2.1), and deep paging stops at the API's 1,000-result window.

import { familyOf, matchStyles, normalizeForMatch, type StyleKey } from "@/config/styles";
import { TM_NOT_DANCE_NIGHTS } from "@/config/sources/ticketmaster";
import { priceRangeLabel } from "@/src/domain/price-range";
import { httpUrl, plainText, sha256, type LocalMoment } from "@/src/adapters/shared";
import { buildListing } from "@/src/adapters/structured";
import type {
  HarvestedListing,
  HarvestResult,
  Metro,
  NightDate,
  RunCtx,
  SourceAdapter,
} from "@/src/adapters/types";
import type { ListingPrice, Point } from "@/src/domain/listing";
import type { ListingType } from "@/src/domain/listing-types";
import { addCalendarDays, isValidZone, localInstant } from "@/src/domain/time";
import { NIGHT_BOUNDARY_HOUR } from "@/src/domain/tonight";

export const TICKETMASTER_BASE = "https://app.ticketmaster.com/discovery/v2/events.json";
export const TICKETMASTER_PAGE_SIZE = 200;
/** The API refuses page * size beyond 1,000. */
export const TICKETMASTER_MAX_PAGES = 5;

export const TICKETMASTER_QUERIES: ReadonlyArray<Record<string, string>> = [
  { classificationName: "Dance/Electronic" },
  { keyword: "salsa" },
  { keyword: "bachata" },
  { keyword: "kizomba" },
  { keyword: "swing dance" },
  { keyword: "tango" },
  { keyword: "ballroom" },
  { keyword: "line dancing" },
  { keyword: "latin night" },
  { keyword: "dance party" },
  { keyword: "silent disco" },
  { keyword: "reggaeton" },
];

/**
 * Keywords on trial (D-132): the coverage sweep's list of dances and party words Ticketmaster is
 * not asked about yet. Each costs one request a run or more. Every run's report says, for each,
 * how many events it found, how many were kept, and how many only it found; the integrator reads
 * the first recorded runs and a keyword that adds nothing is dropped.
 */
export const TICKETMASTER_TRIAL_QUERIES: ReadonlyArray<Record<string, string>> = [
  { keyword: "hustle" },
  { keyword: "zouk" },
  { keyword: "two step" },
  { keyword: "country dance" },
  { keyword: "contra dance" },
  { keyword: "ecstatic dance" },
  { keyword: "afrobeats" },
  { keyword: "amapiano" },
  { keyword: "dancehall" },
  { keyword: "soca" },
  { keyword: "bhangra" },
  { keyword: "bollywood" },
  { keyword: "cumbia" },
  { keyword: "merengue" },
  { keyword: "disco" },
  { keyword: "open format" },
  { keyword: "emo night" },
  { keyword: "y2k" },
  { keyword: "2000s" },
  { keyword: "throwback" },
];

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** The window as UTC instants: the first night's 06:00 to the morning after the last night. */
export function windowUtc(nights: NightDate[], zone: string): { start: string; end: string } {
  const first = nights[0]!;
  const last = nights[nights.length - 1]!;
  const fmt = (d: Date) => `${d.toISOString().slice(0, 19)}Z`;
  return {
    start: fmt(localInstant(first, zone, NIGHT_BOUNDARY_HOUR)),
    end: fmt(localInstant(addCalendarDays(last, 1), zone, NIGHT_BOUNDARY_HOUR)),
  };
}

export function ticketmasterUrl(
  metro: Metro,
  nights: NightDate[],
  query: Record<string, string>,
  apiKey: string,
  page = 0,
): string {
  const { start, end } = windowUtc(nights, metro.tz);
  const url = new URL(TICKETMASTER_BASE);
  url.searchParams.set("apikey", apiKey);
  url.searchParams.set("latlong", `${metro.center.lat.toFixed(4)},${metro.center.lng.toFixed(4)}`);
  url.searchParams.set("radius", String(Math.round(metro.radiusKm)));
  url.searchParams.set("unit", "km");
  url.searchParams.set("startDateTime", start);
  url.searchParams.set("endDateTime", end);
  url.searchParams.set("size", String(TICKETMASTER_PAGE_SIZE));
  url.searchParams.set("page", String(page));
  url.searchParams.set("sort", "date,asc");
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  return url.toString();
}

interface Classification {
  segment: string | null;
  genre: string | null;
  subGenre: string | null;
}

function classificationOf(event: Json): Classification {
  const c = arr(event.classifications).find(isObject) ?? {};
  const name = (v: unknown) => (isObject(v) ? str(v.name) : null);
  const clean = (v: string | null) => (v && v !== "Undefined" ? v : null);
  return {
    segment: clean(name(c.segment)),
    genre: clean(name(c.genre)),
    subGenre: clean(name(c.subGenre)),
  };
}

/**
 * The headliner's own classification: the first attraction's, and only the first. A support act
 * is not the night (any attraction would make Harry Styles's arena show a club night through a
 * DJ who opens it). Null when the event names no attraction.
 */
export function headlinerOf(event: Json): Classification | null {
  const embedded = isObject(event._embedded) ? event._embedded : {};
  const first = arr(embedded.attractions).find(isObject);
  return first ? classificationOf(first) : null;
}

/**
 * Ticketmaster's sub-genre for pop singers who play to a dancefloor (Dadi Freyr, Mind
 * Enterprises): a concert, not a club night, when it is all that says "dance".
 */
const DANCE_POP = /^dance pop$/i;

const PARTICIPATORY =
  /\b(social|party|night|class|lesson|workshop|dance party|dancing|club|fiesta|rave|disco)\b/i;

/** A name that says the event is a dance ("Country Line Dancing", "Silent Disco"). */
const NAMED_DANCE = /\b(dance party|dance night|dancing|line dance|silent disco)\b/i;
/** A name that says the event is a party ("Everybody Loves Drake: A Party"): a club night. */
const NAMED_PARTY = /\b(party|fiesta|rave|club night|dj set)\b/i;

/**
 * A room built for seated or stadium crowds, by its name: Barclays Center, Madison Square Garden,
 * UBS Arena, Citi Field, Flushing Meadows Corona Park. A name that also names a ballroom, club,
 * hall or bar is a room of its own ("Manhattan Center Hammerstein Ballroom", "Bohemian Hall & Beer
 * Garden"). Ticketmaster gives no capacity, so the name is all there is; a stadium-sized theatre
 * ("Jones Beach Theater") is missed.
 */
const BIG_VENUE =
  /\b(arena|stadium|coliseum|colosseum|amphitheat(?:er|re)|ballpark|field|dome|park|garden|center|centre)\b/i;
const OWN_ROOM = /\b(ballroom|club|hall|lounge|bar|room|black box|beer garden|caf[eé])\b/i;

export function isBigVenue(venueName: string | null): boolean {
  return !!venueName && BIG_VENUE.test(venueName) && !OWN_ROOM.test(venueName);
}

/**
 * The dances Ticketmaster's genre and sub-genre name ("Latin / Salsa", "World / Kompa", "Reggae /
 * Soca"). Rap is music to listen to: a hip-hop concert is no breaking night and no hip-hop party.
 */
function genreStyles(c: Classification): StyleKey[] {
  const named = [c.genre, c.subGenre].filter(Boolean).join(" | ");
  if (!named) return [];
  return matchStyles(named).styles.filter((s) => s !== "hip_hop_club" && familyOf(s) !== "hiphop");
}

/** "Latin / Salsa"; a sub-genre that repeats its genre ("Hip-Hop/Rap") is said once. */
function genreLabel(c: Classification): string {
  return [...new Set([c.genre, c.subGenre].filter(Boolean))].join(" / ");
}

/** Whether Ticketmaster's genre or sub-genre names any style at all, rap included. */
export function genreNamesAStyle(c: Classification): boolean {
  const named = [c.genre, c.subGenre].filter(Boolean).join(" | ");
  return !!named && matchStyles(named).styles.length > 0;
}

/** Check if a title is in the metro's list of not-dance nights (case-insensitive). */
export function isTmNotDanceNight(title: string, metroSlug: string): boolean {
  const normalizedTitle = normalizeForMatch(title).trim();
  if (!normalizedTitle) return false;
  const list = TM_NOT_DANCE_NIGHTS[metroSlug];
  if (!list) return false;
  return list.some((t) => normalizeForMatch(t).trim() === normalizedTitle);
}

/** Whether an event is somewhere to dance, with the styles and type that say so. */
export function danceRelevance(
  name: string,
  c: Classification,
  venueName: string | null = null,
  headliner: Classification | null = null,
): { keep: boolean; styles: StyleKey[]; type: ListingType | null; reason: string } {
  // Styles come from the name: a genre names the music, not a dance (Hip-Hop/Rap is not breaking),
  // and Ticketmaster's sub-genre "Amapiano" sat on six events of which none was amapiano (run 33).
  const styles = matchStyles(name).styles;
  if (c.segment === "Sports") return { keep: false, styles, type: null, reason: "sports" };
  const stageDance = c.segment === "Arts & Theatre" && /dance/i.test(c.genre ?? "");
  if (stageDance && !PARTICIPATORY.test(name))
    return { keep: false, styles, type: null, reason: "stage dance" };
  // A club night that names no style is a DJ night, as RA, Skiddle and Bugece tag it (D-771: D-757 screens its
  // "World Tour" concerts).
  const clubStyles: StyleKey[] = styles.length > 0 ? styles : ["dj_night"];
  if (c.genre === "Dance/Electronic") {
    return { keep: true, styles: clubStyles, type: "club_night", reason: "genre Dance/Electronic" };
  }
  // An event Ticketmaster files under "Other" (or under nothing) says what it is through its
  // headliner: Dusky at Elsewhere, Kruder & Dorfmeister and NOTD were filed Music / Other while
  // their own classification is Dance/Electronic (run 33, D-132).
  if (
    (c.genre === null || c.genre === "Other") &&
    headliner?.genre === "Dance/Electronic" &&
    !DANCE_POP.test(headliner.subGenre ?? "")
  ) {
    return {
      keep: true,
      styles: clubStyles,
      type: "club_night",
      reason: "headliner's genre Dance/Electronic",
    };
  }
  if (styles.length > 0)
    return { keep: true, styles, type: null, reason: `styles ${styles.join(", ")}` };
  if (NAMED_DANCE.test(name)) return { keep: true, styles, type: null, reason: "named as a dance" };
  if (NAMED_PARTY.test(name))
    return { keep: true, styles, type: "club_night", reason: "named as a party" };
  // A salsa orquesta, a kompa band or a soca artist at a club is live music people dance to; the
  // same genre at an arena is a concert watched from a seat (the owner's answer, PR 2).
  const fromGenre = genreStyles(c);
  const genre = genreLabel(c);
  if (fromGenre.length > 0 && isBigVenue(venueName)) {
    return {
      keep: false,
      styles: [],
      type: null,
      reason: `a ${genre} concert at an arena or stadium`,
    };
  }
  if (fromGenre.length > 0) {
    return {
      keep: true,
      styles: fromGenre,
      type: "live_music_with_dancing",
      reason: `genre ${genre}: live dance music`,
    };
  }
  return { keep: false, styles, type: null, reason: "not a dance" };
}

function venueOf(event: Json): {
  name: string | null;
  address: string | null;
  location: Point | null;
  tz: string | null;
} {
  const embedded = isObject(event._embedded) ? event._embedded : {};
  const venue = arr(embedded.venues).find(isObject);
  if (!venue) return { name: null, address: null, location: null, tz: null };
  const address = isObject(venue.address) ? str(venue.address.line1) : null;
  const city = isObject(venue.city) ? str(venue.city.name) : null;
  const state = isObject(venue.state) ? str(venue.state.stateCode) : null;
  const loc = isObject(venue.location) ? venue.location : null;
  const lat = loc ? Number(loc.latitude) : NaN;
  const lng = loc ? Number(loc.longitude) : NaN;
  return {
    name: str(venue.name),
    address: [address, city, state, str(venue.postalCode)].filter(Boolean).join(", ") || null,
    location:
      Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0)
        ? { lat, lng }
        : null,
    tz: str(venue.timezone),
  };
}

function pricesOf(event: Json): ListingPrice[] | null {
  const rows: ListingPrice[] = [];
  for (const range of arr(event.priceRanges).filter(isObject)) {
    const currency = str(range.currency)?.toUpperCase();
    const min = typeof range.min === "number" ? range.min : null;
    const max = typeof range.max === "number" ? range.max : null;
    if (!currency || currency.length !== 3 || min === null) continue;
    const label = range.type === "standard including fees" ? "Including fees" : "Tickets";
    if (max !== null && max > min)
      rows.push({
        label: priceRangeLabel(label, min, max, currency),
        amount: null,
        currency,
        includes: null,
      });
    else rows.push({ label, amount: min, currency, includes: null });
  }
  return rows.length > 0 ? rows : null;
}

function localMoment(
  localDate: string | null,
  localTime: string | null,
  zone: string,
): LocalMoment | null {
  if (!localDate || !/^\d{4}-\d{2}-\d{2}$/.test(localDate)) return null;
  const time = localTime && /^\d{2}:\d{2}/.test(localTime) ? localTime.slice(0, 5) : null;
  const hour = time ? Number(time.slice(0, 2)) : 12;
  return {
    day: localDate,
    night: hour < NIGHT_BOUNDARY_HOUR ? addCalendarDays(localDate, -1) : localDate,
    time,
    zone,
    absolute: false,
  };
}

/**
 * Events Ticketmaster lists twice: one name, one venue, one start, two ids. Each such event maps
 * to the id kept in its place. Only events with a venue and a start time are compared, so two
 * untimed shows of one name at unknown venues are never one. The copy kept is, in order: one the
 * dance rules keep (so a night never vanishes because its other copy was rejected), one not
 * cancelled or postponed, one whose own classification says the most (a genre neither missing
 * nor "Other", so the copy the site already lists stays), then the smallest id, so the choice
 * never depends on the order the API answered in.
 */
export function twinsOf(events: readonly Json[]): Map<string, string> {
  const groups = new Map<string, Json[]>();
  for (const event of events) {
    const id = str(event.id);
    const name = plainText(event.name);
    if (!id || !name) continue;
    const dates = isObject(event.dates) ? event.dates : {};
    const start = isObject(dates.start) ? dates.start : {};
    const venue = venueOf(event).name;
    const day = str(start.localDate);
    const time = str(start.localTime);
    if (!venue || !day || !time) continue;
    const key = JSON.stringify([
      name.toLowerCase().replace(/\s+/g, " "),
      venue.toLowerCase(),
      day,
      time,
    ]);
    const group = groups.get(key) ?? [];
    if (!group.some((e) => str(e.id) === id)) group.push(event);
    groups.set(key, group);
  }
  const rank = (event: Json): [number, number, number, string] => {
    const c = classificationOf(event);
    const dates = isObject(event.dates) ? event.dates : {};
    const status = isObject(dates.status) ? str(dates.status.code) : null;
    const kept = danceRelevance(
      plainText(event.name) ?? "",
      c,
      venueOf(event).name,
      headlinerOf(event),
    ).keep;
    return [
      kept ? 0 : 1,
      status === "cancelled" || status === "postponed" ? 1 : 0,
      c.genre !== null && c.genre !== "Other" ? 0 : 1,
      str(event.id)!,
    ];
  };
  const before = (a: Json, b: Json) => {
    const [x, y] = [rank(a), rank(b)];
    for (let k = 0; k < 3; k++) if (x[k] !== y[k]) return (x[k] as number) - (y[k] as number);
    return x[3] < y[3] ? -1 : x[3] > y[3] ? 1 : 0;
  };
  const twins = new Map<string, string>();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const keep = [...group].sort(before)[0]!;
    for (const event of group) if (event !== keep) twins.set(str(event.id)!, str(keep.id)!);
  }
  return twins;
}

export function ticketmasterToListings(
  events: unknown[],
  options: { metro: Metro; fetchedAt: Date },
): {
  listings: HarvestedListing[];
  notes: string[];
  screened: Array<{ externalId: string; title: string; reason: string }>;
} {
  const listings: HarvestedListing[] = [];
  const notes: string[] = [];
  const screened: Array<{ externalId: string; title: string; reason: string }> = [];
  const seen = new Set<string>();
  const twins = twinsOf(events.filter(isObject));
  for (const event of events.filter(isObject)) {
    const id = str(event.id);
    const name = plainText(event.name);
    if (!id || !name || seen.has(id)) continue;
    seen.add(id);
    const twin = twins.get(id);
    if (twin) {
      // Ticketmaster lists some nights twice, under two ids and two classifications (Pauly D and
      // San Holo at Pier 17, run 33); one is kept, and a row stored for the other is retired.
      screened.push({
        externalId: `tm:${id}`,
        title: name,
        reason: `the same night as tm:${twin}, listed twice by Ticketmaster`,
      });
      notes.push(`listed twice by Ticketmaster: ${name} (tm:${twin} kept, tm:${id} left out)`);
      continue;
    }
    // Screen titles that the metro lead has checked as not dance nights.
    if (isTmNotDanceNight(name, options.metro.slug)) {
      screened.push({
        externalId: `tm:${id}`,
        title: name,
        reason: "a title the metro lead checked as not a dance night (notDanceNights)",
      });
      continue;
    }
    const c = classificationOf(event);
    const venue = venueOf(event);
    const dates = isObject(event.dates) ? event.dates : {};
    const relevance = danceRelevance(name, c, venue.name, headlinerOf(event));
    if (!relevance.keep) {
      screened.push({ externalId: `tm:${id}`, title: name, reason: relevance.reason });
      // Include and flag: a concert whose genre named a dance is left out by a rule, so say so.
      if (genreNamesAStyle(c)) {
        const day = isObject(dates.start) ? str(dates.start.localDate) : null;
        const genre = genreLabel(c);
        notes.push(
          `left out: ${name}${day ? ` on ${day}` : ""}${venue.name ? ` at ${venue.name}` : ""} ` +
            `(${relevance.reason === "not a dance" ? `Ticketmaster's genre ${genre} names the music, not a dance` : relevance.reason})`,
        );
      }
      continue;
    }

    const startInfo = isObject(dates.start) ? dates.start : {};
    const zoneRaw = str(dates.timezone) ?? venue.tz;
    const zone = zoneRaw && isValidZone(zoneRaw) ? zoneRaw : options.metro.tz;
    if (startInfo.dateTBA === true) {
      notes.push(`date not announced yet: ${name}`);
      continue;
    }
    // "Time TBA" (or no specific time) is a night with no time: it is listed as "Time not listed"
    // and, keyed on the event id, gains its time in place once Ticketmaster announces it (D-060).
    // A localTime sent beside either flag is a placeholder, not a stated time.
    const flag =
      startInfo.timeTBA === true
        ? "timeTBA"
        : startInfo.noSpecificTime === true
          ? "noSpecificTime"
          : null;
    const start = localMoment(
      str(startInfo.localDate),
      flag ? null : str(startInfo.localTime),
      zone,
    );
    if (!start) continue;
    const noTime = flag ?? "no localTime";
    const endInfo = isObject(dates.end) ? dates.end : {};
    const end = localMoment(str(endInfo.localDate), str(endInfo.localTime), zone);
    const status = isObject(dates.status) ? str(dates.status.code) : null;

    const url = httpUrl(event.url);
    listings.push(
      buildListing(
        {
          externalId: `tm:${id}`,
          title: name,
          start,
          end: end?.time && end.night === start.night ? end : null,
          description: null,
          venue: { name: venue.name, address: venue.address, url: null, location: venue.location },
          organizer: { name: null, url: null },
          prices: pricesOf(event),
          ticketUrl: url,
          // The seller's page for the event is its own page too (D-073).
          eventUrl: url,
          cancelled: status === "cancelled" || status === "postponed",
          styles: relevance.styles,
          type: relevance.type,
          evidence: {
            start: `dates.start ${start.day} ${start.time ?? noTime} ${zone}`,
            ...(relevance.type ? { listing_type: relevance.reason } : {}),
            ...(status === "cancelled" || status === "postponed"
              ? { cancelled: `dates.status ${status}` }
              : {}),
          },
        },
        {
          sourceUrl: url ?? `https://www.ticketmaster.com/event/${id}`,
          fetchedAt: options.fetchedAt,
          method: "api",
          currency: null,
        },
      ),
    );
  }
  return { listings, notes, screened };
}

/**
 * One line per trial keyword (D-132): the events it found, how many no standing query found, and
 * which of those the dance rules would list. Nothing a trial keyword alone finds is written.
 */
export function trialNotes(
  found: ReadonlyMap<Record<string, string>, ReadonlySet<string>>,
  standingIds: ReadonlySet<string>,
  wouldList: readonly HarvestedListing[],
): string[] {
  const would = new Map(
    wouldList.map((l) => [l.externalId?.replace(/^tm:/, "") ?? "", l.listing] as const),
  );
  return TICKETMASTER_TRIAL_QUERIES.map((query) => {
    const ids = [...(found.get(query) ?? [])];
    const fresh = ids.filter((id) => !standingIds.has(id));
    const adds = fresh.flatMap((id) => {
      const listing = would.get(id);
      return listing ? [`${listing.title} (${listing.local_date ?? "no date"})`] : [];
    });
    return (
      `trial keyword "${query.keyword}": ${ids.length} events, ${fresh.length} no standing query found, ` +
      `${adds.length} would be listed (not written)${adds.length ? `: ${adds.slice(0, 5).join("; ")}` : ""}`
    );
  });
}

export const ticketmasterAdapter: SourceAdapter = {
  id: "ticketmaster",
  tier: "A",
  limits: { perDomainIntervalMs: 250, rps: 4, perDay: 5000 },
  requiredEnv: ["TICKETMASTER_API_KEY"],
  async harvestMetro(metro: Metro, nights: NightDate[], ctx: RunCtx): Promise<HarvestResult> {
    const key = ctx.env.TICKETMASTER_API_KEY!;
    const standing: unknown[] = [];
    const trial: unknown[] = [];
    // The event ids each query found, to report what each trial keyword would add.
    const found = new Map<Record<string, string>, Set<string>>();
    let fetchedAt = ctx.now();
    for (const query of [...TICKETMASTER_QUERIES, ...TICKETMASTER_TRIAL_QUERIES]) {
      const ids = new Set<string>();
      found.set(query, ids);
      const into = TICKETMASTER_QUERIES.includes(query) ? standing : trial;
      for (let page = 0; page < TICKETMASTER_MAX_PAGES; page++) {
        const response = await ctx.http.request({
          url: ticketmasterUrl(metro, nights, query, key, page),
          purpose: "api",
          intervalMs: 500,
          headers: { accept: "application/json" },
        });
        fetchedAt = response.fetchedAt;
        const body = JSON.parse(response.body) as Json;
        const embedded = isObject(body._embedded) ? body._embedded : {};
        const pageEvents = arr(embedded.events);
        into.push(...pageEvents);
        for (const e of pageEvents) if (isObject(e) && str(e.id)) ids.add(str(e.id)!);
        const pageInfo = isObject(body.page) ? body.page : {};
        const totalPages = typeof pageInfo.totalPages === "number" ? pageInfo.totalPages : 0;
        if (page + 1 >= totalPages) break;
      }
    }
    // Only the standing queries write listings. What the trial keywords alone found is run
    // through the same rules and reported, never written, until a recorded run says which to keep.
    const { listings, notes, screened } = ticketmasterToListings(standing, { metro, fetchedAt });
    const standingIds = new Set<string>();
    for (const query of TICKETMASTER_QUERIES)
      for (const id of found.get(query) ?? []) standingIds.add(id);
    const trialOnly = trial.filter(
      (e) => isObject(e) && str(e.id) !== null && !standingIds.has(str(e.id)!),
    );
    const would = ticketmasterToListings(trialOnly, { metro, fetchedAt }).listings;
    notes.push(...trialNotes(found, standingIds, would));
    return {
      listings,
      notes,
      screened,
      doc: {
        url: TICKETMASTER_BASE,
        fetchedAt,
        httpStatus: 200,
        etag: null,
        lastModified: null,
        contentHash: sha256(JSON.stringify(listings.map((l) => [l.externalId, l.listing]))),
        cleanedText: null,
      },
    };
  },
};
