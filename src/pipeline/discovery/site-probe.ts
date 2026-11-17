// Probing one venue website (D-040 step 3, D-120): is the site alive, is it still the venue's,
// and where are its nights? Every request goes through the polite client (robots.txt, 5 s per
// domain, the blocklist, the bot User-Agent); a block is recorded, never worked around.
//
// 1. The home page is fetched. A bot wall's challenge page (SiteGround, Cloudflare, Imperva) is
//    "blocked", like a 403. A dead domain (no such host, 404, 410), a parked one, or one that
//    no longer names the place is retired. A home page that redirects to another domain is
//    "moved" and probed no further: a club's site that now lands on a ticket page for a club in
//    Las Vegas (marqueeny.com, 2026-10-04) is not that club's calendar. A 403 or a robots.txt refusal is "blocked". A timeout,
//    a reset or a 5xx is "unreachable": the periodic re-probe (step 7) asks again.
// 2. The page is probed (src/pipeline/probe.ts). A feed, a platform or schema.org events end it.
// 3. Otherwise the home page's own links to an events page (by link text or path, same site) are
//    followed, at most MAX_EVENT_PAGES, and each is probed the same way.
// 4. Nothing structured: the site is "page only" (its events page, when it has one, waits for the
//    dance gate before any model reads it) or "nothing" (no events page at all).
//
// The HTML is hostile: it is only matched against fixed patterns, never followed blindly, and no
// text from it reaches a model here (D-040: discovery calls no model).

import { normalizeForMatch } from "@/config/styles";
import { decodeEntities, httpUrl } from "@/src/adapters/shared";
import type { SourceCandidate, SourceKind } from "@/src/adapters/types";
import { registrableDomain } from "@/src/pipeline/blocklist";
import { hostSkip, siteHost } from "@/src/pipeline/discovery/hosts";
import { HttpError, type HttpClient, type HttpResponse } from "@/src/pipeline/http";
import { probePage } from "@/src/pipeline/probe";
import { OffSiteRedirect } from "@/src/pipeline/discovery/transport";

/**
 * How much of a page discovery reads. A calendar's links and feed tags sit well inside it (the
 * largest page that yielded on 2026-10-04 was 160 KB), and some shared parsers cost quadratic time
 * on hostile markup, so the bound also bounds a run.
 */
export const MAX_SCAN = 500_000;

/**
 * A page's visible text, in linear time whatever the markup: tags, scripts, styles and comments
 * are skipped by index, never by backtracking regex.
 */
export function visibleText(html: string): string {
  const src = html.slice(0, MAX_SCAN);
  const lower = src.toLowerCase();
  const parts: string[] = [];
  let i = 0;
  while (i < src.length) {
    const lt = src.indexOf("<", i);
    if (lt < 0) {
      parts.push(src.slice(i));
      break;
    }
    parts.push(src.slice(i, lt));
    let end: number;
    if (lower.startsWith("<!--", lt)) {
      const close = src.indexOf("-->", lt + 4);
      end = close < 0 ? -1 : close + 2;
    } else if (lower.startsWith("<script", lt) || lower.startsWith("<style", lt)) {
      const close = lower.indexOf(lower.startsWith("<script", lt) ? "</script" : "</style", lt + 6);
      end = close < 0 ? -1 : src.indexOf(">", close);
    } else {
      end = src.indexOf(">", lt);
    }
    if (end < 0) break;
    i = end + 1;
  }
  return decodeEntities(parts.join(" ")).replace(/\s+/g, " ");
}

/** Events pages followed from a home page that has no feed of its own. */
export const MAX_EVENT_PAGES = 2;

