// The listing view model the UI reads (SPEC section 2, DESIGN sections 6 and 7) and the
// extraction output the AI pipeline produces (PLAN section 8.2). Both are zod schemas because
// they sit at boundaries: the repository hands `Listing` to pages and the API, and the
// extraction schema validates LLM output. Unknown is null everywhere ("Not listed"); only
// http(s) URLs survive.

import { z } from "zod";

import { FAMILY_KEYS, STYLE_KEYS, familyOf, type FamilyKey, type StyleKey } from "@/config/styles";
import { LISTING_TYPE_KEYS, listingTypeKeySchema } from "@/src/domain/listing-types";
import { nightDateSchema } from "@/src/domain/tonight";
import { zoneSchema } from "@/src/domain/time";
import { hanTimeTokens } from "@/src/domain/zh-time";

export const httpUrlSchema = z.url({ protocol: /^https?$/ });

/** A URL field where anything that is not http(s) reads as "not listed". */
export const optionalHttpUrl = z.preprocess((value) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  // D-777: two links run together ("https://sevn.ly/xOhttps://www.sevenrooms.com/...") are not listed.
  if (/[A-Za-z0-9]https?:\/\//i.test(trimmed)) return null;
  return httpUrlSchema.safeParse(trimmed).success ? trimmed : null;
}, httpUrlSchema.nullable());

export const styleKeySchema = z.enum(STYLE_KEYS);
export const familyKeySchema = z.enum(FAMILY_KEYS);

export const pointSchema = z.object({
  lat: z.number().finite().min(-90).max(90),
  lng: z.number().finite().min(-180).max(180),
});
export type Point = z.infer<typeof pointSchema>;

export const priceSchema = z.object({
  /** "Door", "Advance", "Lesson only", "Lesson plus social", ... as listed. */
  label: z.string().min(1),
  /** null for free-form prices such as "donation"; 0 for free. */
  amount: z.number().finite().min(0).nullable(),
  /** ISO 4217. */
  currency: z.string().length(3),
  includes: z.string().nullable().default(null),
});
export type ListingPrice = z.infer<typeof priceSchema>;

export const musicSchema = z.object({
  djs: z.array(z.string().min(1)),
  bands: z.array(z.string().min(1)),
  genreMix: z.string().nullable(),
  /** True for a live band, musicians or an orchestra; false for DJs or recorded music; null when not listed. */
  liveMusic: z.boolean().nullable(),
});
export type ListingMusic = z.infer<typeof musicSchema>;

export const confirmationSchema = z.enum([
  "confirmed_today",
  "recurring_unconfirmed",
  "conflicting",
  "cancelled",
]);
export type Confirmation = z.infer<typeof confirmationSchema>;

export const listingStatusSchema = z.enum(["active", "cancelled", "merged", "removed"]);

export const venueKindSchema = z.enum([
  "night_club",
  "dance_hall",
  "studio",
  "bar",
  "restaurant",
  "community_center",
  "outdoor",
  "other",
]);
export const danceFloorSchema = z.enum(["yes", "no", "unknown"]);

export const listingVenueSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  location: pointSchema,
  address: z
    .object({
      line1: z.string().nullable().default(null),
      line2: z.string().nullable().default(null),
      locality: z.string().nullable().default(null),
      region: z.string().nullable().default(null),
      postcode: z.string().nullable().default(null),
      countryCode: z.string().nullable().default(null),
      formatted: z.string().nullable().default(null),
    })
    .nullable(),
  neighborhood: z.string().nullable(),
  /** Google's place ID when one has been resolved (D-014): the exact listing the map links open. */
  googlePlaceId: z.string().min(1).nullable().default(null),
  kind: venueKindSchema,
  danceFloor: danceFloorSchema,
});
export type ListingVenue = z.infer<typeof listingVenueSchema>;

export const listingOrganizerSchema = z.object({
  name: z.string().min(1),
  websiteUrl: httpUrlSchema.nullable(),
  /** Social links, keyed by network ("instagram", "facebook", ...). */
  socials: z.record(z.string(), httpUrlSchema),
});
export type ListingOrganizer = z.infer<typeof listingOrganizerSchema>;

