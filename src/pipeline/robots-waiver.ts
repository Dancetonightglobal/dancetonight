import type { RobotsWaiver } from "@/config/sources/nyc";
import { siteHost } from "@/src/pipeline/discovery/hosts";

/**
 * D-831: a source whose site owner gave written permission is read although its robots.txt
 * disallows us. The waiver names who granted it, when, and the DECISIONS entry that records it; it
 * covers only that seed's own host, and only the robots check (spacing, User-Agent, blocklist and
 * the 402/403 stops all stay).
 */
export function robotsWaivedHosts(
  seeds: readonly { url: string; robotsWaiver?: RobotsWaiver }[],
): Set<string> {
  const hosts = new Set<string>();
  for (const seed of seeds) {
    if (!seed.robotsWaiver) continue;
    const host = siteHost(seed.url);
    if (host) hosts.add(host);
  }
  return hosts;
}

/** One run-report line per waived seed, so every read under a waiver says so. */
export function robotsWaiverLines(
  seeds: readonly { url: string; robotsWaiver?: RobotsWaiver }[],
): string[] {
  return seeds
    .filter((seed) => seed.robotsWaiver)
    .map((seed) => {
      const w = seed.robotsWaiver!;
      return `${seed.url}: robots.txt waived: written permission (${w.decision}, ${w.grantedBy}, ${w.on})`;
    });
}
