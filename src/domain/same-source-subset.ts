import { coreTitleWords, onePlace, sameKindOfNight, type DedupeSide } from "@/src/domain/dedupe";
import { GENERIC_TITLE_WORDS } from "@/config/dedupe";

// Weekday words in various languages (singular and plural forms)
const WEEKDAY_WORDS = new Set([
  // English
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
  "mondays",
  "tuesdays",
  "wednesdays",
  "thursdays",
  "fridays",
  "saturdays",
  "sundays",
  // French
  "lundi",
  "mardi",
  "mercredi",
  "jeudi",
  "vendredi",
  "samedi",
  "dimanche",
  "lundis",
  "mardis",
  "mercredis",
  "jeudis",
  "vendredis",
  "samedis",
  "dimanches",
  // Spanish
  "lunes",
  "martes",
  "miercoles",
  "jueves",
  "viernes",
  "sabado",
  "domingo",
  "luneses",
  "marteses",
  "miercoleses",
  "jueveses",
  "vierneses",
  "sabados",
  "domingos",
  // Portuguese
  "segunda",
  "terca",
  "quarta",
  "quinta",
  "sexta",
  "sabado",
  "domingo",
  "segundas",
  "tercas",
  "quartas",
  "quintas",
  "sextas",
  "sabados",
  "domingos",
  // German
  "montag",
  "dienstag",
  "mittwoch",
  "donnerstag",
  "freitag",
  "samstag",
  "sonntag",
  "montags",
  "dienstags",
  "mittwochs",
  "donnerstags",
  "freitags",
  "samstags",
  "sonntags",
  // Italian
  "lunedi",
  "martedi",
  "mercoledi",
  "giovedi",
  "venerdi",
  "sabato",
  "domenica",
  "lunedis",
  "martedis",
  "mercoledis",
  "giovedis",
  "venerdis",
  "sabatos",
  "domenicas",
]);

// Filler words to drop
const FILLER_WORDS = new Set([
  "a",
  "an",
  "the",
  "le",
  "la",
  "les",
  "el",
  "los",
  "las",
  "de",
  "del",
  "des",
  "du",
  "di",
  "da",
  "do",
  "of",
  "at",
  "en",
  "in",
  "y",
  "e",
  "et",
  "and",
  "with",
  "con",
  "avec",
  "feat",
  "ft",
  "live",
]);

// Age numbers to drop
const AGE_NUMBERS = new Set(["18", "21"]);

function filterWords(words: string[]): string[] {
  return words
    .map((w) => w.toLowerCase())
    .filter((w) => !FILLER_WORDS.has(w))
    .filter((w) => !WEEKDAY_WORDS.has(w))
    .filter((w) => !AGE_NUMBERS.has(w));
}

export function titleWordSubset(a: string, b: string): "equal" | "subset" | null {
  const wordsA = filterWords(coreTitleWords(a));
  const wordsB = filterWords(coreTitleWords(b));

  if (wordsA.length === 0 || wordsB.length === 0) {
    return null;
  }

  const setA = new Set(wordsA);
  const setB = new Set(wordsB);

  if (setA.size === setB.size && [...setA].every((w) => setB.has(w))) {
    return "equal";
  }

  const [smaller, larger] = setA.size <= setB.size ? [setA, setB] : [setB, setA];

  if (smaller.size === 0) {
    return null;
  }

  const isSubset = [...smaller].every((w) => larger.has(w));
  // A longer title that adds a class word, a level or a number names another session ("Salsa" / "Salsa Level 2",
  // "West Coast Swing with ..." / "Class West Coast Swing with ...", run 33), not the same night.
  const added = [...larger].filter((w) => !smaller.has(w));
  if (isSubset && !added.some((w) => SESSION_WORD.test(w))) {
    return "subset";
  }

  return null;
}

const SESSION_WORD =
  /^(?:\d+|[a-z]*\d[a-z\d]*|class(?:es)?|clases?|cours|kurs|aulas?|lessons?|workshops?|levels?|nivel|niveau|beginners?|intermediate|advanced|improvers?|basics?|intro|fundamentals|technique|drop|bootcamp|series|part)$/;

export function sameSourceSubsetTwin(a: DedupeSide, b: DedupeSide): boolean {
  // 1. Neither cancelled, both have non-empty title
  if (a.cancelled === true || b.cancelled === true) {
    return false;
  }
  if (!a.title || !b.title || a.title.trim() === "" || b.title.trim() === "") {
    return false;
  }

  // 2. Same kind of night
  const aType = a.listingType ?? "other";
  const bType = b.listingType ?? "other";
  if (!sameKindOfNight(aType, bType)) {
    return false;
  }

  // 3. Title word subset relation
  const subsetResult = titleWordSubset(a.title, b.title);
  if (subsetResult === null) {
    return false;
  }

  // Determine smaller set for generic guard
  const wordsA = [...new Set(filterWords(coreTitleWords(a.title)))];
  const wordsB = [...new Set(filterWords(coreTitleWords(b.title)))];
  const smallerSet = wordsA.length <= wordsB.length ? wordsA : wordsB;

  // 4. Place and time conditions
  const bothUnplaced = a.venueId === null && b.venueId === null && !a.venuePoint && !b.venuePoint;
  const aStartsNull = a.startsAt === null;
  const bStartsNull = b.startsAt === null;
  const bothTimed = !aStartsNull && !bStartsNull;
  const bothUntimed = aStartsNull && bStartsNull;
  const exactlyOneUntimed = aStartsNull !== bStartsNull;

  // 4(a) onePlace and timing conditions
  const onePlaceCondition =
    onePlace(a, b) &&
    ((bothTimed && a.startsAt!.getTime() === b.startsAt!.getTime()) ||
      exactlyOneUntimed ||
      bothUntimed);

  // 4(b) both unplaced, both timed equal
  const unplacedEqualCondition =
    bothUnplaced && bothTimed && a.startsAt!.getTime() === b.startsAt!.getTime();

  // 4(c) both unplaced, exactly one untimed, subset/equal and smaller set has at least 2 words
  const unplacedOneUntimedCondition =
    bothUnplaced &&
    exactlyOneUntimed &&
    (subsetResult === "subset" || subsetResult === "equal") &&
    smallerSet.length >= 2;

  const placeTimeOk = onePlaceCondition || unplacedEqualCondition || unplacedOneUntimedCondition;
  if (!placeTimeOk) {
    return false;
  }

  // 5. Generic guard
  const allGeneric = smallerSet.every((w) => GENERIC_TITLE_WORDS.includes(w));
  const singleShortWord = smallerSet.length === 1 && (smallerSet[0] ?? "").length < 3;
  if (allGeneric || singleShortWord) {
    // require case 4(a) with both starts non-null and equal
    return onePlace(a, b) && bothTimed && a.startsAt!.getTime() === b.startsAt!.getTime();
  }

  return true;
}
