// Which venue websites to probe this run, in which order (D-040 step 3, D-120). Pure.
//
// One candidate per host: a chain's eleven studios share one site, and one probe answers for all
// of them. Club, salsa and nightlife places come first, because their calendars are the nights the
// site barely covers; studios come last, because their pages are mostly class timetables, which
// are deferred (docs/WORKSTREAMS.md 2.8). A host that already has a source row, enabled or not, is
// never a candidate again: it is named "already a source" or "retired" (WORKSTREAMS section 3).

import type { Point } from "@/src/domain/listing";
import { insideMetro } from "@/src/domain/metro-bounds";
import { hostSkip, otherLane, siteHost, type HostSkip } from "@/src/pipeline/discovery/hosts";
import { GATE_VERSION } from "@/src/pipeline/discovery/gate";

export interface VenueSite {
  venueId: string;
  name: string;
  kind: string;
  danceFloor: "yes" | "no" | "unknown";
  websiteUrl: string;
  location: Point;
}

/** A host that already has a source row (or a starting address that will have one). */
export interface KnownHost {
  url: string;
  /** False for a retired row: switched off by hand, by the ingest, or by an earlier probe. */
  enabled: boolean;
  /** What discovery found when it probed this host ("held", "dead"...), when discovery wrote it. */
  status?: string;
  /** Whether the dance gate has judged this host's page-only events page (D-124). */
  gated?: boolean;
  /** The gate's stored pass verdict (null if no gate). */
  gatePass?: boolean | null;
  /** The gate version stored (default 1). */
  gateVersion?: number;
}

/**
 * A page-only events page probed before the dance gate existed (2026-10-04): it is probed once
 * more so the gate can read it (D-124), then never again until the re-probe (step 7).
 * Also returns true when the gate judged it false under an older version.
 */
export function awaitsGate(source: KnownHost): boolean {
  if (!(!source.enabled && source.status === "page_only")) return false;
  // Not yet gated at all.
  if (source.gated === false) return true;
  // Gated but failed under an older version.
  const version = source.gateVersion ?? 1;
  return source.gatePass === false && version < GATE_VERSION;
}

export interface Candidate {
  host: string;
  /** The website as the seed stores it: the address probed first. */
  url: string;
  /** The place the site is listed for, when one place lists it; null for a shared site. */
  venueId: string | null;
  /** The places that list this site, the first of the highest priority first. */
  venueNames: string[];
  priority: number;
  /** In words, for the report. */
  group: string;
}

export type SkipReason =
  | "already a source"
  | "retired"
  | "probed before"
  | "another lane's"
  | "not a web address"
  | "outside the metro"
  | HostSkip["kind"];

export interface Skipped {
  host: string;
  venueName: string;
  reason: SkipReason;
  detail: string;
}

/** Club, salsa and nightlife places first, studios last (the owner's order, 2026-10-04). */
export function priorityOf(venue: Pick<VenueSite, "kind" | "danceFloor">): {
  priority: number;
  group: string;
} {
  if (venue.kind === "night_club" && venue.danceFloor === "yes")
    return { priority: 0, group: "dance or salsa club" };
  if (venue.kind === "dance_hall") return { priority: 1, group: "dance hall" };
  if (venue.kind === "night_club") return { priority: 2, group: "nightlife venue" };
  if (venue.kind === "bar") return { priority: 3, group: "lounge" };
  if (venue.kind === "other") return { priority: 4, group: "music or event venue" };
  if (venue.kind === "community_center") return { priority: 5, group: "community or social club" };
  if (venue.kind === "studio") return { priority: 6, group: "dance studio" };
  return { priority: 7, group: venue.kind };
}

export function chooseCandidates(
  venues: readonly VenueSite[],
  known: ReadonlyMap<string, KnownHost>,
  metro: { slug: string; center: Point; radiusKm: number },
): { candidates: Candidate[]; skipped: Skipped[] } {
  const byHost = new Map<
    string,
    { url: string; venues: Array<VenueSite & { priority: number; group: string }> }
  >();
  const skipped: Skipped[] = [];
  const skippedHosts = new Set<string>();
  const skip = (host: string, venueName: string, reason: SkipReason, detail: string) => {
    if (skippedHosts.has(host)) return;
    skippedHosts.add(host);
    skipped.push({ host, venueName, reason, detail });
  };

  for (const venue of venues) {
    const host = siteHost(venue.websiteUrl);
    if (!host) {
      // Named, never dropped silently: a website stored without http(s) ("club.com", "mailto:").
      if (insideMetro(metro, venue.location))
        skipped.push({
          host: venue.websiteUrl,
          venueName: venue.name,
          reason: "not a web address",
          detail: "the stored website is not an http(s) address",
        });
      continue;
    }
    if (!insideMetro(metro, venue.location)) {
      // A host is only named outside when no place inside lists it.
      continue;
    }
    const entry = byHost.get(host) ?? { url: venue.websiteUrl, venues: [] };
    entry.venues.push({ ...venue, ...priorityOf(venue) });
    byHost.set(host, entry);
  }
  for (const venue of venues) {
    const host = siteHost(venue.websiteUrl);
    if (host && !byHost.has(host) && !insideMetro(metro, venue.location))
      skip(host, venue.name, "outside the metro", "the place is outside the metro's outline");
  }

  const candidates: Candidate[] = [];
  for (const [host, entry] of byHost) {
    entry.venues.sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));
    const first = entry.venues[0]!;
    const source = known.get(host);
    if (source && !awaitsGate(source)) {
      if (source.enabled) skip(host, first.name, "already a source", source.url);
      else if (source.status)
        skip(host, first.name, "probed before", `${source.status}: ${source.url}`);
      else skip(host, first.name, "retired", source.url);
      continue;
    }
    const lane = otherLane(host);
    if (lane) {
      skip(host, first.name, "another lane's", lane);
      continue;
    }
    const why = hostSkip(host);
    if (why) {
      skip(host, first.name, why.kind, why.reason);
      continue;
    }
    // The address the highest-priority place gives is the one probed.
    candidates.push({
      host,
      url: first.websiteUrl,
      venueId: new Set(entry.venues.map((v) => v.venueId)).size === 1 ? first.venueId : null,
      venueNames: [...new Set(entry.venues.map((v) => v.name))],
      priority: first.priority,
      group: first.group,
    });
  }
  candidates.sort((a, b) => a.priority - b.priority || a.host.localeCompare(b.host));
  skipped.sort((a, b) => a.reason.localeCompare(b.reason) || a.host.localeCompare(b.host));
  return { candidates, skipped };
}
