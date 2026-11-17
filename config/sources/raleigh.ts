// Raleigh's starting sources (D-600). US rules (D-034): official APIs and public pages, robots.txt honoured;
// Facebook and Instagram never; Resident Advisor through its GraphQL area only (D-505, config/sources/ra.ts).
// No DICE: none of its 6,134 sitemap venues is in Wake County or Durham (2026-10-31). ma.to's robots.txt
// disallows ClaudeBot by name, so it is not read (playbook Phase 1). Sources are added as they are checked; the
// daily run also seeds venues and discovers their websites (D-120).
// Not read (2026-10-31): Loafers Beach Club (private members' club, no site found), Legends (legends-club.com
// has no dance schedule), Boatman Spirits and Cuya (no events page / 403; both come through Salsa Vida),
// TangoMango's Orange page (outside the area), Pullen Dance (its Google Calendar keeps a weekly Wednesday rule
// beside separate "CANCELED DANCE" entries, so cancelled nights would show as on), Whiskey Rose (its Thursday
// line dance is only in an Instagram feed embed), Transfer Co. Ballroom (no events page),
// meetup-group-acklcnmq (Sunday swing, same nights as Carolina Dance Club).
// Durham (D-601), not read: Mystic Farm & Distillery (its Tuesday/Thursday line dance; whatismystic.com's
// robots.txt disallows ClaudeBot by name), Club ERA (no site of its own; Friday and Saturday nights only).
// Also not read (2026-10-31): Triangle Tangueros (no public calendar; its local nights come through TangoMango),
// Premier Dance Cary (a Friday practice party with no time, and no calendar on the page), Take the Lead Ballroom
// (its site names no city), Pickleback 2 (its events page lists a kids' party and a concert), Four Thirty 9 and
// PBR's Friday and Saturday nights (neither a site nor two guides say people dance, D-527). A Step to Gold,
// Elite Ballroom and Mambo Dinamico come through DanceGumbo.

import type { RetiredSource, SeedSource } from "@/config/sources/nyc";
import type { StyleKey } from "@/config/styles";

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
});

/** A Meetup group's own iCalendar feed (D-035 Q6: no Pro). robots.txt allows /events/ical/ (2026-10-31). */
const meetup = (group: string, label: string, styles: StyleKey[]): SeedSource => ({
  url: `https://www.meetup.com/${group}/events/`,
  kind: "feed_ics",
  feedUrl: `https://www.meetup.com/${group}/events/ical/`,
  trustTier: "first_party",
  styles,
  label,
  mixedCalendar: true,
});

