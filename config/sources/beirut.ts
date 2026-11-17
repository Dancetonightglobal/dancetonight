// Beirut's starting sources (D-1000). Lebanon is read under the US tier (standing answer D-520): official APIs,
// public pages and feeds, robots.txt honoured, no bot-wall workarounds; Facebook and Instagram never; Resident
// Advisor only through its GraphQL endpoint (D-505, area 547). Platinumlist (queue wall) and Agenda Culturel
// (robots.txt blocks AI crawlers) wait for the owner's permission emails (2026-11-06).

import type { RetiredSource, SeedSource } from "@/config/sources/nyc";
import type { StyleKey } from "@/config/styles";

/** A directory page: pointers, never the organiser's own word (D-061, D-072). */
const directory = (url: string, label: string, styles: StyleKey[]): SeedSource => ({
  url,
  kind: "html",
  trustTier: "directory",
  styles,
  label,
  mixedCalendar: true,
});

export const BEIRUT_SOURCES: readonly SeedSource[] = [
  // Salsa Vida's Beirut guide (owner approved Salsa Vida's terms, 2026-10-31). schema.org Events in its JSON-LD; on
  // 11/06 two weekly socials: Sun "SBK Night at Suzana" (MDC My Dance Club, Verdun, 9:30pm) and Wed "Paraiso Noche
  // Latina" at La Paillote All'Italiana. robots.txt allows it (checked 2026-11-06). Its JSON-LD writes Beirut's 9:30pm
  // starts as "2026-11-08T21:30:00-08:00" (US Pacific), which listed them at 7:30am the next day (read 42338571510,
  // 2026-11-07); Dubai, Istanbul and Berlin guides write their own offsets. D-778 reads Salsa Vida on the wall clock.
  {
    ...directory("https://www.salsavida.com/guides/lebanon/beirut/", "Salsa Vida Beirut", [
      "salsa",
      "bachata",
      "kizomba",
    ]),
    // Salsa Vida lists only dance nights (D-321), so not screened as a mixed calendar (coverage-114, D-772, 2026-11-07).
    mixedCalendar: false,
  },
  // Metro al Madina's Midnight Metro party nights (about weekly). Own site, no JSON-LD, robots.txt allows it
  // (checked 2026-11-06). D-1003.
  {
    url: "https://metromadina.com/events",
    kind: "jsonld",
    trustTier: "first_party",
    platform: "metro_madina",
    styles: [],
    label: "Metro al Madina (Midnight Metro)",
  },
];

export const BEIRUT_RETIRED: readonly RetiredSource[] = [];
