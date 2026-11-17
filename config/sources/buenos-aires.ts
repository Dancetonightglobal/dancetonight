// Buenos Aires' starting sources (D-400). Argentina is treated like the US (the owner 10-29, D-034's US tier):
// official APIs and public pages, robots.txt honoured; Resident Advisor, Facebook and Instagram never.
// Sources are added as they are checked (D-401 on). Hoy Milonga is never a source (owner, 2026-10-29). The
// milongas' own sites publish weekly grids without dates; long-running milongas are read from their own grid
// as weekly nights and rechecked monthly (owner, 2026-10-29, D-402), an exception to NYC's dated-evidence rule.

import { MAPA_MILONGUERO_URL } from "@/src/adapters/apis/bamilonga-register";
import type { RetiredSource, SeedSource } from "@/config/sources/nyc";
import type { StyleKey } from "@/config/styles";

/** A venue's own page, read as HTML (D-401). */
const page = (url: string, label: string, styles: StyleKey[]): SeedSource => ({
  url,
  kind: "html",
  trustTier: "first_party",
  styles,
  label,
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

export const BUENOS_AIRES_SOURCES: readonly SeedSource[] = [
  // Salsa Vida's Buenos Aires guide: schema.org Events on the page (20 on 10/29, to 11/11: La Salsera, Se Picó,
  // El Barcito Bachatero, Parque Patricios outdoors, Club Glorias Argentinas, Club Serrano, La Viruta's Tuesday
  // salsa, Pentos); robots.txt allows all, checked 2026-10-29. Read as a directory, as London's and Lisbon's are.
  // Salsa Vida lists only dance nights: not a mixed calendar, so a night whose title names no dance ("Noche Habanera") stays (D-772).
  {
    ...directory(
      "https://www.salsavida.com/guides/argentina/buenos-aires/",
      "Salsa Vida Buenos Aires",
      ["salsa", "bachata"],
    ),
    mixedCalendar: false,
  },
  // Ritmo Libre, a Latin dance agenda for Argentina: its CABA socials page lists ~27 dated socials for the
  // coming week in a schema.org ItemList (salsa, bachata, rueda, milongas; weeknights included), and each
  // event page is a schema.org DanceEvent with address and point. robots.txt allows all bots; no terms page
  // (checked 2026-10-30). Read as a directory; its dance classes are kept, as in every city. Two items are not
  // dance nights (a teacher training, a stale course advert), checked 2026-10-30 (coverage-64).
  {
    ...directory("https://www.ritmolibre.ar/agenda-baile/sociales/caba", "Ritmo Libre CABA", []),
    kind: "jsonld",
    platform: "jsonld_items",
    notDanceNights: ["Instructorado de Bachata Femme", "Nuevos cursos de salsa en Septiembre"],
  },
  // Circuito Peñero's nationwide peña (folk dance night) agenda, read from its Next.js page once a day;
  // concert-only rows (rubro musica) left out, filtered to the metro by point (D-551).
  {
    ...directory("https://circuitopeñero.com/eventos", "Circuito Peñero", ["argentine_folklore"]),
    kind: "jsonld",
    platform: "circuitopenero",
    // Not a mixed calendar: the reader keeps only rows the site marks music-and-dance (rubro "ambos"), so the
    // mixed-calendar no-dance rule must not drop them (read 41311333581 dropped "Conexión Tierra" at 21:00).
    mixedCalendar: false,
  },
  // Dancetomic's Buenos Aires week (salsa, bachata, kizomba socials and classes): a JSON-LD ItemList of 30 event
  // pages on 2026-10-31, each a schema.org Event with start time, venue and point. Read with the platform's
  // written permission (owner, 2026-10-31, D-404); robots.txt allows all. Much of its data is copied from
  // Instagram: only its own event pages are followed (never an Instagram link), and a row without a venue is
  // left unplaced as usual.
  {
    ...directory("https://dancetomic.com/eventos/buenos-aires", "Dancetomic Buenos Aires", [
      "salsa",
      "bachata",
    ]),
    kind: "jsonld",
    platform: "jsonld_items",
  },
  // Bailar (getbailar.com, also bailar.site), the Latin dance app: its Buenos Aires page's "tonight" ItemList
  // names that night's event pages (2 on 2026-10-31), each a schema.org Event with start, address and point.
  // Read with the platform's written permission (owner, 2026-10-31, D-404); robots.txt allows /dance/ and
  // /events/. The canonical host is getbailar.com, which its ItemList links use.
  {
    ...directory("https://getbailar.com/dance/buenos-aires", "Bailar Buenos Aires", [
      "salsa",
      "bachata",
    ]),
    kind: "jsonld",
    platform: "jsonld_items",
  },
  // Crobar, Palermo: schema.org Events on its dates page (11 club nights 10/30 to 12/19, rooms Crobar,
  // Crobar Studio and El Jardín; robots.txt disallows only /api/ and /admin, checked 2026-10-29). No street
  // address on the site, so none is given.
  {
    ...page("https://www.crobar.com.ar/fechas", "Crobar", ["dj_night", "electronic"]),
    kind: "jsonld",
    venuePage: true,
    onlyHere: true,
  },
  // FEL!ZA, Recoleta (queer bar): found by discovery on daily read 41311333581 (2026-11-01, 32 written); seeded
  // so its non-dance rows can be named. Its agenda's schema.org Events mix DJ sets and parties with shows, talks,
  // games, cinema and a host's or stylist's slot; robots.txt allows all but /admin/, /staff/, /api/ (checked
  // 2026-11-01). Titles read from the live agenda 2026-11-01 (cov-87 OK'd, config only).
  {
    ...page("https://felizarcoiris.com/agenda", "FEL!ZA", []),
    kind: "jsonld",
    notDanceNights: [
      "TALENTOS QUEER FELIZA",
      "DRAGAKADRABRA, varieté",
      "El vodevil de Rodri",
      "Anecdorario de una mariquita Memoriosa",
      "Stylist:",
      "Len",
      "Hostea y recibe: *",
      "Karaoke Drag",
      "TRAVARET",
      "BATALLA DE LIPSYNC",
      "Bingo Mostra Musical",
      "Trivia Mostra",
      "TUTTI FRUTTI MULTITUDINARIO *",
      "GayMatch: *",
      "Cine",
      "FABULOSXS DESCONOCIDXS CINECLUB",
      "FILMACION LUCILA",
      "Leviticus",
      "HELAPOP",
      "Vacas y Cocktails *",
      "Lo mejor son las charlas de verdad, vení temprano",
      "Cineclub *",
      // Its happy-hour "previa" rows (drinks, patio, board games before the night starts), read 11-02.
      "Patio, tragos y gente copada antes de que arranque todo",
      "Llegá temprano y quedate con tus amigues",
      "Juegos de mesa, patio y caras nuevas desde temprano",
      "Arrancá tranqui, rodeadx de amigues",
      "Relajá con amigues y un trago Feliza en mano",
      "Charlar en un lugar seguro, así empieza la noche",
      "La felicidad son los vínculos que armamos acá",
      // Read 2026-11-12: self-published book talks, a foosball tournament and more early "previa" rows.
      "Baby Orlok - Autopublicación",
      "Tina - Autopublicación",
      "Campeonato de Metegol *",
      "Combo de Juegos, tragos y amigues",
      "Conocé gente nueva desde temprano",
    ],
  },
  // Fiesta Jolie, the LGBTIQ+ party every Wednesday from 23:00 at Club Aráoz (Aráoz 2424, Palermo; 1,000+ a night
  // per Perfil 2024): its home page carries a schema.org EventSeries and the next night as an Event (startDate
  // 2026-11-04T23:00-03:00 on 10-31). robots.txt allows all but /admin/, /api/ and member pages; its terms
  // (/terminos) say nothing about bots, checked 2026-11-01 (D-524 gap analysis). The Event's location is an @id
  // reference the reader does not follow, so the address comes from the site's own Place node.
  {
    ...page("https://fiestajolie.com/", "Fiesta Jolie", ["queer_party", "dj_night"]),
    kind: "jsonld",
    venueAddress: "Aráoz 2424, Palermo, CABA",
    venuePage: true,
    onlyHere: true,
  },
  // Niceto Club, Palermo: its agenda (121 dated items 10/29 to 04/2027, each labelled "Concierto" or
  // "Fiesta"; Club 69, Fiesta Trevi and other parties among the gigs); robots.txt allows all, checked 2026-10-29.
  // Address from the club's own site.
  {
    ...page("https://nicetoclub.com/agenda/", "Niceto Club", ["dj_night"]),
    venueAddress: "Niceto Vega 5507, Palermo, CABA",
    venuePage: true,
    // Its cards name the room (Niceto Club, Niceto Bar, Humboldt: the side door on Humboldt 1358, same
    // building); the full read of 10-29 left 4 of 8 unplaced.
    venueRooms: ["Niceto Club", "Niceto Bar", "Humboldt", "Sala Humboldt"],
    onlyHere: true,
    mixedCalendar: true,
    // Its parties print "23 59 hs" for a start it does not give (19 of 116 cards on 2026-10-30, the
    // rest real gig times), shown on the site as "Starts at 11:59pm": read as not listed (D-063), as Venti does.
    placeholderTimes: ["23:59"],
    // Parties its agenda labels "Concierto" and titles without a dance word, so the mixed-calendar screen
    // dropped them (D-524 gap analysis): Polenta (a party since 2019, Forbes Argentina) and Club 69 (the
    // club's own long-running party, "Club 69 | 31 OCT HALLOWEEN"). "*" = the name opens each dated title.
    danceNights: ["Polenta *", "Club 69 *"],
  },
  // La Paz Arriba, Recoleta (Av. Callao 1082, first floor): its nights are ticketed on Passline, which answers
  // bots with a Cloudflare challenge, so they are read from Qué Hacemos' venue page (schema.org Place.event list;
  // robots.txt and terms allow it, checked 2026-10-30). Weekly "Salsa Arriba" Wednesdays appear only as Qué Hacemos
  // dates them (no weekly is inferred: not the venue's own site). Trivia, bingo and karaoke are screened out.
  {
    ...directory(
      "https://www.quehacemos.com.ar/venues/la-paz-arriba",
      "La Paz Arriba (Qué Hacemos)",
      [],
    ),
    kind: "jsonld",
    venueAddress: "Av. Callao 1082, Recoleta, CABA",
    venuePage: true,
    onlyHere: true,
  },
  // Ciudad Cultural Konex, Almagro: its month agenda (dated La Bomba de Tiempo Mondays, Cumbia Konex, La RE
  // Fiesta and Broke Party beside concerts and ballet); robots.txt allows it, checked 2026-10-29. Its ticket site
  // entradas.cckonex.org is walled and is not read. Address from its own site.
  {
    ...page("https://www.cckonex.org/agenda/", "Ciudad Cultural Konex", ["cumbia", "dj_night"]),
    venueAddress: "Sarmiento 3131, C1196AAG CABA",
    venuePage: true,
    onlyHere: true,
    mixedCalendar: true,
    // La Bomba de Tiempo every Monday: the agenda's calendar grid prints "La Bomba de Tiempo 20:00 hs." under each
    // Monday, but the model read dates them to the Sunday beside them, so the date check dropped all of them
    // (read 41311333581, 2026-11-01). Konex's home page states the weekly night ("Todos los lunes | 20 hs").
    fixedNights: [
      {
        title: "La Bomba de Tiempo",
        line: "La Bomba de Tiempo 20:00 hs.",
        days: [1],
        start: "20:00",
        styles: ["other"],
        danceCited:
          "own site, https://www.labombadetiempo.com/: 'Cuando La Bomba explota, un verdadero ritual de ritmo y baile se apodera de todos'; weekday from https://www.cckonex.org/: 'Todos los lunes | 20 hs La Bomba de Tiempo' (2026-11-01)",
        replacesTitles: ["La Bomba de Tiempo", "Lunes Bomba"],
      },
    ],
  },
  // Club Gricel, San Cristóbal: its weekly programme (milongas La Porteña Sun, De Lucy Mon, Yira Yira Fri,
  // Matinée Sat; rock and swing social Wed; Se Picó bachata Thu; Mario Imas salsa Sat), weekly grid without
  // dates, read as weekly nights (D-402; rechecked monthly, last 2026-10-29). robots.txt disallows only /*?.
  {
    ...page("https://clubgricel.com.ar/programacion/", "Club Gricel", [
      "tango",
      "milonga",
      "rock_n_roll",
      "bachata",
      "salsa",
    ]),
    venueAddress: "La Rioja 1180, CABA",
    weeklyGrid: true,
    venuePage: true,
    onlyHere: true,
  },
  // La Viruta Tango Club, Palermo: its one-page site's weekly grid (Wed, Fri, Sun: classes from 20:30, dancing
  // from 23:00; Friday has a show first), read as weekly nights (D-402; rechecked monthly, last 2026-10-29).
  // robots.txt blocks only AI crawlers by name. lavirutatango.com is a "Coming Soon" page.
  {
    ...page("https://lavirutatangoclub.com/", "La Viruta Tango Club", [
      "tango",
      "milonga",
      "salsa",
      "rock_n_roll",
    ]),
    venueAddress: "Armenia 1366, Palermo, CABA",
    weeklyGrid: true,
    venuePage: true,
    onlyHere: true,
  },
  // El Beso: Cachirulo's own page on the salon's site ("Martes y sábados, 20:30 hs"); El Beso's other milonga
  // pages give no times, so only this one is read (D-402; rechecked monthly, last 2026-10-29). robots.txt
  // Content-Signal search=yes, ai-train=no (ai-input not refused).
  {
    ...page("https://elbeso.com.ar/producto/cachirulo/", "Cachirulo (El Beso)", [
      "tango",
      "milonga",
    ]),
    venueAddress: "Riobamba 416, CABA",
    weeklyGrid: true,
    venuePage: true,
    onlyHere: true,
  },
  // Gente de Rock: the rock & roll school's parties page (Capital: Sat 31 Oct 21:00-02:00 "Monstruos, Bestias y
  // Villanos", past dates 10 Oct, 20 Sep...; Castelar, outside CABA: Sun 8 Nov). The only rock & roll party
  // calendar found in CABA (research sweep, 2026-10-29). robots.txt (Yoast) allows all, checked 2026-10-29. The
  // Capital venue is not named on the page, so no address is given.
  page("https://gentederock.com.ar/fiestas/", "Gente de Rock", ["rock_n_roll", "boogie_woogie"]),
  // La Bomba de Tiempo: the percussion group's own page lists its dated "Lunes Bomba" nights at Ciudad Cultural
  // Konex (5, 12, 19, 26 Oct; next Mon 2 Nov 19h) beside tour dates in Spain (Málaga, Barcelona, Valencia,
  // Madrid). Time Out: about three thousand people dance to it every Monday. robots.txt disallows only /wp-admin/,
  // checked 2026-10-29. Not onlyHere: the tour dates are elsewhere.
  {
    ...page("https://www.labombadetiempo.com/", "La Bomba de Tiempo", ["other"]),
    mixedCalendar: true,
    // Its Monday party is a dance night whose title names no dance (BA lead, 2026-10-29, D-264).
    danceNights: ["Lunes Bomba"],
  },
  // Casa Brandon, Villa Crespo: the queer cultural club's own agenda (dated items: its Fiesta del Club Brandon
  // on 18 Oct 2026 among talks, films and screenings), the only DJ bar with a dated calendar on its own site in
  // the DJ-bar sweep (BA lead, 2026-10-30); robots.txt (Yoast) allows all, checked 2026-10-30. Address from its
  // own site.
  {
    ...page("https://brandon.org.ar/agenda/", "Casa Brandon", ["queer_party", "dj_night"]),
    venueAddress: "Luis María Drago 236, Villa Crespo, CABA",
    venuePage: true,
    onlyHere: true,
    mixedCalendar: true,
  },
  // 5Rhythms classes, read with 5Rhythms' written permission (D-523); all six meet at Niceto Vega 5390 (FUEL
  // Palermo), Palermo, CABA, per the 5Rhythms finder on 2026-10-31; the address is set here because 3 pages' rows came back
  // unplaced on 2026-11-01 (read 41311333581). Monday 19:30-21:30, Maria Luz Pilheu.
  {
    ...page(
      "https://www.5rhythms.com/classes/ELMOVIMIENTOABRECAMINOS-298020",
      "El Movimiento Abre Caminos 5Rhythms",
      ["five_rhythms"],
    ),
    venueAddress: "Niceto Vega 5390, Palermo, CABA",
    venuePage: true,
  },
  // Wednesday 07:15-09:15, Alejandra Duhalde, Niceto Vega 5390, Palermo.
  {
    ...page(
      "https://www.5rhythms.com/classes/RITMOS-297411",
      "5 Ritmos Alejandra Duhalde 5Rhythms",
      ["five_rhythms"],
    ),
    venueAddress: "Niceto Vega 5390, Palermo, CABA",
    venuePage: true,
  },
  // Tuesday 19:00, Brenda Cohen Sabban, Niceto Vega 5390, Palermo.
  {
    ...page(
      "https://www.5rhythms.com/classes/RitmosPresencialMARTES-297683",
      "5Ritmos Presencial Martes 5Rhythms",
      ["five_rhythms"],
    ),
    venueAddress: "Niceto Vega 5390, Palermo, CABA",
    venuePage: true,
  },
  // Tuesday 09:30-10:45 on its page (titled VIERNES), Brenda Cohen Sabban, Niceto Vega 5390, Palermo.
  {
    ...page(
      "https://www.5rhythms.com/classes/RitmosPresencialVIERNES-297682",
      "5Ritmos Presencial Viernes 5Rhythms",
      ["five_rhythms"],
    ),
    venueAddress: "Niceto Vega 5390, Palermo, CABA",
    venuePage: true,
  },
  // Friday 19:30-21:30, Pablo Gumina, Niceto Vega 5390 piso 1, Palermo.
  {
    ...page(
      "https://www.5rhythms.com/classes/RitmosenPalermoBuenosAiresVierneshs-293765",
      "5 Ritmos en Palermo 5Rhythms",
      ["five_rhythms"],
    ),
    venueAddress: "Niceto Vega 5390, piso 1, Palermo, CABA",
    venuePage: true,
  },
  // Tribal: one dated session (Sunday 29 Nov 2026 11:00-13:30), Alejandra Duhalde, Niceto Vega 5390, Palermo.
  {
    ...page("https://www.5rhythms.com/classes/TRIBAL-297412", "Tribal 5Rhythms", ["five_rhythms"]),
    venueAddress: "Niceto Vega 5390, Palermo, CABA",
    venuePage: true,
  },
  // Eventbrite.com.ar organisers found by hand from Eventbrite's public Buenos Aires pages, 2026-10-29 (D-131).
  eventbrite("https://www.eventbrite.com.ar/o/46588592173", "Club Severino (Eventbrite)", [
    "dj_night",
  ]),
  eventbrite("https://www.eventbrite.com.ar/o/11093188532", "HYPE Buenos Aires (Eventbrite)", [
    "dj_night",
    "queer_party",
  ]),
  eventbrite("https://www.eventbrite.com.ar/o/121873686507", "Baires Tango Studio (Eventbrite)", [
    "tango",
    "milonga",
  ]),
  // Mariel G's ecstatic dances at Umbral Holistic Wellness (Loyola 1126, Villa Crespo), sold on Eventbrite
  // (29 Aug and 17 Oct 2026); found while checking ecstaticdance.org's Buenos Aires leads (D-573, 2026-11-02).
  eventbrite(
    "https://www.eventbrite.com.ar/o/121565263554",
    "Mariel G ecstatic dance (Eventbrite)",
    ["ecstatic"],
  ),
  // Venti, Argentina's party ticketer: its sitemap's event pages (418 on 2026-10-29, 367 changed since September),
  // each a schema.org Event with coordinates, kept inside CABA; parties and club nights beside concerts, so it is
  // screened as a mixed calendar (owner, 2026-10-29; robots.txt allows /evento/ and the sitemap, Crawl-delay 10).
  {
    ...directory("https://venti.live/sitemap.xml", "Venti", []),
    kind: "platform_api",
    trustTier: "ticketing",
    platform: "venti",
  },
  // Mandarine Park, Costanera (Punta Carrasco): electronic nights listed on its own home page as dated cards
  // ("19 Sep Riverside Sessions", "07 Nov Corporate Night"); tickets sell on Passline, which blocks us. Found by the
  // blocked-platform audit (D-758, 2026-11-06); robots.txt disallows only /admin. Address from its own site.
  {
    ...page("https://mandarinepark.com/", "Mandarine Park", ["dj_night", "electronic"]),
    venueAddress: "Av. Costanera Rafael Obligado 2221, Punta Carrasco, CABA",
    venuePage: true,
    onlyHere: true,
  },
  // BAMilonga, the City Government's register of milongas, as printed in its Mapa Milonguero 2026 PDF (owner's Q1 = A,
  // 2026-10-29), transcribed into src/adapters/apis/bamilonga-register.ts and listed as weekly nights at each venue
  // (D-402, D-403); the PDF is fetched each read only to notice a new map. Monthly and fortnightly milongas are left
  // out (the map does not say which week), and so are La Viruta, Club Gricel and Cachirulo, read from their own sites.
  {
    ...directory(MAPA_MILONGUERO_URL, "BAMilonga (Ciudad de Buenos Aires)", ["tango", "milonga"]),
    kind: "platform_api",
    platform: "bamilonga",
    mixedCalendar: false,
  },
];

/** Starting addresses retired, each with the reason (D-047). */
export const BUENOS_AIRES_RETIRED: readonly RetiredSource[] = [
  {
    url: "https://www.ccmatienzo.com.ar/",
    reason:
      "a Next.js page whose events are only in its __NEXT_DATA__ script, which no reader handles; the full read of 2026-10-29 wrote 0",
  },
  {
    url: "https://epok.buenosaires.gob.ar/getGeoLayer/?categoria=milongas&formato=geojson&srid=4326",
    reason:
      "the city's USIG EPOK map service drops non-browser clients and its robots.txt redirects to an error page, so it counts as disallowed; the same register is read from the Mapa Milonguero 2026 PDF (D-403)",
  },
];
