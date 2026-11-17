// The end of the bill: what an empty list means, and the print-run control.
//
// DESIGN section 6 draws the tail as "Quiet after 1am. Showing tomorrow too, and places within
// 15 miles." That sentence promises two things this build does not do — the thin-results
// widening and spilling into tomorrow are still ahead (PLAN section 11) — and copy that claims
// work we have not done is the one thing this project will not ship. So the tail says only what
// is true of the list above it.

import Link from "next/link";

import { t } from "@/src/i18n";
import { ThemePicker } from "@/src/ui/ThemePicker";

import { hrefWith, type RawParams } from "./params";

/**
 * Every filter param, so "Clear filters" returns the night as it is. Not the distance: the count
 * the sentence gives is the night within the distance already chosen, and clearing it would show
 * a different number than the one promised.
 */
const FILTER_PARAMS = [
  "t",
  "f",
  "s",
  "price",
  "free",
  "lvl",
  "lesson",
  "np",
  "age",
  "live",
  "now",
  "conf",
  "filters",
] as const;

/**
 * An empty list says which of two things happened (review, 2026-09-28): the night itself has
 * nothing within reach, or the filters hid what it has, in which case it offers to clear them.
 * It used to say "Nothing on tonight" whenever the filtered list was empty, which was untrue, and
 * nothing at all on any other night.
 *
 * A night with nothing within a distance the dancer narrowed can still have listings with no
 * location, which that distance leaves out because nobody said they are within it (D-082). The
 * tail then says how many, and offers to clear the distance, never "Nothing on".
 *
 * When a search hides every listing, the tail says nothing matches the typed words and offers
 * "Clear search", which clears the search alone, leaving the other filters as they were.
 *
 * "Know a night we missed? Add it." waits for the suggest page (task 13): until then it would be
 * an invitation with nothing behind it.
 */
export function Tail({
  place,
  dayLabel,
  isTonight,
  shown,
  night,
  unplacedHidden,
  params,
  search,
}: {
  place: string | null;
  dayLabel: string;
  isTonight: boolean;
  /** Listings the list shows. */
  shown: number;
  /** The night's listings within reach before any filter. */
  night: number;
  /**
   * The night's listings with no location that a narrowed distance leaves out, before any filter
   * (D-082). Required, so the tail cannot say "Nothing on" for want of it; the page counts them
   * only when `night` is 0, and passes 0 otherwise.
   */
  unplacedHidden: number;
  params: RawParams;
  /** The search text, if any, that filtered the list; null when no search is active. */
  search: string | null;
}) {
  const clearAll = hrefWith(
    params,
    Object.fromEntries(FILTER_PARAMS.map((key) => [key, null])) as Record<string, null>,
  );
  return (
    <div className="mt-6 px-4 pb-6">
      {shown > 0 || place === null ? null : night === 0 && unplacedHidden > 0 ? (
        <p className="type-body text-ink">
          {t("home.empty.unplacedHidden", { count: unplacedHidden })}{" "}
          <Link
            href={hrefWith(params, { r: null })}
            scroll={false}
            prefetch={false}
            className="type-label text-ink min-h-11 inline-flex items-center underline underline-offset-4"
          >
            {t("home.filters.clearDistance")}
          </Link>
        </p>
      ) : night === 0 ? (
        <p className="type-body text-ink">
          {isTonight
            ? t("home.empty.nothingTonight", { place })
            : t("home.empty.nothingOn", { day: dayLabel, place })}
        </p>
      ) : (
        <p className="type-body text-ink">
          {search !== null
            ? t("home.empty.noSearchMatch", { count: night, query: search })
            : t("home.empty.noMatch", { count: night })}{" "}
          <Link
            href={search !== null ? hrefWith(params, { place: null }) : clearAll}
            scroll={false}
            prefetch={false}
            className="type-label text-ink min-h-11 inline-flex items-center underline underline-offset-4"
          >
            {search !== null ? t("home.filters.clearSearch") : t("home.filters.clear")}
          </Link>
        </p>
      )}
      <ThemePicker className="mt-6" />
    </div>
  );
}
