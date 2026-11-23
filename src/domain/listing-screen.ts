// The not-an-event screen (D-060 point 9). A title that is only a date, a month, a year, a weekday
// or a heading ("October 1, 2026", "December 2027", "Upcoming Dance Dates", "SWING REMIX Fall
// monthly dance schedule"), or a closure notice ("Studio closed", "No class", "Closed for the
// holiday"), names no event. The ingest job screens such rows out before they are stored, and
// counts and notes each one in its report, so nothing is dropped silently.
// Also leaves out boat parties and cruises (owner, 2026-10-18), except nights at moored barge venues (D-1046),
// karaoke, record fairs, band billings, ICLUB, haunted houses, games nights, children's parties,
// explicit sex parties and paint-and-sip nights.
//
// Pure. The word tables are English and small on purpose, because a real event name must never
// match: every rule needs every word of the title (or all of its end) to come from a table, so a
// single word outside them ("Brooklyn Social", "Tuesday Dance", "November 2026 Ranch") keeps the
// listing. Coverage is the product; when in doubt, keep.

import { screenTitleHan } from "@/src/domain/listing-screen-zh";
import {
  screenTitleJa,
  hasDanceWordJa,
  hasPartyKindJa,
  hasSeatedShowJa,
  isShowTitleJa,
} from "@/src/domain/listing-screen-ja";
import { screenTitlePa } from "@/src/domain/listing-screen-pa";
import { screenBillSpam } from "@/src/domain/listing-screen-spam";
import { matchStyles, normalizeForMatch, STYLES, type StyleKey } from "@/config/styles";
import { isPlaceholderTitle } from "@/src/domain/title-notices";
import { listingTypeFromText } from "@/src/domain/text-facts";
import { addCalendarDays, localInstant } from "@/src/domain/time";
import { NON_DANCE_EVIDENCE_REGEX, withoutNonDanceMentions } from "@/src/domain/evidence-noise";

export type NotAnEventKind =
  | "date_or_heading"
  | "closure"
  | "price_line"
  | "not_a_dance"
  | "boat_or_cruise"
  | "crawl_bus_or_happy_hour"
  | "not_dance_scope"
  | "wrong_weekday";

export interface NotAnEvent {
  kind: NotAnEventKind;
  /** Plain words for the run report. */
  reason: string;
}

const words = (list: string): ReadonlySet<string> => new Set(list.split(/\s+/).filter(Boolean));

/** Arabic words in their normalised form plus the prefixed forms Arabic glues on (D-1063). */
function arabicWords(list: string): string[] {
  const out = new Set<string>();
  for (const raw of list.split(/\s+/).filter(Boolean)) {
    const w = normalizeForMatch(raw);
    if (!w) continue;
    const bare = w.startsWith("ال") ? w.slice(2) : w;
    for (const p of ["", "و", "ب", "ل", "ف"]) out.add(p + bare);
    for (const p of ["ال", "وال", "بال", "فال", "لل"]) out.add(p + bare);
  }
  return [...out];
}

/** Build a regex for Arabic words/phrases that matches them with optional prefixes and Arabic letter boundaries (D-1063). */
function arabicRegex(list: readonly string[]): RegExp {
  const normalised = list.map(normalizeForMatch).filter(Boolean);
  // Sort longest first for proper matching
  const escaped = normalised
    .sort((a, b) => b.length - a.length)
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (escaped.length === 0) return /(?!)/; // never matches
  // Use Unicode letter lookarounds to avoid matching inside words
  const pattern = `(?<!\\p{L})(?:و|ف|ب|ل|ك)?(?:ال)?(?:${escaped.join("|")})(?!\\p{L})`;
  return new RegExp(pattern, "u");
}

const MONTHS = words(`
  january february march april may june july august september october november december
  jan feb mar apr jun jul aug sep sept oct nov dec`);

const WEEKDAYS = words(`
  monday tuesday wednesday thursday friday saturday sunday
  mondays tuesdays wednesdays thursdays fridays saturdays sundays
  mon tue tues wed thu thur thurs fri sat sun`);

const SEASONS = words("spring summer fall autumn winter");

/** Words a heading is made of beyond the dates themselves. */
const HEADING_WORDS = words(`
  upcoming schedule schedules calendar calendars date dates event events timetable
  monthly weekly season seasons month months week weeks weekend weekends year years
  today tonight tomorrow tba tbd soon`);

/** A heading may end with one of these ("... monthly dance schedule", "Upcoming Dance Dates"). */
const HEADING_NOUNS = words("schedule schedules calendar calendars dates timetable");

/** Words that join the others and say nothing on their own. */
const CONNECTORS = words(
  "the of and or for in on at to from through thru all our this next more" +
    // Arabic connectors (normalised forms without prefix expansion) (D-1063)
    " في من على إلى عن الحفل الفعالية",
);

/** Holidays a closure notice names ("Thanksgiving: no class", "Closed - Labor Day"). */
const HOLIDAYS = words(`
  holiday holidays thanksgiving christmas xmas easter halloween new eve labor labour memorial
  independence juneteenth day days`);

/** "closed for Thanksgiving", "closed on Christmas Day", "closed for the holidays" (D-888). */
const CLOSED_FOR_HOLIDAY =
  /\bclosed (?:for|on|over) (?:the )?(?:thanksgiving|christmas|xmas|easter|holidays?|new year s?)\b/;

/** What a "No ..." notice says is not on ("No class", "No classes this week", "No social"). */
const ACTIVITIES = words(`
  class classes lesson lessons social socials dance dances dancing practica practicas practice
  milonga milongas jam jams session sessions workshop workshops event events`);

/** Who is closed ("Studio closed", "We are closed", "The school will be closed"). */
const PLACES = words("studio school venue hall club ballroom office space center centre we");
/** Between the place and "closed": "is", "are", "will be", and "we're" read as "we re". */
const LINKS = words("is are re will be");

/** What may follow a closure ("... for the holiday", "... this week", "... - Labor Day"). */
const CLOSURE_TAIL = words("due over during until till reopening reopens");

/** Boat parties and cruises: the owner lists none (2026-10-18). */
const BOAT_WORDS = words(
  "boat boats yacht yachts cruise cruises barco barcos crucero cruceros yate yates lancha lanchas yatcht iate iates escuna escunas cruzeiro cruzeiros veleiro veleiros vaixell vaixells creuer creuers catamara catamaran catamarans golondrinas trajinera trajineras" +
    // Turkish (D-684): tekne boat, vapur ferry, gemi ship.
    " tekne teknesi teknede tekneler vapur vapuru vapurda gemi gemisi gemide" +
    // German (D-1021): boat compounds, schiff, dampfer (not "boot": Boot Scootin line dances; not "floss": a dance)
    " bootsfahrt bootsparty bootstour schiff schiffe schiffsparty partyschiff dampfer dampferfahrt dampferparty" +
    // Latin: dhow dhows (Dubai's dhow cruises)
    " dhow dhows" +
    // Arabic (D-1063)
    " " +
    arabicWords("يخت قارب سفينة").join(" ") +
    // French (D-1041): croisière, bateau-mouche
    " croisiere croisieres bateau-mouche bateaux-mouches",
);
/** Arabic boat phrase "رحلة بحرية" (sea trip) */
const BOAT_AR = arabicRegex(["رحلة بحرية"]);

/** Words that say a boat sails (D-1046): these stay dropped even at a moored barge. */
const SAILING_WORDS = words(
  "cruise cruises crucero cruceros cruzeiro cruzeiros croisiere croisieres creuer creuers sail sails sailing" +
    " bootsfahrt bootstour dampferfahrt",
);

/**
 * A barge moored as a venue (Paris péniches on the Seine, D-1046): its nights are not boat parties. A title names one
 * only by péniche, Marcounet, Concorde Atlantique, Bateau Phare or Annette K (Péniche Annette K., Paris); "barge" counts only in a venue's name, because a US
 * "Party Barge" is a pontoon boat that sails (Lake Travis, Nashville).
 */
/**
 * Moored barge venues by name (D-1046): one word, or two adjacent words. A new moored venue is one line here.
 * "peniche" is the French word for a barge; the others are Paris venues.
 */
export const MOORED_VENUE_NAMES: readonly (readonly [string] | readonly [string, string])[] = [
  ["peniche"],
  ["peniches"],
  ["marcounet"],
  ["concorde", "atlantique"],
  ["bateau", "phare"],
  ["annette", "k"], // Péniche Annette K., Paris (Salsa Vida's "Salsa Yacht Party at Annette K", 2026-11-07)
];

export function isMooredBarge(
  text: string | null | undefined,
  options: { venue?: boolean } = {},
): boolean {
  if (!text) return false;
  const tokens = normalizeForMatch(text.replace(/·/g, "")).split(" ").filter(Boolean);
  if (options.venue && tokens.some((t) => t === "barge" || t === "barges")) return true;
  return MOORED_VENUE_NAMES.some((name) =>
    name.length === 1 ? tokens.includes(name[0]) : hasPair(tokens, name[0], name[1]),
  );
}
/** Boat words that, followed by "club", name a night or a club rather than a boat (D-223). */
const BOAT_CLUB = words("boat yacht yate iate");
const CLUB_WORDS = words("club clubs clube clubes");

/** Bar crawls, party buses and happy hours: the owner lists none (2026-10-18). */
const CRAWL_WORDS = words(
  "crawl crawls cantinazo cantinazos" +
    // German (D-1021): kneipentour, barhopping, pubcrawl
    " kneipentour kneipentouren barhopping pubcrawl",
);
/** Spanish crawl phrase tokens */
const CRAWL_SPANISH = ["recorrido", "de", "bares"];
/** Mexican Spanish crawl phrase tokens */
const CRAWL_ES_MX = [
  ["ruta", "de", "cantinas"],
  ["tour", "de", "cantinas"],
];
/** Portuguese/Catalan crawl phrase tokens */
const CRAWL_PT_CA = [
  ["roteiro", "de", "bares"],
  ["tour", "de", "bares"],
  ["circuito", "de", "bares"],
  ["ruta", "de", "bars"],
  ["ruta", "de", "bares"],
];
/** German crawl phrase tokens (D-1021) */
const CRAWL_DE = [
  ["kneipen", "tour"],
  ["pub", "crawl"],
];
/** Spanish happy hour phrase tokens */
const HAPPY_HOUR_SPANISH = ["hora", "feliz"];
/** Catalan happy hour phrase tokens */
const HAPPY_HOUR_CATALAN = ["hora", "felic"];

/** Cancellation-only titles: "CANCELLED", "POSTPONED". */
const CANCEL_WORDS = words(
  "cancelled canceled cancellation cancelation postponed cancelado cancelada cancelados canceladas pospuesto pospuesta suspendido suspendida reprogramado reprogramada aplazado aplazada anulado anulada anulados anuladas adiado adiada adiados adiadas suspenso suspensa remarcado remarcada cancellat cancellada anullat anullada ajornat ajornada suspes suspesa" +
    " iptal ertelendi ertelenmistir edildi edilmistir" +
    // German (D-1021): abgesagt, entfällt, ausgefallen, verschoben, storniert. Not "verlegt" (moved: the night
    // still happens) and not "aus" alone (one of the commonest words): "fällt aus" is a pair below.
    " abgesagt abgesagte entfallt entfaellt ausgefallen verschoben storniert" +
    // Arabic (D-1063). "تم" ("was done") is a generic auxiliary: safe only because a cancellation-only
    // title needs every token to be a cancel word or a connector ("تم افتتاح نادي سالسا" is kept).
    " " +
    arabicWords("ملغى ملغي ملغاة ملغية إلغاء ألغيت ألغي تم مؤجل مؤجلة تأجيل أجلت").join(" ") +
    // French (D-1041): annulé, reporté
    " annule annulee annules annulees reporte reportee reportes reportees",
);
/** German "fällt aus" (is cancelled) as a pair of tokens (D-1021). */
const CANCEL_PAIRS_DE: readonly (readonly [string, string])[] = [
  ["fallt", "aus"],
  ["faellt", "aus"],
];

/**
 * Record fairs in French and German, DJs or not ("100 000 vinyles - 70 Vendeurs - 8 DJs", D-762), and in English
 * ("PARIS LOVES VINYL 17", the same fair's RA page; "Vinyl Market", "Record Swap", D-787).
 */
const RECORD_FAIR_FR_DE =
  /\b(?:vinyles|bourse aux disques|foire aux disques|plattenborse|schallplattenborse|loves vinyl|(?:vinyl|record|records) (?:market|markets|swap|swaps|sale|show))\b/;
/** Karaoke and record fairs: the owner lists none (2026-10-18). */
const KARAOKE_WORDS = words(
  "karaoke videoke videoque" +
    // Arabic (D-1063)
    " " +
    arabicWords("كاريوكي كاراوكي").join(" "),
);

