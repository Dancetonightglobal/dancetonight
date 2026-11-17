// The Serper gap measurement (D-040 "Measuring the gap", D-125). Run once per test metro.
//
// D-040 retired the model-driven discovery loop. What it would have found that the deterministic
// path does not is unknown; this measures it once with Serper's free sign-up credits (ACCOUNTS
// 3f): the old per-family queries ("salsa social New York"), every organic result's host sorted
// into what the deterministic path already holds and what it misses, and each missed host probed
// politely, as discovery probes, for a calendar. Only URLs and titles are kept, as leads; no
// search-result text is stored (SOURCES 4.1). Nothing is written to the database.

import { FAMILY_KEYS, searchQueriesFor, type FamilyKey } from "@/config/styles";
import type { Metro } from "@/src/adapters/types";
import { danceGate } from "@/src/pipeline/discovery/gate";
import { hostSkip, otherLane, siteHost } from "@/src/pipeline/discovery/hosts";
import { probeSite, type SiteStatus } from "@/src/pipeline/discovery/site-probe";
import type { HttpClient, HttpResponse } from "@/src/pipeline/http";
import { registrableDomain } from "@/src/pipeline/blocklist";

export const SERPER_ENDPOINT = "https://google.serper.dev/search";
export const SERPER_RESOLVE_ENDPOINT = "https://google.serper.dev/resolve";
/** At most this many searches a run: 65 queries, two pages each. One credit each (unverified). */
export const SERP_GAP_MAX_QUERIES = 130;
/** At most this many /resolve calls per search. */
export const SERPER_RESOLVE_MAX_ROUNDS = 3;
/** The longest retryAfter we wait out between /resolve calls. */
export const SERPER_RESOLVE_MAX_WAIT_MS = 30_000;

export interface SerpQuery {
  family: FamilyKey;
  q: string;
  page: number;
}

/** The old discovery queries for a metro: every family's phrases with the metro's name. */
export function gapQueries(metro: Pick<Metro, "name">, pages = 2): SerpQuery[] {
  const out: SerpQuery[] = [];
  for (const family of FAMILY_KEYS)
    for (const phrase of searchQueriesFor(family))
      for (let page = 1; page <= pages; page++)
        out.push({ family, q: `${phrase} ${metro.name}`, page });
  return out;
}

export interface SerpLead {
  url: string;
  title: string;
  host: string;
  family: FamilyKey;
  q: string;
  position: number;
}

/** True for Google redirect links (google.com/goto or google.com/url) that Serper returns for results after top 3.
 * Links still a Google redirect after /resolve (D-512) are dropped and counted.
 */
export function isGoogleRedirect(url: string): boolean {
  try {
    const parsed = new URL(url);
    const domain = registrableDomain(parsed.hostname);
    if (!domain.startsWith("google.")) return false;
    return parsed.pathname === "/goto" || parsed.pathname === "/url";
  } catch {
    return false;
  }
}

/** The organic results of one Serper answer, http(s) only. */
export function organicLeads(body: string, query: SerpQuery): SerpLead[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return [];
  }
  const organic = (parsed as { organic?: unknown }).organic;
  if (!Array.isArray(organic)) return [];
  const out: SerpLead[] = [];
  for (const item of organic as Array<Record<string, unknown>>) {
    const url = typeof item.link === "string" ? item.link : null;
    if (!url || isGoogleRedirect(url)) continue;
    const host = siteHost(url);
    if (!host) continue;
    out.push({
      url,
      title: typeof item.title === "string" ? item.title.slice(0, 200) : "",
      host,
      family: query.family,
      q: query.q,
      position: typeof item.position === "number" ? item.position : out.length + 1,
    });
  }
  return out;
}

/** Count how many organic items are Google redirect links. */
export function googleRedirectCount(body: string): number {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return 0;
  }
  const organic = (parsed as { organic?: unknown }).organic;
  if (!Array.isArray(organic)) return 0;
  let count = 0;
  for (const item of organic as Array<Record<string, unknown>>) {
    const url = typeof item.link === "string" ? item.link : null;
    if (url && isGoogleRedirect(url)) count++;
  }
  return count;
}

