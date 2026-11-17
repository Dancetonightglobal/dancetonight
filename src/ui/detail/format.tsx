// Pure formatting for the event detail page (DESIGN.md section 7). No JSX, no I/O, no React:
// every function here maps a Listing to strings, so the sections stay thin renderers and the
// awkward parts (where the now rule falls in the When rail, the .ics text, a listing whose
// sources disagree) are testable without a DOM. Every word a dancer reads comes from src/i18n
// (D-038); nothing here writes copy of its own.

import type { ListingType } from "@/src/domain/listing-types";
import type { Listing, ListingPrice, ListingSource, PlacedListing } from "@/src/domain/listing";
import {
  HOUR_MS,
  MINUTE_MS,
  addCalendarDays,
  formatCalendarDate,
  formatTime,
} from "@/src/domain/time";
import { foldForMatch } from "@/src/domain/text-facts";
import { currentNightDate, isOpenableNight, isTonight } from "@/src/domain/tonight";
import { t, type TranslationKey } from "@/src/i18n";
import { typeWordShown } from "@/src/ui/stocks";
import { nightOutcome, outboundLinks } from "@/src/ui/links";

/**
 * Every screen formats for this one locale, and nothing in v1 passes another: the app is English
 * only (src/i18n), so a page that guessed at times, distances and money from `navigator.language`
 * would read half in one convention and half in another. The helpers below all take a `locale`
 * so the day the app does negotiate one is a change to their callers and not to their insides;
 * until then the second argument is documentation of an intent, not a live code path.
 */
export const DEFAULT_LOCALE = "en-US";

const DAY_MS = 24 * HOUR_MS;

/** A listed level that promises the lesson is for newcomers, so the When row can say so. */
const BEGINNER_LESSON = /\b(beginner|newcomer|no experience|all levels)\b/i;

// ---------------------------------------------------------------------------------------------
// The title block

/**
 * The long listing-type wording the detail title block uses ("Social dance", not the card's
 * "Social"); en.ts keeps both sets, key for key. config/styles.ts `listingTypeLabel` serves the
 * short form for cards, so the two never collide.
 */
const DETAIL_TYPE_COPY = {
  social: "detail.types.social",
  class: "detail.types.class",
  club_night: "detail.types.clubNight",
  practica: "detail.types.practica",
  live_music_with_dancing: "detail.types.liveMusicWithDancing",
  festival_session: "detail.types.festivalSession",
  outdoor_public: "detail.types.outdoorPublic",
  jam: "detail.types.jam",
  venue_open_night: "detail.types.venueOpenNight",
  other: "detail.types.other",
} as const satisfies Record<ListingType, TranslationKey>;

export function detailTypeLabel(listingType: ListingType): string {
  return t(DETAIL_TYPE_COPY[listingType]);
}

/**
 * The type word beside the family chip, or null when it would say nothing: when the chip already
 * says it (the card's own rule, shared through src/ui/stocks.ts so the two cannot drift), and for
 * "other", which tells a dancer nothing the chip does not (D-069).
 */
export function titleTypeWord(listing: Listing): string | null {
  if (!typeWordShown(listing.listingType, listing.families[0])) return null;
  return detailTypeLabel(listing.listingType);
}

/**
 * "Tonight · Mon, Sep 28", "Tomorrow · Tue, Sep 29" or "Sat, Oct 3": the night this listing is
 * on, read against the current night in the listing's own zone (src/domain/tonight.ts), so a page
 * opened after midnight still calls the night that is on "tonight".
 */
export function nightLabel(listing: Listing, now: Date, locale: string = DEFAULT_LOCALE): string {
  const date = formatCalendarDate(listing.nightDate, locale);
  const tonight = currentNightDate(now, listing.tz);
  if (listing.nightDate === tonight) return t("detail.date.tonight", { date });
  if (listing.nightDate === addCalendarDays(tonight, 1)) {
    return t("detail.date.tomorrow", { date });
  }
  return date;
}

