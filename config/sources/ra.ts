// Resident Advisor areas (D-505): one RA GraphQL source per metro, read by the `ra` adapter.
import type { SeedSource } from "@/config/sources/nyc";

/** RA's numeric area id per metro slug. A metro not listed has no RA source. */
export const RA_AREAS: Readonly<Record<string, number>> = {
  nyc: 8,
  london: 13,
  barcelona: 20,
  lisbon: 53,
  miami: 38,
  philadelphia: 528,
  "mexico-city": 399,
  "new-orleans": 606,
  "buenos-aires": 395,
  "rio-de-janeiro": 401,
  "san-juan": 181,
  // No Raleigh, Durham or Triangle area: RA's state-wide "North Carolina" area; the Wake County outline drops
  // the rest of the state (D-600, D-508; areas(searchTerm:) checked 2026-10-31).
  raleigh: 123,
  "los-angeles": 23, // RA area "Los Angeles", US (GraphQL areas(searchTerm: "Los Angeles"), 2026-11-07; D-1160)
  mumbai: 328, // RA area "Mumbai", India (GraphQL areas(searchTerm: "Mumbai"), 2026-10-31; D-620)
  delhi: 324, // RA area "Delhi", India (GraphQL areas(searchTerm: "Delhi"), 2026-11-07; D-1140)
  "hong-kong": 71,
  medellin: 374,
  istanbul: 73, // RA area "Istanbul", Turkey (D-680)
  dubai: 136, // RA area "Dubai", United Arab Emirates (GraphQL areas(searchTerm: "Dubai"), 2026-11-06; D-1060)
  pune: 329, // RA area "Pune", India (GraphQL areas(searchTerm: "Pune"), 2026-11-07; D-1120)
  berlin: 34, // RA area "Berlin", Germany (GraphQL areas(searchTerm: "Berlin"), 2026-11-06; D-1020)
  beirut: 547, // RA area "Beirut", Lebanon (GraphQL areas(searchTerm: "Beirut"), 2026-11-06; D-1000)
  paris: 44, // RA area "Paris", France (GraphQL areas(searchTerm: "Paris"), 2026-11-06; D-1040)
  // RA area "Tulum", Mexico (GraphQL areas(searchTerm: "Tulum"), 2026-11-07; D-1080). Playa del Carmen is RA area 684,
  // read by its own entry in config/sources/tulum.ts.
  tulum: 523,
  nashville: 653, // RA area "Nashville", US (GraphQL areas(searchTerm: "Nashville"), 2026-11-07; D-1200)
  tokyo: 27, // RA area "Tokyo", Japan (GraphQL areas(searchTerm: "Tokyo"), 2026-11-07; D-1221)
  austin: 321, // RA area "Austin", United States (GraphQL areas(searchTerm: "Austin"), 2026-11-07; D-1180)
  // No Marrakech area: RA's country-wide "Morocco / All" area; the prefecture outline drops Casablanca, Rabat and the
  // rest (areas(searchTerm:"Marrakech") empty, areas(searchTerm:"Morocco") -> 173, 2026-11-07; 8 of 11 listings to
  // year end in or near Marrakech; D-1100).
  marrakesh: 173,
};

const CITY_LABELS: Readonly<Record<string, string>> = {
  nyc: "New York",
  london: "London",
  barcelona: "Barcelona",
  lisbon: "Lisbon",
  miami: "Miami",
  philadelphia: "Philadelphia",
  "mexico-city": "Mexico City",
  "new-orleans": "New Orleans",
  "buenos-aires": "Buenos Aires",
  "rio-de-janeiro": "Rio de Janeiro",
  "san-juan": "San Juan",
  raleigh: "Raleigh",
  "los-angeles": "Los Angeles",
  mumbai: "Mumbai",
  delhi: "Delhi",
  "hong-kong": "Hong Kong",
  medellin: "Medellín",
  istanbul: "Istanbul",
  dubai: "Dubai",
  pune: "Pune",
  beirut: "Beirut",
  paris: "Paris",
  tulum: "Tulum",
  nashville: "Nashville",
  tokyo: "Tokyo",
  austin: "Austin",
  marrakesh: "Marrakesh",
};

/**
 * RA titles per metro that pass every screen but are not dance nights (radio sessions, screenings), each checked
 * by the metro lead on the live site; the RA source's `notDanceNights` (D-519 E1/E2).
 */
