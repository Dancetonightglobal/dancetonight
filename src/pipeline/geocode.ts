// Address geocoding (PLAN 6.2 step 4, D-016, D-043 question 4). A swappable interface with one
// implementation, Geoapify's free tier, which is ON when GEOAPIFY_API_KEY is set.
//
// An answer is used only when it is specific and inside the metro: a building, an amenity or a
// street address with a house number, with Geoapify's own confidence at 0.7 or more, within the
// metro's radius. Anything vaguer returns null and the listing stays unplaced: a pin on the
// wrong block sends a dancer to the wrong door, which is worse than no pin.
//
// Answers are cached per normalised address for the run, so a venue named on thirty listings
// costs one request. Geoapify's free allowance is 3,000 requests a day (SOURCES 6.5; unverified
// from this network), far above one metro's new addresses.
//
// A placeholder address ("123 Main St", "1 Main Street", "123 Fake St", "TBA") is never asked
// about (D-071): a model read wrote "Tango Arts, 123 Main St, New York, NY", and the geocoder
// found a 123 Main St in the Bronx. The venue is left unplaced rather than pinned somewhere
// invented.

import { COUNTRY_REGIONS, METRO_REGIONS, METRO_POSTCODE_PREFIXES } from "@/config/metro-regions";
import { LANGS } from "@/config/styles";
import type { Metro } from "@/src/adapters/types";
import type { Point } from "@/src/domain/listing";
import { insideMetro } from "@/src/domain/metro-bounds";
import type { HttpClient } from "@/src/pipeline/http";
import { postcodeOf, postcodeWord } from "@/src/domain/postcode";

export interface Geocoder {
  readonly id: string;
  geocode(address: string): Promise<Point | null>;
  /**
   * The address's point only when the answer is a building (D-071): what an API's own point is
   * checked against. An amenity's or a park's centroid would move a venue off its door or lawn.
   */
  building(address: string): Promise<Point | null>;
  /**
   * The place the address names outside the metro ("warsaw, pl"), from the geocoder's own reading
   * of it (`geoapifyElsewhere`), or null. Asked with the same request as `geocode`.
   */
  elsewhere?(address: string): Promise<string | null>;
  /**
   * Why the geocoder gave no point for the address ("too vague (street, confidence 0.9)"), or null;
   * asked with the same request as `geocode`.
   */
  refusal?(address: string): Promise<string | null>;
}

/** An accepted answer with Geoapify's `result_type` for it ("building", "amenity", "street"). */
export interface GeocodeAnswer {
  point: Point;
  type: string;
}

export const GEOAPIFY_SEARCH = "https://api.geoapify.com/v1/geocode/search";
export const GEOCODE_MIN_CONFIDENCE = 0.7;
const SPECIFIC = new Set(["building", "amenity"]);

/**
 * Clean an address before sending it to the geocoder:
 * 1. Remove parenthesised parts.
 * 2. If there's a house number preceded by "–", "-", "—" or ",", drop everything before that.
 *    House numbers may be hyphenated (e.g., "52-19 Flushing Ave").
 * 3. Drop trailing ", United States", ", USA", ", US".
 * 4. Drop comma-separated parts that start with a lowercase letter and contain no digits or capitalised place words.
 * 5. Drop consecutive identical parts (case-insensitive).
 * 6. Collapse whitespace and trim.
 * 7. Replace spelled-out state "New York" or "New Jersey" with its two-letter code when followed by a 5-digit ZIP
 *    (optionally ZIP+4), measured 2026-10-22 to improve Geoapify building-level matches.
 * 8. For a house-number range `A-B` at the start of the street line, replace with `A` when the ZIP is not a Queens ZIP
 *    (Queens ZIPs: 11004,11005,11101-11109,11351-11697), measured 2026-10-22 to improve confidence.
 */
