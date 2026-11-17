// The opt-out blocklist (SPEC section 8): every adapter honours it because the HTTP client
// checks it before any request, and the store checks it again before writing a listing.
// Pure; the rows come from the `blocklist` table.

import { getDomain } from "tldts";

export type BlocklistPatternType = "domain" | "url_prefix" | "organizer" | "venue";

export interface BlocklistEntry {
  patternType: BlocklistPatternType;
  value: string;
}

export interface Blocklist {
  /** The matching entry for a URL, or null. Covers `domain` and `url_prefix` entries. */
  matchUrl(url: string): BlocklistEntry | null;
  /** Organizer and venue entries hold normalised names or ids; see the store. */
  hasOrganizer(nameOrId: string): boolean;
  hasVenue(nameOrId: string): boolean;
}

export function registrableDomain(hostname: string): string {
  return getDomain(hostname, { allowPrivateDomains: true }) ?? hostname.toLowerCase();
}

export function buildBlocklist(entries: readonly BlocklistEntry[]): Blocklist {
  const domains = new Set<string>();
  const prefixes: string[] = [];
  const organizers = new Set<string>();
  const venues = new Set<string>();
  for (const entry of entries) {
    const value = entry.value.trim().toLowerCase();
    if (!value) continue;
    if (entry.patternType === "domain") domains.add(value.replace(/^www\./, ""));
    else if (entry.patternType === "url_prefix") prefixes.push(value);
    else if (entry.patternType === "organizer") organizers.add(value);
    else venues.add(value);
  }

  return {
    matchUrl(url) {
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        return null;
      }
      const host = parsed.hostname.toLowerCase();
      // A domain entry covers the host itself and every subdomain of it.
      for (const domain of domains) {
        if (host === domain || host.endsWith(`.${domain}`)) {
          return { patternType: "domain", value: domain };
        }
      }
      const lower = url.toLowerCase();
      for (const prefix of prefixes) {
        if (lower.startsWith(prefix)) return { patternType: "url_prefix", value: prefix };
      }
      return null;
    },
    hasOrganizer: (value) => organizers.has(value.trim().toLowerCase()),
    hasVenue: (value) => venues.has(value.trim().toLowerCase()),
  };
}

export const EMPTY_BLOCKLIST = buildBlocklist([]);