export const RALEIGH_SOURCES: readonly SeedSource[] = [
  // Salsa Vida's Raleigh guide: schema.org Events on the page (8 on 10/31: Cuya Wednesdays, Boatman Spirits
  // Fridays); robots.txt allows it. Read as Miami's and London's are (D-321).
  // Salsa Vida lists only dance nights: not a mixed calendar, so a night whose title names no dance ("Noche Habanera") stays (D-772).
  {
    ...directory("https://www.salsavida.com/guides/north-carolina/raleigh/", "Salsa Vida Raleigh", [
      "salsa",
      "bachata",
    ]),
    mixedCalendar: false,
  },
  // Carolina Dance Club: ballroom, Latin and swing socials at the Raleigh Elks Lodge (5538 Leadmine Rd); its
  // Meetup feed had 1 dated social on 10/31 ("Sunday Afternoon Ballroom & Evening Swing Dancing").
  // The feed's events carry no LOCATION, so every listing is placed at the Raleigh Elks Lodge, where the
  // club's socials are held (first Raleigh read 2026-10-31 left it unplaced).
  {
    ...meetup("carolina-dance-club", "Carolina Dance Club (Meetup)", [
      "social_ballroom",
      "east_coast_swing",
      "west_coast_swing",
      "salsa",
    ]),
    venueAddress: "5538 Leadmine Rd, Raleigh, NC 27612",
  },
  // Raleigh Line Dance group: its Meetup feed (checked 2026-10-31) lists "Raleigh line dance Wednesday nights -
  // Brier Creek!" (6-8:15pm classes, Brier Creek Community Center, 10810 Globe Rd, Morrisville) and a Tuesday
  // 2:15pm class at the Anne Gordon Center for Active Adults (a daytime class at a 55+ centre, not a dance night,
  // so it is left out). The feed's events carry no LOCATION, so listings are placed at Brier Creek.
  {
    ...meetup("raleigh-line-dance-group", "Raleigh Line Dance (Meetup)", ["line_dance"]),
    venueAddress: "10810 Globe Rd, Morrisville, NC 27560",
    notDanceNights: ["Line dance at Anne Gordon Center for Active Adults"],
  },
  // TangoMango (tangomango.org): the free community tango calendar, Wake County page (robots.txt allows the
  // listing pages, Crawl-delay 10; no terms page; checked 2026-10-31). The reader is Miami's (#675, #685).
  {
    ...directory("https://www.tangomango.org/index.php?show=Wake,NC", "TangoMango Wake", [
      "milonga",
    ]),
    kind: "platform_api",
    platform: "tangomango",
  },
  // TangoMango's Durham County page (D-601); same reader and robots.txt (Crawl-delay 10) as Wake, 2026-10-31.
  {
    ...directory("https://www.tangomango.org/index.php?show=Durham,NC", "TangoMango Durham", [
      "milonga",
    ]),
    kind: "platform_api",
    platform: "tangomango",
  },
  // Salsa Vida's Durham guide (D-601): schema.org Events on the page (Ritmo Dance Social, Sat 11/7 on 10/31);
  // robots.txt disallows nothing.
  // Salsa Vida lists only dance nights: not a mixed calendar, so a night whose title names no dance ("Noche Habanera") stays (D-772).
  {
    ...directory("https://www.salsavida.com/guides/north-carolina/durham/", "Salsa Vida Durham", [
      "salsa",
      "bachata",
    ]),
    mixedCalendar: false,
  },
  // The Swing Space, Durham (D-601): West Coast Swing every Wednesday (Level 1-3 classes from 6:15pm, The Swing
  // Space Social Dance 8:30pm) and monthly Stellar Saturday socials, from the public Google Calendar that
  // theswingspace.dance embeds (theswingspace@gmail.com); weekly events carry LOCATION 2603 S Miami Blvd, Durham,
  // NC 27703. Read through the Calendar API (D-130: calendar.google.com's robots.txt closes the ICS address);
  // theswingspace.dance's robots.txt allows / (checked 2026-10-31).
  {
    url: "https://www.theswingspace.dance/",
    kind: "feed_gcal",
    platform: "feed_gcal",
    feedUrl: "https://calendar.google.com/calendar/ical/theswingspace%40gmail.com/public/basic.ics",
    trustTier: "first_party",
    styles: ["west_coast_swing"],
    label: "The Swing Space (Google Calendar)",
    venueAddress: "2603 S Miami Blvd, Durham, NC 27703",
    venuePage: true,
    mixedCalendar: true,
  },
  // Weekly nights the venue's or organiser's own site states (the owner 10-30: "A bars own weekly can count";
  // D-402 weeklyGrid). robots.txt checked 2026-10-31 for each.
  // PBR Cowboy Bar, Cary. "Every Thursday 7PM-9PM Line Dancing Boot Camp" on its Cary page;
  // robots.txt disallows only /wp-admin/ (Crawl-delay 10); no terms page (404).
  {
    url: "https://pbrcowboybar.com/cary/",
    kind: "html",
    trustTier: "first_party",
    styles: ["line_dance", "country"],
    label: "PBR Cowboy Bar Cary",
    venueAddress: "301 Fenton Gateway Dr, Cary, NC 27511",
    venuePage: true,
    mixedCalendar: true,
    weeklyGrid: true,
  },
  // Salsa4Life Wednesdays at Komana Brewery. "Make Every Wednesday a Dance Night" at Komana
  // Brewery, 7:30 lesson, 8:30-11pm social (salsa, bachata, merengue); robots.txt disallows only
  // /calendar/action~* views, not /events/.
  {
    url: "https://salsa4life.com/events/",
    kind: "html",
    trustTier: "first_party",
    styles: ["salsa", "bachata", "merengue"],
    label: "Salsa4Life Wednesdays at Komana Brewery",
    venueAddress: "1020 Ryan Rd, Cary, NC 27511",
    weeklyGrid: true,
  },
  // Carolina Dance Club's own site. "SUNDAY NIGHT SWING DANCING ... 22 years of Sunday night
  // social dancing in Raleigh. 6 PM Beginner & Intermediate East Coast Swing Lessons", plus 1st Sunday
  // afternoon ballroom and 2nd Sunday afternoon country; robots.txt disallows only /Contact.
  {
    url: "https://www.carolinadanceclub.com/",
    kind: "html",
    trustTier: "first_party",
    styles: ["east_coast_swing", "social_ballroom", "country"],
    label: "Carolina Dance Club",
    venueAddress: "5538 Leadmine Rd, Raleigh, NC 27612",
    mixedCalendar: true,
    weeklyGrid: true,
  },
  // Flex Nightclub. dated calendar of DJ, go-go, drag and tea-dance nights (karaoke and drag shows
  // are screened out as mixed); robots.txt disallows only /wp-admin/ and wpforms uploads.
  {
    url: "https://flex-club.com/calendar/",
    kind: "html",
    trustTier: "first_party",
    styles: ["dj_night", "queer_party"],
    label: "Flex Nightclub",
    venueAddress: "615 W Hargett St, Raleigh, NC 27603",
    venuePage: true,
    mixedCalendar: true,
  },
  // Carmen's Cuban Café, Morrisville. Its own events page (SpotHopper) lists a 2nd Friday Latin Social (Cuban
  // salsa, merengue, bachata, rueda casino lesson 9pm, 9pm-1am) and Agua Y Fuego salsa every 4th Friday
  // (9:30pm-2am); robots.txt checked 2026-10-31. Its Tuesday salsa is not on this page: Mambo Dinamico runs it
  // ("Tuesday Salsa After Work Social", classes 7 and 8pm, social 9pm; tickets dated 10/20-12/29 on
  // mambodinamico.com, checked 2026-10-31), and Salsa Vida lists it.
  {
    url: "https://carmenscubancafe.com/events",
    kind: "html",
    trustTier: "first_party",
    styles: ["salsa", "bachata", "merengue", "rueda"],
    label: "Carmen's Cuban Café",
    venueAddress: "108 Factory Shops Rd, Morrisville, NC 27560",
    venuePage: true,
    mixedCalendar: true,
  },
  // Westwood, 518 W Jones St. Its own page: "mondays: mambo monday 7pm - 11pm" (its karaoke, DJ and day-party
  // lines name no dance and are screened out); robots.txt allows / (checked 2026-10-31). Raleigh's first Monday.
  {
    url: "https://www.westwoodraleigh.com/",
    kind: "html",
    trustTier: "first_party",
    styles: ["salsa"],
    label: "Westwood Mambo Mondays",
    venueAddress: "518 W Jones St, Raleigh, NC 27603",
    venuePage: true,
    mixedCalendar: true,
    weeklyGrid: true,
  },
  // DanceGumbo, the Triangle's social-dance calendar, as its iCalendar feed (50 events on 10-31, with venue
  // addresses; Orange County ones fall outside and are dropped). No terms page exists (2026-10-31); robots.txt
  // allows /events.ics (Crawl-delay 10, honoured); read daily (the owner, D-526). Times are real UTC or New York.
  {
    ...directory("https://www.dancegumbo.com/", "DanceGumbo", [
      "salsa",
      "bachata",
      "west_coast_swing",
      "social_ballroom",
      "country",
      "milonga",
    ]),
    kind: "feed_ics",
    feedUrl: "https://www.dancegumbo.com/events.ics",
  },
  // Eventbrite organisers found by hand from Eventbrite's public Raleigh search pages (salsa, bachata, swing,
  // line-dancing, dance-party, dance, kizomba, shag), 2026-10-31 (D-131).
  eventbrite("https://www.eventbrite.com/o/numinus-live-9223007265", "Numinus Live (Eventbrite)", [
    "bachata",
    "salsa",
    "kizomba",
  ]),
  // Its Wednesday listing is the salsa4life.com weekly at Komana above; the two do not merge (Eventbrite
  // lists it as a class, salsa4life.com as a social with a lesson, and the organizer link never joins a
  // class to a social), so live Nov 4 showed it twice. The Eventbrite copy is left out.
  {
    ...eventbrite(
      "https://www.eventbrite.com/o/salsa4life-72082428513",
      "Salsa4Life (Eventbrite)",
      ["salsa"],
    ),
    notDanceNights: ["Salsa Wednesdays w/ lessons @Komana Brewery with Salsa4Life.com"],
  },
  eventbrite(
    "https://www.eventbrite.com/o/121914755995",
    "Salsa, Bachata & Good Vibes (Eventbrite)",
    ["salsa", "bachata"],
  ),
  eventbrite(
    "https://www.eventbrite.com/o/rdu-blues-dance-76857622513",
    "RDU Blues Dance (Eventbrite)",
    ["blues"],
  ),
  eventbrite(
    "https://www.eventbrite.com/o/wisemen-entertainment-50101400903",
    "Wisemen Entertainment (Eventbrite)",
    ["dj_night"],
  ),
  eventbrite(
    "https://www.eventbrite.com/o/mel-entertainment-34180469083",
    "MEL Entertainment (Eventbrite)",
    ["dj_night"],
  ),
  eventbrite("https://www.eventbrite.com/o/tim-boss-31774842755", "Tim Boss (Eventbrite)", [
    "dj_night",
  ]),
  eventbrite(
    "https://www.eventbrite.com/o/marceau-winston-34884130473",
    "Marceau Winston (Eventbrite)",
    ["dj_night"],
  ),
  eventbrite("https://www.eventbrite.com/o/afroevents-7252662729", "AfroEvents (Eventbrite)", [
    "afrobeats_club",
  ]),
  eventbrite("https://www.eventbrite.com/o/urban-desi-95244133413", "Urban Desi (Eventbrite)", [
    "bollywood",
  ]),
  // Cultural organisers (D-551, D-604), found by hand from Eventbrite's Raleigh search pages (diwali, bollywood,
  // amapiano, afrobeats), 2026-11-01. PK Suya's "Amapiano and Friends" parties come through AfroEvents above.
  eventbrite(
    "https://www.eventbrite.com/o/68482846593",
    "Diwali Night, Raj Royal Events (Eventbrite)",
    ["bollywood"],
  ),
  eventbrite(
    "https://www.eventbrite.com/o/121906090760",
    "Grand Diwali Mahotsav, Radha Krishna Temple (Eventbrite)",
    ["garba", "bollywood"],
  ),
  eventbrite("https://www.eventbrite.com/o/1215510427", "DJ Shinski AfroPiano (Eventbrite)", [
    "afrobeats_club",
  ]),
  eventbrite("https://www.eventbrite.com/o/17987935265", "Amapiano and Friends (Eventbrite)", [
    "afrobeats_club",
  ]),
  eventbrite(
    "https://www.eventbrite.com/o/51351480633",
    "Axé Rhythm and Dance Festival (Eventbrite)",
    ["samba"],
  ),
  // Neptunes Parlour, downtown Raleigh: basement bar with DJ dance parties ("DOUGISH: FIRST FRIDAY DANCE PARTY",
  // "OPEN DECKS: DJ NETWORKING + DANCING") and Latin nights; its own Squarespace events page; robots.txt allows
  // /events (checked 2026-11-06). Found by the blocked-platform audit (MATO, D-758, 2026-11-06).
  {
    url: "https://www.neptunesraleigh.com/events",
    kind: "squarespace",
    platform: "squarespace",
    trustTier: "first_party",
    styles: ["dj_night"],
    label: "Neptunes Parlour",
    venueAddress: "14 W Martin St, Raleigh, NC 27601",
    venuePage: true,
    onlyHere: true,
    mixedCalendar: true,
  },
];

