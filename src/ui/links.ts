// Which page outside the app a listing links to, and in what words (D-069, D-073). The card, the
// map's card and the event page all ask here, so a night is never "Tickets" in one place and an
// "Event page" in another, and a page that only lists the night is never called its event page.
// Pure: no JSX, no I/O. Every word comes from src/i18n.

import { isPlatformEventPage, looksLikeEventPage } from "@/src/domain/event-links";
import type { Listing } from "@/src/domain/listing";
import { t } from "@/src/i18n";

/** "midtownhop.com" for a link; the URL itself when it cannot be parsed. */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/**
 * How the night turned out, when it is over for a dancer: cancelled (by the source, or by its
 * status) or ended. Null while it is still ahead or on. The date line then carries the word, the
 * action row stops selling tickets, and directions and calendar step down to secondary (D-069).
 */
export function nightOutcome(listing: Listing): "cancelled" | "ended" | null {
  if (listing.confirmation === "cancelled" || listing.liveStatus?.kind === "cancelled") {
    return "cancelled";
  }
  if (listing.liveStatus?.kind === "ended") return "ended";
  return null;
}

export interface OutboundLinks {
  /** A page that sells or books the night; null when none is listed or the night is over. */
  tickets: string | null;
  /** The event's own page, when there is one and it is not the ticket page. */
  eventPage: string | null;
}

/**
 * Which link is "Get tickets" and which is only the event's page (D-069, D-073). Only a page that
 * can be one event's counts for either (src/domain/event-links.ts): a site's home page or a list
 * of its nights is never "Tickets" and never "Event page".
 *
 * Tickets: the listing's ticket URL, else a ticket seller's own page for the event (a source row
 * of the ticketing tier). A listings site's own page for an event sells nothing ("Get tickets" on
 * The Ronda opened its event listing), so a ticket URL on the host of a source that is not the
 * organiser's is the event page instead; so is one on an event platform (a Facebook, Meetup or
 * Partiful event), which hosts the event's page and sells nothing.
 *
 * Event page: each source's own page for the event, primary source first (event_sources.event_url,
 * D-073); else the canonical URL, as rows stored under D-070 carry it, when it is not one of the
 * listing's source rows (the store falls back to the page a listing was read from, usually a list
 * of many nights); else a listings site's page demoted from the tickets.
 *
 * A cancelled or ended night sells no tickets: the ticket link is left out, and the ticket page
 * stays as the event page when there is no other, since it may say why the night is off.
 */
export function outboundLinks(listing: Listing): OutboundLinks {
  const directoryHosts = new Set(
    listing.sources.filter((source) => !source.byOrganiser).map((source) => hostOf(source.url)),
  );
  const sourceUrls = new Set(listing.sources.map((source) => source.url));

  let tickets: string | null = null;
  const demoted: string[] = [];
  const ticketCandidates = [
    listing.ticketUrl,
    ...listing.sources.filter((s) => s.tier === "ticketing").map((s) => s.eventUrl),
  ];
  for (const url of ticketCandidates) {
    if (url === null || !looksLikeEventPage(url)) continue;
    // A Facebook, Meetup or Partiful event is the event's own page and sells nothing (review
    // #22): an event page, never "Tickets".
    if (directoryHosts.has(hostOf(url)) || isPlatformEventPage(url)) demoted.push(url);
    else tickets ??= url;
  }

  const canonical = listing.canonicalUrl;
  const eventCandidates = [
    ...listing.sources.filter((s) => s.tier !== "ticketing").map((s) => s.eventUrl),
    canonical !== null && !sourceUrls.has(canonical) ? canonical : null,
    ...demoted,
  ];
  const eventPage =
    eventCandidates.find(
      (url): url is string => url !== null && url !== tickets && looksLikeEventPage(url),
    ) ?? null;

  if (nightOutcome(listing) !== null) return { tickets: null, eventPage: eventPage ?? tickets };
  return { tickets, eventPage };
}

/** Which of the three a listing's link is: a page that sells it, its own page, or a list. */
export type EventLinkKind = "tickets" | "event" | "listed";

export interface EventLink {
  kind: EventLinkKind;
  href: string;
  /** The host the words name: "theronda.us". */
  site: string;
  /** "Tickets at ticketmaster.com", "Event page at theronda.us", "Listed on cdny.org". */
  text: string;
}

/** Shorter titles are too likely to be a menu word on the page ("Salsa") to scroll to. */
const MIN_FRAGMENT_TITLE = 4;

/**
 * The page a listing was read from, scrolled to the listing's title: a text fragment
 * (`#:~:text=`, WICG Scroll to Text Fragment). A browser that cannot find the words, or does not
 * know the syntax, opens the page at its top, so a title the page words differently costs
 * nothing. A URL that already has a fragment is left alone. "-", "&" and "," are the syntax's own
 * characters, so they are percent-encoded along with everything encodeURIComponent encodes.
 */
export function withTextFragment(url: string, title: string): string {
  const words = title.trim().replace(/\s+/g, " ");
  if (words.length < MIN_FRAGMENT_TITLE || url.includes("#")) return url;
  return `${url}#:~:text=${encodeURIComponent(words).replace(/-/g, "%2D")}`;
}

/**
 * The one link out a listing shows beside its card, in the map's card and on its own page
 * (D-073), in this order:
 *   1. a page selling tonight's night, while it is not over: "Tickets at {site}";
 *   2. the event's own page (on a listings site, the organiser's site or, once the night is over,
 *      the ticket seller's): "Event page at {site}";
 *   3. otherwise the page it was read from, scrolled to its title: "Listed on {site}";
 *   4. no source at all: null, and nothing is drawn.
 * Tickets come first because the event page puts "Get tickets" first (D-069), so the card never
 * promotes a link the page demotes. Not for a night with no start time that has its own page
 * (D-572): its ticket page may already be gone, so the card links the event page.
 */
export function eventLink(listing: Listing): EventLink | null {
  const { tickets, eventPage } = outboundLinks(listing);
  // D-572: a night with no start time cannot tell when its ticket sales close (Flushing Town
  // Hall's ovationtix page said "Production Not Found" that evening), so its card links the
  // event's own page; "Get tickets" stays on the listing's page.
  const untimedWithPage = listing.startsAt === null && eventPage !== null;
  if (tickets !== null && !untimedWithPage) {
    const site = hostOf(tickets);
    return { kind: "tickets", href: tickets, site, text: t("links.ticketsAt", { site }) };
  }
  if (eventPage !== null) {
    const site = hostOf(eventPage);
    return { kind: "event", href: eventPage, site, text: t("links.eventPageAt", { site }) };
  }
  const source = listing.sources[0];
  if (source === undefined) return null;
  const site = hostOf(source.url);
  return {
    kind: "listed",
    href: withTextFragment(source.url, listing.title),
    site,
    text: t("links.listedOn", { site }),
  };
}
