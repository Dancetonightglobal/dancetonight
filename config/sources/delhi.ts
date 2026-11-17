// Delhi's starting sources (D-1140): NCT Delhi, Gurugram and Gautam Buddh Nagar (Noida). India is read under the US
// tier (D-620, standing answer D-520 item 5): official APIs, public pages and feeds, robots.txt honoured, facts only,
// no bot-wall workarounds; Facebook and Instagram never; Resident Advisor only through its GraphQL endpoint (D-505,
// area 324). The owner's yes to Allevents.in's, SkillBox's, District's and HighApe's terms covers India (D-621).
// Starts empty, like London (D-201); the daily run seeds venues and discovers their websites (D-120).

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

const eventbrite = (url: string, label: string, styles: StyleKey[]): SeedSource => ({
  url,
  kind: "ticketing_api",
  trustTier: "ticketing",
  platform: "eventbrite",
  styles,
  label,
  mixedCalendar: true,
});

/** A single event page whose schema.org Event JSON-LD lists each dated night (District's recurring pages). */
const jsonldEventPage = (url: string, label: string, styles: StyleKey[]): SeedSource => ({
  url,
  kind: "jsonld",
  trustTier: "ticketing",
  styles,
  label,
});

// Allevents' Delhi party pages list comedy, melas, workshops, concerts and trips too: titles checked by the metro lead (2026-11-07).
const ALLEVENTS_NOT_DANCE: readonly string[] = [
  "Vipul Goyal- Unleashed",
  "Vipul Goyal-Unleashed",
  "Out Of Syllabus By Sapan Verma",
  "Sapan Verma LIVE",
  "Silly Papa By Angad Singh Ranyal",
  "Arvind Sunder Live",
  "Standup Stars - The Best of Stand-Up",
  "Mukul Sharma Live - A Poetry & Storytelling Show",
  '"YAARAANA" MUSHAIRA & KAVI SAMMELAN',
  "BANGTANVERSE CARNIVAL - FAN TOUR",
  "college me diwali par mela",
  "CHRISTMAS EARTH MELA26",
  "SCC Candlelight Cinema - Love Aaj Kal",
  "Grand Diwali Lunch at Ministry of Sound",
  "Sufi Night at Cafe After Hours",
  "Anmol Salh LIVE at KOCA",
  "Sur Space - Jamming Diaries",
  "Carvaan Live: Best Love Songs at DLF Club 5",
  "Friday the 13th",
  "Clay Ganesha",
  "Pottery Date",
  "The clay affair",
  "Canvas Painting workshop",
  // "Disco Flower Workshop" is a craft class: its "disco" is not a dance night.
  "Disco Flower Workshop",
  "Goa Trip",
  "Himachal Hills Festival (Kasol New Year Party)",
  "Hornbill Festival in Nagaland",
  "The Supper Club: Prasadam",
  "SRCA RAPID PLAY 2026",
  "Passport to People | New Faces, Real Stories, No Pressure",
  "The Rohini Baby Show 2026 – Free Children's Day Event for Kids Aged 1–3",
];

// District's Delhi nightlife pages list karaoke, Sufi and live-music evenings beside the club nights: titles checked
// by the metro lead (2026-11-07).
export const DISTRICT_NOT_DANCE: readonly string[] = [
  "Karaoke Night at Gonzo",
  "Copper Chimney Vishal Cinema, Live Music",
  "Sufi Wednesday Feat. Mohit Oberoi",
  "Sufi Night",
  "Live Music at Moire",
  "Percussion Night at Dearie",
  "Stellar Sunday feat. Rohit Saini Live",
];

