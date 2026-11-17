// Hong Kong's starting sources (D-660). US rules (the owner's choice, 2026-10-31): official APIs and public pages,
// robots.txt honoured; Facebook and Instagram never. Resident Advisor through its GraphQL listings only (D-505, area 71
// in config/sources/ra.ts). HKD, Chinese screen words and the no-postcode building rule ship before any venue page.

import type { RetiredSource, SeedSource } from "@/config/sources/nyc";
import type { StyleKey } from "@/config/styles";

const page = (url: string, label: string, styles: StyleKey[]): SeedSource => ({
  url,
  kind: "html",
  trustTier: "first_party",
  styles,
  label,
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

/** A directory page: pointers, never the organiser's own word (D-061, D-072). */
const directory = (url: string, label: string, styles: StyleKey[]): SeedSource => ({
  ...page(url, label, styles),
  trustTier: "directory",
});

export const HONG_KONG_SOURCES: SeedSource[] = [
  // The Fringe Club, Central (2 Lower Albert Road): its "Event" page lists the weekly Swing Dance Social, dated
  // (Wed 4, 11, 18 and 25 Nov 2026, 8:00 PM - 3 h, on 10-31) and the Blue Moon Milonga (Tue 10 Nov, 7:30pm),
  // beside talks and other events. Research sweep 10-31 (Hong Kong Swings' own site has expired; the social
  // runs here). robots.txt allows everything (checked 2026-10-31).
  {
    ...page("https://www.hkfringeclub.com/en/whatson/index/4-Event.html", "The Fringe Club", [
      "lindy_hop",
      "milonga",
    ]),
    venueAddress: "2 Lower Albert Road, Central, Hong Kong",
    venuePage: true,
    onlyHere: true,
    mixedCalendar: true,
    // One card per month, one "Wed 04-11-2026, 8:00 PM - 3 h" row per night under its title (D-670).
    datesList: true,
  },
  // The Fringe Club's "Workshop" page, same layout as its Event page: on 10-31 the 2026 Salsa Workshop (Franky
  // Salsaman, Thu 5, 12 and 19 Nov 2026, 7:30 PM - 2 h, Fringe Club) and Rhythm Studio's swing drop-in (Wed, 7:00 PM
  // - 1 h, Fringe Dairy), beside improv and other workshops. D-524 gap hunt #5, coverage-80 approved 10-31.
  {
    ...page(
      "https://www.hkfringeclub.com/en/whatson/index/6-Workshop.html",
      "The Fringe Club workshops",
      ["salsa", "lindy_hop"],
    ),
    venueAddress: "2 Lower Albert Road, Central, Hong Kong",
    venuePage: true,
    onlyHere: true,
    mixedCalendar: true,
    datesList: true,
  },
  // Bachata Viva (bachatahk.com): its weekly schedule on 10-31 ("Classes and parties every week", updated Thu 29 Oct):
  // Mon 8pm class at Vibe Dance Studio, Mong Kok; Wed 7:30pm and 8:30pm classes at Dancestar Academy, Causeway Bay;
  // Wed 9pm Bachata Romantica Party at K-97 (11 Lan Kwai Fong); Fri 10pm social at Sole Mio (51 Elgin St). Several
  // venues, so no venue page. robots.txt allows it (Yoast block, Disallow: empty, checked 2026-10-31). D-524 #10.
  {
    ...page("https://bachatahk.com/classes/", "Bachata Viva", ["bachata"]),
    weeklyGrid: true,
  },
  // Agozar, Sheung Wan (8/F Fung Woo Centre): a salsa studio; its home page states "Every Friday - Salsa Fiesta"
  // (its studio social, "NO PARTY 24th DEC & 31st DEC"; dated news "Halloween costume salsa party Friday 30th
  // October", updated 13 Oct 2026) and its drop-in class timetable. Own-site weekly (the owner 10-30). robots.txt
  // disallows /courses/ system folders only (checked 2026-10-31). The timetable is a weekly grid (weekday heading,
  // time-slot line, class title, no dates), read as weekly classes; a repeated class title takes only the days whose
  // slot matches its own start (D-673, D-524 gap #4). One fresh read (11-03, run 41572358065) got all 36 classes Mon-Sun
  // after a cached read on 11-01 stopped at Saturday's first slot (diag run 41303471985, coverage-85); normal cached
  // reads again from 11-04.
  {
    ...page("https://www.agozar.com/", "Agozar", ["salsa"]),
    venueAddress: "8/F Fung Woo Centre, 279-281 Des Voeux Road Central, Hong Kong",
    venuePage: true,
    onlyHere: true,
    weeklyGrid: true,
  },
  // Salsa Vida's Hong Kong guide (owner read the terms and said use it, HK6, 2026-10-31). schema.org Events in its
  // JSON-LD with full addresses and coordinates: on 10/31 eight nights over two weeks, Sat DanceMos Salsa Social
  // (2/F Kam Fung Commercial Building, Wan Chai, 9pm-1am), Wed K-97 social (11 Lan Kwai Fong, 9:30pm-1am), Fri
  // Salsa Fiesta (Agozar's studio) and Fri Latin night at Sole Mio (The Elgin, 51 Elgin St, 10pm-1:30am).
  // robots.txt allows it (User-agent: * / Disallow: empty, checked 2026-10-31).
  directory("https://www.salsavida.com/guides/china/hong-kong/", "Salsa Vida Hong Kong", [
    "salsa",
    "bachata",
    "kizomba",
  ]),
  // Hong Kong Salsa (hksalsa.com, owner said use it, HK6, 2026-10-31): a volunteer weekly grid ("Last Updated: 26th
  // October 2026"). On 10/31 its visible grid lists only Agozar's Friday Salsa Fiesta and a "may be an event by
  // DanceMos" Saturday note; past nights sit in HTML comments, which the page cleaner drops. No robots.txt (404).
  directory("https://www.hksalsa.com/", "Hong Kong Salsa", ["salsa", "bachata"]),
  // Space Club, 60 Wyndham Street, Central (DJ Mag top 100 #69; no site of its own): its Eventbrite organiser
  // "Space.hkg" lists dated club nights (on 10-31: Halloween DnB Sat 31 Oct, a special guest Fri 20 Nov). D-524 gap
  // #6, config-only (coverage-80 approved 10-31). Social Room has no organiser of its own on Eventbrite (only the
  // promoter "S2", o/121083498642), so it is not added.
  eventbrite("https://www.eventbrite.hk/o/64870093113", "Space Club (Eventbrite)", [
    "club",
    "house",
    "techno",
    "drum_and_bass",
  ]),
];

export const HONG_KONG_RETIRED: RetiredSource[] = [
  // Discovered, not seeded: read as a The Events Calendar site on every run since HK's first and never once good;
  // its /wp-json/tribe/events/v1/events answers 404 (run 41269268877, 2026-11-01; coverage-84 OK).
  {
    url: "https://themansionhk.com/",
    reason:
      "a bar's home page read as a The Events Calendar site; it is not one (its tribe events API answers 404, 2026-11-01)",
  },
  // Discovered, not seeded: The Wanch's ICS feed lists band sets and gigs (run 41383250941, 2026-11-02: 9 written,
  // e.g. "Shark Biscuit", "Woke Tyler and The Peasants Revolt", 21 screened as not events). D-528: The Wanch is
  // listed only with dance-floor evidence, and none was found (HK-7, 10-31).
  {
    url: "https://www.thewanch.hk/",
    reason:
      "a live-music bar's gig calendar: band sets, no dance nights (D-528, no dance-floor evidence; 2026-11-02)",
  },
];
