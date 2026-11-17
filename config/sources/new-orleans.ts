// New Orleans' starting sources (D-340). US rules (D-034): official APIs and public pages, robots.txt honoured;
// Resident Advisor, Facebook and Instagram never. Sources are added as they are checked; the daily run also
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

/** A page naming its events' own pages (a JSON-LD ItemList, Wix event links), followed (D-111). */
const eventPages = (url: string, label: string, styles: StyleKey[]): SeedSource => ({
  ...page(url, label, styles),
  kind: "jsonld",
  platform: "jsonld_items",
});

/** An organiser read through Eventbrite's official API by organiser ID (D-015, D-131, D-205). */
const eventbrite = (url: string, label: string, styles: StyleKey[]): SeedSource => ({
  url,
  kind: "ticketing_api",
  trustTier: "ticketing",
  platform: "eventbrite",
  styles,
  label,
  mixedCalendar: true,
});

export const NEW_ORLEANS_SOURCES: readonly SeedSource[] = [
  // Salsa Vida's New Orleans guide: schema.org Events on the page (Nola Latin Nights, Thursdays at
  // Dance Quarter, dated to 11/05 on 10/29); robots.txt allows it (checked 2026-10-29).
  // Salsa Vida lists only dance nights: not a mixed calendar, so a night whose title names no dance ("Noche Habanera") stays (D-772).
  {
    ...directory(
      "https://www.salsavida.com/guides/louisiana/new-orleans/",
      "Salsa Vida New Orleans",
      ["salsa", "bachata"],
    ),
    mixedCalendar: false,
  },
  // Rock 'n' Bowl, Mid-City: its New Orleans events page (Wix events, each event's own page carries
  // JSON-LD; dated to 12/18 on 10/29). Zydeco Thursdays, Latin Night Tuesdays, party bands at weekends.
  // /live-music is the Lafayette club's calendar: not this one. robots.txt allows / (checked 2026-10-29).
  // Its band nights are dance nights (D-341): a dance hall, dancers on the floor every band night.
  {
    ...eventPages("https://www.rocknbowl.com/new-orleans", "Rock 'n' Bowl", ["zydeco", "swing"]),
    venueAddress: "3016 S Carrollton Ave, New Orleans, LA 70118",
    venuePage: true,
    mixedCalendar: true,
    bandsForDancers: true,
  },
  // Band bars on Frenchmen Street (D-341): each venue's whole calendar, its band billings kept as live music
  // with dancing. Evidence that people dance there is in each comment (checked 2026-10-29).
  // The Spotted Cat, Marigny: the swing dancers' bar (guides and reviews: swing dancers fill the small floor
  // in front of the stage). Its calendar page draws this Bill's Gigulator feed by script: plain HTML with
  // dates (2pm, 6pm and 10pm sets, to 12/28 on 10/29). Gigulator has no robots.txt (404) and no terms page;
  // the feed is the venue's own published listing.
  {
    ...page("https://publish.billsgigulator.com/shows.html?site=1052&hdr=0", "The Spotted Cat", [
      "swing",
    ]),
    venueAddress: "623 Frenchmen St, New Orleans, LA 70116",
    venuePage: true,
    mixedCalendar: true,
    bandsForDancers: true,
  },
  // d.b.a., Marigny: brass, funk and Cajun bands; its Tuesday Louisiana Dance Hall Night (Nat & Kat Cajun
  // String Band) is billed as a packed dance floor. The same Gigulator feed (to 12/26 on 10/29).
  {
    ...page("https://publish.billsgigulator.com/shows.html?site=1048&hdr=0", "d.b.a.", []),
    venueAddress: "618 Frenchmen St, New Orleans, LA 70116",
    venuePage: true,
    mixedCalendar: true,
    bandsForDancers: true,
  },
  // Blue Nile, Marigny: funk and brass bands downstairs, a dance floor and DJs upstairs on the Balcony
  // (Reggae Night, Afrobeat NOLA). Squarespace events list (to 2027-01-01 on 10/29), Squarespace's default
  // robots.txt.
  {
    ...page("https://www.bluenilelive.com/calendar-tickets-", "Blue Nile", []),
    kind: "squarespace",
    platform: "squarespace",
    venueAddress: "532 Frenchmen St, New Orleans, LA 70116",
    venuePage: true,
    mixedCalendar: true,
    bandsForDancers: true,
  },
  // Clubs whose calendars mix dance parties with concerts, karaoke and trivia (mixedCalendar screens those;
  // not band bars). Dates in the HTML; robots.txt allows each page (checked 2026-10-29).
  // Republic NOLA, Warehouse District: Latin, reggaeton, banda and themed DJ parties (Punchis Banda Rave 11/7,
  // Gasolina 11/13) among concerts; dated to late November on 10/29. robots.txt asks Crawl-Delay 20.
  {
    ...page("https://republicnola.com/calendar/upcoming-shows/", "Republic NOLA", [
      "latin_club",
      "reggaeton",
      "dj_night",
    ]),
    venueAddress: "828 S Peters St, New Orleans, LA 70130",
    venuePage: true,
    mixedCalendar: true,
  },
  // The Maison, Marigny (508 Frenchmen): a weekly grid under "EVERY MONDAY" ... "EVERY SUNDAY" headings, no
  // dates (D-402): jazz and blues bands from 1pm, and "Dance Party w/ rotating DJs" at 11pm Fridays and
  // Saturdays. Its home page has no calendar text (the discovered home page read failed, coverage 10-29).
  // robots.txt disallows /feed/, /wp-admin/, /wp-content/ only (checked 2026-10-29).
  {
    ...page("https://maisonfrenchmen.com/music-calendar/", "The Maison", ["dj_night"]),
    venueAddress: "508 Frenchmen St, New Orleans, LA 70116",
    venuePage: true,
    mixedCalendar: true,
    weeklyGrid: true,
  },
  // Ohm Lounge, CBD (601 Tchoupitoulas): a DJ lounge; /events lists its weekly Friday (R&B, hip-hop, reggaeton)
  // and Saturday (open format, house, techno) nights and dated nights in text (Oct 31, Nov 7 on 10/30). DJ-bar
  // sweep (the owner 10-30: a bar's own weekly can count). robots.txt disallows /api/ and /studio only (checked 2026-10-30).
  {
    ...page("https://ohmlounge.com/events", "Ohm Lounge", ["dj_night"]),
    venueAddress: "601 Tchoupitoulas St, New Orleans, LA 70130",
    venuePage: true,
    weeklyGrid: true,
    // Its home page states its hours: "Friday - Saturday : 10:00 pm - Close", no closing time (D-519 C5).
    houseHours: {
      start: "22:00",
      days: [5, 6],
      checked:
        "ohmlounge.com home page: 'Monday - Thursday : Closed Friday - Saturday : 10:00 pm - Close Sunday : Closed' (2026-10-31)",
    },
  },
  // Oz, French Quarter (800 Bourbon): gay dance club; its home page writes this week's nights with dates
  // ("FRIDAY OCT. 30TH ... DJ ROBBIE CARRIEGAN 12AM") among drag shows, comedy and bingo. DJ-bar sweep 10-30.
  // robots.txt blocks /api, /config, /search only (checked 2026-10-30).
  {
    ...page("https://www.ozneworleans.com/", "Oz", ["queer_party", "dj_night"]),
    venueAddress: "800 Bourbon St, New Orleans, LA 70116",
    venuePage: true,
    onlyHere: true,
    mixedCalendar: true,
  },
  // Oz's weekly page: its nights under weekday headings (MONDAY ... SUNDAY, no dates), with its Friday and
  // Saturday DJ dance nights ("Freaky fridays 2.0 ... ROTATING DJ'S every week"; "DANCE BITCHES DANCE! ... rotating
  // guest DJs ... starting @ 10pm") among karaoke, talent night, drag shows and comedy. Coverage check of read
  // 41041908489: the home page's dated lines read as drag shows only. Same robots.txt as above (checked 2026-10-30).
  {
    ...page("https://www.ozneworleans.com/events", "Oz", ["queer_party", "dj_night"]),
    venueAddress: "800 Bourbon St, New Orleans, LA 70116",
    venuePage: true,
    onlyHere: true,
    mixedCalendar: true,
    weeklyGrid: true,
    // The Saturday block states the dance night after the 8pm drag shows: "DANCE BITCHES DANCE! Dance the night
    // away at New Orleans' #1 Gay Dance Club with rotating guest DJs ... starting @ 10pm" (D-527: own site says
    // dance). The model read keeps only "Let it Whip" for Saturday (D-524 gap #9, 2026-11-01).
    fixedNights: [
      {
        title: "Dance Bitches Dance!",
        line: "Gay Dance Club with rotating guest DJs",
        days: [6],
        start: "22:00",
        danceCited:
          "own site, https://www.ozneworleans.com/events: 'Dance the night away at New Orleans #1 Gay Dance Club with rotating guest DJs ... starting @ 10pm' (2026-11-01)",
      },
    ],
  },
  // Santos Bar, French Quarter: weekly goth and darkwave dance nights (Chambre Noir Wednesdays, Resurrection
  // Goth Night) among punk shows and karaoke. Its calendar page is script-drawn; the home page lists the
  // dates (to 11/13 on 10/29).
  // danceNights: checked by the New Orleans lead 2026-10-29 (D-264).
  {
    ...page("https://www.santosbar.com/", "Santos Bar", ["retro", "dj_night"]),
    venueAddress: "1135 Decatur St, New Orleans, LA 70116",
    venuePage: true,
    mixedCalendar: true,
    danceNights: ["Chambre Noir", "Resurrection Goth Night"],
  },
  // The National WWII Museum, Warehouse District: occasional "Dine & Dance" nights with its Victory Swing
  // Orchestra at BB's Stage Door Canteen (10/31 5:30pm on 10/30), among shows, lectures and storytime; dates
  // in the HTML ("10/31/2026 | 5:30 pm"). Second research pass 10-30. robots.txt blocks /search/ only.
  {
    ...page("https://www.nationalww2museum.org/events/events-calendar", "BB's Stage Door Canteen", [
      "swing",
    ]),
    venueAddress: "945 Magazine St, New Orleans, LA 70130",
    venuePage: true,
    mixedCalendar: true,
  },
  // Twelve Mile Limit, Mid-City: a monthly Heatwave dance party (11/14) among weekly karaoke, trivia, bingo
  // and comedy; dated to 12/02 on 10/29.
  // danceNights: checked by the New Orleans lead 2026-10-29 (D-264).
  {
    ...page("https://twelvemilelimit.com/events", "Twelve Mile Limit", ["dj_night"]),
    venueAddress: "500 S Telemachus St, New Orleans, LA 70119",
    venuePage: true,
    mixedCalendar: true,
    danceNights: ["Heatwave"],
  },
  // Dance and party organisers that sell their New Orleans nights on Eventbrite, read by organiser
  // ID; found 2026-10-29 from Eventbrite's public event pages, each with New Orleans nights that day.
  eventbrite(
    "https://www.eventbrite.com/o/wednesday-night-shuffle-121706417765",
    "Wednesday Night Shuffle (Eventbrite)",
    ["swing", "lindy_hop"],
  ),
  eventbrite(
    "https://www.eventbrite.com/o/sexyprodz-entertainment-sakapfet-nola-12354610103",
    "Afro Konpa NOLA (Eventbrite)",
    ["kompa"],
  ),
  eventbrite(
    "https://www.eventbrite.com/o/jeez-loueez-26351106517",
    "Jeez Loueez: Rhinestone Cowpoke (Eventbrite)",
    ["line_dance", "queer_party"],
  ),
  eventbrite("https://www.eventbrite.com/o/ohm-lounge-75597392223", "Ohm Lounge (Eventbrite)", [
    "dj_night",
  ]),
  eventbrite("https://www.eventbrite.com/o/larry-morrow-80057314663", "Larry Morrow (Eventbrite)", [
    "dj_night",
  ]),
  eventbrite(
    "https://www.eventbrite.com/o/larry-morrow-80080465593",
    "Larry Morrow, Hide/Seek (Eventbrite)",
    ["dj_night"],
  ),
  // Three organisers with dance nights at the Dew Drop Inn, Central City (coverage, 2026-10-29: 2+ this year).
  // Shamarr Allen's Ratchet Jazz parties (Halloween Bash 10/30) sit among his concerts and out-of-town dates;
  // the organiser screen (mixedCalendar) and the metro bounds handle those.
  eventbrite(
    "https://www.eventbrite.com/o/shamarr-allen-17243934462",
    "Shamarr Allen: Ratchet Jazz (Eventbrite)",
    ["bounce", "dj_night"],
  ),
  eventbrite("https://www.eventbrite.com/o/wanna-kiss-121732629975", "Wanna Kiss?! (Eventbrite)", [
    "queer_party",
    "dj_night",
  ]),
  eventbrite("https://www.eventbrite.com/o/dj-jess-51965106153", "DJ Jess (Eventbrite)", [
    "retro",
    "dj_night",
  ]),
  // The Rabbit Hole, Central City (1228 Oretha Castle Haley Blvd): its own organiser, so one venue's calendar.
  // A band bar from 9pm (D-341, D-322; the owner, 2026-10-29): Rebirth Brass Band's Tuesday residency (10pm)
  // is a dance night (OffBeat, "Rebirth Brass Band back on Tuesdays"; club listings call it a dance party).
  {
    ...eventbrite(
      "https://www.eventbrite.com/o/the-rabbit-hole-58751661813",
      "The Rabbit Hole (Eventbrite)",
      ["disco", "dj_night"],
    ),
    bandsForDancers: true,
    bandsForDancersFrom: "21:00",
  },
  eventbrite(
    "https://www.eventbrite.com/o/the-metropolitan-17434213154",
    "The Metropolitan (Eventbrite)",
    ["dj_night"],
  ),
  eventbrite(
    "https://www.eventbrite.com/o/herewego-entertainment-big-stan-productions-red-carpet-events-17460744583",
    "Big Stan Productions (Eventbrite)",
    ["dj_night"],
  ),
  // Cafe Negril, Marigny (606 Frenchmen St): its own organiser. A band bar from 9pm (D-341, D-322; the owner,
  // 2026-10-29): reggae, funk and brass bands to a full dance floor (Frenchmen Street guides); its earlier
  // jams and afternoon sets stay screened.
  {
    ...eventbrite(
      "https://www.eventbrite.com/o/cafe-negril-on-frenchmen-9843656610",
      "Cafe Negril (Eventbrite)",
      [],
    ),
    bandsForDancers: true,
    bandsForDancersFrom: "21:00",
  },
  // DanceUS's New Orleans salsa calendar (D-343): its owner said yes to our reading it (the owner, 2026-10-29); its
  // terms (2.1) otherwise forbid reuse. robots.txt allows /events/ (checked 2026-10-29). A directory of
  // salsa socials and workshops with their start times in the page text; New Orleans has no other DanceUS
  // style calendar (bachata, tango, swing and the rest 404).
  {
    ...directory(
      "https://www.danceus.org/events/salsa/new-orleans-la-salsa-calendar/",
      "DanceUS New Orleans salsa",
      ["salsa", "bachata"],
    ),
    mixedCalendar: true,
  },
  // WWOZ Livewire (D-342): the city's music calendar, one page a night, every venue's gigs. WWOZ said yes to
  // our reading it (the owner, 2026-10-29); robots.txt allows /calendar/ with Crawl-delay 10. A directory: a band
  // billing counts as live music with dancing only at the dance floors below, or when its title names a
  // dance-band kind (brass band, zydeco, Cajun...) away from the seated rooms. Read by the `wwoz` adapter.
  {
    ...directory("https://www.wwoz.org/calendar/livewire-music", "WWOZ Livewire", []),
    kind: "jsonld",
    platform: "wwoz",
    mixedCalendar: true,
  },
  // Out x Out New Orleans: LGBTQ+ events directory, read daily with its written yes (D-545, the owner 2026-10-31); its
  // Terms of Service otherwise bar scrapers and aggregation. robots.txt allows /events/. schema.org Events in a
  // JSON-LD ItemList on the page (10 on 2026-11-01: drag shows and brunches, bingo, the Halloween New Orleans tea
  // dance and second line), hence the mixed-calendar screen.
  {
    ...directory("https://outxout.com/events/new-orleans-la", "Out x Out New Orleans", [
      "queer_party",
    ]),
    kind: "jsonld",
    mixedCalendar: true,
  },
  // LeLa Saint (The Saint), Lower Garden District (961 St Mary St): no site of its own; its ma.to venue page carries
  // its dated nights as schema.org Events (DJ dance parties, karaoke, rock nights; 12 on 2026-11-01), read like
  // Miami's ma.to bar pages. robots.txt allows / for all agents (checked 2026-11-01). Mixed: karaoke and happy hours
  // are screened (D-524 gap #34).
  {
    ...directory("https://ma.to/venue/saintbarnola", "LeLa Saint (ma.to)", ["dj_night"]),
    mixedCalendar: true,
  },
  // WWOZ "Takin' It to the Streets" (D-556): the second-line parade season (social aid & pleasure clubs, Sundays
  // Aug-June), each parade's own WWOZ page linked from the programme page, read under WWOZ's yes (D-342); robots.txt
  // allows /programs/ and /events/ for all agents, Crawl-delay 10. Daytime counts (D-552); placed at the route's start.
  {
    ...directory("https://www.wwoz.org/programs/inthestreet", "WWOZ Takin' It to the Streets", [
      "second_line",
    ]),
    kind: "jsonld",
    platform: "wwoz_streets",
  },
];

