// Medellín's starting sources (D-640). US rules (D-034, D-640): official APIs and public pages, robots.txt honoured;
// Facebook and Instagram never; Resident Advisor only as the D-505 `ra` source. Sources are added as they are checked;
// the daily run also seeds venues and discovers their websites (D-120).

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

/** Where Bar Chiquita's own site says people dance there (D-527), checked 2026-10-31. */
const BAR_CHIQUITA_DANCING =
  'https://www.barchiquita.com/ (checked 2026-10-31): "Somos el bar gay cerca de ti que tiene cada semana eventos, muchos cócteles, noches especiales y noches locas de perreo." and "La rumba más chimba está en Bar Chiquita, la combinación entre las canciones pop que amamos y los perreos intensos."';

export const MEDELLIN_SOURCES: readonly SeedSource[] = [
  // Salsa Vida, schema.org Events in the page's JSON-LD (24 on 10/31: Son Havana's four weekly band nights,
  // Posada León, Erre de Rebelión's La Rebanda, Nueva Guardia, Casa Ritmo Latino, Blood Dance Company, Claustro
  // Comfama). Every address on 10/31 was in Medellín (El Poblado, Laureles, La Candelaria). robots.txt allows it
  // (User-agent: * / Disallow: empty, checked 2026-10-31).
  directory("https://www.salsavida.com/guides/colombia/medellin/", "Salsa Vida Medellín", [
    "salsa",
    "bachata",
    "timba",
  ]),
  // The guide page's sibling; schema.org Events in its JSON-LD (24 on 10/31, 14 distinct classes); weekly classes at
  // Social Club Academia, Nueva Guardia, Dancefree and the Rumba y Salsa workshops fill Monday-Wednesday; left out:
  // hostel and language-school classes for travellers (as Mexico City left out traveller nights), an online class,
  // and multi-week Comfama courses (enrolment, not drop-in). robots.txt allows it (checked 2026-10-31).
  {
    ...directory(
      "https://www.salsavida.com/guides/colombia/medellin/lessons/",
      "Salsa Vida Medellín lessons",
      ["salsa", "bachata"],
    ),
    notDanceNights: [
      "Tuesday Free Salsa Class at Wandering Paisa Hostel",
      "Salsa Classes with Jelly at La Familia Hostel",
      "Salsa Classes with Jelly at Centro Catalina",
      "Salsa y Bachata Class at Elefun Spanish School Laureles",
      "Salsa Nivel Intermedio en Línea at Nueva Guardia Dance Club",
      "Bachata Course at Comfama Cristo Rey",
      "Bachata Course at Comfama Sabaneta",
      "Bachata Level 1 Course at Comfama Pedregal",
    ],
  },
  // An LGBTQ+ club in El Poblado whose own WordPress events page lists the week's dated nights (10/31:
  // Thu karaoke, Fri and Sat drag show with DJs 10pm-3:45am, Sunday "Bellakeo" reggaetón party, a football
  // screening); the DJ nights are its dance nights, karaoke and football are not. Found by the 10/31 discovery run
  // (held: no dates read by the gate). robots.txt allows /eventos/ (checked 2026-10-31).
  {
    ...page("https://cluboraculo.com/eventos/", "Club Oráculo", [
      "dj_night",
      "reggaeton",
      "queer_party",
    ]),
    venuePage: true,
    venueAddress: "Cra. 36 #8A-123, El Poblado, Medellín",
    onlyHere: true,
    mixedCalendar: true,
    danceNights: [
      "Domingo de Bellakeo",
      "Viernes de Show Drag",
      "Sábado de Show Drag",
      "Sábados de Show Drag",
    ],
    notDanceNights: ["Jueves de Karaoke", "Miércoles de futbol"],
  },
  // A Medellín techno organiser found on Eventbrite's public Medellín search; one night on 11/15
  // ("Pura frecuencia x No11z - OCTAVE"), 10/31.
  eventbrite("https://www.eventbrite.com/o/81689349493", "Pura frecuencia", [
    "techno",
    "electronic",
  ]),
  // Dancefree, El Poblado: a salsa and bachata school and bar; its own Squarespace calendar (82 upcoming on 10/31,
  // to 1 Dec: 13 "Bar/Social" nights 9:30pm-2am with salsa, bachata and tropical rooms, group classes and
  // practices, private-class slots and language exchanges). robots.txt allows /calendar (checked 2026-10-31).
  // "Bar/Social" names no dance, so it is a named dance night (D-264); private-class slots are not events.
  {
    ...squarespace("https://www.dancefree.com.co/calendar", "Dancefree", ["salsa", "bachata"]),
    venuePage: true,
    venueAddress: "Calle 10A #40-27, El Poblado, Medellín",
    onlyHere: true,
    mixedCalendar: true,
    danceNights: ["Bar/Social"],
    notDanceNights: ["Private Classes"],
  },
  // Casa Ritmo Latino, Laureles: a dance school whose own events page states its weekly night ("Todos los jueves":
  // 8pm salsa and bachata classes, 9pm-1am social, visitors 10.000 COP; 10/31) beside its Colombia Secret Zouk
  // festival (Nov 20-23). Salsa Vida lists the same Thursdays with dates. robots.txt allows all (checked 2026-10-31).
  // The 10/31 run retired its two Thursday nights "JUEVES DE CASA RITMO LATINO" because the title names no dance and
  // the calendar is mixed; the page says that night is its salsa/bachata class + social (D-264).
  {
    ...page(
      "https://casaritmolatino.com/academia-de-baile-en-medellin-colombia-eventos/",
      "Casa Ritmo Latino",
      ["salsa", "bachata", "brazilian_zouk"],
    ),
    venuePage: true,
    venueAddress: "Cra. 81 #34A-71, Laureles, Medellín",
    onlyHere: true,
    mixedCalendar: true,
    danceNights: ["Jueves de Casa Ritmo Latino"],
  },
  // Teatro Victoria, Provenza: a club ("El Teatro de la Rumba"; its own blog: DJs, reggaetón, electrónica, house,
  // crossover) whose own home page names four weekly nights under weekday titles with no dates (10/31: "GRINGOS
  // TUESDAY", "MIÉRCOLES DE SOLTERAS", "JUEVES DE PARRANDA VALLENATA", "LA SERIE VOL 2 TODOS LOS VIERNES") and its
  // hours (9:30pm to 2am Mon-Wed, to 4am Thu-Sat). The titles name no dance, so they are named dance nights (D-264);
  // weekdays come from the titles (D-402 weeklyGrid). D-524 gap report #1. robots.txt allows all (checked 2026-10-31).
  {
    ...page("https://teatrovictoria.co/", "Teatro Victoria", [
      "reggaeton",
      "dj_night",
      "latin_club",
    ]),
    venuePage: true,
    venueAddress: "Carrera 35 # 8A-73, El Poblado, Medellín",
    onlyHere: true,
    mixedCalendar: true,
    weeklyGrid: true,
    danceNights: [
      "Gringos Tuesday",
      "Miércoles de Solteras",
      "Jueves de Parranda Vallenata",
      "La Serie Vol 2",
      "La Serie Vol 2 Todos los Viernes",
    ],
  },
  // Bar Chiquita, El Poblado: an LGBTQ+ bar whose own home page says people dance there ("La rumba más chimba está en
  // Bar Chiquita, la combinación entre las canciones pop que amamos y los perreos intensos"; "noches locas de
  // perreo"; nightly drag shows) and prints its Medellín hours under "Bar Chiquita Medellin" (the page also lists a
  // Bogotá branch). Hours count as dance nights when the venue's own site says people dance (D-527), so the hours are
  // fixed weekly nights. D-524 gap report #5. robots.txt disallows only /wp-admin/, /acceso/, /wp-login.php
  // (checked 2026-10-31).
  {
    ...page("https://www.barchiquita.com/", "Bar Chiquita", ["queer_party", "reggaeton"]),
    venuePage: true,
    venueAddress: "Cra. 37 #8a-88, El Poblado, Medellín",
    onlyHere: true,
    mixedCalendar: true,
    fixedNights: [
      {
        title: "Bar Chiquita: drag show y perreo (martes a jueves)",
        line: "Martes a jueves: 6:00 p.m. a 2:00 a.m.",
        days: [2, 3, 4],
        start: "18:00",
        end: "02:00",
        danceCited: BAR_CHIQUITA_DANCING,
      },
      {
        title: "Bar Chiquita: drag show y perreo (viernes y sábados)",
        line: "Viernes y sábados: 7:00 p.m. a 3:00 a.m.",
        days: [5, 6],
        start: "19:00",
        end: "03:00",
        danceCited: BAR_CHIQUITA_DANCING,
      },
      {
        title: "Bar Chiquita: drag show y perreo (domingos)",
        line: "Domingos: 6:00 p.m. a 2:00 a.m",
        days: [0],
        start: "18:00",
        end: "02:00",
        danceCited: BAR_CHIQUITA_DANCING,
      },
    ],
  },
  // Comfama (caja de compensación) dance events at the Claustro Comfama San Ignacio: the monthly "Patio de Baile"
  // milongas and porro night, and "Ponte Salsa". Comfama gave permission on 2026-11-01 (D-553, docs/PARTNERSHIPS.md).
  // Its site sits behind a Radware bot wall: one read a day of these seeded event pages only, 5 s apart (the
  // client's per-domain interval); a challenge page means the seeds are removed that day, never worked around.
  // Its JSON-LD writes local times with a "Z" ("2026-11-27T20:00:00Z" for 8 p. m. Bogotá), hence jsonldZuluIsLocal.
  // Reseed by hand monthly from https://www.comfama.com/agenda/sitemap-0.xml (robots.txt allows /agenda/, 2026-11-01).
  {
    url: "https://www.comfama.com/agenda/evento/milonga-noviembre/",
    kind: "jsonld",
    trustTier: "first_party",
    styles: ["tango", "milonga"],
    label: "Comfama: Milonga de noviembre (Claustro San Ignacio)",
    jsonldZuluIsLocal: true,
  },
  {
    url: "https://www.comfama.com/agenda/evento/milonga-diciembre/",
    kind: "jsonld",
    trustTier: "first_party",
    styles: ["tango", "milonga"],
    label: "Comfama: Milonga de diciembre (Claustro San Ignacio)",
    jsonldZuluIsLocal: true,
  },
  {
    url: "https://www.comfama.com/agenda/evento/patio-porro-diciembre/",
    kind: "jsonld",
    trustTier: "first_party",
    styles: ["cumbia", "folk"],
    label: "Comfama: Patio de Baile, porro (Claustro San Ignacio)",
    jsonldZuluIsLocal: true,
  },
  {
    url: "https://www.comfama.com/agenda/evento/ponte-salsa-2026/",
    kind: "jsonld",
    trustTier: "first_party",
    styles: ["salsa"],
    label: "Comfama: Ponte Salsa (Claustro San Ignacio)",
    jsonldZuluIsLocal: true,
  },
];

/** Starting addresses retired, each with the reason (D-047). */
export const MEDELLIN_RETIRED: readonly RetiredSource[] = [
  {
    url: "https://www.domebi.com/events",
    reason:
      "Domebi is a ticket site for metal and rock concerts across Colombia (Medellín, Cali, Bogotá, Armenia), found by discovery under Barnaby Jones; Medellín's second full read 41176472155 wrote only concerts and a passed Halloween party from it, no dance nights (checked 2026-10-31)",
  },
];
