// London's starting sources (D-201). UK rule D-034: official or public pages only; an unofficial
// endpoint needs the operator's written consent. Resident Advisor stays out (the owner's choice).
// Sources are added as they are checked (first batch 2026-10-27); the daily run also seeds venues
// and discovers their websites (D-120).

import type { RetiredSource, SeedSource } from "@/config/sources/nyc";
import type { StyleKey } from "@/config/styles";
import { diceSources } from "@/config/sources/dice";

/** DICE's London browse pages (D-197). */
const DICE_BROWSE = "https://dice.fm/browse/london-54d8a23438fe5d27d500001c/music";

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

/** A page naming its events' own pages (a JSON-LD ItemList, Wix event links), followed (D-111). */
const eventPages = (url: string, label: string, styles: StyleKey[]): SeedSource => ({
  ...page(url, label, styles),
  kind: "jsonld",
  platform: "jsonld_items",
});

/** A Ceroc venue's own page: one weekly night at one hall (D-482). */
const ceroc = (url: string, venueAddress: string): SeedSource => ({
  ...page(url, "Ceroc", ["ceroc"]),
  venueAddress,
  onlyHere: true,
  weeklyGrid: true,
});

/**
 * One of Salsateca's weekly-night pages on salsateca.co.uk (D-482). Pinned to plain HTML (D-484):
 * each page links one event page (a New Year's Eve party), so the probe read only that link.
 */
const salsateca = (path: string, venueAddress: string): SeedSource => ({
  ...page(`https://www.salsateca.co.uk/${path}`, "Salsateca", ["salsa", "bachata"]),
  venueAddress,
  onlyHere: true,
  weeklyGrid: true,
  platform: "probed",
});

