// Mumbai's starting sources (D-620). US rules (D-034, the owner's choice for India): official APIs and public
// pages, robots.txt honoured, facts only; Facebook and Instagram never; Resident Advisor through GraphQL only
// (D-505). The owner said yes to District's, SkillBox's, HighApe's and Allevents.in's terms
// (D-621); District agreed to be read once a day (D-542, 2026-10-31), though it answered 403 to the daily run's
// servers on 10-31 (an allowlist is asked; a 403 stops the read and keeps the old rows, never worked around); SkillBox is read through its own API reader; HighApe is mostly tours and other cities, so it is not read yet;
// BookMyShow and SortMyScene answer 403 to our bot. Sources are added as they are checked; the daily run also
// seeds venues and discovers their websites (D-120).

import type { RetiredSource, SeedSource } from "@/config/sources/nyc";
import type { StyleKey } from "@/config/styles";

const page = (url: string, label: string, styles: StyleKey[]): SeedSource => ({
  url,
  kind: "html",
  trustTier: "first_party",
  styles,
  label,
});

const directory = (url: string, label: string, styles: StyleKey[]): SeedSource => ({
  ...page(url, label, styles),
  trustTier: "directory",
});

const mixedDirectory = (url: string, label: string, styles: StyleKey[]): SeedSource => ({
  ...directory(url, label, styles),
  mixedCalendar: true,
});

/** A mixed directory whose listing pages name event pages carrying schema.org Event JSON-LD. */
const jsonldDirectory = (
  url: string,
  label: string,
  notDanceNights?: readonly string[],
  danceNights?: readonly string[],
): SeedSource => ({
  ...mixedDirectory(url, label, ["club"]),
  kind: "jsonld",
  platform: "jsonld_items",
  ...(notDanceNights ? { notDanceNights } : {}),
  ...(danceNights ? { danceNights } : {}),
});

// Allevents' party pages list fairs, workshops, concerts and talks too: titles checked by the metro lead (2026-10-31).
const ALLEVENTS_NOT_DANCE: readonly string[] = [
  "A Tribute to Arijit Singh at Lyla",
  "CHEMBUR KIDS CARNIVAL",
  "Jumbo’s Joyful Diwali Mela",
  "Bad Drawing Party",
  "MMI Musicians Collab October 2026",
  "Trinket Tray Painting",
  "Mumbai Car Show Expo Event 2026-2027",
  "Vegan Mumbai Potluck (2026)",
  "Navi Mumbai Comic Con",
  "KIDZWORLD EXPO - SOUTH MUMBAI",
  "KIDZWORLD EXPO THANE",
  "LockTheBox Book Fair Mumbai 2026 | Fill A Box With Books",
  "Rann of Kutch Festival",
  "Diwali Dhamaka Offer",
  "Matcha + Meetup: Mumbai | Film + Music Industry Monthly Mingle",
  "Hahakaar - A FilterCopy Comedy Festival",
  "Silly Papa By Angad Singh Ranyal",
  "Out Of Syllabus - Sapan Verma - 2026 New Tour",
  // A singing tribute to S.D. Burman (Hindi title), not a dance night (2026-11-01).
  "स्वरांजलि पद्मश्री एस डी बर्मन साहब",
  "Olivier Giraud Live - India Tour",
  "Soul Satsang",
  "Defender Weekend",
  // Checked 2026-10-31 by the metro lead: a painting class at a paint studio, a 4-6pm networking meetup, a 4pm community
  // festival at Nayra.
  "Paint With Strangers",
  "SOCIAL MEETUP",
  "Aarpoo",
  // The Acres Club, Chembur is a members' club ("Ladies Day Out"), not a public night; Allevents also gives it 4pm
  // against the title's 7pm (D-524 gap report, coverage - 80, 2026-10-31).
  "Ladies Night at The Acres Club, Chembur | Every Wednesday, 7PM Onwards.",
  // Checked 2026-11-02 by the metro lead (run 41380465100): a food festival at The Acres Club, and a seated concert of
  // Bollywood songs ("60% seats are booked"), not a DJ night.
  "Lebanese Food Festival at the Poolside Cafe | 3rd to 10th November.",
  "Bollywood Musical Jashn Season 4",
];