/**
 * Where a source's copy of a listing lives, which the card's confirmation line names (D-072):
 * the organiser's own site or feed (trust tier first_party), a ticket seller's page (ticketing:
 * Ticketmaster, Eventbrite, TicketWeb), or any other listing (a directory, a search result, an
 * unofficial page). A ticket seller is not the organiser, so the card says which of the two it was.
 */
export const sourceTierSchema = z.enum(["organizer", "ticketing", "listing"]);
export type SourceTier = z.infer<typeof sourceTierSchema>;

export const listingSourceSchema = z
  .object({
    url: httpUrlSchema,
    /** Short label, normally the host ("frimframjam.com"). */
    label: z.string().min(1),
    checkedAt: z.date(),
    /**
     * True when the organiser published this listing: their own site or feed, or their ticket
     * page (tier organizer or ticketing). A directory, a search result or an unofficial page is
     * not the organiser, so a card never says a night was confirmed on one (D-061, D-072).
     */
    byOrganiser: z.boolean(),
    /** Which of those it was, or neither ("listing"); byOrganiser is true exactly when not. */
    tier: sourceTierSchema,
    /**
     * This source's own page for this one event (D-073): an event page a feed or API names, the
     * link a page read found beside the listing's title, or the source's URL itself when the source
     * is the event's page. Null when the source only lists the night among others.
     */
    eventUrl: httpUrlSchema.nullable(),
    /** When sources disagree, this source's own value per field, formatted for display. */
    values: z.record(z.string(), z.string()).optional(),
  })
  .refine((source) => source.byOrganiser === (source.tier !== "listing"), {
    message: "byOrganiser must be true exactly for the organizer and ticketing tiers",
    path: ["byOrganiser"],
  });
export type ListingSource = z.infer<typeof listingSourceSchema>;

export const liveStatusSchema = z.object({
  /** time_not_listed: the night is known and the start is not (D-060); never a countdown. */
  kind: z.enum(["upcoming", "on_now", "ending", "ended", "cancelled", "time_not_listed"]),
  text: z.string(),
  endNotListed: z.boolean(),
});

/** One listing as the card and the detail page read it. Filled per query: distanceKm, liveStatus. */
export const listingSchema = z
  .object({
    id: z.string().min(1),
    slug: z.string().min(1),
    title: z.string().min(1),
    listingType: listingTypeKeySchema,
    styles: z.array(styleKeySchema),
    /** Families of `styles`, in order of first appearance. Derived, never stored. */
    families: z.array(familyKeySchema),
    doorsAt: z.date().nullable(),
    lessonAt: z.date().nullable(),
    dancingAt: z.date().nullable(),
    endsAt: z.date().nullable(),
    /**
     * coalesce(dancingAt, lessonAt, doorsAt) (D-004). Null when the source lists a date and no
     * time: shown as "Time not listed", never given an invented start (D-060).
     */
    startsAt: z.date().nullable(),
    /** The night this listing is on. For a listing whose time is not listed, the only date fact. */
    nightDate: nightDateSchema,
    tz: zoneSchema,
    venue: listingVenueSchema.nullable(),
    organizer: listingOrganizerSchema.nullable(),
    prices: z.array(priceSchema),
    isFree: z.boolean().nullable(),
    ticketUrl: httpUrlSchema.nullable(),
    level: z.string().nullable(),
    partnerRequired: z.boolean().nullable(),
    ageMin: z.number().int().min(0).nullable(),
    dressCode: z.string().nullable(),
    floor: z.string().nullable(),
    indoorOutdoor: z.enum(["indoor", "outdoor", "both"]).nullable(),
    music: musicSchema.nullable(),
    crowdSizeHint: z.string().nullable(),
    /** "Every Thursday", or null for a one-off. */
    recurrenceText: z.string().nullable(),
    confirmation: confirmationSchema,
    confidence: z.number().min(0).max(1).nullable(),
    /** Our own 2 to 3 sentence summary from structured facts; never source text. */
    summary: z.string().nullable(),
    sources: z.array(listingSourceSchema),
    status: listingStatusSchema,
    canonicalUrl: httpUrlSchema.nullable(),
    /**
     * When the daily check last found this card's own link broken (ISO instant, D-768); null or
     * absent while it works or has not been checked. The card stays listed and says so.
     */
    linkBrokenAt: z.string().datetime().nullable().optional(),
    /** Great-circle distance from the query point; null when no point was given. */
    distanceKm: z.number().min(0).nullable(),
    /** The status sentence for the query's "now"; null when no "now" was given. */
    liveStatus: liveStatusSchema.nullable(),
  })
  .refine((l) => l.styles.every((s) => l.families.includes(familyOf(s))), {
    message: "families must cover every style",
    path: ["families"],
  })
  .refine(
    (l) =>
      (l.startsAt?.getTime() ?? null) ===
      ((l.dancingAt ?? l.lessonAt ?? l.doorsAt)?.getTime() ?? null),
    { message: "startsAt must be coalesce(dancingAt, lessonAt, doorsAt)", path: ["startsAt"] },
  );
