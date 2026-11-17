// Probing (PLAN 6.2 step 2, D-040): what a page is, and which feed to read instead of it. Pure:
// the ingest job fetches the page through the polite client and hands the HTML here.
//
// In order of preference, because a feed beats a page (PLAN 6.5):
// 1. an iCalendar link (`<link rel="alternate" type="text/calendar">`, an `.ics` or `webcal:` href);
// 2. a Google Calendar embed, every calendar it merges, read through the Calendar API (D-130);
// 3. the WordPress Events Calendar REST API, or WordPress Events Manager's /events.ics;
// 4. a Squarespace events collection;
// 5. a Tockify calendar's ICS feed;
// 6. a page naming its events' own pages (a JSON-LD ItemList, Wix event links), followed;
// 7. schema.org events in the page's own JSON-LD.
// Links to other sources found on the way (an Eventbrite organizer, a Meetup group's ICS) come
// back as `discovered`; Facebook and Instagram links come back as `social_link` sources, recorded
// for link-out and never harvested (SPEC section 4, Tier D).
//
// The HTML is hostile: it is only matched against fixed patterns, and every URL it yields is
// resolved against the page and must be http(s).

import {
  googleCalendarAdapter,
  googleCalendarEmbedUrl,
  googleCalendarIdsInHtml,
} from "@/src/adapters/apis/google-calendar";
import { extractJsonLd, findEvents, hasDatedEvent } from "@/src/adapters/feeds/jsonld";
import { eventbriteTarget } from "@/src/adapters/apis/eventbrite";
import { eventPageLinks } from "@/src/adapters/feeds/jsonld-items";
import { decodeEntities, httpUrl } from "@/src/adapters/shared";
import type { SourceCandidate, SourceKind } from "@/src/adapters/types";
import { isEventsList } from "@/src/adapters/feeds/squarespace";

export interface ProbeOutcome {
  /** What to harvest this source as. `html` when nothing structured was found. */
  kind: SourceKind;
  platform: string | null;
  /** The feed to read instead of the page, when there is one. */
  feedUrl: string | null;
  /** How it was decided, for the run report. */
  reason: string;
  /** Other sources the page links to. */
  discovered: SourceCandidate[];
  /** True when the page itself carries schema.org events. */
  hasJsonLdEvents: boolean;
  /**
   * Each feed the source holds, when it holds more than one address: a Google Calendar embed's
   * calendars, one embed address each. `feedUrl` is then one address naming them all.
   */
  feedUrls?: string[];
}

function hrefs(html: string, base: string): string[] {
  const out: string[] = [];
  // Every repetition is bounded, so a hostile page costs linear time (D-120).
  for (const m of html.matchAll(/\b(?:href|src|data-src)\s*=\s*["']([^"'<>]{1,4000})["']/gi)) {
    const raw = decodeEntities(m[1] ?? "").trim();
    const url = httpUrl(raw.replace(/^webcal:/i, "https:"), base);
    if (url) out.push(url);
  }
  return [...new Set(out)];
}

