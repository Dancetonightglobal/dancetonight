// Los Angeles's starting sources (D-1160). US rules (D-034): official APIs and public pages, robots.txt honoured;
// Facebook and Instagram never; Resident Advisor through its GraphQL area only (D-505). Sources are added as
// they are checked; the daily run also seeds venues and discovers their websites (D-120).

import type { RetiredSource, SeedSource } from "@/config/sources/nyc";
import type { StyleKey } from "@/config/styles";
import { DICE_GENRES, diceSources } from "@/config/sources/dice";

/** DICE's Los Angeles browse pages (US, D-139; browse pages only, D-197); robots.txt allows all but /api/. */
const DICE_BROWSE = "https://dice.fm/browse/losangeles-5982e13c613de866017c3e3a/music";

/**
 * The LA genre pages that answered 307 to the city's gig list on 2026-11-07 (too few events): left out, the DJ and
 * Party pages carry their nights. The other 32 answered 200 with their own events (dj/house 23, party/salsa 1).
 */
const LA_DICE_REDIRECTS = new Set([
  "dj/italodisco",
  "dj/latin",
  "dj/latin_tropical",
  "dj/reggaeton",
  "dj/afro_caribbean",
  "dj/soca",
  "dj/jersey_club",
  "dj/dnb",
  "dj/lgbtq+",
  "party/amapiano",
  "party/baile_funk",
  "party/kpop",
  "party/roller_skating",
]);

/** A directory page: pointers, never the organiser's own word (D-061, D-072). */
const directory = (url: string, label: string, styles: StyleKey[]): SeedSource => ({
  url,
  kind: "html",
  trustTier: "directory",
  styles,
  label,
});

/** A venue's or organiser's own page: its own word (D-061). */
const page = (url: string, label: string, styles: StyleKey[]): SeedSource => ({
  url,
  kind: "html",
  trustTier: "first_party",
  styles,
  label,
});