/** Starting addresses retired, each with the reason (D-047). */
export const NEW_ORLEANS_RETIRED: readonly RetiredSource[] = [
  // Found by discovery; both read 0 on the first two full reads (runs 40890379894 and 40918184272, 2026-10-29).
  {
    url: "https://thejoytheater.com/shows/",
    reason:
      "the Joy Theater's concert calendar: seated and standing concerts, no dance nights, 0 rows on two full reads; WWOZ Livewire lists its gigs (D-342)",
  },
  {
    url: "https://www.themetronola.com/",
    reason:
      "The Metropolitan's site: its calendar feed held no events on two full reads; its club nights come from its Eventbrite organiser (The Metropolitan (Eventbrite))",
  },
  // Found by discovery; each failed on every read through 2026-11-02 (run 41476751631). The six Events Calendar
  // sites' REST API held 0 upcoming events on 2026-11-02 and their pages list no dated nights.
  {
    url: "https://cafenegrilnola.com/",
    reason:
      "Cafe Negril's site: its events calendar is empty (0 upcoming, 2026-11-02) and the page says only 'show times vary'; its nights come from its Eventbrite organiser (Cafe Negril (Eventbrite))",
  },
  {
    url: "http://palmcourtjazzcafe.com/",
    reason:
      "the Palm Court Jazz Cafe's site: a seated dinner-jazz room (dining 7pm, music 7:30-10:30pm), its events calendar empty (0 upcoming, 2026-11-02)",
  },
  {
    url: "https://fritzelsjazz.com/",
    reason:
      "Fritzel's Jazz Club's site: a seated jazz bar (WWOZ_SEATED), its events calendar says 'No Events' for November and December (2026-11-02); WWOZ Livewire lists its gigs (D-342)",
  },
  {
    url: "https://salonsalonnola.com/",
    reason:
      "Salon Salon's site: its events calendar is empty (0 upcoming, 2026-11-02) and its pages list no dated nights",
  },
  {
    url: "https://calendar.nolaeast.com/events/",
    reason:
      "the New Orleans East community calendar: empty (0 upcoming, 2026-11-02), every read failed",
  },
  {
    url: "https://www.dillard.edu/partner-with-us/research-centers/center-for-racial-justice/",
    reason:
      "Dillard University's Center for Racial Justice page: a university research centre, its events calendar empty (0 upcoming, 2026-11-02)",
  },
  {
    url: "https://snugjazz.com/",
    reason:
      "Snug Harbor's site: a seated jazz room (WWOZ_SEATED); its events API answered 404 (2026-11-02); WWOZ Livewire lists its gigs (D-342)",
  },
  {
    url: "https://www.nous-foundation.org/",
    reason: "the Nous Foundation's site answered 404 on the reads of 2026-11-01 and 2026-11-02",
  },
];

