// San Juan's starting sources (D-460). US rules (D-034): official APIs and public pages, robots.txt honoured;
// Resident Advisor, Facebook and Instagram never. Sources are added as they are checked; the daily run also
// seeds venues and discovers their websites (D-120).

import type { RetiredSource, SeedSource } from "@/config/sources/nyc";
import type { StyleKey } from "@/config/styles";

/** An organiser's Eventbrite page, read through the official API by organiser ID (D-131, D-205). */
const eventbrite = (
  url: string,
  label: string,
  styles: StyleKey[],
  mixedCalendar = true,
): SeedSource => ({
  url,
  kind: "ticketing_api",
  trustTier: "ticketing",
  platform: "eventbrite",
  styles,
  label,
  mixedCalendar,
});

export const SAN_JUAN_SOURCES: readonly SeedSource[] = [
  // Salsa Vida's San Juan guide: schema.org Events on the page (16 on 10/29, 10/29-11/11; 12 in San Juan,
  // 4 in Carolina), robots.txt allows all. A directory, never first_party (D-061, D-072).
  {
    url: "https://www.salsavida.com/guides/puerto-rico/san-juan/",
    kind: "html",
    trustTier: "directory",
    styles: ["salsa", "bachata"],
    label: "Salsa Vida San Juan",
  },
  // Viajando y Bailando's Puerto Rico agenda (Modern Events Calendar): about 4 dated salsa nights a day across
  // San Juan, Guaynabo and Carolina, each with a street address. robots.txt allows this path (only
  // /agendapuertorico/action~ views are disallowed); no terms page. Island-wide, so the metro outline drops
  // Rincon and other towns. A directory. Read from the category's RSS feed (mec_rss, #498): each item carries
  // mec:startDate, mec:startHour, mec:endHour and mec:location. The page itself (read whole as "probed" since
  // #475) gave dates but no times, so run 40947386186 left all 12 rows untimed.
  {
    url: "https://viajandoybailando.com/mec-category/puerto-rico/",
    feedUrl: "https://viajandoybailando.com/mec-category/puerto-rico/feed/",
    kind: "jsonld",
    platform: "mec_rss",
    trustTier: "directory",
    styles: ["salsa"],
    label: "Viajando y Bailando",
    // Weekly rules from each event page's calendar link (D-466); retired 8 days after the feed stops giving them (D-465).
    eventPageWeekly: true,
    // Titles start with its area label ("Carolina / Isla Verde: "); dropped so other sources' nights match (D-515).
    titleAreaPrefix: true,
  },
  // Cambio en Clave, a salsa school since 2006: its own events page lists its free monthly socials with dates
  // and times (Casa BACARDÍ, Cataño, first Saturdays 6pm; Liberty Square, Guaynabo, a Wednesday 7pm; Rumbón
  // Salsero at the Museo de Arte de Puerto Rico). robots.txt allows /eventos (its /api/calendar.ics is
  // disallowed, so not read); its policies page has no clause against reading. Found in the second research
  // pass (2026-10-30). The calendar page beside it also lists classes, so this reads the events list.
  {
    url: "https://www.cambioenclave.com/eventos",
    kind: "html",
    trustTier: "first_party",
    styles: ["salsa"],
    label: "Cambio en Clave",
    mixedCalendar: true,
  },
  // En Mi Patio PR's culture calendar (D-462): its owners said yes to our reading it (the owner, 2026-10-30); its
  // terms otherwise bar reuse without written permission. robots.txt allows * (it blocks AI-training bots).
  // About 8 bomba, plena and salsa series in the metro (Downtown Cupey Thursdays, El Punto Sabroso Cataño
  // Mondays, El Refugio Rio Piedras Tuesdays, El Gandul Wednesdays, La Placita, Bayamon bombazo). The
  // enmipatio reader keeps dance rows and reads each event page's own dates; no descriptions are copied.
  {
    url: "https://enmipatiopr.com/event",
    kind: "jsonld",
    platform: "enmipatio",
    trustTier: "directory",
    styles: ["bomba", "salsa"],
    label: "En Mi Patio PR",
    mixedCalendar: true,
    // Bomba and plena nights, where the dancers answer the drums: their titles name no dance word (bare "bomba"
    // and "plena" never match, D-235), so the screen left all 10 rows out on full read 41166147750 (2026-10-31).
    // Each event page's pin is in the metro: Tito Matos and Tambuyé in Río Piedras, El Gandul in Santurce, Cataño's
    // Monday plena, Salitre on Calle Loíza. El Imán (Loíza, outside the metro) stays out (D-464).
    danceNights: [
      "Lunes de Plena y Bomba en Puerto Rico: música, arte y cultura",
      "Celebra el espíritu de la plena de Puerto Rico en los Lunes de Tito Matos",
      "Siente el ritmo de Puerto Rico en los Martes de Bomba de Tambuyé",
      "Miércoles de Plena en El Gandul: Música y Cultura Puertorriqueña",
      "Bombas comunitarias de salitre: Preservando las raíces culturales",
    ],
  },
  // Platea PR's island-wide culture calendar (D-760, D-758 audit; written permission, the owner 2026-10-30). One Next.js list page
  // carries every event's title, start, venue and town; the platea reader keeps dance titles in the five municipios
  // (Salsa en el Patio at the MAC, MAPR's Noche de Merengue, Downtown Cupey salsa classes). A directory.
  {
    url: "https://www.plateapr.com/eventos",
    kind: "jsonld",
    platform: "platea",
    trustTier: "directory",
    styles: ["salsa", "bomba"],
    label: "Platea PR",
    mixedCalendar: true,
  },
  // DanceUS's Puerto Rico salsa calendar (D-461): its owner said yes to our reading it (the owner, 2026-10-29); its
  // terms (2.1) otherwise forbid reuse. robots.txt allows /events/salsa/ (checked 2026-10-29). About 25 dated
  // rows a week, all in San Juan and Carolina; the only source for Red Coral Lounge (Thu-Sun), Vaca Brava,
  // Taberna Los Vazquez, the InterContinental's Fridays and Picante Lounge. Classes sit beside the socials, hence
  // mixedCalendar. Start times are in the page text, not its JSON-LD, so it is read as html.
  {
    url: "https://www.danceus.org/events/salsa/puerto-rico-salsa-calendar/",
    kind: "html",
    trustTier: "directory",
    styles: ["salsa", "bachata"],
    label: "DanceUS Puerto Rico salsa",
    mixedCalendar: true,
    // Its rolling calendar gives each weekly night its next date only; the event's own page says "Recurring"
    // and names the weekday (Taberna Los Vázquez, InterContinental, Red Coral Lounge Fridays), D-465.
    eventPageWeekly: true,
    // The Fairmont El San Juan's own events feed (elsanjuanhotel.com/wp-json/wp/v2/events, 38 events, checked
    // 2026-10-31) has no Wednesday music night (Wednesday is "Wine Wednesday" at Caña), so DanceUS's Wednesday
    // listing is stale: the venue's own page wins (coverage, D-515).
    notDanceNights: [
      "Sounds Of Puerto Rico Wednesdays @ El San Juan Hotel lobby bar",
      "Sounds of Puerto Rico Wednesdays",
    ],
  },
  // Party organisers that sell their San Juan nights on Eventbrite, found 2026-10-29 on Eventbrite's
  // public San Juan search pages; each listed an upcoming party in San Juan that day. Their calendars
  // also carry dinners and shows, hence mixedCalendar. Checked and left out: NIA WARD and
  // T.S. Entertainment (their parties are in St Thomas and St Croix, US Virgin Islands), Wyndham Palmas
  // (Rio Grande, outside), Fort Buchanan MWR, El Oasis Hotel (Aguada), one-off private hosts.
  // Ajay Omowale's page is mixed (dinners, shows), but AFRO BEACH is its recurring Afro-Caribbean DJ beach party
  // (1043 Ashford Ave); its title names no dance, so the screen dropped it (run 41019595108, 15 not events).
  {
    ...eventbrite(
      "https://www.eventbrite.com/o/ajay-omowale-75715835563",
      "Ajay Omowale (Eventbrite)",
      ["afrobeats_club"],
    ),
    danceNights: ["AFRO BEACH: A Caribbean & Afro Diaspora Experience", "AFRO BEACH"],
  },
  // Da Sunday Cookout's organiser lists only its weekly Sunday day party ("Music by International Deejay Ajay
  // Omowale & guests"), so every row is a dance party and is not screened as a mixed calendar. The 4 rows were
  // screened out on the full read of 2026-10-29 (run 40936987189). Ajay Omowale's own page stays mixed: its
  // "Soul Food in San Juan" rows are a restaurant. Its title names no dance, so the no-dance screen dropped the
  // series' dates once D-272 read them (run 40976673290); danceNights keeps them (D-264).
  {
    ...eventbrite(
      "https://www.eventbrite.com/o/veronica-cint-ajay-omowale-63004394003",
      "Da Sunday Cookout PR (Eventbrite)",
      ["afrobeats_club"],
      false,
    ),
    danceNights: ["Da Sunday Cookout PR", "Da Sunday Cookout"],
  },
  eventbrite(
    "https://www.eventbrite.com/o/bienhecho-group-corp-29253252321",
    "Bienhecho Group (Eventbrite)",
    ["afrobeats_club"],
  ),
  eventbrite(
    "https://www.eventbrite.com/o/kweens-klub-belart-entertainment-64377337803",
    "Kweens Klub / Belart (Eventbrite)",
    ["queer_party"],
  ),
  // Out x Out's San Juan LGBTQ+ events calendar: read daily with its written yes (D-545, the owner 2026-10-31); its Terms
  // of Service otherwise bar scrapers and aggregation. robots.txt allows /events/ (disallows only /api/, /admin and
  // similar). On 2026-10-31 it listed no events for the week; its venue pages give prose only (no dates or hours),
  // so they are not read. A directory; a mixed calendar (drag shows, beach parties and club nights).
  {
    url: "https://outxout.com/events/san-juan-pr",
    kind: "html",
    trustTier: "directory",
    styles: ["queer_party", "dj_night"],
    label: "Out x Out San Juan",
    mixedCalendar: true,
  },
  // Club Brava, Fairmont El San Juan Hotel, Isla Verde: the hotel's own page for the club names a "lively dance
  // floor and an Open Format DJ" and fixed weekly hours with no dates, "Thursday 10:00 p.m. to 4:00 a.m." and
  // "Friday & Saturday 11:00 p.m. to 4:00 a.m." (checked 2026-10-31), read as weekly nights: "A bars own weekly
  // can count" (the owner, 2026-10-30; the D-402 weekly-grid rule; D-524 gap list #4, coverage - 80 OK). Replaces
  // clubbrava.com, which names no nights. Address from the same page. robots.txt does not disallow /en/hotels/
  // (checked 2026-10-31).
  {
    url: "https://www.fairmont.com/en/hotels/puerto-rico/fairmont-el-san-juan-hotel/dining/club-brava.bar.html",
    kind: "html",
    trustTier: "first_party",
    styles: ["dj_night"],
    label: "Club Brava",
    venuePage: true,
    venueAddress: "6063 Isla Verde Avenue, Carolina, Puerto Rico 00979",
    weeklyGrid: true,
    onlyHere: true,
    // The club's name is its night and names no dance (D-264).
    danceNights: ["Club Brava"],
    // Read 41311341010 (2026-11-01) wrote its Friday and Saturday nights untimed and missed Thursday (the weekly-grid
    // rule kept only "Friday & Saturday"), so both nights are listed from the page's own hours lines instead, while
    // those lines are on the page (coverage - 87, 2026-11-01). They replace the model's "Club Brava" rows.
    fixedNights: [
      {
        title: "Club Brava",
        line: "Thursday 10:00 p.m. to 4:00 a.m.",
        days: [4],
        start: "22:00",
        end: "04:00",
        danceCited:
          "fairmont.com Club Brava page: 'The Main Floor buzzes with energy, featuring a lively dance floor and an Open Format DJ' (2026-11-01)",
        replacesTitles: ["Club Brava"],
      },
      {
        title: "Club Brava (Fri & Sat)",
        line: "Friday & Saturday 11:00 p.m. to 4:00 a.m.",
        days: [5, 6],
        start: "23:00",
        end: "04:00",
        danceCited:
          "fairmont.com Club Brava page: 'The Main Floor buzzes with energy, featuring a lively dance floor and an Open Format DJ' (2026-11-01)",
        replacesTitles: ["Club Brava"],
      },
    ],
  },
  // Three venues' own Instagram accounts naming their weekly dance nights (D-797), read by hand in the owner's Chrome by
  // "Dancetonight Chrome audit - wave 4 - 8" on 2026-11-09; never fetched. Each was a miss in the SJ recall check
  // (diag 42640474680, 11-07/11-08). Recheck monthly.
  // Taberna Los Vázquez, La Placita de Santurce: live music Fri-Sun from 7 pm "para que puedas venir a bailar"
  // (Thursday is karaoke, left out). DanceUS lists its Fridays only.
  {
    url: "https://www.instagram.com/tabernalosvazquezpr/",
    kind: "html",
    trustTier: "first_party",
    styles: ["salsa"],
    label: "Taberna Los Vázquez (Instagram)",
    handChecked: true,
    onlyHere: true,
    venueAddress: "Taberna Los Vázquez, 1348 Calle Orbeta, La Placita de Santurce, San Juan, PR",
    venuePage: false,
    fixedNights: [
      {
        title: "Música en vivo (live salsa)",
        line: "Bio: 'Música en vivo V-D 7PM'",
        days: [5, 6, 0],
        start: "19:00",
        styles: ["salsa"],
        danceCited:
          "'música en vivo todos los viernes, sábados y domingos—para que puedas venir a bailar', IG post 2026-11-05",
        checkedOn: "2026-11-09",
        evidenceUrl: "https://www.instagram.com/p/DfXJBaZuchk/",
      },
    ],
  },
  // La Factoría, Old San Juan: salsa every Sunday and Monday from 10 pm (bio); no Saturday salsoteca on its IG.
  {
    url: "https://www.instagram.com/lafactoriapr/",
    kind: "html",
    trustTier: "first_party",
    styles: ["salsa"],
    label: "La Factoría (Instagram)",
    handChecked: true,
    onlyHere: true,
    venueAddress: "La Factoría, 148 Calle San Sebastián, Old San Juan, PR",
    venuePage: false,
    fixedNights: [
      {
        title: "Salsa Sunday & Monday",
        line: "Bio: 'Salsa every Sunday & Monday 10pm'",
        days: [0, 1],
        start: "22:00",
        styles: ["salsa"],
        danceCited: "'Come up to the 2nd floor for our regular salsa DJs', IG post 2026-10-21",
        checkedOn: "2026-11-09",
        evidenceUrl: "https://www.instagram.com/p/Dexc_adFoEE/",
      },
    ],
  },
  // La Respuesta, Santurce: "Salsa Sunday" (organiser @g.velez, collab posts on the venue's account), live band,
  // 8 pm to 1 am with a salsa class at 8:30; running about a year (11-15 post: "cerrando el primer año").
  {
    url: "https://www.instagram.com/larespuestapr/",
    kind: "html",
    trustTier: "first_party",
    styles: ["salsa"],
    label: "La Respuesta (Instagram)",
    handChecked: true,
    onlyHere: true,
    venueAddress: "La Respuesta, 1600 Ave. Fernández Juncos, Santurce, San Juan, PR 00909",
    venuePage: false,
    fixedNights: [
      {
        title: "Salsa Sunday",
        line: "'SALSA SUNDAY en @larespuestapr ... en vivo ... 8pm-1am ... Clase de salsa: 8:30'",
        days: [0],
        start: "20:00",
        end: "01:00",
        styles: ["salsa"],
        danceCited: "'Clase de salsa: 8:30', IG post 2026-10-30",
        checkedOn: "2026-11-09",
        evidenceUrl: "https://www.instagram.com/p/DfIzrRtuoFt/",
      },
    ],
  },
];