/**
 * The date line under the title (DESIGN.md section 7, D-069). A cancelled or ended night says so
 * on this line ("Thu, Oct 1 · Cancelled"), and the title block then leaves out the status line,
 * which would only repeat the word without the date.
 */
export function dateLine(listing: Listing, now: Date, locale: string = DEFAULT_LOCALE): string {
  const day = nightLabel(listing, now, locale);
  const outcome = nightOutcome(listing);
  if (outcome === "cancelled") return t("detail.date.cancelled", { day });
  if (outcome === "ended") return t("detail.date.ended", { day });
  return day;
}

/**
 * The tab title and the share sheet's title: "Tango Cafe · Wed, Sep 30". Always the plain date,
 * never "Tonight": a bookmark or a shared link is read on another day.
 */
export function pageTitle(listing: Listing, locale: string = DEFAULT_LOCALE): string {
  return t("detail.pageTitle", {
    title: listing.title,
    date: formatCalendarDate(listing.nightDate, locale),
  });
}

/**
 * Where "Back" goes when the page cannot step back through history (a shared link, a new tab):
 * the home page on this listing's night, labelled with that night. The client BackLink steps
 * back instead when the dancer came from the home page, which keeps their filters and scroll.
 *
 * Only a night the home page opens can be named: tonight through tonight + 12, the picker's seven
 * nights and the six after them (isOpenableNight, D-075). The home page reads any other `day` (a
 * night that is over, or the ingest's last night, which may not be written yet) as tonight
 * (parseHomeParams, D-067). So such a listing goes back to tonight and says so, rather than
 * naming a night the tap will not open (review, 2026-09-28).
 */
export function backLink(
  listing: Listing,
  now: Date,
  locale: string = DEFAULT_LOCALE,
): { href: string; label: string } {
  const tonight = currentNightDate(now, listing.tz);
  if (!isOpenableNight(listing.nightDate, now, listing.tz)) {
    return { href: "/", label: t("detail.back.tonight") };
  }
  const href = `/?day=${encodeURIComponent(listing.nightDate)}`;
  if (listing.nightDate === tonight) return { href, label: t("detail.back.tonight") };
  if (listing.nightDate === addCalendarDays(tonight, 1)) {
    return { href, label: t("detail.back.tomorrow") };
  }
  return {
    href,
    label: t("detail.back.day", { day: formatCalendarDate(listing.nightDate, locale) }),
  };
}

// ---------------------------------------------------------------------------------------------
// When

export type WhenRowKey = "start" | "doors" | "lesson" | "dancing" | "ends";

export interface WhenRow {
  key: WhenRowKey;
  /**
   * The instant the row stamps; null on an ends row with no listed end, and on the "start" row of
   * a listing whose time is not listed (D-060), whose rail cell is empty.
   */
  at: Date | null;
  /** The stamped time, through formatTime so a 24-hour locale reads 19:42; null with `at`. */
  time: string | null;
  label: string;
}

/**
 * Doors, lesson, dancing, ends, in time order, each with its own stamped time. A row whose time
 * is not listed is left out rather than guessed; the ends row is the exception, because "End not
 * listed" is itself information (DESIGN.md section 9).
 *
 * A listing whose time is not listed (D-060) opens with a "Time not listed" row whose rail cell
 * is empty, then "Ends" only when an end is listed: "End not listed" under "Time not listed"
 * would say nothing a dancer does not already know (DESIGN.md section 7).
 */
