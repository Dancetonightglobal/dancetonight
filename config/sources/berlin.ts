// Berlin's starting sources (D-1020). Germany is EU: D-034's EU tier (official APIs, public pages and feeds,
// robots.txt honoured, no unofficial endpoint without written consent, no bot-wall workarounds); Facebook and
// Instagram never; Resident Advisor only through its GraphQL endpoint (D-505, area 34). First sources: D-1023.

import { diceSources } from "@/config/sources/dice";
import type { RetiredSource, SeedSource } from "@/config/sources/nyc";
import type { StyleKey } from "@/config/styles";

/**
 * DICE's Berlin browse pages (the owner's yes for Germany, 2026-11-06, D-1020; browse pages only, D-197). Every
 * Berlin genre page (salsa, techno, house...) answers a 307 redirect to the gig list (checked 2026-11-06), so
 * only the DJ and Party pages are read. robots.txt allows all but /api/.
 */
const DICE_BROWSE = "https://dice.fm/browse/berlin-5e426dbb749e68e3e923d1e4/music";

/** An Eventbrite organiser, read through the API (D-015, D-131): a mixed calendar. */
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
  mixedCalendar: true,
});

/** tangosociety.de's milonga list, one page per weekday (Montag is the list's own page). */
const TANGOSOCIETY_DAYS = [
  ["milongas-berlin", "Montag"],
  ["milongas-berlin-dienstag", "Dienstag"],
  ["milongas-berlin-mittwoch", "Mittwoch"],
  ["milongas-berlin-donnerstag", "Donnerstag"],
  ["milongas-berlin-freitag", "Freitag"],
  ["milongas-berlin-samstag", "Samstag"],
  ["milongas-berlin-sonntag", "Sonntag"],
] as const;