/** Singles mixers: "solteros", "singles" (Mexico City, 2026-10-30). Kept beside a dance word or style. */
const SINGLES_WORDS = words("singles solteros solteras solteiros solteiras");
/** Speed dating: kept only beside a named dance style. */
const SPEED_DATING = [
  ["speed", "dating"],
  ["citas", "rapidas"],
  ["encontros", "rapidos"],
];
/** Words that make a singles title a dance night all the same. */
const SINGLES_DANCE_WORDS = words(
  "baile bailes bailar fiesta noche latina latin latino salsa bachata",
);

/** Explicit sex parties: the owner lists none (D-564). */
const SEX_PARTY_WORDS = words(
  "swinger swingers swingerclub gangbang orgy orgia orgias orgies anal libertino libertinos libertina libertinas",
);
/** Words that make a "Swingers" title a band billing (D-774). */
const BILLING_CUES = words("feat featuring ft");
/** Words after "swingers" that keep it a sex party even in a band-like title (D-774). */
const SEX_PARTY_FOLLOWERS = words("party parties club night nights");
/** Sex party token sequences. */
const SEX_PARTY_SEQUENCES = [
  ["sex", "party"],
  ["sex", "parties"],
  ["sexy", "party"],
  ["play", "party"],
  ["play", "parties"],
  ["gang", "bang"],
  ["sex", "club"],
  ["fiesta", "swinger"],
  ["intercambio", "de", "parejas"],
  ["troca", "de", "casais"],
  ["festa", "liberal"],
  ["fiesta", "liberal"],
];

/** Paint-and-sip nights that name no dance. */
const PAINT_SIP_WORDS_PAINT = words("paint painting paints stroke strokes canvas");
const PAINT_SIP_WORDS_PARTY = words("party night");
/** Dance words that keep a paint-and-sip title ("party" and "night" alone do not). */
const PAINT_SIP_DANCE_WORDS = words("dance dances dancing baile bailar danca danza dansa");

/** Games nights: board games, arcade, quiz, bingo, trivia (the owner lists none, 2026-10-28). Run-together
 * quiz names count ("BIG FAT QUIZBOX", Boxpark Wembley, 2026-10-29). */
const GAME_WORDS = words(
  "boardgame boardgames arcade arcades quiz quizzes quizbox quiznight quiznights pubquiz bingo trivia domino dominos dominoes mahjong escacs loteria tombala" +
    // German (D-1021): spieleabend, brettspiel, quizabend
    " spieleabend spielabend brettspiel brettspiele brettspielabend quizabend kneipenquiz spielenacht" +
    // Arabic (D-1063)
    " " +
    arabicWords("بينغو بنغو تريفيا").join(" ") +
    // French (D-1041): loto, belote
    " loto belote",
);
/** Portuguese/Catalan game phrases */
const GAME_PHRASES = [
  ["noite", "de", "jogos"],
  ["nit", "de", "jocs"],
  ["jogos", "de", "tabuleiro"],
  ["noite", "de", "quiz"],
  ["juegos", "de", "mesa"],
  ["noche", "de", "loteria"],
  ["bilgi", "yarismasi"],
  ["kutu", "oyunlari"],
  ["kutu", "oyunu"],
  ["oyun", "gecesi"],
  ["quiz", "gecesi"],
  // German (D-1021)
  ["quiz", "abend"],
  ["spiele", "abend"],
  // Arabic (D-1063)
  ["ليلة", "ألعاب"].map(normalizeForMatch) as [string, string],
  ["ألعاب", "لوحية"].map(normalizeForMatch) as [string, string],
  // French (D-1041): jeux de société, soirée jeux, blind test
  ["jeux", "de", "societe"],
  ["soiree", "jeux"],
  ["blind", "test"],
];

/** Children's parties: kid, child, toddler, tots (the owner lists none, 2026-10-28; "Raver Tots", 2026-10-29). */
const KID_WORDS = words(
  "kid kids child children childrens toddler toddlers tots infantil infantiles nino ninos nina ninas infantis crianca criancas miudos nens nenes canalla peques chiquitines pequeninos pequenos pequenas petizes bebes" +
    " cocuk cocuklar cocuklara cocuklarin cocuklu cocuklugu minikler" +
    // German (D-1021): kinder, kita, knirpse (not "kind": English "a different kind of party")
    " kinder kinderdisco kinderparty kinderfest kindertanz kita knirpse" +
    // Arabic (D-1063)
    " " +
    arabicWords("أطفال طفل الصغار ولاد أولاد").join(" ") +
    // French (D-1041): bambins; "enfants" only inside a program phrase (frenchKidProgram), because Paris venues
    // and nights carry it in their names ("Les Enfants du Canal", "Les Enfants Terribles").
    " bambins",
);
/** Party words for children's parties: party, disco, rave (the owner lists none, 2026-10-28). */
const KID_PARTY_WORDS = words(
  "party parties disco discos rave raves fiesta fiestas festa festas festinha" +
    " parti partisi partiler partileri" +
    // German (D-1021): fete, feier, disko, partys
    " fete feier disko partys" +
    // Arabic (D-1063)
    " " +
    arabicWords("حفلة حفله حفلات سهرة ديسكو").join(" ") +
    // French (D-1041): boum, fête
    " boum boums fete fetes",
);
/** Workshop words for children's workshops: oficina, workshop, taller (Lisbon, 2026-10-29). */
const KID_WORKSHOP_WORDS = words(
  "oficina oficinas workshop workshops taller talleres tallers" +
    " atolye atolyesi atolyeleri" +
    // German (D-1021): kurs, kurse, werkstatt
    " kurs kurse werkstatt" +
    // Arabic (D-1063)
    " " +
    arabicWords("ورشة ورش").join(" ") +
    // French (D-1041): atelier
    " atelier ateliers",
);
/** Dance words that make a children's title a class: "Danca para os Pequeninos" (Lisbon, 2026-10-29). */
const KID_DANCE_WORDS = words(
  "danca dance danza dansa baile" +
    " dans dansi" +
    // German (D-1021): tanz, tanzen, tanzkurs
    " tanz tanzen tanzkurs" +
    // Arabic (D-1063)
    " " +
    arabicWords("رقص").join(" ") +
    // French (D-1041): danse
    " danse",
);
/** Dance names that keep a "family" title (a dance group can call itself a family). */
const FAMILY_DANCE_WORDS = words(
  "salsa bachata swing lindy tango milonga kizomba zouk ceroc ballroom dance dancing" +
    // German (D-1021): tanz, tanzen
    " tanz tanzen",
);

/** Band billings: quartet, trio, orchestra etc. without a dance hint. */
const BAND_WORDS = words(
  "quartet quartets quintet quintets trio trios sextet septet octet orchestra",
);
const DANCE_HINTS = words(
  "dance dances dancing night nights party parties social socials milonga milongas practica practicas" +
    " gecesi geceleri partisi" +
    // German (D-1021): tanz, tanzabend, tanznacht, tanzparty, nacht, abend, fete
    " tanz tanzabend tanznacht tanzparty nacht abend fete" +
    // Arabic (D-1063)
    " " +
    arabicWords("سهرة ليلة حفلة").join(" ") +
    // French (D-1041): soirée, bal
    " soiree soirees bal bals",
);

/** ICLUB (booze-cruise promoter): the owner lists none (2026-10-17). */
const ICLUB_WORDS = words("iclub iclubnyc");

/** Haunted houses, mazes, hayrides etc.: the owner lists none (2026-10-18). */
const HAUNTED_PAIRS = words(
  "house houses mansion mansions maze mazes attraction attractions experience hayride hayrides trail trails",
);
/** Portuguese/Catalan haunted phrases */
const HAUNTED_PHRASES = [
  ["casa", "assombrada"],
  ["casa", "mal", "assombrada"],
  ["casa", "do", "terror"],
  ["casa", "del", "terror"],
];

/** Words that name a dance in a title (D-189; pt, ca: D-234; tr: D-684). "Afrolatina" names a mixed Afro-Latin social
 * (salsa, bachata, kizomba): a dance, but no one style (Lisbon read 40987863983). */
export const DANCE_WORDS_REGEX =
  /\b(dance|dances|dancing|dancer|dancers|baile|bailes|bailar|bailando|bailable|danza|danzas|ball|balls|ballada|ballades|ballar|ballem|danca|dancas|dancar|dancante|dancantes|bailarico|bailaricos|arraial|arraiais|santos populares|tardeada|tardeadas|bailongo|bailoteo|bailables|bailadores|afrolatina|afrolatinas|afrolatino|afrolatinos|afro latina|afro latino|dansi|danslari|dans gecesi|dans gecesine|dans partisi|dans dersi|dans dersleri|dans atolyesi|dans etmek|dans edelim|dans pisti|danse|danses|danser|dansant|dansante|dansants|dansantes|the dansant|piste de danse|bal|bals)\b/i;
/** German dance words (D-1021) */
export const DANCE_WORDS_DE_REGEX =
  /\b(tanz|tanze|tanzen|tanzt|tanzabend|tanzabende|tanznacht|tanzparty|tanzpartys|tanzflache|tanzkurs|tanzkurse|tanzschule|tanztee|tanzcafe|schwof|tanzball|abschlussball|tanz in den mai)\b/i;

/** Arabic dance words regex (D-1063) */
const DANCE_WORDS_AR = arabicRegex([
  "رقص",
  "الرقص",
  "رقصة",
  "رقصات",
  "دبكة",
  "سهرة رقص",
  "حفلة رقص",
  "ليلة رقص",
  "حلبة رقص",
]);

/** Seated-show words that make a dance title a seated performance (D-189). Talks (xerrada, palestra)
 * count, so a talk about a dance is not a dance (pt, ca: D-234). */
const SEATED_SHOW_REGEX =
  /\b(theater|theatre|recital|film|films|screening|premiere|company|performance|performances|presentation|presentations|concierto|conciertos|teatro|pelicula|peliculas|velada|comedia|stand up|standup|impro|open mic|show en vivo|gran show|tributo a|teatre|microteatre|espectacle|espectacles|circ|monoleg|havaneres|concert|concerts|concerto|concertos|peca de teatro|espetaculo|espetaculos|espectaculo|espectaculos|actuacao|atuacao|filme|sessao de cinema|cinema|sarau|lancamento do album|lancamento do disco|fado|fados|noite de fado|fado ao vivo|casa de fados|cena show|show de tango|cena con show|xerrada|xerrades|conferencia|conferencies|debat|debats|palestra|palestras|tertulia|tertulias|pastorela|pastorelas|obra de teatro|lucha libre|monologo|monologos|konser|konseri|konserleri|tiyatro|tiyatrosu|sinema|film gosterimi|gosterim|soylesi|soylesisi|konferans|imza gunu|spectacle|spectacles|projection|projections|piece de theatre|one man show|humour|vernissage|exposition|table ronde|conference|conferences)\b/i;
/** German seated-show words (D-1021) */
const SEATED_SHOW_DE_REGEX =
  /\b(konzert|konzerte|lesung|lesungen|vortrag|vortrage|kino|filmvorfuhrung|filmabend|auffuhrung|vorstellung|kabarett|theaterstuck|podiumsdiskussion|diskussion|vernissage|ausstellung|fuhrung|liederabend|poetry slam)\b/i;

/** Arabic seated show regex (D-1063) */
const SEATED_SHOW_LIST = [
  "مسرحية",
  "مسرح",
  "عرض مسرحي",
  "حفل موسيقي",
  "حفلة موسيقية",
  "أمسية شعرية",
  "ندوة",
  "محاضرة",
  "مؤتمر",
  "معرض",
  "فيلم",
  "أفلام",
  "سينما",
  "عرض سينمائي",
  "كوميديا",
  "ستاند أب",
  "ستاندب",
];
const SEATED_SHOW_AR = arabicRegex(SEATED_SHOW_LIST);
/** Arabic seated show regex without musical concert words (D-1063) */
const SEATED_NOT_MUSIC_AR = arabicRegex(SEATED_SHOW_LIST.filter((w) => !w.includes("موسيقي")));
/** Seated shows a dance-floor venue also hosts (D-341). Leaves out D-228's music-billing words
 * (concierto, show en vivo, gran show, tributo a) and company/performance/presentation: at such a
 * venue those are band nights people dance to. */
const SEATED_NOT_MUSIC_REGEX =
  /\b(theater|theatre|teatro|recital|film|films|screening|premiere|pelicula|peliculas|velada|comedia|comedy|stand up|standup|impro|open mic|teatre|microteatre|circ|monoleg|cinema|filme|sessao de cinema|peca de teatro|sarau|fado|fados|casa de fados|cena show|show de tango|xerrada|palestra|conferencia|tiyatro|tiyatrosu|sinema|film gosterimi|soylesi|konferans|projection|projections|piece de theatre|one man show|humour|vernissage|exposition|table ronde|conference|conferences)\b/i;
