// D-138: a starting source can state its venue's address for listings that name no place.
import type { HarvestedListing } from "@/src/adapters/types";
import { normalizeForMatch } from "@/config/styles";
import type { KnownVenue } from "@/config/known-venues";
import { rawListingSchema } from "@/src/domain/listing";
import { postcodeOf } from "@/src/domain/postcode";
import { isCityOnlyVenue } from "@/src/domain/city-only-venue";
import { sameStreetAddress } from "@/src/domain/dedupe";
import { stripVenuePlaceholder, venueNameCandidates } from "@/src/pipeline/venue-name-fallback";

/** D-506: platform tags a seed label may end with: "Brasil's Nightclub (Our Philly)", "NOTO Events (Eventbrite)". */
const SEED_LABEL_TAGS = [
  "eventbrite",
  "meetup",
  "our philly",
  "dice",
  "fever",
  "sympla",
  "qué hacemos",
  "que hacemos",
  "ticket tailor",
  "skiddle",
  "ra",
  "resident advisor",
  "instagram",
  "facebook",
  "songkick",
  "bandsintown",
  "allevents",
  "shotgun",
  "tockify",
  "google calendar",
];

/** D-506: a seed label without a trailing platform tag: "Brasil's Nightclub (Our Philly)" -> "Brasil's Nightclub". */
export function seedVenueName(label: string): string {
  const trimmed = label.trim();
  const m = /^(.*\S)\s+\(([^()]*)\)$/.exec(trimmed);
  if (!m || !SEED_LABEL_TAGS.includes((m[2] ?? "").trim().toLowerCase())) return trimmed;
  return (m[1] ?? "").trim() || trimmed;
}

export function venueSeedFor<T extends { url: string; venueAddress?: string; venuePage?: boolean }>(
  sourceUrl: string,
  seeds: readonly T[],
): T | undefined {
  // First, try exact URL match
  const exactMatch = seeds.find((seed) => seed.url === sourceUrl);
  if (exactMatch) return exactMatch;

  // Otherwise, try hostname match for seeds with venueAddress and venuePage === true
  try {
    const sourceUrlObj = new URL(sourceUrl);
    const sourceHost = sourceUrlObj.hostname.toLowerCase();
    const sourceHostNoWww = sourceHost.replace(/^www\./, "");

    for (const seed of seeds) {
      if (!seed.venueAddress?.trim() || seed.venuePage !== true) continue;

      try {
        const seedUrlObj = new URL(seed.url);
        const seedHost = seedUrlObj.hostname.toLowerCase();
        const seedHostNoWww = seedHost.replace(/^www\./, "");

        if (sourceHostNoWww === seedHostNoWww) {
          return seed;
        }
      } catch {
        // Invalid seed URL, skip
        continue;
      }
    }
  } catch {
    // Invalid source URL, return undefined
  }
  return undefined;
}

const NO_PLACE_PHRASES = [
  "various venues",
  "various locations",
  "various places",
  "multiple venues",
  "multiple locations",
  "multiple neighborhoods",
  "multiple neighbourhoods",
  "different venues",
  "different locations",
  "venues vary",
  "location varies",
  "rotating venues",
  "rotating locations",
  "varios lugares",
  "varias sedes",
  "varias ubicaciones",
  "diferentes lugares",
  "distintos lugares",
  "por confirmar",
  "a confirmar",
  "por definir",
  "varios locais",
  "a definir",
];
const NO_PLACE = new RegExp(String.raw`^(?:${NO_PLACE_PHRASES.join("|")})(?: |$)`);

/**
 * A venue name or address that says the night has no one place ("Various venues in Mexico City",
 * "Multiple neighborhoods", "Varios lugares", "Por confirmar"): the listing keeps no venue name,
 * address or point, and is listed as "Location not listed" rather than pinned at a city centre (D-280).
 */
export function isNoPlace(text: string | null | undefined): boolean {
  if (!text) return false;
  const normalized = normalizeForMatch(text);
  return NO_PLACE.test(normalized.replace(/\s+/g, " ").trim());
}

/** A venue "name" that is only a street line: "158 Bleecker St", "Rua de Santa Apolónia 59", "C/ Pujades 12". */
function isStreetLine(name: string): boolean {
  const trimmed = name.trim();
  if (hasStreetAddress(trimmed)) return true;
  // Check for street words at the start (case-insensitive)
  const streetWordRegex =
    /^(rua|r\.|avenida|av\.|av|travessa|tv\.|largo|praça|praca|calçada|calcada|estrada|alameda|beco|calle|c\/|carrer|avinguda|avda\.|passeig|rambla|plaza|plaça|street|st\.|road)\s/iu;
  return /\d/.test(trimmed) && streetWordRegex.test(trimmed);
}

/**
 * A listing whose venue name or address is no place (`isNoPlace`) keeps no name, address or point (D-280),
 * as does one whose venue is written only as the city ("London", "London, UK"; D-840).
 */