export type Listing = z.infer<typeof listingSchema>;

/**
 * A listing whose venue is placed: the only kind with a map pin, a distance, directions, map links
 * and Event JSON-LD. A listing with no venue is shown as "Location not listed" (D-082).
 */
export type PlacedListing = Listing & { venue: ListingVenue };

export function isPlaced(listing: Listing): listing is PlacedListing {
  return listing.venue !== null;
}

/**
 * Whether the organiser confirmed this listing for its night: a dated listing with a time, backed
 * by the organiser's own page or ticket page (D-060 point 5, D-061). The card's "On the
 * organizer's page" and "On the ticket page" lines (D-072) and the filter that keeps only those
 * cards all read this, so they cannot disagree.
 */
export function isConfirmedByOrganiser(listing: Listing): boolean {
  return (
    listing.startsAt !== null &&
    listing.confirmation === "confirmed_today" &&
    listing.sources.some((source) => source.byOrganiser)
  );
}

/** Families of a style list, in order of first appearance. */
export function familiesOf(styles: readonly StyleKey[]): FamilyKey[] {
  const families: FamilyKey[] = [];
  for (const style of styles) {
    const family = familyOf(style);
    if (!families.includes(family)) families.push(family);
  }
  return families;
}

// ---------------------------------------------------------------------------------------------
// Extraction output (PLAN section 8.2). Every field the page may state, null when it does not.

/** "HH:MM" wall-clock time on the listing's local date; a time before 06:00 belongs to the same night. */
export const localTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "expected HH:MM");

const CLOCK_24 = /^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/;
const CLOCK_12 = /^(\d{1,2})(?:[:.]([0-5]\d))?\s*([ap])\.?\s*m\.?$/;
/** An hour-suffix 24-hour time (D-229): "22h", "22h30", "22 hs", "21.30 hs", "22:00 hrs", "21 horas". */
const CLOCK_H = /^([01]?\d|2[0-3])(?:(?:[:.h])([0-5]\d))?\s*(?:h|hs|hrs?|horas?)?\.?$/;
/** German "Uhr": "22 Uhr", "22.00 Uhr", "ab 22 Uhr" (leading "ab " optional) */
const CLOCK_UHR = /^(?:ab\s+)?(\d{1,2})(?:[.:](\d{2}))?\s*uhr$/i;

