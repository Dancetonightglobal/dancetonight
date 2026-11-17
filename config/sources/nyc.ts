// New York's starting sources (D-043 question 9), from docs/SOURCES.md section 8. Every URL
// there came from search snippets only (no page could be loaded during the research), so every
// entry is unverified: `html` sources are probed on the first run (src/pipeline/probe.ts), which
// decides whether each is a feed, a calendar platform, a page with schema.org events, or a page
// that waits for the Phase 3 extractor. A dead or blocked URL is reported, not hidden.
//
// The owner's recall list refines this in Phase 3; deterministic discovery (D-040) grows it.

import type { SourceKind, TrustTier } from "@/src/adapters/types";
import type { StyleKey } from "@/config/styles";

/** D-831: the site owner's written permission to read a site whose robots.txt disallows us. */
export interface RobotsWaiver {
  /** Who granted it ("AgendaTrad via the owner"). */
  grantedBy: string;
  /** When, YYYY-MM-DD. */
  on: string;
  /** The DECISIONS entry that records it ("D-831"); a config test requires it. */
  decision: string;
}

export interface SeedSource {
  /** D-831: read this seed's own host although its robots.txt disallows us (written permission). */
  robotsWaiver?: RobotsWaiver;
  url: string;
  kind: SourceKind;
  trustTier: TrustTier;
  platform?: string;
  feedUrl?: string;
  /** Styles the source is known for; used only when a listing names none and there is one. */
  styles: StyleKey[];
  label: string;
  /**
   * Clock times this site prints for every event whatever the real time, as HH:MM. A stated time
   * equal to one of them is read as not listed (D-063), so the listing shows "Time not listed"
   * rather than a time the organiser never gave.
   */
  placeholderTimes?: readonly string[];
  /**
   * The site prints every event's start clock wrong (theronda.us shows New York times as UTC,
   * 4 or 5 hours early; checked 2026-10-14): its doors and dancing times are read as not listed,
   * and only times written in the event's own text (a class time) are kept.
   */
  startTimesShifted?: boolean;
  /**
   * Rooms of this venue that its listings name as their place ("Bad Room" at Good Room). A
   * listing whose place is one of these, with no address of its own, is at the source's own
   * venue under the source's label (2026-10-15).
   */
  venueRooms?: readonly string[];
  /**
   * The page's event cards run a date line, rooms and genre tags into the title (93 Feet East,
   * D-224): a title starting with `prefix` loses it, then each leading "/ <room>" of `rooms`, then
   * each trailing tag of `tails`. A title left with no letters is the card's date, not an event.
   * A raw title matching `danceCard` ("93 CLUB ...") is the venue's own club night: its
   * cleaned title counts as one of the source's `danceNights` (D-292).
   */
  cardTitle?: {
    prefix: RegExp;
    rooms: readonly string[];
    tails: readonly string[];
    danceCard?: RegExp;
  };
  /**
   * Every night this page lists happens at this venue (2026-10-15). A listing's place is taken to
   * be the venue unless the listing gives a street address of its own (one with a house number):
   * a room, a band or a series named as the place, or an address like "New York, NY", is not
   * another place.
   */
  onlyHere?: boolean;
  /**
   * The page is a venue's weekly grid: its nights stand under weekday headings ("Domingos",
   * "MIÉRCOLES") or one line of weekdays ("Martes y sábados, 20:30 hs."), with no dates (D-402). A
   * listing read from it with no rule and no date takes its weekdays from the page (`weeklyGridRule`).
   */
  weeklyGrid?: boolean;
  /**
   * The page lists its nights with dates only and links each night's own page on the same site,
   * whose JSON-LD Event gives the start (The Ave Live): an untimed read listing takes its start
   * from that page (D-275, `timesFromEventPages`).
   */
  eventPageTimes?: boolean;
  /**
   * The page shows a recurring event as one card ("Multiple dates and times") linking the event's own
   * page on the same site, whose JSON-LD lists one Event per occurrence (Tickettailor organisers): a read
   * listing with no date, or with a weekly rule, becomes one night per listed date in the window
   * (D-483, `datesFromEventPages`).
   */
  eventPageDates?: boolean;
  /**
   * The source lists a weekly night as one dated event for its next date only (DanceUS's rolling calendar): a
   * dated listing whose own page marks it "Recurring" and names the listing's weekday ("Every Friday",
   * "Fridays", "todos los viernes") becomes a weekly rule (D-465, `weeklyFromEventPages`).
   */
  eventPageWeekly?: boolean;
  /**
   * The source starts each title with its own area label ("Carolina / Isla Verde: Sábado Bailables",
   * Viajando y Bailando): its MEC RSS reader drops the label and keeps the raw title in evidence, so the
   * same night from another source matches it (D-515).
   */
  titleAreaPrefix?: boolean;
  /**
   * How many of this source's event pages `timesFromEventPages` may read in one run; unset means
   * EVENT_PAGE_TIMES_PER_SOURCE (8). For a first-party agenda with more untimed nights than that (Marula Café).
   */
  eventPageTimesLimit?: number;
  /**
   * The page is one event's, listing its dates one bare date per line under one title with one
   * time block (Newham's tea dances): every window night it lists gets a copy of the model's
   * listing for that title (D-491, `withListedDates`).
   */
  datesList?: boolean;
  /**
   * The model reads the page afresh on every run, serving no cached answer for its text (D-480):
   * for a page whose cached read is wrong and whose text does not change (Newham's tea dances).
   * The new answer is still cached.
   */
  extractUncached?: boolean;
  /**
   * The source's JSON-LD times are local wall-clock times with a wrong UTC offset (Salsa Vida's Quintana Roo
   * guides write -06:00 for UTC-5 Cancun): its JSON-LD readers drop the offset and read the clock in the
   * listing's zone (D-1083).
   */
  wallClockTimes?: boolean;
  /**
   * The opening hours the venue's own site states for its nights (D-494, Lust in Rio: "Quarta-feira a
   * Sábado 00:00 to 06:00" on its home page, not on the programme page read). A dated listing from
   * this source with no doors, lesson or dancing time, on one of `days`, takes `start` as its dancing
   * time and `end`, when the venue states one, as its end time (when it has none). Hand-checked like a known venue: `checked`
   * names the page, its words and the date.
   */
  houseHours?: {
    /** "HH:MM", 24-hour; before 06:00 is after midnight of the listed night. */
    start: string;
    /** "HH:MM", 24-hour; left out when the venue states no closing time. */
    end?: string;
    /** Weekdays, 0 = Sunday ... 6 = Saturday, of the listing's local_date. */
    days: readonly number[];
    checked: string;
  };
  /**
   * The source's JSON-LD writes local wall-clock times with a "Z" suffix (Comfama, Medellín: "2026-11-27T20:00:00Z"
   * for an 8pm local start). A listing read from its JSON-LD whose quoted startDate (and endDate) ends in "Z" is
   * re-read as local time in the listing's zone (`withZuluAsLocal`). Hand-checked against the page's visible time.
   * A string is the one wrong UTC offset the source writes instead of "Z" (Salsa Vida's Beirut guide writes "-08:00"
   * on 9:30pm Beirut starts, 2026-11-07): times ending in exactly that offset are re-read the same way.
   */
  jsonldZuluIsLocal?: boolean | string;
  /**
   * Standing weekly nights the source's own page prints as text, listed without the model (D-524 follow-up). Each
   * run lists one only while `line` is still on the fetched page (whitespace, case and dash style ignored); a line
   * that is gone lists nothing and is noted. `danceCited` says where dancing is stated (D-527: own site, or two
   * recent guides per D-529).
   */
  fixedNights?: readonly {
    /** The night's title as listed (config's, never the model's): unique per source; it keys the row. */
    title: string;
    /** The exact words on the page that state the night, quoted from the page. */
    line: string;
    /** Weekdays, 0 = Sunday ... 6 = Saturday (as houseHours). */
    days: readonly number[];
    /** Monthly on these weeks of the month (1..5 = nth such weekday, -1 = last), else weekly (D-827). */
    weeksOfMonth?: readonly number[];
    /** "HH:MM" 24-hour start; null when the page gives none (listed as "Time not listed"). */
    start: string | null;
    /** "HH:MM" 24-hour end, if stated; an end earlier than the start is after midnight. */
    end?: string;
    /** Styles of this night; else the source's styles. */
    styles?: StyleKey[];
    /** Required: where dancing at this night is stated, with date checked; blank lists nothing. */
    danceCited: string;
    /** Model-read titles this night replaces: the read's listings with these titles are dropped. */
    replacesTitles?: readonly string[];
    /**
     * Nights the venue says it is closed, `from`..`to` inclusive ("YYYY-MM-DD" night dates): not listed. `cited`
     * says where the closure is stated (Caveau de la Huchette: "Fermeture exceptionnelle pour travaux", 2026-11-07).
     */
    closed?: readonly { from: string; to: string; cited: string }[];
    /** The venue's name for this night, when it is not the source's label (an organiser's page): else the label. */
    venue?: string;
    /** With `handChecked`: "YYYY-MM-DD" a person last saw this night on the venue's own Instagram (D-797). */
    checkedOn?: string;
    /** With `handChecked`: the Instagram post URL that shows the night (never fetched, D-797). */
    evidenceUrl?: string;
  }[];
  /**
   * A venue's own Instagram account, or its own site that blocks our bot (D-798), read by hand in the owner's
   * browser (D-796, D-797): never fetched and
   * never read by the model. Its `fixedNights` list while their `checkedOn` is under 35 days old.
   */
  handChecked?: true;
  /**
   * The page is a venue's whole calendar, dance nights among concerts, talks and games: a listing
   * on it that names no dance, no style and no kind of dance night, and starts before 10pm, is a
   * show, not a dance night (`screenNoDance`, PR 2).
   */
  mixedCalendar?: boolean;
  /**
   * A dance-floor venue whose bands play for dancers (D-341, New Orleans' band bars): on its whole
   * calendar (`mixedCalendar`) a band billing that names no dance is live music with dancing, not a
   * concert. Set only with evidence that people dance there; never on a directory. Absent means false.
   */
  bandsForDancers?: boolean;
  /**
   * With `bandsForDancers`: the local time ("HH:MM", 24-hour) from which a band billing counts as
   * playing for dancers (D-322, Ball & Chain's noon trio and 6pm jazz sets). A listing starting
   * earlier on its night is read as if `bandsForDancers` were false. Absent: all day.
   */
  bandsForDancersFrom?: string;
  /**
   * Titles of this venue's own dance nights that name no dance ("Chambre Noir", "Heatwave"), each
   * checked by the metro lead: on a mixed calendar the no-dance screen keeps a listing whose title
   * is one of them, compared after normalizeForMatch (case, accents and punctuation ignored) (D-264).
   */
  danceNights?: readonly string[];
  /**
   * Titles this source lists that are not dance nights though they pass every screen (a teacher
   * training, a concert), each checked by the metro lead: the no-dance screen leaves out a listing
   * whose title is one of them, on any calendar, compared after normalizeForMatch (case, accents and
   * punctuation ignored), as `danceNights` is (2026-10-30).
   */
  notDanceNights?: readonly string[];
  /**
   * Other names this organiser's nights go by on other sites, beside `label` (lane 1, D-090): a
   * directory's or ticket seller's listing titled exactly by one is this source's night, when the
   * two agree on the night, the time and the kind of night.
   */
  alsoListedAs?: readonly string[];
  /**
   * This source's regular nights whose listings may name no place: a phrase of the title (compared
   * after normalizeForMatch, as whole words) to the name of the venue they are held at, as the
   * organiser's own page states it (cite it in a comment at the entry). Fills only a listing with no
   * venue name, no address and no map point of its own (D-279, TangoLX's "Milonga Guapa").
   */
  titleVenues?: Readonly<Record<string, string>>;
  /**
   * The page is a venue's own: a club, studio, bar or restaurant whose nights happen there. Only
   * such a page takes the seeded venue that lists its website, and so places a listing that names
   * no other place at that venue (D-087 as amended). An organiser's or a dance group's site is not
   * a venue page, even when the map data lists a place under its name.
   */
  venuePage?: boolean;
  /**
   * The street address of the venue whose own page this is, for a venue the seeded map data does
   * not hold (D-138). A listing on this source that names no address, and names no place or the
   * source's own label, is placed at this address under the source's label. On a page that is not
   * a venue's own (no `venuePage`), it applies to that exact address only, never to the rest of
   * its host.
   */
  venueAddress?: string;
  /**
   * The page lists several cities' events, each linked to an event page whose path names its city:
   * the link prefix of this metro's events. A listing linking to another city's event page on that
   * host is left out as not in the metro (`otherCityLink`, Daybreaker 2026-10-22).
   */
  cityLinkPrefix?: string;
}