export function whenRows(listing: Listing, locale: string = DEFAULT_LOCALE): WhenRow[] {
  const stamp = (at: Date) => formatTime(at, listing.tz, locale);
  if (listing.startsAt === null) {
    const rows: WhenRow[] = [
      { key: "start", at: null, time: null, label: t("detail.when.timeNotListed") },
    ];
    if (listing.endsAt !== null) {
      rows.push({
        key: "ends",
        at: listing.endsAt,
        time: stamp(listing.endsAt),
        label: t("detail.when.ends"),
      });
    }
    return rows;
  }
  // Equal instants merge (D-069): a rail that stamps "3pm Doors, 3pm Lesson, 3pm Dancing starts"
  // reads as a contradiction. Doors at the same time as the lesson or the dancing says nothing the
  // later row does not; a lesson at the same time as the dancing keeps the lesson, because the
  // lesson is what a dancer plans around.
  const same = (a: Date | null, b: Date | null) =>
    a !== null && b !== null && a.getTime() === b.getTime();
  const showDoors =
    listing.doorsAt !== null &&
    !same(listing.doorsAt, listing.lessonAt) &&
    !same(listing.doorsAt, listing.dancingAt);
  const showDancing = listing.dancingAt !== null && !same(listing.dancingAt, listing.lessonAt);
  const rows: WhenRow[] = [];
  if (showDoors && listing.doorsAt !== null) {
    rows.push({
      key: "doors",
      at: listing.doorsAt,
      time: stamp(listing.doorsAt),
      label: t("detail.when.doors"),
    });
  }
  if (listing.lessonAt !== null) {
    const beginner = listing.level !== null && BEGINNER_LESSON.test(listing.level);
    rows.push({
      key: "lesson",
      at: listing.lessonAt,
      time: stamp(listing.lessonAt),
      label: beginner ? t("detail.when.lessonBeginnerFriendly") : t("detail.when.lesson"),
    });
  }
  if (showDancing && listing.dancingAt !== null) {
    rows.push({
      key: "dancing",
      at: listing.dancingAt,
      time: stamp(listing.dancingAt),
      label: t("detail.when.dancingStarts"),
    });
  }
  rows.sort((a, b) => (a.at?.getTime() ?? 0) - (b.at?.getTime() ?? 0));
  rows.push(
    listing.endsAt === null
      ? { key: "ends", at: null, time: null, label: t("detail.when.endNotListed") }
      : {
          key: "ends",
          at: listing.endsAt,
          time: stamp(listing.endsAt),
          label: t("detail.when.ends"),
        },
  );
  return rows;
}

/**
 * How many rows the now rule sits below: the count of rows already stamped past. 0 puts the rule
 * above Doors (nothing has happened yet), rows.length puts it at the foot of the bill.
 */
export function nowRuleIndex(rows: readonly WhenRow[], now: Date): number {
  return rows.filter((row) => row.at !== null && row.at.getTime() <= now.getTime()).length;
}

/**
 * Whether this bill carries a now rule at all. There is no "now" on a future night (DESIGN.md
 * section 5), and none once the night has ended; a cancelled night keeps its slot and its rule.
 * A listing whose time is not listed has none either: there is no stamped row to place "now"
 * between (D-060, DESIGN.md section 7).
 */
export function showsNowRule(listing: Listing, now: Date): boolean {
  if (listing.startsAt === null) return false;
  return isTonight(
    { startsAt: listing.startsAt, endsAt: listing.endsAt, listingType: listing.listingType },
    now,
    listing.tz,
  );
}

/** The now tab's label, "Now 7:42pm", the same words as the home bill and the sticky strip. */
/** The bare clock time for the now rule. NowRule builds both the visible and the spoken string. */
export function nowTime(listing: Listing, now: Date, locale: string = DEFAULT_LOCALE): string {
  return formatTime(now, listing.tz, locale);
}

/**
 * The instant the "Times are in {zone}" line names its zone at: the start, else the first stamped
 * row. Null when no row carries a time, and then the line is left out, because it would describe
 * a clock the page never shows (D-060, DESIGN.md section 7).
 */
export function timesInZoneAt(listing: Listing, rows: readonly WhenRow[]): Date | null {
  return listing.startsAt ?? rows.find((row) => row.time !== null)?.at ?? null;
}

/**
 * The zone in words ("Eastern Daylight Time"), so the When list can say which clock it means
 * without printing an IANA identifier at a dancer.
 */
export function zoneLabel(tz: string, at: Date, locale: string = DEFAULT_LOCALE): string {
  const parts = new Intl.DateTimeFormat(locale, {
    timeZone: tz,
    timeZoneName: "long",
  }).formatToParts(at);
  return parts.find((part) => part.type === "timeZoneName")?.value ?? tz;
}