/** One time on its own: a 24-hour HH:MM, a 12-hour time with am/pm, noon or midnight, or hour-suffix form. */
function readOneTime(text: string): string | null {
  if (text === "noon") return "12:00";
  if (text === "midnight") return "00:00";
  // Chinese times
  if (/\p{Script=Han}/u.test(text)) {
    const tokens = hanTimeTokens(text);
    const t = tokens[0];
    if (tokens.length === 1 && t && t.mer !== null) {
      // Check that the token covers the whole trimmed text, allowing for a label like "時間："
      const before = text.slice(0, t.at).trim();
      const after = text.slice(t.end).trim();
      // Allow before to be empty or end with "：" or ":"
      const allowedBefore = before === "" || /[：:]$/.test(before);
      if (allowedBefore && after === "") {
        // Convert to 24-hour hour
        const h24 = t.mer === "am" || t.mer === "pm" ? (t.h % 12) + (t.mer === "pm" ? 12 : 0) : t.h;
        const hh = String(h24).padStart(2, "0");
        const mm = String(t.m).padStart(2, "0");
        return `${hh}:${mm}`;
      }
    }
  }
  const clock = CLOCK_24.exec(text);
  if (clock) return `${clock[1]}:${clock[2]}`;
  const twelve = CLOCK_12.exec(text);
  if (twelve) {
    const hour = Number(twelve[1]);
    if (hour < 1 || hour > 12) return null;
    const hour24 = (hour % 12) + (twelve[3] === "p" ? 12 : 0);
    return `${String(hour24).padStart(2, "0")}:${twelve[2] ?? "00"}`;
  }
  // An "h" separator or suffix is required: a bare "22" stays unread (D-229).
  const suffixed = text.includes("h") ? CLOCK_H.exec(text) : null;
  if (suffixed?.[1]) return `${suffixed[1].padStart(2, "0")}:${suffixed[2] ?? "00"}`;
  // German "Uhr" times
  const uhr = CLOCK_UHR.exec(text);
  if (uhr) {
    const hour = Number(uhr[1]);
    if (hour < 0 || hour > 23) return null;
    const minute = uhr[2] ? Number(uhr[2]) : 0;
    if (minute > 59) return null;
    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  }
  return null;
}

/** "8pm-1am", "8:30pm - 12:30am", "8 PM – 1 AM", "8pm to 1am": the two sides of a range. */
const RANGE = /^(.+?)\s*(?:-|–|—|\bto\b|\buntil\b|\btill?\b)\s*(.+)$/;

/**
 * One side of a range, read only when it says which half of the day it is in by itself: am/pm,
 * noon or midnight. A 24-hour HH:MM counts when the range is plainly in 24-hour form (one of its
 * two sides reads 00:xx or 13:00 and later). "8:30 - 12:30" says neither, so neither side is read.
 */
function readRangeSide(side: string, other: string): string | null {
  const clock = CLOCK_24.exec(side);
  if (clock) {
    const plainly24 = (text: string) => {
      const m = CLOCK_24.exec(text);
      return m !== null && (Number(m[1]) === 0 || Number(m[1]) >= 13);
    };
    return plainly24(side) || plainly24(other) ? `${clock[1]}:${clock[2]}` : null;
  }
  // An hour-suffix side ("03h") says it is 24-hour by itself; readOneTime reads it (D-229).
  // Also, if the other side ends with "Uhr", treat this side as 24-hour (German "20 - 2 Uhr")
  const otherHasUhr = /\buhr\b/i.test(other);
  if (otherHasUhr) {
    // Try reading this side as a 24-hour time
    const uhrMatch = CLOCK_UHR.exec(side.toLowerCase());
    if (uhrMatch) {
      const hour = Number(uhrMatch[1]);
      if (hour >= 0 && hour <= 23) {
        const minute = uhrMatch[2] ? Number(uhrMatch[2]) : 0;
        if (minute <= 59) {
          return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
        }
      }
    }
    // If not matching CLOCK_UHR, try reading as bare hour
    const bare = /^(\d{1,2})$/.exec(side);
    if (bare) {
      const hour = Number(bare[1]);
      if (hour >= 0 && hour <= 23) {
        return `${String(hour).padStart(2, "0")}:00`;
      }
    }
  }
  return readOneTime(side);
}

function rangeSides(text: string): { start: string; end: string } | null {
  // No stated time or range is anywhere near this long; a longer reply is not read, which also
  // keeps the range pattern from backtracking over a long run of spaces (review, 2026-09-28).
  if (text.length > 40) return null;
  const m = RANGE.exec(text);
  if (!m || !m[1] || !m[2]) return null;
  return { start: m[1].trim(), end: m[2].trim() };
}