// Allevents' party nights that name no dance word but are DJ nights people dance at (D-620: Bollywood and
// commercial DJ nights count). "Bombay Velvet 2.0 Ft. DJ Ganesh at Dragonfly" (11-13, 8pm) was dropped by the
// no-dance screen in run 41269267054 (coverage - 89, 2026-11-01). Prefix entries: their words open the title.
const ALLEVENTS_DANCE: readonly string[] = ["Bombay Velvet *"];

// District's nightlife and music pages list karaoke, unplugged sets, rock gigs and concerts too: titles checked by the
// metro lead (2026-10-31). Retro Bollywood at Nosh is a sing-along with no DJ (D-620).
const DISTRICT_NOT_DANCE: readonly string[] = [
  "Karaoke Sunday ft. Mumbai Karaoke at Roxanne's",
  "Karaoke Thursday at Nosh and Beyond Café and Bar",
  "Unplugged Wednesday Ft. Aarush Parihar at The Stables",
  "Mehfil Monday ft. Shivraj bhul at The Stables",
  "Live Music Night at Dreamhouse Bistro",
  "Live and Loud ft. Dread Rock at Bora Bora Juhu",
  "Retro Bollywood Night at Nosh and Beyond Café and Bar",
  "Tiki Room - Waikiki",
  "Jamming Session",
  "Durbar Evenings by Godawan Estuary Water ft. Purbayun Chatterjee",
  "Godawan Durbar Evenings - Orchestral Qawwali Project | Mumbai",
  "Papon Live In Concert | Mumbai",
];

export const MUMBAI_SOURCES: readonly SeedSource[] = [
  // Salsa Vida's Mumbai guide: schema.org Events in the page's JSON-LD (6 on 10/31, three weekly socials: Khar
  // Social Party, Mondays at Ramee Guestline Hotel, Khar; Latin Twist Socials, Wednesdays at Mirage, Santacruz
  // West; Sensual Thursdays at Afro Latin Wave, Miller House, Khar). robots.txt allows it (User-agent: * /
  // Disallow: empty, checked 2026-10-31). Read as the other metros' Salsa Vida guides are (owner, D-321).
  directory("https://www.salsavida.com/guides/india/mumbai/", "Salsa Vida Mumbai", [
    "salsa",
    "bachata",
    "kizomba",
  ]),
  // Zerua, the rooftop lounge at Atria - The Millennium Mall, Worli: its own events page, found by discovery
  // (run 41172161951). Two weekly nights on 10/31: "Sunset Hrs" on Sundays ("dancing with friends", kept) and
  // "Top of Twilight" on Saturdays at 8pm, a bar night with a lounge DJ that is not billed as dancing
  // (coverage - 74, 2026-10-31, as San Juan's Latin Soiree). robots.txt allows it (checked 2026-10-31).
  {
    ...page("https://zeruamumbai.com/upcoming-events/", "Zerua", ["club"]),
    notDanceNights: ["Top of Twilight"],
  },
  // Allevents.in's Mumbai party pages (owner's yes to its terms, D-621): 15 schema.org Events per page with full
  // addresses and date-only starts; each event page's JSON-LD has the full start and end (+05:30). Pages 1-4
  // cover about two weeks (ranked by popularity, so they overlap); ~20 dance or party nights for 10/31-11/6.
  // robots.txt allows /mumbai/parties and ?page=N (it blocks only /manage/, /go.php, two /api/ paths, pre-2024
  // date pages and ?ref= variants), checked 2026-10-31. Its JSON API needs a client-state token: never used.
  jsonldDirectory(
    "https://allevents.in/mumbai/parties",
    "Allevents Mumbai parties",
    ALLEVENTS_NOT_DANCE,
    ALLEVENTS_DANCE,
  ),
  jsonldDirectory(
    "https://allevents.in/mumbai/parties?page=2",
    "Allevents Mumbai parties, page 2",
    ALLEVENTS_NOT_DANCE,
    ALLEVENTS_DANCE,
  ),
  jsonldDirectory(
    "https://allevents.in/mumbai/parties?page=3",
    "Allevents Mumbai parties, page 3",
    ALLEVENTS_NOT_DANCE,
    ALLEVENTS_DANCE,
  ),
  jsonldDirectory(
    "https://allevents.in/mumbai/parties?page=4",
    "Allevents Mumbai parties, page 4",
    ALLEVENTS_NOT_DANCE,
    ALLEVENTS_DANCE,
  ),
  // District (D-542, 2026-10-31): each list page names its 12 soonest nights in a JSON-LD ItemList, and each event's own
  // page gives one Event per night, so jsonld_items reads them with no model. robots.txt allows /events/ and blocks
  // /*?, so there is no paging. Its nightlife and music pages mix karaoke, gigs and concerts: titles checked 2026-10-31.
  jsonldDirectory(
    "https://www.district.in/events/nightlife-in-mumbai-book-tickets",
    "District Mumbai nightlife",
    DISTRICT_NOT_DANCE,
  ),
  jsonldDirectory(
    "https://www.district.in/events/nightlife-this-weekend-in-mumbai",
    "District Mumbai nightlife this weekend",
    DISTRICT_NOT_DANCE,
  ),
  jsonldDirectory(
    "https://www.district.in/events/music-in-mumbai-book-tickets",
    "District Mumbai music",
    DISTRICT_NOT_DANCE,
  ),
  // SkillBox's public event API (#826): India only. Its dance categories are the filter, so it is not screened as a
  // mixed calendar (coverage - 78: DJ and Bollywood party nights are listable, D-520); its live concert is not a dance night.
  {
    ...directory("https://www.skillboxes.com/events", "SkillBox", ["club"]),
    kind: "platform_api",
    platform: "skillbox",
    mixedCalendar: false,
    notDanceNights: ["Damru live at Waves- Sonic Diwali"],
  },
  // Kitty Su, The LaLiT Mumbai (Andheri East): the club's own events page, cards for all its Indian cities; only the
  // Mumbai cards fall inside the metro. Found by the blocked-platform audit (District, D-758, 2026-11-06); the cities
  // lead asked for it (cities - 5). Zero Mumbai nights on a day is normal.
  page("https://kittysu.com/events", "Kitty Su", ["club"]),
];