// ---------------------------------------------------------------------------------------------
// Cost

export interface CostRow {
  /** The stamped amount; null when the tier has no listed amount (a donation, say). */
  amount: string | null;
  /** The tier's name in sentence case; null when the source's label only repeated the amount. */
  label: string | null;
  includes: string | null;
}

/** Source words for the two tiers the page already has copy for (en.ts detail.cost). */
const TIER_COPY: Readonly<Record<string, "detail.cost.door" | "detail.cost.advance">> = {
  door: "detail.cost.door",
  "at the door": "detail.cost.door",
  advance: "detail.cost.advance",
  "in advance": "detail.cost.advance",
};

/**
 * Who a price is for, as sources put it in the wrong field ("Includes General Public",
 * "Includes Students"). "Includes" is only what the price covers (a class, drinks), so a value
 * that names an audience joins the tier's name instead (D-069). Deliberately a closed list of
 * whole values: anything else stays where the source put it.
 */
const AUDIENCE =
  /^(the )?(general public|general|public|students?|seniors?|members?|non-?members?|adults?|children|kids|youth|military|veterans?|everyone)$/i;

function sentenceCase(text: string): string {
  return text.length === 0 ? text : text[0]!.toUpperCase() + text.slice(1);
}

/** True when a source's label only restates the amount ("$11" beside $11, "Free" beside 0). */
function labelRepeatsAmount(label: string, price: ListingPrice, amount: string | null): boolean {
  const bare = label.trim().toLowerCase();
  if (amount !== null && bare === amount.toLowerCase()) return true;
  if (price.amount === null) return false;
  // "$11", "11", "11.00", "USD 11", "11 usd": one currency mark at most, then the same number.
  const number = bare.replace(/^(?:[a-z]{3}\s*|[^\w\s]\s*)/, "").replace(/\s*[a-z]{3}$/, "");
  return /^\d+(?:\.\d+)?$/.test(number) && Number(number) === price.amount;
}

/** The tier's name in the page's own words: mapped when we have copy for it, else sentence case. */
function tierLabel(label: string): string {
  const key = TIER_COPY[label.trim().toLowerCase()];
  return key === undefined ? sentenceCase(label.trim()) : t(key);
}

function formatAmount(price: ListingPrice, locale: string): string | null {
  if (price.amount === null) return null;
  if (price.amount === 0) return t("common.free");
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: price.currency,
    maximumFractionDigits: Number.isInteger(price.amount) ? 0 : 2,
  }).format(price.amount);
}

/**
 * Every listed tier, in the order the source gave them. With no tiers at all the row is the
 * spec's own phrase ("Free", or "Cover not listed"): a price is never invented.
 *
 * Each tier is printed in the page's words, never re-priced (D-069): a label that only repeats
 * the amount is dropped ("$11  $11"), "door" and "advance" read as the page's own "Door" and
 * "Advance", any other label starts with a capital, and an "includes" that names who the price
 * is for joins the tier's name ("Door, general public") because "Includes" is only what the
 * price covers. A tier left with no name of its own shows what it includes in its place.
 */
export function costRows(listing: Listing, locale: string = DEFAULT_LOCALE): CostRow[] {
  if (listing.prices.length === 0) {
    return [
      {
        amount: null,
        label: listing.isFree === true ? t("detail.cost.free") : t("detail.cost.notListed"),
        includes: null,
      },
    ];
  }
  return listing.prices.map((price) => {
    const amount = formatAmount(price, locale);
    const tier = labelRepeatsAmount(price.label, price, amount) ? null : tierLabel(price.label);
    const covers = price.includes?.trim() || null;
    if (covers !== null && AUDIENCE.test(covers)) {
      const who = covers.toLowerCase();
      return {
        amount,
        label: tier === null ? sentenceCase(who) : t("detail.cost.tierFor", { tier, who }),
        includes: null,
      };
    }
    const includes = covers === null ? null : t("detail.cost.includes", { what: covers });
    if (tier === null) return { amount, label: includes, includes: null };
    return { amount, label: tier, includes };
  });
}