export const LONDON_SOURCES: readonly SeedSource[] = [
  // Salsa Vida's Greater London guide: schema.org Events on the page (24 on 10/27, about a week
  // ahead).
  directory(
    "https://www.salsavida.com/guides/united-kingdom/england/greater-london/",
    "Salsa Vida London",
    ["salsa", "bachata"],
  ),
  // Dalston Superstore, Hackney: The Events Calendar's iCalendar export (30 events 10/27), queer
  // club nights among karaoke, film and craft evenings, hence the screen.
  {
    ...page("https://dalstonsuperstore.com/events/", "Dalston Superstore", ["queer_party"]),
    venueAddress: "117 Kingsland High St, London E8 2PB",
    kind: "feed_ics",
    feedUrl: "https://dalstonsuperstore.com/events/list/?ical=1",
    venuePage: true,
    onlyHere: true,
    mixedCalendar: true,
  },
  // Ecstatic Dance London: its iCalendar export (30 events 10/27), dances beside sound baths and
  // retreats, hence the screen; places outside London are left out by their point.
  {
    ...page("https://ecstaticdancelondon.com/events/", "Ecstatic Dance London", ["ecstatic_dance"]),
    kind: "feed_ics",
    feedUrl: "https://ecstaticdancelondon.com/events/?ical=1",
    mixedCalendar: true,
  },
  // Skating Haven's roller discos at Newham Leisure Centre: its iCalendar export (10 events 10/27).
  {
    ...page("https://skatinghaven.com/", "Skating Haven", []),
    kind: "feed_ics",
    feedUrl: "https://skatinghaven.com/events/?ical=1",
  },
  // Chats Palace, Homerton: arts centre; its workshops are not dance nights.
  // Found by discovery; seeded 2026-11-01 so its non-dance rows can be named (D-519 E1).
  {
    ...page("https://chatspalace.com/", "Chats Palace", []),
    kind: "feed_ics",
    feedUrl: "https://chatspalace.com/events/?ical=1",
    mixedCalendar: true,
    notDanceNights: ["Queer Recipes Archive (Community Workshop)"],
  },
  // Colour Factory, Hackney Wick: a Squarespace events list (12 upcoming 10/27).
  {
    ...squarespace("https://www.colourfactory.com/whatson", "Colour Factory", []),
    venuePage: true,
    mixedCalendar: true,
  },
  // FOLD, Canning Town: its tickets page (a Squarespace blog, not an events list), read by the
  // extractor.
  {
    ...page("https://www.fold.london/tickets", "FOLD", ["techno", "house"]),
    venuePage: true,
    onlyHere: true,
  },
  // Brixton Jamm: its all-events page (amapiano, reggae Sundays and gigs), read by the extractor.
  {
    ...page("https://www.brixtonjamm.org/allevents", "Brixton Jamm", []),
    venuePage: true,
    mixedCalendar: true,
  },
  // Electrowerkz, Angel: its what's-on page, club nights among gigs. Its Resident Advisor links are
  // never followed (D-034).
  {
    ...page("https://www.electrowerkz.co.uk/whatson", "Electrowerkz", []),
    venueAddress: "7 Torrens Street, London EC1V 1NQ",
    venuePage: true,
    mixedCalendar: true,
  },
  // Night Tales, Hackney: its what's-on page.
  {
    ...page("https://www.nighttales.co.uk/whats-on", "Night Tales", ["house"]),
    venuePage: true,
    onlyHere: true,
  },
  // Bars with DJ nights and dancing (the owner's ask, 2026-10-27): each bar's own calendar.
  // Ridley Road Market Bar, Dalston: Wix event pages (18 on 10/27), DJ nights Tuesday to
  // Saturday.
  {
    ...eventPages("https://www.ridleyroadmarketbar.com/whats-on", "Ridley Road Market Bar", [
      "dj_night",
    ]),
    venuePage: true,
    onlyHere: true,
  },
  // Home Deptford, a bar and record shop: Wix event pages (20 on 10/27), DJ sessions among craft
  // and social evenings, hence the screen.
  {
    ...eventPages("https://www.homedeptford.com/events", "Home Deptford", ["dj_night"]),
    venuePage: true,
    onlyHere: true,
    mixedCalendar: true,
  },
  // Grow Hackney, Hackney Wick: a Squarespace events list (26 upcoming 10/27).
  {
    ...squarespace("https://www.growhackney.co.uk/events-calendar", "Grow Hackney", ["dj_night"]),
    venuePage: true,
    mixedCalendar: true,
  },
  // Freedom Bar, Soho: schema.org Events on its what's-on page (5 on 10/27), disco and cabaret
  // nights.
  {
    ...page("https://freedombarsoho.com/whats-on/", "Freedom Bar", ["dj_night"]),
    kind: "jsonld",
    venuePage: true,
    onlyHere: true,
    mixedCalendar: true,
  },
  // The Greyhound, Peckham: dated basement DJ nights, read by the extractor.
  {
    ...page("https://www.thegreyhound.uk/whats-on", "The Greyhound (Peckham)", ["dj_night"]),
    venueAddress: "109 Peckham High Street, London SE15 5SE",
    venuePage: true,
    mixedCalendar: true,
  },
  // Prince of Peckham: dated DJ nights (MIXTAPE), read by the extractor.
  {
    ...page("https://princeofpeckham.co.uk/whats-on/", "Prince of Peckham", ["dj_night"]),
    venueAddress: "1 Clayton Road, London SE15 5JA",
    venuePage: true,
    mixedCalendar: true,
  },
  // Kave, Fitzrovia: a DJ named for each Friday and Saturday, read by the extractor.
  {
    ...page("https://www.kavelondon.com/whats-on", "Kave", ["dj_night"]),
    venuePage: true,
    onlyHere: true,
  },
  // Queen of Hoxton, Shoreditch: Friday and Saturday DJ nights among other events, read by the
  // extractor.
  {
    ...page("https://queenofhoxton.com/whats-on/", "Queen of Hoxton", ["dj_night"]),
    venueAddress: "1 Curtain Road, London EC2A 3JX",
    venuePage: true,
    mixedCalendar: true,
  },
  // The Old Queen's Head, Islington: weekend DJ nights among gigs, read by the extractor.
  {
    ...page("https://theoldqueenshead.com/whats-on/", "The Old Queen's Head", ["dj_night"]),
    venuePage: true,
    mixedCalendar: true,
  },
  // Social-dance organisers that sell their London nights on Eventbrite (D-205), read through the
  // official API by organiser ID, like NYC's (D-131). Found 2026-10-27 from Eventbrite's public
  // London search pages; each had live London socials that day.
  {
    url: "https://www.eventbrite.co.uk/o/mambocity-3023432912",
    kind: "ticketing_api",
    trustTier: "ticketing",
    platform: "eventbrite",
    styles: ["salsa"],
    label: "Mambo City (Eventbrite)",
    mixedCalendar: true,
  },
  {
    url: "https://www.eventbrite.co.uk/o/tea-time-dance-121234842686",
    kind: "ticketing_api",
    trustTier: "ticketing",
    platform: "eventbrite",
    styles: ["social_ballroom"],
    label: "Tea Time Dance (Eventbrite)",
    mixedCalendar: true,
  },
  {
    url: "https://www.eventbrite.co.uk/o/colindale-salsa-bachata-fitness-nw-london-108669592351",
    kind: "ticketing_api",
    trustTier: "ticketing",
    platform: "eventbrite",
    styles: ["salsa", "bachata"],
    label: "Colindale Salsa & Bachata (Eventbrite)",
    mixedCalendar: true,
    // A fitness class, not a social dance (live check 2026-11-01, D-519 E1).
    notDanceNights: ["Dance Fitness Party Tuesdays in Colindale, NW London / Barnet"],
  },
  {
    url: "https://www.eventbrite.co.uk/o/swingdanceuk-3199827088",
    kind: "ticketing_api",
    trustTier: "ticketing",
    platform: "eventbrite",
    styles: ["lindy_hop", "charleston"],
    label: "SwingDanceUK (Eventbrite)",
    mixedCalendar: true,
  },
  {
    url: "https://www.eventbrite.co.uk/o/incognito-dance-official-6826407685",
    kind: "ticketing_api",
    trustTier: "ticketing",
    platform: "eventbrite",
    styles: ["salsa", "bachata"],
    label: "Incognito Dance (Eventbrite)",
    mixedCalendar: true,
  },
  {
    url: "https://www.eventbrite.co.uk/o/kizomba-addiction-10603023226",
    kind: "ticketing_api",
    trustTier: "ticketing",
    platform: "eventbrite",
    styles: ["kizomba"],
    label: "Kizomba Addiction (Eventbrite)",
    mixedCalendar: true,
  },
  {
    url: "https://www.eventbrite.co.uk/o/the-nest-collective-8949492974",
    kind: "ticketing_api",
    trustTier: "ticketing",
    platform: "eventbrite",
    styles: ["ceilidh"],
    label: "The Nest Collective (Eventbrite)",
    mixedCalendar: true,
  },
  {
    url: "https://www.eventbrite.co.uk/o/julian-mr-m-106149655411",
    kind: "ticketing_api",
    trustTier: "ticketing",
    platform: "eventbrite",
    styles: ["bachata"],
    label: "Ritmo Latino bachata nights (Eventbrite)",
    mixedCalendar: true,
  },
  {
    url: "https://www.eventbrite.co.uk/o/jazzbourne-40064188823",
    kind: "ticketing_api",
    trustTier: "ticketing",
    platform: "eventbrite",
    styles: ["lindy_hop"],
    label: "Jazzbourne (Eventbrite)",
    mixedCalendar: true,
  },
  {
    url: "https://www.eventbrite.co.uk/o/ecstatic-dance-uk-17916431216",
    kind: "ticketing_api",
    trustTier: "ticketing",
    platform: "eventbrite",
    styles: ["ecstatic_dance"],
    label: "Ecstatic Dance UK (Eventbrite)",
    mixedCalendar: true,
  },
  {
    url: "https://www.eventbrite.co.uk/o/cali-beat-dance-64497140593",
    kind: "ticketing_api",
    trustTier: "ticketing",
    platform: "eventbrite",
    styles: ["salsa"],
    label: "Changó Salsa (Eventbrite)",
    mixedCalendar: true,
  },
  {
    url: "https://www.eventbrite.co.uk/o/tribalheart-ecstatic-dance-london-18505959226",
    kind: "ticketing_api",
    trustTier: "ticketing",
    platform: "eventbrite",
    styles: ["ecstatic_dance"],
    label: "Tribalheart Ecstatic Dance (Eventbrite)",
    mixedCalendar: true,
  },
  // Cacao Dance Tribe and Ecstatic Rave (Urubu Wellbeing): 12 ecstatic dances listed (research sweep,
  // D-214, 2026-10-29).
  {
    url: "https://www.eventbrite.co.uk/o/ecstatic-dance-london-urubu-wellbeing-events-8588572090",
    kind: "ticketing_api",
    trustTier: "ticketing",
    platform: "eventbrite",
    styles: ["ecstatic_dance"],
    label: "Cacao Dance Tribe (Eventbrite)",
    mixedCalendar: true,
  },
  // From the ecstaticdance.org directory (D-573, checked 2026-11-02): Ecstatic Dance Culture's women's dances at
  // Sanctuary & Soul, Shoreditch (2026-11-10 and 11-24 on its organiser page).
  {
    url: "https://www.eventbrite.co.uk/o/ecstatic-dance-culture-96657538473",
    kind: "ticketing_api",
    trustTier: "ticketing",
    platform: "eventbrite",
    styles: ["ecstatic_dance"],
    label: "Ecstatic Dance Culture (Eventbrite)",
    mixedCalendar: true,
  },
  // Luminous conscious dance (D-573): its Dandelion organiser page loads events by script; its iCalendar export
  // gives each night with its place (14 Nov Cheshire Street E2, 5 Dec St Mary's Hornsey Rise N19). Read without a model.
  {
    ...directory("https://dandelion.events/o/luminous/events", "Luminous", ["ecstatic_dance"]),
    kind: "feed_ics",
    feedUrl: "https://dandelion.events/o/luminous/events.ics?slug=luminous",
  },
  // Pleasure Medicine (D-573): sober daytime disco and conscious dance for GBTQ+ men, alternate Saturdays at
  // Waking Dreams. Its own site gives no dates; its OutSavvy event page has JSON-LD for every date (the owner approved
  // reading OutSavvy's public pages, 2026-11-02). The page's URL names the year: check it in January.
  {
    ...page("https://www.outsavvy.com/event/32514/pleasure-medicine-2026", "Pleasure Medicine", [
      "queer_party",
      "ecstatic_dance",
    ]),
    venueAddress: "Waking Dreams, 6b Ada Street, London E8 4QU",
    venuePage: true,
    onlyHere: true,
  },
  {
    url: "https://www.eventbrite.co.uk/o/funky-mambo-38144121783",
    kind: "ticketing_api",
    trustTier: "ticketing",
    platform: "eventbrite",
    styles: ["salsa"],
    label: "Funky Mambo (Eventbrite)",
    mixedCalendar: true,
  },
  {
    url: "https://www.eventbrite.co.uk/o/mundo-latino-uk-salsa-bachata-dance-school-74791449843",
    kind: "ticketing_api",
    trustTier: "ticketing",
    platform: "eventbrite",
    styles: ["salsa", "bachata"],
    label: "Mundo Latino (Eventbrite)",
    mixedCalendar: true,
  },
  {
    url: "https://www.eventbrite.co.uk/o/ecstatica-107139959351",
    kind: "ticketing_api",
    trustTier: "ticketing",
    platform: "eventbrite",
    styles: ["ecstatic_dance"],
    label: "Ecstatica (Eventbrite)",
    mixedCalendar: true,
  },
  {
    url: "https://www.eventbrite.co.uk/o/cali-rhythm-by-sami-rodriguez-102678143751",
    kind: "ticketing_api",
    trustTier: "ticketing",
    platform: "eventbrite",
    styles: ["salsa"],
    label: "Cali Rhythm (Eventbrite)",
    mixedCalendar: true,
  },
  // A second batch from the same public London search pages (2026-10-27 list), each with a London
  // social, class-and-social or party that week; one-off parties and non-dance socials left out.
  {
    url: "https://www.eventbrite.co.uk/o/international-west-coast-swing-instructor-coleen-man-26872148457",
    kind: "ticketing_api",
    trustTier: "ticketing",
    platform: "eventbrite",
    styles: ["west_coast_swing"],
    label: "West Coast Swing with Coleen Man, Holborn (Eventbrite)",
    mixedCalendar: true,
  },
  {
    url: "https://www.eventbrite.co.uk/o/morley-college-london-7905914706",
    kind: "ticketing_api",
    trustTier: "ticketing",
    platform: "eventbrite",
    styles: ["social_ballroom"],
    label: "Morley College ballroom and Latin socials (Eventbrite)",
    mixedCalendar: true,
  },
  {
    url: "https://www.eventbrite.co.uk/o/la-terraza-tapas-bar-restaurant-111939079671",
    kind: "ticketing_api",
    trustTier: "ticketing",
    platform: "eventbrite",
    styles: ["salsa", "bachata"],
    label: "La Terraza Latino nights (Eventbrite)",
    mixedCalendar: true,
  },
  {
    url: "https://www.eventbrite.co.uk/o/jamon-jamon-restaurants-120476516301",
    kind: "ticketing_api",
    trustTier: "ticketing",
    platform: "eventbrite",
    styles: ["salsa"],
    label: "Jamon Jamon salsa, Soho (Eventbrite)",
    mixedCalendar: true,
  },
  {
    url: "https://www.eventbrite.co.uk/o/boxpark-wembley-18092373249",
    kind: "ticketing_api",
    trustTier: "ticketing",
    platform: "eventbrite",
    styles: ["salsa"],
    label: "Rumba Latina at Boxpark Wembley (Eventbrite)",
    mixedCalendar: true,
  },
  {
    url: "https://www.eventbrite.co.uk/o/bomgo-cic-121634175585",
    kind: "ticketing_api",
    trustTier: "ticketing",
    platform: "eventbrite",
    styles: ["salsa"],
    label: "Salsa Bridges (Bomgo CIC) (Eventbrite)",
    mixedCalendar: true,
  },
  {
    url: "https://www.eventbrite.co.uk/o/citysalsa-dance-school-121429157434",
    kind: "ticketing_api",
    trustTier: "ticketing",
    platform: "eventbrite",
    styles: ["salsa"],
    label: "CitySalsa at Club Azteca (Eventbrite)",
    mixedCalendar: true,
  },
  {
    url: "https://www.eventbrite.co.uk/o/jalisco-kitchen-bar-102062181991",
    kind: "ticketing_api",
    trustTier: "ticketing",
    platform: "eventbrite",
    styles: ["salsa"],
    label: "Jalisco Latin party (Eventbrite)",
    mixedCalendar: true,
  },
  {
    url: "https://www.eventbrite.co.uk/o/rincon-latino-120992218120",
    kind: "ticketing_api",
    trustTier: "ticketing",
    platform: "eventbrite",
    styles: ["salsa"],
    label: "Rincon Latino (Eventbrite)",
    mixedCalendar: true,
  },
  {
    url: "https://www.eventbrite.co.uk/o/dharmesh-66923930033",
    kind: "ticketing_api",
    trustTier: "ticketing",
    platform: "eventbrite",
    styles: ["salsa", "bachata"],
    label: "Salsa & Bachata Wednesdays, Brixton (Eventbrite)",
    mixedCalendar: true,
  },
  {
    url: "https://www.eventbrite.co.uk/o/dancesimple-121884511757",
    kind: "ticketing_api",
    trustTier: "ticketing",
    platform: "eventbrite",
    styles: ["brazilian_zouk"],
    label: "DanceSimple zouk (Eventbrite)",
    mixedCalendar: true,
  },
  {
    url: "https://www.eventbrite.co.uk/o/the-line-dance-party-uk-111038731041",
    kind: "ticketing_api",
    trustTier: "ticketing",
    platform: "eventbrite",
    styles: ["line_dance"],
    label: "The Line Dance Party UK (Eventbrite)",
    mixedCalendar: true,
  },
  {
    url: "https://www.eventbrite.co.uk/o/latin-soul-110704537951",
    kind: "ticketing_api",
    trustTier: "ticketing",
    platform: "eventbrite",
    styles: ["milonga"],
    label: "Latin Soul tango (Eventbrite)",
    mixedCalendar: true,
  },
  {
    url: "https://www.eventbrite.co.uk/o/el-swing-53069553543",
    kind: "ticketing_api",
    trustTier: "ticketing",
    platform: "eventbrite",
    styles: ["salsa"],
    label: "El Swing salsa (Eventbrite)",
    mixedCalendar: true,
  },
  {
    url: "https://www.eventbrite.co.uk/o/luz-natural-dance-75575681303",
    kind: "ticketing_api",
    trustTier: "ticketing",
    platform: "eventbrite",
    styles: ["ecstatic_dance"],
    label: "Luz Natural Dance (Eventbrite)",
    mixedCalendar: true,
  },
  {
    url: "https://www.eventbrite.co.uk/o/flomotion-dance-35508027393",
    kind: "ticketing_api",
    trustTier: "ticketing",
    platform: "eventbrite",
    styles: ["ecstatic_dance"],
    label: "Flomotion ecstatic dance (Eventbrite)",
    mixedCalendar: true,
  },
  {
    url: "https://www.eventbrite.co.uk/o/parish-of-herne-hill-28728335445",
    kind: "ticketing_api",
    trustTier: "ticketing",
    platform: "eventbrite",
    styles: ["ceilidh"],
    label: "Herne Hill Ceilidh (Eventbrite)",
    mixedCalendar: true,
  },
  // A third batch from the same 2026-10-27 list (D-208): organisers whose upcoming events (checked
  // 2026-10-29) are dance nights; their other events go through the mixed-calendar screen.
  {
    url: "https://www.eventbrite.co.uk/o/cocoon-105310502171",
    kind: "ticketing_api",
    trustTier: "ticketing",
    platform: "eventbrite",
    styles: ["ecstatic_dance"],
    label: "Cocoon ecstatic dance (Eventbrite)",
    mixedCalendar: true,
  },
  {
    url: "https://www.eventbrite.co.uk/o/sound-silence-121350665812",
    kind: "ticketing_api",
    trustTier: "ticketing",
    platform: "eventbrite",
    styles: ["ecstatic_dance"],
    label: "Sound & Silence sober raves and ecstatic dance (Eventbrite)",
    mixedCalendar: true,
  },
  {
    url: "https://www.eventbrite.co.uk/o/the-spiritual-club-121346978178",
    kind: "ticketing_api",
    trustTier: "ticketing",
    platform: "eventbrite",
    styles: ["ecstatic_dance"],
    label: "The Spiritual Club ecstatic dance (Eventbrite)",
    mixedCalendar: true,
  },
  {
    url: "https://www.eventbrite.co.uk/o/brenda-lucia-soul-fetch-96229271443",
    kind: "ticketing_api",
    trustTier: "ticketing",
    platform: "eventbrite",
    styles: ["ecstatic_dance"],
    label: "Soul Fetch women's ecstatic dance, North London (Eventbrite)",
    mixedCalendar: true,
  },
  {
    url: "https://www.eventbrite.co.uk/o/venn-smyth-70761858783",
    kind: "ticketing_api",
    trustTier: "ticketing",
    platform: "eventbrite",
    styles: ["ceilidh"],
    label: "Gaily Ceilidh (Eventbrite)",
    mixedCalendar: true,
  },
  {
    url: "https://www.eventbrite.co.uk/o/beth-chaudhary-18563804327",
    kind: "ticketing_api",
    trustTier: "ticketing",
    platform: "eventbrite",
    styles: ["ceilidh"],
    label: "Ceilidh in Highgate (Eventbrite)",
    mixedCalendar: true,
  },
  {
    url: "https://www.eventbrite.co.uk/o/paola-lizza-40763026683",
    kind: "ticketing_api",
    trustTier: "ticketing",
    platform: "eventbrite",
    styles: ["jive", "rock_n_roll"],
    label: "JiveMeToTheMoon, Walthamstow (Eventbrite)",
    mixedCalendar: true,
  },
  {
    url: "https://www.eventbrite.co.uk/o/funky-mambo-dance-school-38148602933",
    kind: "ticketing_api",
    trustTier: "ticketing",
    platform: "eventbrite",
    styles: ["salsa"],
    label: "Funky Mambo monthly Friday salsa night (Eventbrite)",
    mixedCalendar: true,
  },
  {
    url: "https://www.eventbrite.co.uk/o/kpubstar-event-121327429287",
    kind: "ticketing_api",
    trustTier: "ticketing",
    platform: "eventbrite",
    styles: ["kpop_random_play", "dj_night"],
    label: "Kpubstar K-pop club nights (Eventbrite)",
    mixedCalendar: true,
  },
  // Swing Patrol: each London branch's own class page writes its coming nights and its venue in the
  // page (checked 2026-10-29, D-212); its socials list loads by admin-ajax and stays unread (D-034).
  // Camden and Shadwell listed no dates that day.
  page("https://www.swingpatrol.co.uk/classes/aldgate-stompin-the-blues/", "Swing Patrol", [
    "blues",
  ]),
  // The branch class pages below are read by the swingpatrol reader, no model (D-524). Their kind is
  // "jsonld": an "html" row with a platform is re-probed and read by the model (ingest.ts probe step).
  // The model leaves these pages' class rows with no place although each page names one hall (read
  // 41085025249: all 8 unplaced), so every class title names it (D-481).
  {
    ...page("https://www.swingpatrol.co.uk/classes/angel/", "Swing Patrol", ["lindy_hop"]),
    titleVenues: { "Lindy Hop": "Exmouth Market Centre", Swing: "Exmouth Market Centre" },
    kind: "jsonld",
    platform: "swingpatrol",
  },
  {
    ...page("https://www.swingpatrol.co.uk/classes/bermondsey/", "Swing Patrol", ["lindy_hop"]),
    kind: "jsonld",
    platform: "swingpatrol",
  },
  {
    ...page("https://www.swingpatrol.co.uk/classes/euston/", "Swing Patrol", ["lindy_hop"]),
    kind: "jsonld",
    platform: "swingpatrol",
  },
  {
    ...page("https://www.swingpatrol.co.uk/classes/harringay/", "Swing Patrol", ["lindy_hop"]),
    titleVenues: { "Lindy Hop": "The Langham Club", Swing: "The Langham Club" },
    kind: "jsonld",
    platform: "swingpatrol",
  },
  {
    ...page("https://www.swingpatrol.co.uk/classes/vauxhall/", "Swing Patrol", ["lindy_hop"]),
    titleVenues: {
      "Lindy Hop": "St Anne and All Saints Church",
      Swing: "St Anne and All Saints Church",
    },
    kind: "jsonld",
    platform: "swingpatrol",
  },
  {
    ...page("https://www.swingpatrol.co.uk/classes/waterloo/", "Swing Patrol", ["lindy_hop"]),
    titleVenues: { "Lindy Hop": "Where Living Space", Swing: "Where Living Space" },
    kind: "jsonld",
    platform: "swingpatrol",
  },
  // Tango Amistoso: its weekly schedule of classes and milongas (Claremont Project, Milonga Maitri).
  // Its week summary names the hall once per day ("Friday 30 October, 10 Herbal Hill: ... Milonga
  // Maitri"), so the model leaves those rows with no place; the page states "Friday and Saturday
  // evenings: 10 Herbal Hill ... Sunday: Claremont Project, Lower Hall" (2026-10-30, D-218).
  {
    ...page("https://www.tango-amistoso.co.uk/weekly-schedule/", "Tango Amistoso", ["milonga"]),
    titleVenues: {
      "Milonga Maitri": "10 Herbal Hill, Farringdon",
      "Milonga Amistosa": "10 Herbal Hill, Farringdon",
      "Milonga Simpatica": "Claremont Project, Lower Hall",
    },
  },
  // Jamboree (King's Cross): its events page, a swing taster class before the Cable Street Rag Band
  // most Thursdays among folk sessions and gigs, hence the screen.
  {
    ...page("https://www.jamboreevenue.co.uk/events/", "Jamboree", ["lindy_hop"]),
    venueAddress: "6 St Chad's Place, London WC1X 9HH",
    venuePage: true,
    mixedCalendar: true,
    notDanceNights: [
      "Word Space",
      "A Life Drawing Class by North London Life Drawing (Longer Poses)",
      "A Weekly Life Drawing Class",
    ],
  },

  // More venues' own pages, read by the extractor (D-206), each checked 2026-10-27 (robots.txt
  // allows it). Club calendars mix gigs in, hence the screen. Resident Advisor links on them are
  // never followed (D-034) and DICE is read from its own browse pages (D-197).
  // Cecil Sharp House (EFDSS): its "Dances" list draws its events from a script, which the reader
  // drops, so each regular dance's own page is read; each page lists every date of its season
  // (checked 2026-10-29, D-209). The pages are named by year: swap in next year's in January.
  {
    ...page(
      "https://www.efdss.org/whats-on/27-dances/14417-friday-feet-2026",
      "Cecil Sharp House",
      ["balkan", "israeli"],
    ),
    venueAddress: "2 Regent's Park Road, London NW1 7AY",
    venuePage: true,
  },
  {
    ...page(
      "https://www.efdss.org/whats-on/27-dances/15735-the-london-barndance-company-2026",
      "Cecil Sharp House",
      ["ceilidh", "english_country"],
    ),
    venueAddress: "2 Regent's Park Road, London NW1 7AY",
    venuePage: true,
  },
  {
    ...page(
      "https://www.efdss.org/whats-on/27-dances/15766-knees-up-cecil-sharp-ceilidh-2026",
      "Cecil Sharp House",
      ["ceilidh"],
    ),
    venueAddress: "2 Regent's Park Road, London NW1 7AY",
    venuePage: true,
  },
  // Phonox: its own events page.
  {
    ...page("https://phonox.co.uk/whats-on", "Phonox", ["house", "techno"]),
    venueAddress: "418 Brixton Road, London SW9 7AY",
    venuePage: true,
    mixedCalendar: true,
  },
  // Palais (Peckham): its own events page.
  {
    ...page("https://palais.co.uk/", "Palais (Peckham)", ["house", "techno"]),
    venueAddress: "1A Rye Lane, London SE15 5EW",
    venuePage: true,
    mixedCalendar: true,
  },
  // EartH Hackney: its own events page.
  {
    ...page("https://earthackney.co.uk/events/", "EartH Hackney", []),
    venueAddress: "11-17 Stoke Newington Road, London N16 8BH",
    // Its three rooms, as its events page names them (2026-10-28).
    venueRooms: ["EartH Theatre", "EartH Hall", "EartH Kitchen"],
    venuePage: true,
    mixedCalendar: true,
  },
  // 93 Feet East: its own events page.
  {
    ...page("https://www.93feeteast.co.uk/", "93 Feet East", []),
    venueAddress: "150 Brick Lane, London E1 6QL",
    venuePage: true,
    mixedCalendar: true,
    // Its cards run date, rooms and genres into the title (2026-10-29, D-224).
    cardTitle: {
      prefix:
        /^93\s+(?:CLUB|LIVE)\s+[A-Za-z]+day\s+\d{1,2}\s+[A-Za-z]{3,9}\s+\d{1,2}(?::\d{2})?\s*[ap]m(?:\s*-\s*\d{1,2}(?::\d{2})?\s*[ap]m)?/i,
      // Its "93 CLUB" cards are club nights, "93 LIVE" ones gigs (2026-10-30, D-292).
      danceCard: /^93\s+CLUB\b/i,
      rooms: [
        "Live Room",
        "Members Bar",
        "Rooftop Terrace",
        "Main Room",
        "The Courtyard",
        "Venue Takeover",
      ],
      tails: [
        // An age tag ends some cards (2026-10-29).
        "18+",
        "21+",
        "Deep House",
        "Tech House",
        "Soulful House",
        "Afro House",
        "House",
        "90s Dance",
        "Dance",
        "Electronic",
        "Alternative Rock",
        "Synth Pop",
        "Techno",
        "Disco",
        "Drum & Bass",
        "Garage",
        "Amapiano",
        "Hip Hop",
        "R&B",
      ],
    },
  },
  // Number 90: its own events page.
  {
    ...page("https://number90bar.co.uk/events-east-london/", "Number 90", ["dj_night"]),
    venueAddress: "90 Wallis Road, London E9 5LN",
    venuePage: true,
    mixedCalendar: true,
  },
  // Made in Brasil (Camden): its own events page.
  {
    ...page("https://www.madeinbrasil.co.uk/eventsandoffers", "Made in Brasil (Camden)", [
      "latin_club",
    ]),
    venueAddress: "12 Inverness Street, London NW1 7HJ",
    venuePage: true,
    mixedCalendar: true,
  },
  // Paloma Chelsea: its own events page.
  {
    ...page("https://palomachelsea.com/", "Paloma Chelsea", ["latin_club"]),
    venueAddress: "92b Old Brompton Road, London SW7 3LQ",
    venuePage: true,
    mixedCalendar: true,
  },
  // Swingland: swing socials in Hammersmith and Balham; its events page embeds a public Google
  // Calendar, read through the Calendar API (D-130).
  {
    ...page("https://www.swingland.com/events/", "Swingland", ["lindy_hop"]),
    kind: "feed_gcal",
    platform: "feed_gcal",
  },

  // DICE's London browse pages, DJ and Party, and their genre pages (D-197; the owner, 2026-10-27,
  // after checking DICE's terms): the same pages New York reads (D-139, D-148).
  // Every New York genre page exists for London and lists nights (checked 2026-10-27).
  ...diceSources(DICE_BROWSE, "London"),
  // Colet House (West Kensington): its Ticket Tailor box office mixes qigong, tai chi and choirs with a
  // weekly 5Rhythms night and ecstatic dances (checked 2026-10-29, D-210), hence the screen.
  {
    ...page("https://www.tickettailor.com/events/thestudysociety", "Colet House", ["five_rhythms"]),
    venueAddress: "151 Talgarth Road, London W14 9DA",
    venuePage: true,
    mixedCalendar: true,
  },
  // 5Rhythms class pages from the 5Rhythms class finder (EventSearch.php, United Kingdom, inside London's box),
  // checked 2026-10-31: in-person classes with an upcoming date; online ones, a closed group and one past date
  // skipped (D-523: 5Rhythms gave written permission, which supersedes London's link-only rule for 5Rhythms).
  // Body Prayer: Sundays at Acland Burghley School, Tufnell Park (11:30-14:30).
  page(
    "https://www.5rhythms.com/classes/SundayMorningsRhythmsBODYPRAYER-288024",
    "Body Prayer 5Rhythms",
    ["five_rhythms"],
  ),
  // Emerging Waves Walthamstow: Tuesdays at 350 Hoe Street, Walthamstow (course to 10 Nov).
  page(
    "https://www.5rhythms.com/classes/EmergingWaves-299434",
    "Emerging Waves Walthamstow 5Rhythms",
    ["five_rhythms"],
  ),
  // SACRwED: Wednesdays at Colet House, West Kensington.
  page("https://www.5rhythms.com/classes/SACRwED-294781", "SACRwED 5Rhythms", ["five_rhythms"]),
  // Emerging Waves Balham: Wednesday 11 Nov at Chestnut Grove School, Balham.
  page("https://www.5rhythms.com/classes/EmergingWaves-299155", "Emerging Waves Balham 5Rhythms", [
    "five_rhythms",
  ]),
  // South London Dance Community: Wednesday 11 Nov at Anerley Town Hall.
  page(
    "https://www.5rhythms.com/classes/RhythmsSouthLondonDanceCommunity-298690",
    "South London Dance Community 5Rhythms",
    ["five_rhythms"],
  ),
  // South London Waves: Wednesday 9 Dec at Anerley Town Hall.
  page("https://www.5rhythms.com/classes/SouthLondonWaves-298772", "South London Waves 5Rhythms", [
    "five_rhythms",
  ]),
  // TWC: Thursdays at St Luke's, Hillmarton Road, Holloway.
  page("https://www.5rhythms.com/classes/TWC-329", "TWC 5Rhythms", ["five_rhythms"]),
  // Simply Being: Fridays at Central School of Ballet, Southwark.
  page("https://www.5rhythms.com/classes/SimplyBeingRhythms-291541", "Simply Being 5Rhythms", [
    "five_rhythms",
  ]),
  // Friday Beat: Fridays at Marlborough Primary School, Chelsea.
  page("https://www.5rhythms.com/classes/FridayBeat-290782", "Friday Beat 5Rhythms", [
    "five_rhythms",
  ]),
  // Bare Souls: Fridays at Haverstock School, Chalk Farm.
  page(
    "https://www.5rhythms.com/classes/InpersonBareSoulsRhythmsregclass-136",
    "Bare Souls 5Rhythms",
    ["five_rhythms"],
  ),
  // Dance Kew: Friday 6 Nov at St Luke's Church, Kew.
  page("https://www.5rhythms.com/classes/DanceKew-298722", "Dance Kew 5Rhythms", ["five_rhythms"]),
  // Dance Kew: Friday 13 Nov at Kew Community Centre, St Luke's Church, Kew.
  page("https://www.5rhythms.com/classes/DanceKew-297191", "Dance Kew 5Rhythms", ["five_rhythms"]),
  // Dance Kew: Friday 20 Nov at St Luke's Church, Kew.
  page("https://www.5rhythms.com/classes/DanceKew-298933", "Dance Kew 5Rhythms", ["five_rhythms"]),
  // Emerging Waves Putney: Saturday 7 Nov at Phoenix Yoga, Putney.
  page("https://www.5rhythms.com/classes/EmergingWaves-298559", "Emerging Waves Putney 5Rhythms", [
    "five_rhythms",
  ]),
  // Saturday Waves Highgate: Saturday 14 Nov at the URC Church, Pond Square, Highgate.
  page(
    "https://www.5rhythms.com/classes/saturdayWaves-299244",
    "Saturday Waves Highgate 5Rhythms",
    ["five_rhythms"],
  ),
  // Emerging Waves Southwark: Sunday 15 Nov at Notre Dame School, St George's Road, Southwark.
  page(
    "https://www.5rhythms.com/classes/EmergingWaves-299667",
    "Emerging Waves Southwark 5Rhythms",
    ["five_rhythms"],
  ),
  // Maggie's (Chelsea, 80s club): found by discovery; its pages name no venue, so every night was
  // unplaced on 2026-10-29. Its address, from its own site's "Fulham Road" and listings (D-210).
  {
    // Labelled as its pages write the name ("10:30PM - 2:30AM Maggies"): a listing takes the address only
    // when its venue name matches the label, and "Maggie's" left all 7 unplaced on 2026-10-29 (D-216).
    ...page("https://www.maggies-club.com/whats-on/", "Maggies", ["retro"]),
    venueAddress: "329 Fulham Road, London SW10 9QL",
    venuePage: true,
    mixedCalendar: true,
  },
  // Tea dances (research sweep, D-214, checked 2026-10-29). Newham Council's page lists the year's
  // dates (11 Nov, 7 Dec, 11 Jan...) at Old Town Hall Stratford, a lesson then 1.30-4.30pm dancing.
  {
    ...page(
      "https://www.newham.gov.uk/events/event/73/newham-s-tea-dances",
      "Newham's Tea Dances",
      ["ballroom"],
    ),
    venueAddress: "29 The Broadway, London E15 4BQ",
    venuePage: true,
    // Its dates stand one per line above one time block; the model misdates them (D-491).
    datesList: true,
  },
  // Irish Cultural Centre, Hammersmith: its what's-on list, a monthly community tea dance (19 Nov)
  // among talks, comedy and films, hence the screen.
  {
    ...page("https://irishculturalcentre.co.uk/whats-on/", "Irish Cultural Centre", ["ballroom"]),
    venueAddress: "5 Black's Road, London W6 9DT",
    venuePage: true,
    mixedCalendar: true,
    notDanceNights: ["ICC Concert Session *"],
  },
  // London-wide dance calendars (D-211), each checked 2026-10-29 against the recall list's misses.
  // London Salsa Events: The Events Calendar's iCalendar export, every listing a salsa or bachata
  // class-and-social with its address (24 upcoming).
  {
    ...directory("https://londonsalsaevents.uk/events/", "London Salsa Events", [
      "salsa",
      "bachata",
    ]),
    kind: "feed_ics",
    feedUrl: "https://londonsalsaevents.uk/events/?ical=1",
    // Its feed writes Bailando Thursdays (Metropolis Vauxhall) as 07:00-11:30, a morning; the social runs
    // 7:30-11:30pm (social-dance.today lists it right), so this feed's copy is left out (coverage 2026-11-13).
    notDanceNights: ["Bailando Thursdays"],
  },
  // London Milongas: this week's milongas and practicas with times and addresses (no export), and
  // its list page for the next days; nights outside London (Oxford, Reading) are left out by place.
  directory("https://londonmilongas.co.uk/this-week/", "London Milongas", ["milonga", "practica"]),
  directory("https://londonmilongas.co.uk/events/", "London Milongas", ["milonga", "practica"]),
  // DesignMyNight (owner's go, 2026-10-29): its London lists draw their events from its API, which
  // robots.txt disallows, so a regular night's own page is read; each writes its coming dates.
  directory(
    "https://www.designmynight.com/london/whats-on/classes/bailando-thursdays-bar-salsa-soho",
    "Bailando Salsa Thursdays (DesignMyNight)",
    ["salsa", "bachata"],
  ),
  // Research sweep (D-249, D-213), each checked 2026-10-29: robots.txt allows the page, and it
  // writes dated nights in the coming weeks.
  // Swing Out London: the London-wide list of swing socials, the next 14 days with a date, venue and
  // area each (Blues at the Ritzy, Bishopsgate Swing Den, C Jam, A-Train, Tuesday Tea Hop...).
  // Read by the swingoutlondon reader, no model (D-870): the model left every row unplaced with
  // "Venue in Area" in the title, so no night met the organiser's own copy. Kind "jsonld" as for
  // Swing Patrol above: an "html" row with a platform is re-probed and read by the model.
  {
    ...directory("https://www.swingoutlondon.co.uk/", "Swing Out London", [
      "lindy_hop",
      "balboa",
      "blues",
    ]),
    kind: "jsonld",
    platform: "swingoutlondon",
  },
  // The Bedford, Balham: The Events Calendar's iCalendar export (30 events 10/29), a Monday salsa
  // night and Tuesday swing lessons beside comedy, quizzes and club nights, hence the screen.
  {
    ...page("https://thebedford.com/events/", "The Bedford", ["salsa", "lindy_hop"]),
    venueAddress: "77 Bedford Hill, London SW12 9HD",
    kind: "feed_ics",
    feedUrl: "https://thebedford.com/events/?ical=1",
    venuePage: true,
    mixedCalendar: true,
    notDanceNights: [
      "Zumba",
      "Life Drawing",
      "LIVE AT THE BEDFORD PRESENTS: LONDON'S NO1 ABBA TRIBUTE NIGHT SHOW",
    ],
  },
  // Rivoli Ballroom, Crofton Park: its events page, discos, northern soul, reggae and jukebox
  // dances (19 dated 10/29) beside film and comedy nights, hence the screen.
  {
    ...page("https://www.rivoliballroom.com/upcoming-events", "Rivoli Ballroom", [
      "disco",
      "retro",
    ]),
    venueAddress: "350 Brockley Road, London SE4 2BY",
    venuePage: true,
    mixedCalendar: true,
  },
  // DILF: its Ticket Tailor box office, weekly Friday club nights at RAES, London Bridge (21 dated
  // 10/29); its nights in Manchester, Leeds and Glasgow are left out by place.
  // Every "DILF LONDON" night it lists is at RAES (2026-10-30, D-218); the model left one with no place.
  {
    ...page("https://www.tickettailor.com/events/dilf", "DILF", ["queer_party", "dj_night"]),
    titleVenues: { "DILF LONDON": "RAES" },
  },
  // Cut A Shine: Squarespace events list of ceilidhs and barn dances (Halloween, Winter Ceilidh at
  // the Round Chapel, Burns Night).
  squarespace("https://www.cutashine.co.uk/events", "Cut A Shine", ["ceilidh"]),
  // I Like It Like That: its event calendar, monthly Sunday salsa vinyl matinees (22 Nov, 20 Dec).
  page("https://www.ilikeitlikethat-salsa.com/events", "I Like It Like That", ["salsa"]),
  // From coverage's Serper gap list for London (D-249, D-215), each checked 2026-10-29.
  // folkdance.page: the open folk dance listings (its data is the public dancelist-data repository),
  // London's iCalendar export, 52 ceilidhs, bals and barn dances; robots.txt allows "*" and turns away
  // only named AI crawlers, and the feed is read without a model.
  {
    ...directory("https://folkdance.page/?country=UK&city=London", "folkdance.page", [
      "ceilidh",
      "bal_folk",
    ]),
    kind: "feed_ics",
    feedUrl: "https://folkdance.page/index.ics?country=UK&city=London",
  },
  // Social Dance Today: a London list of social dance parties for the coming week, each with its
  // venue and street (about 60 salsa, bachata, kizomba and Cuban nights on 10/29).
  {
    ...directory("https://social-dance.today/London?l=en", "Social Dance Today", [
      "salsa",
      "bachata",
      "kizomba",
    ]),
    // Its search.ics gives floating DTSTARTs (no TZID) shifted as if from US Central: evening
    // nights arrive at 07:00, 13:00, 13:30 and 14:00 (13:30 = a 19:30 London start minus 6 h;
    // Latin Krazy Thursday, read 41327983492, 2026-11-01). Read those as time not listed (D-063);
    // a real daytime event at one of those times loses its time too.
    placeholderTimes: ["07:00", "13:00", "13:30", "14:00"],
  },
  // Fiddle Paradiddle's Pop-up Ceilidh: its dates in south London pubs and churches (Bedford, Small
  // Beer, St Thomas); its Reading nights are left out by place.
  page("https://popupceilidh.co.uk/", "Pop-up Ceilidh", ["ceilidh"]),
  // K-pop Planet UK: its timetable of dated K-pop dance classes at a Brixton studio.
  {
    ...page("https://www.k-popplanet.uk/timetable", "K-pop Planet UK", ["kpop_class"]),
    venueAddress: "1-3 Brixton Road, London SW9 6DE",
    venuePage: true,
  },
  // Second research pass, checked by hand 2026-10-30 (D-293).
  // Rueda Libre: its events list, Cuban salsa and rueda socials and classes at many London venues
  // (30 upcoming 10/30); its nights outside London are left out by place. Its iCalendar export
  // answers 403 to the reader's own user agent, so the page is read (D-298). Every event is Cuban
  // dance, so no mixed-calendar screen (it dropped Cubaneando). Pinned to plain HTML so the stored
  // feed_ics kind is replaced (D-365's pin).
  {
    ...page("https://ruedalibre.co.uk/events/", "Rueda Libre", ["salsa", "rueda"]),
    platform: "probed",
  },

  // Swing Academy UK: its public Google Calendar, weekly West Coast Swing nights (Tuesdays at the
  // Swiss Church WC2H, Thursdays in Little Russell St WC1A) with dated cancellations and workshops.
  {
    url: "https://www.westcoastswing.co.uk/whats-on/calendar/",
    kind: "feed_gcal",
    platform: "feed_gcal",
    feedUrl:
      "https://calendar.google.com/calendar/ical/swingacademycalendar%40gmail.com/public/basic.ics",
    trustTier: "first_party",
    styles: ["west_coast_swing"],
    label: "Swing Academy UK (Google Calendar)",
  },
  // EastonSwing: a public Google Calendar of UK West Coast Swing socials (SwingTing at Dragon Hall
  // WC2B, Chalk Farm NW3); its nights outside London are left out by place.
  {
    url: "https://www.eastonswing.com/",
    kind: "feed_gcal",
    platform: "feed_gcal",
    feedUrl:
      "https://calendar.google.com/calendar/ical/tdmii7je0scqjjoqibneibpg74%40group.calendar.google.com/public/basic.ics",
    trustTier: "directory",
    styles: ["west_coast_swing"],
    label: "EastonSwing WCS calendar (Google Calendar)",
  },
  // London Ceilidh Club: its Events Calendar API (its ?ical=1 address answers a web page), ceilidhs
  // at Cecil Sharp House NW1 and other halls.
  {
    url: "https://ceilidhclub.com/events/",
    kind: "wp_tribe",
    feedUrl: "https://ceilidhclub.com/wp-json/tribe/events/v1/events",
    trustTier: "first_party",
    styles: ["ceilidh", "scottish_country"],
    label: "London Ceilidh Club",
  },
  // Tickettailor organisers, each with dated London nights on 2026-10-30.
  page("https://www.tickettailor.com/events/forrofamily", "Forró Family", ["forro"]),
  // Ritmo Latino's and Gingaboo's weekly nights are "Multiple dates and times" cards: each card's
  // own event page lists every date as JSON-LD (D-483).
  {
    ...page("https://www.tickettailor.com/events/ritmolatinodance", "Ritmo Latino", [
      "bachata",
      "brazilian_zouk",
      "salsa",
    ]),
    eventPageDates: true,
  },
  page("https://www.tickettailor.com/events/almadecuba", "Alma de Cuba", ["salsa", "timba"]),
  {
    ...page("https://www.tickettailor.com/events/gingaboouk", "Gingaboo UK", [
      "kizomba",
      "urban_kiz",
    ]),
    eventPageDates: true,
  },
  // Pura Nights: weekly salsa and bachata clubs, Mondays at The George IV, Chiswick and Tuesdays at The
  // Drayton Court, Ealing, each a "Multiple dates and times" card whose event page lists its dates (D-485).
  {
    ...page("https://www.tickettailor.com/events/puranightssalsabachata", "Pura Nights", [
      "salsa",
      "bachata",
    ]),
    eventPageDates: true,
  },
  // RSCDS London Branch's Thursday Social: a monthly Scottish country dance at St Columba's, Pont Street,
  // 7-9.30pm; its dates stand one per line under one time block (D-485, as D-491).
  {
    ...page("https://www.rscdslondon.org.uk/thursday-social", "RSCDS Thursday Social", [
      "scottish_country",
    ]),
    venueAddress: "Upper Hall, St Columba's Church, Pont Street, London SW1X 0BD",
    venuePage: true,
    datesList: true,
  },
  // Sway Bar, Holborn: its own club page lists each night as a dated card (title, "Monday 02nd November",
  // description) for months ahead: Latin nights Monday, Tuesday and Thursday, reggaeton Friday, Desi DJs
  // Saturday. Party N Paint (7-10pm) is a painting party, not a dance night (D-486). No robots.txt, 2026-10-31.
  {
    ...page("https://www.swaybar.co.uk/club", "Sway Bar", [
      "salsa",
      "bachata",
      "reggaeton",
      "bhangra",
    ]),
    venueAddress: "Sway, 61-65 Great Queen Street, London WC2B 5BZ",
    venuePage: true,
    onlyHere: true,
    mixedCalendar: true,
    // The model also writes the night's weekday after the card's title ("Latin Krazy Thursday", read
    // 41180675028), which the exact title match missed (D-488).
    danceNights: [
      "Latino Sway Mondays",
      "Latino Sway Monday",
      "The Latin Collective",
      "The Latin Collective Tuesday",
      "Latin Krazy",
      "Latin Krazy Thursday",
      "Jaleo",
      "Jaleo Friday",
      "Desi In The City!",
      "Desi In The City! Saturday",
    ],
    notDanceNights: ["Party N Paint"],
  },
  // DANCE GPS: Bachata Flow Mondays (Be At One, Regent Street) and Bachata Musketeers (Sundays, Dance
  // Station, Aldgate), each a "Multiple dates and times" card whose event page lists its dates (D-486).
  {
    ...page("https://www.tickettailor.com/events/dancegps1", "DANCE GPS", ["bachata"]),
    eventPageDates: true,
  },
  // DJ dance bars (D-291, the owner 2026-10-30: "we need to ensure we're capturing dj dance bars"),
  // each read from its own site, robots.txt checked 2026-10-30.
  // Bambi, London Fields: dated Friday and Saturday DJ nights; the floor is cleared at 11pm for
  // dancing until 1am. Its Sunday live trio and midweek dinners are left out by the screen.
  {
    ...page("https://bambi-bar.com/events/", "Bambi", ["dj_night"]),
    venueAddress: "Netil House, 1 Westgate Street, London E8 3RL",
    venuePage: true,
    onlyHere: true,
    mixedCalendar: true,
    danceNights: ["Fridays at Bambi", "Soul Saturdays"],
  },
  // Venn Street Records, Clapham: dated "DJ SET" nights (10pm-2am) among live bands.
  {
    ...page("https://www.vennstreetrecords.com/whats-on/", "Venn Street Records", ["dj_night"]),
    venueAddress: "78 Venn Street, London SW4 0BD",
    venuePage: true,
    onlyHere: true,
    mixedCalendar: true,
  },
  // Old St. Records, Shoreditch: the same template, dated "DJ SET" nights among live music.
  {
    ...page("https://www.oldstreetrecords.com/whats-on/", "Old St. Records", ["dj_night"]),
    venueAddress: "350-356 Old Street, London EC1V 9NQ",
    venuePage: true,
    onlyHere: true,
    mixedCalendar: true,
  },
  // Northcote Records, Battersea: the same template, dated "DJ SET" nights among live music.
  {
    ...page("https://www.northcoterecords.com/whats-on/", "Northcote Records", ["dj_night"]),
    venueAddress: "8-10 Northcote Road, London SW11 1NT",
    venuePage: true,
    onlyHere: true,
    mixedCalendar: true,
  },
  // Paper Dress Vintage, Hackney: dated disco club nights among ticketed gigs.
  {
    ...page("https://paperdressvintage.co.uk/by-night", "Paper Dress Vintage", [
      "dj_night",
      "disco",
    ]),
    venueAddress: "352a Mare Street, London E8 1HR",
    venuePage: true,
    onlyHere: true,
    mixedCalendar: true,
  },
  // Effra Social, Brixton: its own weekly DJ nights, "Effra House Party" every Friday and "Saturday
  // Spins" every Saturday, free entry (the owner 2026-10-30: a bar's own weekly schedule counts),
  // among quizzes, chess, comedy and live music. robots.txt disallows /event/ and /events/ only.
  {
    ...page("https://effrasocial.co.uk/whats-on/", "Effra Social", ["dj_night"]),
    venueAddress: "89 Effra Road, London SW2 1DF",
    venuePage: true,
    onlyHere: true,
    mixedCalendar: true,
    danceNights: ["Effra House Party", "Saturday Spins"],
  },
  // Ruby's, Dalston: its own weekly "Friday & Saturday Night Anthems Party" with a dance floor in
  // the lounge bar (the owner 2026-10-30: a bar's own weekly schedule counts), beside live jazz.
  {
    ...page("https://www.rubysdalston.com/whats-on/", "Ruby's Dalston", ["dj_night"]),
    venueAddress: "76 Stoke Newington Road, London N16 7XB",
    venuePage: true,
    onlyHere: true,
    mixedCalendar: true,
    danceNights: ["Anthems Party"],
  },
  // Ceroc's London venues: each venue's own page states its weekday and timings ("We meet on:
  // Wednesdays. TIMINGS 19:30 Beginner dance lesson ... 21:00 to 22:30 Freestyle"), read as weekly
  // nights (D-482; the owner's rule of 2026-10-30, D-303/D-402; checked 2026-10-30). The venue list is
  // Ceroc's own map data on ceroc.com/24/venues. robots.txt allows everything.
  ceroc(
    "https://www.ceroc.com/24/131/ceroc-pimlico?id=19",
    "Pimlico Academy, Lupus Street, London SW1V 3AT",
  ),
  ceroc("https://www.ceroc.com/24/131/ceroc-romford?id=56", "28 Mawney Road, Romford RM7 7HB"),
  ceroc(
    "https://www.ceroc.com/24/131/ceroc-orpington?id=133",
    "Crofton Hall, Crofton Road, Orpington BR6 8PR",
  ),
  ceroc(
    "https://www.ceroc.com/24/131/ceroc-twickenham-winning-post-pub-grill?id=139",
    "Winning Post, Chertsey Road, Twickenham TW2 6LS",
  ),
  ceroc(
    "https://www.ceroc.com/24/131/ceroc-south-kensington?id=141",
    "65 Queen's Gate, London SW7 5JS",
  ),
  ceroc(
    "https://www.ceroc.com/24/131/ceroc-eltham?id=778",
    "Harris Academy, Middle Park Avenue, London SE9 5EQ",
  ),
  ceroc(
    "https://www.ceroc.com/24/131/ceroc-upminster?id=874",
    "New Windmill Hall, St Mary's Lane, Upminster RM14 2QH",
  ),
  ceroc(
    "https://www.ceroc.com/24/131/ceroc-st-pancras?id=1345",
    "Edith Neville Primary School, Purchese Street, London NW1 1RW",
  ),
  // Salsateca: one page per weekly night, each with its schedule and hall (D-482, checked 2026-10-30).
  // robots.txt allows these paths.
  salsateca(
    "salsa-bachata-mondays-warrenstreet",
    "Warren Centre, Northumberland House, London W1T 5JU",
  ),
  salsateca(
    "cuban-salsa-bachata-tuesdays-borough-elephantandcastle",
    "47 Bartholomew Street, London SE1 4AN",
  ),
  salsateca("salsa-bachata-tuesdays-bromley", "33 London Road, Bromley BR1 1DG"),
  salsateca(
    "salsa-bachata-wednesdays-warrenstreet",
    "Warren Centre, Northumberland House, London W1T 5JU",
  ),
  salsateca("cuban-salsa-thursdays-moorgate-liverpoolstreet", "4-5 Eldon Street, London EC2M 7LS"),
  salsateca("salsa-bachata-fridays-moorgate-liverpoolstreet", "4-5 Eldon Street, London EC2M 7LS"),
  salsateca("cuban-saturdays-waterloo", "27 Blackfriars Road, London SE1 8NY"),
  salsateca("saturdays-lewisham-salsa-bachata", "100-104 Lewisham High Street, London SE13 5JH"),
  salsateca("salsa-bachata-sundays-borough", "47 Bartholomew Street, London SE1 4AN"),

  // D-524 gap analysis seeds (London-43, 2026-11-01; robots.txt checked 2026-11-01, all allow).

  // Lil' Nashville, Chiswick: its own page states weekly line dancing lessons, Wednesday and Saturday (times
  // only in the booking widget). Sunday lessons are paused ("start back on the 11th January"), so not listed.
  {
    ...page("https://www.lilnashville.co.uk/line-dancing-lessons", "Lil' Nashville (Chiswick)", [
      "line_dance",
    ]),
    venueAddress: "11 Barley Mow Passage, London W4 4PH",
    venuePage: true,
    onlyHere: true,
    fixedNights: [
      {
        title: "Line Dancing Lessons at Lil' Nashville (Wednesday)",
        line: "line dancing lessons every Wednesday evening at our bar in Chiswick",
        days: [3],
        start: null,
        danceCited: "own site, https://www.lilnashville.co.uk/line-dancing-lessons (2026-11-01)",
      },
      {
        title: "Line Dancing Lessons at Lil' Nashville (Saturday)",
        line: "our weekly Saturday line dancing classes",
        days: [6],
        start: null,
        danceCited: "own site, https://www.lilnashville.co.uk/line-dancing-lessons (2026-11-01)",
      },
    ],
  },

  // forro.london "where to dance": London's forró nights by weekday, with venue and hours, no dates (Floripa
  // Tuesdays 7.15pm, Juju's Wednesdays 7pm, Tia Maria Sundays): read as weekly nights (D-402).
  {
    ...directory("https://forro.london/where-to-dance", "forro.london where to dance", ["forro"]),
    weeklyGrid: true,
    mixedCalendar: false,
  },

  // Hootananny Brixton: club and reggae nights.
  {
    ...page("https://hootanannybrixton.co.uk/", "Hootananny Brixton", ["dj_night", "dancehall"]),
    venueAddress: "95 Effra Road, London SW2 1DF",
    venuePage: true,
    onlyHere: true,
    mixedCalendar: true,
  },

  // London Irish Centre, Camden: The Jive Tribe every Thursday 6:45pm, céilís.
  {
    ...page("https://www.londonirishcentre.org/events/", "London Irish Centre", [
      "jive",
      "ceilidh",
    ]),
    venueAddress: "50-52 Camden Square, London NW1 9XB",
    venuePage: true,
    onlyHere: true,
    mixedCalendar: true,
    danceNights: ["The Jive Tribe"],
  },

  // Royal Vauxhall Tavern: queer club nights among cabaret. Its What's On page dates every night; the
  // home page gives titles without dates (9 rejected on read 41339564832, 2026-11-01). Its late club
  // nights name no dance, so they are named here (D-264); the cabaret, quizzes and panto are not.
  {
    ...page("https://www.vauxhalltavern.com/whats-on/", "Royal Vauxhall Tavern", [
      "queer_party",
      "dj_night",
    ]),
    venueAddress: "372 Kennington Lane, London SE11 5HY",
    venuePage: true,
    onlyHere: true,
    mixedCalendar: true,
    danceNights: [
      "Boogie Wonderland",
      "Madonna Fan Party *",
      "Inside The Groove *",
      "Honcho",
      "Eurofest",
      "BeefMince",
      "Push The Button",
      "Dandy Does London",
    ],
  },

  // The Divine, Dalston: successor of The Glory; its club nights are titled "CLUB: ...".
  {
    ...page("https://thedivine.co.uk/", "The Divine (Dalston)", ["queer_party", "dj_night"]),
    venueAddress: "33 Stoke Newington Road, London N16 8BJ",
    venuePage: true,
    onlyHere: true,
    mixedCalendar: true,
  },

  // 100 Club: its home page has no text to read (read 41327983492, 2026-11-01); its events list
  // filtered by genre is plain HTML. Northern Soul = the 6T's all-nighters and parties, every row a
  // dance night; Jump Jive = its swing dance nights (Stompin' at the 100 Club).
  {
    ...page("https://www.the100club.co.uk/events/?genre=northern-soul", "100 Club", ["dj_night"]),
    venueAddress: "100 Oxford Street, London W1D 1LL",
    venuePage: true,
    onlyHere: true,
  },
  {
    ...page("https://www.the100club.co.uk/events/?genre=jump-jive", "100 Club", ["swing", "jive"]),
    venueAddress: "100 Oxford Street, London W1D 1LL",
    venuePage: true,
    onlyHere: true,
  },

  // MARSM: Arabic music and culture; monthly Hishek Bishek SWANA dance parties at changing venues.
  page("https://www.marsm.co.uk/upcoming-events", "MARSM (Hishek Bishek)", ["dj_night", "dabke"]),

  // Bint Bash Parties: SWANA women's dance parties, Ticket Tailor.
  page("https://www.tickettailor.com/events/bintbashparties", "Bint Bash Parties", [
    "dj_night",
    "belly_dance",
  ]),

  // Haitian Vinyl Night: kompa, Ticket Tailor.
  page("https://www.tickettailor.com/events/patriceesperant", "Haitian Vinyl Night", ["kompa"]),
];

