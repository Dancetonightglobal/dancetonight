// Tulum's starting sources (D-1080): the Tulum and Solidaridad (Playa del Carmen) municipios. Mexico is read under
// the US tier (standing answer D-520 item 5, as Mexico City, D-440): official APIs, public pages and feeds,
// robots.txt honoured, no bot-wall workarounds; Facebook and Instagram never. Resident Advisor only through its
// GraphQL endpoint (D-505): Tulum is area 523 (index.ts adds it), and Playa del Carmen is its own RA area, 684,
// read by the second entry below (GraphQL areas(searchTerm:), 2026-11-07: 2 listings each for 11-07..11-21).
// The daily run also seeds venues from Overture and discovers their websites (D-120).

import type { StyleKey } from "@/config/styles";
import type { RetiredSource, SeedSource } from "@/config/sources/nyc";

const page = (url: string, label: string, styles: StyleKey[]): SeedSource => ({
  url,
  kind: "html",
  trustTier: "first_party",
  styles,
  label,
});

const directory = (url: string, label: string, styles: StyleKey[]): SeedSource => ({
  url,
  kind: "html",
  trustTier: "directory",
  styles,
  label,
  mixedCalendar: true,
});

/** A Grupo Mandala club's own MandalaTickets page: its weekly club nights in one line, no dates (D-402, D-1082). */
const mandala = (path: string, label: string, venueAddress: string): SeedSource => ({
  url: `https://mandalatickets.com/en/${path}`,
  kind: "html",
  trustTier: "first_party",
  styles: ["dj_night"],
  label,
  venueAddress,
  venuePage: true,
  weeklyGrid: true,
});

/** A dance organiser's Eventbrite page, read through the official API by organiser ID (D-131, D-205). */
const eventbrite = (url: string, label: string, styles: StyleKey[]): SeedSource => ({
  url,
  kind: "ticketing_api",
  trustTier: "ticketing",
  platform: "eventbrite",
  styles,
  label,
  mixedCalendar: true,
});

