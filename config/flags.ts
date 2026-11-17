// Default feature flags per adapter (D-008, D-029, D-034, D-039, D-041, D-043). A row in the
// `feature_flags` table overrides the default for everyone or for one metro; the default is what
// runs when no row exists.
//
// Rules the defaults encode:
// - Tier A official APIs and open feeds: ON. An adapter whose key is missing is reported as
//   "not configured" by the runner, not as a failure.
// - Tier B and every paid path: OFF (D-041: zero cost; D-043 question 7).
// - Tier D and every unofficial endpoint: OFF, and in EU and UK metros they additionally need a
//   recorded written consent (D-034).
// - Named exceptions: Meetup's keyless search is OFF until its terms are read (D-043 question 6);
//   Google Places is OFF in Phase 2 (question 5); EDMTrain is OFF pending permission (D-029);
//   the Mindbody widget and the Momence endpoint are OFF (D-018); NYC Open Data stays OFF until
//   its licence is settled (D-034).

import { DISCOVERY_DEFAULTS } from "@/src/adapters/registry/discovery";
import { PLATFORM_DEFAULTS } from "@/src/adapters/registry/platforms";
import { READER_DEFAULTS } from "@/src/adapters/registry/readers";
import type { AdapterId } from "@/src/adapters/types";

export const ADAPTER_DEFAULTS: Readonly<Record<AdapterId, boolean>> = {
  // Each lane's own ids (docs/WORKSTREAMS.md, section 4).
  ...READER_DEFAULTS,
  ...DISCOVERY_DEFAULTS,
  ...PLATFORM_DEFAULTS,
  ticketmaster: true,
  meetup: false,
  eventbrite: true,
  overture: true,
  google_places: false,
  overpass: true,
  feed_ics: true,
  // The Calendar API reader, on since 2026-10-17 when the key was added (D-033, D-084, D-130).
  // The first keyed run's report names the response's Cache-Control for the integrator's check.
  feed_gcal: true,
  jsonld: true,
  wp_tribe: true,
  squarespace: true,
  wix: false,
  libcal: true,
  tockify: true,
  teamup: true,
  amilia: true,
  localist: true,
  engage: true,
  presence: true,
  open_data_paris: true,
  open_data_nyc: false,
  open_data_austin: true,
  open_data_berlin: true,
  studio_punchpass: true,
  studio_pike13: true,
  studio_mindbody: false,
  studio_momence: false,
  helloasso: true,
  billetto: true,
  tickster: true,
  moshtix: true,
  serp_discovery: false,
  firecrawl: false,
  llm_html: false,
  connect_discord: false,
  connect_telegram: false,
  connect_rss: true,
  predicthq: false,
  // Tier D, ON by the owner's decision of 2026-10-11 (D-139); US metros only (countries).
  dice: true,
  // Tier D, ON by the owner's decision of 2026-10-31 (D-505): every metro, EU and UK included.
  ra: true,
  edmtrain: false,
  activenet: false,
  engage_discovery: false,
  campusgroups: false,
  apify_facebook: false,
  directory_pointers: true,
};