/** Resolve google.com/goto links in a Serper search response via the /resolve endpoint (D-512). */
export async function resolveSerperBody(options: {
  http: HttpClient;
  apiKey: string;
  body: string;
  sleep: (ms: number) => Promise<void>;
}): Promise<{ body: string; requests: number }> {
  if (googleRedirectCount(options.body) === 0) {
    return { body: options.body, requests: 0 };
  }
  let current = options.body;
  let requests = 0;
  for (let round = 0; round < SERPER_RESOLVE_MAX_ROUNDS; round++) {
    requests += 1;
    let res: HttpResponse;
    try {
      res = await options.http.request({
        url: SERPER_RESOLVE_ENDPOINT,
        method: "POST",
        purpose: "api",
        headers: { "x-api-key": options.apiKey, "content-type": "application/json" },
        body: current,
      });
    } catch {
      // Any error: return the last good body.
      break;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(res.body);
    } catch {
      // Not JSON: keep previous body.
      break;
    }
    if (typeof parsed !== "object" || parsed === null) {
      break;
    }
    current = res.body;
    if (googleRedirectCount(current) === 0) {
      break;
    }
    const retryAfter = (parsed as { retryAfter?: unknown }).retryAfter;
    if (typeof retryAfter !== "number" || !isFinite(retryAfter) || retryAfter <= 0) {
      break;
    }
    if (round === SERPER_RESOLVE_MAX_ROUNDS - 1) {
      // Last round: do not sleep after.
      break;
    }
    const waitMs = Math.min(retryAfter * 1000, SERPER_RESOLVE_MAX_WAIT_MS);
    await options.sleep(waitMs);
  }
  return { body: current, requests };
}

/** Where a result's host stands against what the deterministic path holds. */
export type HostClass =
  | "a source we hold"
  | "a seeded venue's website"
  | "another lane's"
  | "a platform another reader takes"
  | "not a venue's site"
  | "Tier D"
  | "missed";

export function classifyHost(
  host: string,
  held: { sources: ReadonlySet<string>; venueSites: ReadonlySet<string> },
): HostClass {
  const domain = registrableDomain(host);
  if (held.sources.has(host) || held.sources.has(domain)) return "a source we hold";
  if (held.venueSites.has(host) || held.venueSites.has(domain)) return "a seeded venue's website";
  if (otherLane(host)) return "another lane's";
  const skip = hostSkip(host);
  if (skip?.kind === "tier_d") return "Tier D";
  if (skip?.kind === "platform") return "a platform another reader takes";
  if (skip) return "not a venue's site";
  return "missed";
}

export interface GapHost {
  host: string;
  class: HostClass;
  families: FamilyKey[];
  /** The best-placed result's URL and title, kept as a lead. */
  url: string;
  title: string;
  bestPosition: number;
  /** For a missed host: what the probe found, and whether the dance gate passes a page-only one. */
  probe?: { status: SiteStatus; reason: string; url: string; gate?: boolean };
}

export interface GapReport {
  metro: string;
  queries: number;
  results: number;
  hosts: GapHost[];
  byClass: Record<HostClass, number>;
  /** Missed hosts whose probe found a calendar a reader takes, or a page the gate passes. */
  gap: string[];
  requests: number;
}