export function addressForGeocoder(address: string): string {
  // Step 1: Remove parenthesised parts
  let cleaned = address.replace(/\([^)]*\)/g, "");

  // Step 2: Find first house number (1-5 digits, or a Queens "52-19"), then space and letter.
  // D-254: a number that opens a later comma part is a postcode before its town, not a house
  // number, when it is Portugal's NNNN-NNN, starts with 0 (Spain's 08005), or a house number came
  // before it ("Avenida da Índia 52, 1300-299 Lisboa"). Cutting at it dropped the street of every
  // European address. A US "Puerto Plata, 7516 Rockaway Blvd" is still cut at its house number.
  const postcodeAt = (number: string, at: number): boolean => {
    const before = cleaned.slice(0, at);
    if (!/,\s*$/.test(before)) return false;
    return /^\d{4}-\d{3}$/.test(number) || /^0\d{3,4}$/.test(number) || /\d/.test(before);
  };
  const houseNumberMatch = [...cleaned.matchAll(/\b(\d{1,5}(?:-\d{1,4})?)\s+[A-Za-z]/g)].find(
    (m) => !postcodeAt(m[1]!, m.index),
  );
  if (houseNumberMatch) {
    const houseNumberStart = houseNumberMatch.index!;
    // Look backwards for separator
    const before = cleaned.slice(0, houseNumberStart);
    const lastSeparator = Math.max(
      before.lastIndexOf("–"),
      before.lastIndexOf("-"),
      before.lastIndexOf("—"),
      before.lastIndexOf(","),
    );
    if (lastSeparator !== -1) {
      // Drop everything before the separator
      cleaned = cleaned.slice(lastSeparator + 1).trim();
    }
  }

  // Step 3: Remove trailing country suffixes
  cleaned = cleaned.replace(/,\s*(United\s+States|USA|US)\s*$/i, "");

  // Step 4: Drop comma-separated parts that start with lowercase and have no digits/capitals
  const parts = cleaned.split(",").map((part) => part.trim());
  const filteredParts = parts.filter((part) => {
    if (part.length === 0) return false;
    // Keep if contains digit
    if (/\d/.test(part)) return true;
    // Keep if starts with capital letter (place word)
    if (/^[A-Z]/.test(part)) return true;
    // Otherwise drop (starts with lowercase)
    return false;
  });

  // Step 5: Drop consecutive identical parts (case-insensitive)
  const dedupedParts = filteredParts.filter(
    (part, i) => i === 0 || part.toLowerCase() !== filteredParts[i - 1]!.toLowerCase(),
  );

  // Step 6: Collapse whitespace, preserve commas between parts
  // Join with commas and a single space, then collapse any remaining repeated whitespace
  const joined = dedupedParts.join(", ");
  // Collapse multiple spaces into one, but keep commas
  let result = joined.replace(/\s+/g, " ").trim();

  // Step 7: Replace spelled-out state with two-letter code when followed by a ZIP
  // Pattern: whole-word "New York" or "New Jersey" case-insensitive, then whitespace, then 5 digits (optionally dash 4)
  result = result.replace(/\bNew\s+York\s+(\d{5}(?:-\d{4})?)\b/gi, "NY $1");
  result = result.replace(/\bNew\s+Jersey\s+(\d{5}(?:-\d{4})?)\b/gi, "NJ $1");

  // Step 8: House-number range reduction for non-Queens ZIPs
  // Extract the last 5-digit ZIP if present
  const zipMatch = result.match(/\b(\d{5})(?:-\d{4})?(?:\s*$|,)/);
  const zip = zipMatch?.[1];
  // Only apply range reduction if a ZIP is present
  if (zip) {
    const isQueensZip =
      zip === "11004" ||
      zip === "11005" ||
      (zip >= "11101" && zip <= "11109") ||
      (zip >= "11351" && zip <= "11697");
    // Pattern: start of string, digits-dash-digits, whitespace, letter (street name)
    if (!isQueensZip) {
      result = result.replace(/^(\d{1,5})-(\d{1,5})\s+([A-Za-z])/, (match, a, b, letter) => {
        const numA = parseInt(a, 10);
        const numB = parseInt(b, 10);
        if (numB > numA) {
          // Replace with the first number
          return `${a} ${letter}`;
        }
        return match;
      });
    }
  }

  return result;
}

export function geoapifyUrl(address: string, metro: Metro, apiKey: string): string {
  const url = new URL(GEOAPIFY_SEARCH);
  url.searchParams.set("text", address);
  url.searchParams.set(
    "filter",
    `circle:${metro.center.lng},${metro.center.lat},${Math.round(metro.radiusKm * 1000)}`,
  );
  url.searchParams.set("bias", `proximity:${metro.center.lng},${metro.center.lat}`);
  url.searchParams.set("limit", "1");
  url.searchParams.set("format", "json");
  url.searchParams.set("apiKey", apiKey);
  return url.toString();
}

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** The point in a Geoapify answer, when it is specific and confident enough; else null. */
export function acceptGeoapify(body: unknown, metro: Metro): Point | null {
  return geoapifyAnswer(body, metro)?.point ?? null;
}

