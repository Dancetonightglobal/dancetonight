// Dubai's starting sources (D-1060). The UAE is read under the US tier (standing answer D-520 item 5): official
// APIs, public pages and feeds, robots.txt honoured, no bot-wall workarounds; Facebook and Instagram never;
// Resident Advisor only through its GraphQL endpoint (D-505, area 136). Platinumlist (a Queue-it waiting room on
// every page) and Time Out Dubai (403 to our bot) wait for the owner's permission asks (D-541). DICE has no
// Dubai (/browse/dubai 404). Starts empty, like London (D-201); the daily run seeds venues and discovers their
// websites (D-120).

import type { RetiredSource, SeedSource } from "@/config/sources/nyc";
import type { StyleKey } from "@/config/styles";

/** A directory page: pointers, never the organiser's own word (D-061, D-072). */
const directory = (url: string, label: string, styles: StyleKey[]): SeedSource => ({
  url,
  kind: "html",
  trustTier: "directory",
  styles,
  label,
  mixedCalendar: true,
});

export const DUBAI_SOURCES: readonly SeedSource[] = [
  // Salsa Vida's Dubai guide (owner approved Salsa Vida's terms, 2026-10-31). schema.org Events in the page's ItemList
  // (8 on 11/06, four weekly socials: Tue "Bailamé Tuesday Latin Night" at Twenty Three Rooftop, Grand Plaza
  // Mövenpick Media City; Fri "Latin Nights at SoBe" at W Dubai - The Palm and "La Grande Latin Social" in Dubai
  // Media City; Sat "Afro Latin Social" by Dubai Salsa Club). robots.txt allows it (checked 2026-11-06).
  // Salsa Vida lists only dance nights (D-321), so not a mixed calendar: a title naming no dance is still a night
  // (D-772; Paris lost real nights to the concert screen, coverage-114 2026-11-07).
  {
    ...directory(
      "https://www.salsavida.com/guides/united-arab-emirates/dubai/",
      "Salsa Vida Dubai",
      ["salsa", "bachata", "kizomba"],
    ),
    mixedCalendar: false,
  },
  // The Penthouse, FIVE Palm Jumeirah: a dated calendar (slugs end -DDMMYYYY), nightclub nights Mon "Big Mood Monday",
  // Tue "Fashion Ladies Night", Thu "Skyline Thursdays", Fri "Mash-Up Fridays", Sat "House Rules", Sun "Rooftop Groove",
  // plus a Friday night brunch that is not a dance night. robots.txt allows it (checked 2026-11-06).
  {
    url: "https://www.thepenthouse.co/dubai/events",
    kind: "html",
    trustTier: "first_party",
    styles: ["house", "hip_hop_club", "afrobeats_club", "dj_night"],
    label: "The Penthouse Dubai",
    onlyHere: true,
    venueAddress: "FIVE Palm Jumeirah Hotel, No 1 The Palm Jumeirah, Palm Jumeirah, Dubai",
    notDanceNights: ["Skyline Night Brunch at The Penthouse"],
    venuePage: true,
  },
  // Bohemia, FIVE Palm Jumeirah beach club: dated calendar ("Bohemia Presents Jonas Blue ... 7TH NOVEMBER 7PM", MK 21 Nov).
  // robots.txt allows it (checked 2026-11-06).
  {
    url: "https://bohemiadubai.com/events",
    kind: "html",
    trustTier: "first_party",
    styles: ["house", "dj_night"],
    label: "Bohemia Dubai",
    onlyHere: true,
    venueAddress: "Bohemia, FIVE Palm Jumeirah Hotel, No 1 The Palm Jumeirah, Palm Jumeirah, Dubai",
    venuePage: true,
  },
  // BLU Dubai, V Hotel Al Habtoor City: dated list (Nov 6 "Trey Songz Live", Nov 7 "BLU SATURDAY'S", Nov 8 "KeBlack Live",
  // Dec 25, Dec 31). Concerts beside club nights, so `mixedCalendar: true`. robots.txt allows it (checked 2026-11-06).
  {
    url: "https://bludubai.ae/upcoming-events",
    kind: "html",
    trustTier: "first_party",
    styles: ["afrobeats_club", "hip_hop_club", "dj_night"],
    label: "BLU Dubai",
    onlyHere: true,
    mixedCalendar: true,
    danceNights: ["BLU Saturday's", "BLU Saturdays"],
    venueAddress:
      "BLU Dubai, V Hotel Dubai, Al Habtoor City, 260 Sheikh Zayed Road, Business Bay, Dubai",
    venuePage: true,
  },
  // Little Havana, Sofitel JBR: its own home page states a weekly "Signature Latin Dance Night ... Thursdays · 9 PM – 4 AM"
  // (salsa, reggaeton, DJ sets). Own-site weekly counts (the owner 2026-10-30). Weekly with no dates, so `weeklyGrid: true`.
  // robots.txt allows it (checked 2026-11-06).
  {
    url: "https://littlehavanadxb.com/",
    kind: "html",
    trustTier: "first_party",
    styles: ["salsa", "reggaeton", "latin_club"],
    label: "Little Havana Dubai",
    onlyHere: true,
    weeklyGrid: true,
    venueAddress: "Little Havana, Sofitel Dubai Jumeirah Beach Hotel, The Walk, JBR, Dubai",
    venuePage: true,
  },
  // Lucky Voice Dubai, Grand Millennium Hotel Barsha Heights: its promotions page states "Free Salsa and Bachata Classes ...
  // Thursday nights ... join us every Thursday" with social dancing after; the rest of the page is karaoke and
  // happy-hour offers, so `mixedCalendar: true` and `weeklyGrid: true`. robots.txt allows it (checked 2026-11-06).
  {
    url: "https://www.luckyvoice.ae/promotions",
    kind: "html",
    trustTier: "first_party",
    styles: ["salsa", "bachata"],
    label: "Lucky Voice Dubai",
    onlyHere: true,
    mixedCalendar: true,
    weeklyGrid: true,
    venueAddress: "Lucky Voice, Grand Millennium Hotel, Barsha Heights, Dubai",
    venuePage: true,
  },
  // Avenue Club, Shangri-La Sheikh Zayed Road 42nd floor: weekly nights under weekday headings ("Monday: Urban Project",
  // "Wednesday: Bad Habits", "Friday: Ballerz"), open every day 11 PM - 4 AM. robots.txt allows it (checked 2026-11-06).
  {
    url: "https://dubaiavenueclub.com/nights",
    kind: "html",
    trustTier: "first_party",
    styles: ["hip_hop_club", "afrobeats_club", "dj_night"],
    label: "Avenue Club Dubai",
    onlyHere: true,
    weeklyGrid: true,
    venueAddress: "Avenue Club, Shangri-La Hotel, Sheikh Zayed Road, 42nd Floor, Dubai",
    venuePage: true,
  },
  // KIZA, DIFC (Afro restaurant-club): weekly nights in prose ("Every Saturday, from 12 Noon to 3 AM ... Shisanyama
  // Saturdays", "Wahala Fridays Every Friday, 11pm – 3am", a Wednesday ladies night), so `weeklyGrid: true`; the
  // Wednesday ladies night is a drinks offer (D-1065), so it is a `notDanceNights` title. robots.txt allows it (checked 2026-11-06).
  {
    url: "https://kiza.ae/events/",
    kind: "html",
    trustTier: "first_party",
    styles: ["afrobeats_club", "dj_night"],
    label: "KIZA Dubai",
    onlyHere: true,
    weeklyGrid: true,
    notDanceNights: ["Ladies night"],
    venueAddress: "KIZA, Emirates Financial Towers, DIFC, Dubai",
    venuePage: true,
  },
  // Papa Dubai, V Hotel Atrium Level 3, Al Habtoor City (Business Bay): one page per weekly night, each a schema.org
  // Event with a weekly eventSchedule and no startDate (2026-11-06: Mon Bad Decisions, Wed La Santa / Papasito Latin and
  // reggaeton, Thu Code Black, Fri King Papa hip-hop, Sat La Latina Latin and reggaeton 23:00-04:00). A club's own
  // weekly schedule counts (the owner 2026-10-30). Read by the JSON-LD reader, no model. robots.txt allows these pages
  // (it disallows only /tilda/* and two page ids; checked 2026-11-06). Found in the forum pass (What's On awards 2025).
  {
    url: "https://papadubai.ae/bad-decisions",
    kind: "jsonld",
    platform: "jsonld",
    trustTier: "first_party",
    styles: ["hip_hop_club", "dj_night"],
    label: "Papa Dubai: Bad Decisions",
    onlyHere: true,
    venueAddress: "Papa Dubai, V Hotel, Atrium Level 3, Al Habtoor City, Business Bay, Dubai",
    venuePage: true,
  },
  // Papasito's JSON-LD names another page as its own (url /la-santa, a 404 on 2026-11-06), so the JSON-LD reader
  // skips it as "a weekly schedule for another page", and on read 3 (42444842879) the probe stored it as a JSON-LD
  // page, where fixedNights never apply. Pinned to plain HTML (platform "probed", D-1068): the model reads it and its
  // own line gives the Wednesday night. Every Papa page also prints the other five nights' cards ("Bad Decisions Every
  // Monday ..."), which have their own seeds, so they are not this page's nights.
  {
    url: "https://papadubai.ae/papasito",
    kind: "html",
    platform: "probed",
    trustTier: "first_party",
    styles: ["reggaeton", "latin_club"],
    label: "Papa Dubai: Papasito",
    onlyHere: true,
    venueAddress: "Papa Dubai, V Hotel, Atrium Level 3, Al Habtoor City, Business Bay, Dubai",
    venuePage: true,
    notDanceNights: ["Bad Decisions", "French Kiss", "Code Black", "King Papa", "La Latina"],
    fixedNights: [
      {
        title: "Papasito",
        line: "Papasito is the Wednesday Latin party at Papa Dubai",
        days: [3],
        start: "23:00",
        end: "04:00",
        danceCited:
          "papadubai.ae/papasito: 'Papasito is the Wednesday Latin party at Papa Dubai, bringing together Latin house, reggaeton, dancing'; card 'Papasito Every Wednesday 11 PM - 4 AM' (2026-11-08)",
        replacesTitles: ["Papasito", "Papasito Wednesday", "Pasito"],
      },
    ],
  },
  // French Kiss (Tuesday), Papa Dubai: its JSON-LD Event has no date or eventSchedule, so it is pinned to plain HTML
  // like Papasito (D-1068); its own card line "French Kiss Every Tuesday" gives the night. robots.txt allows it (checked 2026-11-08).
  {
    url: "https://papadubai.ae/french-kiss",
    kind: "html",
    platform: "probed",
    trustTier: "first_party",
    styles: ["house", "dj_night"],
    label: "Papa Dubai: French Kiss",
    onlyHere: true,
    venueAddress: "Papa Dubai, V Hotel, Atrium Level 3, Al Habtoor City, Business Bay, Dubai",
    venuePage: true,
    notDanceNights: ["Bad Decisions", "Papasito", "Code Black", "King Papa", "La Latina"],
    fixedNights: [
      {
        title: "French Kiss",
        line: "French Kiss Every Tuesday",
        days: [2],
        start: "23:00",
        end: "04:00",
        danceCited:
          "papadubai.ae/french-kiss: 'French Kiss every Tuesday at Papa Dubai: house beats'; 'a seductive Tuesday night party'; card 'French Kiss Every Tuesday 11 PM - 4 AM' (2026-11-08)",
        replacesTitles: ["French Kiss", "French Kiss Tuesday", "French Kiss Tuesday at Papa Dubai"],
      },
    ],
  },
  {
    url: "https://papadubai.ae/code-black",
    kind: "jsonld",
    platform: "jsonld",
    trustTier: "first_party",
    styles: ["hip_hop_club", "dj_night"],
    label: "Papa Dubai: Code Black",
    onlyHere: true,
    venueAddress: "Papa Dubai, V Hotel, Atrium Level 3, Al Habtoor City, Business Bay, Dubai",
    venuePage: true,
  },
  {
    url: "https://papadubai.ae/king-papa",
    kind: "jsonld",
    platform: "jsonld",
    trustTier: "first_party",
    styles: ["hip_hop_club", "dj_night"],
    label: "Papa Dubai: King Papa",
    onlyHere: true,
    venueAddress: "Papa Dubai, V Hotel, Atrium Level 3, Al Habtoor City, Business Bay, Dubai",
    venuePage: true,
  },
  {
    url: "https://papadubai.ae/la-latina",
    kind: "jsonld",
    platform: "jsonld",
    trustTier: "first_party",
    styles: ["reggaeton", "latin_club"],
    label: "Papa Dubai: La Latina",
    onlyHere: true,
    venueAddress: "Papa Dubai, V Hotel, Atrium Level 3, Al Habtoor City, Business Bay, Dubai",
    venuePage: true,
  },
  // Blocked-platform audit (D-758, 2026-11-06): venues found on Time Out Dubai and Platinumlist, each read on its own
  // site. robots.txt allows all four (checked 2026-11-06). Addresses as each venue's own site gives them.
  // Ushuaia Dubai Harbour: dated headliner nights on the home page (Sat 14 Nov Adriatique, Sat 28 Nov ARTBAT, ...).
  {
    url: "https://www.ushuaiadubai.com/",
    kind: "html",
    trustTier: "first_party",
    styles: ["house", "techno", "dj_night"],
    label: "Ushuaïa Dubai Harbour",
    onlyHere: true,
    venueAddress: "Ushuaïa Dubai Harbour Experience, Dubai Harbour, Dubai",
    venuePage: true,
  },
  // Surf Club, West Beach, Palm Jumeirah: dated DJ nights (Vagabond every Saturday, Family Affair). The Wednesday
  // Ladies' Day (12-5 PM) and the Sunday brunch are daytime, not dance nights.
  {
    url: "https://www.surfclubdubai.com/events",
    kind: "html",
    trustTier: "first_party",
    styles: ["house", "dj_night"],
    label: "Surf Club Dubai",
    onlyHere: true,
    mixedCalendar: true,
    notDanceNights: [
      "La Vie En Rose | Ladies' Day",
      "Sanctum Sundays | Sunday Brunch & After-Brunch",
    ],
    venueAddress: "Surf Club Dubai, West Beach, Palm Jumeirah, Dubai",
    venuePage: true,
  },
  // Baoli Dubai, J1 Beach: dated DJ calendar (Friday guest DJs) plus Baoli Circle every Tuesday 7pm. Its pool day,
  // brunch and lunch items are not dance nights.
  {
    url: "https://www.baoli-restaurant.com/calendar-events-baoli-restautant-dubai.html",
    kind: "html",
    trustTier: "first_party",
    styles: ["house", "dj_night"],
    label: "Bâoli Dubai",
    onlyHere: true,
    mixedCalendar: true,
    weeklyGrid: true,
    notDanceNights: [
      "Euphoria",
      "House of Baoli - Brunch",
      "Ladies by the pool",
      "Seasonal Lunch Menu",
    ],
    venueAddress: "Bâoli Dubai, J1 Beach, Jumeirah 1, Dubai",
    venuePage: true,
  },
  // Paradiso Dubai, FIVE LUXE JBR ("Nestled in the luxurious FIVE LUXE at JBR", its /our-concept page): weekly DJ
  // nights on /events (R&B and house Thursday 9pm, House Beats Friday and Saturday 9pm). the owner 2026-11-06: FIVE Hotels'
  // boilerplate terms do not stop us reading a venue's own events page (D-1066).
  {
    url: "https://www.paradisodubai.com/events",
    kind: "html",
    trustTier: "first_party",
    styles: ["house", "dj_night"],
    label: "Paradiso Dubai",
    onlyHere: true,
    weeklyGrid: true,
    venueAddress: "Paradiso, FIVE LUXE JBR, Jumeirah Beach Residence, Dubai",
    venuePage: true,
  },
  // CÉ LA VI Dubai, Address Sky View Tower 2, Level 54 (its /contact-us page): "In House", "Every Mon 10pm - 2am", Sky
  // Bar and Club Lounge, resident DJs ("a lively evening of fun and dance"). A club's own ladies night is a club night
  // (D-1065). Found on DubaiNight's events list (Monday 09 Nov 2026); robots.txt has no Disallow (checked 2026-11-08).
  {
    url: "https://dxb.celavi.com/events/in-house",
    kind: "html",
    trustTier: "first_party",
    styles: ["dj_night"],
    label: "CÉ LA VI Dubai",
    onlyHere: true,
    weeklyGrid: true,
    venueAddress:
      "CÉ LA VI, Address Sky View Hotel Tower 2, Level 54, Sheikh Mohammed bin Rashid Boulevard, Downtown Dubai",
    venuePage: true,
    // Its page also lists a set lunch and an aperitivo, not dance nights (coverage daily check 2026-11-13).
    notDanceNights: ["Lunch Set Menu", "Sky High Aperitivo"],
  },
  // Latin Crazy Tribe, an organiser's own Instagram (D-802, D-797; Chrome audit 4-8, 2026-11-09), never fetched. Bio:
  // "DUBAI LATIN Nights Wed: @tjs.dubai Thur: @room44dubai Fri: @sobedubai Sat: @tt_dxb". Only Wednesday is listed
  // here: Friday at SoBe already comes from Salsa Vida; Thursday's Calentura just moved to Room 44, JW Marriott Marina
  // ("New Venue", 11-05; D-802 seeds no night whose venue moves: recheck 12-09); Saturday's TT Rooftop gives no address.
  // latincrazytribe.com/parties shows "No events at the moment". Recheck monthly.
  {
    url: "https://www.instagram.com/latincrazytribe/",
    kind: "html",
    handChecked: true,
    trustTier: "first_party",
    styles: ["salsa", "bachata", "kizomba"],
    label: "Latin Crazy Tribe",
    onlyHere: true,
    venueAddress: "TJ's, Taj Jumeirah Lakes Towers Hotel, JLT, Dubai",
    venuePage: false,
    fixedNights: [
      {
        title: "Caliente Wednesdays",
        line: "CALIENTE WEDNESDAYS at TJs, Taj Hotel JLT",
        days: [3],
        start: "20:30",
        end: "00:00",
        venue: "TJ's Dubai",
        danceCited:
          "instagram.com/latincrazytribe post 2026-11-04: 'CALIENTE WEDNESDAYS ... at TJs, Taj Hotel JLT / Salsa • Bachata • Kizomba with DJ AK Fabio / 8:30 PM–midnight' (read 2026-11-09)",
        checkedOn: "2026-11-09",
        evidenceUrl: "https://www.instagram.com/p/DfUSkXVNbS3/",
      },
    ],
  },
  // Le Piaf Dubai (Paris Society piano bar), Jumeirah Emirates Towers: its own Instagram, read by hand in the owner's Chrome
  // (D-796, D-797; Chrome audit 4-5, 2026-11-09), never fetched. Bio: "Mondays: @encoremondays / Wednesday: French
  // night at Le Piaf". No times stated (listed as "Time not listed"). Recheck monthly; drop a night if its posts stop.
  {
    url: "https://www.instagram.com/lepiaf_restaurant_dubai/",
    kind: "html",
    handChecked: true,
    trustTier: "first_party",
    styles: ["dj_night"],
    label: "Le Piaf Dubai",
    onlyHere: true,
    venueAddress: "Le Piaf, Jumeirah Emirates Towers Hotel, 1st floor, Trade Centre 2, Dubai",
    venuePage: true,
    fixedNights: [
      {
        title: "Encore Mondays",
        line: "Encore soiree, Every Monday at Le Piaf",
        days: [1],
        start: null,
        danceCited:
          "instagram.com/lepiaf_restaurant_dubai post 2026-10-18: 'Live performance raises it. The after-party takes it from there. Encore soiree, Every Monday at Le Piaf'; its bio names @encoremondays, which says 'late-night dancing every Monday at @lepiaf_restaurant_dubai' (read 2026-11-09)",
        checkedOn: "2026-11-09",
        evidenceUrl: "https://www.instagram.com/lepiaf_restaurant_dubai/p/DeoNDe2gKKW/",
      },
      {
        title: "French Night at Le Piaf",
        line: "every Wednesday at Le Piaf for a French night",
        days: [3],
        start: null,
        danceCited:
          "instagram.com/lepiaf_restaurant_dubai reel 2026-10-14: 'every Wednesday at Le Piaf for a French night filled with live shows, dinner, and dancing until late' (read 2026-11-09)",
        checkedOn: "2026-11-09",
        evidenceUrl: "https://www.instagram.com/lepiaf_restaurant_dubai/reel/Ded55XBSt97/",
      },
    ],
  },
  // Secret Lounge & Club, Montreal Hotel, Al Barsha 1: its own Instagram, read by hand in the owner's Chrome (D-796, D-797;
  // Chrome audit 4-8, 2026-11-09), never fetched. Vietnamese club nights: bio "VINAHOUSE • Every Night", and the week
  // of 11-04 had a post for each of Wed, Thu, Fri and Sat ("DJ Huy - Live DJ Performance"). Listed on the four posted
  // nights only. No times posted. Recheck monthly; drop the night if its posts stop.
  {
    url: "https://www.instagram.com/secretclubdubai/",
    kind: "html",
    handChecked: true,
    trustTier: "first_party",
    styles: ["dj_night"],
    label: "Secret Lounge & Club Dubai",
    onlyHere: true,
    venueAddress: "Secret Lounge & Club, Montreal Hotel, First Floor, 23rd St, Al Barsha 1, Dubai",
    venuePage: true,
    fixedNights: [
      {
        title: "Vina House Vietnamese Party",
        line: "VINAHOUSE • Every Night",
        days: [3, 4, 5, 6],
        start: null,
        danceCited:
          "instagram.com/secretclubdubai: bio 'VINAHOUSE • Every Night'; Thursday post 'DJ Huy - Live DJ Performance / Live Dancers' (week of 2026-11-04, read 2026-11-09)",
        checkedOn: "2026-11-09",
        evidenceUrl: "https://www.instagram.com/p/DfVTWTdkT36/",
      },
    ],
  },
];

