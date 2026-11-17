// D-840: a venue written only as the city's own name ("London", "London, UK") is no
// place (folkdance.page's London feed; 79 nights pinned at a Wimbledon venue named "London", daily 2026-11-10).

import { normalizeForMatch } from "@/config/styles";

export const COUNTRY_WORDS = new Set([
  "united kingdom",
  "england",
  "scotland",
  "great britain",
  "france",
  "spain",
  "espana",
  "germany",
  "deutschland",
  "united states",
  "united states of america",
  "mexico",
  "argentina",
  "brazil",
  "brasil",
  "portugal",
  "japan",
  "india",
  "turkey",
  "turkiye",
  "lebanon",
  "morocco",
  "colombia",
  "puerto rico",
  "united arab emirates",
  "uae",
  "hong kong",
  "china",
]);

function normalize(text: string): string {
  return normalizeForMatch(text).replace(/\s+/g, " ").trim();
}

function isCodePart(part: string): boolean {
  return /^[a-z]{2,3}$/.test(part);
}

export function isCityOnlyPlace(
  text: string | null | undefined,
  cityNames: readonly string[],
): boolean {
  // 1. Return false when text is null/undefined or blank after trim, or when no non-blank city name is given.
  if (text == null || text.trim() === "") {
    return false;
  }
  const nonBlankCityNames = cityNames.filter((c) => c.trim() !== "");
  if (nonBlankCityNames.length === 0) {
    return false;
  }

  // 2. Normalise city names.
  const normalizedCityNames = nonBlankCityNames.map(normalize);

  // 3. Split the original text on commas, then normalize each part.
  const parts = text
    .split(",")
    .map((p) => normalize(p))
    .filter((p) => p !== "");

  // 4. First part must equal one of the normalized city names exactly.
  const [firstPart, ...rest] = parts;
  if (firstPart === undefined || !normalizedCityNames.includes(firstPart)) {
    return false;
  }

  // 5. Every other part is the city again, a 2-3 letter code or a country word; anything else
  // (a street, a postcode, a venue) is a real place.
  return rest.every(
    (part) => normalizedCityNames.includes(part) || isCodePart(part) || COUNTRY_WORDS.has(part),
  );
}

export function isCityOnlyVenue(
  venue: { name: string | null | undefined; address: string | null | undefined },
  cityNames: readonly string[],
): boolean {
  const { name, address } = venue;

  // name blank or missing and address blank or missing: false (nothing to judge).
  if ((name == null || name.trim() === "") && (address == null || address.trim() === "")) {
    return false;
  }

  // name non-blank: true only when isCityOnlyPlace(name) AND (address is blank/missing OR isCityOnlyPlace(address)).
  if (name != null && name.trim() !== "") {
    if (!isCityOnlyPlace(name, cityNames)) {
      return false;
    }
    if (address != null && address.trim() !== "") {
      return isCityOnlyPlace(address, cityNames);
    }
    return true;
  }

  // name blank/missing: true when isCityOnlyPlace(address).
  return isCityOnlyPlace(address, cityNames);
}