export const BERLIN_SOURCES: readonly SeedSource[] = [
  // A band gig at Club Gretchen on DICE (Fri 2026-11-13 9pm, read 2026-11-08), as on RA (config/sources/ra.ts).
  ...diceSources(DICE_BROWSE, "Berlin", []).map((s) => ({
    ...s,
    notDanceNights: ["Psychedelic Porn Funk Experience ● Berlin"],
  })),
  // Eventbrite organisers (API only, D-015; by id, D-131), found by hand on eventbrite.de's public Berlin search
  // pages for 22 dance words, 2026-11-06 (275 events, 150 organisers; robots allows /d/ and /e/). All mixed
  // calendars: their non-dance rows (concerts, workshops, tours) are screened out.
  eventbrite("https://www.eventbrite.de/o/17098181282", "Maxxim Club Berlin (Eventbrite)", [
    "retro",
    "dj_night",
  ]),
  eventbrite("https://www.eventbrite.de/o/8503327526", "Matrix Club Berlin (Eventbrite)", [
    "dj_night",
  ]),
  eventbrite("https://www.eventbrite.de/o/42544943393", "Herbert Club Disco (Eventbrite)", [
    "dj_night",
  ]),
  eventbrite(
    "https://www.eventbrite.de/o/36790260633",
    "Dancing With Myself 80s Party (Eventbrite)",
    ["retro"],
  ),
  eventbrite("https://www.eventbrite.de/o/33300792149", "dasmituns parties (Eventbrite)", [
    "dj_night",
  ]),
  eventbrite("https://www.eventbrite.de/o/90026362913", "Fandom Night (Eventbrite)", ["dj_night"]),
  eventbrite("https://www.eventbrite.de/o/20248476054", "OUTNOW Events (Eventbrite)", ["retro"]),
  eventbrite("https://www.eventbrite.de/o/29374561583", "Top90s Party Berlin (Eventbrite)", [
    "retro",
  ]),
  eventbrite("https://www.eventbrite.de/o/45909481443", "Dynablaster (Eventbrite)", [
    "dancehall",
    "afrobeats_club",
  ]),
  eventbrite("https://www.eventbrite.de/o/52372498073", "We Love Afrobeats (Eventbrite)", [
    "afrobeats_club",
  ]),
  eventbrite("https://www.eventbrite.de/o/119460191481", "Surprise Club Berlin (Eventbrite)", [
    "afrobeats_club",
  ]),
  eventbrite("https://www.eventbrite.de/o/6882630509", "Afro Haus (Eventbrite)", [
    "afrobeats_club",
    "house",
  ]),
  eventbrite("https://www.eventbrite.de/o/73013510783", "Tipsy Bear Berlin (Eventbrite)", [
    "queer_party",
  ]),
  eventbrite("https://www.eventbrite.de/o/50318338913", "WeDesi Berlin (Eventbrite)", [
    "bollywood",
  ]),
  eventbrite("https://www.eventbrite.de/o/121086875113", "Bollywood House Berlin (Eventbrite)", [
    "bollywood",
  ]),
  eventbrite("https://www.eventbrite.de/o/104496846171", "Electric Social (Eventbrite)", ["retro"]),
  eventbrite(
    "https://www.eventbrite.de/o/16479453293",
    "Conexion Salsa (Pfefferwerk) (Eventbrite)",
    ["salsa"],
  ),
  eventbrite("https://www.eventbrite.de/o/8374384197", "Cumbancha (Eventbrite)", ["salsa"]),
  eventbrite("https://www.eventbrite.de/o/105694874071", "Fania Brava Party (Eventbrite)", [
    "salsa",
  ]),
  eventbrite("https://www.eventbrite.de/o/121838239100", "Latido Berlin (Eventbrite)", [
    "latin_club",
  ]),
  eventbrite("https://www.eventbrite.de/o/34037990667", "Kizomba Berlin (Eventbrite)", [
    "kizomba",
    "urban_kiz",
  ]),
  eventbrite(
    "https://www.eventbrite.de/o/56655440263",
    "Christian Rippel ecstatic dance (Eventbrite)",
    ["ecstatic_dance"],
  ),
  eventbrite(
    "https://www.eventbrite.de/o/106828272711",
    "Sober Berlin ecstatic dance (Eventbrite)",
    ["ecstatic_dance"],
  ),
  eventbrite("https://www.eventbrite.de/o/58187570623", "Ram Chama ecstatic dance (Eventbrite)", [
    "ecstatic_dance",
  ]),
  eventbrite(
    "https://www.eventbrite.de/o/121796491901",
    "Dance Your Dance with Nilo (Eventbrite)",
    ["ecstatic_dance"],
  ),
  eventbrite("https://www.eventbrite.de/o/39160184783", "5Rhythms with Oliver (Eventbrite)", [
    "five_rhythms",
  ]),
  // Venues' own sites (robots.txt checked 2026-11-06; each read once a day).
  // Clärchens Ballhaus, Mitte: the 1913 dance hall's own "Tanz" page, its weekly nights under weekday headings
  // ("Fast jeden Montag ... 19:00-00:00 Uhr: Salsa DJ Wilber", "Fast jeden Dienstag ... 20:15 bis 23:15 Uhr:
  // Swing-Tanzabend", 2026-11-06). Own-site weeklies count (the owner 2026-10-30). Its programme page is a JS calendar.
  {
    url: "https://claerchensball.haus/tanz/",
    kind: "html",
    trustTier: "first_party",
    styles: ["salsa", "swing", "tango"],
    label: "Clärchens Ballhaus",
    weeklyGrid: true,
    venuePage: true,
    venueAddress: "Auguststraße 24, 10117 Berlin",
  },
  // Havanna, Schöneberg: the salsa club's own site lists its weekly opening nights ("Wednesday 20:00 – open end,
  // Friday 22:00, Saturday 22:00", 2026-11-06), so a weekly grid; every night is a dance night. Squarespace:
  // no ?format= view (robots.txt).
  {
    url: "https://www.havanna-berlin.de/events",
    kind: "html",
    trustTier: "first_party",
    styles: ["salsa", "bachata", "reggaeton"],
    label: "Havanna Berlin",
    venuePage: true,
    onlyHere: true,
    // The page holds only its Hours block, so the model read nothing (never wrote a row, read 2026-11-09):
    // the three nights are fixed. Dancing: /dance-lesson "Every Wednesday, Friday and Saturday ... Salsa,
    // Bachata" lessons an hour before opening; /location "on Wednesdays and Fridays dancing to salsa,
    // merengue and bachata", Saturdays "dance and disco classics" and Reggaeton (2026-11-09).
    fixedNights: [
      {
        title: "Wednesday Salsa & Bachata at Havanna",
        line: "Wednesday 20:00 – open end",
        days: [3],
        start: "20:00",
        styles: ["salsa", "bachata"],
        danceCited: "own site, https://www.havanna-berlin.de/dance-lesson + /location (2026-11-09)",
      },
      {
        title: "Friday Latin Party at Havanna",
        line: "Friday 22:00 – open end",
        days: [5],
        start: "22:00",
        styles: ["salsa", "bachata", "reggaeton"],
        danceCited: "own site, https://www.havanna-berlin.de/friday + /location (2026-11-09)",
      },
      {
        title: "Saturday Party at Havanna",
        line: "Saturday 22:00 – open end",
        days: [6],
        start: "22:00",
        styles: ["reggaeton", "dj_night"],
        danceCited: "own site, https://www.havanna-berlin.de/location (2026-11-09)",
      },
    ],
    weeklyGrid: true,
    venueAddress: "Hauptstraße 30, 10827 Berlin",
  },
  // Badehaus, RAW-Gelände Friedrichshain: its The Events Calendar iCalendar export (50 events on 2026-11-06, no
  // LOCATION, so the venue is this page). Concerts and party nights, hence the screen.
  {
    url: "https://badehaus-berlin.com/events/",
    kind: "feed_ics",
    feedUrl: "https://badehaus-berlin.com/events/?ical=1",
    trustTier: "first_party",
    styles: ["dj_night"],
    label: "Badehaus Berlin",
    mixedCalendar: true,
    venuePage: true,
    venueAddress: "Revaler Straße 99, 10245 Berlin",
  },
  // YAAM, Friedrichshain: the beach club's own iCalendar export (reggae, dancehall and afro nights, jams and
  // markets, hence the screen; 2 events on 2026-11-06, its season is summer).
  {
    url: "https://yaam.de/events/",
    kind: "feed_ics",
    feedUrl: "https://yaam.de/events/?ical=1",
    trustTier: "first_party",
    styles: ["dancehall", "afrobeats_club"],
    label: "YAAM Berlin",
    mixedCalendar: true,
    venuePage: true,
    venueAddress: "An der Schillingbrücke 3, 10243 Berlin",
  },
  // Lido, Kreuzberg: its own programme on the front page (mostly concerts; the party nights are dasmituns', also on
  // Eventbrite). Not /events: that is the archive (rows dated 2008 on the first read, run 42184314532).
  {
    url: "https://www.lido-berlin.de/",
    kind: "html",
    trustTier: "first_party",
    styles: ["dj_night"],
    label: "Lido Berlin",
    mixedCalendar: true,
    venuePage: true,
    venueAddress: "Cuvrystraße 7, 10997 Berlin",
  },
  // Sweep 1 (2026-11-06): club and dance-school own pages with dated nights; robots.txt checked 2026-11-06.
  // Soda Club, Kulturbrauerei Prenzlauer Berg: its own dated list (Soda Social Club salsa/bachata/kizomba every
  // Thursday and Sunday with classes, Famous Friday and Sodalicious club nights, 5 floors).
  {
    url: "https://www.soda-berlin.de/events",
    kind: "html",
    trustTier: "first_party",
    styles: ["salsa", "bachata", "kizomba", "dj_night"],
    label: "Soda Club Berlin",
    venuePage: true,
    onlyHere: true,
    venueAddress: "Schönhauser Allee 36, 10435 Berlin",
  },
  // Weekend Club, Alexanderplatz rooftop: its own Squarespace events list (house, Latin and 80s/90s nights).
  {
    url: "https://www.weekendclub.berlin/upcoming",
    kind: "html",
    trustTier: "first_party",
    styles: ["dj_night", "latin_club"],
    label: "Weekend Club Berlin",
    mixedCalendar: true,
    venuePage: true,
    onlyHere: true,
    venueAddress: "Alexanderstraße 7, 10178 Berlin",
  },
  // Tanzschule weRK36, Schöneberg: its own events page (WERKtanzparty Standard/Latein first Saturdays, Milonga,
  // Candy Swing, 36 Grad West Coast Swing, Disco Fever; Tanzfrühstück mornings). Its course calendar is left out.
  {
    url: "https://werk36.de/events/",
    kind: "html",
    trustTier: "first_party",
    styles: ["social_ballroom", "west_coast_swing", "lindy_hop", "tango", "discofox"],
    label: "Tanzschule weRK36",
    mixedCalendar: true,
    venuePage: true,
    onlyHere: true,
    venueAddress: "Sachsendamm 93, 10829 Berlin",
  },
  // La Mambita, Schöneberg: the salsa school's "Tanzen gehen" page (Mambo Café and Salsa Party dates; Mambo Café
  // fortnightly from January 2027 with its dates listed).
  {
    url: "https://www.mambita.de/tanzen-gehen/",
    kind: "html",
    trustTier: "first_party",
    styles: ["salsa", "mambo", "cha_cha"],
    label: "La Mambita",
    venuePage: true,
    onlyHere: true,
    venueAddress: "Kolonnenstraße 29, 10829 Berlin",
  },
  // Tanzschule MAXIXE, Kreuzberg: its own events list (Tango Café Saturdays, Maxixe Hop swing, Beginner Night,
  // themed Standard/Latin nights; also workshops, hence the screen).
  {
    url: "https://www.maxixe.de/events.html",
    kind: "html",
    trustTier: "first_party",
    styles: ["social_ballroom", "tango", "lindy_hop"],
    label: "Tanzschule MAXIXE",
    mixedCalendar: true,
    venuePage: true,
    onlyHere: true,
    venueAddress: "Fidicinstraße 3, 10965 Berlin",
  },
  // Tanzschule Traumtänzer: dated Tanzpartys at its three schools (Flughafen Tempelhof Columbiadamm 8, Kurfürstendamm,
  // Mariendorf), each row with its own school, so no single venue. Ballhaus Tanzparty, KuDamm Tanzparty, Discofox,
  // LineDance and Milonga im Flughafen. Read through its per-event .ics links, no model (D-873: the 442 KB page
  // lost 6-8 of ~20 events per model read). Kind "jsonld" as for Swing Out London: an "html" row with a platform is
  // re-probed and read by the model (D-791).
  {
    url: "https://www.traumtaenzer.de/tanzparty/",
    kind: "jsonld",
    trustTier: "first_party",
    platform: "ics_links",
    styles: ["social_ballroom", "discofox", "line_dance", "tango"],
    label: "Tanzschule Traumtänzer",
    mixedCalendar: true,
  },
  // Kulturzentrum Peter Edel, Weißensee: its own events list (80s parties, Sonntagsschön Indie & Wave Tanzcafé,
  // After-Work-Party; also concerts and karaoke, hence the screen).
  {
    url: "https://www.peteredel.de/events/",
    kind: "html",
    trustTier: "first_party",
    styles: ["retro", "dj_night"],
    label: "Kulturzentrum Peter Edel",
    mixedCalendar: true,
    venuePage: true,
    onlyHere: true,
    venueAddress: "Berliner Allee 125, 13088 Berlin",
  },
  // DJ-bar and forum sweeps (2026-11-06); robots.txt checked 2026-11-06.
  // Soulcat, Neukölln: the 50s/60s vinyl bar's own programme (DJ nights "Dancers Welcome", free entry; also
  // football screenings and bartender's-choice nights, hence the screen). Its calendar views are disallowed, the
  // front page is not.
  {
    url: "https://soulcat-berlin.com/",
    kind: "html",
    trustTier: "first_party",
    styles: ["rock_n_roll", "retro", "dj_night"],
    label: "Soulcat Berlin",
    mixedCalendar: true,
    // The bartender plays records, no DJ, no dancing billed (listed Mon and Wed after the first read).
    notDanceNights: ["60s RnB & Soul & Blues & RocknRoll – Bartenders Choice*"],
    venuePage: true,
    onlyHere: true,
    venueAddress: "Pannierstraße 53, 12047 Berlin",
  },
  // Frannz Club, Kulturbrauerei: its own programme on the front page (Tannz im Frannz, Millennial Mixtape,
  // Flashbacks parties; also concerts, readings and markets, hence the screen).
  {
    url: "https://frannz.eu/",
    kind: "html",
    trustTier: "first_party",
    styles: ["retro", "dj_night"],
    label: "Frannz Club",
    mixedCalendar: true,
    venuePage: true,
    onlyHere: true,
    venueAddress: "Schönhauser Allee 36, 10435 Berlin",
    // Messa (a metal band) on Thu 2026-11-12, listed as "Messa -ausverkauft" (sold out); daily check 11-12.
    notDanceNights: ["Messa*"],
  },
  // Swing in Berlin (Meetup): the swing community group's own iCal feed (balls and socials; 1 dated event on
  // 2026-11-06, the Weihnachtsball am Kudamm). robots.txt does not disallow it.
  {
    url: "https://www.meetup.com/swing-in-berlin/events/",
    kind: "feed_ics",
    feedUrl: "https://www.meetup.com/swing-in-berlin/events/ical/",
    trustTier: "first_party",
    styles: ["lindy_hop", "balboa"],
    label: "Swing in Berlin (Meetup)",
    mixedCalendar: true,
  },
  // D-758 audit finds (rausgegangen / tip Berlin / eventfinder read by hand, 2026-11-06); robots.txt checked 2026-11-06.
  // freiheit fünfzehn, Köpenick: party location on the Dahme; its "Kulturwelt" page carries JSON-LD events
  // (41 on 2026-11-06: Ballhaus Nacht, Knutschen fetzt Singleparty, Altstadt Beats; also other shows, hence the screen).
  {
    url: "https://freiheit15.com/kulturwelt",
    kind: "jsonld",
    platform: "jsonld_items",
    trustTier: "first_party",
    styles: ["dj_night", "retro"],
    label: "freiheit fünfzehn",
    mixedCalendar: true,
    venuePage: true,
    onlyHere: true,
    venueAddress: "Freiheit 15, 12555 Berlin",
  },
  // Privatclub, Kreuzberg: its own programme on the front page as JSON-LD (100 events on 2026-11-06, mostly
  // concerts and slams; party nights such as Dance Dance Revolution), hence the screen.
  {
    url: "https://privatclub-berlin.de/",
    kind: "jsonld",
    platform: "jsonld_items",
    trustTier: "first_party",
    styles: ["dj_night", "retro"],
    label: "Privatclub Berlin",
    mixedCalendar: true,
    venuePage: true,
    onlyHere: true,
    venueAddress: "Skalitzer Straße 85-86, 10997 Berlin",
  },
  // BRICKS, Mitte (Mohrenstraße, renamed Anton-Wilhelm-Amo-Straße in 2025): the hip-hop club's own events page ("FREITAG 13.11. 11pm", Any Given Friday weekly).
  {
    url: "https://www.bricks-berlin.club/events-guestlist",
    kind: "html",
    trustTier: "first_party",
    styles: ["hip_hop_club", "dj_night"],
    label: "BRICKS Club Berlin",
    mixedCalendar: true,
    venuePage: true,
    onlyHere: true,
    venueAddress: "Anton-Wilhelm-Amo-Straße 30, 10117 Berlin",
  },
  // berlin.de ticket series pages (the owner, 2026-11-06, D-1025): two Ü40 dance nights with no site of their own.
  // The JSON-LD startDate is the date at local midnight, so read as html: the page text gives "Samstag, 07. November
  // 2026, 18:00 Uhr". robots.txt allows /tickets/ (checked 2026-11-06).
  {
    url: "https://www.berlin.de/tickets/party/fruehtanz-in-der-eierschale-dahlem-c30c838e-ec1d-4276-9003-331921c3d692/",
    kind: "html",
    trustTier: "first_party",
    styles: ["retro", "dj_night"],
    label: "Eierschale Dahlem",
    venuePage: true,
    onlyHere: true,
    venueAddress: "Podbielskiallee 50, 14195 Berlin",
  },
  {
    url: "https://www.berlin.de/tickets/party/ue40-party-berlin-die-party-fuer-alle-ue40-in-berlin-7403b301-ff35-473e-b71a-8d92c05babb0/",
    kind: "html",
    trustTier: "first_party",
    styles: ["retro", "dj_night"],
    label: "Tiffany Club",
    venuePage: true,
    onlyHere: true,
    venueAddress: "Rosmarinstraße 8, 10117 Berlin",
  },
  // Salsa Vida's Berlin guide: schema.org Events on each event page (11 on the guide 2026-11-06); robots.txt
  // allows all, checked 2026-11-06. Read as London's and Lisbon's are (owner, D-321).
  // Salsa Vida lists only dance nights, so its titles are not screened as a mixed calendar (D-772).
  {
    ...directory("https://www.salsavida.com/guides/germany/berlin/", "Salsa Vida Berlin", [
      "salsa",
      "bachata",
      "kizomba",
    ]),
    mixedCalendar: false,
  },
  // where-to-dance-salsa.com (owner's written permission, D-383): DanceEvent JSON-LD on each style's Berlin
  // list page. Its dates are the site's own projection of weekly nights, so it is only ever a directory.
  // robots.txt allows these paths, checked 2026-11-06.
  directory("https://where-to-dance-salsa.com/salsa/berlin/", "where-to-dance-salsa Berlin salsa", [
    "salsa",
  ]),
  directory(
    "https://where-to-dance-salsa.com/bachata/berlin/",
    "where-to-dance-salsa Berlin bachata",
    ["bachata"],
  ),
  directory(
    "https://where-to-dance-salsa.com/kizomba/berlin/",
    "where-to-dance-salsa Berlin kizomba",
    ["kizomba"],
  ),
  // tangosociety.de's milonga list (owner's yes 2026-11-06, D-1020: no terms page, robots.txt allows us, D-526):
  // weekly milongas ("Jeden Montag") and dated ones ("Montag 02.11.26") with times and addresses. Its Potsdam
  // rows (Villa Arnim) are outside the outline and left out by it.
  ...TANGOSOCIETY_DAYS.map(([path, day]) =>
    directory(`https://www.tangosociety.de/${path}`, `tangosociety.de Milongas ${day}`, ["tango"]),
  ),
];

export const BERLIN_RETIRED: readonly RetiredSource[] = [
  {
    url: "https://claerchensball.haus/programm/",
    reason:
      "a JS calendar (Pie Calendar) that wrote 0 on Berlin's first read 42184314532; replaced by its /tanz/ page",
  },
  {
    url: "https://www.lido-berlin.de/events",
    reason:
      "Lido's event archive (rows dated 2008 on the first read 42184314532); replaced by its front page",
  },
];
