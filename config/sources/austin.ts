// Austin's starting sources (D-1180). US rules (D-034): official APIs and public pages, robots.txt honoured;
// Facebook and Instagram never; Resident Advisor only through its GraphQL endpoint (D-505, area 321). Sources are
// added in later PRs; the daily run also seeds venues and discovers their websites (D-120).

import type { RetiredSource, SeedSource } from "@/config/sources/nyc";
import type { StyleKey } from "@/config/styles";

/** Where dancing at Donn's Depot is stated (hand check, D-798). */
const DONNS_DANCE_CITED =
  "own site, https://donnsdepot.com/: 'LIVE MUSIC / COCKTAILS / DANCING' and a band each night Mon-Sat on its event schedule (hand-checked in the owner's browser 2026-11-08, re-read 2026-11-23, D-798)";

/** A directory page: pointers, never the organiser's own word (D-061, D-072). */
const directory = (url: string, label: string, styles: StyleKey[]): SeedSource => ({
  url,
  kind: "html",
  trustTier: "directory",
  styles,
  label,
});

/** A Meetup group's own iCalendar feed (D-035 Q6: no Pro). robots.txt allows /events/ical/ (2026-11-07). */
const meetup = (group: string, label: string, styles: StyleKey[]): SeedSource => ({
  url: `https://www.meetup.com/${group}/events/`,
  kind: "feed_ics",
  feedUrl: `https://www.meetup.com/${group}/events/ical/`,
  trustTier: "first_party",
  styles,
  label,
  mixedCalendar: true,
});

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