export function withoutNoPlaceVenue(
  listing: HarvestedListing,
  cityNames: readonly string[] = [],
): HarvestedListing {
  const venue = listing.listing.venue;
  if (
    !isNoPlace(venue.name) &&
    !isNoPlace(venue.address) &&
    !isCityOnlyVenue({ name: venue.name, address: venue.address }, cityNames)
  ) {
    return listing;
  }
  return {
    ...listing,
    listing: {
      ...listing.listing,
      venue: {
        ...venue,
        name: null,
        address: null,
      },
    },
    venueLocation: null,
  };
}

function hasStreetAddress(address: string | null | undefined): boolean {
  const trimmed = address?.trim();
  if (!trimmed) return false;
  // A run of 1-5 digits followed by a space and a letter (e.g., "158 Bleecker", "3608 33rd")
  const streetPattern = /^\d{1,5}\s+[A-Za-z]/;
  return streetPattern.test(trimmed);
}

/**
 * Adjusts a listing's venue based on source-provided room names and the `onlyHere` flag.
 * When the venue name matches a known room, the listing is placed at the source's venue
 * (label) and any non-street address is dropped.
 * When `onlyHere` is true and the listing lacks a street address, the listing is placed
 * at the source's venue regardless of the venue name (room, band, series, or junk address).
 * Also applies known venue matching (withKnownVenue) using the given countryCode (default US).
 */
export function withVenueRooms(
  listing: HarvestedListing,
  seed:
    | { label: string; venueRooms?: readonly string[]; onlyHere?: boolean; venueAddress?: string }
    | undefined,
): HarvestedListing {
  if (!seed) return listing;

  const venue = listing.listing.venue;
  const name = venue.name?.trim();
  const nameNorm = name ? normalizeForMatch(name) : null;

  // 1. Check for room match
  if (seed.venueRooms && seed.venueRooms.length > 0 && nameNorm) {
    for (const room of seed.venueRooms) {
      if (normalizeForMatch(room) === nameNorm) {
        // Room matches: place at source venue, drop any address (even non-empty)
        return {
          ...listing,
          listing: {
            ...listing.listing,
            venue: {
              ...venue,
              name: seedVenueName(seed.label),
              address: null,
            },
          },
        };
      }
    }
  }

  // 2. If onlyHere and the listing does NOT have a street address, or has the venue's own street
  //    address (D-829: Nashville Palace's Wix location made a second venue), place at source venue
  if (
    seed.onlyHere &&
    (!hasStreetAddress(venue.address) ||
      sameStreetAddress(venue.address ?? undefined, seed.venueAddress))
  ) {
    return {
      ...listing,
      // D-832: the listing's own point goes too. The source's venue is found by its name and
      // address; a feed's pin (Nashville Palace's Wix point, 7 km off) matched a second venue row.
      venueLocation: null,
      listing: {
        ...listing.listing,
        venue: {
          ...venue,
          name: seedVenueName(seed.label),
          address: null,
        },
      },
    };
  }

  // 3. Otherwise unchanged
  return listing;
}

function venueNameKey(s: string): string {
  // Normalize for match, collapse whitespace, trim, drop leading "the "
  const normalized = normalizeForMatch(s);
  const collapsed = normalized.replace(/\s+/g, " ").trim();
  return collapsed.replace(/^the /, "");
}

/** D-198: one key is a whole-word prefix of the other ("greyhound" / "greyhound peckham"), shorter >= 4 chars. */
function prefixName(a: string, b: string): boolean {
  const [shorter, longer] = a.length < b.length ? [a, b] : [b, a];
  return shorter.length >= 4 && longer.startsWith(shorter + " ");
}

/**
 * Fills a listing's venue name from a title phrase map when the listing has no venue name,
 * no address, and no map point (D-279). Phrases are compared after normalizeForMatch as whole words.
 * Also fills when the venue name is only a street line or starts with the mapped venue's name
 * ("Galeria Antecâmara - Rua de Cabo Verde 17A"), keeping any address (D-502).
 * When the venue name is empty and the address is area-only (no digits), the title venue replaces the address.
 */
