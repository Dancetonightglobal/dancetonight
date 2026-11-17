// Barcelona's starting sources (D-360). EU rules (D-034): official APIs and public pages only, robots.txt
// honoured, no unofficial endpoint without the operator's written consent; Resident Advisor, Facebook and
// Instagram never. Catalan and Spanish screen words ship (coverage, listing-screen.ts) before any venue page.
// The Ajuntament's open-data agenda is read by its own adapter (bcn_agenda, #355), not listed here.

import { DICE_GENRES, diceSources } from "@/config/sources/dice";
import type { RetiredSource, SeedSource } from "@/config/sources/nyc";
import type { StyleKey } from "@/config/styles";

// DICE's Barcelona browse pages (the owner read DICE's terms, D-197; Barcelona answered "A", D-360).
export const DICE_BROWSE = "https://dice.fm/browse/barcelona-5d8cefe1e3e6e374e99e8cbe/music";

/**
 * The DICE genre pages that list Barcelona nights (second full read, run 40926975873, 2026-10-29): the other
 * DJ and Party genre pages wrote nothing, or 1-2 rows the DJ and Party pages already list; an empty one answers
 * a redirect to the gig list.
 */
const BARCELONA_DICE_GENRES = new Set([
  "dj/house",
  "dj/deephouse",
  "dj/techno",
  "party/house",
  "party/pop",
  "party/reggaeton",
]);

const directory = (url: string, label: string, styles: StyleKey[]): SeedSource => ({
  url,
  kind: "html",
  trustTier: "directory",
  styles,
  label,
});