/** Starting addresses retired, each with the reason (D-047). */
export const DUBAI_RETIRED: readonly RetiredSource[] = [
  {
    url: "https://beviparena.com/",
    reason:
      "found by discovery; a conference and studio venue in Dubai Production City (business forums, workshops), no dance nights; its events ?ical=1 answers an empty HTML page, so every read failed (reads 2-3, 2026-11-07/08)",
  },
  {
    url: "https://omniclubdubai.com/",
    reason:
      "found by discovery; its events calendar holds only theme demo rows (New York 'Manhattan Club', 2023) and no upcoming events; ?ical=1 answers empty HTML, every read failed (reads 1-3, 2026-11-06/08)",
  },
  {
    url: "https://steinway.ae/",
    reason:
      "found by discovery; Steinway & Sons Dubai piano showroom and concert-hall rentals, no dance nights and 0 upcoming events (2026-11-08); ?ical=1 answers empty HTML",
  },
  {
    url: "https://www.balcondubai.com/",
    reason:
      "found by discovery; answers 404 on every read (reads 1-3) and 403 from here (2026-11-08)",
  },
  {
    url: "https://solutions-leisure.com/events/",
    reason:
      "a leisure operator whose events page is mostly Cinema on the Sand in Ras Al Khaimah (outside the metro, not dance); its one Dubai row (Lucky 36 Fridays at Asia Asia, Pier 7) links only to a reservation app and was refused (read 42444842879, 2026-11-08)",
  },
  {
    url: "https://mccaffertysjvc.com/whats-on-jvc/",
    reason:
      "found by discovery; an Irish pub in JVC whose calendar holds quiz, brunch, trad (Irish music) and drinks nights, no dance night; read 42752775134 refused them all, but read 42956111758 wrote untimed copies of 'Ladies Night - Lads too' and 'trad thursday' (2026-11-11)",
  },
];
