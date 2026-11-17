// Dedupe thresholds (D-006). The scoring function in src/domain/dedupe.ts reads only these.

/** Two listings are candidates only when their starts are this close. */
export const CANDIDATE_START_MINUTES = 90;
/** ...and their venues are this close, or their venue names this similar. */
export const CANDIDATE_VENUE_METRES = 150;
export const CANDIDATE_VENUE_NAME_SIMILARITY = 0.8;
/** Two venue rows this close whose names begin with one telling word are one place (D-504). */
export const ONE_PLACE_METRES = 50;
/** Two venue rows this close at one street address are one place (D-591). */
export const SAME_ADDRESS_METRES = 25;
/** Two venue rows this close at one street line whose names begin with one telling word are one place:
 * one club's address geocoded twice (Oslo Hackney, 171 m apart; D-765; Sala Upload, 280 m, D-841). */
export const SAME_ADDRESS_NAMED_METRES = 300;
/** Two venue rows this close with one whole name, street line and postcode are one place (Vybz Astoria, 453 m; D-843). */
export const SAME_NAME_ADDRESS_METRES = 600;
/** Words a venue name may begin with that tell no place apart: "Bar Alfa" and "Bar Beta" are two (D-504). */
export const VENUE_GENERIC_WORDS: readonly string[] = [
  "bar",
  "club",
  "clube",
  "cafe",
  "casa",
  "sala",
  "teatro",
  "theatre",
  "theater",
  "studio",
  "studios",
  "estudio",
  "dance",
  "danca",
  "danza",
  "centro",
  "center",
  "centre",
  "hotel",
  "restaurant",
  "restaurante",
  "pub",
  "lounge",
  "the",
  "el",
  "la",
  "le",
  "los",
  "las",
  "o",
  "a",
  "os",
  "as",
  "de",
  "do",
  "da",
  "dos",
  "das",
  "del",
  "di",
  "and",
];

export const WEIGHTS = { title: 0.5, organizer: 0.2, url: 0.2, venue: 0.1 } as const;

/** At or above: merged without a model. */
export const AUTO_MERGE = 0.8;
/** At or above (and below AUTO_MERGE): queued for the Phase 3 model check on facts only. */
export const REVIEW = 0.5;

/** Organizer names this similar count as the same organizer. */
export const ORGANIZER_NAME_SIMILARITY = 0.9;

/** Merged listings whose starts differ by more than this are marked conflicting (both shown). */
export const CONFLICT_START_MINUTES = 15;

/**
 * A pair whose titles are at least this similar and whose starts are at most
 * SAME_NIGHT_START_MINUTES apart is one night, merged without a model (D-146): candidates are
 * already at one place on one night, so one title at one time there is one listing.
 */
export const SAME_NIGHT_TITLE_SIMILARITY = 0.9;
export const SAME_NIGHT_START_MINUTES = 15;
/** One source's cancelled session and its live one this close, at one venue, one title: the session moved (D-594). */
export const CANCELLED_MOVED_MINUTES = 60;
/** A whole-word title prefix at least this long counts as one title (D-146): a lineup appended. At one venue and start, any length does (D-150). */
export const SAME_NIGHT_PREFIX_MIN_CHARS = 15;
/** Short generic titles ("salsa night") at two places must not pair through an unplaced copy. */
export const UNPLACED_PAIR_MIN_CHARS = 16;

/** Letters (spaces aside) a title needs for two copies with no place on either side to pair on it alone (D-751). */
export const UNPLACED_SAME_TITLE_MIN_CHARS = 10;

/** Field precedence when merged sources disagree (D-006): first-party first. */
export const TRUST_ORDER = ["first_party", "ticketing", "serp", "directory", "unofficial"] as const;

/**
 * Registrable domains that host many organisers' pages, so a shared one says nothing about who
 * runs a night (the organizer link, D-090): ticket sellers, social networks, link pages, site
 * builders' shared domains. `ownSite` also refuses any domain whose first label is one of these
 * brands under another suffix (eventbrite.ca, eventbrite.co.uk).
 * The new cities' sellers and aggregators were added from their leads' scorecards (D-495, 2026-10-30).
 * ma.to: venue pages for many venues and promoters (Miami, D-519 audit F2, 2026-10-31).
 * skillboxes.com: SkillBox, an Indian ticket seller (Mumbai, D-519 audit F2, 2026-10-31).
 * dancetomic.com: a salsa, bachata and kizomba agenda for many organisers (Buenos Aires, D-404, 2026-10-31).
 * getbailar.com: Bailar, a Latin dance app listing many organisers (Buenos Aires D-404, Mexico City D-448).
 */
export const PLATFORM_SITES: readonly string[] = [
  "allevents.in",
  "alpogo.com",
  "axs.com",
  "bandsintown.com",
  "beacons.ai",
  "bileto.sympla.com.br",
  "billsgigulator.com",
  "bit.ly",
  "blogspot.com",
  "boletia.com",
  "business.site",
  "carrd.co",
  "checkout.square.site",
  "clubt.com.ar",
  "danceplace.com",
  "dancetomic.com",
  "dice.fm",
  "evbuc.com",
  "eventbrite.com",
  "facebook.com",
  "fb.me",
  "feverup.com",
  "forms.gle",
  "getbailar.com",
  "goandance.com",
  "godaddysites.com",
  "goo.gl",
  "google.com",
  "humanitix.com",
  "instagram.com",
  "linkin.bio",
  "linktr.ee",
  "livenation.com",
  "lu.ma",
  "ma.to",
  "meetup.com",
  "momence.com",
  "partiful.com",
  "passline.com",
  "paypal.com",
  "posh.vip",
  "ra.co",
  "residentadvisor.net",
  "sabaki.dance",
  "seetickets.us",
  "skiddle.com",
  "skillboxes.com",
  "square.link",
  "squarespace.com",
  "sympla.com.br",
  "ticketleap.events",
  "ticketmaster.com",
  "tickettailor.com",
  "ticketweb.com",
  "tiktok.com",
  "tixr.com",
  "twitter.com",
  "universe.com",
  "venmo.com",
  "venti.live",
  "viralagenda.com",
  "weebly.com",
  "withfriends.co",
  "wixsite.com",
  "wordpress.com",
  "x.com",
  "xceed.me",
  "youtube.com",
  "zeffy.com",
  "zoom.us",
];