export const LOS_ANGELES_SOURCES: readonly SeedSource[] = [
  ...diceSources(
    DICE_BROWSE,
    "Los Angeles",
    DICE_GENRES.filter(([path]) => !LA_DICE_REDIRECTS.has(path)),
  ),
  // Out x Out (written yes for every city, D-545, D-558): LGBTQ+ events by city, a mixed calendar (drag shows,
  // brunches and club nights), read through the page's JSON-LD like Miami's.
  {
    ...directory("https://outxout.com/events/los-angeles-ca", "Out x Out Los Angeles", [
      "queer_party",
    ]),
    kind: "jsonld",
    mixedCalendar: true,
  },
  // TangoMango (tangomango.org): the free community tango calendar, its Los Angeles county page (robots.txt allows
  // the listing pages, Crawl-delay 10 honoured; no terms page; 14 milongas listed 2026-11-07).
  {
    ...directory(
      "https://www.tangomango.org/index.php?show=Los%20Angeles,CA",
      "TangoMango Los Angeles",
      ["milonga"],
    ),
    kind: "platform_api",
    platform: "tangomango",
  },
  // 19hz.info's Los Angeles table (D-526, D-1161: no terms page, robots.txt 404; courtesy note sent): dated club
  // nights with each night's ticket page, read by the nineteenhz reader (#1234); rows in Orange County and San Diego
  // drop by their town; a night also read from RA or DICE merges on the shared ticket page (D-592).
  {
    ...directory("https://19hz.info/eventlisting_LosAngeles.php", "19hz Los Angeles", ["dj_night"]),
    kind: "platform_api",
    platform: "nineteenhz",
    mixedCalendar: true,
  },
  // Latin venues' own sites (leads from Salsa Vida's LA guide, read by hand once, D-758; each own page checked
  // 2026-11-07, robots.txt allows all). Weekly nights each site states itself (D-402 shapes, playbook Phase 5).
  // El Floridita, Hollywood: live salsa Fri, Sat and Mon nights, Sun afternoon (its events page).
  {
    ...page("https://elfloridita.com/events", "El Floridita", ["salsa"]),
    venueAddress: "1253 N Vine St, Los Angeles, CA 90038",
    venuePage: true,
    onlyHere: true,
  },
  // Stevens Steakhouse, Commerce: Sunday salsa lessons from 4:30pm and Sunday bachata night (its classes page;
  // robots.txt Crawl-delay 30, honoured by the per-domain spacing).
  {
    ...page("https://stevenssteakhouse.com/classes/", "Stevens Steakhouse", ["salsa", "bachata"]),
    venueAddress: "5332 Stevens Pl, Commerce, CA 90040",
    venuePage: true,
    onlyHere: true,
    mixedCalendar: true,
    // The page states the weekly bachata night as text with no dates, so the model lists none (17:27 read, 11-07).
    fixedNights: [
      {
        title: "Bachata Night (Bachata Dance Academy)",
        line: "Learn How To Dance Bachata In Los Angeles every week on Wednesdays and Sundays at Stevens Steakhouse",
        days: [0, 3],
        start: "22:00",
        end: "02:00",
        styles: ["bachata"],
        danceCited:
          "own site, https://stevenssteakhouse.com/classes/: 'There is open Bachata dancing after the lessons', '10:00pm-2:00am' (2026-11-07)",
      },
    ],
  },
  // The Mixx, Pasadena: "Salsa Mixx" Friday and Saturday nights on its home page's event list.
  {
    ...page("https://themixxclub.com/", "The Mixx", ["salsa", "bachata"]),
    venueAddress: "443 E Colorado Blvd, Pasadena, CA 91101",
    venuePage: true,
    onlyHere: true,
    mixedCalendar: true,
  },
  // Crown Pasadena (Crown City Dance), Pasadena: Monday salsa and bachata socials on its Wix event list.
  {
    ...page("https://www.crownpasadena.com/event-list", "Crown Pasadena", ["salsa", "bachata"]),
    kind: "wix",
    platform: "wix_events",
    venueAddress: "140 S Rosemead Blvd, Pasadena, CA 91107",
    venuePage: true,
    onlyHere: true,
    mixedCalendar: true,
  },
  // Cantina Ixtapa, Pasadena: Tuesday salsa and bachata night (lessons 8:30pm) in its home page's events section.
  {
    ...page("https://cantinaixtapa.com/", "Cantina Ixtapa", ["salsa", "bachata"]),
    venueAddress: "119 E Colorado Blvd, Pasadena, CA 91105",
    venuePage: true,
    onlyHere: true,
    mixedCalendar: true,
  },
  // Salseros LA, an organiser: its own home page states its weeklies at V Lounge (Tarzana, Tuesdays), Club Louie's
  // (Westlake Village, Wednesdays) and La Victoria Coco Bongo (Reseda, Sundays). Its The Events Calendar API listed
  // nothing on 2026-11-07, so the page is read. Discovery stored it as an iCalendar feed (the first read failed,
  // "not an iCalendar file"), so platform "probed" pins it back to the plain page.
  { ...page("https://salseros-la.com/", "Salseros LA", ["salsa", "bachata"]), platform: "probed" },
  // where-to-dance-salsa.com (the operator's written permission covers every city, D-323, D-383): schema.org
  // DanceEvent JSON-LD on each style's LA list page (19 salsa, 20 bachata rows on 2026-11-07, overlapping). Its
  // dates project weekly nights, so only a directory. Orange County rows fall outside the metro by their geo point.
  directory(
    "https://where-to-dance-salsa.com/salsa/los-angeles/",
    "where-to-dance-salsa Los Angeles salsa",
    ["salsa"],
  ),
  directory(
    "https://where-to-dance-salsa.com/bachata/los-angeles/",
    "where-to-dance-salsa Los Angeles bachata",
    ["bachata"],
  ),
  // Dancer University: Monday social at The Continental Club (DTLA) and Thursday social at 1212 Santa Monica,
  // plus dated socials.
  {
    ...page("https://danceruniversity.com/events/", "Dancer University", ["salsa", "bachata"]),
    mixedCalendar: true,
  },
  // Cowboy Palace Saloon, Chatsworth: live country music and dance lessons Wednesday to Sunday nights.
  {
    ...page("https://www.cowboypalace.com/", "Cowboy Palace Saloon", [
      "two_step",
      "line_dance",
      "country",
    ]),
    venueAddress: "21635 Devonshire St, Chatsworth, CA 91311",
    venuePage: true,
    onlyHere: true,
    bandsForDancers: true,
    // Weekly nights stated as text with no dates, so the model lists none (17:27 read, 2026-11-07).
    fixedNights: [
      {
        title: "Country dancing at Cowboy Palace Saloon",
        line: "The Cowboy Palace Saloon has live country music Wednesday through Sunday nights.",
        days: [0, 3, 4, 5, 6],
        start: null,
        danceCited:
          "own site, https://www.cowboypalace.com/: 'dance the night away to live country music', dance lessons (2026-11-07)",
      },
    ],
  },
  // 3 Vino's, Covina: Wednesday salsa night, Friday and Saturday dancing (robots.txt Crawl-delay 10, honoured by
  // the per-domain spacing).
  {
    ...page("https://3vinos.com/", "3 Vino's", ["salsa", "cumbia"]),
    venueAddress: "201 N Citrus Ave, Covina, CA 91723",
    venuePage: true,
    onlyHere: true,
    mixedCalendar: true,
    // Its Friday and Saturday "dancing" names no style, so only the Wednesday salsa night is listed (2026-11-07).
    fixedNights: [
      {
        title: "Salsa Night",
        line: "Join us Wednesday's for Salsa Night.",
        days: [3],
        start: null,
        styles: ["salsa"],
        danceCited:
          "own site, https://3vinos.com/: heading 'Entertainment - Dance', 'Friday & Saturdays for dancing!' (2026-11-07)",
      },
    ],
  },
  // PBDA (Pasadena Ballroom Dance Association): weekly Saturday Night Swing Out with live bands, plus dated
  // ballroom and West Coast Swing nights.
  {
    ...page("https://www.pbda.dance/dances", "PBDA (Pasadena Ballroom Dance Association)", [
      "lindy_hop",
      "east_coast_swing",
      "west_coast_swing",
      "social_ballroom",
    ]),
    venueAddress: "73 N Hill Ave, Pasadena, CA 91106",
    venuePage: true,
    onlyHere: true,
    mixedCalendar: true,
  },
  // Stud Country LA, a queer country dance party: its own page states weekly Thursday socials at The Paramount
  // (Boyle Heights) and 1st and 3rd Monday socials at Los Globos (Silver Lake), 8pm to midnight, line dance lessons
  // 8:30pm and 10pm. Two venues, so no venue address. robots.txt allows / (Crawl-delay 2), checked 2026-11-07.
  {
    ...page("https://studcountry.us/LA", "Stud Country LA", [
      "two_step",
      "line_dance",
      "queer_party",
    ]),
    mixedCalendar: true,
  },
  // LindyGroove, Pasadena: every Thursday 9pm to midnight at the Pasadena Masonic Temple, classes before (its own
  // home page, a Wix site, moved from lindygroove.com/events to lindygroove.la on 2026-11-10; robots.txt allows /, checked 2026-11-10).
  {
    ...page("https://www.lindygroove.la/", "LindyGroove", ["lindy_hop", "east_coast_swing"]),
    // Probing found its ticket pages, which carry no dates (0 rows on 2026-11-07): the plain page is read.
    platform: "probed",
    venueAddress: "200 S Euclid Ave, Pasadena, CA 91101",
    venuePage: true,
    onlyHere: true,
    fixedNights: [
      {
        title: "LindyGroove",
        line: "Join us every Thursday at the Pasadena Masonic Temple",
        days: [4],
        start: "21:00",
        end: "00:00",
        danceCited:
          "own site, https://www.lindygroove.la/: 'dance hall for lindy hoppers and swing dancers', two DJs '09:00pm - Midnight' (2026-11-10)",
      },
    ],
  },
  // Ecstatic Dance LA: its tickets page lists each dated dance (Sundays at Venice Beach, some Fridays at Primal
  // Moves Venice). robots.txt allows the page (Squarespace defaults), checked 2026-11-07.
  {
    ...page("https://www.ecstaticdancela.com/tickets", "Ecstatic Dance LA", ["ecstatic_dance"]),
    mixedCalendar: true,
  },
  // Boardner's, Hollywood: its home page's "CLUB EVENTS" list states its weekly nights (Monday Blue Mondays, '80s
  // and goth; Wednesday Wenzday's Party; Thursday Blue Mondays on Thursdays; Friday Club Decades) among live bands
  // and happy hours. robots.txt has no rules (checked 2026-11-07).
  {
    ...page("https://www.boardners.com/", "Boardner's", ["retro", "dj_night"]),
    venueAddress: "1652 N Cherokee Ave, Los Angeles, CA 90028",
    venuePage: true,
    onlyHere: true,
    mixedCalendar: true,
  },
  // Music venues whose own calendars mix dance parties with concerts (cities-13 flag, 2026-11-13): seeded as
  // mixed calendars so the no-dance screen drops the concerts (D-1168).
  // The Regent, Downtown: DJ nights and dance parties among live shows.
  {
    ...page("https://regentdtla.com/events/", "The Regent", ["dj_night"]),
    venueAddress: "448 S Main St, Los Angeles, CA 90013",
    venuePage: true,
    onlyHere: true,
    mixedCalendar: true,
  },
  // Teragram Ballroom, Westlake: rave and dance-party nights (Broadway Rave, Kawaii Rave) among concerts.
  {
    ...page("https://teragramballroom.com/calendar/", "Teragram Ballroom", ["dj_night"]),
    venueAddress: "1234 W 7th St, Los Angeles, CA 90017",
    venuePage: true,
    onlyHere: true,
    mixedCalendar: true,
  },
  // The Bellwether, Westlake: 80s/90s dance parties and DJ tours among concerts.
  {
    ...page("https://thebellwetherla.com/calendar/", "The Bellwether", ["dj_night"]),
    venueAddress: "333 S Boylston St, Los Angeles, CA 90017",
    venuePage: true,
    onlyHere: true,
    mixedCalendar: true,
  },
  // The Venice West, Venice: Thursday line dancing and a salsa brunch among concerts and comedy (coverage-152,
  // 2026-11-13; D-1169).
  {
    ...page("https://thevenicewest.com/", "The Venice West", ["line_dance", "salsa"]),
    venueAddress: "1717 Lincoln Blvd, Venice, CA 90291",
    venuePage: true,
    onlyHere: true,
    mixedCalendar: true,
  },
  // 1720, Wholesale District: rave nights among metal and rock concerts (coverage-152, 2026-11-13; D-1169).
  {
    ...page("https://1720.la/events/", "1720", ["dj_night"]),
    venueAddress: "1720 E 16th St, Los Angeles, CA 90021",
    venuePage: true,
    onlyHere: true,
    mixedCalendar: true,
  },
];