export function withTitleVenue(
  listing: HarvestedListing,
  titleVenues: Readonly<Record<string, string>> | undefined,
  notes?: string[],
): HarvestedListing {
  if (!titleVenues || Object.keys(titleVenues).length === 0) return listing;
  const venue = listing.listing.venue;
  // If the listing already has a map point, we keep it.
  if (listing.venueLocation) {
    return listing;
  }
  const titleNorm = normalizeForMatch(listing.listing.title);
  const paddedTitle = ` ${titleNorm} `;
  for (const [phrase, venueName] of Object.entries(titleVenues)) {
    const phraseNorm = normalizeForMatch(phrase);
    if (!phraseNorm) continue;
    // Whole-word match: pad with spaces to avoid partial matches.
    if (paddedTitle.includes(` ${phraseNorm} `)) {
      const currentName = venue.name?.trim() ?? null;
      const currentAddress = venue.address?.trim() ?? null;
      const venueNameNorm = normalizeForMatch(venueName);
      // 1. Venue name empty AND address empty -> set name to venueName (address stays null)
      if (!currentName && !currentAddress) {
        return {
          ...listing,
          listing: {
            ...listing.listing,
            venue: {
              ...venue,
              name: venueName,
            },
          },
        };
      }
      // 1b. Venue name empty, address non-empty and area-only (no digits) -> set name to venueName, address to null
      if (!currentName && currentAddress && !/\d/.test(currentAddress)) {
        if (notes) {
          const title = listing.listing.title.trim();
          const address = currentAddress;
          notes.push(
            `${title}: area-only address "${address}" replaced by title venue ${venueName}`,
          );
        }
        return {
          ...listing,
          listing: {
            ...listing.listing,
            venue: {
              ...venue,
              name: venueName,
              address: null,
            },
          },
        };
      }
      // 2. Venue name non-empty and normalizeForMatch(name) starts with normalizeForMatch(venueName) followed by space or end
      if (currentName) {
        const currentNameNorm = normalizeForMatch(currentName);
        if (
          currentNameNorm.startsWith(venueNameNorm) &&
          (currentNameNorm.length === venueNameNorm.length ||
            currentNameNorm[venueNameNorm.length] === " ")
        ) {
          return {
            ...listing,
            listing: {
              ...listing.listing,
              venue: {
                ...venue,
                name: venueName,
              },
            },
          };
        }
      }
      // 3. Venue name non-empty and it is a street line
      if (currentName && isStreetLine(currentName)) {
        return {
          ...listing,
          listing: {
            ...listing.listing,
            venue: {
              ...venue,
              name: venueName,
            },
          },
        };
      }
      // 4. Anything else -> unchanged
      return listing;
    }
  }
  return listing;
}

// A listing with no address takes the source's venueAddress when it names no venue or the source's own
// (equal names; on a venuePage source also a short or long form of the label, D-198).
// On a venuePage seed, a listing with a non-street address and empty venue name also gets the seed's address.
export function withSourceVenue(
  listing: HarvestedListing,
  seed: { label: string; venueAddress?: string; venuePage?: boolean } | undefined,
): HarvestedListing {
  const address = seed?.venueAddress?.trim();
  if (!seed || !address) return listing;

  const venue = listing.listing.venue;
  // If the listing already has a non-empty address, keep it
  if (venue.address?.trim()) {
    // D-250: when seed.venuePage === true and the address is not a street address, and the venue name is a street address or matches the label, override
    if (seed.venuePage === true && !hasStreetAddress(venue.address)) {
      const nameIsStreet = hasStreetAddress(venue.name);
      const labelKey = venueNameKey(seedVenueName(seed.label));
      const nameKey = venue.name ? venueNameKey(venue.name) : null;
      const nameMatchesLabel =
        nameKey === labelKey || (seed.venuePage === true && prefixName(nameKey ?? "", labelKey));
      // An unnamed listing on the venue's own page is the venue itself.
      const nameEmpty = !venue.name?.trim();
      if (nameIsStreet || nameMatchesLabel || nameEmpty) {
        return {
          ...listing,
          listing: {
            ...listing.listing,
            venue: {
              ...venue,
              name: nameIsStreet || nameEmpty ? seedVenueName(seed.label) : venue.name,
              address,
            },
          },
        };
      }
    }
    return listing;
  }

  const labelKey = venueNameKey(seedVenueName(seed.label));
  // If the listing names another place, keep it
  if (venue.name?.trim()) {
    const nameKey = venueNameKey(venue.name);
    if (nameKey !== labelKey && !(seed.venuePage === true && prefixName(nameKey, labelKey))) {
      return listing;
    }
  }

  // Otherwise, provide the source's label as name if missing, and set the address
  return {
    ...listing,
    listing: {
      ...listing.listing,
      venue: {
        ...venue,
        name: venue.name?.trim() ? venue.name : seedVenueName(seed.label),
        address,
      },
    },
  };
}

/**
 * The seed's own venue for a listing on its page (D-138, D-226). A source not yet placed at a
 * venue fills the seed's address as `withSourceVenue` does. A source placed at its venue leaves a
 * listing that names no place to that venue (store's `atSourceVenue`), and fills the address into
 * one that names the venue by another form of the label ("EartH Hackney" at "EartH (Evolutionary
 * Arts Hackney)"), so it is placed and not left as "Location not listed".
 * When sourcePlaced is true and the listing has no venue name, we still fill the seed's address
 * if the listing has a non-street address on a venuePage seed.
 */
export function withSeedVenue(
  listing: HarvestedListing,
  seed: { label: string; venueAddress?: string; venuePage?: boolean } | undefined,
  sourcePlaced: boolean,
): HarvestedListing {
  if (!seed) return listing;
  if (sourcePlaced && !listing.listing.venue.name?.trim()) {
    // Don't return early if the listing has a non-street address on a venuePage seed
    const venue = listing.listing.venue;
    if (seed.venuePage === true && venue.address?.trim() && !hasStreetAddress(venue.address)) {
      // Continue to withSourceVenue which will handle this case
    } else {
      return listing;
    }
  }
  return withSourceVenue(listing, seed);
}

function knownVenueKey(s: string): string {
  return normalizeForMatch(s).replace(/^the /, "").trim();
}

