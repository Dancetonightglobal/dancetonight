// What kind of page a URL is, as far as its host and path say (D-073): one event's own page, a
// ticket seller's page for one event, or a page that is not one event's (a site's home page, a
// list of events, a venue, tag or author page, a ticket seller's organiser page). Pure: the URL is
// all it reads, so the ingest that stores a link and the card that shows it apply the same rules.
//
// It is deliberately conservative. A page it cannot place is not an event page, so a card falls
// back to "Listed on" rather than calling a list of fifty nights "Event page". The rules are
// English-language paths; a city whose sites use other words gets fewer event pages, never a
// wrong one.
//
// Kept free of heavy imports on purpose: the card imports this through src/ui/links.ts, and the
// map's card is a client component, so whatever this file imports ships to the browser. Reading a
// page for its links lives in src/domain/event-link-matcher.ts, which only the ingest imports.

/**
 * Ticket sellers, and the path each one gives a single event: host, then path. A brand's host is
 * anchored to the registrable domains it really uses ("eventbrite.co.uk", not any host that starts
 * "eventbrite."), so "eventbrite.com.evil.example" is nobody's ticket page (review #8).
 */
/** Eventbrite's own hosts, on the registrable domains it uses; the Eventbrite adapter shares it. */
export const EVENTBRITE_HOST =
  /(^|\.)eventbrite\.(?:com|ca|co\.uk|com\.au|co\.nz|ie|de|fr|es|it|nl|be|at|ch|pt|se|dk|fi|sg|hk|com\.mx|com\.br|com\.ar|cl|com\.co|com\.pe)$/;