export const DELHI_SOURCES: readonly SeedSource[] = [
  // Salsa Vida's New Delhi guide (robots.txt allows it, checked 2026-11-07): weekly Latin socials (Bikers Cafe Wed,
  // Lush Fridays at Flow Brew & Dine, Salsa Saturdays by Kizzbasa, Summer House Cafe Sun, Street of Salsa Tue).
  directory("https://www.salsavida.com/guides/india/new-delhi/", "Salsa Vida New Delhi", [
    "salsa",
    "bachata",
    "kizomba",
  ]),
  // Allevents.in's Delhi party pages (owner's yes to its terms, D-621; /delhi/parties redirects here, and the gurgaon
  // and noida pages repeat it). robots.txt allows /new-delhi/parties and ?page=N (checked 2026-11-07).
  jsonldDirectory(
    "https://allevents.in/new-delhi/parties",
    "Allevents Delhi parties",
    ALLEVENTS_NOT_DANCE,
  ),
  jsonldDirectory(
    "https://allevents.in/new-delhi/parties?page=2",
    "Allevents Delhi parties, page 2",
    ALLEVENTS_NOT_DANCE,
  ),
  jsonldDirectory(
    "https://allevents.in/new-delhi/parties?page=3",
    "Allevents Delhi parties, page 3",
    ALLEVENTS_NOT_DANCE,
  ),
  // TicketFairy (D-1081: the owner approved its public events API, 2026-11-07). The API ignores the city: it returns
  // all of India (347 events, 4 pages on 11-07) and the metro outline keeps Delhi's. It also lists concerts and
  // dinners, so the no-dance screen applies. robots.txt allows /api/v1/events/listing.
  {
    url: "https://www.ticketfairy.com/api/v1/events/listing?country=IN&city=New%20Delhi",
    kind: "ticketing_api",
    trustTier: "ticketing",
    platform: "ticketfairy",
    styles: ["dj_night"],
    label: "TicketFairy India",
    mixedCalendar: true,
  },
  // SkillBox's public event API (#826, owner's yes D-621): Delhi city 2 and Noida 3 (SKILLBOX_CITIES, #1279). Its
  // dance categories are the filter, so it is not screened as a mixed calendar (as Mumbai). The url only names the row.
  {
    ...directory("https://www.skillboxes.com/events?city=delhi", "SkillBox Delhi", ["club"]),
    kind: "platform_api",
    platform: "skillbox",
    mixedCalendar: false,
  },
  // Privee (Shangri-La's Eros Hotel, Connaught Place): the club's own events page, dated nights as text (Diwali Carnival
  // 6-8 Nov on 11-07). Found by the blocked-platform audit (D-758: District, SortMyScene). robots.txt allows /events.
  page("https://www.priveenewdelhi.com/events", "Privee", ["club"]),
  // Kitty Su (The Lalit, Barakhamba Road): its events page lists every city's nights; Mumbai reads kittysu.com/events,
  // whose cards are placed against Mumbai, so Delhi reads the same page at www.kittysu.com (served as is, no redirect,
  // checked 2026-11-07; ?city= empties the list). Zero Delhi nights on a day is normal.
  page("https://www.kittysu.com/events", "Kitty Su Delhi", ["club"]),
  // District (owner's yes to its terms, D-542, D-621): each list page names its 12 soonest nights in a JSON-LD
  // ItemList, and each event's own page gives one Event per night, so jsonld_items reads them with no model.
  // robots.txt allows /events/ and blocks /*?, so there is no paging. District answers 403 to the daily run's servers
  // (first read 42438657733, 2026-11-08: all four District pages here, the Zorba pages too): the reads stay failing and
  // write nothing until District allowlists our user agent (D-548); never worked around (D-542).
  // 11/07: The Afters Edition, X Live Presents: Takeover, Afro Arabic House, Fake Sangeet, Phil Berg at KAI ROOM
  // (Gurugram), Diwali parties at Zylo and Tubata.
  // The gurugram and delhi-ncr pages repeat the delhi page; the music page is concerts; the workshops page is pottery.
  jsonldDirectory(
    "https://www.district.in/events/nightlife-in-delhi-book-tickets",
    "District Delhi nightlife",
    DISTRICT_NOT_DANCE,
  ),
  jsonldDirectory(
    "https://www.district.in/events/nightlife-this-weekend-in-delhi",
    "District Delhi nightlife this weekend",
    DISTRICT_NOT_DANCE,
  ),
  // Zorba the Buddha, Ghitorni (an Osho centre): its own site gives two weekly dance evenings with no dates
  // (zorbathebuddha.org/programs/weekly-events/, robots.txt allows all, checked 2026-11-07); District's recurring
  // event pages give each dated night (three each on 11/07). Drums & Dance: Sundays 5-9pm. Circle of Mystical Dances
  // (ecstatic, 5Rhythms, Sufi whirling and other free-form dances, one a week): Thursdays 6:30-9pm. Dinner included.
  jsonldEventPage(
    "https://www.district.in/events/drums-dance-sundays-buy-tickets",
    "Zorba the Buddha Drums & Dance (District)",
    ["ecstatic"],
  ),
  jsonldEventPage(
    "https://www.district.in/events/circle-of-mystical-dances-may14-2026-buy-tickets",
    "Zorba the Buddha Circle of Mystical Dances (District)",
    ["ecstatic"],
  ),
  // Zorba the Buddha's own weekly pages (robots.txt allows all, 2026-11-08): each writes its weekday and times, so the
  // night is a fixed weekly night (coverage-119's OK, 2026-11-08) while District answers 403 to the daily run (D-548).
  {
    ...page("https://zorbathebuddha.org/programs/weekly-events/drums-dance/", "Zorba the Buddha", [
      "ecstatic",
    ]),
    venueAddress: "7, Tropical Drive, Mehrauli-Gurgaon Road, Ghitorni, New Delhi 110030",
    venuePage: true,
    onlyHere: true,
    // Pinned to plain HTML: probed as jsonld (WebPage markup only), its fixed nights were skipped (read 42551085570).
    platform: "probed",
    fixedNights: [
      {
        title: "Drums & Dance at Zorba the Buddha",
        line: "Drums and Dance (Beverages Included): 5:00 PM – 6:30 PM",
        days: [0],
        start: "17:00",
        end: "18:30",
        danceCited:
          "own site, https://zorbathebuddha.org/programs/weekly-events/drums-dance/: 'Schedule (Every Sunday): Drums and Dance (Beverages Included): 5:00 PM – 6:30 PM', 'Ready to Dance Your Heart Out this Sunday?' (2026-11-08)",
      },
    ],
  },
  {
    // Labelled as the venue: a venue page's label is its rows' venue name (read 42742949283 showed the old label).
    ...page(
      "https://zorbathebuddha.org/programs/weekly-events/circle-of-mystical-dances/",
      "Zorba the Buddha",
      ["ecstatic"],
    ),
    venueAddress: "7, Tropical Drive, Mehrauli-Gurgaon Road, Ghitorni, New Delhi 110030",
    venuePage: true,
    onlyHere: true,
    // Pinned to plain HTML: probed as jsonld (WebPage markup only), its fixed nights were skipped (read 42551085570).
    platform: "probed",
    fixedNights: [
      {
        title: "Circle of Mystical Dances at Zorba the Buddha",
        line: "Circle of Mystical Dances: 6:30 PM – 8:00 PM",
        days: [4],
        start: "18:30",
        end: "20:00",
        venue: "Zorba the Buddha",
        // The model reads the same night off the page (read 42551085570 listed it twice).
        replacesTitles: ["Circle of Mystical Dances"],
        danceCited:
          "own site, https://zorbathebuddha.org/programs/weekly-events/circle-of-mystical-dances/: 'Schedule (Every Thursday): Circle of Mystical Dances: 6:30 PM – 8:00 PM', 'Osho-inspired conscious dance' (2026-11-08)",
      },
    ],
  },
  // Eventbrite organiser (API only, D-015; by id, D-131), found by hand on Eventbrite's public New Delhi search pages
  // (dance, salsa, party, bollywood, techno, bachata; 2026-11-07). Eventbrite is thin in Delhi: one club organiser.
  // SOHO SATURDAY at Soho Club, The Ashok, Chanakyapuri.
  eventbrite("https://www.eventbrite.com/o/120880646548", "Soho Club Delhi (Eventbrite)", ["club"]),
];

/** Starting addresses retired, each with the reason (D-047). */
export const DELHI_RETIRED: readonly RetiredSource[] = [];