export const TULUM_SOURCES: readonly SeedSource[] = [
  // Salsa Vida's Tulum guide (the owner approved Salsa Vida's terms, 2026-10-31): schema.org Events in the page's
  // ItemList (6 on 11/07, three weeklies: Fri "Salsa Night at Safari Aldea Zama", Sun "Salsa and Bachata Night at
  // Salon Sombrero", Tue "Salsa Tuesdays at Palma Central"). robots.txt allows it (checked 2026-11-07).
  // Salsa Vida lists only dance nights (D-321), so its rows are not mixed calendars (D-772, coverage-114 11-07).
  // Its JSON-LD writes -06:00 for UTC-5 Cancun (page "8:00 PM", startDate 20:00-06:00); every Salsa Vida clock is
  // read as the page's local time (D-778, D-1083).
  {
    ...directory(
      "https://www.salsavida.com/guides/mexico/quintana-roo/tulum/",
      "Salsa Vida Tulum",
      ["salsa", "bachata"],
    ),
    mixedCalendar: false,
  },
  // Salsa Vida's Playa del Carmen guide (6 on 11/07: Sun "Zenzi Beach Club - Sunday Night Salsa", Sun "Latin Pool
  // Party at Hyatt Centric" 3pm, Tue "Salsa Lessons and Live Music at La Bodeguita del Medio"). Checked 2026-11-07.
  // Same -06:00 offset, read as local time (D-778).
  {
    ...directory(
      "https://www.salsavida.com/guides/mexico/quintana-roo/playa-del-carmen/",
      "Salsa Vida Playa del Carmen",
      ["salsa", "bachata", "kizomba"],
    ),
    mixedCalendar: false,
  },
  // Salsa Vida's Tulum lessons page: the classes the guide leaves out (24 on 11/07: Dance Academy Tulum Mon-Fri 8pm,
  // Baila'mor Mon-Wed 7pm, Sunset Salsa & Bachata at Lula Hotel Thu/Sun 6pm, Estudio Vivo Tue, The Space Fri,
  // Casa Altamar Sat). Same JSON-LD and -06:00 offset as the guide (D-1083). Checked 2026-11-07.
  {
    ...directory(
      "https://www.salsavida.com/guides/mexico/quintana-roo/tulum/lessons/",
      "Salsa Vida Tulum lessons",
      ["salsa", "bachata"],
    ),
    mixedCalendar: false,
  },
  // Salsa Vida's Playa del Carmen lessons page (8 on 11/07: Salsa & Bachata Classes at Mexcalli Playa Tue/Thu 7pm,
  // plus the guide's Hyatt and Bodeguita nights). Checked 2026-11-07.
  {
    ...directory(
      "https://www.salsavida.com/guides/mexico/quintana-roo/playa-del-carmen/lessons/",
      "Salsa Vida Playa del Carmen lessons",
      ["salsa", "bachata"],
    ),
    mixedCalendar: false,
  },
  {
    url: "https://ra.co/graphql?area=684",
    kind: "ticketing_api",
    trustTier: "ticketing",
    platform: "ra",
    styles: ["dj_night"],
    label: "Resident Advisor Playa del Carmen",
  },
  // TicketFairy (D-1081: the owner read its terms and approved the public events API, 2026-11-07): Quintana Roo's
  // events; the metro outline drops Cancun and the rest of the state (10 of 12 kept on the 11-07 fixture: Gitano
  // Jungle and Beach, Papaya Playa Project). It also lists dinners and retreats, so the no-dance screen applies.
  // robots.txt allows /api/v1/events/listing (checked 2026-11-07).
  {
    url: "https://www.ticketfairy.com/api/v1/events/listing?country=MX&state=Quintana%20Roo",
    kind: "ticketing_api",
    trustTier: "ticketing",
    platform: "ticketfairy",
    styles: ["dj_night"],
    label: "TicketFairy Quintana Roo",
    mixedCalendar: true,
    // The club nights its titles do not name as dances (first read 11-07 screened them as "names no dance"):
    // Gitano's weekly Gypsy Disco, Ceremonia and La Noche, Papaya Playa Project's nights, Mera Room's beach party.
    // Las Gitanas is a dinner and stays screened.
    danceNights: ["GYPSY DISCO*", "CEREMONIA*", "LA NOCHE*", "PAPAYA PLAYA PROJECT*", "MERA ROOM*"],
  },
  // Grupo Mandala's nightclubs (DJ-bar sweep 11-07). MandalaTickets is the group's own booking site (the clubs' own
  // sites, e.g. vagalumetulum.com, book through it). Each page states its weekly club nights in one line ("Open:
  // Friday and Saturday nights starting at 8:00 PM to 3:00 AM Music: Reggaeton"). D-1082 (coverage, 11-07): a
  // nightclub's own stated club nights with a music genre are weekly DJ nights; bars and restaurants still need a
  // named night, so Bagatelle Tulum (a restaurant with a DJ) is left out. Abolengo is closed. robots.txt allows /en/
  // (Crawl-delay 10, no query URLs; checked 2026-11-07).
  mandala(
    "playa/disco/rakata",
    "Rakata Playa del Carmen",
    "Calle 12 Nte, Gonzalo Guerrero, 77710 Playa del Carmen, Q.R.",
  ),
  mandala(
    "playa/disco/mandala",
    "Mandala Playa del Carmen",
    "1 Avenida Nte., Centro, 77710 Playa del Carmen, Q.R.",
  ),
  // La Vaquita's page writes its week with no dates ("Open: From Thursday to Sunday starting at 8:30 PM to 3:00 AM").
  // Run 42839432038's model titled it "LA VAQUITA - PLAYA DEL CARMEN", dropped the weekly rule, and the 8 weekly
  // rows were retired, leaving one untimed Tuesday. Listed as a fixed weekly night while the page still writes that
  // line (checked 2026-11-10; coverage-133 asked for it).
  {
    ...mandala(
      "playa/disco/la-vaquita",
      "La Vaquita Playa del Carmen",
      "Calle 12 Nte, Centro, 77720 Playa del Carmen, Q.R.",
    ),
    fixedNights: [
      {
        title: "La Vaquita Playa del Carmen",
        line: "From Thursday to Sunday starting at 8:30 PM to 3:00 AM",
        days: [4, 5, 6, 0],
        start: "20:30",
        end: "03:00",
        danceCited:
          "own page, https://mandalatickets.com/en/playa/disco/la-vaquita: 'dance until dawn', 'From Thursday to Sunday starting at 8:30 PM to 3:00 AM', 'Reggaeton, hip hop and R&B' (2026-11-10)",
        replacesTitles: [
          "LA VAQUITA - PLAYA DEL CARMEN",
          "LA VAQUITA PLAYA DEL CARMEN",
          "La Vaquita",
          "LA VAQUITA",
        ],
      },
    ],
  },
  mandala(
    "playa/disco/santito-tun-tun",
    "Santito Tun Tun",
    "Avenida 12 con, Calle 1 Nte., 77710 Playa del Carmen, Q.R.",
  ),
  // Vagalume's page writes its hours with no dates ("Open: from Thursday to Sunday", "Night Club 7:00 pm - 1:00 am",
  // "Music: Electronic"), and the model listed nothing from it in run 42639809098. Listed as a fixed weekly night while
  // the page still writes that line (checked 2026-11-09); the 11:00-18:00 beach club is not a dance night.
  {
    ...mandala("tulum/disco/Vagalume", "Vagalume Tulum", "QROO 15, Tulum Beach, 77776 Q.R."),
    fixedNights: [
      {
        title: "Vagalume Night Club",
        line: "7:00 pm - 1:00 am",
        days: [4, 5, 6, 0],
        start: "19:00",
        end: "01:00",
        danceCited:
          "own page, https://mandalatickets.com/en/tulum/disco/Vagalume: 'from Thursday to Sunday', 'Night Club 7:00 pm - 1:00 am', 'Music: Electronic' (2026-11-09)",
        replacesTitles: ["VAGALUME", "Vagalume Tulum", "VAGALUME TULUM"],
      },
    ],
  },
  mandala(
    "tulum/disco/bonbonniere",
    "Bonbonniere Tulum",
    "Carretera estatal Tulum - Boca Paila, Parcela 1744-A NCPE José María Pino Suárez, 77760 Tulum, Q.R.",
  ),
  // Tulum dance organisers that sell on Eventbrite (organiser ids from their event pages' JSON-LD, 2026-11-07):
  // Ek Lum Tulum (Tuesday salsa, Hedone Nights), PADMA (ecstatic dance at The Space Tulum), Tulum Salsa Academy.
  eventbrite(
    "https://www.eventbrite.com.mx/o/ek-lum-tulum-106302940951",
    "Ek Lum Tulum (Eventbrite)",
    ["salsa"],
  ),
  eventbrite("https://www.eventbrite.com.mx/o/padma-120706727578", "PADMA Tulum (Eventbrite)", [
    "ecstatic",
  ]),
  eventbrite(
    "https://www.eventbrite.com.mx/o/tulum-salsa-academy-59233430753",
    "Tulum Salsa Academy (Eventbrite)",
    ["salsa", "bachata"],
  ),
  // Casa Jaguar, Tulum beach road km 7.5: a restaurant whose own site lists its dated "Jungle nights" (DJ parties,
  // e.g. the 12 Nov anniversary). Chrome audit wave 4-4, 11-07; robots.txt disallows /admin/, /install/, /storage/,
  // /actions/ only (checked 2026-11-07).
  {
    ...page("https://casajaguar.com.mx/", "Casa Jaguar", ["dj_night"]),
    venueAddress: "Carretera Tulum-Boca Paila km 7.5, Tulum, Q.R.",
    venuePage: true,
    mixedCalendar: true,
    // A DJ-only jungle club: its "A + B" lineup is the dancing (D-341). Run 42492351731 screened "Casa Jaguar
    // Anniversary – MoM + Special Guest" (Thu 2026-11-12, "música electrónica") as a band billing (coverage-124).
    bandsForDancers: true,
  },
  // Tehmplo, Tulum beach road km 5.5: a jungle club whose own site lists its dated headliner nights (techno, house).
  // No robots.txt (checked 2026-11-07).
  {
    ...page("https://www.tehmplo.com/", "Tehmplo Tulum", ["dj_night"]),
    venueAddress: "Parcela, Carretera Tulum - Boca Paila 1678-Km. 5.5, 77780 Tulum, Q.R.",
    venuePage: true,
  },
  // More Eventbrite organisers of Tulum and Playa del Carmen club and dance nights (Chrome audit wave 4-4, 11-07;
  // organiser ids from event pages and Eventbrite's Tulum/Playa dance search, 2026-11-07).
  eventbrite(
    "https://www.eventbrite.com.mx/o/black-zama-formerly-black-tulum-106082337461",
    "Black Zama (Eventbrite)",
    ["dj_night"],
  ),
  eventbrite(
    "https://www.eventbrite.com.mx/o/jungle-juice-global-62134899853",
    "Jungle Juice Global (Eventbrite)",
    ["dj_night"],
  ),
  eventbrite(
    "https://www.eventbrite.com.mx/o/rasheed-dennis-31642299401",
    "Rasheed Dennis (Eventbrite)",
    ["dj_night"],
  ),
  eventbrite("https://www.eventbrite.com.mx/o/81469450903", "Tulum Uncut (Eventbrite)", [
    "dj_night",
  ]),
  eventbrite("https://www.eventbrite.com.mx/o/84172984083", "Support Dope Moves (Eventbrite)", [
    "line_dance",
  ]),
  eventbrite(
    "https://www.eventbrite.com.mx/o/121951289955",
    "PLENITUD Ecstatic Dance (Eventbrite)",
    ["ecstatic"],
  ),
  // Let's Dance Mexico's own Instagram (an organiser naming one fixed venue per night, D-802; the owner 2026-11-09):
  // "LUSH - LATIN DANCE PARTY" every Friday at Aloft Hotel Playa del Carmen (classes 7 and 8 pm, social 9 pm to 1 am)
  // and "LATIN SUNSET" every Sunday at Hotel Fiesta Inn Playa del Carmen (classes 5 and 6 pm, social 7 to 11 pm).
  // Two venues, so no seed venueAddress: each night is placed by its KnownVenue. Read by hand in the owner's Chrome by
  // "Dancetonight Chrome audit - wave 4 - 5/7" (D-796, D-797); never fetched. Recheck monthly.
  {
    url: "https://www.instagram.com/letsdancemex/",
    kind: "html",
    trustTier: "first_party",
    styles: ["salsa", "bachata"],
    label: "Let's Dance Mexico (Instagram)",
    handChecked: true,
    fixedNights: [
      {
        title: "LUSH Latin Dance Party",
        line: "Social de Salsa & Bachata – 9:00 p.m. a 1:00 a.m.",
        days: [5],
        start: "21:00",
        end: "01:00",
        styles: ["salsa", "bachata"],
        danceCited: '"noche increíble de salsa, bachata y baile sin parar", IG post 2026-11-09',
        venue: "Aloft Playa del Carmen",
        checkedOn: "2026-11-09",
        evidenceUrl: "https://www.instagram.com/letsdancemex/p/Dffmm3JP7mU/",
      },
      {
        title: "Latin Sunset",
        line: "Social de Salsa & Bachata – 7:00 p.m. a 11:00 p.m.",
        days: [0],
        start: "19:00",
        end: "23:00",
        styles: ["salsa", "bachata"],
        danceCited:
          '"LATIN SUNSET": salsa class 5 pm, bachata 6 pm, social 7 to 11 pm, IG post 2026-11-07',
        venue: "Fiesta Inn Playa del Carmen",
        checkedOn: "2026-11-09",
        evidenceUrl: "https://www.instagram.com/letsdancemex/p/Dfc5i3sMYOL/",
      },
    ],
  },
  // Tulum Salsa Academy's own Instagram (an organiser naming one fixed venue per night, D-802): Latin nights every
  // Wednesday at El Barrio (Avenida Tulum; times from El Barrio's own events page, 6 pm to 1 am, JS-rendered so not a
  // daily source) and "Rendez-Vous Bachata" every Thursday at The Space, La Veleta (8 pm; no end stated). Two venues,
  // so no seed venueAddress: each night is placed by its KnownVenue. Read by hand in the owner's Chrome by "Dancetonight
  // Chrome audit - wave 4 - 7/8" (D-796, D-797); never fetched. Recheck monthly.
  {
    url: "https://www.instagram.com/tulumsalsa.academy/",
    kind: "html",
    trustTier: "first_party",
    styles: ["salsa", "bachata"],
    label: "Tulum Salsa Academy (Instagram)",
    handChecked: true,
    fixedNights: [
      {
        title: "Salsa & Bachata Night at El Barrio",
        line: "Salsa & Bachata - FREE CLASS · YOA & TALLA · 6 pm – 1 am",
        days: [3],
        start: "18:00",
        end: "01:00",
        styles: ["salsa", "bachata"],
        danceCited:
          '"Salsa & Bachata - FREE CLASS · YOA & TALLA · 6 pm – 1 am", El Barrio events page 2026-11-09; IG post 2026-10-29',
        venue: "El Barrio Tulum",
        checkedOn: "2026-11-09",
        evidenceUrl: "https://www.instagram.com/tulumsalsa.academy/p/DfFYionqhXj/",
      },
      {
        title: "Rendez-Vous Bachata",
        line: "Rendez-Vous Bachata – 8pm The Space La Veleta",
        days: [4],
        start: "20:00",
        styles: ["bachata"],
        danceCited:
          '"Rendez-Vous Bachata", "8pm The Space La Veleta", IG posts 2026-10-29 and 2026-11-05',
        venue: "The Space Tulum",
        checkedOn: "2026-11-09",
        evidenceUrl: "https://www.instagram.com/tulumsalsa.academy/p/DfXPuEnKGdo/",
      },
    ],
  },
  // La Bodeguita del Medio Playa del Carmen's own Instagram (D-796, D-797): "Música en vivo TODOS LOS DÍAS a partir
  // de las 9:00 PM para disfrutar, cantar y bailar al ritmo de la música cubana" (post 2026-10-22; older posts say
  // "salsa en vivo todas las noches"). Tuesday is left out: Salsa Vida already lists Bodeguita's Tuesday class and
  // live music. One venue, so the seed carries the address. Read by hand in the owner's Chrome by "Dancetonight Chrome
  // audit - wave 4 - 8" (2026-11-10); never fetched. Recheck monthly.
  {
    url: "https://www.instagram.com/bodeguitadelmedio.pdc/",
    kind: "html",
    trustTier: "first_party",
    styles: ["salsa"],
    label: "La Bodeguita del Medio Playa (Instagram)",
    handChecked: true,
    venueAddress: "La Bodeguita del Medio, 5ta Avenida esq. Calle 34, Playa del Carmen, Q.R. 77720",
    fixedNights: [
      {
        title: "Live Cuban Music & Salsa at La Bodeguita del Medio",
        line: "Música en vivo TODOS LOS DÍAS a partir de las 9:00 PM",
        days: [0, 1, 3, 4, 5, 6],
        start: "21:00",
        styles: ["salsa"],
        danceCited:
          '"Música en vivo TODOS LOS DÍAS a partir de las 9:00 PM para disfrutar, cantar y bailar al ritmo de la música cubana", IG post 2026-10-22',
        venue: "La Bodeguita del Medio",
        checkedOn: "2026-11-10",
        evidenceUrl: "https://www.instagram.com/bodeguitadelmedio.pdc/p/Dext4mKhHcs/",
      },
    ],
  },
];

/** Starting addresses retired, each with the reason (D-047). */
export const TULUM_RETIRED: readonly RetiredSource[] = [];