/**
 * A stated time as HH:MM, or null when it cannot be read without guessing. Models write "7:30 PM"
 * and "19:30:00" even when asked for HH:MM (ingest run 15 lost two whole pages to one such
 * field each), so the unambiguous forms are converted: a 12-hour time with am/pm, seconds, noon
 * and midnight, and hour-suffix 24-hour forms ("22h", "22h30", "22 hs"). "7:30" with no am/pm is
 * ambiguous for an evening event and becomes null rather than a guess; the field's evidence quote
 * still says what the page wrote.
 *
 * A range is read by its start when the start states its own half of the day ("8pm-1am" and
 * "8 PM – 1 AM" read 20:00, "8:30pm - 12:30am" reads 20:30); "8:30 - 12:30" and "8-11pm" stay
 * null, and the listing shows "Time not listed" (D-060 point 10).
 */
export function normalizeStatedTime(value: string): string | null {
  const text = value.trim().toLowerCase();
  const one = readOneTime(text);
  if (one !== null) return one;
  const sides = rangeSides(text);
  return sides ? readRangeSide(sides.start, sides.end) : null;
}

/**
 * An end time as HH:MM. The same forms as `normalizeStatedTime`, except that a range is read by
 * its end ("8pm-1am" ends at 01:00): reading a range's start into the end field would put the end
 * at the start and push it a day later (normalize's next-morning rule).
 */
export function normalizeStatedEndTime(value: string): string | null {
  const text = value.trim().toLowerCase();
  const one = readOneTime(text);
  if (one !== null) return one;
  const sides = rangeSides(text);
  return sides ? readRangeSide(sides.end, sides.start) : null;
}

/** A listing time as the page states it, normalized by `normalizeStatedTime`. */
const statedTimeSchema = z.string().transform(normalizeStatedTime).nullable().default(null);
/** A listing end time as the page states it, normalized by `normalizeStatedEndTime`. */
const statedEndTimeSchema = z.string().transform(normalizeStatedEndTime).nullable().default(null);

/** The evidence snippet cap (D-009): longer quotes are cut, not rejected. */
export const EVIDENCE_MAX_CHARS = 300;

// ---------------------------------------------------------------------------------------------
// Lenient readers (D-057). With no grammar holding the model to the schema (D-056), it writes ""
// for an unknown, a price as "$20", a date in words, or leaves out an empty list. Each of those
// used to fail the whole page. A field that cannot be read now becomes unknown (null, or an empty
// list), never a guess; the listing's required facts are still validated.

/** "" and whitespace are unknown, not a value. */
/**
 * The words a model writes for "nothing" where a field has no value: SOB's read came back with
 * recurrence_text "null" on three listings, which the grounding check then looked for on the page
 * and rejected them for (run 28). Read as unknown, like a blank.
 */
const NOTHING_WORDS = new Set(["null", "none", "n/a", "na", "undefined", "unknown", "not listed"]);

/**
 * A number in a text field ("floor": 2) is the page's words in another type: keep it as text.
 */
function blankToNull(value: unknown): unknown {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  return trimmed === "" || NOTHING_WORDS.has(trimmed.toLowerCase()) ? null : value;
}

/** A value outside `allowed` is unknown. */
function oneOfOrNull(allowed: readonly string[]) {
  return (value: unknown): unknown =>
    typeof value === "string" && allowed.includes(value) ? value : null;
}

/** true/false, or the words for them; anything else is unknown. */
function booleanOrNull(value: unknown): unknown {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return null;
  const word = value.trim().toLowerCase();
  if (["true", "yes"].includes(word)) return true;
  if (["false", "no"].includes(word)) return false;
  return null;
}

/** A number, or a string that is one number with an optional currency sign ("$20", "20.00"). */
function numberOrNull(value: unknown): unknown {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const match = /^\s*[^\d\s-]{0,3}\s*(\d+(?:[.,]\d{1,2})?)\s*$/.exec(value);
  return match ? Number(match[1]!.replace(",", ".")) : null;
}

