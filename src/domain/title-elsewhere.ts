/**
 * Detect a title naming another city's venue on another weekday (D-863).
 * Example: "Sports Night Wednesday at SCALA London" on a Saturday night in Los Angeles.
 *
 * @param title - The event title.
 * @param nightDate - The night's date in YYYY-MM-DD format.
 * @param ownCityNames - The metro's own city names (folded).
 * @returns The matched city's display name from ELSEWHERE_CITIES, or null if no match.
 */
export function titleNamesVenueElsewhere(
  title: string,
  nightDate: string,
  ownCityNames: readonly string[],
): string | null {
  // 1. Validate nightDate format and compute its weekday.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(nightDate)) {
    return null;
  }
  const nightDateObj = new Date(nightDate + "T12:00:00Z");
  const nightWeekday = nightDateObj.getUTCDay(); // 0 = Sunday, 6 = Saturday

  // 2. Fold the title.
  const folded = fold(title);
  if (folded.length === 0) {
    return null;
  }
  const tokens = folded.split(" ");

  // 3. Weekday detection.
  const weekdaySet = new Set<string>();
  for (const token of tokens) {
    const day = weekdayFromToken(token);
    if (day !== null) {
      weekdaySet.add(day);
    }
  }
  if (weekdaySet.size !== 1) {
    return null;
  }
  const namedWeekday = [...weekdaySet][0] ?? "";
  const namedWeekdayIndex = weekdayToIndex(namedWeekday);
  if (namedWeekdayIndex === nightWeekday) {
    return null;
  }

  // 4. Venue elsewhere detection.
  // Find the last "at" token.
  let lastAtIdx = -1;
  for (let i = tokens.length - 1; i >= 0; i--) {
    if (tokens[i] === "at") {
      lastAtIdx = i;
      break;
    }
  }
  if (lastAtIdx === -1) {
    return null;
  }

  // The city must be at the end of the title.
  // We'll try each city in ELSEWHERE_CITIES (sorted by token count descending, then length).
  const candidates = [...ELSEWHERE_CITIES]
    .map((city) => ({
      display: city,
      foldedTokens: fold(city).split(" "),
    }))
    .sort((a, b) => {
      const diffTokens = b.foldedTokens.length - a.foldedTokens.length;
      if (diffTokens !== 0) return diffTokens;
      return b.display.length - a.display.length;
    });

  for (const cand of candidates) {
    const cityTokenCount = cand.foldedTokens.length;
    const startCityIdx = tokens.length - cityTokenCount;
    if (startCityIdx < 0) continue;
    // Check that the city tokens match exactly.
    let match = true;
    for (let i = 0; i < cityTokenCount; i++) {
      if (tokens[startCityIdx + i] !== cand.foldedTokens[i]) {
        match = false;
        break;
      }
    }
    if (!match) continue;

    // The city must be after the last "at".
    if (startCityIdx <= lastAtIdx) continue;
    // There must be 1 to 4 tokens between the "at" and the start of the city.
    const gap = startCityIdx - lastAtIdx - 1;
    if (gap < 1 || gap > 4) continue;
    // Ensure there is no extra "at" in the gap (already satisfied because we used the last "at").
    // The city must be the last tokens of the title.
    if (startCityIdx + cityTokenCount !== tokens.length) continue;

    // 5. City must not be one of ownCityNames (compare folded forms).
    // A metro also owns its other names: "Brooklyn" and "NYC" are New York's own.
    const cityFolded = cand.foldedTokens.join(" ");
    const owned = ownCityNames.flatMap((own) => [own, ...(OWN_ALIASES[fold(own)] ?? [])]);
    if (owned.some((own) => fold(own) === cityFolded)) {
      return null;
    }

    // All conditions satisfied.
    return cand.display;
  }

  return null;
}

/**
 * Fold a string: lower‑case, strip accents, replace non‑alnum with space, collapse spaces, trim.
 */
function fold(s: string): string {
  // Normalize to NFD, remove diacritics (marks), lower case.
  const normalized = s.normalize("NFD").replace(/\p{M}/gu, "");
  const alnumSpaced = normalized.replace(/[^a-z0-9]/gi, " ");
  const collapsed = alnumSpaced.replace(/\s+/g, " ").trim();
  return collapsed.toLowerCase();
}

/**
 * If token is an English weekday name (singular or plural), return its canonical form.
 */
function weekdayFromToken(token: string): string | null {
  const map: Record<string, string> = {
    monday: "Monday",
    mondays: "Monday",
    tuesday: "Tuesday",
    tuesdays: "Tuesday",
    wednesday: "Wednesday",
    wednesdays: "Wednesday",
    thursday: "Thursday",
    thursdays: "Thursday",
    friday: "Friday",
    fridays: "Friday",
    saturday: "Saturday",
    saturdays: "Saturday",
    sunday: "Sunday",
    sundays: "Sunday",
  };
  return map[token] ?? null;
}

/**
 * Convert canonical weekday name to Date‑style index (0 = Sunday).
 */
function weekdayToIndex(day: string): number {
  const order = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  return order.indexOf(day);
}

/** Other names of a metro's own city, keyed by the folded metro name. */
const OWN_ALIASES: Readonly<Record<string, readonly string[]>> = {
  "new york": ["NYC", "Brooklyn"],
};

/**
 * City names matched, written in their display form without accents.
 */
export const ELSEWHERE_CITIES: readonly string[] = [
  "London",
  "Berlin",
  "Paris",
  "Amsterdam",
  "Ibiza",
  "Manchester",
  "Glasgow",
  "Bristol",
  "Leeds",
  "Dublin",
  "New York",
  "NYC",
  "Brooklyn",
  "Chicago",
  "Detroit",
  "Miami",
  "Los Angeles",
  "San Francisco",
  "Barcelona",
  "Madrid",
  "Lisbon",
  "Tokyo",
  "Dubai",
  "Mexico City",
  "Tulum",
  "Austin",
  "Nashville",
  "New Orleans",
  "Philadelphia",
  "Buenos Aires",
  "Rio de Janeiro",
  "Mumbai",
  "Delhi",
  "Pune",
  "Hong Kong",
  "Istanbul",
  "Beirut",
  "Marrakesh",
  "Medellin",
  "San Juan",
  "Raleigh",
];