/** German seated-show words without konzert (D-1021) */
const SEATED_NOT_MUSIC_DE_REGEX =
  /\b(lesung|lesungen|vortrag|vortrage|kino|filmvorfuhrung|filmabend|auffuhrung|vorstellung|kabarett|theaterstuck|podiumsdiskussion|diskussion|vernissage|ausstellung|fuhrung|liederabend|poetry slam)\b/i;

/** A sound bath, gong bath, sound journey, meditation or breathwork session on a mixed calendar is
 * not a dance unless its title says dance (Aerial Relaxation Pods, Ecstatic Dance London, D-193).
 */
const WELLNESS_SESSION_REGEX =
  /\b(?:gong baths?|sound baths?|sound journeys?|sound healing|meditations?|breathwork|yoga nidra|meditacion|meditaciones|bano de sonido|banos de sonido|cacao ceremony|cacao ceremonies|kirtan|reflexiones espirituales|meditacio|meditacions|bany de so|banys de so|ioga|meditacao|meditacoes|banho de som|banhos de som|banho de gongo|cerimonia de cacau|cerimonia do cacau|tacas tibetanas|roda de cura|temazcal|temazcales|ceremonia de cacao|ceremonias de cacao|cantos al fuego|circulo de hombres|circulos de hombres|circulo de mujeres|circulos de mujeres|bain sonore|bains sonores|bain de gong|bains de gong|sophrologie|meditation guidee)\b/i;

const CLUB_STYLE_KEYS: ReadonlySet<string> = new Set(
  STYLES.filter((style) => style.family === "club").map((style) => style.key),
);

/** Whether a source's own styles name a dance that is not a club style: a dance organiser (D-590). */
function namesNonClubSourceStyle(styles: readonly string[]): boolean {
  return styles.some((key) => !CLUB_STYLE_KEYS.has(key));
}

/**
 * Screens talks, lectures, panels and workshops that name no dance (D-590).
 * Returns a NotAnEvent with kind "not_dance_scope" when the title matches talk/lecture/workshop words,
 * and the title names no dance style, no dance word, and sourceStyles contains no non-club dance style.
 */
export function screenTalkOrWorkshop(
  title: string,
  sourceStyles: readonly string[],
): NotAnEvent | null {
  const normalized = normalizeForMatch(title);
  // Check for talk/lecture/workshop words
  const talkWorkshopRegex =
    /\b(?:talks|artist talk|book talk|lecture|lectures|panel discussion|workshop|workshops)\b/;
  if (!talkWorkshopRegex.test(normalized)) {
    return null;
  }
  // Check if title names any dance style or family
  const matched = matchStyles(normalized);
  if (matched.styles.length > 0 || matched.families.length > 0) {
    return null;
  }
  // Check for dance words
  if (hasDanceWord(title)) {
    return null;
  }
  // Check for DANCE_HINTS tokens other than "night"/"nights"/"party"/"parties"
  const tokens = normalized.split(" ").filter(Boolean);
  const allowedHints = new Set(["night", "nights", "party", "parties"]);
  const hasOtherHint = tokens.some((t) => DANCE_HINTS.has(t) && !allowedHints.has(t));
  if (hasOtherHint) {
    return null;
  }
  if (namesNonClubSourceStyle(sourceStyles)) return null;
  return {
    kind: "not_dance_scope",
    reason: "a talk, lecture or workshop naming no dance (D-590)",
  };
}

/**
 * Language classes, craft classes and castings: never a dance, on any calendar (D-588; #1025 put them
 * in `screenNoDance`, which reads only mixed calendars). Matched on the normalized title.
 */
const LANGUAGE_CRAFT_CASTING =
  /\b(?:(?:adult |beginner |intermediate )?(?:english|italian|spanish|french|german|portuguese|japanese|chinese|mandarin|cantonese|arabic|hebrew|russian|korean|greek|turkish|hindi|catalan|yiddish) (?:lesson|lessons|class|classes|course|courses|conversation|conversation group)|(?:aula|aulas|clase|clases|classe|classes|curso|cursos|corso|corsi) (?:de |d |di )?(?:ingles|italiano|italia|espanhol|espanol|frances|alemao|aleman|portugues|angles|castella|catala|japones|chines|arabe)|crochet|knitting|knit night|sewing class|sewing classes|embroidery|pottery class|pottery classes|ceramics class|ceramics classes|model casting|casting call|open casting|audition|auditions|cours (?:de |d )?(?:francais|anglais|espagnol|italien|allemand|portugais|chinois|japonais|arabe)|atelier (?:tricot|couture|poterie|ceramique|broderie))\b/;
/** German language/craft/casting words (D-1021) */
const LANGUAGE_CRAFT_CASTING_DE =
  /\b(sprachkurs|deutschkurs|englischkurs|kochkurs|malkurs|topferkurs|nahkurs|casting|public viewing|kleidertausch|flohmarkt|buchclub|lesekreis)\b/;

/**
 * Watch and viewing parties, listening sessions, push-up challenges and bare status labels ("Open",
 * "Election Day"): never a dance, on any calendar, unless a dance style is named (D-589, NYC 11-03).
 */
const WATCH_LISTENING_CHALLENGE = new RegExp(
  "\\b(?:" +
    [
      // watch and viewing parties (en, es, pt, ca, tr)
      "watch party|watch parties|viewing party|viewing parties|ver el partido|ver o jogo|assistir ao jogo|veure el partit|mac izleme",
      // listening sessions (including misspelled "sess+ions?" for D-757)
      "listening session|listening sessions|listening party|listening parties|listening club|listening (?:and )?dialogue|deep listening|listening sess+ions?|listening experience|listening experiences|first listening",
      "sesion de escucha|sesiones de escucha|sessao de escuta|sessoes de escuta|sessio d escolta|escucha colectiva|dinleti",
      // music talk(s) for D-757
      "music talk|music talks",
      // election nights
      "noche electoral|noite eleitoral|nit electoral|secim gecesi",
      // challenges, book clubs, clothing swaps
      "push ?up challenge|push ?ups? challenge",
      "book club|club de lectura|clube do livro|clube de leitura|club de lectura|kitap kulubu",
      "clothing swap|clothes swap|intercambio de ropa|troca de roupa",
      // film festivals and screenings, comedy shows (seated shows on any calendar)
      "film festival|film fest|festival de cine|festival de cinema|community cinema|film screening|noche de cine",
      "comedy show|comedy night|stand ?up comedy|comedy presents|noche de comedia|show de comedia|noite de comedia",
      // D-748 (daily check 11-05): poetry readings, stand-up festivals, drag shows, solo piano gigs, cooking courses
      "poetry|poets|spoken word|poesia|poesie|comedy festival|comedy fest|festival de comedia",
      "drag shows?|drag dinner shows?|drag brunch(?:es)?|solo piano|hors d ?oeuvres|cooking class(?:es)?|cooking course",
      // French (D-1041): retransmission du match, club de lecture, vide-dressing
      "retransmission du match|diffusion du match|club de lecture|vide dressing|vide-dressing",
      // D-762 (daily check 11-06): piano-bar sets, comedy, shop pop-ups, bike
      // rides, drawing parties, makeovers, dinner shows and holiday notes
      "at the piano|piano party|piano parties|doing comedy|brand pop ?ups?|pop ?up shops?|pop ?up markets?",
      "cycling|bike rides?|bicycle rides?|drawing party|drawing parties|life drawing|drink and draw",
      "cambia de look|cambio de look|makeover|dinner shows?|cena espectaculo|remembrance day|remembrance sunday|armistice day|veterans day",
      // D-815 (daily check 11-09): a bar's drinks promo, board meetings, sports congresses
      "cocktail menus?|drinks? menus?|drink specials?|board of directors|board meetings?|congresso esportivo|congreso deportivo",
      // D-820 (daily check 11-09): religious ceremonies and rallies, a tribute act's concert, London Jazz Festival sets
      "pujas?|rally|rallies|ultimate [a-z0-9]+ tribute|tribute concerts?|london jazz festival",
      // D-838 (daily check 11-10): teas and tastings, fairs and markets, parks days, rugby, listening and
      // meditation sessions, launches, food festivals, wedding bands, saunas, blind tests, pianos, concerts
      "afternoon teas?|wine tastings?|beer tastings?|tasting sessions?|craft fairs?|christmas markets?|xmas markets?",
      "plant sales?|nature walks?|volunteer days?|autumn internationals|six nations|rugby",
      "album listening|drone listening|gong baths?|meditations?|talk circles?|apparel launch(?:es)?|jewelry week|jewellery week",
      "food festivals?|wedding bands?|social saunas?|sauna socials?|blind ?tests?|duell?ing pianos",
      "en concierto|em concerto|in concert|performing the music of|how to pay",
      // D-847 (London 11-10/11-11): casino tournaments and esports nights ("casino" alone is a salsa style)
      "slots? tournaments?|poker tournaments?|poker nights?|blackjack|roulette|e ?sports?|lan party|lan parties|[1-9]v[1-9]|fifa tournaments?|gaming tournaments?",
      // D-860 (daily check 11-11): flea markets, choir and band rehearsals, card-game nights, tech festivals
      "flea markets?|rehearsals?|card games?|commander casual|magic the gathering|ai festivals?",
      // D-883 (daily check 11-13): aerial silks and weekly film screenings (roller skating stays: D-815 keeps it)
      "acrobacias? en telas|telas? a[eé]reas?|aerial silks?|aerial hoops?|movie (?:mondays?|nights?|screenings?)",
      // D-886 (daily check 2026-11-16, RA): panels, listening events, swap markets, music theatre, string quartets,
      // dining experiences, synth workshops, vinyl and DJ masterclasses
      "panel talks?|panel discussions?|pre ?listening|listening events?|swap markets?|musiktheater|music theat(?:re|er)",
      "string quartets?|dining experiences?|circuit design|(?:vinyl|dj|production) masterclass(?:es)?",
      // D-888 (weekly review 2026-11-23, daily checks 11-18 to 11-22): markets and errands, services, gyms,
      // talks and visits, film cycles, tea ceremonies, juggling, ice skating, surf lessons, speed friending
      "farmers? markets?|food pantr(?:y|ies)|colheita de sangue|blood donations?|citizenship class(?:es)?",
      "bible stud(?:y|ies)|personal trainers?|group fitness|book launch(?:es)?|author events?|in conversation",
      "table ronde|visites? commentees?|visites? hors les murs|ciclo de cine|ciclo de cinema|documentales",
      "proyeccion (?:de )?pelicula|cine para escuelas|tea ceremon(?:y|ies)|juggling|ice skating|surf experiences?",
      "surf lessons?|speed friending|music appreciation|close reading",
      // D-889 (weekly review 2026-11-23): a pub's football screenings
      "premier league|champions league|europa league|nations championship|games? on (?:our|the) (?:big )?screens?",
      "live football|football screenings?|live sports? screenings?",
    ].join("|") +
    ")\\b",
);
// D-770 (the owner 2026-11-07, "keep DJ/party brunches"): a brunch, carvery, roast or sunset dinner is a meal unless its
// title also names a style, a dance word or a party word (Dubai "Bohemia Sunday Brunch", Havana "Brunch in Plaza
// Vieja"; London "House & Disco Bottomless Brunch" and "Ibiza Anthems Brunch" stay).
// D-888: supper clubs, themed and holiday dinners, set lunches, tasting menus, "Drink & Dine", "Dine à la carte".
const MEAL_TITLE =
  /\b(?:brunch(?:es)?|carvery|carveries|sunday roasts?|sunset dinners?|supper clubs?|themed dinners?|thanksgiving dinners?|social lunch(?:es)?|set lunch(?:es)?|tasting menus?|drink dine|dine a la carte)\b/;
const MEAL_PARTY_WORDS =
  /\b(?:party|parties|dj|djs|house|disco|club|clubbing|rave|anthems|electronik|electronic|[0-9]0s)\b/;
const STATUS_ONLY_TITLES = new Set([
  "open",
  "open now",
  "election day",
  "election night",
  "abierto",
  "aberto",
  "obert",
  "acik",
]);

/** Club names a fixture names on both sides of "vs" ("Arsenal vs Borussia Dortmund", "Packers vs Rams"): D-889. */
const TEAM_WORDS = words(`
  arsenal chelsea liverpool tottenham spurs everton newcastle united villa fulham brentford bournemouth brighton leeds
  sunderland burnley celtic rangers dortmund borussia bayern juventus napoli lazio psg atletico betis
  sporting benfica ajax psv feyenoord galatasaray fenerbahce besiktas boca flamengo fluminense botafogo
  corinthians palmeiras packers rams cowboys patriots dolphins steelers ravens vikings falcons commanders
  lakers knicks celtics warriors yankees mets dodgers`);