// ---------------------------------------------------------------------------------------------
// What to expect

export interface ExpectRow {
  key: string;
  label: string;
  value: string;
}

function partnerValue(listing: Listing): string {
  if (listing.partnerRequired === null) return t("common.notListed");
  if (listing.partnerRequired) return t("detail.expect.partnerNeeded");
  return listing.listingType === "class"
    ? t("detail.expect.partnerNotNeededRotates")
    : t("detail.expect.partnerNotNeeded");
}

function floorValue(listing: Listing): string {
  const { floor, indoorOutdoor } = listing;
  if (floor !== null) {
    if (indoorOutdoor === "indoor") return t("detail.expect.floorIndoor", { floor });
    if (indoorOutdoor === "outdoor") return t("detail.expect.floorOutdoor", { floor });
    return floor;
  }
  if (indoorOutdoor === "indoor") return t("detail.where.indoor");
  if (indoorOutdoor === "outdoor") return t("detail.where.outdoor");
  return t("common.notListed");
}

function musicValue(listing: Listing): string {
  const music = listing.music;
  if (music === null) return t("common.notListed");
  const band = music.bands.length > 0 || music.liveMusic === true;
  const dj = music.djs.length > 0 || (music.liveMusic === false && music.genreMix !== null);
  let who: string | null = null;
  if (dj && band) who = t("detail.expect.musicDjAndBand");
  else if (band) who = t("detail.expect.musicBand");
  else if (dj) who = t("detail.expect.musicDj");
  const mix = music.genreMix;
  if (who !== null && mix !== null) return t("detail.expect.musicWithMix", { who, mix });
  if (who !== null) return who;
  if (mix !== null) return mix;
  return t("common.notListed");
}

/**
 * The label-and-value list. A value we do not have says so in the spec's words instead of being
 * hidden, because a missing dress code or floor is itself information (DESIGN.md section 9).
 * Age follows the same rule: an unknown age is "Not listed", never "All ages", because a 21+
 * night whose page does not say so would otherwise be shown as open to everyone (D-061).
 */
export function expectRows(listing: Listing): ExpectRow[] {
  const notListed = t("common.notListed");
  return [
    { key: "level", label: t("detail.expect.level"), value: listing.level ?? notListed },
    { key: "partner", label: t("detail.expect.partner"), value: partnerValue(listing) },
    {
      key: "age",
      label: t("detail.expect.age"),
      value:
        listing.ageMin === null
          ? notListed
          : listing.ageMin === 0
            ? t("detail.expect.ageAll")
            : t("detail.expect.ageMin", { age: listing.ageMin }),
    },
    { key: "floor", label: t("detail.expect.floor"), value: floorValue(listing) },
    { key: "music", label: t("detail.expect.music"), value: musicValue(listing) },
    { key: "dress", label: t("detail.expect.dressCode"), value: listing.dressCode ?? notListed },
    { key: "crowd", label: t("detail.expect.crowd"), value: listing.crowdSizeHint ?? notListed },
  ];
}

// ---------------------------------------------------------------------------------------------
// Sources

/** The field name a conflicting value belongs to, in the dancer's words. */
function fieldLabel(field: string): string {
  switch (field) {
    case "doorsAt":
      return t("detail.when.doors");
    case "lessonAt":
      return t("detail.when.lesson");
    case "dancingAt":
      return t("detail.when.dancingStarts");
    case "endsAt":
      return t("detail.when.ends");
    case "startsAt":
      return t("detail.when.heading");
    case "prices":
      return t("detail.cost.heading");
    default:
      return field;
  }
}

/**
 * This source's own values for the fields the sources disagree on, printed beneath its name so
 * the source name is the label (DESIGN.md section 7). Empty when this source agrees.
 */
export function sourceValueRows(source: ListingSource): { field: string; text: string }[] {
  if (source.values === undefined) return [];
  return Object.entries(source.values).map(([field, value]) => ({
    field,
    text: t("detail.sources.value", { field: fieldLabel(field), value }),
  }));
}