/** Starting addresses retired, each with the reason (D-047). */
export const SAN_JUAN_RETIRED: readonly RetiredSource[] = [
  // Platea's Monday-bars article (D-463, #723): on full read 41166147750 (2026-10-31) the model gave La Terraza
  // de Bonanza the bar's 10:00 opening hour as its start and no place, and read no date for El Boricua's "Lunes de
  // plena". Retired until a weekly-night reader for guide pages exists (coverage).
  {
    url: "https://www.plateapr.com/que-comer/barras-abiertas-lunes-zona-metro",
    reason:
      "Platea's list of bars open on Mondays: the model read La Terraza de Bonanza at the bar's 10:00 opening hour with no place, and no date for El Boricua's Lunes de plena (run 41166147750, 2026-10-31)",
  },
  // Switched on by discovery on the first San Juan run (2026-10-29).
  {
    url: "https://www.condadovanderbilt.com/happenings/",
    reason:
      'The Condado Vanderbilt hotel\'s dining and bar calendar, not dance nights: its 16 rows on the first San Juan run (2026-10-29) were "Cocktails & Bites", "Deadly Delicious", "STK: Deadly Delicious", "Tequila & Tunes" and similar, 10 with no time and 3 with no place',
  },
  // Switched on by discovery on 2026-11-01.
  {
    url: "https://www.sanjuansipandpaint.com/ladies-night",
    reason:
      'San Juan Sip & Paint\'s "ladies night" page is a craft studio\'s calendar, not dancing: run 41311341010 (2026-11-01) wrote 4 "Whipped Wax Dessert Candle Workshop" rows, all with no place',
  },
  {
    url: "https://www.clubbrava.com/brava",
    reason:
      "Club Brava's Squarespace page at El San Juan Hotel names no dated nights: 0 written on the first run (2026-10-29) and on the full read of 2026-10-29 (run 40918213668). Replaced by the hotel's Club Brava page with its weekly hours (D-524 #4, 2026-10-31)",
  },
];
