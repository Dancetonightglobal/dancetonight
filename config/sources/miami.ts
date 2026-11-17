// Miami's starting sources (D-320). US rules (D-034): official APIs and public pages, robots.txt honoured;
// Resident Advisor, Facebook and Instagram never. Sources are added as they are checked; the daily run also
// seeds venues and discovers their websites (D-120). Spanish screen words ship before any venue page (D-228).

import type { RetiredSource, SeedSource } from "@/config/sources/nyc";
import type { StyleKey } from "@/config/styles";
import { DICE_GENRES, diceSources } from "@/config/sources/dice";

/** DICE's Miami browse pages (D-139, D-197; US, so D-034's US rules). Checked 2026-10-29. */
const DICE_BROWSE = "https://dice.fm/browse/miami-5e3bf1b0fe75488ec46cdf9f/music";

/**
 * The DICE genre pages that list Miami nights (second full read, run 40920462019, 2026-10-29): the other
 * DJ and Party genre pages wrote nothing, or only rows these pages already list; an empty one answers a
 * redirect to the gig list (as in Philadelphia).
 */
const MIAMI_DICE_GENRES = new Set([
  "dj/house",
  "dj/deephouse",
  "dj/tech-house",
  "dj/techno",
  "dj/disco",
  "dj/edm",
  "dj/trance",
  "dj/dance",
  "party/house",
  "party/dance",
]);

/** An Eventbrite organiser, read through the API by ID (D-131); every one screened as a mixed calendar. */
const eventbrite = (url: string, label: string, styles: StyleKey[]): SeedSource => ({
  url,
  kind: "ticketing_api",
  trustTier: "ticketing",
  platform: "eventbrite",
  styles,
  label,
  mixedCalendar: true,
});

/** A directory page: pointers, never the organiser's own word (D-061, D-072). */
const directory = (url: string, label: string, styles: StyleKey[]): SeedSource => ({
  url,
  kind: "html",
  trustTier: "directory",
  styles,
  label,
});

/** A Meetup group's own iCalendar feed (D-035 Q6: no Pro). robots.txt allows /events/ical/ (2026-10-29). */
const meetup = (group: string, label: string, styles: StyleKey[]): SeedSource => ({
  url: `https://www.meetup.com/${group}/events/`,
  kind: "feed_ics",
  feedUrl: `https://www.meetup.com/${group}/events/ical/`,
  trustTier: "first_party",
  styles,
  label,
  mixedCalendar: true,
});

/** Where Rosario's dancing is stated (D-527: own site plus a recent guide). */
const ROSARIO_DANCING =
  "rosariomiami.com home page: 'THE BEST LATIN PARTY IN BRICKELL'; contact page 'WORK HOURS Monday: 09:00 pm – 05:00 am ... Sunday: 09:00 pm – 05:00 am'; miamiandbeaches.de beste Latin-Clubs: 'eine schicke Cocktailbar, die sich jeden Abend in einen exklusiven Latin-Tanzclub verwandelt ... DJ ... Salsa-, Bachata- und Reggaeton-Hits' to 5am (checked 2026-11-01)";