export type SiteStatus =
  /** A feed, a platform or schema.org events: a reader can take it without a model. */
  | "structured"
  /** An events page with no structure: only a model could read it (after the dance gate). */
  | "page_only"
  /** Alive and the venue's, with no events page. */
  | "nothing"
  /** Gone: no such host, 404 or 410, or a parked domain. Retired. */
  | "dead"
  /** The domain now serves something else. Retired. */
  | "repurposed"
  /** The home page redirects to another domain: not probed there, because it may not be the place's. */
  | "moved"
  /** A 403, a bot wall or a robots.txt refusal. Recorded, never worked around. */
  | "blocked"
  /** A timeout, a reset, a TLS failure or a 5xx: the periodic re-probe asks again (step 7). */
  | "unreachable";

export interface SiteOutcome {
  status: SiteStatus;
  /** The page the outcome is about: the events page when one was followed, else the home page. */
  url: string;
  kind: SourceKind;
  platform: string | null;
  feedUrl: string | null;
  /** In words, for the report. */
  reason: string;
  /** Other sources the pages link to (an Eventbrite organizer, a Meetup group, socials). */
  discovered: SourceCandidate[];
  /** Tier D calendars the pages point to (RA, DICE, Shotgun): named, never read. */
  tierD: string[];
  /** Requests made, robots.txt included, for the report's budget line. */
  requests: number;
  /** A page-only outcome's events page, for the dance gate (D-124): its visible text and type. */
  page?: { text: string; contentType: string | null };
}