/** A list, or nothing: a missing or wrong-typed list is an empty one. */
function arrayOrEmpty(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** A list of non-blank names; anything else in it is left out. */
function namesOnly(value: unknown): string[] {
  return arrayOrEmpty(value).filter(
    (name): name is string => typeof name === "string" && name.trim() !== "",
  );
}

/** Text as written; a list of words is joined, and any other kind of value is not listed. */
function textOrNull(value: unknown): unknown {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    const words = value.filter(
      (item): item is string => typeof item === "string" && item.trim() !== "",
    );
    return words.length > 0 ? words.join(", ") : null;
  }
  return null;
}

/** Keeps the entries of a map whose values pass `keep`; the rest are annotations nobody gave. */
function entriesWhere(keep: (value: unknown) => boolean) {
  return (value: unknown): unknown => {
    const map = objectOrEmpty(value);
    if (!map || typeof map !== "object") return map;
    return Object.fromEntries(Object.entries(map).filter(([, entry]) => keep(entry)));
  };
}

/** An object, or nothing. */
function objectOrUndefined(value: unknown): unknown {
  return value && typeof value === "object" && !Array.isArray(value) ? value : undefined;
}

const nullableString = z.preprocess(blankToNull, z.string().trim().min(1).nullable());

export const rawPriceSchema = z.object({
  /** The price's own word ("door", "advance"); "price" when the page gives none. */
  label: z.preprocess(
    (value) => (typeof value === "string" && value.trim() !== "" ? value : "price"),
    z.string().trim().min(1),
  ),
  amount: z.preprocess(numberOrNull, z.number().finite().min(0).nullable()).default(null),
  currency: z
    .preprocess(
      (value) =>
        typeof value === "string" && /^[A-Za-z]{3}$/.test(value.trim())
          ? value.trim().toUpperCase()
          : null,
      z.string().length(3).nullable(),
    )
    .default(null),
  includes: nullableString.default(null),
});

/**
 * Evidence and confidence are maps keyed by field. Without a grammar to hold it to that shape
 * (D-056), a model sometimes writes one quote or one number instead; that is read as no map
 * rather than failing every listing on the page. The listing's facts still stand on their own
 * validation; only the unreadable annotation is dropped.
 */
function objectOrEmpty(value: unknown): unknown {
  if (value === undefined || value === null) return undefined;
  return typeof value === "object" && !Array.isArray(value) ? value : {};
}

