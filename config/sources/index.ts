// Starting sources per metro slug (D-043 question 9). New metros add a file beside nyc.ts.

import { DUBAI_RETIRED, DUBAI_SOURCES } from "@/config/sources/dubai";
import { PUNE_RETIRED, PUNE_SOURCES } from "@/config/sources/pune";
import { TULUM_RETIRED, TULUM_SOURCES } from "@/config/sources/tulum";
import { BEIRUT_RETIRED, BEIRUT_SOURCES } from "@/config/sources/beirut";
import { MARRAKESH_RETIRED, MARRAKESH_SOURCES } from "@/config/sources/marrakesh";
import { ISTANBUL_RETIRED, ISTANBUL_SOURCES } from "@/config/sources/istanbul";
import { AUSTIN_RETIRED, AUSTIN_SOURCES } from "@/config/sources/austin";
import { BERLIN_RETIRED, BERLIN_SOURCES } from "@/config/sources/berlin";
import { PARIS_RETIRED, PARIS_SOURCES } from "@/config/sources/paris";
import { NASHVILLE_RETIRED, NASHVILLE_SOURCES } from "@/config/sources/nashville";
import { TOKYO_RETIRED, TOKYO_SOURCES } from "@/config/sources/tokyo";
import { LISBON_RETIRED, LISBON_SOURCES } from "@/config/sources/lisbon";
import { LONDON_RETIRED, LONDON_SOURCES } from "@/config/sources/london";
import { BARCELONA_RETIRED, BARCELONA_SOURCES } from "@/config/sources/barcelona";
import { HONG_KONG_RETIRED, HONG_KONG_SOURCES } from "@/config/sources/hong-kong";
import { MEXICO_CITY_RETIRED, MEXICO_CITY_SOURCES } from "@/config/sources/mexico-city";
import { MIAMI_RETIRED, MIAMI_SOURCES } from "@/config/sources/miami";
import { RALEIGH_RETIRED, RALEIGH_SOURCES } from "@/config/sources/raleigh";
import { LOS_ANGELES_RETIRED, LOS_ANGELES_SOURCES } from "@/config/sources/los-angeles";
import { NEW_ORLEANS_RETIRED, NEW_ORLEANS_SOURCES } from "@/config/sources/new-orleans";
import {
  NYC_RETIRED,
  NYC_SOURCES,
  type RetiredSource,
  type SeedSource,
} from "@/config/sources/nyc";
import { PHILADELPHIA_RETIRED, PHILADELPHIA_SOURCES } from "@/config/sources/philadelphia";
import { BUENOS_AIRES_RETIRED, BUENOS_AIRES_SOURCES } from "@/config/sources/buenos-aires";
import { RIO_DE_JANEIRO_RETIRED, RIO_DE_JANEIRO_SOURCES } from "@/config/sources/rio-de-janeiro";
import { SAN_JUAN_RETIRED, SAN_JUAN_SOURCES } from "@/config/sources/san-juan";
import { MUMBAI_RETIRED, MUMBAI_SOURCES } from "@/config/sources/mumbai";
import { DELHI_RETIRED, DELHI_SOURCES } from "@/config/sources/delhi";
import { MEDELLIN_RETIRED, MEDELLIN_SOURCES } from "@/config/sources/medellin";
import { raSources } from "@/config/sources/ra";

export type { RetiredSource, SeedSource };

function withRa(metro: string, sources: readonly SeedSource[]): readonly SeedSource[] {
  const ra = raSources(metro);
  if (ra.length === 0) return sources;
  return [...sources, ...ra];
}

export const METRO_SOURCES: Readonly<Record<string, readonly SeedSource[]>> = {
  nyc: withRa("nyc", NYC_SOURCES),
  london: withRa("london", LONDON_SOURCES),
  philadelphia: withRa("philadelphia", PHILADELPHIA_SOURCES),
  "new-orleans": withRa("new-orleans", NEW_ORLEANS_SOURCES),
  miami: withRa("miami", MIAMI_SOURCES),
  lisbon: withRa("lisbon", LISBON_SOURCES),
  barcelona: withRa("barcelona", BARCELONA_SOURCES),
  "buenos-aires": withRa("buenos-aires", BUENOS_AIRES_SOURCES),
  "mexico-city": withRa("mexico-city", MEXICO_CITY_SOURCES),
  "hong-kong": withRa("hong-kong", HONG_KONG_SOURCES),
  "rio-de-janeiro": withRa("rio-de-janeiro", RIO_DE_JANEIRO_SOURCES),
  "san-juan": withRa("san-juan", SAN_JUAN_SOURCES),
  raleigh: withRa("raleigh", RALEIGH_SOURCES),
  "los-angeles": withRa("los-angeles", LOS_ANGELES_SOURCES),
  mumbai: withRa("mumbai", MUMBAI_SOURCES),
  delhi: withRa("delhi", DELHI_SOURCES),
  medellin: withRa("medellin", MEDELLIN_SOURCES),
  istanbul: withRa("istanbul", ISTANBUL_SOURCES),
  dubai: withRa("dubai", DUBAI_SOURCES),
  pune: withRa("pune", PUNE_SOURCES),
  tulum: withRa("tulum", TULUM_SOURCES),
  berlin: withRa("berlin", BERLIN_SOURCES),
  beirut: withRa("beirut", BEIRUT_SOURCES),
  marrakesh: withRa("marrakesh", MARRAKESH_SOURCES),
  paris: withRa("paris", PARIS_SOURCES),
  nashville: withRa("nashville", NASHVILLE_SOURCES),
  tokyo: withRa("tokyo", TOKYO_SOURCES),
  austin: withRa("austin", AUSTIN_SOURCES),
};

/** Starting addresses retired per metro slug, each with the reason (D-047). */
export const METRO_RETIRED_SOURCES: Readonly<Record<string, readonly RetiredSource[]>> = {
  nyc: NYC_RETIRED,
  london: LONDON_RETIRED,
  philadelphia: PHILADELPHIA_RETIRED,
  "new-orleans": NEW_ORLEANS_RETIRED,
  miami: MIAMI_RETIRED,
  raleigh: RALEIGH_RETIRED,
  "los-angeles": LOS_ANGELES_RETIRED,
  lisbon: LISBON_RETIRED,
  barcelona: BARCELONA_RETIRED,
  "buenos-aires": BUENOS_AIRES_RETIRED,
  "mexico-city": MEXICO_CITY_RETIRED,
  "hong-kong": HONG_KONG_RETIRED,
  "rio-de-janeiro": RIO_DE_JANEIRO_RETIRED,
  "san-juan": SAN_JUAN_RETIRED,
  mumbai: MUMBAI_RETIRED,
  delhi: DELHI_RETIRED,
  medellin: MEDELLIN_RETIRED,
  istanbul: ISTANBUL_RETIRED,
  dubai: DUBAI_RETIRED,
  pune: PUNE_RETIRED,
  tulum: TULUM_RETIRED,
  berlin: BERLIN_RETIRED,
  beirut: BEIRUT_RETIRED,
  marrakesh: MARRAKESH_RETIRED,
  paris: PARIS_RETIRED,
  nashville: NASHVILLE_RETIRED,
  tokyo: TOKYO_RETIRED,
  austin: AUSTIN_RETIRED,
};