/** "X vs Y" where a club name stands on each side and nothing names a dance or a party (D-889). */
function isFixture(tokens: readonly string[]): boolean {
  const at = tokens.findIndex((t) => t === "vs" || t === "v");
  if (at <= 0 || at >= tokens.length - 1) return false;
  return (
    tokens.slice(0, at).some((t) => TEAM_WORDS.has(t)) &&
    tokens.slice(at + 1).some((t) => TEAM_WORDS.has(t))
  );
}

/** Music jam: "jam", "jams", "jam session", "jam sessions" but not dance jams or slow jams (R&B genre). */
const MUSIC_JAM_REGEX = /(?<!\bslow\s+)\b(?:jam|jams|jam session|jam sessions)\b/i;
/** Dance jam patterns: contact jam, cypher, open floor, freestyle session, swing jam (Barcelona, 2026-11-01),
 *  and jams that welcome dancers (coverage-90, 2026-11-02). */
const DANCE_JAM_REGEX =
  /\b(?:contact jam|swing jam|swing jams|jam de swing|cypher|cyphers|open floor|freestyle session|freestyle|dancers welcome|dancers are welcome|all dancers welcome|ballarins benvinguts|ballarines benvingudes|bailarines bienvenidos|bailarinas bienvenidas|bailarinos bem vindos|bailarinos bem-vindos)\b/i;

/** Party kinds that are dance nights on a mixed calendar (D-256, D-257); matched on the folded title; "DJ sets" too (D-288).
 *  D-865: disco within two words of a decade ("DISCO 80's", Tokyo MAHARAJA), disco classics, italo/nu disco; bare
 *  "disco" stays out (Spanish and Portuguese for an album). */
export const PARTY_KIND_REGEX =
  /\b(halloween|djs|dj sets?|pagode|roda de samba|sambinha|goth night|goth nights|darkwave|industrial night|industrial nights|disco(?: \w+){0,2} [0-9]0 ?s|[0-9]0 ?s(?: \w+){0,2} disco|disco classics|italo disco|nu disco)\b/;

/** Dance band kinds (D-342): brass band, zydeco, cajun, swamp pop, second line, swing band, dance band, party band. */
export const DANCE_BAND_KIND_REGEX =
  /\b(brass band|zydeco|cajun|swamp pop|second line|swing band|dance band|party band)\b/i;

/** Fitness class: pilates, yoga, barre, HIIT, bootcamp, spin class, etc. */
const FITNESS_CLASS_REGEX =
  /\b(?:pilates|yoga|barre|hiit|bootcamp|boot camp|bootcamps|spin class|spin classes|spinning|crossfit|ioga)\b/i;

/** Whether normalised text names a dance style or style family (`matchStyles`). */
function namesDanceStyle(text: string): boolean {
  const named = matchStyles(text);
  return named.styles.length > 0 || named.families.length > 0;
}

/**
 * Screens a title that names its weekly day (e.g., "Tango Mondays") when listed on a different weekday.
 * Returns a NotAnEvent with kind "wrong_weekday" if the title names exactly one weekday (plural or "every <day>")
 * and the nightDate's weekday differs; otherwise null.
 */
export function screenTitleWeekday(title: string, nightDate: string): NotAnEvent | null {
  // Validate nightDate format
  if (!/^\d{4}-\d{2}-\d{2}$/.test(nightDate)) return null;
  const nightDay = new Date(nightDate + "T12:00:00Z").getUTCDay(); // 0 = Sunday
  const normalized = normalizeForMatch(title);
  const tokens = normalized.split(" ").filter(Boolean);
  const weekdays = new Set<number>(); // 0 = Sunday ... 6 = Saturday
  const dayNames = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const pluralDayNames = dayNames.map((d) => d + "s"); // sundays ... saturdays

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i] ?? "";
    // Check plural weekday
    const pluralIdx = pluralDayNames.indexOf(token);
    if (pluralIdx !== -1) {
      weekdays.add(pluralIdx);
      continue;
    }
    // Check singular weekday preceded by "every"
    if (i > 0 && tokens[i - 1] === "every") {
      const singularIdx = dayNames.indexOf(token);
      if (singularIdx !== -1) {
        weekdays.add(singularIdx);
      }
    }
  }

  if (weekdays.size === 1) {
    const namedDay = [...weekdays][0] ?? nightDay;
    if (namedDay !== nightDay) {
      const names = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
      const dayName = names[namedDay] ?? "";
      const nightName = names[nightDay] ?? "";
      return {
        kind: "wrong_weekday",
        reason: `the title names its weekly day (${dayName}s) but it is listed on a ${nightName} (D-589)`,
      };
    }
  }
  return null;
}

/** Whether normalised text names a dance style that is NOT in the club family. */
function namesNonClubDanceStyle(text: string): boolean {
  const named = matchStyles(text);
  if (named.styles.length === 0 && named.families.length === 0) {
    return false;
  }
  // Build a set of club style keys from STYLES
  const clubStyleKeys = new Set<StyleKey>();
  for (const style of STYLES) {
    if (style.family === "club") {
      clubStyleKeys.add(style.key);
    }
  }
  // Check if any matched style is NOT in club family
  for (const styleKey of named.styles) {
    if (!clubStyleKeys.has(styleKey)) {
      return true;
    }
  }
  // Also check families: if any matched family is not "club", it's a non-club dance
  for (const familyKey of named.families) {
    if (familyKey !== "club") {
      return true;
    }
  }
  return false;
}

/** Helper: does tokens contain a followed directly by b (or b's plural with trailing s)? */
function hasPair(tokens: readonly string[], a: string, b: string): boolean {
  for (let i = 0; i < tokens.length - 1; i++) {
    if (tokens[i] === a) {
      const next = tokens[i + 1];
      if (next === b || next === b + "s" || next === b + "es") {
        return true;
      }
    }
  }
  return false;
}

/** Whether the whole folded title is a button label (tickets, more info, waiting list). */
export function isButtonLabel(title: string): boolean {
  // First try with "&" replaced by " and " because normalizeForMatch may turn "&" into a space.
  const withAnd = title.replace(/&/g, " and ");
  const folded = normalizeForMatch(withAnd).trim();
  if (folded === "") return false;
  const buttonLabels = new Set([
    // English
    "tickets",
    "ticket",
    "tickets and info",
    "tickets info",
    "tickets here",
    "tickets now",
    "buy tickets",
    "buy ticket",
    "buy tickets now",
    "get tickets",
    "book tickets",
    "book now",
    "book here",
    "join the waiting list",
    "join waiting list",
    "waiting list",
    "waitlist",
    "more info",
    "more information",
    "further info",
    "info",
    "find out more",
    "read more",
    "learn more",
    "sold out",
    "rsvp",
    "register",
    "register now",
    "sign up",
    "available on the door",
    "tickets on the door",
    "pay on the door",
    "on the door",
    // Spanish/Portuguese/Catalan
    "entradas",
    "comprar entradas",
    "compra tu entrada",
    "ingressos",
    "comprar ingressos",
    "compre seu ingresso",
    "mas info",
    "mas informacion",
    "mais info",
    "mais informacoes",
    "saiba mais",
    "ver mas",
    "ver mais",
    "reservar",
    "reserva",
    "reservas",
    "lista de espera",
    "esgotado",
    "agotado",
    "entrades",
    "comprar entrades",
    "mes info",
  ]);
  return buttonLabels.has(folded);
}

/** Whether a title matches one of the source's named dance nights (D-264). An entry ending in "*" is a
 * party's name that opens every dated title ("Polenta *" matches "Polenta 6 NOV en Niceto Club"): its
 * words must open the title, whole words only. */
export function isNamedDanceNight(
  title: string,
  danceNights: readonly string[] | undefined,
): boolean {
  if (!danceNights || danceNights.length === 0) return false;
  const normalizedTitle = normalizeForMatch(title).trim();
  if (normalizedTitle === "") return false;
  const titleTokens = normalizedTitle.split(/\s+/);
  for (const night of danceNights) {
    const isPrefix = night.trim().endsWith("*");
    const normalizedNight = normalizeForMatch(night.trim().replace(/\*$/, "")).trim();
    if (normalizedNight === "") continue;
    if (!isPrefix && normalizedNight === normalizedTitle) return true;
    if (isPrefix && normalizedNight.split(/\s+/).every((token, i) => titleTokens[i] === token))
      return true;
  }
  return false;
}

/** Helper: does tokens contain the consecutive sequence of words? */
/** A French children's program phrase (D-1041): "pour (les) enfants", "atelier enfants", "spectacle enfants",
 * "boum des enfants", "enfants de/des/dès <N> ans". The bare word names venues ("Les Enfants du Canal"). */
function frenchKidProgram(tokens: readonly string[]): boolean {
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t !== "enfant" && t !== "enfants") continue;
    const prev = tokens[i - 1];
    const prev2 = tokens[i - 2];
    if (prev === "pour" || prev === "atelier" || prev === "ateliers" || prev === "spectacle")
      return true;
    if (prev === "les" && prev2 === "pour") return true;
    if (prev === "des" && (prev2 === "boum" || prev2 === "fete")) return true;
    const next = tokens[i + 1];
    if (
      (next === "de" || next === "des") &&
      /^\d+$/.test(tokens[i + 2] ?? "") &&
      tokens[i + 3] === "ans"
    ) {
      return true;
    }
  }
  return false;
}

function hasSequence(tokens: readonly string[], sequence: readonly string[]): boolean {
  if (sequence.length === 0) return false;
  for (let i = 0; i <= tokens.length - sequence.length; i++) {
    let match = true;
    for (let j = 0; j < sequence.length; j++) {
      if (tokens[i + j] !== sequence[j]) {
        match = false;
        break;
      }
    }
    if (match) return true;
  }
  return false;
}

/** Who a price is for, in a price table ("Students & Young Adults 16–18 (Must Show ID) – $10"). */
const TIER_NOUNS = words(`
  student students adult adults child children kid kids youth teen teens senior seniors
  member members nonmember nonmembers general admission entry door advance presale
  ticket tickets price prices`);

/** What else a price table's line says about who pays: ages, proof, discounts, currencies. */
const TIER_WORDS = words(`
  young non early bird per person each must show valid with w id ids age ages under over only
  full time half discount discounted concession concessions reduced military veteran veterans
  usd eur gbp cad aud dollar dollars`);

/** An amount of money: "$10", "£5", "10 €", "15 EUR". */
const AMOUNT = /[$€£]\s?\d|\b\d[\d.,]*\s?(?:€|(?:eur|usd|gbp|dollars?)\b)/i;

function isNumberWord(token: string): boolean {
  // 2026, 1, 21st, 3rd, 9pm, 30pm (from "9:30pm"), am, pm
  return (
    /^\d+$/.test(token) ||
    /^\d{1,2}(?:st|nd|rd|th)$/.test(token) ||
    /^\d{1,2}(?:am|pm)$/.test(token) ||
    token === "am" ||
    token === "pm" ||
    token === "noon" ||
    token === "midnight"
  );
}

/** A word that names a date or a part of the calendar. */
function isDateWord(token: string): boolean {
  return MONTHS.has(token) || WEEKDAYS.has(token) || SEASONS.has(token) || isNumberWord(token);
}

function isTailWord(token: string): boolean {
  return (
    isDateWord(token) ||
    HEADING_WORDS.has(token) ||
    CONNECTORS.has(token) ||
    HOLIDAYS.has(token) ||
    CLOSURE_TAIL.has(token)
  );
}

/** Rule A: every word is a date, heading or joining word, and at least one is a date or heading. */
function isOnlyDateOrHeading(tokens: readonly string[]): boolean {
  return (
    tokens.every((t) => isDateWord(t) || HEADING_WORDS.has(t) || CONNECTORS.has(t)) &&
    tokens.some((t) => isDateWord(t) || HEADING_WORDS.has(t))
  );
}

/** Rule B: the title ends with a heading noun, after any dates that follow it ("Fall schedule 2026"). */
function endsWithHeadingNoun(tokens: readonly string[]): boolean {
  let end = tokens.length;
  while (end > 0 && (isDateWord(tokens[end - 1]!) || CONNECTORS.has(tokens[end - 1]!))) end -= 1;
  return end > 0 && HEADING_NOUNS.has(tokens[end - 1]!);
}

/**
 * "no class", "no classes or socials this week": "no", then activities, then a tail. A further
 * activity counts as not on only when "or", "and", "nor" or "no" comes right before it: in
 * "No Class - Practica" the practica is what is on, so the title may name an event.
 */