/** Apply entry's point to listing if present, otherwise return unchanged listing. */
function applyPoint(listing: HarvestedListing, entry: KnownVenue): HarvestedListing {
  // A canonical entry stores every alias under its first name (D-265).
  const name = entry.canonical ? (entry.names[0] ?? null) : null;
  const named =
    name && listing.listing.venue.name !== name
      ? { ...listing, listing: { ...listing.listing, venue: { ...listing.listing.venue, name } } }
      : listing;
  if (!entry.point) return named;
  return {
    ...named,
    venueLocation: { lat: entry.point.lat, lng: entry.point.lng },
  };
}

function buildHarvestedListingForVenue(venue: {
  name: string | null;
  address: string | null;
}): HarvestedListing | null {
  const parsed = rawListingSchema.safeParse({
    title: "stored",
    listing_type: "social",
    styles: [],
    local_date: "2026-01-01",
    doors_time: null,
    venue: {
      name: venue.name,
      address: venue.address,
      url: null,
    },
    organizer: { name: null, url: null },
  });
  if (!parsed.success) return null;
  return {
    listing: parsed.data,
    externalId: null,
    tz: null,
    venueLocation: null,
    recurrence: null,
    provenance: {
      sourceUrl: "https://stored.invalid/",
      fetchedAt: new Date(0),
      method: "feed",
    },
  };
}

/**
 * The hand-checked venue a stored venue (name and address) names, or null (D-266).
 * Applies the same rules as `withKnownVenue`; null when they leave the venue unchanged.
 */
export function knownVenuePlace(
  venue: { name: string | null; address: string | null },
  known: readonly KnownVenue[] | undefined,
  countryCode: string,
): { name: string | null; address: string; point: { lat: number; lng: number } | null } | null {
  if (!known || known.length === 0) return null;
  const listing = buildHarvestedListingForVenue(venue);
  if (!listing) return null;
  const after = withKnownVenue(listing, known, countryCode);
  const afterAddress = after.listing.venue.address?.trim();
  if (!afterAddress) return null;
  if (afterAddress === venue.address?.trim() && after.venueLocation === null) {
    return null;
  }
  return {
    name: after.listing.venue.name ?? null,
    address: afterAddress,
    point: after.venueLocation
      ? { lat: after.venueLocation.lat, lng: after.venueLocation.lng }
      : null,
  };
}

/** Levenshtein distance of at most 1 (0 or 1). */
function editDistanceAtMost1(a: string, b: string): boolean {
  const lenA = a.length;
  const lenB = b.length;
  // Must differ by at most 1 in length
  if (Math.abs(lenA - lenB) > 1) return false;
  if (lenA === lenB) {
    // Substitution: at most one char differs
    let diff = 0;
    for (let i = 0; i < lenA; i++) {
      if (a[i] !== b[i]) diff++;
      if (diff > 1) return false;
    }
    return true; // diff can be 0 or 1
  }
  // Insertion/deletion: one string is longer by 1
  const [shorter, longer] = lenA < lenB ? [a, b] : [b, a];
  let i = 0;
  let j = 0;
  let diff = 0;
  while (i < shorter.length && j < longer.length) {
    if (shorter[i] !== longer[j]) {
      diff++;
      j++; // skip the extra char in longer
      if (diff > 1) return false;
    } else {
      i++;
      j++;
    }
  }
  // If we reached end of shorter, there's one extra char at end of longer
  if (j < longer.length) diff++;
  return diff === 1;
}

/**
 * The GB outward codes an address gives when every digit in it belongs to one ("WC1X",
 * "King's Cross WC1X", "Brixton, SW2"), upper-cased; null when any other digit is present (a
 * house number, a full postcode) or no outward code is found (D-284).
 */
function gbOutwardCodes(address: string): string[] | null {
  const pattern = /\b([A-Z]{1,2}[0-9][A-Z0-9]?)\b/gi;
  const codes = [...address.matchAll(pattern)].map((m) => m[1]!.toUpperCase());
  if (codes.length === 0) return null;
  if (/\d/.test(address.replace(pattern, ""))) return null;
  return codes;
}