const EVENT_WORDS =
  /\b(events?|calendar|schedule|line-?up|upcoming|parties|party|nights?|shows?|agenda|what'?s on|rsvp|tickets|programs?|socials?|milongas?|dances)\b/i;
const EVENT_PATH =
  /\/(events?|calendar|schedule|line-?up|upcoming|parties|shows|agenda|whats-?on|rsvp|tickets|socials?|milongas?)(\/|$|\.)/i;
const ONE_EVENT =
  /\/(event-details|event|e|tickets?)\/[^/]+|\/events?\/[^/]+\/[^/]+|event\.php|[?&]event_?id=/i;
// Pages about hiring the room, not about its nights ("Private events", "Party menu").
const NOT_A_CALENDAR =
  /\b(private|rentals?|rent|hire|book(?:ing)?s?|catering|menus?|weddings?|corporate|venues?|about|careers?|press|gift)\b/i;
// Bot walls answer 200 or 202 with a challenge page: recorded as blocked, never worked around.
const BOT_WALL =
  /sgcaptcha|\/cdn-cgi\/challenge-platform|<title>\s*(?:Just a moment\.\.\.|Attention Required! \| Cloudflare)|_Incapsula_Resource|Please wait while your request is being verified|imunify360/i;
const SKIP_PATH = /\/(wp-admin|wp-login|cart|checkout|account|login|privacy|terms|cookie|feed)\b/i;

const TIER_D_LINK =
  /^https?:\/\/(?:[a-z0-9-]+\.)*(ra\.co|residentadvisor\.net|dice\.fm|shotgun\.live)\//i;

const PARKED =
  /\b(this domain (?:name )?(?:is|may be) for sale|buy this domain|domain (?:is )?parked|parked (?:free|domain)|hugedomains|sedoparking|dan\.com|afternic|domain has expired|renew (?:this|your) domain)\b/i;

// Words a place's name shares with every other place's, which prove nothing about whose site it is.
const GENERIC_NAME_WORDS = new Set(
  (
    "the a an and of at in on nyc ny new york city brooklyn manhattan queens bronx staten island " +
    "bar lounge club nightclub night restaurant cafe studio studios dance dancing ballroom " +
    "hall center centre room rooftop venue social inc llc co company house"
  ).split(" "),
);

/** The words of a place's name that would identify its own site. */
export function nameMarks(name: string): string[] {
  return (
    normalizeForMatch(name)
      .split(" ")
      // A city glued to the name ("Nexonyc", "Clubbk") is not part of what identifies it.
      .map((w) => w.replace(/(nyc|bk)$/, ""))
      .filter((w) => w.length >= 3 && !GENERIC_NAME_WORDS.has(w))
  );
}

/**
 * Whether a page is still the place's: one of its names' identifying words is in the page's text
 * or title, or in the site's host. A name with no identifying word ("The Dance Studio") cannot be
 * checked and counts as named.
 */
export function namesPlace(names: readonly string[], host: string, html: string): boolean {
  const marks = names.flatMap(nameMarks);
  if (marks.length === 0) return true;
  const hostWords = host.toLowerCase().replace(/[^a-z0-9]/g, "");
  const text = ` ${normalizeForMatch(visibleText(html))} `;
  return marks.some((m) => text.includes(` ${m} `) || hostWords.includes(m.replace(/ /g, "")));
}

/**
 * Whether a host carries one of a place's identifying words: a site that moved to such a domain
 * (lvgnewyork.com to lvgsalsasocial.com) is still the place's. A name with no identifying word
 * cannot vouch for any host.
 */
export function hostNamesPlace(names: readonly string[], host: string): boolean {
  const hostWords = host.toLowerCase().replace(/[^a-z0-9]/g, "");
  return names.flatMap(nameMarks).some((m) => hostWords.includes(m.replace(/ /g, "")));
}

/** Where an off-site redirect pointed, from the error that refused it. */
export function movedTo(error: unknown): string | null {
  if (error instanceof OffSiteRedirect) return error.target;
  if (error instanceof HttpError && error.kind === "robots_disallowed") {
    const host = /could not be fetched \(redirects to ([a-z0-9.-]+)\)/i.exec(error.message)?.[1];
    if (host) return `https://${host}/`;
  }
  return null;
}

/** The home page's links to its own events pages, best first. */
export function eventPageLinks(html: string, pageUrl: string): string[] {
  const home = new URL(pageUrl);
  const site = registrableDomain(home.hostname);
  const scored = new Map<string, number>();
  // Bounded, so a hostile page of unclosed tags costs linear time, not quadratic (D-120).
  for (const m of html.slice(0, MAX_SCAN).matchAll(/<a\b([^<>]{0,2000})>([\s\S]{0,500}?)<\/a>/gi)) {
    const href = /\bhref\s*=\s*["']([^"'<>]{1,2000})["']/i.exec(m[1] ?? "")?.[1];
    if (!href) continue;
    const url = httpUrl(decodeEntities(href).trim(), pageUrl);
    if (!url) continue;
    const parsed = new URL(url);
    if (registrableDomain(parsed.hostname) !== site) continue;
    if (SKIP_PATH.test(parsed.pathname)) continue;
    parsed.hash = "";
    const clean = parsed.toString();
    if (clean === home.toString() || (parsed.pathname === "/" && parsed.hostname === home.hostname))
      continue;
    const text = decodeEntities(m[2]!.replace(/<[^>]*>/g, " "))
      .replace(/\s+/g, " ")
      .trim();
    if (NOT_A_CALENDAR.test(parsed.pathname.replace(/[-_/]/g, " ")) || NOT_A_CALENDAR.test(text))
      continue;
    let score = 0;
    if (EVENT_PATH.test(parsed.pathname)) score += 2;
    if (text.length <= 40 && EVENT_WORDS.test(text)) score += 2;
    // A calendar on its own subdomain (calendar.houseofyes.org).
    if (parsed.hostname !== home.hostname && /^(calendar|events?|tickets)\./i.test(parsed.hostname))
      score += 2;
    // One event's own page is not the calendar (Tulum's /event-details/<slug>, a ticket page).
    if (ONE_EVENT.test(`${parsed.pathname}${parsed.search}`)) continue;
    if (/\/events?\/[^/]+\/?$/i.test(parsed.pathname)) score -= 1;
    if (score >= 2) scored.set(clean, Math.max(score, scored.get(clean) ?? 0));
  }
  return [...scored]
    .sort((a, b) => b[1] - a[1] || a[0].length - b[0].length || a[0].localeCompare(b[0]))
    .map(([url]) => url);
}

function tierDLinks(html: string, pageUrl: string): string[] {
  const out = new Set<string>();
  for (const m of html.slice(0, MAX_SCAN).matchAll(/\bhref\s*=\s*["']([^"'<>]{1,2000})["']/gi)) {
    const url = httpUrl(decodeEntities(m[1] ?? "").trim(), pageUrl);
    const site = url ? TIER_D_LINK.exec(url)?.[1] : null;
    if (site) out.add(site.toLowerCase());
  }
  return [...out].sort();
}

/** How a failed fetch reads in the outcome. */
export function failureStatus(error: unknown): { status: SiteStatus; reason: string } {
  if (!(error instanceof HttpError)) {
    return {
      status: "unreachable",
      reason: error instanceof Error ? error.message : String(error),
    };
  }
  if (error instanceof OffSiteRedirect)
    return { status: "moved", reason: `the site ${error.message}` };
  switch (error.kind) {
    case "robots_disallowed":
      // An unreadable robots.txt counts as disallowing the site (RFC 9309), but why it was
      // unreadable says more: no such host is a dead domain, and a timeout or a 5xx may pass.
      if (/ENOTFOUND|EAI_NONAME/i.test(error.message))
        return { status: "dead", reason: error.message };
      // robots.txt itself redirects to another site: the site has moved.
      if (/could not be fetched \(redirects to /i.test(error.message))
        return { status: "moved", reason: error.message };
      if (/robots\.txt (answered 5\d\d|could not be fetched)/i.test(error.message))
        return { status: "unreachable", reason: error.message };
      return { status: "blocked", reason: error.message };
    case "blocklisted":
    case "stopped":
      return { status: "blocked", reason: error.message };
    case "http_status":
      if (error.status === 404 || error.status === 410)
        return { status: "dead", reason: error.message };
      return { status: "unreachable", reason: error.message };
    case "network":
      // No such host: the domain is gone. Anything else (a reset, a TLS failure) may pass.
      // EAI_AGAIN is a resolver that did not answer, not a name that does not exist.
      if (/ENOTFOUND|EAI_NONAME/i.test(error.message))
        return { status: "dead", reason: error.message };
      return { status: "unreachable", reason: error.message };
    case "invalid_url":
      return { status: "dead", reason: error.message };
    default:
      return { status: "unreachable", reason: error.message };
  }
}

/** Whether a page is a bot wall's challenge rather than the site. */
export function isBotWall(response: Pick<HttpResponse, "status" | "body">): boolean {
  return BOT_WALL.test(response.body.slice(0, 20_000));
}

export async function probeSite(
  http: HttpClient,
  site: { url: string; venueNames: readonly string[]; movedFrom?: string },
): Promise<SiteOutcome> {
  let requests = 0;
  const robotsSeen = new Set<string>();
  const get = async (url: string): Promise<HttpResponse> => {
    const origin = new URL(url).origin;
    if (!robotsSeen.has(origin)) {
      robotsSeen.add(origin);
      requests += 1;
    }
    requests += 1;
    return http.request({ url, purpose: "crawl", headers: { accept: "text/html" } });
  };
  const base = {
    url: site.url,
    kind: "html" as SourceKind,
    platform: null,
    feedUrl: null,
    discovered: [] as SourceCandidate[],
    tierD: [] as string[],
  };

  let home: HttpResponse;
  try {
    home = await get(site.url);
  } catch (error) {
    // A site that moved to a domain carrying the place's own name is still the place's: it is
    // probed there once, from the start, so that domain's robots.txt and spacing apply.
    const target = movedTo(error);
    const targetHost = target ? siteHost(target) : null;
    if (
      target &&
      targetHost &&
      !site.movedFrom &&
      !hostSkip(targetHost) &&
      hostNamesPlace(site.venueNames, targetHost)
    ) {
      const there = await probeSite(http, { ...site, url: target, movedFrom: site.url });
      return {
        ...there,
        reason: `${there.reason} (the site moved here from ${siteHost(site.url)})`,
        requests: there.requests + requests,
      };
    }
    return { ...base, ...failureStatus(error), requests };
  }
  const homeUrl = home.url || site.url;
  if (isBotWall(home))
    return {
      ...base,
      url: homeUrl,
      status: "blocked",
      reason: "a bot wall's challenge page",
      requests,
    };
  const host = siteHost(homeUrl) ?? "";
  if (PARKED.test(visibleText(home.body).slice(0, 4000)) || PARKED.test(home.body.slice(0, 2000)))
    return { ...base, url: homeUrl, status: "dead", reason: "a parked domain", requests };
  if (
    registrableDomain(new URL(homeUrl).hostname) !== registrableDomain(new URL(site.url).hostname)
  )
    return {
      ...base,
      url: homeUrl,
      status: "moved",
      reason: `the site redirects to ${host}`,
      requests,
    };
  if (!namesPlace(site.venueNames, host, home.body)) {
    return {
      ...base,
      url: homeUrl,
      status: "repurposed",
      reason: `the page never names ${site.venueNames[0] ?? "the place"}`,
      requests,
    };
  }

  const discovered: SourceCandidate[] = [];
  const tierD = new Set<string>();
  const seenDiscovered = new Set<string>();
  const take = (url: string, html: string) => {
    const probe = probePage(url, html.slice(0, MAX_SCAN));
    for (const d of probe.discovered) {
      if (seenDiscovered.has(d.url)) continue;
      seenDiscovered.add(d.url);
      discovered.push(d);
    }
    for (const t of tierDLinks(html, url)) tierD.add(t);
    return probe;
  };
  const done = (outcome: Omit<SiteOutcome, "discovered" | "tierD" | "requests">): SiteOutcome => ({
    ...outcome,
    discovered,
    tierD: [...tierD].sort(),
    requests,
  });

  const first = take(homeUrl, home.body);
  if (first.kind !== "html")
    return done({
      status: "structured",
      url: homeUrl,
      kind: first.kind,
      platform: first.platform,
      feedUrl: first.feedUrl,
      reason: first.reason,
    });

  const pages = eventPageLinks(home.body, homeUrl).slice(0, MAX_EVENT_PAGES);
  const failures: string[] = [];
  let pageOnly: { url: string; text: string; contentType: string | null } | null = null;
  for (const url of pages) {
    let page: HttpResponse;
    try {
      page = await get(url);
    } catch (error) {
      failures.push(`${url}: ${failureStatus(error).reason}`);
      continue;
    }
    const pageUrl = page.url || url;
    if (isBotWall(page)) {
      failures.push(`${url}: a bot wall's challenge page`);
      continue;
    }
    if (registrableDomain(new URL(pageUrl).hostname) !== registrableDomain(new URL(url).hostname)) {
      failures.push(`${url}: redirects to ${siteHost(pageUrl) ?? "another site"}`);
      continue;
    }
    const probe = take(pageUrl, page.body);
    if (probe.kind !== "html")
      return done({
        status: "structured",
        url: pageUrl,
        kind: probe.kind,
        platform: probe.platform,
        feedUrl: probe.feedUrl,
        reason: `${probe.reason} (on ${pageUrl})`,
      });
    pageOnly ??= {
      url: pageUrl,
      text: visibleText(page.body),
      contentType: page.headers["content-type"] ?? null,
    };
  }
  if (pageOnly)
    return done({
      status: "page_only",
      url: pageOnly.url,
      page: { text: pageOnly.text, contentType: pageOnly.contentType },
      kind: "html",
      platform: null,
      feedUrl: null,
      reason: "an events page with no feed or structured events",
    });
  return done({
    status: "nothing",
    url: homeUrl,
    kind: "html",
    platform: null,
    feedUrl: null,
    reason:
      failures.length > 0
        ? `no feed on the home page; its events pages failed (${failures.join("; ")})`
        : "no feed and no events page on the home page",
  });
}