/** `acceptGeoapify`'s answer with its result type. */
export function geoapifyAnswer(body: unknown, metro: Metro): GeocodeAnswer | null {
  const parsed = parseGeoapifyResult(body);
  if (!parsed) return null;
  const { lat, lng, confidence, type } = parsed;
  const specific =
    SPECIFIC.has(type) || (type === "street" && typeof parsed.housenumber === "string");
  if (!specific || confidence < GEOCODE_MIN_CONFIDENCE) return null;
  const point = { lat, lng };
  return insideMetro(metro, point) ? { point, type } : null;
}

interface ParsedGeoapifyResult {
  lat: number;
  lng: number;
  confidence: number;
  type: string;
  housenumber?: string;
}

function parseGeoapifyResult(body: unknown): ParsedGeoapifyResult | null {
  if (!isObject(body) || !Array.isArray(body.results)) return null;
  const best = body.results.find(isObject);
  if (!best) return null;
  const lat = Number(best.lat);
  const lng = Number(best.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const rank = isObject(best.rank) ? best.rank : {};
  const confidence = typeof rank.confidence === "number" ? rank.confidence : 0;
  const type = typeof best.result_type === "string" ? best.result_type : "";
  const housenumber = typeof best.housenumber === "string" ? best.housenumber : undefined;
  return { lat, lng, confidence, type, housenumber };
}

/**
 * The place a confident, specific answer puts outside the metro's outline ("yonkers, new york"),
 * or null (D-084). Geoapify's circle reaches past the five boroughs, so an address in Yonkers or
 * Jersey City comes back placed and in the circle, but not in New York.
 */
export function geoapifyOutside(body: unknown, metro: Metro): string | null {
  const parsed = parseGeoapifyResult(body);
  if (!parsed) return null;
  const { lat, lng, confidence } = parsed;
  if (confidence < GEOCODE_MIN_CONFIDENCE || insideMetro(metro, { lat, lng })) return null;
  if (!isObject(body) || !Array.isArray(body.results)) return null;
  const best = body.results.find(isObject);
  if (!best) return null;
  const words = [best.city, best.state_code ?? best.state]
    .filter((w): w is string => typeof w === "string" && w.trim() !== "")
    .map((w) => w.trim().toLowerCase());
  return words.length > 0 ? words.join(", ") : `${lat.toFixed(3)}, ${lng.toFixed(3)}`;
}

/**
 * Why the geocoder gave no point for the address, or null when it did.
 */
export function geoapifyRefusal(body: unknown, metro: Metro): string | null {
  const parsed = parseGeoapifyResult(body);
  if (!parsed) return "no answer";
  const { lat, lng, confidence, type } = parsed;
  const specific =
    SPECIFIC.has(type) || (type === "street" && typeof parsed.housenumber === "string");
  if (!specific) {
    const c = Number(confidence.toFixed(2));
    return `too vague (${type || "unknown"}, confidence ${c})`;
  }
  if (confidence < GEOCODE_MIN_CONFIDENCE) {
    const c = Number(confidence.toFixed(2));
    return `low confidence ${c} (${type})`;
  }
  if (!insideMetro(metro, { lat, lng })) {
    return `outside the metro (${lat.toFixed(4)}, ${lng.toFixed(4)})`;
  }
  return null;
}

/**
 * The postal code an address gives when it is outside the metro by `METRO_POSTCODE_PREFIXES`, or null.
 */
export function postcodeOutsideMetro(
  address: string,
  metro: Pick<Metro, "slug" | "countryCode">,
): string | null {
  const prefixes = METRO_POSTCODE_PREFIXES[metro.slug];
  if (!prefixes) return null;
  const code = postcodeOf(address, metro.countryCode);
  if (!code) return null;
  const startsWithPrefix = prefixes.some((prefix) => code.startsWith(prefix));
  if (startsWithPrefix) return null;
  const word = postcodeWord(metro.countryCode);
  return `${word} ${code}`;
}

/**
 * The place an address names outside the metro, from Geoapify's own reading of the address
 * (`query.parsed`), or null: a country other than the metro's ("Warsaw, PL" in New York), or, in
 * the metro's country, a first-level region the metro does not reach ("3050 Bristol St, Costa
 * Mesa, CA"). `regions` are the metro's (`METRO_REGIONS`); without them only the country is
 * checked. Only a country or a region recognised for certain counts: "N.Y.", "Estados Unidos" or
 * "New York State" are not another place, and an address that names neither (most do not: "239 W
 * 14th St") is never elsewhere, however the geocoder answers it. Coverage first: when in doubt, the
 * listing stays.
 */
export function geoapifyElsewhere(
  body: unknown,
  metro: Pick<Metro, "countryCode">,
  regions: readonly string[] = [],
): string | null {
  if (!isObject(body) || !isObject(body.query) || !isObject(body.query.parsed)) return null;
  const parsed = body.query.parsed;
  const part = (key: string) =>
    typeof parsed[key] === "string" ? (parsed[key] as string).trim().toLowerCase() : "";
  const named = [part("city"), part("state"), part("country")].filter(Boolean).join(", ");
  const home = metro.countryCode.toUpperCase();
  const table = COUNTRY_REGIONS[home] ?? [];
  const regionOf = (written: string) =>
    written
      ? (table.find(([code, name]) => [code, name].map(letters).includes(written))?.[0] ?? null)
      : null;
  // A country slot that is one of the home country's regions ("Atlanta, Georgia") is that region.
  const country = letters(part("country"));
  const countryRegion = regionOf(country);
  const code = countryRegion ? null : countryCodeOf(country);
  // "Central, Hong Kong, China" and "Macau, China": a page that writes China after Hong Kong or Macau
  // is in that home, not elsewhere (D-668).
  const sarNamed = [part("city"), part("state")]
    .map(letters)
    .some((w) => (SAR_NAMES[home] ?? []).some((n) => w.startsWith(n)));
  if (code === "CN" && sarNamed) {
    return null;
  }
  if (code && code !== home) return named;
  if (regions.length === 0) return null;
  const region = countryRegion ?? regionOf(letters(part("state")));
  return region && !regions.includes(region) ? named : null;
}

/**
 * Letters only, without accents: "N.Y." is "ny", "États-Unis" is "etatsunis" (decomposed, an
 * accent is a mark of its own, dropped with the dots and spaces).
 */
function letters(text: string): string {
  return text
    .normalize("NFD")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}

/** Hong Kong and Macau as an address writes them before ", China" ("Hong Kong SAR", "Hong Kong Island"). */
const SAR_NAMES: Readonly<Record<string, readonly string[]>> = {
  HK: ["hongkong"],
  MO: ["macau", "macao"],
};

/** Short forms an address writes for a country that are not a code or a name Intl knows. */
const COUNTRY_ALIASES: Readonly<Record<string, string>> = {
  usa: "US",
  england: "GB",
  scotland: "GB",
  wales: "GB",
};

/** Codes Intl names that are no country: the EU, the eurozone, the UN, outlying Oceania. */
const NOT_COUNTRIES = new Set(["EU", "EZ", "UN", "QO"]);

let countryIndex: Map<string, string> | null = null;
/**
 * The ISO code of a country written as its code or its name in any of the taxonomy's languages
 * ("pl", "Poland", "Polen", "Pologne"), or null when the words are not certainly one country. An
 * old code is its country's current one ("dd" is Germany, "uk" the United Kingdom).
 */
function countryCodeOf(written: string): string | null {
  if (!written) return null;
  if (!countryIndex) {
    countryIndex = new Map(Object.entries(COUNTRY_ALIASES));
    const names = LANGS.map((lang) => new Intl.DisplayNames([lang], { type: "region" }));
    const A = "A".charCodeAt(0);
    for (let i = 0; i < 26 * 26; i++) {
      const code = String.fromCharCode(A + Math.floor(i / 26), A + (i % 26));
      const canonical = Intl.getCanonicalLocales(`und-${code}`)[0]!.slice(4);
      const english = names[0]!.of(canonical);
      // Intl echoes a code it does not know, and names the reserved ones "Unknown Region".
      if (!english || english === canonical || /unknown/i.test(english)) continue;
      if (NOT_COUNTRIES.has(canonical)) continue;
      countryIndex.set(code.toLowerCase(), canonical);
      for (const n of names) {
        const key = letters(n.of(canonical) ?? "");
        if (key.length > 2) countryIndex.set(key, canonical);
      }
    }
  }
  return countryIndex.get(written) ?? null;
}

// The street line as a form or a model fills it in when nothing is known. "Main Street" counts
// only with a filler number (350 Main Street is a real address), and a bare "123 Street" only
// when that is the whole line (123 St Marks Place is real too).
const FILLER_NUMBER = String.raw`(?:1|123|1234|12345)`;
const STREET = String.raw`(?:st|street|rd|road|ave|avenue|blvd|boulevard|ln|lane|dr|drive|way|pl|place)`;
const PLACEHOLDER_STREET = [
  new RegExp(String.raw`^${FILLER_NUMBER} main ${STREET}(?: |$)`),
  new RegExp(String.raw`^${FILLER_NUMBER} ${STREET}$`),
  new RegExp(
    String.raw`^(?:\d+ )?(?:fake|any|anywhere|example|sample|placeholder|your) ${STREET}(?: |$)`,
  ),
  /^(?:\d+ )?(?:anystreet|anytown|street name|street address|address line(?: \d)?|your address)(?: |$)/,
  /^(?:tba|tbd|tbc|to be (?:announced|determined|confirmed)|n a|na|none|unknown|not listed|address|location|venue|secret location|(?:location|address|venue) (?:tba|tbd|tbc))$/,
];

/**
 * Whether an address is a placeholder rather than a place (D-071): its first part (the street
 * line) is a filler such as "123 Main St", "1 Main Street", "123 Fake St", "Street address" or
 * "TBA". Such an address is never geocoded, stored or searched.
 *
 * The cost, accepted: a real 1 Main Street (DUMBO's Clock Tower, say) is refused too. Its
 * listing is then unplaced and counted in the report, never silently dropped.
 */
export function isPlaceholderAddress(address: string): boolean {
  const line = normalizeAddress(address.split(",")[0] ?? "");
  if (!line) return false;
  return PLACEHOLDER_STREET.some((pattern) => pattern.test(line));
}

export function normalizeAddress(address: string): string {
  return address
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function geoapifyGeocoder(
  http: HttpClient,
  metro: Metro,
  apiKey: string,
  regions: readonly string[] = METRO_REGIONS[metro.slug] ?? [],
): Geocoder & { requests: () => number } {
  type Read = { answer: GeocodeAnswer | null; elsewhere: string | null; refusal: string | null };
  const cache = new Map<string, Promise<Read>>();
  let requests = 0;
  const none: Read = { answer: null, elsewhere: null, refusal: null };
  const readFor = (address: string): Promise<Read> => {
    const key = normalizeAddress(address);
    if (!key || isPlaceholderAddress(address)) return Promise.resolve(none);
    let read = cache.get(key);
    if (!read) {
      requests += 1;
      const cleanedAddress = addressForGeocoder(address);
      read = http
        .request({
          url: geoapifyUrl(cleanedAddress, metro, apiKey),
          purpose: "api",
          intervalMs: 250,
          headers: { accept: "application/json" },
        })
        .then((response) => {
          const body = JSON.parse(response.body) as unknown;
          return {
            answer: geoapifyAnswer(body, metro),
            elsewhere: geoapifyElsewhere(body, metro, regions) ?? geoapifyOutside(body, metro),
            refusal: geoapifyRefusal(body, metro),
          };
        })
        .catch(() => ({ answer: null, elsewhere: null, refusal: "request failed" }));
      cache.set(key, read);
    }
    return read;
  };
  return {
    id: "geoapify",
    requests: () => requests,
    geocode: async (address) => (await readFor(address)).answer?.point ?? null,
    building: async (address) => {
      const { answer } = await readFor(address);
      return answer?.type === "building" ? answer.point : null;
    },
    elsewhere: async (address) =>
      postcodeOutsideMetro(address, metro) ?? (await readFor(address)).elsewhere,
    refusal: async (address) => (await readFor(address)).refusal,
  };
}
