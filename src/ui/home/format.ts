// Values, not copy. Every sentence on the home screen comes from src/i18n/en.ts (D-038); the
// helpers here only turn a number or an instant into a string Intl is responsible for, which is
// exactly what en.ts's header comment asks callers to do ("values arrive already formatted").

import { t } from "@/src/i18n";
import {
  isConfirmedByOrganiser,
  type Listing,
  type ListingPrice,
  type ListingSource,
} from "@/src/domain/listing";
import { MINUTE_MS, HOUR_MS } from "@/src/domain/time";

/** Metric locales get km, the rest miles; Intl decides, so nothing is hard-coded per country. */
export function formatDistance(km: number, locale: string): string {
  const metric = usesMetric(locale);
  const value = metric ? km : km / 1.609344;
  return new Intl.NumberFormat(locale, {
    style: "unit",
    unit: metric ? "kilometer" : "mile",
    unitDisplay: "short",
    maximumFractionDigits: value < 10 ? 1 : 0,
  }).format(value);
}

/**
 * The same, rounded to whole units. The radius choices are round numbers of kilometres, and
 * "Within 3 mi" reads like a choice where "Within 3.1 mi" reads like a measurement.
 */
export function formatRadius(km: number, locale: string): string {
  const metric = usesMetric(locale);
  return new Intl.NumberFormat(locale, {
    style: "unit",
    unit: metric ? "kilometer" : "mile",
    unitDisplay: "short",
    maximumFractionDigits: 0,
  }).format(metric ? km : km / 1.609344);
}

const IMPERIAL_DISTANCE = new Set(["US", "GB", "LR", "MM"]);

function usesMetric(locale: string): boolean {
  const region = new Intl.Locale(locale).maximize().region;
  return region === undefined || !IMPERIAL_DISTANCE.has(region);
}

export function formatMoney(amount: number, currency: string, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    maximumFractionDigits: Number.isInteger(amount) ? 0 : 2,
  }).format(amount);
}

/** "2 hr. ago" in the visitor's locale; the unit and the word are Intl's, never ours. */
export function formatAgo(from: Date, now: Date, locale: string): string {
  const elapsed = now.getTime() - from.getTime();
  const format = new Intl.RelativeTimeFormat(locale, { numeric: "auto", style: "narrow" });
  if (elapsed < HOUR_MS) {
    return format.format(-Math.max(1, Math.round(elapsed / MINUTE_MS)), "minute");
  }
  if (elapsed < 24 * HOUR_MS) return format.format(-Math.round(elapsed / HOUR_MS), "hour");
  return format.format(-Math.round(elapsed / (24 * HOUR_MS)), "day");
}

/**
 * A tier anyone can buy, as opposed to a members' or students' one. "Entry" is the label the
 * pipeline gives an amount a page states with no tier (src/domain/prices.ts, the JSON-LD and
 * The Events Calendar feeds), so "$20, $15 students" is Entry 20 and Students 15.
 */
const GENERAL_TIER =
  /^(general|general admission|general public|admission|entry|entrance|cover|adults?|standard)$/i;

/**
 * The price the card prints: the listed door or advance price; else the general price, or the one
 * price when every tier costs the same, bare; else "From" the cheapest. A dancer walking in pays
 * the general price, so "From $15" for the students' tier under a $25 general price misled, and
 * "From $11" over one price implied a range (review, 2026-09-28).
 */
export function cardPrice(listing: Listing, locale: string): string | null {
  if (listing.isFree === true) return t("card.price.free");
  const byLabel = (name: string): ListingPrice | undefined =>
    listing.prices.find((p) => p.label.toLowerCase() === name && p.amount !== null);

  const door = byLabel("door");
  if (door?.amount != null) {
    return t("card.price.door", { price: formatMoney(door.amount, door.currency, locale) });
  }
  const advance = byLabel("advance");
  if (advance?.amount != null) {
    return t("card.price.advance", {
      price: formatMoney(advance.amount, advance.currency, locale),
    });
  }
  const priced = listing.prices.filter(
    (p): p is ListingPrice & { amount: number } => p.amount !== null,
  );
  if (priced.length === 0) return null;
  const general = priced.find((p) => GENERAL_TIER.test(p.label.trim()));
  const [first] = priced;
  // One price, the same for every tier: but a lone members' or students' tier is not what anyone
  // pays at the door, so it keeps "From" (review, 2026-09-28).
  const flat =
    general ??
    (first !== undefined &&
    priced.length > 1 &&
    priced.every((p) => p.amount === first.amount && p.currency === first.currency)
      ? first
      : undefined);
  if (flat !== undefined) {
    if (flat.amount === 0) return t("card.price.free");
    return t("card.price.flat", { price: formatMoney(flat.amount, flat.currency, locale) });
  }
  const cheapest = priced.reduce((a, b) => (b.amount < a.amount ? b : a));
  if (cheapest.amount === 0) return t("card.price.free");
  return t("card.price.from", {
    price: formatMoney(cheapest.amount, cheapest.currency, locale),
  });
}