/** True when at least one source carries its own value, i.e. the sources disagree. */
export function sourcesDisagree(listing: Listing): boolean {
  return listing.sources.some((source) => sourceValueRows(source).length > 0);
}

// ---------------------------------------------------------------------------------------------
// Places, distances, times ago, hosts

/** "You Should Be Dancing, Midtown" when the neighborhood is known, else the venue name. */
export function venueLine(listing: Listing): string {
  if (listing.venue === null) return t("card.place.locationNotListed");
  const neighborhood = listing.venue.neighborhood;
  return neighborhood === null
    ? listing.venue.name
    : t("card.place.venueAndNeighborhood", { venue: listing.venue.name, neighborhood });
}

/** The street address as one line; null when no address is on file. */
export function venueAddress(listing: Listing): string | null {
  const address = listing.venue?.address ?? null;
  if (address === null) return null;
  if (address.formatted !== null && address.formatted.length > 0) return address.formatted;
  const parts = [
    address.line1,
    address.line2,
    address.locality,
    address.region,
    address.postcode,
  ].filter((part): part is string => part !== null && part.length > 0);
  return parts.length === 0 ? null : parts.join(", ");
}

/**
 * The address to print under the venue's name: null when there is none, or when the venue is named
 * by its own address ("37 W 26th St, 2nd floor, NYC" twice, brief F17).
 */
export function addressBesideName(listing: Listing): string | null {
  const address = venueAddress(listing);
  if (address === null || listing.venue === null) return address;
  return foldForMatch(address) === foldForMatch(listing.venue.name) ? null : address;
}

/** Regions whose dancers read miles; everyone else reads kilometres. */
const IMPERIAL_REGIONS = new Set(["US", "GB", "LR", "MM"]);

/** "2.4 mi" or "3.9 km", through Intl so the unit follows the visitor's locale. */
export function formatDistance(km: number, locale: string = DEFAULT_LOCALE): string {
  let region: string | undefined;
  try {
    region = new Intl.Locale(locale).maximize().region ?? undefined;
  } catch {
    region = undefined;
  }
  const miles = region !== undefined && IMPERIAL_REGIONS.has(region);
  const value = miles ? km / 1.609344 : km;
  return new Intl.NumberFormat(locale, {
    style: "unit",
    unit: miles ? "mile" : "kilometer",
    unitDisplay: "short",
    maximumFractionDigits: value < 10 ? 1 : 0,
  }).format(value);
}

const AGO_UNITS: readonly (readonly [Intl.RelativeTimeFormatUnit, number])[] = [
  ["year", 365 * DAY_MS],
  ["month", 30 * DAY_MS],
  ["day", DAY_MS],
  ["hour", HOUR_MS],
  ["minute", MINUTE_MS],
  ["second", 1000],
];

/** "2 hr. ago", "yesterday", "now": how long ago a source was checked, in the visitor's locale. */
export function formatAgo(from: Date, now: Date, locale: string = DEFAULT_LOCALE): string {
  const elapsed = Math.max(0, now.getTime() - from.getTime());
  const relative = new Intl.RelativeTimeFormat(locale, { numeric: "auto", style: "narrow" });
  for (const [unit, ms] of AGO_UNITS) {
    if (elapsed >= ms) return relative.format(-Math.floor(elapsed / ms), unit);
  }
  return relative.format(0, "second");
}

/**
 * What the map apps are asked to find: "name, address", so Google opens the venue's own listing
 * rather than a dropped pin at its coordinates. Null when no address is known: a name alone can
 * match a place of the same name anywhere, so the coordinates are the safer target then.
 */
export function placeQuery(listing: PlacedListing): string | null {
  const address = venueAddress(listing);
  return address === null ? null : `${listing.venue.name}, ${address}`;
}

function coordinates(listing: PlacedListing): string {
  return `${listing.venue.location.lat},${listing.venue.location.lng}`;
}

/**
 * Links that open the venue itself in each map app (the WHERE section). Google's documented Maps
 * URL: `query` names the place, and `query_place_id`, when we have one, is "the best guarantee"
 * of the right listing (developers.google.com/maps/documentation/urls, read 2026-09-28).
 */