function isNoActivity(tokens: readonly string[]): boolean {
  if (tokens[0] !== "no" || !ACTIVITIES.has(tokens[1] ?? "")) return false;
  return tokens.slice(2).every((t, i) => {
    if (t === "no") return true;
    if (ACTIVITIES.has(t)) return ["or", "and", "nor", "no"].includes(tokens[i + 1]!);
    return isTailWord(t);
  });
}

/** What follows "closed": nothing, a date or holiday tail, or a "no ..." notice. */
function isClosureTail(tokens: readonly string[]): boolean {
  return tokens.every(isTailWord) || isNoActivity(tokens);
}

/** Check for "private event" pattern after "closed" */
function isPrivateEventClosure(tokens: readonly string[]): boolean {
  // Look for "private" followed by "event" or "events"
  for (let i = 0; i < tokens.length - 1; i++) {
    if (tokens[i] === "private") {
      const next = tokens[i + 1];
      if (next === "event" || next === "events") {
        // All other tokens must be connectors or "for"/"a"
        const otherTokens = tokens.filter((_, idx) => idx !== i && idx !== i + 1);
        return otherTokens.every((t) => CONNECTORS.has(t) || t === "for" || t === "a");
      }
    }
  }
  return false;
}

/** Rule C: a closure notice, after any leading dates or holidays ("Nov 26: studio closed"). */
function isClosure(all: readonly string[]): boolean {
  let start = 0;
  while (
    start < all.length &&
    (isDateWord(all[start]!) || HOLIDAYS.has(all[start]!) || CONNECTORS.has(all[start]!))
  )
    start += 1;
  const tokens = all.slice(start);
  if (tokens.length === 0) return false;
  if (isNoActivity(tokens)) return true;
  if (tokens[0] === "closed" || tokens[0] === "closure") {
    const rest = tokens.slice(1);
    if (isPrivateEventClosure(rest)) return true;
    return isClosureTail(rest);
  }
  // "Thanksgiving Break", "Winter break Dec 21 - Jan 3": a break after a holiday or season word.
  // "Spring Break Social" and "Break Dance Battle" name something after it, so they are kept.
  if (start > 0 && (tokens[0] === "break" || tokens[0] === "recess"))
    return isClosureTail(tokens.slice(1));
  if (PLACES.has(tokens[0]!)) {
    let i = 1;
    while (i < tokens.length && LINKS.has(tokens[i]!)) i += 1;
    if (tokens[i] === "closed" || (i === 1 && tokens[i] === "closure")) {
      return isClosureTail(tokens.slice(i + 1));
    }
  }
  return false;
}

/** "Soirée annulée": the French word for the evening may stand beside a cancellation word (D-1041). */
const CANCEL_NIGHT_WORDS = words("soiree soirees");

/** True when every token is a cancellation word or a connector, and at least one is a cancellation word. */
function isCancellationOnly(input: readonly string[]): boolean {
  let tokens = input;
  let pairCancel = false;
  for (const [a, b] of CANCEL_PAIRS_DE) {
    const i = tokens.findIndex((t, k) => t === a && tokens[k + 1] === b);
    if (i >= 0) {
      tokens = [...tokens.slice(0, i), ...tokens.slice(i + 2)];
      pairCancel = true;
    }
  }
  if (pairCancel) return tokens.every((t) => CANCEL_WORDS.has(t) || CONNECTORS.has(t));
  const hasCancel = tokens.some((t) => CANCEL_WORDS.has(t));
  const allAllowed = tokens.every(
    (t) => CANCEL_WORDS.has(t) || CONNECTORS.has(t) || CANCEL_NIGHT_WORDS.has(t),
  );
  return hasCancel && allAllowed;
}

/**
 * Rule D: a line of a price table ("Students & Young Adults 16–18 (Must Show ID) – $10",
 * "General – $20-25"): an amount, a word for who pays it, and nothing else. A single word outside
 * the tables ("Student Night – $5", "Members' Dance $10") keeps the listing.
 */
function isPriceLine(title: string, tokens: readonly string[]): boolean {
  return (
    AMOUNT.test(title) &&
    tokens.some((t) => TIER_NOUNS.has(t)) &&
    tokens.every(
      (t) =>
        TIER_NOUNS.has(t) ||
        TIER_WORDS.has(t) ||
        CONNECTORS.has(t) ||
        /^\d+$/.test(t) ||
        /^\d{1,2}(?:st|nd|rd|th)$/.test(t),
    )
  );
}

/**
 * Whether normalised text names a dance word (D-1063).
 */
export function hasDanceWord(text: string): boolean {
  const normalized = normalizeForMatch(text);
  return (
    DANCE_WORDS_REGEX.test(text) ||
    DANCE_WORDS_REGEX.test(normalized) ||
    DANCE_WORDS_DE_REGEX.test(text) ||
    DANCE_WORDS_DE_REGEX.test(normalized) ||
    DANCE_WORDS_AR.test(normalized) ||
    hasDanceWordJa(text)
  );
}

/** D-757: check if a listing is a billed live show before 10pm naming no dance */
function screenLiveShow(listing: {
  title: string;
  styles: readonly string[];
  startsAt: Date | null;
  endsAt?: Date | null;
  nightDate: string;
  tz: string;
}): NotAnEvent | null {
  const title = listing.title;
  const normalized = normalizeForMatch(title);
  const tokens = normalized.split(" ").filter(Boolean);

  // a. live-show marker detection
  const hasLiveMarker = (() => {
    // Check raw title for *live, live*, (live)
    if (/\*live\b/i.test(title) || /\blive\*/i.test(title) || /\(live\)/i.test(title)) {
      return true;
    }
    // Last word is "live"
    const lastWord = tokens[tokens.length - 1];
    if (lastWord === "live") {
      return true;
    }
    // "live at the"
    if (normalized.includes("live at the")) {
      return true;
    }
    // "world tour"
    if (normalized.includes("world tour")) {
      return true;
    }
    // "tour" followed by 4-digit year
    for (let i = 0; i < tokens.length - 1; i++) {
      if (tokens[i] === "tour" && /^\d{4}$/.test(tokens[i + 1] ?? "")) {
        return true;
      }
    }
    // "album release"
    if (normalized.includes("album release")) {
      return true;
    }
    // "in concert"
    if (normalized.includes("in concert")) {
      return true;
    }
    return false;
  })();

  if (!hasLiveMarker) {
    return null;
  }
  // Only a club listing (RA tags every row dj_night): a dance organiser's own "Friday Live" (salsa) is its dance.
  if (listing.styles.length === 0 || listing.styles.some((style) => style !== "dj_night"))
    return null;

  // b. startsAt not null and local hour before LATE_HOUR (22)
  if (listing.startsAt === null) {
    return null;
  }
  // Check if startsAt is before LATE_HOUR local time
  const lateCutoff = localInstant(listing.nightDate, listing.tz, LATE_HOUR, 0);
  if (listing.startsAt.getTime() >= lateCutoff.getTime()) {
    return null;
  }

  // c. no end, or an end at or before 00:30 local the morning after the night (a club night runs later)
  if (listing.endsAt !== null && listing.endsAt !== undefined) {
    const endCutoff = localInstant(addCalendarDays(listing.nightDate, 1), listing.tz, 0, 30);
    if (listing.endsAt.getTime() > endCutoff.getTime()) return null;
  }

  // d. title names no dance
  if (hasDanceWord(title)) {
    return null;
  }
  // Check DANCE_HINTS tokens
  if (tokens.some((t) => DANCE_HINTS.has(t))) {
    return null;
  }
  // Check matchStyles
  if (matchStyles(normalized).styles.length > 0) {
    return null;
  }

  return {
    kind: "not_a_dance",
    reason: "a billed live show before 10pm, naming no dance (D-757)",
  };
}

/**
 * Why a title names no event, or null when it may name one. Only the title is read: a title that
 * is only a date or a heading, or a closure notice, is not an event whatever else the row says.
 */