function alternateCalendar(html: string, base: string): string | null {
  for (const m of html.matchAll(/<link\b[^<>]{0,2000}>/gi)) {
    const tag = m[0];
    if (/rel\s*=\s*["']?alternate/i.test(tag) && /type\s*=\s*["']?text\/calendar/i.test(tag)) {
      const href = /href\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
      const url = href ? httpUrl(decodeEntities(href).replace(/^webcal:/i, "https:"), base) : null;
      if (url) return url;
    }
  }
  return null;
}

/**
 * The /events.ics of a WordPress Events Manager site, from where the plugin's assets live: a site
 * in a subdirectory (/blog/wp-content/...) serves it at /blog/events.ics. Assets on another host
 * (a CDN) say nothing about where WordPress is, so the page's own origin is used then.
 */
function eventsManagerFeed(html: string, pageUrl: string): string | null {
  const m = /([^"'\s()<>]{0,300})\/wp-content\/plugins\/events-manager\//i.exec(html);
  if (!m) return null;
  const page = new URL(pageUrl);
  const base = httpUrl(`${m[1] || ""}/`, pageUrl);
  const root = base && new URL(base).host === page.host ? base : `${page.origin}/`;
  return new URL("events.ics", root).toString();
}

const MEETUP_GROUP = /^https?:\/\/(?:www\.)?meetup\.com\/([a-z0-9-]+)\/?(?:events\/?)?$/i;

export function probePage(pageUrl: string, html: string): ProbeOutcome {
  const links = hrefs(html, pageUrl);
  const discovered: SourceCandidate[] = [];
  const seen = new Set<string>();
  const add = (candidate: SourceCandidate) => {
    if (seen.has(candidate.url) || candidate.url === pageUrl) return;
    seen.add(candidate.url);
    discovered.push(candidate);
  };

  for (const link of links) {
    const eb = eventbriteTarget(link);
    if (eb) {
      add({
        url: link.replace(/[?#].*$/, ""),
        kind: "ticketing_api",
        platform: "eventbrite",
        trustTier: "ticketing",
        discoveredBy: "probe",
      });
      continue;
    }
    const meetup = MEETUP_GROUP.exec(link);
    if (
      meetup?.[1] &&
      !["find", "topics", "cities", "apps", "about"].includes(meetup[1].toLowerCase())
    ) {
      add({
        url: `https://www.meetup.com/${meetup[1]}/`,
        kind: "feed_ics",
        platform: "meetup",
        feedUrl: `https://www.meetup.com/${meetup[1]}/events/ical/`,
        trustTier: "first_party",
        discoveredBy: "probe",
      });
      continue;
    }
    if (
      /^https?:\/\/(?:www\.|m\.)?(facebook\.com|instagram\.com)\/[^/?#]+/i.test(link) &&
      !/\/(sharer|share|dialog|plugins|tr)\b/i.test(link)
    ) {
      add({
        url: link.replace(/[?#].*$/, ""),
        kind: "social_link",
        trustTier: "unofficial",
        discoveredBy: "probe",
      });
    }
  }

  const found = (
    kind: SourceKind,
    feedUrl: string | null,
    reason: string,
    platform: string | null = null,
  ): ProbeOutcome => ({
    kind,
    platform,
    feedUrl,
    reason,
    discovered,
    hasJsonLdEvents: hasDatedEvent(findEvents(extractJsonLd(html).blocks)),
  });

  const alt = alternateCalendar(html, pageUrl);
  if (alt) return found("feed_ics", alt, "the page names an iCalendar feed");

  // Every calendar an embed merges (nycwcs.com merges 29), not only its first `src`.
  // A page that carries its own schema.org events is read from them; a calendar link beside them
  // (a "Subscribe" button) does not replace them.
  const calendars = googleCalendarIdsInHtml(html);
  if (calendars.length > 0 && findEvents(extractJsonLd(html).blocks).length === 0) {
    return {
      ...found(
        "feed_gcal",
        googleCalendarEmbedUrl(calendars),
        calendars.length === 1
          ? "the page embeds a Google Calendar"
          : `the page embeds ${calendars.length} Google Calendars`,
        googleCalendarAdapter.id,
      ),
      feedUrls: calendars.map((id) => googleCalendarEmbedUrl([id])),
    };
  }

  const ics = links.find(
    (l) => /\.ics(\?|$)/i.test(new URL(l).pathname + new URL(l).search) && !/google\.com/i.test(l),
  );
  if (ics) return found("feed_ics", ics, "the page links to an .ics file");

  if (/\/wp-json\/tribe\/events\/v1|tribe-events|the-events-calendar/i.test(html)) {
    return found("wp_tribe", null, "the page runs The Events Calendar", "wp_tribe");
  }
  // WordPress Events Manager serves the whole site's events as iCalendar at /events.ics, and
  // links it from no page (D-122). Its stylesheets and scripts name the plugin's directory.
  const eventsManager = eventsManagerFeed(html, pageUrl);
  if (eventsManager) {
    return found(
      "feed_ics",
      eventsManager,
      "the site runs Events Manager, whose calendar is /events.ics",
    );
  }
  // Squarespace (D-137): every Squarespace site's asset manifest names "events-collection", so
  // only a list on the page itself counts, or a link on the same site to its events page.
  if (/static1\.squarespace\.com|<meta[^<>]{1,500}generator[^<>]{1,500}squarespace/i.test(html)) {
    if (isEventsList(html) || /summary-item-record-type-event/i.test(html)) {
      return found("squarespace", null, "a Squarespace events list", "squarespace");
    }
    const events = squarespaceEventsLink(pageUrl, links);
    if (events) {
      return found(
        "squarespace",
        events,
        "a Squarespace site linking its events page",
        "squarespace",
      );
    }
  }
  // Tockify embeds name the calendar in an attribute; a plain link is tockify.com/{name}.
  const tockifyName =
    /data-tockify-calendar\s*=\s*["']([a-z0-9_-]+)["']/i.exec(html)?.[1] ??
    links
      .map(
        (l) =>
          /^https?:\/\/(?:www\.)?tockify\.com\/(?:api\/feeds\/ics\/)?([a-z0-9_-]+)\/?$/i.exec(
            l,
          )?.[1],
      )
      .find(
        (name) =>
          name && !["api", "pricing", "about", "tkf2", "browser"].includes(name.toLowerCase()),
      );
  if (tockifyName) {
    return found(
      "feed_ics",
      `https://tockify.com/api/feeds/ics/${tockifyName}`,
      "a Tockify calendar",
      "tockify",
    );
  }
  // Lane 3 (D-111): a page that names its events' own pages (a JSON-LD ItemList, Wix event links)
  // is read by following them.
  if (eventPageLinks(html, pageUrl).length > 0) {
    return found("jsonld", null, "the page names its events' own pages", "jsonld_items");
  }
  const outcome = found("html", null, "no feed or structured events on the page");
  if (outcome.hasJsonLdEvents)
    return { ...outcome, kind: "jsonld", reason: "schema.org events in the page" };
  return outcome;
}

/** The names a Squarespace site gives its events page, most telling first (D-137). */
const SQUARESPACE_EVENTS_PATHS = [
  "events",
  "event",
  "calendar",
  "shows",
  "parties",
  "rsvp",
  "upcoming",
  "whats-on",
  "happenings",
  "nights",
  "lineup",
  "music",
];

/** A same-site link (a leading www. ignored) to a one-segment page named as an events page. */
function squarespaceEventsLink(pageUrl: string, links: readonly string[]): string | null {
  const host = (u: URL) => u.host.replace(/^www\./i, "").toLowerCase();
  const site = host(new URL(pageUrl));
  const byName = new Map<string, string>();
  for (const link of links) {
    const url = new URL(link);
    const name = /^\/([a-z-]+)\/?$/i.exec(url.pathname)?.[1]?.toLowerCase();
    if (name && host(url) === site && !byName.has(name)) byName.set(name, link);
  }
  for (const name of SQUARESPACE_EVENTS_PATHS) {
    const link = byName.get(name);
    if (link) return link;
  }
  return null;
}