/** Whether the first comma part of two addresses are the same street after normalizing abbreviations. */
function sameStreet(own: string, known: string): boolean {
  const normalizeStreetPart = (s: string): string => {
    // Remove diacritics first
    let normalized = s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
    // Remove dots
    normalized = normalized.replace(/\./g, "");
    // Collapse whitespace
    normalized = normalized.replace(/\s+/g, " ").trim();

    // Strip number sign with optional spaces before a digit
    normalized = normalized.replace(/#\s*(?=\d)/g, " ");
    // Strip number markers: no, n°, nº, no. (the dot already removed)
    normalized = normalized.replace(/\b(?:no|n°|nº)\s*(?=\d)/g, " ");
    // Collapse whitespace again
    normalized = normalized.replace(/\s+/g, " ").trim();

    // Split glued street abbreviation and number: e.g., "cr48" -> "cr 48"
    normalized = normalized.replace(/\b(cra|kra|cr|kr|cll|cl|cq|tv|tr|dg|av|avda)(\d)/g, "$1 $2");

    // Map street-type words (whole words only)
    const streetWordMap: Record<string, string> = {
      cr: "carrera",
      cra: "carrera",
      kr: "carrera",
      kra: "carrera",
      carrera: "carrera",
      cl: "calle",
      cll: "calle",
      calle: "calle",
      cq: "circular",
      circular: "circular",
      tv: "transversal",
      tr: "transversal",
      transv: "transversal",
      transversal: "transversal",
      dg: "diagonal",
      diag: "diagonal",
      diagonal: "diagonal",
      avda: "ave",
      avenida: "ave",
    };

    // Replace whole words
    normalized = normalized.replace(
      /\b(cr|cra|kr|kra|carrera|cl|cll|calle|cq|circular|tv|tr|transv|transversal|dg|diag|diagonal|avda|avenida)\b/g,
      (match) => streetWordMap[match] || match,
    );

    // Apply existing English abbreviations (these run after Colombian mapping)
    normalized = normalized
      .replace(/\bavenue\b/g, "ave")
      .replace(/\bstreet\b/g, "st")
      .replace(/\bboulevard\b/g, "blvd")
      .replace(/\bplace\b/g, "pl")
      .replace(/\broad\b/g, "rd")
      .replace(/\bav\b/g, "ave"); // "av" -> "ave" (San Juan: "Av. Paraná")

    // Final whitespace collapse
    return normalized.replace(/\s+/g, " ").trim();
  };

  // Remove diacritics for accent-insensitive comparison
  const removeDiacritics = (s: string): string => s.normalize("NFD").replace(/\p{M}/gu, "");

  // Extract street part: first comma part that contains a house-number word, skipping postcode+town parts.
  const extractStreetPart = (s: string): string => {
    const parts = s.split(",").map((p) => p.trim());
    // House-number word: digits 1-4 optionally followed by a letter, may have leading '#'
    const houseNumberWordRegex = /(?<![\p{L}\p{N}])#?(\d{1,4}[a-z]?)\b/iu;
    // Postcode+town pattern: 4-5 digits optionally with dash, then whitespace and a letter
    const postcodeTownPattern = /^\d{4,5}(?:-\d{3,4})?\s+\p{L}/u;

    for (const part of parts) {
      // Skip parts that are just postcode + town (e.g., "08030 Barcelona")
      if (postcodeTownPattern.test(part)) continue;
      // Check if part contains a house-number word
      if (houseNumberWordRegex.test(part)) {
        return part;
      }
    }
    // If none found, return first part (as before)
    return parts[0] ?? "";
  };

  const ownPart = extractStreetPart(own);
  const knownPart = extractStreetPart(known);

  const ownNorm = normalizeStreetPart(ownPart);
  const knownNorm = normalizeStreetPart(knownPart);

  // Exact match after normalization
  if (ownNorm === knownNorm) return true;

  // Colombian grid comparison
  const colombianPattern =
    /^(carrera|calle|circular|transversal|diagonal|ave)\s+(\d{1,3}\s?[a-z]?(?:\s(?:bis|sur))?)\s+(\d{1,3}\s?[a-z]?)\s*-\s*(\d{1,3})\b/;
  const ownMatch = colombianPattern.exec(ownNorm);
  const knownMatch = colombianPattern.exec(knownNorm);

  if (ownMatch && knownMatch) {
    // Compare all four groups
    for (let i = 1; i <= 4; i++) {
      const ownGroup = (ownMatch[i] || "").replace(/\s+/g, "");
      const knownGroup = (knownMatch[i] || "").replace(/\s+/g, "");
      if (ownGroup !== knownGroup) {
        return false;
      }
    }
    return true;
  }
  // If only one or neither matches, continue with existing logic

  // Find house numbers in each part (could be anywhere)
  const findHouseNumber = (part: string): string | null => {
    const match = part.match(/(?<![\p{L}\p{N}])#?(\d{1,4}[a-z]?)\b/iu);
    return match?.[1]?.toLowerCase() ?? null;
  };
  const ownHouse = findHouseNumber(ownNorm);
  const knownHouse = findHouseNumber(knownNorm);
  if (!ownHouse || !knownHouse || ownHouse !== knownHouse) return false;

  // Remove house number from both strings for word-by-word comparison
  const ownWithoutNumber = ownNorm.replace(/(?<![\p{L}\p{N}])#?\d{1,4}[a-z]?\b/iu, "").trim();
  const knownWithoutNumber = knownNorm.replace(/(?<![\p{L}\p{N}])#?\d{1,4}[a-z]?\b/iu, "").trim();

  const ownWords = ownWithoutNumber.split(/\s+/).filter((w) => w.length > 0);
  const knownWords = knownWithoutNumber.split(/\s+/).filter((w) => w.length > 0);

  if (ownWords.length !== knownWords.length) return false;
  if (ownWords.length === 0) return true; // only house number present

  // Compare remaining words
  let diffCount = 0;
  let hasEditDistanceAtMost1 = false;
  for (let i = 0; i < ownWords.length; i++) {
    const ownWord = removeDiacritics(ownWords[i]!);
    const knownWord = removeDiacritics(knownWords[i]!);
    if (ownWord !== knownWord) {
      diffCount++;
      if (diffCount > 1) return false;
      // Both words must be at least 5 letters and have edit distance at most 1
      if (ownWord.length >= 5 && knownWord.length >= 5 && editDistanceAtMost1(ownWord, knownWord)) {
        hasEditDistanceAtMost1 = true;
      } else {
        return false;
      }
    }
  }

  // All words match exactly
  if (diffCount === 0) return true;
  // Exactly one pair differs with edit distance at most 1
  return diffCount === 1 && hasEditDistanceAtMost1;
}

/** Country names a town-only address may end with; they say nothing about the town (US, UK, wave-1 cities). */
const TOWN_COUNTRY_WORDS = new Set([
  "united states",
  "usa",
  "us",
  "united kingdom",
  "uk",
  "england",
  "gb",
  "portugal",
  "pt",
  "spain",
  "españa",
  "espanya",
  "es",
  "brazil",
  "brasil",
  "br",
  "mexico",
  "méxico",
  "mx",
  "argentina",
  "ar",
  "puerto rico",
  "pr",
  // Salsa Vida writes "Berlin, Germany" (Havanna, read 2026-11-08).
  "germany",
  "deutschland",
]);

/** Whether every non-country part of a town-only address appears as a whole word in the known address. */
function townMatches(own: string, known: string, areas: readonly string[] = []): boolean {
  const areaKeys = areas.map((a) => a.trim().toLowerCase());
  const ownParts = own
    .split(",")
    .map((p) => p.trim().toLowerCase())
    .filter((p) => p.length > 0)
    .filter((p) => !TOWN_COUNTRY_WORDS.has(p));
  if (ownParts.length === 0) {
    return true;
  }
  const knownLower = known.toLowerCase();
  return ownParts.every((part) => {
    // A neighbourhood the known venue lists stands for its street address.
    if (areaKeys.includes(part)) return true;
    const expandedParts =
      part === "ny" ? ["ny", "new york"] : part === "new york" ? ["new york", "ny"] : [part];
    return expandedParts.some((expandedPart) => {
      const escaped = expandedPart.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      // Letter-aware edges: \b treats accented letters as non-word ("Ave. Paraná", SJ 2026-10-29).
      const regex = new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "iu");
      return regex.test(knownLower);
    });
  });
}

/**
 * Places a listing that names a known venue but gives no address at that venue's checked
 * street address (config/known-venues.ts). The name is compared whole and by the part before
 * its first comma, so "The Last Word, Astoria" matches "The Last Word". Only whole names match,
 * never prefixes or substrings. The listing's own name is kept as written.
 * A listing that already has an address takes the checked one when:
 * 1. Both carry the same postcode (US: five-digit ZIP, dropping +4; GB: outward+inward code).
 * 2. The listing's address has no postcode and contains no digits (town-only). It is taken if every
 *    comma-separated part of the listing's address (excluding "united states", "usa", "us",
 *    "united kingdom", "uk", "england", "gb") appears as a whole word in the known address,
 *    with "new york" matching "NY" and vice versa.
 *    A part naming one of the venue's `areas` matches too ("DROM", "East Village, NY, US").
 * 3. The listing's address has no postcode but has digits. It is taken if the first comma part of
 *    the listing's address (street) equals the first comma part of the known address after
 *    normalizing street abbreviations (avenue->ave, street->st, boulevard->blvd, place->pl, road->rd).
 * 4. When no entry matches by name, and the listing's venue name or address text contains a street
 *    phrase listed in the venue's `streets` (whole words, case-insensitive, after the same
 *    abbreviation normalising), and the listing's postcode (if any) matches the venue's postcode
 *    (GB: the same outward code is enough, D-220),
 *    the listing is placed at that venue. The venue name is kept as written; if it was null,
 *    empty, or held the street phrase itself (D-220), it is set to the venue's first name. Exactly one entry must match; zero or multiple
 *    matches leave the listing unchanged.
 * Otherwise the listing's own address is kept.
 */
export function restateVenue(
  venue: { name: string | null; address: string | null },
  context: {
    sourceUrl: string;
    /** The source row's own venue_id: when set, `venueAddress` is not applied (as in ingest.ts). */
    sourceHasVenue: boolean;
    seeds: readonly {
      url: string;
      label: string;
      venueAddress?: string;
      venuePage?: boolean;
      venueRooms?: readonly string[];
      onlyHere?: boolean;
    }[];
    known: readonly KnownVenue[] | undefined;
    countryCode?: string;
  },
): { name: string | null; address: string | null } {
  // Build a minimal HarvestedListing to pass to the existing functions
  const parsed = rawListingSchema.safeParse({
    title: "stored",
    listing_type: "social",
    styles: [],
    local_date: "2026-01-01",
    doors_time: null,
    venue: {
      name: venue.name,
      address: venue.address,
      url: null,
    },
    organizer: { name: null, url: null },
  });
  // A stored venue the schema refuses (an over-long name) is placed as stored.
  if (!parsed.success) return { name: venue.name, address: venue.address };
  const listing: HarvestedListing = {
    listing: parsed.data,
    externalId: null,
    tz: null,
    venueLocation: null,
    recurrence: null,
    provenance: {
      sourceUrl: context.sourceUrl,
      fetchedAt: new Date(0),
      method: "feed",
    },
  };

  // 1. Apply withVenueRooms
  const seed = context.seeds.find((s) => s.url === context.sourceUrl);
  let afterRooms = withVenueRooms(listing, seed);

  // 2. Apply withSourceVenue if source doesn't already have a venue
  if (!context.sourceHasVenue) {
    const venueSeed = venueSeedFor(context.sourceUrl, context.seeds);
    afterRooms = withSourceVenue(afterRooms, venueSeed);
  }

  // 3. Apply withKnownVenue
  const afterKnown = withKnownVenue(afterRooms, context.known, context.countryCode ?? "US");

  // Return the resulting venue fields
  return {
    name: afterKnown.listing.venue.name ?? null,
    address: afterKnown.listing.venue.address ?? null,
  };
}

export function withKnownVenue(
  listing: HarvestedListing,
  known: readonly KnownVenue[] | undefined,
  countryCode: string = "US",
): HarvestedListing {
  if (!known || known.length === 0) return listing;

  const venue = listing.listing.venue;

  const name = venue.name?.trim();
  const wholeKey = name ? knownVenueKey(name) : null;
  const headKey = name ? knownVenueKey(name.split(",")[0] ?? name) : null;

  const entryByName = name
    ? known.find((candidate) =>
        candidate.names.some((entryName) => {
          const entryKey = knownVenueKey(entryName);
          return entryKey === wholeKey || entryKey === headKey;
        }),
      )
    : null;
  if (entryByName) {
    const entry = entryByName;
    const own = venue.address?.trim();
    if (own) {
      if (own === entry.address) return applyPoint(listing, entry);
      const ownZip = postcodeOf(own, countryCode);
      const entryZip = postcodeOf(entry.address, countryCode);
      if (ownZip !== null && entryZip !== null && ownZip === entryZip) {
        // Rule 1: same postcode -> take checked address
        return takeChecked(listing, venue, entry.address, entry);
      }
      if (ownZip === null) {
        // No postcode in listing's address
        if (!/\d/.test(own)) {
          // Rule 2: town-only address
          if (townMatches(own, entry.address, entry.areas)) {
            return takeChecked(listing, venue, entry.address, entry);
          }
          // No match -> keep own address
          return listing;
        } else {
          // GB: words plus a bare outward code ("King's Cross WC1X") name a district, not a
          // street: the entry's own outward code decides (D-284).
          if (countryCode === "GB" && entryZip !== null) {
            const outwards = gbOutwardCodes(own);
            if (outwards !== null) {
              const entryOutward = entryZip.replace(/\s+/g, "").slice(0, -3).toUpperCase();
              return outwards.includes(entryOutward)
                ? takeChecked(listing, venue, entry.address, entry)
                : listing;
            }
          }
          // Rule 3: has digits but no postcode
          if (sameStreet(own, entry.address)) {
            return takeChecked(listing, venue, entry.address, entry);
          }
          // Different street -> keep own, unless the entry's streets match
          if (entry.streets && entry.streets.some((s) => streetPhraseIn(own, s))) {
            return takeChecked(listing, venue, entry.address, entry);
          }
          return listing;
        }
      }
      // Has postcode but different -> keep own, unless the entry's streets match
      if (entry.streets && entry.streets.some((s) => streetPhraseIn(own, s))) {
        return takeChecked(listing, venue, entry.address, entry);
      }
      return listing;
    }
    // No address in listing -> take checked address
    return takeChecked(listing, venue, entry.address, entry);
  }

  // No entry matched by name: try name fallback (D-559)
  if (
    !entryByName &&
    !venue.address?.trim() &&
    (listing.venueLocation === null ||
      (listing.venueLocation.lat === 0 && listing.venueLocation.lng === 0))
  ) {
    const candidates = venueNameCandidates(venue.name ?? null, listing.listing.title);
    const matchingEntries: KnownVenue[] = [];
    for (const candidate of candidates) {
      for (const entry of known) {
        const matches = entry.names.some(
          (entryName) => knownVenueKey(entryName) === knownVenueKey(candidate),
        );
        if (matches && !matchingEntries.includes(entry)) {
          matchingEntries.push(entry);
        }
      }
    }
    if (matchingEntries.length === 1) {
      const entry = matchingEntries[0]!;
      // Determine whether to keep original name or use entry's first name
      const originalName = venue.name?.trim() ?? "";
      const placeholderStripped =
        originalName !== "" && stripVenuePlaceholder(originalName) !== null;
      const newName =
        !originalName || placeholderStripped ? (entry.names[0] ?? null) : originalName;
      const named = {
        ...venue,
        name: newName,
      };
      return takeChecked(listing, named, entry.address, entry);
    }
  }

  // No entry matched by name: try street matching (rule 4)
  const textParts: string[] = [];
  if (venue.name?.trim()) textParts.push(venue.name.trim());
  if (venue.address?.trim()) textParts.push(venue.address.trim());
  const text = textParts.join(" , ").toLowerCase();
  if (!text) return listing;

  const candidates = known.filter((candidate) => candidate.streets && candidate.streets.length > 0);
  const matchingEntries: KnownVenue[] = [];

  for (const candidate of candidates) {
    // If the listing's address has a postcode, it must match the candidate's postcode
    const listingPostcode = venue.address ? postcodeOf(venue.address, countryCode) : null;
    const candidatePostcode = postcodeOf(candidate.address, countryCode);
    if (
      listingPostcode !== null &&
      candidatePostcode !== null &&
      !sameStreetPostcode(listingPostcode, candidatePostcode, countryCode)
    ) {
      continue;
    }

    // Check each street phrase
    for (const street of candidate.streets!) {
      // Normalize street phrase: same abbreviation normalization as sameStreet
      const normalizeStreetPhrase = (s: string): string => {
        return s
          .toLowerCase()
          .replace(/\./g, "")
          .replace(/\s+/g, " ")
          .trim()
          .replace(/\bavenue\b/g, "ave")
          .replace(/\bstreet\b/g, "st")
          .replace(/\bboulevard\b/g, "blvd")
          .replace(/\bplace\b/g, "pl")
          .replace(/\broad\b/g, "rd");
      };
      const normStreet = normalizeStreetPhrase(street);
      // Also normalize the text for abbreviations
      const normText = normalizeStreetPhrase(text);
      // Escape regex metacharacters
      const escaped = normStreet.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "iu");
      if (regex.test(normText)) {
        // D-879: an entry with no house number on the street ("Hanbury Street, London E1 5JP", Kizuna) does not
        // take a listing that gives one ("15 Hanbury Street": Juju's, Ely's Yard): that is another door.
        const numbered = new RegExp(
          `(?<![\\p{L}\\p{N}])\\d{1,5}[a-z]?\\s+${escaped}(?![\\p{L}\\p{N}])`,
          "iu",
        );
        if (numbered.test(normText) && !numbered.test(normalizeStreetPhrase(candidate.address))) {
          continue;
        }
        matchingEntries.push(candidate);
        break; // one street match per candidate is enough
      }
    }
  }

  const entry = matchingEntries.length === 1 ? matchingEntries[0] : undefined;
  if (entry) {
    const newVenue = { ...venue };
    // Keep the name as written; if it was null/empty, or it was the street itself (a feed's LOCATION
    // directions in the name, D-220), set to entry's first name
    const nameIsStreet = (entry.streets ?? []).some((street) =>
      streetPhraseIn(venue.name ?? "", street),
    );
    if (!newVenue.name?.trim() || nameIsStreet) {
      newVenue.name = entry.names[0] ?? null;
    }
    newVenue.address = entry.address;
    const newListing = {
      ...listing,
      listing: {
        ...listing.listing,
        venue: newVenue,
      },
    };
    return applyPoint(newListing, entry);
  }

  // Zero or multiple matches: return unchanged
  return listing;
}

/** The closed known venue a listing is placed at, or null (D-263). Call it on the listing after withKnownVenue. */
export function closedKnownVenue(
  listing: HarvestedListing,
  known: readonly KnownVenue[] | undefined,
): KnownVenue | null {
  if (!known || known.length === 0) return null;
  const address = listing.listing.venue.address?.trim();
  if (!address) return null;
  for (const entry of known) {
    const closed = entry.closed?.trim();
    if (closed && closed.length > 0 && address === entry.address) {
      return entry;
    }
  }
  return null;
}

/** Whether `street` appears as whole words in `text`, after rule 4's abbreviation normalising. */
function streetPhraseIn(text: string, street: string): boolean {
  const norm = (s: string): string =>
    s
      .toLowerCase()
      .replace(/\./g, "")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\bavenue\b/g, "ave")
      .replace(/\bstreet\b/g, "st")
      .replace(/\bboulevard\b/g, "blvd")
      .replace(/\bplace\b/g, "pl")
      .replace(/\broad\b/g, "rd")
      .replace(/\bav\b/g, "ave") // Consistent with sameStreet normalization
      // UK and US street types written short on one side ("3 Thorpe Cl" for Thorpe Close, UNDR, D-789).
      .replace(/\bclose\b/g, "cl")
      .replace(/\blane\b/g, "ln")
      .replace(/\bdrive\b/g, "dr")
      .replace(/\bcourt\b/g, "ct")
      .replace(/\bsquare\b/g, "sq")
      .replace(/\bcrescent\b/g, "cres")
      .replace(/\bterrace\b/g, "ter")
      .replace(/\bgardens\b/g, "gdns");
  const escaped = norm(street).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "iu").test(norm(text));
}

/** Rule 4's postcode check: US ZIPs must be equal; a GB postcode need only share its outward code
 * ("NW5 1EL" and "NW5 1HE"), since the street already matched and organisers write a nearby inward code (D-220). */
function sameStreetPostcode(own: string, known: string, countryCode: string): boolean {
  if (countryCode !== "GB") return own === known;
  return own.slice(0, -3) === known.slice(0, -3);
}

function takeChecked(
  listing: HarvestedListing,
  venue: HarvestedListing["listing"]["venue"],
  checkedAddress: string,
  entry?: KnownVenue,
): HarvestedListing {
  const newListing = {
    ...listing,
    listing: {
      ...listing.listing,
      venue: {
        ...venue,
        address: checkedAddress,
      },
    },
  };
  return entry ? applyPoint(newListing, entry) : newListing;
}