/** A WWOZ venue where people dance to the bands, with the evidence (D-341, D-342). */
export interface WwozDanceFloor {
  /** Local "HH:MM" from which a band billing there counts as dancing; absent: all day. */
  from?: string;
  evidence: string;
}

/** WWOZ Livewire venues (keyed by the /organizations/<slug> in WWOZ's links) whose band gigs are dancing. */
export const WWOZ_DANCE_FLOORS: Readonly<Record<string, WwozDanceFloor>> = {
  // the owner (2026-10-29): Spotted Cat lists all sets, the 2pm ones included.
  "spotted-cat": {
    evidence: "the swing dancers' bar: dancers fill the floor in front of the stage (D-341)",
  },
  dba: { evidence: "d.b.a.'s band nights are dance nights on Frenchmen (D-341, #342)" },
  "blue-nile": { evidence: "Blue Nile: funk and brass dance nights downstairs (D-341, #342)" },
  "blue-nile-balcony-room": {
    from: "21:00",
    evidence:
      "Blue Nile's upstairs room: late DJs and dance nights (Gambit bar guide; Afrobeats on Frenchmen)",
  },
  "cafe-negril": {
    from: "21:00",
    evidence:
      "weekend evenings the tables are crowded out by dancers (Frenchmen guides; the owner 2026-10-29)",
  },
  "rabbit-hole": {
    from: "21:00",
    evidence: "brass band and disco dance nights (the owner 2026-10-29, #370)",
  },
  "mid-city-lanes-rock-n-bowl": {
    evidence: "Rock 'n' Bowl: a dance hall, zydeco and swing dancers on the floor every band night",
  },
  "maple-leaf": {
    // From 7pm: its 8pm sets (Sunpie & the Louisiana Sunspots' zydeco, funk trios) draw dancers too.
    from: "19:00",
    evidence:
      "a small dance floor where people sweat to the bands (Lonely Planet; Rebirth Tuesdays)",
  },
  "vaughans-lounge": {
    from: "21:00",
    evidence:
      "Thursday nights you end up dancing to Corey Henry & the Treme Funktet (The Infatuation)",
  },
  bamboulas: {
    from: "21:00",
    evidence: "WWOZ's own listing: dance the night away to the best local bands",
  },
};