/** Starting addresses retired, each with the reason (D-047). */
export const LOS_ANGELES_RETIRED: readonly RetiredSource[] = [
  {
    url: "https://www.swingdance.la/events/",
    reason:
      "answers 403 to the reader (first scheduled read, 2026-11-07); its swing weeklies come from LindyGroove, PBDA and Crown City Dance's own pages",
  },
  {
    url: "https://pvplc.org/mec_calendars/full-calendar/",
    reason:
      "Palos Verdes Peninsula Land Conservancy: nature walks, plant sales and volunteer days, no dance; discovered as a venue website, rows landed at 1am/2am (daily check 2026-11-10)",
  },
  // Discovered as venue websites on the 11-10 read (run 42865224828); both feeds passed with no dance gate.
  {
    url: "https://calendar.usc.edu/?utm_campaign=Brand&utm_medium=website&utm_source=USC%20Homepage",
    reason:
      'USC\'s whole university calendar (iCal): talks, exhibitions, recitals and CE courses; 16 rows written, none a dance night, kept because descriptions credit the School of Dance (the owner, 2026-11-10: "Sun to Shade" panel at Gensler)',
  },
  {
    url: "https://trojanevents.usc.edu/",
    reason: "USC's student events site: 404 from its first run (2026-11-10)",
  },
  {
    url: "https://threeclubs.com/",
    reason:
      'a Hollywood comedy and theater club: its iCal lists shows, sing-alongs and concerts, no dance nights; the Buffy musical-episode sing-along passed because its blurb says she "sings, dances" (the owner, 2026-11-10)',
  },
  {
    url: "https://www.sweetwaterweho.com/watch",
    reason:
      "a West Hollywood sapphic bar: its weeklies are a board-game mixer, a drag show, karaoke and Pass the Aux, no dance wording (checked 2026-11-10)",
  },
  {
    url: "https://18thstreet.org/",
    reason:
      "18th Street Arts Center, Santa Monica: artist talks, exhibitions and openings, no dance or DJ wording (checked 2026-11-11)",
  },
  {
    url: "https://thekiaforum.com/",
    reason:
      "Kia Forum, Inglewood: arena concerts (Slayer, Smashing Pumpkins, Teddy Swims), no dance nights (checked 2026-11-12)",
  },
  {
    url: "https://www.eastwestplayers.org/",
    reason:
      "East West Players: theatre productions and library readings, no dance (checked 2026-11-12)",
  },
  {
    url: "https://pasadenasymphony-pops.org/",
    reason:
      "Pasadena Symphony and POPS: orchestral concerts (Beethoven 7), no dance (checked 2026-11-12)",
  },
  {
    url: "https://www.backyardpartyla.com/shows",
    reason: "Backyard Party LA: ska and punk shows, no dance nights (checked 2026-11-12)",
  },
  {
    url: "https://www.chevychasecc.com/calendar",
    reason:
      "Chevy Chase Country Club, Glendale: members' club calendar, no public dance nights (checked 2026-11-12)",
  },
  {
    url: "https://www.harvelles.com/",
    reason:
      "Harvelle's Santa Monica: burlesque and music shows to watch, no social dance nights (checked 2026-11-12)",
  },
  {
    url: "https://longbeach.harvelles.com/events",
    reason:
      "Harvelle's Long Beach: burlesque and music shows to watch, no social dance nights (checked 2026-11-12)",
  },
  {
    url: "https://www.skiptownplayhouse.com/calendar",
    reason:
      "Skiptown Playhouse, Elysian Valley: immersive theatre (Poe-Etique), no dance nights (checked 2026-11-12)",
  },
  {
    url: "https://www.ranchovistagolfclub.com/weddings/",
    reason:
      "Rancho Vista Golf Club, Palmdale: weddings page and a Taco Tuesday food night, no dance (checked 2026-11-12)",
  },
  {
    url: "https://www.dav.org/",
    reason:
      "Disabled American Veterans national calendar: information seminars and job fairs in other states pinned to a Woodland Hills hall, no dance (checked 2026-11-13)",
  },
  {
    url: "https://cal.lmu.edu/",
    reason:
      "Loyola Marymount University calendar: academic deadlines and campus talks, no dance nights (checked 2026-11-13)",
  },
  {
    url: "https://www.azusatheater.com/upcoming-programs.html",
    reason:
      "Azusa Renaissance Theater programs: a children's afterschool program and theatre classes, no dance nights (checked 2026-11-13)",
  },
  {
    url: "https://grammymuseum.org/programs/",
    reason: "GRAMMY Museum programs: talks and screenings, no dance nights (checked 2026-11-13)",
  },
  {
    url: "https://vipnightlife.com/events/",
    reason:
      "VIP Nightlife events page: mixes Las Vegas club days with LA nights and gives no venue for them; the LA nights come from the venues' own pages (checked 2026-11-13)",
  },
  // Found by discovery: a jazz supper club's concert calendar (cities sweep 2026-11-14).
  {
    url: "https://www.vibratogrilljazz.com",
    reason:
      'Vibrato Grill Jazz: a supper club\'s concerts ("Adam Hawley Christmas", "Tim Hockenberry & The 559 Band"), not dance nights (cities sweep 2026-11-14)',
  },
  {
    url: "https://www.oxy.edu/events",
    reason:
      "Occidental College's campus events calendar: colloquia and concerts, no social dance nights (2026-11-16 daily report; cities sweep 2026-11-17)",
  },
];