const page = (url: string, label: string, styles: StyleKey[]): SeedSource => ({
  url,
  kind: "html",
  trustTier: "first_party",
  styles,
  label,
});

/**
 * A Squarespace events list, read as its page shows it with each item's own page followed (D-111);
 * never its `?format=json` view, which Squarespace's robots.txt disallows. `list` is the events
 * page when the starting address is not it.
 */
const squarespace = (
  url: string,
  label: string,
  styles: StyleKey[],
  list?: string,
): SeedSource => ({
  ...page(url, label, styles),
  kind: "squarespace",
  platform: "squarespace",
  ...(list ? { feedUrl: list } : {}),
});

/** A page naming its events' own pages (a JSON-LD ItemList, Wix event links), followed (D-111). */
const eventPages = (url: string, label: string, styles: StyleKey[]): SeedSource => ({
  ...page(url, label, styles),
  kind: "jsonld",
  platform: "jsonld_items",
});

/** A listings site that gathers other people's nights: not the organiser (D-061). */
const directory = (url: string, label: string, styles: StyleKey[]): SeedSource => ({
  ...page(url, label, styles),
  trustTier: "directory",
});

import { diceSources } from "@/config/sources/dice";

/** DICE's New York browse pages (D-139, D-148). */
const DICE_BROWSE = "https://dice.fm/browse/new_york-5bbf4db0f06331478e9b2c59/music";

export interface RetiredSource {
  url: string;
  reason: string;
}