export const MUMBAI_RETIRED: readonly RetiredSource[] = [
  {
    url: "https://www.district.in/events/social-mixers-in-mumbai-book-tickets",
    reason:
      "Not dance: District's social mixers are meetups, games and dating mixers (12 of 12 checked 2026-10-31, D-542).",
  },
  {
    url: "https://www.district.in/events/upcoming-events-in-mumbai",
    reason:
      "Not read: every category (comedy, theatre, kids, tours); its nightlife and music pages are read instead (D-542).",
  },
  {
    url: "https://warehouse.g5a.org/calendar/",
    reason:
      "Not dance: G5A Warehouse is a theatre and arts space; discovery switched it on as a venue calendar and its 7 rows were theatre shows and workshops (run 41269267054, 2026-11-01).",
  },
  {
    url: "https://www.raceconferences.com/",
    reason:
      "Not dance: a conference organiser; discovery switched it on as a venue calendar (run 41269267054, 2026-11-01).",
  },
  {
    url: "https://vrohospitality.com/",
    reason:
      "Wrong place: VRO Hospitality is a Bangalore restaurant chain; discovery switched it on as a venue calendar and its events page answers 404 (run 41380465100, 2026-11-02).",
  },
  {
    url: "https://www.powaifinearts.org/",
    reason:
      "Not dance: a fine-arts society whose site is unreachable; discovery switched it on and it never gave an iCalendar feed (run 41380465100, 2026-11-02).",
  },
  {
    url: "https://ymcabombay.org/",
    reason:
      "Not dance: YMCA Bombay's site names no dance; discovery switched it on and it never gave an iCalendar feed (run 41380465100, 2026-11-02).",
  },
  {
    url: "https://rjdance.com/calendar/",
    reason:
      "Wrong place: Overture gave this site to a Mumbai studio, but its Google Calendar is a Los Angeles studio's (TZID America/Los_Angeles, ballroom and West Coast Swing classes), checked 2026-10-31.",
  },
];
