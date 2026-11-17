// Lisbon's starting sources (D-380, D-381, D-383). EU rules (D-034): official APIs and public pages only,
// robots.txt honoured, no unofficial endpoint without the operator's written consent; Resident Advisor, Facebook
// and Instagram never. Village Underground followed on 2026-10-29. Viral Agenda and where-to-dance-salsa.com are
// read with their owners' written permission (2026-10-29, D-383); Fever is held (its Lisbon nightlife page is pub
// crawls and boat parties, D-382). The daily run also seeds venues and discovers their websites (D-120).

import type { RetiredSource, SeedSource } from "@/config/sources/nyc";
import type { StyleKey } from "@/config/styles";
import { DICE_GENRES, diceSources } from "@/config/sources/dice";

/**
 * DICE's Lisbon browse page (D-139, D-197; PT added to the adapter's countries, owner 2026-10-29). Lux Frágil
 * sells only here; Casa Capitão carries Musicbox's programme (closed 09-2025). Checked 2026-10-29, robots.txt
 * allows all but /api/.
 */
const DICE_BROWSE = "https://dice.fm/browse/lisbon-5db997662b6fd8302bc10d91/music";

/**
 * DICE genre pages that exist for Lisbon: checked 2026-10-29, these seven answered 200; the other 38 (every
 * Party genre and the other DJ ones) answer a 307 redirect to the gig list and are retired below.
 */
const LISBON_DICE_GENRES = new Set([
  "dj/house",
  "dj/deephouse",
  "dj/tech-house",
  "dj/techno",
  "dj/afrobeats",
  "dj/afrohouse",
  "dj/rnb",
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
  mixedCalendar: true,
});

/** A Meetup group's own iCal feed (Meetup's API needs Pro; D-035 Q6). */
const meetup = (group: string, label: string, styles: StyleKey[]): SeedSource => ({
  url: `https://www.meetup.com/${group}/events/`,
  kind: "feed_ics",
  feedUrl: `https://www.meetup.com/${group}/events/ical/`,
  trustTier: "first_party",
  styles,
  label,
  mixedCalendar: true,
});

/**
 * where-to-dance-salsa's outdoor summer Mondays, still projected weekly into November (Jardim Roque Gameiro;
 * Lisbon - 8's live grep, 2026-10-30): a stale row, left out on all three style pages.
 */
const SEGUNDAS_SUMMER = ["Segundas SBK – Mondays in the summer"];