export const NYC_SOURCES: readonly SeedSource[] = [
  // Swing, Lindy and blues
  directory("https://thisweekinswingnyc.com/", "This Week in Swing NYC", ["lindy_hop"]),
  // The events list, not the home page: the model read the home page's "Oct 1" and "Oct 8" as
  // headings (D-110).
  squarespace("https://frimframjam.com/calendar", "Frim Fram Jam", ["lindy_hop"]),
  page("https://swingremixnyc.com/", "Swing Remix", ["lindy_hop"]),
  // The exchange's three evening dances, each dated, timed and placed; the home page gives only
  // "October 9-11" (D-110). This Week in Swing lists the exchange's nights as "NYLX" (lane 1, D-090).
  {
    ...page("https://www.nylindy.com/dances-2026", "New York Lindy Exchange", ["lindy_hop"]),
    alsoListedAs: ["NYLX"],
  },
  eventPages("https://nycswings.net/", "NYC Swings", ["west_coast_swing"]),
  // One embed merging 29 hosts' Google Calendars, read through the Calendar API (lane 5, D-130).
  {
    ...page("https://nycwcs.com/", "NYC West Coast Swing", ["west_coast_swing"]),
    kind: "feed_gcal",
    platform: "feed_gcal",
  },
  // Salsa, bachata, kizomba, zouk
  // A music venue's calendar: salsa and bachata classes, Bollywood and Haitian parties, and
  // concerts, album releases, a poetry night and a games tournament (run 33).
  { ...page("https://sobs.com/calendar", "SOB's", []), mixedCalendar: true, venuePage: true },
  {
    ...page("https://steppingoutstudios.com/social-events1", "Stepping Out Studios socials", []),
    venuePage: true,
  },
  // Tango
  // Its calendar is drawn in the browser from three CSV files, read by lane 5's reader with
  // New York Tango's permission (D-084 question 1, D-133).
  {
    ...directory("https://newyorktango.com/", "New York Tango", ["milonga"]),
    kind: "platform_api",
    platform: "newyorktango",
  },
  // Posh's recent-events sitemap; each event page's schema.org Event, kept inside the metro (D-152).
  {
    ...directory("https://posh.vip/sitemap-events-recent.xml", "Posh", []),
    kind: "platform_api",
    platform: "posh",
  },
  // Every event on the page reads "3:00 PM" (checked 2026-09-28: eight of eight, including a
  // practica whose own note says its class runs 2:30 to 3:30pm), so 3pm there is not a time.
  // Its clock times are also shifted 4 hours early (2026-10-14), so its start times are dropped.
  {
    ...directory("https://theronda.us/nyc", "The Ronda NYC", ["milonga"]),
    placeholderTimes: ["15:00"],
    startTimesShifted: true,
  },
  page("https://nuevotangoarts.org/2026-calendar", "Nuevo Tango Arts", ["milonga"]),
  // Ballroom, hustle, country
  eventPages("https://bigappleranch.com/", "Big Apple Ranch", ["two_step"]),
  // Ecstatic, contact, contra, English, Scottish
  // CDNY: its home page showed four dates and a price list the model read as a night (D-110), so
  // it is retired; the season's list is read as a Google Calendar feed below (lane 5, D-130).
  squarespace(
    "https://brooklyncontra.org/",
    "Brooklyn Contra",
    ["contra"],
    "https://www.brooklyncontra.org/events",
  ),
  // Its socials, from the events list; the home page shows only some of them.
  squarespace(
    "https://rscdsnewyork.org/",
    "RSCDS New York",
    ["scottish_country"],
    "https://www.rscdsnewyork.org/all-events",
  ),
  // The weekly Thursday class and its exceptions; the home page shows the socials only (D-110).
  page("https://www.rscdsnewyork.org/classes", "RSCDS New York classes", ["scottish_country"]),
  // Monthly blues dances. The apex host has no certificate for its name, www does (D-110).
  squarespace("https://www.bluesdancenewyork.com/events", "Blues Dance New York", ["blues"]),
  {
    url: "https://www.eventbrite.com/o/115478120751",
    kind: "ticketing_api",
    trustTier: "ticketing",
    platform: "eventbrite",
    styles: ["contra"],
    label: "Country Dance New York on Eventbrite",
  },
  // Lane 5 (D-130): the Google Calendars two organisers embed, read through the Calendar API.
  // The page is the source, so a listing links to it and a calendar the organiser adds is read.
  // CDNY's front page is retired (D-110); its calendar sits on another page.
  {
    ...page("https://cdny.org/calendar-events", "Country Dance New York calendar", ["contra"]),
    kind: "feed_gcal",
    platform: "feed_gcal",
  },
  // bluesdancenewyork.com without www. is retired below (its certificate does not name it);
  // www. answers, and its calendar page embeds the NYC Blues Calendar.
  {
    ...page("https://www.bluesdancenewyork.com/calendar", "Blues Dance New York calendar", [
      "blues",
    ]),
    kind: "feed_gcal",
    platform: "feed_gcal",
  },
  // Lane 5 (D-131): Elsewhere, a Brooklyn club, sells every night through Eventbrite and links
  // only event pages. The Eventbrite adapter reads this page for those links and asks the API
  // whose they are. About half its nights are concerts, which the mixed-calendar rule screens.
  {
    url: "https://www.elsewhere.club/events",
    kind: "ticketing_api",
    trustTier: "ticketing",
    platform: "eventbrite",
    styles: [],
    label: "Elsewhere (tickets on Eventbrite)",
    mixedCalendar: true,
  },
  // Lane 3 (D-115): first-party pages that list their own dated nights, each checked live on
  // 2026-10-05 (robots.txt allows it; counts are for 10/5 to 10/17).
  // A SoHo restaurant's live salsa nights: band, free lesson on Thursdays (5 in the window).
  {
    ...page(
      "https://gygnyc.com/new-york-soho-greenwich-village-gonzalez-y-gonzalez-live-salsa",
      "Gonzalez y Gonzalez",
      ["salsa"],
    ),
    venuePage: true,
    venueAddress: "192 Mercer St, New York, NY 10012",
    onlyHere: true,
  },
  // A ballroom studio's group classes for the week and its socials (about 16 in the window).
  { ...page("https://bigappleballroom.com/schedule", "Big Apple Ballroom", []), venuePage: true },
  // Salsa Tuesdays, 7 to 11pm (2 in the window).
  {
    ...page("https://cobblefish.net/events", "Cobble Fish", ["salsa"]),
    venuePage: true,
    venueAddress: "89 South St, Pier 16, New York, NY 10038",
    onlyHere: true,
  },
  // Free outdoor salsa, Wednesdays 6 to 9pm, May 6 to October 28 (2 in the window).
  page("https://misalsadurabaileevent.netlify.app/", "Mi Salsa Dura Baile", ["salsa"]),
  // The Manhattan studio's weekly salsa and bachata timetable (about 16 classes a week).
  {
    ...page("https://nievesdancestudio.com/manhattan/", "Nieves Dance Studio Manhattan", ["salsa"]),
    venuePage: true,
  },
  // A Ridgewood club's nights (3 in the window).
  {
    ...page("https://h0l0.nyc/", "H0L0", []),
    venuePage: true,
    venueAddress: "1090 Wyckoff Ave, Ridgewood, NY 11385",
    onlyHere: true,
  },
  // Venues' whole calendars: DJ nights beside sunset bar hours, cabaret shows and concerts.
  {
    ...page("https://www.lebainnewyork.com/", "Le Bain", []),
    mixedCalendar: true,
    venuePage: true,
  },
  {
    ...page("https://calendar.houseofyes.org/", "House of Yes", []),
    mixedCalendar: true,
    venuePage: true,
  },
  {
    ...page("https://lpr.com/", "Le Poisson Rouge", []),
    mixedCalendar: true,
    venuePage: true,
    venueAddress: "158 Bleecker St, New York, NY 10012",
    onlyHere: true,
  },
  // Venue calendars discovery found, mostly concerts, shows and talks; screened as mixed calendars
  // (2026-10-22). Addresses from each venue's own visit page.
  {
    ...page("https://www.momaps1.org/en/calendar", "MoMA PS1", []),
    mixedCalendar: true,
    venuePage: true,
    venueAddress: "22-25 Jackson Ave, Long Island City, NY 11101",
  },
  {
    ...page("https://roulette.org/calendar/", "Roulette Intermedium", []),
    mixedCalendar: true,
    venuePage: true,
    venueAddress: "509 Atlantic Ave, Brooklyn, NY 11217",
  },
  {
    ...page("https://www.hostoscenter.org/events", "Hostos Center for the Arts & Culture", []),
    mixedCalendar: true,
    venuePage: true,
    venueAddress: "450 Grand Concourse, Bronx, NY 10451",
  },
  {
    ...page("https://www.index-space.org/programming", "Index", []),
    mixedCalendar: true,
  },
  // Squarespace events lists of three Brooklyn venues, checked live on 2026-10-11 (robots.txt
  // allows each; 9, 16 and 38 upcoming items). Whole calendars, so each is screened (D-083).
  {
    ...squarespace("https://www.signalnyc.club/events", "Signal", []),
    mixedCalendar: true,
    venuePage: true,
    venueAddress: "175 Morgan Ave, Brooklyn, NY 11237",
  },
  {
    ...squarespace("https://www.starrbar.com/events", "Starr Bar", []),
    mixedCalendar: true,
    venuePage: true,
    venueAddress: "214 Starr St, Brooklyn, NY 11237",
  },
  // A DJ bar whose events page lists its nights as "FRI_10/16: ..." (the owner, 2026-10-16:
  // "why didn't the app have Dead Letter No. 9"). robots.txt allows it. Its site prints "63 Grand
  // Street Brooklyn, NY 11201"; OpenStreetMap places the bar at 63 Grand St, Williamsburg, 11249.
  {
    ...page("https://www.deadletterno9.com/events", "Dead Letter No. 9", ["dj_night"]),
    mixedCalendar: true,
    venuePage: true,
    onlyHere: true,
    venueAddress: "63 Grand St, Brooklyn, NY 11249",
  },
  // Venue sites found by discovery whose listings named no place (2026-10-15). Addresses as each
  // site prints it; LPR's does not, so its address is the owner's (2026-10-15).
  {
    ...page("https://club51nyc.com/events", "Club 51", []),
    mixedCalendar: true,
    venuePage: true,
    venueAddress: "627 West 51st Street, New York, NY 10019",
    onlyHere: true,
  },
  // Somewhere Nowhere's own club nights name no dance; they are its dance nights (coverage-94, NYC 11-04).
  {
    ...page("https://www.somewherenowherenyc.com/events", "Somewhere Nowhere", []),
    mixedCalendar: true,
    danceNights: ["Suave Saturdays*", "Haus of Joon*", "Loco Carnaval*"],
    venuePage: true,
    venueAddress: "112 W 25th St, New York, NY 10001",
    onlyHere: true,
  },
  {
    ...squarespace("https://www.3dollarbillbk.com/rsvp", "3 Dollar Bill", []),
    mixedCalendar: true,
    venuePage: true,
  },
  // Latin dance directories (owner's answer 2026-10-11: directories are read as listings once their
  // terms are read). GO Latin Dance's New York category as The Events Calendar's iCalendar export
  // (24 nights 10/11 to 10/20).
  {
    ...directory("https://golatindance.com/events/category/new-york-city/", "GO Latin Dance NYC", [
      "salsa",
      "bachata",
    ]),
    kind: "feed_ics",
    feedUrl: "https://golatindance.com/events/category/new-york-city/?ical=1",
  },
  // Salsa Vida's New York guide: schema.org Events on the page (24 on 10/11, a week ahead).
  directory("https://www.salsavida.com/guides/new-york/new-york-city/", "Salsa Vida NYC", [
    "salsa",
    "bachata",
  ]),
  // Clubs. Good Room's https fails its TLS handshake; http answers (6 nights 10/11 to 10/24).
  {
    ...page("http://www.goodroombk.com/", "Good Room", ["house", "techno", "disco"]),
    venuePage: true,
    venueRooms: ["Bad Room"],
    onlyHere: true,
  },
  // Public Records tags each night Club, Live or Etc (about 9 club nights among concerts).
  {
    ...page("https://publicrecords.nyc/", "Public Records", ["house", "techno"]),
    mixedCalendar: true,
    venuePage: true,
  },
  // Roller dancing to a DJ at Central Park's skate circle, weekends until late October.
  page("https://cpdsa.org/events/", "Central Park Dance Skaters", []),
  // Bohemian Hall, Astoria: Wix events, an occasional silent disco among other events.
  {
    ...eventPages("https://www.bohemianhall.com/events", "Bohemian Hall & Beer Garden", [
      "silent_disco",
    ]),
    mixedCalendar: true,
    venuePage: true,
  },
  // Sulekha Events, New York area: the Indian community's ticket site (Garba nights, Bollywood
  // parties) beside concerts, comedy and banquets, hence the screen. Each event is a schema.org
  // Event on the list page itself; robots.txt allows every crawler (owner's request, 2026-10-25).
  {
    ...eventPages("https://events.sulekha.com/new-york-metro-area", "Sulekha Events", []),
    mixedCalendar: true,
  },
  // Tickeri, the Latin community's ticket site for New York, New Jersey and Connecticut: Colombian
  // salsa, reggaeton, Dominican and Peruvian nights that sell only there, beside concerts, comedy and
  // match screenings, hence the screen. Places outside the metro are left out by their point
  // (owner's answer 2026-10-25).
  {
    ...page("https://www.tickeri.com/local/tristate", "Tickeri (Latin nights)", []),
    kind: "jsonld",
    platform: "tickeri",
    mixedCalendar: true,
  },
  // menna, New York's SWANA (Arab, Persian, Turkish, Armenian) events calendar: only the cards it
  // tags Party or Dance are read, so no screen; most of its parties sell on no site we read
  // (owner's ask 2026-10-25).
  {
    ...page("https://itsmenna.com/events", "menna (SWANA events)", []),
    kind: "jsonld",
    platform: "menna",
  },
  // Viewcy, a ticket site for small arts and community events. Its "dance" search page (the first
  // 28 events it lists) carries concerts and classes too, hence the screen; places outside the
  // metro are left out by their point. The Jewish Embodiment Lab's page carries its Sabbath Dance,
  // a Jewish ecstatic dance night at Abhaya Yoga (owner's ask 2026-10-25).
  {
    ...page("https://www.viewcy.com/discover?q=dance", "Viewcy (dance search)", []),
    kind: "jsonld",
    platform: "viewcy",
    mixedCalendar: true,
  },
  {
    ...page(
      "https://www.viewcy.com/jewishembodimentlab",
      "The Jewish Embodiment Lab (Sabbath Dance)",
      ["ecstatic"],
    ),
    kind: "jsonld",
    platform: "viewcy",
  },
  // Seasonal outdoor series (owner's answer 2026-10-11: add them now). Each returns nothing
  // between seasons and fills again in spring with no change here. SummerStage runs May to
  // September; its calendar's iCalendar export also carries volunteer days, hence the screen.
  {
    ...page("https://cityparksfoundation.org/calendar/", "City Parks Foundation (SummerStage)", []),
    kind: "feed_ics",
    feedUrl: "https://cityparksfoundation.org/calendar/?ical=1",
    mixedCalendar: true,
  },
  // DICE's New York browse pages, DJ and Party, and their genre pages (D-139, D-148): the clubs
  // that sell only there.
  ...diceSources(DICE_BROWSE, "New York"),
  // Coverage review of 2026-10-17, part 1: venues and organisers the owner approved, each
  // probed live that day; read without a model.
  // International folk dancing (Balkan, Israeli), Thursdays at Zion German Evangelical Lutheran
  // Church, Brooklyn Heights; some feed weeks give only "NY" as the place (2026-10-22).
  {
    ...page(
      "https://brooklynheightsfolkdancers.org/events/list/",
      "Brooklyn Heights International Folk Dancers",
      ["balkan", "israeli"],
    ),
    kind: "feed_ics",
    feedUrl: "https://brooklynheightsfolkdancers.org/events/?ical=1",
    venueAddress: "125 Henry St, Brooklyn, NY 11201",
    onlyHere: true,
  },
  // Modern western square dancing, an LGBTQ+ club, Thursdays in the West Village.
  {
    ...page("https://timessquares.nyc/events/", "Times Squares (square dance)", ["square_dance"]),
    kind: "feed_ics",
    feedUrl: "https://timessquares.nyc/events/?ical=1",
  },
  // Hart Bar, Bushwick: basement DJ nights mixed with band shows (a Google Calendar).
  {
    ...page("https://www.hartbarnyc.com/shows", "Hart Bar", ["dj_night"]),
    kind: "feed_gcal",
    platform: "feed_gcal",
    mixedCalendar: true,
    venuePage: true,
    venueAddress: "538 Hart Street, Brooklyn, NY 11221",
  },
  // Skinny Dennis, Williamsburg: country bar, two-step Tuesdays with a lesson.
  {
    ...squarespace("https://skinnydennisbrooklyn.com/calendar", "Skinny Dennis", [
      "two_step",
      "honky_tonk",
    ]),
    mixedCalendar: true,
    venuePage: true,
    venueAddress: "152 Metropolitan Ave, Brooklyn, NY 11249",
  },
  // Club Cumming, East Village: queer bar with DJ dance parties.
  {
    ...squarespace("https://clubcummingnyc.com/", "Club Cumming", ["queer_party"]),
    mixedCalendar: true,
    venuePage: true,
    venueAddress: "505 East 6th Street, New York, NY 10009",
  },
  // Cafe Erzulie, Bushwick: hip-hop, dancehall, soca and Afrobeats parties.
  {
    ...squarespace("https://www.cafeerzulie.com/events", "Cafe Erzulie", [
      "afrobeats_club",
      "dancehall",
      "hip_hop_club",
    ]),
    mixedCalendar: true,
    venuePage: true,
    onlyHere: true,
    venueAddress: "894 Broadway, Brooklyn, NY 11206",
  },
  // Metropolitan, Williamsburg: gay bar with a dance floor, DJ nights.
  {
    ...squarespace("https://www.metropolitanbarny.com/events", "Metropolitan", ["queer_party"]),
    mixedCalendar: true,
    venuePage: true,
    onlyHere: true,
    venueAddress: "559 Lorimer Street, Brooklyn, NY 11211",
  },
  // Mood Ring, Bushwick: DJ dance parties Wednesday to Saturday.
  {
    ...squarespace("https://www.moodringnyc.club/events", "Mood Ring", ["dj_night"]),
    mixedCalendar: true,
    venuePage: true,
    venueAddress: "1260 Myrtle Avenue, Brooklyn, NY 11221",
  },
  // Friends and Lovers, Crown Heights: DJ dance parties on Fridays and Saturdays.
  {
    ...squarespace("https://www.fnlbk.com/upcoming", "Friends and Lovers", ["dj_night"]),
    mixedCalendar: true,
    venuePage: true,
    onlyHere: true,
    venueAddress: "641 Classon Avenue, Brooklyn, NY 11238",
  },
  // Damballa, Bushwick: DJ nights Thursday to Saturday (Afro, bashment).
  {
    ...squarespace("https://www.damballa.nyc/events-builder", "Damballa", [
      "afrobeats_club",
      "dancehall",
    ]),
    mixedCalendar: true,
    venuePage: true,
    onlyHere: true,
    venueAddress: "895 Broadway, Brooklyn, NY 11206",
  },
  // Sunset Stoop, Sunset Park: salsa class and social on Tuesdays (schema.org event pages).
  {
    ...eventPages("https://sunsetstoop.com/events", "Sunset Stoop", ["salsa"]),
    mixedCalendar: true,
    venuePage: true,
    venueAddress: "4114 5th Ave, Brooklyn, NY 11232",
  },
  // MTS Productions: the Friday salsa social at La Casita, Bushwick.
  {
    url: "https://www.eventbrite.com/o/11920997917",
    kind: "ticketing_api",
    trustTier: "ticketing",
    platform: "eventbrite",
    styles: ["salsa"],
    label: "MTS Productions (Eventbrite)",
    mixedCalendar: true,
  },
  // 5Rhythms Friday Morning Waves at St. Mark's Church in-the-Bowery.
  {
    url: "https://www.eventbrite.com/o/45575086953",
    kind: "ticketing_api",
    trustTier: "ticketing",
    platform: "eventbrite",
    styles: ["five_rhythms"],
    label: "Morning Waves 5Rhythms (Eventbrite)",
  },
  // Coverage review of 2026-10-17, part 2: pages with no feed, read by the model.
  // Where2Ballroom's New York calendar: ballroom, Latin and hustle socials (Manhattan Ballroom Dance, St. Jean Baptiste).
  directory("https://www.wheretoballroom.com/events/us/ny/new-york", "Where2Ballroom New York", [
    "social_ballroom",
    "hustle",
  ]),
  // Daybreaker: sober morning raves and sauna raves (Othership), all dance parties (owner,
  // 2026-10-23); its list covers other cities too.
  {
    ...page("https://www.daybreaker.com/our-events/", "Daybreaker", ["morning_rave"]),
    kind: "jsonld",
    platform: "daybreaker",
    cityLinkPrefix: "https://www.daybreaker.com/event/new-york-",
  },
  // Ethyl's, Upper East Side: 70s disco dance parties Thursday to Saturday.
  {
    ...page("https://www.ethylsalcohol.com/dance-parties/", "Ethyl's Alcohol & Food", [
      "disco",
      "retro",
    ]),
    venuePage: true,
    venueAddress: "1629 2nd Avenue, New York, NY 10028",
  },
  // The Stonewall Inn, West Village: dance floor, weekly events.
  {
    ...page("https://thestonewallinnnyc.com/", "The Stonewall Inn", ["queer_party"]),
    mixedCalendar: true,
    venuePage: true,
    onlyHere: true,
    venueAddress: "53 Christopher Street, New York, NY 10014",
  },
  // NYCity Waves: 5Rhythms Tuesdays at the Joffrey Ballet School.
  page("https://www.tickettailor.com/events/nycitywaves", "NYCity Waves 5Rhythms", [
    "five_rhythms",
  ]),
  // Space Invader Social: costume balls with all-night DJs at rented venues (owner, 2026-10-17).
  page("https://www.tickettailor.com/events/spaceinvadersocial", "Space Invader Social", [
    "dj_night",
  ]),
  // BODYWERK: 5Rhythms waves, Mondays at the Ukrainian National Home.
  page(
    "https://www.5rhythms.com/classes/BODYWERKARhythmsWavesHappening-288016",
    "BODYWERK 5Rhythms",
    ["five_rhythms"],
  ),
  // Body Waves: 5Rhythms Fridays at the New York Center for Creativity and Dance.
  page("https://5rhythms.ticketspice.com/bodywaves", "Body Waves 5Rhythms", ["five_rhythms"]),
  // Friday salsa at Time Out Market Union Square, free, as Time Out lists it. The page names no
  // address and the listing no venue, so the seed carries the market's (D-163; Time Out, 2026-10-22).
  {
    ...directory(
      "https://www.timeout.com/newyork/things-to-do/friday-night-salsa-at-time-out-market-union-square",
      "Time Out Market Union Square",
      ["salsa"],
    ),
    venueAddress: "124 E 14th St, New York, NY 10003",
  },
  // Friday reggaeton nights at Doha Bar Lounge, Astoria, sold on Fever (schema.org event).
  {
    ...page("https://feverup.com/m/265332", "Friday Nights Reggaeton Astoria (Fever)", [
      "reggaeton",
    ]),
    kind: "jsonld",
  },
  // Coverage review of 2026-10-17, part 3: confirmed by a second pass the same day.
  // AfroSabor: salsa socials about monthly, lately at Imperial Ballroom on Division St.
  page("https://afrosabor.org/events", "AfroSabor", ["salsa"]),
  // MAMBROSO NYC's Speakeasy Salsa: live-band salsa nights in a Flatiron loft (schema.org events on Luma).
  {
    ...page("https://luma.com/mambroso", "Speakeasy Salsa (MAMBROSO NYC)", ["salsa"]),
    kind: "jsonld",
  },
  // Contact Improv NYC: the monthly Gymmy Jam at Metamorphosis Fitness, Bushwick.
  {
    url: "https://www.eventbrite.com/o/86666285873",
    kind: "ticketing_api",
    trustTier: "ticketing",
    platform: "eventbrite",
    styles: ["contact_improv"],
    label: "Contact Improv NYC (Eventbrite)",
  },
  // Nublu, Alphabet City: Latin Wednesdays with a live band and DJs.
  { ...page("https://nublu.net/", "Nublu", ["latin_club"]), mixedCalendar: true, venuePage: true },
  // Animal, Williamsburg: a dated daily DJ schedule, 10pm to 4am.
  {
    ...page("https://animal.nyc/", "Animal", ["dj_night"]),
    venuePage: true,
    venueAddress: "307 Meeker Avenue, Brooklyn, NY 11211",
  },
  // The Monster, West Village: Saturday Spunk dance party and the Sunday tea dance. Its calendar
  // also lists piano bar sets and drag shows ("At the Piano with ...", "Curtains UP!"), so it is
  // a mixed calendar whose own DJ nights are named (D-589, NYC 11-03).
  {
    ...page("https://www.spunknyc.com/monster-reservations", "The Monster (Spunk)", [
      "queer_party",
    ]),
    mixedCalendar: true,
    danceNights: ["SPUNK*", "B2B BASSMENT*", "Bitches Love the 90s*"],
    venuePage: true,
    onlyHere: true,
    venueAddress: "80 Grove Street, New York, NY 10014",
  },
  // VERS, Hell's Kitchen: DJ dance nights Fridays and Saturdays.
  {
    ...page("https://www.versnyc.com/events-vers-gay-bar-nyc", "VERS", ["queer_party"]),
    mixedCalendar: true,
    venuePage: true,
    venueAddress: "714 9th Avenue, New York, NY 10019",
  },
  // Bryant Park's calendar: summer dance series, K-pop classes in the autumn.
  { ...page("https://bryantpark.org/calendar", "Bryant Park", []), mixedCalendar: true },
  // Matinee Social Club: early weekend dance parties (Saturdays at Joyface), dated on Eventbrite.
  {
    url: "https://www.eventbrite.com/o/71776965133",
    kind: "ticketing_api",
    trustTier: "ticketing",
    platform: "eventbrite",
    styles: ["disco", "retro"],
    label: "Matinee Social Club (Eventbrite)",
  },
  // Let's Zydeco: dated zydeco dances with a live band at Connolly's, about monthly.
  {
    url: "https://www.eventbrite.com/o/77134879823",
    kind: "ticketing_api",
    trustTier: "ticketing",
    platform: "eventbrite",
    styles: ["zydeco"],
    label: "Let's Zydeco (Eventbrite)",
  },
  // Party promoters (owner, 2026-10-17): parties at rented venues, dated on Eventbrite.
  // GBH: themed tribute dance parties; also runs NJ, Austin and London dates (screened by metro).
  {
    url: "https://www.eventbrite.com/o/2045320721",
    kind: "ticketing_api",
    trustTier: "ticketing",
    platform: "eventbrite",
    styles: ["dj_night", "disco"],
    label: "GBH (Eventbrite)",
  },
  // Monstera Nightlife: reggaeton and costume parties.
  {
    url: "https://www.eventbrite.com/o/49781638123",
    kind: "ticketing_api",
    trustTier: "ticketing",
    platform: "eventbrite",
    styles: ["reggaeton", "latin_club"],
    label: "Monstera Nightlife (Eventbrite)",
  },
  // reggaetonLABS: perreo and techno nights in Brooklyn.
  {
    url: "https://www.eventbrite.com/o/50573986003",
    kind: "ticketing_api",
    trustTier: "ticketing",
    platform: "eventbrite",
    styles: ["reggaeton", "techno"],
    label: "reggaetonLABS (Eventbrite)",
  },
  // Late Nite RnB: R&B parties and day parties.
  {
    url: "https://www.eventbrite.com/o/17084686475",
    kind: "ticketing_api",
    trustTier: "ticketing",
    platform: "eventbrite",
    styles: ["hip_hop_club", "dj_night"],
    label: "Late Nite RnB (Eventbrite)",
  },
  // Caribbean City (Capital Events): Afro-Caribbean and R&B parties.
  {
    url: "https://www.eventbrite.com/o/9769672320",
    kind: "ticketing_api",
    trustTier: "ticketing",
    platform: "eventbrite",
    styles: ["afrobeats_club", "dancehall"],
    label: "Caribbean City (Eventbrite)",
  },
  // ALIZE: gallery raves, techno and hyperpop.
  {
    url: "https://www.eventbrite.com/o/95632110373",
    kind: "ticketing_api",
    trustTier: "ticketing",
    platform: "eventbrite",
    styles: ["techno", "electronic"],
    label: "ALIZE (Eventbrite)",
  },
  // Trance, Bro!: trance parties.
  {
    url: "https://www.eventbrite.com/o/52316065793",
    kind: "ticketing_api",
    trustTier: "ticketing",
    platform: "eventbrite",
    styles: ["electronic"],
    label: "Trance, Bro! (Eventbrite)",
  },
  // Latin Parties of New York: reggaeton rooftop parties.
  {
    url: "https://www.eventbrite.com/o/29807702493",
    kind: "ticketing_api",
    trustTier: "ticketing",
    platform: "eventbrite",
    styles: ["reggaeton", "latin_club"],
    label: "Latin Parties of New York (Eventbrite)",
  },
  // Refuge.NYC: house and techno with touring DJs.
  {
    url: "https://www.eventbrite.com/o/109511595401",
    kind: "ticketing_api",
    trustTier: "ticketing",
    platform: "eventbrite",
    styles: ["house", "techno"],
    label: "Refuge.NYC (Eventbrite)",
  },
  // JiggyTime Ent: Caribbean bar parties.
  {
    url: "https://www.eventbrite.com/o/5494940201",
    kind: "ticketing_api",
    trustTier: "ticketing",
    platform: "eventbrite",
    styles: ["dancehall", "afrobeats_club"],
    label: "JiggyTime (Eventbrite)",
  },
  // Monstruo: costume dance parties.
  {
    url: "https://www.eventbrite.com/o/121868699843",
    kind: "ticketing_api",
    trustTier: "ticketing",
    platform: "eventbrite",
    styles: ["latin_club", "dj_night"],
    label: "Monstruo (Eventbrite)",
  },
  // INTO THE NIGHT: reggaeton boat and rooftop parties.
  {
    url: "https://www.eventbrite.com/o/10657483800",
    kind: "ticketing_api",
    trustTier: "ticketing",
    platform: "eventbrite",
    styles: ["reggaeton", "latin_club"],
    label: "INTO THE NIGHT (Eventbrite)",
  },
  // Off The Record: DJ nights at the PUBLIC Hotel.
  {
    url: "https://www.eventbrite.com/o/86554035583",
    kind: "ticketing_api",
    trustTier: "ticketing",
    platform: "eventbrite",
    styles: ["dj_night"],
    label: "Off The Record (Eventbrite)",
  },
  // SILO Brooklyn, Bushwick: DJ and open-decks nights (address from silobrooklyn.com, 2026-10-17).
  {
    ...page("https://www.silobrooklyn.com/events", "SILO Brooklyn", ["dj_night"]),
    mixedCalendar: true,
    venuePage: true,
    onlyHere: true,
    venueAddress: "90 Scott Avenue, Brooklyn, NY 11237",
  },
  // Shrine, Harlem: world-music bar with live bands most nights and late DJ dance parties (Afro fusion, etc.).
  // Its own calendar is plain HTML (calendar.php). Found by the blocked-platform audit (DoNYC, D-758, 2026-11-06).
  {
    ...page("https://www.shrinenyc.com/calendar.php", "Shrine", ["dj_night"]),
    mixedCalendar: true,
    venuePage: true,
    onlyHere: true,
    venueAddress: "2271 Adam Clayton Powell Jr. Blvd, New York, NY 10030",
  },
  // Found by discovery, seeded 2026-11-12 to name non-dance rows (coverage-148): Drom, a music venue whose events
  // page mixes dance parties with seated concerts; the Julia de Burgos Latino Cultural Center, whose calendar mixes
  // dance classes with talks and leadership programmes.
  {
    ...page("https://dromnyc.com/events/", "Drom", ["dj_night"]),
    mixedCalendar: true,
    venuePage: true,
    venueAddress: "85 Avenue A, New York, NY 10009",
    notDanceNights: ["Tracy Bonham *"],
  },
  {
    ...page("https://juliadeburgos.org/calendar", "Julia de Burgos Latino Cultural Center", []),
    mixedCalendar: true,
    venuePage: true,
    venueAddress: "1680 Lexington Ave, New York, NY 10029",
    notDanceNights: ["Latina Image Leadership Program"],
  },
];