const TICKETING: ReadonlyArray<readonly [RegExp, RegExp]> = [
  [EVENTBRITE_HOST, /^\/e\//],
  [
    /(^|\.)ticketmaster\.(?:com|ca|co\.uk|ie|de|fr|es|it|nl|be|at|ch|dk|fi|no|se|pl|com\.au|co\.nz|com\.mx|co\.za|ae)$/,
    /\/event\//,
  ],
  [/(^|\.)livenation\.(?:com|co\.uk|ca|com\.au|co\.nz|ie|de|fr|es|it|nl|be|se)$/, /\/event\//],
  [/(^|\.)ticketweb\.(?:com|ca|co\.uk|ie)$/, /\/event\//],
  [/(^|\.)dice\.fm$/, /^\/event\//],
  [/(^|\.)ra\.co$/, /^\/events\/\d+/],
  [/(^|\.)tixr\.com$/, /\/events\//],
  [/(^|\.)universe\.com$/, /^\/events\//],
  [/(^|\.)withfriends\.co$/, /^\/event\//],
  [/(^|\.)posh\.vip$/, /^\/e\//],
  [/(^|\.)axs\.com$/, /^\/events\//],
  [/(^|\.)seetickets\.(?:com|us|fr|nl|de)$/, /\/event\//],
  [/(^|\.)etix\.com$/, /^\/ticket\//],
  [/(^|\.)tickettailor\.com$/, /^\/events\//],
  // Humanitix gives each event a page on events.humanitix.com; humanitix.com itself is the
  // seller's own site (search, sign-in, its blog), never one event's page.
  [/^events\.humanitix\.com$/, /^\/[^/]+\/?$/],
  [/(^|\.)humanitix\.com$/, /(?!)/],
  [/(^|\.)simpletix\.com$/, /^\/e\//],
  [/(^|\.)showclix\.com$/, /^\/event\//],
  [/(^|\.)zeffy\.com$/, /\/ticketing\//],
  [/(^|\.)shotgun\.live$/, /\/events\//],
];

/**
 * Sites that host a page for one event without selling it: an RSVP or a listing (review #18, #22).
 * Their single-event page is the event's own page, never "Tickets"; their other pages (a Meetup
 * group, a Facebook page) are not one event's.
 */
const EVENT_PLATFORMS: ReadonlyArray<readonly [RegExp, RegExp]> = [
  [/(^|\.)partiful\.com$/, /^\/e\/[^/]+/],
  [/(^|\.)meetup\.com$/, /\/events\/\d+/],
  [/(^|\.)(?:facebook|fb)\.com$/, /^\/events\/\d+/],
];

/**
 * Hosts that are never one event's page: social profiles, link lists, videos, maps and payment
 * pages (review #23). Facebook's event pages are an event platform's (above); the rest of
 * Facebook is refused there.
 */
const NOT_EVENT_HOST =
  /(^|\.)(?:instagram\.com|instagr\.am|linktr\.ee|youtube\.com|youtu\.be|linkedin\.com|tiktok\.com|x\.com|twitter\.com|paypal\.com|paypal\.me|venmo\.com|maps\.apple\.com|maps\.app\.goo\.gl)$|^maps\.google\./;

/** Google Maps on a Google host ("google.com/maps/place/…", "goo.gl/maps/…"). */
const MAPS_PATH_HOST = /(^|\.)(?:google\.[a-z.]+|goo\.gl)$/;

/** Paths that are never one event's page: taxonomy, people, places, the site's own chrome. */
const NOT_EVENT_PATH =
  /\/(?:venue|venues|location|locations|organi[sz]ers?|organi[sz]ations?|groups?|places?|clubs?|studios?|teachers?|instructors?|djs?|members?|profiles?|users?|people|author|category|categories|tag|tags|cart|search|login|account|about(?:-us)?|contact(?:-us)?|blog|news|post|articles?|ambassadors?|artists?|store|shop|merch|donate|join|get-involved|membership|volunteer|support(?:-us)?|subscribe|newsletter|faq|privacy(?:-policy)?|terms|policies|gift-cards?)(?:\/|$)|[?&](?:category|tag|month|view|dir)=/i;

/**
 * The last segment of a list of a site's events (review #23): "events", "calendar", "schedule",
 * "classes", "socials", "milongas", "lessons", wherever they sit ("/nyc/events"), with a year in
 * front ("2026-calendar"), a copy number ("events-1") or more words after a plural or a calendar
 * ("events-calendar-kizomba", "social-dances-parties.html"). A singular "event" is a list only
 * bare or as "event-1" / "event-calendar…", since "/e/event-night" can be one event. Also "agenda", "eventos",
 * "evenements": a venue's calendar in Spanish, Catalan or French (Marula Café /agenda/, D-804).
 */
const COLLECTION_SEGMENT =
  /^(?:\d{4}-)?(?:(?:events|eventos|evenements|agenda|classes|lessons|socials|milongas|calendars?|schedules?|upcoming|whats-on|all-events|calendar-events|social-dances|upcoming-events)(?:-[\w-]*)?|(?:event|social|class)(?:-\d+|-(?:calendar|list|schedule)[\w-]*)?)(?:\.(?:html?|php|aspx?))?$/i;

/** A view of the list under /events/: The Events Calendar's list, month, day and so on. */
const COLLECTION_VIEW =
  /\/events?\/(?:list|month|week|day|today|photo|map|upcoming|past)(?:\/|$)|\/events?\/\d{4}-\d\d(?:-\d\d)?\/?$/i;

/** A bare locale segment: "/en", "/en-us", "/pt-br". */
const LOCALE_SEGMENT = /^[a-z]{2}(?:[-_][a-z]{2})?$/i;

/** Query keys that only pick a page of the site, not an event: "/?page_id=12", "/?lang=en". */
const PAGE_ONLY_QUERY = /^(?:page_id|p|page|paged|lang|locale|hl|s)$/i;

/** The URL parsed, or null when it is not an http(s) URL. */
export function parseHttpUrl(url: string): URL | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * A template link nobody filled in: an id like 1234567890, 0123456789 or 00000000 standing alone in
 * the path or query (itsmenna.com's "tickets-1234567890" Eventbrite link, D-745).
 */
export function isPlaceholderLink(url: string): boolean {
  const parsed = parseHttpUrl(url);
  if (parsed === null) return false;
  return /(?:^|\D)(?:0?1234567890?|(\d)\1{7,})(?:\D|$)/.test(parsed.pathname + parsed.search);
}

/** True for any page on a ticket seller's site, one event's or not. */
export function isTicketingHost(url: string): boolean {
  const parsed = parseHttpUrl(url);
  if (parsed === null) return false;
  const host = parsed.hostname.toLowerCase();
  return TICKETING.some(([h]) => h.test(host));
}

/** True for a ticket seller's page for one event: Eventbrite /e/, Ticketmaster /event/, and so on. */
export function isTicketingEventPage(url: string): boolean {
  const parsed = parseHttpUrl(url);
  if (parsed === null) return false;
  const host = parsed.hostname.toLowerCase();
  return TICKETING.some(([h, p]) => h.test(host) && p.test(parsed.pathname));
}

/** True for any page on an event platform (Facebook, Meetup, Partiful), one event's or not. */
export function isPlatformHost(url: string): boolean {
  const parsed = parseHttpUrl(url);
  if (parsed === null) return false;
  const host = parsed.hostname.toLowerCase();
  return EVENT_PLATFORMS.some(([h]) => h.test(host));
}

/**
 * True for an event platform's page for one event: facebook.com/events/<id>, a Meetup group's
 * /events/<id>, partiful.com/e/<id>. One event's own page, which sells nothing: never "Tickets".
 */
export function isPlatformEventPage(url: string): boolean {
  const parsed = parseHttpUrl(url);
  if (parsed === null) return false;
  const host = parsed.hostname.toLowerCase();
  return EVENT_PLATFORMS.some(([h, p]) => h.test(host) && p.test(parsed.pathname));
}

/** True for one event's page on a site that hosts many organisers' events: a seller or a platform. */
export function isHostedEventPage(url: string): boolean {
  return isTicketingEventPage(url) || isPlatformEventPage(url);
}

/** True for a social profile, link list, video, map or payment page: never one event's. */
export function isNotEventHost(url: string): boolean {
  const parsed = parseHttpUrl(url);
  if (parsed === null) return false;
  const host = parsed.hostname.toLowerCase();
  if (NOT_EVENT_HOST.test(host)) return true;
  return MAPS_PATH_HOST.test(host) && /^\/maps(?:\/|$)/i.test(parsed.pathname);
}

/** The path's segments, without empty ones. */
function segmentsOf(parsed: URL): string[] {
  return parsed.pathname.split("/").filter(Boolean);
}

/**
 * A site's front page: no path beyond "/", "/home", "/index.html" or a bare locale ("/en/"), and
 * no query but one that only picks a page ("/?page_id=12", "/?lang=en").
 */
export function isHomePage(url: string): boolean {
  const parsed = parseHttpUrl(url);
  if (parsed === null) return false;
  let segments = segmentsOf(parsed);
  if (segments.length > 0 && LOCALE_SEGMENT.test(segments[0]!)) segments = segments.slice(1);
  const home =
    segments.length === 0 ||
    (segments.length === 1 && /^(?:home|index\.(?:html?|php|aspx?))$/i.test(segments[0]!));
  if (!home) return false;
  return [...parsed.searchParams.keys()].every((key) => PAGE_ONLY_QUERY.test(key));
}

/** "/events", "/nyc/calendar", "/events-1", "/events/list/" and the like: the list, not an event on it. */
export function isCollectionPage(url: string): boolean {
  const parsed = parseHttpUrl(url);
  if (parsed === null) return false;
  const last = segmentsOf(parsed).pop();
  return (
    (last !== undefined && COLLECTION_SEGMENT.test(last)) || COLLECTION_VIEW.test(parsed.pathname)
  );
}

/**
 * Whether a URL can be one event's own page (D-073). Not a home page, a list of events, or a
 * taxonomy, venue, people or chrome page, and never a social profile, map or payment page; on a
 * ticket seller's or event platform's site, only its path for a single event (an Eventbrite
 * organiser page lists every night that organiser sells, a Meetup group page every meetup).
 */
export function looksLikeEventPage(url: string): boolean {
  const parsed = parseHttpUrl(url);
  if (parsed === null || isNotEventHost(url)) return false;
  if (isTicketingHost(url)) return isTicketingEventPage(url);
  if (isPlatformHost(url)) return isPlatformEventPage(url);
  if (isHomePage(url) || isCollectionPage(url)) return false;
  return !NOT_EVENT_PATH.test(`${parsed.pathname}${parsed.search}`);
}