export function placeUrls(listing: PlacedListing): { google: string; apple: string } {
  const query = placeQuery(listing);
  const placeId = listing.venue.googlePlaceId;
  const google = new URL("https://www.google.com/maps/search/");
  google.searchParams.set("api", "1");
  google.searchParams.set("query", query ?? coordinates(listing));
  if (placeId !== null) google.searchParams.set("query_place_id", placeId);
  const apple = new URL("https://maps.apple.com/");
  apple.searchParams.set("q", listing.venue.name);
  apple.searchParams.set("ll", coordinates(listing));
  const address = venueAddress(listing);
  if (address !== null) apple.searchParams.set("address", address);
  return { google: google.toString(), apple: apple.toString() };
}

/** The two map apps the directions sheet offers, routing to the named venue where one is known. */
export function directionsUrls(listing: PlacedListing): { google: string; apple: string } {
  const query = placeQuery(listing);
  const placeId = listing.venue.googlePlaceId;
  const google = new URL("https://www.google.com/maps/dir/");
  google.searchParams.set("api", "1");
  google.searchParams.set("destination", query ?? coordinates(listing));
  if (placeId !== null) google.searchParams.set("destination_place_id", placeId);
  // Apple routes to the named venue when the address names its city, so the route ends at
  // "Stepping Out Studios" rather than at a coordinate label (D-069). Many stored addresses have
  // no city ("140 2nd Ave", read by the model from a listings site), and a street with no city
  // could be a street of that name anywhere, so those still route to the coordinates.
  const locality = listing.venue.address?.locality ?? null;
  const apple = new URL("https://maps.apple.com/");
  apple.searchParams.set(
    "daddr",
    query !== null && locality !== null && locality.trim().length > 0
      ? query
      : coordinates(listing),
  );
  return { google: google.toString(), apple: apple.toString() };
}

// ---------------------------------------------------------------------------------------------
// Add to calendar (.ics)

const encoder = new TextEncoder();