/** London's retired starting addresses, each with the reason (D-047). */
export const LONDON_RETIRED: readonly RetiredSource[] = [
  // Found by discovery from a London venue's website on the first London run (2026-10-27).
  {
    url: "https://www.ceroc.com/27/41/events",
    reason:
      "Ceroc's national calendar: 49 of its 49 nights named no place, and they were in Ipswich, Rugby, Norfolk and Shrewsbury (first London run, 2026-10-27); London's Ceroc nights come from its London pages",
  },
  {
    url: "https://labyrinthshrewsbury.com/events/",
    reason: "a Shrewsbury club, 150 miles from London (first London run, 2026-10-27)",
  },
  // Found by discovery; checked by hand 2026-10-30 (D-290).
  {
    url: "https://cococure.com/",
    reason:
      "answers 403 to every request, from the runner and by hand (full reads 40982144396 and 40990265600, 2026-10-30)",
  },
  {
    url: "https://swervednb.com/",
    reason:
      "its Events Calendar API (/wp-json/tribe/events/v1/events) answers 404 though the site is up: no longer a calendar (2026-10-29 to 10-30)",
  },
  // Found by discovery; their "?ical=1" address answers a web page, not a calendar, every run.
  {
    url: "https://bisma.org/",
    reason:
      "its calendar address is not an iCalendar file: failed 6 runs in a row from the first, 2026-10-27 to 10-28",
  },
  {
    url: "https://laxalounge.co.uk/",
    reason:
      "its calendar address is not an iCalendar file: failed 6 runs in a row from the first, 2026-10-27 to 10-28",
  },
  // D-291: both answer a browser but 403 the ingest runner on every read since 2026-10-29.
  {
    url: "https://www.slimjimsliquorstore.com/events-rock-music-live-music-club-djs/",
    reason:
      "answers 403 to the ingest runner on every London read from 2026-10-29 to 10-30 (200 from a browser): a block on data-centre addresses",
  },
  {
    url: "https://villageunderground.co.uk/events/",
    reason:
      "answers 403 to the ingest runner on every London read from 2026-10-29 to 10-30 (200 from a browser): a block on data-centre addresses",
  },
  // Read 41044155102, checked by hand 2026-10-30 (D-298).
  {
    url: "https://ceilidhclub.com/",
    reason:
      "the same club's nights as its Events Calendar API source (ceilidhclub.com/events/, D-293), which carries times; read twice they were doubled",
  },
  {
    url: "https://www.swingacademy.co.uk/",
    reason:
      "the domain does not resolve (ENOTFOUND, 2026-10-30); its calendar is read from westcoastswing.co.uk's calendar page (D-298)",
  },
  // Read 41085025249, checked by hand 2026-10-30 (D-481).
  {
    url: "https://www.thesmoothjazzlounge.com/events",
    reason:
      "a DJ's own tour page: its dated rows are in Derby and Hampton, Virginia, and the rest name no dance (read 41085025249)",
  },
  // Read 41157882789 (D-487).
  {
    url: "https://swingdanceuk.com/classes/workshops/",
    reason:
      "never answered within 20 s: timed out on full reads 41121791821 and 41157882789 and by hand (2026-10-31); SwingdanceUK's Eventbrite organiser gives its dated nights",
  },
  // Found by discovery; live sex-party rows on 2026-11-01 (read 41284856117).
  {
    url: "https://houseofpoitier.com/",
    reason:
      "a swingers' club, not a dance venue: its nights are sex parties (read 41284856117, 2026-11-01)",
  },
  // Found by discovery; failed two full reads in a row on 2026-11-01 (read 41327983492).
  {
    url: "https://www.kclsu.org/events/",
    reason:
      "King's College students' union events page: the page has no text to read for the model (JavaScript only), failed full reads on 2026-11-01 (read 41327983492)",
  },
  // Replaced by its events list by genre (2026-11-01).
  {
    url: "https://www.the100club.co.uk/",
    reason:
      "its home page has no text to read (failed read 41327983492, 2026-11-01); its Northern Soul and Jump Jive event lists replace it",
  },
  // Replaced by its What's On page (2026-11-01).
  {
    url: "https://www.vauxhalltavern.com/",
    reason:
      "its home page lists nights without dates (1 written, 9 rejected on read 41339564832, 2026-11-01); its What's On page replaces it",
  },
  // Found by discovery; a band-photography site, not a venue calendar (2026-11-10).
  {
    url: "https://www.livebandphotos.co.uk/",
    reason:
      "a band photographer's gig list: pub cover bands, never dance nights (24 untimed rows on read 42775469862, 2026-11-10, e.g. Remus Down Boulevard at The Crown Inn, Hornchurch; same on 11-08)",
  },
  // Discovered sources that never read once (404 on every read since 2026-11-01; cities sweep 2026-11-11, run 42979688127).
  {
    url: "http://www.leopardlounge.co.uk/",
    reason: "the site answered 404 on 16 reads in a row since 2026-11-01; it never read once",
  },
  {
    url: "https://archclapham.co.uk/",
    reason: "the site answered 404 on 16 reads in a row since 2026-11-01; it never read once",
  },
  {
    url: "https://www.limehousetownhall.co.uk/",
    reason: "the site answered 404 on 16 reads in a row since 2026-11-01; it never read once",
  },
  // Found by discovery as a lounge (2026-11-10): a pub's poker page.
  {
    url: "https://www.theblackhorseeastcote.com/poker.php",
    reason:
      'The Black Horse Eastcote\'s poker page: a pub poker night, no dance nights ("DJ Night" was its only row; new-sources check 2026-11-11)',
  },
  // Found by discovery (2026-11-11): a board-game club's feed.
  {
    url: "https://www.badgerbadger.org/",
    reason:
      'a board and card game club\'s calendar ("EDH/Commander Casual"); its site lists only games, no dance nights (coverage 2026-11-11)',
  },
  // Found by discovery (2026-11-11): pubs on one site platform whose homepages link a dead /events-old/?ical=1 (it
  // answers HTML) and whose events API lists nothing; their pages list live music and quizzes only (coverage-147).
  {
    url: "https://www.thecrownhackney.co.uk/",
    reason:
      "a pub: its calendar link is a dead feed and its page lists live music and quizzes, no dance nights",
  },
  {
    url: "https://www.thefoxpub.co.uk/",
    reason:
      "a pub: its calendar link is a dead feed and its page lists live music and quizzes, no dance nights",
  },
  {
    url: "https://www.thehanbury.co.uk/",
    reason:
      "a pub: its calendar link is a dead feed and its page lists live music and quizzes, no dance nights",
  },
  {
    url: "https://www.theherculesholloway.co.uk/",
    reason:
      "a pub: its calendar link is a dead feed and its page lists live music and quizzes, no dance nights",
  },
  {
    url: "https://www.theoldhatealing.co.uk/",
    reason:
      "a pub: its calendar link is a dead feed and its page lists live music and quizzes, no dance nights",
  },
  // Found by discovery (2026-11-11) as lounges: one non-dance row each, no dance nights.
  {
    url: "https://www.thedoodlebar.com/",
    reason:
      'a bar\'s events page: a book launch ("Hip Hop Cocktails: Deluxe Edition Book Launch"), no dance nights (2026-11-12)',
  },
  {
    url: "https://www.thepriorypubn8.com/",
    reason:
      'a pub\'s page: live bands ("ZOE QUINN & BAND - LIVE MUSIC"), no dance nights (2026-11-12)',
  },
  // Found by discovery: a pub's meal page that now answers 404.
  {
    url: "https://www.owlandpussycatshoreditch.com/food-drink/sunday-roast",
    reason:
      "The Owl & Pussycat's Sunday roast page: a meal, not a dance night, and it answers 404 (coverage 2026-11-12)",
  },
  // Found by discovery (2026-11-12): a pub's menus page.
  {
    url: "https://www.thetrafalgarchelsea.com/menus/",
    reason:
      'The Trafalgar Chelsea\'s menus page: cabaret and live music ("CAMP Cabaret: A Royal Affair", "Prime Time Live Music Sessions"), not dance nights (cities sweep 2026-11-13)',
  },
  // Found by discovery (2026-11-12): a pub's what's-on page.
  {
    url: "https://www.angelandcrown.co.uk/whats-on/",
    reason:
      "The Angel & Crown's what's-on page: a daily \"MORNING CAFE\" breakfast and quiz nights, not dance nights (coverage daily check 2026-11-13)",
  },
  // Found by discovery: pubs' pages that list DJs in the bar and live music, not dance nights (cities sweep 2026-11-14).
  {
    url: "https://www.thethieves.pub/",
    reason:
      'The Thieves pub: "DJs in the main bar every Saturday night" and "Live Music Every Friday!", bar DJs, not dance nights (cities sweep 2026-11-14)',
  },
  {
    url: "https://www.thesuntavern.co.uk/whats-on/",
    reason:
      'The Sun Tavern: "DJs every Thursday, Friday, and Saturday", bar DJs, not dance nights (cities sweep 2026-11-14)',
  },
  // Found by discovery: pages that failed on every read since they were found and never stored a row (cities sweep 2026-11-14).
  {
    url: "https://www.conjuringatthecourt.com/event-list",
    reason:
      "Conjuring at the Court: a magic show; its events page has answered 404 on 9 reads in a row (cities sweep 2026-11-14)",
  },
  {
    url: "https://de-arcltd.co.uk/",
    reason:
      "de-arcltd.co.uk: failed every read since it was found and holds no listings (cities sweep 2026-11-14)",
  },
  {
    url: "https://therobinwembley.co.uk/",
    reason:
      "The Robin, Wembley (a pub): failed every read since it was found and holds no listings (cities sweep 2026-11-14)",
  },
  {
    url: "https://www.theshipsouthwark.co.uk/",
    reason:
      "The Ship, Southwark (a pub): its calendar link is not an iCalendar feed; failed every read and holds no listings (cities sweep 2026-11-14)",
  },
  {
    url: "https://www.thestagandlantern.co.uk/",
    reason:
      "The Stag and Lantern (a pub): its events link answers 404; failed every read and holds no listings (cities sweep 2026-11-14)",
  },
  {
    url: "https://cargo-dubai.com/",
    reason:
      "Cargo Dubai, a venue in Dubai found by discovery and enabled on London: wrong city, 0 rows (cities sweep 2026-11-16)",
  },
];