export async function runSerpGap(options: {
  metro: Metro;
  http: HttpClient;
  apiKey: string;
  held: { sources: ReadonlySet<string>; venueSites: ReadonlySet<string> };
  now: () => Date;
  maxQueries?: number;
  /** Missed hosts probed, best-placed first. */
  probeLimit?: number;
  log?: (line: string) => void;
  sleep?: (ms: number) => Promise<void>;
}): Promise<GapReport> {
  const log = options.log ?? (() => {});
  const sleep = options.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const queries = gapQueries(options.metro).slice(0, options.maxQueries ?? SERP_GAP_MAX_QUERIES);
  const leads: SerpLead[] = [];
  let resolveRequests = 0;
  for (const query of queries) {
    const res = await options.http.request({
      url: SERPER_ENDPOINT,
      method: "POST",
      purpose: "api",
      headers: { "x-api-key": options.apiKey, "content-type": "application/json" },
      body: JSON.stringify({ q: query.q, gl: "us", hl: "en", page: query.page }),
    });
    const beforeGoto = googleRedirectCount(res.body);
    const resolved = await resolveSerperBody({
      http: options.http,
      apiKey: options.apiKey,
      body: res.body,
      sleep,
    });
    resolveRequests += resolved.requests;
    const afterGoto = googleRedirectCount(resolved.body);
    const found = organicLeads(resolved.body, query);
    const dropped = afterGoto;
    const resolvedCount = Math.max(0, beforeGoto - afterGoto);
    const parts: string[] = [];
    if (resolvedCount > 0) parts.push(`${resolvedCount} google.com/goto links resolved`);
    if (dropped > 0) parts.push(`${dropped} google.com/goto links dropped`);
    const extra = parts.length > 0 ? `, ${parts.join(", ")}` : "";
    log(`${query.q} (page ${query.page}): ${found.length} results${extra}`);
    leads.push(...found);
  }

  const byHost = new Map<string, GapHost>();
  for (const lead of leads) {
    const before = byHost.get(lead.host);
    if (!before) {
      byHost.set(lead.host, {
        host: lead.host,
        class: classifyHost(lead.host, options.held),
        families: [lead.family],
        url: lead.url,
        title: lead.title,
        bestPosition: lead.position,
      });
      continue;
    }
    if (!before.families.includes(lead.family)) before.families.push(lead.family);
    if (lead.position < before.bestPosition)
      Object.assign(before, { url: lead.url, title: lead.title, bestPosition: lead.position });
  }

  const hosts = [...byHost.values()].sort(
    (a, b) => a.bestPosition - b.bestPosition || a.host.localeCompare(b.host),
  );
  const missed = hosts.filter((h) => h.class === "missed").slice(0, options.probeLimit ?? 200);
  let requests = queries.length + resolveRequests;
  for (const host of missed) {
    log(`probing ${host.url}`);
    const outcome = await probeSite(options.http, { url: host.url, venueNames: [] });
    requests += outcome.requests;
    const gate =
      outcome.status === "page_only" && outcome.page
        ? danceGate({
            text: outcome.page.text,
            contentType: outcome.page.contentType,
            // A result for a dance query stands in for a dance club's page: its nights alone pass.
            group: "dance or salsa club",
            now: options.now(),
            tz: options.metro.tz,
            languages: options.metro.languages,
            countryCode: options.metro.countryCode,
          }).pass
        : undefined;
    host.probe = {
      status: outcome.status,
      reason: outcome.reason,
      url: outcome.url,
      ...(gate === undefined ? {} : { gate }),
    };
  }

  const byClass = Object.fromEntries(
    (
      [
        "a source we hold",
        "a seeded venue's website",
        "another lane's",
        "a platform another reader takes",
        "not a venue's site",
        "Tier D",
        "missed",
      ] as HostClass[]
    ).map((c) => [c, hosts.filter((h) => h.class === c).length]),
  ) as Record<HostClass, number>;
  const gap = missed
    .filter((h) => h.probe?.status === "structured" || h.probe?.gate === true)
    .map((h) => h.host);
  return {
    metro: options.metro.slug,
    queries: queries.length,
    results: leads.length,
    hosts,
    byClass,
    gap,
    requests,
  };
}

/** The recall CSV: one row per host, for `evals/recall/serper-gap/`. */
export function gapCsv(report: GapReport): string {
  const cell = (v: string | number | boolean | undefined) => {
    const s = v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = [
    "host,class,families,best_position,url,title,probe_status,probe_url,gate_pass,in_gap",
    ...report.hosts.map((h) =>
      [
        h.host,
        h.class,
        h.families.join(" "),
        h.bestPosition,
        h.url,
        h.title,
        h.probe?.status,
        h.probe?.url,
        h.probe?.gate,
        report.gap.includes(h.host),
      ]
        .map(cell)
        .join(","),
    ),
  ];
  return `${rows.join("\n")}\n`;
}

/** The summary for the run's log and the PR. */
export function formatGapReport(report: GapReport): string {
  const missed = report.byClass.missed;
  return [
    `Serper gap for ${report.metro}: ${report.queries} searches, ${report.results} results, ${report.hosts.length} hosts, ${report.requests} requests.`,
    ...Object.entries(report.byClass).map(([c, n]) => `  ${c}: ${n}`),
    `Missed hosts with a calendar a reader takes or the dance gate passes: ${report.gap.length} of ${missed}.`,
    ...report.gap.map((h) => `  ${h}`),
  ].join("\n");
}