/** RFC 5545 escaping: backslash, semicolon, comma and newlines. */
function icsEscape(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/** A calendar date as RFC 5545 writes a DATE value: 2026-09-20 becomes 20260920. */
function icsDate(date: string): string {
  return date.replace(/-/g, "");
}

/** UTC date-time as RFC 5545 writes it: 20260925T013000Z. */
function icsStamp(instant: Date): string {
  return `${instant
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "")}`;
}

/**
 * RFC 5545 content lines are at most 75 octets; continuations begin with one space. Folding
 * counts UTF-8 bytes and never splits a character, so an accented venue name survives the trip.
 */
function fold(line: string): string {
  const segments: string[] = [];
  let current = "";
  let bytes = 0;
  for (const char of line) {
    const size = encoder.encode(char).length;
    const limit = segments.length === 0 ? 75 : 74;
    if (bytes + size > limit) {
      segments.push(current);
      current = "";
      bytes = 0;
    }
    current += char;
    bytes += size;
  }
  segments.push(current);
  return segments.map((segment, i) => (i === 0 ? segment : ` ${segment}`)).join("\r\n");
}

/** The file name the download lands under. */
export function icsFilename(listing: Listing): string {
  return `${listing.slug}.ics`;
}

/**
 * Where "Add to calendar" points: a GET route that serves `icsFor` as text/calendar
 * (app/e/[slug]/calendar.ics/route.ts). A plain link to a text/calendar response is what iOS
 * Safari hands to Calendar's add-event sheet; a blob download goes to Files instead (D-069).
 */
export function calendarPath(listing: Listing): string {
  return `/e/${encodeURIComponent(listing.slug)}/calendar.ics`;
}

/**
 * One VEVENT for this night. An end that is not listed is left out rather than guessed, and the
 * description says so in the spec's words, so a calendar never shows an invented finish time.
 *
 * A listing whose time is not listed (D-060) is an all-day entry on its night: `DTSTART;VALUE=DATE`
 * and no DTEND, which RFC 5545 section 3.6.1 reads as the one day (a DATE start cannot take a
 * date-time end, so a listed end goes into the description instead, as "Time not listed, until
 * 2am"). Nothing gives it an hour the source did not give.
 */
export function icsFor(listing: Listing, url: string, now: Date): string {
  const place = [listing.venue?.name ?? null, addressBesideName(listing)]
    .filter((part): part is string => part !== null)
    .join(", ");
  const untimed = listing.startsAt === null;
  const whenNote = untimed
    ? listing.endsAt === null
      ? t("detail.when.timeNotListed")
      : t("card.status.timeNotListedUntil", {
          until: formatTime(listing.endsAt, listing.tz, DEFAULT_LOCALE),
        })
    : listing.endsAt === null
      ? t("detail.when.endNotListed")
      : null;
  const when =
    listing.startsAt === null
      ? [`DTSTART;VALUE=DATE:${icsDate(listing.nightDate)}`]
      : [
          `DTSTART:${icsStamp(listing.startsAt)}`,
          ...(listing.endsAt === null ? [] : [`DTEND:${icsStamp(listing.endsAt)}`]),
        ];
  const description = [listing.summary, whenNote, url]
    .filter((part): part is string => part !== null && part.length > 0)
    .join("\n");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//DanceTonight//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${icsEscape(listing.slug)}@dancetonight`,
    `DTSTAMP:${icsStamp(now)}`,
    ...when,
    `SUMMARY:${icsEscape(listing.title)}`,
    ...(place.length === 0 ? [] : [`LOCATION:${icsEscape(place)}`]),
    ...(description.length === 0 ? [] : [`DESCRIPTION:${icsEscape(description)}`]),
    `URL:${icsEscape(url)}`,
    `STATUS:${listing.confirmation === "cancelled" ? "CANCELLED" : "CONFIRMED"}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return `${lines.map(fold).join("\r\n")}\r\n`;
}

// ---------------------------------------------------------------------------------------------
// schema.org

/**
 * The Event JSON-LD for this listing (D-033: leaf pages only). Facts only, never source prose.
 *
 * A listing whose time is not listed (D-060) carries its night as a date-only `startDate`
 * ("2026-09-20"): schema.org's startDate takes a Date or a DateTime, and Google's event guidance
 * is not to state a time that is not known. No endDate: a listed end is a clock time on a night
 * that may run past midnight, and a date-time end after a date-only start is a mixed pair.
 */
export function eventJsonLd(listing: PlacedListing, url: string): Record<string, unknown> {
  const address = venueAddress(listing);
  // An offer's url is where it is sold: never a listings site's event page (D-069).
  const { tickets } = outboundLinks(listing);
  const offers = listing.prices
    .filter((price) => price.amount !== null)
    .map((price) => ({
      "@type": "Offer",
      name: price.label,
      price: price.amount,
      priceCurrency: price.currency,
      ...(tickets === null ? {} : { url: tickets }),
    }));
  return {
    "@context": "https://schema.org",
    "@type": "Event",
    name: listing.title,
    ...(listing.startsAt === null
      ? { startDate: listing.nightDate }
      : {
          startDate: listing.startsAt.toISOString(),
          ...(listing.endsAt === null ? {} : { endDate: listing.endsAt.toISOString() }),
        }),
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    eventStatus:
      listing.confirmation === "cancelled"
        ? "https://schema.org/EventCancelled"
        : "https://schema.org/EventScheduled",
    url,
    location: {
      "@type": "Place",
      name: listing.venue.name,
      ...(address === null ? {} : { address }),
      geo: {
        "@type": "GeoCoordinates",
        latitude: listing.venue.location.lat,
        longitude: listing.venue.location.lng,
      },
    },
    ...(listing.organizer === null
      ? {}
      : {
          organizer: {
            "@type": "Organization",
            name: listing.organizer.name,
            ...(listing.organizer.websiteUrl === null ? {} : { url: listing.organizer.websiteUrl }),
          },
        }),
    ...(offers.length === 0 ? {} : { offers }),
    ...(listing.summary === null ? {} : { description: listing.summary }),
  };
}