export const LISBON_SOURCES: readonly SeedSource[] = [
  ...diceSources(
    DICE_BROWSE,
    "Lisbon",
    DICE_GENRES.filter(([path]) => LISBON_DICE_GENRES.has(path)),
  ),
  // Xceed's Lisbon listing (owner's yes to its terms, D-382): Event JSON-LD for the first few nights plus ~35
  // event links, read as a directory with Barcelona's. robots.txt disallows only /reset and /authenticate,
  // checked 2026-10-29. Its event pages are followed (jsonld_items, 2026-10-30).
  {
    ...directory("https://xceed.me/en/lisboa/events", "Xceed Lisbon", ["club"]),
    kind: "jsonld",
    platform: "jsonld_items",
    // A concert, not a dance night (Lisbon - 8's live grep, 2026-10-30).
    notDanceNights: ["Tabanka Djaz - Homenagem Ao Caló Barbosa"],
  },
  // Salsa Vida's Lisbon guide: schema.org Events on each event page (Jazzy Dance Studios, UDance, Caselas,
  // BUS Paragem Cultural, Barrio Latino); robots.txt allows all, checked 2026-10-29. Read as Miami's and
  // London's are (owner, D-321).
  // Salsa Vida lists only dance nights: not a mixed calendar, so a night whose title names no dance ("Noche Habanera") stays (D-772).
  {
    ...directory("https://www.salsavida.com/guides/portugal/lisbon/", "Salsa Vida Lisbon", [
      "salsa",
      "bachata",
      "kizomba",
    ]),
    mixedCalendar: false,
  },
  // Salsa Vida's Ericeira (Mafra) and Setúbal guides, both inside the metro: BreakPoint Ericeira's Saturday Latin
  // night, Setubailas' Tuesday salsa/bachata/kizomba (D-524, 2026-10-31); read like the Lisbon guide (D-321).
  // Salsa Vida lists only dance nights: not a mixed calendar, so a night whose title names no dance ("Noche Habanera") stays (D-772).
  {
    ...directory("https://www.salsavida.com/guides/portugal/ericeira/", "Salsa Vida Ericeira", [
      "salsa",
      "bachata",
      "kizomba",
    ]),
    mixedCalendar: false,
  },
  // Salsa Vida lists only dance nights: not a mixed calendar, so a night whose title names no dance ("Noche Habanera") stays (D-772).
  {
    ...directory("https://www.salsavida.com/guides/portugal/setubal/", "Salsa Vida Setúbal", [
      "salsa",
      "bachata",
      "kizomba",
    ]),
    mixedCalendar: false,
  },
  // Viral Agenda (owner's written permission, D-383): Lisbon's dance page and the pages of six places that
  // hold dance nights. Each page carries schema.org Event JSON-LD for its next 20 events, read with no
  // model. Its national /tags/ pages are not read: they mix in Porto and carry no JSON-LD. robots.txt
  // allows /*/p/* and the /pt/lisboa/ pages, checked 2026-10-29.
  directory("https://www.viralagenda.com/pt/lisboa/dance", "Viral Agenda Lisbon dance", []),
  directory("https://www.viralagenda.com/pt/p/BlezaClube", "B.Leza (Viral Agenda)", [
    "kizomba",
    "semba",
    "kompa",
    "forro",
  ]),
  // A dance studio's own calendar, so not a mixed one: run 40959620384 retired its DanSunday as a show.
  {
    ...directory(
      "https://www.viralagenda.com/pt/p/jazzydancestudiossantos",
      "Jazzy Dance Studios (Viral Agenda)",
      ["kizomba", "semba", "kompa"],
    ),
    mixedCalendar: false,
  },
  directory(
    "https://www.viralagenda.com/pt/p/v-MilongadABarracanoBardoTeatroABarraca",
    "Milonga d'A Barraca (Viral Agenda)",
    ["milonga"],
  ),
  directory("https://www.viralagenda.com/pt/p/tradballs", "Trad Balls Lisboa (Viral Agenda)", [
    "bal_folk",
  ]),
  directory("https://www.viralagenda.com/pt/p/SwingnSmile", "Swing n' Smile (Viral Agenda)", [
    "lindy_hop",
  ]),
  directory(
    "https://www.viralagenda.com/pt/p/v-MalandrodoMarques",
    "Malandro do Marquês (Viral Agenda)",
    ["kizomba", "semba"],
  ),
  // Fábrica Braço de Prata, Poço do Bispo: Tertúlia Trad bal folk nights (2 a month, e.g. Wed 4 Nov 22:00)
  // and forró nights beside concerts, talks and classes, so the no-dance screen applies (D-551 fix 1).
  {
    ...directory(
      "https://www.viralagenda.com/pt/p/fabricabracodeprata",
      "Fábrica Braço de Prata (Viral Agenda)",
      ["bal_folk", "forro"],
    ),
    mixedCalendar: true,
  },
  // where-to-dance-salsa.com (owner's written permission, D-383): schema.org DanceEvent JSON-LD on each
  // style's Lisbon list page (~12 weekly socials, overlapping). Its dates are the site's own projection of
  // weekly nights, so it is only ever a directory. robots.txt allows these paths, checked 2026-10-29.
  {
    ...directory(
      "https://where-to-dance-salsa.com/salsa/lisbon/",
      "where-to-dance-salsa Lisbon salsa",
      ["salsa"],
    ),
    notDanceNights: SEGUNDAS_SUMMER,
  },
  {
    ...directory(
      "https://where-to-dance-salsa.com/bachata/lisbon/",
      "where-to-dance-salsa Lisbon bachata",
      ["bachata"],
    ),
    notDanceNights: SEGUNDAS_SUMMER,
  },
  {
    ...directory(
      "https://where-to-dance-salsa.com/kizomba/lisbon/",
      "where-to-dance-salsa Lisbon kizomba",
      ["kizomba"],
    ),
    notDanceNights: SEGUNDAS_SUMMER,
  },
  // Eventbrite.pt organisers found by hand from Eventbrite's public Lisbon pages, 2026-10-29 (D-131).
  eventbrite("https://www.eventbrite.pt/o/105940491441", "Portugal Social Events (Eventbrite)", [
    "salsa",
    "bachata",
  ]),
  eventbrite("https://www.eventbrite.pt/o/110874539691", "AfroLisbon (Eventbrite)", [
    "afrobeats_club",
  ]),
  // ma.to venue pages carry schema.org Events, read like Miami's (robots.txt allows /venue/; the owner allowed
  // ma.to in Lisbon, D-563, 2026-11-01). AfroLisbon's ma.to page lists nights its Eventbrite does not
  // (Afrofusion, R&B & Slow Jams, Zouk Love); EMBRASA Clube runs BAILE funk nights at Casa Capitão.
  {
    ...directory("https://ma.to/venue/afrolisbon", "AfroLisbon (ma.to)", [
      "afrobeats_club",
      "brazilian_zouk",
    ]),
    mixedCalendar: true,
    // An R&B dance party whose title names no dance style (ma.to, Sat 2026-11-07).
    danceNights: ["R&B & Slow Jams"],
  },
  {
    ...directory("https://ma.to/venue/embrasaclube", "EMBRASA Clube (ma.to)", ["baile_funk"]),
    mixedCalendar: true,
  },
  eventbrite("https://www.eventbrite.pt/o/88304503683", "Tukina Lisboa (Eventbrite)", [
    "kizomba",
    "semba",
  ]),
  eventbrite("https://www.eventbrite.pt/o/52446170193", "Black Hills Events (Eventbrite)", [
    "afrobeats_club",
  ]),
  eventbrite("https://www.eventbrite.pt/o/121333690813", "Tara Achkar 5Rhythms (Eventbrite)", [
    "five_rhythms",
  ]),
  // Emerging Waves 5Rhythms (Tara Achkar): Wednesdays 19:00-21:00 at Centro Upaya, Calçada dos Sete Moinhos 143A;
  // 5Rhythms' class finder, read with its written permission (D-523, next class 2026-11-11, checked 2026-10-31).
  {
    url: "https://www.5rhythms.com/classes/EmergingWaves-297719",
    kind: "html",
    trustTier: "first_party",
    styles: ["five_rhythms"],
    label: "Emerging Waves 5Rhythms",
  },
  // Ecstatic Dance Lisboa: retired 2026-10-29 (last event 2022-09-17), live again on 2026-10-30 with a dated
  // event on Saturday 2026-11-21, 17:00-21:00, at Liceu Pedro Nunes, Avenida Alvares Cabral, 1269-093 Lisboa.
  eventbrite("https://www.eventbrite.pt/o/51891766343", "Ecstatic Dance Lisboa (Eventbrite)", [
    "ecstatic_dance",
  ]),
  // Village Underground Lisboa, Alcântara: club nights (afro house, amapiano, techno) between concerts and talks,
  // so screened as a mixed calendar. Squarespace events list (24 upcoming on 2026-10-29); robots.txt is
  // Squarespace's default, which names AI crawlers but allows * on /eventos. Its events carry no address.
  {
    url: "https://vulisboa.com/eventos",
    kind: "squarespace",
    platform: "squarespace",
    trustTier: "first_party",
    styles: [],
    label: "Village Underground Lisboa",
    venuePage: true,
    venueAddress: "Avenida da Índia 52, 1300-299 Lisboa",
    mixedCalendar: true,
  },
  // TEJÁ House, Cais do Sodré: a culture house whose own events page mixes ecstatic dance, day parties and
  // dance workshops with yoga, singing circles and talks, so screened as a mixed calendar. Dates in the HTML
  // (~20 dated rows on 2026-10-29); robots.txt allows /events.
  // Its own footer gives "Cais do Sodré 5, 1200-109 Lisboa, Portugal" (2026-10-29).
  {
    url: "https://www.tejahouse.com/events",
    kind: "html",
    trustTier: "first_party",
    styles: [],
    label: "TEJÁ House",
    venuePage: true,
    venueAddress: "Cais do Sodré 5, 1200-109 Lisboa",
    mixedCalendar: true,
  },
  // SerVivo (Palmela): discovery found its own calendar, which mixes dance nights with ceramics classes (read
  // 41284858945 wrote "Ceramic and Glass fusing Classes"), so it is seeded only to be screened as a mixed calendar.
  {
    url: "https://www.servivo.earth/",
    kind: "jsonld",
    trustTier: "first_party",
    styles: [],
    label: "SerVivo",
    venuePage: true,
    mixedCalendar: true,
  },
  // DJ-bar sweep (owner 2026-10-30, D-384): bars and clubs where people dance to a DJ, read from their own
  // sites, except DARC, whose dated nights appear only on Viral Agenda (D-383).
  // Casa Independente, Largo do Intendente: its own /agenda/ lists dated DJ sets on Fridays and Saturdays at
  // 23:00 (four in October 2026) between concerts and afro matinées, so screened as a mixed calendar. robots.txt
  // (WordPress) disallows only /wp-admin/, checked 2026-10-30.
  {
    url: "https://casaindependente.com/agenda/",
    kind: "html",
    trustTier: "first_party",
    styles: ["dj_night"],
    label: "Casa Independente",
    venuePage: true,
    venueAddress: "Largo do Intendente Pina Manique 45, 1100-285 Lisboa",
    onlyHere: true,
    mixedCalendar: true,
  },
  // Trumps, Príncipe Real: the LGBTQIA+ club's own events page lists its dated parties (Fri 30 Oct, Sat 31 Oct
  // 2026: "DJs: Tribal & House, Dancefloor: Pop & Funk"). robots.txt (WordPress) disallows only /wp-admin/,
  // checked 2026-10-30. Address from OSM (node 6047546785); the site gives none.
  {
    url: "https://trumps.pt/shop/events/",
    kind: "html",
    trustTier: "first_party",
    styles: ["queer_party", "dj_night"],
    label: "Trumps",
    venuePage: true,
    venueAddress: "Rua da Imprensa Nacional 104B, 1250-127 Lisboa",
    onlyHere: true,
  },
  // Lisboa Rio Club, Cais do Gás (Cais do Sodré): restaurant by day, club at weekends (baile funk, reggaeton,
  // themed parties). Its own site's "Events" button goes to its Xceed venue page, which carries Event JSON-LD
  // and links to each night; Xceed's terms are covered by the owner's yes (D-382). Found by the blocked-platform
  // audit (Shotgun, D-758, 2026-11-06).
  {
    ...directory("https://xceed.me/en/lisboa/venue/lisboa-rio-club", "Lisboa Rio Club (Xceed)", [
      "club",
    ]),
    kind: "jsonld",
    platform: "jsonld_items",
  },
  // Bonança, Associação Naval de Lisboa, Doca de Belém: restaurant that turns club on Fri/Sat nights (Tormenta
  // guest DJs, to 03:00). Its own site's "our next events" link is its 3cket organiser page, which lists the dated
  // nights as text ("6 nov às 23:00"). 3cket robots.txt allows all, checked 2026-11-06. Found by the
  // blocked-platform audit (Shotgun, D-758, 2026-11-06).
  {
    url: "https://3cket.com/pt/organizer/Bonanca",
    kind: "html",
    trustTier: "ticketing",
    styles: ["dj_night"],
    label: "Bonança (3cket)",
    venuePage: true,
    venueAddress: "Doca de Belém, 1400-038 Lisboa",
    onlyHere: true,
  },
  // K Urban Beach, Cais da Viscondessa (Santos riverside): its own home page lists dated club nights for the next
  // ten days (Konnect Sun, Eklipse Tue, Insanity Wed, Thu, Oasis Fri, XoXo Sat; 23:00-06:00) and says "Open every
  // day from 23:00 - 06:00". robots.txt (WordPress) disallows only /wp-admin/, checked 2026-10-31 (D-524). Overture
  // carries grupo-k.pt for it, so discovery never found this page.
  {
    url: "https://urbanbeach.pt/",
    kind: "html",
    trustTier: "first_party",
    styles: ["dj_night"],
    label: "K Urban Beach",
    venuePage: true,
    venueAddress: "Cais da Viscondessa, 1200-109 Lisboa",
  },
  // POSH Club, Rua de São Bento 157 (São Bento): LGBTQIA+ discoteca since 2018, "um espaço seguro, acolhedor e feito
  // para dançar" (its own site). Its home page names the next party with date and time ("Alice in Halloweenland 31
  // Outubro · 23h59"); its full list is on Shotgun, which we do not read (Vercel bot check, D-541), so this page is
  // its only source. No robots.txt (the path serves the home page), checked 2026-10-31.
  {
    url: "https://poshclub.pt/",
    kind: "html",
    trustTier: "first_party",
    styles: ["queer_party", "dj_night"],
    label: "POSH Club",
    venuePage: true,
    venueAddress: "Rua de São Bento 157, Lisboa",
    onlyHere: true,
  },
  // Lust in Rio, Cais do Sodré riverside: its own programme page gives a fixed weekly programme, Wednesday to
  // Saturday 00:00-06:00 (Wed Qu4rto Escuro, Thu Pegadinha "todas as quintas-feiras", Fri Blah Blah Blah "todas
  // as sextas-feiras", Sat Complô), read as weekly nights: the owner, 2026-10-30, "A bars own weekly can count"
  // (D-384, the D-402 weekly-grid rule). Address from its own site. robots.txt disallows only /wp-admin/,
  // checked 2026-10-30.
  {
    url: "https://lustinrio.pt/eventos-programa-lust-in-rio-discoteca/",
    kind: "html",
    trustTier: "first_party",
    styles: ["dj_night", "baile_funk"],
    label: "Lust in Rio",
    venuePage: true,
    venueAddress: "Rua da Cintura do Porto de Lisboa, 1200-109 Lisboa",
    weeklyGrid: true,
    onlyHere: true,
    // Its nights are named, with no dance word in the name (coverage-58, 2026-10-30).
    danceNights: ["Qu4rto Escuro", "Pegadinha", "Blah Blah Blah", "Complô"],
    // Its home page states its hours: "Quarta-feira a Sábado 00:00 to 06:00" (2026-10-30, D-494).
    houseHours: {
      start: "00:00",
      end: "06:00",
      days: [3, 4, 5, 6],
      checked: "lustinrio.pt home page: 'Quarta-feira a Sábado 00:00 to 06:00' (2026-10-30)",
    },
  },
  // Jamaica (with Tokyo next door), Cais do Gás 1, Cais do Sodré: its own home page states its weekly hours,
  // "Abertos de 4ª a Sábado das 00h às 07h00", and says people dance there ("convivem, dançam e vivem num
  // espírito muito próprio"), D-527. Listed as a fixed weekly night (D-524 #3, fixedNights #891), only while that
  // line stays on the page. robots.txt disallows only /wp-admin/, checked 2026-10-31.
  {
    url: "https://jamaica.com.pt/",
    kind: "html",
    trustTier: "first_party",
    styles: ["dj_night"],
    label: "Jamaica",
    venuePage: true,
    venueAddress: "Cais do Gás 1, 1200-109 Lisboa",
    onlyHere: true,
    fixedNights: [
      {
        title: "Jamaica",
        line: "Abertos de 4ª a Sábado das 00h às 07h00",
        days: [3, 4, 5, 6],
        start: "00:00",
        end: "07:00",
        danceCited:
          "jamaica.com.pt home page: 'Há mais de 50 anos que o Jamaica é um ponto de encontro ... que aqui convivem, dançam e vivem' (checked 2026-10-31)",
      },
    ],
  },
  // Finalmente Club, Rua da Palmeira 38, Príncipe Real: Lisbon's drag-show discoteca since 1976. Its own home page
  // states "Discoteca Finalmente Club Aberto todos os dias das 1:00h às 6:00h. Espetáculo às 3:00h" and Time Out PT's
  // best discotecas list (modified 2026-10-19) has it; coverage-81 ruled 2026-10-31 that a self-described discoteca
  // with a DJ, so listed, is dance evidence (D-527). Fixed weekly night every night (D-524 #2, fixedNights #891).
  // robots.txt allows / (disallows /wp-admin/, /wp-includes/ and query URLs), checked 2026-10-31.
  {
    url: "https://www.finalmenteclub.com/",
    kind: "html",
    trustTier: "first_party",
    styles: ["dj_night"],
    label: "Finalmente Club",
    venuePage: true,
    venueAddress: "Rua da Palmeira 38, 1200-313 Lisboa",
    onlyHere: true,
    notDanceNights: ["Grandioso Show de Variedades"],
    fixedNights: [
      {
        title: "Finalmente Club (discoteca)",
        line: "Discoteca Finalmente Club Aberto todos os dias das 1:00h às 6:00h",
        days: [0, 1, 2, 3, 4, 5, 6],
        start: "01:00",
        end: "06:00",
        danceCited:
          "finalmenteclub.com home page: 'Discoteca Finalmente Club Aberto todos os dias das 1:00h às 6:00h' with a resident DJ; Time Out PT 'melhores discotecas' (modified 2026-10-19): 'uma das discotecas mais antigas e emblemáticas da noite gay lisboeta' (checked 2026-10-31)",
      },
    ],
  },
  // DARC - Desterro, Santa Maria Maior: club nights (Fim de Emissão, Alienação, label nights; 4 dated from
  // 30 Oct to 20 Nov 2026) beside concerts and a film festival. Its own site was not found; its Viral Agenda
  // page carries schema.org Event JSON-LD (D-383 permission).
  {
    ...directory("https://www.viralagenda.com/pt/p/darclx", "DARC - Desterro (Viral Agenda)", [
      "dj_night",
      "electronic",
    ]),
    // A band's concert, read 2026-11-12.
    notDanceNights: ["Russian Library *"],
  },
  // Swing Station, Lisbon's lindy hop school: The Events Calendar's REST API (robots.txt allows it). It listed
  // no events on 2026-10-29; read so its socials appear when they are published.
  {
    url: "https://swingstation.pt/agenda/",
    kind: "wp_tribe",
    feedUrl: "https://swingstation.pt/wp-json/tribe/events/v1/events",
    trustTier: "first_party",
    styles: ["lindy_hop"],
    label: "Swing Station",
    mixedCalendar: true,
  },
  // Fábrica de Alternativas (Algés), found by discovery: its Events Calendar iCal feed lists tango, Afro-Latin and
  // European folk dance classes beside concerts and an open rehearsal (read 2026-11-12).
  {
    url: "https://fabricadealternativas.pt/",
    kind: "feed_ics",
    feedUrl: "https://fabricadealternativas.pt/eventos/?ical=1",
    trustTier: "first_party",
    styles: ["tango", "folk"],
    label: "Fábrica de Alternativas",
    mixedCalendar: true,
    notDanceNights: ["Ensaio Aberto", "Ensaio Aberto *"],
  },
  // Dance & Connect: salsa, bachata and kizomba socials; its own iCal feed (robots.txt does not disallow it).
  meetup("dance-connect-salsa-bachata-kizomba", "Dance & Connect Lisbon (Meetup)", [
    "salsa",
    "bachata",
    "kizomba",
  ]),
  // Bachata Lisboa: bachata socials several nights a week; its own iCal feed held 8 dated events on
  // 2026-10-29 (robots.txt does not disallow it). Research sweep, D-249.
  meetup("bachata_lisboa", "Bachata Lisboa (Meetup)", ["bachata", "salsa"]),
  // TangoLX's "Agenda of Tango for Lisbon": a public Google Calendar the tango community keeps (linked from
  // tangolx.com), with weekly milongas (Monday a Outra Milonga, Tuesday A Todo Tango, Wednesday Tango na Rua,
  // Sunday Milonga d'A Barraca) and monthly ones as RRULEs, plus one-off milongas; 22 live rules and 11 dated
  // events to 2026-11-30 on 2026-10-29. Most events carry no LOCATION, so those stay unplaced (flagged).
  // Read through the Calendar API (D-130), as Mexico City's agendatangomx calendar: as feed_ics it wrote 0 on run
  // 40943335594. Research sweep, D-249.
  // Tango only (milongas, practicas), so not a mixed calendar: run 40955491033 retired two practicas as shows.
  // Rows with no LOCATION take their venue from titleVenues below; Tango na Rua moves weekly, so it has none.
  {
    url: "https://www.tangolx.com/",
    kind: "feed_gcal",
    platform: "feed_gcal",
    feedUrl: "https://calendar.google.com/calendar/embed?src=agendatangolx%40gmail.com",
    trustTier: "directory",
    styles: ["tango"],
    label: "TangoLX tango agenda (Google Calendar)",
    // Regular milongas whose calendar rows carry no place, to the venue TangoLX's own list of regular milongas
    // names (tangolx.com/milongas-1, 2026-10-30); each venue is a Lisbon KnownVenue with a checked point (D-279).
    titleVenues: {
      "Milonga Guapa": "Academia do Lumiar",
      "Outra Milonga": "Clube Ferroviario",
      "Rave Tanguera": "Clube Ferroviario",
      "Rave Tanguerra": "Clube Ferroviario",
      "Milonga La Gata": "ADF",
      "Milonga La Orillera": "Sporting Clube da Penha",
      "Milonga Dirigida": "Sociedade Recreativa Musical de Carcavelos",
      "Milonga A Promotora": "A Promotora",
      "Milonga Tango Brujo": "Casa do Concelho de Castanheira de Pera",
      "Milonga d'A Barraca": "Teatro A Barraca",
      // Not "Milonga A Todo Tango" itself: the Tuesday milonga is at Rua dos Fanqueiros 286 (no checked point),
      // and that phrase would also match the Delux titles.
      "Todo Tango Delux": "Casa do Concelho de Tomar",
      "Fusion Dance Party": "Galeria Antecâmara",
    },
  },
  // Blues & Swing Lisboa, a blues, balboa and lindy hop school: its own events page (a Google Site) lists dated
  // practices and jams (Beer&Blues, Beer&Balboa at Flor de Lupulo, Tea&Jam); robots.txt allows it, 2026-10-29.
  // Read with a model. Research sweep, D-249.
  {
    url: "https://www.bluesswinglisboa.com/eventos",
    kind: "html",
    trustTier: "first_party",
    styles: ["blues", "balboa", "lindy_hop"],
    label: "Blues & Swing Lisboa",
    mixedCalendar: true,
  },
  // Little Big Apple, a lindy hop school: its own agenda page (swing jam sessions with a house band, parties
  // such as the Halloween party of 2026-10-30); robots.txt allows it, 2026-10-29. Address from its own footer.
  // Read with a model. Research sweep, D-249.
  {
    url: "https://littlebigapple.pt/agenda/",
    kind: "html",
    trustTier: "first_party",
    styles: ["lindy_hop", "swing"],
    label: "Little Big Apple",
    venuePage: true,
    venueAddress: "Rua Professor Mira Fernandes 10A, Loja B, 1900-381 Lisboa",
    mixedCalendar: true,
  },
  // Salsa Lisboa: a community page listing every salsa, Cuban and rueda night in Lisbon for the current week,
  // with times, venues and prices (Tuesday Only Cuban at Asha's Place, Wednesday Dale Mambo rueda and La Salsa
  // del Pueblo, Friday Salsa no Mercado, B.leza). robots.txt allows all, 2026-10-29. Found by coverage's
  // serper-gap run 40934081918. A directory, read with a model. Research sweep, D-249.
  // Every row is a salsa, Cuban or rueda night, so it is not a mixed calendar: "Casino", "A lo Cubano" and
  // "DanSunday" name no dance word and were retired as shows on run 40955491033.
  {
    ...directory("https://salsalisbon.com/", "Salsa Lisboa (weekly salsa nights)", [
      "salsa",
      "rueda",
    ]),
    mixedCalendar: false,
  },
  // Time Out Market Lisboa's own dance nights, as Time Out lists them (as NYC's Time Out Market Union Square,
  // D-163): the pages name no street, so the seed carries the market's address (Av. 24 de Julho 49, the
  // Mercado da Ribeira; Time Out, 2026-10-29). Salsa no Mercado (dated nights 2026-10-30 and 2026-11-27 on
  // 2026-10-30), forro "Baiao no Mercado" (monthly; dated nights 2026-11-06 and 2026-11-22). robots.txt allows these pages. Research sweep, D-249.
  // Samba de gafieira (Tuesdays) was retired 2026-10-30: its page lists only 2025-09-02.
  {
    ...directory(
      "https://www.timeout.com/time-out-market-lisboa/things-to-do/salsa-no-mercado",
      "Time Out Market Lisboa: salsa",
      ["salsa"],
    ),
    venueAddress: "Av. 24 de Julho 49, 1200-479 Lisboa",
  },
  {
    ...directory(
      "https://www.timeout.com/time-out-market-lisboa/things-to-do/baiao-no-mercado",
      "Time Out Market Lisboa: forro (Baiao no Mercado)",
      ["forro"],
    ),
    venueAddress: "Av. 24 de Julho 49, 1200-479 Lisboa",
  },
  {
    ...directory(
      "https://www.timeout.com/time-out-market-lisboa/things-to-do/baiao-no-mercado-1",
      "Time Out Market Lisboa: forro (Forro no Mercado)",
      ["forro"],
    ),
    venueAddress: "Av. 24 de Julho 49, 1200-479 Lisboa",
  },
  // Comunidade Hindu de Portugal (Radha Krishna temple, Lumiar): Navaratri garba nights and Bollywood Holi
  // beside staged shows (the Diwali Show) and religious events, so the no-dance screen applies. Wix page;
  // the server HTML carries the event dates; robots.txt allows it (D-551 fix 3).
  {
    ...directory("https://www.comunidadehindu.org/en/event-list", "Comunidade Hindu de Portugal", [
      "garba",
      "bollywood",
    ]),
    mixedCalendar: true,
  },
];

