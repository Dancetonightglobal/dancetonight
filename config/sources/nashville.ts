// Nashville's starting sources (D-1200). US rules (D-034): official APIs and public pages, robots.txt honoured;
// Facebook and Instagram never; Resident Advisor through its GraphQL area only (D-505, config/sources/ra.ts,
// area 653). Sources are added as they are checked; the daily run also seeds venues and discovers their
// websites (D-120).
// Not read (2026-11-07): Tantísimo (tantisimo.com's robots.txt disallows ClaudeBot; its Tuesday and Sunday nights
// come through Salsa Vida), Acme Feed & Seed (its robots.txt disallows ClaudeBot by name), Wildhorse Saloon (its
// Events Calendar feed is empty; Category 10 now carries its line dancing), Category 10's events feed (concerts
// only; its line-dancing page is read below), Rudy's Jazz Room (its calendar loads by script
// from an empty feed; its Monday salsa with 12 Manos comes through Salsa Vida), DICE (about one event each on its
// Nashville DJ and party pages), Shotgun (all 18 Nashville events are Night We Met's, read from its own site below).

import type { RetiredSource, SeedSource } from "@/config/sources/nyc";
import type { StyleKey } from "@/config/styles";

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

export const NASHVILLE_SOURCES: SeedSource[] = [
  // Salsa Vida's Nashville guide: schema.org Events on the page (7 on 11/07: Nashville Palace Monday salsa and
  // bachata, Tantísimo, Rudy's Jazz Room, Plaza Mariachi); robots.txt allows it. Read as Raleigh's is (D-321).
  {
    url: "https://www.salsavida.com/guides/tennessee/nashville/",
    kind: "html",
    trustTier: "directory",
    styles: ["salsa", "bachata"],
    label: "Salsa Vida Nashville",
  },
  // The Nashville Palace, Music Valley (its real site; nashvillepalace.com is a parked domain). Its Wix Events
  // calendar (156 events in the warmup data on 11/07): Standard Western Line Dance Lessons, Line Dance Lessons 21+,
  // Open Line Dance 18+/21+, Salsa and Bachata Lessons, Ladies Night, Two Step Nights, beside daytime band sets and
  // karaoke. Its own home and dancing pages: "live music that keeps the floor packed every night" and "weekend
  // dance nights featuring DJ sets", so evening band billings are read as live music with dancing (D-341).
  // robots.txt disallows only lightbox and Wix internals (2026-11-07).
  {
    url: "https://www.thefamousnashvillepalace.com/calendar",
    kind: "wix",
    platform: "wix_events",
    trustTier: "first_party",
    styles: ["line_dance", "two_step", "country", "salsa", "bachata"],
    label: "The Nashville Palace",
    venueAddress: "2611 McGavock Pike, Nashville, TN 37214",
    venuePage: true,
    onlyHere: true,
    mixedCalendar: true,
    bandsForDancers: true,
    bandsForDancersFrom: "19:00",
    notDanceNights: ["Karaoke", "Nashville Palace Angels Go Live"],
  },
  // Plaza Mariachi, 3955 Nolensville Pike: its The Events Calendar iCal (30 events on 11/07: flea markets, happy
  // hours, mariachi shows, fairs; "Salsa Night – Free Lesson & Open Dance Floor" on Thursdays). A mixed calendar.
  // robots.txt allows it (2026-11-07).
  {
    url: "https://plazamariachi.com/events/",
    kind: "feed_ics",
    feedUrl: "https://plazamariachi.com/?post_type=tribe_events&ical=1&eventDisplay=list",
    trustTier: "first_party",
    styles: ["salsa", "bachata"],
    label: "Plaza Mariachi",
    venueAddress: "3955 Nolensville Pike, Nashville, TN 37211",
    venuePage: true,
    onlyHere: true,
    mixedCalendar: true,
    notDanceNights: [
      "Mexican Folkloric Dance",
      "Arabian Nights Dinner Show",
      "Flea Market at Plaza Mariachi",
      "Live Out Love Health Fair with HFF at Plaza Mariachi",
    ],
  },
  // The 5 Spot, Five Points (East Nashville): its home page lists every show by date (Tim Carroll happy hours,
  // bands, karaoke, "Strictly 80's Dance Party"). Motown Monday names no dance; two guides say it is a dance
  // night: StyleBlueprint, 2025-08-06 ("hosts Motown Mondays every week. Beginning at 9 p.m., this is a
  // dance-centric event") and WMOT ("packed with people mingling and dancing ... a dance party called 'Motown
  // Mondays'"). robots.txt disallows only /wp-admin/ and wpforms uploads (2026-11-07).
  {
    url: "https://the5spotnashville.com/",
    kind: "html",
    trustTier: "first_party",
    styles: ["retro", "disco"],
    label: "The 5 Spot",
    venueAddress: "1006 Forrest Ave, Nashville, TN 37206",
    venuePage: true,
    onlyHere: true,
    mixedCalendar: true,
    danceNights: ["MOTOWN MONDAY"],
    // Read 42502522680 (2026-11-08): the model listed none of the page's dated MOTOWN MONDAY rows, so the weekly night
    // is listed from the page line itself (the guides above say it is a weekly dance party from 9 p.m.).
    fixedNights: [
      {
        title: "MOTOWN MONDAY",
        line: "MOTOWN MONDAY",
        days: [1],
        start: "21:00",
        replacesTitles: ["MOTOWN MONDAY", "Motown Monday"],
        danceCited:
          "StyleBlueprint 2025-08-06: 'hosts Motown Mondays every week. Beginning at 9 p.m., this is a dance-centric event'; WMOT: 'packed with people mingling and dancing ... a dance party called Motown Mondays' (D-510); own site lists 'MOTOWN MONDAY November 9, 2026 @ 9:00 PM' (2026-11-08)",
      },
    ],
  },
  // Swing Dance Nashville's Jump Session page: "every 2nd and 4th Friday ... 730-830 PM Beginner Swing Dance Lesson
  // 830-1100 PM Open Dancing" at the Global Education Center (4822 Charlotte Ave #3). An organiser's own stated
  // night (D-402 weekly grid). robots.txt disallows only WordPress admin paths (2026-11-07). The night is always at the
  // Global Education Center, so the page is treated as that venue's: read 42502522680 left its row unplaced (no venue).
  {
    url: "https://swingdancenashville.com/jump-session/",
    kind: "html",
    trustTier: "first_party",
    styles: ["lindy_hop", "swing"],
    label: "Global Education Center",
    venueAddress: "4822 Charlotte Ave, Nashville, TN 37209",
    venuePage: true,
    weeklyGrid: true,
  },
  // Night We Met, The Gulch: its own home page states "A Modern and Elevated Dance Music Experience" and the club
  // room's hours "Fri/Sat: 10pm-3am [Moon Room]" (its Sun-Thu Vera Lounge is a cocktail lounge, left out). A
  // nightclub's own stated nights with a genre (D-1082). Its dated events load by script from Shotgun, so the
  // standing nights are listed without the model. robots.txt allows everything (2026-11-07).
  {
    url: "https://nightwemetnashville.com/",
    kind: "html",
    trustTier: "first_party",
    styles: ["house", "techno"],
    label: "Night We Met",
    venueAddress: "114 12th Ave N, Nashville, TN 37203",
    venuePage: true,
    onlyHere: true,
    mixedCalendar: true,
    fixedNights: [
      {
        title: "Night We Met (Moon Room)",
        line: "Fri/Sat: 10pm-3am [Moon Room]",
        days: [5, 6],
        start: "22:00",
        end: "03:00",
        danceCited:
          "own site, https://nightwemetnashville.com/: 'A Modern and Elevated Dance Music Experience', 'centered first and foremost around dance music' (2026-11-07)",
      },
    ],
  },
  // Play Dance Bar, 1519 Church St (LGBTQ dance bar with drag shows): its own Nashville page, "Voted Nashville's
  // Best Place to Dance since 2005 ... a World-class Dance Floor with our roster of Resident DJ's! Operating Hours:
  // Monday–Tuesday Closed Wednesday, Thursday, Sunday 8pm–2am Friday–Saturday 8pm–3am" (D-1082). No robots.txt
  // (2026-11-07). Its drag shows are screened as shows (mixed calendar).
  {
    url: "https://nashville.playdancebar.com/",
    kind: "html",
    trustTier: "first_party",
    styles: ["queer_party", "dj_night"],
    label: "Play Dance Bar",
    venueAddress: "1519 Church St, Nashville, TN 37203",
    venuePage: true,
    onlyHere: true,
    mixedCalendar: true,
    fixedNights: [
      {
        title: "Play Dance Bar",
        line: "Wednesday, Thursday, Sunday 8pm–2am",
        days: [0, 3, 4],
        start: "20:00",
        end: "02:00",
        danceCited:
          "own site, https://nashville.playdancebar.com/: 'Voted Nashville's Best Place to Dance since 2005' and 'a World-class Dance Floor with our roster of Resident DJ's' (2026-11-07)",
      },
      {
        title: "Play Dance Bar (Friday and Saturday)",
        line: "Friday–Saturday 8pm–3am",
        days: [5, 6],
        start: "20:00",
        end: "03:00",
        danceCited:
          "own site, https://nashville.playdancebar.com/: 'Voted Nashville's Best Place to Dance since 2005' and 'a World-class Dance Floor with our roster of Resident DJ's' (2026-11-07)",
      },
    ],
  },
  // Flamingo Cocktail Club, Wedgewood-Houston: its own home page's weekly grid ("Thursday 6PM – 12AM Rotating
  // entertainment & DJs 3rd Thu: Latin Night — salsa lesson 9PM, DJ 10PM"; "Friday 6PM – 2AM Live jazz 7:30–9:30 →
  // rotating DJs & events"; "1st Sat: Perreo Party · 2nd: SWEAT (no cover) · 3rd: 509Party · Last: Studio 54").
  // Its Wednesday improv jam and comedy nights are screened as shows. robots.txt allows / (2026-11-07).
  // The first read (run 42393901109) put the 3rd-Thursday Latin Night under Friday as a weekly night, so the grid's
  // rows are not read: the Friday and Saturday DJs are fixed nights from the grid's own line, and the 3rd-Thursday
  // Latin Night (RITMO) comes through its Eventbrite organiser below.
  {
    url: "https://www.flamingococktailclub.com/",
    kind: "html",
    trustTier: "first_party",
    styles: ["dj_night", "reggaeton"],
    label: "Flamingo Cocktail Club",
    venueAddress: "509 Houston St, Nashville, TN 37203",
    venuePage: true,
    onlyHere: true,
    mixedCalendar: true,
    notDanceNights: ["Latin Night", "The Invite", "Live jazz → rotating DJs & events"],
    fixedNights: [
      {
        title: "Flamingo Cocktail Club DJs",
        line: "Live jazz 7:30–9:30 → rotating DJs & events No cover",
        days: [5, 6],
        start: "21:30",
        end: "02:00",
        danceCited:
          "own site, https://www.flamingococktailclub.com/: 'Friday 6PM – 2AM Live jazz 7:30–9:30 → rotating DJs & events', 'Flamingo Food / Cocktails / Dancing', 'It is at once a casual dance club' (2026-11-07)",
      },
    ],
  },
  // The Office, 604 Gallatin Ave (East Nashville): "Underground EDM Venue & Nightclub"; its home page lists the
  // upcoming club nights by date (DJ billings, 10-11pm starts). robots.txt is empty (2026-11-07).
  {
    url: "https://www.theofficenashville.com/",
    kind: "html",
    trustTier: "first_party",
    styles: ["house", "techno", "dj_night"],
    label: "The Office",
    venueAddress: "604 Gallatin Ave Ste 117, Nashville, TN 37206",
    venuePage: true,
    onlyHere: true,
  },
  // Category 10, Lower Broad (Nashville Scene readers' Best Place to Dance 2025): its own "Free Line Dancing" page
  // shows today's Hurricane Hall card, "Line Dance Schedule 11:00 AM - 1:00 AM", under the date ("Line Dancing
  // Available Thursday - Sunday"; free lessons and an all-call, 21+ after 8 PM). One dated night per daily read.
  // robots.txt allows everything (2026-11-07).
  {
    url: "https://www.category10.com/nashville/line-dancing/",
    kind: "html",
    // Pinned to plain HTML: the first read (run 42393901109) took the page's events iCal link, concerts only.
    platform: "probed",
    trustTier: "first_party",
    styles: ["line_dance", "country"],
    label: "Category 10",
    venueAddress: "120 2nd Ave N, Nashville, TN 37201",
    venuePage: true,
    onlyHere: true,
    // Read 42502522680 (2026-11-08) wrote 0: the model gave "Free Line Dancing" as a weekly night the visible text does
    // not write. The days are in the page's own calendar markup ("Line Dancing Available Thursday - Sunday") and
    // Category 10's 2025 guide ("free lessons from Thursday through Sunday"); hours vary ("Thursday has varying hours").
    fixedNights: [
      {
        title: "Free Line Dancing (Hurricane Hall)",
        line: "Line Dance All-Call Own the floor!",
        days: [0, 4, 5, 6],
        start: null,
        replacesTitles: [
          "Free Line Dancing",
          "Line Dance Schedule",
          "Hurricane Hall Line Dance Schedule",
        ],
        danceCited:
          "own site, https://www.category10.com/nashville/line-dancing/: 'FREE line dance lessons! ... Line Dance All-Call', calendar markup 'Line Dancing Available Thursday - Sunday'; category10.com 2025-09-30 guide: free lessons Thursday through Sunday (2026-11-08)",
      },
    ],
  },
  // Tin Roof Demonbreun, 1516 Demonbreun St: its own calendar page states "Bands in the live room, DJ's in the Green
  // Room, 4 bars & no cover at the Tin Roof on Demonbreun every weekend night since 2002!" A bar's own stated weekly
  // DJ nights (owner rule 10-30); the Green Room is its DJ dance floor (TableJourney). The weekend means Friday and
  // Saturday; no times are given. Its dated rows (band shows, watch parties) are screened. robots.txt allows
  // everything (2026-11-07).
  {
    url: "https://theoriginaltinroof.com/live-music-events-calendar/",
    kind: "html",
    trustTier: "first_party",
    styles: ["dj_night"],
    label: "Tin Roof Demonbreun",
    venueAddress: "1516 Demonbreun St, Nashville, TN 37203",
    venuePage: true,
    onlyHere: true,
    mixedCalendar: true,
    fixedNights: [
      {
        title: "Tin Roof Green Room DJs",
        line: "Bands in the live room, DJ's in the Green Room, 4 bars & no cover at the Tin Roof on Demonbreun every weekend night since 2002!",
        days: [5, 6],
        start: null,
        danceCited:
          "own site, https://theoriginaltinroof.com/live-music-events-calendar/: 'DJ's in the Green Room ... every weekend night'; TableJourney: 'a DJ-led Green Room dance floor' (2026-11-07)",
      },
    ],
  },
  // Skinny Dennis, 2635 Gallatin Pike (East Nashville honky-tonk; Nashville Scene Best New Honky-Tonk 2025): its own
  // calendar lists every night by date (bands, happy hours, a Sunday vintage market) and each Sunday "BEGINNER TWO
  // STEP LESSON WITH ZG SMITH" ("Sunday nights start with a beginner's Tennessee Two-Step lesson at 8pm"), 12 on
  // 2026-11-07. Only that night is kept; band billings are screened. robots.txt allows everything (2026-11-07).
  {
    url: "https://skinnydennisnashville.com/calendar/",
    kind: "html",
    trustTier: "first_party",
    styles: ["two_step", "country"],
    label: "Skinny Dennis",
    venueAddress: "2635 Gallatin Pike, Nashville, TN 37216",
    venuePage: true,
    onlyHere: true,
    mixedCalendar: true,
    // The first read (run 42393901109) wrote the lesson under the page's prose ("Sunday nights start with ...")
    // and the band's billing; the lesson night is a fixed Sunday night instead, replacing those rows.
    fixedNights: [
      {
        title: "Beginner Two Step Lesson with ZG Smith",
        line: "Sunday nights start with a beginner's Tennessee Two-Step lesson at 8pm",
        days: [0],
        start: "20:00",
        danceCited:
          "own site, https://skinnydennisnashville.com/calendar/: 'BEGINNER TWO STEP LESSON WITH ZG SMITH ... Sunday nights start with a beginner's Tennessee Two-Step lesson at 8pm' (2026-11-07)",
        replacesTitles: [
          "Sunday nights start with a beginner's Tennessee Two-Step lesson",
          "Sunday Two-Step Lesson & Live Band",
          "Tennessee Two-Step lesson and live band",
        ],
      },
    ],
  },
  // Honky Tonk Tuesday Nights, Eastside Bowl, Madison (Davidson County): the series' own site states "Honky Tonk
  // Roundup Presents Honky Tonk Tuesday Nights LIVE AT EASTSIDE BOWL ... 7PM: Dance Lessons w/ Laura Mae Socks 8PM:
  // Live Music + The Cowpokes" (D-1082). Dancing: StyleBlueprint's "Dancing in Nashville" and WMOT (2026-04-12, "the
  // country swing and two-step vortex ... on the much larger Eastside Bowl dancefloor"), two independent guides
  // (D-510). robots.txt (Shopify) allows the home page (2026-11-07).
  {
    url: "https://honkytonkroundup.com/",
    kind: "html",
    trustTier: "first_party",
    styles: ["two_step", "swing", "country"],
    label: "Honky Tonk Tuesday Nights",
    mixedCalendar: true,
    venueAddress: "1508A Gallatin Pike, Madison, TN 37115",
    onlyHere: true,
    fixedNights: [
      {
        title: "Honky Tonk Tuesday Nights",
        line: "Honky Tonk Tuesday Nights LIVE AT EASTSIDE BOWL",
        days: [2],
        start: "19:00",
        venue: "Eastside Bowl",
        danceCited:
          "own site, https://honkytonkroundup.com/: '7PM: Dance Lessons w/ Laura Mae Socks'; WMOT 2026-04-12: 'the country swing and two-step vortex that is now on the much larger Eastside Bowl dancefloor' (2026-11-07)",
      },
    ],
  },
  // Brooklyn Bowl Nashville, Germantown: its own shows page carries schema.org Events (36 on 2026-11-07, mostly
  // concerts; Blisspop's themed DJ dance parties such as "Hot In Herre: 2000s Dance Party", and QDP's Pride
  // nights), hence the screen. robots.txt allows everything (2026-11-07).
  {
    url: "https://nashville.brooklynbowl.com/shows",
    kind: "jsonld",
    platform: "jsonld_items",
    trustTier: "first_party",
    styles: ["dj_night", "retro"],
    label: "Brooklyn Bowl Nashville",
    mixedCalendar: true,
    venuePage: true,
    onlyHere: true,
    venueAddress: "925 3rd Ave N, Nashville, TN 37201",
  },
  // The Ballroom of Nashville, 4928 Edmondson Pike #107 (a dance studio): its own calendar page prints the weekly
  // grid "M O N D A Y ... 7:00pm West Coast Swing Beginner Class ... 8:00pm West Coast Swing Dance Party ...
  // W E D N E S D A Y 7:00pm Lindy Hop with Laynee 8:00pm Swing Dance Party with Laynee ... S A T U R D A Y ...
  // 6:00pm Argentine TanGo Practica", "All activities and events are open to the public ... Walk-ins welcome" (an
  // organiser's own stated weekly nights, D-1082). Only the socials are listed, not the classes. robots.txt (Wix)
  // allows the page (2026-11-07).
  {
    url: "https://www.theballroomofnashville.com/calendar",
    kind: "html",
    trustTier: "first_party",
    styles: ["west_coast_swing", "swing", "lindy_hop", "tango"],
    label: "The Ballroom of Nashville",
    venueAddress: "4928 Edmondson Pike #107, Nashville, TN 37211",
    venuePage: true,
    onlyHere: true,
    fixedNights: [
      {
        title: "West Coast Swing Dance Party",
        line: "8:00pm West Coast Swing Dance Party",
        days: [1],
        start: "20:00",
        styles: ["west_coast_swing"],
        danceCited:
          "own site, https://www.theballroomofnashville.com/calendar: 'M O N D A Y ... 7:00pm West Coast Swing Beginner Class ... 8:00pm West Coast Swing Dance Party' (2026-11-07)",
      },
      {
        title: "Swing Dance Party",
        line: "8:00pm Swing Dance Party with Laynee",
        days: [3],
        start: "20:00",
        styles: ["lindy_hop", "swing"],
        danceCited:
          "own site, https://www.theballroomofnashville.com/calendar: 'W E D N E S D A Y 7:00pm Lindy Hop with Laynee 8:00pm Swing Dance Party with Laynee' (2026-11-07)",
      },
      {
        title: "Argentine Tango Practica",
        line: "6:00pm Argentine TanGo Practica",
        days: [6],
        start: "18:00",
        styles: ["tango"],
        danceCited:
          "own site, https://www.theballroomofnashville.com/calendar: 'S A T U R D A Y ... 5:00pm Argentine Tango Fundamentals with Patricia 6:00pm Argentine TanGo Practica' (2026-11-07)",
      },
    ],
  },
  // DanceQuest Ballroom, 700 Airpark Center Dr Suite 715 (a ballroom studio): its The Events Calendar iCal (30 events
  // on 2026-11-07: "Dance Party - 8:00-10:00pm" Fridays, group classes "Rumba - 6:30pm" Mon, "Kizomba - 7:00pm" Tue,
  // "Waltz - 7:00pm" Wed, Salsa Sat, Bachata Sun; holiday notes "Veterans Day", "Happy Thanksgiving", hence the
  // screen). robots.txt disallows only /wp-admin/ (2026-11-07).
  {
    url: "https://dancequestnashville.com/calendar/",
    kind: "feed_ics",
    feedUrl: "https://dancequestnashville.com/calendar/?ical=1",
    trustTier: "first_party",
    styles: ["ballroom", "salsa", "bachata", "kizomba"],
    label: "DanceQuest Ballroom",
    venueAddress: "700 Airpark Center Dr Suite 715, Nashville, TN 37217",
    venuePage: true,
    onlyHere: true,
    mixedCalendar: true,
  },
  // Blueprint Underground Cocktail Club, 156 Printers Alley: its own entertainment page, "Party with the hottest DJs
  // every weekend ... non-stop dancing", and its hours "Friday: 7pm-2am Saturday: 7pm-2am" (a DJ bar's own weekly
  // nights, the owner 2026-10-30; D-1082). Its schedule says "Check back soon for updates". No robots.txt (404, 2026-11-07).
  {
    url: "https://blueprintcocktailclub.com/entertainment",
    kind: "html",
    trustTier: "first_party",
    styles: ["dj_night"],
    label: "Blueprint Underground Cocktail Club",
    venueAddress: "156 Printers Alley, Nashville, TN 37201",
    venuePage: true,
    onlyHere: true,
    fixedNights: [
      {
        title: "Blueprint Underground (DJs)",
        line: "Friday: 7pm-2am Saturday: 7pm-2am",
        days: [5, 6],
        start: "19:00",
        end: "02:00",
        danceCited:
          "own site, https://blueprintcocktailclub.com/entertainment: 'Party with the hottest DJs every weekend ... non-stop dancing' (2026-11-07)",
      },
    ],
  },
  // Nashville Tango Club (Argentine tango): its own home page, "holds weekly practicas, monthly Saturday milongas" and
  // "Practicas and Workshops THURSDAYS 7:00PM - 8:30PM Casa Azafran 2195 Nolensville Pike, Suite L3". Its monthly
  // milongas are on the Tango Mango calendar. robots.txt allows everything (2026-11-07).
  {
    url: "https://nashvilletango.com/",
    kind: "html",
    trustTier: "first_party",
    styles: ["tango"],
    label: "Nashville Tango Club",
    venueAddress: "2195 Nolensville Pike Suite L3, Nashville, TN 37211",
    onlyHere: true,
    fixedNights: [
      {
        title: "Nashville Tango Club Practica",
        line: "Practicas and Workshops THURSDAYS 7:00PM - 8:30PM",
        days: [4],
        start: "19:00",
        end: "20:30",
        venue: "Casa Azafran",
        danceCited:
          "own site, https://nashvilletango.com/: 'Nashville Tango Club holds weekly practicas ... Practicas and Workshops THURSDAYS 7:00PM - 8:30PM' (2026-11-07)",
      },
    ],
  },
  // American Legion Post 82, Inglewood (3204 Gallatin Pike): its own home page header, "Live music and dance lessons on
  // Thursdays!" ("Rocky Tonk Thursday": lessons, then bands; no time on its page, so "Time not listed"). robots.txt disallows only /404 (2026-11-07).
  {
    url: "https://nashvillepost82.org/",
    kind: "html",
    trustTier: "first_party",
    styles: ["country", "two_step", "swing"],
    label: "American Legion Post 82",
    venueAddress: "3204 Gallatin Pike, Nashville, TN 37216",
    venuePage: true,
    onlyHere: true,
    fixedNights: [
      {
        title: "Live Music and Dance Lessons",
        line: "Live music and dance lessons on Thursdays!",
        days: [4],
        start: null,
        // The model also reads the header as a dated row (raw "Live music and dance lessons on Thursdays", tidied by
        // D-837): one read wrote both, so they never merge. The model's copy is dropped here (run 43063450875).
        replacesTitles: [
          "Live music and dance lessons on Thursdays!",
          "Live music and dance lessons on Thursdays",
          "Live music and dance lessons",
        ],
        danceCited:
          "own site, https://nashvillepost82.org/: 'Live music and dance lessons on Thursdays!'; nashvillemusiccalendar.com lists Thursday 'Rocky Tonk' nights there (2026-11-07)",
      },
    ],
  },
  // Nashville Salsa Dancing's socials page: dated salsa socials at changing venues ("Salsa Lounge ... Hot Ticket - 311
  // Gallatin Ave ... November 14th 5-7 PM"; "Salsa Cafe ... Second Saturday of every month"). No robots.txt (404,
  // 2026-11-07). Its 1st-Saturday Salseros Social also comes via Salsa Vida (dedupe).
  {
    url: "https://nashvillesalsadancing.com/socials",
    kind: "html",
    trustTier: "first_party",
    styles: ["salsa"],
    label: "Nashville Salsa Dancing",
  },
  // Eventbrite organisers found by hand from Eventbrite's public Nashville search pages (salsa, bachata, swing,
  // line-dancing, dance-party, kizomba, ballroom), 2026-11-07 (D-131). Acme Feed & Seed's own site bars ClaudeBot
  // in robots.txt and is not read; its Eventbrite organiser is a separate site.
  eventbrite(
    "https://www.eventbrite.com/o/acme-feed-seed-6943431155",
    "Acme Feed & Seed (Eventbrite)",
    ["line_dance", "salsa"],
  ),
  eventbrite(
    "https://www.eventbrite.com/o/flamingo-cocktail-club-26902406793",
    "Flamingo Cocktail Club (Eventbrite)",
    ["salsa", "bachata"],
  ),
  eventbrite(
    "https://www.eventbrite.com/o/rayos-entertainment-120838787572",
    "Rayos Entertainment (Eventbrite)",
    ["reggaeton", "latin_club"],
  ),
  eventbrite(
    "https://www.eventbrite.com/o/pressed-and-aged-121732160713",
    "Pressed and Aged (Eventbrite)",
    ["latin_club", "salsa", "bachata"],
  ),
  eventbrite(
    "https://www.eventbrite.com/o/the-art-of-ballroom-llc-112468086981",
    "The Art of Ballroom (Eventbrite)",
    ["social_ballroom"],
  ),
  eventbrite(
    "https://www.eventbrite.com/o/615-soul-line-dancers-58583674073",
    "615 Soul Line Dancers (Eventbrite)",
    ["line_dance"],
  ),
  eventbrite(
    "https://www.eventbrite.com/o/body-language-by-lalaa-121614583393",
    "Body Language by Lalaa (Eventbrite)",
    ["dj_night", "disco"],
  ),
];

export const NASHVILLE_RETIRED: RetiredSource[] = [];
