// The family key to Tailwind class maps (D-036; colour as text and bar since D-147). Tailwind cannot build a class name at runtime, so
// every stock is named here as a literal, and a test asserts this map and config/styles.ts carry
// exactly the same thirteen families. That is the "cannot drift apart" guarantee DESIGN.md asks for.

import type { FamilyKey } from "@/config/styles";
import type { ListingType } from "@/src/domain/listing-types";

/** A family's colour as text: its name above a listing (D-147). */
export const STOCK_TEXT: Readonly<Record<FamilyKey, string>> = Object.freeze({
  salsa: "text-stock-salsa",
  kizomba: "text-stock-kizomba",
  swing: "text-stock-swing",
  tango: "text-stock-tango",
  ballroom: "text-stock-ballroom",
  country: "text-stock-country",
  folk: "text-stock-folk",
  ecstatic: "text-stock-ecstatic",
  club: "text-stock-club",
  hiphop: "text-stock-hiphop",
  kpop: "text-stock-kpop",
  silent: "text-stock-silent",
  other: "text-stock-other",
});

/** A family's colour as the 3px bar beside a listing (D-147). */
export const STOCK_BAR: Readonly<Record<FamilyKey, string>> = Object.freeze({
  salsa: "border-stock-salsa",
  kizomba: "border-stock-kizomba",
  swing: "border-stock-swing",
  tango: "border-stock-tango",
  ballroom: "border-stock-ballroom",
  country: "border-stock-country",
  folk: "border-stock-folk",
  ecstatic: "border-stock-ecstatic",
  club: "border-stock-club",
  hiphop: "border-stock-hiphop",
  kpop: "border-stock-kpop",
  silent: "border-stock-silent",
  other: "border-stock-other",
});

export function stockClass(family: FamilyKey): string {
  return STOCK_TEXT[family];
}

export function stockBarClass(family: FamilyKey): string {
  return STOCK_BAR[family];
}

/**
 * A type word is dropped when the family chip beside it already says it (DESIGN section 6:
 * "Mister Sunday shows 21+ alone after its chip"). Spelled out rather than guessed from the
 * words, so adding a family cannot silently start hiding a type. The card and the detail title
 * block both read it from here, so the two cannot disagree about what the chip already says
 * (D-069).
 */
export const TYPE_REPEATS_FAMILY: Readonly<Partial<Record<ListingType, FamilyKey>>> = Object.freeze(
  { club_night: "club" },
);

/** True when `family`'s chip already says what `listingType`'s word would. */
export function typeRepeatsFamily(
  listingType: ListingType,
  family: FamilyKey | undefined,
): boolean {
  return family !== undefined && TYPE_REPEATS_FAMILY[listingType] === family;
}

/**
 * Whether the type word is printed beside the family chip, on the card and on the event page
 * alike: not when the chip already says it, and never "Other", which tells a dancer nothing
 * (review, 2026-09-28; D-067, D-069).
 */
export function typeWordShown(listingType: ListingType, family: FamilyKey | undefined): boolean {
  return listingType !== "other" && !typeRepeatsFamily(listingType, family);
}