/**
 * First-party sources that list other organisers' nights beside their own (a studio or club that
 * rents its rooms): their domain says where a night is, not who runs it, so it is never an
 * organiser's own site for the link (D-090).
 * Directories and venues that list other organisers' nights in the new cities (D-495, 2026-10-30).
 * New Orleans' directories: WWOZ Livewire and DanceUS (D-519 city audit, 2026-10-31).
 * tangomango.org: Miami's tango calendar of other organisers' milongas (D-519 audit F2, 2026-10-31).
 * mapadosamba.com.br: Rio's directory of other organisers' samba rodas (D-519 audit F2, 2026-10-31).
 * viajandoybailando.com: San Juan's island-wide calendar of other venues' salsa nights (D-519 audit F2, 2026-10-31).
 */
export const HUB_SITES: readonly string[] = [
  "brandon.org.ar",
  "cckonex.org",
  "clubgricel.com.ar",
  "cracovia32.com",
  "danceus.org",
  "elbeso.com.ar",
  "kizombaembassy.com",
  "lavirutatangoclub.com",
  "mapadosamba.com.br",
  "nicetoclub.com",
  "nycswings.net",
  "nycwcs.com",
  "ourphilly.org",
  // outxout.com: Philadelphia's LGBTQ directory of other venues' nights (D-519 audit, 2026-10-31).
  "outxout.com",
  "quehacemos.com.ar",
  "ritmolibre.ar",
  "salsavida.com",
  "sobs.com",
  "steppingoutstudios.com",
  "tangomango.org",
  "viajandoybailando.com",
  "where-to-dance-salsa.com",
  "wwoz.org",
  "zoukology.com",
];

/** Title similarity by which one linked partner must lead the next to be chosen over it. */
export const LINK_TITLE_MARGIN = 0.1;

/**
 * A lesson given by one source and dancing by the other are one evening, not two values, when the
 * dancing starts this soon after the lesson (D-090).
 */
export const LESSON_THEN_DANCING_MINUTES = 60;

/**
 * A shared site with a listing that gives no time is weak evidence: an organiser sells more than
 * one event at its usual place on one day (a workshop beside the dance). Such a pair also needs
 * titles this similar (D-090). Measured: CDNY's true pairs score 0.170 and 0.324; a workshop
 * against its untimed dance, 0.000 to 0.154.
 */
export const SAME_SITE_UNTIMED_TITLE = 0.16;

/** Leading words that mark a copy's status, not its name: "CANCELLED: A Barn Dance" is "A Barn Dance". */
export const STATUS_TAGS = [
  "cancelled",
  "canceled",
  "postponed",
  "sold out",
  "rescheduled",
  "new date",
] as const;
/**
 * Words a short title may not consist of only, for the one-venue-one-start rule: "Salsa" beside
 * "Salsa Level 2" at a studio running two rooms is two classes, not one night.
 */
export const GENERIC_TITLE_WORDS: readonly string[] = [
  "salsa",
  "bachata",
  "kizomba",
  "zouk",
  "tango",
  "milonga",
  "practica",
  "swing",
  "lindy",
  "hop",
  "blues",
  "balboa",
  "shag",
  "ballroom",
  "latin",
  "hustle",
  "west",
  "coast",
  "wcs",
  "contra",
  "country",
  "line",
  "two",
  "step",
  "folk",
  "social",
  "dance",
  "dancing",
  "party",
  "night",
  "class",
  "classes",
  "lesson",
  "lessons",
  "workshop",
  "beginner",
  "beginners",
  "intro",
  "intermediate",
  "advanced",
  "level",
  "open",
  "jam",
  "the",
  "a",
  "an",
  "and",
  "with",
  "at",
  "of",
  "in",
  "on",
  "for",
  "dj",
  "live",
  "music",
  "band",
  "friday",
  "saturday",
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "weekly",
  "monthly",
  "free",
];

/** Words too common in club titles to show two listings are one night. */
export const SHARED_STEM_IGNORE_WORDS: readonly string[] = [
  "party",
  "parties",
  "night",
  "nights",
  "event",
  "events",
  "edition",
  "presents",
  "official",
  "ticket",
  "tickets",
  "free",
  "entry",
  "special",
  "dance",
  "dancing",
  "music",
  "live",
  "club",
  "lounge",
  "rooftop",
  "views",
  "skyline",
  "with",
  "from",
  "this",
  "that",
  "your",
  "their",
  "reggaeton",
];

/** Words for "dance", "party" or "night" in the metros' languages: never a party's own name (D-741). */
export const BRAND_GENERIC_WORDS: readonly string[] = [
  "baile",
  "bailes",
  "festa",
  "festas",
  "fiesta",
  "fiestas",
  "noite",
  "noites",
  "noche",
  "noches",
  "soiree",
  "soirees",
  "fete",
  "fetes",
  "danse",
  "danses",
  "nuits",
  "tanz",
  "tanzen",
  "ballo",
  "serata",
  "danca",
  "dansa",
  "milonga",
];

/** Minimum number of shared distinctive stems required for D-549 rule. */
export const SHARED_STEM_MIN = 2;