export const RA_NOT_DANCE_NIGHTS: Readonly<Record<string, readonly string[]>> = {
  barcelona: [
    "Entity Radio // Viajes Sonoros",
    "Pedro Son Lab: Open Studio with Entity Radio",
    "DRAKE'S R&B WORLD - FILM SCREENING & LISTENING SESSION - SESIÓN DE ESCUCHA",
    // Cities sweep 2026-11-14: a sauna session (same series as London's), not a dance night.
    "Ambient Sauna *",
  ],
  // Casual, Wan Chai: one-hour listening sessions, not dance nights (Sun 2026-11-01 5:30-6:30pm, live check 10-31;
  // Sun 2026-11-08 4-5pm, live check 11-01, coverage-84 OK).
  "hong-kong": [
    "Focus On: Pablo Valentino (Listening Session)",
    "Listening Session presented by Chucheewa",
  ],
  // Club Hunni Academy, Wed 2026-11-04: a talk, not a dance night (London live check 2026-11-01).
  // Coverage daily check 2026-11-13: an album playback in the dark and a sauna session, not dance nights.
  london: [
    "Club Hunni Academy: In Conversation with Logic1000",
    "Pitchblack Playback *",
    "Ambient Sauna *",
  ],
  // Berlin live check 2026-11-07: concerts at Club Gretchen (Wed 11-11 8-11pm, Sat 11-07 8-10pm, Fri 11-13 9pm) and
  // sets at migas, a listening bar in Wedding (8-11pm), not dance nights. Gabriel (Sat 11-14): read 2026-11-08.
  berlin: [
    "NICK HAKIM",
    "Rey&Kjavik",
    "Psychedelic Porn Funk Experience ● Berlin",
    "ÄLI plays at migas",
    "Amanita plays at migas",
    "maxiu plays at migas",
    "Gabriel plays at migas",
    // Daily check 2026-11-12 (coverage-148, section H): concerts on Wed 11-18 at 8pm.
    "Luca Hohmann Trio - Release-Konzert",
    "Årabrot, Intercourse",
    "Psychic Liberation Night: Horse Lords + Audrey Chen & Nick Klein",
    // Daily check 2026-11-13 (coverage-152, section K): a bubble-tea workshop (11-17), an organ concert (11-18),
    // a rap open mic and two concerts (11-19).
    "Taiwanese Bubble Tea & DIY Instrument Making",
    "Maxime Denuc",
    ">>How many Mics?!?<< (Open Mic with DJ BOOM BAP)",
    "MARIAMA - THE MO(U)RNING STAR EP Release Show",
    "ØTTA HOTTIES ALBUM TOUR",
  ],
  philadelphia: ["William Basinski: 25 Years of Disintegration Loops"],
  // Talks, checked 2026-11-12 (coverage-148 daily check).
  // Coverage daily check 2026-11-13: a yoga class, not a dance night.
  nyc: ["SoleTies: The Conversation & Crafts Experience", "Hard Yoga *"],
  marrakesh: ["LVR CULTURE TALK *"],
  // IndustryHours, Wed 2026-11-18 7pm: a monthly networking mixer, not a dance night (coverage-148 daily check 11-12).
  "los-angeles": ["IndustryHours Monthly Networking Mixer"],
};

/**
 * RA title phrases per metro that name a venue RA leaves blank ("~ at Pensão Amor"), each a KnownVenue of
 * the metro with a checked point; the RA source's `titleVenues` (D-279, D-519 D1).
 */
export const RA_TITLE_VENUES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  lisbon: {
    "at Pensão Amor": "Pensão Amor",
  },
};

export function raSources(metro: string): SeedSource[] {
  const area = RA_AREAS[metro];
  if (area === undefined) return [];
  const cityLabel = CITY_LABELS[metro] ?? metro;
  const notDanceNights = RA_NOT_DANCE_NIGHTS[metro];
  const titleVenues = RA_TITLE_VENUES[metro];
  return [
    {
      url: `https://ra.co/graphql?area=${area}`,
      kind: "ticketing_api" as const,
      trustTier: "ticketing" as const,
      platform: "ra",
      styles: ["dj_night"],
      label: `Resident Advisor ${cityLabel}`,
      ...(notDanceNights ? { notDanceNights } : {}),
      ...(titleVenues ? { titleVenues } : {}),
    },
  ];
}