/** The currency the sheet's price ceilings are written in: the one this night's listings use. */
export function dominantCurrency(listings: readonly Listing[], fallback = "USD"): string {
  const tally = new Map<string, number>();
  for (const listing of listings) {
    for (const price of listing.prices)
      tally.set(price.currency, (tally.get(price.currency) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [currency, count] of tally) {
    if (count > bestCount) {
      best = currency;
      bestCount = count;
    }
  }
  return best ?? fallback;
}

/** "SOB's, SoHo", or just the venue when the neighborhood is not listed. */
export function venueLine(listing: Listing): string {
  if (listing.venue === null) return t("card.place.locationNotListed");
  const neighborhood = listing.venue.neighborhood;
  if (neighborhood === null) return listing.venue.name;
  return t("card.place.venueAndNeighborhood", {
    venue: listing.venue.name,
    neighborhood,
  });
}

/**
 * "Lesson 6:30, dancing 7:30": the times the stamp does not already say. The stamp is the start,
 * which is the dancing time, else the lesson, else the doors, so the line prints a lesson that
 * comes at another time than the dancing, else doors that open before the start, else nothing.
 * It used to print the start again on 21 of 24 cards ("9:00 ... Lesson 9pm"), and "Dancing 10pm"
 * where the new fact was doors at 9:30 (review, 2026-09-28).
 */
export function lessonLine(
  listing: Listing,
  formatClock: (instant: Date) => string,
): string | null {
  const { lessonAt, dancingAt, doorsAt, startsAt } = listing;
  if (lessonAt && dancingAt && lessonAt.getTime() !== dancingAt.getTime()) {
    return t("card.lesson.both", {
      lesson: formatClock(lessonAt),
      dancing: formatClock(dancingAt),
    });
  }
  if (doorsAt && startsAt && doorsAt.getTime() < startsAt.getTime()) {
    return t("card.lesson.doorsOnly", { doors: formatClock(doorsAt) });
  }
  return null;
}

/** The latest time any of these sources was read; null when there are none. */
function latestCheck(sources: readonly ListingSource[]): Date | null {
  return sources.reduce<Date | null>(
    (latest, source) =>
      latest === null || source.checkedAt.getTime() > latest.getTime() ? source.checkedAt : latest,
    null,
  );
}

/**
 * Returns a warning string a dancer must see before going, or null if no such warning exists.
 * Used for the card's warning line; "checked 9h ago" lines move to the event page's Sources section.
 */
export function cardWarning(listing: Listing): string | null {
  if (listing.startsAt === null) return t("card.flags.checkBeforeYouGo");
  if (listing.confirmation === "conflicting") return t("card.flags.sourcesDisagree");
  // No source has been checked and it is not confirmed by the organiser
  const hasCheckedSource = latestCheck(listing.sources) !== null;
  if (!hasCheckedSource && !isConfirmedByOrganiser(listing)) {
    return t("card.flags.recurringUnconfirmed");
  }
  return null;
}

/**
 * The confirmation flag, the last line of a card. It says where the listing was checked (D-072):
 * "On the organizer's page, checked 2h ago" when the organiser's own page confirms tonight, "On
 * the ticket page, checked 2h ago" when only a ticket seller's does (a ticket seller is not the
 * organiser), and otherwise "Listing checked 2h ago", when we last read it, rather than silence.
 * A listing whose time is not listed never names a confirming page: whatever was confirmed, the
 * time was not, so its flag is "Check before you go" (D-060, DESIGN section 5).
 */
export function confirmationLine(listing: Listing, now: Date, locale: string): string | null {
  if (listing.startsAt === null) return t("card.flags.checkBeforeYouGo");
  // Only the organiser's own page or ticket page confirms (D-061); the organiser's own page is
  // named first when both do. A directory's dated listing falls through to when it was checked.
  if (isConfirmedByOrganiser(listing)) {
    const organizer = latestCheck(listing.sources.filter((s) => s.tier === "organizer"));
    if (organizer !== null) {
      return t("card.flags.onOrganizerPage", { ago: formatAgo(organizer, now, locale) });
    }
    const ticket = latestCheck(listing.sources.filter((s) => s.tier === "ticketing"));
    if (ticket !== null) {
      return t("card.flags.onTicketPage", { ago: formatAgo(ticket, now, locale) });
    }
  }
  if (listing.confirmation === "conflicting") return t("card.flags.sourcesDisagree");
  const checked = latestCheck(listing.sources);
  if (checked === null) return t("card.flags.recurringUnconfirmed");
  return t("card.flags.listingChecked", { ago: formatAgo(checked, now, locale) });
}