export function screenTitle(title: string, venueName?: string | null): NotAnEvent | null {
  // Remove middle dot used in Catalan (U+00B7) so that "cancel·lat" becomes "cancellat"
  const normalized = normalizeForMatch(title.replace(/·/g, ""));
  const tokens = normalized.split(" ").filter(Boolean);
  if (tokens.length === 0) return null;
  // Chinese titles have no word spaces: their screens match substrings (D-664).
  const han = screenTitleHan(title, isMooredBarge(venueName, { venue: true }));
  if (han) return han;
  // Japanese titles (kana or kanji) match substrings too (D-1224).
  const ja = screenTitleJa(title);
  if (ja) return ja;
  // Punjabi (Gurmukhi) titles (D-1141).
  const pa = screenTitlePa(title);
  if (pa) return pa;
  if (isClosure(tokens)) return { kind: "closure", reason: "a closure notice" };
  // "CLOSED FOR THANKSGIVING DADA", "NO CONTRA Hancock closed for Thanksgiving": a holiday closure anywhere in the
  // title, after a venue or a style name too (D-888).
  if (CLOSED_FOR_HOLIDAY.test(normalized))
    return { kind: "closure", reason: "a holiday closure notice (D-888)" };
  // Bill-payment SEO spam posted to RA as club nights (D-857).
  const spam = screenBillSpam(title);
  if (spam) return spam;
  // "THE PRACTICA GUIDE FOR TODAY IS N/A": a placeholder row, whatever style it names (D-815).
  if (isPlaceholderTitle(title))
    return { kind: "closure", reason: "a placeholder row that names no event (D-815)" };
  // Language and craft classes and castings, unless the title names a dance style ("Salsa & Spanish
  // Classes" stays) (D-588).
  if (
    (LANGUAGE_CRAFT_CASTING.test(normalized) || LANGUAGE_CRAFT_CASTING_DE.test(normalized)) &&
    matchStyles(normalized).styles.length === 0
  ) {
    return {
      kind: "not_dance_scope",
      reason: "a language or craft class or a casting, not a dance (D-588)",
    };
  }
  if (
    (WATCH_LISTENING_CHALLENGE.test(normalized) || STATUS_ONLY_TITLES.has(normalized)) &&
    matchStyles(normalized).styles.length === 0 &&
    !hasDanceWord(normalized)
  ) {
    return {
      kind: "not_dance_scope",
      reason:
        "a watch party, listening session, show, fair, outing or status label, not a dance (D-589, D-762)",
    };
  }
  if (
    isFixture(tokens) &&
    !MEAL_PARTY_WORDS.test(normalized) &&
    matchStyles(normalized).styles.length === 0 &&
    !hasDanceWord(normalized)
  ) {
    return { kind: "not_dance_scope", reason: "a sports fixture on a screen, not a dance (D-889)" };
  }
  if (
    MEAL_TITLE.test(normalized) &&
    // "club" in "supper club" names the meal, not a club night (D-888).
    !MEAL_PARTY_WORDS.test(normalized.replace(/\bsupper clubs?\b/g, " ")) &&
    matchStyles(normalized).styles.length === 0 &&
    !hasDanceWord(normalized)
  ) {
    return { kind: "not_dance_scope", reason: "a brunch or meal, not a dance (D-770)" };
  }
  // Boat parties and cruises: the owner lists none (2026-10-18). A "Boat Club" or "Yacht Club" names a
  // night or a club, not a boat ("BOAT CLUB HALLOWEEN" at 93 Feet East, D-223).
  // A night at a moored barge venue is listed (D-1046, owner 2026-11-07); a title that sails or cruises is still dropped.
  const hasBoatWord = tokens.some(
    (t, i) => BOAT_WORDS.has(t) && !(BOAT_CLUB.has(t) && CLUB_WORDS.has(tokens[i + 1] ?? "")),
  );
  const hasBoatAr = BOAT_AR.test(normalized);
  const hasBateauMouche =
    hasPair(tokens, "bateau", "mouche") || hasPair(tokens, "bateaux", "mouches");
  const hasSailingWord = tokens.some((t) => SAILING_WORDS.has(t));
  if (hasBoatWord || hasBoatAr || hasBateauMouche) {
    const moored =
      (isMooredBarge(title) || isMooredBarge(venueName, { venue: true })) &&
      !hasSailingWord &&
      !hasBoatAr &&
      !hasBateauMouche;
    if (!moored) {
      return {
        kind: "boat_or_cruise",
        reason: "a boat party or cruise (the owner lists none, 2026-10-18)",
      };
    }
  }
  // Bar crawls, party buses and happy hours: the owner lists none (2026-10-18).
  // A happy hour beside a named dance stays ("Salsa Groove: Dance Class & Happy Hour", SOB's).
  const happyHourOnly =
    (hasPair(tokens, "happy", "hour") ||
      hasSequence(tokens, HAPPY_HOUR_SPANISH) ||
      hasSequence(tokens, HAPPY_HOUR_CATALAN)) &&
    !tokens.some(
      (t) =>
        DANCE_HINTS.has(t) ||
        t === "class" ||
        t === "classes" ||
        t === "lesson" ||
        t === "fiesta" ||
        t === "baile" ||
        t === "clase" ||
        t === "clases" ||
        t === "noche",
    );
  const hasCrawl =
    tokens.some((t) => CRAWL_WORDS.has(t)) ||
    hasSequence(tokens, CRAWL_SPANISH) ||
    CRAWL_ES_MX.some((seq) => hasSequence(tokens, seq)) ||
    CRAWL_PT_CA.some((seq) => hasSequence(tokens, seq)) ||
    CRAWL_DE.some((seq) => hasSequence(tokens, seq));
  // "Party bus", "bus party" and "a party on a moving bus" (London RA, run 41157882789).
  const partyBus =
    hasPair(tokens, "party", "bus") ||
    hasPair(tokens, "bus", "party") ||
    hasPair(tokens, "moving", "bus");
  if (hasCrawl || partyBus || happyHourOnly) {
    return {
      kind: "crawl_bus_or_happy_hour",
      reason: "a bar crawl, party bus or happy hour (the owner lists none, 2026-10-18)",
    };
  }

  // Cancellation-only titles (after the existing closure check).
  if (isCancellationOnly(tokens)) {
    return { kind: "closure", reason: "a cancellation notice that names no event" };
  }

  // Karaoke and record fairs. Karaoke beside a named dance style stays ("Bachata & Karaoke Social", Mexico City, D-278).
  // But a club music genre (family "club") does not save karaoke ("Emo Night Karaoke").
  if (tokens.some((t) => KARAOKE_WORDS.has(t)) && !namesNonClubDanceStyle(normalized)) {
    return {
      kind: "not_dance_scope",
      reason: "karaoke or a record fair (the owner lists none, 2026-10-18)",
    };
  }
  if (
    hasPair(tokens, "record", "fair") ||
    hasPair(tokens, "record", "fairs") ||
    RECORD_FAIR_FR_DE.test(normalized)
  ) {
    return {
      kind: "not_dance_scope",
      reason: "karaoke or a record fair (the owner lists none, 2026-10-18)",
    };
  }

  // Singles mixers and speed dating: no dance named (Mexico City, 2026-10-30). "La Noche Latina - para solteros"
  // is a salsa night and stays.
  const speedDating = SPEED_DATING.some((seq) => hasSequence(tokens, seq));
  const singles = tokens.some((t) => SINGLES_WORDS.has(t));
  if (
    (speedDating && !namesDanceStyle(normalized)) ||
    (singles &&
      !speedDating &&
      !namesDanceStyle(normalized) &&
      !tokens.some((t) => DANCE_HINTS.has(t) || SINGLES_DANCE_WORDS.has(t)))
  ) {
    return {
      kind: "not_dance_scope",
      reason: "a singles mixer or speed dating that names no dance",
    };
  }

  // Explicit sex parties: the owner lists none (D-564).
  // A band named "... Swingers" is not a sex party (Austin 11-07, "Twisted Swingers feat. Alice Spencer",
  // "Kermit Ruffins & the BBQ Swingers", D-774): a billing cue (feat/featuring/ft) or "the" just before the
  // word makes it a name, unless a party word follows it ("The Swingers Party").
  const billing = tokens.some((t) => BILLING_CUES.has(t));
  const hasSexPartyWord = tokens.some(
    (t, i) =>
      SEX_PARTY_WORDS.has(t) &&
      !(
        (t === "swinger" || t === "swingers") &&
        (billing || tokens[i - 1] === "the" || tokens[i - 2] === "the") &&
        !SEX_PARTY_FOLLOWERS.has(tokens[i + 1] ?? "")
      ),
  );
  const hasSexPartySequence = SEX_PARTY_SEQUENCES.some((seq) => hasSequence(tokens, seq));
  if (hasSexPartyWord || hasSexPartySequence) {
    return {
      kind: "not_dance_scope",
      reason: "an explicit sex party (the owner lists none, D-564)",
    };
  }

  // Paint-and-sip nights that name no dance.
  const hasSip = tokens.includes("sip");
  const hasPaintWord = tokens.some((t) => PAINT_SIP_WORDS_PAINT.has(t));
  const hasPaintPartyWord = tokens.some((t) => PAINT_SIP_WORDS_PARTY.has(t));
  const hasPaint = tokens.some((t) => t === "paint" || t === "painting");
  const isPaintAndSip = (hasSip && hasPaintWord) || (hasPaint && hasPaintPartyWord);
  if (
    isPaintAndSip &&
    !namesDanceStyle(normalized) &&
    !tokens.some((t) => PAINT_SIP_DANCE_WORDS.has(t))
  ) {
    return {
      kind: "not_dance_scope",
      reason: "a paint-and-sip night that names no dance",
    };
  }

  // Games nights: board games, arcade, quiz, bingo, trivia (the owner lists none, 2026-10-28).
  // Exception: "domino" followed by "park" is a place (Domino Park) and not a game word, and a possessive
  // "Domino's" is a name (Austin 11-07, "Floyd Domino's All Stars", D-774).
  const hasGameWord = tokens.some(
    (t, i) =>
      GAME_WORDS.has(t) && !(t === "domino" && (tokens[i + 1] === "park" || tokens[i + 1] === "s")),
  );
  const hasGamePhrase = GAME_PHRASES.some((seq) => hasSequence(tokens, seq));
  const isGameNight =
    hasGameWord ||
    hasGamePhrase ||
    hasPair(tokens, "board", "game") ||
    hasPair(tokens, "game", "night") ||
    hasPair(tokens, "games", "night");
  if (isGameNight) {
    return {
      kind: "not_dance_scope",
      reason: "a games night (the owner lists none, 2026-10-28)",
    };
  }

  // Children's parties: kid, child, toddler with party/disco/rave (the owner lists none, 2026-10-28).
  // "family" also counts as a kid word only when the title names no dance ("Swing Family Halloween Party"
  // stays). The party words are left out of the style match: "disco" is a style.
  const familyDance = (): boolean =>
    tokens.some((t) => FAMILY_DANCE_WORDS.has(t)) ||
    matchStyles(tokens.filter((t) => !KID_PARTY_WORDS.has(t)).join(" ")).styles.length > 0;
  const hasKidWord =
    tokens.some((t) => KID_WORDS.has(t)) ||
    frenchKidProgram(tokens) ||
    (tokens.includes("family") && !familyDance());
  const hasKidPartyWord = tokens.some((t) => KID_PARTY_WORDS.has(t));
  const hasKidWorkshopWord = tokens.some((t) => KID_WORKSHOP_WORDS.has(t));
  const hasKidDanceWord = tokens.some((t) => KID_DANCE_WORDS.has(t));
  // "Danca criativa" (creative dance) is a children's class (Lisbon, 2026-10-29).
  const creativeDance = /\b(danca|dansa|danza) (criativa|creativa)\b/.test(tokens.join(" "));
  if (hasKidWord && hasKidPartyWord) {
    return {
      kind: "not_dance_scope",
      reason: "a children's party (the owner lists none, 2026-10-28)",
    };
  }
  if (creativeDance || (hasKidWord && (hasKidWorkshopWord || hasKidDanceWord))) {
    return {
      kind: "not_dance_scope",
      reason: "a children's workshop (the owner lists none, 2026-10-29)",
    };
  }

  // D-570, D-571: Sport, children's program, dance show checks (owner, 2026-11-02)
  // B. Children's program
  const KID_PROGRAM_WORDS = words("teen teens youth juvenil juveniles adolescente adolescentes");
  // A DJ line-up's names are not kid or sport words ("DJ Tennis", "Junkie Kid", "Nina Yamada").
  const namesDjs = tokens.some((t) => t === "dj" || t === "djs");
  // Singular kid words that are often names ("Kid Chocolate", "Nina Yamada") do not mark a program.
  const NAME_LIKE_KID_WORDS = new Set(["kid", "nina", "nino", "nena", "nene"]);
  const isKidProgram = (): boolean => {
    if (frenchKidProgram(tokens)) return true;
    // 1. Kid word with exceptions
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      if (
        !namesDjs &&
        !NAME_LIKE_KID_WORDS.has(token!) &&
        (KID_WORDS.has(token!) || KID_PROGRAM_WORDS.has(token!))
      ) {
        // Check next token for exceptions
        const nextToken = tokens[i + 1];
        const prevToken = tokens[i - 1];
        const exceptionNext =
          nextToken && ["welcome", "friendly", "free", "under", "eat", "eats"].includes(nextToken);
        const exceptionPrev = prevToken && ["with", "bring"].includes(prevToken);
        if (!exceptionNext && !exceptionPrev) {
          return true;
        }
      }
    }
    // 2. Age under 18 pattern
    for (let i = 0; i < tokens.length - 1; i++) {
      if (["age", "ages", "edad", "edades", "idade", "idades", "yas"].includes(tokens[i]!)) {
        const nextToken = tokens[i + 1];
        // Parse number token
        if (nextToken && /^\d+(\.\d+)?$/.test(nextToken)) {
          const num = parseFloat(nextToken);
          if (num < 18) {
            return true;
          }
        }
      }
    }
    // 3. A number under 18, or a range of two ("12-18 months" is tokens 12 18 months), then months,
    // or years old ("3-5 year olds").
    const isNumber = (t: string | undefined) => t !== undefined && /^\d+$/.test(t);
    for (let i = 0; i < tokens.length; i++) {
      if (!isNumber(tokens[i]) || Number(tokens[i]) >= 18) continue;
      let j = i + 1;
      if (isNumber(tokens[j])) j++;
      const unit = tokens[j];
      if (unit && ["months", "meses", "mesos", "month", "mes"].includes(unit)) return true;
      if (
        unit &&
        ["year", "years", "yr", "yrs", "ano", "anos"].includes(unit) &&
        ["old", "olds"].includes(tokens[j + 1] ?? "")
      ) {
        return true;
      }
    }
    return false;
  };
  if (isKidProgram()) {
    return {
      kind: "not_dance_scope",
      reason: "a children's program (the owner lists none, D-571)",
    };
  }

  // A. Sport
  const SPORT_WORDS = words(
    "basketball baloncesto basquete basquetebol soccer futbol futebol futsal football volleyball voleibol volei tennis tenis pickleball padel swim swimming natacion natacao gymnastics gimnasia ginastica tumbling tumblers karate judo taekwondo jiujitsu chess ajedrez xadrez hockey baseball softball golf cricket rugby lacrosse basketbol futbolu yuzme satranc",
  );
  const hasSportWord =
    tokens.some((t) => SPORT_WORDS.has(t)) ||
    hasSequence(tokens, ["martial", "arts"]) ||
    hasSequence(tokens, ["jiu", "jitsu"]);
  if (hasSportWord && !namesDjs) {
    const hasDanceWordCheck = hasDanceWord(title);
    const hasStyle = matchStyles(normalized).styles.length > 0;
    if (!hasDanceWordCheck && !hasStyle) {
      return {
        kind: "not_dance_scope",
        reason: "a sport, not a dance (D-571)",
      };
    }
  }

  // C. Dance show
  const SHOW_WORDS = words(
    "performance performances presentation presentations recital recitals theater theatre premiere screening espectaculo espectaculos espetaculo espetaculos espectacle espectacles teatro teatre presentacion presentacio apresentacao" +
      // French (D-1041)
      " spectacle spectacles representation representations projection projections",
  );
  const JOIN_WORDS = words(
    "afterparty afterparties series team teams social socials party parties class classes lesson lessons workshop workshops night nights milonga milongas practica practicas pratica praticas clase clases aula aulas taller talleres noche noches noite noites nit festa festas fiesta fiestas baile bailes bal ball jam jams dancing floor gecesi partisi" +
      // French (D-1041)
      " soiree soirees bals cours",
  );
  const hasShowWord = tokens.some((t) => SHOW_WORDS.has(t));
  // A second line is a dance parade people join (New Orleans).
  const hasJoinWord =
    tokens.some((t) => JOIN_WORDS.has(t)) || hasSequence(tokens, ["second", "line"]);
  if (hasShowWord && !hasJoinWord) {
    return {
      kind: "not_dance_scope",
      reason: "a dance show, not a dance people join (D-570)",
    };
  }

  // ICLUB (booze-cruise promoter).
  if (tokens.some((t) => ICLUB_WORDS.has(t))) {
    return {
      kind: "not_dance_scope",
      reason: "an ICLUB party (booze cruises; the owner lists none, 2026-10-17)",
    };
  }

  // Haunted houses, mazes, hayrides etc.: the owner lists none (2026-10-18).
  // Keep if the title also names a dance event or class.
  const hasHauntedPair = (() => {
    for (let i = 0; i < tokens.length - 1; i++) {
      if (tokens[i] === "haunted" && HAUNTED_PAIRS.has(tokens[i + 1]!)) {
        return true;
      }
    }
    return false;
  })();
  const hasSpanishHaunted = (() => {
    // Check for "casa embrujada" or "casa del terror" or "casa de terror"
    for (let i = 0; i < tokens.length - 1; i++) {
      if (tokens[i] === "casa") {
        const next = tokens[i + 1];
        if (next === "embrujada" || next === "embrujadas") {
          return true;
        }
        if (i + 2 < tokens.length) {
          const twoWord = tokens[i + 1] + " " + tokens[i + 2];
          if (twoWord === "del terror" || twoWord === "de terror") {
            return true;
          }
        }
      }
    }
    return false;
  })();
  const hasPortugueseCatalanHaunted = HAUNTED_PHRASES.some((seq) => hasSequence(tokens, seq));
  if (hasHauntedPair || hasSpanishHaunted || hasPortugueseCatalanHaunted) {
    const danceWords = new Set([
      ...DANCE_HINTS,
      "class",
      "classes",
      "lesson",
      "salsa",
      "bachata",
      "swing",
      "tango",
      "zouk",
      "kizomba",
      "lindy",
      "baile",
      "clase",
    ]);
    if (!tokens.some((t) => danceWords.has(t))) {
      return {
        kind: "not_dance_scope",
        reason: "a haunted house (the owner lists none, 2026-10-18)",
      };
    }
  }

  // Button labels (tickets, more info, waiting list) are not events.
  if (isButtonLabel(title)) {
    return {
      kind: "date_or_heading",
      reason: "a button's label (tickets, more info, waiting list), not an event",
    };
  }
  if (isPriceLine(title, tokens)) return { kind: "price_line", reason: "a line of a price table" };
  if (isOnlyDateOrHeading(tokens) || endsWithHeadingNoun(tokens)) {
    return { kind: "date_or_heading", reason: "only a date or a heading" };
  }
  return null;
}