/**
 * WWOZ venues where people sit and listen (concert halls, theatres, museums, hotel lounges, a steamboat): a
 * dance-band kind in a title there is not dancing. A title naming a dance is still kept (D-342).
 */
export const WWOZ_SEATED: ReadonlySet<string> = new Set([
  "preservation-hall",
  "snug-harbor",
  "fritzels-jazz-club",
  "mahogany-jazz-hall",
  "saenger-theatre",
  "civic-theatre",
  "joy-theater",
  "double-dealer-orpheum-theater",
  "mahalia-jackson-theater-performing-arts",
  "new-marigny-theatre",
  "lsu-new-orleans-lakefront-arena",
  "lsu-new-orleans-performing-arts-center-recital-hall",
  "ellis-marsalis-center-music",
  "new-orleans-jazz-museum",
  "new-orleans-jazz-national-historical-park",
  "new-orleans-storyville-museum",
  "ogden-museum-southern-art",
  "nola-nacular-art-gallery",
  "steamboat-natchez",
  "davenport-lounge-ritz-carlton",
  "polo-club-windsor-court",
  "peacock-room-kimpton-hotel-fontenot",
  "carousel-bar-lounge-hotel-monteleone",
  "lobby-lounge-jw-marriott",
  "chemin-la-mer-four-seasons-hotel",
  "bayou-bar-pontchartrain",
  "twilight-room-allways-lounge",
  "streaming-only",
]);