export const MIAMI_SOURCES: readonly SeedSource[] = [
  ...diceSources(
    DICE_BROWSE,
    "Miami",
    DICE_GENRES.filter(([path]) => MIAMI_DICE_GENRES.has(path)),
  ),
  // Salsa Vida's Miami guide: schema.org Events on the page (24 on 10/29, about 12 days ahead; robots.txt
  // allows it). Read as London's is (owner, 2026-10-29, D-321). Its Hallandale Beach rows are outside.
  directory("https://www.salsavida.com/guides/florida/miami/", "Salsa Vida Miami", [
    "salsa",
    "bachata",
  ]),
  // Out x Out's Miami LGBTQ+ events calendar: read daily with its written yes (D-545; all cities, D-558, the owner
  // 2026-11-01); its Terms of Service otherwise bar scrapers and aggregation. robots.txt allows /events/ (disallows
  // only /api/, /admin and similar). schema.org Events on the page (an ItemList of 10 on 11-01: Twist, Palace and
  // Fort Lauderdale / Wilton Manors bars, which the outline leaves out). A directory; a mixed calendar (drag shows,
  // brunches and club nights). The Sunday drag brunch and Palace's Tuesday drag dinner (Tacos, Tequila &
  // Tiaras) are seated shows (D-528).
  {
    ...directory("https://outxout.com/events/miami-fl", "Out x Out Miami", ["queer_party"]),
    kind: "jsonld",
    mixedCalendar: true,
    notDanceNights: ["The Real Drag Brunch of Miami (Sunday)", "Tacos, Tequila & Tiaras"],
  },
  // Eventbrite organisers found by hand from Eventbrite's public Miami search pages, 2026-10-29 (D-131).
  // Salsa, bachata and Latin socials.
  eventbrite(
    "https://www.eventbrite.com/o/miami-salsa-events-15101805796",
    "Miami Salsa Events (Eventbrite)",
    ["salsa", "bachata"],
  ),
  eventbrite(
    "https://www.eventbrite.com/o/miami-salsa-scene-49620407353",
    "Miami Salsa Scene (Eventbrite)",
    ["salsa", "bachata"],
  ),
  // DanceArts, a dance school (250 NE 61st St): these titles are its daytime and beginner classes, read as dance
  // nights (D-519 audit E2; Eventbrite titles in full read 41157878059, 2026-10-31).
  {
    ...eventbrite(
      "https://www.eventbrite.com/o/esther-frances-dmitry-krasnyanskiy-34298594211",
      "DanceArts Miami (Eventbrite)",
      ["salsa", "bachata", "ballroom"],
    ),
    notDanceNights: [
      "Reggaeton - ALL LEVELS",
      "Bachata - BEGINNER",
      "Club Latin - Salsa, bachata, merengue",
      "Contact Improv - ALL LEVELS",
      "Salsa Femme",
    ],
  },
  eventbrite(
    "https://www.eventbrite.com/o/mangos-tropical-cafe-south-beach-58131823103",
    "Mango's Tropical Cafe South Beach (Eventbrite)",
    ["latin_club", "salsa"],
  ),
  eventbrite(
    "https://www.eventbrite.com/o/102546710111",
    "Miami Salsa Party, Ocean Drive (Eventbrite)",
    ["salsa"],
  ),
  eventbrite(
    "https://www.eventbrite.com/o/hazael-rojas-alejandro-marambio-54874923283",
    "Miami Baila Calle 8 (Eventbrite)",
    ["salsa", "rueda"],
  ),
  eventbrite(
    "https://www.eventbrite.com/o/miami-dance-center-76720348273",
    "Miami Dance Center (Eventbrite)",
    ["salsa", "bachata"],
  ),
  eventbrite(
    "https://www.eventbrite.com/o/bachata-sensual-radio-29168493131",
    "Bachata Sensual Radio (Eventbrite)",
    ["bachata", "salsa"],
  ),
  eventbrite(
    "https://www.eventbrite.com/o/flamingoz-a-taste-of-miami-wynwood-120961922525",
    "Flamingoz Wynwood (Eventbrite)",
    ["salsa"],
  ),
  eventbrite(
    "https://www.eventbrite.com/o/miami-nights-120813479648",
    "Miami Nights (Eventbrite)",
    ["salsa"],
  ),
  eventbrite(
    "https://www.eventbrite.com/o/elia-on-the-river-106936988431",
    "Elia on the River (Eventbrite)",
    ["salsa"],
  ),
  eventbrite(
    "https://www.eventbrite.com/o/angelica-casanas-121861957978",
    "The Salsa Room (Eventbrite)",
    ["salsa"],
  ),
  eventbrite(
    "https://www.eventbrite.com/o/vedado-social-club-2959431013",
    "Vedado Social Club, El Bembe (Eventbrite)",
    ["latin_club", "timba"],
  ),
  eventbrite(
    "https://www.eventbrite.com/o/rumbon-latin-party-by-bembe-entertainment-89901525123",
    "Rumbon Latin Party (Eventbrite)",
    ["latin_club"],
  ),
  eventbrite(
    "https://www.eventbrite.com/o/buddy-system-mia-39036827283",
    "Buddy System MIA, The People's Pachanga (Eventbrite)",
    ["latin_club"],
  ),
  // Haitian kompa, Afro-Caribbean, afrobeats and amapiano.
  eventbrite(
    "https://www.eventbrite.com/o/nouvo-koncep-33113177979",
    "Nouvo Koncep, Kompa After Dark (Eventbrite)",
    ["kompa"],
  ),
  eventbrite(
    "https://www.eventbrite.com/o/duo-vybezz-production-100338771981",
    "Duo Vybezz, Miami Sou Konpa (Eventbrite)",
    ["kompa"],
  ),
  eventbrite(
    "https://www.eventbrite.com/o/dgr-productions-54026022283",
    "DGR Productions (Eventbrite)",
    ["kompa"],
  ),
  eventbrite(
    "https://www.eventbrite.com/o/sounds-of-the-shrine-51827972893",
    "Sounds of the Shrine (Eventbrite)",
    ["afrobeats_club", "dancehall"],
  ),
  eventbrite("https://www.eventbrite.com/o/manlikeaya-51330071813", "STAMPED (Eventbrite)", [
    "afrobeats_club",
  ]),
  eventbrite(
    "https://www.eventbrite.com/o/dream-team-events-8350418604",
    "Dream Team Events, soca (Eventbrite)",
    ["dancehall"],
  ),
  eventbrite(
    "https://www.eventbrite.com/o/eclectic-vibes-120876230853",
    "Eclectic Vibes, Afro House Fridays (Eventbrite)",
    ["house", "afrobeats_club"],
  ),
  // R&B and hip-hop club nights.
  eventbrite(
    "https://www.eventbrite.com/o/originaljeanie-64169865593",
    "Thank You! R&B night (Eventbrite)",
    ["hip_hop_club"],
  ),
  eventbrite("https://www.eventbrite.com/o/are-n-bee-llc-8154801805", "Are N Bee (Eventbrite)", [
    "hip_hop_club",
  ]),
  eventbrite(
    "https://www.eventbrite.com/o/miamigonewild-llc-63532776973",
    "Revenge South Beach (Eventbrite)",
    ["hip_hop_club"],
  ),
  // Tango, swing, ecstatic dance, and a venue mixing band nights, country night and tango with other events.
  eventbrite(
    "https://www.eventbrite.com/o/lincoln-road-16774526447",
    "Lincoln Road, Open Air Tango (Eventbrite)",
    ["milonga"],
  ),
  eventbrite(
    "https://www.eventbrite.com/o/all-swing-productions-922662743",
    "All Swing Productions (Eventbrite)",
    ["lindy_hop"],
  ),
  eventbrite("https://www.eventbrite.com/o/zoel-13807534878", "ZOEL, AbunDANCE (Eventbrite)", [
    "ecstatic_dance",
  ]),
  eventbrite(
    "https://www.eventbrite.com/o/the-doral-yard-18376490243",
    "The Doral Yard (Eventbrite)",
    ["latin_club", "line_dance"],
  ),
  // A gap from the early recall check (2026-10-29): PRIVE Fridays at Saucy Boodah (10pm).
  eventbrite(
    "https://www.eventbrite.com/o/afro-events-miami-15315193124",
    "Afro Events Miami, PRIVE Fridays (Eventbrite)",
    ["afrobeats_club", "hip_hop_club"],
  ),
  // Ball & Chain, Little Havana: Salsa bands play for dancers every evening; a noon trio, 6pm jazz
  // sets and a happy hour share the calendar, so its bands count only from 7pm (D-322) and its
  // categories are no dance evidence (D-322, #352). The site moved to Webflow (2026-11-11): the old
  // Events Calendar feed and /live-music/ 404, and /events carries each night as schema.org Event
  // microdata with local start and end times (empty robots.txt), 52 events 11-11..12-31 (D-858).
  // The url stays the source's key; its links go to speakeasygo.com, the venue's own ticketing.
  {
    url: "https://ballandchainmiami.com/live-music/",
    kind: "jsonld",
    feedUrl: "https://ballandchainmiami.com/events",
    trustTier: "first_party",
    styles: ["salsa"],
    label: "Ball & Chain",
    venueAddress: "1513 SW 8th Street, Miami, FL 33135",
    venuePage: true,
    onlyHere: true,
    mixedCalendar: true,
    bandsForDancers: true,
    bandsForDancersFrom: "19:00",
  },
  // Meetup groups' own feeds (3 active "Miami" dance groups, 2026-10-29; "swingdance" left out: it meets at 600 Tennis Club Dr, Fort Lauderdale). The feeds carry no LOCATION.
  meetup("miamisalsaevents", "Miami Salsa Events (Meetup)", ["salsa", "bachata"]),
  meetup("the-salsa-cooperative-miami", "The Salsa Cooperative Miami (Meetup)", ["salsa"]),
  // Hoy Como Ayer, Little Havana (Latin Fever Fridays): its own domain is parked, so the ma.to venue page,
  // which carries the venue's nights as schema.org Events (robots.txt allows it, 2026-10-29). A directory.
  directory("https://ma.to/venue/hoycomoayer.miami", "Hoy Como Ayer (ma.to)", ["salsa"]),
  // EXPANSION Ecstatic Dance (Ecstatic Flow): the organiser's own Wix events page, read without a model by
  // the Wix Events reader (warmup data carries each start); robots.txt allows it, 2026-10-29. Most of its
  // places print "Address w/ Ticket", so those nights stay unplaced (flagged in the report).
  {
    url: "https://www.ecstatic-flow.com/danceevents",
    kind: "wix",
    platform: "wix_events",
    trustTier: "first_party",
    styles: ["ecstatic_dance"],
    label: "EXPANSION Ecstatic Dance (Ecstatic Flow)",
  },
  // Serper-gap leads checked 2026-10-29 (coverage-45, run 40934209137). Left out on their terms: danceus.org's
  // Miami tango and salsa calendars (terms 2.1 forbid reuse without permission) and sabaki.dance (its terms ban
  // automated bots and scraping; it has a keyed API). Pointers only, never sources.
  // Copper Blues, CityPlace Doral: its own Miami page lists the upcoming nights in the HTML (Whiskey Wednesdays
  // country dancing 7pm, Salsa Night Thursdays 9pm, After Hours Salsa Night, DJ nights) beside live bands.
  // Address from its own info page, 2026-10-29. robots.txt allows everything.
  {
    url: "https://copperblueslive.com/locations/miami/live-music/",
    kind: "html",
    trustTier: "first_party",
    styles: ["salsa", "line_dance", "two_step"],
    label: "Copper Blues Miami (Doral)",
    venueAddress: "3450 NW 83rd Ave, Suite 224, Doral, FL 33122",
    venuePage: true,
    onlyHere: true,
    mixedCalendar: true,
    // Its page says Whiskey Wednesdays is country dancing from 7pm; the title names no dance, so the
    // mixed-calendar screen dropped it 8 times on full read 40978916166 (2026-10-30).
    danceNights: ["Whiskey Wednesdays"],
  },
  // DJ dance bars (the owner 10-30: "capturing dj dance bars rather than just ticketed club nights"; sweep by Miami - 5,
  // 2026-10-30). Blackbird Ordinary, Brickell (729 SW 1st Ave): its own site is a link page; its Eventbrite
  // organiser lists the free-RSVP DJ nights (Foolish Hearts Fridays and others).
  eventbrite("https://www.eventbrite.com/o/blackbird-ordinary-17632293075", "Blackbird Ordinary", [
    "dj_night",
  ]),
  // Bars whose own sites draw no calendar (JS shells or no events page): their ma.to venue pages carry the
  // nights as schema.org Events, read like Hoy Como Ayer's (robots.txt allows /venue/, 2026-10-30). Each mixes
  // DJ parties with bands, drag or happy hours, so the no-dance screen applies (mixedCalendar).
  // Mama Tried, Downtown (207 NE 1st St): themed DJ parties Fri/Sat 10pm, 90s Ladies Night Thursdays.
  {
    ...directory("https://ma.to/venue/mamatriedmia", "Mama Tried (ma.to)", ["dj_night"]),
    mixedCalendar: true,
  },
  // Las Rosas, Allapattah (2898 NW 7th Ave): mostly bands; DJ nights such as Emo Night and cumbia/goth nights.
  {
    ...directory("https://ma.to/venue/lasrosasmiami", "Las Rosas (ma.to)", ["dj_night"]),
    mixedCalendar: true,
  },
  // Dante's HiFi+, Wynwood (519 NW 26th St): vinyl DJ sets Thu-Sat and parties like PRESSURE.
  {
    ...directory("https://ma.to/venue/danteshifi", "Dante's HiFi+ (ma.to)", ["dj_night"]),
    mixedCalendar: true,
  },
  // ZeyZey, Little River (353 NE 61st St): Salsa Vs Perreo Fridays, Haitian Vinyl Night Sundays, DJ parties.
  // zeyzey.com answered 429 (recorded, not worked around); zeyzeymiami.com only links a table-booking site.
  {
    ...directory("https://ma.to/venue/zeyzeymiami", "ZeyZey (ma.to)", [
      "dj_night",
      "salsa",
      "latin_club",
    ]),
    mixedCalendar: true,
  },
  // The White Elephant Bar, Wynwood (223 NW 23rd St): Amapiano Sundays dance parties, Friday deep house and
  // Wednesday all-vinyl sessions (its ma.to page, 2026-11-01). D-525 search, gap report fix 8.
  {
    ...directory("https://ma.to/venue/thewhiteelephantbar", "The White Elephant Bar (ma.to)", [
      "dj_night",
    ]),
    mixedCalendar: true,
  },
  // Weekly DJ nights the bar's own site states with no dates (the owner 10-30: "A bars own weekly can count"; D-402
  // weeklyGrid). Café La Trova, Little Havana: "LIVE DJ @ our 80's 305 Bar Friday & Saturday: 12am - 2am" after
  // its live trova music. robots.txt allows all; no terms page (checked 2026-10-30).
  {
    url: "https://www.cafelatrova.com/location/cafe-la-trova/",
    kind: "html",
    trustTier: "first_party",
    styles: ["dj_night"],
    label: "Café La Trova",
    venueAddress: "971 SW 8th St, Miami, FL 33130",
    venuePage: true,
    mixedCalendar: true,
    weeklyGrid: true,
    // Its DJ nights carried no time (4 untimed in full read 41157878059; D-519 audit C5).
    houseHours: {
      start: "00:00",
      end: "02:00",
      days: [5, 6],
      checked:
        "cafelatrova.com location page: 'LIVE DJ @ our 80's 305 Bar Friday & Saturday: 12am - 2am' (2026-10-30)",
    },
  },
  // La Otra, Wynwood: "open from Thursday to Saturday, from 11pm until 5am ... a night of dancing" (Latin club
  // nights). Wix; robots.txt blocks only lightbox and gallery paths; no terms page (checked 2026-10-30).
  {
    url: "https://www.laotramiami.com/",
    kind: "html",
    trustTier: "first_party",
    styles: ["latin_club"],
    label: "La Otra",
    venueAddress: "55 NW 24th St, Miami, FL 33127",
    venuePage: true,
    weeklyGrid: true,
  },
  // Rosario, Brickell (901 Brickell Plaza, Suite 101): its own home page calls it "THE BEST LATIN PARTY IN
  // BRICKELL" and its contact page lists its hours every night of the week; Miami & Beaches' best Latin clubs
  // guide says it turns into a Latin dance club every evening, DJ playing salsa, bachata and reggaeton to 5am
  // (D-527). Its upcoming-events page gives no dates (dance gate), so the contact page's hours are listed as
  // fixed weekly nights, only while those lines stay on the page. robots.txt disallows only /wp-admin/
  // (checked 2026-11-01).
  {
    url: "https://rosariomiami.com/contact/",
    kind: "html",
    trustTier: "first_party",
    styles: ["latin_club"],
    label: "Rosario",
    venuePage: true,
    venueAddress: "901 Brickell Plaza, Suite 101, Miami, FL 33131",
    onlyHere: true,
    fixedNights: [
      {
        title: "Rosario: Latin party (Sunday to Thursday)",
        line: "Monday: 09:00 pm – 05:00 am",
        days: [0, 1, 2, 3, 4],
        start: "21:00",
        end: "05:00",
        danceCited: ROSARIO_DANCING,
      },
      {
        title: "Rosario: Latin party (Friday and Saturday)",
        line: "Friday: 07:00 pm – 05:00 am",
        days: [5, 6],
        start: "19:00",
        end: "05:00",
        danceCited: ROSARIO_DANCING,
      },
    ],
  },
  // where-to-dance-salsa.com (the operator's written permission covers every city, the owner 2026-10-29; D-323,
  // D-383): schema.org DanceEvent JSON-LD on each style's Miami list page (18 salsa, 11 bachata on 10/29,
  // overlapping). Its dates are the site's projection of weekly nights, so only ever a directory. Every row says
  // "Miami" as its locality, even Hollywood and Dania Beach ones; their geo points place them outside.
  // robots.txt allows these paths, checked 2026-10-29. The kizomba page had 1 row and no JSON-LD: left out.
  directory("https://where-to-dance-salsa.com/salsa/miami/", "where-to-dance-salsa Miami salsa", [
    "salsa",
  ]),
  directory(
    "https://where-to-dance-salsa.com/bachata/miami/",
    "where-to-dance-salsa Miami bachata",
    ["bachata"],
  ),
  // TangoMango (tangomango.org, run by the Bay Area Argentine Tango Association): a free community tango calendar.
  // robots.txt allows the listing pages (Crawl-delay 10, honoured); there is no terms page (checked 2026-10-30).
  // The county list is the page's own `show=` value, so other US metros reuse the reader with their counties.
  {
    ...directory(
      "https://www.tangomango.org/index.php?show=Miami-Dade,FL",
      "TangoMango Miami-Dade",
      ["milonga"],
    ),
    kind: "platform_api",
    platform: "tangomango",
  },
  // 5Rhythms (written permission to read the class finder and class pages, D-523, 2026-10-31). Liliana De La Vega's
  // Sunday Waves workshops at The Peacemaker, 8100 SW 81 Dr, Suite 275: the only Miami entries in the finder (10-31).
  {
    url: "https://www.5rhythms.com/classes/Witnessing-299742",
    kind: "html",
    trustTier: "first_party",
    styles: ["five_rhythms"],
    label: "Witnessing 5Rhythms",
  },
  {
    url: "https://www.5rhythms.com/classes/Settling-299743",
    kind: "html",
    trustTier: "first_party",
    styles: ["five_rhythms"],
    label: "Settling 5Rhythms",
  },
];

