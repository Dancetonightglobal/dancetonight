// Marrakesh's starting sources (D-1100). Morocco is read under the US tier (standing answer D-520): official APIs,
// public pages and feeds, robots.txt honoured, no bot-wall workarounds; Facebook and Instagram never; Resident
// Advisor only through its GraphQL endpoint (D-505, Morocco area 173, kept to the prefecture by the outline).

import type { RetiredSource, SeedSource } from "@/config/sources/nyc";
import type { StyleKey } from "@/config/styles";

const directory = (url: string, label: string, styles: StyleKey[]): SeedSource => ({
  url,
  kind: "html",
  trustTier: "directory",
  styles,
  label,
  mixedCalendar: true,
});

export const MARRAKESH_SOURCES: readonly SeedSource[] = [
  // Theatro (Hivernage, the Es Saadi club): its home page lists one named night per date (9 dated nights 6-14 Nov on
  // 2026-11-07), each linking its own /event/ page, whose Event JSON-LD gives the date only. Every event page says
  // "Theatro is Open 7/7 from 11:30pm to 5:00am", so its nights take those house hours (D-494, D-527: a nightclub).
  // robots.txt disallows only /wp-admin/ (checked 2026-11-07); no terms page found.
  {
    url: "https://www.theatromarrakech.com/",
    kind: "html",
    trustTier: "first_party",
    styles: ["club"],
    label: "Theatro Marrakech",
    venuePage: true,
    venueAddress: "Theatro, Rue Ibrahim El Mazini, Hivernage, 40000 Marrakech",
    onlyHere: true,
    houseHours: {
      start: "23:30",
      end: "05:00",
      days: [0, 1, 2, 3, 4, 5, 6],
      checked:
        "theatromarrakech.com event pages: 'Theatro is Open 7/7 from 11:30pm to 5:00am' (2026-11-07)",
    },
  },
  // Babouchka (Hivernage club): its events page lists its "Soirées récurrentes" under English weekday headings with
  // no dates (Mon We Love Babouchka, Tue People Like Us, Wed La Tsarine, Fri Kulture Klub, Sat Revolution, Sun Volga;
  // no Thursday), read as weekly nights (D-402, a club's own weekly schedule, the owner 2026-10-30). Hours from the same
  // page: "Lundi - Dimanche : Minuit à 5h". robots.txt has no Disallow (checked 2026-11-07); no terms page found.
  {
    url: "https://babouchka-marrakech.com/events",
    kind: "html",
    trustTier: "first_party",
    styles: ["club", "house"],
    label: "Babouchka Marrakech",
    venuePage: true,
    venueAddress: "Babouchka, 10 Rue Haroun Errachid, Hivernage, 40000 Marrakech",
    onlyHere: true,
    weeklyGrid: true,
    houseHours: {
      start: "00:00",
      end: "05:00",
      days: [0, 1, 2, 3, 5, 6],
      checked: "babouchka-marrakech.com/events: 'Lundi - Dimanche : Minuit à 5h' (2026-11-07)",
    },
  },
  // Salsa Vida's Marrakech guide (owner approved Salsa Vida's terms, 2026-10-31): schema.org Events; on 11/07 one,
  // Raíces Marrakech (Cuban salsa class then social, 2nd Saturday monthly, M Rooftop by Medina Heritage), JSON-LD
  // start "2026-11-14T19:00:00+00:00". Check the shown time on the first read (Beirut's guide wrote US Pacific).
  // Its JSON-LD writes the page's shown wall clock with "+00:00" ("7:00 PM" shown, "...T19:00:00+00:00" written;
  // Morocco is UTC+1), so that offset is re-read as Marrakesh wall clock. Salsa Vida lists only dance nights (D-321),
  // so it is not screened as a mixed calendar (as Beirut, D-772).
  {
    ...directory("https://www.salsavida.com/guides/morocco/marrakech/", "Salsa Vida Marrakech", [
      "salsa",
      "bachata",
    ]),
    jsonldZuluIsLocal: "+00:00",
    mixedCalendar: false,
  },
  // Back To House (Underground Series, house nights at Les Asnouss), Eventbrite organiser 121545424647, read
  // through the API (D-015, D-131); found on Eventbrite's public Marrakech search (2026-11-07).
  {
    url: "https://www.eventbrite.com/o/121545424647",
    kind: "ticketing_api",
    trustTier: "ticketing",
    platform: "eventbrite",
    styles: ["house"],
    label: "Back To House (Eventbrite)",
    mixedCalendar: true,
  },
  // Tidar (buy.tidar.ma), Morocco's ticket seller for electronic nights: its public Marrakech city page, read by the
  // tidar reader (#1284, D-1102: robots allow all, terms cover ticket sales only). About 10 club nights in two weeks
  // on 2026-11-07 (Leone, El Fenn, ECHO7000, Back To House); the reader keeps Marrakech, dance and in-outline rows.
  {
    url: "https://buy.tidar.ma/city/marrakech",
    kind: "platform_api",
    platform: "tidar",
    trustTier: "ticketing",
    styles: ["dj_night"],
    label: "Tidar Marrakech",
  },
  // El Fenn's rooftop Sol Sundays (Bab El Ksour, Medina): its own page dates them, every other Sunday, "Shems takes
  // over the decks every other Sunday", 5pm-10pm, free entry (8 Nov, 22 Nov, 6 Dec on 2026-11-07). robots.txt
  // has an empty Disallow (checked 2026-11-07). Also on Tidar; the two merge on night and venue.
  {
    url: "https://el-fenn.com/sol-sundays-at-el-fenn/",
    kind: "html",
    trustTier: "first_party",
    styles: ["dj_night"],
    label: "Sol Sundays at El Fenn",
    venuePage: true,
    venueAddress:
      "El Fenn, Derb Moulay Abdellah Ben Hezzian, Bab El Ksour, Medina, 40000 Marrakech",
    onlyHere: true,
  },
  // Souktronic, Comptoir Darna's first-floor club (Hivernage): its own art-show page states the club every night,
  // "TOUT LES SOIRS DE 00:00 à 03:00", and "Chaque soir, nos DJs talentueux enflamment le dancefloor" (D-527). The
  // page's dinner and belly-dance shows are not listed (fixed night only). robots.txt disallows only /admin, search
  // and tracking queries (checked 2026-11-07).
  {
    url: "https://www.comptoirmarrakech.com/art-show",
    kind: "html",
    trustTier: "first_party",
    styles: ["dj_night"],
    label: "Souktronic at Comptoir Darna",
    venuePage: true,
    venueAddress: "Comptoir Darna, Avenue Echouhada, Hivernage, 40000 Marrakech",
    onlyHere: true,
    mixedCalendar: true,
    // Its dinner shows pass the screen on "danse" (read 42463050305 listed "Ballet de danse orientale" every night).
    notDanceNights: ["Ballet de danse orientale", "Live band Gnaoua oriental"],
    fixedNights: [
      {
        title: "Souktronic club at Comptoir Darna",
        line: "TOUT LES SOIRS DE 00:00 à 03:00",
        days: [0, 1, 2, 3, 4, 5, 6],
        start: "00:00",
        end: "03:00",
        danceCited:
          "comptoirmarrakech.com/art-show: 'Le club du premier étage ... Chaque soir, nos DJs talentueux enflamment le dancefloor' (checked 2026-11-07)",
      },
    ],
  },
  // Nightclubs with no site of their own (searched 2026-11-07/08), listed by their nightly hours under D-510 (two
  // independent sources agree on the nights and hours) and D-527 (one says people dance), per coverage-122 (11-08).
  // The read page is the club's Clubbable page (robots.txt "Allow: /", terms silent on automated access, read
  // 2026-11-07): its OPENING HOURS block, quoted whole as the night's line, so a change of hours stops the listing.
  // The model's own rows from the page (dated "upcoming nights" that are only the hours) are replaced.
  // 555 Famous Club, Hotel Clubbing, 555 Bd Mohammed VI, Agdal. Second source: Arrival Guides
  // (arrivalguides.com/en/Travelguide/MARRAKECH/barsandnightlife/555-famous-club-92920: "openingHours Daily
  // 11pm-5am", "a spacious dance floor ... renowned guest DJs", 2026-11-08). 555marrakech.com does not answer.
  {
    ...directory("https://www.clubbable.com/Marrakech/555-Famous-NightClub", "555 Famous Club", [
      "club",
    ]),
    venueAddress:
      "555 Famous Club, Hotel Clubbing, 555 Boulevard Mohammed VI, Agdal, 40000 Marrakech",
    onlyHere: true,
    fixedNights: [
      {
        title: "555 Famous Club",
        line: "OPENING HOURS: MONDAY 11:00 PM - 5:00 AM TUESDAY 11:00 PM - 5:00 AM WEDNESDAY 11:00 PM - 5:00 AM THURSDAY 11:00 PM - 5:00 AM FRIDAY 11:00 PM - 5:00 AM SATURDAY 11:00 PM - 5:00 AM SUNDAY 11:00 PM - 5:00 AM",
        days: [0, 1, 2, 3, 4, 5, 6],
        start: "23:00",
        end: "05:00",
        venue: "555 Famous Club",
        danceCited:
          "Arrival Guides 555 Famous Club page: 'a spacious dance floor', 'renowned guest DJs', 'Daily 11pm-5am'; Clubbable: same hours (2026-11-08)",
        // Clubbable's JSON-LD names each night "<Weekday> at 555 Famous NightClub", typed as a class (read 42586138898).
        replacesTitles: [
          "555 Famous NightClub",
          "555 Famous Club",
          "555 Famous NightClub Marrakech",
          "Monday at 555 Famous NightClub",
          "Tuesday at 555 Famous NightClub",
          "Wednesday at 555 Famous NightClub",
          "Thursday at 555 Famous NightClub",
          "Friday at 555 Famous NightClub",
          "Saturday at 555 Famous NightClub",
          "Sunday at 555 Famous NightClub",
        ],
      },
    ],
  },
  // Secret Room, Avenue Echouhada, Hivernage. Second source: Alotea Concierge (alotea.com/marrakech/nightclubs/
  // secret-room: "Opening Hours Sunday 23:00 - 05:00 ... Saturday 23:00 - 05:00", "commits entirely to house and
  // dance hits", Nightclub, 2026-11-08). Clubbable: "a vibrant party scene driven by talented DJs".
  {
    ...directory("https://www.clubbable.com/Marrakech/Secret-Room", "Secret Room", [
      "club",
      "house",
    ]),
    venueAddress: "Secret Room, Avenue Echouhada, Hivernage, 40000 Marrakech",
    onlyHere: true,
    fixedNights: [
      {
        title: "Secret Room",
        line: "OPENING HOURS: MONDAY 11:00 PM - 5:00 AM TUESDAY 11:00 PM - 5:00 AM WEDNESDAY 11:00 PM - 5:00 AM THURSDAY 11:00 PM - 5:00 AM FRIDAY 11:00 PM - 5:00 AM SATURDAY 11:00 PM - 5:00 AM SUNDAY 11:00 PM - 5:00 AM",
        days: [0, 1, 2, 3, 4, 5, 6],
        start: "23:00",
        end: "05:00",
        venue: "Secret Room",
        danceCited:
          "Alotea Secret Room page: 'house and dance hits', Opening Hours 23:00-05:00 every day; Clubbable: 'party scene driven by talented DJs', same hours (2026-11-08)",
        // Clubbable's JSON-LD names each night "<Weekday> at Secret Room", with a guest-list "Free" price (read 42586138898).
        replacesTitles: [
          "Secret Room",
          "Secret Room Marrakech",
          "Monday at Secret Room",
          "Tuesday at Secret Room",
          "Wednesday at Secret Room",
          "Thursday at Secret Room",
          "Friday at Secret Room",
          "Saturday at Secret Room",
          "Sunday at Secret Room",
        ],
      },
    ],
  },
];

export const MARRAKESH_RETIRED: readonly RetiredSource[] = [];