/** Starting addresses retired, each with the reason (D-047). */
export const RALEIGH_RETIRED: readonly RetiredSource[] = [
  // 8 Count Country's lessons page (#884): its Tuesday and Wednesday rows were the lessons only, beside
  // DanceGumbo's own row for each night (live 11-03 and 11-04 showed them two and three times).
  {
    url: "https://www.8countcountry.com/lessons",
    reason: "lesson-only rows; DanceGumbo carries one row per night",
  },
  // Five addresses discovery added (11-01 run 41311342759): none is a dance source and none has ever
  // written a row, so each read only cost fetches and database work.
  { url: "https://chapelofbones.com/", reason: "events page answers 404; not a dance source" },
  { url: "https://www.icsnc.org/events/", reason: "events page answers 404; not a dance source" },
  {
    url: "https://apexaquavitae.com/",
    reason: "its feed is not an iCalendar file; not a dance source",
  },
  {
    url: "https://bccraleigh.org/event/read-write-run-5k/",
    reason: "a 5k race page, its feed is not an iCalendar file; not a dance source",
  },
  {
    url: "https://www.honeygirlmeadery.com/",
    reason: "its feed is not an iCalendar file; not a dance source",
  },
  // Living Arts Collective's Google Calendar (#1008, D-573): its first read (11-02 run 41444916203) wrote FRINGE
  // Festival theatre shows as dance listings and a second Sunday Dancewave beside DanceGumbo's row, which already
  // carries the Sunday Dancewave and the Contact Improv Jam.
  {
    url: "https://www.livingartscollective.com/dancewave/",
    reason: "theatre shows from a mixed calendar; DanceGumbo carries its Sunday Dancewave",
  },
  // Motorco Music Hall's calendar (D-758, #1178): read fine on three scheduled reads (11-07, 11-08, 11-09 run
  // 42617238873) but listed nothing on the next 7 nights and never wrote a row; each read cost a model call.
  {
    url: "https://motorcomusic.com/calendar/",
    reason: "read fine three times but never wrote a row; no dance nights in its next 7 days",
  },
  {
    url: "https://arts.duke.edu/events/",
    reason:
      "Duke Arts' university events calendar (wind symphony, vespers, talks, plays, info sessions): 19 non-dance cards in the 2026-11-16 daily report (cities sweep 2026-11-17)",
  },
];
