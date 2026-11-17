// Mexico City's starting sources (D-440). US rules (D-034, the owner's choice for Mexico, 2026-10-29): official APIs and public pages, robots.txt honoured; Facebook and Instagram never. Resident Advisor through its GraphQL listings only (D-505, area 399 in config/sources/ra.ts). Mexican screen words and the MXN "$" rule (coverage, D-229/D-230) ship before any venue page.

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

const eventbrite = (url: string, label: string, styles: StyleKey[]): SeedSource => ({
  url,
  kind: "ticketing_api",
  trustTier: "ticketing",
  platform: "eventbrite",
  styles,
  label,
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

export const MEXICO_CITY_SOURCES: readonly SeedSource[] = [
  // Salsa Vida, schema.org Events in the page's ItemList (24 on 10/29: Mama Rumba, San Luis Club, La Flor del Son,
  // Gran Salón El Incomparable, Be Bops Roma); nights in Nezahualcóyotl, Tlalnepantla and Cuautitlán Izcalli are
  // outside the city and left out by the outside-towns list. robots.txt allows it (checked 2026-10-29).
  // Salsa Candela's page is weekly classes (Monday/Wednesday and Tuesday/Thursday cohorts) plus one monthly party,
  // but the guide dates it on every class night as an 8:30pm-3am social (Sun, Mon and Tue on read 41205637719):
  // classes, not a dance night (coverage-77, 2026-10-31).
  {
    ...directory("https://www.salsavida.com/guides/mexico/mexico-city/", "Salsa Vida Mexico City", [
      "salsa",
      "bachata",
      "son",
    ]),
    // Somos Casineros en México: a Cuban casino collective whose monthly events "vary by date and location" (its
    // Salsa Vida page, 2026-11-01); the guide projects it every Monday to Saturday 19:00-02:00 at "Various venues,
    // Multiple neighborhoods", so each row is a made-up night with no place. Screened until a dated, placed source
    // for its monthly socials is found.
    notDanceNights: [
      "Salsa Candela Weekly Classes and Monthly Party",
      "Somos Casineros en México – Cuban Dance Events",
    ],
  },
  // Eventbrite organisers found on Eventbrite's public Mexico City searches (salsa, bachata, cumbia, baile; 10/29),
  // read through the API only (D-015, D-131) as mixed calendars: each lists about one dance night a month among
  // workshops, walking tours and saunas, which the screens leave out. The owner left out the travellers' guided
  // "Salsa Night Experience" organisers (2026-10-29).
  eventbrite("https://www.eventbrite.com/o/casa-kumbhaka-76009527113", "Casa Kumbhaka", ["cumbia"]),
  eventbrite(
    "https://www.eventbrite.com/o/derek-reds-121416565906",
    "Derek Reds (La Noche Latina)",
    ["salsa", "bachata"],
  ),
  eventbrite("https://www.eventbrite.com/o/discos-y-amigos-71110341203", "Discos y Amigos", [
    "cumbia",
  ]),
  // Party and club-night organisers found on Eventbrite's public Mexico City searches (fiesta, techno, baile,
  // lgbt, salsa; 2026-10-30, D-445), each with a dated CDMX night ahead: raves, reggaeton, baile funk, soul,
  // a lesbian party and a country dance rodeo. Same API-only, mixed-calendar rules as above; Cósmica's
  // Chihuahua dates fall outside the metro.
  eventbrite("https://www.eventbrite.com/o/cosmica-105922435931", "Cósmica", ["electronic"]),
  eventbrite("https://www.eventbrite.com/o/coffee-rave-121123880349", "Coffee Rave", [
    "electronic",
  ]),
  eventbrite("https://www.eventbrite.com/o/villa-funk-120825711677", "Villa Funk", ["baile_funk"]),
  eventbrite("https://www.eventbrite.com/o/electronica-rave-121869317134", "Electrónica Rave", [
    "techno",
  ]),
  eventbrite(
    "https://www.eventbrite.com/o/pinche-gringo-bbq-patio-37166113313",
    "Pinche Gringo BBQ",
    ["two_step", "line_dance"],
  ),
  eventbrite("https://www.eventbrite.com/o/regueton-night-121679183450", "Regueton Night", [
    "reggaeton",
  ]),
  eventbrite("https://www.eventbrite.com/o/hpg-121817772832", "HPG (Tumba la Casa Mami)", [
    "reggaeton",
  ]),
  eventbrite("https://www.eventbrite.com/o/aurora-mx-120911128438", "Aurora MX", ["electronic"]),
  eventbrite("https://www.eventbrite.com/o/f-mack-108808004501", "F-Mack (CDMX Soul Night)", [
    "dj_night",
  ]),
  eventbrite("https://www.eventbrite.com/o/ella-mexico-26936604513", "Ella México", [
    "queer_party",
  ]),
  eventbrite("https://www.eventbrite.com/o/4dsoul-121849031119", "4DSoul", ["dj_night"]),
  eventbrite("https://www.eventbrite.com/o/highest-109192154861", "HÏGHÊŠT (Bar Oriente)", [
    "dj_night",
  ]),
  eventbrite("https://www.eventbrite.com/o/instinto-mx-121036858430", "Instinto MX", ["dj_night"]),
  // Meetup groups found by the research sweep (D-441, 2026-10-29), their iCalendar feeds: a Roma Norte studio's
  // Thursday bachata class, social and karaoke and Wednesday salsa nights (10 dated to 12-02), and Espresso Beats'
  // Saturday day parties (afro-latin house, Afrobeats, reggaeton; Halloween edition 10-31).
  // Its iCalendar feed has no LOCATION; every one of its 10 dated nights (10-30 check of each event page) is at
  // Kartharsis Studio (a known venue with a checked point), so the feed is placed there (run 40981708736 left 4 unplaced). An onlyHere seed names its venue after the label, so the label is the studio name.
  {
    ...meetup("foreigners-and-expats-in-mexico-city-latin-dance-in-cdmx", "Kartharsis Studio", [
      "bachata",
      "salsa",
    ]),
    venueAddress: "Calle Mérida 124, Roma Norte, Cuauhtémoc, 06700 Ciudad de México",
    onlyHere: true,
  },
  meetup("espresso-beats", "Espresso Beats (Meetup)", ["afrobeats_club", "dj_night"]),
  // Second research pass (the owner, 10-30; D-447). La Flor del Son, Roma Norte (since 2005): its one-page site
  // says live Cuban son Thursday to Saturday from 6 PM, free entry, and dates its special nights (10-31). robots.txt
  // is a 404 (2026-10-30).
  {
    ...page("https://laflordelson.com.mx/", "La Flor del Son", ["son", "salsa"]),
    venueAddress: "Puebla 52, Roma Norte, 06700 Ciudad de México",
    venuePage: true,
    onlyHere: true,
    weeklyGrid: true,
  },
  // Cracovia 32, San Ángel: a cultural house, the city's Lindy Hop and swing home (city tourism site); its dated
  // cartelera mixes circus, theatre and workshops with rumba jams, parties and swing nights.
  {
    ...page("https://cracovia32.com/", "Cracovia 32", ["swing", "lindy_hop"]),
    venueAddress: "Cracovia 32, San Ángel, Álvaro Obregón, 01000 Ciudad de México",
    venuePage: true,
    onlyHere: true,
    mixedCalendar: true,
  },
  // Pervert, a queer techno party (the owner, 10-30: list it). Its home page lists the next nights with date and
  // place (CDMX at Ex Fábrica de Harina on 10-31; also Guadalajara and Madrid, which placement leaves out).
  page("https://pervert.mx/", "Pervert", ["queer_party", "techno"]),
  // Tango México's "Milongas (CDMX)" Google Calendar, read through the Calendar API (D-130, D-442): 175 events, 44
  // weekly/monthly milongas and practicas kept current (end dates edited 10/2026). Only this calendar: the same page's
  // festivals (other cities, all-day) and stage shows are not dance nights. Found by coverage's Serper gap run.
  {
    ...page("https://sites.google.com/view/tangomexico/agenda", "Tango México milongas", [
      "milonga",
      "practica",
    ]),
    trustTier: "directory",
    kind: "feed_gcal",
    platform: "feed_gcal",
    feedUrl: "https://calendar.google.com/calendar/embed?src=agendatangomx%40gmail.com",
  },
  // Salón Los Ángeles, Guerrero (since 1937): its home page lists dated danzón, salsa and orchestra nights (8 on
  // 10/29, to 12-12). robots.txt asks Crawl-delay 3600, so one page a run (D-252). Discovery had probed its
  // `?ical=1` link (a 500) and stored the page as a feed, which spent that one page on the first full read (run
  // 40942528159); platform "probed" pins it back to the page itself (D-443).
  {
    ...page("https://salonlosangeles.mx/", "Salón Los Ángeles", ["danzon", "salsa", "cumbia"]),
    platform: "probed",
    venueAddress: "Lerdo 206, Guerrero, 06300 Ciudad de México",
    venuePage: true,
    onlyHere: true,
  },
  // DJ bars whose own site states a fixed weekly DJ schedule (the owner, 10-30: "a bar's own weekly can count";
  // D-446). robots.txt allows it.
  {
    ...page("https://www.cabaretito.com.mx/fusi%C3%B3n/", "Cabaré-Tito Fusión", [
      "queer_party",
      "dj_night",
    ]),
    venueAddress: "Londres 77, Juárez, 06600 Ciudad de México",
    venuePage: true,
    onlyHere: true,
    weeklyGrid: true,
  },
  // San Luis Club, San Luis Potosí 28, Roma Norte (between Frontera and Mérida): an old salsa hall with a live
  // orchestra, Monday to Saturday 20:00-04:00. It has no site of its own (Instagram only), so it is listed by
  // D-510 (the owner 2026-10-31: a venue's fixed weekly night counts when 2+ independent guides agree). The read page is
  // Salsa Vida's event page ("Every Mon, Tue, Wed, Thu, Fri & Sat", "8:00 PM - 4:00 AM"); the others, checked
  // 2026-10-31: Chilango's salsa guide (chilango.com/que-hacer/musica/lugares-para-bailar-salsa/, "Lunes a sábado
  // de 20:00 a 04:00 horas"), Chilango's venue page (chilango.com/antros-y-bares/roma-2/salon-san-luis/, number
  // 28) and Time Out México (timeoutmexico.mx/ciudad-de-mexico/bares-y-cantinas/san-luis-club, number 28; one
  // listing says 26). Re-check the guides at each full read. robots.txt allows all (checked 2026-10-31).
  // Pinned to plain HTML: the page's JSON-LD holds only the next date, so a probe would read one night a run.
  {
    ...directory(
      "https://www.salsavida.com/event/mexico/mexico-city/salsa-en-vivo-at-san-luis-club/",
      "San Luis Club",
      ["salsa"],
    ),
    platform: "probed",
    venueAddress: "San Luis Potosí 28, Roma Norte, Cuauhtémoc, 06700 Ciudad de México",
    onlyHere: true,
    weeklyGrid: true,
  },
  // Bailar (getbailar.com): its terms (6(j)) need written consent for bots; Bailar gave it to the owner by email
  // (2026-10-31, D-448). One read a day of the public Mexico City page only, facts only (name, venue, date, time,
  // style), each night linked back. Its 7-night list is the only web source for Salón Candela's Monday to Thursday
  // tardeadas and Barba Azul's nights. Cloudflare answers 403 to a plain curl but 200 to our bot User-Agent;
  // robots.txt allows / (checked 2026-10-31).
  directory("https://getbailar.com/dance/mexico-city", "Bailar Mexico City", [
    "salsa",
    "bachata",
    "danzon",
    "cumbia",
  ]),
  // where-to-dance-salsa.com (the operator's written permission covers every city, the owner 2026-10-29; D-323,
  // D-383, D-444): schema.org DanceEvent JSON-LD on each style's Mexico City list page (21 salsa, 13 bachata on
  // 10/29, overlapping Salsa Vida's). It adds Sunday to Wednesday nights Salsa Vida lacks. Its dates are the
  // site's projection of weekly nights, so only ever a directory. robots.txt allows these paths, checked
  // 2026-10-29. The kizomba page had 1 row (Bachata Feeling, on both other pages): left out.
  directory(
    "https://where-to-dance-salsa.com/salsa/mexico-city/",
    "where-to-dance-salsa Mexico City salsa",
    ["salsa"],
  ),
  directory(
    "https://where-to-dance-salsa.com/bachata/mexico-city/",
    "where-to-dance-salsa Mexico City bachata",
    ["bachata"],
  ),
  // Out x Out's Mexico City LGBTQ+ events calendar: read daily with its written yes (D-545; all cities, D-558, the owner
  // 2026-11-01); its Terms of Service otherwise bar scrapers and aggregation. robots.txt allows /events/ (disallows
  // only /api/, /admin and similar). On 2026-11-01 it listed no events for the week (Sun 1 to Sat 7 Nov); its other
  // cities' pages carry schema.org Events in a JSON-LD ItemList. A directory; a mixed calendar (drag shows, brunches
  // and club nights).
  {
    ...directory("https://outxout.com/events/mexico-city-mx", "Out x Out Mexico City", [
      "queer_party",
    ]),
    kind: "jsonld",
    mixedCalendar: true,
  },
];

/** Starting addresses retired, each with the reason (D-047). */
export const MEXICO_CITY_RETIRED: readonly RetiredSource[] = [
  {
    url: "https://depa.radio/agenda",
    // Its weekly grid names "Radio Bar Sessions EN VIVO" (live radio) and no dance (run 41043406841, D-446).
    reason: "a radio schedule: its bar sessions are live radio and name no dance",
  },
  {
    url: "http://www.elduxdevenecia.com",
    reason:
      "Dead feed: discovery switched it on as a venue calendar and its Events Calendar feed answers 404 (run 41311336330, 2026-11-01).",
  },
  {
    url: "https://gentedemezcal.com/en/",
    reason:
      "Dead feed: discovery switched it on as a venue calendar and its Events Calendar feed answers 404 (run 41311336330, 2026-11-01).",
  },
  {
    url: "https://www.centrodidacticocultural.mx/",
    reason:
      "Dead feed: discovery switched it on as a venue calendar and its Events Calendar feed answers 404 (run 41311336330, 2026-11-01).",
  },
  {
    url: "https://cultura.uam.mx/",
    reason:
      "Dead feed: discovery switched it on as a venue calendar and its calendar link is not an iCalendar file (run 41311336330, 2026-11-01).",
  },
  {
    url: "https://foro.engranica.com/",
    reason:
      "Dead feed: discovery switched it on as a venue calendar and its calendar link is not an iCalendar file (run 41311336330, 2026-11-01).",
  },
  {
    url: "https://mc.jpf.go.jp/",
    reason:
      "Dead feed: discovery switched it on as a venue calendar and its calendar link is not an iCalendar file (run 41311336330, 2026-11-01).",
  },
];