/** True when the title names no event (see `screenTitle`). */
export function isNotAnEvent(title: string): boolean {
  return screenTitle(title) !== null;
}

/**
 * A band's concert billing ("PEDRO GIRAUDO TANGO QUARTET"): a band word, no dance word, and no kind of
 * night in the title. Also "A + B" billings (two or more names joined by " + ") when they name no dance.
 * Screened on mixed calendars only (screenNoDance): on a dance source a trio or an
 * orchestra plays for dancers ("Swing Remix with the George Gee Orchestra", D-082's test).
 */
function isBandBilling(title: string): boolean {
  const tokens = normalizeForMatch(title).split(" ").filter(Boolean);
  const normalizedTitle = normalizeForMatch(title);
  // Original band-word logic
  if (!tokens.some((t) => BAND_WORDS.has(t))) return false;
  if (tokens.some((t) => DANCE_HINTS.has(t))) return false;
  return listingTypeFromText(title, null, matchStyles(normalizedTitle).styles).type === "other";
}

/** An orchestra billed with its conductor ("Orquesta del Tango ... / Dirección: ..."), D-861. */
const CONDUCTED_ORCHESTRA =
  /\b(?:orquesta|orquestra|orchestra)\b.*\b(?:direccion|directora?|conductor|regencia)\b|\b(?:direccion|directora?|conductor|regencia)\b.*\b(?:orquesta|orquestra|orchestra)\b/;
function isConductedOrchestra(title: string): boolean {
  const n = normalizeForMatch(title);
  if (!CONDUCTED_ORCHESTRA.test(n)) return false;
  return !n.split(" ").some((t) => DANCE_HINTS.has(t) || t === "baile" || t === "bailes");
}

/** Concert billing patterns that name no dance: a band name, a "//" double bill,
 * "Live in <place> <year>" tour title, or "<style> Meets Jazz". */
function isConcertBilling(title: string): boolean {
  const normalized = normalizeForMatch(title);
  const tokens = normalized.split(" ").filter(Boolean);
  // Must have no dance hints and no dance words
  if (tokens.some((t) => DANCE_HINTS.has(t))) return false;
  if (hasDanceWord(title)) return false;
  // Dance band kinds are not concert billings
  if (DANCE_BAND_KIND_REGEX.test(title) || DANCE_BAND_KIND_REGEX.test(normalized)) return false;
  // Check patterns
  const lastToken = tokens[tokens.length - 1];
  if (lastToken === "band" || lastToken === "bands") return true;
  if (title.includes(" // ")) return true;
  if (/\blive in [a-z]+(?: [a-z]+)? \d{4}\b/.test(normalized)) return true;
  if (/\bmeets jazz\b/.test(normalized)) return true;
  return false;
}

/** Club hours: a night on a venue's calendar that starts at 10pm or later may be a party. */
export const LATE_HOUR = 22;
/** A comedy show or open mic is seated at any hour: club hours do not keep it (D-862). */
const LATE_COMEDY = /\b(?:comedy|comedia|comedie|stand ?up|open mic|open mike)\b/;

/** A source's venue-calendar flags (`SeedSource.mixedCalendar`, `bandsForDancers`, D-341, D-322). */
export interface VenueCalendarFlags {
  mixedCalendar?: boolean;
  bandsForDancers?: boolean;
  bandsForDancersFrom?: string;
  danceBandKinds?: boolean;
  /**
   * A start at 10pm or later names a party, not a show (the default). False for a directory's rows
   * at venues that are not dance floors (WWOZ, D-342): late shows there are concerts.
   */
  lateNightKeep?: boolean;
  styles?: readonly string[];
  /**
   * Titles of this venue's own dance nights that name no dance (`SeedSource.danceNights`, D-264).
   */
  danceNights?: readonly string[];
  /** Titles the metro lead checked as not dance nights (`SeedSource.notDanceNights`). */
  notDanceNights?: readonly string[];
}