/** A directory that also lists bar crawls, boat parties and shows: screened (D-321, D-361). */
const mixedDirectory = (url: string, label: string, styles: StyleKey[]): SeedSource => ({
  ...directory(url, label, styles),
  mixedCalendar: true,
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

export const BARCELONA_SOURCES: readonly SeedSource[] = [
  ...diceSources(
    DICE_BROWSE,
    "Barcelona",
    DICE_GENRES.filter(([path]) => BARCELONA_DICE_GENRES.has(path)),
  ),
  // Salsa Vida's Barcelona guide: schema.org Events on the page (20 on 10/29: Sala Vivaldi on Tuesdays, Seven
  // Dance's "Jueves de Bachata", Antilla, Dio Club; robots.txt allows it, checked 2026-10-29). Read as a
  // directory (D-321). Its Santa Susanna rows are outside the Barcelonès.
  directory(
    "https://www.salsavida.com/guides/spain/catalunya/barcelona/barcelona-city/",
    "Salsa Vida Barcelona",
    ["salsa", "bachata"],
  ),
  // Meetup group's iCalendar feed (10 events on 10/29: Sala Vivaldi's Tuesday and Thursday "Salsa vs Bachata"
  // socials, Saturday and Sunday free class + social, Wednesday bachata; term courses too, hence the screen).
  // robots.txt allows /events/ical/.
  meetup("free-salsa-bachata-masterclass", "Free Salsa & Bachata Masterclass (Meetup)", [
    "salsa",
    "bachata",
  ]),
  // More Meetup groups' iCalendar feeds, found by the research sweep (D-249): each lists weekly socials (feeds read
  // 2026-10-29: "Salsa & Bachata Workshop & Social Dance Party", Gràcia Latina's free class + social and live salsa,
  // "Salsa & Bachata Party", Parkchata's outdoor bachata social). Classes and workshops are screened as on the first.
  // Every event is at Gaby's Club (Meetup event pages' venue, 2026-10-29).
  {
    ...meetup("FunSalsaBachataBarcelona", "Fun Salsa Bachata Barcelona (Meetup)", [
      "salsa",
      "bachata",
    ]),
    venueAddress: "Carrer de Topazi 24, 08012 Barcelona",
  },
  // Every event is at Gràcia Latina (Meetup event pages' venue, 2026-10-29).
  {
    ...meetup("gracia-latina-barcelona-salsa-dance-group", "Gràcia Latina (Meetup)", [
      "salsa",
      "bachata",
    ]),
    venueAddress: "Carrer de l'Or 19, 08012 Barcelona",
  },
  // Every event is at Sabor Cubano / El Sabor, Gràcia (Meetup event pages' venue, 2026-10-29).
  {
    ...meetup("grupo-de-meetup-en-barcelona-de-baile-social", "Baile social Barcelona (Meetup)", [
      "salsa",
      "bachata",
    ]),
    venueAddress: "Carrer de Francisco Giner 32, 08012 Barcelona",
  },
  meetup("barcelona-bachata-and-salsa-dance-lessons", "Barcelona Bachata and Salsa (Meetup)", [
    "salsa",
    "bachata",
  ]),
  // Antilla Salsa, Sants-Montjuïc: the club's own site, schema.org Events (salsa, timba and bachata nights, Fri
  // and Sun). Its address moved from Carrer d'Aragó; Salsa Vida gives Carrer d'Alcolea 100, 08014 (2026-10-29).
  // Not mixed: every night on it is a dance night.
  {
    url: "https://antillasalsa.com/",
    kind: "jsonld",
    trustTier: "first_party",
    styles: ["salsa", "bachata"],
    label: "Antilla Salsa Barcelona",
    venuePage: true,
    onlyHere: true,
    venueAddress: "Carrer d'Alcolea 100, 08014 Barcelona",
  },
  // BCNswing's The Events Calendar iCalendar export (swing socials, jams and classes, hence the screen).
  // robots.txt asks Crawl-delay 60 and Wordfence limits an address after a few quick requests (2026-10-29):
  // one feed read a day only, never the event pages.
  {
    url: "https://www.bcnswing.org/mogudes/",
    kind: "feed_ics",
    feedUrl: "https://www.bcnswing.org/mogudes/?ical=1",
    trustTier: "first_party",
    styles: ["lindy_hop", "swing"],
    label: "BCNswing",
    mixedCalendar: true,
    // Its Barcelona swing jams are dance socials; the music-jam screen dropped both (read 41284857494, D-720).
    danceNights: ["La Gràcia Swing Jam", "Power Jam de Swing"],
  },
  // Moog, Raval: the techno club's own The Events Calendar iCalendar export (30 events on 2026-10-29; robots.txt
  // allows /esdeveniments/). Its events carry no LOCATION, so the venue is this page (full read of 2026-10-29:
  // 14/14 unplaced). Not mixed: every event is a club night.
  {
    url: "https://moogbarcelona.com/esdeveniments/",
    kind: "feed_ics",
    feedUrl: "https://moogbarcelona.com/esdeveniments/?ical=1",
    trustTier: "first_party",
    styles: ["club"],
    label: "Moog Barcelona",
    venuePage: true,
    venueAddress: "Carrer de l'Arc del Teatre 3, 08002 Barcelona",
  },
  // Jamboree, Plaça Reial 17 (Gòtic): its The Events Calendar iCalendar export (30 events on 2026-10-29, each
  // with a postcode in LOCATION; robots.txt allows it). Nightly "Disco" club sessions plus jazz concerts, hence
  // the screen; it keeps the odd forró, swing or salsa night. One feed read a day, never the event pages.
  {
    url: "https://jamboreejazz.com/events/",
    kind: "feed_ics",
    feedUrl: "https://jamboreejazz.com/events/?ical=1",
    trustTier: "first_party",
    styles: ["club", "hip_hop_club", "dancehall"],
    label: "Jamboree Barcelona",
    mixedCalendar: true,
  },
  // SomSardana, the Confederació Sardanista de Catalunya's agenda (D-363): every public sardana dance ("ballada")
  // in Catalonia, filtered to the city of Barcelona (about one a week at Pla de la Catedral on 2026-10-30, beside
  // cobla concerts). No robots.txt (404) and a legal notice with no reuse clause (checked 2026-10-30). Unfiltered
  // by date, the page shows the next four days. Concerts are screened; the titles below are its dance sessions.
  {
    ...directory(
      "https://somsardana.cat/sardanisme/agenda?location=poblacio-5",
      "SomSardana Barcelona",
      ["folk"],
    ),
    // Pinned to plain HTML: on 2026-10-30 the probe took one cobla's Google Calendar from the page's
    // script data (2 wrong rows); the page embeds no calendar.
    platform: "probed",
    mixedCalendar: true,
    danceNights: [
      "Ballada de sardanes",
      "Doble ballada de sardanes",
      "Ballada de sardanes de Nadal",
    ],
  },
  // SomSardana's Badalona agenda (location poblacio-3 in the page's own municipality list, 2026-10-30): about one
  // ballada a month (2 in Sep-Oct 2026). Read, pinned and screened as Barcelona's above.
  {
    ...directory(
      "https://somsardana.cat/sardanisme/agenda?location=poblacio-3",
      "SomSardana Badalona",
      ["folk"],
    ),
    platform: "probed",
    mixedCalendar: true,
    danceNights: [
      "Ballada de sardanes",
      "Doble ballada de sardanes",
      "Ballada de sardanes de Nadal",
    ],
  },
  // La Deskomunal (Sants), a cooperative venue: club nights (LaBulla, Araña Club) beside concerts. Discovery
  // found it as JSON-LD, whose startDate is date-only (10 of 10 untimed, run 40989034082). Its Modern Events
  // Calendar RSS feed gives each night's start (mec:startHour, D-367). robots.txt allows everything (2026-10-30).
  // Concerts are screened. The feed names no place: every night is at its night entrance (its home page, 2026-10-30).
  {
    url: "https://ladeskomunal.coop/",
    feedUrl: "https://ladeskomunal.coop/agenda/feed/",
    kind: "jsonld",
    platform: "mec_rss",
    trustTier: "first_party",
    styles: ["club"],
    label: "La Deskomunal",
    mixedCalendar: true,
    venueAddress: "Carrer de la Riera d'Escuder 38, 08028 Barcelona",
  },
  // DanceUS's Barcelona salsa calendar (D-364): the owner said DanceUS's written yes covers Barcelona (2026-10-30);
  // its terms (2.1) otherwise forbid reuse. robots.txt allows /events/ (checked 2026-10-30). About 20 weekly socials
  // a week across the province (Antilla's Wednesdays, Habana Barcelona, Bailongu, Dio Club, Esencia at Sarau); rows
  // outside the Barcelonès (Cerdanyola, Sabadell, Terrassa, Castelldefels) are left out by place. Start times are in
  // the page text, not its JSON-LD, so it is read as html. Its other style calendars (bachata, kizomba, zouk, swing,
  // tango) 404 for Barcelona.
  {
    url: "https://www.danceus.org/events/salsa/barcelona-spain-salsa-calendar/",
    kind: "html",
    trustTier: "directory",
    styles: ["salsa", "bachata"],
    label: "DanceUS Barcelona salsa",
    mixedCalendar: true,
  },
  // Xceed's Barcelona listing: club nights with schema.org Events on the page and ~42 event links
  // (2026-10-29). robots.txt allows it. The owner read Xceed's terms (https://xceed.me/en/tos) and said yes
  // (D-361). Its event pages are followed (jsonld_items, 2026-10-30).
  {
    ...mixedDirectory("https://xceed.me/en/barcelona/events", "Xceed Barcelona", ["club"]),
    kind: "jsonld",
    platform: "jsonld_items",
  },
  // Fever's Barcelona nightlife page: 29 items on 10/29, club nights and open-air parties beside bar crawls,
  // boat parties and pub tours, hence the screen. robots.txt allows it; the owner read Fever's terms
  // (https://feverup.com/legal/terms_en.html) and said yes (D-361). Its /m/ event pages are followed
  // (jsonld_items): their inline plan data gives each night's venue, point and session time (2026-10-30).
  {
    ...mixedDirectory(
      "https://feverup.com/en/barcelona/nightlife-clubs",
      "Fever Barcelona nightlife",
      ["club"],
    ),
    kind: "jsonld",
    platform: "jsonld_items",
  },
  // Eventbrite organisers found by the research sweep (D-249), each with dated Barcelona nights on its page
  // (2026-10-29). Mixed: the screen drops their workshops, karaoke and concerts.
  eventbrite("https://www.eventbrite.es/o/60259674523", "El Sabor Cubano (Eventbrite)", [
    "salsa",
    "bachata",
  ]),
  eventbrite(
    "https://www.eventbrite.es/o/53364765663",
    "Barcelona International Social (Eventbrite)",
    ["salsa", "bachata", "dj_night"],
  ),
  // Second research pass (2026-10-30, forums and press; private notes), D-369.
  // Swing Maniacs' jams: lindy hop, blues, West Coast and rock'n'roll socials (~57 to December), with dates and
  // times on the list; workshops beside them are screened. The list names no place: nearly every jam is at its
  // hall, Roger de Flor 291 (an outdoor jam on Passeig de Sant Joan is the exception). No robots.txt (2026-10-30).
  {
    url: "https://jams.swingmaniacs.com/",
    kind: "html",
    trustTier: "first_party",
    styles: ["lindy_hop", "blues", "west_coast_swing", "boogie_woogie"],
    label: "Swing Maniacs jams",
    venueAddress: "Carrer de Roger de Flor 291, 08025 Barcelona",
    mixedCalendar: true,
    // Its jams are swing dance socials; the music-jam screen dropped all 42 a week (read 41180676482, D-379).
    danceNights: [
      "Blues Jam!",
      "Classic Jam!",
      "Fast Jam!",
      "Beginners Jam!",
      "Friday Jam!",
      "Super Jam!",
      "Swing Jam al Passeig de Sant Joan!",
      "Swing Jam de Tranquis!",
    ],
  },
  // Dio Club (Seven Dance), Gràcia: salsa and bachata nights in two rooms; its page lists the next ~6 nights with
  // times (Fri and Sat 23:00-03:00, Sun 18:00-22:00). robots.txt allows everything (2026-10-30).
  {
    url: "https://www.sevendance.com/es/dio-club",
    kind: "html",
    trustTier: "first_party",
    styles: ["salsa", "bachata"],
    label: "Dio Club",
    venueAddress: "Carrer del Perill 10, 08012 Barcelona",
    venuePage: true,
    // Its cards give "BCN Gràcia" alone as the place on some nights (D-373).
    onlyHere: true,
  },
  // Ocaña, Plaça Reial: "Ocaña de Rumba" every Thursday, funk and soul bands on Fridays.
  eventbrite("https://www.eventbrite.es/o/96768207773", "Ocaña (Eventbrite)", ["rumba"]),
  eventbrite("https://www.eventbrite.es/o/26919582185", "MUV at Marula Café (Eventbrite)", [
    "dj_night",
  ]),
  eventbrite("https://www.eventbrite.es/o/114282761401", "EMD Studio salsa (Eventbrite)", [
    "salsa",
  ]),
  eventbrite("https://www.eventbrite.es/o/102055022221", "NEO (Eventbrite)", ["afrobeats_club"]),
  eventbrite("https://www.eventbrite.es/o/121807209402", "Nyahbingi Sound (Eventbrite)", [
    "dancehall",
  ]), // DJ dance bars' own sites (owner, 2026-10-30: "capture DJ dance bars, not just ticketed club nights"; a bar's
  // own weekly schedule counts). Sweep of 22 bars: private notes; most have no site of their own.
  // Marula Café, Gòtic: a free-before-00:30 DJ bar. Its agenda lists MARULA CLUB DJ nights beside concerts and
  // jam sessions, with dates only; each /evento/ page's MusicEvent JSON-LD gives the start (D-275). robots.txt
  // disallows /wp-admin/ only (checked 2026-10-30).
  // Its agenda has ~20 untimed nights a window, so it reads up to 24 event pages, not 8 (one a 5 s, D-374).
  {
    url: "https://marulacafe.com/agenda/",
    kind: "html",
    trustTier: "first_party",
    styles: ["dj_night"],
    label: "Marula Café",
    venueAddress: "Carrer dels Escudellers 49, 08002 Barcelona",
    venuePage: true,
    // Its cards name the room or night ("MARULA CLUB"), never another place (D-373).
    onlyHere: true,
    mixedCalendar: true,
    eventPageTimes: true,
    eventPageTimesLimit: 24,
  },
  // Ocaña, Plaça Reial: its live-music page gives a fixed weekly grid with no dates. Tuesdays "La Clave" (latin
  // jazz and salsa, then a DJ set "para seguir bailando") and Fridays "Noches de Soul & Funk" (bands, then DJs)
  // are dance nights; the rumba, Balkan and jazz concerts are screened. robots.txt allows it (2026-10-30).
  {
    url: "https://www.ocana.cat/live-music/",
    kind: "html",
    trustTier: "first_party",
    styles: ["salsa", "dj_night"],
    label: "Ocaña",
    venueAddress: "Plaça Reial 13-15, 08002 Barcelona",
    venuePage: true,
    // Its grid names its rooms ("Apotheke", "Café", "Club") as the place (D-373).
    onlyHere: true,
    mixedCalendar: true,
    weeklyGrid: true,
    danceNights: ["La Clave", "Noches de Soul & Funk"],
  },
  // Bailongu (Eixample dreta), a dance school: Sunday socials 19-22h (Salsongu-bachatongu, Bailongu Ball, Bailongu
  // Rock, Son cubà, Sevillanes), €10, entry with the free Bailongu card. Monthly agenda pages /agenda/YYYY-M read by
  // the bailongu reader (D-375); workshops, course notices and street events are screened. robots.txt allows /agenda
  // (checked 2026-10-30).
  {
    url: "https://www.bailongu.com/agenda",
    kind: "jsonld",
    platform: "bailongu",
    trustTier: "first_party",
    styles: ["salsa", "bachata", "ballroom"],
    label: "Bailongu",
    venueAddress: "Passatge d'Utset 11-13, 08013 Barcelona",
  },
  // Arena Xperience (Grupo Arena), Ronda de Sant Pere 19-21, Eixample: an LGBTQ+ disco whose own home page lists
  // every night for weeks ahead, named and dated ("Lunes 02 Nov TU PELUCA ME SUENA", "Martes 03 Nov SENSUAL
  // NIGHT"); no times printed. robots.txt is absent (404); its aviso legal forbids reproducing content, and we store
  // facts and our own summaries only (checked 2026-11-01, D-378). Address: its footer and Time Out.
  {
    url: "https://arenadisco.com/",
    kind: "html",
    trustTier: "first_party",
    styles: ["dj_night", "queer_party"],
    label: "Arena Xperience",
    venueAddress: "Ronda de Sant Pere 19-21, 08010 Barcelona",
    venuePage: true,
    onlyHere: true,
  },
  // Shôko, Port Olímpic: its events collection lists each night with weekday and date ("Monday, 2.11.2026 FUCKING
  // MONDAY BY SHÔKO MONDAZE"). robots.txt disallows only cart/checkout/admin paths; its terms speak only of
  // personal data (checked 2026-11-01, D-378). Some nights bill a live artist: screened as a mixed calendar.
  {
    url: "https://shoko.biz/collections/eventos-shoko-barcelona",
    kind: "html",
    trustTier: "first_party",
    styles: ["dj_night", "reggaeton"],
    label: "Shôko",
    venueAddress: "Passeig Marítim de la Barceloneta 36, 08005 Barcelona",
    venuePage: true,
    onlyHere: true,
    mixedCalendar: true,
  },
  // Otto Zutz, Sant Gervasi: its home page lists its dated nights (Event JSON-LD with startDate). robots.txt
  // (Wix) blocks only lightbox/partials paths for all agents (checked 2026-11-01, D-378). Concerts are screened.
  {
    url: "https://www.ottozutz.com/",
    kind: "html",
    trustTier: "first_party",
    styles: ["dj_night"],
    label: "Otto Zutz",
    venueAddress: "Carrer de Lincoln 15, 08006 Barcelona",
    venuePage: true,
    onlyHere: true,
    mixedCalendar: true,
  },
  // Luz de Gas, Sant Gervasi: its "Próximos Eventos" list dates and times every night ("IYKYK ... Mié 28 de
  // octubre 23:58h hasta 05:00h", "MIMUS Jue 29 de octubre 23:59h"); we only had its Saturday. robots.txt
  // disallows /wp-admin/ only; its aviso legal forbids reproducing content, and we store facts only (checked
  // 2026-11-01, D-378). Afternoon "tardeo" and drag shows sit beside the club nights: a mixed calendar.
  {
    url: "https://luzdegas.com/es/",
    kind: "html",
    trustTier: "first_party",
    styles: ["dj_night"],
    label: "Luz de Gas",
    venueAddress: "Carrer de Muntaner 246, 08021 Barcelona",
    venuePage: true,
    onlyHere: true,
    mixedCalendar: true,
  },
  // Ku Barcelona, Barceloneta: its home page's "Weekly Agenda" prints only Monday without JavaScript ("Monday Vibra @
  // Main Room Reggaeton | Afrobeat | Hip-Hop | R&B"); the other days and /events load by script, and its Xceed
  // venue page is script-loaded too. Listed as a fixed weekly night only while that line stays on the page.
  // robots.txt allows all (checked 2026-11-01, D-378).
  {
    url: "https://www.kubarcelona.com/",
    kind: "html",
    trustTier: "first_party",
    styles: ["reggaeton", "afrobeats_club"],
    label: "Ku Barcelona",
    venueAddress: "Passeig de la Barceloneta 38, 08003 Barcelona",
    venuePage: true,
    onlyHere: true,
    fixedNights: [
      {
        title: "Vibra",
        line: "Monday Vibra @ Main Room",
        days: [1],
        start: null,
        styles: ["reggaeton", "afrobeats_club"],
        danceCited:
          "kubarcelona.com home page: weekly agenda 'Monday Vibra @ Main Room', and 'the dance floor a universal language' (checked 2026-11-01)",
      },
    ],
  },
  // Dom Lis, ecstatic dance (D-573, ecstaticdance.org lead): its own page lists each dated session with its place, most
  // at Espai Viceversa, Passeig de Sant Joan 30 (Eixample); sessions in l'Empordà are left out by place. robots.txt
  // allows /bailar/ (2026-11-02). Times are not on the page (the directory says Fridays 18:00-20:00), so rows are untimed.
  {
    url: "https://domlis.es/bailar/",
    kind: "html",
    trustTier: "first_party",
    styles: ["ecstatic"],
    label: "Dom Lis ecstatic dance",
    venueAddress: "Passeig de Sant Joan 30, 08010 Barcelona",
  },
  // Sinestesia (Sants), found by discovery: its events calendar (schema.org JSON-LD) lists music and dance nights beside
  // a weekly open mic ("MICROOBERT"). Seeded 2026-11-12 to name the open mic (coverage-148).
  {
    url: "https://sinestesia.barcelona/reload/",
    kind: "jsonld",
    trustTier: "first_party",
    styles: [],
    label: "Sinestesia",
    mixedCalendar: true,
    venuePage: true,
    venueAddress: "Carrer de Santa Caterina 52-54, 08014 Barcelona",
    notDanceNights: ["MICROOBERT *"],
  },
];

/** Starting addresses retired, each with the reason (D-047). */
export const BARCELONA_RETIRED: readonly RetiredSource[] = [
  // DICE genre pages read on the first two full reads and left out since (BARCELONA_DICE_GENRES): a page off
  // the starting list stays switched on until it is retired here (D-047).
  ...DICE_GENRES.filter(([path]) => !BARCELONA_DICE_GENRES.has(path)).map(([path]) => ({
    url: `${DICE_BROWSE}/${path}`,
    reason:
      "a DICE genre page that wrote nothing new on Barcelona's second full read (run 40926975873, 2026-10-29); an empty one redirects to the gig list",
  })),
  // Read on Barcelona's first full run (2026-10-29, run 40918375911).
  {
    url: "https://matineegroup.com/",
    reason:
      "a club group's home page read as a The Events Calendar site; it is not one (first Barcelona run, 2026-10-29)",
  },
  {
    url: "https://www.aymisalsa.com/",
    reason: "read as a The Events Calendar site; it is not one (first Barcelona run, 2026-10-29)",
  },
  {
    url: "https://www.openbarcelona.com/",
    reason: "a home page with no dated dance nights (first Barcelona run, 2026-10-29)",
  },
  {
    url: "https://tangoenbarcelona.es/agenda/",
    reason: "answers 403 to the daily runners (first Barcelona run, 2026-10-29)",
  },
  {
    url: "https://www.meetup.com/bcnbachata/events/",
    reason:
      "a Meetup group whose iCalendar feed lists no events (0 rows on full read 40945417148; feed empty 2026-10-29)",
  },
  // Discovered sources that wrote nothing on full read 40945417148 (2026-10-29).
  {
    url: "https://grupalmodobar.com/",
    reason:
      "an iCalendar feed with no dance events (3 not events, 0 written on full read 40945417148)",
  },
  {
    url: "https://automatamusic.com/drum-and-bass-parties-in-barcelona/",
    reason: "a blog list whose 12 rows were all rejected on full read 40945417148",
  },
  // Discovered sources that never read once (404 on every read; cities sweep 2026-11-11, run 42972608522).
  {
    url: "https://ien.es/",
    reason: "the site answered 404 on 11 reads in a row since 2026-11-01; it never read once",
  },
  {
    url: "https://espailinia.cat/",
    reason: "the site answered 404 on 11 reads in a row since 2026-11-01; it never read once",
  },
  {
    url: "https://www.bibliomusicineteca.com/",
    reason: "the site answered 404 on 11 reads in a row since 2026-11-01; it never read once",
  },
  {
    url: "https://www.toniguida.org/",
    reason: "the site answered 404 on 8 reads in a row since 2026-11-04; it never read once",
  },
  // Found by discovery (2026-11-11): a community centre's programme.
  {
    url: "https://cancarol.cat/",
    reason:
      'Can Carol, a community centre: wellbeing talks, workshops and a swap market ("Iniciació als diorames", "Mercat d\'Intercanvi"), no dance nights (new-sources check 2026-11-12)',
  },
  // Found by discovery (venue_websites): a Berlin club's site that discovery attached to Barcelona; its parties
  // ("FUCK MY HOLE") are in Berlin, so they showed as Barcelona cards (coverage daily check 2026-11-14).
  {
    url: "https://berlindark.com/",
    reason:
      "berlindark.com: a Berlin club's party site that venue discovery attached to Barcelona; its parties are in Berlin (coverage daily check 2026-11-14)",
  },
];