/** Starting addresses retired, each with the reason (D-047). */
export const LISBON_RETIRED: readonly RetiredSource[] = [
  {
    url: "https://www.timeout.com/time-out-market-lisboa/things-to-do/samba-de-gafieira",
    reason:
      "Time Out Market Lisboa's samba de gafieira page lists only Tuesday 2025-09-02 (checked 2026-10-30) and wrote 0 on Lisbon's full read 41021582639",
  },
  {
    url: "https://www.casa-lac.com/programa",
    reason:
      "CASA - Laboratório de criação's programme lists no dance nights: read 41403215771 (2026-11-02) wrote only an English lesson (twice) and called its other 16 rows not events, even screened as a mixed calendar",
  },
  // Found by discovery: a bartending school's course list.
  {
    url: "https://cocktailteam.net/agenda-de-cursos/",
    reason:
      'a bartending school\'s course calendar ("International Premium Bartender"), no dance nights (coverage 2026-11-12)',
  },
  // DICE genre pages with no Lisbon page: each answered a 307 redirect to the gig list (2026-10-29).
  ...DICE_GENRES.filter(([path]) => !LISBON_DICE_GENRES.has(path)).map(([path]) => ({
    url: `${DICE_BROWSE}/${path}`,
    reason:
      "DICE has no Lisbon page for this genre: it answers a 307 redirect to the gig list and wrote 0 on Lisbon's full read (2026-10-29, run 40924196347)",
  })),
];