export const AUSTIN_SOURCES: readonly SeedSource[] = [
  // Salsa Vida's Austin guide: schema.org Events on the page (11 on 11/07: Fuego Friday, Sensual Tuesday, Flow and
  // Feel Thursday); robots.txt allows all. Read as Raleigh's and Miami's are (D-321).
  directory("https://www.salsavida.com/guides/texas/austin/", "Salsa Vida Austin", [
    "salsa",
    "bachata",
  ]),
  // TangoMango's Travis County page (the shared tangomango reader, Miami #675); robots Crawl-delay 10 honoured.
  {
    ...directory(
      "https://www.tangomango.org/index.php?show=Travis,TX",
      "TangoMango Travis County",
      ["milonga"],
    ),
    kind: "platform_api",
    platform: "tangomango",
  },
  // Austin Tango Society (austintango.org, robots allows all): two public Google Calendars embedded on its home
  // page, milongas and practicas, and classes, festivals and workshops; read through the Calendar API (D-130).
  {
    url: "https://austintango.org/",
    kind: "feed_gcal",
    platform: "feed_gcal",
    feedUrl:
      "https://calendar.google.com/calendar/ical/aiusn8ua5aq0fn2hqavnlabvpg%40group.calendar.google.com/public/basic.ics",
    trustTier: "directory",
    styles: ["milonga"],
    label: "Austin Tango Society: milongas and practicas (Google Calendar)",
  },
  {
    url: "https://austintango.org/#classes",
    kind: "feed_gcal",
    platform: "feed_gcal",
    feedUrl:
      "https://calendar.google.com/calendar/ical/jn6j9aghkkulchvnivkpck2r5g%40group.calendar.google.com/public/basic.ics",
    trustTier: "directory",
    styles: ["tango"],
    label: "Austin Tango Society: classes and workshops (Google Calendar)",
  },
  // Austin Swing Syndicate: its weekly Thursday social (doors 7pm, social 9pm-midnight) at The Mansion / the Texas
  // Federation of Women's Clubs, 2312 San Gabriel St; its own site has no dated calendar (an unconfigured widget),
  // its Meetup group has the dated nights (10 on 11/07).
  {
    ...meetup("swing-dancing-atx", "Austin Swing Syndicate (Meetup)", [
      "lindy_hop",
      "east_coast_swing",
    ]),
    venueAddress: "2312 San Gabriel St, Austin, TX 78705",
    onlyHere: true,
  },
  // Esquina Tango, 209 Pedernales St (East Austin): its own WordPress events page lists dated milongas, practicas
  // and classes, some at other halls (Cabana Club, 5012 E 7th St), so no onlyHere; robots.txt allows all (11/07).
  {
    url: "https://www.esquinatango.org/events/",
    kind: "html",
    trustTier: "first_party",
    styles: ["tango", "milonga"],
    label: "Esquina Tango",
  },
  // Kingdom, 505 E 7th St: nightclub whose home page lists its dated DJ nights (14 dates on 11/07, "Chromeo DJ set",
  // "Amtrac"); tickets on Etix; robots.txt disallows only /wp-admin/ (11/07). Found by the Chrome audit (gay.do512).
  {
    url: "https://kingdomnightclub.com/",
    kind: "html",
    trustTier: "first_party",
    styles: ["dj_night"],
    label: "Kingdom",
    venueAddress: "505 E 7th St, Austin, TX 78701",
    venuePage: true,
    onlyHere: true,
  },
  // Oilcan Harry's, 211 W 4th St: queer dance club; its calendar page links its Eventbrite organiser (D-131).
  {
    ...eventbrite(
      "https://www.eventbrite.com/o/oilcan-harrys-33046707923",
      "Oilcan Harry's (Eventbrite)",
      ["dj_night"],
    ),
    venueAddress: "211 W 4th St, Austin, TX 78701",
  },
  // Posh's recent-events sitemap, kept inside the Austin outline (D-152); Highland Lounge sells there.
  {
    ...directory("https://posh.vip/sitemap-events-recent.xml", "Posh", []),
    kind: "platform_api",
    platform: "posh",
  },
  // Go Dance Studio - North Austin, 2525 W Anderson Ln (Northcross Mall Plaza): its Squarespace calendar (19 upcoming
  // on 11/07): "Go West: Weekly West Coast Swing Dance" Tuesdays 8:30pm, Variety Social Dance Sundays 5:30pm,
  // Salsa & Bachata Social, Austin Ballroom Dancers' Social, SeBASH-JAM WCS. Read as its page shows it, never the
  // ?format=json view robots.txt disallows. Its "Contra Dance" is TAADA's 3rd Saturday dance, read from TAADA's
  // own page below; class-term sign-ups and the showcase are not nights.
  {
    url: "https://godancestudio.squarespace.com/calendar",
    kind: "squarespace",
    platform: "squarespace",
    trustTier: "first_party",
    styles: ["west_coast_swing", "ballroom", "salsa", "bachata"],
    label: "Go Dance Studio",
    venueAddress: "2525 W Anderson Ln, Austin, TX 78757",
    venuePage: true,
    onlyHere: true,
    mixedCalendar: true,
    notDanceNights: ["Contra Dance", "New Group Class Session!", "Winter Showcase"],
  },
  // TAADA (Traditional Austin Area Dance Association; taada.org is now a parked domain, its site is taada.us): its
  // Austin-area events page states the weekly English country dance (Mondays 7:15-9:30pm) and the Austin Barn
  // Dancers' free weekly contra (Wednesdays 7:30-9:45pm), both at Hancock Recreation Center, 811 E 41st St, and the
  // 3rd Saturday contra at Go Dance Studio, above a dated month grid (Simple Calendar, 11/07: "English Country Dance
  // @ Hancock", "Austin Barn Dancers @ Hancock", "NO CONTRA Hancock closed for Veterans Day", Fire Ant Frolic). Its
  // San Marcos dance is outside the metro and is left out by place. No JSON-LD, so the model reads the page.
  // No robots.txt (taada.us answers 404, 11/07).
  {
    url: "https://taada.us/wp/events/",
    kind: "html",
    trustTier: "first_party",
    styles: ["contra", "english_country"],
    label: "TAADA (contra and English country dance)",
  },
  // createaustin.org's events calendar (The Events Calendar iCal, 30 events on 11/07): arts listings with dance
  // socials among them (SoCo Partner Dance Practica, Casa Azul Community Social Dance Practica, Zouk & Lambada in
  // the Park). A mixed calendar. Fuego Friday's entry is stamped America/New_York (an hour off) and Salsa Vida
  // already lists it, so it is left out here. robots.txt asks Crawl-delay 10: one feed a run (11/07).
  {
    url: "https://createaustin.org/events/",
    kind: "feed_ics",
    feedUrl: "https://createaustin.org/events/?ical=1",
    trustTier: "directory",
    styles: [],
    label: "Create Austin events",
    mixedCalendar: true,
    notDanceNights: ["Fuego Friday – Weekly Afro-Latin Social Dance Series"],
  },
  // Highland Lounge, 404 Colorado St: Austin's largest gay club. Its own home page: "3 STORIES. 6 BARS. DRAG SHOWS.
  // GOGO BOYS. ... DANCING." and "dance the night away", with its hours "Fri 9:30PM-3:30AM", "Sat 9:30PM-3:30AM"
  // (Mon-Thu closed; Sunday 4pm is a drag and bar afternoon, left out). Its dated cards are 2025's; tickets sell
  // on Posh (read above). A club's own stated nights (D-1082, Nashville's Night We Met). Squarespace robots.txt
  // allows this page (11/07).
  {
    url: "https://www.highlandlounge.com/",
    kind: "html",
    trustTier: "first_party",
    styles: ["queer_party", "dj_night"],
    label: "Highland Lounge",
    venueAddress: "404 Colorado St, Austin, TX 78701",
    venuePage: true,
    onlyHere: true,
    mixedCalendar: true,
    fixedNights: [
      {
        title: "Highland Lounge Friday",
        line: "Fri 9:30PM-3:30AM",
        days: [5],
        start: "21:30",
        end: "03:30",
        danceCited:
          "own site, https://www.highlandlounge.com/: 'DANCING.', 'who want to dance the night away' (2026-11-07)",
      },
      {
        title: "Highland Lounge Saturday",
        line: "Sat 9:30PM-3:30AM",
        days: [6],
        start: "21:30",
        end: "03:30",
        danceCited:
          "own site, https://www.highlandlounge.com/: 'DANCING.', 'who want to dance the night away' (2026-11-07)",
      },
    ],
  },
  // 19hz.info's Texas listing (the nineteenhz reader, #1234, D-526: no terms page, robots.txt absent (404),
  // read once a day with the honest user agent): dated electronic club nights across Texas, 5 naming Austin on
  // 11/07; rows naming another town ("Dallas, TX") are left out by place.
  {
    url: "https://19hz.info/eventlisting_Texas.php",
    kind: "platform_api",
    platform: "nineteenhz",
    trustTier: "directory",
    styles: ["dj_night"],
    label: "19hz Texas",
    mixedCalendar: true,
  },
  // Sam's Town Point, 2115 Allred Dr (South Austin honky tonk since 1981): its own site, "a laid-back live music bar
  // with a dance floor"; its /events page lists dated band nights every evening (11/07: "Bob Wills Night with the
  // Super Swing Revue" Tue 7:30pm, "Steel Monday with Jim Loessberg"), so evening bands are live music with dancing
  // (D-341). Daytime and coffee-day items are screened as a mixed calendar. robots.txt allows all (11/07).
  {
    url: "https://samstownpoint.com/events",
    kind: "html",
    trustTier: "first_party",
    styles: ["two_step", "country"],
    label: "Sam's Town Point",
    venueAddress: "2115 Allred Dr, Austin, TX 78748",
    venuePage: true,
    onlyHere: true,
    mixedCalendar: true,
    bandsForDancers: true,
    bandsForDancersFrom: "19:00",
  },
  // Broken Spoke, 3201 S Lamar Blvd (dance hall since 1964): its own home page states "Two-Step/Swing Lessons
  // Wednesday - Saturday 8p-9pm" and "Dance Lessons 8pm-9pm Wednesday - Saturday" with the dancehall open to 12am
  // Wed/Thu and 1:30am Fri/Sat (11/07). Its band calendar is an Inffuse widget we cannot read, so the stated weekly
  // lessons-and-dancing nights are listed (D-1082). Wix robots.txt allows all but ?lightbox= (11/07).
  {
    url: "https://www.brokenspokeaustintx.net/",
    kind: "html",
    trustTier: "first_party",
    styles: ["two_step", "country"],
    label: "Broken Spoke",
    venueAddress: "3201 S Lamar Blvd, Austin, TX 78704",
    venuePage: true,
    onlyHere: true,
    mixedCalendar: true,
    fixedNights: [
      {
        title: "Two-Step Lessons and Dancing at the Broken Spoke",
        line: "Dance Lessons 8pm-9pm Wednesday - Saturday",
        days: [3, 4],
        start: "20:00",
        end: "00:00",
        danceCited:
          "own site, https://www.brokenspokeaustintx.net/: 'Two-Step/Swing Lessons Wednesday - Saturday 8p-9pm', 'Last of the True Texas Dancehalls' (2026-11-07)",
      },
      {
        title: "Two-Step Lessons and Dancing at the Broken Spoke (Fri/Sat)",
        line: "Dance Lessons 8pm-9pm Wednesday - Saturday",
        days: [5, 6],
        start: "20:00",
        end: "01:30",
        danceCited:
          "own site, https://www.brokenspokeaustintx.net/: 'Two-Step/Swing Lessons Wednesday - Saturday 8p-9pm', 'Last of the True Texas Dancehalls' (2026-11-07)",
      },
    ],
  },
  // The White Horse, 500 Comal St (East Austin honky tonk): its own "Dancin' at WH" page states donation-based Texas
  // Two-Step lessons "on Thursdays, Fridays, Saturdays AND SUNDAYS at 7:00 PM", then live music (open to 2am). Its
  // band calendar is an Inffuse widget we cannot read (11/07). Wix robots.txt allows all but ?lightbox= (11/07).
  {
    url: "https://www.thewhitehorseaustin.com/events",
    kind: "html",
    trustTier: "first_party",
    styles: ["two_step", "country"],
    label: "The White Horse",
    venueAddress: "500 Comal St, Austin, TX 78702",
    venuePage: true,
    onlyHere: true,
    mixedCalendar: true,
    fixedNights: [
      {
        title: "Texas Two-Step Lesson and Dancing at The White Horse",
        line: "Texas Two-Step lessons on Thursdays, Fridays, Saturdays AND SUNDAYS at 7:00 PM",
        replacesTitles: ["Texas Two-Step lessons"],
        days: [4, 5, 6, 0],
        start: "19:00",
        end: "02:00",
        danceCited:
          "own site, https://www.thewhitehorseaustin.com/events: 'Cut a rug at The White Horse', 'Texas Two-Step lessons on Thursdays, Fridays, Saturdays AND SUNDAYS at 7:00 PM' (2026-11-07)",
      },
    ],
  },
  // Austin International Folk Dancers (aifd.cc): its own home page states "We meet almost every Friday, 7-9:45 pm,
  // at the beautiful Hancock Recreation Center (811 E. 41st St)" (11/07). robots.txt absent.
  {
    url: "https://aifd.cc/",
    kind: "html",
    trustTier: "first_party",
    styles: ["folk", "balkan"],
    label: "Austin International Folk Dancers",
    venueAddress: "811 E 41st St, Austin, TX 78751",
    venuePage: false,
    onlyHere: true,
    mixedCalendar: true,
    fixedNights: [
      {
        title: "Austin International Folk Dancers Friday Dance",
        line: "We meet almost every Friday, 7-9:45 pm",
        days: [5],
        start: "19:00",
        end: "21:45",
        danceCited:
          "own site, https://aifd.cc/: 'AIFD is Austin's home for recreational international folk dancing. We meet almost every Friday, 7-9:45 pm' (2026-11-07)",
      },
    ],
  },
  // Clive Bar, 609 Davis St (Rainey Street): its own site, "live country music ... Enjoy our spacious dance floor"
  // and "DANCE WITH US"; its /live-music page states a fixed daily band schedule (11/07). Wix robots.txt allows all
  // but ?lightbox= (11/07).
  {
    url: "https://www.clivebaratx.com/live-music",
    kind: "html",
    trustTier: "first_party",
    styles: ["two_step", "country"],
    label: "Clive Bar",
    venueAddress: "609 Davis St, Austin, TX 78701",
    venuePage: true,
    onlyHere: true,
    mixedCalendar: true,
    fixedNights: [
      {
        title: "Live Country Bands at Clive Bar (Mon/Tue)",
        line: "MONDAY House Band, 6-8pm Acoustic, 7-10pm TUESDAY House Band, 6-8pm Acoustic, 7-10pm",
        days: [1, 2],
        start: "18:00",
        end: "22:00",
        danceCited:
          "own site, https://www.clivebaratx.com/: 'live country music', 'Enjoy our spacious dance floor'; https://www.clivebaratx.com/live-music: 'DANCE WITH US' (2026-11-07)",
      },
      {
        title: "Live Country Bands at Clive Bar (Wed)",
        line: "WEDNESDAY House Band, 6-8pm Acoustic, 7/8-10pm",
        days: [3],
        start: "18:00",
        end: "22:00",
        danceCited:
          "own site, https://www.clivebaratx.com/: 'live country music', 'Enjoy our spacious dance floor'; https://www.clivebaratx.com/live-music: 'DANCE WITH US' (2026-11-07)",
      },
      {
        title: "Live Country Bands at Clive Bar (Thu)",
        line: "THURSDAY House Band, 6-8pm Second Band, 8/9-11pm",
        days: [4],
        start: "18:00",
        end: "23:00",
        danceCited:
          "own site, https://www.clivebaratx.com/: 'live country music', 'Enjoy our spacious dance floor'; https://www.clivebaratx.com/live-music: 'DANCE WITH US' (2026-11-07)",
      },
      {
        title: "Live Country Bands at Clive Bar (Fri)",
        line: "FRIDAY House Band, 6-8pm Second Band, 8-11pm",
        days: [5],
        start: "18:00",
        end: "23:00",
        danceCited:
          "own site, https://www.clivebaratx.com/: 'live country music', 'Enjoy our spacious dance floor'; https://www.clivebaratx.com/live-music: 'DANCE WITH US' (2026-11-07)",
      },
      {
        title: "Live Country Bands at Clive Bar (Sat)",
        line: "Late Band, 8-11pm",
        days: [6],
        start: "20:00",
        end: "23:00",
        danceCited:
          "own site, https://www.clivebaratx.com/: 'live country music', 'Enjoy our spacious dance floor'; https://www.clivebaratx.com/live-music: 'DANCE WITH US' (2026-11-07)",
      },
    ],
  },
  // Austin Uptown Dance, 8868 Research Blvd #706: its Squarespace events list (11/07: Austin Westie Academy WCS
  // Thursdays 7:45-11pm, Echale Salsita 2nd Saturdays 8pm-2am, Connection Tango Milonga, Salsamania, open houses).
  // Read as its page shows it (squarespace reader), never the ?format=json view. Its robots.txt names AI crawlers in
  // the same group as `*`, which allows the events pages (11/07).
  {
    url: "https://www.austinuptowndance.com/main-events",
    kind: "squarespace",
    platform: "squarespace",
    trustTier: "first_party",
    styles: ["west_coast_swing", "salsa", "bachata", "milonga"],
    label: "Austin Uptown Dance",
    venueAddress: "8868 Research Blvd #706, Austin, TX 78758",
    venuePage: true,
    mixedCalendar: true,
    // Its socials' names carry no dance word: the first read (42391420850) screened Echale Salsita out.
    danceNights: ["Echale Salsita", "Salsamania", "Austin Westie Academy"],
  },
  // Eventbrite organisers found on Eventbrite's public Austin search pages (salsa, bachata, two-step, swing,
  // dance party; 11/07), read through the API (D-131): Double or Nothing Two-Step (weekly lessons at Sagebrush,
  // Sun and Tue), Be-Bachata Dance Academy (bachata classes and parties), Balledjo American Social
  // Guild (Afro-Latin night: salsa, merengue, cumbia, bachata).
  eventbrite(
    "https://www.eventbrite.com/o/double-or-nothing-two-step-118223927791",
    "Double or Nothing Two-Step (Eventbrite)",
    ["two_step"],
  ),
  eventbrite(
    "https://www.eventbrite.com/o/be-bachata-dance-academy-106710443641",
    "Be-Bachata Dance Academy (Eventbrite)",
    ["bachata"],
  ),
  eventbrite(
    "https://www.eventbrite.com/o/balledjo-american-social-guild-76880320293",
    "Balledjo American Social Guild (Eventbrite)",
    ["salsa", "merengue", "cumbia", "bachata"],
  ),
  // Donn's Depot, 1600 W 5th St (Clarksville dance hall since 1978, "LIVE MUSIC / COCKTAILS / DANCING"): its site
  // answers 403 to GitHub Actions (read 42391420850), so it is hand-checked in the owner's browser monthly (D-798) and
  // never fetched. The 2026-11-08 check: a band every night Mon-Sat, Monday 8:30pm, Wednesday Double or Nothing
  // two-step lessons at 7:30pm then a band 8:30-11:30pm, other nights 9pm; closed Sunday.
  // Re-checked 2026-11-23 (weekly review, fetched from the cloud: 200): still "DANCING" and a band each night
  // Mon-Sat (Mon 8:30pm, Wed lessons 7:30pm then band 8:30pm, others 9pm); closed Thanksgiving 11-26.
  {
    url: "https://donnsdepot.com/",
    kind: "html",
    trustTier: "first_party",
    styles: ["two_step", "country"],
    platform: "probed",
    label: "Donn's Depot",
    venueAddress: "1600 W 5th St, Austin, TX 78703",
    venuePage: true,
    onlyHere: true,
    handChecked: true,
    fixedNights: [
      {
        title: "Monday Band and Dancing at Donn's Depot",
        line: "Monday: live band 8:30 pm, no cover",
        days: [1],
        start: "20:30",
        danceCited: DONNS_DANCE_CITED,
        checkedOn: "2026-11-23",
        evidenceUrl: "https://donnsdepot.com/",
      },
      {
        title: "Tuesday Band and Dancing at Donn's Depot",
        line: "Tuesday: live band 9:00 pm",
        days: [2],
        start: "21:00",
        danceCited: DONNS_DANCE_CITED,
        checkedOn: "2026-11-23",
        evidenceUrl: "https://donnsdepot.com/",
      },
      {
        title: "Double or Nothing Two-Step Lessons and Band at Donn's Depot",
        line: "Wednesday: Double or Nothing two-step lessons 7:30 pm, live band 8:30-11:30 pm",
        days: [3],
        start: "19:30",
        end: "23:30",
        danceCited: DONNS_DANCE_CITED,
        checkedOn: "2026-11-23",
        evidenceUrl: "https://donnsdepot.com/",
      },
      {
        title: "Thursday Band and Dancing at Donn's Depot",
        line: "Thursday: live band 9:00 pm",
        days: [4],
        start: "21:00",
        danceCited: DONNS_DANCE_CITED,
        checkedOn: "2026-11-23",
        evidenceUrl: "https://donnsdepot.com/",
      },
      {
        title: "Friday Band and Dancing at Donn's Depot",
        line: "Friday: live band 9:00 pm",
        days: [5],
        start: "21:00",
        danceCited: DONNS_DANCE_CITED,
        checkedOn: "2026-11-23",
        evidenceUrl: "https://donnsdepot.com/",
      },
      {
        title: "Saturday Band and Dancing at Donn's Depot",
        line: "Saturday: live band 9:00 pm",
        days: [6],
        start: "21:00",
        danceCited: DONNS_DANCE_CITED,
        checkedOn: "2026-11-23",
        evidenceUrl: "https://donnsdepot.com/",
      },
    ],
  },
  // Coconut Club, 310B Colorado St ("Dance & Night Club"; no site of its own, Facebook and Instagram only): its own
  // Instagram, read by hand in the owner's browser (D-797), never fetched. 2026-11-09 check: "Latin Thursdays" every
  // Thursday, salsa or bachata classes 8-9pm then salsa upstairs and bachata downstairs to 1am (posts of 10-29 to
  // 11-05). Its Wednesday "Open Decks" is a DJ night with no dance stated; its Fri/Sat nights change week to week.
  {
    url: "https://www.instagram.com/coconutclub.austin/",
    kind: "html",
    platform: "probed",
    trustTier: "first_party",
    styles: ["salsa", "bachata"],
    label: "Coconut Club",
    venueAddress: "310B Colorado St, Austin, TX 78701",
    venuePage: true,
    onlyHere: true,
    handChecked: true,
    fixedNights: [
      {
        title: "Latin Thursdays at Coconut Club",
        line: "Latin Thursdays at Coconut Club! 8 PM - 9 PM Dance Classes: Salsa or Traditional Bachata. 9 PM - 1 AM Party Time: Rooftop: Old School Sazón (Salsa w/ DJ Coquito + Live Percussion!) Downstairs: Bachata",
        days: [4],
        start: "20:00",
        end: "01:00",
        styles: ["salsa", "bachata"],
        danceCited:
          "own Instagram, https://www.instagram.com/p/DfU2XjOT4V1/ (2026-11-05): 'Dance Classes: Salsa ... Traditional Bachata', 'a night of non-stop music, dancing' (hand-checked 2026-11-09, D-797)",
        checkedOn: "2026-11-09",
        evidenceUrl: "https://www.instagram.com/p/DfU2XjOT4V1/",
      },
    ],
  },
];

export const AUSTIN_RETIRED: readonly RetiredSource[] = [
  {
    url: "https://dice.fm/browse/austin-5e3c24db136e51081e406ed3/dj",
    reason:
      "on Austin's first read (42391420850, 2026-11-07) the DJ and party pages served the same 30-event gig list: band concerts at Chess Club, Hotel Vegas and The 13th Floor; Austin's club nights come through RA 321, 19hz and the clubs' own pages",
  },
  {
    url: "https://dice.fm/browse/austin-5e3c24db136e51081e406ed3/party",
    reason: "the same gig list as the DJ page on Austin's first read (42391420850, 2026-11-07)",
  },
  {
    url: "https://www.meetup.com/Austin-Contra-Dancers/",
    reason:
      "found by discovery from TAADA's page; its iCal answers 404 (the group is gone, 2026-11-07); TAADA's own page carries the contra dances",
  },
  {
    url: "https://www.eventbrite.com/o/latin-city-1098215067",
    reason:
      "a multi-city food-festival organiser: its first read (2026-11-07) gave Houston, Jacksonville and Manassas festivals and no Austin dance night",
  },
];
