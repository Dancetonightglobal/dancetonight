// Philadelphia's starting sources (D-300). US rule D-034: first-party pages with robots.txt, rate
// limits and facts-only storage; official APIs. Resident Advisor, Facebook and Instagram stay out.
// Sources are added as they are checked; the daily run also seeds venues and discovers their
// websites (D-120). Starts empty, as London did (D-201).

import { DICE_GENRES, diceSources } from "@/config/sources/dice";
import type { RetiredSource, SeedSource } from "@/config/sources/nyc";
import type { StyleKey } from "@/config/styles";

const DICE_BROWSE = "https://dice.fm/browse/philadelphia-60f5b88857fe332ef6268244/music";

/** DICE genre pages that add nights for Philadelphia (the other seven wrote nothing on two full reads, 10-29). */
const PHILADELPHIA_DICE_GENRES = new Set(["dj/house"]);

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

const squarespace = (url: string, label: string, styles: StyleKey[]): SeedSource => ({
  ...page(url, label, styles),
  kind: "squarespace",
  platform: "squarespace",
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

// A club or promoter whose Eventbrite nights are all dance nights: its titles need no dance word (the run of
// 2026-10-29 screened Noto's "Joyhauser" and La Discoteka's "Noches Bravas" as shows).
const eventbriteDanceOnly = (url: string, label: string, styles: StyleKey[]): SeedSource => ({
  ...eventbrite(url, label, styles),
  mixedCalendar: false,
});

export const PHILADELPHIA_SOURCES: readonly SeedSource[] = [
  // Salsa Vida, schema.org Events on the page (15 on 10/29, Brasil's and Cuba Libre in Old City); a night
  // outside the city (Essington) is left out by its point. robots.txt allows it (checked 2026-10-29).
  directory(
    "https://www.salsavida.com/guides/pennsylvania/philadelphia/",
    "Salsa Vida Philadelphia",
    ["salsa", "bachata"],
  ),
  // Thursday Contra (PATMAD), Mt Airy: its Meetup group's iCalendar export (4 dances 10/29 to 11/19, tested with our
  // bot; robots.txt does not disallow /events/ical/). The page is thursdaycontra.com, which lists the same dances.
  // The feed gives no LOCATION, so its dances went unplaced (run 40943365923). It lists the Thursday dances only, which
  // thursdaycontra.com places at the Irish Center; the series' Saturday specials at other halls are not in it.
  {
    ...page("https://thursdaycontra.com/", "Thursday Contra (PATMAD)", ["contra"]),
    kind: "feed_ics",
    feedUrl: "https://www.meetup.com/Mt-Airy-Contra-Dance/events/ical/",
    venueAddress: "6815 Emlen St, Philadelphia, PA 19119",
    venuePage: true,
  },
  // Park Avenue Contra, Swarthmore (near suburbs, D-511): 2nd and 4th Tuesdays 7:30-9:30pm and the Thursday afternoon
  // Gentle English dances, from the public Google Calendar that parkavenuecontra.org's own page loads (site.js
  // calendarId); every event has LOCATION 129 Park Ave, Swarthmore, PA 19081 (checked 2026-10-31).
  {
    ...page("https://parkavenuecontra.org/", "Park Avenue Contra (Google Calendar)", [
      "contra",
      "english_country",
    ]),
    kind: "feed_gcal",
    platform: "feed_gcal",
    feedUrl:
      "https://calendar.google.com/calendar/ical/park.ave.contra%40gmail.com/public/basic.ics",
    venueAddress: "129 Park Ave, Swarthmore, PA 19081",
    venuePage: true,
  },
  // Germantown Country Dancers, Merion Station (Lower Merion, near suburbs, D-511): its home page's "Regular Dances and
  // Events" table gives "Wednesdays Year round (occasional exceptions) ... 8:00 - 10:15 pm English Country Dancing" at
  // Merion Friends Meeting's Activities Building, plus an Upcoming Events list (balls, Saturday workshops, a Teen Barn
  // Dance at Summit Church, Mt Airy). robots.txt allows / with Crawl-delay 10 (checked 2026-10-31).
  {
    ...page("https://germantowncountrydancers.org/", "Germantown Country Dancers", [
      "english_country",
    ]),
    venueAddress: "615 Montgomery Ave, Merion Station, PA 19066",
    venuePage: true,
    weeklyGrid: true,
  },
  // Folk Dance Council of the Delaware Valley: weekly international folk dancing (Balkan, Israeli and other
  // folk dances). Its home page: "We currently dance every Tuesday evening at 7:30 - 9:30 pm at the Commodore John
  // Barry Arts and Cultural Center" (6815 Emlen St), "$5 and first-time visitors are free". robots.txt allows it
  // (crawl-delay 10, checked 2026-11-01). Found by the D-551 cultural report; coverage-83 OK (2026-11-01).
  {
    ...page("https://folkdancecouncil.org/", "Folk Dance Council of the Delaware Valley", [
      "balkan",
      "israeli",
    ]),
    venueAddress: "6815 Emlen St, Philadelphia, PA 19119",
    venuePage: true,
    fixedNights: [
      {
        title: "International Folk Dancing (Folk Dance Council)",
        line: "We currently dance every Tuesday evening at 7:30 - 9:30 pm at the Commodore John Barry Arts and Cultural Center",
        days: [2],
        start: "19:30",
        end: "21:30",
        styles: ["balkan", "israeli"],
        danceCited:
          "folkdancecouncil.org home page: 'The FDC sponsors weekly folk dancing in Philadelphia'; 'We currently dance every Tuesday evening at 7:30 - 9:30 pm' (2026-11-01, D-551)",
        replacesTitles: [
          "Folk Dance Council of the Delaware Valley",
          "Weekly Dancing",
          "Folk Dancing",
        ],
        venue: "Commodore John Barry Arts and Cultural Center",
      },
    ],
  },
  // Ecstatic Dance Philly, Northern Liberties (D-573, from ecstaticdance.org): its TicketSpice page lists its dated
  // Sunday dances ("Warm up at 11am and Dance at 12pm on Sunday mornings", Pig Iron Theatre, 1417 N 2nd St; dates
  // November 15th, December 6th, December 20th 2026 in the HTML, checked 2026-11-02). robots.txt allows /info.
  {
    ...page("https://phillyecstaticdance.ticketspice.com/info", "Ecstatic Dance Philly", [
      "ecstatic_dance",
    ]),
    venueAddress: "1417 N 2nd St, Philadelphia, PA 19122",
  },
  // Pivot Ballroom on the Main Line, Ardmore (near suburbs, D-511): its Events page lists dated monthly socials (Los
  // Besos Milonguita 1st Saturday, Divertida Milonga 3rd Saturday, Milonga Espiral 4th Saturday, West Coast Swing
  // Social 2nd Friday, Controla Latin Fridays 1st and 3rd Fridays, ballroom socials) beside a Halloween bash; Wix,
  // text in the HTML; robots.txt allows it (2026-10-31). Its footer's ZIP 19460 is wrong; Ardmore is 19003.
  {
    ...page("https://pivotballroom.com/events", "Pivot Ballroom (Ardmore)", [
      "milonga",
      "west_coast_swing",
      "social_ballroom",
      "salsa",
      "bachata",
    ]),
    venueAddress: "49 E Lancaster Ave, Ardmore, PA 19003",
    venuePage: true,
    onlyHere: true,
    mixedCalendar: true,
  },
  // Out x Out Philadelphia: LGBTQ events directory, schema.org Events on the page (10 on 10/29, Voyeur, Woody's,
  // Giddy Up line dancing among karaoke, piano bars and drag shows, hence the screen). robots.txt allows /events/.
  {
    ...directory("https://outxout.com/events/philadelphia-pa", "Out x Out Philadelphia", [
      "queer_party",
    ]),
    kind: "jsonld",
    mixedCalendar: true,
    // Punch Line Philly's drag comedy brunch (seated show, 10/31 run 41205630921); Woody's Monday Rosewood lounge, which
    // Woody's own source screens as no dance night (listed from here on 11-02, run 41325587854).
    notDanceNights: [
      "Big Wig Brunch",
      "Big Wig Brunch: Halloween",
      "Rosewood Monday",
      "Rosewood Mondays",
      "Monday Rosewood",
    ],
  },
  // Underground Arts, Callowhill: schema.org Events (62 on 10/29, mostly concerts, some dance parties). Some rows are
  // at Warehouse on Watts, so not onlyHere.
  {
    ...page("https://undergroundarts.org/events/", "Underground Arts", ["dj_night"]),
    kind: "jsonld",
    venueAddress: "1200 Callowhill Street, Philadelphia, PA 19107",
    venuePage: true,
    mixedCalendar: true,
  },
  // Our Philly: a city-wide events directory whose "dance" tag (26 rows 10/29 to 11/04) lists nights we miss
  // elsewhere: Brasil's Nightclub's four weekly nights (Zouk Tuesdays, Wepa Wednesdays, Finally Fridays, Salsational
  // Saturdays), the Dolphin, PBR line dancing, University City Swing, Rittenhop, Siempre Salsa. Its terms welcome
  // non-commercial scraping with credit (DanceTonight is non-commercial, the owner 10-29); robots.txt allows /tags/.
  {
    ...directory("https://www.ourphilly.org/tags/dance", "Our Philly (dance)", []),
    mixedCalendar: true,
    // Dance nights whose titles name no dance: the mixed screen dropped them 11 times on full read 41019704017
    // (2026-10-30). Brasil's Latin nights and University City Swing (a weekly swing social). West Philly Swingers
    // stays screened: its Penn Live Arts dates are a staged show (D-264).
    danceNights: [
      "Zouk Tuesdays",
      "¡Wepa! Wednesdays",
      "Finally Fridays",
      "Salsational Saturdays",
      "University City Swing",
    ],
    // Not dance nights (full read 41217433517): "Rent" is an unverified reader-reported recurring item with no
    // place; Arts of India Festival Community Day is a performance afternoon at Penn Live Arts.
    notDanceNights: ["Rent", "Arts of India Festival Community Day"],
  },
  // Kaiserman JCC (Wynnewood), found by discovery: The Events Calendar's REST API lists a weekly Israeli Dancing
  // session beside lectures, classes and a Friday family Shabbat (read 2026-11-12). Seeded to name the non-dance rows.
  {
    url: "https://www.phillyjcc.com/",
    kind: "wp_tribe",
    feedUrl: "https://www.phillyjcc.com/wp-json/tribe/events/v1/events",
    trustTier: "first_party",
    styles: ["israeli"],
    label: "Kaiserman JCC",
    mixedCalendar: true,
    notDanceNights: ["Family Shabbat", "Gems at the J *"],
  },
  // The Irish Center (Mount Airy), found by discovery: céilís and set dancing beside music and singing sessions.
  // Seeded 2026-11-12 to name the non-dance rows (coverage-148).
  {
    ...page("https://theirishcenter.org/irish-center-events-calendar/", "The Irish Center", [
      "ceilidh",
    ]),
    mixedCalendar: true,
    venuePage: true,
    venueAddress: "6815 Emlen St, Philadelphia, PA 19119",
    // Matching folds punctuation, so this also matches the page's curly-apostrophe "Singers’ Session".
    notDanceNights: ["Singers' Session"],
  },
  // Our Philly's venue pages for two clubs whose own sites we cannot read (brasilsnightclub.com answers 403; the
  // Dolphin's Squarespace list is empty): it pulls their nights from the venues' sites, dated (10/29: Brasil's 19
  // rows, Zouk Tuesdays, Wepa Wednesdays, Finally Fridays, Salsational Saturdays, plus a Monday comedy open mic; the
  // Dolphin 8 DJ nights to 11/21). The dance tag page did not yield them on run 40943365923.
  {
    ...directory(
      "https://www.ourphilly.org/venues/brasils-nightclub",
      "Brasil's Nightclub (Our Philly)",
      ["salsa", "bachata", "brazilian_zouk"],
    ),
    venueAddress: "112 Chestnut St, Philadelphia, PA 19106",
    venuePage: true,
    onlyHere: true,
    // A Monday comedy open mic shares the page: the mixed screen drops seated shows, and bandsForDancers keeps its
    // named Latin nights, which carry no dance word (D-341; coverage-47, 2026-10-29).
    mixedCalendar: true,
    bandsForDancers: true,
  },
  {
    ...directory(
      "https://www.ourphilly.org/venues/the-dolphin-tavern",
      "The Dolphin Tavern (Our Philly)",
      ["dj_night"],
    ),
    venueAddress: "1539 S Broad St, Philadelphia, PA 19147",
    venuePage: true,
    onlyHere: true,
  },
  // The 700, Northern Liberties: The Events Calendar's REST API (robots.txt allows /wp-json/; 5 upcoming on 10/29,
  // posted month by month): DJ dance parties upstairs beside karaoke, open mics and comedy, hence the screen.
  {
    url: "https://philly700.com/events/",
    kind: "wp_tribe",
    feedUrl: "https://philly700.com/wp-json/tribe/events/v1/events",
    trustTier: "first_party",
    styles: ["dj_night", "retro"],
    label: "The 700",
    venueAddress: "700 N 2nd St, Philadelphia, PA 19123",
    venuePage: true,
    onlyHere: true,
    mixedCalendar: true,
  },
  // Secondhand Ranch, Fishtown: Squarespace events list (18 upcoming 10/29): Honky Tonk Hustle, a weekly
  // Wednesday country line dancing night with instructors, beside country karaoke and DJ jukebox nights.
  {
    ...squarespace("https://www.secondhandranch.com/eventcalendar", "Secondhand Ranch", [
      "line_dance",
      "honky_tonk",
    ]),
    venueAddress: "1148 Frankford Ave, Philadelphia, PA 19125",
    venuePage: true,
    onlyHere: true,
    mixedCalendar: true,
  },
  // Groundfloor, Northern Liberties waterfront: Squarespace events list (4 upcoming 10/29: Gimme Gimme Disco, a Bad
  // Bunny party, a costume party, a vintage sale).
  {
    ...squarespace("https://www.groundfloor215.com/events", "Groundfloor", ["dj_night", "disco"]),
    venueAddress: "915 N Delaware Ave, Philadelphia, PA 19123",
    venuePage: true,
    onlyHere: true,
    mixedCalendar: true,
  },
  // Concourse Dance Bar, Center City: Squarespace events list (13 rows 10/02 to 11/14, DJ nights).
  {
    ...squarespace("https://www.concoursedancebar.com/events", "Concourse Dance Bar", ["dj_night"]),
    venueAddress: "1635 Market St, Philadelphia, PA 19103",
    venuePage: true,
    onlyHere: true,
  },
  // Silk City, Northern Liberties: its events list (23 rows 10/29 to 01/22, DJ nights tagged "dj" beside gigs,
  // burlesque and drag brunch), read by the extractor.
  {
    ...page("https://silkcityphilly.com/events/", "Silk City", ["dj_night"]),
    venueAddress: "435 Spring Garden St, Philadelphia, PA 19123",
    venuePage: true,
    onlyHere: true,
    mixedCalendar: true,
  },
  // Johnny Brenda's, Fishtown: events list (~60 rows, mostly gigs; dance parties such as a Depeche Mode night 11/06).
  {
    ...page("https://johnnybrendas.com/events/", "Johnny Brenda's", ["dj_night"]),
    venueAddress: "1201 Frankford Ave, Philadelphia, PA 19125",
    venuePage: true,
    onlyHere: true,
    mixedCalendar: true,
    // A Clueless film screening night (11/01 5:30pm, run 41205630921), not a dance party.
    notDanceNights: ["REEL CLUELESS – HALLOWEEN EDITION", "Reel Clueless"],
  },
  // Bob & Barbara's Lounge, South St: events page (a monthly last-Tuesday house dance party among drag shows and
  // organ-jazz bands). Address from its Eventbrite page (1509 South St).
  {
    ...page("https://www.bobandbarbaras.com/events", "Bob & Barbara's Lounge", ["house"]),
    venueAddress: "1509 South St, Philadelphia, PA 19146",
    venuePage: true,
    onlyHere: true,
    mixedCalendar: true,
    // A band's first-Tuesday gig, not a dance night (full read 41217433517).
    notDanceNights: ["Jason Jeffries and the tall trees"],
  },
  // Society Hill Dance Academy, East Passyunk: its events page (a monthly Latin night, 11/06, and theme parties; one
  // party is held at another hall, so not onlyHere).
  {
    ...page("https://societyhilldance.com/events.php", "Society Hill Dance Academy", [
      "salsa",
      "bachata",
      "social_ballroom",
    ]),
    venueAddress: "1919 E Passyunk Ave, Philadelphia, PA 19148",
    venuePage: true,
    mixedCalendar: true,
  },
  // 5Rhythms' class finder, read with its written permission (D-523); both classes led by Samantha Slade
  // (Teacher in Training), checked 2026-10-31. Center City Breathe, 1425 Federal St (Point Breeze): Wednesdays
  // 19:00-20:30, next class 2026-11-11, series to 2026-12-18.
  page(
    "https://www.5rhythms.com/classes/EmergingWavesCenterCityBreathe-299251",
    "Emerging Waves Center City Breathe 5Rhythms",
    ["five_rhythms"],
  ),
  // Summit Presbyterian Church, 6757 Greene St (Mount Airy): Saturdays 15:00-17:00, next class 2026-11-14,
  // series to 2026-12-12.
  page(
    "https://www.5rhythms.com/classes/EmergingWavesSummit-299256",
    "Emerging Waves Summit 5Rhythms",
    ["five_rhythms"],
  ),

  // Estilo Dance Studio: its weekly salsa, bachata and mambo classes (classes, not socials). Found by discovery;
  // seeded so the page is read every run. Two studios, so not onlyHere: classes marked "OLD CITY LOCATION!" are
  // inside Brasil's Nightclub (112 Chestnut St), the rest at 2036 Frankford Ave (contact page, 2026-10-31).
  page("https://estilodancestudio.com/group-lessons/", "Estilo Dance Studio", ["salsa", "bachata"]),
  // Kung Fu Necktie, Fishtown: its events list (~48 rows on 10/30, mostly gigs beside DJ dance nights, hence the
  // screen). Found by discovery; seeded so its rows get times: the list's dates come with no start, and each event
  // page's Event JSON-LD gives one ("2026-11-07T19:00:00-0500"). Address from its own page; robots.txt allows /event/.
  {
    ...page("https://kungfunecktie.com/events/", "Kung Fu Necktie", ["dj_night"]),
    venueAddress: "1248 N Front St, Philadelphia, PA 19122",
    venuePage: true,
    onlyHere: true,
    mixedCalendar: true,
    eventPageTimes: true,
  },
  // Jazz Attack (Philadelphia Swing and Jazz Dance Association): its monthly schedule post ("October 2026 at Jazz
  // Attack": Thursdays 10/01 to 10/29, social 9-11pm after an 8pm lesson). robots.txt Crawl-delay 10 (honoured by
  // the fetcher).
  {
    ...page("https://www.jazzattackswings.com/blog", "Jazz Attack", ["lindy_hop", "balboa"]),
    venueAddress: "1336 Spring Garden St, Philadelphia, PA 19123",
    venuePage: true,
    onlyHere: true,
  },
  // The Ave Live, Northern Liberties waterfront: a 21+ electronic club whose events list (16 rows 10/29 to 12/18 on
  // 10/29: house, techno, tech house, dubstep, bass) are all DJ nights, so not mixed. The list gives dates only; each
  // event page's MusicEvent JSON-LD gives the address (520 N Christopher Columbus Blvd 19123). robots.txt allows /events.
  {
    ...page("https://theavelive.com/events", "The Ave Live", ["house", "techno", "dj_night"]),
    venueAddress: "520 N Christopher Columbus Blvd, Philadelphia, PA 19123",
    venuePage: true,
    onlyHere: true,
    eventPageTimes: true,
  },
  // Philadelphia Argentine Tango School, Fishtown: its "Milongas & Practicas" page gives the standing schedule as
  // text (10/30): Palermo Fishtown Milonga Wednesdays 9pm-midnight, Bailongo practica 1st and 3rd Sundays 4-6pm,
  // Milonga Qilombo 4th Saturdays 9:30pm-2am, all at its studio. Read as recurring rules (D-005). robots.txt allows
  // all but AI crawlers (Content-Signal search=yes, ai-train=no). philadelphiadance.org's tango calendar, which also
  // lists this school, has answered 522 since 10/29.
  {
    ...page(
      "https://www.philadelphiatangoschool.com/milongas-practicas",
      "Philadelphia Argentine Tango School",
      ["tango"],
    ),
    venueAddress: "2030 Frankford Ave, Philadelphia, PA 19125",
    venuePage: true,
    onlyHere: true,
    // Its nights sit under weekday headings with no dates ("__Wednesdays__", "__4th Saturdays of the month:__"): run
    // 40982048267 wrote only the practica and rejected the Wednesday milonga as undated (D-402, #577).
    weeklyGrid: true,
  },
  // Warehouse on Watts (Wow Philly), North Philadelphia: schema.org Events on its calendar (24 on 10/29, to 12/13, in
  // Cambridge Hall and The Loft: DJ and dance parties such as Book of Bass, Legacy, Abduction among concerts, hence the
  // screen). Underground Arts also lists some of its nights. robots.txt allows /events.
  {
    ...page("https://www.wowphilly.com/events", "Warehouse on Watts", ["dj_night", "house"]),
    kind: "jsonld",
    venueAddress: "923 N Watts St, Philadelphia, PA 19123",
    venuePage: true,
    onlyHere: true,
    mixedCalendar: true,
  },
  // DJ dance bars whose own sites state a fixed weekly DJ schedule with no dates (D-303; the owner 2026-10-30: "A bars own
  // weekly can count"). Each is read as recurring rules from its own page; robots.txt allows each page (checked
  // 2026-10-30). Their dated nights elsewhere (Trestle and La Discoteka on Eventbrite, Voyeur on Out x Out) merge
  // into these by dedupe. `weeklyGrid` is a fallback for a read whose model gives no recurrence phrase; `danceNights`
  // keeps the bars' nights whose titles name no dance past the mixed screen (coverage-58, 2026-10-30).
  // The Trestle Inn, Callowhill: "Every Thursday to Saturday" all-vinyl DJ dance parties with go-go dancers (home page;
  // Saturday is Saturnia, Philly Mag's Best Dance Party 2026). Happy hour and private-party text share the page.
  {
    ...page("https://thetrestleinn.com/", "The Trestle Inn", ["dj_night", "disco", "retro"]),
    venueAddress: "339 N 11th St, Philadelphia, PA 19107",
    venuePage: true,
    onlyHere: true,
    mixedCalendar: true,
    danceNights: ["The Trestle Inn", "Trestle Inn", "Saturnia"],
    weeklyGrid: true,
    // Its cached read kept a stale summer line ("every Friday 10PM this summer") over "Every Thursday to
    // Saturday" (D-480).
    extractUncached: true,
    // Its home page still carries a summer-only line ("every Friday 10PM this summer"), read as a weekly
    // Friday into November (run 41205630921). The summer is over.
    notDanceNights: ["DNH - A Disco & House Summer Dance Party"],
    // Its page gives no time for the parties, only "Open Thursday-Saturday 5pm-2am": the dance parties start at 9pm, not
    // at the 5pm opening (coverage-80, D-527: the page says "dance parties featuring all vinyl DJs").
    houseHours: {
      start: "21:00",
      end: "02:00",
      days: [4, 5, 6],
      checked:
        "thetrestleinn.com home page: 'Join us Thursday, Friday and Saturday nights for dance parties featuring all vinyl DJs'; 'Open Thursday-Saturday 5pm-2am' (2026-10-31)",
    },
    // Its read titled the parties "Dance Parties with Go Go dancers" and was rejected as a title the page does not
    // write (run 41223672054): the page's own line lists them instead (fixed weekly night, D-524).
    fixedNights: [
      {
        title: "Trestle Inn Dance Party",
        line: "Join us Thursday, Friday and Saturday nights for dance parties featuring all vinyl DJs",
        days: [4, 5, 6],
        start: "21:00",
        end: "02:00",
        danceCited:
          "thetrestleinn.com home page: 'dance parties featuring all vinyl DJs' Thursday to Saturday (2026-10-31, D-527)",
        // The read's own title for the parties (run 41325587854), listed once under it instead of this one.
        replacesTitles: [
          "The Trestle Inn",
          "Trestle Inn",
          "Dance Parties with Go Go dancers",
          "dance parties featuring all vinyl DJs and Philly's only troupe of Go Go dancers, The Trestle Specials",
        ],
      },
    ],
  },
  // Pulse, Center City: "Dance Party DJ, Dance Music Every Friday and Saturday", 10:30pm-3am (home page). Every
  // night it lists is a DJ night, so not mixed.
  {
    ...page("https://www.pulsephilly.com/", "Pulse", ["dj_night"]),
    venueAddress: "1526 Sansom St, Philadelphia, PA 19102",
    venuePage: true,
    onlyHere: true,
    weeklyGrid: true,
  },
  // Voyeur, Gayborhood: DJ dance floor Thursdays from midnight, Fridays and Saturdays from 11pm (home page; its
  // "Sundays 1AM" is Saturday's night). Old specials (a 2024 talent competition) share the page, hence the screen.
  {
    ...page("https://www.voyeurnightclub.com/", "Voyeur", ["dj_night", "queer_party"]),
    venueAddress: "1221 St James St, Philadelphia, PA 19107",
    venuePage: true,
    onlyHere: true,
    mixedCalendar: true,
    danceNights: ["Voyeur", "Voyeur Nightclub", "Thursdays at Voyeur", "Weekends at Voyeur"],
    weeklyGrid: true,
  },
  // Woody's, Gayborhood (202 S 13th St): its own home page prints the weekly grid "JUST RNB THURSDAYS", "FRIDAYS: WKND
  // PART 1", "SATURDAY NIGHT: WKND PT. 2" with hours (Thursday-Sunday 7 PM-2 AM), beside Monday Night Football, the
  // Rosewood Monday lounge and Wednesday karaoke (screened). Its dance floors: Out x Out's event pages ("Saturday
  // Gayborhood dance night ... Main Dance Floor, The Suite and Glöbar"; Thursday dance music videos) and Time Out (2025,
  // "dancing until 2am" at weekends), D-529/D-530. Out x Out lists only today to Sunday, so next week's nights were
  // missing (D-524). robots.txt allows / (checked 2026-10-31).
  {
    ...page("https://www.woodysbar.com/", "Woody's", ["dj_night", "queer_party"]),
    venueAddress: "202 S 13th St, Philadelphia, PA 19107",
    venuePage: true,
    onlyHere: true,
    mixedCalendar: true,
    danceNights: [
      "Just RnB Thursdays",
      "Just RnB",
      "WKND Part 1",
      "WKND Pt. 1",
      "WKND Part 2",
      "WKND Pt. 2",
    ],
    notDanceNights: [
      "Woody's Monday Night Football",
      "Monday Night Football",
      "Rosewood Monday",
      "Rosewood Mondays",
      "Wednesday Karaoke",
    ],
    weeklyGrid: true,
    // Its read titled the nights "Thursdays Just R&B", "Fridays WKND Part 1" and "Saturday Night WKND Pt 2", titles the
    // page does not write, so all three were rejected (run 41325587854, 0 written): listed from the page's own menu
    // lines instead, at its stated hours "Thursday 7 PM–2 AM Friday 7 PM–2 AM Saturday 7 PM–2 AM" (fixed weekly
    // nights, D-524; checked 2026-11-01).
    fixedNights: [
      {
        title: "Just RnB Thursdays",
        line: "JUST RNB THURSDAYS",
        days: [4],
        start: "19:00",
        end: "02:00",
        styles: ["dj_night", "queer_party"],
        danceCited:
          "D-529/D-530: Out x Out's Woody's event pages (Thursday dance music videos; 'Main Dance Floor, The Suite and Glöbar') and Time Out 2025 ('dancing until 2am'); woodysbar.com menu 'JUST RNB THURSDAYS', hours 'Thursday 7 PM–2 AM' (2026-11-01)",
        replacesTitles: [
          "Thursdays Just R&B",
          "Just RnB Thursdays",
          "Just RnB",
          "Thursdays Just RnB",
        ],
      },
      {
        title: "WKND Part 1",
        line: "FRIDAYS: WKND PART 1",
        days: [5],
        start: "19:00",
        end: "02:00",
        styles: ["dj_night", "queer_party"],
        danceCited:
          "D-529/D-530: Out x Out's Woody's event pages ('Main Dance Floor, The Suite and Glöbar') and Time Out 2025 ('dancing until 2am' at weekends); woodysbar.com menu 'FRIDAYS: WKND PART 1', hours 'Friday 7 PM–2 AM' (2026-11-01)",
        replacesTitles: [
          "Fridays WKND Part 1",
          "WKND Part 1",
          "WKND Pt. 1",
          "Fridays: WKND Part 1",
        ],
      },
      {
        title: "WKND Pt. 2",
        line: "SATURDAY NIGHT: WKND PT. 2",
        days: [6],
        start: "19:00",
        end: "02:00",
        styles: ["dj_night", "queer_party"],
        danceCited:
          "D-529/D-530: Out x Out ('Saturday Gayborhood dance night ... Main Dance Floor, The Suite and Glöbar') and Time Out 2025 ('dancing until 2am' at weekends); woodysbar.com menu 'SATURDAY NIGHT: WKND PT. 2', hours 'Saturday 7 PM–2 AM' (2026-11-01)",
        replacesTitles: [
          "Saturday Night WKND Pt 2",
          "Saturday Night WKND Pt. 2",
          "WKND Part 2",
          "WKND Pt. 2",
          "Saturday Night: WKND Pt. 2",
        ],
      },
    ],
  },
  // Tavern on Camac, Gayborhood: its schedule page gives the upstairs Ascend Lounge "Tuesday - Thursday 9-2, DJ 9pm
  // -2 am" beside the downstairs piano bar's nightly pianists and Sunday showtunes (screened: no dance).
  {
    ...page("https://www.tavernoncamac.com/schedule", "Tavern on Camac (Ascend)", [
      "dj_night",
      "queer_party",
    ]),
    venueAddress: "243 S Camac St, Philadelphia, PA 19107",
    venuePage: true,
    onlyHere: true,
    mixedCalendar: true,
    danceNights: ["Ascend", "Ascend Lounge", "Ascend Lounge DJ"],
    weeklyGrid: true,
    // Its cached read found no dance night in the Ascend Lounge's "DJ 9pm -2 am" (D-480).
    extractUncached: true,
    // The Ascend line sits in the Wix page footer, which page cleaning drops, so the model never saw it (read
    // 41223672054 wrote 0): listed from the raw page's own line (fixed weekly night, D-524). the owner listed Ascend as an
    // exception to "no lounge nights" (D-531, 2026-10-31).
    fixedNights: [
      {
        title: "Ascend Lounge DJ",
        line: "Ascend Lounge: Tuesday - Thursday 9-2",
        days: [2, 3, 4],
        start: "21:00",
        end: "02:00",
        styles: ["dj_night", "queer_party"],
        danceCited:
          "D-531 (the owner, 2026-10-31): Ascend Lounge listed; its own schedule page 'DJ 9pm -2 am'; Visit Philly: the upstairs Ascend lounge's dancing (checked 2026-10-31)",
        replacesTitles: ["Ascend", "Ascend Lounge", "Ascend Lounge DJ"],
      },
    ],
  },
  // National Mechanics, Old City: its home page's weekly events list "Bachata Thursdays" and "La Diskoteka Fridays &
  // Saturdays" (La Discoteka's Eventbrite organiser has the dated ones) among karaoke, trivia and wine nights.
  {
    ...page("https://www.nationalmechanics.com/", "National Mechanics", ["bachata", "reggaeton"]),
    venueAddress: "22 S 3rd St, Philadelphia, PA 19106",
    venuePage: true,
    onlyHere: true,
    mixedCalendar: true,
    danceNights: ["La Diskoteka"],
    weeklyGrid: true,
  },
  // Saint Lazarus Bar, Northern Liberties: its own home page states 'Ladies First Monday! - Every Monday @ 9pm',
  // 'Tuesday Night Hangout! - Every Tuesday @ 9pm', 'The Wednesday Society! - Every Wednesday @ 9pm' and 'The Thursday
  // Turn-up! - Every Thursday Night @ 10pm', DJ nights on its dance floor. Two guides agree (D-510): ma.to (MVP
  // Mondays: Ladies First, women DJs and dancing; Tuesday Night Hangout, free DJ night) and Visit Philly (Monday
  // hip-hop, Tuesday dancing), checked 2026-10-30/31. robots.txt allows it.
  {
    ...page("https://saintlazarusbar.com/", "Saint Lazarus Bar", ["dj_night", "hip_hop_club"]),
    venueAddress: "102 W Girard Ave, Philadelphia, PA 19123",
    venuePage: true,
    onlyHere: true,
    mixedCalendar: true,
    danceNights: [
      "Ladies First Monday",
      "Ladies First Mondays",
      "MVP Mondays",
      "Tuesday Night Hangout",
      "Tuesday Night Hang Out",
      "The Wednesday Society",
      "The Thursday Turn-up",
    ],
    weeklyGrid: true,
  },
  // Dance and party organisers that sell their Philadelphia nights on Eventbrite, read by organiser
  // ID (D-015, D-131); found 2026-10-29 from Eventbrite's public organiser and search pages, each with upcoming
  // nights. Multi-city organisers' other cities are left out by their point.
  eventbrite(
    "https://www.eventbrite.com/o/franky-bradleys-19213387803",
    "Franky Bradley's (Eventbrite)",
    ["queer_party", "dj_night"],
  ),
  eventbriteDanceOnly(
    "https://www.eventbrite.com/o/noto-philly-16917375439",
    "NOTO Philly (Eventbrite)",
    ["dj_night"],
  ),
  eventbriteDanceOnly(
    "https://www.eventbrite.com/o/noto-events-69829155243",
    "NOTO Events (Eventbrite)",
    ["dj_night"],
  ),
  // NOTO's own events page (discovered, stored as a mixed calendar): every night it lists is a club night with a
  // DJ (PTO Thursdays, touring DJs), so not mixed; its games nights go by the title screen. robots.txt names only
  // a sitemap (checked 2026-10-30). Its Eventbrite nights merge into these by dedupe.
  {
    ...page("https://www.notophl.com/events", "NOTO Philadelphia", ["dj_night"]),
    venueAddress: "1209 Vine St, Philadelphia, PA 19107",
    venuePage: true,
    onlyHere: true,
    mixedCalendar: false,
  },
  eventbriteDanceOnly(
    "https://www.eventbrite.com/o/la-discoteka-120626298488",
    "La Discoteka (Eventbrite)",
    ["latin_club", "reggaeton"],
  ),
  eventbriteDanceOnly(
    "https://www.eventbrite.com/o/4nav4life-34493092233",
    "Reggae Bash World (Eventbrite)",
    ["dancehall"],
  ),
  eventbriteDanceOnly(
    "https://www.eventbrite.com/o/reggae-meets-soca-djsmoy-7627176099",
    "Reggae Meets Soca (Eventbrite)",
    ["dancehall"],
  ),
  eventbriteDanceOnly(
    "https://www.eventbrite.com/o/latin-vibes-group-30806397764",
    "Latin Vibes Group (Eventbrite)",
    ["reggaeton"],
  ),
  eventbriteDanceOnly(
    "https://www.eventbrite.com/o/dj-o-boyy-omg-entertainment-llc-34214997099",
    "Island Vybez, DJ O-Boyy (Eventbrite)",
    ["dancehall"],
  ),
  eventbriteDanceOnly(
    "https://www.eventbrite.com/o/dreamteament-53900670923",
    "Soundgasm, DreamTeamEnt (Eventbrite)",
    ["afrobeats_club"],
  ),
  eventbrite(
    "https://www.eventbrite.com/o/bob-barbaras-lounge-32476913085",
    "Bob & Barbara's Lounge (Eventbrite)",
    [],
  ),
  {
    ...eventbrite(
      "https://www.eventbrite.com/o/infusion-lounge-12259966201",
      "Infusion Lounge (Eventbrite)",
      ["dj_night"],
    ),
    // A drink special, not a dance night (11/05, run 41205630921).
    notDanceNights: ["Thirsty Thursdays @ Infusion Lounge - $4 Drink Night"],
  },
  eventbriteDanceOnly(
    "https://www.eventbrite.com/o/one-group-18061548979",
    "One Group (Eventbrite)",
    ["dj_night"],
  ),
  eventbriteDanceOnly(
    "https://www.eventbrite.com/o/temple-swag-friends-41087753973",
    "Temple Swag & Friends (Eventbrite)",
    ["dj_night"],
  ),
  eventbrite(
    "https://www.eventbrite.com/o/the-trestle-inn-1583205400",
    "The Trestle Inn (Eventbrite)",
    ["retro"],
  ),
  // Added 2026-10-29 from the recall lists (evals/recall/philadelphia/2026-11-*): theme dance nights at National
  // Mechanics, Khyber Pass, Broad Hall and The 700 (2000's Night 11/07, Beyonce Night, Goth NYE), with a video bingo
  // among them, hence the screen.
  eventbrite("https://www.eventbrite.com/o/riot-nerd-13231604389", "Riot Nerd (Eventbrite)", [
    "retro",
  ]),
  // Philly Salsa Bachata: Ultimate Thursdays at Lucky Strike, 1336 Chestnut St (bachata and salsa lessons, then a
  // social 8pm-2am; weekly listings July to October 2026, checked 2026-10-30). All its nights are socials.
  eventbriteDanceOnly(
    "https://www.eventbrite.com/o/philly-salsa-bachata-27750099393",
    "Philly Salsa Bachata (Eventbrite)",
    ["salsa", "bachata"],
  ),
  // Touring parties with one Philadelphia night each (checked 2026-10-29); other cities are left out by their point.
  // R&B Only Live, Franklin Music Hall 11/13.
  eventbriteDanceOnly(
    "https://www.eventbrite.com/o/colors-worldwide-11897925533",
    "R&B Only, COLORS Worldwide (Eventbrite)",
    ["dj_night"],
  ),
  // Secret Rivalry Rave, Roar 11/12.
  eventbriteDanceOnly(
    "https://www.eventbrite.com/o/harrison-121465416483",
    "Secret Rivalry Rave, Harrison (Eventbrite)",
    ["techno"],
  ),
  // Gimme Gimme Disco (Philadelphia night on its event page 2001611433680); the organiser also sells concerts.
  eventbrite(
    "https://www.eventbrite.com/o/concert-crave-31633224317",
    "Gimme Gimme Disco, Concert Crave (Eventbrite)",
    ["disco"],
  ),
  // DICE's Philadelphia browse pages, DJ and Party, and the genre pages Philadelphia has (D-139, D-148,
  // D-197; the dice adapter already runs in US metros). Checked 2026-10-29: these eight DJ genre pages
  // list nights; every Party genre page and the other DJ ones answer a 307 redirect to the gig list.
  ...diceSources(
    DICE_BROWSE,
    "Philadelphia",
    DICE_GENRES.filter(([path]) => PHILADELPHIA_DICE_GENRES.has(path)),
  ),
];

/** Starting addresses retired, each with the reason (D-047). */
export const PHILADELPHIA_RETIRED: readonly RetiredSource[] = [
  // Found by discovery on the first full Philadelphia read (run 40890367744, 2026-10-29).
  {
    url: "https://ulife.vpul.upenn.edu/calendar/",
    reason:
      "Penn's campus-wide calendar: its 'dance' rows on the first full read were an English department party with a band (4-6pm) and a swing troupe's stage show at Iron Gate Theater, plus a Dia de los Muertos talk; 5 of its 6 rows had no place (checked by coverage-39, 2026-10-29)",
  },
  // Empty on two full reads (40890367744, 40943365923, 2026-10-29): DICE's DJ page and its house page carry these nights.
  ...[
    "dj/tech-house",
    "dj/techno",
    "dj/hard_techno",
    "dj/hiphop",
    "dj/edm",
    "dj/melodic_house",
    "dj/dance",
  ].map((path) => ({
    url: `${DICE_BROWSE}/${path}`,
    reason:
      "DICE Philadelphia genre page: no nights beyond DICE's DJ page on two full reads (coverage-47, 2026-10-29)",
  })),
  {
    url: "https://www.riotnerdphilly.com/",
    reason:
      "Riot Nerd's Wix events list is drawn by JavaScript: 0 items on run 40943365923; its nights come from its Eventbrite organiser page",
  },
  // Found by discovery.
  {
    url: "https://www.roarphilly.com/",
    reason:
      "Roar's domain has no address (ENOTFOUND) on 3 reads in a row since 2026-10-30 (last 41217433517); its nights come from Eventbrite and RA",
  },
  // Discovered sources that never read once (404 on every read; cities sweep 2026-11-11, run 43012161836).
  {
    url: "https://mexicanculturalcenter.org/",
    reason: "the site answered 404 on 12 reads in a row since 2026-11-01; it never read once",
  },
  {
    url: "https://www.mediatheatre.org/",
    reason: "the site answered 404 on 10 reads in a row since 2026-11-02; it never read once",
  },
  {
    url: "https://www.wharton.upenn.edu/events/",
    reason:
      "a business school's events page: 404 on 12 reads in a row since 2026-11-01, never read once, and no dance nights",
  },
  // Found by discovery (2026-11-11): a church's music page.
  {
    url: "https://waynepres.org/music/",
    reason:
      'Wayne Presbyterian Church\'s music page: choir rehearsals and concerts ("Wayne Oratorio Society Weekly Rehearsal"), no dance nights (coverage 2026-11-11)',
  },
  // Found by discovery (2026-11-12): a bar's shows and a club's open house (coverage daily check 2026-11-13).
  {
    url: "https://velvetwhipphilly.com/",
    reason:
      'The Velvet Whip: shows and open mics ("CDH SIDE SHOW CLOWN DANGER", "Jam Session Open Mic"), no dance nights (coverage daily check 2026-11-13)',
  },
  {
    url: "https://polishhome.com/main/events/",
    reason:
      'Polish American Citizens Home events page: "PKM Open House", not a dance night (coverage daily check 2026-11-13)',
  },
];