const HH_MM = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * Whether a listing's bands play for dancers (D-341): the source says so and, with
 * `bandsForDancersFrom` ("HH:MM"), the listing starts at or after that time on its night (D-322:
 * Ball & Chain's noon trio and 6pm jazz sets are not, its 8pm salsa bands are). The night, not the
 * calendar date, so a 1am start counts after "19:00". An untimed listing does not count when a
 * cut-off is set; a malformed cut-off is ignored, so it never screens anything new.
 */
export function bandsForDancersAt(
  source: Pick<VenueCalendarFlags, "bandsForDancers" | "bandsForDancersFrom">,
  at: { startsAt: Date | null; nightDate: string; tz: string },
): boolean {
  if (source.bandsForDancers !== true) return false;
  const from =
    source.bandsForDancersFrom === undefined ? null : HH_MM.exec(source.bandsForDancersFrom);
  if (!from) return true;
  if (!at.startsAt) return false;
  const cutoff = localInstant(at.nightDate, at.tz, Number(from[1]), Number(from[2]));
  return at.startsAt.getTime() >= cutoff.getTime();
}

/**
 * A listing on a venue's whole calendar (a `mixedCalendar` source: SOB's lists concerts, talks and
 * a games night beside its dance nights) that names no dance: no style from the listing, its title
 * or its source, no kind of dance night (`other`), and a start before 10pm. "Chow Lee Album Release
 * Show" at 7pm is a concert. A night that names any dance, any kind ("party", "class", "live band"),
 * or starts late ("POLENTA", 11pm) is kept, and so is one with no time: nobody said it is a show.
 * A title that says dance, dances, dancing, dancer or dancers (unless it also names a seated show)
 * names a dance (D-189). On any other source every listing is a dance: the page is a dance studio's,
 * a dance organiser's or a dance directory's.
 *
 * The kind must be named in the listing's own title. A model read of a whole venue page types a
 * concert "social" as readily as a dance (Le Poisson Rouge's "Blake Allen's The Ceiling", 6:30pm,
 * run of 2026-10-05), so the stated type is no evidence of dancing here.
 *
 * A style the title does not name (the model's or the source's tag) is not evidence of dancing on a
 * mixed calendar (D-237): Underground Arts' concerts tagged hip-hop, a haunted house on a
 * salsa-tagged venue's calendar (2026-10-18). A style counts when the title or the listing's
 * evidence quote names it.
 *
 * A dance-floor venue whose bands play for dancers (D-341, New Orleans' band bars) opts in with
 * `bandsForDancers`: on its whole calendar a band billing that names no dance is live music with
 * dancing, not a concert, and seated shows (theater, film, recital) are screened out. With
 * `bandsForDancersFrom`, only from that time on its night (D-322).
 */
export function screenNoDance(
  listing: {
    title: string;
    styles: readonly string[];
    startsAt: Date | null;
    endsAt?: Date | null;
    nightDate: string;
    tz: string;
    evidenceText?: string | null;
  },
  source: VenueCalendarFlags,
): NotAnEvent | null {
  // A title the metro lead checked as not a dance night, on any calendar.
  if (isNamedDanceNight(listing.title, source.notDanceNights)) {
    return {
      kind: "not_dance_scope",
      reason: "a title the metro lead checked as not a dance night (notDanceNights)",
    };
  }

  // D-757: a billed live show before 10pm is a concert on any source
  const liveShowScreened = screenLiveShow(listing);
  if (liveShowScreened !== null) {
    return liveShowScreened;
  }

  if (!source.mixedCalendar) return null;
  // A dance night the starting page names (D-264)
  if (isNamedDanceNight(listing.title, source.danceNights)) return null;
  // D-848: a Japanese show title (ワンマン, ライブ, 歌謡) naming no dance is a show, timed or not (not on a band-for-dancers source).
  if (!source.bandsForDancers && isShowTitleJa(listing.title)) {
    return {
      kind: "not_dance_scope",
      reason: "a Japanese live show, one-man concert or 歌謡 bar night naming no dance (D-848)",
    };
  }
  // Remove "Ball & Chain" venue name to avoid false positive on "ball" dance word (D-234)
  const titleText = listing.title.replace(/\bball\s*(?:&|and|n'?)\s*chain\b/gi, " ");
  const plain = normalizeForMatch(titleText);
  const bandsForDancers = bandsForDancersAt(source, listing);
  // A concert billing names a style ("tango quartet") and is still a concert on a venue's calendar.
  // "+" billing pattern applies only before LATE_HOUR
  const isPlusBilling = (text: string): boolean => {
    if (!/\s\+\s/.test(text)) return false;
    const normalized = normalizeForMatch(text);
    const tokens = normalized.split(" ").filter(Boolean);
    if (tokens.some((t) => DANCE_HINTS.has(t))) return false;
    if (DANCE_WORDS_REGEX.test(text) || DANCE_WORDS_REGEX.test(normalized)) return false;
    if (matchStyles(normalized).styles.length > 0) return false;
    return listingTypeFromText(text, null, []).type === "other";
  };
  const isEarlyPlusBilling =
    listing.startsAt !== null &&
    listing.startsAt.getTime() < localInstant(listing.nightDate, listing.tz, LATE_HOUR).getTime() &&
    isPlusBilling(titleText);
  // A dance band kind ("Rebirth Brass Band", zydeco) at a venue whose rows opt in (D-342) is live
  // music people dance to, unless the title names a seated show.
  if (
    source.danceBandKinds === true &&
    (DANCE_BAND_KIND_REGEX.test(titleText) || DANCE_BAND_KIND_REGEX.test(plain)) &&
    !(SEATED_SHOW_REGEX.test(titleText) || SEATED_SHOW_REGEX.test(plain))
  ) {
    return null;
  }
  if (!bandsForDancers && (isBandBilling(titleText) || isEarlyPlusBilling)) {
    return {
      kind: "not_dance_scope",
      reason: "a band's concert billing (the owner lists none, 2026-10-18)",
    };
  }
  // A band name, a "//" double bill, a tour title or "<style> Meets Jazz", at any hour and untimed
  // too; a jam session is left to the music-jam screen (D-589).
  if (!bandsForDancers && !MUSIC_JAM_REGEX.test(plain) && isConcertBilling(titleText)) {
    return {
      kind: "not_a_dance",
      reason: "a concert billing on a venue's calendar, naming no dance (D-589)",
    };
  }
  // A style does not make a conducted orchestra's concert a dance; a milonga or baile does (D-861).
  if (!bandsForDancers && isConductedOrchestra(titleText)) {
    return { kind: "not_a_dance", reason: "an orchestra's concert with its conductor (D-861)" };
  }
  // Before a dance-floor venue's dance hours (D-322: Ball & Chain's noon "The Ball & Chain Trio"),
  // only a named style keeps a listing: the rest is lunch or dinner music, even a band's. Checked
  // before the dance words, which the venue's own name ("Ball") would otherwise satisfy.
  if (
    source.bandsForDancers === true &&
    source.bandsForDancersFrom !== undefined &&
    !bandsForDancers &&
    listing.startsAt !== null &&
    listing.styles.length === 0 &&
    matchStyles(plain).styles.length === 0
  ) {
    return {
      kind: "not_a_dance",
      reason: "music before the venue's dance hours, naming no style (D-322)",
    };
  }
  // A title that says dance, dances, dancing, dancer or dancers names a dance (D-189),
  // unless it also names a seated show (theater, recital, film, etc.).
  // Spanish words are matched without accents ("película", "meditación"; D-228).
  const hasDanceWordCheck = hasDanceWord(titleText);
  const hasSeatedShowWord =
    SEATED_SHOW_REGEX.test(titleText) ||
    SEATED_SHOW_REGEX.test(plain) ||
    SEATED_SHOW_DE_REGEX.test(titleText) ||
    SEATED_SHOW_DE_REGEX.test(plain) ||
    SEATED_SHOW_AR.test(plain) ||
    hasSeatedShowJa(titleText);
  if (hasDanceWordCheck && !hasSeatedShowWord) {
    return null;
  }
  // D-256: a Halloween night, a DJ set, a pagode or a roda de samba is a party people dance
  // at, on any venue's calendar ("Halloween Night ft. DJ Breezy", "Pink Flamingo Halloween",
  // "Fundo de Quintal" billed as pagode), unless it names a seated show.
  if ((PARTY_KIND_REGEX.test(plain) || hasPartyKindJa(titleText)) && !hasSeatedShowWord) {
    return null;
  }
  // D-257, D-261: the page's own words about this listing say dance ("all-vinyl oldies dance party"),
  // or name a party kind (pagode, roda de samba, sambinha), and neither they nor the title name a seated show.
  // D-845: a dance word in an institution's name or a plot's verb list is not evidence.
  const cleanEvidence = listing.evidenceText ? withoutNonDanceMentions(listing.evidenceText) : null;
  if (cleanEvidence) {
    const evidence = cleanEvidence.replace(/\bball\s*(?:&|and|n'?)\s*chain\b/gi, " ");
    const evidencePlain = normalizeForMatch(evidence);
    const evidenceDance = hasDanceWord(evidence);
    const evidenceParty = PARTY_KIND_REGEX.test(evidencePlain) || hasPartyKindJa(evidence);
    const evidenceSeated =
      SEATED_SHOW_REGEX.test(evidence) ||
      SEATED_SHOW_REGEX.test(evidencePlain) ||
      SEATED_SHOW_DE_REGEX.test(evidence) ||
      SEATED_SHOW_DE_REGEX.test(evidencePlain) ||
      SEATED_SHOW_AR.test(evidencePlain) ||
      NON_DANCE_EVIDENCE_REGEX.test(evidence) ||
      hasSeatedShowJa(evidence);
    if ((evidenceDance || evidenceParty) && !evidenceSeated && !hasSeatedShowWord) return null;
  }
  // A seated show on a dance-floor venue's calendar (D-341)
  if (
    bandsForDancers &&
    (SEATED_NOT_MUSIC_REGEX.test(titleText) ||
      SEATED_NOT_MUSIC_REGEX.test(plain) ||
      SEATED_NOT_MUSIC_DE_REGEX.test(titleText) ||
      SEATED_NOT_MUSIC_DE_REGEX.test(plain) ||
      SEATED_NOT_MUSIC_AR.test(plain))
  ) {
    return {
      kind: "not_dance_scope",
      reason: "a seated show on a dance-floor venue's calendar (D-341)",
    };
  }
  // A sound bath, gong bath, sound journey, meditation or breathwork session on a mixed calendar
  // is not a dance (D-193).
  if (WELLNESS_SESSION_REGEX.test(titleText) || WELLNESS_SESSION_REGEX.test(plain)) {
    return {
      kind: "not_dance_scope",
      reason: "a sound bath or meditation session, not a dance (D-193)",
    };
  }
  // Music jam: "jam", "jams", "jam session", "jam sessions" but not dance jams.
  if (MUSIC_JAM_REGEX.test(titleText) || MUSIC_JAM_REGEX.test(plain)) {
    // Not a dance jam: check against dance jam patterns
    if (!(DANCE_JAM_REGEX.test(titleText) || DANCE_JAM_REGEX.test(plain))) {
      const tokens = normalizeForMatch(titleText).split(" ").filter(Boolean);
      const hasDanceHint = tokens.some((t) => DANCE_HINTS.has(t));
      if (matchStyles(plain).styles.length === 0 && !hasDanceHint) {
        return {
          kind: "not_dance_scope",
          reason: "a music jam (jam session), not a dance jam",
        };
      }
    }
  }
  // Fitness class: pilates, yoga, barre, HIIT, bootcamp, spin class, etc.
  // A club music genre (family "club") does not save a fitness class ("Techno Yoga").
  if (FITNESS_CLASS_REGEX.test(titleText) || FITNESS_CLASS_REGEX.test(plain)) {
    if (!namesNonClubDanceStyle(plain)) {
      return {
        kind: "not_dance_scope",
        reason: "a fitness class (pilates, yoga, barre, HIIT, bootcamp, spin), not a dance",
      };
    }
  }
  // Talks and worship (D-228, D-238; language and craft classes, castings: coverage-90, 2026-11-02)
  const talksRegex =
    /\b(charla|charlas|taller|talleres|seminario|seminarios|noche de adoracion|worship|xerrada|xerrades|conferencia|conferencies|debat|debats|presentacio|curs|cursos|curso|palestra|palestras|oficina|oficinas|conversa|tertulia|culto|louvor|noite de louvor|prova de vinhos|correfoc|castells|castellers|gegants|cercavila|cumbre|cumbres|congreso|congresos|posgrado|posgrados|diplomado|diplomados|cata|catas|degustacion|degustaciones|mezcal fest|feria|ferias|tianguis|bazar|bazares|mercadito|mercaditos|desfile|desfiles|ofrenda|ofrendas|concurso de catrinas|intercambio de idiomas|language exchange|desayuno emprendedor|desayunos emprendedores|desayuno de emprendedores|business breakfast|networking breakfast|(?:adult |beginner |intermediate )?(?:english|italian|spanish|french|german|portuguese|japanese|chinese|mandarin|cantonese|arabic|hebrew|russian|korean|greek|turkish|hindi|catalan|yiddish) (?:lesson|lessons|class|classes|course|courses|conversation|conversation group)|(?:aula|aulas|clase|clases|classe|classes|curso|cursos|corso|corsi) (?:de |d |di )?(?:ingles|italiano|italia|espanhol|espanol|frances|alemao|aleman|portugues|angles|castella|catala|japones|chines|arabe)|crochet|knitting|knit night|sewing class|sewing classes|embroidery|pottery class|pottery classes|ceramics class|ceramics classes|paint and sip|paint & sip|paint sip|model casting|casting call|open casting|audition|auditions)\b/;
  // A talk or debate about a dance names the style but is still a talk ("Xerrada i debat 'Ball de bot...'"),
  // unless the title also offers a class, a social or a party (D-559 fix 3). Not "tertulia": in Lisbon
  // a tertulia is a dance session.
  const talkOnly =
    /\b(xerrada|xerrades|conferencia|conferencies|debat|debats|palestra|palestras|charla|charlas)\b/.test(
      plain,
    ) &&
    !/\b(aula|aulas|clase|clases|class|classes|classe|baile|bailes|festa|fiesta|social|socials|roda|milonga|practica)\b/.test(
      plain,
    );
  if (talksRegex.test(plain) && (talkOnly || matchStyles(plain).styles.length === 0)) {
    return {
      kind: "not_dance_scope",
      reason:
        "a talk, workshop, fair, tasting, parade, worship night, language exchange, language or craft class, casting or business breakfast, not a dance (D-228, D-234, D-238)",
    };
  }
  // A style counts as dance evidence only when the title or evidence text names it (D-237)
  const named = matchStyles(plain);
  const styleNamed = named.styles.length > 0 || named.families.length > 0;
  // Check evidence text for dance words or styles
  const evidenceHasDanceWord =
    cleanEvidence &&
    (DANCE_WORDS_REGEX.test(cleanEvidence) ||
      DANCE_WORDS_REGEX.test(normalizeForMatch(cleanEvidence)) ||
      DANCE_WORDS_DE_REGEX.test(cleanEvidence) ||
      DANCE_WORDS_DE_REGEX.test(normalizeForMatch(cleanEvidence)) ||
      hasDanceWordJa(cleanEvidence));
  const evidenceHasStyle =
    listing.evidenceText &&
    (matchStyles(normalizeForMatch(listing.evidenceText)).styles.length > 0 ||
      matchStyles(normalizeForMatch(listing.evidenceText)).families.length > 0);
  // A style key the title says as a word ("Swing at the Barbary"), which matchStyles may not catch.
  const titleWords = new Set(plain.split(" "));
  const anyStyleInTitle = listing.styles.some((style) => titleWords.has(style));
  const effectiveStyles =
    styleNamed || anyStyleInTitle || evidenceHasDanceWord || evidenceHasStyle ? listing.styles : [];
  if (effectiveStyles.length > 0 || !listing.startsAt) return null;
  const typeNamed = listingTypeFromText(titleText, null, matchStyles(plain).styles).type;
  // D-590: "Class", "Workshop" or "Social" alone keeps a row only on a dance organiser's calendar (its source
  // names a non-club style) or when the title names a style or a dance word (SAGE NYC's health workshops).
  if (typeNamed !== "other") {
    const kindWordOnly =
      (typeNamed === "class" || typeNamed === "social") &&
      !namesNonClubSourceStyle(source.styles ?? []) &&
      !styleNamed &&
      !hasDanceWordCheck;
    if (!kindWordOnly) return null;
  }
  if (bandsForDancers) return null;
  if (
    source.lateNightKeep !== false &&
    !LATE_COMEDY.test(plain) &&
    listing.startsAt.getTime() >= localInstant(listing.nightDate, listing.tz, LATE_HOUR).getTime()
  )
    return null;
  return {
    kind: "not_a_dance",
    reason: "names no dance, and the venue's calendar lists concerts too",
  };
}

/**
 * A row stored from a venue's whole calendar with no time that names no dance (as
 * `screenNoDance` reads a title, styles and source), which a whole read of that calendar did
 * not list (D-167). `screenNoDance` keeps an untimed row, since nobody said it is a show; once
 * the calendar is read again and the read leaves it out, nothing says it is a dance either.
 */
export function screenUnlistedUntimed(
  listing: {
    title: string;
    styles: readonly string[];
    startsAt: Date | null;
    nightDate: string;
    tz: string;
  },
  source: VenueCalendarFlags,
): NotAnEvent | null {
  if (!source.mixedCalendar || listing.startsAt !== null) return null;
  // Simulate a 7pm start to let screenNoDance decide
  const simulated = {
    ...listing,
    startsAt: localInstant(listing.nightDate, listing.tz, 19),
  };
  const screened = screenNoDance(simulated, source);
  if (screened === null) return null;
  // Map any non-null result to the same kind but with a reason about the read leaving it out
  return {
    kind: "not_a_dance",
    reason: "names no dance and no time, and this read of the venue's calendar no longer lists it",
  };
}

/**
 * The model's page quotes about a listing, for the screen (D-257): every quote except the ones naming a place,
 * an organiser, a price or a link ("Mid-City Dance Hall" is a venue, not a dance).
 */
export function screenEvidenceText(
  evidence: Readonly<Record<string, string>> | null | undefined,
): string | null {
  if (!evidence) return null;
  const parts = Object.entries(evidence)
    .filter(([key, value]) => !SKIPPED_EVIDENCE_KEY.test(key) && value.trim() !== "")
    .map(([, value]) => value);
  return parts.length > 0 ? parts.join(" ") : null;
}

/** Evidence keys that name a place, an organiser, a price or a link, not the listing (D-257). */
const SKIPPED_EVIDENCE_KEY = /^(?:venue|address|organizer|organiser|price|ticket|url)/i;

/** Why a stored row from this source is left out now, or null: the title screen, then the venue-
 * calendar screen with the source's flags (D-341: every pass reads bandsForDancers the same way). */
export function screenStoredRow(
  row: {
    title: string;
    styles: readonly string[];
    startsAt: Date | null;
    endsAt?: Date | null;
    nightDate: string;
    tz: string;
    venueName?: string | null;
  },
  source: VenueCalendarFlags,
): string | null {
  return (
    screenTitle(row.title, row.venueName)?.reason ??
    screenTalkOrWorkshop(row.title, source.styles ?? [])?.reason ??
    screenNoDance(row, source)?.reason ??
    null
  );
}