/** Starting addresses retired, each with the reason (D-047). */
export const MIAMI_RETIRED: readonly RetiredSource[] = [
  // DICE genre pages read on the first two full reads and left out since (MIAMI_DICE_GENRES): a page off
  // the starting list stays switched on until it is retired here (D-047).
  ...DICE_GENRES.filter(([path]) => !MIAMI_DICE_GENRES.has(path)).map(([path]) => ({
    url: `${DICE_BROWSE}/${path}`,
    reason:
      "a DICE genre page that wrote nothing new on Miami's second full read (run 40920462019, 2026-10-29); an empty one redirects to the gig list",
  })),
  // Found by discovery, read on Miami's first full run (2026-10-29, run 40890373942).
  {
    url: "https://myntlounge.com/",
    reason: "its ?ical address answers a web page, not a calendar (first Miami run, 2026-10-29)",
  },
  // Not listed (D-524 gap report, 2026-11-01): E11EVEN stays on its dated nights only; guides call it open 24/7, but
  // its own site gives no hours and a 24/7 line states no dancing (D-529; coverage-87). Taverna Opa (Dolphin Mall,
  // nightly belly dancing that diners join): a dinner show, not a dance night (the owner's call, 2026-11-01, D-528).
  {
    url: "https://www.11miami.com/events",
    reason:
      "E11EVEN's robots.txt disallows its /events/ pages, and the list gives no times: 18 of 18 untimed, 14 unplaced (first Miami run, 2026-10-29)",
  },
  {
    url: "https://www.clubspace.com/shows",
    reason:
      "DICE lists the same Club Space nights with times and the address; this page gave 5 of 5 untimed and unplaced (first Miami run, 2026-10-29)",
  },
  {
    url: "https://www.vipsouthbeach.com/best-dance-nightclubs-miami-south-beach/",
    reason:
      "a guide article with no dated nights; a model read a day for nothing (first Miami run, 2026-10-29)",
  },
  {
    url: "https://www.eventbrite.com/o/kr-event-production-30030987624",
    reason:
      "its nights are in Atlanta and Washington DC: 9 of 9 left out on Miami's third full read (run 40926718106, 2026-10-29)",
  },
  {
    url: "https://www.plgdc.org",
    reason:
      "a dance company's site (stage performances), found by discovery; no nights on three full reads (2026-10-29)",
  },
  {
    url: "https://www.eventbrite.com/o/pier-5-56549886523",
    reason:
      "a venue's own calendar of nights that name no dance (CHISPA, Live From PIER 5): 17 of 17 screened on full read 40935790652 (2026-10-29)",
  },
  {
    url: "https://www.eventbrite.com/o/city-of-coral-gables-8842135697",
    reason:
      "a city's calendar (gallery nights, Halloween events); Giralda Live's titles name no dance, so 4 of 4 screened on full read 40935790652 (2026-10-29)",
  },
  // Found by discovery; retired after the daily read of 2026-10-30 (run 41063394697).
  {
    url: "https://www.faena.com/miami-beach/things-to-do",
    reason:
      "a hotel's things-to-do calendar (lounge live music, jazz series, wellness): 29 written, 22 with no venue, none a dance night (daily read 41063394697, 2026-10-30)",
  },
  {
    url: "https://www.pandoraboxent.com/schedule",
    reason:
      "an event hall's class page: only a Zumba fitness class, Mondays and Wednesdays (daily read 41063394697, 2026-10-30)",
  },
  // Found by discovery; retired after the full read of 2026-11-01 (run 41322199720).
  {
    url: "https://www.implantseminars.com/",
    reason:
      "a dental-implant course calendar (FAIR 2-Day Mastery Course, virtual sessions): wrote 1 non-dance row (full read 41322199720, 2026-11-01)",
  },
  {
    url: "https://bottledblondescottsdale.com/events/",
    reason: "a bar in Scottsdale, Arizona, not Miami (full read 41322199720, 2026-11-01)",
  },
  {
    url: "https://calendar.mdc.edu/",
    reason:
      "Miami Dade College's campus calendar (e.g. Beginner 3D Printing Workshop), not dance nights; failing (full read 41322199720, 2026-11-01)",
  },
  {
    url: "https://regattagrove.com/events",
    reason:
      "a waterfront bar's food and drink events (Smooth Sailing, Spritz Festival, Sip, Savor, Celebrate), no dance named (full read 41322199720, 2026-11-01)",
  },
  {
    url: "http://www.lagniappehouse.com/music-schedule.html",
    reason:
      "a seated wine bar's band billings (D-528: seated rooms only for gigs that name a dance); wrote 9 (full read 41322199720, 2026-11-01)",
  },
  {
    url: "http://acscc.org/",
    reason:
      "not a dance calendar; the feed is not an iCalendar file (full read 41322199720, 2026-11-01)",
  },
  {
    url: "https://churchillspub.com/cart/",
    reason: "a shop cart page, answers 404 (full read 41322199720, 2026-11-01)",
  },
  {
    url: "https://ligacontraelcancer.org",
    reason:
      "a cancer charity's site, not a dance calendar; the feed is not an iCalendar file (full read 41322199720, 2026-11-01)",
  },
  {
    url: "https://www.mooseintl.org/",
    reason:
      "a fraternal order's national site, not a dance calendar; the feed is not an iCalendar file (full read 41322199720, 2026-11-01)",
  },
  // Found by discovery; retired after the daily read of 2026-11-02 (run 41440870332).
  {
    url: "https://palacesouthbeach.com/",
    reason:
      "a drag bar's calendar of drag brunches, lunches and shows (D-528: a show is not a dance night, as the Miami gap report found 2026-11-01): 20 of 23 screened, the 3 written included Tacos, Tequila & Tiaras (daily read 41440870332, 2026-11-02)",
  },
  {
    url: "https://themojitobar.com",
    reason:
      "a bar's 'Live Music at Mojitobar' nights with no time, no venue and no dance named: 8 of 8 untimed and unplaced (daily read 41440870332, 2026-11-02)",
  },
];
