// Lane 4's adapters: discovery (venue websites, Overpass, Next.js pages) (docs/WORKSTREAMS.md). Each lane keeps its adapter ids, their
// default flags and the adapters themselves in its own file, so parallel branches never edit the
// same lines. `AdapterId` (src/adapters/types.ts), `ADAPTER_DEFAULTS` (config/flags.ts) and
// `REGISTRY` (src/pipeline/ingest.ts) take them from here.
import type { SourceAdapter } from "@/src/adapters/types";

/** This lane's adapter ids, for example `| "nextjs"`. Add a new id here, not in types.ts. */
export type DiscoveryAdapterId = "venue_websites";

/** Each id's default flag, by the rules at the top of config/flags.ts. */
export const DISCOVERY_DEFAULTS: Readonly<Record<DiscoveryAdapterId, boolean>> = {
  // The venues' own sites, probed politely (D-040 step 3, D-120). Tier A: first-party pages under
  // robots.txt. The `adapter.venue_websites` flag switches the discovery job off for a metro.
  venue_websites: true,
};

/**
 * Venue-website discovery (src/pipeline/discovery/run.ts, `pnpm discover`). It harvests nothing:
 * it is here for its id, which its sources carry as `discovered_by`, and for its flag.
 */
export const venueWebsitesAdapter: SourceAdapter = {
  id: "venue_websites",
  tier: "A",
  limits: { perDomainIntervalMs: 5_000 },
};

export const DISCOVERY_ADAPTERS: readonly SourceAdapter[] = [venueWebsitesAdapter];
