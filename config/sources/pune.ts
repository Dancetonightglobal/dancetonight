// Pune's starting sources (D-1120). India is read under the US tier (D-034, the owner's choice for India in D-620;
// standing answer D-520 item 5): official APIs, public pages and feeds, robots.txt honoured, facts only, no
// bot-wall workarounds; Facebook and Instagram never; Resident Advisor only through its GraphQL endpoint (D-505,
// area 329). The owner's yes to District's terms (D-621) and District's yes to a daily read (D-542) are India-wide.
// Checked 2026-11-07 and left out: Allevents.in has no Pune party page for our bot (302 to /pages/404), SkillBox has
// no Pune city, DICE has no Pune page (/browse/pune 404), Townscript is discontinued, BookMyShow and SortMyScene
// answer 403 (the blocked-platform audit found no Pune dance venues on either, D-758, 2026-11-07). The daily run also seeds venues and discovers their websites
// (D-120).

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

/** A mixed directory whose listing pages name event pages carrying schema.org Event JSON-LD. */
const jsonldDirectory = (
  url: string,
  label: string,
  notDanceNights?: readonly string[],
): SeedSource => ({
  ...directory(url, label, ["club"]),
  mixedCalendar: true,
  kind: "jsonld",
  platform: "jsonld_items",
  ...(notDanceNights ? { notDanceNights } : {}),
});

// District's Pune nightlife pages list music jams, a band's tribute set and a rapper's live show beside the club
// nights: titles checked by the metro lead (2026-11-07).
const DISTRICT_NOT_DANCE: readonly string[] = [
  "Jamming Night - Pune",
  // The workshops page: a painting night and a kids' class (2026-11-07).
  "Sips & Strokes",
  "Kids Dance classes by Sachi",
  "MLTR by Abji and the Grooves",
  "Sambata Live at Ballr",
];

export const PUNE_SOURCES: readonly SeedSource[] = [
  // Salsa Vida's Pune guide: schema.org Events in the page (9 on 11/07): PURA VIDA Latin Social Nights (Saturdays,
  // LIVE, Koregaon Park), La Rumba (Furor Pune Salsa, Sundays), MAK Afro-Latin Nights (Tuesdays, Kiki, The Mills),
  // Pune Latin Nights (Fridays, The Mills), Latin Magica (third Tuesday, Revolution Bar, Baner). robots.txt allows it
  // (User-agent: * / Disallow: empty, checked 2026-11-07). Read as the other metros' Salsa Vida guides are (D-321).
  // La Rumba is read from Furor's own page below, not from here: Salsa Vida calls it weekly, but Furor's own page says
  // "happening twice a month" and names one dated night at a time (2026-11-08). The first read wrote Salsa Vida's
  // weekly La Rumba on 11-08 and 11-15, a week after the 11-01 night Furor's page gave.
  {
    ...directory("https://www.salsavida.com/guides/india/pune/", "Salsa Vida Pune", [
      "salsa",
      "bachata",
      "kizomba",
    ]),
    // Two more of its nights are contradicted by the organisers' own Instagram, read by hand in the owner's Chrome (Chrome
    // audit wave 4 - 7, 2026-11-09, D-796/D-802): Pune Latin Nights' account (@punelatinnights) gives its Friday
    // socials at Dobaraa (Phoenix Marketcity, Viman Nagar) since 2026-09-16, not The Mills; MAK Afro-Latin Nights
    // (@maklatinnights) moves venue each week (Kiki one week, Epitome on Wed 11-11), not "Tuesdays at Kiki". Neither
    // account passes D-796's 30-day rule today, so neither is listed until a fresh post does (recheck 2026-12-09).
    notDanceNights: ["La Rumba", "Pune Latin Nights", "MAK Afro-Latin Nights at Kiki"],
  },
  // Furor Pune Salsa's own La Rumba page (WordPress, punesalsa.com): "Upcoming La Rumba Details: 24K Kraft Brewzz, Viman
  // Nagar, 1st Nov 2026, Sunday, 8pm to 11pm - Social, Rs 450"; "happening twice a month". The venue changes, so it is
  // not onlyHere. robots.txt allows all but /wp-admin/ (checked 2026-11-08); no terms page (D-526). Model-read, one page.
  page("https://punesalsa.com/index.php/la-rumba/", "Furor Pune Salsa (La Rumba)", [
    "salsa",
    "bachata",
  ]),
  // District (D-542): each list page names its 12 soonest nights in a JSON-LD ItemList, and each event's own page
  // gives one Event per night, so jsonld_items reads them with no model. robots.txt allows /events/ and blocks /*?, so
  // there is no paging. 11/07: club nights at Kiki, Di Mora and Epitome (The Mills), Dorf Brewhouse (Baner), The Game
  // Palacio, Anti Social and Aufside. The music page (concerts, Goa and Kharghar festivals) and the social-mixers page
  // (dating, comedy, talks) hold no dance nights and are not read.
  jsonldDirectory(
    "https://www.district.in/events/nightlife-in-pune-book-tickets",
    "District Pune nightlife",
    DISTRICT_NOT_DANCE,
  ),
  jsonldDirectory(
    "https://www.district.in/events/nightlife-this-weekend-in-pune",
    "District Pune nightlife this weekend",
    DISTRICT_NOT_DANCE,
  ),
  // District's Pune workshops page (D-542): mostly craft, pottery and cooking workshops, with drop-in dance workshops
  // among them (11/07: "Bachata and Kizomba Dance Workshop in Baner", "Bachata Dance Class"). Read as a club-style mixed
  // directory so only rows that name a dance stay (D-588, D-590).
  jsonldDirectory(
    "https://www.district.in/events/workshops-in-pune-book-tickets",
    "District Pune workshops",
    DISTRICT_NOT_DANCE,
  ),
];

/** Starting addresses retired, each with the reason (D-047). */
export const PUNE_RETIRED: readonly RetiredSource[] = [
  {
    url: "https://www.district.in/events/music-in-pune-book-tickets",
    reason:
      "District's Pune music page lists concerts and out-of-town festivals, no dance nights (2026-11-07)",
  },
  {
    url: "https://www.district.in/events/social-mixers-in-pune-book-tickets",
    reason:
      "District's Pune social-mixers page lists dating, comedy and talks, no dance nights (2026-11-07)",
  },
  // Found by discovery on the first scheduled read (run 42436472311, 2026-11-08): none is a dance venue.
  {
    url: "https://mcckala.com/",
    reason:
      "Maharashtra Cultural Centre's arts home page (drama, music, visual arts), not a calendar feed: 'not an iCalendar file' (run 42436472311, 2026-11-08)",
  },
  {
    url: "https://www.gyaanadab.org/",
    reason:
      "a literary and cultural centre's home page, not a calendar feed: 'not an iCalendar file' (run 42436472311, 2026-11-08)",
  },
  {
    url: "https://www.seamedu.com/events",
    reason:
      "a media college's events (masterclasses, game days, film screenings), no dance nights; 0 written (run 42436472311, 2026-11-08)",
  },
  {
    url: "https://www.swigbar.com/",
    reason:
      "Swig in San Francisco (Union Square), not Swig Pune; matched by name. 0 written (run 42436472311, 2026-11-08)",
  },
  {
    url: "https://www.eventbrite.com/o/114096315351",
    reason:
      "The Vibrancy Clinic (Eventbrite): its only Pune night (11-09 ecstatic dance workshop) passed and nothing is listed since; silent every read 11-09..11-16 (cities sweep 2026-11-16)",
  },
];