export const rawListingSchema = z.object({
  title: z.string().trim().min(1),
  /** A listing type outside the list is "other", not a failed page. */
  listing_type: z.preprocess(
    (value) =>
      typeof value === "string" && (LISTING_TYPE_KEYS as readonly string[]).includes(value)
        ? value
        : "other",
    listingTypeKeySchema,
  ),
  /**
   * Taxonomy keys; the prompt lists them. A style the model names outside the taxonomy is left
   * off rather than failing the page; the source's own styles still apply downstream.
   */
  styles: z.preprocess(
    (value) =>
      arrayOrEmpty(value).filter(
        (key): key is string =>
          typeof key === "string" && (STYLE_KEYS as readonly string[]).includes(key),
      ),
    z.array(styleKeySchema),
  ),
  /** The date as stated; null when the page only gives a recurrence ("every Thursday"). */
  local_date: z
    .preprocess(
      (value) =>
        typeof value === "string" && nightDateSchema.safeParse(value.trim()).success
          ? value.trim()
          : null,
      nightDateSchema.nullable(),
    )
    .default(null),
  doors_time: statedTimeSchema,
  lesson_time: statedTimeSchema,
  dancing_time: statedTimeSchema,
  end_time: statedEndTimeSchema,
  venue: z.preprocess(
    (value) => objectOrUndefined(value) ?? {},
    z.object({
      name: nullableString.default(null),
      address: nullableString.default(null),
      url: optionalHttpUrl.default(null),
    }),
  ),
  organizer: z.preprocess(
    (value) => objectOrUndefined(value) ?? {},
    z.object({
      name: nullableString.default(null),
      url: optionalHttpUrl.default(null),
    }),
  ),
  prices: z.preprocess(
    (value) => arrayOrEmpty(value).filter((item) => objectOrUndefined(item) !== undefined),
    z.array(rawPriceSchema),
  ),
  is_free: z.preprocess(booleanOrNull, z.boolean().nullable()).default(null),
  ticket_url: optionalHttpUrl.default(null),
  level: nullableString.default(null),
  partner_required: z.preprocess(booleanOrNull, z.boolean().nullable()).default(null),
  age_min: z
    .preprocess((value) => {
      const n = numberOrNull(value);
      return typeof n === "number" && Number.isInteger(n) ? n : null;
    }, z.number().int().min(0).nullable())
    .default(null),
  dress_code: nullableString.default(null),
  floor: nullableString.default(null),
  indoor_outdoor: z
    .preprocess(
      oneOfOrNull(["indoor", "outdoor", "both"]),
      z.enum(["indoor", "outdoor", "both"]).nullable(),
    )
    .default(null),
  music: z
    .preprocess(
      objectOrUndefined,
      z.object({
        djs: z.preprocess(namesOnly, z.array(z.string().trim().min(1))),
        bands: z.preprocess(namesOnly, z.array(z.string().trim().min(1))),
        genre_mix: z.preprocess(textOrNull, nullableString).default(null),
      }),
    )
    .default({ djs: [], bands: [], genre_mix: null }),
  crowd_size_hint: nullableString.default(null),
  /** The recurrence phrase as written ("every Thursday"); never turned into a date here. */
  recurrence_text: nullableString.default(null),
  cancelled: z.preprocess(booleanOrNull, z.boolean().nullable()).default(null),
  /** A short quote per populated field, cut to EVIDENCE_MAX_CHARS (D-009) rather than rejected. */
  evidence: z.preprocess(
    entriesWhere((quote) => typeof quote === "string"),
    z
      .record(
        z.string(),
        z.string().transform((quote) => quote.slice(0, EVIDENCE_MAX_CHARS)),
      )
      .default({}),
  ),
  /** 0 to 1 per populated field. */
  confidence: z.preprocess(
    entriesWhere((score) => typeof score === "number" && score >= 0 && score <= 1),
    z.record(z.string(), z.number().min(0).max(1)).default({}),
  ),
});
export type RawListing = z.infer<typeof rawListingSchema>;

export const pageKindSchema = z.enum([
  "single_event",
  "list",
  "calendar",
  "venue_home",
  "class_schedule",
  "not_relevant",
]);

export const rawExtractionSchema = z.object({
  /** A page kind outside the list is read as "list", the kind that makes no claim about it. */
  page_kind: z.preprocess(
    (value) =>
      typeof value === "string" && (pageKindSchema.options as readonly string[]).includes(value)
        ? value
        : "list",
    pageKindSchema,
  ),
  /** BCP 47 language tag of the page text; "und" (undetermined) when the reply gives none. */
  language: z.preprocess(
    (value) => (typeof value === "string" && value.trim().length >= 2 ? value : "und"),
    z.string().trim().min(2),
  ),
  /**
   * An entry with no title is not an event the page named, so it is left out; every other
   * entry is validated in full.
   */
  listings: z.preprocess(
    (value) =>
      arrayOrEmpty(value).filter((entry) => {
        const title = (objectOrUndefined(entry) as { title?: unknown } | undefined)?.title;
        return typeof title === "string" && title.trim() !== "";
      }),
    z.array(rawListingSchema),
  ),
});
export type RawExtraction = z.infer<typeof rawExtractionSchema>;

/** Mean of a listing's per-field confidences; null when none were given (escalation rule in PLAN 8.2). */
export function meanConfidence(listing: Pick<RawListing, "confidence">): number | null {
  const values = Object.values(listing.confidence);
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}