/**
 * Starting addresses taken off the list, with the reason each was dropped. The ingest switches
 * their rows off and names them in its report rather than letting them vanish (D-047). Phase 3's
 * discovery looks for their current addresses.
 */
export const NYC_RETIRED: readonly RetiredSource[] = [
  {
    url: "https://bluesdancenewyork.com/",
    // The apex's certificate does not name it (runs 9 and 10); the www host works (D-110).
    reason: "replaced by https://www.bluesdancenewyork.com/events",
  },
  { url: "https://dancemanhattan.com/calendar", reason: "certificate expired (runs 9 and 10)" },
  { url: "https://newyorktango.org/", reason: "no answer within 10 s (runs 9 and 10)" },
  {
    url: "https://dancesport.com/",
    reason:
      "its events page lists competitions in Florida, Georgia and California only, and their weekdays fit 2023 (run 33); the LA Hustle Congress was listed in New York",
  },
  // D-110: re-pointed starting addresses, replaced by the page that lists the nights.
  { url: "https://frimframjam.com/", reason: "replaced by https://frimframjam.com/calendar" },
  { url: "https://nylindy.com/", reason: "replaced by https://www.nylindy.com/dances-2026" },
  { url: "https://cdny.org/", reason: "replaced by https://cdny.org/calendar-events" },
  {
    url: "https://nuevotangoarts.org/",
    reason: "replaced by https://nuevotangoarts.org/2026-calendar",
  },
  {
    url: "https://www.lincolncenter.org/series/summer-for-the-city",
    // Out of season the page dates nothing; the model read the month grid as nights (2026-10-11).
    reason: "no dated events on the page; its calendar is drawn by script",
  },
  {
    url: "https://basementny.net/",
    // A React app with no text in its HTML; its events come from a private ticketing API (2026-10-20).
    reason: "its events are drawn by script from a private API; the page has no text to read",
  },
  // D-110: not New York sources.
  {
    url: "https://salsanewyork.com/",
    reason: "its calendar is frozen at June 2021 (checked 2026-10-04)",
  },
  {
    url: "https://zoukology.com/",
    reason:
      "a worldwide festival directory; it put the Warsaw Brasil Festival in New York (run 34)",
  },
  {
    url: "https://kizombaembassy.com/",
    reason: "a worldwide festival directory with no New York events (checked 2026-10-04)",
  },
  {
    url: "https://clubundergroundla.com/",
    reason: "Club Underground is in Los Angeles; its nights were listed in New York (2026-10-15)",
  },
  {
    url: "https://clubundergroundla.com/rsvp/",
    reason: "Club Underground is in Los Angeles; its nights were listed in New York (2026-10-15)",
  },
  // Lane 5 (D-131).
  {
    url: "https://www.eventbrite.com/o/33937979455",
    reason:
      "Ecstatic Dance NYC's Eventbrite organizer: no event in six runs (to run 34), and ecstaticdance.nyc answers 404",
  },
  {
    url: "https://www.eventbrite.com/o/20030892557",
    reason: "boat parties: the owner lists no boat parties or cruises (2026-10-18)",
  },
  {
    url: "https://www.eventbrite.com/o/12316350145",
    reason: "boat parties: the owner lists no boat parties or cruises (2026-10-18)",
  },
  {
    url: "https://www.eventbrite.com/o/71593368893",
    reason: "its feed lists every party on every day, 5pm-4am (owner, 2026-10-18)",
  },
  {
    url: "https://www.eventbrite.com/o/60462031173",
    reason: "mostly promotion: club crawls, a party bus, boat rentals (owner, 2026-10-18)",
  },
  // Weekly bars removed 2026-10-17 for lack of dated evidence.
  {
    url: "https://matinee.club/events",
    reason:
      "its own page says only 'every weekend'; its dated nights are read from its Eventbrite organiser (2026-10-17)",
  },
  {
    url: "https://www.letszydeco.com/",
    reason:
      "dated shows about monthly, read from its Eventbrite organiser; the page's titles did not match the model's (2026-10-17)",
  },
  {
    url: "https://www.industry-bar.com/",
    reason: "a weekly schedule with no dates and no dated evidence it runs (check of 2026-10-17)",
  },
  {
    url: "https://www.risebarnyc.com/",
    reason: "a weekly schedule with no dates and no dated evidence it runs (check of 2026-10-17)",
  },
  {
    url: "https://berlin.nyc/dance-party/",
    reason: "a weekly schedule with no dates and no dated evidence it runs (check of 2026-10-17)",
  },
  {
    url: "https://www.11howard.com/the-blond",
    reason: "a weekly schedule with no dates and no dated evidence it runs (check of 2026-10-17)",
  },
  {
    url: "https://heavencanwaitnyc.com/house-music-dance-party/",
    reason:
      "a weekly schedule with no dates; nothing dated since 2025 or the venue changed (check of 2026-10-17)",
  },
  {
    url: "https://www.bowerypalace.com/dance-party/",
    reason:
      "a weekly schedule with no dates; nothing dated since 2025 or the venue changed (check of 2026-10-17)",
  },
  {
    url: "https://www.katralounge.com/",
    reason:
      "a weekly schedule with no dates; nothing dated since 2025 or the venue changed (check of 2026-10-17)",
  },
  {
    url: "https://hombreslounge.com/",
    reason:
      "a weekly schedule with no dates; nothing dated since 2025 or the venue changed (check of 2026-10-17)",
  },
  {
    url: "https://www.gospelnyc.com/home",
    reason: "opening hours only, no named dance night (check of 2026-10-17)",
  },
  {
    url: "https://taogroup.com/venues/tao-downtown-nightclub-new-york/events/",
    reason:
      "the page lists no nights; its dated nights appear only on Discotech, which we do not read (2026-10-17)",
  },
  // Eight addresses discovery added that have never had a good read (11-09 run 42634949829, "last good run never"):
  // seven answer 404 on every run since they were added, and one is not an iCalendar feed. Each read only cost
  // fetches and a failing-sources line.
  {
    url: "https://mercuryeastpresents.com/",
    reason: "answers 404 on 17 runs since 11-01; never read",
  },
  { url: "https://setloungeny.com/", reason: "answers 404 on 17 runs since 11-01; never read" },
  {
    url: "https://www.downtimebarnyc.com/",
    reason: "answers 404 on 17 runs since 11-01; never read",
  },
  { url: "https://www.kingsbayy.org/", reason: "answers 404 on 17 runs since 11-01; never read" },
  { url: "https://katrafilmseries.com/", reason: "answers 404 on 11 runs since 11-04; never read" },
  { url: "https://nyceventsguide.com/", reason: "answers 404 on 9 runs since 11-05; never read" },
  { url: "https://syndicatedbk.com/", reason: "answers 404 on 5 runs since 11-07; never read" },
  {
    url: "https://newyorkmetropolitanarea.impacthub.net/",
    reason: "its feed is not an iCalendar file; not a dance source",
  },
  // Found by discovery as a community venue (2026-11-10): a documentary film and arts center.
  {
    url: "https://uniondocs.org/",
    reason:
      'UnionDocs, a documentary film and arts center: screenings and talks, no dance nights ("Camera Ministry: Lens-based Encounters" 11-13; new-sources check 2026-11-10)',
  },
  // A hotel group's site: robots.txt disallows its events data view (8 reads in a row since 2026-11-07).
  {
    url: "https://acehotel.com/",
    reason:
      "robots.txt allows the page but not the wp_tribe events data view (failed 8 reads in a row since 2026-11-07, run 43038723823); no workaround",
  },
  // Found by discovery as a dance studio (2026-11-11): its events page lists seated performances, not dance nights.
  // The seeded movementresearch.org source (Sunday contact improvisation jam) stays.
  {
    url: "https://movementresearch.org/classes-and-events/events/",
    reason:
      'Movement Research\'s events page: seated performances ("Movement Research at the Judson Church" 11-16), not dance nights; coverage verdict 2026-11-11',
  },
  // Found by discovery (2026-11-11): an orchestra's concert feed, an improv theater and a Boston theater listing.
  {
    url: "https://oslmusic.org",
    reason:
      "Orchestra of St. Luke's concert feed: seated concerts and NYC Ballet repertoire at the Koch Theater, no dance nights (coverage 2026-11-11)",
  },
  {
    url: "https://newyorkimprovtheater.com/",
    reason: 'an improv comedy theater ("EIGHT IMPROV"), no dance nights (coverage 2026-11-11)',
  },
  {
    url: "https://us.atgtickets.com/whats-on/boston/",
    reason:
      'a ticket seller\'s Boston theater listing ("A Drag Queen Christmas"): outside the metro and seated shows (coverage 2026-11-11)',
  },
  // Found by discovery (2026-11-12): a union's retiree fitness page.
  {
    url: "https://www.cwa1180.org/retiree/events",
    reason:
      'CWA Local 1180\'s retiree events page: online fitness and yoga classes ("Online Fitness: Dance @ 1 p.m.", "Yoga & Dance Live"), not dance nights (cities sweep 2026-11-13)',
  },
  // Found by discovery (2026-11-12): concert venues, a burlesque bar and a community drive (coverage daily check 2026-11-13).
  {
    url: "https://www.terrablues.com/",
    reason:
      'Terra Blues: a blues bar\'s concert calendar ("Michael Powers", "Jr Mack Band"), not dance nights (coverage daily check 2026-11-13)',
  },
  {
    url: "https://www.soupandsound.org/",
    reason:
      'Soup & Sound: a concert series ("IN MOTION: DANCE CLARINETS", "TRIO NU"), not dance nights (coverage daily check 2026-11-13)',
  },
  {
    url: "https://www.nursebettie.com/entertainment/",
    reason:
      'Nurse Bettie: burlesque shows ("Burlesque Show November 19th!"), not dance nights (coverage daily check 2026-11-13)',
  },
  {
    url: "https://balticstreet.org/",
    reason:
      'balticstreet.org\'s calendar feed: a "Turkey Drive" donation drive, not dance nights (coverage daily check 2026-11-13)',
  },
];
